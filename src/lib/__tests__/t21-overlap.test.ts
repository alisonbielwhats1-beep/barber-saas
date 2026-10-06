import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { VisitDay } from "../visit-scheduling";
type TestDay=Omit<VisitDay,"appointments">&{appointments:(VisitDay["appointments"][number]&{id:string})[]};
const state=vi.hoisted(()=>({day:null as unknown as TestDay, role:"OWNER", journal:[] as Record<string,unknown>[], cancel:vi.fn(),create:vi.fn(),lock:vi.fn()}));
vi.mock("../visit-scheduling",async original=>({...await original<object>(),loadVisitDay:async (_tx:unknown,_salon:unknown,_date:unknown,_choices:unknown,_now:unknown,projection?:{releasedAppointmentId:string})=>({...state.day,
  appointments:state.day.appointments.filter(a=>(a as {id?:string}).id!==projection?.releasedAppointmentId)})}));
vi.mock("../appointment-service",async original=>({...await original<object>(),lockAppointmentOperationalScope:state.lock}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),getCustomer:async (_tx:unknown,_actor:unknown,id:string)=>({id,name:id==="amanda"?"Amanda Souza":"Fábio Santos"}),searchSalonCustomer:async (_tx:unknown,_actor:unknown,q:string)=>[{id:q.startsWith("Amanda")?"amanda":"fabio",name:q}]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>state.role,locateSchedulingAppointments:async()=>[{appointment_ref:"released",customer_name:"Amanda Souza",start_local:"2030-09-11T10:00",professional_name:"Tatiana"}],
  schedulingActionSnapshot:async()=>({kind:"appointment.cancel",professional_ref:"pro",professional_name:"Tatiana",timezone:"America/Sao_Paulo",startLocal:"2030-09-11T10:00",endLocal:"2030-09-11T10:30",appointment_ref:"released",revision:1,customer_ref:"amanda",customer_name:"Amanda Souza",services:[],requires_acceptance:false,resource_ids:[],waiting_count:0,waiting_hash:"empty",affected:[]}),
  executeSchedulingMutation:state.cancel}));
vi.mock("../scheduling-actions",async original=>({...await original<object>(),executeSchedulingCreate:state.create}));
import { getSchedulingAvailability } from "../scheduling-catalog";
import { patchBatch, validateBatchPlan, upsertBatchDraft, proposeActionBatch, confirmActionBatch } from "../scheduling-batch";
import { canOverrideSlot } from "../appointment-overlap-policy";
import { groundSchedulingException } from "../scheduling-conflict-contract";
import { groundOriginalSchedulingException } from "../scheduling-reason-source";
import { collectedActionFields } from "../secretary-action-plan";
import { createActionPlan, assessPlanAction, actionPlanPreview } from "@everflair/salon-secretary";
import { intent, plan as selection } from "../../test/secretary-capability-plan";

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
    salon:{findUnique:vi.fn(async()=>state.day.salon)},membership:{findFirstOrThrow:vi.fn(async()=>({role:state.role}))},
    service:{findMany:vi.fn(async()=>state.day.services),findFirstOrThrow:vi.fn(async()=>service)},
    servicePricingRule:{findFirst:vi.fn().mockResolvedValue(null)},professionalService:{findMany:vi.fn().mockResolvedValue([{serviceId:"cut"}])},
    professional:{findFirst:vi.fn().mockResolvedValue({id:"pro"}),findMany:vi.fn().mockResolvedValue([{id:"pro",user:{name:"Tatiana"}}])},
    workingHours:{findMany:vi.fn(async()=>state.day.hours.get("pro"))},professionalOpening:{findMany:vi.fn().mockResolvedValue([])},
    physicalResource:{findFirst:vi.fn().mockResolvedValue({id:"room"})},
    salonClosure:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.closures.find(x=>overlaps(x,where))??null)},
    timeOff:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.blocks.find(x=>overlaps(x,where))??null)},
    appointment:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]&{id?:{not:string}}})=>state.day.appointments.find(a=>(a as {id?:string}).id!==where.id?.not&&overlaps(a,where))??null)},
    resourceBooking:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.resourceBookings.find(x=>overlaps(x,where))??null)},
    waitlistOffer:{findFirst:vi.fn(async({where}:{where:{OR:Parameters<typeof overlaps>[1][]}})=>state.day.offers.find(x=>where.OR.some(w=>overlaps(x,w)))??null)},
    auditLog:{create:vi.fn(async({data}:{data:Record<string,unknown>})=>{state.journal.push(structuredClone(data));return data;}),findMany:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)),findFirst:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)[0]??null)},
  };
  return {raw,tx:raw as unknown as Tx,service};
}
const batch=()=>validateBatchPlan({execution_policy:"all_or_nothing",items:[
  {key:"a",operation:"appointment.cancel",depends_on:[],fields:{customer_name:"Amanda Souza",reason:"Cliente desistiu",date,time:"10:00"}},
  {key:"b",operation:"appointment.create",depends_on:["a"],released_slot_of:"a",fields:{customer_name:"Fábio Santos",service_name:"Corte Completo"}},
]});
const slot={service_ref:"cut",professional_ref:"pro",date,time:"10:00"};
beforeEach(()=>{vi.clearAllMocks();state.role="OWNER";state.journal=[];vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","true");vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe("T21 backend and contract without network or database writes",()=>{
  it("keeps the same-slot default and rejects implicit alternative destinations",()=>{
    expect(batch().items[1].fields).not.toHaveProperty("destination_mode");
    expect(()=>patchBatch(batch(),"b",{time:"11:00"})).toThrow("DEPENDENCY_ERROR");
    const next=patchBatch(batch(),"b",{destination_mode:"ALTERNATIVE_SLOT",time:"11:00"});
    expect(next.items[1]).toMatchObject({key:"b",depends_on:["a"],released_slot_of:"a",fields:{time:"11:00",destination_mode:"ALTERNATIVE_SLOT",override_requested:false}});
  });
  it("AVAILABLE: backend duration fits fully after the projected cancellation",async()=>{
    const {tx,service}=setup();service.durationMin=30;
    const x=await getSchedulingAvailability(tx,actor,slot,instant("08:00"),{releasedAppointmentId:"released"});
    expect(x.review).toMatchObject({status:"AVAILABLE",durationMin:30,endLocal:`${date}T10:30`,missing_fields:[],override_allowed:false});expect(x.plan).not.toBeNull();
  });
  it("projects only the cancelled appointment and detects the remaining 15 minutes",async()=>{
    const {tx}=setup();const x=await getSchedulingAvailability(tx,actor,slot,instant("08:00"),{releasedAppointmentId:"released"});
    expect(x.review).toMatchObject({status:"CONFLICT_OVERRIDABLE",durationMin:45,override_allowed:true,conflicts:[{startLocal:`${date}T10:30`,endLocal:`${date}T11:00`,overlapMinutes:15}],missing_fields:["override_requested"]});
    expect(x.plan).toBeNull();expect(x.review!.message.match(/\?/g)).toHaveLength(1);
  });
  it.each(["OWNER","MANAGER","RECEPTIONIST"])("derives overbooking permission from the real %s membership",async role=>{
    const {tx}=setup();state.role=role;const x=await getSchedulingAvailability(tx,actor,{...slot,override_requested:true,override_reason:"Cliente aguardando"},instant("08:00"));
    expect(x.review!.override_allowed).toBe(role!=="RECEPTIONIST");expect(Boolean(x.plan)).toBe(role!=="RECEPTIONIST");
    if(role==="RECEPTIONIST"){expect(x.review!.missing_fields).not.toContain("override_reason");expect(x.review!.message).not.toContain("Quer fazer");}
  });
  it("does not treat generic SLOT_TAKEN as permission",()=>{
    expect(canOverrideSlot("SLOT_TAKEN",[],true)).toBe(false);
    expect(canOverrideSlot("SLOT_TAKEN",[{kind:"RESOURCE"}],true)).toBe(false);
    expect(canOverrideSlot("SLOT_TAKEN",[{kind:"APPOINTMENT"},{kind:"WAITLIST"}],true)).toBe(false);
  });
  it.each(["RESOURCE","WAITLIST","SALON_CLOSED"])("%s blocks override even alongside professional overlap",async kind=>{
    const {tx,service}=setup(),interval={startAt:instant("10:00"),endAt:instant("12:00")};
    if(kind==="RESOURCE"){service.physicalResourceId="room";state.day.resourceBookings.push({...interval,resourceId:"room"});}
    if(kind==="WAITLIST")state.day.offers.push({...interval,professionalId:"pro",resourceIds:[]});
    if(kind==="SALON_CLOSED")state.day.closures.push(interval);
    const x=await getSchedulingAvailability(tx,actor,{...slot,override_requested:true,override_reason:"Cliente aguardando"},instant("08:00"));
    expect(x.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false,missing_fields:["destination_mode"]});
    expect(x.review!.causes).toContain(kind);expect(x.plan).toBeNull();expect(x.review!.message).not.toContain("motivo");expect(x.review!.message).not.toContain("Quer fazer");
  });
  it("preserves one draft through consent, mandatory reason and proposal",async()=>{
    const {tx}=setup();let d=await upsertBatchDraft(tx,actor,{plan:batch()});const ref=d.draft_ref,original=structuredClone(d.plan.items[0]);
    expect(d.missing_fields).toEqual(["b.override_requested"]);
    d=await upsertBatchDraft(tx,actor,{plan:patchBatch(d.plan,"b",{override_requested:true}),draft_ref:ref,expected_revision:d.draft_revision});
    expect(d.missing_fields).toEqual(["b.override_reason"]);expect(d.message).toBe("Qual o motivo do encaixe?");expect(d.status).toBe("NEEDS_INPUT");
    d=await upsertBatchDraft(tx,actor,{plan:patchBatch(d.plan,"b",{override_reason:"Cliente já está aguardando"}),draft_ref:ref,expected_revision:d.draft_revision});
    expect(d.status).toBe("READY");expect(d.draft_ref).toBe(ref);expect(d.plan.items[0]).toEqual(original);
    const p=await proposeActionBatch(tx,actor,{draft_ref:ref,draft_revision:d.draft_revision});
    expect(p.snapshot!.create.overbook).toMatchObject({reason:"Cliente já está aguardando"});expect(p.preview).toContain("ENCAIXE");
    let projected=createActionPlan({...selection([intent("appointment.cancel",{item_key:"a",depends_on:[]}),intent("appointment.create",{item_key:"b",depends_on:["a"],released_slot_of:"a"})]),independent:false});
    for(const key of ["a","b"])projected=assessPlanAction(projected,key,{status:"READY",missing_fields:[],preview:p.preview});
    expect(actionPlanPreview(projected)).toContain("ENCAIXE: haverá sobreposição. Motivo: Cliente já está aguardando");
    expect(state.cancel).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();
  });
  it("hard block persists in the same draft when the owner insists with a reason",async()=>{
    const {tx}=setup();state.day.closures.push({startAt:instant("10:30"),endAt:instant("11:00")});
    const first=await upsertBatchDraft(tx,actor,{plan:batch()});
    const original=structuredClone(first.plan.items[0]);
    const fields={override_requested:true,override_reason:"Cliente aguardando"};
    groundSchedulingException(fields,{},"Pode encaixar mesmo assim porque Cliente aguardando.");
    const next=await upsertBatchDraft(tx,actor,{plan:patchBatch(first.plan,"b",fields),draft_ref:first.draft_ref,expected_revision:first.draft_revision});
    expect(next.draft_ref).toBe(first.draft_ref);expect(next.plan.items[0]).toEqual(original);
    expect(next.plan.items[1].depends_on).toEqual(["a"]);expect(next.status).not.toBe("READY");
    expect(next.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false});
    expect(next.message).not.toContain("Qual o motivo");expect(next.message).not.toContain("Quer fazer");
    await expect(proposeActionBatch(tx,actor,{draft_ref:next.draft_ref,draft_revision:next.draft_revision})).rejects.toThrow();
    expect(state.cancel).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();
  });
  it("accepts an initially grounded reason without asking again",async()=>{
    const {tx}=setup();const fields={override_requested:true,override_reason:"ele já está aguardando"};
    groundSchedulingException(fields,{},"Coloca Fábio mesmo que dê conflito porque ele já está aguardando.");
    const d=await upsertBatchDraft(tx,actor,{plan:patchBatch(batch(),"b",fields)});
    expect(d.status).toBe("READY");expect(d.missing_fields).toEqual([]);
  });
  it("offers only backend alternatives and preserves the batch on an explicit choice",async()=>{
    const {tx}=setup();const first=await upsertBatchDraft(tx,actor,{plan:batch()});
    const choice=await upsertBatchDraft(tx,actor,{plan:patchBatch(first.plan,"b",{destination_mode:"ALTERNATIVE_SLOT"}),draft_ref:first.draft_ref,expected_revision:first.draft_revision});
    expect(choice.missing_fields).toEqual(["b.time"]);expect(choice.review!.alternatives[0].startLocal).toBe(`${date}T11:00`);
    const ready=await upsertBatchDraft(tx,actor,{plan:patchBatch(choice.plan,"b",{time:"11:00"}),draft_ref:choice.draft_ref,expected_revision:choice.draft_revision});
    expect(ready.status).toBe("READY");expect(ready.draft_ref).toBe(first.draft_ref);expect(ready.snapshot!.create.startLocal).toBe(`${date}T11:00`);
    expect(ready.snapshot!.create.overbook).toBeUndefined();expect(ready.plan.items[0]).toEqual(first.plan.items[0]);
    const p=await proposeActionBatch(tx,actor,{draft_ref:ready.draft_ref,draft_revision:ready.draft_revision});expect(p.preview).toContain("outro horário escolhido");
  });
  it("invalidates consent/reason after a material destination change",()=>{
    const approved=patchBatch(batch(),"b",{override_requested:true,override_reason:"Cliente aguardando"});
    const next=patchBatch(approved,"b",{destination_mode:"ALTERNATIVE_SLOT"});
    expect(next.items[1].fields.override_requested).toBe(false);expect(next.items[1].fields.override_reason).toBeUndefined();
    const action=createActionPlan(selection([intent("appointment.create",{item_key:"b",override_requested:true,override_reason:"Cliente aguardando"})])).actions[0];
    const result=collectedActionFields({sessionId:"synthetic",cancelled:false,message:"",batch:{operation:"action.batch",plan:next,message:"",metrics:{},interpretation_source:"MODEL"}},action);
    expect((result as Record<string,unknown>).override_requested).toBe(false);expect((result as Record<string,unknown>).override_reason).toBeUndefined();
  });
  it("rejects ungrounded consent, invented reason and ambiguous yes",()=>{
    expect(()=>groundSchedulingException({override_requested:true},{},"Sim.")).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
    expect(()=>groundSchedulingException({override_reason:"Cliente aguardando"},{},"Pode encaixar.")).toThrow("OVERRIDE_REASON_NOT_GROUNDED");
    expect(()=>groundSchedulingException({time:"13:00",override_requested:true},{time:"10:00",override_requested:true},"Às 13h.")).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
  });
  it("preserves the original causal span in the domain draft and reaches HARD_BLOCK without override",async()=>{
    const {tx}=setup();state.day.closures.push({startAt:instant("10:30"),endAt:instant("11:00")});
    const plan=batch(),fields=plan.items[1].fields;
    Object.assign(fields,{override_requested:true,override_reason:"Fábio já está aguardando"});
    const message="Coloca Fábio Santos no lugar para Corte Completo, mesmo que dê conflito, porque ele já está aguardando.";
    groundOriginalSchedulingException(fields,{},message);
    const draft=await upsertBatchDraft(tx,actor,{plan});
    expect(draft.plan.items[1].fields.override_reason).toBe("ele já está aguardando");
    const source=draft.plan.items[1].fields.override_reason_source!;
    expect(message.slice(source.start,source.end)).toBe(source.original_text);
    expect(draft.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false,causes:["SALON_CLOSED"]});
    expect(draft.message).not.toMatch(/Quer fazer|motivo/i);
    expect(draft.plan.items[1].depends_on).toEqual(plan.items[1].depends_on);
    await expect(proposeActionBatch(tx,actor,{draft_ref:draft.draft_ref,draft_revision:draft.draft_revision})).rejects.toThrow("NEEDS_INPUT");
    expect(state.cancel).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();
    const alternate=patchBatch(draft.plan,"b",{destination_mode:"ALTERNATIVE_SLOT",time:"11:00"});
    expect(alternate.items[1].fields.override_reason_source).toBeUndefined();
    expect(alternate.items[1].fields.override_reason).toBeUndefined();
  });
  it("keeps five actions, the branched graph and a single natural question",()=>{
    let p=createActionPlan({...selection([intent("appointment.cancel",{item_key:"a",depends_on:[]}),intent("appointment.create",{item_key:"b",depends_on:["a"],released_slot_of:"a"}),intent("customer.message",{item_key:"c",depends_on:["a"]}),intent("service.change",{item_key:"d",depends_on:[]}),intent("financial.report",{item_key:"e",depends_on:[]})]),independent:false});
    const edges=structuredClone(p.dependencies);p=assessPlanAction(p,"b",{status:"NEEDS_INPUT",missing_fields:["override_reason"]});
    expect(actionPlanPreview(p,{b:{question:"Qual o motivo do encaixe?"}})).toBe("Qual o motivo do encaixe?");expect(p.dependencies).toEqual(edges);expect(p.actions).toHaveLength(5);
  });
  it("alternative destination uses the same transaction and propagates failure before the receipt",async()=>{
    const {tx}=setup();const d=await upsertBatchDraft(tx,actor,{plan:patchBatch(batch(),"b",{destination_mode:"ALTERNATIVE_SLOT",time:"11:00"})});
    const p=await proposeActionBatch(tx,actor,{draft_ref:d.draft_ref,draft_revision:d.draft_revision});
    state.cancel.mockImplementation(async received=>{expect(received).toBe(tx);});state.create.mockImplementation(async received=>{expect(received).toBe(tx);throw Error("SIMULATED_DESTINATION_FAILURE");});
    await expect(confirmActionBatch(tx,actor,{proposal_ref:p.proposal_ref,draft_revision:p.draft_revision})).rejects.toThrow("SIMULATED_DESTINATION_FAILURE");
    expect(state.cancel).toHaveBeenCalledOnce();expect(state.create).toHaveBeenCalledOnce();
    expect(state.cancel.mock.invocationCallOrder[0]).toBeLessThan(state.create.mock.invocationCallOrder[0]);
    expect(state.journal.some(row=>row.action==="CONFIRMED")).toBe(false);
  });
  it("flag OFF refuses new intent without changing the legacy same-slot plan",()=>{
    vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","false");expect(batch().items).toHaveLength(2);
    expect(()=>patchBatch(batch(),"b",{destination_mode:"ALTERNATIVE_SLOT"})).toThrow("SCHEDULING_OVERLAP_DISABLED");
  });
});
