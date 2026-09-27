import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { SalonSecretary } from "../salon-secretary";
import { dateKeyInTimeZone,addCalendarDays,localDateTimeToUtc } from "../time";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";
const suite=process.env.RUN_SERVICE_MVP_INTEGRATION==="1"?describe:describe.skip;
const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL??process.env.DATABASE_URL}}});
const tz="America/Sao_Paulo";
async function fixture(){
  const salonId=randomUUID();return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const user=await tx.user.create({data:{name:"Tatiana",email:`echo-${salonId}@example.test`,passwordHash:"synthetic-no-login"}});
    await tx.salon.create({data:{id:salonId,name:"Synthetic option echo",slug:`echo-${salonId}`,accessStatus:"APPROVED",plan:"PRO",timezone:tz}});
    await tx.membership.create({data:{salonId,userId:user.id,role:"OWNER"}});
    const client=await tx.clientProfile.create({data:{salonId,name:"Amanda Souza"}});
    const service=await tx.service.create({data:{salonId,name:"Escova",priceCents:6000,durationMin:45}});
    const professional=await tx.professional.create({data:{salonId,userId:user.id}});
    await tx.professionalService.create({data:{serviceId:service.id,professionalId:professional.id}});
    await tx.workingHours.createMany({data:Array.from({length:7},(_,weekday)=>({salonId,professionalId:professional.id,weekday,startMinutes:540,endMinutes:1140}))});
    const today=dateKeyInTimeZone(new Date(),tz);
    return {actor:{salonId,userId:user.id},client,service,professional,tomorrow:addCalendarDays(today,1),after:addCalendarDays(today,2)};
  });
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function booking(f:Fixture,date:string,time:string){
  return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
    const startAt=localDateTimeToUtc(`${date}T${time}`,tz),endAt=new Date(+startAt+45*60000);
    return tx.appointment.create({data:{salonId:f.actor.salonId,clientId:f.client.id,professionalId:f.professional.id,serviceId:f.service.id,startAt,endAt,timezone:tz,priceCents:6000,status:"CONFIRMED",serviceItems:{create:{serviceId:f.service.id,position:0,serviceName:"Escova",durationMin:45,priceCents:6000}}}});
  });
}
/** "Muda um dos horários da Amanda para depois de amanhã às 16h" lists two options;
 * the answer's patch (with literal evidence, as on the V2 wire) is scripted exactly
 * as Luna produced it in Golden v15 GF13. */
async function choose(f:Fixture,answer:string,patch:object){
  const first=intent("appointment.change",{customer_name:"Amanda",day_offset:2,time:"16:00"});
  const fake=new ScriptedServicesModel([call("select_capabilities",plan([first])),call("upsert_action_draft",{operation:null,...patch})]);
  const secretary=new SalonSecretary(vi.fn(async()=>fake),()=>"fake-option-echo"),session=(await secretary.start(f.actor,"auto")).sessionId;
  const listed=await secretary.send(f.actor,{sessionId:session,message:"Muda um dos horários da Amanda para depois de amanhã às 16h."});
  const options=listed.operations![0].state.scheduling!.candidates?.items??[];
  const next=await secretary.send(f.actor,{sessionId:session,message:answer});
  return {options,scheduling:next.operations![0].state.scheduling!};
}
suite("Option echo: a copied option coordinate is never evidence (PostgreSQL, fake model)",()=>{
  const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});
  beforeAll(async()=>{console.log("OPTION_ECHO_PREFLIGHT",await assertMvpTestDatabase(admin));expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");vi.stubGlobal("fetch",network);});
  afterAll(async()=>{expect(network).not.toHaveBeenCalled();vi.unstubAllGlobals();await admin.$disconnect();await prisma.$disconnect();});
  it("proven clock selects one option and the copied day agrees: proposal for that appointment",async()=>{
    const f=await fixture(),a=await booking(f,f.tomorrow,"14:00");await booking(f,f.after,"11:00");
    const {options,scheduling}=await choose(f,"O das 14h.",{source_date:f.tomorrow,source_time:"14:00",temporal_evidence:[{field:"source_date",text:"O das 14h"},{field:"source_time",text:"das 14h"}]});
    expect(options).toHaveLength(2);
    expect(scheduling.proposal?.action_snapshot?.appointment_ref).toBe(a.id);
    expect(scheduling.fields.source_date).toBeUndefined();expect(scheduling.fields.source_time).toBe("14:00");
  });
  it("copied day contradicts the option selected by the proven clock: asks, no proposal",async()=>{
    const f=await fixture();await booking(f,f.tomorrow,"14:00");await booking(f,f.after,"11:00");
    const {scheduling}=await choose(f,"O das 14h.",{source_date:f.after,source_time:"14:00",temporal_evidence:[{field:"source_date",text:"O das 14h"},{field:"source_time",text:"das 14h"}]});
    expect(scheduling.proposal).toBeUndefined();expect(scheduling.fields.appointment_ref).toBeUndefined();
  });
  it("nothing proven in the answer: the copied day selects nothing",async()=>{
    const f=await fixture();await booking(f,f.tomorrow,"14:00");await booking(f,f.after,"11:00");
    const {scheduling}=await choose(f,"Esse.",{source_date:f.tomorrow,temporal_evidence:[{field:"source_date",text:"Esse"}]});
    expect(scheduling.proposal).toBeUndefined();expect(scheduling.fields.appointment_ref).toBeUndefined();
  });
  it("proven clock matches two options: the copied day does not break the tie",async()=>{
    const f=await fixture();await booking(f,f.tomorrow,"14:00");await booking(f,f.after,"14:00");
    const {scheduling}=await choose(f,"O das 14h.",{source_date:f.tomorrow,source_time:"14:00",temporal_evidence:[{field:"source_date",text:"O das 14h"},{field:"source_time",text:"das 14h"}]});
    expect(scheduling.proposal).toBeUndefined();expect(scheduling.fields.appointment_ref).toBeUndefined();
  });
});
