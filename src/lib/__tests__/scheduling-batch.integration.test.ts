import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { confirmActionBatch, latestBatch } from "../scheduling-batch";
import * as visit from "../visit-scheduling";
import { dateKeyInTimeZone,addCalendarDays,localDateTimeToUtc } from "../time";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent } from "../../test/secretary-capability-plan";
const suite=process.env.RUN_SERVICE_MVP_INTEGRATION==="1"?describe:describe.skip;
const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL??process.env.DATABASE_URL}}});
const tz="America/Sao_Paulo";
async function fixture(account=false){
  const salonId=randomUUID();return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const user=await tx.user.create({data:{name:"Tatiana",email:`actions-${salonId}@example.test`,passwordHash:"synthetic-no-login"}});
    await tx.salon.create({data:{id:salonId,name:"Synthetic Gate23",slug:`actions-${salonId}`,accessStatus:"APPROVED",plan:"PRO",timezone:tz}});
    await tx.membership.create({data:{salonId,userId:user.id,role:"OWNER"}});
    const client=await tx.clientProfile.create({data:{salonId,name:"Amanda Souza",...(account?{passwordHash:"synthetic-account-never-model"}:{})}});
    const room=await tx.physicalResource.create({data:{salonId,name:"Sala sintética",kind:"ROOM"}});
    const service=await tx.service.create({data:{salonId,name:"Progressiva",priceCents:12000,durationMin:60,processingMin:20,finishingMin:10,physicalResourceId:room.id}});
    const professional=await tx.professional.create({data:{salonId,userId:user.id}});
    await tx.professionalService.create({data:{serviceId:service.id,professionalId:professional.id}});
    await tx.workingHours.createMany({data:Array.from({length:7},(_,weekday)=>({salonId,professionalId:professional.id,weekday,startMinutes:540,endMinutes:1080}))});
    const replacement=await tx.clientProfile.create({data:{salonId,name:"Fábio Silva"}});
    return {actor:{salonId,userId:user.id},replacement,client,service,professional,room,date:addCalendarDays(dateKeyInTimeZone(new Date(),tz),1)};
  });
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function booking(f:Fixture,time="10:00"){
  return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
    const startAt=localDateTimeToUtc(`${f.date}T${time}`,tz),endAt=new Date(+startAt+3600000);
    return tx.appointment.create({data:{salonId:f.actor.salonId,clientId:f.client.id,professionalId:f.professional.id,serviceId:f.service.id,startAt,endAt,timezone:tz,priceCents:12000,status:"CONFIRMED",notes:"Preservar anotação sintética",serviceItems:{create:{serviceId:f.service.id,position:0,serviceName:"Progressiva",durationMin:60,priceCents:12000,processingMin:20,finishingMin:10}}}});
  });
}
const selection=(a:object={},b:object={})=>({skills:["scheduling"],independent:false,operations:[
  intent("appointment.cancel",{item_key:"a",depends_on:[],customer_name:"Amanda",day_offset:1,time:"10:00",reason:"Substituição solicitada",...a}),
  intent("appointment.create",{item_key:"b",depends_on:["a"],released_slot_of:"a",customer_name:"Fábio",service_name:"Progressiva",...b}),
]});
async function conversation(f:Fixture,a:object={},b:object={},continuations:object[]=[]){
  const fake=new ScriptedServicesModel([call("select_capabilities",selection(a,b)),...continuations.map(p=>call("upsert_action_draft",p))]);
  const factory=vi.fn(async()=>fake),secretary=new SalonSecretary(factory,()=>"fake-gate24"),session=(await secretary.start(f.actor,"auto")).sessionId;
  const view=await secretary.send(f.actor,{sessionId:session,message:"Cancele Amanda e coloque Fábio nesse horário. Motivo: Substituição solicitada."});
  return {fake,factory,secretary,session,view};
}
const state=(c:Awaited<ReturnType<typeof conversation>>)=>c.view.operations![0].state.batch!;
const pi=(p:{proposal_ref:string;draft_revision:number})=>({proposal_ref:p.proposal_ref,draft_revision:p.draft_revision});
const confirm=(f:Fixture,c:Awaited<ReturnType<typeof conversation>>)=>c.secretary.confirmAutomatic(f.actor,c.session,c.view.operations![0].operation_ref,pi(state(c).proposal!));
const read=(f:Fixture,id:string)=>withTenant(f.actor,tx=>tx.appointment.findFirstOrThrow({where:{id,salonId:f.actor.salonId}}));
const count=(f:Fixture)=>withTenant(f.actor,tx=>tx.appointment.count({where:{salonId:f.actor.salonId,clientId:f.replacement.id}}));
suite("Gate24 batch / real runtime PostgreSQL / fake model",()=>{
  const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});
  beforeAll(async()=>{console.log("GATE24_PREFLIGHT",await assertMvpTestDatabase(admin));expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");vi.stubGlobal("fetch",network);
    const [role]=await prisma.$queryRaw<{rolsuper:boolean;rolbypassrls:boolean}[]>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({rolsuper:false,rolbypassrls:false});
  });
  afterAll(async()=>{expect(network).not.toHaveBeenCalled();vi.unstubAllGlobals();await admin.$disconnect();await prisma.$disconnect();});
  it("A/H/N/T: projected slot, atomic commit, receipt replay, no extra inference",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f),s=state(c);
    expect(s.draft?.status).toBe("READY");expect(s.proposal?.preview).toContain("depende do horário");
    expect(s.proposal?.snapshot?.create).toMatchObject({customer_ref:f.replacement.id,startLocal:`${f.date}T10:00`,professional_ref:f.professional.id});
    expect((await read(f,a.id)).status).toBe("CONFIRMED");expect(await count(f)).toBe(0);
    const done=await confirm(f,c),receipt=done.operations![0].state.batch!.receipt!;
    expect((await read(f,a.id)).status).toBe("CANCELLED");expect(await count(f)).toBe(1);
    expect(receipt.results.map(x=>x.outcome)).toEqual(["CANCELLED","CONFIRMED"]);
    const eventCounts=await withTenant(f.actor,async tx=>({events:await tx.appointmentEvent.count({where:{salonId:f.actor.salonId}}),outbox:await tx.notificationOutbox.count({where:{salonId:f.actor.salonId}})}));
    const repeat=await withTenant(f.actor,tx=>confirmActionBatch(tx,f.actor,pi(s.proposal!)));
    expect(repeat).toEqual({...receipt,duplicate:true});expect(await count(f)).toBe(1);
    expect(await withTenant(f.actor,async tx=>({events:await tx.appointmentEvent.count({where:{salonId:f.actor.salonId}}),outbox:await tx.notificationOutbox.count({where:{salonId:f.actor.salonId}})}))).toEqual(eventCounts);
    expect(c.fake.requests).toHaveLength(1);expect(eventCounts.events).toBe(2);expect(eventCounts.outbox).toBeGreaterThan(0);
    console.log("GATE24_LATENCY",JSON.stringify(done.operations![0].state.batch!.metrics));
  });
  it.each([{customer_name:"Ausente"},{service_name:"Ausente"},{professional_name:"Ausente"}])("B/C/D: missing/ineligible entity blocks all effects %j",async fields=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f,{},fields);expect(state(c).proposal).toBeUndefined();expect((await read(f,a.id)).status).toBe("CONFIRMED");expect(await count(f)).toBe(0);
  });
  it("E: missing service continues SAME batch and preserves cancellation and edge",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f,{}, {service_name:null},[{item_key:"b",service_name:"Progressiva"}]);
    const first=state(c);expect(first.draft?.missing_fields).toEqual(["b.service_name"]);expect(first.proposal).toBeUndefined();
    const next=await c.secretary.send(f.actor,{sessionId:c.session,message:"Progressiva"}),s=next.operations![0].state.batch!;
    expect(s.draft?.draft_ref).toBe(first.draft?.draft_ref);expect(s.plan.items[0]).toEqual(first.plan.items[0]);expect(s.plan.items[1].depends_on).toEqual(["a"]);expect(s.proposal).toBeTruthy();
    expect((await read(f,a.id)).status).toBe("CONFIRMED");expect(await count(f)).toBe(0);expect(c.fake.requests).toHaveLength(2);
    expect(JSON.stringify(c.fake.requests[1])).not.toContain("appointment_ref");
  });
  it("F: new block before confirmation rejects all operations",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f);
    await admin.timeOff.create({data:{professionalId:f.professional.id,startAt:a.startAt,endAt:a.endAt,reason:"Synthetic concurrent block"}});
    await expect(confirm(f,c)).rejects.toThrow();expect((await read(f,a.id)).status).toBe("CONFIRMED");expect(await count(f)).toBe(0);
  });
  it("G: failure inside second executor rolls cancellation/events/outbox/resources back",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f);
    const real=visit.createVisit;const spy=vi.spyOn(visit,"createVisit").mockImplementationOnce(async(tx,input)=>{await real(tx,input);throw Error("SYNTHETIC_SECOND_FAILURE");});
    try{await expect(confirm(f,c)).rejects.toThrow("SYNTHETIC_SECOND_FAILURE");}finally{spy.mockRestore();}
    expect(await read(f,a.id)).toMatchObject({status:"CONFIRMED",version:a.version});expect(await count(f)).toBe(0);
    expect(await withTenant(f.actor,tx=>tx.appointmentEvent.count({where:{salonId:f.actor.salonId}}))).toBe(0);
    expect(await withTenant(f.actor,tx=>tx.notificationOutbox.count({where:{salonId:f.actor.salonId}}))).toBe(0);
    expect(await withTenant(f.actor,tx=>tx.resourceBooking.count({where:{appointmentId:a.id,active:true}}))).toBe(1);
  });
  it("I: simultaneous confirmations have one receipt and one effect",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f),p=pi(state(c).proposal!);
    const results=await Promise.all([withTenant(f.actor,tx=>confirmActionBatch(tx,f.actor,p)),withTenant(f.actor,tx=>confirmActionBatch(tx,f.actor,p))]);
    expect(results.map(r=>r.duplicate).sort()).toEqual([false,true]);expect(results[0].receipt_ref).toBe(results[1].receipt_ref);expect(await count(f)).toBe(1);expect((await read(f,a.id)).version).toBe(a.version+1);
  });
  it("J: cross tenant and revoked role cannot execute or replay",async()=>{
    const f=await fixture(),other=await fixture();await booking(f);const c=await conversation(f),p=pi(state(c).proposal!);
    await expect(withTenant(other.actor,tx=>confirmActionBatch(tx,other.actor,p))).rejects.toThrow("PROPOSAL_NOT_FOUND");
    await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;await tx.membership.updateMany({where:f.actor,data:{role:"RECEPTIONIST"}});});
    await expect(withTenant(f.actor,tx=>confirmActionBatch(tx,f.actor,p))).rejects.toThrow("FORBIDDEN");expect(await count(f)).toBe(0);
  });
  it("revision change invalidates old proposal",async()=>{
    const f=await fixture();await booking(f);const c=await conversation(f,{}, {},[{item_key:"a",reason:"Outro motivo explícito"}]),old=pi(state(c).proposal!);
    await c.secretary.send(f.actor,{sessionId:c.session,message:"Outro motivo explícito"});
    await expect(withTenant(f.actor,tx=>confirmActionBatch(tx,f.actor,old))).rejects.toThrow("REVISION_CONFLICT");
  });
  it("O: STAFF cancellation preserves waitlist without promotion",async()=>{
    const f=await fixture(),a=await booking(f);
    await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;await tx.waitlistEntry.create({data:{salonId:f.actor.salonId,appointmentId:a.id,clientId:f.client.id,professionalId:f.professional.id,startAt:a.startAt,endAt:a.endAt,timezone:tz,serviceSnapshots:[],priceCents:12000}});});
    const c=await conversation(f);await confirm(f,c);expect(await count(f)).toBe(1);
    expect(await withTenant(f.actor,tx=>tx.waitlistEntry.count({where:{appointmentId:a.id,fulfilledAt:null,cancelledAt:null}}))).toBe(1);
  });
  it("P: conflicting physical resource from another professional rolls back original",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f);
    // Reserve a resource needed by the replacement, without editing original appointment.
    await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
      await tx.physicalResource.update({where:{id:f.room.id},data:{active:false}});
    });
    await expect(confirm(f,c)).rejects.toThrow();expect((await read(f,a.id)).status).toBe("CONFIRMED");expect(await count(f)).toBe(0);
  });
  it("ambiguity requires selection and reuses same batch",async()=>{
    const f=await fixture();await booking(f);const second=await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;return tx.clientProfile.create({data:{salonId:f.actor.salonId,name:"Fábio Souza"}});});void second;
    const c=await conversation(f),s=state(c);expect(s.draft?.candidates?.items).toHaveLength(2);expect(s.proposal).toBeUndefined();
    const next=await c.secretary.selectAutomatic(f.actor,c.session,c.view.operations![0].operation_ref,f.replacement.id);
    expect(next.operations![0].state.batch?.draft?.draft_ref).toBe(s.draft?.draft_ref);expect(next.operations![0].state.batch?.proposal).toBeTruthy();
    const persisted=await withTenant(f.actor,tx=>latestBatch(tx,f.actor,s.draft!.draft_ref));expect(persisted.plan.items[1].fields.customer_ref).toBe(f.replacement.id);
  });
  it("P/F: two batches compete for the same new resource; loser keeps original intact",async()=>{
    const f=await fixture(),a=await booking(f);
    const extra=await admin.$transaction(async tx=>{
      await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
      const resource=await tx.physicalResource.create({data:{salonId:f.actor.salonId,name:"Recurso novo disputado",kind:"ROOM"}});
      const cut=await tx.service.create({data:{salonId:f.actor.salonId,name:"Corte masculino",durationMin:30,priceCents:5000,physicalResourceId:resource.id}});
      const user=await tx.user.create({data:{name:"Ana Lima",email:`batch-${randomUUID()}@local.test`,passwordHash:"synthetic"}});
      const pro=await tx.professional.create({data:{salonId:f.actor.salonId,userId:user.id}});
      const plain=await tx.service.create({data:{salonId:f.actor.salonId,name:"Serviço sem sala",durationMin:60,priceCents:4000}});
      await tx.professionalService.createMany({data:[{serviceId:cut.id,professionalId:pro.id},{serviceId:cut.id,professionalId:f.professional.id},{serviceId:plain.id,professionalId:pro.id}]});
      await tx.workingHours.createMany({data:Array.from({length:7},(_,weekday)=>({salonId:f.actor.salonId,professionalId:pro.id,weekday,startMinutes:540,endMinutes:1080}))});
      const original=await tx.appointment.create({data:{salonId:f.actor.salonId,clientId:f.client.id,professionalId:pro.id,serviceId:plain.id,startAt:a.startAt,endAt:a.endAt,timezone:tz,priceCents:4000,status:"CONFIRMED"}});
      return {original};
    });
    const x=await conversation(f,{professional_name:"Tatiana"},{service_name:"Corte masculino",professional_name:"Tatiana"});
    const y=await conversation(f,{professional_name:"Ana Lima"},{service_name:"Corte masculino",professional_name:"Ana Lima"});
    expect(state(x).proposal).toBeTruthy();expect(state(y).proposal).toBeTruthy();
    const results=await Promise.allSettled([confirm(f,x),confirm(f,y)]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const originals=await Promise.all([read(f,a.id),read(f,extra.original.id)]);expect(originals.filter(r=>r.status==="CONFIRMED")).toHaveLength(1);expect(await count(f)).toBe(1);
  });
  it("duration extending into another booking fails projected validation",async()=>{
    const f=await fixture(),a=await booking(f);await booking(f,"11:00");
    await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;await tx.service.update({where:{id:f.service.id},data:{durationMin:120}});});
    const c=await conversation(f);expect(state(c).proposal).toBeUndefined();expect(state(c).draft?.status).toBe("BLOCKED");expect((await read(f,a.id)).status).toBe("CONFIRMED");
  });
  it("new customer revision invalidates batch without cancelling original",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f);
    await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;await tx.clientProfile.update({where:{id:f.replacement.id},data:{name:"Fábio Silva Atualizado"}});});
    await expect(confirm(f,c)).rejects.toThrow("SCHEDULE_CHANGED");expect((await read(f,a.id)).status).toBe("CONFIRMED");expect(await count(f)).toBe(0);
  });
});
