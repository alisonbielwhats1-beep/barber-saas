/* Controlled local browser gate; no .env secrets are inherited by Next. */
const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {assertLocalDbIdentity,readLocalDbIdentity}=require('./local-db-identity.cjs');
const root=resolve(__dirname,'..'),pg='C:/Program Files/PostgreSQL/16/bin/';
/** F4: byte-safe identity (hex data directory, raw-byte suffix check); the display string is never the decision. */
async function frontDatabaseIdentity(db){return assertLocalDbIdentity(await readLocalDbIdentity(db));}
/** --preflight-only: identity + pg_dump backup, then stop (Next and Playwright are not started). */
async function main(){
 const runtime='postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp',adminUrl='postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp';
 const db=new PrismaClient({datasources:{db:{url:adminUrl}}});let identity;
 try{identity=await frontDatabaseIdentity(db);}finally{await db.$disconnect();}
 const directory=identity.directory;
 const out=resolve(root,'packages/salon-secretary/evaluation/results/front-voice',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(out,{recursive:true});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/SECRET|TOKEN|API_KEY|SUPABASE|MERCADOPAGO|RESEND|OPENAI|DATABASE_URL|DIRECT_URL|SALON_SECRETARY|VERCEL|NODE_OPTIONS/i.test(key)));
 // Blank all .env names first, so Next cannot silently load local provider credentials.
 for(const file of ['.env','.env.local']){try{for(const line of readFileSync(resolve(root,file),'utf8').split(/\r?\n/)){const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);if(match)env[match[1]]='';}}catch{}}
 Object.assign(env,{APP_ENV:'test',VERCEL_ENV:'development',DATABASE_URL:runtime,DIRECT_URL:adminUrl,MVP_TEST_ADMIN_URL:adminUrl,MVP_TEST_CLUSTER:directory,MVP_TEST_CLUSTER_HEX:identity.directoryHex,EXECUTION_E2E_OUTPUT:out,
 NEXTAUTH_SECRET:'local-disposable-front-fixture-secret-only',NEXTAUTH_URL:'http://127.0.0.1:3157',NEXT_TELEMETRY_DISABLED:'1',CI:'1',
 SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_NORMAL_REVIEW_MAX:'5',SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP:'10',SALON_SECRETARY_ENABLED:'true',SALON_SECRETARY_FRONT_ENABLED:'true',SALON_SECRETARY_VOICE_ENABLED:'true',SALON_SECRETARY_ALLOW_PAID_CALLS:'false',SALON_SECRETARY_JEV_ROUTER_ENABLED:'false',SALON_SECRETARY_MULTI_ACTION_V2_ENABLED:'true',SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED:'true',SALON_SECRETARY_CONFIRMATION_GROUPING:'component',
 PLATFORM_BILLING_ENABLED:'false',MERCADOPAGO_BILLING_ENABLED:'false',EMAIL_INVITES_ENABLED:'false',SECRETARY_FRONT_E2E_SCRIPT:resolve(out,'model-script.json'),NEXT_FONT_GOOGLE_MOCKED_RESPONSES:resolve(root,'packages/salon-secretary/evaluation/results/execution-font-mock.cjs')});
 const dump=(name)=>{const file=resolve(out,name+'.dump');const r=spawnSync(pg+'pg_dump.exe',['-h','127.0.0.1','-p','55441','-U','mvp_test_admin','-d','everflair_service_mvp','-Fc','-f',file],{env,windowsHide:true});if(r.status!==0||spawnSync(pg+'pg_restore.exe',['-l',file],{env,windowsHide:true}).status!==0)throw Error('BACKUP_FAILED');return {dump:file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')};};
 writeFileSync(resolve(out,'preflight.json'),JSON.stringify({...dump('before-fixtures'),directory,directoryHex:identity.directoryHex,directoryTransport:identity.directoryTransport,local:true},null,2));
 console.log('FRONT_VOICE_EVIDENCE',out);
 if(process.argv.includes('--preflight-only')){console.log('FRONT_PREFLIGHT_ONLY identity and backup ok; Next and Playwright not started');return;}
 const finishArg=process.argv.find(v=>v.startsWith('--read-only-finish='));
 const resumeArg=process.argv.find(v=>v.startsWith('--resume-products='))||finishArg;
 if(resumeArg){
  const prior=resolve(resumeArg.slice(resumeArg.indexOf('=')+1)),allowed=resolve(root,'packages/salon-secretary/evaluation/results/front-voice')+require('node:path').sep;
  if(!prior.startsWith(allowed))throw Error('UNSAFE_RESUME_PATH');
  const fixture=JSON.parse(readFileSync(resolve(prior,'fixture.json'),'utf8'));
  const check=new PrismaClient({datasources:{db:{url:adminUrl}}});
  try{const p=await check.product.findUniqueOrThrow({where:{id:fixture.productId}}),a=await check.appointment.findUniqueOrThrow({where:{id:fixture.appointmentId}}),s=await check.salon.findUniqueOrThrow({where:{id:fixture.salonId}});
   if(!s.slug.startsWith('front-voice-')||p.salonId!==s.id||p.stock!==(finishArg?8:10)||a.salonId!==s.id||a.startAt.toISOString()!==new Date(fixture.date+'T11:00:00-03:00').toISOString())throw Error('RESUME_STATE_MISMATCH');
  }finally{await check.$disconnect();}
  // Preserve all earlier evidence; only the untouched stock action remains in this new run.
  readFileSync(resolve(prior,finishArg?'inventory-replay-no-second-mutation.json':'appointment-refreshed.json'));
  writeFileSync(resolve(out,'fixture.json'),JSON.stringify(fixture,null,2));
  writeFileSync(resolve(out,'model-script.json'),JSON.stringify(finishArg?[]:[JSON.parse(readFileSync(resolve(prior,'model-script.json'),'utf8'))[1]],null,2));
  writeFileSync(resolve(out,'resume.json'),JSON.stringify({prior,agenda:'PASS preserved; not repeated',stock_before:finishArg?8:10,read_only:Boolean(finishArg)},null,2));
  env.SECRETARY_FRONT_RESUME_PRODUCTS='true';env.SECRETARY_FRONT_REFRESH_ONLY='true';env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED='false';
  if(finishArg)env.SECRETARY_FRONT_READ_ONLY_FINISH='true';
 }else{
  const seed=spawnSync(process.execPath,['--import','tsx',resolve(root,'scripts/prepare-secretary-front-fixture.ts')],{cwd:root,env,windowsHide:true,encoding:'utf8'});writeFileSync(resolve(out,'fixture.log'),(seed.stdout||'')+(seed.stderr||''));if(seed.status!==0)throw Error('FIXTURE_FAILED: '+(seed.stderr||''));
 }
 if(process.argv.includes('--refresh-only')&&!resumeArg){
  writeFileSync(resolve(out,'model-script.json'),JSON.stringify(JSON.parse(readFileSync(env.SECRETARY_FRONT_E2E_SCRIPT,'utf8')).slice(1,3),null,2));
  env.SECRETARY_FRONT_REFRESH_ONLY='true';
  env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED='false';
 }
 const run=spawnSync(process.execPath,[resolve(root,'node_modules/@playwright/test/cli.js'),'test','--config=tests/secretary-front.config.ts'],{cwd:root,env,windowsHide:true,encoding:'utf8'});
 writeFileSync(resolve(out,'browser.log'),(run.stdout||'')+(run.stderr||''));
 writeFileSync(resolve(out,'after-backup.json'),JSON.stringify({...dump('after-browser'),flags_final:{paid:false,jev:false,multi_action_v2:false,overlap:false,front:false,voice:false},server_stopped:true},null,2));
 console.log('BROWSER_EXIT',run.status,'Log:',resolve(out,'browser.log'));console.log('FRONT_VOICE_EVIDENCE',out);process.exitCode=run.status===0?0:1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={frontDatabaseIdentity};

