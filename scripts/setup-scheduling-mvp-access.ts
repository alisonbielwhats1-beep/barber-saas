/** Explicitly approved disposable-only bootstrap. Never a production migration. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";

async function main(){
  if(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS!=="false" || process.env.MVP_SCHEDULING_ADMIN_APPROVED!=="true")throw Error("EXPLICIT_LOCAL_APPROVAL_REQUIRED");
  const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
  try{
    console.log("SAFE_TARGET",await assertMvpTestDatabase(admin));
    const bin=process.env.MVP_PG_BIN??"C:/Program Files/PostgreSQL/16/bin";
    const args=["-h","127.0.0.1","-p","55441","-U","mvp_test_admin","-d","everflair_service_mvp"];
    const dir=join(tmpdir(),`everflair-scheduling-backup-${Date.now()}`);mkdirSync(dir);
    execFileSync(join(bin,"pg_dump.exe"),[...args,"-Fc","-f",join(dir,"before.dump")],{stdio:"pipe",windowsHide:true});
    const tables=["Appointment","AppointmentService","AppointmentEvent","NotificationOutbox","WorkingHours","ProfessionalOpening","TimeOff","SalonClosure","ServicePricingRule","WaitlistOffer","ResourceBooking","PhysicalResource"];
    const before=await admin.$queryRawUnsafe(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c WHERE c.relname IN (${tables.map(t=>`'${t}'`).join(",")})`);
    const policies=await admin.$queryRawUnsafe(`SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN (${tables.map(t=>`'${t}'`).join(",")})`);
    writeFileSync(join(dir,"security-before.json"),JSON.stringify({before,policies},null,2));
    const [helper]=await admin.$queryRaw<{ok:boolean}[]>`SELECT to_regprocedure('app_current_salon()') IS NOT NULL AS ok`;
    if(!helper.ok)throw Error("RLS_HELPER_MISSING");
    const sql:string[]=["BEGIN;"];
    const names:Record<string,string>={AppointmentService:"tenant_isolation",AppointmentEvent:"tenant_isolation",ProfessionalOpening:"professional_opening_tenant",WaitlistOffer:"offer_tenant",ResourceBooking:"product_tenant",PhysicalResource:"product_tenant"};
    for(const [table,policy]of Object.entries(names)){
      const present=(policies as {tablename:string;policyname:string}[]).filter(p=>p.tablename===table);
      if(present.length && !present.some(p=>p.policyname===policy))throw Error(`UNEXPECTED_POLICY_${table}`);
      sql.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY; ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      if(!present.length)sql.push(`CREATE POLICY "${policy}" ON "${table}" USING ("salonId"=app_current_salon()) WITH CHECK ("salonId"=app_current_salon());`);
    }
    sql.push('GRANT SELECT ON "Appointment","AppointmentService","AppointmentEvent","WorkingHours","ProfessionalOpening","TimeOff","SalonClosure","ServicePricingRule","WaitlistOffer","ResourceBooking" TO mvp_service_runtime;');
    sql.push('GRANT INSERT ON "Appointment","AppointmentService","AppointmentEvent","NotificationOutbox" TO mvp_service_runtime;');
    sql.push('GRANT INSERT ("appointmentId","resourceId","salonId","startAt","endAt",active) ON "ResourceBooking" TO mvp_service_runtime;');
    sql.push('GRANT UPDATE ("startAt","endAt",active,retired) ON "ResourceBooking" TO mvp_service_runtime;');
    sql.push('CREATE EXTENSION IF NOT EXISTS btree_gist;');
    const existing=await admin.$queryRaw<{conname:string}[]>`SELECT conname FROM pg_constraint WHERE conname IN ('appointment_no_overlap','resource_no_overlap')`;
    const migration8=readFileSync("prisma/sql/manual/008_fase2_appointment_reliability.sql","utf8");
    if(!existing.some(x=>x.conname==="appointment_no_overlap"))sql.push(migration8.slice(migration8.lastIndexOf('ALTER TABLE "Appointment"'),migration8.lastIndexOf("COMMIT;")));
    const migration19=readFileSync("prisma/sql/manual/019_product_depth.sql","utf8");
    if(!existing.some(x=>x.conname==="resource_no_overlap"))sql.push(migration19.match(/ALTER TABLE "ResourceBooking" ADD CONSTRAINT resource_no_overlap[^;]+;/)![0]);
    const migration23=readFileSync("prisma/sql/manual/023_receipts_booking.sql","utf8");
    const functions:[[string,string,string],[string,string,string]]=[
      ["product_reserve_resource",migration19,"CREATE OR REPLACE FUNCTION product_update_resources"],
      ["booking_offer_guard",migration23,'DROP TRIGGER IF EXISTS booking_offer_guard'],
    ];
    for(const [name,source,end]of functions){
      const [exists]=await admin.$queryRawUnsafe<{ok:boolean}[]>(`SELECT to_regprocedure('${name}()') IS NOT NULL AS ok`);
      if(!exists.ok)sql.push(source.slice(source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`),source.indexOf(end)));
    }
    const triggers=await admin.$queryRaw<{tgname:string;table_name:string}[]>`SELECT tgname,tgrelid::regclass::text AS table_name FROM pg_trigger WHERE NOT tgisinternal`;
    for(const [table,name,statement]of [
      ["Appointment","product_reserve_primary",'AFTER INSERT ON "Appointment" FOR EACH ROW EXECUTE FUNCTION product_reserve_resource()'],
      ["AppointmentService","product_reserve_additional",'AFTER INSERT ON "AppointmentService" FOR EACH ROW EXECUTE FUNCTION product_reserve_resource()'],
      ["Appointment","booking_offer_guard",'BEFORE INSERT OR UPDATE OF "startAt","endAt","professionalId",status ON "Appointment" FOR EACH ROW EXECUTE FUNCTION booking_offer_guard()'],
      ["ResourceBooking","booking_offer_guard",'BEFORE INSERT OR UPDATE ON "ResourceBooking" FOR EACH ROW EXECUTE FUNCTION booking_offer_guard()'],
    ])if(!triggers.some(t=>t.tgname===name&&t.table_name===`"${table}"`))sql.push(`CREATE TRIGGER ${name} ${statement};`);
    sql.push('REVOKE ALL ON FUNCTION product_reserve_resource(),booking_offer_guard() FROM PUBLIC; GRANT EXECUTE ON FUNCTION product_reserve_resource(),booking_offer_guard() TO mvp_service_runtime; COMMIT;');
    writeFileSync(join(dir,"applied.sql"),sql.join("\n"));
    execFileSync(join(bin,"psql.exe"),[...args,"-X","-v","ON_ERROR_STOP=1","-f",join(dir,"applied.sql")],{stdio:"pipe",windowsHide:true});
    // Prefer revoking this gate's access over disabling RLS or deleting audit/data on rollback.
    writeFileSync(join(dir,"rollback-access.sql"),'BEGIN;\nREVOKE SELECT ON "Appointment","AppointmentService","AppointmentEvent","WorkingHours","ProfessionalOpening","TimeOff","SalonClosure","ServicePricingRule","WaitlistOffer","ResourceBooking" FROM mvp_service_runtime;\nREVOKE INSERT ON "Appointment","AppointmentService","AppointmentEvent","NotificationOutbox" FROM mvp_service_runtime;\nREVOKE INSERT ("appointmentId","resourceId","salonId","startAt","endAt",active), UPDATE ("startAt","endAt",active,retired) ON "ResourceBooking" FROM mvp_service_runtime;\nCOMMIT;');
    console.log("SCHEDULING_LOCAL_READY",dir);
  }finally{await admin.$disconnect();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"BOOTSTRAP_FAILED");process.exitCode=1;});
