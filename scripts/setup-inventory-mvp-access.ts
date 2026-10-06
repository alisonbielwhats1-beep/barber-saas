/** Explicit authorization: Product column access, local MVP only. */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";
async function main() {
  if (process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" || !process.env.MVP_ACL_BACKUP_DIR) throw Error("SAFE_CONFIGURATION_REQUIRED");
  if (new URL(process.env.MVP_TEST_ADMIN_URL ?? "").username !== "mvp_test_admin" || new URL(process.env.DATABASE_URL ?? "").username !== "mvp_service_runtime") throw Error("EXPECTED_LOCAL_ROLES_REQUIRED");
  const admin = new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
  try {
    const target = await assertMvpTestDatabase(admin);
    const state = await admin.$queryRaw<{enabled:boolean;forced:boolean;acl:string|null}[]>`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced,relacl::text AS acl FROM pg_class WHERE oid='"Product"'::regclass`;
    const policies = await admin.$queryRaw<{policyname:string;qual:string;with_check:string}[]>`SELECT policyname,qual,with_check FROM pg_policies WHERE tablename='Product'`;
    if (!state[0]?.enabled || !state[0].forced) throw Error("EXPECTED_RLS_MISSING");
    if(policies.length!==1 || policies[0].policyname!=="tenant_isolation" || !policies[0].qual.includes("app_current_salon()") || !policies[0].with_check.includes("app_current_salon()"))throw Error("EXPECTED_TENANT_POLICY_MISSING");
    const grants = await admin.$queryRaw<{column_name:string;privilege_type:string}[]>`SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='mvp_service_runtime' AND table_name='Product'`;
    if (grants.length) throw Error("ACL_CHANGED_REVIEW_REQUIRED");
    const directory=process.env.MVP_ACL_BACKUP_DIR;mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,"product-before.json"),JSON.stringify({target,state,policies,grants},null,2),{flag:"wx"});
    writeFileSync(join(directory,"rollback.sql"),'REVOKE SELECT (id, "salonId", name, stock, "minStock", active, "updatedAt"), UPDATE (stock, "updatedAt") ON "Product" FROM mvp_service_runtime;\n',{flag:"wx"});
    await admin.$executeRawUnsafe('GRANT SELECT (id, "salonId", name, stock, "minStock", active, "updatedAt"), UPDATE (stock, "updatedAt") ON "Product" TO mvp_service_runtime');
    console.log("INVENTORY_COLUMNS_GRANTED",target);
  } finally {await admin.$disconnect();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"FAILED");process.exitCode=1;});
