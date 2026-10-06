/** Latest explicit authorization: local grant state restoration, two refresh mutations, then revoke. */
import {PrismaClient, type Prisma} from '@prisma/client';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {snapshotGrants,restoreGrants,restoreGrantSql,temporaryGrants,assertTemporaryDelta,canonicalGrants,schemaWithoutDumpNonce} from '../src/test/secretary-grant-state';
const root=resolve(__dirname,'..'),out=resolve(root,'packages/salon-secretary/evaluation/results/front-voice','closure-'+new Date().toISOString().replace(/[:.]/g,'-'));
const admin=new PrismaClient({datasources:{db:{url:'postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp'}}});
const runtime=new PrismaClient({datasources:{db:{url:'postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp'}}});
const hash=(x:unknown)=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const save=(n:string,x:unknown)=>writeFileSync(resolve(out,n+'.json'),JSON.stringify(x,null,2));
function demand(x:unknown,message:string):asserts x {if(!x)throw Error(message);}
const pg='C:/Program Files/PostgreSQL/16/bin/',env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')));
function dump(name:string,schema=false){const file=resolve(out,name+(schema?'.sql':'.dump'));const r=spawnSync(pg+'pg_dump.exe',['-h','127.0.0.1','-p','55441','-U','mvp_test_admin','-d','everflair_service_mvp',...(schema?['--schema-only','--no-owner','--no-privileges']:['-Fc']),'-f',file],{env,windowsHide:true,encoding:'utf8'});demand(r.status===0,'BACKUP_FAILED');if(!schema)demand(spawnSync(pg+'pg_restore.exe',['-l',file],{env,windowsHide:true}).status===0,'BACKUP_INVALID');return {file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),...(schema?{structure:hash(schemaWithoutDumpNonce(readFileSync(file,'utf8')))}:{})};}
async function identity(){const [i]=await admin.$queryRawUnsafe<{db:string;host:string;port:number;directory:string;system_id:string}[]>("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory,(SELECT system_identifier::text FROM pg_control_system()) AS system_id");demand(i.db==='everflair_service_mvp'&&i.host==='127.0.0.1'&&i.port===55441&&i.directory.replaceAll('\\','/')==='C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-dumpcheck-20260924-uxbaseline/data','UNSAFE_DATABASE');return i;}
async function security(){
 const [role]=await runtime.$queryRawUnsafe<{name:string;rolsuper:boolean;rolbypassrls:boolean}[]>('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');demand(role.name==='mvp_service_runtime'&&!role.rolsuper&&!role.rolbypassrls,'UNSAFE_RUNTIME');
 const [s]=await admin.$queryRawUnsafe<{value:{tables:{name:string;rls:boolean;force:boolean}[]}}[]>(`SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),'membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p),'tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'),'schema_acl',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace),'default_acl',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d)) AS value`);
 const protectedTables=['Salon','Membership','ClientProfile','Service','Professional','WorkingHours','ProfessionalService','Appointment','AppointmentService','AppointmentEvent','AppointmentProduct','Payment','Product','NotificationOutbox','AuditLog','SalonClosure','TimeOff','PhysicalResource','ResourceBooking'];
 demand(protectedTables.every(t=>s.value.tables.some(v=>v.name===t&&v.rls&&v.force)),'RLS_FORCE');return {role,...s.value};
}
async function dataHashes(){const tables=await admin.$queryRawUnsafe<{tablename:string}[]>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"),result:Record<string,unknown>={};for(const {tablename} of tables){const [row]=await admin.$queryRawUnsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${tablename.replaceAll('"','""')}" t`);result[tablename]=row;}return result;}
async function isolation(){
 const fixtures=await admin.salon.findMany({where:{slug:{startsWith:'front-voice-'}},select:{id:true},orderBy:{id:'asc'},take:2});demand(fixtures.length===2,'FIXTURES_REQUIRED');const results=[];
 for(const table of ['Product','ClientProfile','Service','Appointment','Payment']){
  const column=table==='Payment'?'appointmentId':'id';const filter=table==='Payment'?'"appointmentId" IN (SELECT id FROM "Appointment" WHERE "salonId"=$1)':'"salonId"=$1';
  demand((await runtime.$queryRawUnsafe<unknown[]>(`SELECT "${column}" FROM "${table}"`)).length===0,'NO_CONTEXT_LEAK');
  const own=await admin.$queryRawUnsafe<unknown[]>(`SELECT "${column}" FROM "${table}" WHERE ${filter} ORDER BY "${column}"`,fixtures[0].id);
  const foreign=await admin.$queryRawUnsafe<Record<string,string>[]>(`SELECT "${column}" FROM "${table}" WHERE NOT (${filter}) ORDER BY "${column}" LIMIT 1`,fixtures[0].id);
  await runtime.$transaction(async tx=>{await tx.$executeRawUnsafe("SELECT set_config('app.current_salon',$1,true)",fixtures[0].id);demand(hash(await tx.$queryRawUnsafe(`SELECT "${column}" FROM "${table}" ORDER BY "${column}"`))===hash(own),'TENANT_LEAK');if(foreign.length)demand((await tx.$queryRawUnsafe<unknown[]>(`SELECT "${column}" FROM "${table}" WHERE "${column}"=$1`,foreign[0][column])).length===0,'CROSS_TENANT_LEAK');});
  results.push({table,own_count:own.length,foreign_row_tested:foreign.length===1,no_context:'DENIED',tenant:'PASS',cross_tenant:foreign.length?'DENIED':'NO_FOREIGN_ROW'});
 }return results;
}
async function localAlgorithmTrials(){
 const report:unknown[]=[];const marker=Error('ROLLBACK_TRIALS');
 try{await admin.$transaction(async tx=>{
  for(const scenario of ['A_absent','B_table','C_column','D_mixed','E_twice','F_partial_failure']){
   await tx.$executeRawUnsafe('SAVEPOINT trial');
   if(['B_table','D_mixed'].includes(scenario))await tx.$executeRawUnsafe(temporaryGrants[0]);
   const before=await snapshotGrants(tx);
   if(scenario==='A_absent')await tx.$executeRawUnsafe(temporaryGrants[1]);
   else {
    try {await tx.$executeRawUnsafe(temporaryGrants[0]);if(scenario==='F_partial_failure')throw Error('INJECTED_AFTER_FIRST_GRANT');await tx.$executeRawUnsafe(temporaryGrants[1]);}
    catch(error){if(!(scenario==='F_partial_failure'&&error instanceof Error&&error.message==='INJECTED_AFTER_FIRST_GRANT'))throw error;}
   }
   // F injects an application failure after statement one; restoration must retain every BEFORE grant.
   const temporary=await snapshotGrants(tx),first=await restoreGrants(tx,before),second=await restoreGrants(tx,before);
   demand(first.raw_equal&&second.raw_equal,'TRIAL_RAW_ACL_MISMATCH');
   demand(second.sql.length===0,'ROLLBACK_NOT_IDEMPOTENT');
   report.push({scenario,before,temporary,after:first.after,sql:first.sql,exact:true,double_restore:true});
   await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT trial');
  }
  throw marker;
 },{timeout:30000});}catch(e){if(e!==marker)throw e;}
 save('local-restore-trials',report);return report.length;
}
async function main(){
 mkdirSync(out,{recursive:true});console.log('CLOSURE_EVIDENCE',out);
 const target=await identity(),secure=await security(),before=await snapshotGrants(admin),data=await dataHashes(),backup=dump('before-grants'),schema=dump('schema-before',true);
 save('before',{target,secure,privileges:before,data,backup,schema,isolation:await isolation()});
 const trials=await localAlgorithmTrials();
 demand(JSON.stringify(await snapshotGrants(admin))===JSON.stringify(before),'TRIALS_NOT_ROLLED_BACK');demand(hash(await dataHashes())===hash(data),'TRIAL_DATA_CHANGED');
 console.log('LOCAL_ALGORITHM_TRIALS_PASS',trials);
 // Precompute restoration against the exact intended delta before applying anything persistent.
 const planned=before.grants.concat([{schema:'public',table:'Product',column:null,grantor:'mvp_test_admin',grantee:'mvp_service_runtime',privilege:'SELECT',is_grantable:false},{schema:'public',table:'ClientProfile',column:null,grantor:'mvp_test_admin',grantee:'mvp_service_runtime',privilege:'SELECT',is_grantable:false},{schema:'public',table:'Payment',column:'id',grantor:'mvp_test_admin',grantee:'mvp_service_runtime',privilege:'SELECT',is_grantable:false}].filter(g=>!before.grants.some(b=>JSON.stringify(b)===JSON.stringify(g))));
 const rollback=restoreGrantSql(before.grants,planned);writeFileSync(resolve(out,'rollback-from-before.sql'),'BEGIN;\n'+rollback.join(';\n')+';\nCOMMIT;\n');
 let applied=false,frontCode:number|null=null;
 try{
  await admin.$transaction(async tx=>{for(const sql of temporaryGrants)await tx.$executeRawUnsafe(sql);});applied=true;
  const temporary=await snapshotGrants(admin),added=assertTemporaryDelta(before.grants,temporary.grants);
  save('temporary',{privileges:temporary,added,security:await security(),isolation:await isolation()});
  demand(hash(await identity())===hash(target)&&hash(await security())===hash(secure),'SECURITY_DRIFT');demand(dump('schema-temporary',true).structure===schema.structure,'SCHEMA_DRIFT');demand(hash(await dataHashes())===hash(data),'UNEXPECTED_DATA_CHANGE');
  console.log('TEMPORARY_GRANTS_SECURITY_PASS; starting two refresh cases and speech diagnostic');
  const child=spawnSync(process.execPath,[resolve(root,'scripts/run-secretary-front.cjs'),'--refresh-only',...process.argv.filter(v=>v.startsWith('--resume-products=')||v.startsWith('--read-only-finish='))],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:25*1024*1024});
  frontCode=child.status;writeFileSync(resolve(out,'front.log'),(child.stdout||'')+(child.stderr||''));console.log(child.stdout||'');
  demand(hash(await security())===hash(secure),'POST_FRONT_SECURITY_DRIFT');demand(canonicalGrants((await snapshotGrants(admin)).grants)===canonicalGrants(temporary.grants),'POST_FRONT_GRANT_DRIFT');
  save('post-front',{isolation:await isolation(),data:await dataHashes(),front_exit:frontCode,backup:dump('after-front')});
 }finally{
  if(applied){
   const restored=await admin.$transaction((tx:Prisma.TransactionClient)=>restoreGrants(tx,before),{timeout:30000});
   demand(restored.raw_equal,'FINAL_RAW_ACL_MISMATCH');
   const repeat=await admin.$transaction(tx=>restoreGrants(tx,before));demand(repeat.sql.length===0&&repeat.raw_equal,'FINAL_DOUBLE_RESTORE');
   const finalSecurity=await security();demand(hash(finalSecurity)===hash(secure),'FINAL_SECURITY_DRIFT');demand(dump('schema-final',true).structure===schema.structure,'FINAL_SCHEMA_DRIFT');
   save('after-rollback',{privileges:restored.after,integral_equal:JSON.stringify(restored.after)===JSON.stringify(before),canonical_equal:canonicalGrants(restored.after.grants)===canonicalGrants(before.grants),raw_equal:restored.raw_equal,repeat_noop:true,security:finalSecurity,isolation:await isolation(),backup:dump('after-rollback')});console.log('ROLLBACK_EXACT_PASS');
  }
 }
 demand(frontCode===0,'FRONT_CHECKS_FAILED');save('verdict',{grants:'PASS',rollback:'PASS',security:'PASS',front_exit:frontCode});
}
main().catch(e=>{save('failure',{message:e instanceof Error?e.message:String(e)});console.error(e);process.exitCode=1;}).finally(async()=>{await admin.$disconnect();await runtime.$disconnect();});
