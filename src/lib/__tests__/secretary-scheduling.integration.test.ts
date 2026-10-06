import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { confirmAppointmentCreate,proposeAppointmentCreate } from "../scheduling-actions";
import { getSchedulingAppointment,getSchedulingAvailability,listSchedulingAppointments } from "../scheduling-catalog";
import { dateKeyInTimeZone,addCalendarDays,localDateTimeToUtc } from "../time";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";
const suite=process.env.RUN_SERVICE_MVP_INTEGRATION==="1"?describe:describe.skip;
const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL??process.env.DATABASE_URL}}});
async function fixture(){
  const salonId=randomUUID();
  return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const user=await tx.user.create({data:{name:"Tatiana",email:`schedule-${salonId}@example.test`,passwordHash:"not-a-login-hash"}});
    await tx.salon.create({data:{id:salonId,name:"Synthetic Scheduling",slug:`schedule-${salonId}`,accessStatus:"APPROVED",plan:"PRO",timezone:"America/Sao_Paulo"}});
    await tx.membership.create({data:{salonId,userId:user.id,role:"OWNER"}});
    const client=await tx.clientProfile.create({data:{salonId,name:"Amanda Souza",passwordHash:"never-return-this"}});
    const service=await tx.service.create({data:{salonId,name:"Progressiva",priceCents:12000,durationMin:90,processingMin:30,finishingMin:15}});
    const professional=await tx.professional.create({data:{salonId,userId:user.id}});
    await tx.professionalService.create({data:{serviceId:service.id,professionalId:professional.id}});
    await tx.workingHours.createMany({data:Array.from({length:7},(_,weekday)=>({salonId,professionalId:professional.id,weekday,startMinutes:540,endMinutes:1080}))});
    return {actor:{salonId,userId:user.id},client,service,professional,date:addCalendarDays(dateKeyInTimeZone(new Date(),"America/Sao_Paulo"),1)};
  });
}
const appointmentIntent=(fields:object={})=>intent("appointment.create",{customer_name:"Amanda",service_name:"Progressiva",day_offset:1,time:"10:00",...fields});
async function conversation(f:Awaited<ReturnType<typeof fixture>>,ops=[appointmentIntent()],continuation:object[]=[],message="Marque Amanda amanhã às 10h para Progressiva."){
  const fake=new ScriptedServicesModel([call("select_capabilities",plan(ops)),...continuation.map(p=>call("upsert_action_draft",{operation:null,...p}))]);
  const secretary=new SalonSecretary(async()=>fake,()=>"fake-scheduling");const s=await secretary.start(f.actor,"auto");
  const send=(message:string)=>secretary.send(f.actor,{sessionId:s.sessionId,message});
  const state=await send(message);
  return {fake,secretary,session:s.sessionId,state,send};
}
const sched=(c:{state:Awaited<ReturnType<SalonSecretary["send"]>>})=>c.state.operations!.find(x=>x.state.scheduling)!.state.scheduling!;
const pi=(p:{proposal_ref:string;draft_revision:number})=>({proposal_ref:p.proposal_ref,draft_revision:p.draft_revision});
const count=(f:Awaited<ReturnType<typeof fixture>>)=>withTenant(f.actor,tx=>tx.appointment.count({where:{salonId:f.actor.salonId}}));
describe("Scheduling synthetic clock source fidelity (offline)",()=>{
  it("rejects the original fixture mismatch rather than silently accepting fake11h",async()=>{
    const {groundSchedulingTemporal}=await import("../scheduling-temporal-source");
    const grounded=groundSchedulingTemporal({},{day_offset:1,time:"11:00"},"Marque Amanda amanhã às 10h para Progressiva.","America/Sao_Paulo",new Date("2027-04-12T12:00:00Z"),undefined,"appointment.create");
    expect(grounded.fields.time).toBeUndefined();expect(grounded.rejected).toContainEqual(expect.objectContaining({field:"time"}));
  });
  it.each(["08","11","13","16"])("corrected %sh input passes temporal proof before agenda validation",async hour=>{
    const {groundSchedulingTemporal}=await import("../scheduling-temporal-source");
    const grounded=groundSchedulingTemporal({},{day_offset:1,time:hour+":00"},"Marque Amanda amanhã às "+hour+"h para Progressiva.","America/Sao_Paulo",new Date("2027-04-12T12:00:00Z"),undefined,"appointment.create");
    expect(grounded.rejected).toEqual([]);expect(grounded.fields).toEqual({date:"2027-04-13",time:hour+":00"});
  });
});
suite("Scheduling Core PostgreSQL and fake SDK",()=>{
  const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});
  beforeAll(async()=>{console.log("SCHEDULING_PREFLIGHT",await assertMvpTestDatabase(admin));expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");vi.stubGlobal("fetch",network);});
  afterAll(async()=>{expect(network).not.toHaveBeenCalled();vi.unstubAllGlobals();await admin.$disconnect();await prisma.$disconnect();});
  it("temporal create: period correction, concrete replacement and new date preserve resolved identities",async()=>{
    const f=await fixture(),c=await conversation(f,[appointmentIntent({time:"11:00"})],[{period:"afternoon",customer_name:"Amanda",service_name:"Progressiva"},{time:"14:00"},{day_offset:2}],"Marque Amanda amanhã às 11h para Progressiva.");
    const first=sched(c),refs={customer_ref:f.client.id,service_ref:f.service.id,professional_ref:f.professional.id};
    const vague=await c.send("depois do almoço"),v=vague.operations![0].state.scheduling!;
    expect(v.fields).toMatchObject({...refs,period:"afternoon"});expect(v.fields.time).toBeUndefined();expect(v.draft?.fields.time).toBeUndefined();expect(v.proposal).toBeUndefined();
    await expect(withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(first.proposal!)))).rejects.toThrow("REVISION_CONFLICT");
    const exact=await c.send("às quatorze em ponto"),e=exact.operations![0].state.scheduling!;
    expect(e.proposal?.snapshot?.startLocal).toBe(`${f.date}T14:00`);expect(e.fields.period).toBe("afternoon");
    const date=await c.send("mude para depois de amanhã"),d=date.operations![0].state.scheduling!;
    expect(d.fields).toMatchObject({...refs,date:addCalendarDays(f.date,1),time:"14:00",period:"afternoon"});
    expect(d.proposal?.snapshot?.date).toBe(addCalendarDays(f.date,1));expect(d.draft?.draft_ref).toBe(first.draft?.draft_ref);expect(await count(f)).toBe(0);
    await expect(withTenant(f.actor,tx=>getSchedulingAvailability(tx,f.actor,{service_ref:f.service.id,professional_ref:f.professional.id,date:f.date,time:"11:00",period:"afternoon"}))).rejects.toThrow("TEMPORAL_CONFLICT");
  });
  it("A/M: real quote, no premature insert, authenticated confirmation and durable replay",async()=>{
    const f=await fixture(),c=await conversation(f),s=sched(c);expect(s.proposal?.snapshot).toMatchObject({customer_name:"Amanda Souza",service_name:"Progressiva",professional_name:"Tatiana",date:f.date,startLocal:`${f.date}T10:00`,endLocal:`${f.date}T11:30`,priceCents:12000,durationMin:90});
    expect(await count(f)).toBe(0);const op=c.state.operations![0];const done=await c.secretary.confirmAutomatic(f.actor,c.session,op.operation_ref,pi(s.proposal!));
    expect(done.operations![0].state.scheduling?.receipt?.appointment_ref).toBeTruthy();expect(await count(f)).toBe(1);expect(c.fake.requests).toHaveLength(1);
    const again=await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(s.proposal!)));expect(again.duplicate).toBe(true);expect(await count(f)).toBe(1);
    const rows=await withTenant(f.actor,tx=>tx.appointmentService.findMany({where:{salonId:f.actor.salonId}}));expect(rows[0]).toMatchObject({processingMin:30,finishingMin:15});
    const events=await withTenant(f.actor,tx=>tx.notificationOutbox.count({where:{salonId:f.actor.salonId}}));expect(events).toBeGreaterThan(0);
    process.stdout.write(`SCHEDULING_FAKE_LATENCY ${JSON.stringify(done.operations![0].state.scheduling?.metrics)}\n`);
  });
  it("B/K: unavailable slot returns real alternatives; changed slot invalidates earlier proposal",async()=>{
    const f=await fixture(),a=await conversation(f),b=await conversation(f);
    await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(sched(a).proposal!)));
    await expect(withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(sched(b).proposal!)))).rejects.toThrow("SLOT_CONFLICT");
    const conflict=await conversation(f);expect(sched(conflict).proposal).toBeUndefined();expect(sched(conflict).message).toContain("indisponível");
    expect(sched(conflict).alternatives?.[0].startLocal).toBe(`${f.date}T11:30`);expect(await count(f)).toBe(1);
  });
  it("L: two concurrent confirmations on same professional/time allow only one",async()=>{
    const f=await fixture(),a=await conversation(f),b=await conversation(f);
    const results=await Promise.allSettled([a,b].map(c=>withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(sched(c).proposal!)))));
    expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(await count(f)).toBe(1);
  });
  it("C: customer ambiguity and selection preserve SAME draft/date/time",async()=>{
    const f=await fixture();await admin.clientProfile.create({data:{salonId:f.actor.salonId,name:"Amanda Silva"}});
    const c=await conversation(f),s=sched(c);expect(s.candidates?.kind).toBe("customer_ref");expect(s.proposal).toBeUndefined();
    const next=await c.secretary.selectAutomatic(f.actor,c.session,c.state.operations![0].operation_ref,f.client.id);
    const n=next.operations![0].state.scheduling!;expect(n.draft?.draft_ref).toBe(s.draft?.draft_ref);expect(n.proposal?.snapshot?.startLocal).toBe(`${f.date}T10:00`);expect(c.fake.requests).toHaveLength(1);
  });
  it.each([["customer_name","Inexistente"],["service_name","Inexistente"]])("D/E: unresolved %s never invents a reference",async(key,value)=>{
    const f=await fixture(),c=await conversation(f,[appointmentIntent({[key]:value})],[],`Marque ${key==='customer_name'?value:'Amanda'} amanhã às 10h para ${key==='service_name'?value:'Progressiva'}.`);expect(sched(c).proposal).toBeUndefined();expect(sched(c).message).toContain("Não encontrei");expect(await count(f)).toBe(0);
  });
  it("F: multiple services require selection",async()=>{
    const f=await fixture();await admin.service.create({data:{salonId:f.actor.salonId,name:"Progressiva Premium",priceCents:18000,durationMin:120}});
    const c=await conversation(f);expect(sched(c).candidates?.kind).toBe("service_ref");expect(sched(c).candidates?.items).toHaveLength(2);expect(sched(c).proposal).toBeUndefined();
    const next=await c.secretary.selectAutomatic(f.actor,c.session,c.state.operations![0].operation_ref,f.service.id);expect(next.operations![0].state.scheduling?.proposal?.snapshot?.priceCents).toBe(12000);
  });
  it("G: ineligible named professional cannot be assigned silently",async()=>{
    const f=await fixture(),c=await conversation(f,[appointmentIntent({professional_name:"Outra pessoa"})],[],"Marque Amanda amanhã às 10h para Progressiva com Outra pessoa.");expect(sched(c).proposal).toBeUndefined();expect(sched(c).candidates?.items).toEqual([{id:f.professional.id,name:"Tatiana"}]);expect(await count(f)).toBe(0);
  });
  it("H/I: missing service/time asks only needed fields and continues the same draft",async()=>{
    const f=await fixture(),c=await conversation(f,[appointmentIntent({service_name:null})],[{service_name:"Progressiva"}],"Marque Amanda amanhã às 10h.");
    expect(sched(c).message).toBe("Informe serviço.");const ref=sched(c).draft?.draft_ref;
    const next=await c.send("Progressiva.");expect(next.operations![0].state.scheduling?.draft?.draft_ref).toBe(ref);expect(next.operations![0].state.scheduling?.proposal?.snapshot?.startLocal).toBe(`${f.date}T10:00`);expect(c.fake.requests).toHaveLength(2);
    const d=await conversation(f,[appointmentIntent({time:null,period:"morning"})],[],"Marque Amanda amanhã de manhã para Progressiva.");expect(sched(d).message).toBe("Informe horário exato.");expect(sched(d).proposal).toBeUndefined();
  });
  it("J: another tenant cannot read proposal/ref; positive RLS and empty context",async()=>{
    const f=await fixture(),g=await fixture(),c=await conversation(f);const p=sched(c).proposal!;
    await expect(withTenant(g.actor,tx=>confirmAppointmentCreate(tx,g.actor,pi(p)))).rejects.toThrow("PROPOSAL_NOT_FOUND");
    await expect(withTenant(g.actor,tx=>getSchedulingAvailability(tx,g.actor,{service_ref:f.service.id,professional_ref:f.professional.id,date:f.date,time:"10:00"}))).rejects.toThrow("PRO_SERVICE_MISMATCH");
    const done=await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(p)));
    await expect(withTenant(g.actor,tx=>getSchedulingAppointment(tx,g.actor,done.appointment_ref))).rejects.toThrow("APPOINTMENT_NOT_FOUND");
    expect(await prisma.appointment.count()).toBe(0);expect(await withTenant(g.actor,tx=>tx.appointment.count({where:{salonId:f.actor.salonId}}))).toBe(0);
    const [role]=await prisma.$queryRaw<{s:boolean;b:boolean}[]>`SELECT rolsuper AS s,rolbypassrls AS b FROM pg_roles WHERE rolname=current_user`;expect(role).toEqual({s:false,b:false});
    const forbidden=await prisma.$queryRaw<{u:boolean;d:boolean}[]>`SELECT has_table_privilege(current_user,'"Appointment"','UPDATE') AS u,has_table_privilege(current_user,'"Appointment"','DELETE') AS d`;expect(forbidden[0]).toEqual({u:false,d:false});
  });
  it("T05/T06: authorized day lookup and detail DTO omit authentication data",async()=>{
    const f=await fixture(),c=await conversation(f);await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(sched(c).proposal!)));
    const rows=await withTenant(f.actor,tx=>listSchedulingAppointments(tx,f.actor,{date:f.date,customer_ref:f.client.id}));expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toMatch(/passwordHash|never-return|email/);
    const read=await conversation(f,[intent("appointment.read",{customer_name:"Amanda",day_offset:1})],[],"Consulte o agendamento da Amanda amanhã.");expect(sched(read).appointments).toHaveLength(1);expect(sched(read).proposal).toBeUndefined();
  });
  it("P: three independent Skills have separate drafts/proposals without premature writes",async()=>{
    const f=await fixture(),c=await conversation(f,[intent("service.create",{name:"Massagem",priceCents:5000,durationMin:60}),intent("customer.create",{name:"Carla Souza"}),appointmentIntent()],[],"Crie o serviço Massagem por R$50 com duração de 60 minutos, cadastre Carla Souza e marque Amanda amanhã às 10h para Progressiva.");
    expect(c.state.loaded?.map(x=>x.skill_id).sort()).toEqual(["customers","scheduling","services"]);
    const refs=c.state.operations!.map(o=>o.state.draft?.draft_ref??o.state.customer?.draft?.draft_ref??o.state.scheduling?.draft?.draft_ref);expect(new Set(refs).size).toBe(3);
    const props=c.state.operations!.map(o=>o.state.proposal?.proposal_ref??o.state.customer?.proposal?.proposal_ref??o.state.scheduling?.proposal?.proposal_ref);expect(props.every(Boolean)).toBe(true);expect(new Set(props).size).toBe(3);expect(await count(f)).toBe(0);expect(c.fake.requests).toHaveLength(1);
  });
  it("quote/revision changed and insufficient permission fail closed",async()=>{
    const f=await fixture(),c=await conversation(f),p=sched(c).proposal!;
    await expect(withTenant(f.actor,tx=>proposeAppointmentCreate(tx,f.actor,{draft_ref:p.draft_ref,draft_revision:p.draft_revision+1}))).rejects.toThrow("REVISION_CONFLICT");
    await admin.service.update({where:{id:f.service.id},data:{priceCents:13000}});
    await expect(withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(p)))).rejects.toThrow("SCHEDULE_CHANGED");expect(await count(f)).toBe(0);
    await admin.membership.updateMany({where:f.actor,data:{role:"PROFESSIONAL"}});
    await expect(withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(p)))).rejects.toThrow("FORBIDDEN");
  });
  it("resources, blocks, closures and working breaks use the actual domain",async()=>{
    const f=await fixture();const resource=await admin.physicalResource.create({data:{salonId:f.actor.salonId,name:"Sala sintética",kind:"ROOM"}});await admin.service.update({where:{id:f.service.id},data:{physicalResourceId:resource.id}});
    const c=await conversation(f);await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(sched(c).proposal!)));
    expect(await withTenant(f.actor,tx=>tx.resourceBooking.count({where:{salonId:f.actor.salonId,active:true}}))).toBe(1);
    await admin.timeOff.create({data:{professionalId:f.professional.id,startAt:localDateTimeToUtc(`${f.date}T13:00`,"America/Sao_Paulo"),endAt:localDateTimeToUtc(`${f.date}T14:00`,"America/Sao_Paulo")}});
    const blocked=await conversation(f,[appointmentIntent({time:"13:00"})],[],"Marque Amanda amanhã às 13h para Progressiva.");expect(sched(blocked).proposal).toBeUndefined();
    await admin.salonClosure.create({data:{salonId:f.actor.salonId,startAt:localDateTimeToUtc(`${f.date}T15:00`,"America/Sao_Paulo"),endAt:localDateTimeToUtc(`${f.date}T18:00`,"America/Sao_Paulo"),reason:"Sintético"}});
    const closed=await conversation(f,[appointmentIntent({time:"16:00"})],[],"Marque Amanda amanhã às 16h para Progressiva.");expect(sched(closed).proposal).toBeUndefined();
    const outside=await conversation(f,[appointmentIntent({time:"08:00"})],[],"Marque Amanda amanhã às 08h para Progressiva.");expect(sched(outside).proposal).toBeUndefined();
  });
  it("resource exclusion protects concurrent reservations across DIFFERENT professionals",async()=>{
    const f=await fixture();const room=await admin.physicalResource.create({data:{salonId:f.actor.salonId,name:"Sala compartilhada",kind:"ROOM"}});
    await admin.service.update({where:{id:f.service.id},data:{physicalResourceId:room.id}});
    const u=await admin.user.create({data:{name:"Paula",email:`paula-${randomUUID()}@example.test`,passwordHash:"not-a-login-hash"}});
    const pro=await admin.professional.create({data:{salonId:f.actor.salonId,userId:u.id}});
    await admin.professionalService.create({data:{serviceId:f.service.id,professionalId:pro.id}});
    await admin.workingHours.createMany({data:Array.from({length:7},(_,weekday)=>({salonId:f.actor.salonId,professionalId:pro.id,weekday,startMinutes:540,endMinutes:1080}))});
    const a=await conversation(f,[appointmentIntent({professional_name:"Tatiana"})],[],"Marque Amanda amanhã às 10h para Progressiva com Tatiana."),b=await conversation(f,[appointmentIntent({professional_name:"Paula"})],[],"Marque Amanda amanhã às 10h para Progressiva com Paula.");
    const results=await Promise.allSettled([a,b].map(c=>withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(sched(c).proposal!)))));
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(await count(f)).toBe(1);
  });
  it("multiple professionals require choice; T07 respects period and read filters",async()=>{
    const f=await fixture();const u=await admin.user.create({data:{name:"Paula",email:`query-${randomUUID()}@example.test`,passwordHash:"not-a-login-hash"}});
    const pro=await admin.professional.create({data:{salonId:f.actor.salonId,userId:u.id}});await admin.professionalService.create({data:{serviceId:f.service.id,professionalId:pro.id}});
    const c=await conversation(f);expect(sched(c).proposal).toBeUndefined();expect(sched(c).candidates?.items).toHaveLength(2);
    const selected=await c.secretary.selectAutomatic(f.actor,c.session,c.state.operations![0].operation_ref,f.professional.id);
    await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(selected.operations![0].state.scheduling!.proposal!)));
    const read=await conversation(f,[intent("appointment.list",{professional_name:"Paula",day_offset:1})],[],"Liste os agendamentos de amanhã com Paula.");expect(sched(read).appointments).toEqual([]);
    const free=await conversation(f,[intent("availability.get",{service_name:"Progressiva",professional_name:"Tatiana",day_offset:1,period:"afternoon"})],[],"Veja os horários disponíveis amanhã à tarde para Progressiva com Tatiana.");
    expect(sched(free).alternatives?.length).toBeGreaterThan(0);expect(sched(free).alternatives?.every(s=>Number(s.startLocal.slice(11,13))>=12)).toBe(true);
  });
  it("local schema-smoke: required RLS, constraints, tenant FKs and invoker triggers",async()=>{
    const rls=await prisma.$queryRaw<{relname:string;enabled:boolean;forced:boolean}[]>`SELECT relname,relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE relname IN ('Appointment','AppointmentService','AppointmentEvent','NotificationOutbox','ProfessionalOpening','ResourceBooking','WaitlistOffer')`;
    expect(rls).toHaveLength(7);expect(rls.every(r=>r.enabled&&r.forced)).toBe(true);
    const constraints=await prisma.$queryRaw<{conname:string}[]>`SELECT conname FROM pg_constraint WHERE conname IN ('appointment_no_overlap','resource_no_overlap','Appointment_client_tenant_fkey','Appointment_professional_tenant_fkey','Appointment_service_tenant_fkey')`;
    expect(constraints).toHaveLength(5);
    const functions=await prisma.$queryRaw<{proname:string;prosecdef:boolean}[]>`SELECT proname,prosecdef FROM pg_proc WHERE proname IN ('product_reserve_resource','booking_offer_guard')`;
    expect(functions).toHaveLength(2);expect(functions.every(f=>!f.prosecdef)).toBe(true);
  });
});
