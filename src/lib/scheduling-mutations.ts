import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { schedulingAlteration, serviceChangesResolved, type SchedulingFields } from "./scheduling-contract";
import { formatLocal, formatLocalRange } from "./secretary-datetime-format";
import { assertSchedulingAccess, getSchedulingAppointment, listSchedulingAppointments } from "./scheduling-catalog";
import { inspectAppointmentAvailability, inspectAppointmentAvailabilityWithServiceSnapshots, lockAppointmentOperationalScope, cancelAppointmentReliably } from "./appointment-service";
import { alterAppointmentEnabled } from "../../packages/salon-secretary/src/alter-appointment";
import { cancelReasonOptionalEnabled } from "../../packages/salon-secretary/src/cancel-reason";
import { requestStaffReschedule } from "./reschedule-proposals";
import { executeAvailabilityBlock, expandBlock } from "./availability-block-domain";
import { lockOperationalResources } from "./inventory-lock";
import { addCalendarDays, toLocalDateTime, localDateTimeToUtc } from "./time";
import { assertSchedulingTemporalConsistency, matchesSchedulingPeriod } from "./scheduling-temporal";
import { releasedAgendaView } from "./scheduling-released-slot";

export const mutationOperation=z.enum(["appointment.change","appointment.cancel","schedule.block"]);
export const isSchedulingMutation=(op:string)=>mutationOperation.safeParse(op).success;
const serviceSnapshot=z.object({id:z.string(),name:z.string(),durationMin:z.number(),priceCents:z.number(),priceType:z.string(),priceNote:z.string().nullable(),processingMin:z.number(),finishingMin:z.number()}).strict();
export const actionSnapshot=z.object({
  kind:mutationOperation,professional_ref:z.string(),professional_name:z.string(),timezone:z.string(),startLocal:z.string(),endLocal:z.string(),
  appointment_ref:z.string().optional(),revision:z.number().optional(),before_start:z.string().optional(),before_end:z.string().optional(),before_timezone:z.string().optional(),
  customer_name:z.string().optional(),customer_ref:z.string().optional(),priceCents:z.number().optional(),services:z.array(serviceSnapshot),
  requires_acceptance:z.boolean(),resource_ids:z.array(z.string()),waiting_count:z.number(),waiting_hash:z.string(),
  affected:z.array(z.object({id:z.string(),version:z.number(),name:z.string(),startLocal:z.string()}).strict()),
  // P2a (only on an alteration): who attended and what was booked before; professional_ref/services/priceCents are the new ones.
  before_professional_ref:z.string().optional(),before_professional_name:z.string().optional(),before_services:z.array(serviceSnapshot).optional(),before_price_cents:z.number().optional(),
}).strict();
export type ActionSnapshot=z.infer<typeof actionSnapshot>;
/** P2a: the service list an alteration asks for, from the appointment's current services (ids, in order). SET is the complete
 * new list; REMOVE takes out a service the appointment holds; INCLUDE puts a service it does not hold where the first removed one
 * was (a swap keeps the order), else at the end. Refused, never guessed: a service to remove the appointment does not have,
 * one to add it already has, no service left, more than 10. `index`: the change refused. A SET of exactly the current services
 * keeps their order (the domain's order): nothing changes. */
export type AlteredServices={ids:string[]}|{error:"SERVICE_NOT_IN_APPOINTMENT"|"SERVICE_ALREADY_IN_APPOINTMENT"|"SERVICE_CHANGE_EMPTY"|"SERVICE_CHANGE_TOO_MANY"|"SERVICE_CHANGE_MIXED";index?:number};
export function alteredServiceIds(current:readonly string[],changes:readonly {mode:"SET"|"INCLUDE"|"REMOVE";ref:string}[]):AlteredServices{
  if(changes.some(change=>change.mode==="SET")){
    if(changes.some(change=>change.mode!=="SET"))return {error:"SERVICE_CHANGE_MIXED"};
    const ids=[...new Set(changes.map(change=>change.ref))];
    // Review A: the same services said in another order are the appointment's own list (a no-op, never a repriced change).
    if(ids.length===current.length&&ids.every(id=>current.includes(id)))return {ids:[...current]};
    return ids.length>10?{error:"SERVICE_CHANGE_TOO_MANY"}:{ids};
  }
  let ids=[...current],at:number|undefined;
  for(const [index,change]of changes.entries())if(change.mode==="REMOVE"){
    const position=ids.indexOf(change.ref);if(position<0)return {error:"SERVICE_NOT_IN_APPOINTMENT",index};
    at??=position;ids=ids.filter(id=>id!==change.ref);
  }
  const added:string[]=[];
  for(const [index,change]of changes.entries())if(change.mode==="INCLUDE"){
    if(ids.includes(change.ref)||added.includes(change.ref))return {error:"SERVICE_ALREADY_IN_APPOINTMENT",index};
    added.push(change.ref);
  }
  ids=at===undefined?[...ids,...added]:[...ids.slice(0,at),...added,...ids.slice(at)];
  return !ids.length?{error:"SERVICE_CHANGE_EMPTY"}:ids.length>10?{error:"SERVICE_CHANGE_TOO_MANY"}:{ids};
}
/** P2a: what a change's fields alter, against the appointment's current service ids. Never with the flag off, never with a
 * name still unresolved; a refused service delta throws its code. Empty when the change alters nothing but the slot. */
export function alterationFromFields(f:SchedulingFields,current:readonly string[]):{professional_ref?:string;service_ids?:string[]}{
  if(!schedulingAlteration(f))return {};
  if(!alterAppointmentEnabled())throw Error("ALTER_APPOINTMENT_DISABLED");
  if(f.target_professional_name&&!f.target_professional_ref||!serviceChangesResolved(f))throw Error("NEEDS_INPUT");
  const services=f.service_changes?alteredServiceIds(current,f.service_changes.map((change,index)=>({mode:change.mode,ref:f.service_changes_ref![index]!}))):undefined;
  if(services&&"error" in services)throw Error(services.error);
  return {...(f.target_professional_ref?{professional_ref:f.target_professional_ref}:{}),...(services?{service_ids:services.ids}:{})};
}
/** P2a: the appointment's professional and services in order (tenant scoped), for the alteration questions. */
export async function schedulingAppointmentServices(tx:Tx,actor:ServiceActor,ref:string){
  await assertSchedulingAccess(tx,actor);
  const a=await tx.appointment.findFirst({where:{id:ref,salonId:actor.salonId},select:{professionalId:true,client:{select:{name:true}},professional:{select:{user:{select:{name:true}}}},
    service:{select:{id:true,name:true}},serviceItems:{orderBy:{position:"asc"},select:{serviceId:true,serviceName:true}}}});
  if(!a)throw Error("APPOINTMENT_NOT_FOUND");
  return {professional_ref:a.professionalId,professional_name:a.professional.user.name,customer_name:a.client.name,
    services:a.serviceItems.length?a.serviceItems.map(s=>({id:s.serviceId,name:s.serviceName})):[{id:a.service.id,name:a.service.name}]};
}
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
  // P2a (flag): a service locates an appointment holding it in any position, as the dated search does (scheduling-catalog).
  const byService=f.service_ref?alterAppointmentEnabled()?{OR:[{serviceId:f.service_ref},{serviceItems:{some:{serviceId:f.service_ref}}}]}:{serviceId:f.service_ref}:{};
  const filters={...(f.customer_ref?{clientId:f.customer_ref}:{}),...(f.professional_ref?{professionalId:f.professional_ref}:{}),...byService};
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
/** T07 mutation adapter delegates to the existing snapshot-aware availability engine.
 * `excluded` (C4): local clocks ("HH:mm") the owner excluded; never offered as an alternative.
 * `released` (C5): an appointment a pending cancellation of the same plan releases; the destination is checked as if it
 * were free (preparation only; the executor passes nothing and re-checks the committed agenda). */
/** `fields` (P2a, flag SALON_SECRETARY_ALTER_APPOINTMENT): the change's alteration (alterationFromFields). The destination is
 * then checked for the NEW professional and the NEW services with their catalog duration and price, exactly the domain path
 * the executor takes (the historical snapshots when the services stay, the catalog otherwise); no date and no time keep the
 * appointment's own start. The alternatives are the new professional's, for the new duration. */
export async function inspectSchedulingMove(tx:Tx,actor:ServiceActor,ref:string,date:string|undefined,time:string|undefined,excluded?:ReadonlySet<string>,released?:string,fields?:SchedulingFields){
  await authorizeSchedulingOperation(tx,actor,"appointment.change");
  const current=await mutableSnapshot(tx,actor,ref);
  const alteration=fields?alterationFromFields(fields,current.services.map(s=>s.id)):{};
  const professional=alteration.professional_ref??current.dto.professional_ref,ids=alteration.service_ids;
  const servicesChanged=!!ids&&!(ids.length===current.services.length&&ids.every((id,index)=>id===current.services[index].id));
  const agenda=released&&released!==ref?releasedAgendaView(tx,released):tx;
  const inspect=async(startLocal:string)=>{
    if(servicesChanged)return inspectAppointmentAvailability(agenda,{salonId:actor.salonId,professionalId:professional,serviceIds:ids!,startLocal,excludeAppointmentId:ref,enforceBookingWindow:false});
    const probes=current.resource_ids.length?current.resource_ids:[undefined];
    let result;
    for(const resource of probes){
      result=await inspectAppointmentAvailabilityWithServiceSnapshots(agenda,{salonId:actor.salonId,professionalId:professional,currentProfessionalId:current.dto.professional_ref,
        serviceSnapshots:current.services.map((s,i)=>({...s,...(i===0&&resource?{physicalResourceId:resource}:{})})),startLocal,excludeAppointmentId:ref,enforceBookingWindow:false});
      if(result.violation)return result;
    }
    return result!;
  };
  // An alteration with no destination said keeps the slot; a day without a clock is never completed here (GF14).
  if(date===undefined&&time===undefined&&!alteration.professional_ref&&!ids||(date===undefined)!==(time===undefined))throw Error("NEEDS_INPUT");
  const requested=date!==undefined&&time!==undefined?`${date}T${time}`:current.dto.start_local.slice(0,16);
  const salon=await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}});
  if(localDateTimeToUtc(requested,salon.timezone)<=new Date())throw Error("PAST_TIME");
  const result=await inspect(requested);
  const alternatives:{startLocal:string;endLocal:string;professional_ref:string}[]=[];
  if(result.violation){
    const day=requested.slice(0,10),minute=Number(requested.slice(11,13))*60+Number(requested.slice(14,16));
    for(let m=Math.ceil((minute+1)/15)*15;m<1440&&alternatives.length<5;m+=15){
      const local=`${day}T${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
      if(excluded?.has(local.slice(11)))continue;
      const option=await inspect(local);if(!option.violation)alternatives.push({startLocal:local,endLocal:toLocalDateTime(option.endAt,option.timezone),professional_ref:professional});
    }
  }
  return {current,result,alternatives,professional_ref:professional,services_changed:servicesChanged};
}
export async function schedulingActionSnapshot(tx:Tx,actor:ServiceActor,operation:string,f:SchedulingFields,released?:string):Promise<ActionSnapshot>{
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
  // P2a: an alteration re-checks the destination for its new professional and services (and keeps the slot when none was said).
  const alter=kind==="appointment.change"&&schedulingAlteration(f);
  const move=kind==="appointment.change"?await (alter?inspectSchedulingMove(tx,actor,f.appointment_ref,f.date,f.time,undefined,released,f):released?inspectSchedulingMove(tx,actor,f.appointment_ref,f.date!,f.time!,undefined,released):inspectSchedulingMove(tx,actor,f.appointment_ref,f.date!,f.time!)):undefined;
  if(move?.result.violation)throw Error("SLOT_CONFLICT");
  const current=move?.current??await mutableSnapshot(tx,actor,f.appointment_ref);const d=current.dto;
  if(kind==="appointment.cancel"&&!cancelReasonOptionalEnabled()&&(!f.reason||f.reason.trim().length<3))throw Error("REASON_REQUIRED");
  const alteration=alter&&move?await alterationSnapshot(tx,actor,d,current.services,move):{};
  return actionSnapshot.parse({kind,appointment_ref:d.appointment_ref,revision:d.revision,customer_ref:d.customer_ref,customer_name:d.customer_name,
    professional_ref:d.professional_ref,professional_name:d.professional_name,timezone:move?.result.timezone??d.timezone,before_start:d.start_local,before_end:d.end_local,before_timezone:d.timezone,
    startLocal:move?toLocalDateTime(move.result.startAt,move.result.timezone):d.start_local,endLocal:move?toLocalDateTime(move.result.endAt,move.result.timezone):d.end_local,
    priceCents:d.priceCents,services:current.services,resource_ids:current.resource_ids,requires_acceptance:kind==="appointment.change"&&current.requires_acceptance&&toLocalDateTime(move!.result.startAt,d.timezone)!==d.start_local,
    waiting_count:current.waiting.length,waiting_hash:createHash("sha256").update(JSON.stringify(current.waiting)).digest("hex"),affected:[],...alteration});
}
/** P2a: the snapshot keys an alteration replaces: the new professional, services (the domain's own snapshots: catalog
 * duration and price when the list changes) and total price, what was there before, and the customer's acceptance exactly as
 * the domain decides it (requestStaffReschedule: an account customer accepts any change of slot, professional or services).
 * Nothing changing at all is refused (no proposal for a no-op). */
async function alterationSnapshot(tx:Tx,actor:ServiceActor,d:Awaited<ReturnType<typeof mutableSnapshot>>["dto"],before:Awaited<ReturnType<typeof mutableSnapshot>>["services"],
  move:{result:{startAt:Date;timezone:string;services:{id:string;name:string;durationMin:number;priceCents:number;priceType?:string;priceNote?:string|null;processingMin?:number;finishingMin?:number}[]};professional_ref:string;services_changed:boolean;current:{requires_acceptance:boolean}}){
  const moved=toLocalDateTime(move.result.startAt,d.timezone)!==d.start_local,pro=move.professional_ref!==d.professional_ref;
  if(!moved&&!pro&&!move.services_changed)throw Error("NO_CHANGE");
  const target=pro?await tx.professional.findFirst({where:{id:move.professional_ref,salonId:actor.salonId,active:true},select:{user:{select:{name:true}}}}):undefined;
  if(pro&&!target)throw Error("PROFESSIONAL_NOT_FOUND");
  const services=move.services_changed?move.result.services.map(s=>({id:s.id,name:s.name,durationMin:s.durationMin,priceCents:s.priceCents,priceType:s.priceType??"FIXED",priceNote:s.priceNote??null,processingMin:s.processingMin??0,finishingMin:s.finishingMin??0})):before;
  return {professional_ref:move.professional_ref,professional_name:pro?target!.user.name:d.professional_name,services,
    ...(move.services_changed?{priceCents:services.reduce((sum,s)=>sum+s.priceCents,0)}:{}),
    requires_acceptance:move.current.requires_acceptance&&(moved||pro||move.services_changed),
    ...(pro?{before_professional_ref:d.professional_ref,before_professional_name:d.professional_name}:{}),
    ...(move.services_changed?{before_services:before,before_price_cents:d.priceCents}:{})};
}
export function schedulingActionPreview(s:ActionSnapshot,reason?:string){
  // Human text only; the snapshot keeps ISO local values for hashes and execution.
  const when=(start:string,end:string,timezone?:string)=>`${formatLocalRange(start,end)}${timezone&&timezone!==s.timezone?` (${timezone})`:""}`;
  const waiting=(n:number,change:boolean)=>n?`Lista de espera: ${n} pessoa(s)${change?"; o horário liberado pode ser oferecido a elas.":", sem oferta automática."}`:"Lista de espera: ninguém.";
  if(s.kind==="schedule.block")return `BLOQUEAR AGENDA\n${s.professional_name}\n${when(s.startLocal,s.endLocal)}\n${s.affected.length?`${s.affected.length} agendamento(s) nesse período continuam marcados:`:"Nenhum agendamento nesse período."}${s.affected.map(a=>`\n${a.name} — ${formatLocal(a.startLocal)}`).join("")}${reason?`\nMotivo: ${reason}`:""}`;
  if(s.kind==="appointment.change"&&(s.before_professional_ref||s.before_services))return alterationPreview(s,when,waiting(s.waiting_count,true));
  const title=s.kind==="appointment.change"?"REMARCAR AGENDAMENTO":"CANCELAR AGENDAMENTO";
  return `${title}\n${s.customer_name}\n${s.services.map(s=>s.name).join(", ")}\n${s.professional_name}\nANTES: ${when(s.before_start!,s.before_end!,s.before_timezone)}`+
    (s.kind==="appointment.change"?`\nDEPOIS: ${when(s.startLocal,s.endLocal)}\nPreço mantido: ${((s.priceCents??0)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}${s.requires_acceptance?"\nO novo horário ficará aguardando o aceite do cliente.":""}\n${waiting(s.waiting_count,true)}`:`${reason?`\nMotivo: ${reason}`:""}\n${waiting(s.waiting_count,false)}`);
}
/** P2a: ANTES → DEPOIS of an alteration: services, professional and slot, then what stays and what changes (duration and
 * price only when the services change: the domain keeps the booked price otherwise). */
function alterationPreview(s:ActionSnapshot,when:(start:string,end:string,timezone?:string)=>string,waiting:string){
  const money=(cents:number,services:ActionSnapshot["services"])=>`${services.some(x=>x.priceType==="FROM")?"a partir de ":""}${(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}`;
  const list=(services:ActionSnapshot["services"])=>services.length<2?services.map(x=>x.name).join(""):`${services.slice(0,-1).map(x=>x.name).join(", ")} e ${services.at(-1)!.name}`;
  const minutes=(start:string,end:string)=>Math.round((Date.parse(`${end}:00Z`)-Date.parse(`${start}:00Z`))/60000);
  const before=s.before_services??s.services,kept=s.startLocal===s.before_start&&(!s.before_timezone||s.before_timezone===s.timezone);
  const title=s.before_professional_ref&&!s.before_services&&kept?"TROCAR PROFISSIONAL":"ALTERAR AGENDAMENTO";
  const lines=[title,s.customer_name!,
    `ANTES: ${list(before)} com ${s.before_professional_name??s.professional_name} — ${when(s.before_start!,s.before_end!,s.before_timezone)}`,
    `DEPOIS: ${list(s.services)} com ${s.professional_name} — ${when(s.startLocal,s.endLocal)}`,
    ...(kept?["Horário mantido."]:[]),
    ...(s.before_services?[`Duração: ${minutes(s.before_start!,s.before_end!)} min → ${minutes(s.startLocal,s.endLocal)} min`,`Preço: ${money(s.before_price_cents??0,before)} → ${money(s.priceCents??0,s.services)}`]
      :[`Preço mantido: ${money(s.priceCents??0,s.services)}`]),
    ...(s.requires_acceptance?["A alteração ficará aguardando o aceite do cliente."]:[]),waiting];
  return lines.join("\n");
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
