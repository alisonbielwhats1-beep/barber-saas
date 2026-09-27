import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { confirmAppointmentCreate, upsertSchedulingDraft, proposeSchedulingAction, proposeAppointmentCreate } from "../scheduling-actions";
import { dateKeyInTimeZone,addCalendarDays,localDateTimeToUtc } from "../time";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";
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
    return {actor:{salonId,userId:user.id},client,service,professional,room,date:addCalendarDays(dateKeyInTimeZone(new Date(),tz),1)};
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
const change=(fields:object={})=>intent("appointment.change",{customer_name:"Amanda",source_day_offset:1,source_time:"10:00",time:"11:00",...fields});
const cancel=(fields:object={})=>intent("appointment.cancel",{customer_name:"Amanda",day_offset:1,time:"10:00",reason:"Pedido da cliente",...fields});
const block=(fields:object={})=>intent("schedule.block",{professional_name:"Tatiana",day_offset:1,time:"13:00",end_time:"15:00",...fields});
async function conversation(f:Fixture,operation=change(),continuations:object[]=[],sourceMessage="Pedido sintético do cenário"){
  const fake=new ScriptedServicesModel([call("select_capabilities",plan([operation])),...continuations.map(p=>call("upsert_action_draft",{operation:null,...p}))]);
  const factory=vi.fn(async()=>fake),secretary=new SalonSecretary(factory,()=>"fake-gate23"),session=(await secretary.start(f.actor,"auto")).sessionId;
  const state=await secretary.send(f.actor,{sessionId:session,message:sourceMessage});
  return {fake,factory,secretary,session,state};
}
const state=(c:Awaited<ReturnType<typeof conversation>>)=>c.state.operations![0].state.scheduling!;
const pi=(p:{proposal_ref:string;draft_revision:number})=>({proposal_ref:p.proposal_ref,draft_revision:p.draft_revision});
const confirm=(f:Fixture,c:Awaited<ReturnType<typeof conversation>>)=>c.secretary.confirmAutomatic(f.actor,c.session,c.state.operations![0].operation_ref,pi(state(c).proposal!));
const read=(f:Fixture,id:string)=>withTenant(f.actor,tx=>tx.appointment.findFirstOrThrow({where:{id,salonId:f.actor.salonId}}));
describe("Scheduling action synthetic source fidelity (offline)",()=>{
  it("the preserved original placeholder cannot prove an extracted service",async()=>{
    const {assertSeparateServiceMention}=await import("../scheduling-entity-mentions");
    expect(()=>assertSeparateServiceMention("Pedido sintético do cenário","Progressiva",["Amanda Souza"])).toThrow("ENTITY_MENTION_CONFLICT");
    expect(()=>assertSeparateServiceMention("Muda a Amanda na Progressiva com Tatiana de amanhã às 10h para amanhã.","Progressiva",["Amanda Souza"])).not.toThrow();
  });
  it("the corrected source leaves only destination clock awaiting input",async()=>{
    const {groundSchedulingTemporal}=await import("../scheduling-temporal-source");
    const grounded=groundSchedulingTemporal({},{source_day_offset:1,source_time:"10:00",day_offset:1},"Muda a Amanda na Progressiva com Tatiana de amanhã às 10h para amanhã.",tz,new Date("2027-04-12T12:00:00Z"),undefined,"appointment.change");
    expect(grounded.rejected).toEqual([]);expect(grounded.fields).toMatchObject({source_date:"2027-04-13",source_time:"10:00",date:"2027-04-13"});expect(grounded.fields.time).toBeUndefined();
  });
});
suite("Gate 2.3 actions / runtime PostgreSQL / fake model",()=>{
  const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});
  beforeAll(async()=>{console.log("GATE23_PREFLIGHT",await assertMvpTestDatabase(admin));expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");vi.stubGlobal("fetch",network);});
  afterAll(async()=>{expect(network).not.toHaveBeenCalled();vi.unstubAllGlobals();await admin.$disconnect();await prisma.$disconnect();});
  it("P3 actual PostgreSQL journal retains accepted destination after a rejected retarget",async()=>{
    const {groundSchedulingTemporal}=await import("../scheduling-temporal-source");
    const f=await fixture(),fields={customer_name:"Amanda Souza",date:f.date,time:"09:00"};
    const first=await withTenant(f.actor,tx=>upsertSchedulingDraft(tx,f.actor,{operation:"appointment.change",fields}));
    const grounded=groundSchedulingTemporal(fields,{time:"11:00"},"11h",tz,new Date(),"source_time","appointment.change",[{field:"time",text:"11h"}]);
    const next=await withTenant(f.actor,tx=>upsertSchedulingDraft(tx,f.actor,{operation:"appointment.change",fields:grounded.fields,rejected_temporal:grounded.rejected,draft_ref:first.draft_ref,expected_revision:first.draft_revision}));
    expect(next.fields).toEqual(fields);expect(next.temporal_missing).toEqual(["source_time"]);expect(next.status).toBe("NEEDS_INPUT");
    await expect(withTenant(f.actor,tx=>proposeSchedulingAction(tx,f.actor,{draft_ref:next.draft_ref,draft_revision:next.draft_revision}))).rejects.toThrow("NEEDS_INPUT");
    const audit=await withTenant(f.actor,tx=>tx.auditLog.findMany({where:{salonId:f.actor.salonId,entityId:next.draft_ref},select:{action:true,metadata:true}}));
    expect(audit.filter(r=>r.action==="DRAFT")).toHaveLength(2);expect(audit.some(r=>r.action==="PROPOSAL"||r.action==="CONFIRMED")).toBe(false);
    expect(audit.find(r=>r.action==="TEMPORAL_RECONCILED")?.metadata).toMatchObject({rejected:expect.arrayContaining([expect.objectContaining({field:"time",retained_value:"09:00"})])});
  });
  it.each([false,true])("temporal A/F/G/H: rejected time never effective, even if repeated in patch (%s)",async repeated=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f,change({time:null,day_offset:1,service_name:"Progressiva",professional_name:"Tatiana"}),[{period:"afternoon",...(repeated?{time:"11:00"}:{})}],"Muda a Amanda na Progressiva com Tatiana de amanhã às 10h para amanhã.");
    const initial=state(c),fast=await c.secretary.send(f.actor,{sessionId:c.session,message:"11h"}),fastOp=fast.operations![0],s=fastOp.state.scheduling!;
    expect(s.interpretation_source).toBe("DETERMINISTIC_FAST_PATH");expect(c.fake.requests).toHaveLength(1);expect(s.proposal).toBeTruthy();
    const vague=await c.secretary.send(f.actor,{sessionId:c.session,message:"depois do almoço"}),v=vague.operations![0].state.scheduling!;
    expect(v.interpretation_source).toBe("MODEL");expect(c.fake.requests).toHaveLength(2);
    expect(vague.operations![0].operation_ref).toBe(fastOp.operation_ref);expect(v.draft?.draft_ref).toBe(initial.draft?.draft_ref);
    expect(v.fields).toMatchObject({period:"afternoon",date:f.date,customer_ref:f.client.id,service_ref:f.service.id,professional_ref:f.professional.id,appointment_ref:a.id});
    expect(v.fields).not.toHaveProperty("time");expect(v.draft?.fields).not.toHaveProperty("time");
    expect(v.draft).toMatchObject({status:"NEEDS_INPUT",missing_fields:["time"]});expect(v.waiting_for).toBe("time");expect(v.proposal).toBeUndefined();
    expect(v.draft?.action_snapshot).toBeUndefined();
    expect(v.draft?.temporal_conflicts).toEqual([]);expect(v.draft?.temporal_missing).toEqual(["time"]);
    const evidence=await withTenant(f.actor,tx=>tx.auditLog.findMany({where:{salonId:f.actor.salonId,entityId:v.draft!.draft_ref,action:"TEMPORAL_RECONCILED"},select:{metadata:true}}));
    expect(evidence).toHaveLength(1);expect(evidence[0].metadata).toEqual({draft_revision:v.draft!.draft_revision,rejected:[{code:"TIME_OUTSIDE_PERIOD",field:"time",value:"11:00"}]});
    await expect(withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(s.proposal!)))).rejects.toThrow("REVISION_CONFLICT");
    const old=await read(f,a.id);expect(old).toMatchObject({version:1,startAt:a.startAt});
    expect(await withTenant(f.actor,tx=>tx.appointmentEvent.count({where:{appointmentId:a.id}}))).toBe(0);
    const corrected=await c.secretary.send(f.actor,{sessionId:c.session,message:"14h"});const fixed=corrected.operations![0].state.scheduling!;
    expect(fixed.proposal?.action_snapshot?.startLocal).toBe(`${f.date}T14:00`);expect(c.fake.requests).toHaveLength(2);
    expect(fixed.fields).toMatchObject({time:"14:00",period:"afternoon"});expect(fixed.draft?.status).toBe("READY");expect(fixed.draft?.temporal_missing).toBeUndefined();
    expect(fixed.draft?.draft_ref).toBe(v.draft?.draft_ref);expect((await read(f,a.id)).version).toBe(1);
  });
  it.each(["appointment.create","appointment.change","appointment.cancel","schedule.block"] as const)("temporal guards protect direct U03/proposal calls: %s",async operation=>{
    const f=await fixture(),a=await booking(f);
    const d=await withTenant(f.actor,tx=>upsertSchedulingDraft(tx,f.actor,{operation,fields:{appointment_ref:a.id,customer_ref:f.client.id,service_ref:f.service.id,professional_ref:f.professional.id,date:f.date,time:"11:00",period:"afternoon",reason:"Teste sintético",end_time:"15:00"}}));
    expect(d.status).toBe("NEEDS_INPUT");expect(d.temporal_conflicts).toEqual([]);expect(d.temporal_missing).toEqual(["time"]);expect(d.fields.time).toBeUndefined();expect(d.fields.period).toBe("afternoon");
    await expect(withTenant(f.actor,tx=>(operation==="appointment.create"?proposeAppointmentCreate:proposeSchedulingAction)(tx,f.actor,{draft_ref:d.draft_ref,draft_revision:d.draft_revision}))).rejects.toThrow("NEEDS_INPUT");
    const unrelated=await withTenant(f.actor,tx=>upsertSchedulingDraft(tx,f.actor,{operation,draft_ref:d.draft_ref,expected_revision:d.draft_revision,fields:{reason:"Novo motivo sintético"}}));
    expect(unrelated.fields.time).toBeUndefined();expect(unrelated.temporal_missing).toEqual(["time"]);expect(unrelated.status).toBe("NEEDS_INPUT");
    expect(await read(f,a.id)).toMatchObject({version:1,startAt:a.startAt});
    expect(await withTenant(f.actor,tx=>tx.timeOff.count({where:{professionalId:f.professional.id}}))).toBe(0);
  });
  it("temporal M: compound drafts keep independent clocks and references",async()=>{
    const f=await fixture();await booking(f);
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([change(),block(),intent("customer.create",{name:"Carla Sintética"})])),call("upsert_action_draft",{operation:null,period:"afternoon"})]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-temporal"),session=(await secretary.start(f.actor,"auto")).sessionId;
    const first=await secretary.send(f.actor,{sessionId:session,message:"Pedido composto sintético"});
    const second=await secretary.send(f.actor,{sessionId:session,operation_ref:first.operations![0].operation_ref,message:"depois do almoço"});
    expect(second.operations![0].state.scheduling?.fields.time).toBeUndefined();expect(second.operations![0].state.scheduling?.proposal).toBeUndefined();
    expect(second.operations!.slice(1)).toEqual(first.operations!.slice(1));
    expect(new Set(second.operations!.map(x=>x.state.scheduling?.draft?.draft_ref??x.state.customer?.draft?.draft_ref)).size).toBe(3);
  });
  it("A/E: same executor preserves snapshots, notes/resources; account requires acceptance",async()=>{
    const f=await fixture(true),a=await booking(f),c=await conversation(f);const s=state(c);
    expect(s.proposal?.action_snapshot).toMatchObject({appointment_ref:a.id,before_start:`${f.date}T10:00`,startLocal:`${f.date}T11:00`,requires_acceptance:true,priceCents:12000});
    expect(await read(f,a.id)).toMatchObject({startAt:a.startAt,version:a.version});
    const done=await confirm(f,c),out=done.operations![0].state.scheduling!;
    expect(out.receipt?.outcome).toBe("PENDING_ACCEPTANCE");expect(out.message).toContain("aguardando aceite");expect(out.message).not.toContain("confirmado");
    const after=await read(f,a.id);expect(after.startAt).toEqual(localDateTimeToUtc(`${f.date}T11:00`,tz));expect(after.notes).toBe(a.notes);expect(after.priceCents).toBe(12000);
    const resources=await withTenant(f.actor,tx=>tx.resourceBooking.findMany({where:{appointmentId:a.id}}));expect(resources).toHaveLength(1);expect(resources[0]).toMatchObject({active:true,startAt:after.startAt,resourceId:f.room.id});
    const snapshot=await withTenant(f.actor,tx=>tx.appointmentService.findFirstOrThrow({where:{appointmentId:a.id}}));expect(snapshot).toMatchObject({processingMin:20,finishingMin:10,priceCents:12000});
    const accept=await withTenant(f.actor,tx=>tx.rescheduleProposal.findFirstOrThrow({where:{appointmentId:a.id}}));expect(accept.status).toBe("PENDING");expect(c.fake.requests).toHaveLength(1);
    expect(JSON.stringify(c.fake.requests)).not.toMatch(/passwordHash|synthetic-account|appointment_ref/);
  });
  it("direct guest reschedule + repeated confirmation returns same receipt without reapplying",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f);await confirm(f,c);const first=await read(f,a.id);
    const again=await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(state(c).proposal!)));expect(again).toMatchObject({outcome:"RESCHEDULED",appointment_ref:a.id,duplicate:true});expect((await read(f,a.id)).version).toBe(first.version);
  });
  it("B/C: occupied at proposal or confirmation preserves original and its resources",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f);await booking(f,"11:00");
    await expect(confirm(f,c)).rejects.toThrow("SLOT_CONFLICT");expect(await read(f,a.id)).toMatchObject({startAt:a.startAt,version:a.version});
    const d=await conversation(f);expect(state(d).proposal).toBeUndefined();expect(state(d).alternatives?.[0].startLocal).toBe(`${f.date}T12:00`);
    expect(await withTenant(f.actor,tx=>tx.resourceBooking.findFirst({where:{appointmentId:a.id,active:true}}))).toMatchObject({startAt:a.startAt});
  });
  it("D: concurrent reschedules to same new slot permit one winner",async()=>{
    const f=await fixture(),a=await booking(f,"09:00"),b=await booking(f,"10:00"),x=await conversation(f,change({source_time:"09:00",time:"13:00"})),y=await conversation(f,change({time:"13:00"}));
    const result=await Promise.allSettled([confirm(f,x),confirm(f,y)]);expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const rows=await withTenant(f.actor,tx=>tx.appointment.findMany({where:{id:{in:[a.id,b.id]}}}));expect(rows.filter(r=>+r.startAt===+localDateTimeToUtc(`${f.date}T13:00`,tz))).toHaveLength(1);
  });
  it("F/G: cancellation only after confirmation, reason/events/outbox, resources released and replay",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f,cancel(),[],"Pedido sintético do cenário. Motivo: Pedido da cliente.");expect((await read(f,a.id)).status).toBe("CONFIRMED");
    await confirm(f,c);const after=await read(f,a.id);expect(after).toMatchObject({status:"CANCELLED",cancelledReason:"Pedido da cliente"});
    const again=await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(state(c).proposal!)));expect(again).toMatchObject({appointment_ref:a.id,duplicate:true,outcome:"CANCELLED"});expect((await read(f,a.id)).version).toBe(after.version);
    expect(await withTenant(f.actor,tx=>tx.resourceBooking.count({where:{appointmentId:a.id,active:true}}))).toBe(0);
    expect(await withTenant(f.actor,tx=>tx.appointmentEvent.count({where:{appointmentId:a.id,eventType:"CANCELLED"}}))).toBe(1);
    expect(await withTenant(f.actor,tx=>tx.notificationOutbox.count({where:{salonId:f.actor.salonId}}))).toBeGreaterThan(0);
  });
  it("cancellation missing reason asks, without inventing it",async()=>{
    const f=await fixture();await booking(f);const c=await conversation(f,cancel({reason:null}));expect(state(c).proposal).toBeUndefined();expect(state(c).waiting_for).toBe("reason");
  });
  it("H/I: nonexistent and multiple appointments never choose arbitrarily; selection preserves draft",async()=>{
    const f=await fixture(),missing=await conversation(f,cancel(),[],"Pedido sintético do cenário. Motivo: Pedido da cliente.");expect(state(missing).proposal).toBeUndefined();expect(state(missing).message).toContain("Não encontrei");
    const a=await booking(f);await booking(f,"14:00");const c=await conversation(f,cancel({time:null}),[],"Pedido sintético do cenário. Motivo: Pedido da cliente.");expect(state(c).candidates?.items).toHaveLength(2);
    const next=await c.secretary.selectAutomatic(f.actor,c.session,c.state.operations![0].operation_ref,a.id);const s=next.operations![0].state.scheduling!;
    expect(s.draft?.draft_ref).toBe(state(c).draft?.draft_ref);expect(s.proposal?.action_snapshot?.appointment_ref).toBe(a.id);expect(c.fake.requests).toHaveLength(1);
  });
  it("J/M: block overlap follows agenda domain: reservation preserved and impact disclosed",async()=>{
    const f=await fixture(),a=await booking(f,"14:00"),c=await conversation(f,block());expect(state(c).proposal?.action_snapshot?.affected.map(r=>r.id)).toEqual([a.id]);
    expect(await withTenant(f.actor,tx=>tx.timeOff.count({where:{professionalId:f.professional.id}}))).toBe(0);const done=await confirm(f,c);
    expect(done.operations![0].state.scheduling?.receipt?.outcome).toBe("BLOCKED");expect((await read(f,a.id)).status).toBe("CONFIRMED");
    const again=await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(state(c).proposal!)));expect(again.duplicate).toBe(true);expect(await withTenant(f.actor,tx=>tx.timeOff.count({where:{professionalId:f.professional.id}}))).toBe(1);
  });
  it("K: ambiguous professionals require selection, no block created",async()=>{
    const f=await fixture();const u=await admin.user.create({data:{name:"Tatiana Silva",email:`tatiana-${randomUUID()}@example.test`,passwordHash:"synthetic"}});await admin.professional.create({data:{salonId:f.actor.salonId,userId:u.id}});
    const c=await conversation(f,block());expect(state(c).candidates?.items).toHaveLength(2);expect(state(c).proposal).toBeUndefined();
  });
  it("L/R/U: block awaiting end accepts 15h without model and keeps operation/draft",async()=>{
    const f=await fixture(),c=await conversation(f,block({end_time:null})),s=state(c);expect(s.waiting_for).toBe("end_time");
    const n=await c.secretary.send(f.actor,{sessionId:c.session,message:"15h"}),next=n.operations![0].state.scheduling!;
    expect(n.operations![0].operation_ref).toBe(c.state.operations![0].operation_ref);expect(next.draft?.draft_ref).toBe(s.draft?.draft_ref);expect(next.fields).toMatchObject({date:f.date,time:"13:00",end_time:"15:00"});
    expect(next.interpretation_source).toBe("DETERMINISTIC_FAST_PATH");expect(c.factory).toHaveBeenCalledTimes(1);expect(next.proposal).toBeTruthy();
    const telemetry=await withTenant(f.actor,tx=>tx.auditLog.findMany({where:{entityType:"SECRETARY_LATENCY",salonId:f.actor.salonId},select:{metadata:true}}));expect(telemetry.some(x=>(x.metadata as Record<string,unknown>).model_avoided===true)).toBe(true);
  });
  it("R/T/U: 11h fast-path vs ambiguous fake-model continuation, measured not estimated",async()=>{
    const f=await fixture();await booking(f);const c=await conversation(f,change({time:null,day_offset:1}));expect(state(c).waiting_for).toBe("time");
    const fast=await c.secretary.send(f.actor,{sessionId:c.session,message:"11h"});const fs=fast.operations![0].state.scheduling!;expect(fs.fields.time).toBe("11:00");expect(c.fake.requests).toHaveLength(1);
    const d=await conversation(f,change({time:null,day_offset:1}),[{time:"11:00"}]);const model=await d.secretary.send(f.actor,{sessionId:d.session,message:"às onze em ponto"});const ms=model.operations![0].state.scheduling!;
    expect(ms.interpretation_source).toBe("MODEL");expect(ms.proposal?.action_snapshot?.startLocal).toBe(fs.proposal?.action_snapshot?.startLocal);expect(d.fake.requests).toHaveLength(2);
    const ambiguous=await conversation(f,change({time:null,day_offset:1}),[{period:"afternoon"}]);const unknown=await ambiguous.secretary.send(f.actor,{sessionId:ambiguous.session,message:"depois do almoço"});expect(unknown.operations![0].state.scheduling?.proposal).toBeUndefined();expect(ambiguous.fake.requests).toHaveLength(2);
    console.log("GATE23_LATENCY",JSON.stringify({fast:fs.metrics,modelFake:ms.metrics,fastModelCalls:0,fakeModelCalls:1}));
  });
  it("S: Services duration fast-path keeps validations, zero extra inference",async()=>{
    const f=await fixture(),c=await conversation(f,intent("service.create",{name:"Massagem",priceCents:5000}));
    const n=await c.secretary.send(f.actor,{sessionId:c.session,message:"45 minutos"});expect(n.operations![0].state.proposal?.fields.durationMin).toBe(45);expect(c.fake.requests).toHaveLength(1);
  });
  it("N: tenant isolation and role revalidation apply even to duplicate confirmation",async()=>{
    const f=await fixture(),g=await fixture();await booking(f);const c=await conversation(f,cancel(),[],"Pedido sintético do cenário. Motivo: Pedido da cliente.");
    await expect(withTenant(g.actor,tx=>confirmAppointmentCreate(tx,g.actor,pi(state(c).proposal!)))).rejects.toThrow("PROPOSAL_NOT_FOUND");
    expect(state(await conversation(g,cancel(),[],"Pedido sintético do cenário. Motivo: Pedido da cliente.")).proposal).toBeUndefined();await confirm(f,c);
    await admin.membership.updateMany({where:f.actor,data:{role:"RECEPTIONIST"}});
    await expect(withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(state(c).proposal!)))).rejects.toThrow("FORBIDDEN");
    expect(await prisma.appointment.count()).toBe(0);const [role]=await prisma.$queryRaw<{s:boolean;b:boolean}[]>`SELECT rolsuper AS s,rolbypassrls AS b FROM pg_roles WHERE rolname=current_user`;expect(role).toEqual({s:false,b:false});
  });
  it("revision changed after proposal fails without overwrite",async()=>{
    const f=await fixture(),a=await booking(f),c=await conversation(f);await admin.appointment.update({where:{id:a.id},data:{version:{increment:1},notes:"Outro operador"}});
    await expect(confirm(f,c)).rejects.toThrow("SCHEDULE_CHANGED");expect((await read(f,a.id)).startAt).toEqual(a.startAt);
  });
  it("destination uses current salon timezone, preserving historical origin timezone",async()=>{
    const f=await fixture(),a=await booking(f);await admin.salon.update({where:{id:f.actor.salonId},data:{timezone:"America/Manaus"}});
    const c=await conversation(f);expect(state(c).proposal?.action_snapshot).toMatchObject({before_timezone:tz,timezone:"America/Manaus",startLocal:`${f.date}T11:00`});
    await confirm(f,c);expect((await read(f,a.id)).startAt).toEqual(localDateTimeToUtc(`${f.date}T11:00`,"America/Manaus"));
  });
  it.each([false,true])("real waitlist effect: reschedule promotes first entry (guest=%s)",async guest=>{
    const f=await fixture(),a=await booking(f);
    const client=guest?undefined:await admin.clientProfile.create({data:{salonId:f.actor.salonId,name:"Fila Sintética"}});
    const entry=await admin.waitlistEntry.create({data:{salonId:f.actor.salonId,appointmentId:a.id,professionalId:f.professional.id,
      ...(client?{clientId:client.id}:{guestName:"Convidado Sintético",guestPhone:"11999990011"}),startAt:a.startAt,endAt:a.endAt,timezone:tz,priceCents:12000,
      serviceSnapshots:[{serviceId:f.service.id,serviceName:"Progressiva",priceCents:12000,durationMin:60}]}});
    const c=await conversation(f);expect(state(c).proposal?.action_snapshot?.waiting_count).toBe(1);await confirm(f,c);
    const fulfilled=await withTenant(f.actor,tx=>tx.waitlistEntry.findFirstOrThrow({where:{id:entry.id}}));expect(fulfilled.fulfilledAppointmentId).toBeTruthy();
    const promoted=await read(f,fulfilled.fulfilledAppointmentId!);expect(promoted).toMatchObject({startAt:a.startAt,origin:"WAITLIST",status:"CONFIRMED"});
    await withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(state(c).proposal!)));expect(await withTenant(f.actor,tx=>tx.appointment.count({where:{salonId:f.actor.salonId}}))).toBe(2);
  });
  it("STAFF cancellation preserves waiting entry, does not promote",async()=>{
    const f=await fixture(),a=await booking(f);
    const e=await admin.waitlistEntry.create({data:{salonId:f.actor.salonId,appointmentId:a.id,professionalId:f.professional.id,clientId:f.client.id,startAt:a.startAt,endAt:a.endAt,timezone:tz,priceCents:12000,serviceSnapshots:[{serviceId:f.service.id,serviceName:"Progressiva",priceCents:12000,durationMin:60}]}});
    const c=await conversation(f,cancel(),[],"Pedido sintético do cenário. Motivo: Pedido da cliente.");await confirm(f,c);
    expect(await withTenant(f.actor,tx=>tx.waitlistEntry.findFirst({where:{id:e.id}}))).toMatchObject({fulfilledAt:null,cancelledAt:null,appointmentId:a.id});
    expect(await withTenant(f.actor,tx=>tx.appointment.count({where:{salonId:f.actor.salonId}}))).toBe(1);
  });
  it("physical resource competition across different professionals: one move wins, loser intact",async()=>{
    const f=await fixture();const u=await admin.user.create({data:{name:"Paula",email:`paula-action-${randomUUID()}@example.test`,passwordHash:"synthetic"}});
    const pro=await admin.professional.create({data:{salonId:f.actor.salonId,userId:u.id}});await admin.professionalService.create({data:{serviceId:f.service.id,professionalId:pro.id}});
    await admin.workingHours.createMany({data:Array.from({length:7},(_,weekday)=>({salonId:f.actor.salonId,professionalId:pro.id,weekday,startMinutes:540,endMinutes:1080}))});
    const a=await booking(f,"09:00"),b=await booking({...f,professional:pro},"10:00");
    const x=await conversation(f,change({source_time:"09:00",time:"13:00"})),y=await conversation(f,change({time:"13:00"}));
    const results=await Promise.allSettled([confirm(f,x),confirm(f,y)]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const rows=await withTenant(f.actor,tx=>tx.appointment.findMany({where:{id:{in:[a.id,b.id]}}}));expect(rows.filter(r=>+r.startAt===+a.startAt||+r.startAt===+b.startAt)).toHaveLength(1);
    expect(await withTenant(f.actor,tx=>tx.resourceBooking.count({where:{salonId:f.actor.salonId,active:true,startAt:localDateTimeToUtc(`${f.date}T13:00`,tz)}}))).toBe(1);
  });
  it("stale draft, missing permissions and invalid interval reject writes",async()=>{
    const f=await fixture();await booking(f);const c=await conversation(f);const old=state(c).proposal!;
    c.fake.requests.length=0; // Counts below are only the continuation.
    // Reinterpret via fake, not a real provider, to invalidate the prior revision.
    const {applySchedulingInterpretation}=await import("../secretary-scheduling");
    const copied=structuredClone(state(c));await applySchedulingInterpretation(f.actor,copied,{time:"12:00"});
    await expect(withTenant(f.actor,tx=>confirmAppointmentCreate(tx,f.actor,pi(old)))).rejects.toThrow("REVISION_CONFLICT");
    const invalid=state(await conversation(f,block({time:"15:00",end_time:"13:00"})));
    expect(invalid.draft).toMatchObject({status:"NEEDS_INPUT",temporal_conflicts:[],temporal_missing:["end_time"]});expect(invalid.draft?.fields.end_time).toBeUndefined();
    expect(invalid.proposal).toBeUndefined();
    await admin.membership.updateMany({where:f.actor,data:{role:"RECEPTIONIST"}});
    await expect(conversation(f,block())).rejects.toThrow("FORBIDDEN");await expect(conversation(f,cancel(),[],"Pedido sintético do cenário. Motivo: Pedido da cliente.")).rejects.toThrow("FORBIDDEN");
  });
  it("schema smoke: approved column grants, forced RLS, invoker trigger, no Product access",async()=>{
    const rows=await prisma.$queryRaw<{enabled:boolean;forced:boolean}[]>`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE relname IN ('Appointment','TimeOff','RescheduleProposal','WaitlistEntry')`;expect(rows).toHaveLength(4);expect(rows.every(r=>r.enabled&&r.forced)).toBe(true);
    const [priv]=await prisma.$queryRaw<{all_update:boolean;start_update:boolean;product:boolean}[]>`SELECT has_table_privilege(current_user,'"Appointment"','UPDATE') AS all_update,has_column_privilege(current_user,'"Appointment"','startAt','UPDATE') AS start_update,has_table_privilege(current_user,'"Product"','UPDATE') AS product`;expect(priv).toEqual({all_update:false,start_update:true,product:false});
    const [fn]=await prisma.$queryRaw<{prosecdef:boolean}[]>`SELECT prosecdef FROM pg_proc WHERE proname='product_update_resources'`;expect(fn.prosecdef).toBe(false);
  });
});

