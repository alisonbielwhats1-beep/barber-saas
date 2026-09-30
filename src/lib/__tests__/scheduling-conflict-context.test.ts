import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { VisitDay } from "../visit-scheduling";
type TestDay=Omit<VisitDay,"appointments">&{appointments:(VisitDay["appointments"][number]&{id:string})[]};
const state=vi.hoisted(()=>({day:null as unknown as TestDay, tx:null as unknown as Tx, role:"OWNER", journal:[] as Record<string,unknown>[], cancel:vi.fn(),create:vi.fn(),lock:vi.fn()}));
vi.mock("../visit-scheduling",async original=>({...await original<object>(),loadVisitDay:async (_tx:unknown,_salon:unknown,_date:unknown,_choices:unknown,_now:unknown,projection?:{releasedAppointmentId:string})=>({...state.day,
  appointments:state.day.appointments.filter(a=>(a as {id?:string}).id!==projection?.releasedAppointmentId)})}));
vi.mock("../appointment-service",async original=>({...await original<object>(),lockAppointmentOperationalScope:state.lock}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),getCustomer:async (_tx:unknown,_actor:unknown,id:string)=>({id,name:id==="amanda"?"Amanda Souza":"Fábio Santos"}),searchSalonCustomer:async (_tx:unknown,_actor:unknown,q:string)=>[{id:q.startsWith("Amanda")?"amanda":"fabio",name:q}]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>state.role,locateSchedulingAppointments:async()=>[{appointment_ref:"released",customer_name:"Amanda Souza",start_local:"2030-09-11T10:00",professional_name:"Tatiana"}],
  schedulingActionSnapshot:async()=>({kind:"appointment.cancel",professional_ref:"pro",professional_name:"Tatiana",timezone:"America/Sao_Paulo",startLocal:"2030-09-11T10:00",endLocal:"2030-09-11T10:30",appointment_ref:"released",revision:1,customer_ref:"amanda",customer_name:"Amanda Souza",services:[],requires_acceptance:false,resource_ids:[],waiting_count:0,waiting_hash:"empty",affected:[]}),
  executeSchedulingMutation:state.cancel}));
vi.mock("../scheduling-actions",async original=>({...await original<object>(),executeSchedulingCreate:state.create}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,run:(tx:Tx)=>unknown)=>run(state.tx)}));
import { applySchedulingInterpretation, schedulingState } from "../secretary-scheduling";
import { groundBatchPatch } from "../secretary-batch";
import { groundSchedulingReasons } from "../scheduling-literal-source";
import type { SchedulingOverrideDecisionContext } from "../scheduling-conflict-contract";
import { getSchedulingAvailability } from "../scheduling-catalog";
import { patchBatch, validateBatchPlan, upsertBatchDraft } from "../scheduling-batch";
import { proposeAppointmentCreate } from "../scheduling-actions";
import { groundSchedulingException } from "../scheduling-conflict-contract";





const actor={salonId:"salon",userId:"owner"}, date="2030-09-11";
const instant=(time:string)=>new Date(`${date}T${time}:00-03:00`);
const overlaps=(a:{startAt:Date;endAt:Date},where:{startAt:{lt:Date};endAt:{gt:Date}})=>a.startAt<where.startAt.lt&&a.endAt>where.endAt.gt;
function setup(){
  const service={id:"cut",name:"Corte Completo",durationMin:45,priceCents:5000,priceType:"FIXED",priceNote:null,physicalResourceId:null as string|null,professionals:[{professional:{id:"pro",user:{name:"Tatiana"}}}]};
  state.day={salon:{timezone:"America/Sao_Paulo",minBookingLeadMinutes:0,maxBookingLeadDays:365,bufferMinutes:0},services:[service],priced:[service],hours:new Map([["pro",[{startMinutes:540,endMinutes:1080}]]]),closures:[],blocks:[],
    appointments:[{id:"released",professionalId:"pro",startAt:instant("10:00"),endAt:instant("10:30")},{id:"next",professionalId:"pro",startAt:instant("10:30"),endAt:instant("11:00")}],resourceBookings:[],offers:[],preferences:{slotMode:"FIT",returnDays:30,serviceReturnDays:{},addons:{},simultaneousPairs:[]},date,now:instant("08:00")};
  const findAudit=({where}:{where:Record<string,unknown>})=>state.journal.filter(row=>Object.entries(where).every(([k,v])=>row[k]===v));
  const raw={
    $queryRaw:vi.fn().mockImplementation(async (q:readonly string[])=>q.join("").includes('"Membership"')?[{role:state.role}]:[{revision:"1",accessStatus:"APPROVED"}]),$executeRaw:vi.fn().mockResolvedValue(1),
    salon:{findUnique:vi.fn(async()=>state.day.salon),findUniqueOrThrow:vi.fn(async()=>state.day.salon)},membership:{findFirstOrThrow:vi.fn(async()=>({role:state.role}))},
    service:{findMany:vi.fn(async()=>state.day.services),findFirstOrThrow:vi.fn(async()=>service)},
    servicePricingRule:{findFirst:vi.fn().mockResolvedValue(null)},professionalService:{findMany:vi.fn().mockResolvedValue([{serviceId:"cut"}])},
    professional:{findFirst:vi.fn().mockResolvedValue({id:"pro"}),findMany:vi.fn().mockResolvedValue([{id:"pro",user:{name:"Tatiana"}}])},
    workingHours:{findMany:vi.fn(async()=>state.day.hours.get("pro"))},professionalOpening:{findMany:vi.fn().mockResolvedValue([])},
    physicalResource:{findFirst:vi.fn().mockResolvedValue({id:"room"})},
    salonClosure:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.closures.find(x=>overlaps(x,where))??null)},
    timeOff:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.blocks.find(x=>overlaps(x,where))??null)},
    appointment:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]&{id?:{not:string}}})=>state.day.appointments.find(a=>(a as {id?:string}).id!==where.id?.not&&overlaps(a,where))??null),
      // C7: the NEW booking preview reads the customer's upcoming appointments; this fixture's customer has none of its own.
      findMany:vi.fn(async()=>[])},
    resourceBooking:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.resourceBookings.find(x=>overlaps(x,where))??null)},
    waitlistOffer:{findFirst:vi.fn(async({where}:{where:{OR:Parameters<typeof overlaps>[1][]}})=>state.day.offers.find(x=>where.OR.some(w=>overlaps(x,w)))??null)},
    auditLog:{create:vi.fn(async({data}:{data:Record<string,unknown>})=>{state.journal.push(structuredClone(data));return data;}),findMany:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)),findFirst:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)[0]??null)},
  };
  state.tx=raw as unknown as Tx;return {raw,tx:state.tx,service};
}
const batch=()=>validateBatchPlan({execution_policy:"all_or_nothing",items:[
  {key:"a",operation:"appointment.cancel",depends_on:[],fields:{customer_name:"Amanda Souza",reason:"Cliente desistiu",date,time:"10:00"}},
  {key:"b",operation:"appointment.create",depends_on:["a"],released_slot_of:"a",fields:{customer_name:"Fábio Santos",service_name:"Corte Completo"}},
]});
const slot={service_ref:"cut",professional_ref:"pro",date,time:"10:00"};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(instant("08:00"));vi.clearAllMocks();state.role="OWNER";state.journal=[];vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","true");vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");}));});
afterEach(()=>{vi.useRealTimers();expect(fetch).not.toHaveBeenCalled();vi.unstubAllEnvs();vi.unstubAllGlobals();});


async function pending(){
  setup();const c=schedulingState();c.fields={...slot,customer_name:"Fábio Santos",customer_ref:"fabio",service_name:"Corte Completo",professional_name:"Tatiana"};
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create"});
  expect(c.waiting_for).toBe("override_requested");expect(c.draft?.review?.override_allowed).toBe(true);expect(c.proposal).toBeUndefined();return c;
}
function context(c:Awaited<ReturnType<typeof pending>>):SchedulingOverrideDecisionContext{return {operation:c.operation!,waiting_for:c.waiting_for,fields:c.draft!.fields,review:c.draft!.review,expires_at:c.draft!.expires_at};}
describe("semantic overlap decisions are scoped to the factual pending draft",()=>{
 it.each(["Quero manter esse horário como encaixe.","Pode seguir com o horário que pedi.","Sim, quero manter.","É isso, mantenha a reserva sobreposta.","Autorizado, pode continuar."])("accepts typed consent to the actual question: %s",async message=>{
  const c=await pending(),first=structuredClone(c.draft!),before=structuredClone(c.fields);
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:true},message);
  expect(c.fields).toEqual({...before,override_requested:true});expect(c.draft?.draft_ref).toBe(first.draft_ref);expect(c.draft!.draft_revision).toBe(first.draft_revision+1);
  expect(c.waiting_for).toBe("override_reason");expect(c.draft?.missing_fields).toEqual(["override_reason"]);expect(c.proposal).toBeUndefined();
  const cause="a cliente concordou em esperar";
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_reason:cause},"Porque "+cause+".");
  expect(c.draft?.missing_fields).toEqual([]);expect(c.proposal?.snapshot?.overbook?.reason).toBe(cause);expect(c.proposal?.preview).toContain("ENCAIXE");
  expect(state.create).not.toHaveBeenCalled();expect(state.cancel).not.toHaveBeenCalled();
 });
 it.each(["", "  ","Não, quero outro horário."])("does not accept an empty or negated source: %j",async message=>{
  const c=await pending(),before=structuredClone(c.fields);
  await expect(applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:true},message)).rejects.toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
  expect(c.fields).toEqual(before);expect(c.proposal).toBeUndefined();
 });
 it.each([{time:"13:00"},{date:"2030-09-12"},{customer_name:"Outra Cliente"},{service_name:"Outro serviço"},{professional_name:"Outra pessoa"},{destination_mode:"ALTERNATIVE_SLOT"},{customer_ref:"different"}])("cannot reuse the pending decision for changed fields %j",async patch=>{
  const c=await pending();expect(()=>groundSchedulingException({...patch,override_requested:true},c.fields,"Sim, mantenha.",context(c))).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
 });
 it.each(["hard","permission","expired","fields","question","operation"])("refuses a contextual bypass with invalid backend %s",async failure=>{
  const c=await pending(),ctx=structuredClone(context(c));
  if(failure==="hard")ctx.review!.status="CONFLICT_HARD_BLOCK";
  if(failure==="permission")ctx.review!.override_allowed=false;
  if(failure==="expired")ctx.expires_at=instant("07:59").toISOString();
  if(failure==="fields")ctx.fields.time="11:00";
  if(failure==="question")ctx.waiting_for="override_reason";
  if(failure==="operation")ctx.operation="appointment.change";
  expect(()=>groundSchedulingException({override_requested:true},c.fields,"Mantenha, por favor.",ctx)).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
 });
 it("preserves false and still rejects an invented causal reason",async()=>{
  const c=await pending();await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:false},"Prefiro não fazer encaixe.");
  expect(c.fields.override_requested).toBe(false);expect(c.proposal).toBeUndefined();
  const patch={override_requested:true,override_reason:"A pessoa aprovou tudo"};
  const another=await pending();const result=groundSchedulingReasons(patch,another.fields,"Mantenha o horário.",context(another));
  expect(result.rejected).toEqual([{code:"SOURCE_REASON_CONFLICT",field:"override_reason",value:"A pessoa aprovou tudo"}]);expect(patch).not.toHaveProperty("override_reason");
 });
 it("retains the conservative historical rule without a pending question",()=>{
  expect(()=>groundSchedulingException({override_requested:true},{},"Sim.")).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
 });
 it("binds a batch reply to the exact reviewed graph and preserves dependencies",async()=>{
  const {tx}=setup();const d=await upsertBatchDraft(tx,actor,{plan:batch()});
  const next=groundBatchPatch(d.plan,"b",{override_requested:true},"Sim, mantenha o horário.","America/Sao_Paulo",undefined,d);
  expect(next.items[0]).toEqual(d.plan.items[0]);expect(next.items[1]).toMatchObject({depends_on:["a"],released_slot_of:"a",fields:{override_requested:true}});
  const reason=await upsertBatchDraft(tx,actor,{plan:next,draft_ref:d.draft_ref,expected_revision:d.draft_revision});expect(reason.missing_fields).toEqual(["b.override_reason"]);
  const changed=structuredClone(d.plan);changed.items[0].fields.appointment_ref="different-source";
  expect(()=>groundBatchPatch(changed,"b",{override_requested:true},"Sim, mantenha.","America/Sao_Paulo",undefined,d)).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
  expect(()=>groundBatchPatch(d.plan,"b",{override_requested:true},"Sim, mantenha.","America/Sao_Paulo")).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
 });
});
describe("a declined overlap is a completed decision about that destination",()=>{
 it("preserves a same-slot refusal without reasking and prepares a genuinely free alternative",async()=>{
  const c=await pending(),before=structuredClone(c.fields);
  for(let turn=0;turn<2;turn++){
   await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:false},"Prefiro outro horário.");
   expect(c.fields).toEqual({...before,override_requested:false});expect(c.waiting_for).toBe("destination_mode");expect(c.message).not.toMatch(/Quer fazer|motivo/i);expect(c.message).toContain("Qual horário");expect(c.proposal).toBeUndefined();
  }
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",time:"11:00"},"Às 11h.");
  expect(c.fields).toMatchObject({date,time:"11:00",customer_ref:"fabio",service_ref:"cut",professional_ref:"pro"});expect(c.draft?.review?.status).toBe("AVAILABLE");expect(c.proposal?.snapshot?.overbook).toBeUndefined();expect(c.proposal).toBeDefined();
 });
 it("reopens consent on a new conflicting slot, preserving the original date and entity",async()=>{
  const c=await pending();await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:false},"Prefiro outro horário.");
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",time:"10:15"},"Às 10h15.");
  expect(c.fields).toMatchObject({date,time:"10:15",customer_ref:"fabio"});expect(c.fields.override_requested).toBeUndefined();expect(c.waiting_for).toBe("override_requested");expect(c.proposal).toBeUndefined();
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:true},"Pode manter este.");expect(c.waiting_for).toBe("override_reason");expect(c.proposal).toBeUndefined();
 });
 it.each(["permission","closure"])("revalidates fresh %s after contextual consent",async change=>{
  const c=await pending();if(change==="permission")state.role="RECEPTIONIST";else state.day.closures.push({startAt:instant("10:00"),endAt:instant("12:00")});
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:true},"Sim, mantenha o horário.");
  expect(c.draft?.review?.status).toBe("CONFLICT_HARD_BLOCK");expect(c.draft?.review?.override_allowed).toBe(false);expect(c.proposal).toBeUndefined();expect(state.create).not.toHaveBeenCalled();
 });
 it.each(["11:00","10:15"])("batch declined -> new slot %s has a fresh factual decision without losing graph",async time=>{
  const {tx}=setup();let d=await upsertBatchDraft(tx,actor,{plan:batch()});
  d=await upsertBatchDraft(tx,actor,{plan:groundBatchPatch(d.plan,"b",{override_requested:false},"Prefiro outro horário.","America/Sao_Paulo",undefined,d),draft_ref:d.draft_ref,expected_revision:d.draft_revision});
  expect(d.missing_fields).toEqual(["b.destination_mode"]);expect(d.message).not.toMatch(/Quer fazer|motivo/i);expect(d.plan.items[1].fields.override_requested).toBe(false);
  const original=structuredClone(d.plan.items[0]);
  d=await upsertBatchDraft(tx,actor,{plan:patchBatch(d.plan,"b",{destination_mode:"ALTERNATIVE_SLOT",time}),draft_ref:d.draft_ref,expected_revision:d.draft_revision});
  expect(d.plan.items[0]).toEqual(original);expect(d.plan.items[1].depends_on).toEqual(["a"]);
  if(time==="11:00"){expect(d.status).toBe("READY");expect(d.plan.items[1].fields.override_requested).toBe(false);expect(d.snapshot?.create.overbook).toBeUndefined();}
  else {expect(d.missing_fields).toEqual(["b.override_requested"]);expect(d.plan.items[1].fields.override_requested).toBeUndefined();expect(d.status).toBe("NEEDS_INPUT");}
 });
 it("a prior positive consent cannot authorize a changed customer by repetition alone",()=>{
  expect(()=>groundSchedulingException({customer_name:"Outra pessoa",override_requested:true},{customer_name:"Original",override_requested:true},"Sim, mantenha.")).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
 });
});
describe("review preserves every independently proven salon closure cause",()=>{
 it.each([false,true])("retains CLOSED and OUTSIDE_WORKING_HOURS when override=%s",async override_requested=>{
  const {tx}=setup();state.day.hours.set("pro",[]);state.day.closures.push({startAt:instant("00:00"),endAt:new Date("2030-09-12T00:00:00-03:00")});
  const x=await getSchedulingAvailability(tx,actor,{...slot,override_requested,override_reason:"A cliente concordou"},instant("08:00"));
  expect(x.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false,missing_fields:["destination_mode"]});
  expect(x.review?.causes).toEqual(expect.arrayContaining(["OUTSIDE_WORKING_HOURS","SALON_CLOSED"]));expect(x.review?.message).toContain("O salão está fechado");expect(x.plan).toBeNull();
 });
 it.each([["09:00","10:00"],["10:45","12:00"]])("does not invent closure when interval merely touches %s-%s",async(start,end)=>{
  const {tx}=setup();state.day.closures.push({startAt:instant(start),endAt:instant(end)});
  const x=await getSchedulingAvailability(tx,actor,slot,instant("08:00"));expect(x.review?.causes).not.toContain("SALON_CLOSED");expect(x.review?.override_allowed).toBe(true);
 });
 it("insistence never creates a proposal under both hard restrictions",async()=>{
  setup();state.day.hours.set("pro",[]);state.day.closures.push({startAt:instant("00:00"),endAt:new Date("2030-09-12T00:00:00-03:00")});
  const c=schedulingState();c.fields={...slot,customer_ref:"fabio"};await applySchedulingInterpretation(actor,c,{operation:"appointment.create"});
  const initial=structuredClone(c.fields);await applySchedulingInterpretation(actor,c,{operation:"appointment.create",override_requested:true},"Pode encaixar mesmo assim.");
  expect(c.fields).toEqual({...initial,override_requested:true});expect(c.draft?.review?.causes).toEqual(expect.arrayContaining(["OUTSIDE_WORKING_HOURS","SALON_CLOSED"]));expect(c.draft?.review?.override_allowed).toBe(false);expect(c.proposal).toBeUndefined();expect(state.create).not.toHaveBeenCalled();
  await expect(proposeAppointmentCreate(state.tx,actor,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision})).rejects.toThrow();
 });
});

describe("C7 notice (review): the customer's existing appointments are screen-only, never the model's context",()=>{
 it("a NEW booking for Fábio, who already has an appointment: the preview (and so Luna's previous_response) has no notice; the card shows it",async()=>{
  const {raw}=setup();
  const upcoming={id:"appt-fabio",clientId:"fabio",client:{name:"Fábio Santos"},professionalId:"pro",professional:{user:{name:"Tatiana"}},serviceId:"cut",serviceItems:[],
    startAt:new Date(`2030-09-13T16:00:00-03:00`),endAt:new Date(`2030-09-13T17:00:00-03:00`),timezone:"America/Sao_Paulo",status:"CONFIRMED",version:1,priceCents:5000};
  raw.appointment.findMany.mockImplementation((async(args:{where:{clientId?:string;endAt?:unknown}})=>args.where.clientId==="fabio"&&!args.where.endAt?[upcoming]:[]) as never);
  const c=schedulingState();c.fields={service_ref:"cut",professional_ref:"pro",date,time:"14:00",customer_name:"Fábio Santos",customer_ref:"fabio",service_name:"Corte Completo",professional_name:"Tatiana"};
  await applySchedulingInterpretation(actor,c,{operation:"appointment.create"});
  expect(c.proposal).toBeDefined();expect(c.proposal!.preview).not.toContain("Atenção");expect(c.message).not.toContain("Atenção");
  expect(c.proposal!.existing_bookings).toEqual([{appointment_ref:"appt-fabio",start_local:"2030-09-13T16:00",overlaps:false}]);
  const {actionDetails}=await import("../secretary-ui");
  const view={sessionId:"s",cancelled:false,message:c.message,scheduling:c} as unknown as Parameters<typeof actionDetails>[0];
  expect(actionDetails(view,undefined,"2030-09-11")).toContain("Atenção: Fábio Santos já tem horário marcado: sex, 13/09 às 16h. Isto cria um novo agendamento; para mudar o existente, peça para remarcar.");
  expect(actionDetails(view,undefined,"2030-09-11",new Set(["appt-fabio"]))).not.toContain("Atenção");
 });
});
