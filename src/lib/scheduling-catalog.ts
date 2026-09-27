import { z } from "zod";
import { performance } from "node:perf_hooks";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { assertCustomerAccess, getCustomer } from "./customer-catalog";
import { loadVisitDay, findVisitPlan, visitQuote } from "./visit-scheduling";
import { endExclusiveOfDateInTimeZone, isDateKey, localDateTimeToUtc, startOfDateInTimeZone, toLocalDateTime } from "./time";
import { assertSchedulingTemporalConsistency, matchesSchedulingPeriod } from "./scheduling-temporal";
import { inspectAppointmentAvailability } from "./appointment-service";
import { canOverbookRole, canOverrideSlot, validOverbookReason } from "./appointment-overlap-policy";
import { schedulingOverlapEnabled, schedulingReviewSchema, type SchedulingReview } from "./scheduling-conflict-contract";

export const assertSchedulingAccess = assertCustomerAccess;
export type SchedulingMetrics = Partial<Record<"interpretation"|"parsing"|"appointments"|"customers"|"services"|"professional"|"availability"|"proposal"|"message"|"confirmation",number>>;
export async function timed<T>(metrics: SchedulingMetrics, key: keyof SchedulingMetrics, run: ()=>Promise<T>) {
  const t=performance.now(); try{return await run();}finally{metrics[key]=(metrics[key]??0)+performance.now()-t;}
}
const query=z.string().trim().min(2).max(200);
const ref=z.string().min(1).max(100);
/** T03: shared real catalog, explicit minimal projection; no service mutation permission implied. */
export async function listSchedulingServices(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertSchedulingAccess(tx,actor);const q=query.parse(input);
  return tx.service.findMany({where:{salonId:actor.salonId,active:true,name:{contains:q,mode:"insensitive"}},
    select:{id:true,name:true,durationMin:true,priceCents:true,priceType:true},orderBy:[{name:"asc"},{id:"asc"}],take:21});
}
/** Names only (no ids, prices or customers), bounded, for Luna's role disambiguation. */
export async function secretaryDirectory(tx: Tx, actor: ServiceActor) {
  await assertSchedulingAccess(tx,actor);
  const [professionals,services]=await Promise.all([
    tx.professional.findMany({where:{salonId:actor.salonId,active:true},select:{user:{select:{name:true}}},orderBy:{id:"asc"},take:40}),
    tx.service.findMany({where:{salonId:actor.salonId,active:true},select:{name:true},orderBy:[{name:"asc"},{id:"asc"}],take:80}),
  ]);
  const {timezone}=await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}});
  const now=new Date(),date=now.toLocaleDateString("sv-SE",{timeZone:timezone});
  const weekday=now.toLocaleDateString("pt-BR",{timeZone:timezone,weekday:"long"});
  return {professionals:[...new Set(professionals.map(p=>p.user.name).filter((n):n is string=>!!n))],services:[...new Set(services.map(s=>s.name))],today:{date,weekday,timezone}};
}
/** T04: all returned options are active, linked and tenant scoped. No automatic arbitrary assignment. */
export async function listSchedulingProfessionals(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertSchedulingAccess(tx,actor);
  const p=z.object({service_ref:ref.optional(),query:query.optional()}).strict().parse(input);
  // Sentence punctuation can be retained in a name extracted from a transcript.
  // Keep internal name characters; return all matches so ambiguity still requires selection.
  const professionalQuery=p.query?.replace(/[.!?]+$/u, "").trim();
  if(p.query&&(!professionalQuery||professionalQuery.length<2))return [];
  const rows=await tx.professional.findMany({where:{salonId:actor.salonId,active:true,
    ...(p.service_ref?{services:{some:{serviceId:p.service_ref,service:{salonId:actor.salonId,active:true}}}}:{}),
    ...(professionalQuery?{user:{name:{contains:professionalQuery,mode:"insensitive" as const}}}:{})},
    select:{id:true,user:{select:{name:true}}},orderBy:{id:"asc"},take:21});
  return rows.map(r=>({id:r.id,name:r.user.name}));
}
export async function schedulingTimezone(tx: Tx,actor: ServiceActor) {
  await assertSchedulingAccess(tx,actor);
  return (await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}})).timezone;
}
export const slotInput=z.object({service_ref:ref,professional_ref:ref,date:z.string().refine(isDateKey),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),period:z.enum(["morning","afternoon","evening"]).optional(),override_requested:z.boolean().optional(),override_reason:z.string().max(200).optional()}).strict();
/** T07: same visit engine as the application. One day, one chosen professional, bounded alternatives. */
export async function getSchedulingAvailability(tx: Tx,actor: ServiceActor,input: unknown,now=new Date(),projection?: {releasedAppointmentId:string}) {
  await assertSchedulingAccess(tx,actor);const p=slotInput.parse(input);
  assertSchedulingTemporalConsistency(p);
  const eligible=await tx.professional.findFirst({where:{id:p.professional_ref,salonId:actor.salonId,active:true,services:{some:{serviceId:p.service_ref,service:{salonId:actor.salonId,active:true}}}},select:{id:true}});
  if(!eligible)throw new Error("PRO_SERVICE_MISMATCH");
  const service=await tx.service.findFirstOrThrow({where:{id:p.service_ref,salonId:actor.salonId,active:true},select:{physicalResourceId:true}});
  if(service.physicalResourceId&&!await tx.physicalResource.findFirst({where:{id:service.physicalResourceId,salonId:actor.salonId,active:true},select:{id:true}}))throw Error("RESOURCE_UNAVAILABLE");
  const choices=[{serviceId:p.service_ref,professionalId:p.professional_ref}];
  const day=await loadVisitDay(tx,actor.salonId,p.date,choices,now,projection);
  const at=(minute:number)=>`${p.date}T${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
  const planAt=(minute:number)=>localDateTimeToUtc(at(minute),day.salon.timezone)>now ? findVisitPlan(day,choices,minute,{manual:true}):null;
  const requested=p.time?Number(p.time.slice(0,2))*60+Number(p.time.slice(3)):undefined;
  let plan=requested!==undefined?planAt(requested):null;
  const alternatives=[];
  for(let minute=0;minute<1440 && alternatives.length<5;minute+=15){
    if(requested!==undefined && minute<=requested)continue;
    if(!matchesSchedulingPeriod(at(minute).slice(11),p.period))continue;
    const option=planAt(minute);if(option)alternatives.push({startLocal:option.startLocal,endLocal:option.endLocal,professional_ref:p.professional_ref});
  }
  let review: SchedulingReview | undefined;
  if (schedulingOverlapEnabled() && requested !== undefined) {
    const inspected=await inspectAppointmentAvailability(tx,{salonId:actor.salonId,professionalId:p.professional_ref,serviceIds:[p.service_ref],
      startLocal:at(requested),enforceBookingWindow:false,now,excludeAppointmentId:projection?.releasedAppointmentId});
    const membership=await tx.membership.findFirstOrThrow({where:{salonId:actor.salonId,userId:actor.userId},select:{role:true}});
    const future=inspected.startAt>now;
    // Domain validation returns the first violation. Preserve independent
    // closure facts already loaded in this tenant's day even if working hours
    // failed first; both causes remain true and closure always blocks override.
    const closed=day.closures.some(c=>c.startAt<inspected.endAt&&c.endAt>inspected.startAt);
    const allowed=future && !closed && canOverrideSlot(inspected.violation,inspected.conflicts,canOverbookRole(membership.role));
    const status=!future||closed ? "CONFLICT_HARD_BLOCK" : !inspected.violation ? "AVAILABLE" : allowed ? "CONFLICT_OVERRIDABLE" : "CONFLICT_HARD_BLOCK";
    const startLocal=toLocalDateTime(inspected.startAt,inspected.timezone),endLocal=toLocalDateTime(inspected.endAt,inspected.timezone);
    const conflicts=inspected.conflicts.flatMap(c=>c.startAt&&c.endAt?[{startLocal:toLocalDateTime(c.startAt,inspected.timezone),endLocal:toLocalDateTime(c.endAt,inspected.timezone),
      overlapMinutes:Math.max(0,(Math.min(inspected.endAt.getTime(),c.endAt.getTime())-Math.max(inspected.startAt.getTime(),c.startAt.getTime()))/60000)}]:[]);
    const causes=[...new Set([...(inspected.violation?[inspected.violation]:[]),...inspected.conflicts.map(c=>c.kind),...(closed?["SALON_CLOSED"]:[]),...(!future?["PAST_START"]:[])])];
    const missing=status==="CONFLICT_OVERRIDABLE" ? p.override_requested===false?["destination_mode"]:p.override_requested!==true?["override_requested"]:!validOverbookReason(p.override_reason)?["override_reason"]:[] : status==="CONFLICT_HARD_BLOCK"?["destination_mode"]:[];
    if (allowed && p.override_requested && validOverbookReason(p.override_reason))
      plan=findVisitPlan(day,choices,requested,{manual:true,allowAppointmentOverlap:true});
    if(status==="CONFLICT_HARD_BLOCK" || missing.length)plan=null;
    const clock=(local:string)=>local.slice(11,16).replace(":00","h").replace(":","h");
    const options=alternatives.length?`Tenho ${alternatives.map(a=>clock(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Não encontrei outra opção nesta data. Qual outra data ou horário você prefere consultar?";
    // Explain the backend's own cause; only mention "encaixe" when it was requested.
    const blockCause=causes.includes("SALON_CLOSED")?" O salão está fechado nesse horário.":causes.includes("PAST_START")?" Esse horário já passou.":
      causes.includes("RESOURCE")?" A sala ou equipamento está reservado.":causes.includes("WAITLIST")?" O horário está reservado por uma oferta da fila.":
      causes.some(c=>["OUTSIDE_WORKING_HOURS","AFTER_WORKING_HOURS","WORKING_HOURS_BREAK"].includes(c))?" Fica fora do expediente do profissional.":
      causes.includes("PROFESSIONAL_UNAVAILABLE")?" O profissional está indisponível (folga ou bloqueio).":
      causes.includes("SLOT_TAKEN")?" Já existe outro atendimento nesse horário.":" Há uma restrição de agenda ou permissão.";
    const message=status==="AVAILABLE"?"Horário disponível.":status==="CONFLICT_HARD_BLOCK"?
      `${p.override_requested===true?"Não posso fazer encaixe nesse horário.":"Esse horário está indisponível."}${blockCause} ${options}`:
      missing[0]==="destination_mode"?options:missing[0]==="override_reason"?"Qual o motivo do encaixe?":missing.length?
        `${inspected.services.map(s=>s.name).join(", ")} vai até ${clock(endLocal)}${conflicts[0]?` e há outro atendimento às ${clock(conflicts[0].startLocal)}`:" e há conflito na agenda"}. Quer fazer o encaixe ou escolher outro horário?${alternatives.length?` Livres: ${alternatives.map(a=>clock(a.startLocal)).join(", ")}.`:""}`:
        `Encaixe solicitado para ${clock(startLocal)}–${clock(endLocal)}, com motivo registrado. Aguarda confirmação.`;
    review=schedulingReviewSchema.parse({status,startLocal,endLocal,durationMin:(inspected.endAt.getTime()-inspected.startAt.getTime())/60000,causes,conflicts,override_allowed:allowed,missing_fields:missing,message,alternatives});
  }
  return {timezone:day.salon.timezone,plan,quote:plan?visitQuote(plan):null,alternatives,as_of:now.toISOString(),...(review?{review}:{})};
}
const appointmentSelect={id:true,clientId:true,professionalId:true,serviceId:true,startAt:true,endAt:true,status:true,version:true,timezone:true,priceCents:true,
  client:{select:{name:true}},professional:{select:{user:{select:{name:true}}}},serviceItems:{orderBy:{position:"asc" as const},select:{serviceName:true,durationMin:true,priceCents:true,priceType:true}}} as const;
async function listAppointments(tx:Tx,actor:ServiceActor,where: Parameters<Tx["appointment"]["findMany"]>[0]) {
  const rows=await tx.appointment.findMany({...where,select:appointmentSelect});
  return rows.map(r=>({appointment_ref:r.id,customer_ref:r.clientId,customer_name:r.client.name,professional_ref:r.professionalId,
    professional_name:r.professional.user.name,service_ref:r.serviceId,services:r.serviceItems,start_at:r.startAt.toISOString(),end_at:r.endAt.toISOString(),start_local:toLocalDateTime(r.startAt,r.timezone),end_local:toLocalDateTime(r.endAt,r.timezone),
    status:r.status,revision:r.version,timezone:r.timezone,priceCents:r.priceCents}));
}
/** T05: bounded day query. No raw ClientProfile/User or financial data. */
export async function listSchedulingAppointments(tx:Tx,actor:ServiceActor,input:unknown) {
  const p=z.object({date:z.string().refine(isDateKey),customer_ref:ref.optional(),professional_ref:ref.optional(),service_ref:ref.optional()}).strict().parse(input);
  const timezone=await schedulingTimezone(tx,actor);
  if(p.customer_ref)await getCustomer(tx,actor,p.customer_ref);
  if(p.professional_ref && !await tx.professional.findFirst({where:{id:p.professional_ref,salonId:actor.salonId},select:{id:true}}))throw Error("PROFESSIONAL_NOT_FOUND");
  if(p.service_ref&&!await tx.service.findFirst({where:{id:p.service_ref,salonId:actor.salonId},select:{id:true}}))throw Error("SERVICE_NOT_FOUND");
  return listAppointments(tx,actor,{where:{salonId:actor.salonId,startAt:{gte:startOfDateInTimeZone(p.date,timezone),lt:endExclusiveOfDateInTimeZone(p.date,timezone)},
    ...(p.customer_ref?{clientId:p.customer_ref}:{}),...(p.professional_ref?{professionalId:p.professional_ref}:{}),...(p.service_ref?{OR:[{serviceId:p.service_ref},{serviceItems:{some:{serviceId:p.service_ref}}}]}:{})},orderBy:[{startAt:"asc"},{id:"asc"}],take:51});
}
/** T06: opaque reference only from an authorized backend/UI selection. */
export async function getSchedulingAppointment(tx:Tx,actor:ServiceActor,input:unknown) {
  await assertSchedulingAccess(tx,actor);const id=ref.parse(input);
  const [row]=await listAppointments(tx,actor,{where:{id,salonId:actor.salonId},take:1});
  if(!row)throw Error("APPOINTMENT_NOT_FOUND");return row;
}
