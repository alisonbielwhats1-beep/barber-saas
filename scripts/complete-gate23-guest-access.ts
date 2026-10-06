/** Explicit final authorization: two INSERT columns, disposable MVP only. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";

async function main(){
  if(process.env.MVP_GATE23_GUEST_DEFAULTS_APPROVED!=="true"||process.env.SALON_SECRETARY_ALLOW_PAID_CALLS!=="false")throw Error("EXPLICIT_LOCAL_APPROVAL_REQUIRED");
  if(new URL(process.env.MVP_TEST_ADMIN_URL??"").username!=="mvp_test_admin")throw Error("ADMIN_IDENTITY_MISMATCH");
  const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
  try{
    console.log("SAFE_TARGET",await assertMvpTestDatabase(admin));
    const security=async()=>({
      tables:await admin.$queryRaw`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname`,
      policies:await admin.$queryRaw`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`,
    });
    const before=await security();
    const [rls]=await admin.$queryRaw<{enabled:boolean;forced:boolean}[]>`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE oid='"ClientProfile"'::regclass`;
    if(!rls.enabled||!rls.forced)throw Error("RLS_DIVERGENCE_STOP");
    const [role]=await admin.$queryRaw<{super:boolean;bypass:boolean}[]>`SELECT rolsuper AS super,rolbypassrls AS bypass FROM pg_roles WHERE rolname='mvp_service_runtime'`;
    if(!role||role.super||role.bypass)throw Error("RUNTIME_ROLE_UNSAFE");
    const acl=await admin.$queryRaw`SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='ClientProfile' AND grantee='mvp_service_runtime' ORDER BY privilege_type,column_name`;
    const dir=join(tmpdir(),`everflair-gate23-guest-defaults-${Date.now()}`);mkdirSync(dir);
    const bin="C:/Program Files/PostgreSQL/16/bin",args=["-h","127.0.0.1","-p","55441","-U","mvp_test_admin","-d","everflair_service_mvp"];
    execFileSync(join(bin,"pg_dump.exe"),[...args,"-Fc","-f",join(dir,"before.dump")],{stdio:"pipe",windowsHide:true});
    writeFileSync(join(dir,"security-before.json"),JSON.stringify({before,acl,role},null,2));
    const grants:string[]=[],rollback:string[]=[];
    for(const column of ["sessionVersion","createdAt"]){
      const [p]=await admin.$queryRaw<{insert:boolean;update:boolean}[]>`SELECT has_column_privilege('mvp_service_runtime','"ClientProfile"',${column},'INSERT') AS insert,has_column_privilege('mvp_service_runtime','"ClientProfile"',${column},'UPDATE') AS update`;
      if(p.update)throw Error("UNEXPECTED_UPDATE_PRIVILEGE_STOP");
      if(!p.insert){grants.push(`GRANT INSERT ("${column}") ON "ClientProfile" TO mvp_service_runtime;`);rollback.push(`REVOKE INSERT ("${column}") ON "ClientProfile" FROM mvp_service_runtime;`);}
    }
    writeFileSync(join(dir,"applied.sql"),["BEGIN;",...grants,"COMMIT;"].join("\n"));
    writeFileSync(join(dir,"rollback.sql"),["BEGIN;",...rollback,"COMMIT;"].join("\n"));
    execFileSync(join(bin,"psql.exe"),[...args,"-X","-v","ON_ERROR_STOP=1","-f",join(dir,"applied.sql")],{stdio:"pipe",windowsHide:true});
    if(JSON.stringify(await security())!==JSON.stringify(before))throw Error("SECURITY_STATE_CHANGED_STOP");
    const final=await admin.$queryRaw`SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='ClientProfile' AND grantee='mvp_service_runtime' ORDER BY privilege_type,column_name`;
    writeFileSync(join(dir,"grants-after.json"),JSON.stringify(final,null,2));
    console.log("LOCAL_GRANT_COMPLETE",JSON.stringify({backup:dir,applied:grants,rls,role,policies_unchanged:true,grants:final}));
  }finally{await admin.$disconnect();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"ADMIN_FAILED");process.exitCode=1;});
