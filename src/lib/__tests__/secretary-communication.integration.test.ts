import { randomUUID } from "node:crypto";
import { PrismaClient,type NotificationChannel } from "@prisma/client";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { FakeCommunicationProvider } from "../communication-provider";
import { getCustomerMessageContext,upsertMessageDraft,proposeCustomerMessage,confirmCustomerMessage,dispatchLocalMessage,getMessageStatus } from "../communication-actions";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";
import golden from "../../test/fixtures/secretary-real-outputs.json";
import { addCalendarDays,dateKeyInTimeZone,localDateTimeToUtc } from "../time";
const suite=process.env.RUN_SERVICE_MVP_INTEGRATION==="1"?describe:describe.skip;
const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL??process.env.DATABASE_URL}}});
const tz="America/Sao_Paulo";
async function fixture(){
  const salonId=randomUUID();return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner=await tx.user.create({data:{name:"Tatiana sintética",email:`comm-${salonId}@local.test`,passwordHash:"synthetic-non-login"}});
    const staff=await tx.user.create({data:{name:"Profissional sintético",email:`comm-staff-${salonId}@local.test`,passwordHash:"synthetic-non-login"}});
    await tx.salon.create({data:{id:salonId,name:"Communication sintético",slug:`comm-${salonId}`,accessStatus:"APPROVED",plan:"FREE",timezone:tz}});
    await tx.membership.createMany({data:[{salonId,userId:owner.id,role:"OWNER"},{salonId,userId:staff.id,role:"PROFESSIONAL"}]});
    const clients=[];for(const [name,phone]of [["Fábio Silva","11987654321"],["Amanda Um","21987654321"],["Amanda Dois","31987654321"],["Sem Contato",null]] as const)clients.push(await tx.clientProfile.create({data:{salonId,name,phone}}));
    const service=await tx.service.create({data:{salonId,name:"Corte sintético",priceCents:5000,durationMin:60}});
    const pro=await tx.professional.create({data:{salonId,userId:owner.id}});
    await tx.professionalService.create({data:{serviceId:service.id,professionalId:pro.id}});
    const date=addCalendarDays(dateKeyInTimeZone(new Date(),tz),2);
    const appts=[];
    for(const time of ["10:00","14:00","16:00"]){const startAt=localDateTimeToUtc(`${date}T${time}`,tz);appts.push(await tx.appointment.create({data:{salonId,clientId:clients[0].id,professionalId:pro.id,serviceId:service.id,startAt,endAt:new Date(+startAt+3600000),timezone:tz,priceCents:5000,status:"CONFIRMED"}}));}
    const event=await tx.appointmentEvent.create({data:{salonId,appointmentId:appts[0].id,eventType:"CREATED",actorType:"STAFF",actorId:owner.id,correlationId:randomUUID()}});
    const named=[];
    for(const [index,name] of ["Amanda Communication Sintética","Maria Clara de Souza","João Pedro Santos","Ana Paula Inventory Teste"].entries()){
      const customer=await tx.clientProfile.create({data:{salonId,name,phone:"41987654321"}});
      const day=addCalendarDays(date,1),time=`${String(8+index*2).padStart(2,"0")}:00`,startAt=localDateTimeToUtc(`${day}T${time}`,tz);
      const appointment=await tx.appointment.create({data:{salonId,clientId:customer.id,professionalId:pro.id,serviceId:service.id,startAt,endAt:new Date(+startAt+3600000),timezone:tz,priceCents:5000,status:"CONFIRMED"}});
      named.push({name,customer,appointment,day,time});
    }
    await tx.service.createMany({data:["Corte Especial A","Corte Especial B"].map(name=>({salonId,name,priceCents:5000,durationMin:60}))});
    return {actor:{salonId,userId:owner.id},staff:{salonId,userId:staff.id},clients,service,pro,date,appts,event,named,users:[owner.id,staff.id]};
  });
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const pi=(p:{proposal_ref:string;draft_revision:number})=>({proposal_ref:p.proposal_ref,draft_revision:p.draft_revision});
const msg=(fields:object={})=>intent("customer.message",{communication:{recipient_name:"Fábio",channel:"WHATSAPP",message_mode:"EXACT",content:"Texto ignorado a favor do original",...fields}});
suite("Communication fake / PostgreSQL runtime",()=>{
  let a:Fixture,b:Fixture;const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});
  beforeAll(async()=>{expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");expect(new URL(process.env.DATABASE_URL!).username).toBe("mvp_service_runtime");console.log("COMMUNICATION_PREFLIGHT",await assertMvpTestDatabase(admin));vi.stubGlobal("fetch",network);a=await fixture();b=await fixture();});
  afterAll(async()=>{
    expect(network).not.toHaveBeenCalled();
    for(const f of [a,b].filter(Boolean))await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
      await tx.notificationOutbox.deleteMany({where:{salonId:f.actor.salonId}});await tx.appointmentEvent.deleteMany({where:{salonId:f.actor.salonId}});await tx.appointment.deleteMany({where:{salonId:f.actor.salonId}});await tx.salon.delete({where:{id:f.actor.salonId}});await tx.user.deleteMany({where:{id:{in:f.users}}});});
    vi.unstubAllGlobals();await admin.$disconnect();await prisma.$disconnect();
  });
  const scoped=<T>(fn:Parameters<typeof withTenant<T>>[1])=>withTenant(a.actor,fn);
  const rows=()=>scoped(tx=>tx.notificationOutbox.findMany({where:{salonId:a.actor.salonId,channel:"WHATSAPP"}}));
  const read=(id:string)=>scoped(tx=>tx.appointment.findFirstOrThrow({where:{id,salonId:a.actor.salonId}}));
  const prepare=async(content="Texto sintético",ref?:string)=>{const d=await scoped(tx=>upsertMessageDraft(tx,a.actor,{customer_ref:ref??a.clients[0].id,patch:{channel:"WHATSAPP",message_mode:"EXACT",content}}));return scoped(tx=>proposeCustomerMessage(tx,a.actor,{draft_ref:d.draft_ref,draft_revision:d.draft_revision}));};
  const confirm=(p:Parameters<typeof pi>[0])=>scoped(tx=>confirmCustomerMessage(tx,a.actor,pi(p)));
  async function conversation(selection=plan([msg()]),text='Mande exatamente para Fábio no WhatsApp: “Olá, Fábio.”',fail=false){
    const fake=new ScriptedServicesModel([call("select_capabilities",selection)]),provider=new FakeCommunicationProvider(fail),secretary=new SalonSecretary(async()=>fake,()=>"fake-communication",provider);
    const session=(await secretary.start(a.actor,"auto")).sessionId;const state=await secretary.send(a.actor,{sessionId:session,message:text});return {fake,provider,secretary,session,state};
  }
  it("exact grants and RLS/FORCE; runtime no superuser/BYPASSRLS",async()=>{
    expect(await prisma.$queryRaw`SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`).toEqual([{current_user:"mvp_service_runtime",rolsuper:false,rolbypassrls:false}]);
    expect(await prisma.$queryRaw`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='"NotificationOutbox"'::regclass`).toEqual([{relrowsecurity:true,relforcerowsecurity:true}]);
    const grants=await prisma.$queryRaw<{column_name:string}[]>`SELECT column_name FROM information_schema.column_privileges WHERE grantee=current_user AND table_name='NotificationOutbox' AND privilege_type='UPDATE' ORDER BY column_name`;
    expect(grants.map(x=>x.column_name)).toEqual(['attempts','lastError','nextAttemptAt','status','updatedAt']);
    expect(await prisma.$queryRaw`SELECT has_table_privilege(current_user,'"NotificationOutbox"','DELETE') AS del,has_table_privilege(current_user,'"NotificationOutbox"','UPDATE') AS upd`).toEqual([{del:false,upd:false}]);
  });
  it("authorized context CHECK matrix using runtime only, no retained test rows",async()=>{
    for(const channel of ['INTERNAL','EMAIL','MANUAL_WHATSAPP','WHATSAPP'] as NotificationChannel[])for(const flags of [[true,true],[false,false],[true,false],[false,true]]){
      let inserted=false;const allowed=flags.every(Boolean)||(channel==='WHATSAPP'&&flags.every(x=>!x));
      try{await scoped(async tx=>{await tx.notificationOutbox.create({data:{id:randomUUID(),salonId:a.actor.salonId,eventId:flags[0]?a.event.id:null,appointmentId:flags[1]?a.appts[0].id:null,recipientType:'CLIENT',recipientId:a.clients[0].id,recipientKey:`matrix:${randomUUID()}`,channel,template:'constraint-test',payload:{synthetic:true}},select:{id:true}});inserted=true;throw Error('MATRIX_ROLLBACK');});}
      catch(e){if(!allowed)expect(String(e)).toContain('NotificationOutbox_context_check');else expect(String(e)).toContain('MATRIX_ROLLBACK');}
      expect(inserted).toBe(allowed);
    }
  });
  it("A/E/G/H/I/T exact content, no enqueue before confirm, one item/receipt, zero inference confirmation",async()=>{
    const before=(await rows()).length,c=await conversation(undefined,'Mande exatamente para Fábio no WhatsApp: “  Olá!\nTudo bem? 👋  ”');
    const op=c.state.operations![0],p=op.state.communication!.proposal!;
    expect(p.fields.content).toBe('  Olá!\nTudo bem? 👋  ');expect(p.preview).toContain(p.fields.content!);expect((await rows()).length).toBe(before);expect(c.provider.calls).toHaveLength(0);
    const result=await c.secretary.confirmAutomatic(a.actor,c.session,op.operation_ref,pi(p));const state=result.operations![0].state.communication!;
    expect(state.delivery).toMatchObject({status:'SIMULATED',external_delivery:false,attempts:1});
    const repeat=await c.secretary.confirmAutomatic(a.actor,c.session,op.operation_ref,pi(p));expect(repeat.operations![0].state.communication!.receipt).toEqual({...state.receipt,duplicate:true});
    expect(c.fake.requests).toHaveLength(1);expect(c.provider.calls).toHaveLength(1);expect((await rows()).length).toBe(before+1);
    process.stdout.write(`COMMUNICATION_FAKE_METRICS ${JSON.stringify(state.metrics)}\n`);
    const persisted=(await rows()).find(r=>r.id===state.receipt!.message_ref)!;expect(persisted).toMatchObject({status:'PENDING',sentAt:null,readAt:null});expect((persisted.payload as {content:string}).content).toBe(p.fields.content);
    expect(JSON.stringify(c.fake.requests)).not.toContain(a.clients[0].phone!);
    const telemetry=await scoped(tx=>tx.auditLog.findMany({where:{entityType:'SECRETARY_LATENCY',entityId:op.operation_ref},select:{metadata:true}}));expect(JSON.stringify(telemetry)).not.toContain('Tudo bem');expect(JSON.stringify(telemetry)).not.toContain(a.clients[0].phone!);
  });
  it("B/C/D recipient absent, ambiguous, missing contact; selected real candidate no model",async()=>{
    const missing=await conversation(plan([msg({recipient_name:'Inexistente'})]),'Mande exatamente para Inexistente no WhatsApp: “Olá, Fábio.”');expect(missing.state.operations![0].state.communication!.proposal).toBeUndefined();
    const ambiguous=await conversation(plan([msg({recipient_name:'Amanda'})]),'Mande exatamente para Amanda no WhatsApp: “Olá, Fábio.”');const op=ambiguous.state.operations![0];expect(op.state.communication!.candidates).toHaveLength(3);
    await expect(ambiguous.secretary.selectAutomatic(a.actor,ambiguous.session,op.operation_ref,b.clients[0].id)).rejects.toThrow('SELECTION_INVALID');
    const picked=await ambiguous.secretary.selectAutomatic(a.actor,ambiguous.session,op.operation_ref,a.clients[1].id);expect(picked.operations![0].state.communication!.proposal!.recipient.customer_ref).toBe(a.clients[1].id);expect(ambiguous.fake.requests).toHaveLength(1);
    const noPhone=await conversation(plan([msg({recipient_name:'Sem Contato'})]),'Mande exatamente para Sem Contato no WhatsApp: “Olá, Fábio.”');expect(noPhone.state.operations![0].state.communication!.message).toContain('telefone válido');expect(noPhone.state.operations![0].state.communication!.proposal).toBeUndefined();
  });
  it("F/J generated preview, fake failure does not claim sent or auto-retry",async()=>{
    const c=await conversation(plan([msg({message_mode:'GENERATED',content:'Olá, Fábio. Entre em contato com a equipe.'})]),'Escreva educadamente para Fábio no WhatsApp.',true),op=c.state.operations![0];
    expect(op.state.communication!.proposal!.preview).toContain('Olá, Fábio. Entre em contato com a equipe.');expect(c.provider.calls).toHaveLength(0);
    const done=await c.secretary.confirmAutomatic(a.actor,c.session,op.operation_ref,pi(op.state.communication!.proposal!));const state=done.operations![0].state.communication!;
    expect(state.delivery).toMatchObject({status:'FAILED',attempts:1,error_code:'FAKE_FAILURE',retry_state:'MANUAL_REVIEW'});
    await dispatchLocalMessage(a.actor,state.receipt!.message_ref,c.provider);expect(c.provider.calls).toHaveLength(1);
  });
  it("channel continuation same draft, zero model; omission preserves exact content",async()=>{
    const c=await conversation(plan([msg({channel:null})]),'Mande exatamente para Fábio: “Olá, Fábio.”'),op=c.state.operations![0],d=op.state.communication!.draft!;
    expect(d.missing_fields).toEqual(['channel']);expect(op.state.communication!.proposal).toBeUndefined();
    const next=await c.secretary.send(a.actor,{sessionId:c.session,message:'WhatsApp'}),state=next.operations![0].state.communication!;
    expect(state.draft!.draft_ref).toBe(d.draft_ref);expect(state.fields.content).toBe('Olá, Fábio.');expect(state.interpretation_source).toBe('DETERMINISTIC_FAST_PATH');expect(c.fake.requests).toHaveLength(1);
    process.stdout.write(`COMMUNICATION_FAST_PATH_METRICS ${JSON.stringify(state.metrics)}\n`);
  });
  function dependent(time:string){return {...plan([intent('appointment.cancel',{item_key:'a',customer_name:'Fábio',date:a.date,time,reason:'Substituição solicitada pela equipe'}),{...msg(),item_key:'b',depends_on:['a']}]),independent:false};}
  it("real split output is rejected before Scheduling/Communication drafts, proposals or operational writes",async()=>{
    const recorded=golden.find(g=>g.id==='gate27-communication-entity-split')!;
    const countDrafts=()=>scoped(tx=>tx.auditLog.count({where:{salonId:a.actor.salonId,entityType:{in:['SECRETARY_SCHEDULING','SECRETARY_COMMUNICATION']}}}));
    const beforeDrafts=await countDrafts(),beforeRows=(await rows()).length;
    await expect(conversation(recorded.payload as ReturnType<typeof plan>,recorded.source_message!)).rejects.toThrow('ENTITY_MENTION_CONFLICT');
    expect(await countDrafts()).toBe(beforeDrafts);expect((await rows()).length).toBe(beforeRows);
    expect((await read(a.named[0].appointment.id)).status).toBe('CONFIRMED');
  });
  it.each([0,1,2,3])("full compound name %i resolves same customer for cancel/message; no invented service",async index=>{
    const f=a.named[index],service=index===1?a.service.name:undefined;
    const selected={...plan([intent('appointment.cancel',{item_key:'a',customer_name:f.name,date:f.day,time:f.time,reason:'teste',...(service?{service_name:service}:{})}),{...msg({recipient_name:f.name}),item_key:'b',depends_on:['a']}]),independent:false};
    const before=(await rows()).length;
    const c=await conversation(selected,`Cancele ${f.name} em ${f.day} às ${f.time}${service?` para o serviço ${service}`:''} e mande no WhatsApp: “Cancelado.” Motivo: teste.`);
    const state=c.state.operations![0].state.communication!;
    expect(state.cancel!.fields.customer_name).toBe(f.name);
    expect(state.cancel!.fields.service_name).toBe(service);
    expect(state.proposal!.recipient.customer_ref).toBe(f.customer.id);
    expect(state.proposal!.dependency!.snapshot.appointment_ref).toBe(f.appointment.id);
    expect(state.proposal!.fields.content).toBe('Cancelado.');
    expect((await read(f.appointment.id)).status).toBe('CONFIRMED');
    expect((await rows()).length).toBe(before);expect(c.provider.calls).toHaveLength(0);
  });
  it("service ambiguity stays separate from the full customer and blocks the dependent message",async()=>{
    const f=a.named[1];
    const selected={...plan([intent('appointment.cancel',{item_key:'a',customer_name:f.name,service_name:'Corte Especial',date:f.day,time:f.time,reason:'teste'}),{...msg({recipient_name:f.name}),item_key:'b',depends_on:['a']}]),independent:false};
    const c=await conversation(selected,`Cancele ${f.name} para Corte Especial e mande no WhatsApp: “Cancelado.” Motivo: teste.`);
    const state=c.state.operations![0].state.communication!;
    expect(state.cancel!.fields.customer_ref).toBe(f.customer.id);
    expect(state.cancel!.candidates).toMatchObject({kind:'service_ref'});
    expect(state.cancel!.candidates!.items).toHaveLength(2);
    expect(state.proposal).toBeUndefined();expect(c.provider.calls).toHaveLength(0);
  });
  it("P/L cancel+message atomic enqueue; fake failure postcommit preserves business; repeated confirm",async()=>{
    const before=await read(a.appts[0].id);const c=await conversation(dependent('10:00'),'Cancele Fábio e mande no WhatsApp: “Serviço cancelado, Fábio.” Motivo: Substituição solicitada pela equipe.',true),op=c.state.operations![0],state=op.state.communication!;
    expect(state.proposal!.dependency!.snapshot.appointment_ref).toBe(a.appts[0].id);expect(state.cancel!.proposal).toBeUndefined();expect(await read(a.appts[0].id)).toEqual(before);
    const done=await c.secretary.confirmAutomatic(a.actor,c.session,op.operation_ref,pi(state.proposal!));expect((await read(a.appts[0].id)).status).toBe('CANCELLED');
    const result=done.operations![0].state.communication!;expect(result.receipt!.business_outcome).toBe('CANCELLED');expect(result.delivery!.status).toBe('FAILED');
    const eventCount=await scoped(tx=>tx.appointmentEvent.count({where:{appointmentId:a.appts[0].id,eventType:'CANCELLED'}}));
    const repeated=await c.secretary.confirmAutomatic(a.actor,c.session,op.operation_ref,pi(state.proposal!));expect(repeated.operations![0].state.communication!.receipt!.duplicate).toBe(true);
    expect(await scoped(tx=>tx.appointmentEvent.count({where:{appointmentId:a.appts[0].id,eventType:'CANCELLED'}}))).toBe(eventCount);expect(c.provider.calls).toHaveLength(1);expect(c.fake.requests).toHaveLength(1);
  });
  it("K concurrent change prevents cancel and enqueue entirely",async()=>{
    const c=await conversation(dependent('14:00'),'Cancele Fábio e avise no WhatsApp: “Serviço cancelado.” Motivo: Substituição solicitada pela equipe.'),op=c.state.operations![0],before=(await rows()).length;
    await scoped(tx=>tx.appointment.updateMany({where:{id:a.appts[1].id,salonId:a.actor.salonId},data:{version:{increment:1}}}));
    await expect(c.secretary.confirmAutomatic(a.actor,c.session,op.operation_ref,pi(op.state.communication!.proposal!))).rejects.toThrow('SCHEDULE_CHANGED');
    expect((await read(a.appts[1].id)).status).toBe('CONFIRMED');expect((await rows()).length).toBe(before);expect(c.provider.calls).toHaveLength(0);
  });
  it("same proposal concurrent confirmations share receipt and single outbox",async()=>{
    const p=await prepare(),before=(await rows()).length;const results=await Promise.all([confirm(p),confirm(p)]);
    expect(results.map(r=>r.duplicate).sort()).toEqual([false,true]);expect(results[0].receipt_ref).toBe(results[1].receipt_ref);expect((await rows()).length).toBe(before+1);
    const provider=new FakeCommunicationProvider();await Promise.all([dispatchLocalMessage(a.actor,results[0].message_ref,provider),dispatchLocalMessage(a.actor,results[0].message_ref,provider)]);expect(provider.calls).toHaveLength(1);
  });
  it("enqueue failure rolls back the cancellation and its event in the same transaction",async()=>{
    const c=await conversation(dependent('16:00'),'Cancele Fábio e mande no WhatsApp: “Serviço cancelado.” Motivo: Substituição solicitada pela equipe.');
    const p=c.state.operations![0].state.communication!.proposal!,before=await read(a.appts[2].id);
    await expect(scoped(tx=>confirmCustomerMessage(new Proxy(tx,{get(target,key){
      if(key==='notificationOutbox')return new Proxy(target.notificationOutbox,{get(delegate,method){
        if(method==='create')return async()=>{throw Error('SYNTHETIC_ENQUEUE_FAILURE');};return Reflect.get(delegate,method);
      }});return Reflect.get(target,key);
    }}),a.actor,pi(p)))).rejects.toThrow('SYNTHETIC_ENQUEUE_FAILURE');
    expect(await read(a.appts[2].id)).toEqual(before);
    expect(await scoped(tx=>tx.appointmentEvent.count({where:{appointmentId:a.appts[2].id,eventType:'CANCELLED'}}))).toBe(0);
    expect(c.provider.calls).toHaveLength(0);
  });
  it("old proposal revision is invalid after content edit",async()=>{
    const p=await prepare('old');await scoped(tx=>upsertMessageDraft(tx,a.actor,{customer_ref:a.clients[0].id,draft_ref:p.draft_ref,expected_revision:p.draft_revision,patch:{content:'new'}}));
    await expect(confirm(p)).rejects.toThrow('REVISION_CONFLICT');
  });
  it("M/N positive cross-tenant, missing context, unauthorized role and explicit forged refs blocked",async()=>{
    const p=await prepare(),r=await confirm(p);
    const bd=await withTenant(b.actor,tx=>upsertMessageDraft(tx,b.actor,{customer_ref:b.clients[0].id,patch:{content:'B',channel:'WHATSAPP',message_mode:'EXACT'}}));
    const bp=await withTenant(b.actor,tx=>proposeCustomerMessage(tx,b.actor,{draft_ref:bd.draft_ref,draft_revision:bd.draft_revision}));const br=await withTenant(b.actor,tx=>confirmCustomerMessage(tx,b.actor,pi(bp)));
    expect(await scoped(tx=>tx.notificationOutbox.findMany({where:{id:br.message_ref},select:{id:true}}))).toEqual([]);
    expect(await withTenant(b.actor,tx=>tx.notificationOutbox.findMany({where:{id:r.message_ref},select:{id:true}}))).toEqual([]);
    expect(await prisma.notificationOutbox.findMany({select:{id:true}})).toEqual([]);
    await expect(withTenant(b.actor,tx=>getMessageStatus(tx,b.actor,r.message_ref))).rejects.toThrow('MESSAGE_NOT_FOUND');
    await expect(withTenant(b.actor,tx=>confirmCustomerMessage(tx,b.actor,pi(p)))).rejects.toThrow('PROPOSAL_NOT_FOUND');
    await expect(withTenant(a.staff,tx=>getCustomerMessageContext(tx,a.staff,a.clients[0].id))).rejects.toThrow('FORBIDDEN');
    await expect(scoped(tx=>getCustomerMessageContext(tx,a.actor,b.clients[0].id))).rejects.toThrow('CUSTOMER_NOT_FOUND');
    const dto=await scoped(tx=>getMessageStatus(tx,a.actor,r.message_ref));expect(JSON.stringify(dto)).not.toContain('content');expect(JSON.stringify(dto)).not.toContain(a.clients[0].phone!);
  });
  it("O/Q compound Financial+Communication independent; create+cancel-message blocked before drafts",async()=>{
    const c=await conversation(plan([intent('financial.report',{financial:{metrics:['service_revenue'],period:'today'}}),msg()]),'Quanto faturei hoje? Mande exatamente para Fábio no WhatsApp: “Olá, Fábio.”');
    expect(c.state.operations![0].state.financial!.status).toBe('DONE');expect(c.state.operations![1].state.communication!.proposal).toBeTruthy();
    const before=(await rows()).length;await expect(conversation(plan([intent('appointment.create'),msg()]),'Agende Fábio e mande: “Seu serviço foi cancelado.”')).rejects.toThrow();expect((await rows()).length).toBe(before);
  });
});
