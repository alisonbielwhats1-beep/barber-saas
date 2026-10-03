import { performance } from "node:perf_hooks";
import { clarificationContext } from "./secretary-clarification";
import { runServicesTurn, referencesV2Enabled, sameAsEnabled, type Model, type CapabilitySelection, type SchedulingTemporalEvidence } from "@everflair/salon-secretary";
import { referenceLiteralProven } from "./secretary-same-as";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { schedulingPatch, type SchedulingFields } from "./scheduling-contract";
import { projectSchedulingOperation } from "./secretary-operation-projection";
import { applyTemporalRejections } from "./scheduling-temporal";
import { groundSchedulingTemporalTurn } from "./scheduling-temporal-mode";
import { schedulingNegativeContext, withTemporalTurnDrafts } from './secretary-temporal-turn';
import { nextTemporalAmbiguities } from "./scheduling-temporal-ambiguity";
import { nextCalendarConflicts } from "./scheduling-calendar-conflict";
import { schedulingTimezone } from "./scheduling-catalog";
import { secretaryFastPath } from "./secretary-fast-path";
import { askedSourceFields, groundSchedulingReasons, pendingSourceFields } from "./scheduling-literal-source";
import { literalOverrideConsent } from "./scheduling-conflict-contract";
import { actionScopedSource } from "./secretary-sibling-scope";
import { recurrenceFromTurn, recurrencePending } from "./secretary-recurrence";
import { applyScopeCoverage } from "./scheduling-temporal-source";
import { polarityCodes } from "./scheduling-temporal-polarity";
import { onlyRestatesOptions, replyOnlyPicks } from "./secretary-options";
import { batchRequirements, validateBatchPlan, upsertBatchDraft, proposeActionBatch, confirmActionBatch, patchBatch, type BatchDraft, type BatchProposal, type BatchPlan } from "./scheduling-batch";

export type BatchState={operation:"action.batch";plan:BatchPlan;message:string;draft?:BatchDraft;proposal?:BatchProposal;receipt?:Awaited<ReturnType<typeof confirmActionBatch>>;
  metrics:Record<string,number>;interpretation_source:"MODEL"|"DETERMINISTIC_FAST_PATH"};
async function prepareBatchMutable(actor:ServiceActor,c:BatchState){
  c.proposal=undefined;const t=performance.now();
  c.draft=await withTenant(actor,tx=>upsertBatchDraft(tx,actor,{plan:c.plan,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
  c.metrics={...c.metrics,...c.draft.metrics,validation:performance.now()-t};c.plan=c.draft.plan;c.message=c.draft.message;
  if(c.draft.status==="READY"){
    const p=performance.now();c.proposal=await withTenant(actor,tx=>proposeActionBatch(tx,actor,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision}));
    c.metrics.proposal=performance.now()-p;c.message=c.proposal.preview;
  }
}
/** Adopt only the graph accepted by the journal, including after proposal failure. */
export async function prepareBatch(actor:ServiceActor,c:BatchState,plan?:BatchPlan){
  c.proposal=undefined;const next=structuredClone(c);if(plan)next.plan=structuredClone(plan);
  try{await prepareBatchMutable(actor,next);Object.assign(c,next);}
  catch(error){
    if(next.draft&&(!c.draft||next.draft.draft_ref!==c.draft.draft_ref||next.draft.draft_revision>c.draft.draft_revision)){
      next.plan=next.draft.plan;next.proposal=undefined;next.message="Os dados do plano estão preservados. Não consegui preparar a confirmação. Tente novamente.";
      Object.assign(c,next);
    }
    throw error;
  }
}
/** Promote an already accepted cancellation draft into the atomic cancel→create
 * pair when a later turn asks to fill its released slot. The cancellation keeps
 * its backend-accepted fields (grounded in its own earlier message); only the new
 * creation comes from the current turn. It inherits the released slot, so it is
 * never grounded against a message that does not mention a date or time. */
export async function startReleasedSlotBatch(actor:ServiceActor,cancel:{key:string;fields:SchedulingFields;source_missing?:BatchPlan["items"][number]["source_missing"]},
  create:CapabilitySelection["operations"][number],sourceMessage:string,adoptCommitted?:(state:BatchState)=>void):Promise<BatchState>{
  const start=performance.now();
  const {item_key,operation,fields:parsed,temporal_evidence}=projectSchedulingOperation(create);
  if(operation!=="appointment.create"||!item_key)throw Error("UNSUPPORTED_BATCH");
  // P3c (flag): an atomic pair has no "só a primeira?" card: a recurrence stated for its create prepares nothing (never one
  // silent occurrence).
  if(recurrencePending(recurrenceFromTurn(undefined,operation,sourceMessage,[parsed.service_name,parsed.customer_name,parsed.professional_name]).state,operation))throw Error("UNSUPPORTED_DEPENDENCY_ADAPTER");
  // Same slot inherits time from the cancellation; an alternative destination is
  // grounded against the current message exactly like any other new date/time.
  const alternative=parsed.destination_mode==="ALTERNATIVE_SLOT",timezone=await withTenant(actor,tx=>schedulingTimezone(tx,actor));
  const plan=validateBatchPlan({execution_policy:"all_or_nothing",items:[
    {key:cancel.key,operation:"appointment.cancel",depends_on:[],fields:cancel.fields,...(cancel.source_missing?.length?{source_missing:cancel.source_missing}:{})},
    {key:item_key,operation,depends_on:[cancel.key],released_slot_of:cancel.key,fields:groundSchedulingTemporalTurn({},parsed,alternative?sourceMessage:undefined,timezone,new Date(),undefined,operation,alternative?temporal_evidence??undefined:undefined).fields,
      // D3 (V2): "o mesmo serviço" of the cancellation, proven in this turn's message.
      ...(serviceFollowsReleased(sourceMessage,create,[create],timezone)?{service_follows_released:true as const}:{})},
  ]});
  const c:BatchState={operation:"action.batch",plan,message:"",metrics:{graph:performance.now()-start},interpretation_source:"MODEL"};
  try{await prepareBatch(actor,c);return c;}catch(error){if(c.draft)adoptCommitted?.(c);throw error;}
}
/** D3 (V2): the create of a released slot follows the released appointment's service only with a proven "mesmo serviço"
 * link to its releaser (an identity marker, inside the create's own verified clause, never negated); otherwise the service is
 * the owner's own or asked (the catalog rule "não copie serviço"). */
function serviceFollowsReleased(message:string,op:CapabilitySelection["operations"][number],siblings:readonly CapabilitySelection["operations"][number][],timezone:string){
  if(!referencesV2Enabled()||!sameAsEnabled())return false;
  const link=op.same_as?.find(ref=>ref.field==="service"&&ref.item_key===op.released_slot_of);
  if(!link)return false;
  const scoped=actionScopedSource(message,op,siblings),at=scoped.scoped&&op.source_scope?message.indexOf(op.source_scope):-1;
  return referenceLiteralProven(message,link.literal,at>=0?[at,at+op.source_scope!.length]:undefined,"appointment.create",[],timezone,new Date(),"service");
}
/** `siblings`: every operation of the request (default: this pair). With a verified clause
 * per operation each item is grounded against its own clause (secretary-sibling-scope.ts);
 * otherwise against the full message, as before. `divergence` receives codes only. */
export async function startBatch(actor:ServiceActor,selection:CapabilitySelection,sourceMessage?:string,adoptCommitted?:(state:BatchState)=>void,
  scope:{siblings?:readonly CapabilitySelection["operations"][number][];divergence?:(codes:string[])=>void}={}):Promise<BatchState>{
  if(selection.independent||selection.skills.length!==1||selection.skills[0]!=="scheduling")throw Error("UNSUPPORTED_BATCH");
  const timezone=await withTenant(actor,tx=>schedulingTimezone(tx,actor)),start=performance.now();
  const plan=validateBatchPlan({execution_policy:"all_or_nothing",items:selection.operations.map(op=>{
    const {item_key,depends_on,released_slot_of,operation,fields:parsed,temporal_evidence,temporal_negative_context}=projectSchedulingOperation(op);
    const inherited=operation==="appointment.create"&&released_slot_of&&parsed.destination_mode!=="ALTERNATIVE_SLOT";
    const scoped=sourceMessage===undefined?undefined:actionScopedSource(sourceMessage,op,scope.siblings??selection.operations);
    const source=scoped?.scoped?scoped.text:sourceMessage;
    // P3c (flag): no "só a primeira?" card in an atomic pair: a recurrence its create/block (review B: or cancellation) states
    // prepares nothing; an adjective inside the owner's own names of the item ("manutenção mensal") is that name.
    if(recurrencePending(recurrenceFromTurn(undefined,operation,source,[parsed.service_name,parsed.customer_name,parsed.professional_name]).state,operation))throw Error("UNSUPPORTED_DEPENDENCY_ADAPTER");
    const negativeContext=schedulingNegativeContext(temporal_negative_context,{source,previous:{},raw:parsed,evidence:temporal_evidence,operation});
    const grounded=groundSchedulingTemporalTurn({},parsed,inherited?undefined:source,timezone,new Date(),undefined,operation,inherited?undefined:temporal_evidence??undefined,undefined,negativeContext);
    if(scoped?.scoped&&!inherited&&source!==undefined)scope.divergence?.(applyScopeCoverage(grounded,source,timezone,new Date(),operation,parsed,temporal_evidence));
    // B5: a contradicted temporal role is asked (temporal_missing below); telemetry keeps its code.
    if(!inherited&&temporal_evidence?.some(entry=>entry.conflict))scope.divergence?.(["TEMPORAL_SELECTOR_CONFLICT"]);
    // C4 (flag): exclusion proof codes (never text or values).
    if(!inherited&&grounded.exclusions)scope.divergence?.(polarityCodes(grounded));
    const fields=grounded.fields;
    const sourceResult=groundSchedulingReasons(fields,{},source);
    const source_missing=askedSourceFields(pendingSourceFields(undefined,sourceResult));
    const pending=grounded.pending_temporal_ambiguities;
    const calendar=grounded.pending_calendar_conflicts;
    const temporal_missing=grounded.rejected.filter(rejection=>rejection.field!=="period"&&!pending.some(value=>value.field===rejection.field)&&!calendar.some(value=>value.field===rejection.field)).map(rejection=>rejection.field);
    // D3 (flag SALON_SECRETARY_REFERENCES_V2): "pro mesmo serviço" beside the released slot, proven in the create's own clause.
    const follows=operation==="appointment.create"&&!!released_slot_of&&sourceMessage!==undefined&&serviceFollowsReleased(sourceMessage,op,scope.siblings??selection.operations,timezone);
    return {key:item_key,operation,depends_on,...(released_slot_of?{released_slot_of}:{}),fields,...(source_missing.length?{source_missing}:{}),...(temporal_missing.length?{temporal_missing}:{}),...(pending.length?{pending_temporal_ambiguities:pending}:{}),...(calendar.length?{pending_calendar_conflicts:calendar}:{}),
      ...(follows?{service_follows_released:true as const}:{})};
  })});
  const c:BatchState={operation:"action.batch",plan,message:"",metrics:{graph:performance.now()-start},interpretation_source:"MODEL"};
  try{await prepareBatch(actor,c);return c;}catch(error){if(c.draft)adoptCommitted?.(c);throw error;}
}
export async function sendBatchTurn(actor:ServiceActor,c:BatchState,message:string,model:()=>Promise<Model>,assertLive:()=>unknown){
  return withTemporalTurnDrafts(c.draft?c.draft.plan.items.map(item=>({...c.draft!,fields:item.fields,item_key:item.key,scope_valid:JSON.stringify(c.draft!.plan)===JSON.stringify(c.plan)})):[],()=>sendBatchTurnBound(actor,c,message,model,assertLive));
}
async function sendBatchTurnBound(actor:ServiceActor,c:BatchState,message:string,model:()=>Promise<Model>,assertLive:()=>unknown){
  c.proposal=undefined;c.metrics={};const start=performance.now();
  const waiting=c.draft?.missing_fields.length===1&&!c.draft.candidates?c.draft.missing_fields[0]:undefined;
  const [itemKey,field]=waiting?.split(".")??[];
  const pending=c.plan.items.find(item=>item.key===itemKey)?.pending_temporal_ambiguities?.some(value=>value.field===field);
  const t=performance.now(),fast=pending?undefined:secretaryFastPath(field,message);c.metrics.parsing=performance.now()-t;
  let selected:string,raw:unknown,evidence:SchedulingTemporalEvidence|undefined,negativeProof:unknown;
  if(fast&&itemKey){selected=itemKey;raw=fast;c.interpretation_source="DETERMINISTIC_FAST_PATH";}
  else{
    c.interpretation_source="MODEL";const t=performance.now();
    const response=await runServicesTurn(await model(),message,{waiting_for:waiting,items:c.plan.items.map(i=>({...i,...clarificationContext({operation:i.operation,fields:i.fields,pending_temporal_ambiguities:i.pending_temporal_ambiguities,pending_calendar_conflicts:i.pending_calendar_conflicts,missing_fields:c.draft?.missing_fields.filter(k=>k.startsWith(`${i.key}.`)).map(k=>k.slice(i.key.length+1)),waiting_for:i.key===itemKey?field:undefined,message:c.message})}))},batchRequirements(),"scheduling-batch");
    c.metrics.interpretation=performance.now()-t;selected=response.item_key;const {item_key,temporal_evidence,temporal_negative_context,...fields}=response as typeof response&{temporal_negative_context?:unknown};void item_key;raw=fields;evidence=temporal_evidence;negativeProof=temporal_negative_context;
  }
  assertLive();
  const timezone=await withTenant(actor,tx=>schedulingTimezone(tx,actor));
  const changed=groundBatchPatch(c.plan,selected,schedulingPatch.parse(raw),message,timezone,evidence,c.draft,negativeProof);
  await prepareBatch(actor,c,changed);c.metrics.message=performance.now()-start;
}
export function groundBatchPatch(plan:BatchPlan,selected:string,raw:SchedulingFields,message:string,timezone:string,evidence?:SchedulingTemporalEvidence,draft?:BatchDraft,negativeProof?:unknown){
  const item=plan.items.find(i=>i.key===selected);if(!item)throw Error("DEPENDENCY_ERROR");
  // P2b: the T21 create books the one service of the released slot; a service list there is out of scope (never dropped).
  if(raw.service_names!==undefined)throw Error("CAPABILITY_FIELD_MISMATCH");
  // A validated empty delta retains this item; the source may describe only a
  // sibling's correction. New proof still requires its normal validation.
  if(!Object.keys(raw).length&&!evidence?.length&&negativeProof==null)return structuredClone(plan);
  // A daypart reply belongs to one current batch item and one reviewed draft.
  // Neither a different graph nor a simultaneous retarget may reuse that context.
  const sameDraft=draft&&JSON.stringify(draft.plan)===JSON.stringify(plan);
  const waiting=sameDraft&&draft.missing_fields.length===1&&!draft.candidates&&draft.missing_fields[0].startsWith(selected+".")?draft.missing_fields[0].slice(selected.length+1):undefined;
  const residual=item.pending_temporal_ambiguities?.find(value=>value.field===waiting);
  const retarget=["customer_name","customer_ref","service_name","service_ref","professional_name","professional_ref","date","day_offset","weekday","source_date","source_day_offset","source_weekday","destination_mode"].some(key=>raw[key as keyof SchedulingFields]!==undefined&&raw[key as keyof SchedulingFields]!==item.fields[key as keyof SchedulingFields]);
  const temporalContext=draft&&(residual||item.pending_calendar_conflicts?.length)?{pending_temporal_ambiguities:item.pending_temporal_ambiguities,pending_calendar_conflicts:item.pending_calendar_conflicts,draft_ref:draft.draft_ref,draft_revision:draft.draft_revision,expires_at:draft.expires_at,scope_valid:!!sameDraft&&(!residual||!retarget)}:undefined;
  const negativeContext=schedulingNegativeContext(negativeProof,{source:message,previous:item.fields,raw,evidence,operation:item.operation,draft:draft?{...draft,fields:item.fields,item_key:selected,scope_valid:!!sameDraft}:undefined});
  // C7: a pure pick of this item's open card ("a segunda" = the second option) is not read as dates or clocks; the
  // owner's own words must be only that pick too (a negator or another temporal atom keeps the full grounding).
  const card=sameDraft&&draft?.candidates?.item_key===selected?draft.candidates:undefined;
  const pick=!!card&&!evidence?.length&&negativeProof==null&&onlyRestatesOptions(card.field,card.items.map(option=>option.name),raw)&&
    replyOnlyPicks(message,Object.values(raw).filter((value):value is string=>typeof value==="string"));
  const grounded=groundSchedulingTemporalTurn(item.fields,raw,pick?undefined:message,timezone,new Date(),waiting,item.operation,evidence,temporalContext,negativeContext);
  // A failed response cannot erase the literal question or advance another item.
  if(waiting&&grounded.rejected.length&&!grounded.pending_temporal_ambiguities.length&&!grounded.pending_calendar_conflicts.length)return structuredClone(plan);
  if(item.pending_temporal_ambiguities?.some(value=>grounded.rejected.some(rejection=>rejection.field===value.field)))return structuredClone(plan);
  // The full graph must still be the one reviewed. Changing the cancellation
  // also changes an inherited slot, so item fields alone are insufficient.
  const context=draft&&JSON.stringify(draft.plan)===JSON.stringify(plan)&&draft.missing_fields.length===1&&draft.missing_fields[0]===selected+".override_requested"
    ?{operation:item.operation,waiting_for:"override_requested",fields:draft.plan.items.find(i=>i.key===selected)!.fields,review:draft.review,expires_at:draft.expires_at}:undefined;
  const sourceResult=groundSchedulingReasons(grounded.patch,item.fields,message,context);
  // A1-GF23 (flag): the item's live review (this very graph, unexpired, its question open) decides what a contradictory consent means.
  const live=sameDraft&&Date.parse(draft!.expires_at)>Date.now()&&draft!.missing_fields.some(field=>field.startsWith(selected+"."))?draft!.review:undefined;
  const next=patchBatch(plan,selected,grounded.patch,{review:live,literal:literalOverrideConsent(message)}),target=next.items.find(i=>i.key===selected)!;
  applyTemporalRejections(target.fields,item.fields,grounded.rejected);
  const source_missing=askedSourceFields(pendingSourceFields(item.source_missing,sourceResult));
  if(source_missing.length)target.source_missing=source_missing;else delete target.source_missing;
  const pending=nextTemporalAmbiguities(item.pending_temporal_ambiguities,grounded.pending_temporal_ambiguities,target.fields,raw,grounded.rejected);
  if(pending.length)target.pending_temporal_ambiguities=pending;else delete target.pending_temporal_ambiguities;
  const calendar=nextCalendarConflicts(item.pending_calendar_conflicts,grounded.pending_calendar_conflicts,target.fields);
  if(calendar.length)target.pending_calendar_conflicts=calendar;else delete target.pending_calendar_conflicts;
  const missing=[...new Set([...(item.temporal_missing??[]),...grounded.rejected.flatMap(r=>r.field!=="period"?[r.field]:[])])].filter(f=>!target.fields[f]&&!pending.some(value=>value.field===f)&&!calendar.some(value=>value.field===f));
  if(missing.length)target.temporal_missing=missing;else delete target.temporal_missing;
  return next;
}
export async function selectBatch(actor:ServiceActor,c:BatchState,ref:string){
  const pick=c.draft?.candidates;if(!pick?.items.some(i=>i.id===ref))throw Error("SELECTION_INVALID");
  const changed=structuredClone(c.plan);changed.items.find(i=>i.key===pick.item_key)!.fields[pick.field]=ref;
  // prepare resolves again and validates the selected ref against current candidates.
  await prepareBatch(actor,c,changed);
}
export async function persistBatchMetrics(actor:ServiceActor,id:string,c:BatchState){
  await withTenant(actor,tx=>tx.auditLog.create({data:{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — latência",entityType:"SECRETARY_LATENCY",entityId:id,action:"BATCH_TIMINGS",
    metadata:{operation:"action.batch",batch_ref:c.draft?.draft_ref??null,interpretation_source:c.interpretation_source,durations_ms:c.metrics,...(c.interpretation_source==="DETERMINISTIC_FAST_PATH"?{model_requests:0,model_cost:0,model_avoided:true}:{})}}}));
}
