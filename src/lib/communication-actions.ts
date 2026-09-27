import { createHash,randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import { withTenant } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { assertCustomerAccess,getCustomer } from "./customer-catalog";
import { maskPhone } from "./client-identity";
import { isValidPhoneBR,normalizePhone } from "./phone";
import { actionJournal,assertCurrent,assertUnexpired,confirmJournalAction } from "./secretary-journal";
import { proposeServiceInput,confirmServiceInput } from "./service-create-mvp";
import { actionSnapshot,schedulingActionSnapshot,executeSchedulingMutation } from "./scheduling-mutations";
import { schedulingResolved } from "./scheduling-contract";
import { FakeCommunicationProvider,assertLocalCommunication } from "./communication-provider";

const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function assertCommunicationAccess(tx:Tx,actor:ServiceActor){assertLocalCommunication();await assertCustomerAccess(tx,actor);}
/** T10: no authentication fields or full contact returned. Eligibility is LOCAL_FAKE only. */
export async function getCustomerMessageContext(tx:Tx,actor:ServiceActor,ref:string){
  await assertCommunicationAccess(tx,actor);const c=await getCustomer(tx,actor,ref);
  const eligible=Boolean(c.phone&&isValidPhoneBR(c.phone));
  return {customer_ref:c.id,name:c.name,masked_recipient:maskPhone(c.phone),channel:"WHATSAPP" as const,provider:"LOCAL_FAKE" as const,
    channel_eligible:eligible,missing_requirements:eligible?[]:["recipient_phone"],contact_revision:digest({id:c.id,name:c.name,phone:c.phone}),allowed_template_refs:[]};
}
export const messagePatch=z.object({channel:z.literal("WHATSAPP").optional(),message_mode:z.enum(["EXACT","GENERATED"]).optional(),content:z.string().min(1).max(2000).optional()}).strict();
const recipientSchema=z.object({customer_ref:z.string(),name:z.string(),masked_recipient:z.string().nullable(),contact_revision:z.string()}).strict();
const dependencySchema=z.object({snapshot:actionSnapshot,fields:schedulingResolved}).strict();
const journal=actionJournal("SECRETARY_COMMUNICATION");
const draftSchema=z.object({operation:z.literal("customer.message"),draft_ref:z.string().uuid(),draft_revision:z.number().int().min(1).max(100),recipient:recipientSchema,fields:messagePatch,
  dependency:dependencySchema.optional(),expires_at:z.string().datetime()}).strict();
const proposalSchema=draftSchema.extend({proposal_ref:z.string().uuid(),payload_hash:z.string(),preview:z.string()});
const receiptSchema=z.object({receipt_ref:z.string().uuid(),proposal_ref:z.string().uuid(),draft_ref:z.string().uuid(),draft_revision:z.number(),message_ref:z.string(),status:z.literal("QUEUED"),provider:z.literal("LOCAL_FAKE"),appointment_ref:z.string().optional(),business_outcome:z.literal("CANCELLED").optional()}).strict();
const hash=(d:z.infer<typeof draftSchema>)=>digest({recipient:d.recipient,fields:d.fields,dependency:d.dependency??null});
async function latest(tx:Tx,a:ServiceActor,ref:string){const rows=await tx.auditLog.findMany({where:{...journal.scope(a),entityId:ref,action:"DRAFT"},select:{metadata:true}});const d=rows.map(r=>draftSchema.parse(r.metadata)).sort((a,b)=>b.draft_revision-a.draft_revision)[0];if(!d)throw Error("DRAFT_NOT_FOUND");return d;}
function assess(d:z.infer<typeof draftSchema>){const missing_fields=(["channel","message_mode","content"] as const).filter(k=>d.fields[k]===undefined);return {...d,status:missing_fields.length?"NEEDS_INPUT" as const:"READY" as const,missing_fields};}
async function revalidate(tx:Tx,a:ServiceActor,d:z.infer<typeof draftSchema>){
  const c=await getCustomerMessageContext(tx,a,d.recipient.customer_ref);
  if(!c.channel_eligible)throw Error("CONTACT_NOT_ELIGIBLE");
  if(c.contact_revision!==d.recipient.contact_revision)throw Error("RECIPIENT_CHANGED");
  if(d.dependency){
    const {snapshot,fields}=d.dependency;
    if(snapshot.kind!=="appointment.cancel"||snapshot.customer_ref!==c.customer_ref)throw Error("DEPENDENCY_ERROR");
    if(JSON.stringify(await schedulingActionSnapshot(tx,a,"appointment.cancel",fields))!==JSON.stringify(snapshot))throw Error("SCHEDULE_CHANGED");
  }
}
/** U03: exact content is a reviewed domain value, never trimmed or normalized here. */
export async function upsertMessageDraft(tx:Tx,a:ServiceActor,input:unknown){
  await assertCommunicationAccess(tx,a);
  const p=z.object({customer_ref:z.string().min(1),patch:messagePatch,dependency:dependencySchema.optional(),draft_ref:z.string().uuid().optional(),expected_revision:z.number().int().optional()}).strict().refine(x=>Boolean(x.draft_ref)===Boolean(x.expected_revision)).parse(input);
  const ref=p.draft_ref??randomUUID();await journal.lock(tx,a,ref);const old=p.draft_ref?await latest(tx,a,ref):undefined;
  if(old){assertCurrent(old,p.expected_revision!);assertUnexpired(old.expires_at);if(old.recipient.customer_ref!==p.customer_ref)throw Error("OPERATION_MISMATCH");if(await tx.auditLog.findFirst({where:{...journal.scope(a),entityId:ref,action:"CONFIRMED"}}))throw Error("ALREADY_CONFIRMED");}
  const c=await getCustomerMessageContext(tx,a,p.customer_ref);if(!c.channel_eligible)throw Error("CONTACT_NOT_ELIGIBLE");
  const d=draftSchema.parse({operation:"customer.message",draft_ref:ref,draft_revision:(old?.draft_revision??0)+1,
    recipient:old?.recipient??{customer_ref:c.customer_ref,name:c.name,masked_recipient:c.masked_recipient,contact_revision:c.contact_revision},
    fields:{...old?.fields,...Object.fromEntries(Object.entries(p.patch).filter(([,v])=>v!==undefined))},dependency:p.dependency??old?.dependency,
    expires_at:old?.expires_at??new Date(Date.now()+30*60000).toISOString()});
  await revalidate(tx,a,d);await journal.append(tx,a,"DRAFT",ref,d);return assess(d);
}
/** T20: preview and hash cover the exact content, recipient, channel and optional cancel snapshot. */
export async function proposeCustomerMessage(tx:Tx,a:ServiceActor,input:unknown){
  await assertCommunicationAccess(tx,a);const p=proposeServiceInput.parse(input);await journal.lock(tx,a,p.draft_ref);
  const d=await latest(tx,a,p.draft_ref);assertCurrent(d,p.draft_revision);assertUnexpired(d.expires_at);await revalidate(tx,a,d);
  if(assess(d).status!=="READY")throw Error("NEEDS_INPUT");
  const old=await tx.auditLog.findMany({where:{...journal.scope(a),entityId:d.draft_ref,action:"PROPOSAL"},select:{metadata:true}});
  const existing=old.map(r=>proposalSchema.parse(r.metadata)).find(p=>p.draft_revision===d.draft_revision);if(existing)return existing;
  const dependency=d.dependency?`CANCELAR AGENDAMENTO\n${d.dependency.snapshot.customer_name}\n${d.dependency.snapshot.before_start}\nMotivo: ${d.dependency.fields.reason}\nA mensagem depende do sucesso deste cancelamento.\n\n`:"";
  const proposal=proposalSchema.parse({...d,proposal_ref:randomUUID(),payload_hash:hash(d),preview:`${dependency}MENSAGEM — SIMULAÇÃO LOCAL\nPara: ${d.recipient.name} (${d.recipient.masked_recipient})\nCanal: WhatsApp (fake, sem envio externo)\nMensagem:\n${d.fields.content}`,expires_at:new Date(Math.min(Date.parse(d.expires_at),Date.now()+10*60000)).toISOString()});
  await journal.append(tx,a,"PROPOSAL",d.draft_ref,proposal,proposal.proposal_ref);return proposal;
}
/** Commit only. Caller invokes fake dispatch AFTER withTenant has committed. */
export async function confirmCustomerMessage(tx:Tx,a:ServiceActor,input:unknown){
  return confirmJournalAction<z.infer<typeof draftSchema>,z.infer<typeof proposalSchema>,z.infer<typeof receiptSchema>>(tx,a,confirmServiceInput.parse(input),{
    journal,proposalAction:"PROPOSAL",confirmedAction:"CONFIRMED",authorize:()=>assertCommunicationAccess(tx,a),parseProposal:x=>proposalSchema.parse(x),parseReceipt:x=>receiptSchema.parse(x),latest:ref=>latest(tx,a,ref),proposalHash:hash,draftHash:hash,
    execute:async(p,d)=>{
      await revalidate(tx,a,d);let eventId:string|undefined;
      if(d.dependency){
        await executeSchedulingMutation(tx,a,d.dependency.snapshot,d.dependency.fields,`${p.proposal_ref}:cancel`);
        const event=await tx.appointmentEvent.findFirst({where:{salonId:a.salonId,appointmentId:d.dependency.snapshot.appointment_ref!,idempotencyKey:`${p.proposal_ref}:cancel:cancelled`},select:{id:true}});
        if(!event)throw Error("DEPENDENCY_EVENT_MISSING");eventId=event.id;
      }
      const message_ref=`communication:${p.proposal_ref}`;
      await tx.notificationOutbox.create({data:{id:message_ref,salonId:a.salonId,eventId:eventId??null,appointmentId:d.dependency?.snapshot.appointment_ref??null,
        recipientType:"CLIENT",recipientId:d.recipient.customer_ref,recipientKey:`CLIENT:${d.recipient.customer_ref}`,channel:"WHATSAPP",template:"secretary.communication.v1",
        payload:{provider:"LOCAL_FAKE",content:d.fields.content!,message_mode:d.fields.message_mode!,content_hash:digest(d.fields.content),contact_revision:d.recipient.contact_revision,proposal_ref:p.proposal_ref},status:"PENDING"},select:{id:true}});
      return receiptSchema.parse({receipt_ref:randomUUID(),proposal_ref:p.proposal_ref,draft_ref:d.draft_ref,draft_revision:d.draft_revision,message_ref,status:"QUEUED",provider:"LOCAL_FAKE",...(d.dependency?{appointment_ref:d.dependency.snapshot.appointment_ref,business_outcome:"CANCELLED"}:{})});
    },
  });
}
const payloadSchema=z.object({provider:z.literal("LOCAL_FAKE"),content:z.string(),message_mode:z.enum(["EXACT","GENERATED"]),content_hash:z.string(),contact_revision:z.string(),proposal_ref:z.string()}).strict();
async function messageRow(tx:Tx,a:ServiceActor,ref:string){
  await assertCommunicationAccess(tx,a);const row=await tx.notificationOutbox.findFirst({where:{id:ref,salonId:a.salonId,channel:"WHATSAPP",template:"secretary.communication.v1"},select:{id:true,recipientId:true,payload:true,status:true,attempts:true,lastError:true,updatedAt:true,appointmentId:true}});
  if(!row)throw Error("MESSAGE_NOT_FOUND");payloadSchema.parse(row.payload);return row;
}
/** T11: minimum DTO. No body, raw recipient/contact, or internal DB object. */
export async function getMessageStatus(tx:Tx,a:ServiceActor,ref:string){
  const r=await messageRow(tx,a,ref);return {message_ref:r.id,provider:"LOCAL_FAKE" as const,status:r.status==="FAILED"?"FAILED" as const:r.attempts>0?"SIMULATED" as const:"QUEUED" as const,
    external_delivery:false,attempts:r.attempts,error_code:r.lastError,related_action_ref:r.appointmentId,last_event_at:r.updatedAt.toISOString(),retry_state:r.status==="FAILED"?"MANUAL_REVIEW":"NONE"};
}
/** Narrow fake-only dispatcher, no network. No retry on repeat; locks message across concurrent calls. */
export async function dispatchLocalMessage(a:ServiceActor,ref:string,provider:FakeCommunicationProvider){
  assertLocalCommunication();if(!(provider instanceof FakeCommunicationProvider))throw Error("EXTERNAL_PROVIDER_DISABLED");
  const started=performance.now();let providerMs=0;
  const status=await withTenant(a,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`communication:${a.salonId}:${ref}`},0))`;
    const row=await messageRow(tx,a,ref);if(row.attempts>0)return getMessageStatus(tx,a,ref);
    const payload=payloadSchema.parse(row.payload);let error:string|undefined;
    const c=await getCustomer(tx,a,row.recipientId!);
    if(!c.phone||!isValidPhoneBR(c.phone)||digest({id:c.id,name:c.name,phone:c.phone})!==payload.contact_revision)error="RECIPIENT_CHANGED";
    else {
      const t=performance.now();
      try{const result=await provider.send({idempotencyKey:row.id,recipient:`55${normalizePhone(c.phone)}`,content:payload.content});if(result.status==="FAILED")error="FAKE_FAILURE";}
      catch{error="FAKE_FAILURE";}providerMs=performance.now()-t;
    }
    await tx.notificationOutbox.updateMany({where:{id:row.id,salonId:a.salonId,attempts:0},data:{attempts:1,status:error?"FAILED":"PENDING",lastError:error??null,nextAttemptAt:null}});
    return getMessageStatus(tx,a,ref);
  });
  return {...status,metrics:{provider_fake:providerMs,dispatch:performance.now()-started}};
}
export async function communicationMetrics(a:ServiceActor,sessionId:string,metrics:Record<string,number>,source:"MODEL"|"DETERMINISTIC_FAST_PATH"){
  await withTenant(a,tx=>tx.auditLog.create({data:{salonId:a.salonId,userId:a.userId,actorName:"Secretária — latência",entityType:"SECRETARY_LATENCY",entityId:sessionId,action:"COMMUNICATION",metadata:{interpretation_source:source,durations_ms:metrics,...(source==="DETERMINISTIC_FAST_PATH"?{model_avoided:true,model_cost:0,model_requests:0}:{})} as Prisma.InputJsonObject}}));
}
