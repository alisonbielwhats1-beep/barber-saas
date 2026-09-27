/** CLI only; launcher loads local credentials privately and guards reject every non-local database. */
import { resolve } from 'node:path';
import { prepareFreeUse, runFreeUse, safeOutputDirectory } from '../packages/salon-secretary/evaluation/free-use-runner';
async function main(){
 const args=process.argv.slice(2),mode=args.shift();
 if(!['--prepare','--run'].includes(mode??''))throw Error('FREE_USE_COMMAND');
 const values:Record<string,string>={};
 while(args.length){const key=args.shift();if(!key||!['--cases','--out','--max-requests'].includes(key)||!args.length||values[key])throw Error('FREE_USE_ARGUMENT');values[key]=args.shift()!;}
 if(!values['--out'])throw Error('FREE_USE_OUT_REQUIRED');
 const out=safeOutputDirectory(resolve(values['--out']));
 const result=mode==='--prepare'?await prepareFreeUse(values['--cases'],out,values['--max-requests']?Number(values['--max-requests']):undefined):await runFreeUse(out);
 console.log(JSON.stringify(result));
 if('fail' in result&&(result.fail||result.blocked||result.notExecuted))process.exitCode=1;
}
main().catch(error=>{process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='false';console.error(JSON.stringify({status:'BLOCKED',code:error instanceof Error&&/^[A-Z0-9_:.-]{1,160}$/.test(error.message)?error.message:'FREE_USE_FAILURE_REDACTED'}));process.exitCode=1;});
