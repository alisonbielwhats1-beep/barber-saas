import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { VisitDay } from "../visit-scheduling";

/** P3a D3 (flag SALON_SECRETARY_REFERENCES_V2) in the atomic cancel→create pair: "coloca o Téo no lugar dela pro mesmo serviço".
 * The create item carries `service_follows_released` (set only on a proven link, secretary-batch.ts); the batch then takes the
 * CANCELLED appointment's own service from its snapshot: one is copied, several are a card, the owner's different service is a
 * conflict, and the released professional must still perform it. Offline: a fake tenant transaction, no network, no writes. */
type TestDay=Omit<VisitDay,"appointments">&{appointments:(VisitDay["appointments"][number]&{id:string})[]};
const state=vi.hoisted(()=>({day:null as unknown as TestDay,journal:[] as Record<string,unknown>[],services:[] as {id:string;name:string}[],performs:true}));
vi.mock("../visit-scheduling",async original=>({...await original<object>(),loadVisitDay:async (_tx:unknown,_salon:unknown,_date:unknown,_choices:unknown,_now:unknown,projection?:{releasedAppointmentId:string})=>({...state.day,
  appointments:state.day.appointments.filter(a=>a.id!==projection?.releasedAppointmentId)})}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),getCustomer:async (_tx:unknown,_actor:unknown,id:string)=>({id,name:id==="iara"?"Iara Mendes":"Téo Nakamura"}),
  searchSalonCustomer:async (_tx:unknown,_actor:unknown,q:string)=>[{id:q.startsWith("Iara")?"iara":"teo",name:q}]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>"OWNER",
  locateSchedulingAppointments:async()=>[{appointment_ref:"released",customer_name:"Iara Mendes",start_local:"2030-09-11T10:00",professional_name:"Wanda"}],
  schedulingActionSnapshot:async()=>({kind:"appointment.cancel",professional_ref:"pro",professional_name:"Wanda",timezone:"America/Sao_Paulo",startLocal:"2030-09-11T10:00",endLocal:"2030-09-11T10:30",
    appointment_ref:"released",revision:1,customer_ref:"iara",customer_name:"Iara Mendes",requires_acceptance:false,resource_ids:[],waiting_count:0,waiting_hash:"empty",affected:[],
    services:state.services.map(s=>({...s,durationMin:30,priceCents:5000,priceType:"FIXED",priceNote:null,processingMin:0,finishingMin:0}))})}));
import { validateBatchPlan, upsertBatchDraft, patchBatch } from "../scheduling-batch";

const actor={salonId:"salon",userId:"owner"},date="2030-09-11";
const instant=(time:string)=>new Date(`${date}T${time}:00-03:00`);
const overlaps=(a:{startAt:Date;endAt:Date},where:{startAt:{lt:Date};endAt:{gt:Date}})=>a.startAt<where.startAt.lt&&a.endAt>where.endAt.gt;
const catalog=[{id:"cut",name:"Corte Completo"},{id:"beard",name:"Barba"},{id:"brush",name:"Escova"}];
function setup(){
  const service=(row:{id:string;name:string})=>({...row,durationMin:30,priceCents:5000,priceType:"FIXED",priceNote:null,physicalResourceId:null as string|null,professionals:[{professional:{id:"pro",user:{name:"Wanda"}}}]});
  state.day={salon:{timezone:"America/Sao_Paulo",minBookingLeadMinutes:0,maxBookingLeadDays:365,bufferMinutes:0},services:catalog.map(service),priced:catalog.map(service),hours:new Map([["pro",[{startMinutes:540,endMinutes:1080}]]]),closures:[],blocks:[],
    appointments:[{id:"released",professionalId:"pro",startAt:instant("10:00"),endAt:instant("10:30")}],resourceBookings:[],offers:[],preferences:{slotMode:"FIT",returnDays:30,serviceReturnDays:{},addons:{},simultaneousPairs:[]},date,now:instant("08:00")};
  const findAudit=({where}:{where:Record<string,unknown>})=>state.journal.filter(row=>Object.entries(where).every(([k,v])=>row[k]===v));
  const named=(where:{name?:{contains:string};OR?:{name?:{contains:string}}[]})=>{const q=(where.name?.contains??where.OR?.[0]?.name?.contains??"").toLowerCase();return catalog.filter(row=>row.name.toLowerCase().includes(q)).map(service);};
  const raw={
    $queryRaw:vi.fn().mockImplementation(async (q:readonly string[])=>{const sql=q.join("");return sql.includes('"Membership"')?[{role:"OWNER"}]:sql.includes('FROM "Service"')&&sql.includes("LIKE")?[]:[{revision:"1",accessStatus:"APPROVED"}];}),$executeRaw:vi.fn().mockResolvedValue(1),
    salon:{findUnique:vi.fn(async()=>state.day.salon)},membership:{findFirstOrThrow:vi.fn(async()=>({role:"OWNER"}))},
    service:{findMany:vi.fn(async({where}:{where:Parameters<typeof named>[0]})=>where.name||where.OR?named(where):state.day.services),findFirstOrThrow:vi.fn(async({where}:{where:{id:string}})=>service(catalog.find(row=>row.id===where.id)!))},
    servicePricingRule:{findFirst:vi.fn().mockResolvedValue(null)},professionalService:{findMany:vi.fn(async()=>catalog.map(row=>({serviceId:row.id})))},
    professional:{findFirst:vi.fn().mockResolvedValue({id:"pro"}),findMany:vi.fn(async()=>state.performs?[{id:"pro",user:{name:"Wanda"}}]:[])},
    workingHours:{findMany:vi.fn(async()=>state.day.hours.get("pro"))},professionalOpening:{findMany:vi.fn().mockResolvedValue([])},physicalResource:{findFirst:vi.fn().mockResolvedValue({id:"room"})},
    salonClosure:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.closures.find(x=>overlaps(x,where))??null)},
    timeOff:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.blocks.find(x=>overlaps(x,where))??null)},
    appointment:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]&{id?:{not:string}}})=>state.day.appointments.find(a=>a.id!==where.id?.not&&overlaps(a,where))??null)},
    resourceBooking:{findFirst:vi.fn().mockResolvedValue(null)},waitlistOffer:{findFirst:vi.fn().mockResolvedValue(null)},
    auditLog:{create:vi.fn(async({data}:{data:Record<string,unknown>})=>{state.journal.push(structuredClone(data));return data;}),findMany:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)),findFirst:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)[0]??null)},
  };
  return raw as unknown as Tx;
}
const plan=(create:Record<string,unknown>={},follows=true)=>({execution_policy:"all_or_nothing" as const,items:[
  {key:"a",operation:"appointment.cancel" as const,depends_on:[],fields:{customer_name:"Iara Mendes",reason:"Cliente desistiu",date,time:"10:00"}},
  {key:"b",operation:"appointment.create" as const,depends_on:["a"],released_slot_of:"a",fields:{customer_name:"Téo Nakamura",...create},...(follows?{service_follows_released:true as const}:{})}]});
beforeEach(()=>{state.journal=[];state.services=[{id:"cut",name:"Corte Completo"}];state.performs=true;vi.stubEnv("SALON_SECRETARY_REFERENCES_V2","true");vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe("D3 in the atomic pair: the released appointment's own service", () => {
  it("the item key is optional and backward compatible (a historical plan parses unchanged)", () => {
    expect(validateBatchPlan(plan({service_name:"Escova"},false)).items[1]).not.toHaveProperty("service_follows_released");
    expect(validateBatchPlan(plan()).items[1]).toMatchObject({service_follows_released:true});
  });
  it("one service: copied from the cancelled appointment's snapshot; READY", async () => {
    const d=await upsertBatchDraft(setup(),actor,{plan:plan()});
    expect(d.status).toBe("READY");
    expect(d.snapshot!.create).toMatchObject({service_ref:"cut",service_name:"Corte Completo",professional_ref:"pro",startLocal:`${date}T10:00`});
  });
  it("several services: a card of those services, never a pick", async () => {
    state.services=[{id:"cut",name:"Corte Completo"},{id:"beard",name:"Barba"}];
    const d=await upsertBatchDraft(setup(),actor,{plan:plan()});
    expect(d).toMatchObject({status:"NEEDS_INPUT",missing_fields:["b.service_ref"],candidates:{item_key:"b",field:"service_ref",items:[{id:"cut"},{id:"beard"}]}});
    expect(d.snapshot).toBeUndefined();
  });
  it("a card choice is one of the released services only; then READY", async () => {
    state.services=[{id:"cut",name:"Corte Completo"},{id:"beard",name:"Barba"}];
    const chosen=plan();chosen.items[1].fields={...chosen.items[1].fields,service_ref:"beard"} as never;
    expect((await upsertBatchDraft(setup(),actor,{plan:chosen})).snapshot!.create).toMatchObject({service_ref:"beard",service_name:"Barba"});
    const foreign=plan();foreign.items[1].fields={...foreign.items[1].fields,service_ref:"brush"} as never;
    expect(await upsertBatchDraft(setup(),actor,{plan:foreign})).toMatchObject({status:"BLOCKED"});
  });
  it("the owner's own different service beside the link: conflict, asked, nothing chosen", async () => {
    const d=await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"Escova"})});
    expect(d).toMatchObject({status:"NEEDS_INPUT",missing_fields:["b.service_name"],message:"Recebi indicações diferentes para o serviço e não escolhi nenhuma. Qual serviço?"});
    // The owner's next word for the service is theirs: the link is released.
    expect(patchBatch(validateBatchPlan(plan({service_name:"Escova"})),"b",{service_name:"Escova"}).items[1]).not.toHaveProperty("service_follows_released");
  });
  it("the released professional must perform the copied service (never another professional)", async () => {
    state.performs=false;
    expect(await upsertBatchDraft(setup(),actor,{plan:plan()})).toMatchObject({status:"BLOCKED"});
  });
  it("flag off: the key is inert; the service is asked as before", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2","false");
    expect(await upsertBatchDraft(setup(),actor,{plan:plan()})).toMatchObject({status:"NEEDS_INPUT",missing_fields:["b.service_name"],message:"Qual é o serviço do novo agendamento?"});
  });
});
