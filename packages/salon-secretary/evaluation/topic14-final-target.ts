/** Final closure scope: re-score existing evidence, then exactly one new x94 request. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { TurnCapture } from "./hard-conversations-observation-bridge";
import type { RealRow } from "./t21-real";
import { t21Cases, t21Fixture } from "./t21-cases";
import { targetHashes as oldHashes, precheckTarget as oldPrecheck, scoreT21, scoreTargetUX } from "./t21-target";
import { digest, readDurable } from "./hard-conversations-durable";
import { persistBenchmark } from "./multi-action-benchmark-harness";
import { EVALUATOR_TEXT_POLICY } from "./evaluator-text";
import { snapshotPhaseACase } from "./hard-conversations-phase-a-db";
import { benchmarkCases, benchmarkFixture } from "./multi-action-benchmark-cases";
export { scoreT21, scoreTargetUX };
export const ORIGINAL_RESULTS="packages/salon-secretary/evaluation/results/t21-extension";
export const TARGET_RESULTS="packages/salon-secretary/evaluation/results/topic14-final";
export const targetCases=t21Cases.filter(c=>c.id==="x94");
const scorer="packages/salon-secretary/evaluation/t21-target.ts";
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
export const originalReport=()=>read(join(ORIGINAL_RESULTS,"real-result-1790309742335.json")) as {rows:RealRow[];final:{id:string;snapshot:Awaited<ReturnType<typeof snapshotPhaseACase>>}[]};
export function targetHashes(){return {...oldHashes(),...Object.fromEntries([
  "packages/salon-secretary/evaluation/evaluator-text.ts","packages/salon-secretary/evaluation/topic14-final-target.ts",
  "packages/salon-secretary/evaluation/topic14-final-real.ts","scripts/run-topic14-final.ts","scripts/run-topic14-final.cjs",
].map(p=>[p,digest(readFileSync(p))]))};}
export function verifyOriginalEvidence(){
  const closure=read(join(ORIGINAL_RESULTS,"closure.json")),manifest=read(join(ORIGINAL_RESULTS,"real-manifest.json"));
  for(const [p,h] of Object.entries(closure.evidence_sha256))if(digest(readFileSync(join(ORIGINAL_RESULTS,p)))!==h)throw Error("FINAL_ORIGINAL_EVIDENCE_DRIFT");
  for(const [p,h] of Object.entries(manifest.source_hashes))if(p!==scorer&&digest(readFileSync(p))!==h)throw Error("FINAL_RUNTIME_DRIFT");
  if(digest(readFileSync(join(TARGET_RESULTS,"original-t21-target.ts.txt")))!==manifest.source_hashes[scorer])throw Error("FINAL_ORIGINAL_SCORER_DRIFT");
  const cases=t21Cases.map(({outputs:_outputs,...c})=>{void _outputs;return c;});
  if(JSON.stringify(cases)!==JSON.stringify(manifest.cases))throw Error("FINAL_EXPECTED_DRIFT");
  const journal=readDurable(join(ORIGINAL_RESULTS,"real.jsonl"),digest(readFileSync(join(ORIGINAL_RESULTS,"real-manifest.json"))));
  if(journal.filter(r=>r.kind==="BEFORE_NETWORK").length!==9||journal.some(r=>r.case_id==="x94"))throw Error("FINAL_ORIGINAL_REQUESTS_DRIFT");
  return {original_closure_sha256:digest(readFileSync(join(ORIGINAL_RESULTS,"closure.json"))),original_manifest_sha256:digest(readFileSync(join(ORIGINAL_RESULTS,"real-manifest.json"))),journal};
}
export function reevaluate(){
  const verified=verifyOriginalEvidence(),original=originalReport(),previous=new Map<string,RealRow["observed_view"]>();
  if(original.rows.length!==9)throw Error("FINAL_ORIGINAL_TURNS_DRIFT");
  const rows=original.rows.map(row=>{
    const c=t21Cases.find(c=>c.id===row.case_id);if(!c||c.id==="x94"||!row.observed_view)throw Error("FINAL_REPLAY_SCOPE");
    const capture=verified.journal.find(r=>r.case_id===c.id&&r.turn_index===row.turn&&r.kind==="OBSERVATION_EVENT"&&(r.data as {capture?:TurnCapture}).capture)?.data as {capture:TurnCapture}|undefined;
    if(!capture)throw Error("FINAL_CAPTURE_MISSING");
    const score=scoreT21(c,row.turn,row.observed_view,previous.get(c.id)??null),ux=scoreTargetUX(c.id,row.turn,row.observed_view,capture.capture,score);
    const effectsSafe=!row.effects.changed_tables.length&&Object.entries(row.effects.counters).every(([key,value])=>key==="openai_requests"||value===0);
    const pass=score.pass&&!ux.failures.length&&effectsSafe;
    previous.set(c.id,row.observed_view);
    return {case_id:c.id,turn:row.turn,ORIGINAL_FROZEN_RESULT:{classification:row.classification,score:row.score},
      CORRECTED_EVALUATOR_RESULT:{classification:pass?"PASS":score.safety.length?"SAFETY_FAILURE":"FUNCTIONAL_FAILURE_SAFE",score,ux,effectsSafe}};
  });
  const {journal:_journal,...binding}=verified;void _journal;
  const result={policy:EVALUATOR_TEXT_POLICY,...binding,scorer_sha256:digest(readFileSync(scorer)),normalizer_sha256:digest(readFileSync("packages/salon-secretary/evaluation/evaluator-text.ts")),
    new_inferences:0,passed:rows.every(r=>r.CORRECTED_EVALUATOR_RESULT.classification==="PASS"),rows};
  persistBenchmark(join(TARGET_RESULTS,"corrected-evaluator-result.json"),result);return result;
}
export async function protectExisting(admin:PrismaClient){
  verifyOriginalEvidence();
  for(const row of originalReport().final.filter(r=>r.id!=="x94")){
    const current=await snapshotPhaseACase(admin,t21Fixture(t21Cases.find(c=>c.id===row.id)!));
    if(JSON.stringify(current)!==JSON.stringify(row.snapshot))throw Error("FINAL_PRIOR_CASE_DRIFT");
  }
  const historical=read("packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/post-battery-snapshot.json");
  for(const c of benchmarkCases.filter(c=>["x41","x42","x44","x46","x49"].includes(c.id))){
    if(JSON.stringify(await snapshotPhaseACase(admin,benchmarkFixture(c,"b")))!==JSON.stringify(historical.cases.find((r:{id:string})=>r.id===c.id).snapshot))throw Error("FINAL_HISTORICAL_DRIFT");
  }
}
export const canStartCompleteCase=(used:number,id:string)=>{if(id!=="x94")throw Error("FINAL_CASE_FORBIDDEN");return used===0;};
export async function precheckTarget(admin:PrismaClient,runtime:PrismaClient,c:typeof targetCases[number]){
  if(c.id!=="x94")throw Error("FINAL_CASE_FORBIDDEN");await protectExisting(admin);await oldPrecheck(admin,runtime,c);
  if(JSON.stringify(await snapshotPhaseACase(admin,t21Fixture(c)))!==JSON.stringify(originalReport().final.find(r=>r.id===c.id)!.snapshot))throw Error("FINAL_X94_BASELINE_DRIFT");
}
export function freezeFinal(){
  verifyOriginalEvidence();const correction=read(join(TARGET_RESULTS,"corrected-evaluator-result.json")),checks=read(join(TARGET_RESULTS,"pre-network-checks.json"));
  if(!correction.passed||!checks.passed||correction.scorer_sha256!==digest(readFileSync(scorer))||correction.normalizer_sha256!==digest(readFileSync("packages/salon-secretary/evaluation/evaluator-text.ts")))throw Error("FINAL_OFFLINE_NOT_PASSED");
  persistBenchmark(join(TARGET_RESULTS,"frozen-plan.json"),{source_hashes:targetHashes(),cases:targetCases.map(({outputs:_outputs,...c})=>{void _outputs;return c;}),
    corrected_evaluator_sha256:digest(readFileSync(join(TARGET_RESULTS,"corrected-evaluator-result.json"))),checks_sha256:digest(readFileSync(join(TARGET_RESULTS,"pre-network-checks.json"))),
    max_requests:1,max_usd:.013,retries:0,confirm:false,execute:false,jev:false,store:false,hosted_tools:0,containers:0});
}
export function verifyFrozenTarget(){
  verifyOriginalEvidence();const path=join(TARGET_RESULTS,"frozen-plan.json"),frozen=read(path);
  if(JSON.stringify(targetHashes())!==JSON.stringify(frozen.source_hashes)||frozen.max_requests!==1||frozen.max_usd!==.013||
    frozen.corrected_evaluator_sha256!==digest(readFileSync(join(TARGET_RESULTS,"corrected-evaluator-result.json")))||
    frozen.checks_sha256!==digest(readFileSync(join(TARGET_RESULTS,"pre-network-checks.json"))))throw Error("FINAL_MANIFEST_DRIFT");
  return digest(readFileSync(path));
}
