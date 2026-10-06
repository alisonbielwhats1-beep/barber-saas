import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { TARGET_RESULTS, reevaluate, freezeFinal, protectExisting } from "../packages/salon-secretary/evaluation/topic14-final-target";
import { assertPhaseAEnvironment } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { sealRealBenchmark, executeRealBenchmark } from "../packages/salon-secretary/evaluation/topic14-final-real";

async function main(){
  const command=process.argv[2];
  if(process.argv.length!==3||!["--reevaluate","--seal","--execute"].includes(command))throw Error("FINAL_COMMAND_INVALID");
  mkdirSync(TARGET_RESULTS,{recursive:true});
  if(command==="--reevaluate"){
    globalThis.fetch=async()=>{throw Error("FINAL_OFFLINE_NETWORK_FORBIDDEN");};
    const result=reevaluate();console.log(JSON.stringify({passed:result.passed,turns:result.rows.length,new_inferences:0}));
    if(!result.passed)process.exitCode=1;return;
  }
  assertPhaseAEnvironment();
  if(process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED==="true"||process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED==="true")throw Error("FINAL_FLAGS_ALREADY_ON");
  const admin=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  try{
    if(command==="--seal"){await protectExisting(admin);freezeFinal();console.log(JSON.stringify(await sealRealBenchmark(admin,prisma)));}
    else{
      await protectExisting(admin);const result=await executeRealBenchmark(admin,prisma);await protectExisting(admin);
      console.log(JSON.stringify({status:result.status,stopped:result.stopped,requests:result.requests,rows:result.rows.map(r=>({case:r.case_id,turn:r.turn,classification:r.classification,score:r.score})),effects:result.effects,flags_final:result.flags_final}));
      if(result.stopped||result.rows.length!==1||!result.rows[0].score.pass)process.exitCode=1;
    }
  }finally{
    for(const f of ["SALON_SECRETARY_MULTI_ACTION_V2_ENABLED","SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","SALON_SECRETARY_ALLOW_PAID_CALLS","SALON_SECRETARY_JEV_ROUTER_ENABLED"])process.env[f]="false";
    await admin.$disconnect();await prisma.$disconnect();
  }
}
main().catch(error=>{const message=error instanceof Error?error.message:"";console.error(JSON.stringify({status:"STOPPED",code:/^[A-Z0-9_:.-]+$/.test(message)?message:"FINAL_FAIL_CLOSED"}));process.exitCode=1;});
