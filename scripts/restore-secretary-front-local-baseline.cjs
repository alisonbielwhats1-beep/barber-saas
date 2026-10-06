/** Recovery only: restore exact preexisting SELECT columns removed by table REVOKE. */
const {PrismaClient}=require('@prisma/client');
const {readFileSync,writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const out=resolve(__dirname,'../packages/salon-secretary/evaluation/results/front-voice/grants-2026-09-25T13-02-48-049Z');
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const before=JSON.parse(readFileSync(resolve(out,'before.json'),'utf8'));
const admin=new PrismaClient({datasources:{db:{url:'postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp'}}});
const runtime=new PrismaClient({datasources:{db:{url:'postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp'}}});
const assert=(x,s)=>{if(!x)throw Error(s);};
const privilegeSql=`SELECT c.relname AS table_name,'' AS column_name,x.privilege_type,x.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x WHERE c.relnamespace='public'::regnamespace AND x.grantee='mvp_service_runtime'::regrole UNION ALL SELECT c.relname,a.attname,x.privilege_type,x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE c.relnamespace='public'::regnamespace AND x.grantee='mvp_service_runtime'::regrole ORDER BY 1,2,3`;
async function main(){
 assert(hash(before.catalog)===before.hashes.catalog,'BASELINE_HASH');
 const [identity]=await admin.$queryRawUnsafe("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory");
 assert(JSON.stringify(identity)===JSON.stringify(before.identity),'TARGET_MISMATCH');
 const backup=resolve(out,'before-column-restoration.dump');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')));
 const pg='C:/Program Files/PostgreSQL/16/bin/';
 assert(spawnSync(pg+'pg_dump.exe',['-h','127.0.0.1','-p','55441','-U','mvp_test_admin','-d','everflair_service_mvp','-Fc','-f',backup],{env,windowsHide:true}).status===0,'BACKUP_FAILED');
 assert(spawnSync(pg+'pg_restore.exe',['-l',backup],{env,windowsHide:true}).status===0,'BACKUP_INVALID');
 const columns=before.catalog.privileges.filter(p=>['Product','ClientProfile'].includes(p.table_name)&&p.column_name&&p.privilege_type==='SELECT'&&!p.is_grantable);
 const sql=['Product','ClientProfile'].map(table=>`GRANT SELECT (${columns.filter(p=>p.table_name===table).map(p=>'"'+p.column_name.replaceAll('"','""')+'"').join(', ')}) ON "${table}" TO mvp_service_runtime`);
 const rollback=['REVOKE SELECT ON "Product", "ClientProfile" FROM mvp_service_runtime','REVOKE SELECT (id) ON "Payment" FROM mvp_service_runtime',...sql];
 writeFileSync(resolve(out,'rollback-corrected.sql'),'BEGIN;\n'+rollback.join(';\n')+';\nCOMMIT;\n');
 await admin.$transaction(async tx=>{for(const statement of sql)await tx.$executeRawUnsafe(statement);assert(hash(await tx.$queryRawUnsafe(privilegeSql))===hash(before.catalog.privileges),'PRIVILEGE_RESTORATION_MISMATCH');});
 const [role]=await runtime.$queryRawUnsafe('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');assert(role.name==='mvp_service_runtime'&&!role.rolsuper&&!role.rolbypassrls,'ROLE_UNSAFE');
 const security=await admin.$queryRawUnsafe(`SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),'membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p),'tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r')) AS value`);
 assert(hash(security[0].value)===hash(before.catalog.security),'SECURITY_CHANGED');
 const tables=await admin.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"),baseline={};
 for(const {tablename} of tables){const [row]=await admin.$queryRawUnsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${tablename.replaceAll('"','""')}" t`);baseline[tablename]=row;}
 assert(hash(baseline)===before.hashes.baseline,'DATA_CHANGED');
 const tenants=await admin.salon.findMany({where:{slug:{startsWith:'front-voice-'}},select:{id:true},orderBy:{id:'asc'},take:2});const isolation=[];
 for(const table of ['Product','ClientProfile','Payment']){
  const col=table==='Payment'?'appointmentId':'id';assert((await runtime.$queryRawUnsafe(`SELECT "${col}" FROM "${table}"`)).length===0,'NO_CONTEXT_LEAK');
  const filter=table==='Payment'?'"appointmentId" IN (SELECT id FROM "Appointment" WHERE "salonId"=$1)':'"salonId"=$1';
  const own=await admin.$queryRawUnsafe(`SELECT "${col}" FROM "${table}" WHERE ${filter} ORDER BY "${col}"`,tenants[0].id);
  const other=await admin.$queryRawUnsafe(`SELECT "${col}" FROM "${table}" WHERE ${filter} ORDER BY "${col}"`,tenants[1].id);
  await runtime.$transaction(async tx=>{await tx.$executeRawUnsafe("SELECT set_config('app.current_salon',$1,true)",tenants[0].id);assert(hash(await tx.$queryRawUnsafe(`SELECT "${col}" FROM "${table}" ORDER BY "${col}"`))===hash(own),'TENANT_ISOLATION');if(other.length)assert((await tx.$queryRawUnsafe(`SELECT "${col}" FROM "${table}" WHERE "${col}"=$1`,other[0][col])).length===0,'CROSS_TENANT');});
  isolation.push({table,no_context:'DENIED',tenant:'PASS',foreign_fixture_rows:other.length,cross_tenant:other.length?'DENIED':'NO_PAYMENT_IN_FRONT_FIXTURE'});
 }
 const acls=await admin.$queryRawUnsafe(`SELECT c.relname AS table_name, '' AS column_name, c.relacl::text AS acl FROM pg_class c WHERE c.relnamespace='public'::regnamespace UNION ALL SELECT c.relname,a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`);
 const aclDifferences=acls.filter(a=>!before.catalog.acls.some(b=>JSON.stringify(a)===JSON.stringify(b)));
 assert(aclDifferences.length===2&&aclDifferences.every(a=>['Product','ClientProfile'].includes(a.table_name)&&a.column_name===''&&a.acl==='{mvp_test_admin=arwdDxt/mvp_test_admin}'),'OTHER_ACL_CHANGED');
 const normalize=s=>s.replace(/^\\(?:un)?restrict .*$/gm,'-- pg_dump session nonce omitted');
 assert(hash(normalize(readFileSync(resolve(out,'schema-before.sql'),'utf8')))===hash(normalize(readFileSync(resolve(out,'schema-restored.sql'),'utf8'))),'SCHEMA_CHANGED');
 const result={restored_at:new Date().toISOString(),baseline_runtime_privileges_exact:true,restored_select_columns:columns,role,security_roles_policies_rls_unchanged:true,all_63_table_hashes_unchanged:true,isolation,raw_acl_differences:aclDifferences,acl_note:'PostgreSQL materialized the implicit owner ACL; owner authority unchanged. Runtime privileges match baseline exactly.',schema_unchanged_excluding_dump_nonce:true,authorized_new_grants_remaining:0,operational_mutations:0,continuation:'STOPPED',backup_sha256:createHash('sha256').update(readFileSync(backup)).digest('hex')};
 writeFileSync(resolve(out,'recovery-verified.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({restored:true,columns:columns.length,rls_unchanged:true,table_hashes_unchanged:tables.length,new_grants_remaining:0,continuation:'STOPPED'}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{await admin.$disconnect();await runtime.$disconnect();});
