import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL } } });
  try {
    const target = await assertMvpTestDatabase(admin);
    // This script is ONLY test bootstrap. It never targets remote or existing app databases.
    if (await admin.salon.count() !== 0 || await admin.user.count() !== 0 || await admin.clientProfile.count() !== 0) {
      throw new Error("Bootstrap requires empty synthetic database");
    }
    const psql = process.env.MVP_PSQL_PATH ?? "psql";
    execFileSync(psql, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55441", "-U", "mvp_test_admin", "-d", "everflair_service_mvp", "-f", resolve("prisma/sql/rls/01_enable_rls.sql")], { stdio: "pipe" });
    await admin.$executeRawUnsafe("CREATE ROLE mvp_service_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE");
    await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO mvp_service_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE ON "Service" TO mvp_service_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT, UPDATE ON "Salon", "Membership", "PhysicalResource" TO mvp_service_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT ON "User", "Professional", "ProfessionalService" TO mvp_service_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT, INSERT ON "AuditLog" TO mvp_service_runtime');
    console.log(JSON.stringify({ ...target, bootstrap: "ready", runtime: "mvp_service_runtime", rls: "existing repository policies" }));
  } finally { await admin.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
