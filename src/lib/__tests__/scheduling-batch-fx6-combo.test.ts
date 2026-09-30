import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { VisitDay } from "../visit-scheduling";

/** FX6 (review, owner rule 9, safety; flag SALON_SECRETARY_MULTI_SERVICE) in the atomic cancel→create pair ("cancela a X e coloca a Y no
 * lugar dela pra hidratação e escova"): the pair books ONE service, so the one combo the search finds for words whose parts are also
 * registered apart is a card of that combo (with the reason), never a pick; the combo alone registered (rule 9, case 1) and the owner
 * naming the combo itself are used as before. Offline: a fake tenant transaction, no network, no writes. Synthetic spa, diverse names. */
type TestDay=Omit<VisitDay,"appointments">&{appointments:(VisitDay["appointments"][number]&{id:string})[]};
const state=vi.hoisted(()=>({day:null as unknown as TestDay,journal:[] as Record<string,unknown>[],catalog:[] as {id:string;name:string}[]}));
vi.mock("../visit-scheduling",async original=>({...await original<object>(),loadVisitDay:async (_tx:unknown,_salon:unknown,_date:unknown,_choices:unknown,_now:unknown,projection?:{releasedAppointmentId:string})=>({...state.day,
  appointments:state.day.appointments.filter(a=>a.id!==projection?.releasedAppointmentId)})}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),getCustomer:async (_tx:unknown,_actor:unknown,id:string)=>({id,name:id==="nadia"?"Nádia Farias":"Oksana Petrenko"}),
  searchSalonCustomer:async (_tx:unknown,_actor:unknown,q:string)=>[{id:q.startsWith("Nádia")?"nadia":"oksana",name:q}]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>"OWNER",
  locateSchedulingAppointments:async()=>[{appointment_ref:"released",customer_name:"Nádia Farias",start_local:"2030-09-11T10:00",professional_name:"Priscila"}],
  schedulingActionSnapshot:async()=>({kind:"appointment.cancel",professional_ref:"pro",professional_name:"Priscila",timezone:"America/Sao_Paulo",startLocal:"2030-09-11T10:00",endLocal:"2030-09-11T11:30",
    appointment_ref:"released",revision:1,customer_ref:"nadia",customer_name:"Nádia Farias",requires_acceptance:false,resource_ids:[],waiting_count:0,waiting_hash:"empty",affected:[],
    services:[{id:"umect",name:"Umectação",durationMin:90,priceCents:9000,priceType:"FIXED",priceNote:null,processingMin:0,finishingMin:0}]})}));
import { upsertBatchDraft } from "../scheduling-batch";

const actor={salonId:"spa-sol",userId:"dona-sol"},date="2030-09-11";
const instant=(time:string)=>new Date(`${date}T${time}:00-03:00`);
const overlaps=(a:{startAt:Date;endAt:Date},where:{startAt:{lt:Date};endAt:{gt:Date}})=>a.startAt<where.startAt.lt&&a.endAt>where.endAt.gt;
const COMBO={id:"combo",name:"Combo hidratação e escova"},HID={id:"hid",name:"Hidratação"},ESC={id:"esc",name:"Escova"},UMECT={id:"umect",name:"Umectação"};
function setup(){
  const service=(row:{id:string;name:string})=>({...row,durationMin:40,priceCents:5000,priceType:"FIXED",priceNote:null,physicalResourceId:null as string|null,professionals:[{professional:{id:"pro",user:{name:"Priscila"}}}]});
  state.day={salon:{timezone:"America/Sao_Paulo",minBookingLeadMinutes:0,maxBookingLeadDays:365,bufferMinutes:0},services:state.catalog.map(service),priced:state.catalog.map(service),hours:new Map([["pro",[{startMinutes:540,endMinutes:1080}]]]),closures:[],blocks:[],
    appointments:[{id:"released",professionalId:"pro",startAt:instant("10:00"),endAt:instant("11:30")}],resourceBookings:[],offers:[],preferences:{slotMode:"FIT",returnDays:30,serviceReturnDays:{},addons:{},simultaneousPairs:[]},date,now:instant("08:00")};
  const findAudit=({where}:{where:Record<string,unknown>})=>state.journal.filter(row=>Object.entries(where).every(([k,v])=>row[k]===v));
  const named=(where:{name?:{contains:string};OR?:{name?:{contains:string}}[]})=>{const q=(where.name?.contains??where.OR?.[0]?.name?.contains??"").toLowerCase();return state.catalog.filter(row=>row.name.toLowerCase().includes(q)).map(service);};
  const raw={
    $queryRaw:vi.fn().mockImplementation(async (q:readonly string[])=>{const sql=q.join("");return sql.includes('"Membership"')?[{role:"OWNER"}]:sql.includes('FROM "Service"')&&sql.includes("LIKE")?[]:[{revision:"1",accessStatus:"APPROVED"}];}),$executeRaw:vi.fn().mockResolvedValue(1),
    salon:{findUnique:vi.fn(async()=>state.day.salon)},membership:{findFirstOrThrow:vi.fn(async()=>({role:"OWNER"}))},
    service:{findMany:vi.fn(async({where}:{where:Parameters<typeof named>[0]})=>where.name||where.OR?named(where):state.day.services),findFirstOrThrow:vi.fn(async({where}:{where:{id:string}})=>service(state.catalog.find(row=>row.id===where.id)!))},
    servicePricingRule:{findFirst:vi.fn().mockResolvedValue(null)},professionalService:{findMany:vi.fn(async()=>state.catalog.map(row=>({serviceId:row.id})))},
    professional:{findFirst:vi.fn().mockResolvedValue({id:"pro"}),findMany:vi.fn(async()=>[{id:"pro",user:{name:"Priscila"}}])},
    workingHours:{findMany:vi.fn(async()=>state.day.hours.get("pro"))},professionalOpening:{findMany:vi.fn().mockResolvedValue([])},physicalResource:{findFirst:vi.fn().mockResolvedValue({id:"room"})},
    salonClosure:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.closures.find(x=>overlaps(x,where))??null)},
    timeOff:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.blocks.find(x=>overlaps(x,where))??null)},
    appointment:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]&{id?:{not:string}}})=>state.day.appointments.find(a=>a.id!==where.id?.not&&overlaps(a,where))??null)},
    resourceBooking:{findFirst:vi.fn().mockResolvedValue(null)},waitlistOffer:{findFirst:vi.fn().mockResolvedValue(null)},
    auditLog:{create:vi.fn(async({data}:{data:Record<string,unknown>})=>{state.journal.push(structuredClone(data));return data;}),findMany:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)),findFirst:vi.fn(async(args:{where:Record<string,unknown>})=>findAudit(args)[0]??null)},
  };
  return raw as unknown as Tx;
}
const plan=(create:Record<string,unknown>)=>({execution_policy:"all_or_nothing" as const,items:[
  {key:"a",operation:"appointment.cancel" as const,depends_on:[],fields:{customer_name:"Nádia Farias",reason:"Cliente teve um imprevisto",date,time:"10:00"}},
  {key:"b",operation:"appointment.create" as const,depends_on:["a"],released_slot_of:"a",fields:{customer_name:"Oksana Petrenko",...create}}]});
beforeEach(()=>{state.journal=[];state.catalog=[COMBO,HID,ESC,UMECT];vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE","true");vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe("rule 9 in the atomic pair: a combo is never picked by the words' form", () => {
  it("the combo found while its parts are registered apart: a card of that combo with the reason; nothing is prepared", async () => {
    const d=await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"hidratação e escova"})});
    expect(d).toMatchObject({status:"NEEDS_INPUT",missing_fields:["b.service_ref"],candidates:{item_key:"b",field:"service_ref",items:[{id:"combo",name:"Combo hidratação e escova"}]}});
    expect(d.message).toContain("esses serviços também existem separados");expect(d.snapshot).toBeUndefined();
  });
  it("the owner's click on the combo: READY with the combo (the card's own option, rechecked by the search)", async () => {
    const d=await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"hidratação e escova",service_ref:"combo"})});
    expect(d.status).toBe("READY");expect(d.snapshot!.create).toMatchObject({service_ref:"combo",service_name:"Combo hidratação e escova"});
  });
  it("rule 9, case 1: only the combo registered: it is used directly (no question)", async () => {
    state.catalog=[COMBO,UMECT];
    const d=await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"hidratação e escova"})});
    expect(d.status).toBe("READY");expect(d.snapshot!.create).toMatchObject({service_ref:"combo"});
  });
  it("the owner writing the combo's registered name names it: used; a plain single service is unchanged", async () => {
    expect((await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"Combo hidratação e escova"})})).snapshot!.create).toMatchObject({service_ref:"combo"});
    expect((await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"Escova"})})).status).toBe("NEEDS_INPUT"); // "Escova" is a word of the combo too: a card, as before
    expect((await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"Umectação"})})).snapshot!.create).toMatchObject({service_ref:"umect"});
  });
  it("flag off: the historical single match (unchanged)", async () => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE","false");
    const d=await upsertBatchDraft(setup(),actor,{plan:plan({service_name:"hidratação e escova"})});
    expect(d.status).toBe("READY");expect(d.snapshot!.create).toMatchObject({service_ref:"combo"});
  });
});
