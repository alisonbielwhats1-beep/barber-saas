import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import type { SchedulingFields } from "./scheduling-contract";
import { assertSchedulingAccess, getSchedulingAppointment, listSchedulingAppointments } from "./scheduling-catalog";
import { inspectAppointmentAvailabilityWithServiceSnapshots, lockAppointmentOperationalScope, cancelAppointmentReliably } from "./appointment-service";
import { requestStaffReschedule } from "./reschedule-proposals";
import { executeAvailabilityBlock, expandBlock } from "./availability-block-domain";
import { lockOperationalResources } from "./inventory-lock";
import { addCalendarDays, toLocalDateTime, localDateTimeToUtc } from "./time";
import { assertSchedulingTemporalConsistency, matchesSchedulingPeriod } from "./scheduling-temporal";

export const mutationOperation=z.enum(["appointment.change","appointment.cancel","schedule.block"]);
export const isSchedulingMutation=(op:string)=>mutationOperation.safeParse(op).success;
const serviceSnapshot=z.object({id:z.string(),name:z.string(),durationMin:z.number(),priceCents:z.number(),priceType:z.string(),priceNote:z.string().nullable(),processingMin:z.number(),finishingMin:z.number()}).strict();
export const actionSnapshot=z.object({
  kind:mutationOperation,professional_ref:z.string(),professional_name:z.string(),timezone:z.string(),startLocal:z.string(),endLocal:z.string(),
  appointment_ref:z.string().optional(),revision:z.number().optional(),before_start:z.string().optional(),before_end:z.string().optional(),before_timezone:z.string().optional(),
  customer_name:z.string().optional(),customer_ref:z.string().optional(),priceCents:z.number().optional(),services:z.array(serviceSnapshot),
  requires_acceptance:z.boolean(),resource_ids:z.array(z.string()),waiting_count:z.number(),waiting_hash:z.string(),
  affected:z.array(z.object({id:z.string(),version:z.number(),name:z.string(),startLocal:z.string()}).strict()),
}).strict();
export type ActionSnapshot=z.infer<typeof actionSnapshot>;
export async function authorizeSchedulingOperation(tx:Tx,actor:ServiceActor,operation:string){
  await assertSchedulingAccess(tx,actor);
  const membership=await tx.membership.findFirstOrThrow({where:{salonId:actor.salonId,userId:actor.userId},select:{role:true}});
  if(["appointment.cancel","schedule.block"].includes(operation)&&!["OWNER","MANAGER"].includes(membership.role))throw Error("FORBIDDEN");
  return membership.role;
}
/** T05/T06 bounded locator. No reference supplied by the model. */
export async function locateSchedulingAppointments(tx:Tx,actor:ServiceActor,f:SchedulingFields,operation:string){
  await authorizeSchedulingOperation(tx,actor,operation);
  assertSchedulingTemporalConsistency(f);
  const date=operation==="appointment.change"?f.source_date:f.date;
  const time=operation==="appointment.change"?f.source_time:f.time;
  const filters={...(f.customer_ref?{clientId:f.customer_ref}:{}),...(f.professional_ref?{professionalId:f.professional_ref}:{}),...(f.service_ref?{serviceId:f.service_ref}:{})};
  let rows;
  if(date)rows=await listSchedulingAppointments(tx,actor,{date,customer_ref:f.customer_ref,service_ref:f.service_ref,professional_ref:f.professional_ref});
  else {
    if(!f.customer_ref)throw Error("APPOINTMENT_SELECTOR_REQUIRED");
    const ids=await tx.appointment.findMany({where:{salonId:actor.salonId,...filters,status:{in:["PENDING","CONFIRMED"]},startAt:{gt:new Date()}},select:{id:true},orderBy:[{startAt:"asc"},{id:"asc"}],take:51});
    if(ids.length>50)throw Error("APPOINTMENT_SEARCH_TOO_BROAD");
    rows=await Promise.all(ids.map(r=>getSchedulingAppointment(tx,actor,r.id)));
  }
  if(rows.length>50)throw Error("APPOINTMENT_SEARCH_TOO_BROAD");
  return rows.filter(r=>["PENDING","CONFIRMED"].includes(r.status)&&new Date(r.start_at)>new Date()&&(!time||r.start_local.slice(11)===time)&&(operation!=="appointment.cancel"||matchesSchedulingPeriod(r.start_local.slice(11),f.period)));
}
async function mutableSnapshot(tx:Tx,actor:ServiceActor,ref:string){
  const dto=await getSchedulingAppointment(tx,actor,ref);
  if(!["PENDING","CONFIRMED"].includes(dto.status)||new Date(dto.start_at)<=new Date())throw Error("ALREADY_STARTED_OR_CLOSED");
  const a=await tx.appointment.findFirstOrThrow({where:{id:ref,salonId:actor.salonId},select:{
    dependentId:true,products:{select:{id:true}},service:{select:{id:true,name:true,durationMin:true,priceCents:true,priceType:true,priceNote:true,processingMin:true,finishingMin:true}},
    serviceItems:{orderBy:{position:"asc"},select:{serviceId:true,serviceName:true,durationMin:true,priceCents:true,priceType:true,priceNote:true,processingMin:true,finishingMin:true}},
  }});
  if(a.products.length||a.dependentId)throw Error("SCHEDULING_RELATION_NOT_SUPPORTED");
  const services=a.serviceItems.length?a.serviceItems.map(s=>({id:s.serviceId,name:s.serviceName,durationMin:s.durationMin,priceCents:s.priceCents,priceType:s.priceType,priceNote:s.priceNote,processingMin:s.processingMin,finishingMin:s.finishingMin})):[a.service];
  const resources=await tx.resourceBooking.findMany({where:{salonId:actor.salonId,appointmentId:ref,retired:false},select:{resourceId:true},orderBy:{resourceId:"asc"}});
  const waiting=await tx.waitlistEntry.findMany({where:{salonId:actor.salonId,appointmentId:ref,fulfilledAt:null,cancelledAt:null},select:{id:true,clientId:true,startAt:true,endAt:true,serviceSnapshots:true,priceCents:true},orderBy:{id:"asc"}});
  // Account detection stays internal; only a boolean reaches proposals/Agent context.
  const [account]=await tx.$queryRaw<{has_account:boolean}[]>`SELECT (NULLIF(c."passwordHash",'') IS NOT NULL OR c."authIdentityId" IS NOT NULL OR NULLIF(u."passwordHash",'') IS NOT NULL OR u."authIdentityId" IS NOT NULL) AS has_account FROM "ClientProfile" c LEFT JOIN "User" u ON u.id=c."userId" WHERE c.id=${dto.customer_ref} AND c."salonId"=${actor.salonId}`;
  return {dto,services,resource_ids:resources.map(r=>r.resourceId),waiting,requires_acceptance:account?.has_account??false};
}
/** T07 mutation adapter delegates to the existing snapshot-aware availability engine. */
export async function inspectSchedulingMove(tx:Tx,actor:ServiceActor,ref:string,date:string,time:string){
  await authorizeSchedulingOperation(tx,actor,"appointment.change");
  const current=await mutableSnapshot(tx,actor,ref);
  const inspect=async(startLocal:string)=>{
    const probes=current.resource_ids.length?current.resource_ids:[undefined];
    let result;
    for(const resource of probes){
      result=await inspectAppointmentAvailabilityWithServiceSnapshots(tx,{salonId:actor.salonId,professionalId:current.dto.professional_ref,currentProfessionalId:current.dto.professional_ref,
        serviceSnapshots:current.services.map((s,i)=>({...s,...(i===0&&resource?{physicalResourceId:resource}:{})})),startLocal,excludeAppointmentId:ref,enforceBookingWindow:false});
      if(result.violation)return result;
    }
    return result!;
  };
  const requested=`${date}T${time}`;
  const salon=await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}});
  if(localDateTimeToUtc(requested,salon.timezone)<=new Date())throw Error("PAST_TIME");
  const result=await inspect(requested);
  const alternatives:{startLocal:string;endLocal:string;professional_ref:string}[]=[];
  if(result.violation){
    const minute=Number(time.slice(0,2))*60+Number(time.slice(3));
    for(let m=Math.ceil((minute+1)/15)*15;m<1440&&alternatives.length<5;m+=15){
      const local=`${date}T${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
      const option=await inspect(local);if(!option.violation)alternatives.push({startLocal:local,endLocal:toLocalDateTime(option.endAt,option.timezone),professional_ref:current.dto.professional_ref});
    }
  }
  return {current,result,alternatives};
}
export async function schedulingActionSnapshot(tx:Tx,actor:ServiceActor,operation:string,f:SchedulingFields):Promise<ActionSnapshot>{
  const kind=mutationOperation.parse(operation);await authorizeSchedulingOperation(tx,actor,kind);
  assertSchedulingTemporalConsistency(f);
  if(kind==="schedule.block"){
    if(!f.professional_ref||!f.date||!f.time||!f.end_time)throw Error("NEEDS_INPUT");
    const pro=await tx.professional.findFirst({where:{id:f.professional_ref,salonId:actor.salonId,active:true},select:{id:true,user:{select:{name:true}}}});if(!pro)throw Error("PROFESSIONAL_NOT_FOUND");
    const {timezone}=await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}});
    const startLocal=`${f.date}T${f.time}`,endLocal=`${f.end_date??(f.end_time==="00:00"?addCalendarDays(f.date,1):f.date)}T${f.end_time}`;
    const [interval]=expandBlock({id:"00000000-0000-4000-8000-000000000000",professionalIds:[pro.id],startLocal,endLocal,reason:f.reason??""},timezone);
    const affected=await tx.appointment.findMany({where:{salonId:actor.salonId,professionalId:pro.id,startAt:{lt:interval.endAt},endAt:{gt:interval.startAt},status:{in:["PENDING","CONFIRMED","IN_PROGRESS"]}},select:{id:true,version:true,startAt:true,client:{select:{name:true}}},orderBy:{id:"asc"}});
    return actionSnapshot.parse({kind,professional_ref:pro.id,professional_name:pro.user.name,timezone,startLocal,endLocal,services:[],resource_ids:[],waiting_count:0,waiting_hash:"",requires_acceptance:false,affected:affected.map(a=>({id:a.id,version:a.version,name:a.client.name,startLocal:toLocalDateTime(a.startAt,timezone)}))});
  }
  if(!f.appointment_ref)throw Error("NEEDS_INPUT");
  const move=kind==="appointment.change"?await inspectSchedulingMove(tx,actor,f.appointment_ref,f.date!,f.time!):undefined;
  if(move?.result.violation)throw Error("SLOT_CONFLICT");
  const current=move?.current??await mutableSnapshot(tx,actor,f.appointment_ref);const d=current.dto;
  if(kind==="appointment.cancel"&&(!f.reason||f.reason.trim().length<3))throw Error("REASON_REQUIRED");
  return actionSnapshot.parse({kind,appointment_ref:d.appointment_ref,revision:d.revision,customer_ref:d.customer_ref,customer_name:d.customer_name,
    professional_ref:d.professional_ref,professional_name:d.professional_name,timezone:move?.result.timezone??d.timezone,before_start:d.start_local,before_end:d.end_local,before_timezone:d.timezone,
    startLocal:move?toLocalDateTime(move.result.startAt,move.result.timezone):d.start_local,endLocal:move?toLocalDateTime(move.result.endAt,move.result.timezone):d.end_local,
    priceCents:d.priceCents,services:current.services,resource_ids:current.resource_ids,requires_acceptance:kind==="appointment.change"&&current.requires_acceptance&&toLocalDateTime(move!.result.startAt,d.timezone)!==d.start_local,
    waiting_count:current.waiting.length,waiting_hash:createHash("sha256").update(JSON.stringify(current.waiting)).digest("hex"),affected:[]});
}
export function schedulingActionPreview(s:ActionSnapshot,reason?:string){
  if(s.kind==="schedule.block")return `BLOQUEAR AGENDA\n${s.professional_name}\n${s.startLocal}–${s.endLocal} (${s.timezone})\n${s.affected.length} agendamento(s) atingido(s), preservado(s).${s.affected.map(a=>`\n${a.name} — ${a.startLocal}`).join("")}${reason?`\nMotivo: ${reason}`:""}`;
  const title=s.kind==="appointment.change"?"REMARCAR AGENDAMENTO":"CANCELAR AGENDAMENTO";
  return `${title}\n${s.customer_name}\n${s.services.map(s=>s.name).join(", ")}\n${s.professional_name}\nANTES: ${s.before_start}–${s.before_end} (${s.before_timezone??s.timezone})`+
    (s.kind==="appointment.change"?`\nDEPOIS: ${s.startLocal}–${s.endLocal} (${s.timezone})\nPreço preservado: ${((s.priceCents??0)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}\n${s.requires_acceptance?"O novo horário será reservado e ficará aguardando aceite do cliente.":"Sem nova solicitação de aceite."}\nFila ativa: ${s.waiting_count}. A regra existente pode promover a fila na origem liberada.`:`\nMotivo: ${reason}\nFila ativa: ${s.waiting_count}, preservada sem promoção automática.`);
}
export async function executeSchedulingMutation(tx:Tx,actor:ServiceActor,s:ActionSnapshot,f:SchedulingFields,key:string){
  const role=await authorizeSchedulingOperation(tx,actor,s.kind);
  if(s.kind==="schedule.block")await lockOperationalResources(tx,{professionalIds:[s.professional_ref]});
  else await lockAppointmentOperationalScope(tx,{salonId:actor.salonId,appointmentId:s.appointment_ref!,targetProfessionalIds:[s.professional_ref]});
  const fresh=await schedulingActionSnapshot(tx,actor,s.kind,f);
  if(JSON.stringify(fresh)!==JSON.stringify(s))throw Error("SCHEDULE_CHANGED");
  if(s.kind==="schedule.block"){
    await executeAvailabilityBlock(tx,{...actor,role},{id:key,professionalIds:[s.professional_ref],startLocal:s.startLocal,endLocal:s.endLocal,reason:f.reason??""});
    return {block_ref:`${key}:${s.professional_ref}`,outcome:"BLOCKED" as const};
  }
  const args={salonId:actor.salonId,appointmentId:s.appointment_ref!,idempotencyKey:key,expectedVersion:s.revision,actor:{type:"STAFF" as const,id:actor.userId,name:"Secretária — equipe autenticada"}};
  if(s.kind==="appointment.cancel"){await cancelAppointmentReliably(tx,{...args,reason:f.reason,enforceClientPolicy:false});return {appointment_ref:s.appointment_ref,outcome:"CANCELLED" as const};}
  const result=await requestStaffReschedule(tx,{...args,professionalId:s.professional_ref,serviceIds:s.services.map(x=>x.id),startLocal:s.startLocal});
  return {appointment_ref:s.appointment_ref,outcome:result.requiresAcceptance?"PENDING_ACCEPTANCE" as const:"RESCHEDULED" as const,...(result.requiresAcceptance?{acceptance_ref:result.proposalId}:{})};
}
