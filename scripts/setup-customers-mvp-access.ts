/** Explicitly authorized local column grants only. Does not change RLS or any data. */
import { PrismaClient } from "@prisma/client";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";
async function main() {
  if (process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false") throw new Error("PAID_CALLS_MUST_BE_DISABLED");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL } } });
  try {
    console.log("SAFE_TARGET", await assertMvpTestDatabase(admin));
    const [rls] = await admin.$queryRaw<{ enabled: boolean; forced: boolean }[]>`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE relname='ClientProfile'`;
    if (!rls?.enabled || !rls.forced) throw new Error("EXPECTED_RLS_MISSING");
    await admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('GRANT SELECT (id, "salonId", name, phone, "phoneNormalized", email, "mergedIntoId", xmin) ON "ClientProfile" TO mvp_service_runtime');
      await tx.$executeRawUnsafe('GRANT INSERT (id, "salonId", name, phone, "phoneNormalized", email) ON "ClientProfile" TO mvp_service_runtime');
      await tx.$executeRawUnsafe('GRANT UPDATE (name, phone, "phoneNormalized", email) ON "ClientProfile" TO mvp_service_runtime');
    });
    console.log("CUSTOMERS_COLUMN_GRANTS_READY");
  } finally { await admin.$disconnect(); }
}
main().catch(e=>{ console.error(e instanceof Error ? e.message : "SETUP_FAILED"); process.exitCode=1; });
