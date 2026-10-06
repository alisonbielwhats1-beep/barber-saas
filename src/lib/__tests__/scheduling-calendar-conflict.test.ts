import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import type { TemporalAmbiguityContext } from "../scheduling-temporal-ambiguity";
import { calendarConflictQuestion, pendingCalendarConflicts, type PendingCalendarConflict } from "../scheduling-calendar-conflict";
import { weekdayOfDateKey } from "../time";
import { applySchedulingInterpretation, schedulingState } from "../secretary-scheduling";
import { upsertSchedulingDraft, proposeAppointmentCreate } from "../scheduling-actions";
import { groundBatchPatch, startBatch, type BatchState } from "../secretary-batch";
import { upsertBatchDraft, proposeActionBatch, validateBatchPlan } from "../scheduling-batch";
import { clarificationContext } from "../secretary-clarification";
import { assessmentFromView, collectedActionFields } from "../secretary-action-plan";
import { planConversationContext, secretaryPlanMessage } from "../secretary-presentation";
import { prepareDeferredReadFields } from "../secretary-deferred-read";
import { createActionPlan, assessPlanAction, validateSelectionV2 } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";

const db=vi.hoisted(()=>({tx:undefined as unknown as Tx,rows:[] as Record<string,unknown>[],locate:vi.fn(async()=>[])}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,fn:(tx:Tx)=>unknown)=>fn(db.tx)}));
vi.mock("../scheduling-catalog",async original=>({...await original<object>(),schedulingTimezone:async()=>"America/Sao_Paulo",assertSchedulingAccess:async()=>undefined,
  listSchedulingServices:async(_tx:unknown,_actor:unknown,name:string)=>[{id:"service-a",name}],listSchedulingAppointments:async()=>[]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>"OWNER",locateSchedulingAppointments:db.locate}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),assertCustomerAccess:async()=>undefined,searchSalonCustomer:async(_tx:unknown,_actor:unknown,name:string)=>[{id:"customer-a",name}]}));
vi.mock("../scheduling-entity-mentions",()=>({validateSchedulingEntityMentions:async()=>undefined}));

const actor={salonId:"calendar-tenant-a",userId:"calendar-owner-a"},zone="America/Sao_Paulo",now=new Date("2027-04-12T12:00:00Z");
const date="2027-04-14",source="Reserva Hidratação Névoa para Bruno na terça, dia 14 de abril de 2027, às 13h.";
const evidence=[{field:"date" as const,text:"dia 14 de abril de 2027"},{field:"time" as const,text:"às 13h"}];
const request={operation:"appointment.change" as const,customer_name:"Bruno",service_name:"Hidratação Névoa",date,time:"13:00",temporal_evidence:evidence};
const diagnostic=():PendingCalendarConflict=>({field:"date",kind:"WEEKDAY_DATE_CONFLICT",expression:"terca, dia 14 de abril de 2027",calendar_date:date,stated_weekday:2,actual_weekday:3});
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(now);db.rows=[];db.locate.mockClear();
  const find=(where:Record<string,unknown>)=>db.rows.filter(row=>Object.entries(where).every(([key,value])=>row[key]===value));
  db.tx={$executeRaw:vi.fn(async()=>0),auditLog:{create:vi.fn(async({data}:{data:Record<string,unknown>})=>{db.rows.push(structuredClone(data));return data}),
    findMany:vi.fn(async({where}:{where:Record<string,unknown>})=>find(where)),findFirst:vi.fn(async({where}:{where:Record<string,unknown>})=>find(where)[0]??null)}} as unknown as Tx;
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN")}));
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.useRealTimers();});

describe("role-bound calendar diagnostics preserve the factual contradiction",()=>{
  it("retains the whole adjacent atom when Luna quotes only the calendar date",()=>{
    const result=groundSchedulingTemporal({},request,source,zone,now,undefined,"appointment.create",evidence);
    expect(result.fields).toMatchObject({customer_name:"Bruno",service_name:"Hidratação Névoa",time:"13:00"});
    expect(result.fields.date).toBeUndefined();expect(result.patch.date).toBeUndefined();
    expect(result.pending_calendar_conflicts).toEqual([diagnostic()]);
    expect(calendarConflictQuestion(diagnostic())).toContain("terça-feira, mas 14/04/2027 cai em quarta-feira");
    expect(calendarConflictQuestion(diagnostic())).toContain("vale terça-feira ou 14/04/2027?");
  });
  it.each(["date","source_date","end_date"] as const)("supports %s without creating a date candidate",field=>{
    const weekdays=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
    for(const calendar of ["2028-02-29","2030-12-25","2029-04-01"]){
      const actual=weekdayOfDateKey(calendar),stated=(actual+3)%7,text=`${weekdays[stated]}, ${calendar}`;
      const result=groundSchedulingTemporal({}, {[field]:calendar},text,zone,now,undefined,"schedule.block",[{field,text:calendar}]);
      expect(result.fields[field]).toBeUndefined();expect(result.pending_calendar_conflicts).toEqual([{field,kind:"WEEKDAY_DATE_CONFLICT",expression:text.normalize("NFD").replace(/[\u0300-\u036f]/g,""),calendar_date:calendar,stated_weekday:stated,actual_weekday:actual}]);
    }
  });
  it("distinguishes an incorrect model date from contradictory user facts",()=>{
    for(const text of ["quarta-feira, dia 14 de abril de 2027","quarta-feira, 14/04/2027","quarta-feira, 2027-04-14"]){
      const result=groundSchedulingTemporal({}, {date:"2027-04-15"},text,zone,now,undefined,"appointment.create",[{field:"date",text}]);
      expect(result.fields.date).toBeUndefined();expect(result.pending_calendar_conflicts).toEqual([]);
    }
  });
  it("accepts a coherent full atom, but never clips away an adjacent weekday",()=>{
    const text="quarta-feira, dia 14 de abril de 2027";
    expect(groundSchedulingTemporal({}, {date},text,zone,now,undefined,"appointment.create",[{field:"date",text}]).fields.date).toBe(date);
    expect(groundSchedulingTemporal({}, {date},source,zone,now,undefined,"appointment.create",[{field:"date",text:"dia 14 de abril de 2027"}]).fields.date).toBeUndefined();
  });
  it.each(["Não quero terça-feira, 2027-04-14", "Na terça conversamos. Reserva em 2027-04-14", "terça-feira, 2027-02-30", "terça-feira, 2027-04-14 ou 2027-04-15", "terça, 14/04", "terça, 14 de abril"])("does not manufacture a calendar choice from %s",text=>{
    const result=groundSchedulingTemporal({}, {date},text,zone,now,undefined,"appointment.create",[{field:"date",text}]);
    expect(result.pending_calendar_conflicts).toEqual([]);
  });
  it("keeps origin and destination independent even when an evidence quote targets the wrong role",()=>{
    const text="Muda de terça, dia 14 de abril de 2027 às 10h para quinta, dia 15 de abril de 2027 às 16h";
    const result=groundSchedulingTemporal({}, {source_date:date,source_time:"10:00",date:"2027-04-15",time:"16:00"},text,zone,now,undefined,"appointment.change",[
      {field:"source_date",text:"dia 14 de abril de 2027"},{field:"source_time",text:"às 10h"},{field:"date",text:"quinta, dia 15 de abril de 2027"},{field:"time",text:"às 16h"}]);
    expect(result.pending_calendar_conflicts).toEqual([{...diagnostic(),field:"source_date"}]);
    expect(result.fields).toMatchObject({date:"2027-04-15",source_time:"10:00",time:"16:00"});expect(result.fields.source_date).toBeUndefined();
    const wrongRole=groundSchedulingTemporal({}, {source_date:date,date:"2027-04-15"},text,zone,now,undefined,"appointment.change",[{field:"date",text:"dia 14 de abril de 2027"}]);
    expect(wrongRole.pending_calendar_conflicts.some(item=>item.field==="date")).toBe(false);
  });
  it("does not turn a short answer for another role into a calendar question",()=>{
    const text="terça-feira, 2027-04-14";
    const result=groundSchedulingTemporal({date:"2027-04-15"},{source_date:date},text,zone,now,"date","appointment.change",[{field:"source_date",text}]);
    expect(result.pending_calendar_conflicts).toEqual([]);
  });
  it("validates diagnostic truth and uniqueness independently of display",()=>{
    expect(()=>pendingCalendarConflicts.parse([{...diagnostic(),actual_weekday:4}])).toThrow();
    expect(()=>pendingCalendarConflicts.parse([diagnostic(),diagnostic()])).toThrow();
  });
});

describe("draft, ActionPlan, UI and clarification share one pending calendar choice",()=>{
  it.each(["a data", "fica com o número do calendário", "a referência numérica"])("binds Luna's published calendar choice for '%s' without parsing the phrase",async reply=>{
    const state=schedulingState();await applySchedulingInterpretation(actor,state,request,source);
    await applySchedulingInterpretation(actor,state,{date,temporal_evidence:[{field:"date",text:reply}]},reply);
    expect(state.fields).toMatchObject({date,customer_name:"Bruno",service_name:"Hidratação Névoa",time:"13:00"});
    expect(state.pending_calendar_conflicts).toEqual([]);expect(state.draft?.draft_revision).toBe(2);
  });
  it("binds the weekday reference only to the stated weekday and the existing date resolver",async()=>{
    const state=schedulingState();await applySchedulingInterpretation(actor,state,request,source);
    await applySchedulingInterpretation(actor,state,{weekday:2,temporal_evidence:[{field:"date",text:"o dia da semana"} ]},"o dia da semana");
    expect(state.fields.date).toBe("2027-04-13");expect(state.pending_calendar_conflicts).toEqual([]);
  });
  it.each([
    {reply:"a data",raw:{date:"2027-04-18"}},
    {reply:"o dia da semana",raw:{weekday:5}},
    {reply:"a data",raw:{date,weekday:2}},
    {reply:"a data",raw:{date,customer_name:"Outra pessoa"}},
    {reply:"a data",raw:{source_date:date}},
    {reply:"a data",raw:{date,time:"15:00"}},
    {reply:"não, a data não",raw:{date}},
    {reply:"a data, dia 15",raw:{date}},
  ])("rejects unbound or contradictory referential choice $reply / $raw",async({reply,raw})=>{
    const state=schedulingState();await applySchedulingInterpretation(actor,state,request,source);const before=structuredClone(state);
    const field="source_date" in raw?"source_date":"date";
    await applySchedulingInterpretation(actor,state,{...raw,temporal_evidence:[{field,text:reply}]},reply);
    expect(state.fields).toEqual(before.fields);expect(state.draft).toEqual(before.draft);expect(state.waiting_for).toBe("date");expect(state.proposal).toBeUndefined();
  });
  it("requires the live role, current literal, revision and scope for a reference",()=>{
    const live:TemporalAmbiguityContext={draft_ref:"current",draft_revision:1,expires_at:"2027-04-12T12:30:00Z",pending_calendar_conflicts:[diagnostic()]};
    const fields={customer_name:"Bruno",time:"13:00"},reply="a data",quote=[{field:"date" as const,text:reply}];
    for(const context of [undefined,{...live,expires_at:now.toISOString()},{...live,draft_revision:0},{...live,scope_valid:false}]){
      const result=groundSchedulingTemporal(fields,{date},reply,zone,now,"date","appointment.change",quote,context);
      expect(result.fields.date).toBeUndefined();expect(result.rejected.map(item=>item.field)).toContain("date");
    }
    for(const proof of [undefined,[{field:"date" as const,text:"data"}],[{field:"date" as const,text:"a referência anterior"}]]){
      expect(groundSchedulingTemporal(fields,{date},reply,zone,now,"date","appointment.change",proof,live).fields.date).toBeUndefined();
    }
    expect(groundSchedulingTemporal(fields,{date},reply,zone,now,"source_date","appointment.change",quote,live).fields.date).toBeUndefined();
  });
  it.each(["appointment.change","appointment.list"])("keeps %s calendar choice pending for negation, absent source or empty content",operation=>{
    const live:TemporalAmbiguityContext={draft_ref:"current",draft_revision:1,expires_at:"2027-04-12T12:30:00Z",pending_calendar_conflicts:[diagnostic()]};
    for(const reply of ["não a data","nunca a data","jamais a data","nem a data",undefined," ",".","..."]){
      const proof=reply===undefined?undefined:[{field:"date" as const,text:reply}];
      const result=groundSchedulingTemporal({customer_name:"Bruno",time:"13:00"},{date},reply,zone,now,"date",operation,proof,live);
      expect(result.fields.date,`${operation}: ${String(reply)}`).toBeUndefined();
      expect(result.fields.customer_name).toBe("Bruno");expect(result.fields.time).toBe("13:00");
      expect(result.rejected.map(item=>item.field)).toContain("date");
    }
  });
  it("a negated daypart also cannot select a published clock candidate",()=>{
    const live:TemporalAmbiguityContext={draft_ref:"current",draft_revision:1,expires_at:"2027-04-12T12:30:00Z",
      pending_temporal_ambiguities:[{field:"time",kind:"CLOCK_DAYPART",expression:"às três",candidates:["03:00","15:00"]}]};
    const result=groundSchedulingTemporal({date},{time:"15:00"},"nem à tarde",zone,now,"time","appointment.change",[{field:"time",text:"nem à tarde"}],live);
    expect(result.fields.time).toBeUndefined();expect(result.fields.date).toBe(date);
  });
  it("keeps validated fields and supplies the same specific question to UI and Luna",async()=>{
    const state=schedulingState();await applySchedulingInterpretation(actor,state,request,source);
    expect(state.fields).toEqual({customer_name:"Bruno",service_name:"Hidratação Névoa",time:"13:00"});
    expect(state.waiting_for).toBe("date");expect(state.draft?.pending_calendar_conflicts).toEqual([diagnostic()]);
    expect(state.draft?.temporal_missing).toBeUndefined();expect(state.proposal).toBeUndefined();
    let p=createActionPlan(plan([intent("appointment.change",{item_key:"move",customer_name:"Bruno",date,time:"13:00"})]));
    const view={sessionId:"calendar-child",cancelled:false,message:state.message,scheduling:state};
    p.actions[0].fields=collectedActionFields(view,p.actions[0]);p=assessPlanAction(p,"move",assessmentFromView(view,p.actions[0]));
    const units=[{keys:["move"],kind:"single" as const,child:"calendar-child"}],children=[{operation_ref:"calendar-child",state:view}];
    expect(secretaryPlanMessage(p,units,children)).toBe(state.message);
    const context=planConversationContext(p,units,children).actions[0];
    expect(context.fields.date).toBeUndefined();expect(context.pending_calendar_conflicts).toEqual([diagnostic()]);
    expect(context.clarification).toMatchObject({requested_field:"date",requested_component:"calendar_reference",previous_response:state.message});
    await applySchedulingInterpretation(actor,state,{date,temporal_evidence:[{field:"date",text:"14/04/2027"}]},"14/04/2027");
    expect(state.fields).toMatchObject({date,customer_name:"Bruno",service_name:"Hidratação Névoa",time:"13:00"});
    expect(state.pending_calendar_conflicts).toEqual([]);expect(state.draft?.pending_calendar_conflicts).toBeUndefined();expect(state.draft?.draft_revision).toBe(2);
  });
  it("a weekday correction chooses that reference through the existing temporal guard",async()=>{
    const state=schedulingState();await applySchedulingInterpretation(actor,state,request,source);
    await applySchedulingInterpretation(actor,state,{weekday:2,temporal_evidence:[{field:"date",text:"terça"}]},"terça");
    expect(state.fields).toMatchObject({date:"2027-04-13",time:"13:00",customer_name:"Bruno"});expect(state.pending_calendar_conflicts).toEqual([]);
  });
  it("invalid replies retain the question, revision and accepted fields",async()=>{
    const state=schedulingState();await applySchedulingInterpretation(actor,state,request,source);const before=structuredClone(state);
    await applySchedulingInterpretation(actor,state,{date:"2027-04-15",temporal_evidence:[{field:"date",text:"14/04/2027"}]},"14/04/2027");
    expect(state.draft).toEqual(before.draft);expect(state.fields).toEqual(before.fields);expect(state.pending_calendar_conflicts).toEqual(before.pending_calendar_conflicts);
    expect(state.waiting_for).toBe("date");expect(state.message).toContain(before.message);
  });
  it("invalidates old proposal state and prevents a proposal while the date is unresolved",async()=>{
    const fields={customer_name:"Bruno",time:"13:00",date};
    const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields});
    const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,proposal:{proposal_ref:"old"} as never};
    await applySchedulingInterpretation(actor,state,{date,temporal_evidence:[{field:"date",text:"dia 14 de abril de 2027"}]},source);
    expect(state.proposal).toBeUndefined();expect(state.fields.date).toBeUndefined();expect(state.draft?.draft_revision).toBe(2);
    await expect(proposeAppointmentCreate(db.tx,actor,{draft_ref:state.draft!.draft_ref,draft_revision:2})).rejects.toThrow("NEEDS_INPUT");
    const current=structuredClone(state);
    await expect(applySchedulingInterpretation(actor,{...state,draft},request,source)).rejects.toThrow("REVISION_CONFLICT");expect(state).toEqual(current);
  });
  it("keeps exact reason before calendar, then calendar before clock in all projections",async()=>{
    const state=schedulingState();await applySchedulingInterpretation(actor,state,{...request,operation:"appointment.cancel",reason:"cliente viajando",time:"14:00",temporal_evidence:[evidence[0],{field:"time",text:"às duas"}]},source.replace("às 13h", "às duas")+" porque ele vai viajar.");
    expect(state.waiting_for).toBe("reason");expect(state.pending_calendar_conflicts).toHaveLength(1);expect(state.pending_temporal_ambiguities).toHaveLength(1);
    expect(clarificationContext({...state,missing_fields:state.draft?.missing_fields}).clarification).not.toHaveProperty("requested_component");
    await applySchedulingInterpretation(actor,state,{reason:"porque ele vai viajar"},"porque ele vai viajar");
    expect(state.waiting_for).toBe("date");expect(state.message).toBe(calendarConflictQuestion(diagnostic()));
    await applySchedulingInterpretation(actor,state,{date,temporal_evidence:[{field:"date",text:"14/04/2027"}]},"14/04/2027");
    expect(state.waiting_for).toBe("time");expect(state.message).toContain("02h ou 14h");
  });
});

describe("batch and deferred reads retain the same unresolved role",()=>{
  const batchPlan=()=>validateBatchPlan({execution_policy:"all_or_nothing",items:[
    {key:"cancel",operation:"appointment.cancel",depends_on:[],fields:{customer_name:"Bruno",reason:"por viagem",time:"13:00"},pending_calendar_conflicts:[diagnostic()]},
    {key:"replace",operation:"appointment.create",depends_on:["cancel"],released_slot_of:"cancel",fields:{customer_name:"Vera",service_name:"Corte"}},
  ]});
  it("persists calendar missing state in an atomic batch and resolves only that item",async()=>{
    const draft=await upsertBatchDraft(db.tx,actor,{plan:batchPlan()});
    expect(draft.status).toBe("NEEDS_INPUT");expect(draft.missing_fields).toEqual(["cancel.date"]);expect(draft.message).toBe(calendarConflictQuestion(diagnostic()));
    await expect(proposeActionBatch(db.tx,actor,{draft_ref:draft.draft_ref,draft_revision:draft.draft_revision})).rejects.toThrow("NEEDS_INPUT");
    const changed=groundBatchPatch(draft.plan,"cancel",{date},"14/04/2027",zone,[{field:"date",text:"14/04/2027"}],draft);
    expect(changed.items[0].fields).toMatchObject({date,customer_name:"Bruno",reason:"por viagem",time:"13:00"});expect(changed.items[0].pending_calendar_conflicts).toBeUndefined();
    expect(changed.items[1]).toEqual(draft.plan.items[1]);expect(changed.items.map(item=>item.depends_on)).toEqual(draft.plan.items.map(item=>item.depends_on));
  });
  it("binds a batch reference only to the current item and draft graph",async()=>{
    const draft=await upsertBatchDraft(db.tx,actor,{plan:batchPlan()});
    const fixed=groundBatchPatch(draft.plan,"cancel",{date},"a data",zone,[{field:"date",text:"a data"}],draft);
    expect(fixed.items[0].fields.date).toBe(date);expect(fixed.items[0].pending_calendar_conflicts).toBeUndefined();expect(fixed.items[1]).toEqual(draft.plan.items[1]);
    const altered=structuredClone(draft.plan);altered.items[1].fields.customer_name="Outra pessoa";
    const rejected=groundBatchPatch(altered,"cancel",{date},"a data",zone,[{field:"date",text:"a data"}],draft);
    expect(rejected.items[0].fields.date).toBeUndefined();expect(rejected.items[0].pending_calendar_conflicts).toEqual([diagnostic()]);
  });
  it("creates diagnostic metadata on batch start without promoting the rejected date",async()=>{
    const selection=validateSelectionV2({...plan([
      intent("appointment.cancel",{item_key:"cancel",customer_name:"Bruno",reason:"por viagem",date,time:"13:00",temporal_evidence:evidence}),
      intent("appointment.create",{item_key:"replace",depends_on:["cancel"],released_slot_of:"cancel",customer_name:"Vera",service_name:"Corte"}),
    ]),independent:false});
    const state=await startBatch(actor,selection,source+" Cancela por viagem e coloca Vera no lugar.");
    expect(state.plan.items[0].pending_calendar_conflicts).toEqual([diagnostic()]);expect(state.plan.items[0].fields.date).toBeUndefined();expect(state.proposal).toBeUndefined();
  });
  it("uses one batch question in UI and model context while a prerequisite is pending",async()=>{
    const input=batchPlan();input.items[0].source_missing=["reason"];delete input.items[0].fields.reason;
    const draft=await upsertBatchDraft(db.tx,actor,{plan:input});
    const batch:BatchState={operation:"action.batch",plan:draft.plan,draft,message:draft.message,metrics:{},interpretation_source:"MODEL"};
    const view={sessionId:"calendar-batch",cancelled:false,message:draft.message,batch};
    let p=createActionPlan({...plan([intent("appointment.cancel",{item_key:"cancel",customer_name:"Bruno"}),intent("appointment.create",{item_key:"replace",depends_on:["cancel"],released_slot_of:"cancel",customer_name:"Vera",service_name:"Corte"})]),independent:false});
    for(const action of p.actions){action.fields=collectedActionFields(view,action);p=assessPlanAction(p,action.key,assessmentFromView(view,action));}
    const units=[{keys:["cancel","replace"],kind:"scheduling-batch" as const,child:"calendar-batch"}],children=[{operation_ref:"calendar-batch",state:view}];
    expect(secretaryPlanMessage(p,units,children)).toBe(draft.message);
    const context=planConversationContext(p,units,children).actions[0];expect(context.clarification.requested_field).toBe("reason");expect(context.clarification).not.toHaveProperty("requested_component");
    expect(context.pending_calendar_conflicts).toEqual([diagnostic()]);
  });
  it("blocks a deferred read until the date choice is validated",async()=>{
    const p=createActionPlan({...plan([intent("service.change",{item_key:"price",target_name:"Corte",priceCents:9000}),intent("appointment.list",{item_key:"read",depends_on:["price"]})]),independent:false});
    const action=p.actions.find(item=>item.key==="read")!;
    const result=await prepareDeferredReadFields(actor,action,{date,temporal_evidence:[evidence[0]]},source);
    expect(result.fields.date).toBeUndefined();expect(result.pending_calendar_conflicts).toEqual([diagnostic()]);expect(result.missing).toContain("date");
    action.fields=result.fields;action.assessment={status:"NEEDS_INPUT",missing_fields:result.missing,pending_calendar_conflicts:result.pending_calendar_conflicts};
    const fixed=await prepareDeferredReadFields(actor,action,{date,temporal_evidence:[{field:"date",text:"14/04/2027"}]},"14/04/2027","date");
    expect(fixed.fields.date).toBe(date);expect(fixed.pending_calendar_conflicts).toEqual([]);expect(fixed.missing).toEqual([]);
  });
});
