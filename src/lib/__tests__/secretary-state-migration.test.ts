import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_APP_GRANTS } from "../../../scripts/setup-local-app-role";
import { SECRETARY_STATE_MVP_GRANTS } from "../../../scripts/setup-secretary-state-mvp-access";

/** D1 storage: manual migration 027 (static checks; applied only by the coordinator, locally, after a read-only preflight).
 * Raw-SQL tables (no Prisma model): conversations and events with FORCE RLS by salon AND user, append-only events, aliases
 * with FORCE RLS by salon whose delete needs OWNER/MANAGER; the application reaches them only through tagged $queryRaw
 * inside withTenant, behind default-off flags. */
const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const code = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const migration = code(source("prisma/sql/manual/027_secretary_state.sql"));
const tables = ["SecretaryConversation", "SecretaryConversationEvent", "SecretaryNameAlias"];

describe("027_secretary_state", () => {
  it("raw-SQL tables (prisma/schema.prisma untouched), transactional with an advisory lock, FORCE RLS and no PUBLIC access", () => {
    for (const table of tables) {
      expect(source("prisma/schema.prisma")).not.toContain(table);
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL ON "${table}" FROM PUBLIC`);
      expect(migration).toContain(`REVOKE ALL ON "${table}" FROM anon`);
      expect(migration).toContain(`REVOKE ALL ON "${table}" FROM authenticated`);
    }
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('migration:027_secretary_state',0))");
    expect(migration.trim().startsWith("BEGIN;")).toBe(true); expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    // Never a catch-all policy.
    expect(migration).not.toMatch(/FOR ALL\b/);
  });
  it("conversations and events: every policy scoped to the salon AND the user; events only for a conversation the same user owns", () => {
    const scoped = '"salonId" = app_current_salon() AND "userId" = app_current_user()';
    for (const policy of ["secretary_conversation_read ON \"SecretaryConversation\" FOR SELECT USING (", "secretary_conversation_insert ON \"SecretaryConversation\" FOR INSERT WITH CHECK (",
      "secretary_conversation_update ON \"SecretaryConversation\" FOR UPDATE USING (", "secretary_conversation_delete ON \"SecretaryConversation\" FOR DELETE USING (",
      "secretary_conversation_event_read ON \"SecretaryConversationEvent\" FOR SELECT USING (", "secretary_conversation_event_insert ON \"SecretaryConversationEvent\" FOR INSERT WITH CHECK ("])
      expect(migration).toContain(`CREATE POLICY ${policy}${scoped}`);
    expect(migration).toContain('WITH CHECK ("salonId" = app_current_salon() AND "userId" = app_current_user());');
    expect(migration).toMatch(/secretary_conversation_event_insert[\s\S]*EXISTS \(SELECT 1 FROM "SecretaryConversation" c WHERE c\."id" = "conversationId"/);
    expect(migration).not.toMatch(/ON "SecretaryConversationEvent" FOR (?:UPDATE|DELETE)/);
  });
  it("events are append-only (UPDATE refused; DELETE only through the conversation's removal), codes-only and unique per (conversation, seq/clientTurnId)", () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "SecretaryConversationEvent"');
    expect(migration).toContain(`IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public."SecretaryConversation" c WHERE c."id" = OLD."conversationId") THEN`);
    expect(migration).toContain("RAISE EXCEPTION 'Secretary conversation events are append-only'");
    expect(migration).toContain('UNIQUE ("conversationId","seq")'); expect(migration).toContain('UNIQUE ("conversationId","clientTurnId")');
    expect(migration).toContain(`"kind" IN ('TURN_STARTED','TURN_OUTCOME','SELECTION','CONFIRMATION','DISCARD','RESUME','CANCEL')`);
    expect(migration).toContain(`octet_length("payload"::text) <= 2048`);
    expect(migration).toContain('REFERENCES "SecretaryConversation"("salonId","id") ON DELETE CASCADE');
  });
  it("conversations: id = sessionId, versioned, leased, bounded state and a retention bound", () => {
    expect(migration).toContain('"id" UUID PRIMARY KEY');
    expect(migration).toContain('"version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0)');
    expect(migration).toContain('"leaseUntil" TIMESTAMPTZ(3)');
    expect(migration).toContain(`"status" IN ('OPEN','CANCELLED','CLOSED','EXPIRED')`);
    expect(migration).toContain(`jsonb_typeof("state")='object' AND jsonb_typeof("state"->'json')='string'`);
    expect(migration).toContain(`CHECK ("expiresAt" <= "createdAt" + interval '3 hours')`);
    expect(migration).toContain('"salonId" TEXT NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE');
  });
  it("aliases: unique per (salon, kind, folded text), readable by the salon, learner = authenticated user, delete only for OWNER/MANAGER", () => {
    expect(migration).toContain('UNIQUE ("salonId","kind","aliasFolded")');
    expect(migration).toContain(`"kind" IN ('customer','professional','service')`);
    expect(migration).toContain('CREATE POLICY secretary_name_alias_read ON "SecretaryNameAlias" FOR SELECT USING ("salonId" = app_current_salon());');
    expect(migration).toContain('FOR INSERT WITH CHECK ("salonId" = app_current_salon() AND "createdBy" = app_current_user());');
    expect(migration).toMatch(/secretary_name_alias_delete ON "SecretaryNameAlias" FOR DELETE USING \("salonId" = app_current_salon\(\) AND EXISTS \(\s*SELECT 1 FROM "Membership" m WHERE m\."salonId" = app_current_salon\(\) AND m\."userId" = app_current_user\(\) AND m\."role" IN \('OWNER','MANAGER'\)\)\);/);
  });
  it("runtime grants: conversations SIUD, events SELECT/INSERT only, aliases SIUD; local role and MVP test role grant the same", () => {
    expect(migration).toContain('GRANT SELECT,INSERT,UPDATE,DELETE ON "SecretaryConversation" TO app_runtime;');
    expect(migration).toContain('GRANT SELECT,INSERT ON "SecretaryConversationEvent" TO app_runtime;');
    expect(migration).toContain('GRANT SELECT,INSERT,UPDATE,DELETE ON "SecretaryNameAlias" TO app_runtime;');
    expect(migration).not.toMatch(/GRANT[^;]*(?:UPDATE|DELETE)[^;]*"SecretaryConversationEvent"/);
    expect(PRODUCTION_APP_GRANTS.SecretaryConversation).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    expect(PRODUCTION_APP_GRANTS.SecretaryConversationEvent).toEqual(["SELECT", "INSERT"]);
    expect(PRODUCTION_APP_GRANTS.SecretaryNameAlias).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    expect(Object.fromEntries(SECRETARY_STATE_MVP_GRANTS)).toEqual({ SecretaryConversation: PRODUCTION_APP_GRANTS.SecretaryConversation,
      SecretaryConversationEvent: PRODUCTION_APP_GRANTS.SecretaryConversationEvent, SecretaryNameAlias: PRODUCTION_APP_GRANTS.SecretaryNameAlias });
    const script = source("scripts/setup-secretary-state-mvp-access.ts");
    expect(script).toContain('process.env.MVP_SECRETARY_STATE_ADMIN_APPROVED !== "true"'); expect(script).toContain("assertMvpTestDatabase(admin)");
    expect(script).toContain('"pg_dump.exe"'); expect(script).toContain("rollback.sql"); expect(script).toContain("MIGRATION_027_NOT_APPLIED_WITH_FORCE_RLS");
    expect(script).not.toMatch(/SUPERUSER|BYPASSRLS|CREATE ROLE|ALTER ROLE/);
  });
  it("the preflight is read-only and identifies the destination unambiguously (local disposable cluster or the CI database)", () => {
    const preflight = code(source("prisma/sql/manual/027_secretary_state.preflight.sql"));
    expect(preflight.toUpperCase()).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    expect(preflight).toContain("BEGIN TRANSACTION READ ONLY;");
    expect(preflight).toContain("current_database() = 'everflair_service_mvp' AND host(inet_server_addr()) = '127.0.0.1' AND inet_server_port() = 55441");
    expect(preflight).toContain("current_database() = 'salon_schema_ci'");
    for (const check of ["app_current_salon()", "app_current_user()", '"Membership"', "rolbypassrls", "MANAGER"]) expect(preflight).toContain(check);
  });
  it("verify is read-only and checks RLS, policies, the append-only guard, uniqueness and grants; rollback and purge are explicit", () => {
    const verify = code(source("prisma/sql/manual/027_secretary_state.verify.sql"));
    expect(verify.replace(/'[^']*'/g, "''").toUpperCase()).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    for (const check of ["relforcerowsecurity", "secretary_conversation_event_append_only", "SecretaryConversationEvent_conversationId_seq_key",
      "SecretaryNameAlias_salonId_kind_aliasFolded_key", "rolbypassrls", "'UPDATE'", "'DELETE'", "OWNER", "MANAGER"]) expect(verify).toContain(check);
    const rollback = source("prisma/sql/manual/027_secretary_state.rollback.sql");
    for (const table of tables) expect(rollback).toContain(`DROP TABLE IF EXISTS "${table}"`);
    expect(rollback).toMatch(/SALON_SECRETARY_PERSISTED_STATE/); expect(rollback).toMatch(/SALON_SECRETARY_NAME_ALIASES/);
    const purge = code(source("prisma/sql/manual/027_secretary_state.purge.sql"));
    expect(purge).toContain('DELETE FROM "SecretaryConversation" WHERE "expiresAt" < now();'); expect(purge).toContain("rolsuper OR rolbypassrls");
    expect(purge.toUpperCase()).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
  });
  it("review: retention is enforced by a scheduled purge (fail-closed, maintenance role) required before either flag is on; customer aliases follow erasure", () => {
    const schedule = source("prisma/sql/manual/027_secretary_state.schedule.sql"), purge = code(source("prisma/sql/manual/027_secretary_state.purge.sql"));
    expect(schedule).toMatch(/BEFORE turning SALON_SECRETARY_PERSISTED_STATE or SALON_SECRETARY_NAME_ALIASES on/);
    expect(schedule).toContain("(rolsuper OR rolbypassrls)"); expect(schedule).toContain("extname='pg_cron'");
    expect(schedule).toContain(`cron.schedule('secretary-conversation-purge', '*/30 * * * *', $job$DELETE FROM "SecretaryConversation" WHERE "expiresAt" < now()$job$)`);
    // The scheduled statements are exactly the purge's (one source of truth for what is deleted).
    const aliasJob = /cron\.schedule\('secretary-name-alias-purge', '[^']+', \$job\$([\s\S]*?)\$job\$\)/.exec(schedule)?.[1];
    expect(aliasJob).toBeDefined();
    expect(purge).toContain(`${aliasJob!};`); expect(purge).toContain('DELETE FROM "SecretaryConversation" WHERE "expiresAt" < now();');
    expect(aliasJob).toContain(`a."kind" = 'customer' AND NOT EXISTS (SELECT 1 FROM "ClientProfile" c WHERE c."id" = a."targetId" AND c."salonId" = a."salonId" AND c."mergedIntoId" IS NULL)`);
    expect(code(schedule).toUpperCase()).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|TRUNCATE|UPDATE|GRANT|REVOKE)\b/);
    // The migration and the flag documentation say so.
    expect(source("prisma/sql/manual/027_secretary_state.sql")).toContain("MUST be scheduled");
    expect(source("docs/SECRETARY_PERSISTED_STATE_AND_ALIASES.md")).toContain("027_secretary_state.schedule.sql");
  });
  it("the application reaches the tables only through tagged $queryRaw inside withTenant, behind default-off flags", () => {
    for (const path of ["src/lib/secretary-session-store.ts", "src/lib/secretary-name-aliases.ts"]) {
      const store = source(path);
      expect(store).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe/);
      expect(store).toContain("withTenant(actor");
    }
    expect(source("src/lib/secretary-session-store.ts")).toContain('env.SALON_SECRETARY_PERSISTED_STATE === "true"');
    expect(source("src/lib/secretary-name-aliases.ts")).toContain('env.SALON_SECRETARY_NAME_ALIASES === "true"');
    expect(source("src/lib/salon-secretary-runtime.ts")).toContain("persistedSessionStore");
  });
});
