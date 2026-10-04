import { inventorySkill,inventoryInterpretation,inventoryQuantityWire } from "./inventory-skill";
import { financialSkill,financialInterpretation } from "./financial-skill";
import { communicationSkill,communicationInterpretation } from "./communication-skill";
import { entityExtractionInstructions } from "./entity-extraction";
import { servicesSkill } from "./services-skill";
import { customersSkill } from "./customers-skill";
import { schedulingSkill,schedulingFields,temporalEvidence,temporalValueRoles,temporalValueWire,type TemporalValueField } from "./scheduling-skill";
import { createHash } from "node:crypto";
import { z } from "zod";
import { dependencyGraph } from "./dependency-graph";
import { temporalComponentsEnabled, temporalComponentsWire } from "./temporal-components";
import { temporalExclusionsWire, temporalPolarityEnabled } from "./temporal-polarity";
import { sameAsTransport, sameAsEnabled, sameAsWire, sameAsTargets, checkReferences, preparationGraph, withoutReleasedReferences, referencesV2Enabled, releasedSlotSources, type SameAsReference, type ReferenceTarget } from "./same-as";
import { alterationFields, alterationKeys, alterAppointmentEnabled, assertAlterationScope, alterationInstruction, ALTERATION_REPLACED_SENTENCE } from "./alter-appointment";
import { multiServiceFields, multiServiceKeys, multiServiceEnabled, multiServiceOperations, assertMultiServiceScope, withoutRedundantServiceList } from "./multi-service";
import { cancelReasonOptionalEnabled, CANCEL_REASON_MANUAL_EDIT } from "./cancel-reason";
export const skillId=z.enum(["services","customers","scheduling","financial","inventory","communication"]);
export type SkillId=z.infer<typeof skillId>;
export const publishedOperation=z.enum(["product.search","stock.balance","stock.movement","financial.report","service.create","service.change","customer.search","customer.read","customer.create","customer.change","appointment.create","appointment.list","appointment.read","availability.get","appointment.change","appointment.cancel","schedule.block","customer.message"]);
export const skillRegistry=Object.freeze([
  Object.freeze({skill_id: "inventory" as const, version: "1.0.0", enabled: true, description: "Consultar produtos, saldo e estoque baixo; preparar entrada/saída de unidades de produtos. Shampoo é produto.", operations: Object.freeze(["product.search", "stock.balance", "stock.movement"]), manual_ref: "inventory-skill.ts#inventorySkill", capabilities: Object.freeze(["U02", "U03", "T24", "T25", "T26", "T30"]), roles: Object.freeze(["OWNER", "MANAGER"]), authorization: "Salão aprovado. Movimentação requer plano INVENTORY, proposta, confirmação e revisão. Sem cadastro de produto."}),
  Object.freeze({skill_id: "financial" as const, version: "1.0.0", enabled: true, description: "Consultar faturamento de serviços concluídos (dashboard), realizado com produtos, recebido registrado, ticket, atendimentos, rankings por receita e saldo a receber. Somente leitura; sem lucro, estornos, taxas ou ranking por quantidade.", operations: Object.freeze(["financial.report"]), manual_ref: "financial-skill.ts#financialSkill", capabilities: Object.freeze(["U02", "T09"]), roles: Object.freeze(["SUPER_ADMIN", "OWNER", "MANAGER"]), authorization: "Membership financeiro real e salão aprovado; agregados mínimos com RLS. Nenhuma escrita financeira."}),
  Object.freeze({skill_id: "scheduling" as const, version: "1.2.0", enabled: true, description: "Consultar agenda e disponibilidade; criar, remarcar ou cancelar agendamentos e bloquear período de profissional.", operations: Object.freeze(["appointment.create", "appointment.list", "appointment.read", "availability.get", "appointment.change", "appointment.cancel", "schedule.block"]), manual_ref: "scheduling-skill.ts#schedulingSkill", capabilities: Object.freeze(["U02", "U03", "T01", "T03", "T04", "T05", "T06", "T07", "T12", "T13", "T14", "T15", "T21"]), roles: Object.freeze(["OWNER", "MANAGER", "RECEPTIONIST"]), authorization: "Tenant aprovado. Remarcação: OWNER/MANAGER/RECEPTIONIST; cancelar/bloquear: OWNER/MANAGER. Confirmação e revisão obrigatórias."}),
  Object.freeze({skill_id: "services" as const, version: "1.0.0", enabled: true, description: "Cadastrar serviços e alterar nome, preço ou duração. Massagem é serviço.", operations: Object.freeze(["service.create", "service.change"]), manual_ref: "services-skill.ts#servicesSkill", capabilities: Object.freeze(["U02", "U03", "T17", "T18"]), roles: Object.freeze(["OWNER", "MANAGER"]), authorization: "Salão aprovado; escrita requer confirmação autenticada e revisão."}),
  Object.freeze({skill_id: "customers" as const, version: "1.0.0", enabled: true, description: "Buscar, consultar, cadastrar e alterar nome/telefone/e-mail de clientes. Amanda Souza é pessoa.", operations: Object.freeze(["customer.search", "customer.read", "customer.create", "customer.change"]), manual_ref: "customers-skill.ts#customersSkill", capabilities: Object.freeze(["U02", "U03", "T01", "T02", "T19"]), roles: Object.freeze(["OWNER", "MANAGER", "RECEPTIONIST"]), authorization: "Salão aprovado; DTO mínimo; confirmação para escrita; foto e credenciais proibidas."}),
  Object.freeze({skill_id:"communication" as const,version:"1.0.0",enabled:true,description:"Preparar mensagem individual EXACT ou GENERATED explícita, WhatsApp exclusivamente fake/local. customer.message pode depender de appointment.cancel; não implica entrega externa.",operations:Object.freeze(["customer.message"]),manual_ref:"communication-skill.ts#communicationSkill",capabilities:Object.freeze(["U02","U03","T01","T10","T11","T20","T21"]),roles:Object.freeze(["OWNER","MANAGER","RECEPTIONIST"]),authorization:"Salão aprovado; contato backend; preview/confirm; cancelamento dependente exige OWNER/MANAGER; provider somente local."})
]);
export function operationSkill(operation:string):SkillId{
  publishedOperation.parse(operation);const entry=skillRegistry.find(s=>s.enabled&&s.operations.includes(operation));
  if(!entry)throw Error("UNPUBLISHED_OPERATION");return entry.skill_id;
}
/** U01: IDs only, no arbitrary files/URLs or external tool loading. */
export function loadSkills(input:unknown){
  const {skill_ids}=z.object({skill_ids:z.array(skillId).min(1).max(8)}).strict().parse(input);
  const manuals=[...new Set(skill_ids)].map(id=>{
    const entry=skillRegistry.find(s=>s.skill_id===id&&s.enabled);if(!entry)throw Error("SKILL_DISABLED");
    const manual=id==="communication"?communicationSkill:id==="inventory"?inventorySkill:id==="financial"?financialSkill:id==="services"?servicesSkill:id==="customers"?customersSkill:schedulingManual();
    return {...entry,manual,manual_hash:createHash("sha256").update(manual).digest("hex")};
  });return {manuals,capabilities:[...new Set(manuals.flatMap(m=>m.capabilities))]};
}
export const discoveryInstructions = `Você é a única Secretária Everflair do salão. Descubra e interprete o pedido em UMA resposta estruturada.
${entityExtractionInstructions}
Catálogo publicado: ${JSON.stringify(skillRegistry.map(({skill_id,description,operations})=>({skill_id,description,operations})))}
Não carregue agentes internos, SQL ou capacidades externas. Se ambíguo/fora do catálogo, retorne operations=[] e skills=[].
Conversa casual, saudação, agradecimento e comentários não operacionais usam disposition=CONVERSATION, operations=[], skills=[] e conversation_response natural, curta. Nunca invente fatos, execução, disponibilidade ou registros. Não use CONVERSATION se houver intenção operacional plausível: preserve a ação e deixe o backend perguntar os faltantes.
Distinga disposition=AMBIGUOUS (não identificou o pedido) de UNSUPPORTED (pedido compreendido mas fora do catálogo).
conversation_response é obrigatória em CONVERSATION e opcional em UNSUPPORTED/AMBIGUOUS, sempre sem operações. Em SUPPORTED ou sem disposition, use null. A explicação de UNSUPPORTED/AMBIGUOUS é apenas informativa: o backend apresenta sua mensagem factual canônica e nunca a trata como recibo.
Em UNSUPPORTED informe unavailable_capability: professional_management, product_management, financial_mutation, salon_hours, external_communication ou other.
Cadastrar profissional ou jornada é professional_management, não customer.create. Em pedido suportado use disposition=SUPPORTED e unavailable_capability=null; campos faltantes serão perguntados pelo backend.
Até quatro operações INDEPENDENTES. Dependentes: somente cancelar uma reserva e criar outra no horário liberado; independent=false, exatamente duas operações Scheduling. Cada item tem item_key local (a/b), depends_on=[] no cancelamento e depends_on=["a"], released_slot_of="a" na criação. Não copie data/hora/serviço/profissional para a criação dependente; horário vem do backend. Também é permitido exclusivamente appointment.cancel -> customer.message: independent=false, item_key local em ambos, depends_on no segundo apontando o cancelamento. Não usar released_slot_of para mensagem. Outros padrões dependentes não são suportados.
Retorne apenas campos explícitos. name significa novo nome; target_name identifica o nome atual para o backend buscar.
Com 2+ operações, source_scope de CADA uma é a cópia exata e contígua da oração que a descreve (negação, ação, pessoa ou profissional, data, horário e motivo dela), sem trecho de outra operação.
Nunca forneça IDs/referências. null omite e preserva; clear_fields somente para remoção explícita de phone/email de cliente.
Reais viram priceCents; uma hora vira durationMin=60. Serviço exige nome/preço/duração, sem inventar duração ou profissional.
Cliente administrativo exige só nome, telefone/e-mail opcionais. Mude e-mail/telefone sem novo valor: requested_fields correspondente.
Selecione todas e somente as Skills das operações interpretadas. Cadastre Amanda Souza e altere massagem para 80: customer.create + service.change.
Não afirme sucesso. Apenas backend autoriza, resolve alvo, valida draft e prepara proposta; só confirmação autenticada escreve.
Agenda: appointment.create/list/read e availability.get. Use customer_name/service_name/professional_name, jamais IDs/preço/duração. Cada seletor temporal usa null ou {value,literal}: amanhã day_offset={value:1,literal:"amanhã"}; terça weekday={value:2,literal:"terça"}; date value YYYY-MM-DD; time value HH:mm. Só UM seletor de data por papel. literal é a expressão atual completa, incluindo qualificadores, sem paráfrase/recorte ou contexto discursivo. source_* é origem, date/day_offset/weekday/time destino, end_* fim. Período sem relógio usa period morning/afternoon/evening, não fabrica data ou hora. Exceção: pending_temporal_ambiguities com clarification.requested_component=daypart permite somente candidato de requested_field, como {value:candidato,literal:período atual}; não repita campos aceitos.
Remarcar é appointment.change: source_date/source_day_offset/source_weekday/source_time localizam ORIGEM; date/day_offset/weekday/time são DESTINO. Em "de amanhã às 10 para 11", origem é amanhã às 10; destino, 11h. Cancelar é appointment.cancel: date/time localizam origem, reason somente um trecho causal literal e contíguo da mensagem atual, sem paráfrase. reason e override_reason devem copiar exatamente o trecho escolhido, sem reescrever, completar ou resumir. Bloquear é schedule.block: professional_name, date/time início, end_time fim; end_date só quando dito. Fechar, travar, trancar ou bloquear a agenda (ou os horários) de um profissional, das X às Y ou o dia todo, também é schedule.block; dia dito depois do intervalo ("das 10 às 11 do dia 28") é o date do bloqueio; sem horário dito, time/end_time null. Não alterar serviço/profissional de um agendamento.
Financial: financial.report usa apenas financial={metrics,period,compare_period,group_by}. metrics: service_revenue (faturamento sem qualificador), realized_revenue (com produtos), received_revenue (recebido), completed_count, average_ticket, outstanding_receivables (saldo atual sem período). period/compare_period: today/yesterday/this_week/last_week/this_month/last_month. group_by professional/service somente para service_revenue, sem comparação. Não calcule valores. Se faltar período deixe null. Lucro líquido, estornos, taxas, filtros por entidade e mais vendido por quantidade não são suportados: retorne operations=[]; não substitua por outra métrica. Compare semanas significa service_revenue, this_week vs last_week.
Inventory: product.search (lista/busca, low_stock=true para acabando), stock.balance (saldo), stock.movement (entrada/saída). Use inventory={product_name,mode,quantity,reason,low_stock,reference}. IN/OUT: quantity=null ou {value:inteiro positivo,literal:medida atual completa com unidade/embalagem ou produto contado e fatores}. Não recorte só o número, calcule saldo/projeção ou converta embalagens. source_scope cita a ação atual completa com conectivo inicial; nunca use trecho de outra ação como referência do produto. reference NAMED/literal=produto completo; CURRENT_FIELD/literal=null responde quantity vinculada pelo contexto. reason cita complemento com conectivo. Nunca recorte variante, negação ou fator. Motivo opcional; backend informa o default. Sem COUNT, compras, cadastro/alteração de produto ou histórico.
Communication: customer.message usa somente communication={recipient_name,channel,message_mode,content}. channel WHATSAPP é fake/local sem rede. Canal ausente: null, nunca inventar. EXACT: texto literal informado entre aspas, sem reescrever. GENERATED só se explicitamente solicitado (redija, escreva, educadamente); sugestão completa revisada antes de confirmação. Nunca telefone/ID. T01 resolve cliente; T10 contexto; T20 proposta; T11 status. T21 somente cancelamento -> mensagem ao mesmo cliente. Nenhum envio pela interpretação.
Fotos, desbloquear, expediente, escrita financeira, cadastro de produtos, compras, WhatsApp real, SMS, e-mail externo, campanhas, voz, consentimento, credenciais e papéis estão fora do catálogo. Fechar ou abrir o salão, o expediente ou o horário de funcionamento (sem um profissional) é salon_hours, fora do catálogo.`;
/** A chained instruction edit must never silently no-op: an absent target would leak the
 * rule it was meant to replace into the published instructions. Fails at module load. */
export function replacedInstruction(text:string,target:string|RegExp,replacement:string){
  if(typeof target==="string"?!text.includes(target):!new RegExp(target.source,target.flags.replace("g","")).test(text))throw Error("INSTRUCTION_REPLACE_TARGET_MISSING");
  return text.replace(target,replacement);
}
/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT): the catalog sentence that forbids changing an appointment's service or
 * professional becomes the alteration rule. Flag off: the text is returned unchanged (byte-identical prompt). */
export const withAlterationRule=(text:string)=>replacedInstruction(text,ALTERATION_REPLACED_SENTENCE,alterationInstruction);
export const alterationInstructions=(text:string)=>alterAppointmentEnabled()?withAlterationRule(text):text;
withAlterationRule(discoveryInstructions);
/** 03/10 (flag SALON_SECRETARY_CANCEL_REASON_OPTIONAL): T14's mandatory reason becomes optional in the scheduling manual
 * (checked replace). Flag off: the manual is returned unchanged (byte-identical prompt and manual hash). */
const optionalReasonManual=replacedInstruction(schedulingSkill,...CANCEL_REASON_MANUAL_EDIT);
export const schedulingManual=()=>cancelReasonOptionalEnabled()?optionalReasonManual:schedulingSkill;
/** P3a (flag SALON_SECRETARY_REFERENCES_V2): the decision prompt's rules for the new links, each a checked replace of the
 * sentence it amends. D1: a change's origin is a released slot too. D3: the service of a released slot is copied only when the
 * owner says "mesmo serviço". E2: the owner's first person as the professional is the pronoun itself (the backend resolves
 * it to the actor's own registration or asks). D4: "herdados" means earlier turns, never a coordinated action. */
export const REFERENCES_V2_EDITS:readonly (readonly [string,string])[]=[
  ['Para criar no horário de um cancelamento use released_slot_of e depends_on apontando o cancelamento;','Para criar no horário de um cancelamento ou da origem de uma remarcação use released_slot_of e depends_on apontando essa ação;'],
  ['Não copie serviço/profissional nem calcule horário do slot liberado.','Não copie serviço (só via same_as service)/profissional nem calcule horário do slot liberado.'],
  ['Use customer_name/service_name/professional_name, jamais IDs/preço/duração.',"Use customer_name/service_name/professional_name, jamais IDs/preço/duração. Profissional em 1ª pessoa ('minha agenda', 'comigo'): professional_name = só o pronome ('minha'); 'me'/'nosso' não."],
  ['Campos herdados ficam null.','Campos de outros turnos ficam null.'],
];
export const withReferencesRule=(text:string)=>REFERENCES_V2_EDITS.reduce((out,[target,replacement])=>replacedInstruction(out,target,replacement),text);
export const referencesInstructions=(text:string)=>referencesV2Enabled()?withReferencesRule(text):text;
export const selectionSchema=z.object({
  disposition:z.enum(["SUPPORTED","AMBIGUOUS","UNSUPPORTED","CONVERSATION"]).nullable().optional(),
  conversation_response:z.string().trim().min(1).max(600).nullable().optional().describe("Obrigatória em CONVERSATION; opcional em UNSUPPORTED/AMBIGUOUS sem operações; null nos demais estados. Não é recibo nem autoridade factual."),
  unavailable_capability:z.enum(["professional_management","product_management","financial_mutation","salon_hours","external_communication","other"]).nullable().optional(),
  skills:z.array(skillId).max(4),independent:z.boolean(),operations:z.array(z.object({
  item_key:z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).nullable().optional(),depends_on:z.array(z.string()).max(2).nullable().optional(),released_slot_of:z.string().nullable().optional(),
  source_scope:z.string().min(1).max(1000).regex(/\S/).nullable().optional(),
  // P2b (flag): the service list precedes service_name (structured decoding follows property order); published only by
  // capabilityOperationWire in the appointment.create/availability.get families, absent otherwise.
  ...Object.fromEntries(Object.entries(schedulingFields).flatMap(([k,v]):[string,z.ZodType][]=>[...(k==="service_name"?Object.entries(multiServiceFields):[]),[k,v]]).map(([k,v])=>[k,v.nullable().optional()])),
  // P2a (flag): published only in the appointment.change wire family (capabilityOperationWire); absent otherwise.
  ...Object.fromEntries(Object.entries(alterationFields).map(([k,v])=>[k,v.nullable().optional()])) as {[K in keyof typeof alterationFields]:z.ZodOptional<z.ZodNullable<(typeof alterationFields)[K]>>},
  ...Object.fromEntries(Object.entries(multiServiceFields).map(([k,v])=>[k,v.nullable().optional()])) as {[K in keyof typeof multiServiceFields]:z.ZodOptional<z.ZodNullable<(typeof multiServiceFields)[K]>>},
  temporal_evidence: temporalEvidence.nullable().optional(),
  communication:communicationInterpretation.nullable().optional(),inventory:inventoryInterpretation.omit({operation:true,source_scope:true}).nullable().optional(),financial:financialInterpretation.nullable().optional(),
  operation:publishedOperation,target_name:z.string().max(200).nullable(),name:z.string().max(200).nullable(),priceCents:z.number().nullable(),durationMin:z.number().nullable(),phone:z.string().max(32).nullable(),email:z.string().max(320).nullable(),
  requested_fields:z.array(z.enum(["name","phone","email"])),clear_fields:z.array(z.enum(["phone","email"])),
}).strict()).max(4)}).strict();
type SelectionInput=z.infer<typeof selectionSchema>;
export function validateDisposition(selection: {disposition?: SelectionInput["disposition"]; unavailable_capability?: SelectionInput["unavailable_capability"]; conversation_response?: string | null; operations: unknown[]}) {
  // Explanatory prose does not select capabilities or authorize operations. The
  // backend only renders model text for CONVERSATION; refusals remain factual.
  const informational = selection.disposition === "CONVERSATION" || selection.disposition === "UNSUPPORTED" || selection.disposition === "AMBIGUOUS";
  if (selection.disposition === "CONVERSATION" && !selection.conversation_response || !informational && selection.conversation_response != null) throw Error("CAPABILITY_DISPOSITION_MISMATCH");
  if (selection.disposition === "SUPPORTED" && !selection.operations.length ||
    selection.disposition && selection.disposition !== "SUPPORTED" && selection.operations.length ||
    selection.unavailable_capability && selection.disposition !== "UNSUPPORTED") throw Error("CAPABILITY_DISPOSITION_MISMATCH");
}
/** B5 partial acceptance: an operation left out of an otherwise accepted turn, and why (a code; the
 * owner's own clause and a subject name only for the reply that asks to repeat it, never telemetry). */
export const rejectedOperation=z.object({item_key:z.string().nullable(),operation:publishedOperation.nullable(),code:z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
  dependent:z.boolean(),source_scope:z.string().max(1000).nullable(),subject:z.string().max(200).nullable()}).strict();
export type RejectedOperation=z.infer<typeof rejectedOperation>;
/** `partial` (B5, turn decoder only): an invalid operation is left out with every operation that depends on
 * it; the turn fails only when none remains. Envelope, graph, skill and route errors stay turn-fatal. */
/** `references` (C5, ADD): the active plan's actions a same_as reference may name besides the envelope's own keys. */
export type ValidationOptions={partial?:boolean;references?:readonly {item_key:string;operation:string;status?:string}[]};
export type CapabilitySelection=Omit<SelectionInput,"operations">&{operations:(Omit<SelectionInput["operations"][number],"depends_on">&{depends_on:string[];same_as?:SameAsReference[]})[];rejected?:RejectedOperation[]};
/** A validated selection re-enters validation (route objects, tool handler): its `rejected` report is
 * carried, never re-derived. It is backend-built; the model's wire never publishes it. */
export function carriedRejections(input:unknown):{rest:unknown;rejected:RejectedOperation[]}{
  if(!input||typeof input!=="object"||Array.isArray(input)||!Object.hasOwn(input,"rejected"))return {rest:input,rejected:[]};
  const {rejected,...rest}=input as Record<string,unknown>;
  return {rest,rejected:z.array(rejectedOperation).max(64).parse(rejected)};
}
export const withRejected=<T extends object>(selection:T,rejected:readonly RejectedOperation[]):T=>rejected.length?{...selection,rejected:[...rejected]}:selection;
/** A stable error code of a rejected operation (never exception text). */
export const rejectionCode=(error:unknown)=>{const message=error instanceof Error?error.message:"";return /^[A-Z][A-Z0-9_]{1,79}$/.test(message)?message:"OPERATION_INVALID";};
/** Reply-only context of a rejected operation: its own clause and the person/professional/product it names. */
export function rejectionContext(raw:unknown):Pick<RejectedOperation,"source_scope"|"subject">{
  const op=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>,nested=(key:string,sub:string)=>(op[key]&&typeof op[key]==="object"?(op[key] as Record<string,unknown>)[sub]:undefined);
  const text=(value:unknown,max:number)=>typeof value==="string"&&value.trim()?value.slice(0,max):null;
  return {source_scope:text(op.source_scope,1000),subject:[op.customer_name,nested("communication","recipient_name"),op.target_name,op.name,op.professional_name,nested("inventory","product_name")].map(value=>text(value,200)).find(Boolean)??null};
}
function withoutNeutralProvenance<T extends {operation:string;temporal_evidence?:unknown[]|null}>(operation:T):T {
  if(operationSkill(operation.operation)==="scheduling"||operation.temporal_evidence?.length)return operation;
  const result={...operation};delete result.temporal_evidence;return result;
}
export function validateSelection(input:unknown){
  const parsed=selectionSchema.parse(input);
  validateDisposition(parsed);
  const selection:CapabilitySelection={...parsed,operations:parsed.operations.map(op=>withoutNeutralProvenance({...withoutRedundantServiceList(op),depends_on:op.depends_on??[]}))};
  const expected=[...new Set(selection.operations.map(op=>operationSkill(op.operation)))].sort();
  if(JSON.stringify([...new Set(selection.skills)].sort())!==JSON.stringify(expected))throw Error("SKILL_OPERATION_MISMATCH");
  const keyed=new Map<string,CapabilitySelection["operations"][number]>();
  for(const op of selection.operations)if(op.item_key!=null){if(keyed.has(op.item_key))throw Error("DEPENDENCY_ERROR");keyed.set(op.item_key,op);}
  if(!selection.independent){
    if(selection.operations.some(op=>op.item_key==null))throw Error("DEPENDENCY_ERROR");
    const visiting=new Set<string>(),visited=new Set<string>();
    const visit=(key:string)=>{
      if(visiting.has(key))throw Error("DEPENDENCY_CYCLE");if(visited.has(key))return;
      const op=keyed.get(key);if(!op||new Set(op.depends_on).size!==op.depends_on.length)throw Error("DEPENDENCY_ERROR");
      if(op.released_slot_of!=null&&!op.depends_on.includes(op.released_slot_of))throw Error("DEPENDENCY_ERROR");
      visiting.add(key);for(const dependency of op.depends_on)visit(dependency);visiting.delete(key);visited.add(key);
    };
    for(const key of keyed.keys())visit(key);
    if(!selection.operations.some(op=>op.depends_on.length))throw Error("UNSUPPORTED_BATCH");
  }
  if(selection.skills.includes("communication")&&selection.skills.includes("scheduling")){
    const a=selection.operations.find(o=>o.operation==="appointment.cancel"),b=selection.operations.find(o=>o.operation==="customer.message");
    if(selection.independent||selection.operations.length!==2||!a||!b||a.depends_on.length||b.depends_on.length!==1||b.depends_on[0]!==a.item_key||a.released_slot_of||b.released_slot_of)throw Error("UNSUPPORTED_COMMUNICATION_DEPENDENCY");
  }
  for(const op of selection.operations){
    if(selection.independent&&(op.depends_on.length||op.released_slot_of!=null))throw Error("DEPENDENCY_ERROR");
    const skill=operationSkill(op.operation),schedulingKeys=Object.keys(schedulingFields).filter(key=>key!=="temporal_evidence");
    // Evidence is provenance, not a domain field. Empty legacy metadata is neutral;
    // nonempty evidence cannot be smuggled into a capability without temporal roles.
    if(skill!=="scheduling"&&op.temporal_evidence?.length)throw Error("CAPABILITY_FIELD_MISMATCH");
    if (op.operation !== "appointment.create" && ["destination_mode","override_requested","override_reason"].some(key=>(op as Record<string,unknown>)[key]!=null)) throw Error("CAPABILITY_FIELD_MISMATCH");
    assertAlterationScope(op);
    assertMultiServiceScope(op);
    if(skill!=="communication"&&op.communication!=null)throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill==="communication"&&([op.name,op.target_name,op.priceCents,op.durationMin,op.phone,op.email].some(x=>x!=null)||op.requested_fields.length||op.clear_fields.length))throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill!=="inventory"&&op.inventory!=null)throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill==="inventory"){
      if([op.name,op.target_name,op.priceCents,op.durationMin,op.phone,op.email].some(x=>x!=null)||op.requested_fields.length||op.clear_fields.length)throw Error("CAPABILITY_FIELD_MISMATCH");
      if(op.operation!=="stock.movement"&&[op.inventory?.mode,op.inventory?.quantity,op.inventory?.quantity_evidence,op.inventory?.reason,op.inventory?.reference].some(x=>x!=null))throw Error("CAPABILITY_FIELD_MISMATCH");
      if(op.operation==="stock.movement"&&op.inventory?.low_stock===true)throw Error("CAPABILITY_FIELD_MISMATCH");
    }
    if(skill!=="financial"&&op.financial!=null)throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill==="financial"&&([op.name,op.target_name,op.priceCents,op.durationMin,op.phone,op.email].some(x=>x!=null)||op.requested_fields.length||op.clear_fields.length))throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill!=="scheduling"&&schedulingKeys.some(k=>(op as Record<string,unknown>)[k]!=null))throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill==="scheduling"&&([op.name,op.target_name,op.priceCents,op.durationMin,op.phone,op.email].some(x=>x!=null)||op.requested_fields.length||op.clear_fields.length))throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill==="services"&&(op.phone!==null||op.email!==null||op.requested_fields.length||op.clear_fields.length))throw Error("CAPABILITY_FIELD_MISMATCH");
    if(skill==="customers"&&(op.priceCents!==null||op.durationMin!==null))throw Error("CAPABILITY_FIELD_MISMATCH");
  }return selection;
}

// Keep the transport intermediate: status, refs, groups and authority are backend-only.
export const selectionSchemaV2 = selectionSchema.extend({
  skills: z.array(skillId),
  operations: z.array(selectionSchema.shape.operations.element.extend({
    depends_on: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)).nullable().optional(), same_as: sameAsTransport.optional(),
  })),
});

/** Only omitted transport-neutral keys are filled. Present values are never coerced or dropped. */
const neutralTransportFields = {
  target_name:selectionSchema.shape.operations.element.shape.target_name.default(null),
  name:selectionSchema.shape.operations.element.shape.name.default(null),
  priceCents:selectionSchema.shape.operations.element.shape.priceCents.default(null),
  durationMin:selectionSchema.shape.operations.element.shape.durationMin.default(null),
  phone:selectionSchema.shape.operations.element.shape.phone.default(null),
  email:selectionSchema.shape.operations.element.shape.email.default(null),
  requested_fields:selectionSchema.shape.operations.element.shape.requested_fields.default([]),
  clear_fields:selectionSchema.shape.operations.element.shape.clear_fields.default([]),
};
export const selectionTransportSchema=selectionSchema.extend({operations:z.array(selectionSchema.shape.operations.element.extend(neutralTransportFields)).max(4)});
export const selectionTransportSchemaV2=selectionSchemaV2.extend({operations:z.array(selectionSchemaV2.shape.operations.element.extend(neutralTransportFields))});

export function validateSelectionV2(input: unknown, options: ValidationOptions = {}): CapabilitySelection {
  const { rest, rejected: carried } = carriedRejections(input);
  if (options.partial) return partialSelectionV2(rest, carried, options.references);
  const parsed = selectionSchemaV2.parse(rest);
  validateDisposition(parsed);
  const explicitKeys = new Set(parsed.operations.flatMap(op => op.item_key ? [op.item_key] : []));
  let nextKey = 1;
  const operations = parsed.operations.map((original, index) => {
    // C5: references are graph metadata, checked below over every key (never a V1 capability field).
    const { same_as: references, ...op } = withoutNeutralProvenance(withoutRedundantServiceList(original));
    void index;
    let generated = `action_${nextKey++}`;
    while (explicitKeys.has(generated)) generated = `action_${nextKey++}`;
    const item_key = op.item_key ?? generated;
    explicitKeys.add(item_key);
    const depends_on = op.depends_on ?? [];
    if (!parsed.independent && !op.item_key) throw Error("INVALID_DEPENDENCY_GRAPH");
    assertMultiServiceScope(op);
    // Reuse every V1 capability/field guard without its composition limits.
    validateSelection({ skills: [operationSkill(op.operation)], independent: true,
      operations: [{ ...op, item_key, depends_on: [], released_slot_of: null }] });
    return { ...op, item_key, depends_on, ...(references?.length ? { same_as: references } : {}) };
  });
  const expected = [...new Set(operations.map(op => operationSkill(op.operation)))].sort();
  if (JSON.stringify([...new Set(parsed.skills)].sort()) !== JSON.stringify(expected)) throw Error("SKILL_OPERATION_MISMATCH");
  dependencyGraph(operations.map(op => ({ key: op.item_key, depends_on: op.depends_on })));
  if (parsed.independent !== !operations.some(op => op.depends_on.length)) throw Error("INVALID_DEPENDENCY_GRAPH");
  const byKey = new Map(operations.map(op => [op.item_key, op])), releasers = releasedSlotSources();
  for (const op of operations) {
    if (op.released_slot_of != null && (op.operation !== "appointment.create" ||
      !op.depends_on.includes(op.released_slot_of) || !releasers.includes(byKey.get(op.released_slot_of)?.operation ?? "")))
      throw Error("INVALID_DEPENDENCY_GRAPH");
  }
  if (operations.some(op => op.same_as)) {
    const targets = referenceTargets(operations.map(op => ({ key: op.item_key, operation: op.operation })), options.references);
    for (const op of operations) checkReferences(op, targets);
    preparationGraph(operations.map(op => ({ key: op.item_key, depends_on: op.depends_on, same_as: withoutReleasedReferences(op).same_as })));
  }
  return withRejected({ ...parsed, operations: operations.map(withoutReleasedReferences) }, carried);
}
/** C5: every key a reference may name: the envelope's own operations, then (ADD) the active plan's actions. */
function referenceTargets(own: readonly { key: string; operation: string }[], external: ValidationOptions["references"]) {
  return new Map<string, ReferenceTarget>([...(external ?? []).map(action => [action.item_key, { operation: action.operation, status: action.status }] as const),
    ...own.map(op => [op.key, { operation: op.operation }] as const)]);
}
const operationShape = selectionSchemaV2.shape.operations.element;
/** Identity and edges only: read from EVERY operation, valid or not, so the graph stays whole. */
const operationSkeleton = z.object({ item_key: operationShape.shape.item_key, operation: publishedOperation,
  depends_on: operationShape.shape.depends_on, released_slot_of: operationShape.shape.released_slot_of, same_as: operationShape.shape.same_as });
/** B5: the strict validation of each operation, isolated. The graph (keys, edges, released slot, independence)
 * and the skills are checked over ALL operations exactly as the strict path does (turn-fatal); an operation
 * failing its own guards is left out together with the transitive closure of its dependents. */
function partialSelectionV2(input: unknown, carried: readonly RejectedOperation[], external?: ValidationOptions["references"]): CapabilitySelection {
  const envelope = selectionSchemaV2.extend({ operations: z.array(z.unknown()) }).parse(input);
  validateDisposition(envelope);
  const shapes = envelope.operations.map(raw => { const found = operationSkeleton.safeParse(raw); if (!found.success) throw found.error; return found.data; });
  const explicitKeys = new Set(shapes.flatMap(op => op.item_key ? [op.item_key] : []));
  let nextKey = 1;
  const keys = shapes.map(op => {
    let generated = `action_${nextKey++}`;
    while (explicitKeys.has(generated)) generated = `action_${nextKey++}`;
    const key = op.item_key ?? generated; explicitKeys.add(key); return key;
  });
  if (!envelope.independent && shapes.some(op => !op.item_key)) throw Error("INVALID_DEPENDENCY_GRAPH");
  const failures = new Map<number, unknown>(), targets = referenceTargets(shapes.map((op, index) => ({ key: keys[index], operation: op.operation })), external);
  const checked = envelope.operations.map((raw, index) => {
    try {
      const { same_as: references, ...op } = withoutNeutralProvenance(withoutRedundantServiceList(operationShape.parse(raw)));
      assertMultiServiceScope(op);
      validateSelection({ skills: [operationSkill(op.operation)], independent: true,
        operations: [{ ...op, item_key: keys[index], depends_on: [], released_slot_of: null }] });
      const valid = { ...op, item_key: keys[index], depends_on: op.depends_on ?? [], ...(references?.length ? { same_as: references } : {}) };
      checkReferences(valid, targets);
      return withoutReleasedReferences(valid);
    } catch (error) { failures.set(index, error); return undefined; }
  });
  const expected = [...new Set(shapes.map(op => operationSkill(op.operation)))].sort();
  if (JSON.stringify([...new Set(envelope.skills)].sort()) !== JSON.stringify(expected)) throw Error("SKILL_OPERATION_MISMATCH");
  const graph = shapes.map((op, index) => ({ key: keys[index], operation: op.operation, depends_on: op.depends_on ?? [], released_slot_of: op.released_slot_of ?? null,
    same_as: withoutReleasedReferences({ released_slot_of: op.released_slot_of ?? null, same_as: op.same_as ?? [] }).same_as ?? [] }));
  dependencyGraph(graph.map(op => ({ key: op.key, depends_on: op.depends_on })));
  // C5: a reference cycle is a graph error of the whole turn, like a dependency cycle.
  if (graph.some(op => op.same_as.length)) preparationGraph(graph);
  if (envelope.independent !== !graph.some(op => op.depends_on.length)) throw Error("INVALID_DEPENDENCY_GRAPH");
  const byKey = new Map(graph.map(op => [op.key, op])), releasers = releasedSlotSources(), v2 = referencesV2Enabled();
  graph.forEach((op, index) => {
    if (op.released_slot_of == null) return;
    const target = byKey.get(op.released_slot_of);
    // An unknown key or a released slot outside depends_on stays a graph error of the whole turn.
    if (!target || !op.depends_on.includes(op.released_slot_of)) throw Error("INVALID_DEPENDENCY_GRAPH");
    if (op.operation === "appointment.create" && releasers.includes(target.operation)) return;
    // D1 (V2): a slot no action of this kind releases fails only this operation (its dependents follow it out).
    if (!v2) throw Error("INVALID_DEPENDENCY_GRAPH");
    if (!failures.has(index)) failures.set(index, Error("RELEASED_SLOT_UNSUPPORTED"));
  });
  // released_slot_of is always inside depends_on: one closure covers both edges. A reference (C5) to a left-out
  // operation can never be satisfied either: its operation waits with it.
  const dropped = new Set([...failures.keys()].map(index => keys[index]));
  for (let grown = dropped.size > 0; grown;) {
    grown = false;
    for (const op of graph) if (!dropped.has(op.key) && (op.depends_on.some(key => dropped.has(key)) || op.same_as.some(ref => dropped.has(ref.item_key)))) { dropped.add(op.key); grown = true; }
  }
  const operations = checked.filter((op, index) => !dropped.has(keys[index])) as CapabilitySelection["operations"];
  if (!dropped.size) return withRejected({ ...envelope, operations }, carried);
  if (!operations.length) throw failures.get(Math.min(...failures.keys()));
  const rejected: RejectedOperation[] = graph.flatMap((op, index) => dropped.has(op.key) ? [{ item_key: op.key, operation: op.operation,
    code: failures.has(index) ? rejectionCode(failures.get(index)) : "DEPENDENT_OF_REJECTED", dependent: !failures.has(index), ...rejectionContext(envelope.operations[index]) }] : []);
  return { ...envelope, skills: [...new Set(operations.map(op => operationSkill(op.operation)))], independent: !operations.some(op => op.depends_on.length),
    operations, rejected: [...carried, ...rejected] };
}

export const discoveryInstructionsV2 = replacedInstruction(discoveryInstructions,
  /Até quatro operações INDEPENDENTES\.[^\n]+/,
  `Retorne todas as operações explícitas em operations[]. Não há limite de quatro ou dez ações no contrato.
Cada operação tem item_key local único; depends_on lista as chaves das ações que devem ocorrer antes dela.
independent=true somente sem arestas. São permitidas cadeias, ramificações e componentes independentes no mesmo pedido; nunca ciclos ou referências inexistentes.
Para criar no horário de um cancelamento use released_slot_of e depends_on apontando o cancelamento; preserve o serviço explicitamente informado (ex.: Corte Completo). Não copie serviço/profissional nem calcule horário do slot liberado. "No lugar", "na vaga" ou "no horário dele" é o mesmo horário liberado: destination_mode=SAME_RELEASED_SLOT. Se o cancelamento está no plano ativo, use ADD com released_slot_of e depends_on na chave publicada dele.
T21 V2: se o usuário explicitamente escolher outro destino, mantenha released_slot_of e depends_on e use destination_mode=ALTERNATIVE_SLOT; data/hora somente se ditas. Pedido explícito de encaixe usa override_requested=true; override_reason é apenas o motivo real fornecido. 'Pode encaixar' e 'sim' não são motivos. O backend valida causa, permissão, motivo e disponibilidade; não execute nem autorize a operação.
O backend decide grupos de revisão, faltantes, conflitos e confirmação. Ausência de campo não elimina ação. Nenhuma ação foi executada.`
);

/** The wire publishes the same capability restrictions as validateSelection.
 * Incompatible fields are absent on the wire; transport fills neutral internal keys. */
export type SecretaryWireSchema = {
  type?: string | string[]; properties?: Record<string, SecretaryWireSchema>;
  items?: SecretaryWireSchema; anyOf?: SecretaryWireSchema[]; required?: string[];
  additionalProperties?: boolean; enum?: unknown[]; $ref?: string;
  $defs?: Record<string, SecretaryWireSchema>; [key: string]: unknown;
};
/** Components mode: relative-day and weekday selectors are what components state, so they are not
 * published beside them (the 64k request budget). date/time selectors stay: they answer a published
 * DATE_CHOICE/calendar or half-day candidate. The decoder still reads every selector. */
const componentOnlySelectors = new Set(['day_offset','weekday','source_day_offset','source_weekday']);
export function strictSecretaryWire(schema: SecretaryWireSchema): SecretaryWireSchema {
  const result = { ...schema }; delete result.$schema;
  if (schema.properties) {
    const temporal=Object.hasOwn(schema.properties,'temporal_evidence');
    const inventory=Object.hasOwn(schema.properties,'quantity_evidence');
    result.properties = Object.fromEntries(Object.entries(schema.properties).filter(([key])=>!['temporal_evidence','quantity_evidence'].includes(key)&&
      !(temporal&&temporalComponentsEnabled()&&componentOnlySelectors.has(key))).flatMap(([key,value]):[string,SecretaryWireSchema][] => [
      // Components mode (flag): the typed container precedes the discouraged legacy selectors.
      ...(temporal && key==='date' && temporalComponentsEnabled() ? [['components', componentsWire()] as [string,SecretaryWireSchema]] : []),
      [key,strictSecretaryWire(
      temporal && Object.hasOwn(temporalValueRoles,key) ? legacySelectorWire(key as TemporalValueField) :
        inventory&&key==='quantity'?z.toJSONSchema(inventoryQuantityWire) as SecretaryWireSchema:
        // C5: the reference list (published only by capabilityOperationWire, with the flag) shares the published literal.
        key==='same_as'?sameAsWire(publishedLiteral()) as SecretaryWireSchema:value
    )],
      // C4 polarity (flag): the excluded values follow every affirmed temporal selector.
      ...(temporal && key==='end_date' && temporalPolarityEnabled() ? [['excluded', exclusionsWire()] as [string,SecretaryWireSchema]] : [])]));
    result.required = Object.keys(result.properties); result.additionalProperties = false;
  }
  if (schema.items) result.items = strictSecretaryWire(schema.items);
  if (schema.anyOf) result.anyOf = schema.anyOf.map(strictSecretaryWire);
  return result;
}
/** In components mode the legacy selectors stay valid but discouraged: their weekday prose
 * (numbering already stated by the component instructions) is not repeated on the wire. */
function legacySelectorWire(field: TemporalValueField): SecretaryWireSchema {
  const wire = z.toJSONSchema(temporalValueWire(field)) as SecretaryWireSchema;
  if (temporalComponentsEnabled()) for (const branch of wire.anyOf ?? []) delete (branch.properties?.value as SecretaryWireSchema | undefined)?.description;
  return wire;
}
/** The component pairs reuse the exact published literal schema of the legacy pairs. */
function publishedLiteral() {
  return strictSecretaryWire(z.toJSONSchema(temporalValueWire('time')) as SecretaryWireSchema).anyOf!.find(value => value.properties)!.properties!.literal as Record<string, unknown>;
}
function componentsWire(): SecretaryWireSchema {
  return temporalComponentsWire(publishedLiteral()) as SecretaryWireSchema;
}
/** C4: the exclusions share the published literal and, in components mode, the component value schemas. */
function exclusionsWire(): SecretaryWireSchema {
  return temporalExclusionsWire(publishedLiteral(), temporalComponentsEnabled()) as SecretaryWireSchema;
}
const operationMeaning = {
  "service.create": "novo serviço",
  "service.change": "alterar serviço",
  "customer.search": "buscar cliente",
  "customer.read": "consultar cliente",
  "customer.create": "novo cliente",
  "customer.change": "alterar cliente",
  "appointment.create": "NOVO atendimento",
  "appointment.list": "listar agenda",
  "appointment.read": "detalhar atendimento existente",
  "availability.get": "horários livres",
  "appointment.change": "remarcar existente",
  "appointment.cancel": "cancelar existente",
  "schedule.block": "bloquear agenda",
  "product.search": "buscar produto",
  "stock.balance": "saldo de estoque",
  "stock.movement": "entrada/saída de estoque",
  "financial.report": "valores financeiros",
  "customer.message": "preparar mensagem"
} satisfies Record<z.infer<typeof publishedOperation>,string>;
function capabilityOperationWire(v2: boolean, operations: readonly string[], patch = false): SecretaryWireSchema {
  const schema = strictSecretaryWire(z.toJSONSchema((v2 ? selectionSchemaV2 : selectionSchema).shape.operations.element) as SecretaryWireSchema);
  const properties = schema.properties!;
  const operation = operations[0], skill = operationSkill(operation);
  const allow = new Set(['item_key','operation','depends_on','released_slot_of','source_scope']);
  if (skill === 'scheduling') for (const key of [...Object.keys(schedulingFields), 'components', 'excluded']) allow.add(key);
  if (operation !== 'appointment.create') for (const key of ['destination_mode','override_requested','override_reason']) allow.delete(key);
  // P2a (flag): the new professional and the service delta, only in the family that holds appointment.change.
  if (alterAppointmentEnabled() && operations.includes('appointment.change')) for (const key of alterationKeys) allow.add(key);
  // P2b (flag): the service list, only in the families that hold appointment.create or availability.get.
  if (multiServiceEnabled() && operations.some(id => (multiServiceOperations as readonly string[]).includes(id))) for (const key of multiServiceKeys) allow.add(key);
  if (skill === 'services') for (const key of ['target_name','name','priceCents','durationMin']) allow.add(key);
  if (skill === 'customers') for (const key of ['target_name','name','phone','email','requested_fields','clear_fields']) allow.add(key);
  if (['inventory','financial','communication'].includes(skill)) allow.add(skill);
  // C5 (flag): new operations (NEW/ADD, never a PATCH delta) that may follow another action's value.
  if (v2 && !patch && sameAsEnabled() && operations.some(id => Object.values(sameAsTargets).some(targets => targets.includes(id)))) allow.add('same_as');
  for (const key of Object.keys(properties)) if (!allow.has(key)) delete properties[key];
  properties.operation = { ...(patch ? {anyOf:[{type:'string',enum:[...operations]},{type:'null'}]} : {type:'string',enum:[...operations]}),
    description: operations.map(id=>`${id.split('.')[1]}=${operationMeaning[id as keyof typeof operationMeaning]}`).join('; ') }; 
  if (skill === 'inventory') {
    const inventory = properties.inventory.anyOf!.find(value => value.properties)!.properties!;
    if (operation !== 'stock.movement') for (const key of ['mode','quantity','reason','reference']) inventory[key] = {type:'null'};
    else inventory.low_stock = {anyOf:[{type:'boolean',enum:[false]},{type:'null'}]};
  }
  if (patch) { delete properties.depends_on; delete properties.released_slot_of; }
  // Structured decoding follows property order: choose the operation before
  // committing to a capability-specific field shape. Provenance follows its values.
  const keys = ["operation", "item_key", "depends_on", "released_slot_of", "same_as",
    ...Object.keys(properties).filter(key=>!["operation","item_key","depends_on","released_slot_of","same_as","temporal_evidence"].includes(key)), "temporal_evidence"]
    .filter(key=>key in properties);
  schema.properties = Object.fromEntries(keys.map(key=>[key,properties[key]]));
  schema.required = keys;
  return schema;
}
const wireOperationGroups = [
  ['service.create','service.change'], ['customer.search','customer.read','customer.create','customer.change'],
  ['appointment.create'], ['appointment.list','appointment.read','availability.get','appointment.change','appointment.cancel','schedule.block'],
  ['product.search','stock.balance'], ['stock.movement'], ['financial.report'], ['customer.message'],
] as const;
export function capabilitySelectionWire(v2: boolean): SecretaryWireSchema {
  const schema = strictSecretaryWire(z.toJSONSchema(v2 ? selectionSchemaV2 : selectionSchema) as SecretaryWireSchema);
  schema.properties!.operations.items = {anyOf:wireOperationGroups.map(operations => capabilityOperationWire(v2,operations))};
  return schema;
}
/** The published item_key schema of existing (open) actions; PATCH and DISCARD share it. */
export const existingItemKeyWire=(keys:readonly string[]):SecretaryWireSchema=>({type:'string',enum:[...new Set(keys)],pattern:'^[a-z][a-z0-9_]{0,31}$'});
/** B4: option ids an action's open card publishes in the routing context (clarification.candidates), in order. */
export function publishedOptionIds(action:unknown):string[]{
  const candidates=(action as {clarification?:{candidates?:unknown}}|undefined)?.clarification?.candidates;
  return Array.isArray(candidates)?candidates.flatMap(item=>{const id=(item as {option_id?:unknown}|null)?.option_id;return typeof id==='string'&&/^opt_[1-9]\d?$/.test(id)?[id]:[];}):[];
}
const choiceLiteral=():SecretaryWireSchema=>strictSecretaryWire(z.toJSONSchema(z.string().min(1).max(600).regex(/\S/)) as SecretaryWireSchema);
/** `choices`: only the ACTIVE plan's PATCH publishes option choices. Without any open card the
 * items schema is exactly the historical one (no bytes added); an item with a card gets its own
 * branch whose `choice` enumerates only that card's ids (a key appears in exactly one branch). */
export function existingOperationsWire(actions: readonly {item_key:string;operation:string;status:string;clarification?:unknown}[],choices=false): SecretaryWireSchema {
  const open=actions.filter(action=>action.status!=='DONE'&&action.status!=='DISCARDED');
  const operations=new Set(open.map(action=>publishedOperation.parse(action.operation)));
  if(!open.length) return {type:'array',items:{type:'null'},maxItems:0};
  const fields={anyOf:wireOperationGroups.flatMap(group=>{
    const selected=group.filter(operation=>operations.has(operation));if(!selected.length)return [];
    const schema=capabilityOperationWire(true,selected,true);
    delete schema.properties!.item_key;schema.required=Object.keys(schema.properties!);
    return [schema];
  })};
  // Key-to-operation binding is checked against the chosen canonical plan. Separating
  // immutable identity from the field delta allows all retained plans to share $defs.
  const item=(keys:readonly string[]):SecretaryWireSchema=>({type:'object',properties:{item_key:existingItemKeyWire(keys),fields},required:['item_key','fields'],additionalProperties:false});
  const carded=choices?[...new Set(open.map(action=>action.item_key))].flatMap(key=>{const ids=publishedOptionIds(open.find(action=>action.item_key===key));return ids.length?[[key,ids] as const]:[];}):[];
  if(!carded.length)return {type:'array',items:item(open.map(action=>action.item_key))};
  const plain=open.map(action=>action.item_key).filter(key=>!carded.some(([card])=>card===key));
  // Structured decoding follows property order: the choice precedes any other delta of the item.
  return {type:'array',items:{anyOf:[...(plain.length?[item(plain)]:[]),...carded.map(([key,ids]):SecretaryWireSchema=>({type:'object',properties:{
    item_key:existingItemKeyWire([key]),
    choice:{anyOf:[{type:'object',properties:{option_id:{type:'string',enum:[...ids]},literal:choiceLiteral()},required:['option_id','literal'],additionalProperties:false},{type:'null'}],
      description:'Opção de clarification.candidates escolhida; literal copia o trecho da mensagem que a indica. null sem escolha.'},
    fields,
  },required:['item_key','choice','fields'],additionalProperties:false}))]}};
}
/** Deduplicate schemas, not data. OpenAI strict function schemas support $defs/$ref.
 * Keep the root an object; definitions are local and never load URLs or code.
 * `emittedCopies` (C4, the polarity contract only): a subtree's copies are counted as they will be
 * emitted: the children of a repeated subtree once (the other copies are the same definition or the
 * same inline bytes), so a subtree used only inside one definition stays inline instead of becoming
 * a single-use $ref. The resolved schema is identical; the historical count keeps its bytes. */
export function compactSecretaryWire(root: SecretaryWireSchema, emittedCopies = false): SecretaryWireSchema {
  const definitions: Record<string,SecretaryWireSchema> = {}, known = new Map<string,string>();
  const occurrences=new Map<string,number>(), emitted=new Map<string,SecretaryWireSchema>();
  const count=(schema:SecretaryWireSchema)=>{
    const key=JSON.stringify(schema),seen=occurrences.get(key)??0;occurrences.set(key,seen+1);
    if(emittedCopies&&seen)return;
    if(schema.properties)for(const value of Object.values(schema.properties))count(value);
    if(schema.items)count(schema.items);if(schema.anyOf)for(const value of schema.anyOf)count(value);
  };
  count(root);
  const visit = (schema:SecretaryWireSchema, isRoot = false):SecretaryWireSchema => {
    const original=JSON.stringify(schema), cached=emitted.get(original);
    if(!isRoot&&cached)return cached;
    const result = {...schema};
    if(schema.properties) result.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,visit(value)]));
    if(schema.items) result.items=visit(schema.items);
    if(schema.anyOf) result.anyOf=schema.anyOf.map(value=>visit(value));
    const serialized=JSON.stringify(result);
    const copies=occurrences.get(original)??1;
    const referenceBytes=JSON.stringify({$ref:'#/$defs/s'+known.size}).length;
    if(isRoot || serialized.length*(copies-1) <= referenceBytes*copies+12){
      if(!isRoot)emitted.set(original,result);return result;
    }
    let name=known.get(serialized);
    if(!name){name='s'+known.size;known.set(serialized,name);definitions[name]=result;}
    const reference={$ref:'#/$defs/'+name};
    // The same original subtree must always receive the same representation.
    // Otherwise growing reference names change the savings threshold and duplicate
    // whole parent catalogs across NEW/ADD or active/suspended patch branches.
    emitted.set(original,reference);return reference;
  };
  const result=visit(root,true);
  return {...result,...(Object.keys(definitions).length?{$defs:definitions}:{})};
}


const temporalCatalogClause='Cada seletor temporal usa null ou {value,literal}: amanhã day_offset={value:1,literal:"amanhã"}; terça weekday={value:2,literal:"terça"}; date value YYYY-MM-DD; time value HH:mm. Só UM seletor de data por papel. literal é a expressão atual completa, incluindo qualificadores, sem paráfrase/recorte ou contexto discursivo. source_* é origem, date/day_offset/weekday/time destino, end_* fim. Período sem relógio usa period morning/afternoon/evening, não fabrica data ou hora. Exceção: pending_temporal_ambiguities com clarification.requested_component=daypart permite somente candidato de requested_field, como {value:candidato,literal:período atual}; não repita campos aceitos.';
/** The catalog's own temporal clause in decision mode (the value formats only); components mode removes it. */
export const decisionTemporalClause='Seletores temporais: amanhã day_offset={value:1,literal:"amanhã"}; date value YYYY-MM-DD; time value HH:mm.';
/** Same capability catalog for the decision-first transport, without obsolete
 * envelope metadata competing with the single mode discriminator. */
export const turnDiscoveryInstructions=([
  ['Se ambíguo/fora do catálogo, retorne operations=[] e skills=[].','Se ambíguo/fora do catálogo, use o modo sem operação correspondente.'],
  ['usam disposition=CONVERSATION, operations=[], skills=[] e conversation_response natural, curta.','usam turn.mode=CONVERSATION e response natural, curta.'],
  ['Distinga disposition=AMBIGUOUS','Distinga turn.mode=AMBIGUOUS'],
  ['conversation_response é obrigatória em CONVERSATION e opcional em UNSUPPORTED/AMBIGUOUS, sempre sem operações. Em SUPPORTED ou sem disposition, use null.','response é obrigatória em CONVERSATION e opcional em UNSUPPORTED/AMBIGUOUS; esses modos não possuem operações.'],
  ['Em pedido suportado use disposition=SUPPORTED e unavailable_capability=null; campos faltantes serão perguntados pelo backend.','Pedido suportado, inclusive incompleto, usa NEW/PATCH; campos faltantes serão perguntados pelo backend.'],
  ['independent=true somente sem arestas.','O backend deriva a independência pelas arestas explícitas.'],
  ['Selecione todas e somente as Skills das operações interpretadas.','O backend deriva todas e somente as Skills das operações interpretadas.'],
  ['retorne operations=[]; não substitua por outra métrica.','use turn.mode=UNSUPPORTED; não substitua por outra métrica.'],
  // C6 lint: the decision prompt always carries temporalEvidenceInstructions, which states each of these rules once
  // (one selector per role, roles, complete literal, period without clock, the daypart exception, the weekday example).
  [temporalCatalogClause,decisionTemporalClause],
  ['Remarcar é appointment.change: source_date/source_day_offset/source_weekday/source_time localizam ORIGEM; date/day_offset/weekday/time são DESTINO. Em "de amanhã às 10 para 11"','Remarcar é appointment.change: em "de amanhã às 10 para 11"'],
] as const).reduce((text,[target,replacement])=>replacedInstruction(text,target,replacement),discoveryInstructionsV2)
  + '\ncustomer.read/customer.search: requested_fields seleciona nome/telefone/e-mail para consulta; valores name/phone/email e clear_fields ficam vazios. Em customer.create/change requested_fields indica novos valores ainda faltantes. O catálogo é fechado e inclui appointment.change para remarcação; não confunda falta de dados com operação não suportada.';
