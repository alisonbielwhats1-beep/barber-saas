import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_APP_GRANTS } from "../../../scripts/setup-local-app-role";

/** B7 owner feedback storage: manual migration 026 (static checks; it is applied only by the coordinator, locally, after
 * a read-only preflight). Raw-SQL table: no Prisma model, FORCE RLS by salon and user, append-only runtime, 90-day
 * retention and the conversation text only with consent. */
const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const code = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const migration = code(source("prisma/sql/manual/026_secretary_feedback.sql"));

describe("026_secretary_feedback", () => {
  it("is a raw-SQL table (prisma/schema.prisma untouched) with FORCE RLS scoped to the salon and the user", () => {
    expect(source("prisma/schema.prisma")).not.toContain("SecretaryFeedback");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "SecretaryFeedback"');
    expect(migration).toContain('ALTER TABLE "SecretaryFeedback" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "SecretaryFeedback" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON "SecretaryFeedback" FROM PUBLIC');
    // Review migration (backup: .demo/agenda-core/contract-migration/secretary-feedback-migration.test.before-retention-review.ts):
    // the read policy also hides rows past their retention.
    expect(migration).toContain('FOR SELECT USING ("salonId" = app_current_salon() AND "userId" = app_current_user() AND "expiresAt" > now())');
    expect(migration).toContain('FOR INSERT WITH CHECK ("salonId" = app_current_salon() AND "userId" = app_current_user())');
    expect(migration).not.toMatch(/FOR (?:UPDATE|DELETE|ALL)\b/);
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('migration:026_secretary_feedback',0))");
    expect(migration.trim().startsWith("BEGIN;")).toBe(true); expect(migration.trim().endsWith("COMMIT;")).toBe(true);
  });
  it("grants the runtime SELECT and INSERT only (append-only, UPDATE refused by trigger); anon/authenticated get nothing", () => {
    expect(migration).toContain('REVOKE ALL ON "SecretaryFeedback" FROM app_runtime;');
    expect(migration).toContain('GRANT SELECT,INSERT ON "SecretaryFeedback" TO app_runtime;');
    expect(migration).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*"SecretaryFeedback"/);
    expect(migration).toContain('REVOKE ALL ON "SecretaryFeedback" FROM anon');
    expect(migration).toContain('REVOKE ALL ON "SecretaryFeedback" FROM authenticated');
    expect(migration).toContain('BEFORE UPDATE ON "SecretaryFeedback"');
    expect(PRODUCTION_APP_GRANTS.SecretaryFeedback).toEqual(["SELECT", "INSERT"]);
  });
  it("keeps codes and opinions bounded, the conversation text only with consent, and a 90-day retention", () => {
    expect(migration).toContain(`"expiresAt" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '90 days')`);
    expect(migration).toContain('CHECK ("transcript" IS NULL OR "transcriptConsent")');
    expect(migration).toContain(`"contractVersion" ~ '^[0-9a-f]{64}$'`);
    expect(migration).toContain('jsonb_array_length("outcomeCodes")<=32');
    expect(migration).toContain('char_length("comment") BETWEEN 1 AND 1000');
    expect(migration).toContain('REFERENCES "Salon"("id") ON DELETE CASCADE');
    expect(migration).toContain('"SecretaryFeedback_expiresAt_idx"');
  });
  it("the preflight is read-only and checks its predecessors; verify checks RLS, grants, consent and retention", () => {
    const preflight = code(source("prisma/sql/manual/026_secretary_feedback.preflight.sql")).toUpperCase();
    expect(preflight).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    expect(preflight).toContain("APP_CURRENT_SALON()"); expect(preflight).toContain("APP_CURRENT_USER()"); expect(preflight).toContain("BILLINGPLANCHANGE");
    const verify = code(source("prisma/sql/manual/026_secretary_feedback.verify.sql"));
    // Privilege names inside has_table_privilege('…','UPDATE') are string literals, not commands.
    expect(verify.replace(/'[^']*'/g, "''").toUpperCase()).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    for (const check of ["relforcerowsecurity", "secretary_feedback_immutable", "SecretaryFeedback_transcript_consent", "expiresAt", "rolbypassrls", "'UPDATE'", "'DELETE'"]) expect(verify).toContain(check);
    const rollback = source("prisma/sql/manual/026_secretary_feedback.rollback.sql");
    expect(rollback).toContain('DROP TABLE IF EXISTS "SecretaryFeedback"'); expect(rollback).toMatch(/SALON_SECRETARY_FEEDBACK/);
  });
  it("review: retention is enforced, not only declared: a purge for the maintenance role (fails closed otherwise) and its schedule", () => {
    const purge = code(source("prisma/sql/manual/026_secretary_feedback.purge.sql"));
    expect(purge).toContain('DELETE FROM "SecretaryFeedback" WHERE "expiresAt" < now();');
    expect(purge).toContain("rolsuper OR rolbypassrls"); expect(purge).toMatch(/RAISE EXCEPTION/);
    expect(purge.trim().startsWith("BEGIN;")).toBe(true); expect(purge.trim().endsWith("COMMIT;")).toBe(true);
    // Only expired rows: no other DELETE, no UPDATE, no DDL, no grant.
    expect(purge.match(/\bDELETE\b/g)).toHaveLength(1);
    expect(purge.toUpperCase()).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    const schedule = code(source("prisma/sql/manual/026_secretary_feedback.schedule.sql"));
    expect(schedule).toContain(`cron.schedule('secretary-feedback-purge'`); expect(schedule).toContain('DELETE FROM "SecretaryFeedback" WHERE "expiresAt" < now()');
    expect(schedule).toContain("rolsuper OR rolbypassrls"); expect(schedule).toContain("pg_cron");
    // The migration still gives the runtime no way to delete (append-only), and verify checks the retention filter.
    expect(migration).not.toMatch(/FOR (?:UPDATE|DELETE|ALL)\b/);
    expect(code(source("prisma/sql/manual/026_secretary_feedback.verify.sql"))).toContain("'%expiresAt%now()%'");
    const store = source("src/lib/secretary-feedback.ts");
    expect(store).toContain('"createdAt" > now() - make_interval(mins => ${FEEDBACK_RATE_WINDOW_MINUTES}::int)) < ${FEEDBACK_RATE_LIMIT}::int');
    expect(store).toContain('(SELECT count(*) FROM "SecretaryFeedback" WHERE "sessionId" = ${row.sessionId}::uuid) < ${FEEDBACK_SESSION_LIMIT}::int');
  });
  it("the application reaches it only through $queryRaw inside withTenant, behind the default-off flag", () => {
    const store = source("src/lib/secretary-feedback.ts"), action = source("src/app/(admin)/servicos/secretaria/actions.ts");
    expect(store).toContain("withTenant(actor, tx => tx.$queryRaw"); expect(store).toContain('INSERT INTO "SecretaryFeedback"');
    expect(store).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe/);
    expect(store).toContain('process.env.SALON_SECRETARY_FEEDBACK === "true"');
    expect(action).toContain("secretaryFeedbackEnabled()"); expect(action).toContain("const actor = await context();");
  });
});

describe("031_secretary_feedback_rating", () => {
  const rating = code(source("prisma/sql/manual/031_secretary_feedback_rating.sql"));
  it("adds GOOD/BAD (default BAD, as every older row was 'Não era isso') without touching policies, grants or retention", () => {
    expect(rating.trim().startsWith("BEGIN;")).toBe(true); expect(rating.trim().endsWith("COMMIT;")).toBe(true);
    expect(rating).toContain("pg_advisory_xact_lock(hashtextextended('migration:031_secretary_feedback_rating',0))");
    expect(rating).toContain(`ADD COLUMN IF NOT EXISTS "rating" TEXT NOT NULL DEFAULT 'BAD'`);
    expect(rating).toContain(`CHECK ("rating" IN ('GOOD','BAD'))`);
    expect(rating).not.toMatch(/\b(GRANT|REVOKE|POLICY|DROP|DELETE)\b/);
  });
  it("preflight and verify are read-only; verify checks the column, the check and that the runtime still cannot change feedback", () => {
    const preflight = code(source("prisma/sql/manual/031_secretary_feedback_rating.preflight.sql")).toUpperCase();
    expect(preflight).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    const verify = code(source("prisma/sql/manual/031_secretary_feedback_rating.verify.sql"));
    expect(verify.replace(/'[^']*'/g, "''").toUpperCase()).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    for (const check of ["SecretaryFeedback_rating", "secretary_feedback_immutable", "'UPDATE'", "'DELETE'", "VERIFY_OK"]) expect(verify).toContain(check);
    expect(source("prisma/sql/manual/031_secretary_feedback_rating.rollback.sql")).toContain('DROP COLUMN IF EXISTS "rating"');
  });
});
