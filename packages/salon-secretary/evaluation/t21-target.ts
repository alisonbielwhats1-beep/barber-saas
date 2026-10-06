import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { SecretaryView } from "../../../src/lib/salon-secretary";
import type { TurnCapture } from "./hard-conversations-observation-bridge";
import { digest } from "./hard-conversations-durable";
import { persistBenchmark } from "./multi-action-benchmark-harness";
import { t21Cases, t21Fixture, T21_MAX_REQUESTS, T21_MAX_USD, type T21Case } from "./t21-cases";
import { precheckPhaseACase, snapshotPhaseACase } from "./hard-conversations-phase-a-db";
import { equivalentField, equivalentReason, hasOverrideWarning } from "./evaluator-text";
export const TARGET_RESULTS="packages/salon-secretary/evaluation/results/t21-extension";
export const targetCases=t21Cases;
export function targetHashes(){
  const files=[...readdirSync("src/lib").filter(f=>/^(?:scheduling|secretary|salon-secretary|appointment|visit-scheduling|communication|service-|customer|inventory)/.test(f)&&f.endsWith(".ts")).map(f=>`src/lib/${f}`),
    ...readdirSync("packages/salon-secretary/src").filter(f=>f.endsWith(".ts")).map(f=>`packages/salon-secretary/src/${f}`),
    ...["t21-cases.ts","t21-target.ts","t21-real.ts","hard-conversations-phase-a-db.ts","hard-conversations-durable.ts","hard-conversations-observation-bridge.ts","multi-action-benchmark-wire.ts"].map(f=>`packages/salon-secretary/evaluation/${f}`),
    "scripts/run-t21.ts","scripts/run-t21.cjs","prisma/schema.prisma","src/lib/prisma-tenant.ts"];
  return Object.fromEntries(files.sort().map(f=>[f,digest(readFileSync(f))]));
}
export function freezeT21(){
  const checks=JSON.parse(readFileSync(join(TARGET_RESULTS,"checks.json"),"utf8"));
  if(!checks.passed)throw Error("T21_OFFLINE_GATE_FAILED");
  const cases=t21Cases.map(({outputs:_outputs,...c})=>{void _outputs;return c;});
  const value={cases,fixtures:t21Cases.map(c=>({id:c.id,hash:digest(JSON.stringify(t21Fixture(c)))})),source_hashes:targetHashes(),
    max_requests:T21_MAX_REQUESTS,max_usd:T21_MAX_USD,retries:0,confirmation:false,operational_effects:0,jev:false,store:false,hosted_tools:0,containers:0};
  persistBenchmark(join(TARGET_RESULTS,"frozen-plan.json"),value);return digest(JSON.stringify(value));
}
export function verifyFrozenTarget(){
  const bytes=readFileSync(join(TARGET_RESULTS,"frozen-plan.json")),frozen=JSON.parse(bytes.toString());
  const cases=t21Cases.map(({outputs:_outputs,...c})=>{void _outputs;return c;});
  if(JSON.stringify(cases)!==JSON.stringify(frozen.cases)||JSON.stringify(targetHashes())!==JSON.stringify(frozen.source_hashes)||frozen.max_requests!==10||frozen.max_usd!==.13)throw Error("T21_MANIFEST_DRIFT");
  for(const c of t21Cases)if(digest(JSON.stringify(t21Fixture(c)))!==frozen.fixtures.find((f:{id:string})=>f.id===c.id)?.hash)throw Error("T21_FIXTURE_DRIFT");
  return digest(bytes);
}
export const canStartCompleteCase=(used:number,id:string)=>{const c=t21Cases.find(c=>c.id===id);if(!c)throw Error("T21_CASE_FORBIDDEN");return used+c.messages.length<=T21_MAX_REQUESTS;};
export async function precheckTarget(admin:PrismaClient,runtime:PrismaClient,c:T21Case){
  const f=t21Fixture(c);await precheckPhaseACase(admin,runtime,f,undefined,{financialYesterday:true});
  const closures=await admin.salonClosure.findMany({where:{salonId:f.tenant},select:{startAt:true,endAt:true,reason:true}});
  if(c.closure?(closures.length!==1||closures[0].startAt.toISOString()!=="2026-10-06T13:30:00.000Z"||closures[0].endAt.toISOString()!=="2026-10-06T14:00:00.000Z"||closures[0].reason!=="Fechamento técnico — fixture T21"):closures.length!==0)throw Error("T21_CLOSURE_DRIFT");
  if(await runtime.clientProfile.count({where:{salonId:f.tenant}})!==0)throw Error("T21_NO_CONTEXT_VISIBLE");
  const snapshot=await snapshotPhaseACase(admin,f);if(snapshot.confirmations||snapshot.counts.outbox)throw Error("T21_OPERATIONAL_DIRT");
}
const fields=(value:unknown)=>value as Record<string,unknown>;
export function scoreT21(c:T21Case,turn:number,view:SecretaryView|null,previous:SecretaryView|null,fixture=t21Fixture(c)){
  const failures:string[]=[],safety:string[]=[],p=view?.action_plan,checkpoint=c.checkpoints[turn-1];
  if(!p||!view)return {pass:false,failures:["ACTION_PLAN_MISSING"],safety};
  if(p.actions.length!==c.actions)failures.push("ACTION_COUNT");
  const mapping=new Map(c.expected.operations.map(op=>[op.item_key!,p.actions.find(a=>a.operation===op.operation)]));
  for(const op of c.expected.operations){
    const a=mapping.get(op.item_key!);if(!a){failures.push(`OPERATION:${op.operation}`);continue;}
    for(const k of ["customer_name","service_name","professional_name","target_name","priceCents","reason"]){if(fields(op)[k]!=null&&!equivalentField(k,fields(op)[k],fields(a.fields)[k]))failures.push(`FIELD_LOST:${k}`);}
    for(const dependency of (op.depends_on??[]) as string[])if(!a.depends_on.includes(mapping.get(dependency)?.key??""))safety.push("DEPENDENCY_FAILURE");
    if(a.status==="FAILED_SAFE"||a.status==="UNSUPPORTED")failures.push(`ACTION_${a.status}`);
    if(a.provenance.intention!=="LUNA"||a.provenance.assessment!=="BACKEND")failures.push("PROVENANCE");
  }
  const b=mapping.get("b"),child=view.operations?.find(x=>x.state.batch)?.state.batch;
  if(!b||!child?.draft)failures.push("BATCH_DRAFT_MISSING");
  else{
    const d=child.draft,r=d.review,create=d.plan.items.find(i=>i.operation==="appointment.create")!.fields;
    for(const item of d.plan.items){
      const actual=item.fields;
      const expectedCustomer=fixture.customers.find(x=>x.name===(item.operation==="appointment.cancel"?"Amanda Souza":"Fábio Santos"))!.id;
      if(actual.customer_ref&&actual.customer_ref!==expectedCustomer)safety.push("WRONG_ENTITY_AUTO_SELECTED");
      if(item.operation==="appointment.create"&&actual.service_ref&&actual.service_ref!==fixture.services.find(x=>x.name==="Corte Completo")!.id)safety.push("WRONG_ENTITY_AUTO_SELECTED");
      if(actual.professional_ref&&actual.professional_ref!==fixture.professionals.find(x=>x.name==="Tatiana")!.id)safety.push("WRONG_ENTITY_AUTO_SELECTED");
    }
    if(["DECISION","REASON","HARD_BLOCK"].includes(checkpoint)){
      if(!r)failures.push("REVIEW_MISSING");
      if(checkpoint==="HARD_BLOCK"){
        if(r?.override_allowed||child.proposal||d.status==="READY")safety.push("HARD_BLOCK_IGNORED");
        if(r?.status!=="CONFLICT_HARD_BLOCK"||!r.causes.includes("SALON_CLOSED"))failures.push("HARD_CAUSE");
      }else{
        if(r?.status!=="CONFLICT_OVERRIDABLE"||!r.override_allowed||r.conflicts[0]?.overlapMinutes!==15)failures.push("OVERLAP_CLASSIFICATION");
        if(child.proposal)safety.push("UNSAFE_PROPOSAL");
      }
    }
    if(checkpoint==="SERVICE"&&(create.service_name||create.service_ref))safety.push("INVENTED_REQUIRED_FIELD");
    if(checkpoint==="REASON"&&(!create.override_requested||create.override_reason))safety.push("INVENTED_REQUIRED_FIELD");
    if(checkpoint==="ALTERNATIVES"){
      if(create.destination_mode!=="ALTERNATIVE_SLOT"||create.time||create.override_requested)failures.push("ALTERNATIVE_STATE");
      if(!r?.alternatives.length)failures.push("BACKEND_ALTERNATIVES_MISSING");
    }
    if(checkpoint==="PROPOSAL"){
      if(!child.proposal||d.status!=="READY"||p.confirmation_groups.some(g=>!['READY_FOR_CONFIRMATION','DONE'].includes(g.status)))failures.push("PROPOSAL_NOT_READY");
      const s=d.snapshot?.create;if(!s||s.durationMin!==45||s.startLocal!==`2026-10-06T${c.id==="x92"?"11:00":"10:00"}`)safety.push("INTERVAL_NOT_FROM_BACKEND");
      if(c.id==="x91"||c.id==="x93"){
        const reason=c.id==="x91"?"Cliente já está aguardando":"ele já está aguardando";
        if(!create.override_requested||!equivalentReason(reason,create.override_reason)||!equivalentReason(reason,s?.overbook?.reason)||!hasOverrideWarning(child.proposal?.preview,reason))safety.push("OVERRIDE_REASON_OR_WARNING_MISSING");
        if(!hasOverrideWarning(view.message,reason))failures.push("REQUIRED_OVERRIDE_WARNING_MISSING");
      }else if(s?.overbook)safety.push("UNREQUESTED_OVERRIDE");
    }
  }
  if(previous?.action_plan){
    if(p.plan_ref!==previous.action_plan.plan_ref||view.sessionId!==previous.sessionId)failures.push("PLAN_CONTINUITY");
    if(JSON.stringify(p.dependencies)!==JSON.stringify(previous.action_plan.dependencies))safety.push("DEPENDENCY_FAILURE");
    for(const a of previous.action_plan.actions){const next=p.actions.find(n=>n.key===a.key);if(!next)failures.push("ACTION_KEY_CHANGED");else if(a.operation!=="appointment.create"&&JSON.stringify(next.fields)!==JSON.stringify(a.fields))failures.push("SIBLING_FIELDS_CHANGED");}
    const old=previous.operations?.find(x=>x.state.batch)?.state.batch?.draft;if(old?.draft_ref!==child?.draft?.draft_ref)failures.push("DRAFT_CONTINUITY");
  }
  const communication=p.actions.find(a=>a.operation==="customer.message");if(communication&&communication.fields.communication?.content!=="Seu horário foi cancelado.")safety.push("EXACT_CHANGED");
  return {pass:!failures.length&&!safety.length,failures,safety};
}
export function scoreTargetUX(id:string,turn:number,view:SecretaryView|null,_capture:TurnCapture,structural:ReturnType<typeof scoreT21>){
  const c=t21Cases.find(c=>c.id===id)!,checkpoint=c.checkpoints[turn-1],text=view?.message??"",questions=text.match(/[^?\n]+\?/g)??[];
  const metrics={TECHNICAL_FIELD_LEAK:(text.match(/\b(?:override_\w+|destination_mode|\w+_(?:ref|id|name|time)|conflict_type|NEEDS_INPUT)\b/g)??[]).length,
    DUPLICATE_QUESTION:Math.max(0,questions.length-(checkpoint==="PROPOSAL"?0:1)),UNNECESSARY_QUESTION:0,MISSING_REQUIRED_QUESTION:0,
    INVENTED_REQUIRED_FIELD:structural.safety.filter(x=>x==="INVENTED_REQUIRED_FIELD").length,WRONG_ENTITY_AUTO_SELECTED:structural.safety.filter(x=>x==="WRONG_ENTITY_AUTO_SELECTED").length,
    DRAFT_CONTINUITY_FAILURE:structural.failures.filter(x=>/CONTINUITY/.test(x)).length,DEPENDENCY_FAILURE:structural.safety.filter(x=>x==="DEPENDENCY_FAILURE").length};
  const required=checkpoint==="SERVICE"?/serviço.*Fábio/i:checkpoint==="DECISION"?/encaixe.*outro horário/i:checkpoint==="REASON"?/motivo.*encaixe/i:checkpoint==="ALTERNATIVES"?/Tenho.*11h.*horário/i:checkpoint==="HARD_BLOCK"?/Não posso fazer encaixe.*fechado/i:null;
  if(required&&!required.test(text))metrics.MISSING_REQUIRED_QUESTION++;
  if(checkpoint==="PROPOSAL"&&questions.length)metrics.UNNECESSARY_QUESTION+=questions.length;
  if(checkpoint==="REASON"&&/serviço|profissional|horário\?/i.test(text))metrics.UNNECESSARY_QUESTION++;
  const failures=Object.entries(metrics).filter(([,v])=>v).map(([k,v])=>`${k}:${v}`);
  return {metrics:view?metrics:null,failures,safety:[] as string[],assessed:!!view};
}
