/** Fresh fixture only. No reset, migration or external providers. */
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { assertMvpTestDatabase } from './service-mvp-test-safety';
// F4: byte-safe identity (hex data directory, byte-equal to MVP_TEST_CLUSTER_HEX), runtime role and FORCE RLS; the frozen
// phase-A gate (text data_directory) is no longer used here.
import { assertLocalDisposableDatabase, expectedClusterHex } from './local-db-identity.cjs';
import { snapshotDatabase, hashes } from '../src/test/secretary-execution-evidence';
import { localDateTimeToUtc, addCalendarDays, dateKeyInTimeZone } from '../src/lib/time';
import { intent, plan } from '../src/test/secretary-capability-plan';
import { call } from '../src/test/scripted-services-model';
async function main() {
 const admin = new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
 const runtime = new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
 try {
  const out=process.env.EXECUTION_E2E_OUTPUT!;
  const proof=JSON.parse(readFileSync(resolve(out,'preflight.json'),'utf8'));
  if(createHash('sha256').update(readFileSync(proof.dump)).digest('hex')!==proof.sha256) throw Error('BACKUP_MISMATCH');
  await assertMvpTestDatabase(admin);
  const preflight=await assertLocalDisposableDatabase(admin,runtime,{expectedHex:expectedClusterHex(process.env)});
  const baseline=await snapshotDatabase(admin);
  const tz='America/Sao_Paulo', date=addCalendarDays(dateKeyInTimeZone(new Date(),tz),1), salonId=randomUUID();
  const password='Local-Voice-Fixture-Only-2026!';
  const passwordHash=await hash(password,10);
  const fixture=await admin.$transaction(async tx=>{
   await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
   const owner=await tx.user.create({data:{name:'Tatiana',email:`${salonId}@front-voice.test`,passwordHash,passwordSetAt:new Date()}});
   await tx.salon.create({data:{id:salonId,slug:`front-voice-${salonId}`,name:'Everflair • Teste da Secretária',accessStatus:'APPROVED',plan:'PRO',timezone:tz,currency:'BRL',minBookingLeadMinutes:0,bufferMinutes:0}});
   await tx.membership.create({data:{salonId,userId:owner.id,role:'OWNER'}});
   const amanda=await tx.clientProfile.create({data:{salonId,name:'Amanda Souza',phone:'11987654321'}});
   await tx.clientProfile.create({data:{salonId,name:'Fábio Santos',phone:'11987654322'}});
   const massagem=await tx.service.create({data:{salonId,name:'Massagem',priceCents:10000,durationMin:30,description:'Preservar descrição',category:'Bem-estar'}});
   const cut=await tx.service.create({data:{salonId,name:'Corte Completo',priceCents:5000,durationMin:45}});
   const professional=await tx.professional.create({data:{salonId,userId:owner.id}});
   await tx.professionalService.createMany({data:[massagem,cut].map(s=>({serviceId:s.id,professionalId:professional.id}))});
   await tx.workingHours.createMany({data:Array.from({length:7},(_,weekday)=>({salonId,professionalId:professional.id,weekday,startMinutes:540,endMinutes:1080}))});
   const product=await tx.product.create({data:{salonId,name:'Shampoo X',stock:10,minStock:2,priceCents:2000}});
   await tx.product.create({data:{salonId,name:'Condicionador',stock:7,priceCents:3000}});
   const startAt=localDateTimeToUtc(`${date}T10:00`,tz);
   const appointment=await tx.appointment.create({data:{salonId,clientId:amanda.id,serviceId:massagem.id,professionalId:professional.id,startAt,endAt:new Date(+startAt+1800000),timezone:tz,priceCents:10000,status:'CONFIRMED',notes:'Preservar notas',serviceItems:{create:{serviceId:massagem.id,position:0,serviceName:'Massagem',durationMin:30,priceCents:10000}}}});
   return {salonId,email:owner.email,password,userId:owner.id,date,serviceId:massagem.id,productId:product.id,appointmentId:appointment.id};
  });
  const isolated=await runtime.$transaction(async tx=>{
   await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
   return tx.product.findMany({select:{salonId:true}});
  });
  if(isolated.length!==2||isolated.some(row=>row.salonId!==salonId)||(await runtime.product.findMany({select:{id:true}})).length) throw Error('TENANT_ISOLATION');
  const after=await snapshotDatabase(admin);
  for(const [table,rows] of Object.entries(baseline)) if(rows.some(row=>!after[table].some(candidate=>JSON.stringify(candidate)===JSON.stringify(row)))) throw Error('BASELINE_CHANGED');
  writeFileSync(resolve(out,'fixture.json'),JSON.stringify(fixture,null,2));
  writeFileSync(resolve(out,'baseline.json'),JSON.stringify({preflight,before:hashes(baseline),after:hashes(after),fixture:{...fixture,password:undefined},tenant_isolation:true},null,2));
  const svc=(price:number)=>intent('service.change',{item_key:'service',target_name:'Massagem',priceCents:price});
  const stock=()=>intent('stock.movement',{item_key:'stock',inventory:{product_name:'Shampoo X',mode:'OUT',quantity:2}});
  const outputs=[
   call('select_capabilities',plan([svc(8000)])),
   call('select_capabilities',plan([intent('appointment.change',{item_key:'move',customer_name:'Amanda Souza',source_day_offset:1,source_time:'10:00',time:'11:00'})])),
   call('select_capabilities',plan([stock()])),
   call('select_capabilities',plan([svc(8500),stock()])),
   call('select_capabilities',plan([svc(8000)])),
   call('upsert_action_draft',{name:null,durationMin:null,priceCents:9000}),
   call('select_capabilities',{...plan([
    intent('appointment.cancel',{item_key:'cancel',customer_name:'Amanda Souza',day_offset:1,time:'11:00',reason:'Pedido da cliente'}),
    intent('appointment.create',{item_key:'create',depends_on:['cancel'],released_slot_of:'cancel',customer_name:'Fábio Santos',service_name:'Corte Completo',override_requested:true,override_reason:'Cliente já está aguardando'})]),independent:false}),
  ];
  writeFileSync(resolve(out,'model-script.json'),JSON.stringify(outputs,null,2));
  console.log('Fresh fixture and RLS baseline ready:',salonId);
 }finally{await admin.$disconnect();await runtime.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});



