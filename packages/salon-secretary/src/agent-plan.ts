import { z } from "zod";

/** C5 agent (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §4). The resolved plan Luna hands
 * over with `propor_plano`, the last of the agent's six strict tools (agent-tools.ts). It never carries an approval, a price, a
 * duration, a status, an override or a database id: refs of THIS message only (p#, s#, c#, a#, f#), absolute times in the salon's
 * timezone and, for every value that was not said in so many words, the owner's own words that justify it (`bases`). The backend
 * checks facts (src/lib/secretary-agent-validator.ts) and reuses the C4 draft/proposal/confirm path; only the owner's authenticated
 * click writes. Nothing imports this module with the flag off. */
export const AGENT_PLAN_TOOL = "propor_plano" as const;
export const AGENT_PLAN_RESULTS = ["PLANO", "PERGUNTA", "CONVERSA", "FORA_DO_ESCOPO"] as const;
/** The published operation ids (skill-registry publishedOperation), so a plan maps onto the C4 action plan directly. */
export const AGENT_PLAN_OPERATIONS = ["appointment.create", "appointment.change", "appointment.cancel", "schedule.block", "appointment.list", "appointment.read", "availability.get"] as const;
export const AGENT_MUTATING_OPERATIONS = ["appointment.create", "appointment.change", "appointment.cancel", "schedule.block"] as const;
/** LISTA: the whole service list of the action; INCLUIR/REMOVER/TROCAR change an existing appointment (TROCAR: the current
 * service that leaves, replaced by the INCLUIR ones). */
export const AGENT_SERVICE_MODES = ["LISTA", "INCLUIR", "REMOVER", "TROCAR"] as const;
/** The value fields of an action, which a base (and a question) may name. */
export const AGENT_BASE_FIELDS = ["atendimento", "cliente", "profissional", "novo_profissional", "servicos", "inicio", "fim", "dia", "motivo"] as const;
export const AGENT_BASE_TYPES = ["DITO", "PRIMEIRA_PESSOA", "DELEGADO", "NAO_DITO", "MANTIDO", "ANCORA", "SEQUENCIA", "ENTRE_ACOES", "LIBERADO_POR", "EXCECAO", "FIM_EXPEDIENTE"] as const;
/** §5 V23: bases whose value the backend derives; their provenance is re-checked before the Confirmar writes. */
export const AGENT_DERIVED_BASE_TYPES = ["ANCORA", "DELEGADO", "EXCECAO", "FIM_EXPEDIENTE", "SEQUENCIA", "ENTRE_ACOES"] as const;
/** §4: a non-null value of these fields always carries its base (a said entity without one is proven by the backend, V4-E). */
export const AGENT_BASE_REQUIRED_FIELDS = ["atendimento", "inicio", "fim", "dia"] as const;
export const AGENT_QUESTION_FIELDS = ["operacao", "atendimento", "cliente", "profissional", "novo_profissional", "servicos", "dia", "inicio", "fim", "motivo"] as const;
export type AgentPlanResult = (typeof AGENT_PLAN_RESULTS)[number];
export type AgentPlanOperation = (typeof AGENT_PLAN_OPERATIONS)[number];
export type AgentServiceMode = (typeof AGENT_SERVICE_MODES)[number];
export type AgentBaseField = (typeof AGENT_BASE_FIELDS)[number];
export type AgentBaseType = (typeof AGENT_BASE_TYPES)[number];
export type AgentQuestionField = (typeof AGENT_QUESTION_FIELDS)[number];
/** Anchored JSON Schema patterns (also compiled by the decoders). Refs are 1..99 per kind and message. */
export const AGENT_PATTERNS = Object.freeze({
  key: "^[a-z][a-z0-9_]{0,31}$", date: "^\\d{4}-\\d{2}-\\d{2}$", clock: "^([01]\\d|2[0-3]):[0-5]\\d$",
  minute: "^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$",
  p: "^p[1-9][0-9]?$", s: "^s[1-9][0-9]?$", c: "^c[1-9][0-9]?$", a: "^a[1-9][0-9]?$", f: "^f[1-9][0-9]?$",
});
export const AGENT_PLAN_LIMITS = Object.freeze({ actions: 4, actionsLeft: 20, reply: 400, actionQuote: 240, quote: 80, baseRef: 40, bases: 8, premises: 2, premise: 120,
  services: 10, dependsOn: 2, reason: 200, recurrence: 120, question: 200 });

/** A JSON Schema node of the agent's wire (plain data; OpenAI strict function schemas). */
export type AgentJsonSchema = { [key: string]: unknown };
export type AgentObjectSchema = { type: "object"; properties: Record<string, AgentJsonSchema>; required: string[]; additionalProperties: false; description?: string };
/** Strict object: every property required (null states absence) and nothing else admitted. */
export const agentObjectWire = (properties: Record<string, AgentJsonSchema>, description?: string): AgentObjectSchema =>
  ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) });
export const agentNullableWire = (schema: AgentJsonSchema): AgentJsonSchema => ({ ...schema, type: [schema.type, "null"] });
export const agentPatternWire = (pattern: string): AgentJsonSchema => ({ type: "string", pattern });
export const agentTextWire = (max: number, min?: number): AgentJsonSchema => ({ type: "string", ...(min === undefined ? {} : { minLength: min }), maxLength: max });
const described = (schema: AgentJsonSchema, description: string): AgentJsonSchema => ({ ...schema, description });
/** Frozen at every level (a published wire never changes after load). */
export const agentDeepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") { for (const child of Object.values(value)) agentDeepFreeze(child); Object.freeze(value); }
  return value;
};
const L = AGENT_PLAN_LIMITS, P = AGENT_PATTERNS;

const baseWire = agentObjectWire({
  campo: { enum: [...AGENT_BASE_FIELDS] },
  tipo: { enum: [...AGENT_BASE_TYPES] },
  ref: described(agentNullableWire(agentTextWire(L.baseRef)), "a# ou f# da âncora ou da exceção; chave da outra ação nos tipos entre ações; senão null."),
  citacao: described(agentTextWire(L.quote, 1), "Cópia curta das palavras do dono que sustentam o valor."),
});
const actionWire = agentObjectWire({
  chave: described(agentPatternWire(P.key), "Identificador curto desta ação dentro do plano."),
  operacao: { enum: [...AGENT_PLAN_OPERATIONS] },
  citacao_acao: described(agentTextWire(L.actionQuote, 2), "Cópia exata do trecho em que o dono pede esta ação."),
  atendimento: described(agentNullableWire(agentPatternWire(P.a)), "Atendimento que a ação altera, cancela ou lê."),
  cliente: agentNullableWire(agentPatternWire(P.c)),
  profissional: agentNullableWire(agentPatternWire(P.p)),
  novo_profissional: described(agentNullableWire(agentPatternWire(P.p)), "Só remarcação que troca quem atende."),
  servicos: described({ type: ["array", "null"], minItems: 1, maxItems: L.services, items: agentObjectWire({ ref: agentPatternWire(P.s), modo: { enum: [...AGENT_SERVICE_MODES] } }) },
    "LISTA dá a lista inteira; INCLUIR, REMOVER e TROCAR mudam um atendimento existente (TROCAR marca o serviço atual que sai)."),
  inicio: described(agentNullableWire(agentPatternWire(P.minute)), "Início com data e hora completas, no horário local do salão."),
  fim: described(agentNullableWire(agentPatternWire(P.minute)), "Só em bloqueio."),
  dia: described(agentNullableWire(agentPatternWire(P.date)), "Dia sem hora: leituras, ou quando a hora ainda falta."),
  motivo: described(agentNullableWire(agentTextWire(L.reason)), "Trecho literal do dono."),
  recorrencia: described(agentNullableWire(agentTextWire(L.recurrence)), "Cópia das palavras de repetição, quando o dono pede repetir."),
  depende_de: described({ type: "array", maxItems: L.dependsOn, items: agentPatternWire(P.key) }, "Chaves das ações deste plano que precisam vir antes."),
  ocupa_horario_de: described(agentNullableWire(agentPatternWire(P.key)), "Chave do cancelamento ou da remarcação cujo horário esta criação ocupa."),
  bases: described({ type: "array", maxItems: L.bases, items: baseWire }, "No máximo uma por campo preenchido."),
  premissas: described({ type: "array", maxItems: L.premises, items: agentTextWire(L.premise) }, "Suposições feitas, em poucas palavras."),
});
const questionWire = agentObjectWire({ acao: agentNullableWire(agentPatternWire(P.key)), campo: { enum: [...AGENT_QUESTION_FIELDS] }, texto: agentTextWire(L.question, 3) });
/** §4 wire of `propor_plano`. `pergunta` is published as anyOf [object, null] (the nullable-object form of the recorded C4 wire);
 * the resolved schema is §4's. `servicos` has minItems 1 (null states absence; an empty list would be a second spelling of it). */
export const AGENT_PLAN_PARAMETERS: AgentObjectSchema = agentDeepFreeze(agentObjectWire({
  resultado: { enum: [...AGENT_PLAN_RESULTS] },
  resposta: described(agentNullableWire(agentTextWire(L.reply)), "Só em CONVERSA, FORA_DO_ESCOPO ou pergunta de operação."),
  acoes: { type: "array", maxItems: L.actions, items: actionWire },
  acoes_fora: described({ type: "integer", minimum: 0, maximum: L.actionsLeft }, "Ações pedidas que não couberam nas quatro."),
  pergunta: described({ anyOf: [questionWire, { type: "null" }] }, "Só em PERGUNTA. Com campo operacao, acao é null."),
}));
export const AGENT_PLAN_DESCRIPTION = "Entrega o plano resolvido. Nada é gravado: o backend confere os fatos e o dono confirma pelo botão. Chame uma única vez, sem consultas na mesma rodada.";

/** A published wire compiled as a validator (like the C4's interpretationParser): used to validate only, never to transform. */
export const compileAgentWire = (schema: AgentJsonSchema): z.ZodType => z.fromJSONSchema(structuredClone(schema) as Parameters<typeof z.fromJSONSchema>[0]);
let planWire: z.ZodType | undefined;
/** Length in code points (JSON Schema minLength/maxLength), not UTF-16 units. */
export const agentText = (min: number, max: number) => z.string().refine(value => { const n = [...value].length; return n >= min && n <= max; }, "LENGTH");
const pattern = (source: string) => z.string().regex(new RegExp(source));
const agentBaseSchema = z.object({ campo: z.enum(AGENT_BASE_FIELDS), tipo: z.enum(AGENT_BASE_TYPES), ref: agentText(0, L.baseRef).nullable(), citacao: agentText(1, L.quote) }).strict();
const agentActionSchema = z.object({
  chave: pattern(P.key), operacao: z.enum(AGENT_PLAN_OPERATIONS), citacao_acao: agentText(2, L.actionQuote),
  atendimento: pattern(P.a).nullable(), cliente: pattern(P.c).nullable(), profissional: pattern(P.p).nullable(), novo_profissional: pattern(P.p).nullable(),
  servicos: z.array(z.object({ ref: pattern(P.s), modo: z.enum(AGENT_SERVICE_MODES) }).strict()).min(1).max(L.services).nullable(),
  inicio: pattern(P.minute).nullable(), fim: pattern(P.minute).nullable(), dia: pattern(P.date).nullable(),
  motivo: agentText(0, L.reason).nullable(), recorrencia: agentText(0, L.recurrence).nullable(),
  depende_de: z.array(pattern(P.key)).max(L.dependsOn), ocupa_horario_de: pattern(P.key).nullable(),
  bases: z.array(agentBaseSchema).max(L.bases), premissas: z.array(agentText(0, L.premise)).max(L.premises),
}).strict();
const agentQuestionSchema = z.object({ acao: pattern(P.key).nullable(), campo: z.enum(AGENT_QUESTION_FIELDS), texto: agentText(3, L.question) }).strict();
/** Structural decoder of the wire (the §4 rules below run after it). */
export const agentPlanShape = z.object({
  resultado: z.enum(AGENT_PLAN_RESULTS), resposta: agentText(0, L.reply).nullable(), acoes: z.array(agentActionSchema).max(L.actions),
  acoes_fora: z.number().int().min(0).max(L.actionsLeft), pergunta: agentQuestionSchema.nullable(),
}).strict();
export type AgentPlan = z.infer<typeof agentPlanShape>;
export type AgentPlanAction = AgentPlan["acoes"][number];
export type AgentPlanBase = AgentPlanAction["bases"][number];
export type AgentPlanQuestion = NonNullable<AgentPlan["pergunta"]>;

/** Rejection of the whole plan (§5 effect REJEITA, §3.8 "plano inválido no esquema"). `reasons` are codes and schema paths only:
 * never a string the model wrote (telemetry takes them as they are). */
export class AgentPlanError extends Error {
  readonly code = "AGENT_SCHEMA";
  constructor(readonly reasons: readonly string[]) { super("AGENT_SCHEMA"); this.name = "AgentPlanError"; }
}
/** The value of a base field in an action (null: absent). */
export const agentFieldValue = (action: AgentPlanAction, field: AgentBaseField) => action[field];
/** The bases of one field of an action. */
export const agentFieldBases = (action: AgentPlanAction, field: AgentBaseField) => action.bases.filter(base => base.campo === field);
const talk = (result: AgentPlanResult) => result === "CONVERSA" || result === "FORA_DO_ESCOPO";
/** §4 decoding rules, as codes (empty: the plan holds them). Structural only: refs, quotes and facts are the validator's (§5). */
export function agentPlanViolations(plan: AgentPlan): string[] {
  const out = new Set<string>(), keys = new Set<string>(), actions = plan.acoes;
  for (const action of actions) { if (keys.has(action.chave)) out.add("KEY_DUPLICATE"); keys.add(action.chave); }
  for (const action of actions) {
    for (const field of AGENT_BASE_FIELDS) {
      const bases = agentFieldBases(action, field), value = agentFieldValue(action, field);
      if (value !== null && bases.length > 1) out.add("BASE_DUPLICATE");
      if (value !== null && !bases.length && (AGENT_BASE_REQUIRED_FIELDS as readonly string[]).includes(field)) out.add("BASE_REQUIRED");
    }
    for (const base of action.bases) if (base.tipo === "NAO_DITO") {
      if (base.campo !== "profissional" && base.campo !== "novo_profissional") out.add("NAO_DITO_FIELD");
      else if (action[base.campo] !== null) out.add("NAO_DITO_VALUE");
    }
    const edges = [...action.depende_de, ...(action.ocupa_horario_de === null ? [] : [action.ocupa_horario_de])];
    if (edges.some(key => key === action.chave || !keys.has(key))) out.add("DEPENDENCY_UNKNOWN");
    if (new Set(action.depende_de).size !== action.depende_de.length) out.add("DEPENDENCY_DUPLICATE");
  }
  const question = plan.pergunta;
  if (plan.resultado === "PLANO" && !actions.length) out.add("PLAN_EMPTY");
  if (plan.resultado === "PERGUNTA" && !question) out.add("QUESTION_REQUIRED");
  if (plan.resultado !== "PERGUNTA" && question) out.add("QUESTION_UNEXPECTED");
  if (plan.resultado === "PERGUNTA" && question) {
    const field = question.campo, target = question.acao;
    if (field === "operacao") { if (actions.length || target !== null) out.add("QUESTION_OPERATION_ACTIONS"); }
    else {
      const asked = actions.find(action => action.chave === target);
      if (!asked) out.add("QUESTION_ACTION");
      else if (asked[field] !== null) out.add("QUESTION_FIELD_FILLED");
      if (plan.resposta !== null) out.add("REPLY_UNEXPECTED");
    }
  }
  if (talk(plan.resultado) && (plan.resposta === null || !plan.resposta.trim())) out.add("REPLY_REQUIRED");
  if (talk(plan.resultado) && actions.length) out.add("TALK_ACTIONS");
  if (plan.resultado === "PLANO" && plan.resposta !== null) out.add("REPLY_UNEXPECTED");
  if (plan.acoes_fora > 0 && actions.length !== L.actions) out.add("ACTIONS_LEFT");
  return [...out];
}
/** Strict decode of a `propor_plano` payload: the typed shape, the published wire itself (both must accept), then the §4
 * rules. Throws AgentPlanError; the value is never transformed (a decoded plan is the model's own, re-checked by the validator). */
export function decodeAgentPlan(raw: unknown): AgentPlan {
  const parsed = agentPlanShape.safeParse(raw);
  if (!parsed.success) throw new AgentPlanError([...new Set(parsed.error.issues.map(issue => `SCHEMA:${issue.code}@${issue.path.map(String).join(".")}`))]);
  if (!(planWire ??= compileAgentWire(AGENT_PLAN_PARAMETERS)).safeParse(raw).success) throw new AgentPlanError(["WIRE"]);
  const violations = agentPlanViolations(parsed.data);
  if (violations.length) throw new AgentPlanError(violations);
  return parsed.data;
}
/** The function-call arguments string of `propor_plano`. */
export function decodeAgentPlanArguments(json: string): AgentPlan {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new AgentPlanError(["JSON"]); }
  return decodeAgentPlan(raw);
}
