import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { VisitDay } from "../visit-scheduling";

/** Owner decision 05/10 (flag SALON_SECRETARY_SCHEDULE_EXCEPTIONS): a new booking outside the professional's schedule is asked
 * ("quer agendar mesmo assim?"), never refused outright nor booked silently; the reason is optional; the executor re-checks role
 * and causes and books with the agenda's own override parameters. Same mocked tenant as t21-overlap (no network, no database). */
type TestDay=Omit<VisitDay,"appointments">&{appointments:(VisitDay["appointments"][number]&{id:string})[]};
const state=vi.hoisted(()=>({day:null as unknown as TestDay,role:"OWNER",journal:[] as Record<string,unknown>[],createAppointment:vi.fn()}));
vi.mock("../visit-scheduling",async original=>({...await original<object>(),loadVisitDay:async()=>state.day}));
vi.mock("../appointment-service",async original=>({...await original<object>(),createAppointment:state.createAppointment}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>state.role}));
import { getSchedulingAvailability } from "../scheduling-catalog";
import { appointmentCreatePreview, conflictGrant, executeSchedulingCreate } from "../scheduling-actions";
import { EXCEPTION_DEFAULT_REASON } from "../schedule-exception-policy";

const actor={salonId:"salon",userId:"owner"},date="2030-09-11";
const instant=(time:string)=>new Date(`${date}T${time}:00-03:00`);
const overlaps=(a:{startAt:Date;endAt:Date},where:{startAt:{lt:Date};endAt:{gt:Date}})=>a.startAt<where.startAt.lt&&a.endAt>where.endAt.gt;
function setup(){
  const service={id:"cut",name:"Corte Completo",durationMin:45,priceCents:5000,priceType:"FIXED",priceNote:null,physicalResourceId:null as string|null,professionals:[{professional:{id:"pro",user:{name:"Tatiana"}}}]};
  state.day={salon:{timezone:"America/Sao_Paulo",minBookingLeadMinutes:0,maxBookingLeadDays:365,bufferMinutes:0},services:[service],priced:[service],hours:new Map([["pro",[{startMinutes:540,endMinutes:1080}]]]),closures:[],blocks:[],
    appointments:[],resourceBookings:[],offers:[],preferences:{slotMode:"FIT",returnDays:30,serviceReturnDays:{},addons:{},simultaneousPairs:[]},date,now:instant("08:00")} as unknown as TestDay;
  const raw={
    $queryRaw:vi.fn().mockImplementation(async (q:readonly string[])=>q.join("").includes('"Membership"')?[{role:state.role}]:[{revision:"1",accessStatus:"APPROVED"}]),$executeRaw:vi.fn().mockResolvedValue(1),
    salon:{findUnique:vi.fn(async()=>state.day.salon),findUniqueOrThrow:vi.fn(async()=>state.day.salon)},membership:{findFirstOrThrow:vi.fn(async()=>({role:state.role}))},
    service:{findMany:vi.fn(async()=>state.day.services),findFirstOrThrow:vi.fn(async()=>service)},
    servicePricingRule:{findFirst:vi.fn().mockResolvedValue(null)},professionalService:{findMany:vi.fn().mockResolvedValue([{serviceId:"cut"}])},
    professional:{findFirst:vi.fn().mockResolvedValue({id:"pro",user:{name:"Tatiana"}}),findMany:vi.fn().mockResolvedValue([{id:"pro",user:{name:"Tatiana"}}])},
    workingHours:{findMany:vi.fn(async()=>state.day.hours.get("pro"))},professionalOpening:{findMany:vi.fn().mockResolvedValue([])},
    physicalResource:{findFirst:vi.fn().mockResolvedValue({id:"room"})},
    salonClosure:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.closures.find(x=>overlaps(x,where))??null)},
    timeOff:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.blocks.find(x=>overlaps(x,where))??null)},
    appointment:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]&{id?:{not:string}}})=>state.day.appointments.find(a=>(a as {id?:string}).id!==where.id?.not&&overlaps(a,where))??null)},
    resourceBooking:{findFirst:vi.fn(async({where}:{where:Parameters<typeof overlaps>[1]})=>state.day.resourceBookings.find(x=>overlaps(x,where))??null)},
    waitlistOffer:{findFirst:vi.fn(async({where}:{where:{OR:Parameters<typeof overlaps>[1][]}})=>state.day.offers.find(x=>where.OR.some(w=>overlaps(x,w)))??null)},
    auditLog:{create:vi.fn(async({data}:{data:Record<string,unknown>})=>{state.journal.push(structuredClone(data));return data;})},
  };
  return raw as unknown as Tx;
}
const slot=(time:string,extra:Record<string,unknown>={})=>({service_ref:"cut",professional_ref:"pro",date,time,...extra});
const review=async(tx:Tx,time:string,extra:Record<string,unknown>={})=>(await getSchedulingAvailability(tx,actor,slot(time,extra),instant("08:00"),undefined,undefined,5,true));
beforeEach(()=>{vi.clearAllMocks();state.role="OWNER";state.journal=[];vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","true");vi.stubEnv("SALON_SECRETARY_SCHEDULE_EXCEPTIONS","true");
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe("schedule exception on a new booking",()=>{
  it("asks before booking outside the professional's hours, and books only after the consent",async()=>{
    const tx=setup();
    const asked=await review(tx,"19:00");
    expect(asked.plan).toBeNull();
    expect(asked.review).toMatchObject({status:"CONFLICT_OVERRIDABLE",causes:["OUTSIDE_WORKING_HOURS"],override_allowed:true,missing_fields:["override_requested"]});
    expect(asked.review!.message).toBe("Esse horário fica fora do expediente de Tatiana. Quer agendar mesmo assim ou escolher outro horário?");
    const kept=await review(tx,"19:00",{override_requested:true});
    expect(kept.plan?.startLocal).toBe(`${date}T19:00`);
    expect(kept.review).toMatchObject({status:"CONFLICT_OVERRIDABLE",missing_fields:[]});
    expect(kept.review!.message).toBe("Exceção autorizada (fora do expediente) para 19h–19h45. Aguarda confirmação.");
  });

  it("names a block and an overlap together in one question",async()=>{
    const tx=setup();
    state.day.blocks.push({professionalId:"pro",startAt:instant("10:00"),endAt:instant("12:00")} as never);
    state.day.appointments.push({id:"other",professionalId:"pro",startAt:instant("10:30"),endAt:instant("11:00")} as never);
    const asked=await review(tx,"10:00");
    expect(asked.review!.causes).toEqual(["PROFESSIONAL_UNAVAILABLE","SLOT_TAKEN"]);
    expect(asked.review!.message).toContain("está bloqueado na agenda de Tatiana (folga ou bloqueio) e tem outro atendimento às 10h30");
  });

  it("follows the agenda's roles: a manager may keep a block; reception never (the professional's own matrix: policy test)",async()=>{
    const tx=setup();
    state.role="MANAGER";
    state.day.blocks.push({professionalId:"pro",startAt:instant("10:00"),endAt:instant("12:00")} as never);
    expect((await review(tx,"10:00")).review).toMatchObject({status:"CONFLICT_OVERRIDABLE",override_allowed:true,causes:["PROFESSIONAL_UNAVAILABLE"]});
    state.role="RECEPTIONIST";
    const refused=await review(tx,"19:00",{override_requested:true});
    expect(refused.plan).toBeNull();
    expect(refused.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false});
    expect(refused.review!.message).toContain("Seu acesso não permite abrir essa exceção.");
  });

  it("keeps a salon closure a hard block, even with consent",async()=>{
    const tx=setup();
    state.day.closures.push({startAt:instant("00:00"),endAt:instant("23:59")} as never);
    const closed=await review(tx,"19:00",{override_requested:true});
    expect(closed.plan).toBeNull();
    expect(closed.review).toMatchObject({status:"CONFLICT_HARD_BLOCK",override_allowed:false});
    expect(closed.review!.causes).toContain("SALON_CLOSED");
  });

  it("changes nothing without the flag or without the caller's opt-in",async()=>{
    const tx=setup();
    vi.stubEnv("SALON_SECRETARY_SCHEDULE_EXCEPTIONS","false");
    const off=await review(tx,"19:00",{override_requested:true});
    expect(off.plan).toBeNull();
    expect(off.review).toMatchObject({status:"CONFLICT_HARD_BLOCK"});
    vi.stubEnv("SALON_SECRETARY_SCHEDULE_EXCEPTIONS","true");
    const legacy=await getSchedulingAvailability(tx,actor,slot("19:00"),instant("08:00"));
    expect(legacy.review).toMatchObject({status:"CONFLICT_HARD_BLOCK"});
  });

  it("carries the owner's reason or the default one, and shows the exception on the card",async()=>{
    const tx=setup();
    const kept=await review(tx,"19:00",{override_requested:true});
    expect(conflictGrant(kept.review,{})).toMatchObject({exception:{causes:["OUTSIDE_WORKING_HOURS"],reason:EXCEPTION_DEFAULT_REASON,reason_source:"DEFAULT"}});
    expect(conflictGrant(kept.review,{override_reason:"Cliente só pode à noite"})).toMatchObject({exception:{reason:"Cliente só pode à noite",reason_source:"OWNER"}});
    const preview=appointmentCreatePreview({customer_name:"Amanda Souza",service_name:"Corte Completo",professional_name:"Tatiana",startLocal:`${date}T19:00`,endLocal:`${date}T19:45`,priceType:"FIXED",priceCents:5000,
      exception:{causes:["OUTSIDE_WORKING_HOURS"],reason:"Cliente só pode à noite",reason_source:"OWNER",conflict_hash:"h"}});
    expect(preview).toContain("EXCEÇÃO: fora do expediente · Motivo: Cliente só pode à noite");
  });

  it("re-checks role and causes at execution and books with the agenda's override parameters plus an audit row",async()=>{
    const tx=setup();
    state.createAppointment.mockResolvedValue({appointment:{id:"new"}});
    const s={customer_ref:"amanda",customer_name:"Amanda Souza",service_ref:"cut",service_revision:"1",service_name:"Corte Completo",professional_ref:"pro",professional_name:"Tatiana",date,
      startLocal:`${date}T19:00`,endLocal:`${date}T19:45`,timezone:"America/Sao_Paulo",priceCents:5000,priceType:"FIXED",durationMin:45,quote:"q",
      exception:{causes:["OUTSIDE_WORKING_HOURS" as const],reason:EXCEPTION_DEFAULT_REASON,reason_source:"DEFAULT" as const,conflict_hash:"h"}};
    await expect(executeSchedulingCreate(tx,actor,s,"key")).resolves.toBe("new");
    expect(state.createAppointment).toHaveBeenCalledWith(tx,expect.objectContaining({canOverrideSchedule:true,scheduleOverrideReason:EXCEPTION_DEFAULT_REASON,origin:"ADMIN"}));
    expect(state.journal).toEqual([expect.objectContaining({action:"SECRETARY_SCHEDULE_EXCEPTION_CREATE",entityId:"new",reason:EXCEPTION_DEFAULT_REASON})]);
    // A block added after the proposal changes the causes: nothing is booked.
    state.createAppointment.mockClear();
    state.day.blocks.push({professionalId:"pro",startAt:instant("18:30"),endAt:instant("20:00")} as never);
    await expect(executeSchedulingCreate(tx,actor,s,"key2")).rejects.toThrow("SCHEDULE_CHANGED");
    expect(state.createAppointment).not.toHaveBeenCalled();
    // A role that lost the permission: nothing is booked.
    state.day.blocks.length=0;state.role="RECEPTIONIST";
    await expect(executeSchedulingCreate(tx,actor,s,"key3")).rejects.toThrow("FORBIDDEN");
    expect(state.createAppointment).not.toHaveBeenCalled();
  });
});
