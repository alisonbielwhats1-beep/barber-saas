/** D1 (027_secretary_state): explicitly approved local grants for the least-privilege test role `mvp_service_runtime`, so
 * the PostgreSQL integration suites (secretary-persisted-state.integration.test.ts) reach the new tables under RLS.
 * Local disposable cluster only (assertMvpTestDatabase), explicit approval env, pg_dump backup first, rollback SQL written
 * next to it. Adds only absent privileges; never a superuser or RLS-bypassing role, never DDL, never another role. Refuses when 027 is not
 * applied with FORCE RLS. Run after the coordinator applied 027 (preflight → migration → verify). */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";

/** Same privileges production's app_runtime gets from 027 (events: append only). */
export const SECRETARY_STATE_MVP_GRANTS: [table: string, privileges: ("SELECT" | "INSERT" | "UPDATE" | "DELETE")[]][] = [
  ["SecretaryConversation", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
  ["SecretaryConversationEvent", ["SELECT", "INSERT"]],
  ["SecretaryNameAlias", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
];

async function main() {
  if (process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" || process.env.MVP_SECRETARY_STATE_ADMIN_APPROVED !== "true") throw Error("EXPLICIT_LOCAL_APPROVAL_REQUIRED");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL } } });
  try {
    console.log("SAFE_TARGET", await assertMvpTestDatabase(admin));
    const tables = SECRETARY_STATE_MVP_GRANTS.map(([table]) => table);
    const security = await admin.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: number }[]>`
      SELECT c.relname::text AS relname, c.relrowsecurity, c.relforcerowsecurity,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(${tables}::text[])`;
    if (security.length !== tables.length || security.some(row => !row.relrowsecurity || !row.relforcerowsecurity || row.policies < 1)) throw Error("MIGRATION_027_NOT_APPLIED_WITH_FORCE_RLS");
    const [role] = await admin.$queryRaw<{ super: boolean; bypass: boolean }[]>`SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'mvp_service_runtime'`;
    if (!role || role.super || role.bypass) throw Error("UNSAFE_RUNTIME_ROLE");
    const bin = "C:/Program Files/PostgreSQL/16/bin", args = ["-h", "127.0.0.1", "-p", "55441", "-U", "mvp_test_admin", "-d", "everflair_service_mvp"];
    const dir = join(tmpdir(), `everflair-secretary-state-backup-${Date.now()}`); mkdirSync(dir);
    execFileSync(join(bin, "pg_dump.exe"), [...args, "-Fc", "-f", join(dir, "before.dump")], { stdio: "pipe", windowsHide: true });
    writeFileSync(join(dir, "security-before.json"), JSON.stringify({ security }, null, 2));
    const sql = ["BEGIN;"], rollback = ["BEGIN;"];
    for (const [table, privileges] of SECRETARY_STATE_MVP_GRANTS) for (const privilege of privileges) {
      const [held] = await admin.$queryRaw<{ ok: boolean }[]>`SELECT has_table_privilege('mvp_service_runtime', ${`"${table}"`}, ${privilege}) AS ok`;
      if (held.ok) continue;
      sql.push(`GRANT ${privilege} ON "${table}" TO mvp_service_runtime;`); rollback.push(`REVOKE ${privilege} ON "${table}" FROM mvp_service_runtime;`);
    }
    sql.push("COMMIT;"); rollback.push("COMMIT;");
    writeFileSync(join(dir, "applied.sql"), sql.join("\n")); writeFileSync(join(dir, "rollback.sql"), rollback.join("\n"));
    execFileSync(join(bin, "psql.exe"), [...args, "-X", "-v", "ON_ERROR_STOP=1", "-f", join(dir, "applied.sql")], { stdio: "pipe", windowsHide: true });
    console.log("SECRETARY_STATE_MVP_ACCESS_READY", dir);
  } finally { await admin.$disconnect(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/setup-secretary-state-mvp-access.ts"))
  main().catch(error => { console.error(error instanceof Error ? error.message : "BOOTSTRAP_FAILED"); process.exitCode = 1; });
