/** Gate 2.3: explicitly authorized local ACL additions and existing migration-019 trigger only. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";

async function main(){
  if(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS!=="false"||process.env.MVP_SCHEDULING_ACTIONS_ADMIN_APPROVED!=="true")throw Error("EXPLICIT_LOCAL_APPROVAL_REQUIRED");
  const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
  try{
    console.log("SAFE_TARGET",await assertMvpTestDatabase(admin));
    const tables=["Appointment","AppointmentService","RescheduleProposal","AppointmentProduct","TimeOff","WaitlistEntry","ClientProfile"];
    const security=await admin.$queryRawUnsafe<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean;relacl:string}[]>(`SELECT relname,relrowsecurity,relforcerowsecurity,relacl::text FROM pg_class WHERE relname IN (${tables.map(t=>`'${t}'`).join(",")})`);
    if(security.length!==tables.length||security.some(t=>!t.relrowsecurity||!t.relforcerowsecurity))throw Error("RLS_DIVERGENCE_STOP");
    const policies=await admin.$queryRawUnsafe(`SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN (${tables.map(t=>`'${t}'`).join(",")})`);
    const bin="C:/Program Files/PostgreSQL/16/bin",args=["-h","127.0.0.1","-p","55441","-U","mvp_test_admin","-d","everflair_service_mvp"];
    const dir=join(tmpdir(),`everflair-gate23-backup-${Date.now()}`);mkdirSync(dir);
    execFileSync(join(bin,"pg_dump.exe"),[...args,"-Fc","-f",join(dir,"before.dump")],{stdio:"pipe",windowsHide:true});
    const columns=await admin.$queryRaw`SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='mvp_service_runtime'`;
    writeFileSync(join(dir,"security-before.json"),JSON.stringify({security,policies,columns},null,2));
    const grants:[string,string,string[]?][]=[
      ["Appointment","UPDATE",["serviceId","professionalId","startAt","endAt","priceCents","timezone","status","reminderSentAt","checkedInAt","checkedInById","notes","version","isOverbooked","cancelledAt","cancelledReason","cancelledByType","cancelledById","updatedAt"]],
      ["AppointmentService","DELETE"],["RescheduleProposal","SELECT"],["RescheduleProposal","INSERT"],
      ["RescheduleProposal","UPDATE",["status","responseReason","respondedAt","updatedAt"]],
      ["AppointmentProduct","SELECT"],["TimeOff","INSERT"],["WaitlistEntry","SELECT"],
      ["WaitlistEntry","UPDATE",["fulfilledAt","fulfilledAppointmentId","appointmentId"]],
      ["ClientProfile","SELECT",["passwordHash","authIdentityId","userId"]],
      ["ClientProfile","INSERT",["gender"]], // Separately authorized: real guest waitlist promotion.
    ];
    const sql=["BEGIN;"],rollback=["BEGIN;"];
    // Add only absent privileges; rollback never revokes earlier gates' grants.
    for(const [table,privilege,cols] of grants){
      for(const col of cols??[undefined]){
        const [row]=col?await admin.$queryRaw<{ok:boolean}[]>`SELECT has_column_privilege('mvp_service_runtime',${`"${table}"`},${col},${privilege}) AS ok`:await admin.$queryRaw<{ok:boolean}[]>`SELECT has_table_privilege('mvp_service_runtime',${`"${table}"`},${privilege}) AS ok`;
        if(row.ok)continue;
        const scope=`${privilege}${col?` ("${col}")`:""} ON "${table}"`;
        sql.push(`GRANT ${scope} TO mvp_service_runtime;`);rollback.push(`REVOKE ${scope} FROM mvp_service_runtime;`);
      }
    }
    const [objects]=await admin.$queryRaw<{fn:boolean;trigger:boolean}[]>`SELECT to_regprocedure('product_update_resources()') IS NOT NULL AS fn,EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='product_update_resources' AND tgrelid='"Appointment"'::regclass) AS trigger`;
    if(objects.fn!==objects.trigger)throw Error("PARTIAL_TRIGGER_DIVERGENCE_STOP");
    if(!objects.fn){
      const migration=readFileSync("prisma/sql/manual/019_product_depth.sql","utf8");
      sql.push(migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION product_update_resources("),migration.indexOf('DROP TRIGGER IF EXISTS product_reserve_primary')));
      sql.push('CREATE TRIGGER product_update_resources AFTER UPDATE OF "startAt","endAt",status ON "Appointment" FOR EACH ROW EXECUTE FUNCTION product_update_resources();');
      sql.push('REVOKE ALL ON FUNCTION product_update_resources() FROM PUBLIC; GRANT EXECUTE ON FUNCTION product_update_resources() TO mvp_service_runtime;');
      rollback.push('DROP TRIGGER product_update_resources ON "Appointment"; DROP FUNCTION product_update_resources();');
    }
    sql.push("COMMIT;");rollback.push("COMMIT;");
    writeFileSync(join(dir,"applied.sql"),sql.join("\n"));writeFileSync(join(dir,"rollback.sql"),rollback.join("\n"));
    execFileSync(join(bin,"psql.exe"),[...args,"-X","-v","ON_ERROR_STOP=1","-f",join(dir,"applied.sql")],{stdio:"pipe",windowsHide:true});
    console.log("GATE23_LOCAL_READY",dir);
  }finally{await admin.$disconnect();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"BOOTSTRAP_FAILED");process.exitCode=1;});
