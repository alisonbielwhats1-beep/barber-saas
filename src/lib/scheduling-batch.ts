import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { actionJournal, assertCurrent, assertUnexpired, confirmJournalAction } from "./secretary-journal";
import { confirmServiceInput, proposeServiceInput } from "./service-create-mvp";
import { schedulingResolved, type SchedulingFields } from "./scheduling-contract";
import { reconcileSchedulingTemporal, assertSchedulingTemporalConsistency } from "./scheduling-temporal";
import { searchSalonCustomer, getCustomer } from "./customer-catalog";
import { listSchedulingServices, listSchedulingProfessionals, getSchedulingAvailability } from "./scheduling-catalog";
import { authorizeSchedulingOperation, locateSchedulingAppointments, schedulingActionSnapshot, actionSnapshot, executeSchedulingMutation } from "./scheduling-mutations";
import { schedulingSnapshot, snapshot, executeSchedulingCreate } from "./scheduling-actions";
import { lockAppointmentOperationalScope } from "./appointment-service";
import { schedulingOverlapEnabled, schedulingReviewSchema, assertSchedulingExceptionScope } from "./scheduling-conflict-contract";

import { reasonField } from "./scheduling-literal-source";
import { pendingTemporalAmbiguities, firstTemporalAmbiguity, temporalAmbiguityQuestion } from "./scheduling-temporal-ambiguity";
import { pendingCalendarConflicts, firstCalendarConflict, calendarConflictQuestion } from "./scheduling-calendar-conflict";

export const BATCH_MAX_OPERATIONS = 2;
const key = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
export const batchItem = z.object({ key, operation: z.enum(["appointment.cancel", "appointment.create"]),
  depends_on: z.array(key).max(BATCH_MAX_OPERATIONS), released_slot_of: key.optional(), fields: schedulingResolved,
  pending_temporal_ambiguities:pendingTemporalAmbiguities.optional(),
  pending_calendar_conflicts:pendingCalendarConflicts.optional(),
  source_missing:z.array(reasonField).optional(),temporal_missing:z.array(z.enum(["date","source_date","source_time","time","end_date","end_time"])).optional() }).strict();
export const batchPlan = z.object({ execution_policy: z.literal("all_or_nothing"), items: z.array(batchItem).min(2).max(BATCH_MAX_OPERATIONS) }).strict();
export type BatchPlan = z.infer<typeof batchPlan>;
export { batchRequirements } from "./scheduling-contract";

/** Validate graph, then narrow to the one proven pattern. Order of input is immaterial. */
export function validateBatchPlan(input: unknown) {
  const plan = batchPlan.parse(input), byKey = new Map(plan.items.map(i => [i.key, i]));
  if (byKey.size !== plan.items.length) throw Error("DEPENDENCY_ERROR");
  const visiting = new Set<string>(), visited = new Set<string>(), ordered: BatchPlan["items"] = [];
  function visit(id: string) {
    if (visiting.has(id)) throw Error("DEPENDENCY_CYCLE");
    if (visited.has(id)) return;
    const item = byKey.get(id); if (!item) throw Error("DEPENDENCY_ERROR");
    if (new Set(item.depends_on).size !== item.depends_on.length) throw Error("DEPENDENCY_ERROR");
    visiting.add(id); for (const dependency of item.depends_on) visit(dependency);
    visiting.delete(id); visited.add(id); ordered.push(item);
  }
  plan.items.forEach(i => visit(i.key));
  const [cancel, create] = ordered;
  if (cancel.operation !== "appointment.cancel" || cancel.depends_on.length || cancel.released_slot_of ||
      create.operation !== "appointment.create" || create.depends_on.length !== 1 || create.depends_on[0] !== cancel.key || create.released_slot_of !== cancel.key)
    throw Error("UNSUPPORTED_BATCH");
  for(const item of ordered)assertSchedulingExceptionScope(item.fields,item.operation);
  // Omitted mode is the historical same-slot contract; explicit opt-in changes only destination.
  const alternative=create.fields.destination_mode==="ALTERNATIVE_SLOT";
  if ([...(alternative?[]:["date","time","period"]),"end_time","source_date","source_time"].some(k => create.fields[k as keyof SchedulingFields] !== undefined)) throw Error("DEPENDENCY_ERROR");
  return { ...plan, items: ordered };
}

const resolvedSnapshot = z.object({ cancel: actionSnapshot, create: snapshot,
  create_fields: schedulingResolved, customer_revision: z.string(), professional_revision: z.string(), resource_revision: z.string().nullable() }).strict();
const candidate = z.object({ item_key: key, field: z.enum(["customer_ref", "service_ref", "professional_ref", "appointment_ref"]), items: z.array(z.object({id:z.string(),name:z.string()}).strict()) }).strict();
const draftSchema = z.object({ batch_ref:z.string().uuid(),batch_revision:z.number().int().min(1).max(100), draft_ref:z.string().uuid(), draft_revision:z.number().int().min(1).max(100), operation:z.literal("action.batch"), plan:batchPlan,
  status:z.enum(["NEEDS_INPUT","BLOCKED","READY"]), missing_fields:z.array(z.string()), message:z.string(), candidates:candidate.optional(),
  review:schedulingReviewSchema.optional(), snapshot:resolvedSnapshot.optional(), metrics:z.record(z.number()).optional(), expires_at:z.string().datetime() }).strict();
const proposalSchema = draftSchema.extend({proposal_ref:z.string().uuid(),payload_hash:z.string(),preview:z.string()});
const receiptSchema = z.object({receipt_ref:z.string().uuid(),proposal_ref:z.string().uuid(),draft_ref:z.string().uuid(),draft_revision:z.number(),batch_ref:z.string().uuid(),batch_revision:z.number(),
  results:z.array(z.object({key:z.string(),operation:z.string(),appointment_ref:z.string(),outcome:z.string()}).strict())}).strict();
export type BatchDraft = z.infer<typeof draftSchema>;
export type BatchProposal = z.infer<typeof proposalSchema>;
const journal=actionJournal("SECRETARY_SCHEDULING_BATCH");
const hash=(d:BatchDraft)=>createHash("sha256").update(JSON.stringify({plan:d.plan,status:d.status,snapshot:d.snapshot})).digest("hex");
export async function latestBatch(tx:Tx,actor:ServiceActor,ref:string) {
  const rows=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:ref,action:"DRAFT"},select:{metadata:true}});
  const d=rows.map(r=>draftSchema.parse(r.metadata)).sort((a,b)=>b.draft_revision-a.draft_revision)[0];if(!d)throw Error("DRAFT_NOT_FOUND");return d;
}
async function authorize(tx:Tx,actor:ServiceActor){await authorizeSchedulingOperation(tx,actor,"appointment.cancel");}
type Assessment=Pick<BatchDraft,"status"|"missing_fields"|"message"|"candidates"|"snapshot"|"review">;
async function assess(tx:Tx,actor:ServiceActor,plan:BatchPlan,metrics:Record<string,number>={},previousPlan?:BatchPlan):Promise<Assessment> {
  await authorize(tx,actor);
  const resolutionStart=performance.now();
  const [a,b]=plan.items;
  const missing=(item:typeof a,field:string,message:string):Assessment=>({status:"NEEDS_INPUT",missing_fields:[`${item.key}.${field}`],message});
  const pick=(item:typeof a,field:z.infer<typeof candidate>["field"],rows:{id:string;name:string}[]):Assessment|undefined=>{
    if(item.fields[field]) {if(!rows.some(r=>r.id===item.fields[field]))throw Error("SELECTION_INVALID");return;}
    if(rows.length===1){item.fields[field]=rows[0].id;return;}
    return {status:"NEEDS_INPUT",missing_fields:[`${item.key}.${field}`],message:rows.length?"Selecione a correspondência correta. Nenhuma ação foi executada.":"Não encontrei esse cadastro neste salão. Confira o nome.",
      ...(rows.length&&rows.length<=20?{candidates:{item_key:item.key,field,items:rows.map(r=>({id:r.id,name:r.name}))}}:{})};
  };
  for(const item of [a,b])assertSchedulingTemporalConsistency(item.fields);
  for(const item of [a,b])if(item.source_missing?.length)return {status:"NEEDS_INPUT",missing_fields:item.source_missing.map(f=>`${item.key}.${f}`),message:item.source_missing.includes("reason")?"Qual é o motivo do cancelamento? Vou registrar suas palavras.":"Qual é o motivo do encaixe? Vou registrar suas palavras."};
  for(const item of [a,b]){const pending=firstCalendarConflict(item.pending_calendar_conflicts);if(pending)return missing(item,pending.field,calendarConflictQuestion(pending));}
  for(const item of [a,b]){const pending=firstTemporalAmbiguity(item.pending_temporal_ambiguities);if(pending)return missing(item,pending.field,temporalAmbiguityQuestion(pending));}
  for(const item of [a,b])if(item.temporal_missing?.length)return {status:"NEEDS_INPUT",missing_fields:item.temporal_missing.map(f=>`${item.key}.${f}`),message:"A interpretação de data ou horário divergiu do pedido. Informe novamente a data e o horário desejados."};
  // Customer lookups independent; no full customer records enter the plan.
  const customers=await Promise.all(plan.items.map(i=>i.fields.customer_name?searchSalonCustomer(tx,actor,i.fields.customer_name):Promise.resolve([])));
  for(const [index,item] of plan.items.entries()){
    if(!item.fields.customer_name)return missing(item,"customer_name",`Informe o cliente da ação ${item.key}.`);
    const need=pick(item,"customer_ref",customers[index]);if(need)return need;
  }
  for(const [name,ref] of [["service_name","service_ref"],["professional_name","professional_ref"]] as const){
    if(a.fields[name]){
      const rows=ref==="service_ref"?await listSchedulingServices(tx,actor,a.fields[name]!):await listSchedulingProfessionals(tx,actor,{query:a.fields[name]!,service_ref:a.fields.service_ref});
      const need=pick(a,ref,rows);if(need)return need;
    }
  }
  const appointments=await locateSchedulingAppointments(tx,actor,a.fields,"appointment.cancel");
  const need=pick(a,"appointment_ref",appointments.map(r=>({id:r.appointment_ref,name:`${r.customer_name} — ${r.start_local} — ${r.professional_name}`})));if(need)return need;
  if(!a.fields.reason||a.fields.reason.trim().length<3)return missing(a,"reason","Informe o motivo real do cancelamento (mínimo 3 caracteres).");
  const cancel=await schedulingActionSnapshot(tx,actor,"appointment.cancel",a.fields);
  if(!b.fields.service_name)return missing(b,"service_name","Qual é o serviço do novo agendamento?");
  const serviceNeed=pick(b,"service_ref",await listSchedulingServices(tx,actor,b.fields.service_name));if(serviceNeed)return serviceNeed;
  const pros=await listSchedulingProfessionals(tx,actor,{service_ref:b.fields.service_ref,...(b.fields.professional_name?{query:b.fields.professional_name}:{})});
  if(!pros.length)throw Error("PRO_SERVICE_MISMATCH");
  // The released slot belongs to the cancelled appointment's professional and the
  // gate below accepts only that professional. Asking to choose among others would
  // be a question whose only valid answer is already known by the backend.
  if(!b.fields.professional_ref&&!b.fields.professional_name&&pros.some(p=>p.id===cancel.professional_ref))b.fields.professional_ref=cancel.professional_ref;
  const proNeed=pick(b,"professional_ref",pros);if(proNeed)return proNeed;
  // This gate replaces the same professional's slot; no arbitrary reassignment.
  if(b.fields.professional_ref!==cancel.professional_ref)throw Error("PRO_SERVICE_MISMATCH");
  metrics.resolution=performance.now()-resolutionStart;
  const alternative=b.fields.destination_mode==="ALTERNATIVE_SLOT";
  const create_fields={...b.fields,date:alternative?(b.fields.date??cancel.startLocal.slice(0,10)):cancel.startLocal.slice(0,10),time:alternative?b.fields.time:cancel.startLocal.slice(11)};
  const availabilityStart=performance.now();
  if(schedulingOverlapEnabled()){
    // A prior refusal belongs to its reviewed destination. A new destination
    // needs a fresh decision only when the backend finds another conflict.
    const previous=previousPlan?.items.find(i=>i.key===b.key);
    const changedSlot=previous&&["customer_name","customer_ref","service_name","service_ref","professional_name","professional_ref","date","time","period","destination_mode"].some(k=>b.fields[k as keyof SchedulingFields]!==previous.fields[k as keyof SchedulingFields]);
    const requestedOverride=create_fields.override_requested===false&&changedSlot?undefined:create_fields.override_requested;
    const available=await getSchedulingAvailability(tx,actor,{service_ref:create_fields.service_ref,professional_ref:create_fields.professional_ref,date:create_fields.date,
      time:create_fields.time??cancel.startLocal.slice(11),override_requested:requestedOverride,override_reason:create_fields.override_reason},new Date(),{releasedAppointmentId:cancel.appointment_ref!});
    if(alternative&&!create_fields.time){
      const options=available.alternatives.map(a=>a.startLocal.slice(11).replace(":00","h").replace(":","h"));
      return {...missing(b,"time",options.length?`Tenho ${options.join(", ")}. Qual horário você prefere?`:"Não encontrei outra opção nesta data. Qual outra data ou horário você prefere consultar?"),review:available.review};
    }
    if(changedSlot&&available.review?.missing_fields.includes("override_requested"))delete b.fields.override_requested;
    if(available.review?.missing_fields.length)return {status:"NEEDS_INPUT",missing_fields:available.review.missing_fields.map(k=>`${b.key}.${k}`),message:available.review.message,review:available.review};
  }
  const create=await schedulingSnapshot(tx,actor,create_fields,new Date(),{releasedAppointmentId:cancel.appointment_ref!});
  metrics.projected_availability=performance.now()-availabilityStart;
  const [customer]=await tx.$queryRaw<{revision:string}[]>`SELECT xmin::text AS revision FROM "ClientProfile" WHERE id=${create.customer_ref} AND "salonId"=${actor.salonId}`;
  const [professional]=await tx.$queryRaw<{revision:string}[]>`SELECT xmin::text AS revision FROM "Professional" WHERE id=${create.professional_ref} AND "salonId"=${actor.salonId}`;
  const resource=await tx.service.findFirstOrThrow({where:{id:create.service_ref,salonId:actor.salonId},select:{physicalResourceId:true}});
  const resourceRows=resource.physicalResourceId?await tx.$queryRaw<{revision:string}[]>`SELECT xmin::text AS revision FROM "PhysicalResource" WHERE id=${resource.physicalResourceId} AND "salonId"=${actor.salonId} AND active=true`:[];
  return {status:"READY",missing_fields:[],message:"Plano validado. Aguarda confirmação única.",snapshot:resolvedSnapshot.parse({cancel,create,create_fields,customer_revision:customer.revision,professional_revision:professional.revision,resource_revision:resourceRows[0]?.revision??null})};
}
/** U03 batch adapter; stores partial plans and revisions in the existing journal. */
export async function upsertBatchDraft(tx:Tx,actor:ServiceActor,input:unknown){
  await authorize(tx,actor);
  const p=z.object({plan:batchPlan,draft_ref:z.string().uuid().optional(),expected_revision:z.number().int().optional()}).strict().parse(input);
  if(Boolean(p.draft_ref)!==Boolean(p.expected_revision))throw Error("REVISION_REQUIRED");
  const ref=p.draft_ref??randomUUID();await journal.lock(tx,actor,ref);
  const old=p.draft_ref?await latestBatch(tx,actor,ref):undefined;
  if(old){assertCurrent(old,p.expected_revision!);assertUnexpired(old.expires_at);if(await tx.auditLog.findFirst({where:{...journal.scope(actor),entityId:ref,action:"CONFIRMED"},select:{id:true}}))throw Error("ALREADY_CONFIRMED");}
  const graphStart=performance.now(),plan=validateBatchPlan(p.plan),metrics:Record<string,number>={graph:performance.now()-graphStart};
  const start=performance.now();let result:Assessment;
  try{result=await assess(tx,actor,plan,metrics,old?.plan);}catch(error){
    const code=error instanceof Error?error.message:"";
    if(!["SLOT_CONFLICT","PRO_SERVICE_MISMATCH","SCHEDULING_RELATION_NOT_SUPPORTED","SELECTION_INVALID","APPOINTMENT_NOT_FOUND","ALREADY_STARTED_OR_CLOSED","RESOURCE_UNAVAILABLE"].includes(code))throw error;
    result={status:"BLOCKED",missing_fields:[],message:`Plano bloqueado: ${code}. Nenhuma ação executada.`};
  }
  const d=draftSchema.parse({batch_ref:ref,batch_revision:(old?.draft_revision??0)+1,draft_ref:ref,draft_revision:(old?.draft_revision??0)+1,operation:"action.batch",plan,...result,metrics,expires_at:old?.expires_at??new Date(Date.now()+1800000).toISOString()});
  await journal.append(tx,actor,"DRAFT",ref,d);
  await journal.append(tx,actor,"BATCH_VALIDATED",ref,{draft_revision:d.draft_revision,validation_ms:performance.now()-start,status:d.status});
  return d;
}
/** Patch one named local operation, never merge fields across items. */
export function patchBatch(plan:BatchPlan,itemKey:string,patch:SchedulingFields){
  const next=structuredClone(plan),item=next.items.find(i=>i.key===itemKey);if(!item)throw Error("DEPENDENCY_ERROR");
  const old=item.fields;item.fields=reconcileSchedulingTemporal(old,patch).fields;
  if(patch.override_reason!==undefined&&patch.override_reason!==old.override_reason&&!patch.override_reason_source)delete item.fields.override_reason_source;
  if(item.operation==="appointment.create"){
    const changesSlot=["customer_name","service_name","professional_name","date","time","period","destination_mode"].some(k=>patch[k as keyof SchedulingFields]!==undefined&&patch[k as keyof SchedulingFields]!==old[k as keyof SchedulingFields]);
    if(changesSlot&&patch.override_requested!==true){if(old.override_requested!==undefined)item.fields.override_requested=false;else delete item.fields.override_requested;delete item.fields.override_reason;delete item.fields.override_reason_source;}
    if(patch.override_requested===false){delete item.fields.override_reason;delete item.fields.override_reason_source;}
    if(patch.destination_mode==="ALTERNATIVE_SLOT"){
      item.fields.override_requested=false;delete item.fields.override_reason;delete item.fields.override_reason_source;
      if(patch.time===undefined)delete item.fields.time;
    }
  }else if(item.operation==="appointment.cancel"&&JSON.stringify(old)!==JSON.stringify(item.fields)){
    for(const dependent of next.items.filter(i=>i.released_slot_of===item.key)){delete dependent.fields.override_requested;delete dependent.fields.override_reason;delete dependent.fields.override_reason_source;}
  }
  for(const [name,ref] of [["customer_name","customer_ref"],["service_name","service_ref"],["professional_name","professional_ref"]] as const){
    if(patch[name]!==undefined&&patch[name]!==old[name]){delete item.fields[ref];if(name==="service_name")delete item.fields.professional_ref;}
  }
  if(["customer_name","service_name","professional_name","date","time","period"].some(k=>patch[k as keyof SchedulingFields]!==undefined&&patch[k as keyof SchedulingFields]!==old[k as keyof SchedulingFields]))delete item.fields.appointment_ref;
  if(item.fields.reason_source&&item.fields.reason_source.original_text!==item.fields.reason)delete item.fields.reason_source;
  if(item.fields.override_reason_source&&item.fields.override_reason_source.original_text!==item.fields.override_reason)delete item.fields.override_reason_source;
  return validateBatchPlan(next);
}
/** T21: one proposal for the entire typed dependency graph, without operational writes. */
export async function proposeActionBatch(tx:Tx,actor:ServiceActor,input:unknown){
  await authorize(tx,actor);const p=proposeServiceInput.parse(input);await journal.lock(tx,actor,p.draft_ref);
  const d=await latestBatch(tx,actor,p.draft_ref);assertCurrent(d,p.draft_revision);assertUnexpired(d.expires_at);
  if(d.status!=="READY"||!d.snapshot)throw Error("NEEDS_INPUT");
  const fresh=await assess(tx,actor,validateBatchPlan(d.plan));if(fresh.status!=="READY"||JSON.stringify(fresh.snapshot)!==JSON.stringify(d.snapshot))throw Error("SCHEDULE_CHANGED");
  const rows=await tx.auditLog.findMany({where:{...journal.scope(actor),entityId:d.draft_ref,action:"PROPOSAL"},select:{metadata:true}});
  const prior=rows.map(r=>proposalSchema.parse(r.metadata)).find(p=>p.draft_revision===d.draft_revision);if(prior){assertUnexpired(prior.expires_at);return prior;}
  const {cancel:a,create:b}=d.snapshot;
  const proposal=proposalSchema.parse({...d,proposal_ref:randomUUID(),payload_hash:hash(d),expires_at:new Date(Math.min(Date.parse(d.expires_at),Date.now()+600000)).toISOString(),
    preview:`ALTERAÇÕES NA AGENDA\n1. CANCELAR: ${a.customer_name} — ${a.services.map(s=>s.name).join(", ")}\n${a.startLocal}–${a.endLocal} (${a.timezone})\nMotivo: ${d.plan.items[0].fields.reason}\nFila ativa: ${a.waiting_count}, preservada sem promoção.\n2. AGENDAR: ${b.customer_name} — ${b.service_name}\n${b.professional_name} — ${b.startLocal}–${b.endLocal} (${b.timezone})\n${b.priceType==="FROM"?"A partir de ":""}${(b.priceCents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}\n${d.plan.items[1].fields.destination_mode==="ALTERNATIVE_SLOT"?"A ação 2 usa outro horário escolhido e continua dependendo do cancelamento da ação 1.":"A ação 2 depende do horário liberado pela ação 1."}${b.overbook?`\nENCAIXE: haverá sobreposição. Motivo: ${b.overbook.reason}`:""} Tudo será aplicado na mesma transação.`});
  await journal.append(tx,actor,"PROPOSAL",d.draft_ref,proposal,proposal.proposal_ref);return proposal;
}
/** Must run inside ONE withTenant transaction. Existing executors receive that same tx. */
export async function confirmActionBatch(tx:Tx,actor:ServiceActor,input:unknown){
  return confirmJournalAction<BatchDraft,BatchProposal,z.infer<typeof receiptSchema>>(tx,actor,confirmServiceInput.parse(input),{
    journal,proposalAction:"PROPOSAL",confirmedAction:"CONFIRMED",authorize:()=>authorize(tx,actor),parseProposal:x=>proposalSchema.parse(x),parseReceipt:x=>receiptSchema.parse(x),
    latest:ref=>latestBatch(tx,actor,ref),proposalHash:hash,draftHash:hash,
    execute:async(p,d)=>{
      if(d.status!=="READY"||!p.snapshot)throw Error("NEEDS_INPUT");
      const t=performance.now(),s=p.snapshot;
      await lockAppointmentOperationalScope(tx,{salonId:actor.salonId,appointmentId:s.cancel.appointment_ref!,targetProfessionalIds:[s.create.professional_ref]});
      await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${s.create.service_ref} AND "salonId"=${actor.salonId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ClientProfile" WHERE id=${s.create.customer_ref} AND "salonId"=${actor.salonId} FOR SHARE`;
      const fresh=await assess(tx,actor,validateBatchPlan(d.plan));
      if(fresh.status!=="READY"||JSON.stringify(fresh.snapshot)!==JSON.stringify(s))throw Error("SCHEDULE_CHANGED");
      await getCustomer(tx,actor,s.create.customer_ref);
      const [a,b]=d.plan.items;
      await executeSchedulingMutation(tx,actor,s.cancel,a.fields,`${p.proposal_ref}:${a.key}`);
      const created=await executeSchedulingCreate(tx,actor,s.create,`${p.proposal_ref}:${b.key}`);
      await journal.append(tx,actor,"BATCH_EXECUTED",d.draft_ref,{transaction_body_ms:performance.now()-t,post_commit_effects:"EXISTING_OUTBOX_ONLY"});
      return {receipt_ref:randomUUID(),proposal_ref:p.proposal_ref,draft_ref:d.draft_ref,draft_revision:d.draft_revision,batch_ref:d.draft_ref,batch_revision:d.draft_revision,
        results:[{key:a.key,operation:a.operation,appointment_ref:s.cancel.appointment_ref!,outcome:"CANCELLED"},{key:b.key,operation:b.operation,appointment_ref:created,outcome:"CONFIRMED"}]};
    },
  });
}
