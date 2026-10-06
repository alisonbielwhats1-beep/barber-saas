/** Gate 2.7: exact, explicitly authorized local change. Refuses drift/reapplication. */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";
async function main() {
  if(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS!=="false"||!process.env.MVP_ACL_BACKUP_DIR)throw Error("SAFE_CONFIGURATION_REQUIRED");
  if(new URL(process.env.MVP_TEST_ADMIN_URL!).username!=="mvp_test_admin"||new URL(process.env.DATABASE_URL!).username!=="mvp_service_runtime")throw Error("EXPECTED_ROLES_REQUIRED");
  const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
  try {
    const target=await assertMvpTestDatabase(admin);
    const inspect=async()=>({
      roles:await admin.$queryRaw`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='mvp_service_runtime'`,
      rls:await admin.$queryRaw`SELECT relrowsecurity,relforcerowsecurity,relacl::text FROM pg_class WHERE oid='"NotificationOutbox"'::regclass`,
      policies:await admin.$queryRaw`SELECT policyname,cmd,roles::text,qual,with_check FROM pg_policies WHERE tablename='NotificationOutbox'`,
      columns:await admin.$queryRaw<{column_name:string;is_nullable:string}[]>`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='NotificationOutbox' ORDER BY ordinal_position`,
      grants:await admin.$queryRaw<{column_name:string;privilege_type:string}[]>`SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='mvp_service_runtime' AND table_name='NotificationOutbox' ORDER BY privilege_type,column_name`,
      constraints:await admin.$queryRaw<{conname:string;definition:string}[]>`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"NotificationOutbox"'::regclass ORDER BY conname`,
      indexes:await admin.$queryRaw<{indexname:string;indexdef:string}[]>`SELECT indexname,indexdef FROM pg_indexes WHERE tablename='NotificationOutbox' ORDER BY indexname`,
      triggers:await admin.$queryRaw<unknown[]>`SELECT tgname FROM pg_trigger WHERE tgrelid='"NotificationOutbox"'::regclass AND NOT tgisinternal`,
      channels:await admin.$queryRaw<{enumlabel:string}[]>`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='NotificationChannel' ORDER BY enumsortorder`,
    });
    const before=await inspect();
    const expectedColumns=['id','salonId','eventId','appointmentId','recipientType','recipientId','recipientKey','channel','template','payload','status','attempts','nextAttemptAt','sentAt','readAt','lastError','createdAt','updatedAt'];
    const required=new Set(['id','salonId','eventId','appointmentId','recipientType','recipientKey','channel','template','payload','status','attempts','createdAt','updatedAt']);
    const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
    if(!eq(before.roles,[{rolsuper:false,rolbypassrls:false}])||!eq(before.columns,expectedColumns.map(column_name=>({column_name,is_nullable:required.has(column_name)?'NO':'YES'})))||
      !eq(before.grants,['INSERT','SELECT'].flatMap(privilege_type=>[...expectedColumns].sort().map(column_name=>({column_name,privilege_type}))))||
      !eq(before.channels.map(x=>x.enumlabel),['INTERNAL','EMAIL','MANUAL_WHATSAPP'])||before.triggers.length||
      !eq(before.constraints.map(x=>x.conname),['NotificationOutbox_appointment_tenant_fkey','NotificationOutbox_event_tenant_fkey','NotificationOutbox_pkey','NotificationOutbox_salonId_fkey'])||before.indexes.length!==5||
      !eq((before.rls as {relrowsecurity:boolean;relforcerowsecurity:boolean}[]).map(r=>[r.relrowsecurity,r.relforcerowsecurity]),[[true,true]])||
      !eq(before.policies,[{policyname:'tenant_isolation',cmd:'ALL',roles:'{public}',qual:'("salonId" = app_current_salon())',with_check:'("salonId" = app_current_salon())'}]))throw Error('PREFLIGHT_DRIFT_STOP');
    const directory=process.env.MVP_ACL_BACKUP_DIR;mkdirSync(directory,{recursive:false});
    writeFileSync(join(directory,'before.json'),JSON.stringify({target,...before},null,2),{flag:'wx'});
    const args=['-h','127.0.0.1','-p','55441','-U','mvp_test_admin','-d','everflair_service_mvp'];
    execFileSync('C:/Program Files/PostgreSQL/16/bin/pg_dump.exe',[...args,'--schema-only','--file',join(directory,'schema-before.sql')]);
    execFileSync('C:/Program Files/PostgreSQL/16/bin/pg_dump.exe',[...args,'--data-only','--table=public."NotificationOutbox"','--file',join(directory,'outbox-before.sql')]);
    const rows=await admin.$queryRaw`SELECT * FROM "NotificationOutbox" ORDER BY id`;
    const checksum=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    writeFileSync(join(directory,'outbox-before.json'),JSON.stringify(rows),{flag:'wx'});
    writeFileSync(join(directory,'rollback.sql'),`BEGIN;
REVOKE UPDATE (status, attempts, "nextAttemptAt", "lastError", "updatedAt") ON "NotificationOutbox" FROM mvp_service_runtime;
-- SET NOT NULL fails safely if standalone messages exist. Never delete them here.
ALTER TABLE "NotificationOutbox" ALTER COLUMN "eventId" SET NOT NULL, ALTER COLUMN "appointmentId" SET NOT NULL;
ALTER TABLE "NotificationOutbox" DROP CONSTRAINT "NotificationOutbox_context_check";
COMMIT;
-- WHATSAPP remains inert; rebuilding an enum is not authorized.
`,{flag:'wx'});
    await admin.$executeRawUnsafe(`ALTER TYPE "NotificationChannel" ADD VALUE 'WHATSAPP'`);
    await admin.$transaction(async tx=>{
      await tx.$executeRawUnsafe('ALTER TABLE "NotificationOutbox" ALTER COLUMN "eventId" DROP NOT NULL, ALTER COLUMN "appointmentId" DROP NOT NULL');
      await tx.$executeRawUnsafe(`ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_context_check" CHECK (("eventId" IS NOT NULL AND "appointmentId" IS NOT NULL) OR (channel = 'WHATSAPP' AND "eventId" IS NULL AND "appointmentId" IS NULL))`);
      await tx.$executeRawUnsafe('GRANT UPDATE (status, attempts, "nextAttemptAt", "lastError", "updatedAt") ON "NotificationOutbox" TO mvp_service_runtime');
    });
    const after=await inspect();
    if(!eq(before.policies,after.policies)||!eq(before.indexes,after.indexes)||!eq(before.roles,after.roles)||checksum!==createHash('sha256').update(JSON.stringify(await admin.$queryRaw`SELECT * FROM "NotificationOutbox" ORDER BY id`)).digest('hex'))throw Error('POSTCHECK_FAILED');
    writeFileSync(join(directory,'after.json'),JSON.stringify({target,...after,rows_hash:checksum},null,2),{flag:'wx'});
    console.log('COMMUNICATION_LOCAL_CHANGE_OK',target,'backup:',directory);
  } finally{await admin.$disconnect();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'FAILED');process.exitCode=1;});

