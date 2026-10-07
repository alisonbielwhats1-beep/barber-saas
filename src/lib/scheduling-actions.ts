import { pendingTemporalAmbiguities } from "./scheduling-temporal-ambiguity";
import { pendingCalendarConflicts } from "./scheduling-calendar-conflict";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { actionJournal, assertCurrent, assertUnexpired, confirmJournalAction } from "./secretary-journal";
import { confirmServiceInput, proposeServiceInput } from "./service-create-mvp";
import { schedulingOperation, schedulingResolved, schedulingMissingRequired, schedulingServiceRefs } from "./scheduling-contract";
import { groupVisitItems } from "./visit-plan";
import { multiServiceEnabled } from "../../packages/salon-secretary/src/multi-service";
import { assertSchedulingAccess, getSchedulingAvailability, listUpcomingCustomerAppointments } from "./scheduling-catalog";
import { getCustomer } from "./customer-catalog";
import { createVisit } from "./visit-scheduling";
import { formatLocalRange } from "./secretary-datetime-format";
import { localDateTimeToUtc } from "./time";
import { createAppointment, inspectAppointmentAvailability } from "./appointment-service";
import { writeAuditLog } from "./audit";
import { canGrantException, collectExceptionCauses, EXCEPTION_DEFAULT_REASON, EXCEPTION_ROLES, exceptionHash, exceptionLabel, hasScheduleCause, SCHEDULE_EXCEPTION_CAUSES, type ScheduleExceptionCause } from "./schedule-exception-policy";
import { canOverbookRole } from "./appointment-overlap-policy";
import { schedulingReviewSchema, assertSchedulingExceptionScope, exceptionRulesV2Enabled, type SchedulingReview } from "./scheduling-conflict-contract";
import { lockOperationalResources } from "./inventory-lock";
import { actionSnapshot, authorizeSchedulingOperation, executeSchedulingMutation, schedulingActionSnapshot, schedulingActionPreview } from "./scheduling-mutations";
import { applyTemporalRejections, reconcileSchedulingTemporal, temporalRejectionSchema, schedulingTemporalConflicts, assertSchedulingTemporalConsistency } from "./scheduling-temporal";

import { reasonField, reasonRejection } from "./scheduling-literal-source";
import { SERIES_MAX, seriesDates, seriesEnabled, seriesPreviewLines } from "./secretary-series";

const journal=actionJournal("SECRETARY_SCHEDULING");
/** `services` (P2b, flag SALON_SECRETARY_MULTI_SERVICE, only for 2+ services): every service of the ONE appointment in order,
 * as the domain priced and timed it; the top-level service_* is the first one, priceCents/durationMin/start/end the whole. */
const snapshotService=z.object({service_ref:z.string(),service_revision:z.string(),service_name:z.string(),priceCents:z.number(),priceType:z.string(),durationMin:z.number()}).strict();
export const snapshot=z.object({customer_ref:z.string(),customer_name:z.string(),service_ref:z.string(),service_revision:z.string(),service_name:z.string(),professional_ref:z.string(),professional_name:z.string(),
  date:z.string(),startLocal:z.string(),endLocal:z.string(),timezone:z.string(),priceCents:z.number(),priceType:z.string(),durationMin:z.number(),quote:z.string(),overbook:z.object({reason:z.string().min(3).max(200),conflict_hash:z.string()}).strict().optional(),
  exception:z.object({causes:z.array(z.enum(SCHEDULE_EXCEPTION_CAUSES)).min(1),reason:z.string().min(3).max(200),reason_source:z.enum(["OWNER","DEFAULT"]),conflict_hash:z.string()}).strict().optional(),
  services:z.array(snapshotService).min(2).max(10).optional(),
  /** Owner 07/10 (flag SALON_SECRETARY_RECURRING_SERIES): the series' other dates as the domain timed and priced each one now, and those
   * left out with the domain's cause; the top-level slot is the first date. Never with an encaixe or an exception. */
  series:z.object({step_days:z.union([z.literal(7),z.literal(14)]),until:z.string(),
    occurrences:z.array(z.object({startLocal:z.string(),endLocal:z.string(),quote:z.string()}).strict()).max(SERIES_MAX-1),
    skipped:z.array(z.object({date:z.string(),cause:z.string()}).strict()).max(SERIES_MAX-1)}).strict().optional()}).strict();
/** The catalog services of a create snapshot, in order (one, or every service of a list). */
export const snapshotServiceRefs=(s:Pick<z.infer<typeof snapshot>,"service_ref"|"services">)=>s.services?.map(item=>item.service_ref)??[s.service_ref];
const draftSchema=z.object({draft_ref:z.string().uuid(),draft_revision:z.number().int().min(1).max(100),operation:schedulingOperation,
  fields:schedulingResolved,pending_temporal_ambiguities:pendingTemporalAmbiguities.optional(),pending_calendar_conflicts:pendingCalendarConflicts.optional(),source_missing:z.array(reasonField).optional(),temporal_missing:z.array(z.enum(["date","source_date","source_time","time","end_time","end_date"])).optional(),review:schedulingReviewSchema.optional(),snapshot:snapshot.optional(),action_snapshot:actionSnapshot.optional(),expires_at:z.string().datetime()}).strict();
const proposalSchema=draftSchema.extend({proposal_ref:z.string().uuid(),payload_hash:z.string(),preview:z.string(),
  existing_bookings:z.array(z.object({appointment_ref:z.string(),start_local:z.string(),overlaps:z.boolean()}).strict()).max(6).optional()});
const receiptSchema=z.object({proposal_ref:z.string().uuid(),draft_ref:z.string().uuid(),draft_revision:z.number(),appointment_ref:z.string().optional(),snapshot:snapshot.optional(),action_snapshot:actionSnapshot.optional(),block_ref:z.string().optional(),acceptance_ref:z.string().optional(),outcome:z.enum(["RESCHEDULED","PENDING_ACCEPTANCE","CANCELLED","BLOCKED"]).optional(),
  /** Owner 07/10: the series' other appointments, in date order (appointment_ref is the first). */
  series_refs:z.array(z.string()).max(SERIES_MAX-1).optional()}).strict();
const hash=(d:z.infer<typeof draftSchema>)=>createHash("sha256").update(JSON.stringify({operation:d.operation,fields:d.fields,snapshot:d.snapshot,action_snapshot:d.action_snapshot,temporal_missing:d.temporal_missing,source_missing:d.source_missing,pending_temporal_ambiguities:d.pending_temporal_ambiguities,pending_calendar_conflicts:d.pending_calendar_conflicts})).digest("hex");
async function latest(tx:Tx,actor:ServiceActor,ref:string){
  const rows=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:ref,action:"DRAFT"},select:{metadata:true}});
  const d=rows.map(x=>draftSchema.parse(x.metadata)).sort((a,b)=>b.draft_revision-a.draft_revision)[0];
  if(!d)throw Error("DRAFT_NOT_FOUND");return d;
}
function assess(d:z.infer<typeof draftSchema>){
  const temporal_conflicts=schedulingTemporalConflicts(d.fields);
  const missing_fields=[...new Set([...schedulingMissingRequired(d.operation,d.fields),...(d.temporal_missing??[]),...(d.pending_temporal_ambiguities??[]).map(item=>item.field),...(d.pending_calendar_conflicts??[]).map(item=>item.field),...(d.source_missing??[]),...temporal_conflicts.map(c=>c.field),...(d.review?.missing_fields??[])])];
  return {...d,status:missing_fields.length?"NEEDS_INPUT" as const:"READY" as const,missing_fields,temporal_conflicts};
}
/** The conflict grant a ready review carries: the overbook of a plain overlap (reason required, as before), or (05/10, flag
 * SALON_SECRETARY_SCHEDULE_EXCEPTIONS) the schedule exception with its causes and the owner's reason or the default one. */
export function conflictGrant(review:SchedulingReview|undefined,fields:{override_reason?:string}){
  if(review?.status!=="CONFLICT_OVERRIDABLE")return {};
  if(hasScheduleCause(review.causes)){
    const own=fields.override_reason?.trim(),owner=!!own&&own.length>=3&&own.length<=200;
    return {exception:{causes:review.causes.filter((c):c is ScheduleExceptionCause=>(SCHEDULE_EXCEPTION_CAUSES as readonly string[]).includes(c)),
      reason:owner?own!:EXCEPTION_DEFAULT_REASON,reason_source:owner?"OWNER" as const:"DEFAULT" as const,conflict_hash:exceptionHash(review)}};
  }
  return {overbook:{reason:fields.override_reason!.trim(),conflict_hash:createHash("sha256").update(JSON.stringify(review.conflicts)).digest("hex")}};
}
export async function schedulingSnapshot(tx:Tx,actor:ServiceActor,fields:z.infer<typeof schedulingResolved>,now=new Date(),projection?: {releasedAppointmentId:string}){
  const first=await firstSnapshot(tx,actor,fields,now,projection);
  return fields.series?snapshot.parse({...first,series:await seriesSnapshot(tx,actor,fields,first,now)}):first;
}
/** Owner 07/10 (flag SALON_SECRETARY_RECURRING_SERIES): each later date of the series at the same clock, with the same professional and
 * services, read like the first one (getSchedulingAvailability: the exact start, one appointment, the domain's quote). A date the domain
 * refuses, or where the customer already has an overlapping appointment, is skipped with its cause (the manual agenda skips them too);
 * never an encaixe or an exception. Read only. */
async function seriesSnapshot(tx:Tx,actor:ServiceActor,fields:z.infer<typeof schedulingResolved>,first:z.infer<typeof snapshot>,now:Date){
  if(!seriesEnabled())throw Error("SERIES_DISABLED");
  if(first.overbook||first.exception||fields.override_requested)throw Error("SERIES_EXCEPTION");
  const series=fields.series!,dates=seriesDates(first.date,series.step_days,series.until);
  if(!dates||dates.length<2)throw Error("NEEDS_INPUT");
  const refs=snapshotServiceRefs(first),time=first.startLocal.slice(11,16);
  const occurrences:{startLocal:string;endLocal:string;quote:string}[]=[],skipped:{date:string;cause:string}[]=[];
  for(const date of dates.slice(1)){
    const found=await getSchedulingAvailability(tx,actor,{service_ref:refs[0],...(refs.length>1?{service_refs:refs}:{}),professional_ref:first.professional_ref,date,time},now,undefined,undefined,1,true);
    const plan=found.plan;
    const fits=!!plan&&!!found.quote&&plan.startLocal===`${date}T${time}`&&plan.items.length===refs.length&&plan.items.every((item,index)=>item.serviceId===refs[index]&&item.professionalId===first.professional_ref)&&groupVisitItems(plan.items).length===1;
    if(!fits){skipped.push({date,cause:found.review?.causes[0]??"SLOT_TAKEN"});continue;}
    const slot={start:localDateTimeToUtc(plan!.startLocal,first.timezone),end:localDateTimeToUtc(plan!.endLocal,first.timezone)};
    if((await listUpcomingCustomerAppointments(tx,actor,first.customer_ref,{overlapping:slot,now})).length){skipped.push({date,cause:"CUSTOMER_OVERLAP"});continue;}
    occurrences.push({startLocal:plan!.startLocal,endLocal:plan!.endLocal,quote:found.quote!});
  }
  return {step_days:series.step_days,until:series.until,occurrences,skipped};
}
async function firstSnapshot(tx:Tx,actor:ServiceActor,fields:z.infer<typeof schedulingResolved>,now:Date,projection?: {releasedAppointmentId:string}){
  assertSchedulingExceptionScope(fields,"appointment.create");
  assertSchedulingTemporalConsistency(fields);
  // P2b: a service list is only ever planned with the flag on (a draft kept from before never executes with it off).
  if(fields.service_names&&!multiServiceEnabled())throw Error("MULTI_SERVICE_DISABLED");
  const list=fields.service_names?schedulingServiceRefs(fields):undefined;
  if(fields.service_names&&(!list||list.length<2))throw Error("NEEDS_INPUT");
  const {customer_ref,professional_ref,date,time}=fields,service_ref=list?list[0]:fields.service_ref;
  if(!customer_ref||!service_ref||!professional_ref||!date||!time)throw Error("NEEDS_INPUT");
  const customer=await getCustomer(tx,actor,customer_ref);
  const available=await getSchedulingAvailability(tx,actor,{service_ref,...(list?{service_refs:list}:{}),professional_ref,date,time,...(fields.override_requested!==undefined?{override_requested:fields.override_requested}:{}),...(fields.override_reason?{override_reason:fields.override_reason}:{})},now,projection,undefined,5,true);
  if(!available.plan||!available.quote)throw Error("SLOT_CONFLICT");
  if(list)return listSnapshot(tx,actor,{customer_ref,customer_name:customer.name,professional_ref,date,list,fields},available);
  const item=available.plan.items[0];
  const [version]=await tx.$queryRaw<{revision:string}[]>`SELECT xmin::text AS revision FROM "Service" WHERE id=${service_ref} AND "salonId"=${actor.salonId}`;
  if(!version)throw Error("SERVICE_NOT_FOUND");
  return snapshot.parse({customer_ref,customer_name:customer.name,service_ref,service_revision:version.revision,service_name:item.serviceName,professional_ref,professional_name:item.professionalName,
    date,startLocal:item.startLocal,endLocal:item.endLocal,timezone:available.timezone,priceCents:item.priceCents,priceType:item.priceType,durationMin:item.durationMin,quote:available.quote,
    ...conflictGrant(available.review,fields)});
}
/** P2b: ONE appointment with several services, exactly as the domain planned it: every item with the one professional, back to
 * back, in the order said (one appointment group); anything else is a changed schedule, never a partial or split booking.
 * Price and duration are the domain's (per service and summed); each service's catalog revision is frozen like a single one. */
async function listSnapshot(tx:Tx,actor:ServiceActor,input:{customer_ref:string;customer_name:string;professional_ref:string;date:string;list:readonly string[];fields:z.infer<typeof schedulingResolved>},
  available:Awaited<ReturnType<typeof getSchedulingAvailability>>){
  const plan=available.plan!,items=plan.items;
  if(items.length!==input.list.length||items.some((item,index)=>item.serviceId!==input.list[index]||item.professionalId!==input.professional_ref)||groupVisitItems(items).length!==1)throw Error("SLOT_CONFLICT");
  const services:z.infer<typeof snapshotService>[]=[];
  for(const item of items){
    const [version]=await tx.$queryRaw<{revision:string}[]>`SELECT xmin::text AS revision FROM "Service" WHERE id=${item.serviceId} AND "salonId"=${actor.salonId}`;
    if(!version)throw Error("SERVICE_NOT_FOUND");
    services.push({service_ref:item.serviceId,service_revision:version.revision,service_name:item.serviceName,priceCents:item.priceCents,priceType:item.priceType,durationMin:item.durationMin});
  }
  const review=available.review;
  return snapshot.parse({customer_ref:input.customer_ref,customer_name:input.customer_name,service_ref:services[0].service_ref,service_revision:services[0].service_revision,service_name:services.map(s=>s.service_name).join(" + "),
    professional_ref:input.professional_ref,professional_name:items[0].professionalName,date:input.date,startLocal:plan.startLocal,endLocal:plan.endLocal,timezone:available.timezone,
    priceCents:plan.totalCents,priceType:services.some(s=>s.priceType==="FROM")?"FROM":"FIXED",durationMin:services.reduce((sum,s)=>sum+s.durationMin,0),quote:available.quote!,
    ...conflictGrant(review,input.fields),services});
}
/** Same transaction supplied by the caller. The manual executor owns override, audit and locks. */
export async function executeSchedulingCreate(tx:Tx,actor:ServiceActor,s:z.infer<typeof snapshot>,key:string){
  if(s.exception){
    // 05/10: the role and the causes are checked again now; a slot whose causes changed since the proposal is never booked.
    const role=await authorizeSchedulingOperation(tx,actor,"appointment.create");
    if(!canGrantException(role,s.exception.causes))throw Error("FORBIDDEN");
    const live=await scheduleExceptionCausesNow(tx,actor,{professional_ref:s.professional_ref,service_refs:snapshotServiceRefs(s),startLocal:s.startLocal,endLocal:s.endLocal});
    if(live.hard.length||[...live.causes].sort().join()!==[...s.exception.causes].sort().join())throw Error("SCHEDULE_CHANGED");
    const has=(cause:ScheduleExceptionCause)=>s.exception!.causes.includes(cause),can=(cause:ScheduleExceptionCause)=>EXCEPTION_ROLES[cause].includes(role),reason=s.exception.reason;
    const result=await createAppointment(tx,{salonId:actor.salonId,clientId:s.customer_ref,professionalId:s.professional_ref,serviceIds:snapshotServiceRefs(s),startLocal:s.startLocal,
      origin:"ADMIN",actor:{type:"STAFF",id:actor.userId,name:"Secretária — equipe autenticada"},idempotencyKey:key,enforceBookingWindow:false,enforcePlanLimits:true,
      ...(has("OUTSIDE_WORKING_HOURS")?{canOverrideSchedule:can("OUTSIDE_WORKING_HOURS"),scheduleOverrideReason:reason}:{}),
      ...(has("PROFESSIONAL_UNAVAILABLE")?{canOverrideTimeOff:can("PROFESSIONAL_UNAVAILABLE"),timeOffOverrideReason:reason}:{}),
      ...(has("WORKING_HOURS_BREAK")?{canOverrideWorkingHoursBreak:can("WORKING_HOURS_BREAK"),overrideConfirmed:true,workingHoursBreakReason:reason}:{}),
      ...(has("AFTER_WORKING_HOURS")?{canFinishAfterHours:can("AFTER_WORKING_HOURS"),afterHoursReason:reason}:{}),
      ...(has("SLOT_TAKEN")?{canOverride:can("SLOT_TAKEN"),overrideReason:reason}:{})});
    await writeAuditLog(tx,{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — equipe autenticada",action:"SECRETARY_SCHEDULE_EXCEPTION_CREATE",entityType:"Appointment",
      entityId:result.appointment.id,reason,metadata:{causes:s.exception.causes,reason_source:s.exception.reason_source,startLocal:s.startLocal,professionalId:s.professional_ref}});
    return result.appointment.id;
  }
  if(s.overbook){
    assertSchedulingExceptionScope({override_requested:true},"appointment.create");
    const role=await authorizeSchedulingOperation(tx,actor,"appointment.create");
    const result=await createAppointment(tx,{salonId:actor.salonId,clientId:s.customer_ref,professionalId:s.professional_ref,serviceIds:snapshotServiceRefs(s),startLocal:s.startLocal,
      origin:"ADMIN",actor:{type:"STAFF",id:actor.userId,name:"Secretária — equipe autenticada"},idempotencyKey:key,enforceBookingWindow:false,enforcePlanLimits:true,
      canOverride:canOverbookRole(role),overrideReason:s.overbook.reason});
    return result.appointment.id;
  }
  // P2b: several services with one professional are one visit group, so still exactly one appointment (the guard below).
  return createOneVisit(tx,actor,s,{startLocal:s.startLocal,quote:s.quote,key,...(s.series?{seriesId:key}:{})});
}
async function createOneVisit(tx:Tx,actor:ServiceActor,s:z.infer<typeof snapshot>,at:{startLocal:string;quote:string;key:string;seriesId?:string}){
  const result=await createVisit(tx,{salonId:actor.salonId,clientId:s.customer_ref,choices:snapshotServiceRefs(s).map(serviceId=>({serviceId,professionalId:s.professional_ref})),startLocal:at.startLocal,
    idempotencyKey:at.key,quote:at.quote,manual:true,actor:{type:"STAFF",id:actor.userId,name:"Secretária — equipe autenticada"},...(at.seriesId?{seriesId:at.seriesId}:{})});
  if(result.appointmentIds.length!==1)throw Error("UNEXPECTED_APPOINTMENT_RESULT");
  return result.appointmentIds[0]!;
}
/** Owner 07/10 (flag SALON_SECRETARY_RECURRING_SERIES): the other dates of a confirmed series in this same transaction, grouped by the
 * proposal's ref (Appointment.seriesId, as the manual agenda groups its series); a date taken meanwhile fails the whole confirmation
 * (the domain's refusal, nothing half written) and the owner gets a fresh proposal. */
async function executeSeriesOccurrences(tx:Tx,actor:ServiceActor,s:z.infer<typeof snapshot>,key:string){
  if(!seriesEnabled())throw Error("SERIES_DISABLED");
  if(s.overbook||s.exception)throw Error("SERIES_EXCEPTION");
  const refs:string[]=[];
  for(const [index,item] of s.series!.occurrences.entries())refs.push(await createOneVisit(tx,actor,s,{startLocal:item.startLocal,quote:item.quote,key:`${key}:${index+1}`,seriesId:key}));
  return refs;
}
/** 05/10: the exception causes of a slot as the domain sees them now (the same collection the review used). A move passes its
 * own inspector (its snapshot services and the released appointment). */
export async function scheduleExceptionCausesNow(tx:Tx,actor:ServiceActor,slot:{professional_ref:string;service_refs:string[];startLocal:string;endLocal:string;excludeAppointmentId?:string;
  inspect?:(skips:{skipSchedule?:boolean;skipTimeOff?:boolean;skipWorkingHoursBreak?:boolean;skipAfterHours?:boolean})=>Promise<{violation:string|null;conflicts:readonly {kind:"APPOINTMENT"|"RESOURCE"|"WAITLIST"}[]}>}){
  const salon=await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}});
  const start=localDateTimeToUtc(slot.startLocal,salon.timezone),end=localDateTimeToUtc(slot.endLocal,salon.timezone);
  return collectExceptionCauses(slot.inspect??(skips=>inspectAppointmentAvailability(tx,{salonId:actor.salonId,professionalId:slot.professional_ref,serviceIds:slot.service_refs,startLocal:slot.startLocal,
      enforceBookingWindow:false,excludeAppointmentId:slot.excludeAppointmentId,...skips})),
    async()=>!!await tx.timeOff.findFirst({where:{professionalId:slot.professional_ref,professional:{salonId:actor.salonId},startAt:{lt:end},endAt:{gt:start}},select:{id:true}}));
}
/** C5 agent (flag SALON_SECRETARY_AGENT): the fields a derived value may occupy; a continuation that drops that value (with its provenance)
 * hands them to the next write in `forget_fields`, so the journal merge never resurrects them. */
export const SCHEDULING_FORGET_FIELDS=["date","time","end_date","end_time","professional_ref","professional_name","target_professional_ref","target_professional_name"] as const;
export type SchedulingForgetField=(typeof SCHEDULING_FORGET_FIELDS)[number];
/** U03 adapter: same journal, explicit patch; no Appointment INSERT. Refs are backend/UI resolved. */
export async function upsertSchedulingDraft(tx:Tx,actor:ServiceActor,input:unknown){
  await assertSchedulingAccess(tx,actor);
  const p=z.object({operation:schedulingOperation,fields:schedulingResolved,pending_temporal_ambiguities:pendingTemporalAmbiguities.optional(),pending_calendar_conflicts:pendingCalendarConflicts.optional(),review:schedulingReviewSchema.optional(),snapshot:snapshot.optional(),action_snapshot:actionSnapshot.optional(),draft_ref:z.string().uuid().optional(),expected_revision:z.number().int().optional(),rejected_temporal:z.array(temporalRejectionSchema).max(8).optional(),source_missing:z.array(reasonField).optional(),rejected_source:z.array(reasonRejection).max(2).optional(),
    // A3 (review B): origin roles the adapter forgot with the chosen appointment (ref-derived; any flag state).
    forget_origin:z.array(z.enum(["date","time","source_date","source_time"])).max(4).optional(),
    forget_fields:z.array(z.enum(SCHEDULING_FORGET_FIELDS)).max(SCHEDULING_FORGET_FIELDS.length).optional()}).strict().parse(input);
  assertSchedulingExceptionScope(p.fields,p.operation);
  await authorizeSchedulingOperation(tx,actor,p.operation);
  if(Boolean(p.draft_ref)!==Boolean(p.expected_revision))throw Error("REVISION_REQUIRED");
  const ref=p.draft_ref??randomUUID();await journal.lock(tx,actor,ref);
  const old=p.draft_ref?await latest(tx,actor,ref):undefined;
  if(old){assertCurrent(old,p.expected_revision!);assertUnexpired(old.expires_at);if(old.operation!==p.operation)throw Error("OPERATION_MISMATCH");
    if(await tx.auditLog.findFirst({where:{...journal.scope(actor),entityId:ref,action:"CONFIRMED"},select:{id:true}}))throw Error("ALREADY_CONFIRMED");}
  const reconciliation=reconcileSchedulingTemporal(old?.fields??{},p.fields);
  const fields=reconciliation.fields;
  if(fields.reason_source&&fields.reason_source.original_text!==fields.reason)delete fields.reason_source;
  if(fields.override_reason_source&&fields.override_reason_source.original_text!==fields.override_reason)delete fields.override_reason_source;
  if(p.fields.override_requested===false)delete fields.override_reason;
  if(p.fields.destination_mode==="ALTERNATIVE_SLOT"&&!p.fields.time)delete fields.time;
  if(exceptionRulesV2Enabled()){
    // A1-GF23 (flag): an encaixe consent the adapter holds supersedes a stored "other slot" (never resurrected beside it).
    if(p.fields.override_requested===true&&p.fields.destination_mode===undefined)delete fields.destination_mode;
    // A3 (flag): origin roles the adapter dropped with (or when replacing) the chosen appointment are never resurrected.
    if(old?.fields.appointment_ref&&p.fields.appointment_ref!==old.fields.appointment_ref)
      for(const role of p.operation==="appointment.change"?["source_date","source_time"] as const:p.operation==="appointment.cancel"?["date","time"] as const:[])if(p.fields[role]===undefined)delete fields[role];
  }
  // A3 (review B): what the adapter says it forgot with the appointment is never resurrected, whatever the flag says now.
  for(const role of p.forget_origin??[])if(p.fields[role]===undefined)delete fields[role];
  // C5 agent: a derived value the adapter dropped with its provenance is never resurrected either.
  for(const key of p.forget_fields??[])if(p.fields[key]===undefined)delete fields[key];
  if(old && ["customer_name","service_name","professional_name","date","time","period"].some(k=>p.fields[k as keyof typeof p.fields]!==undefined&&p.fields[k as keyof typeof p.fields]!==old.fields[k as keyof typeof old.fields])&&p.fields.override_requested!==true){delete fields.override_requested;delete fields.override_reason;}
  for(const [name,key]of [["customer_name","customer_ref"],["service_name","service_ref"],["professional_name","professional_ref"]] as const){
    if(p.fields[name]!==undefined&&p.fields[name]!==old?.fields[name]){
      if(!p.fields[key])delete fields[key];
      if(name==="service_name"&&!p.fields.professional_ref)delete fields.professional_ref;
    }
  }
  // P2a: the adapter sends its complete fields: an alteration key it no longer holds (refused, negated, redundant) is gone,
  // never resurrected from the previous revision. A new professional or service delta said differently drops what was
  // resolved for the previous words.
  for(const key of ["target_professional_name","target_professional_ref","service_changes","service_changes_ref"] as const)if(p.fields[key]===undefined)delete fields[key];
  if(p.fields.target_professional_name!==undefined&&p.fields.target_professional_name!==old?.fields.target_professional_name&&!p.fields.target_professional_ref)delete fields.target_professional_ref;
  if(p.fields.service_changes!==undefined&&JSON.stringify(p.fields.service_changes)!==JSON.stringify(old?.fields.service_changes)&&!p.fields.service_changes_ref)delete fields.service_changes_ref;
  // P2b: the service list and its refs are the adapter's complete state too (never resurrected). The adapter holds one form of
  // the services at a time: a list replaces the single service, and a new list the professional (re-checked for every service).
  for(const key of ["service_names","service_list_ref"] as const)if(p.fields[key]===undefined)delete fields[key];
  // Owner 07/10: a series the adapter no longer holds (dropped, or another day) is never resurrected.
  if(p.fields.series===undefined)delete fields.series;
  if(p.fields.service_names!==undefined){
    for(const key of ["service_name","service_ref"] as const)if(p.fields[key]===undefined)delete fields[key];
    const changed=JSON.stringify(p.fields.service_names)!==JSON.stringify(old?.fields.service_names);
    if(changed&&!p.fields.professional_ref)delete fields.professional_ref;
    // Another duration: an encaixe consent given for the previous services is not kept.
    if(changed&&old&&p.fields.override_requested!==true){delete fields.override_requested;delete fields.override_reason;}
  }
  // Resolved appointment is invalidated when the backend locator changes.
  if(old&&!p.fields.appointment_ref&&["customer_name","source_date","source_time"].some(k=>p.fields[k as keyof typeof p.fields]!==undefined&&p.fields[k as keyof typeof p.fields]!==old.fields[k as keyof typeof old.fields]))delete fields.appointment_ref;
  if(old&&p.operation==="appointment.cancel"&&!p.fields.appointment_ref&&["date","time","period"].some(k=>fields[k as keyof typeof fields]!==old.fields[k as keyof typeof old.fields]))delete fields.appointment_ref;
  const rejected=[...new Map([...(p.rejected_temporal??[]),...reconciliation.rejected].map(r=>[JSON.stringify(r),r])).values()];
  // A merge must never resurrect a rejected selector from the previous revision.
  applyTemporalRejections(fields,old?.fields??{},rejected);
  const pending_temporal_ambiguities=(p.pending_temporal_ambiguities??old?.pending_temporal_ambiguities??[]).filter(item=>!fields[item.field]);
  const pending_calendar_conflicts=(p.pending_calendar_conflicts??old?.pending_calendar_conflicts??[]).filter(item=>!fields[item.field]);
  const temporal_missing=[...new Set([...(old?.temporal_missing??[]),...rejected.flatMap(r=>r.field!=="period"?[r.field]:[])])].filter(k=>!fields[k]&&!pending_temporal_ambiguities.some(item=>item.field===k)&&!pending_calendar_conflicts.some(item=>item.field===k));
  const source_missing=p.source_missing??old?.source_missing??[];
  const incomplete=pending_calendar_conflicts.length>0||pending_temporal_ambiguities.length>0||source_missing.length>0||temporal_missing.length>0||schedulingTemporalConflicts(fields).length>0||schedulingMissingRequired(p.operation,fields).length>0;
  const d=draftSchema.parse({draft_ref:ref,draft_revision:(old?.draft_revision??0)+1,operation:p.operation,fields,...(pending_calendar_conflicts.length?{pending_calendar_conflicts}:{}),...(pending_temporal_ambiguities.length?{pending_temporal_ambiguities}:{}),...(source_missing.length?{source_missing}:{}),...(p.review?{review:p.review}:{}),...(temporal_missing.length?{temporal_missing}:{}),snapshot:incomplete?undefined:p.snapshot,action_snapshot:incomplete?undefined:p.action_snapshot,
    expires_at:old?.expires_at??new Date(Date.now()+30*60000).toISOString()});
  await journal.append(tx,actor,"DRAFT",ref,d);
  if(rejected.length)await journal.append(tx,actor,"TEMPORAL_RECONCILED",ref,{draft_revision:d.draft_revision,rejected});
  if(p.rejected_source?.length)await journal.append(tx,actor,"SOURCE_RECONCILED",ref,{draft_revision:d.draft_revision,rejected:p.rejected_source});
  return assess(d);
}
/** T12: pure proposal, revalidates availability and frozen domain quote. */
/** `projection` (P3a D1, flag SALON_SECRETARY_REFERENCES_V2): the appointment a pending reschedule of the same plan moves out of
 * this slot, for the freshness check of the proposal only. confirmAppointmentCreate never takes it: the executor re-checks the
 * committed agenda after the move (a slot taken meanwhile is SCHEDULE_CHANGED, never a double booking). */
export async function proposeAppointmentCreate(tx:Tx,actor:ServiceActor,input:unknown,projection?:{releasedAppointmentId:string}){
  await assertSchedulingAccess(tx,actor);const p=proposeServiceInput.parse(input);await journal.lock(tx,actor,p.draft_ref);
  const d=await latest(tx,actor,p.draft_ref);assertCurrent(d,p.draft_revision);assertUnexpired(d.expires_at);
  assertSchedulingTemporalConsistency(d.fields);
  if(d.operation!=="appointment.create"||assess(d).status!=="READY"||!d.snapshot)throw Error("NEEDS_INPUT");
  if(JSON.stringify(await (projection?schedulingSnapshot(tx,actor,d.fields,new Date(),projection):schedulingSnapshot(tx,actor,d.fields)))!==JSON.stringify(d.snapshot))throw Error("SCHEDULE_CHANGED");
  const existing=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:d.draft_ref,action:"PROPOSAL"},select:{metadata:true}});
  const prior=existing.map(r=>proposalSchema.parse(r.metadata)).find(p=>p.draft_revision===d.draft_revision);
  if(prior){assertUnexpired(prior.expires_at);return prior;}
  const s=d.snapshot;
  const slot={start:localDateTimeToUtc(s.startLocal,s.timezone),end:localDateTimeToUtc(s.endLocal,s.timezone)};
  const [overlapping,upcoming]=await Promise.all([listUpcomingCustomerAppointments(tx,actor,s.customer_ref,{overlapping:slot}),listUpcomingCustomerAppointments(tx,actor,s.customer_ref)]);
  const bookings=existingBookings([...overlapping,...upcoming],slot);
  const proposal=proposalSchema.parse({...d,proposal_ref:randomUUID(),payload_hash:hash(d),expires_at:new Date(Math.min(Date.parse(d.expires_at),Date.now()+600000)).toISOString(),
    preview:appointmentCreatePreview(s),...(bookings.length?{existing_bookings:bookings}:{})});
  await journal.append(tx,actor,"PROPOSAL",d.draft_ref,proposal,proposal.proposal_ref);return proposal;
}
/** The NEW booking preview (the model reads it as the action's previous response; part of the presentation digest). */
export function appointmentCreatePreview(s:Pick<z.infer<typeof snapshot>,"customer_name"|"service_name"|"professional_name"|"startLocal"|"endLocal"|"priceType"|"priceCents"|"overbook"|"exception">&Partial<Pick<z.infer<typeof snapshot>,"services"|"durationMin"|"series">>){
  // Owner 07/10: a series names its dates (and those left out) after the first date's own lines; the price is per date.
  const series=s.series?seriesPreviewLines(s.series,s.startLocal.slice(0,10)):"";
  if(s.services)return `${appointmentListPreview({...s,services:s.services})}${series}`;
  return `${s.series?"NOVOS AGENDAMENTOS (SÉRIE)":"NOVO AGENDAMENTO"}\nCliente: ${s.customer_name}\nServiço: ${s.service_name}\nProfissional: ${s.professional_name}\nQuando: ${formatLocalRange(s.startLocal,s.endLocal)}\n${s.series?"Preço por data":"Preço"}: ${s.priceType==="FROM"?"A partir de ":""}${(s.priceCents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}${s.overbook?`\nENCAIXE: haverá sobreposição. Motivo: ${s.overbook.reason}`:""}${s.exception?`\nEXCEÇÃO: ${exceptionLabel(s.exception.causes)} · Motivo: ${s.exception.reason}`:""}${series}`;
}
const brl=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
/** P2b: a NEW booking with several services (one professional): every service with its own duration and price, then the
 * totals the domain computed (a price "a partir de" makes the total "a partir de" too). */
function appointmentListPreview(s:Pick<z.infer<typeof snapshot>,"customer_name"|"professional_name"|"startLocal"|"endLocal"|"priceType"|"priceCents"|"overbook"|"exception">&{services:NonNullable<z.infer<typeof snapshot>["services"]>;durationMin?:number}){
  const services=s.services.map(item=>`${item.service_name} (${item.durationMin} min, ${item.priceType==="FROM"?"a partir de ":""}${brl(item.priceCents)})`).join(" + ");
  const minutes=s.durationMin??s.services.reduce((sum,item)=>sum+item.durationMin,0);
  return `NOVO AGENDAMENTO\nCliente: ${s.customer_name}\nServiços: ${services}\nProfissional: ${s.professional_name}\nQuando: ${formatLocalRange(s.startLocal,s.endLocal)}\nDuração total: ${minutes} min\nPreço total: ${s.priceType==="FROM"?"A partir de ":""}${brl(s.priceCents)}${s.overbook?`\nENCAIXE: haverá sobreposição. Motivo: ${s.overbook.reason}`:""}${s.exception?`\nEXCEÇÃO: ${exceptionLabel(s.exception.causes)} · Motivo: ${s.exception.reason}`:""}`;
}
/** C7 (create vs change, review): the customer's upcoming appointments a NEW booking proposal found, the one overlapping the
 * new slot first and marked. Kept BESIDE the preview (never in it): the preview is the model's context, the notice is
 * screen-only (secretary-display existingBookingNotice). No phrase rule, no question. */
export function existingBookings(appointments:readonly {appointment_ref:string;start_local:string;start_at:string;end_at:string}[],slot?:{start:Date;end:Date}){
  const unique=appointments.filter((item,index)=>appointments.findIndex(other=>other.appointment_ref===item.appointment_ref)===index);
  const overlaps=(item:(typeof unique)[number])=>!!slot&&Date.parse(item.start_at)<slot.end.getTime()&&Date.parse(item.end_at)>slot.start.getTime();
  return unique.slice(0,6).map(item=>({appointment_ref:item.appointment_ref,start_local:item.start_local,overlaps:overlaps(item)}));
}
/** `options.precondition` (C5 agent V23, flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §5.1): the re-check of a
 * derived value's provenance, run on THIS transaction right before the write (a create: after lockOperationalResources; a change, cancel or
 * block: just before the domain mutation, whose own locks follow). A refusal throws and nothing is written. Absent: exactly as before. */
export type SchedulingConfirmOptions={precondition?:(tx:Tx)=>Promise<void>};
export async function confirmAppointmentCreate(tx:Tx,actor:ServiceActor,input:unknown,options:SchedulingConfirmOptions={}){
  const inputRef=confirmServiceInput.parse(input);
  const row=await tx.auditLog.findFirst({where:{...journal.scope(actor),id:inputRef.proposal_ref,action:"PROPOSAL"},select:{metadata:true}});
  if(row)await authorizeSchedulingOperation(tx,actor,proposalSchema.parse(row.metadata).operation);
  return confirmJournalAction<z.infer<typeof draftSchema>,z.infer<typeof proposalSchema>,z.infer<typeof receiptSchema>>(tx,actor,confirmServiceInput.parse(input),{
    journal,proposalAction:"PROPOSAL",confirmedAction:"CONFIRMED",authorize:()=>assertSchedulingAccess(tx,actor),parseProposal:x=>proposalSchema.parse(x),parseReceipt:x=>receiptSchema.parse(x),
    latest:ref=>latest(tx,actor,ref),proposalHash:hash,draftHash:hash,
    execute:async(p,d)=>{
      if(assess(d).status!=="READY")throw Error("NEEDS_INPUT");
      assertSchedulingTemporalConsistency(d.fields);
      assertSchedulingTemporalConsistency(p.fields);
      if(p.operation!=="appointment.create"){
        if(!p.action_snapshot||p.action_snapshot.kind!==p.operation)throw Error("PROPOSAL_INVALID");
        if(options.precondition)await options.precondition(tx);
        const result=await executeSchedulingMutation(tx,actor,p.action_snapshot,d.fields,p.proposal_ref);
        return receiptSchema.parse({proposal_ref:p.proposal_ref,draft_ref:d.draft_ref,draft_revision:d.draft_revision,...result,action_snapshot:p.action_snapshot});
      }
      if(!p.snapshot)throw Error("PROPOSAL_INVALID");
      await lockOperationalResources(tx,{professionalIds:[p.snapshot.professional_ref]});
      if(options.precondition)await options.precondition(tx);
      // Lock resolved catalog rows while rechecking quote and executing the existing domain.
      for(const service_ref of snapshotServiceRefs(p.snapshot))await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${service_ref} AND "salonId"=${actor.salonId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ClientProfile" WHERE id=${p.snapshot.customer_ref} AND "salonId"=${actor.salonId} FOR SHARE`;
      const fresh=await schedulingSnapshot(tx,actor,d.fields);
      if(JSON.stringify(fresh)!==JSON.stringify(p.snapshot))throw Error("SCHEDULE_CHANGED");
      const appointment_ref=await executeSchedulingCreate(tx,actor,fresh,p.proposal_ref);
      // Owner 07/10: the series' other dates, as proposed (the fresh snapshot equals it), one visit each under the professional's lock.
      const series_refs=fresh.series?await executeSeriesOccurrences(tx,actor,fresh,p.proposal_ref):undefined;
      return receiptSchema.parse({proposal_ref:p.proposal_ref,draft_ref:d.draft_ref,draft_revision:d.draft_revision,appointment_ref,snapshot:fresh,...(series_refs?{series_refs}:{})});
    },
  });
}

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE; docs/c5-spike/12-piloto-remarcacao.md §5): the journal receipt of a proposal
 * that was already confirmed (the CONFIRMED row of its draft naming this very proposal_ref), read only, in the actor's own journal. A Confirmar
 * repeated after a lost reply consults it before any expiry rule; undefined when nothing was written for this proposal. */
export async function schedulingProposalReceipt(tx:Tx,actor:ServiceActor,proposalRef:string){
  await assertSchedulingAccess(tx,actor);
  const row=await tx.auditLog.findFirst({where:{...journal.scope(actor),id:z.string().uuid().parse(proposalRef),action:"PROPOSAL"},select:{metadata:true}});
  if(!row)return undefined;
  const proposal=proposalSchema.parse(row.metadata);
  const confirmed=await tx.auditLog.findFirst({where:{...journal.scope(actor),action:"CONFIRMED",entityId:proposal.draft_ref},select:{metadata:true}});
  if(!confirmed)return undefined;
  const receipt=receiptSchema.parse(confirmed.metadata);
  return receipt.proposal_ref===proposalRef?{...receipt,duplicate:true}:undefined;
}
/** Pilot of the reschedule (flag; review E1): the journal receipt of a draft already confirmed (its CONFIRMED row, whichever proposal it named),
 * read only, in the actor's own journal; undefined when the draft was never confirmed. */
export async function schedulingDraftReceipt(tx:Tx,actor:ServiceActor,draftRef:string){
  await assertSchedulingAccess(tx,actor);
  const confirmed=await tx.auditLog.findFirst({where:{...journal.scope(actor),action:"CONFIRMED",entityId:z.string().uuid().parse(draftRef)},select:{metadata:true}});
  return confirmed?{...receiptSchema.parse(confirmed.metadata),duplicate:true}:undefined;
}
/** T13/T14/T15: existing U03 journal, revision and confirmation contract. `released` (C5): an appointment a pending
 * cancellation of the same plan releases, for the move's freshness check (the executor re-checks the committed agenda). */
export async function proposeSchedulingAction(tx:Tx,actor:ServiceActor,input:unknown,released?:string){
  const p=proposeServiceInput.parse(input);await journal.lock(tx,actor,p.draft_ref);
  const d=await latest(tx,actor,p.draft_ref);await authorizeSchedulingOperation(tx,actor,d.operation);
  assertCurrent(d,p.draft_revision);assertUnexpired(d.expires_at);
  assertSchedulingTemporalConsistency(d.fields);
  if(assess(d).status!=="READY"||!d.action_snapshot||d.action_snapshot.kind!==d.operation)throw Error("NEEDS_INPUT");
  if(JSON.stringify(await schedulingActionSnapshot(tx,actor,d.operation,d.fields,...(released&&d.operation==="appointment.change"?[released] as const:[] as const)))!==JSON.stringify(d.action_snapshot))throw Error("SCHEDULE_CHANGED");
  const existing=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:d.draft_ref,action:"PROPOSAL"},select:{metadata:true}});
  const prior=existing.map(r=>proposalSchema.parse(r.metadata)).find(p=>p.draft_revision===d.draft_revision);
  if(prior){assertUnexpired(prior.expires_at);return prior;}
  const proposal=proposalSchema.parse({...d,proposal_ref:randomUUID(),payload_hash:hash(d),expires_at:new Date(Math.min(Date.parse(d.expires_at),Date.now()+600000)).toISOString(),preview:schedulingActionPreview(d.action_snapshot,d.fields.reason)});
  await journal.append(tx,actor,"PROPOSAL",d.draft_ref,proposal,proposal.proposal_ref);return proposal;
}
