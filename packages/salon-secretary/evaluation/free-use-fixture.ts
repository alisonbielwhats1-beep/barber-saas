/** Create-once synthetic fixture adapter. Caller must first prove local DB identity. */
import { createHash } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { withTenant } from '../../../src/lib/prisma-tenant';
import { fixtureSchema, type EntityBindings, type FixtureIdentity, type FreeUseFixture } from './free-use-contract';
function id(namespace:string,key:string){const hash=createHash('sha256').update('free-use-v1:'+namespace+':'+key).digest('hex');return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);}
export function fixtureIdentity(namespace:string,caseId:string,input:FreeUseFixture):FixtureIdentity{
 const fixture=fixtureSchema.parse(input),scope=namespace+':'+caseId,bindings:EntityBindings={};
 for(const [kind,rows]of [['customer',fixture.customers],['professional',fixture.professionals],['service',fixture.services],['product',fixture.products],['appointment',fixture.appointments]] as const)
  for(const row of rows){const key=kind+':'+row.key;if(bindings[key])throw Error('FREE_USE_FIXTURE_DUPLICATE_KEY');bindings[key]=id(scope,key);}
 return {tenant:id(scope,'tenant'),actor:id(scope,'owner'),foreignTenant:id(scope+':foreign','tenant'),foreignActor:id(scope+':foreign','owner'),bindings};
}
export function validateFreeUseFixture(input:FreeUseFixture){
 const f=fixtureSchema.parse(input),errors:string[]=[];
 const known=(kind:'customers'|'professionals'|'services',key:string)=>f[kind].some(row=>row.key===key);
 if(f.openMinutes<0||f.closeMinutes>1440||f.openMinutes>=f.closeMinutes||new Set(f.openWeekdays).size!==f.openWeekdays.length)errors.push('HOURS');
 for(const [kind,rows]of Object.entries({customers:f.customers,professionals:f.professionals,services:f.services,products:f.products,appointments:f.appointments}))
  if(new Set(rows.map(row=>row.key)).size!==rows.length)errors.push('DUPLICATE_'+kind.toUpperCase());
 for(const s of f.services)if(s.professionalKeys.some(key=>!known('professionals',key))||new Set(s.professionalKeys).size!==s.professionalKeys.length)errors.push('SERVICE_ELIGIBILITY');
 for(const a of f.appointments){const service=f.services.find(s=>s.key===a.serviceKey);
  if(!known('customers',a.customerKey)||!known('professionals',a.professionalKey)||!service||!service.professionalKeys.includes(a.professionalKey))errors.push('APPOINTMENT_RELATION');
  if(a.payment&&a.status!=='COMPLETED')errors.push('PAYMENT_STATUS');}
 for(const closure of f.closures)if(Date.parse(closure.startAt)>=Date.parse(closure.endAt))errors.push('CLOSURE_RANGE');
 return [...new Set(errors)];
}
async function seedTenant(tx:Prisma.TransactionClient,scope:string,tenant:string,actor:string,bindings:EntityBindings,f:FreeUseFixture,timezone:string){
 await tx.user.create({data:{id:actor,email:actor+'@example.invalid',name:'Synthetic Free Use Owner',passwordHash:'synthetic-non-login'}});
 for(const p of f.professionals)await tx.user.create({data:{id:id(scope,'professional-user:'+p.key),email:id(scope,'professional-user:'+p.key)+'@example.invalid',name:p.name,passwordHash:'synthetic-non-login'}});
 await tx.salon.create({data:{id:tenant,slug:'free-use-'+tenant,name:'Synthetic Free Use '+scope,accessStatus:'APPROVED',plan:'PRO',timezone,currency:'BRL',
  openMinutes:f.openMinutes,closeMinutes:f.closeMinutes,minBookingLeadMinutes:0,bufferMinutes:0}});
 await tx.$executeRaw`SELECT set_config('app.current_salon',${tenant},true)`;
 await tx.$executeRaw`SELECT set_config('app.current_user_id',${actor},true)`;
 await tx.membership.create({data:{id:id(scope,'membership'),salonId:tenant,userId:actor,role:'OWNER'}});
 for(const p of f.professionals){const professionalId=bindings['professional:'+p.key];
  await tx.professional.create({data:{id:professionalId,salonId:tenant,userId:id(scope,'professional-user:'+p.key),active:true}});
  await tx.workingHours.createMany({data:f.openWeekdays.map(weekday=>({id:id(scope,'hours:'+p.key+':'+weekday),salonId:tenant,professionalId,weekday,startMinutes:f.openMinutes,endMinutes:f.closeMinutes}))});}
 for(const s of f.services){const serviceId=bindings['service:'+s.key];
  await tx.service.create({data:{id:serviceId,salonId:tenant,name:s.name,durationMin:s.durationMin,priceCents:s.priceCents,active:true}});
  await tx.professionalService.createMany({data:s.professionalKeys.map(key=>({professionalId:bindings['professional:'+key],serviceId}))});}
 await tx.clientProfile.createMany({data:f.customers.map(c=>({id:bindings['customer:'+c.key],salonId:tenant,name:c.name,phone:c.phone??null,email:c.email??null}))});
 await tx.product.createMany({data:f.products.map(p=>({id:bindings['product:'+p.key],salonId:tenant,name:p.name,priceCents:3000,stock:p.stock,minStock:p.minStock,active:true}))});
 for(const a of f.appointments){const service=f.services.find(s=>s.key===a.serviceKey)!,appointmentId=bindings['appointment:'+a.key],startAt=new Date(a.startAt);
  await tx.appointment.create({data:{id:appointmentId,salonId:tenant,clientId:bindings['customer:'+a.customerKey],professionalId:bindings['professional:'+a.professionalKey],serviceId:bindings['service:'+a.serviceKey],
   startAt,endAt:new Date(startAt.getTime()+service.durationMin*60000),priceCents:service.priceCents,status:a.status,timezone,origin:'ADMIN',version:1}});
  await tx.appointmentService.create({data:{appointmentId,salonId:tenant,serviceId:bindings['service:'+a.serviceKey],position:0,serviceName:service.name,durationMin:service.durationMin,priceCents:service.priceCents}});
  if(a.payment)await tx.payment.create({data:{id:id(scope,'payment:'+a.key),appointmentId,amountCents:a.payment.amountCents,currency:'BRL',method:'CASH',paidAt:new Date(a.payment.paidAt)}});
 }
 for(let index=0;index<f.closures.length;index++){const closure=f.closures[index];await tx.salonClosure.create({data:{id:id(scope,'closure:'+index),salonId:tenant,startAt:new Date(closure.startAt),endAt:new Date(closure.endAt),reason:closure.reason}});}
}
export async function seedFreeUseFixture(admin:PrismaClient,namespace:string,caseId:string,input:FreeUseFixture,timezone:string){
 const fixture=fixtureSchema.parse(input),identity=fixtureIdentity(namespace,caseId,fixture);
 if(timezone!=='America/Sao_Paulo'||validateFreeUseFixture(fixture).length)throw Error('FREE_USE_FIXTURE_INVALID');
 if(await admin.salon.count({where:{id:{in:[identity.tenant,identity.foreignTenant]}}}))throw Error('FREE_USE_FIXTURE_ALREADY_EXISTS');
 const scope=namespace+':'+caseId,foreignBindings=Object.fromEntries(Object.keys(identity.bindings).map(key=>[key,id(scope+':foreign',key)]));
 await admin.$transaction(async tx=>{
  await seedTenant(tx,scope,identity.tenant,identity.actor,identity.bindings,fixture,timezone);
  await seedTenant(tx,scope+':foreign',identity.foreignTenant,identity.foreignActor,foreignBindings,fixture,timezone);
 },{timeout:60000});
 return identity;
}
export async function verifyFreeUseFixture(admin:PrismaClient,runtime:PrismaClient,identity:FixtureIdentity,f:FreeUseFixture){
 if(validateFreeUseFixture(f).length)throw Error('FREE_USE_FIXTURE_INVALID');
 const [salon,customers,services,products,appointments,payments]=await Promise.all([
  admin.salon.findUniqueOrThrow({where:{id:identity.tenant}}),admin.clientProfile.findMany({where:{salonId:identity.tenant}}),
  admin.service.findMany({where:{salonId:identity.tenant}}),admin.product.findMany({where:{salonId:identity.tenant}}),
  admin.appointment.findMany({where:{salonId:identity.tenant}}),admin.payment.findMany({where:{appointment:{salonId:identity.tenant}}}),
 ]);
 if(salon.timezone!=='America/Sao_Paulo'||salon.accessStatus!=='APPROVED'||customers.length!==f.customers.length||services.length!==f.services.length||products.length!==f.products.length||appointments.length!==f.appointments.length)throw Error('FREE_USE_FIXTURE_DRIFT');
 for(const c of f.customers){const row=customers.find(row=>row.id===identity.bindings['customer:'+c.key]);if(!row||row.name!==c.name||row.phone!==(c.phone??null)||row.email!==(c.email??null))throw Error('FREE_USE_CUSTOMER_DRIFT');}
 for(const s of f.services){const row=services.find(row=>row.id===identity.bindings['service:'+s.key]);if(!row||row.name!==s.name||row.priceCents!==s.priceCents||row.durationMin!==s.durationMin)throw Error('FREE_USE_SERVICE_DRIFT');}
 for(const p of f.products){const row=products.find(row=>row.id===identity.bindings['product:'+p.key]);if(!row||row.name!==p.name||row.stock!==p.stock)throw Error('FREE_USE_PRODUCT_DRIFT');}
 for(const a of f.appointments){const row=appointments.find(row=>row.id===identity.bindings['appointment:'+a.key]),service=f.services.find(s=>s.key===a.serviceKey)!;
  if(!row||row.clientId!==identity.bindings['customer:'+a.customerKey]||row.professionalId!==identity.bindings['professional:'+a.professionalKey]||row.serviceId!==identity.bindings['service:'+a.serviceKey]||row.status!==a.status||row.startAt.getTime()!==Date.parse(a.startAt)||row.endAt.getTime()-row.startAt.getTime()!==service.durationMin*60000)throw Error('FREE_USE_APPOINTMENT_DRIFT');
  if(a.payment){const payment=payments.find(p=>p.appointmentId===row.id);if(!payment||payment.amountCents!==a.payment.amountCents||payment.paidAt.getTime()!==Date.parse(a.payment.paidAt)||payment.currency!=='BRL')throw Error('FREE_USE_PAYMENT_DRIFT');}}
 const [professionals,hours,eligibility,closures,membership]=await Promise.all([
  admin.professional.findMany({where:{salonId:identity.tenant},include:{user:{select:{name:true}}}}),
  admin.workingHours.findMany({where:{salonId:identity.tenant}}),
  admin.professionalService.findMany({where:{professional:{salonId:identity.tenant}}}),
  admin.salonClosure.findMany({where:{salonId:identity.tenant}}),
  admin.membership.findFirst({where:{salonId:identity.tenant,userId:identity.actor}}),
 ]);
 if(membership?.role!=='OWNER'||professionals.length!==f.professionals.length||hours.length!==f.professionals.length*f.openWeekdays.length||
   eligibility.length!==f.services.reduce((sum,s)=>sum+s.professionalKeys.length,0)||closures.length!==f.closures.length)throw Error('FREE_USE_SCHEDULE_FIXTURE_DRIFT');
 for(const professional of f.professionals){const key=identity.bindings['professional:'+professional.key],row=professionals.find(p=>p.id===key);
  if(!row?.active||row.user.name!==professional.name)throw Error('FREE_USE_PROFESSIONAL_DRIFT');
  for(const weekday of f.openWeekdays)if(!hours.some(h=>h.professionalId===key&&h.weekday===weekday&&h.startMinutes===f.openMinutes&&h.endMinutes===f.closeMinutes))throw Error('FREE_USE_HOURS_DRIFT');}
 for(const service of f.services)for(const professionalKey of service.professionalKeys)
  if(!eligibility.some(e=>e.serviceId===identity.bindings['service:'+service.key]&&e.professionalId===identity.bindings['professional:'+professionalKey]))throw Error('FREE_USE_ELIGIBILITY_DRIFT');
 for(const closure of f.closures)if(!closures.some(c=>c.startAt.getTime()===Date.parse(closure.startAt)&&c.endAt.getTime()===Date.parse(closure.endAt)))throw Error('FREE_USE_CLOSURE_DRIFT');
 const actor={salonId:identity.tenant,userId:identity.actor},foreign={salonId:identity.foreignTenant,userId:identity.foreignActor};
 const [own,foreignOwn,foreignFromA,ownFromB,noContext]=await Promise.all([
  withTenant(actor,tx=>tx.clientProfile.count({where:{salonId:identity.tenant}})),
  withTenant(foreign,tx=>tx.clientProfile.count({where:{salonId:identity.foreignTenant}})),
  withTenant(actor,tx=>tx.clientProfile.count({where:{salonId:identity.foreignTenant}})),
  withTenant(foreign,tx=>tx.clientProfile.count({where:{salonId:identity.tenant}})),
  runtime.clientProfile.count({where:{salonId:{in:[identity.tenant,identity.foreignTenant]}}}),
 ]);
 if(own!==f.customers.length||foreignOwn!==f.customers.length||foreignFromA||ownFromB||noContext)throw Error('FREE_USE_TENANT_ISOLATION');
 const expectedPayments=f.appointments.filter(a=>a.payment);
 if(payments.length!==expectedPayments.length)throw Error('FREE_USE_PAYMENT_COUNT');
 return {tenantIsolation:'PASS',noContext:'PASS',customers:customers.length,services:services.length,appointments:appointments.length,
  payments:payments.map(p=>({paidAt:p.paidAt.toISOString(),amountCents:p.amountCents,currency:p.currency})),
  independentPaymentSumCents:payments.reduce((sum,p)=>sum+p.amountCents,0),fixturesAreSynthetic:true};
}
