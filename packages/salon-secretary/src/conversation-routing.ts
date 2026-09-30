import { AsyncLocalStorage } from "node:async_hooks";
import { type CapabilitySelection, validateDisposition, validateSelection, validateSelectionV2, selectionSchemaV2, selectionTransportSchemaV2, capabilitySelectionWire, strictSecretaryWire, publishedOperation, operationSkill, existingOperationsWire, existingItemKeyWire, type SecretaryWireSchema,
  carriedRejections, withRejected, rejectionCode, type RejectedOperation, type ValidationOptions } from "./skill-registry";
import { z } from "zod";
import { decodeTemporalEvidencePayload } from "./scheduling-skill";
import { decodeInventoryQuantityPayload } from "./inventory-skill";
import { releasedSlotSources, referencesV2Enabled, withoutReleasedReferences } from "./same-as";
import { reportNormalization } from "./multi-service";

export type ConversationRoutingContext = {
  /** `pending_discard` (B3, review 2b): the linked set the backend asked about last turn ("descarto os dois?"). */
  active_plan?: { plan_ref: string; actions: unknown[]; pending_discard?: { item_keys: string[]; question: string } };
  suspended_plans?: { plan_ref: string; actions: unknown[] }[];
};
const routing = new AsyncLocalStorage<ConversationRoutingContext>();
/** Staff and service names of the authenticated salon (never customers). Data for
 * role disambiguation only ("a Tatiana" is a professional, not a client); the
 * backend still resolves every entity, permission and availability. */
export type SalonDirectory = { professionals: readonly string[]; services: readonly string[]; today?: { date: string; weekday: string; timezone: string } };
const directory = new AsyncLocalStorage<SalonDirectory>();
export function withSalonDirectory<T>(value: SalonDirectory | undefined, work: () => Promise<T>): Promise<T> {
  return value ? directory.run(value, work) : work();
}
export const salonDirectory = () => directory.getStore();
export const conversationRoutingEnabled = () => routing.getStore() !== undefined;
export const conversationRoutingContext = () => routing.getStore();
export function withConversationRouting<T>(work: () => Promise<T>, context: ConversationRoutingContext = {}): Promise<T> {
  return routing.run(context, work);
}
/** Synchronous compile helper (contract version): `work` sees exactly `context`, or no routing at all when undefined. */
export function inConversationRouting<T>(context: ConversationRoutingContext | undefined, work: () => T): T {
  return context ? routing.run(context, work) : routing.exit(work);
}
/** C6 (default off): state-bound rules travel in a per-turn appendix of the system input (instructions.ts). The request
 * budget (index.ts) may compile ONE request with the appendix when the static prompt would not fit the cap. */
const jitRequest = new AsyncLocalStorage<true>();
export const jitInstructionsEnabled = () => jitRequest.getStore() ?? process.env.SALON_SECRETARY_JIT_INSTRUCTIONS === "true";
/** Synchronous: `work` compiles with the JIT appendix on, whatever the flag says. */
export function withJitInstructions<T>(work: () => T): T { return jitRequest.run(true, work); }
/** Every route decision an interpretation throws (NEW/ADD/PATCH, RESUME, DISCARD). Catch sites test
 * this base, so a route can never be swallowed as an adapter or preparation failure. */
export abstract class SecretaryRouteRequest extends Error {}
export class SecretaryNewRequest extends SecretaryRouteRequest {
  readonly selection: CapabilitySelection;
  constructor(input: unknown, readonly mode: "NEW" | "ADD" | "PATCH" = "NEW") {
    super("SECRETARY_NEW_REQUEST");
    this.selection = mode === "PATCH" ? validateExistingPlanPatches(input, routing.getStore()?.active_plan) : mode === "ADD" ? validateAddSelection(input, routing.getStore()?.active_plan) : validateSelectionV2(input);
    if (mode !== "NEW" && !this.selection.operations.length) throw Error("CONVERSATION_ROUTE_CONFLICT");
  }
}
export class SecretaryResumeRequest extends SecretaryRouteRequest {
  readonly patches?: CapabilitySelection;
  constructor(readonly planRef: string, patches?: unknown, options: ValidationOptions = {}) {
    super("SECRETARY_RESUME_REQUEST");
    if (!routing.getStore()?.suspended_plans?.some(plan => plan.plan_ref === planRef)) throw Error("PLAN_NOT_IN_SESSION");
    if (patches != null) this.patches = validateExistingPlanPatches(patches, routing.getStore()!.suspended_plans!.find(plan => plan.plan_ref === planRef), options);
  }
}
/** DISCARD gives up actions of the ACTIVE plan (null = every open action). It never confirms or
 * executes; the backend closes atomic units and dependents and reports them. */
export class SecretaryDiscardRequest extends SecretaryRouteRequest {
  readonly itemKeys: string[] | null;
  constructor(itemKeys: unknown) {
    super("SECRETARY_DISCARD_REQUEST");
    this.itemKeys = validateDiscardKeys(itemKeys, routing.getStore()?.active_plan);
  }
}
const terminal = (status: string) => status === 'DONE' || status === 'DISCARDED';
const discardKeys = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)).min(1).nullable();
/** Keys must be open actions of the published active plan: a completed one cannot be discarded. A repeated
 * key says the same thing twice (set semantics; strict JSON schema cannot forbid it), never a refusal. */
export function validateDiscardKeys(input: unknown, plan: RoutingPlan | undefined): string[] | null {
  const parsed = discardKeys.parse(input), actions = canonicalActions(plan), keys = parsed && [...new Set(parsed)];
  if (keys?.some(key => actions.find(action => action.item_key === key)?.status === 'DONE')) throw Error('ALREADY_CONFIRMED');
  if (!actions.some(action => !terminal(action.status))) throw Error('DISCARD_ACTION_MISMATCH');
  if (keys === null) return null;
  if (keys.some(key => !actions.some(action => action.item_key === key && !terminal(action.status)))) throw Error('DISCARD_ACTION_MISMATCH');
  return keys;
}
/** B4: one published option of THIS item's open card (clarification.candidates), chosen by its
 * positional id; `literal` is the user's own words that pick it. An alias the backend resolves only
 * through the card it published this turn, never an entity id; a stale id is asked again. */
export const optionChoice=z.object({option_id:z.string().regex(/^opt_[1-9]\d?$/),literal:z.string().min(1).max(600).regex(/\S/)}).strict();
export type OptionChoice=z.infer<typeof optionChoice>;
/** The option choice a validated PATCH delta carries, if any (never part of the capability fields). */
export const operationChoice=(op:object):OptionChoice|undefined=>(op as {choice?:OptionChoice|null}).choice??undefined;
/** Existing actions are identified by backend keys, never re-selected by the model. */
const existingActionDeltaSchema=selectionSchemaV2.shape.operations.element.partial().extend({
  item_key:z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),operation:publishedOperation.nullable().optional(),choice:optionChoice.nullable().optional(),
});
const existingFieldsSchema=existingActionDeltaSchema.omit({item_key:true,depends_on:true,released_slot_of:true,choice:true,same_as:true});
export const existingPlanPatchSchema = selectionSchemaV2.partial().extend({
  operations:z.array(z.union([existingActionDeltaSchema,z.object({
    item_key:existingActionDeltaSchema.shape.item_key,choice:optionChoice.nullable().optional(),
    fields:existingFieldsSchema,
  }).strict()])),
});
type RoutingPlan = NonNullable<ConversationRoutingContext['active_plan']>;
const canonicalActionSchema=z.object({item_key:z.string(),operation:publishedOperation,status:z.string()}).passthrough();
function canonicalActions(plan:RoutingPlan | undefined) {
  if(!plan) throw Error('PLAN_NOT_IN_SESSION');
  return plan.actions.map(action=>canonicalActionSchema.parse(action));
}
/** ADD normally validates the new operations as a standalone graph. The single
 * external reference allowed is the one Luna needs for "coloca o Fábio no lugar":
 * a new appointment filling the slot released by a cancellation already in the
 * active plan. Every capability/field guard still runs on the new operation; the
 * backend decides whether that cancellation is pending (atomic pair) or done. */
export function validateAddSelection(input:unknown,plan:RoutingPlan|undefined,options:ValidationOptions={}):CapabilitySelection {
  const operations=(input as {operations?:{item_key?:string|null;operation?:string;depends_on?:string[]|null;released_slot_of?:string|null}[]}).operations??[];
  const own=new Set(operations.map(op=>op.item_key).filter(Boolean));
  const external=operations.some(op=>(op.depends_on??[]).some(key=>!own.has(key))||op.released_slot_of!=null&&!own.has(op.released_slot_of));
  // C5: a same_as reference may also name an action of the active plan (a data link, never an execution edge).
  if(!external)return validateSelectionV2(input,{...options,...(plan?{references:canonicalActions(plan)}:{})});
  const [op]=operations,released=op?.released_slot_of;
  const target=canonicalActions(plan).find(action=>action.item_key===released);
  // P3a D1 (flag SALON_SECRETARY_REFERENCES_V2): the origin of a reschedule of the active plan is a released slot too.
  if(operations.length!==1||op.operation!=='appointment.create'||!released||!releasedSlotSources().includes(target?.operation??'')||target!.status==='DISCARDED'||
    JSON.stringify(op.depends_on)!==JSON.stringify([released]))throw Error('INVALID_DEPENDENCY_GRAPH');
  // P3a D3 (V2): the added create may say "o mesmo serviço" of that releaser (an active-plan key); beside the released slot only
  // that service link is kept (withoutReleasedReferences).
  const v2=referencesV2Enabled();
  const checked=validateSelectionV2({...(input as object),independent:true,operations:[{...op,depends_on:[],released_slot_of:null}]},v2&&plan?{references:canonicalActions(plan)}:{});
  const added=v2?withoutReleasedReferences({...checked.operations[0],released_slot_of:released}):checked.operations[0];
  return {...checked,independent:false,operations:[{...added,depends_on:[released],released_slot_of:released}]};
}
/** C4 R-A (flag SALON_SECRETARY_REFERENCES_V2): an edge of a NEW/ADD operation to an action the published active plan already
 * executed (DONE; never a key of the envelope itself, never the operation's released slot) is satisfied: nothing waits for it,
 * so it is dropped before validation (DEPENDENCY_ALREADY_DONE, codes only). Only an executed create or change left its appointment
 * alive, and only while no cancellation of the plan (open or done) may have ended it: an edge to a done cancellation (the follow-up
 * speaks of an appointment that no longer exists, so locating another one of the customer would change the wrong appointment),
 * block or read, or to an open, discarded or unknown action, is kept (INVALID_DEPENDENCY_GRAPH as before). Flag off or no active
 * plan: the operations as sent. */
export function withoutSatisfiedEdges<T>(operations:readonly T[],plan:RoutingPlan|undefined):T[]{
  if(!referencesV2Enabled()||!plan)return [...operations];
  const own=new Set(operations.map(op=>(op as {item_key?:unknown}|null)?.item_key));
  const fields=(action:unknown)=>(action??{}) as {item_key?:unknown;status?:unknown;operation?:unknown};
  const ended=plan.actions.some(action=>fields(action).operation==='appointment.cancel'&&fields(action).status!=='DISCARDED');
  const done=new Set(ended?[]:plan.actions.flatMap(action=>{const {item_key,status,operation}=fields(action);
    return status==='DONE'&&(operation==='appointment.create'||operation==='appointment.change')&&typeof item_key==='string'&&!own.has(item_key)?[item_key]:[];}));
  return operations.map(op=>{
    const {depends_on:edges,released_slot_of:released}=(op&&typeof op==='object'?op:{}) as {depends_on?:unknown;released_slot_of?:unknown};
    if(!Array.isArray(edges))return op;
    const kept=edges.filter(key=>typeof key!=='string'||!done.has(key)||key===released);
    if(kept.length===edges.length)return op;
    reportNormalization('DEPENDENCY_ALREADY_DONE');
    return {...op,depends_on:kept};
  });
}
type PatchDelta=z.infer<typeof existingPlanPatchSchema>['operations'][number];
const splitDelta=(delta:PatchDelta)=>'fields' in delta ? {...delta.fields,item_key:delta.item_key,choice:delta.choice} : delta;
/** One delta against its canonical action: capability guards only (identity is checked by the caller). */
function patchOperation(delta:Omit<ReturnType<typeof splitDelta>,'choice'>,choice:ReturnType<typeof splitDelta>['choice'],action:ReturnType<typeof canonicalActions>[number]){
  // Only transport-neutral values are supplied here. Accepted fields live in the backend draft. A (null) C5 reference is graph metadata.
  const {same_as:_references,...patch}=delta as typeof delta&{same_as?:unknown};void _references;
  const operation={target_name:null,name:null,priceCents:null,durationMin:null,phone:null,email:null,requested_fields:[],clear_fields:[],...patch,operation:action.operation,depends_on:[],released_slot_of:null};
  const validated=validateSelection({skills:[operationSkill(action.operation)],independent:true,operations:[operation]}).operations[0];
  // The choice rides beside the capability fields; the backend binds it to its published card (or asks again).
  return choice?{...validated,choice}:validated;
}
export function validateExistingPlanPatches(input:unknown,plan:RoutingPlan|undefined,options:ValidationOptions={}):CapabilitySelection {
  const {rest,rejected:carried}=carriedRejections(input);
  if(options.partial)return partialPlanPatches(rest,plan,carried);
  const parsed=existingPlanPatchSchema.parse(rest), actions=canonicalActions(plan);
  validateDisposition(parsed);
  const seen=new Set<string>();
  const operations=parsed.operations.map(delta=>{
    const {choice,...patch}=splitDelta(delta);
    const action=actions.find(action=>action.item_key===patch.item_key);
    if(!action || terminal(action.status) || seen.has(patch.item_key) || patch.operation!=null && patch.operation!==action.operation || patch.depends_on?.length || patch.released_slot_of!=null || patch.same_as?.length) throw Error('CONTINUATION_ACTION_MISMATCH');
    seen.add(patch.item_key);
    return patchOperation(patch,choice,action);
  });
  const skills=[...new Set(operations.map(op=>operationSkill(op.operation)))];
  if(parsed.skills?.length && JSON.stringify([...new Set(parsed.skills)].sort())!==JSON.stringify([...skills].sort())) throw Error('SKILL_OPERATION_MISMATCH');
  // Dependency edges remain solely in the canonical plan. This envelope only carries field deltas.
  return withRejected({...parsed,skills,independent:true,operations},carried);
}
/** B5: each delta is validated on its own. A delta naming an unknown, closed or repeated key, reclassifying
 * its operation or failing its capability guards is left out, with every delta whose action depends on it
 * in the plan; the rest apply. Edge edits (a graph change) and skill mismatches stay turn-fatal. */
function partialPlanPatches(input:unknown,plan:RoutingPlan|undefined,carried:readonly RejectedOperation[]):CapabilitySelection{
  const envelope=existingPlanPatchSchema.extend({operations:z.array(z.unknown())}).parse(input),actions=canonicalActions(plan);
  validateDisposition(envelope);
  // The published item shape {item_key, choice, fields} only (the decoder's input).
  const element=canonicalPatches.shape.operations.element;
  const deltas=envelope.operations.map(raw=>{
    const found=element.safeParse(raw),rawKey=(raw as {item_key?:unknown}|null)?.item_key;
    if(!found.success)return {key:typeof rawKey==='string'?rawKey:null,error:found.error as unknown,context:(raw as {fields?:unknown}|null)?.fields??raw};
    const {choice,...patch}=splitDelta(found.data);
    if(patch.depends_on?.length||patch.released_slot_of!=null||patch.same_as?.length)throw Error('CONTINUATION_ACTION_MISMATCH');
    return {key:patch.item_key,patch,choice,context:patch as unknown};
  });
  const count=(key:string|null)=>deltas.filter(delta=>delta.key===key).length;
  const failures=new Map<number,unknown>();
  const checked=deltas.map((delta,index)=>{
    try{
      if(!delta.patch)throw delta.error;
      const action=actions.find(item=>item.item_key===delta.key);
      // Two deltas for one item are two statements: neither is chosen.
      if(!action||terminal(action.status)||count(delta.key)>1||delta.patch.operation!=null&&delta.patch.operation!==action.operation)throw Error('CONTINUATION_ACTION_MISMATCH');
      return patchOperation(delta.patch,delta.choice,action);
    }catch(error){failures.set(index,error);return undefined;}
  });
  const known=[...new Set(deltas.flatMap(delta=>actions.filter(action=>action.item_key===delta.key).map(action=>operationSkill(action.operation))))];
  if(envelope.skills?.length&&JSON.stringify([...new Set(envelope.skills)].sort())!==JSON.stringify(known.sort()))throw Error('SKILL_OPERATION_MISMATCH');
  // A correction of an action depending (in the plan) on a left-out correction waits with it.
  const parents=(key:string)=>{const depends=(actions.find(action=>action.item_key===key) as {depends_on?:unknown}|undefined)?.depends_on;return Array.isArray(depends)?depends.filter((item):item is string=>typeof item==='string'):[];};
  const ancestors=(key:string,seen=new Set<string>()):Set<string>=>{for(const parent of parents(key))if(!seen.has(parent)){seen.add(parent);ancestors(parent,seen);}return seen;};
  const rejectedKeys=new Set(deltas.flatMap((delta,index)=>failures.has(index)&&delta.key?[delta.key]:[]));
  const dependent=(index:number)=>!failures.has(index)&&!!deltas[index].key&&[...ancestors(deltas[index].key!)].some(key=>rejectedKeys.has(key));
  const left=(index:number)=>failures.has(index)||dependent(index);
  const operations=checked.filter((op,index)=>!left(index)) as CapabilitySelection['operations'];
  const skills=[...new Set(operations.map(op=>operationSkill(op.operation)))];
  if(!failures.size)return withRejected({...envelope,skills,independent:true,operations},carried);
  if(!operations.length)throw failures.get(Math.min(...failures.keys()));
  const rejected:RejectedOperation[]=deltas.flatMap((delta,index)=>{
    if(!left(index))return [];
    const scope=(delta.context as {source_scope?:unknown}|null)?.source_scope;
    return [{item_key:delta.key,operation:actions.find(action=>action.item_key===delta.key)?.operation??null,
      code:failures.has(index)?rejectionCode(failures.get(index)):'DEPENDENT_OF_REJECTED',dependent:!failures.has(index),
      source_scope:typeof scope==='string'&&scope.trim()?scope.slice(0,1000):null,subject:null}];
  });
  return {...envelope,skills,independent:true,operations,rejected:[...carried,...rejected]};
}
export function existingPlanPatchWire(plan:RoutingPlan | undefined):SecretaryWireSchema {
  return {type:'object',properties:{operations:existingOperationsWire(plan ? canonicalActions(plan) : [])},required:['operations'],additionalProperties:false};
}
export function resumeRequestWire():SecretaryWireSchema {
  const plans=routing.getStore()?.suspended_plans ?? [];
  // One shared patch schema bounds cost across retained plans. The constructor validates
  // each key/operation/status against the selected plan again, never against this union.
  return plans.length ? {anyOf:[{type:'object',properties:{
    plan_ref:{type:'string',enum:plans.map(plan=>plan.plan_ref)},
    patches:{anyOf:[existingPlanPatchWire({plan_ref:'wire-only',actions:plans.flatMap(plan=>plan.actions)}),{type:'null'}]},
  },required:['plan_ref','patches'],additionalProperties:false},{type:'null'}]} : {type:'null'};
}

/** V2 has one decision before its payload. Legacy decoding is kept outside this
 * schema, so an invalid new envelope cannot fall back to another interpretation. */
const canonicalPatches=z.object({operations:z.array(z.object({
  item_key:existingActionDeltaSchema.shape.item_key,choice:optionChoice.nullable().optional(),
  fields:existingFieldsSchema,
}).strict()).min(1)}).strict();
const nonOperationalResponse=z.string().trim().min(1).max(600);
const envelopeOf=<O extends z.ZodType,P extends z.ZodType>(operations:O,patches:P)=>z.object({turn:z.discriminatedUnion('mode',[
  z.object({mode:z.literal('NEW'),operations}).strict(),
  z.object({mode:z.literal('ADD'),operations}).strict(),
  z.object({mode:z.literal('PATCH'),operations:patches}).strict(),
  z.object({mode:z.literal('RESUME'),plan_ref:z.string().uuid(),patches:z.object({operations:patches}).strict().nullable()}).strict(),
  z.object({mode:z.literal('DISCARD'),item_keys:discardKeys}).strict(),
  z.object({mode:z.literal('CONVERSATION'),response:nonOperationalResponse}).strict(),
  z.object({mode:z.literal('UNSUPPORTED'),unavailable_capability:selectionSchemaV2.shape.unavailable_capability.unwrap().unwrap(),response:nonOperationalResponse.nullable()}).strict(),
  z.object({mode:z.literal('AMBIGUOUS'),response:nonOperationalResponse.nullable()}).strict(),
  z.object({mode:z.literal('CURRENT'),fields:z.record(z.string(),z.unknown())}).strict(),
])}).strict();
const turnEnvelope=envelopeOf(selectionTransportSchemaV2.shape.operations.min(1),canonicalPatches.shape.operations);
/** B5: the same decision envelope, each operation/delta left for its own validation (partial acceptance). */
const partialTurnEnvelope=envelopeOf(z.array(z.unknown()).min(1),z.array(z.unknown()).min(1));
const transportOperation=selectionTransportSchemaV2.shape.operations.element;

/** `strict` (dev validators, e.g. the example bank): no partial acceptance and no per-role degradation;
 * any invalid operation or contradictory selector rejects the whole turn, as before B5. */
export function decodeConversationTurn(input:unknown, currentSchema?:z.ZodType, message?:string, options:{strict?:boolean}={}):Record<string,unknown> {
  // B5: one bad operation or one contradicted temporal role does not lose the rest of the turn.
  const partial=!options.strict;
  const decoded=decodeInventoryQuantityPayload(decodeTemporalEvidencePayload(input,true,message,partial),true);
  const {turn}=(partial?partialTurnEnvelope:turnEnvelope).parse(decoded),context=conversationRoutingContext();
  const route=(selection:CapabilitySelection,mode:'NEW'|'ADD'|'PATCH'='NEW'):Record<string,unknown>=>
    conversationRoutingEnabled()?{new_request:selection,new_request_mode:mode}:selection;
  switch(turn.mode){
    case 'CURRENT':
      if(!currentSchema||context?.active_plan)throw Error('CONVERSATION_ROUTE_CONFLICT');
      return currentSchema.parse(turn.fields) as Record<string,unknown>;
    case 'NEW':case 'ADD':{
      if(turn.mode==='ADD'&&!context?.active_plan)throw Error('PLAN_NOT_IN_SESSION');
      // Partial: neutral transport defaults apply to each operation that parses; one that does not is
      // left as sent and refused on its own by validation (never by the whole envelope).
      // C4 R-A: an edge to an action the active plan already executed is satisfied (withoutSatisfiedEdges, flag REFERENCES_V2).
      const operations=withoutSatisfiedEdges((turn.operations as unknown[]).map(operation=>{const parsed=partial?transportOperation.safeParse(operation):undefined;return parsed?.success?parsed.data:operation;}),
        context?.active_plan) as {operation?:unknown;depends_on?:unknown}[];
      const request={disposition:'SUPPORTED',conversation_response:null,unavailable_capability:null,
        skills:[...new Set(operations.flatMap(operation=>{const parsed=publishedOperation.safeParse(operation?.operation);return parsed.success?[operationSkill(parsed.data)]:[];}))],
        independent:!operations.some(operation=>Array.isArray(operation?.depends_on)&&operation.depends_on.length),operations};
      const selection=turn.mode==='ADD'?validateAddSelection(request,context?.active_plan,{partial}):validateSelectionV2(request,{partial});
      return route(selection,turn.mode);
    }
    case 'PATCH':{
      const selection=validateExistingPlanPatches({operations:turn.operations},context?.active_plan,{partial});
      return route(selection,'PATCH');
    }
    case 'RESUME':{
      // Validates the selected plan, keys, operation and DONE state before dispatch.
      const resume=new SecretaryResumeRequest(turn.plan_ref,turn.patches,{partial});
      return {resume_request:{plan_ref:resume.planRef,patches:resume.patches??null}};
    }
    case 'DISCARD':{
      // Validates the keys against the published active plan (open actions only) before dispatch.
      if(!context?.active_plan)throw Error('PLAN_NOT_IN_SESSION');
      return {discard_request:{item_keys:new SecretaryDiscardRequest(turn.item_keys).itemKeys}};
    }
    default:return route(validateSelectionV2({disposition:turn.mode,conversation_response:turn.response,
      unavailable_capability:turn.mode==='UNSUPPORTED'?turn.unavailable_capability:null,
      skills:[],independent:true,operations:[]}));
  }
}

/** Root stays an object for strict Structured Outputs; each nested branch starts
 * with its discriminator and contains only the payload that decision can use. */
export function conversationTurnWire(currentWire?:SecretaryWireSchema):SecretaryWireSchema {
  const context=conversationRoutingContext(),active=context?.active_plan;
  // C6 JIT (flag): a description names only modes this very wire publishes.
  const patchPublished=!!active&&canonicalActions(active).some(action=>!terminal(action.status));
  const branch=(mode:string,description:string,properties:Record<string,SecretaryWireSchema>)=>({
    type:'object',properties:{mode:{type:'string',enum:[mode],description},...properties},
    required:['mode',...Object.keys(properties)],additionalProperties:false,
  } satisfies SecretaryWireSchema);
  const operations={...capabilitySelectionWire(true).properties!.operations,minItems:1};
  const modes:SecretaryWireSchema[]=[branch('NEW','Novo pedido operacional, inclusive incompleto. Remarcar é appointment.change, disponível.',{operations})];
  if(active){
    modes.push(branch('ADD','Acrescentar ações ao pedido ativo, com novas chaves.',{operations}));
    const open=canonicalActions(active).filter(action=>!terminal(action.status));
    // DISCARD keys use the exact PATCH item_key schema (open keys only), so without an open card the wire shares one $def.
    // B4: an item with an open card gets its own branch whose `choice` enumerates only that card's option ids.
    const patch=existingOperationsWire(canonicalActions(active),true);
    if(open.length)modes.push(branch('PATCH','Responder ou corrigir ações existentes. Só deltas; o backend conserva campos e grafo.',{
      operations:{...patch,minItems:1},
    }),branch('DISCARD','Desistir de ações.',{
      item_keys:{anyOf:[{type:'array',items:existingItemKeyWire(open.map(action=>action.item_key)),minItems:1},{type:'null'}]},
    }));
  }else if(currentWire)modes.push(branch('CURRENT','Delta do adapter isolado, sem plano ativo.',{fields:currentWire}));
  const suspended=context?.suspended_plans??[],suspendedActions=suspended.flatMap(canonicalActions);
  if(suspended.length)modes.push(branch('RESUME','Retomar exclusivamente um plano suspenso publicado.',{
    plan_ref:{type:'string',enum:suspended.map(plan=>plan.plan_ref)},
    patches:suspendedActions.some(action=>!terminal(action.status))?{anyOf:[{type:'object',properties:{operations:{...existingOperationsWire(suspendedActions),minItems:1}},required:['operations'],additionalProperties:false},{type:'null'}]}:{type:'null'},
  }));
  const response=strictSecretaryWire(z.toJSONSchema(nonOperationalResponse) as SecretaryWireSchema);
  modes.push(branch('CONVERSATION','Conversa casual sem intenção operacional.',{response}),
    branch('UNSUPPORTED','Pedido compreendido fora do catálogo; não significa campo faltante, conflito ou entidade não localizada.',{
      unavailable_capability:strictSecretaryWire(z.toJSONSchema(selectionSchemaV2.shape.unavailable_capability.unwrap().unwrap()) as SecretaryWireSchema),response:{anyOf:[response,{type:'null'}]},
    }),branch('AMBIGUOUS',`Ainda não identificou intenção; pedido operacional incompleto usa ${jitInstructionsEnabled()&&!patchPublished?'NEW':'NEW/PATCH'}.`,{response:{anyOf:[response,{type:'null'}]}}));
  return {type:'object',properties:{turn:{anyOf:modes}},required:['turn'],additionalProperties:false};
}

/** C6: the routing rules as named sections, each stated once. The static prompt joins all of them (below); with
 * SALON_SECRETARY_JIT_INSTRUCTIONS the stable prefix keeps the state-free ones and the system input carries each
 * state-bound one only while its mode or context is published (instructions.ts). Removed as duplicates in C6:
 * "appointment.change (remarcar) É SUPORTADO." (the catalog says it) and the short-answer rule (the system tail says it). */
export const routingRules = Object.freeze({
  core: 'Primeiro escolha turn.mode; depois preencha somente o payload desse ramo. NEW inicia novo pedido operacional.',
  add: 'ADD acrescenta ações ao plano ativo.',
  operations: 'operations preserva todas as leituras, escritas e dependências explícitas.',
  patch: 'PATCH é o único formato para responder uma pergunta ou corrigir o plano ativo: operations=[{item_key,fields}], apenas os campos novos/corrigidos. Use as chaves publicadas, inclusive quando a resposta é curta ou se refere a outra ação aberta. Não reclassifique a operação do item; operation pode ser null, derivada pelo backend. Não copie campos aceitos nem altere arestas. Nunca edite DONE, crie chave ou operação em PATCH.',
  resume: 'RESUME usa exclusivamente plan_ref de suspended_plans; patches=null sem correção, ou operations=[{item_key,fields}] do plano escolhido.',
  resumeActive: 'O plano ativo usa PATCH.',
  discard: 'DISCARD desiste de ações do PLANO; null = plano inteiro.',
  pendingDiscard: 'pending_discard aceito = todas as suas chaves.',
  discardVsCancel: 'Cancelar AGENDAMENTO é appointment.cancel. "Não" sozinho na prévia é AMBIGUOUS; correção ("não, às 11h", "deixa pra sexta") é PATCH; desistir e pedir algo novo é NEW.',
  safety: 'Campo ausente, ambiguidade de entidade, horário indisponível ou informação parcial não tornam a capability unsupported: preserve a intenção em NEW/PATCH e deixe validação, fatos, segurança e confirmação ao backend. Nenhum modo executa operações. Casual/unsupported preservam pedidos abertos. Nova intenção usa NEW, sem carregar campos da tarefa anterior. Nunca transforme uma negação em operação afirmativa.',
  choice: 'Escolha entre clarification.candidates vai em choice={option_id,literal} do item; response_fields só refinam. IDs internos não são entrada.',
  identify: 'Para identificar um cliente, nome, telefone ou e-mail informado pelo usuário é target_name (ou customer_name na agenda), nunca alteração dos dados do cadastro.',
});
const r = routingRules;
export const conversationRoutingInstructions = '\n' + [`${r.core} ${r.add} ${r.operations}`, r.patch, `${r.resume} ${r.resumeActive}`,
  `${r.discard} ${r.pendingDiscard} ${r.discardVsCancel}`, r.safety, r.choice, r.identify].join('\n') + '\n';
