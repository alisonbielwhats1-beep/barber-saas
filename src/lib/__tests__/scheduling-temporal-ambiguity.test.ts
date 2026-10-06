import { SalonSecretary } from "../salon-secretary";
it.each(["onze.","11h.","às onze!","  onze.  ","às onze ?!","ÁS ONZE!","a\u0300s onze!","(onze)."])("punctuation and normalization cannot turn a rejected short role into residual: %s",source=>{
  const roles=["source_time","time","end_time"] as const;
  for(const requested of roles)for(const emitted of roles.filter(field=>field!==requested)){
    const result=groundSchedulingTemporal({customer_name:"Lara",date:"2027-04-14"},{[emitted]:"23:00"},source,zone,now,requested,"appointment.change",[{field:emitted,text:source}]);
    expect(result.pending_temporal_ambiguities).toEqual([]);expect(result.fields[emitted]).toBeUndefined();
    expect(result.rejected.map(item=>item.field)).toEqual(expect.arrayContaining([requested,emitted]));
  }
});
it.each(["Corrige o horário de destino para às quatro.","  Corrige o horário de destino para às quatro!  ","CORRIGE O HORÁRIO DE DESTINO PARA ÀS QUATRO?"])("a broad explicit correction remains a correction with punctuation: %s",source=>{
  const result=groundSchedulingTemporal({date:"2027-04-14",time:"15:00"},{time:"16:00"},source,zone,now,"source_time","appointment.change",[{field:"time",text:source}]);
  expect(result.pending_temporal_ambiguities).toEqual([expect.objectContaining({field:"time",candidates:["04:00","16:00"]})]);
  expect(result.fields.time).toBeUndefined();expect(result.rejected.map(item=>item.field)).not.toContain("source_time");
});
it.each([["às quatro","16:00",true],["às 16h","16:00",false]] as const)("quote granularity cannot retarget an explicit destination correction: %s",async(quote,time,residual)=>{
  const source="Corrige o horário de destino para "+quote;
  for(const proof of [quote,source]){
    const fields={customer_name:"Lara",source_date:"2027-04-13",date:"2027-04-14",time:"15:00"};
    const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"}]});
    const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,waiting_for:"source_time",message:"Qual era o horário original?"};
    await applySchedulingInterpretation(actor,state,{time,temporal_evidence:[{field:"time",text:proof}]},source);
    expect(state.draft?.draft_revision).toBe(2);expect(state.draft?.temporal_missing).toEqual(["source_time"]);
    if(residual){
      expect(state.fields.time).toBeUndefined();
      expect(state.pending_temporal_ambiguities).toEqual([expect.objectContaining({field:"time",candidates:["04:00","16:00"]})]);
    }else{expect(state.fields.time).toBe(time);expect(state.pending_temporal_ambiguities).toEqual([]);}
  }
});
it.each(["às quatro","às 16h"])("without role evidence, a pending clock remains authoritative even during an apparent correction: %s",quote=>{
  const time="16:00";
  const result=groundSchedulingTemporal({date:"2027-04-14",time:"15:00"},{time},"Corrige o horário de destino para "+quote,zone,now,"source_time","appointment.change");
  expect(result.pending_temporal_ambiguities).toEqual([]);
  expect(result.fields.time).toBe("15:00");
  expect(result.rejected.map(item=>item.field)).toEqual(expect.arrayContaining(["source_time","time"]));
});
it.each([
  ["o primeiro das 11h","11:00"],
  ["o segundo das 17h","17:00"],
  ["aquele de 8h","08:00"],
  ["o de antes, às três","15:00"],
])("legacy referential replies cannot retarget a pending clock without role evidence: %s",(source,time)=>{
  const roles=["source_time","time","end_time"] as const;
  for(const requested of roles)for(const emitted of roles.filter(field=>field!==requested)){
    const previous={customer_name:"Lara",date:"2027-04-14",[emitted]:"09:00"};
    const result=groundSchedulingTemporal(previous,{[emitted]:time},source,zone,now,requested,"appointment.change");
    expect(result.fields).toEqual(previous);
    expect(result.pending_temporal_ambiguities).toEqual([]);
    expect(result.rejected.map(item=>item.field)).toEqual(expect.arrayContaining([requested,emitted]));
  }
});
it("a referential legacy reply preserves the draft and accepted destination in the adapter",async()=>{
  const fields={customer_name:"Lara",source_date:"2027-04-13",date:"2027-04-14",time:"09:00"};
  const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"}]});
  const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,waiting_for:"source_time",message:"Qual era o horário original?"};
  await applySchedulingInterpretation(actor,state,{time:"11:00",date:fields.date,customer_name:fields.customer_name},"o primeiro das 11h");
  expect(state.fields).toEqual(fields);expect(state.draft).toEqual(draft);expect(state.waiting_for).toBe("source_time");
  expect(state.pending_temporal_ambiguities).toBeUndefined();expect(state.proposal).toBeUndefined();
});
describe("residual prerequisites and qualifiers have one backend authority",()=>{
 it("keeps an exact reason as the pending question ahead of a clock in both UI and Luna context",async()=>{
   const state=schedulingState();
   await applySchedulingInterpretation(actor,state,{operation:"appointment.cancel",customer_name:"Lara Matos",day_offset:1,time:"14:00",reason:"viagem da cliente",temporal_evidence:[{field:"date",text:"amanhã"},{field:"time",text:"às duas"}]},"Cancela a Lara Matos amanhã às duas porque ela vai viajar.");
   expect(state.waiting_for).toBe("reason");expect(state.pending_temporal_ambiguities).toHaveLength(1);
   let p=createActionPlan(plan([intent("appointment.cancel",{item_key:"cancel",customer_name:"Lara Matos"})]));
   const view={sessionId:"child",cancelled:false,message:state.message,scheduling:state};
   p.actions[0].fields=collectedActionFields(view,p.actions[0]);p=assessPlanAction(p,"cancel",assessmentFromView(view,p.actions[0]));
   const units=[{keys:["cancel"],kind:"single" as const,child:"child"}],children=[{operation_ref:"child",state:view}];
   expect(secretaryPlanMessage(p,units,children)).toBe(state.message);
   const context=planConversationContext(p,units,children).actions[0];
   expect(context.clarification.requested_field).toBe("reason");expect(context.clarification).not.toHaveProperty("requested_component");
   expect(context.pending_temporal_ambiguities).toHaveLength(1);
   await applySchedulingInterpretation(actor,state,{reason:"porque ela vai viajar"},"porque ela vai viajar");
   expect(state.waiting_for).toBe("time");expect(state.message).toContain("02h ou 14h");expect(state.fields.reason).toBe("porque ela vai viajar");
 });
 it("a qualifier for the source clock cannot write a contradictory destination period",async()=>{
   const state=schedulingState();
   const source="Passa a Lara de terça às duas para quarta às 16h.";
   await applySchedulingInterpretation(actor,state,{operation:"appointment.change",customer_name:"Lara",source_weekday:2,weekday:3,source_time:"14:00",time:"16:00",temporal_evidence:[{field:"source_time",text:"terça às duas"},{field:"time",text:"quarta às 16h"}]},source);
   expect(state.waiting_for).toBe("source_time");expect(state.fields.time).toBe("16:00");
   await applySchedulingInterpretation(actor,state,{source_time:"14:00",period:"morning",temporal_evidence:[{field:"source_time",text:"da tarde"}]},"da tarde");
   expect(state.fields).toMatchObject({source_time:"14:00",time:"16:00",source_date:"2027-04-13",date:"2027-04-14"});
   expect(state.fields.period).toBeUndefined();expect(state.draft?.temporal_missing).toBeUndefined();
 });
 it.each([["às quatro","16:00",true],["às 16h","16:00",false]] as const)("keeps a genuine destination correction %s while source time is pending",async(quote,time,residual)=>{
   const fields={customer_name:"Lara",source_date:"2027-04-13",date:"2027-04-14",time:"15:00"};
   const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"}]});
   const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,waiting_for:"source_time",message:"Qual era o horário original?"};
   await applySchedulingInterpretation(actor,state,{time,temporal_evidence:[{field:"time",text:quote}]},"Corrige o horário de destino para "+quote+".");
   expect(state.draft?.draft_revision).toBe(2);
   if(residual){expect(state.fields.time).toBeUndefined();expect(state.pending_temporal_ambiguities).toEqual([{field:"time",kind:"CLOCK_DAYPART",expression:quote,candidates:["04:00","16:00"]}]);}
   else {expect(state.fields.time).toBe(time);expect(state.pending_temporal_ambiguities).toEqual([]);}
   expect(state.fields).toMatchObject({source_date:"2027-04-13",date:"2027-04-14"});expect(state.draft?.temporal_missing).toEqual(["source_time"]);
 });
});
describe("a rejected role cannot become a new residual question",()=>{
 const clocks=["source_time","time","end_time"] as const;
 const cases=clocks.flatMap(requested=>clocks.filter(emitted=>emitted!==requested).flatMap(emitted=>[
   {requested,emitted,source:"às onze",value:"23:00"},
   {requested,emitted,source:"pelas três e meia",value:"15:30"},
   {requested,emitted,source:"às 2h",value:"14:00"},
 ]));
 it.each(cases)("keeps requested $requested when Luna retargets $source to $emitted",({requested,emitted,source,value})=>{
   const previous={customer_name:"Lara",source_date:"2027-04-13",date:"2027-04-14"};
   const result=groundSchedulingTemporal(previous,{[emitted]:value},source,zone,now,requested,"appointment.change",[{field:emitted,text:source}]);
   expect(result.pending_temporal_ambiguities).toEqual([]);
   expect(result.fields[emitted]).toBeUndefined();expect(result.rejected.length).toBeGreaterThan(0);
 });
 it.each(clocks)("preserves draft, fields and question when waiting for %s",async requested=>{
   const fields={customer_name:"Lara",source_date:"2027-04-13",date:"2027-04-14"};
   const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:requested,value:"MISSING"}]});
   const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,waiting_for:requested,message:"Pergunta do papel pendente"};
   const emitted=clocks.find(field=>field!==requested)!;
   await applySchedulingInterpretation(actor,state,{[emitted]:"23:00",temporal_evidence:[{field:emitted,text:"onze"}]},"onze");
   expect(state.draft).toEqual(draft);expect(state.fields).toEqual(fields);expect(state.waiting_for).toBe(requested);
   expect(state.pending_temporal_ambiguities).toBeUndefined();expect(state.message).toContain("Pergunta do papel pendente");
 });
});
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import { nextTemporalAmbiguities, type TemporalAmbiguityContext } from "../scheduling-temporal-ambiguity";
import { applySchedulingInterpretation, schedulingState } from "../secretary-scheduling";
import { upsertSchedulingDraft, proposeAppointmentCreate } from "../scheduling-actions";
import { assessmentFromView, collectedActionFields } from "../secretary-action-plan";
import { secretaryPlanMessage, planConversationContext } from "../secretary-presentation";
import { createActionPlan, assessPlanAction } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import fixture from "../../test/fixtures/secretary-real-wire-golden8-temporal.json";
import type { Tx } from "../prisma-tenant";
import type { SchedulingFields } from "../scheduling-contract";

const db=vi.hoisted(()=>({tx:undefined as unknown as Tx,locate:vi.fn(async()=>[])}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,fn:(tx:Tx)=>unknown)=>fn(db.tx)}));
vi.mock("../scheduling-catalog",async original=>({...await original<object>(),schedulingTimezone:async()=>"America/Sao_Paulo",assertSchedulingAccess:async()=>undefined,listSchedulingAppointments:async()=>[]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>"OWNER",locateSchedulingAppointments:db.locate}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),assertCustomerAccess:async()=>undefined,searchSalonCustomer:async(_tx:unknown,_actor:unknown,name:string)=>[{id:"customer-a",name}]}));
vi.mock("../scheduling-entity-mentions",()=>({validateSchedulingEntityMentions:async()=>undefined}));
vi.mock("../service-catalog",async original=>({...await original<object>(),assertServiceWriter:async()=>({})}));
const now=new Date("2027-04-12T12:00:00Z"),zone="America/Sao_Paulo",actor={salonId:"tenant-a",userId:"owner-a"};
const gf=fixture.rows.find(row=>row.caseId==="GF11")!;
const original=JSON.parse(gf.arguments).turn.operations[0];
const raw=Object.fromEntries(Object.entries(original).filter(([key,value])=>value!=null&&!["item_key","depends_on","released_slot_of"].includes(key)));
type Row=Record<string,unknown>;let rows:Row[];
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);rows=[];db.locate.mockClear();
 const filtered=(where:Row)=>rows.filter(row=>Object.entries(where).every(([k,v])=>row[k]===v));
 db.tx={$executeRaw:vi.fn(async()=>0),auditLog:{
   create:vi.fn(async({data}:{data:Row})=>{rows.push(structuredClone(data));return data}),
   findMany:vi.fn(async({where}:{where:Row})=>filtered(where)),findFirst:vi.fn(async({where}:{where:Row})=>filtered(where)[0]??null)
 }} as unknown as Tx;
});
afterEach(()=>vi.useRealTimers());
const ground=(fields:SchedulingFields,source:string,evidence?:{field:"source_time"|"time"|"end_time";text:string}[],waiting?:string,context?:TemporalAmbiguityContext)=>
 groundSchedulingTemporal({},fields,source,zone,now,waiting,"appointment.change",evidence,context);
function ambiguity(){
 return ground({source_time:"14:00"},"às duas",[{field:"source_time",text:"às duas"}]).pending_temporal_ambiguities;
}
const live=():TemporalAmbiguityContext=>({draft_ref:"backend-owned",draft_revision:1,expires_at:"2027-04-12T12:30:00.000Z",pending_temporal_ambiguities:ambiguity()});

describe("residual clock daypart is active state, never a recovered rejected value",()=>{
 it("replays immutable GF11 provider output preserving each expression and both accepted dates",async()=>{
   expect(createHash("sha256").update(gf.arguments).digest("hex")).toBe(gf.argumentsSha256);
   const state=schedulingState();
   await applySchedulingInterpretation(actor,state,raw,gf.message);
   expect(state.fields).toEqual({customer_name:"Lara Matos",date:"2027-04-14",source_date:"2027-04-13"});
   expect(state.draft?.temporal_missing).toBeUndefined();
   expect(state.draft?.pending_temporal_ambiguities).toEqual(expect.arrayContaining([
     {field:"source_time",kind:"CLOCK_DAYPART",expression:"terça às duas",candidates:["02:00","14:00"]},
     {field:"time",kind:"CLOCK_DAYPART",expression:"quarta às quatro",candidates:["04:00","16:00"]}
   ]));
   expect(state.waiting_for).toBe("source_time");expect(state.message).toContain("02h ou 14h");expect(state.message).not.toContain("Informe novamente");
   expect(db.locate).not.toHaveBeenCalled();expect(state.proposal).toBeUndefined();
   await expect(proposeAppointmentCreate(db.tx,actor,{draft_ref:state.draft!.draft_ref,draft_revision:1})).rejects.toThrow("NEEDS_INPUT");
   const firstRef=state.draft!.draft_ref;
   await applySchedulingInterpretation(actor,state,{source_time:"14:00",temporal_evidence:[{field:"source_time",text:"da tarde"}]},"da tarde");
   expect(state.draft?.draft_ref).toBe(firstRef);expect(state.draft?.draft_revision).toBe(2);
   expect(state.fields).toMatchObject({source_time:"14:00",date:"2027-04-14",source_date:"2027-04-13"});
   expect(state.fields.time).toBeUndefined();expect(state.waiting_for).toBe("time");expect(state.message).toContain("04h ou 16h");
   expect(state.draft?.pending_temporal_ambiguities).toHaveLength(1);expect(db.locate).not.toHaveBeenCalled();
   await applySchedulingInterpretation(actor,state,{time:"16:00",temporal_evidence:[{field:"time",text:"da tarde"}]},"da tarde também");
   expect(state.draft?.draft_ref).toBe(firstRef);expect(state.draft?.draft_revision).toBe(3);
   expect(state.fields).toMatchObject({source_time:"14:00",time:"16:00",date:"2027-04-14",source_date:"2027-04-13"});
   expect(state.draft?.pending_temporal_ambiguities).toBeUndefined();expect(state.draft?.temporal_missing).toBeUndefined();
   expect(rows.some(row=>row.action==="CONFIRMED"||row.action==="PROPOSAL")).toBe(false);
 });
 it.each([["às três","15:00","03:00"],["pelas cinco e meia","17:30","05:30"],["às oito e quinze","20:15","08:15"],["às doze","00:00","12:00"],["às 2h","14:00","02:00"],["pelas 3:45","15:45","03:45"]])("keeps the literal alternatives for %s", (source,time,literal)=>{
   const result=ground({time},source,[{field:"time",text:source}]);
   expect(result.fields.time).toBeUndefined();expect(result.pending_temporal_ambiguities).toEqual([{field:"time",kind:"CLOCK_DAYPART",expression:source,candidates:[literal,time]}]);
 });
 it.each([["às duas da tarde","02:00"],["às duas","15:00"],["não às duas","14:00"],["às duas ou três","14:00"]])("does not launder a contradiction as an ambiguity: %s", (source,time)=>{
   const result=ground({time},source,[{field:"time",text:source}]);expect(result.fields.time).toBeUndefined();expect(result.pending_temporal_ambiguities).toEqual([]);
 });
 it("keeps swapped role evidence rejected",()=>{
   const source="Mude de terça às duas para quarta às quatro";
   const result=ground({source_time:"14:00",time:"16:00"},source,[{field:"source_time",text:"quarta às quatro"},{field:"time",text:"terça às duas"}]);
   expect(result.pending_temporal_ambiguities).toEqual([]);expect(result.fields.source_time).toBeUndefined();
 });
 it.each(["da tarde","à tarde","no período da tarde"])("resolves only the requested live candidate from %s", source=>{
   const result=ground({source_time:"14:00"},source,[{field:"source_time",text:source}],"source_time",live());
   expect(result.fields.source_time).toBe("14:00");expect(result.rejected).toEqual([]);
 });
 it.each([
   ["sem contexto",undefined,"source_time","14:00","da tarde"],
   ["sem papel",live(),undefined,"14:00","da tarde"],
   ["papel errado",live(),"time","14:00","da tarde"],
   ["candidato errado",live(),"source_time","15:00","da tarde"],
   ["período contraditório",live(),"source_time","14:00","da manhã"],
   ["negação",live(),"source_time","14:00","não da tarde"],
   ["qualificadores divergentes",live(),"source_time","14:00","de manhã ou da tarde"],
   ["contexto expirado",{...live(),expires_at:"2027-04-12T11:00:00.000Z"},"source_time","14:00","da tarde"],
 ])("rejects %s",(_label,context,waiting,time,source)=>{
   const result=ground({source_time:time as string},source as string,[{field:"source_time",text:source as string}],waiting as string|undefined,context as TemporalAmbiguityContext|undefined);
   expect(result.fields.source_time).toBeUndefined();expect(result.rejected.length).toBeGreaterThan(0);
 });
 it("rejects a qualifier without evidence or active residual",()=>{
   expect(ground({time:"14:00"},"da tarde").fields.time).toBeUndefined();
 });
 it("requires the evidence quote itself to prove the residual component",()=>{
   const result=ground({source_time:"14:00"},"O original é da tarde",[{field:"source_time",text:"original"}],"source_time",live());
   expect(result.fields.source_time).toBeUndefined();expect(result.rejected.length).toBeGreaterThan(0);
 });
 it.each(["","entendi"])("does not accept a missing clock answer in live residual: %s",source=>{
   expect(ground({source_time:"14:00"},source,undefined,"source_time",live()).fields.source_time).toBeUndefined();
 });
 it("an explicit new clock replaces only its old residual",()=>{
   const pending=ambiguity(),result=ground({source_time:"15:45"},"às 15:45",[{field:"source_time",text:"às 15:45"}],"source_time",live());
   expect(result.fields.source_time).toBe("15:45");
   expect(nextTemporalAmbiguities(pending,result.pending_temporal_ambiguities,result.fields,{source_time:"15:45"},result.rejected)).toEqual([]);
 });
 it("preserves the exact draft on an incorrectly targeted short answer",async()=>{
   const state=schedulingState();await applySchedulingInterpretation(actor,state,raw,gf.message);
   const before=structuredClone(state.draft);
   await applySchedulingInterpretation(actor,state,{time:"16:00",temporal_evidence:[{field:"time",text:"da tarde"}]},"da tarde");
   expect(state.draft).toEqual(before);expect(state.waiting_for).toBe("source_time");expect(state.fields.time).toBeUndefined();
 });
 it("does not use an old draft revision to authorize resolution",async()=>{
   const state=schedulingState();await applySchedulingInterpretation(actor,state,raw,gf.message);
   const before=structuredClone(state);
   await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields:state.fields,pending_temporal_ambiguities:state.pending_temporal_ambiguities,draft_ref:state.draft!.draft_ref,expected_revision:1});
   await expect(applySchedulingInterpretation(actor,state,{source_time:"14:00",temporal_evidence:[{field:"source_time",text:"da tarde"}]},"da tarde")).rejects.toThrow();
   expect(state).toEqual(before);
   expect(rows.some(row=>row.action==="PROPOSAL"||row.action==="CONFIRMED")).toBe(false);
 });
 it("projects the same residual and one exact question through draft, ActionPlan and next Luna context",async()=>{
   const state=schedulingState();await applySchedulingInterpretation(actor,state,raw,gf.message);
   let p=createActionPlan(plan([intent("appointment.change",{item_key:"move",customer_name:"Lara Matos",source_time:"14:00",time:"16:00"})]));
   const view={sessionId:"child",cancelled:false,message:state.message,scheduling:state};
   p.actions[0].fields=collectedActionFields(view,p.actions[0]);
   p=assessPlanAction(p,"move",assessmentFromView(view,p.actions[0]));
   const units=[{keys:["move"],kind:"single" as const,child:"child"}],children=[{operation_ref:"child",state:view}];
   expect(p.actions[0].fields).not.toHaveProperty("time");
   expect(p.actions[0].assessment.pending_temporal_ambiguities).toEqual(state.draft?.pending_temporal_ambiguities);
   expect(secretaryPlanMessage(p,units,children)).toBe(state.message);
   const context=planConversationContext(p,units,children).actions[0];
   expect(context.clarification).toMatchObject({requested_field:"source_time",requested_component:"daypart",previous_response:state.message});
   expect(context.pending_temporal_ambiguities).toHaveLength(2);expect(context.fields).toMatchObject({customer_name:"Lara Matos",date:"2027-04-14",source_date:"2027-04-13"});
 });
});

it("a deferred read retains its residual at interpretation and resolves before any read execution",async()=>{
  const {prepareDeferredReadFields}=await import("../secretary-deferred-read");
  let p=createActionPlan({...plan([intent("service.create",{item_key:"before",name:"Tratamento",priceCents:8000,durationMin:40}),intent("appointment.list",{item_key:"after",depends_on:["before"]})]),independent:false});
  const action=p.actions[1];
  const first=await prepareDeferredReadFields(actor,action,{day_offset:1,time:"15:30",temporal_evidence:[{field:"date",text:"amanhã"},{field:"time",text:"às três e meia"}]},"Depois me mostre a agenda de amanhã às três e meia.",undefined,now);
  expect(first.fields).toMatchObject({date:"2027-04-13"});expect(first.fields.time).toBeUndefined();
  expect(first.pending_temporal_ambiguities).toEqual([{field:"time",kind:"CLOCK_DAYPART",expression:"às três e meia",candidates:["03:30","15:30"]}]);
  action.fields=first.fields;p=assessPlanAction(p,"after",{status:"NEEDS_INPUT",missing_fields:first.missing,pending_temporal_ambiguities:first.pending_temporal_ambiguities});
  const next=await prepareDeferredReadFields(actor,p.actions[1],{time:"15:30",temporal_evidence:[{field:"time",text:"à tarde"}]},"à tarde","time",now,{draft_ref:p.plan_ref,draft_revision:p.revision,expires_at:"2027-04-12T12:30:00.000Z",pending_temporal_ambiguities:first.pending_temporal_ambiguities});
  expect(next.fields).toMatchObject({date:"2027-04-13",time:"15:30"});expect(next.pending_temporal_ambiguities).toEqual([]);expect(next.missing).toEqual([]);
  expect(db.locate).not.toHaveBeenCalled();expect(rows).toEqual([]);
});
it("NEW isolates a residual and RESUME restores only the owner plan with its remaining role",async()=>{
  const firstSelection=plan([intent("appointment.change",{item_key:"move",customer_name:"Lara Matos",source_weekday:2,weekday:3,source_time:"14:00",time:"16:00",temporal_evidence:original.temporal_evidence})]);
  let model=new ScriptedServicesModel([call("select_capabilities",firstSelection)]);
  const secretary=new SalonSecretary(async()=>model,()=>"test",undefined,{}, {enabled:()=>true});
  const session=await secretary.start(actor,"auto");
  const first=await secretary.send(actor,{sessionId:session.sessionId,message:gf.message});
  const initial=structuredClone(first.action_plan!);
  model=new ScriptedServicesModel([call("upsert_action_draft",{operation:null,new_request:plan([intent("appointment.list",{item_key:"agenda",day_offset:1})])})]);
  const next=await secretary.send(actor,{sessionId:session.sessionId,message:"Agora me mostre a agenda de amanhã."});
  expect(next.action_plan!.plan_ref).not.toBe(initial.plan_ref);expect(next.action_plan!.actions[0].assessment.pending_temporal_ambiguities).toBeUndefined();
  expect(next.action_plan!.actions[0].fields).not.toHaveProperty("customer_name");
  await expect(secretary.send({...actor,salonId:"tenant-other"},{sessionId:session.sessionId,message:"Volte à remarcação."})).rejects.toThrow("SESSION_NOT_FOUND");
  model=new ScriptedServicesModel([call("select_capabilities",{skills:[],independent:true,operations:[],resume_request:{plan_ref:initial.plan_ref,patches:plan([intent("appointment.change",{item_key:"move",source_time:"14:00",temporal_evidence:[{field:"source_time",text:"da tarde"}]})])}})]);
  const resumed=await secretary.send(actor,{sessionId:session.sessionId,message:"Volte à remarcação. O original é da tarde."});
  expect(resumed.action_plan!.plan_ref).toBe(initial.plan_ref);expect(resumed.action_plan!.actions).toHaveLength(1);
  expect(resumed.action_plan!.actions[0].fields).toMatchObject({source_time:"14:00",date:"2027-04-14",source_date:"2027-04-13"});
  expect(resumed.action_plan!.actions[0].assessment.pending_temporal_ambiguities).toEqual([{field:"time",kind:"CLOCK_DAYPART",expression:"quarta às quatro",candidates:["04:00","16:00"]}]);
  expect(resumed.message).toContain("04h ou 16h");
  expect(resumed.action_plan!.confirmation_groups.every(group=>group.status==="NEEDS_REVIEW")).toBe(true);
});
