/** Build-only guard: all feature flags OFF, no usable DB or provider credentials. */
const {spawnSync}=require('node:child_process');
const {resolve,dirname}=require('node:path');
const {readFileSync,writeFileSync}=require('node:fs');
const root=resolve(__dirname,'..');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/SECRET|TOKEN|API_KEY|SUPABASE|MERCADOPAGO|RESEND|OPENAI|DATABASE_URL|DIRECT_URL|SALON_SECRETARY|VERCEL|NODE_OPTIONS/i.test(key)));
for(const file of ['.env','.env.local']){try{for(const line of readFileSync(resolve(root,file),'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);if(m)env[m[1]]='';}}catch{}}
Object.assign(env,{APP_ENV:'test',VERCEL_ENV:'development',DATABASE_URL:'postgresql://mvp_service_runtime@127.0.0.1:1/never_connect_build',DIRECT_URL:'postgresql://mvp_service_runtime@127.0.0.1:1/never_connect_build',NEXTAUTH_SECRET:'disposable-build-secret',NEXTAUTH_URL:'http://127.0.0.1:3001',NEXT_TELEMETRY_DISABLED:'1',
 SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_NORMAL_REVIEW_MAX:'5',SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP:'10',SALON_SECRETARY_ENABLED:'false',SALON_SECRETARY_FRONT_ENABLED:'false',SALON_SECRETARY_VOICE_ENABLED:'false',SALON_SECRETARY_ALLOW_PAID_CALLS:'false',SALON_SECRETARY_JEV_ROUTER_ENABLED:'false',SALON_SECRETARY_MULTI_ACTION_V2_ENABLED:'false',SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED:'false',PLATFORM_BILLING_ENABLED:'false',MERCADOPAGO_BILLING_ENABLED:'false',EMAIL_INVITES_ENABLED:'false',SECRETARY_FRONT_E2E_SCRIPT:'',NEXT_FONT_GOOGLE_MOCKED_RESPONSES:resolve(root,'packages/salon-secretary/evaluation/results/execution-font-mock.cjs')});
const result=spawnSync(process.execPath,[resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'run','build'],{cwd:root,env,windowsHide:true,encoding:'utf8',maxBuffer:10*1024*1024});
const logName = process.argv.includes('--staging-readiness') ? 'staging-readiness-build.log' : 'front-voice-closure-final-build.log';
writeFileSync(resolve(root,'packages/salon-secretary/evaluation/results',logName),(result.stdout||'')+(result.stderr||''));
console.log('BUILD_EXIT',result.status);console.log(((result.stdout||'')+(result.stderr||'')).split('\n').slice(-12).join('\n'));process.exitCode=result.status===0?0:1;
