import { pendingTemporalAmbiguities } from "./scheduling-temporal-ambiguity";
import { pendingCalendarConflicts } from "./scheduling-calendar-conflict";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { actionJournal, assertCurrent, assertUnexpired, confirmJournalAction } from "./secretary-journal";
import { confirmServiceInput, proposeServiceInput } from "./service-create-mvp";
import { schedulingOperation, schedulingResolved, schedulingRequirements } from "./scheduling-contract";
import { assertSchedulingAccess, getSchedulingAvailability } from "./scheduling-catalog";
import { getCustomer } from "./customer-catalog";
import { createVisit } from "./visit-scheduling";
import { createAppointment } from "./appointment-service";
import { canOverbookRole } from "./appointment-overlap-policy";
import { schedulingReviewSchema, assertSchedulingExceptionScope } from "./scheduling-conflict-contract";
import { lockOperationalResources } from "./inventory-lock";
import { actionSnapshot, authorizeSchedulingOperation, executeSchedulingMutation, schedulingActionSnapshot, schedulingActionPreview } from "./scheduling-mutations";
import { applyTemporalRejections, reconcileSchedulingTemporal, temporalRejectionSchema, schedulingTemporalConflicts, assertSchedulingTemporalConsistency } from "./scheduling-temporal";

import { reasonField, reasonRejection } from "./scheduling-literal-source";

const journal=actionJournal("SECRETARY_SCHEDULING");
export const snapshot=z.object({customer_ref:z.string(),customer_name:z.string(),service_ref:z.string(),service_revision:z.string(),service_name:z.string(),professional_ref:z.string(),professional_name:z.string(),
  date:z.string(),startLocal:z.string(),endLocal:z.string(),timezone:z.string(),priceCents:z.number(),priceType:z.string(),durationMin:z.number(),quote:z.string(),overbook:z.object({reason:z.string().min(3).max(200),conflict_hash:z.string()}).strict().optional()}).strict();
const draftSchema=z.object({draft_ref:z.string().uuid(),draft_revision:z.number().int().min(1).max(100),operation:schedulingOperation,
  fields:schedulingResolved,pending_temporal_ambiguities:pendingTemporalAmbiguities.optional(),pending_calendar_conflicts:pendingCalendarConflicts.optional(),source_missing:z.array(reasonField).optional(),temporal_missing:z.array(z.enum(["date","source_date","source_time","time","end_time","end_date"])).optional(),review:schedulingReviewSchema.optional(),snapshot:snapshot.optional(),action_snapshot:actionSnapshot.optional(),expires_at:z.string().datetime()}).strict();
const proposalSchema=draftSchema.extend({proposal_ref:z.string().uuid(),payload_hash:z.string(),preview:z.string()});
const receiptSchema=z.object({proposal_ref:z.string().uuid(),draft_ref:z.string().uuid(),draft_revision:z.number(),appointment_ref:z.string().optional(),snapshot:snapshot.optional(),action_snapshot:actionSnapshot.optional(),block_ref:z.string().optional(),acceptance_ref:z.string().optional(),outcome:z.enum(["RESCHEDULED","PENDING_ACCEPTANCE","CANCELLED","BLOCKED"]).optional()}).strict();
const hash=(d:z.infer<typeof draftSchema>)=>createHash("sha256").update(JSON.stringify({operation:d.operation,fields:d.fields,snapshot:d.snapshot,action_snapshot:d.action_snapshot,temporal_missing:d.temporal_missing,source_missing:d.source_missing,pending_temporal_ambiguities:d.pending_temporal_ambiguities,pending_calendar_conflicts:d.pending_calendar_conflicts})).digest("hex");
async function latest(tx:Tx,actor:ServiceActor,ref:string){
  const rows=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:ref,action:"DRAFT"},select:{metadata:true}});
  const d=rows.map(x=>draftSchema.parse(x.metadata)).sort((a,b)=>b.draft_revision-a.draft_revision)[0];
  if(!d)throw Error("DRAFT_NOT_FOUND");return d;
}
function assess(d:z.infer<typeof draftSchema>){
  const temporal_conflicts=schedulingTemporalConflicts(d.fields);
  const missing_fields=[...new Set([...schedulingRequirements(d.operation).required_fields.filter(k=>!d.fields[k as keyof typeof d.fields]),...(d.temporal_missing??[]),...(d.pending_temporal_ambiguities??[]).map(item=>item.field),...(d.pending_calendar_conflicts??[]).map(item=>item.field),...(d.source_missing??[]),...temporal_conflicts.map(c=>c.field),...(d.review?.missing_fields??[])])];
  return {...d,status:missing_fields.length?"NEEDS_INPUT" as const:"READY" as const,missing_fields,temporal_conflicts};
}
export async function schedulingSnapshot(tx:Tx,actor:ServiceActor,fields:z.infer<typeof schedulingResolved>,now=new Date(),projection?: {releasedAppointmentId:string}){
  assertSchedulingExceptionScope(fields,"appointment.create");
  assertSchedulingTemporalConsistency(fields);
  const {customer_ref,service_ref,professional_ref,date,time}=fields;
  if(!customer_ref||!service_ref||!professional_ref||!date||!time)throw Error("NEEDS_INPUT");
  const customer=await getCustomer(tx,actor,customer_ref);
  const available=await getSchedulingAvailability(tx,actor,{service_ref,professional_ref,date,time,...(fields.override_requested!==undefined?{override_requested:fields.override_requested}:{}),...(fields.override_reason?{override_reason:fields.override_reason}:{})},now,projection);
  if(!available.plan||!available.quote)throw Error("SLOT_CONFLICT");
  const item=available.plan.items[0];
  const [version]=await tx.$queryRaw<{revision:string}[]>`SELECT xmin::text AS revision FROM "Service" WHERE id=${service_ref} AND "salonId"=${actor.salonId}`;
  if(!version)throw Error("SERVICE_NOT_FOUND");
  return snapshot.parse({customer_ref,customer_name:customer.name,service_ref,service_revision:version.revision,service_name:item.serviceName,professional_ref,professional_name:item.professionalName,
    date,startLocal:item.startLocal,endLocal:item.endLocal,timezone:available.timezone,priceCents:item.priceCents,priceType:item.priceType,durationMin:item.durationMin,quote:available.quote,
    ...(available.review?.status==="CONFLICT_OVERRIDABLE"?{overbook:{reason:fields.override_reason!.trim(),conflict_hash:createHash("sha256").update(JSON.stringify(available.review.conflicts)).digest("hex")}}:{})});
}
/** Same transaction supplied by the caller. The manual executor owns override, audit and locks. */
export async function executeSchedulingCreate(tx:Tx,actor:ServiceActor,s:z.infer<typeof snapshot>,key:string){
  if(s.overbook){
    assertSchedulingExceptionScope({override_requested:true},"appointment.create");
    const role=await authorizeSchedulingOperation(tx,actor,"appointment.create");
    const result=await createAppointment(tx,{salonId:actor.salonId,clientId:s.customer_ref,professionalId:s.professional_ref,serviceIds:[s.service_ref],startLocal:s.startLocal,
      origin:"ADMIN",actor:{type:"STAFF",id:actor.userId,name:"Secretária — equipe autenticada"},idempotencyKey:key,enforceBookingWindow:false,enforcePlanLimits:true,
      canOverride:canOverbookRole(role),overrideReason:s.overbook.reason});
    return result.appointment.id;
  }
  const result=await createVisit(tx,{salonId:actor.salonId,clientId:s.customer_ref,choices:[{serviceId:s.service_ref,professionalId:s.professional_ref}],startLocal:s.startLocal,
    idempotencyKey:key,quote:s.quote,manual:true,actor:{type:"STAFF",id:actor.userId,name:"Secretária — equipe autenticada"}});
  if(result.appointmentIds.length!==1)throw Error("UNEXPECTED_APPOINTMENT_RESULT");
  return result.appointmentIds[0];
}
/** U03 adapter: same journal, explicit patch; no Appointment INSERT. Refs are backend/UI resolved. */
export async function upsertSchedulingDraft(tx:Tx,actor:ServiceActor,input:unknown){
  await assertSchedulingAccess(tx,actor);
  const p=z.object({operation:schedulingOperation,fields:schedulingResolved,pending_temporal_ambiguities:pendingTemporalAmbiguities.optional(),pending_calendar_conflicts:pendingCalendarConflicts.optional(),review:schedulingReviewSchema.optional(),snapshot:snapshot.optional(),action_snapshot:actionSnapshot.optional(),draft_ref:z.string().uuid().optional(),expected_revision:z.number().int().optional(),rejected_temporal:z.array(temporalRejectionSchema).max(8).optional(),source_missing:z.array(reasonField).optional(),rejected_source:z.array(reasonRejection).max(2).optional()}).strict().parse(input);
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
  if(old && ["customer_name","service_name","professional_name","date","time","period"].some(k=>p.fields[k as keyof typeof p.fields]!==undefined&&p.fields[k as keyof typeof p.fields]!==old.fields[k as keyof typeof old.fields])&&p.fields.override_requested!==true){delete fields.override_requested;delete fields.override_reason;}
  for(const [name,key]of [["customer_name","customer_ref"],["service_name","service_ref"],["professional_name","professional_ref"]] as const){
    if(p.fields[name]!==undefined&&p.fields[name]!==old?.fields[name]){
      if(!p.fields[key])delete fields[key];
      if(name==="service_name"&&!p.fields.professional_ref)delete fields.professional_ref;
    }
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
  const incomplete=pending_calendar_conflicts.length>0||pending_temporal_ambiguities.length>0||source_missing.length>0||temporal_missing.length>0||schedulingTemporalConflicts(fields).length>0||schedulingRequirements(p.operation).required_fields.some(k=>!fields[k as keyof typeof fields]);
  const d=draftSchema.parse({draft_ref:ref,draft_revision:(old?.draft_revision??0)+1,operation:p.operation,fields,...(pending_calendar_conflicts.length?{pending_calendar_conflicts}:{}),...(pending_temporal_ambiguities.length?{pending_temporal_ambiguities}:{}),...(source_missing.length?{source_missing}:{}),...(p.review?{review:p.review}:{}),...(temporal_missing.length?{temporal_missing}:{}),snapshot:incomplete?undefined:p.snapshot,action_snapshot:incomplete?undefined:p.action_snapshot,
    expires_at:old?.expires_at??new Date(Date.now()+30*60000).toISOString()});
  await journal.append(tx,actor,"DRAFT",ref,d);
  if(rejected.length)await journal.append(tx,actor,"TEMPORAL_RECONCILED",ref,{draft_revision:d.draft_revision,rejected});
  if(p.rejected_source?.length)await journal.append(tx,actor,"SOURCE_RECONCILED",ref,{draft_revision:d.draft_revision,rejected:p.rejected_source});
  return assess(d);
}
/** T12: pure proposal, revalidates availability and frozen domain quote. */
export async function proposeAppointmentCreate(tx:Tx,actor:ServiceActor,input:unknown){
  await assertSchedulingAccess(tx,actor);const p=proposeServiceInput.parse(input);await journal.lock(tx,actor,p.draft_ref);
  const d=await latest(tx,actor,p.draft_ref);assertCurrent(d,p.draft_revision);assertUnexpired(d.expires_at);
  assertSchedulingTemporalConsistency(d.fields);
  if(d.operation!=="appointment.create"||assess(d).status!=="READY"||!d.snapshot)throw Error("NEEDS_INPUT");
  if(JSON.stringify(await schedulingSnapshot(tx,actor,d.fields))!==JSON.stringify(d.snapshot))throw Error("SCHEDULE_CHANGED");
  const existing=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:d.draft_ref,action:"PROPOSAL"},select:{metadata:true}});
  const prior=existing.map(r=>proposalSchema.parse(r.metadata)).find(p=>p.draft_revision===d.draft_revision);
  if(prior){assertUnexpired(prior.expires_at);return prior;}
  const s=d.snapshot;
  const proposal=proposalSchema.parse({...d,proposal_ref:randomUUID(),payload_hash:hash(d),expires_at:new Date(Math.min(Date.parse(d.expires_at),Date.now()+600000)).toISOString(),
    preview:`NOVO AGENDAMENTO\nCliente: ${s.customer_name}\nServiço: ${s.service_name}\nProfissional: ${s.professional_name}\nData: ${s.date}\nHorário: ${s.startLocal.slice(11)}–${s.endLocal.slice(11)} (${s.timezone})\nPreço: ${s.priceType==="FROM"?"A partir de ":""}${(s.priceCents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}${s.overbook?`\nENCAIXE: haverá sobreposição. Motivo: ${s.overbook.reason}`:""}`});
  await journal.append(tx,actor,"PROPOSAL",d.draft_ref,proposal,proposal.proposal_ref);return proposal;
}
export async function confirmAppointmentCreate(tx:Tx,actor:ServiceActor,input:unknown){
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
        const result=await executeSchedulingMutation(tx,actor,p.action_snapshot,d.fields,p.proposal_ref);
        return receiptSchema.parse({proposal_ref:p.proposal_ref,draft_ref:d.draft_ref,draft_revision:d.draft_revision,...result,action_snapshot:p.action_snapshot});
      }
      if(!p.snapshot)throw Error("PROPOSAL_INVALID");
      await lockOperationalResources(tx,{professionalIds:[p.snapshot.professional_ref]});
      // Lock resolved catalog rows while rechecking quote and executing the existing domain.
      await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${p.snapshot.service_ref} AND "salonId"=${actor.salonId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ClientProfile" WHERE id=${p.snapshot.customer_ref} AND "salonId"=${actor.salonId} FOR SHARE`;
      const fresh=await schedulingSnapshot(tx,actor,d.fields);
      if(JSON.stringify(fresh)!==JSON.stringify(p.snapshot))throw Error("SCHEDULE_CHANGED");
      const appointment_ref=await executeSchedulingCreate(tx,actor,fresh,p.proposal_ref);
      return receiptSchema.parse({proposal_ref:p.proposal_ref,draft_ref:d.draft_ref,draft_revision:d.draft_revision,appointment_ref,snapshot:fresh});
    },
  });
}

/** T13/T14/T15: existing U03 journal, revision and confirmation contract. */
export async function proposeSchedulingAction(tx:Tx,actor:ServiceActor,input:unknown){
  const p=proposeServiceInput.parse(input);await journal.lock(tx,actor,p.draft_ref);
  const d=await latest(tx,actor,p.draft_ref);await authorizeSchedulingOperation(tx,actor,d.operation);
  assertCurrent(d,p.draft_revision);assertUnexpired(d.expires_at);
  assertSchedulingTemporalConsistency(d.fields);
  if(assess(d).status!=="READY"||!d.action_snapshot||d.action_snapshot.kind!==d.operation)throw Error("NEEDS_INPUT");
  if(JSON.stringify(await schedulingActionSnapshot(tx,actor,d.operation,d.fields))!==JSON.stringify(d.action_snapshot))throw Error("SCHEDULE_CHANGED");
  const existing=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:d.draft_ref,action:"PROPOSAL"},select:{metadata:true}});
  const prior=existing.map(r=>proposalSchema.parse(r.metadata)).find(p=>p.draft_revision===d.draft_revision);
  if(prior){assertUnexpired(prior.expires_at);return prior;}
  const proposal=proposalSchema.parse({...d,proposal_ref:randomUUID(),payload_hash:hash(d),expires_at:new Date(Math.min(Date.parse(d.expires_at),Date.now()+600000)).toISOString(),preview:schedulingActionPreview(d.action_snapshot,d.fields.reason)});
  await journal.append(tx,actor,"PROPOSAL",d.draft_ref,proposal,proposal.proposal_ref);return proposal;
}
