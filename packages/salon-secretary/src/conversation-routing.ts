import { AsyncLocalStorage } from "node:async_hooks";
import { type CapabilitySelection, validateDisposition, validateSelection, validateSelectionV2, selectionSchemaV2, selectionTransportSchemaV2, capabilitySelectionWire, strictSecretaryWire, publishedOperation, operationSkill, existingOperationsWire, type SecretaryWireSchema } from "./skill-registry";
import { z } from "zod";
import { decodeTemporalEvidencePayload } from "./scheduling-skill";
import { decodeInventoryQuantityPayload } from "./inventory-skill";

export type ConversationRoutingContext = {
  active_plan?: { plan_ref: string; actions: unknown[] };
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
export class SecretaryNewRequest extends Error {
  readonly selection: CapabilitySelection;
  constructor(input: unknown, readonly mode: "NEW" | "ADD" | "PATCH" = "NEW") {
    super("SECRETARY_NEW_REQUEST");
    this.selection = mode === "PATCH" ? validateExistingPlanPatches(input, routing.getStore()?.active_plan) : mode === "ADD" ? validateAddSelection(input, routing.getStore()?.active_plan) : validateSelectionV2(input);
    if (mode !== "NEW" && !this.selection.operations.length) throw Error("CONVERSATION_ROUTE_CONFLICT");
  }
}
export class SecretaryResumeRequest extends Error {
  readonly patches?: CapabilitySelection;
  constructor(readonly planRef: string, patches?: unknown) {
    super("SECRETARY_RESUME_REQUEST");
    if (!routing.getStore()?.suspended_plans?.some(plan => plan.plan_ref === planRef)) throw Error("PLAN_NOT_IN_SESSION");
    if (patches != null) this.patches = validateExistingPlanPatches(patches, routing.getStore()!.suspended_plans!.find(plan => plan.plan_ref === planRef));
  }
}
/** Existing actions are identified by backend keys, never re-selected by the model. */
const existingActionDeltaSchema=selectionSchemaV2.shape.operations.element.partial().extend({
  item_key:z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),operation:publishedOperation.nullable().optional(),
});
export const existingPlanPatchSchema = selectionSchemaV2.partial().extend({
  operations:z.array(z.union([existingActionDeltaSchema,z.object({
    item_key:existingActionDeltaSchema.shape.item_key,
    fields:existingActionDeltaSchema.omit({item_key:true,depends_on:true,released_slot_of:true}),
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
export function validateAddSelection(input:unknown,plan:RoutingPlan|undefined):CapabilitySelection {
  const operations=(input as {operations?:{item_key?:string|null;operation?:string;depends_on?:string[]|null;released_slot_of?:string|null}[]}).operations??[];
  const own=new Set(operations.map(op=>op.item_key).filter(Boolean));
  const external=operations.some(op=>(op.depends_on??[]).some(key=>!own.has(key))||op.released_slot_of!=null&&!own.has(op.released_slot_of));
  if(!external)return validateSelectionV2(input);
  const [op]=operations,released=op?.released_slot_of;
  const target=canonicalActions(plan).find(action=>action.item_key===released);
  if(operations.length!==1||op.operation!=='appointment.create'||!released||target?.operation!=='appointment.cancel'||
    JSON.stringify(op.depends_on)!==JSON.stringify([released]))throw Error('INVALID_DEPENDENCY_GRAPH');
  const checked=validateSelectionV2({...(input as object),independent:true,operations:[{...op,depends_on:[],released_slot_of:null}]});
  return {...checked,independent:false,operations:[{...checked.operations[0],depends_on:[released],released_slot_of:released}]};
}
export function validateExistingPlanPatches(input:unknown,plan:RoutingPlan|undefined):CapabilitySelection {
  const parsed=existingPlanPatchSchema.parse(input), actions=canonicalActions(plan);
  validateDisposition(parsed);
  const seen=new Set<string>();
  const operations=parsed.operations.map(delta=>{
    const patch='fields' in delta ? {...delta.fields,item_key:delta.item_key} : delta;
    const action=actions.find(action=>action.item_key===patch.item_key);
    if(!action || action.status==='DONE' || seen.has(patch.item_key) || patch.operation!=null && patch.operation!==action.operation || patch.depends_on?.length || patch.released_slot_of!=null) throw Error('CONTINUATION_ACTION_MISMATCH');
    seen.add(patch.item_key);
    // Only transport-neutral values are supplied here. Accepted fields live in the backend draft.
    const operation={target_name:null,name:null,priceCents:null,durationMin:null,phone:null,email:null,requested_fields:[],clear_fields:[],...patch,operation:action.operation,depends_on:[],released_slot_of:null};
    return validateSelection({skills:[operationSkill(action.operation)],independent:true,operations:[operation]}).operations[0];
  });
  const skills=[...new Set(operations.map(op=>operationSkill(op.operation)))];
  if(parsed.skills?.length && JSON.stringify([...new Set(parsed.skills)].sort())!==JSON.stringify([...skills].sort())) throw Error('SKILL_OPERATION_MISMATCH');
  // Dependency edges remain solely in the canonical plan. This envelope only carries field deltas.
  return {...parsed,skills,independent:true,operations};
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
  item_key:existingActionDeltaSchema.shape.item_key,
  fields:existingActionDeltaSchema.omit({item_key:true,depends_on:true,released_slot_of:true}),
}).strict()).min(1)}).strict();
const nonOperationalResponse=z.string().trim().min(1).max(600);
const turnEnvelope=z.object({turn:z.discriminatedUnion('mode',[
  z.object({mode:z.literal('NEW'),operations:selectionTransportSchemaV2.shape.operations.min(1)}).strict(),
  z.object({mode:z.literal('ADD'),operations:selectionTransportSchemaV2.shape.operations.min(1)}).strict(),
  z.object({mode:z.literal('PATCH'),...canonicalPatches.shape}).strict(),
  z.object({mode:z.literal('RESUME'),plan_ref:z.string().uuid(),patches:canonicalPatches.nullable()}).strict(),
  z.object({mode:z.literal('CONVERSATION'),response:nonOperationalResponse}).strict(),
  z.object({mode:z.literal('UNSUPPORTED'),unavailable_capability:selectionSchemaV2.shape.unavailable_capability.unwrap().unwrap(),response:nonOperationalResponse.nullable()}).strict(),
  z.object({mode:z.literal('AMBIGUOUS'),response:nonOperationalResponse.nullable()}).strict(),
  z.object({mode:z.literal('CURRENT'),fields:z.record(z.string(),z.unknown())}).strict(),
])}).strict();

export function decodeConversationTurn(input:unknown, currentSchema?:z.ZodType, message?:string):Record<string,unknown> {
  const {turn}=turnEnvelope.parse(decodeInventoryQuantityPayload(decodeTemporalEvidencePayload(input,true,message),true)),context=conversationRoutingContext();
  const route=(selection:CapabilitySelection,mode:'NEW'|'ADD'|'PATCH'='NEW'):Record<string,unknown>=>
    conversationRoutingEnabled()?{new_request:selection,new_request_mode:mode}:selection;
  switch(turn.mode){
    case 'CURRENT':
      if(!currentSchema||context?.active_plan)throw Error('CONVERSATION_ROUTE_CONFLICT');
      return currentSchema.parse(turn.fields) as Record<string,unknown>;
    case 'NEW':case 'ADD':{
      if(turn.mode==='ADD'&&!context?.active_plan)throw Error('PLAN_NOT_IN_SESSION');
      const operations=turn.operations;
      const request={disposition:'SUPPORTED',conversation_response:null,unavailable_capability:null,
        skills:[...new Set(operations.map(operation=>operationSkill(operation.operation)))],
        independent:!operations.some(operation=>operation.depends_on?.length),operations};
      const selection=turn.mode==='ADD'?validateAddSelection(request,context?.active_plan):validateSelectionV2(request);
      return route(selection,turn.mode);
    }
    case 'PATCH':{
      const selection=validateExistingPlanPatches({operations:turn.operations},context?.active_plan);
      return route(selection,'PATCH');
    }
    case 'RESUME':{
      // Validates the selected plan, keys, operation and DONE state before dispatch.
      const resume=new SecretaryResumeRequest(turn.plan_ref,turn.patches);
      return {resume_request:{plan_ref:resume.planRef,patches:resume.patches??null}};
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
  const branch=(mode:string,description:string,properties:Record<string,SecretaryWireSchema>)=>({
    type:'object',properties:{mode:{type:'string',enum:[mode],description},...properties},
    required:['mode',...Object.keys(properties)],additionalProperties:false,
  } satisfies SecretaryWireSchema);
  const operations={...capabilitySelectionWire(true).properties!.operations,minItems:1};
  const modes:SecretaryWireSchema[]=[branch('NEW','Novo pedido operacional, inclusive incompleto. Remarcar é appointment.change, disponível.',{operations})];
  if(active){
    modes.push(branch('ADD','Acrescentar ações ao pedido ativo, com novas chaves.',{operations}));
    if(canonicalActions(active).some(action=>action.status!=='DONE'))modes.push(branch('PATCH','Responder ou corrigir ações existentes. Só deltas; o backend conserva campos e grafo.',{
      operations:{...existingOperationsWire(canonicalActions(active)),minItems:1},
    }));
  }else if(currentWire)modes.push(branch('CURRENT','Delta do adapter isolado, sem plano ativo.',{fields:currentWire}));
  const suspended=context?.suspended_plans??[],suspendedActions=suspended.flatMap(canonicalActions);
  if(suspended.length)modes.push(branch('RESUME','Retomar exclusivamente um plano suspenso publicado.',{
    plan_ref:{type:'string',enum:suspended.map(plan=>plan.plan_ref)},
    patches:suspendedActions.some(action=>action.status!=='DONE')?{anyOf:[{type:'object',properties:{operations:{...existingOperationsWire(suspendedActions),minItems:1}},required:['operations'],additionalProperties:false},{type:'null'}]}:{type:'null'},
  }));
  const response=strictSecretaryWire(z.toJSONSchema(nonOperationalResponse) as SecretaryWireSchema);
  modes.push(branch('CONVERSATION','Conversa casual sem intenção operacional.',{response}),
    branch('UNSUPPORTED','Pedido compreendido fora do catálogo; não significa campo faltante, conflito ou entidade não localizada.',{
      unavailable_capability:strictSecretaryWire(z.toJSONSchema(selectionSchemaV2.shape.unavailable_capability.unwrap().unwrap()) as SecretaryWireSchema),response:{anyOf:[response,{type:'null'}]},
    }),branch('AMBIGUOUS','Ainda não identificou intenção; pedido operacional incompleto usa NEW/PATCH.',{response:{anyOf:[response,{type:'null'}]}}));
  return {type:'object',properties:{turn:{anyOf:modes}},required:['turn'],additionalProperties:false};
}

export const conversationRoutingInstructions = `
Primeiro escolha turn.mode; depois preencha somente o payload desse ramo.
NEW inicia novo pedido operacional. ADD acrescenta ações ao plano ativo. operations
preserva todas as leituras, escritas e dependências explícitas. Skills e independent
são derivados pelo backend; não os retorne. appointment.change (remarcar) É SUPORTADO.
PATCH é o único formato para responder uma pergunta ou corrigir o plano ativo:
operations=[{item_key,fields}], apenas os campos novos/corrigidos. Use as chaves
publicadas, inclusive quando a resposta é curta ou se refere a outra ação aberta.
Não reclassifique a operação do item; operation pode ser null, derivada pelo backend.
Não copie campos aceitos nem altere arestas. Nunca edite DONE, crie chave ou operação
em PATCH. Quando o schema disponibiliza CURRENT, não existe plano ativo; fields é
o delta do adapter isolado. Não há flat patch fora de turn.
RESUME usa exclusivamente plan_ref de suspended_plans; patches=null sem correção,
ou operations=[{item_key,fields}] do plano escolhido. O plano ativo usa PATCH.
CONVERSATION usa response natural e curta. UNSUPPORTED usa categoria e response
opcional; só para capability fora do catálogo. AMBIGUOUS é intenção não identificada.
Campo ausente, ambiguidade de entidade, horário indisponível ou informação parcial
não tornam a capability unsupported: preserve a intenção em NEW/PATCH e deixe
validação, fatos, segurança e confirmação ao backend. Nenhum modo executa operações.
Casual/unsupported preservam pedidos abertos. Nova intenção usa NEW, sem carregar
campos da tarefa anterior. Nunca transforme uma negação em operação afirmativa.
Use clarification, requested_field e a pergunta exibida para respostas curtas.
Quando clarification trouxer candidates e response_fields, use esses campos do
schema para a escolha/refinamento do usuário. IDs internos não são entrada.
Para identificar um cliente, nome, telefone ou e-mail informado pelo usuário é
target_name (ou customer_name na agenda), nunca alteração dos dados do cadastro.
`;
