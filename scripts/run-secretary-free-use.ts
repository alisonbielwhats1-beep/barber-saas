/** CLI only; launcher loads local credentials privately and guards reject every non-local database. */
import { resolve } from 'node:path';
import { prepareFreeUse, runFreeUse, safeOutputDirectory } from '../packages/salon-secretary/evaluation/free-use-runner';
import { parseFreeUseArgs } from '../packages/salon-secretary/evaluation/free-use-options';
async function main(){
 // --mission accepts only allowlisted ids (never a journal path); --repeat K (1..8) is fixed at --prepare.
 const options=parseFreeUseArgs(process.argv.slice(2));
 const out=safeOutputDirectory(resolve(options.out));
 const result=options.mode==='--prepare'?await prepareFreeUse(options.cases,out,options.maxRequests,{repeat:options.repeat,mission:options.mission}):await runFreeUse(out,options.mission);
 console.log(JSON.stringify(result));
 if('fail' in result&&(result.fail||result.blocked||result.notExecuted))process.exitCode=1;
}
main().catch(error=>{process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='false';console.error(JSON.stringify({status:'BLOCKED',code:error instanceof Error&&/^[A-Z0-9_:.-]{1,160}$/.test(error.message)?error.message:'FREE_USE_FAILURE_REDACTED'}));process.exitCode=1;});
