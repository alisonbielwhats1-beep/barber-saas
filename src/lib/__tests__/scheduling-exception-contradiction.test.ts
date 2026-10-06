import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { VisitDay } from "../visit-scheduling";

/** A1-GF23 (flag SALON_SECRETARY_EXCEPTION_RULES_V2): a contradictory exception decision (encaixe AND another slot) never retracts
 * a proven value. Barbearia fixture ("Pezinho" with Wanda); the real adapter, journal, review and proposal over a fake tenant
 * transaction. No model, no network, nothing confirmed. */
type TestDay=Omit<VisitDay,"appointments">&{appointments:(VisitDay["appointments"][number]&{id:string})[]};
const state=vi.hoisted(()=>({day:null as unknown as TestDay, tx:null as unknown as Tx, role:"OWNER", journal:[] as Record<string,unknown>[], cancel:vi.fn(),create:vi.fn(),lock:vi.fn()}));
vi.mock("../visit-scheduling",async original=>({...await original<object>(),loadVisitDay:async (_tx:unknown,_salon:unknown,_date:unknown,_choices:unknown,_now:unknown,projection?:{releasedAppointmentId:string})=>({...state.day,
  appointments:state.day.appointments.filter(a=>(a as {id?:string}).id!==projection?.releasedAppointmentId)})}));
vi.mock("../appointment-service",async original=>({...await original<object>(),lockAppointmentOperationalScope:state.lock}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),getCustomer:async (_tx:unknown,_actor:unknown,id:string)=>({id,name:id==="iara"?"Iara Mendes":"Otávio Reis"}),
  searchSalonCustomer:async (_tx:unknown,_actor:unknown,q:string)=>[{id:q.startsWith("Iara")?"iara":"otavio",name:q}]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>state.role,locateSchedulingAppointments:async()=>[{appointment_ref:"released",customer_name:"Iara Mendes",start_local:"2030-09-11T10:00",professional_name:"Wanda"}],
  schedulingActionSnapshot:async()=>({kind:"appointment.cancel",professional_ref:"pro",professional_name:"Wanda",timezone:"America/Sao_Paulo",startLocal:"2030-09-11T10:00",endLocal:"2030-09-11T10:30",appointment_ref:"released",revision:1,customer_ref:"iara",customer_name:"Iara Mendes",services:[],requires_acceptance:false,resource_ids:[],waiting_count:0,waiting_hash:"empty",affected:[]}),
  executeSchedulingMutation:state.cancel}));
vi.mock("../scheduling-actions",async original=>({...await original<object>(),executeSchedulingCreate:state.create}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,run:(tx:Tx)=>unknown)=>run(state.tx)}));
import { applySchedulingInterpretation, schedulingState } from "../secretary-scheduling";
import { groundBatchPatch } from "../secretary-batch";
import { patchBatch, validateBatchPlan, upsertBatchDraft } from "../scheduling-batch";
import { proposeAppointmentCreate } from "../scheduling-actions";
import { literalOverrideConsent, reconcileExceptionDecision, type SchedulingReview } from "../scheduling-conflict-contract";

const actor={salonId:"salon-pezinho",userId:"owner-pezinho"}, date="2030-09-11";
const instant=(time:string)=>new Date(`${date}T${time}:00-03:00`);
const overlaps=(a:{startAt:Date;endAt:Date},where:{startAt:{lt:Date};endAt:{gt:Date}})=>a.startAt<where.startAt.lt&&a.endAt>where.endAt.gt;
function setup(){
  const service={id:"pezinho",name:"Pezinho",durationMin:45,priceCents:3000,priceType:"FIXED",priceNote:null,physicalResourceId:null as string|null,professionals:[{professional:{id:"pro",user:{name:"Wanda"}}}]};
  state.day={salon:{timezone:"America/Sao_Paulo",minBookingLeadMinutes:0,maxBookingLeadDays:365,bufferMinutes:0},services:[service],priced:[service],hours:new Map([["pro",[{startMinutes:540,endMinutes:1080}]]]),closures:[],blocks:[],
    appointments:[{id:"released",professionalId:"pro",startAt:instant("10:00"),endAt:instant("10:30")},{id:"next",professionalId:"pro",startAt:instant("10:30"),endAt:instant("11:00")}],resourceBookings:[],offers:[],preferences:{slotMode:"FIT",returnDays:30,serviceReturnDays:{},addons:{},simultaneousPairs:[]},date,now:instant("08:00")};
  const findAudit=({where}:{where:Record<string,unknown>})=>state.journal.filter(row=>Object.entries(where).every(([k,v])=>row[k]===v));
  const raw={
    $queryRaw:vi.fn().mockImplementation(async (q:readonly string[])=>q.join("").includes('"Membership"')?[{role:state.role}]:[{revision:"1",accessStatus:"APPROVED"}]),$executeRaw:vi.fn().mockResolvedValue(1),
    salon:{findUnique:vi.fn(async()=>state.day.salon),findUniqueOrThrow:vi.fn(async()=>state.day.salon)},membership:{findFirstOrThrow:vi.fn(async()=>({role:state.role}))},
    service:{findMany:vi.fn(async()=>state.day.services),findFirstOrThrow:vi.fn(async()=>service)},
    servicePricingRule:{findFirst:vi.fn().mockResolvedValue(null)},professionalService:{findMany:vi.fn().mockResolvedValue([{serviceId:"pezinho"}])},
    professional:{findFirst:vi.fn().mockResolvedValue({id:"pro"}),findMany:vi.fn().mockResolvedValue([{id:"pro",user:{name:"Wanda"}}])},
    workingHours:{findMany:vi.fn(async()=>state.day.hours.get("pro"))},professionalOpening:{findMany:vi.fn().mockResolvedValue([])},
    physicalResource:{findFirst:vi.fn().mockResolvedValue({id:"room"})},
    salonClosure:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.closures.find(x=>overlaps(x,where))??null)},
    timeOff:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.blocks.find(x=>overlaps(x,where))??null)},
    appointment:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]&{id?:{not:string}}})=>state.day.appointments.find(a=>(a as {id?:string}).id!==where.id?.not&&overlaps(a,where))??null),findMany:vi.fn(async()=>[])},
    resourceBooking:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.resourceBookings.find(x=>overlaps(x,where))??null)},
    waitlistOffer:{findFirst:vi.fn(async({where}:{where:{OR:Parameters<typeof overlaps>[1][]}})=>state.day.offers.find(x=>where.OR.some(w=>overlaps(x,w)))??null)},
    auditLog:{create:vi.fn(async({data}:{data:Record<string,unknown>})=>{state.journal.push(structuredClone(data));return data;}),findMany:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)),findFirst:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)[0]??null)},
  };
  state.tx=raw as unknown as Tx;return {raw,tx:state.tx,service};
}
const slot={service_ref:"pezinho",professional_ref:"pro",date,time:"10:00"};
const contradiction={operation:"appointment.create" as const,override_requested:true,destination_mode:"ALTERNATIVE_SLOT" as const};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(instant("08:00"));vi.clearAllMocks();state.role="OWNER";state.journal=[];vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","true");
  vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2","true");vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");}));});
afterEach(()=>{vi.useRealTimers();expect(fetch).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();expect(state.cancel).not.toHaveBeenCalled();vi.unstubAllEnvs();vi.unstubAllGlobals();});

/** The salon is closed all day and Wanda has no hours: a HARD_BLOCK review at the proven 10:00. */
async function hardBlock(fields:Record<string,unknown>={customer_ref:"iara"}){
  setup();state.day.hours.set("pro",[]);state.day.closures.push({startAt:instant("00:00"),endAt:new Date("2030-09-12T00:00:00-03:00")});
  const c=schedulingState();c.fields={...slot,...fields};await applySchedulingInterpretation(actor,c,{operation:"appointment.create"});
  expect(c.draft?.review?.status).toBe("CONFLICT_HARD_BLOCK");return c;
}
/** The slot is taken by another client (10:00–10:30 and 10:30–11:00): an OVERRIDABLE review waiting for the encaixe decision. */
async function overridable(){
  setup();const c=schedulingState();c.fields={...slot,customer_name:"Iara Mendes",customer_ref:"iara",service_name:"Pezinho",professional_name:"Wanda"};
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create"});
  expect(c.waiting_for).toBe("override_requested");expect(c.draft?.review?.status).toBe("CONFLICT_OVERRIDABLE");return c;
}
const proposeFails=async(c:ReturnType<typeof schedulingState>)=>expect(proposeAppointmentCreate(state.tx,actor,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision})).rejects.toThrow();

describe("A1-GF23: the recorded turn-2 patch on a HARD_BLOCK keeps the proven slot and explains that encaixe is impossible",()=>{
 it.each(["Pode encaixar mesmo assim.","pode encaixar mesmo assim"])("insistence %j with 'another slot' beside it: date/time kept, review kept, nothing confirmable",async message=>{
  const c=await hardBlock(),initial=structuredClone(c.fields);
  const codes=await applySchedulingInterpretation(actor,c,contradiction,message);
  expect(codes).toContain("EXCEPTION_DECISION_CONTRADICTION");
  expect(c.fields).toEqual({...initial,override_requested:true});expect(c.draft?.fields).toEqual({...initial,override_requested:true});
  expect(c.draft?.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false});
  expect(c.draft?.review?.causes).toEqual(expect.arrayContaining(["OUTSIDE_WORKING_HOURS","SALON_CLOSED"]));
  expect(c.message).toMatch(/^Não posso fazer encaixe nesse horário\. O salão está fechado nesse horário\./);
  expect(c.proposal).toBeUndefined();await proposeFails(c);
 });
 it("flag off: today's behaviour (the ungrounded 'another slot' retracts the time; no contradiction code)",async()=>{
  vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2","false");
  const c=await hardBlock();
  const codes=await applySchedulingInterpretation(actor,c,contradiction,"Pode encaixar mesmo assim.");
  expect(codes).not.toContain("EXCEPTION_DECISION_CONTRADICTION");expect(c.fields.time).toBeUndefined();expect(c.fields.destination_mode).toBe("ALTERNATIVE_SLOT");expect(c.proposal).toBeUndefined();
 });
 it("two contradictory turns in a row: the same state and the same answer, never a proposal",async()=>{
  const c=await hardBlock();
  await applySchedulingInterpretation(actor,c,contradiction,"Pode encaixar mesmo assim.");
  const first={fields:structuredClone(c.fields),message:c.message,revision:c.draft!.draft_revision};
  await applySchedulingInterpretation(actor,c,contradiction,"Pode encaixar mesmo assim.");
  expect(c.fields).toEqual(first.fields);expect(c.message).toBe(first.message);expect(c.draft!.draft_revision).toBe(first.revision+1);expect(c.proposal).toBeUndefined();
 });
 it("RECEPTIONIST (encaixe not permitted) in a taken slot: HARD_BLOCK kept, explained, nothing proposed",async()=>{
  state.role="RECEPTIONIST";setup();const c=schedulingState();c.fields={...slot,customer_ref:"iara"};await applySchedulingInterpretation(actor,c,{operation:"appointment.create"});
  expect(c.draft?.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false});
  await applySchedulingInterpretation(actor,c,contradiction,"Pode encaixar mesmo assim.");
  expect(c.fields).toMatchObject({time:"10:00",date,override_requested:true});expect(c.fields.destination_mode).toBeUndefined();
  expect(c.message).toMatch(/^Não posso fazer encaixe nesse horário\./);expect(c.proposal).toBeUndefined();await proposeFails(c);
 });
 it("PAST_START: HARD_BLOCK kept ('Esse horário já passou'), nothing proposed",async()=>{
  setup();const c=schedulingState();c.fields={...slot,time:"07:30",customer_ref:"iara"};await applySchedulingInterpretation(actor,c,{operation:"appointment.create"});
  expect(c.draft?.review?.causes).toContain("PAST_START");
  await applySchedulingInterpretation(actor,c,contradiction,"Pode encaixar mesmo assim.");
  expect(c.fields.time).toBe("07:30");expect(c.message).toMatch(/^Não posso fazer encaixe nesse horário\. Esse horário já passou\./);expect(c.proposal).toBeUndefined();
 });
});
describe("A1-GF23 in an OVERRIDABLE conflict: a literal consent keeps its meaning, the reason is still asked",()=>{
 it("literal consent beside 'another slot': override kept, destination dropped, the reason asked, no proposal",async()=>{
  const c=await overridable(),before=structuredClone(c.fields);
  const codes=await applySchedulingInterpretation(actor,c,contradiction,"Pode encaixar mesmo assim.");
  expect(codes).toContain("EXCEPTION_DECISION_CONTRADICTION");
  expect(c.fields).toEqual({...before,override_requested:true});expect(c.waiting_for).toBe("override_reason");expect(c.draft?.missing_fields).toEqual(["override_reason"]);
  expect(c.message).toMatch(/motivo do encaixe/);expect(c.proposal).toBeUndefined();
 });
 it("a literal reason inside a contradiction is never persisted as an overbook",async()=>{
  const c=await overridable();
  await applySchedulingInterpretation(actor,c,{...contradiction,override_reason:"ela é cliente antiga"},"Pode encaixar mesmo assim, ela é cliente antiga.");
  expect(c.fields.override_reason).toBeUndefined();expect(c.fields.override_reason_source).toBeUndefined();
  expect(c.waiting_for).toBe("override_reason");expect(c.proposal).toBeUndefined();
 });
 it("a negated insistence ('Não encaixa não, outro horário') is refused by the guard first: nothing changes",async()=>{
  const c=await overridable(),before=structuredClone(c.fields),revision=c.draft!.draft_revision;
  await expect(applySchedulingInterpretation(actor,c,contradiction,"Não encaixa não, outro horário.")).rejects.toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
  expect(c.fields).toEqual(before);expect(c.draft!.draft_revision).toBe(revision);expect(c.proposal).toBeUndefined();
 });
 it("a merely contextual consent never reaches the rule: the contradictory patch is refused (fail-safe)",async()=>{
  const c=await overridable(),before=structuredClone(c.fields);
  await expect(applySchedulingInterpretation(actor,c,contradiction,"Mantenha, por favor.")).rejects.toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
  expect(c.fields).toEqual(before);
 });
 it("a contradiction that also proves a new time ('às 11h'): 11:00 applied, both exception fields cleared, reviewed afresh",async()=>{
  const c=await overridable();
  await applySchedulingInterpretation(actor,c,{...contradiction,time:"11:00"},"Pode encaixar às 11h.");
  expect(c.fields).toMatchObject({date,time:"11:00",customer_ref:"iara"});
  for(const key of ["override_requested","override_reason","destination_mode"] as const)expect(c.fields[key]).toBeUndefined();
  expect(c.draft?.review?.status).toBe("AVAILABLE");expect(c.proposal?.snapshot?.overbook).toBeUndefined();expect(c.proposal).toBeDefined();
 });
 it("a contradiction that changes the customer never inherits consent: the binary question is asked for the new person",async()=>{
  const c=await overridable();
  await applySchedulingInterpretation(actor,c,{...contradiction,customer_name:"Otávio Reis"},"Pode encaixar o Otávio Reis mesmo assim.");
  expect(c.fields).toMatchObject({customer_ref:"otavio",time:"10:00"});expect(c.fields.override_requested).toBeUndefined();expect(c.fields.destination_mode).toBeUndefined();
  expect(c.waiting_for).toBe("override_requested");expect(c.proposal).toBeUndefined();
 });
 it("'another slot' stored in an EARLIER turn is cleared by a later insistence (adapter and journal); the time is kept",async()=>{
  const c=await overridable();
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",destination_mode:"ALTERNATIVE_SLOT",time:"10:15"},"Às 10h15.");
  expect(c.fields).toMatchObject({time:"10:15",destination_mode:"ALTERNATIVE_SLOT"});expect(c.fields.override_requested).not.toBe(true);
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:true},"Pode encaixar mesmo assim.");
  expect(c.fields).toMatchObject({time:"10:15",override_requested:true});expect(c.fields.destination_mode).toBeUndefined();expect(c.draft?.fields.destination_mode).toBeUndefined();
  expect(c.waiting_for).toBe("override_reason");expect(c.proposal).toBeUndefined();
 });
 it("flag off: the stored 'another slot' stays beside the consent (historical journal)",async()=>{
  vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2","false");
  const c=await overridable();
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",destination_mode:"ALTERNATIVE_SLOT",time:"10:15"},"Às 10h15.");
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:true},"Pode encaixar mesmo assim.");
  expect(c.draft?.fields).toMatchObject({time:"10:15",override_requested:true,destination_mode:"ALTERNATIVE_SLOT"});
 });
 it("a plain 'another slot' (no contradiction) keeps today's retraction of the time",async()=>{
  const c=await overridable();
  const codes=await applySchedulingInterpretation(actor,c,{operation:"appointment.create",destination_mode:"ALTERNATIVE_SLOT"},"Prefiro outro horário.");
  expect(codes).not.toContain("EXCEPTION_DECISION_CONTRADICTION");expect(c.fields.time).toBeUndefined();expect(c.fields.override_requested).toBe(false);expect(c.proposal).toBeUndefined();
 });
});
describe("A1-GF23 patchBatch parity (released-slot create, all_or_nothing)",()=>{
 const batch=()=>validateBatchPlan({execution_policy:"all_or_nothing",items:[
  {key:"a",operation:"appointment.cancel",depends_on:[],fields:{customer_name:"Iara Mendes",reason:"Cliente viajou",date,time:"10:00"}},
  {key:"b",operation:"appointment.create",depends_on:["a"],released_slot_of:"a",fields:{customer_name:"Otávio Reis",service_name:"Pezinho"}},
 ]});
 it("with the item's live OVERRIDABLE review, a literal consent beside 'another slot' keeps the released slot and asks the reason",async()=>{
  const {tx}=setup();let d=await upsertBatchDraft(tx,actor,{plan:batch()});
  expect(d.missing_fields).toEqual(["b.override_requested"]);
  const next=groundBatchPatch(d.plan,"b",{override_requested:true,destination_mode:"ALTERNATIVE_SLOT"},"Pode encaixar mesmo assim.","America/Sao_Paulo",undefined,d);
  expect(next.items[0]).toEqual(d.plan.items[0]);expect(next.items[1]).toMatchObject({depends_on:["a"],released_slot_of:"a",fields:{override_requested:true}});
  expect(next.items[1].fields.destination_mode).toBeUndefined();
  d=await upsertBatchDraft(tx,actor,{plan:next,draft_ref:d.draft_ref,expected_revision:d.draft_revision});
  expect(d.missing_fields).toEqual(["b.override_reason"]);expect(d.status).toBe("NEEDS_INPUT");expect(d.plan.items).toHaveLength(2);
 });
 it("without a live review both decisions go (the binary question is asked again); the cancel never runs alone",async()=>{
  const {tx}=setup();const d=await upsertBatchDraft(tx,actor,{plan:batch()});
  const next=patchBatch(d.plan,"b",{override_requested:true,destination_mode:"ALTERNATIVE_SLOT"});
  expect(next.items[1].fields.override_requested).toBeUndefined();expect(next.items[1].fields.destination_mode).toBeUndefined();expect(next.items[0]).toEqual(d.plan.items[0]);
  const again=await upsertBatchDraft(tx,actor,{plan:next,draft_ref:d.draft_ref,expected_revision:d.draft_revision});
  expect(again.missing_fields).toEqual(["b.override_requested"]);
 });
 it("flag off: patchBatch keeps today's 'another slot' (override false, the released time is not kept)",()=>{
  vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2","false");setup();
  const next=patchBatch(batch(),"b",{override_requested:true,destination_mode:"ALTERNATIVE_SLOT"});
  expect(next.items[1].fields).toMatchObject({destination_mode:"ALTERNATIVE_SLOT",override_requested:false});
 });
});
describe("reconcileExceptionDecision (pure rule, codes only)",()=>{
 const review=(status:SchedulingReview["status"]):SchedulingReview=>({status,startLocal:`${date}T10:00`,endLocal:`${date}T10:45`,durationMin:45,causes:[],conflicts:[],override_allowed:status==="CONFLICT_OVERRIDABLE",missing_fields:[],message:"",alternatives:[]});
 const run=(patch:Record<string,unknown>,decision:{review?:SchedulingReview;literal:boolean},previous:Record<string,unknown>={time:"10:00",date})=>{const p={...patch};return {codes:reconcileExceptionDecision(p,previous,decision),p};};
 const both={override_requested:true,destination_mode:"ALTERNATIVE_SLOT",override_reason:"motivo dito",override_reason_source:{}};
 it.each([
  ["HARD_BLOCK keeps the consent (it only selects the explanation)",review("CONFLICT_HARD_BLOCK"),false,true],
  ["OVERRIDABLE with a literal consent keeps it",review("CONFLICT_OVERRIDABLE"),true,true],
  ["OVERRIDABLE with a contextual-only consent drops both",review("CONFLICT_OVERRIDABLE"),false,false],
  ["no live review (stale or expired draft) drops both",undefined,true,false],
  ["an AVAILABLE review drops both",review("AVAILABLE"),true,false],
 ] as const)("%s",(_label,live,literal,kept)=>{
  const {codes,p}=run(both,{review:live,literal});
  expect(codes).toEqual(["EXCEPTION_DECISION_CONTRADICTION"]);
  expect(p.destination_mode).toBeUndefined();expect(p.override_reason).toBeUndefined();expect(p.override_reason_source).toBeUndefined();
  expect(p.override_requested).toBe(kept?true:undefined);
 });
 it("a turn that also moves the slot or changes who/what drops both, whatever the review",()=>{
  for(const change of [{time:"11:00"},{date:"2030-09-12"},{customer_name:"Outra Pessoa"},{service_name:"Barba"},{professional_name:"Outro"}])
   expect(run({...both,...change},{review:review("CONFLICT_HARD_BLOCK"),literal:true}).p.override_requested).toBeUndefined();
 });
 it("no contradiction: untouched, no code",()=>{
  for(const patch of [{destination_mode:"ALTERNATIVE_SLOT"},{override_requested:true},{override_requested:true,destination_mode:"SAME_RELEASED_SLOT"},{override_requested:false,destination_mode:"ALTERNATIVE_SLOT"}]){
   const {codes,p}=run(patch,{review:review("CONFLICT_HARD_BLOCK"),literal:true});expect(codes).toEqual([]);expect(p).toEqual(patch);
  }
 });
 it("literalOverrideConsent reads the historical guard and never a negation",()=>{
  expect(literalOverrideConsent("Pode encaixar mesmo assim.")).toBe(true);expect(literalOverrideConsent("pode encaixar")).toBe(true);
  expect(literalOverrideConsent("Não pode encaixar")).toBe(false);expect(literalOverrideConsent("Mantenha, por favor.")).toBe(false);expect(literalOverrideConsent(undefined)).toBe(false);
 });
});
