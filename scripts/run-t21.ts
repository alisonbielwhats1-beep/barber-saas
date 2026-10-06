import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { SalonSecretary } from "../src/lib/salon-secretary";
import { ScriptedServicesModel, call } from "../src/test/scripted-services-model";
import { t21Cases, t21Fixture, type T21Case } from "../packages/salon-secretary/evaluation/t21-cases";
import { TARGET_RESULTS,freezeT21,precheckTarget,scoreT21,scoreTargetUX,targetHashes } from "../packages/salon-secretary/evaluation/t21-target";
import { sealRealBenchmark,executeRealBenchmark } from "../packages/salon-secretary/evaluation/t21-real";
import { persistBenchmark } from "../packages/salon-secretary/evaluation/multi-action-benchmark-harness";
import { assertPhaseAEnvironment,assertPhaseADatabase,backupPhaseALocalDatabase,seedPhaseACase,precheckPhaseACase,snapshotPhaseACase,comparePhaseAJournal,installPhaseAWriteWitness,emptyIndependentCounters } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { RuntimeObservationBridge } from "../packages/salon-secretary/evaluation/hard-conversations-observation-bridge";
import { withPhaseAClock } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-execution";
import { benchmarkCases,benchmarkFixture } from "../packages/salon-secretary/evaluation/multi-action-benchmark-cases";
import { digest } from "../packages/salon-secretary/evaluation/hard-conversations-durable";
const control=(c:T21Case,i:number)=>({...c,id:`x8${i}`});
const historical=benchmarkCases.filter(c=>["x41","x42","x44","x46","x49"].includes(c.id));
async function protectHistorical(admin:PrismaClient){
  const final=JSON.parse(readFileSync("packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/post-battery-snapshot.json","utf8"));
  const rows=final.cases??final.final;
  if(!rows)throw Error("T21_HISTORICAL_SNAPSHOT_FORMAT");
  for(const c of historical){const expected=rows.find((r:{id:string})=>r.id===c.id)?.snapshot;
    if(!expected||JSON.stringify(await snapshotPhaseACase(admin,benchmarkFixture(c,"b")))!==JSON.stringify(expected))throw Error("T21_HISTORICAL_DRIFT");}
}
async function prepare(admin:PrismaClient){
  const env=assertPhaseAEnvironment();await assertPhaseADatabase(admin,prisma);await protectHistorical(admin);
  const cases=[...t21Cases.map(control),...t21Cases];
  if((await Promise.all(cases.map(c=>admin.salon.count({where:{id:t21Fixture(c).tenant}})))).some(Boolean))throw Error("T21_FIXTURES_ALREADY_EXIST");
  const backup=backupPhaseALocalDatabase(env.admin);
  persistBenchmark(join(TARGET_RESULTS,`preparation-backup-${Date.now()}.json`),{backup:{...backup,sha256:digest(readFileSync(backup.path))}});
  for(const c of cases){const f=t21Fixture(c);await seedPhaseACase(admin,f,{financialYesterday:true});
    if(c.closure)await admin.salonClosure.create({data:{salonId:f.tenant,startAt:new Date("2026-10-06T13:30:00Z"),endAt:new Date("2026-10-06T14:00:00Z"),reason:"Fechamento técnico — fixture T21"}});
    await precheckTarget(admin,prisma,c);persistBenchmark(join(TARGET_RESULTS,`fixture-${c.id}.json`),{fixture:f,snapshot:await snapshotPhaseACase(admin,f)});
  }
  await protectHistorical(admin);return {prepared:cases.length,paid_requests:0};
}
async function validate(admin:PrismaClient){
  assertPhaseAEnvironment();await assertPhaseADatabase(admin,prisma);await protectHistorical(admin);
  const prior=existsSync(join(TARGET_RESULTS,"controlled-result.json"));
  if(prior&&!JSON.parse(readFileSync(join(TARGET_RESULTS,"controlled-result.json"),"utf8")).passed)throw Error("T21_PRIOR_CONTROL_INCOMPLETE");
  const directory=prior?join(TARGET_RESULTS,"controlled-after-fix"):TARGET_RESULTS;
  if(prior){if(existsSync(directory))throw Error("T21_REVALIDATION_ALREADY_STARTED");mkdirSync(directory);}
  const effects=emptyIndependentCounters();installPhaseAWriteWitness(prisma,effects);
  prisma.$use((params,next)=>{if(["create","createMany","update","updateMany","upsert","delete","deleteMany"].includes(params.action)&&params.model!=="AuditLog")throw Error("T21_OPERATIONAL_WRITE_FORBIDDEN");return next(params);});
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("T21_OFFLINE_NETWORK_FORBIDDEN");};
  process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED="true";process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED="true";
  let turns=0;
  try{for(const [i,c]of t21Cases.entries()){
    const cc=control(c,i),f=t21Fixture(cc),before=await snapshotPhaseACase(admin,f);
    if(prior){
      const initial=JSON.parse(readFileSync(join(TARGET_RESULTS,`fixture-${cc.id}.json`),"utf8")).snapshot;
      const last=JSON.parse(readFileSync(join(TARGET_RESULTS,`controlled-${c.id}-${c.messages.length}.json`),"utf8"));
      if(JSON.stringify(before.hashes)!==JSON.stringify(initial.hashes)||before.technical_audits!==initial.technical_audits+last.delta.technical_audit_delta)throw Error("T21_CONTROL_BASELINE_DRIFT");
      persistBenchmark(join(directory,`before-${c.id}.json`),before);
      await precheckPhaseACase(admin,prisma,f,{kind:"APPROVED_RESUME_HISTORY",case_id:f.caseId,count:before.technical_audits,technical_audit_hash:before.technical_audit_hash!},{financialYesterday:true});
    }else await precheckTarget(admin,prisma,cc);
    await withPhaseAClock(async()=>{
      const model=new ScriptedServicesModel([call("select_capabilities",c.expected),...c.outputs]);
      const secretary=new SalonSecretary(async()=>model,()=>"gpt-6-luna",undefined,{enabled:()=>false},{enabled:()=>true});
      const bridge=new RuntimeObservationBridge({secretary:{start:secretary.start.bind(secretary),send:secretary.send.bind(secretary)},actor:{salonId:f.tenant,userId:f.actor},fixture:f,
        allowedTurns:c.messages.map((message,i)=>({turn:i+1,message})),effectEvidence:()=>({confirmations:effects.confirmations,business_writes:effects.operational_writes,outbox_writes:effects.outbox_creations,external_messages:effects.external_messages})});
      const conversation_ref=await bridge.open();let previous:Awaited<ReturnType<SalonSecretary["send"]>>|null=null,draft_refs:Record<string,string>={};
      for(const [index,message]of c.messages.entries()){
        const {view,capture}=await bridge.send({conversation_ref,draft_refs,turn_index:index+1,message});
        const score=scoreT21(c,index+1,view,previous,f),ux=scoreTargetUX(c.id,index+1,view,capture,score),after=await snapshotPhaseACase(admin,f),delta=comparePhaseAJournal(before,after);
        const passed=score.pass&&!ux.failures.length&&!delta.changed_tables.length&&!delta.counters.confirmations;
        persistBenchmark(join(directory,`controlled-${c.id}-${index+1}.json`),{passed,view,capture,score,ux,delta,effects});
        if(!passed)throw Error("T21_CONTROLLED_FAILURE");turns++;previous=view;draft_refs=capture.draft_refs;
      }
    });
  }await protectHistorical(admin);
  const result={passed:true,turns,effects,paid_requests:0,source_hashes:targetHashes()};persistBenchmark(join(directory,"controlled-result.json"),result);return result;
  }finally{globalThis.fetch=oldFetch;process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED="false";process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED="false";}
}
async function main(){
  const command=process.argv[2];if(process.argv.length!==3||!["--prepare","--validate","--seal","--execute"].includes(command))throw Error("T21_COMMAND_INVALID");
  assertPhaseAEnvironment();if(process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED==="true"||process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED==="true")throw Error("T21_FLAGS_ALREADY_ON");
  mkdirSync(TARGET_RESULTS,{recursive:true});const admin=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  try{
    if(command==="--prepare")console.log(JSON.stringify(await prepare(admin)));
    if(command==="--validate")console.log(JSON.stringify(await validate(admin)));
    if(command==="--seal"){
      const controlled=JSON.parse(readFileSync(join(TARGET_RESULTS,"controlled-after-fix/controlled-result.json"),"utf8"));
      if(!controlled.passed||JSON.stringify(controlled.source_hashes)!==JSON.stringify(targetHashes()))throw Error("T21_CONTROLLED_NOT_PASSED");
      await protectHistorical(admin);freezeT21();console.log(JSON.stringify(await sealRealBenchmark(admin,prisma)));
    }
    if(command==="--execute"){
      await protectHistorical(admin);const result=await executeRealBenchmark(admin,prisma);await protectHistorical(admin);
      console.log(JSON.stringify({status:result.status,stopped:result.stopped,requests:result.requests,effects:result.effects,flags_final:result.flags_final}));if(result.stopped)process.exitCode=1;
    }
  }finally{for(const flag of ["SALON_SECRETARY_MULTI_ACTION_V2_ENABLED","SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","SALON_SECRETARY_ALLOW_PAID_CALLS","SALON_SECRETARY_JEV_ROUTER_ENABLED"])process.env[flag]="false";await admin.$disconnect();await prisma.$disconnect();}
}
main().catch(e=>{console.error(JSON.stringify({status:"STOPPED",code:/^[A-Z0-9_:.-]+$/.test(e.message??"")?e.message:"T21_FAIL_CLOSED"}));process.exitCode=1;});
