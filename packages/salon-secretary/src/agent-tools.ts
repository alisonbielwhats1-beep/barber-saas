import { createHash } from "node:crypto";
import { z } from "zod";
import { AGENT_PATTERNS, AGENT_PLAN_DESCRIPTION, AGENT_PLAN_PARAMETERS, AGENT_PLAN_TOOL, agentNullableWire, agentObjectWire, agentPatternWire, agentText, agentTextWire,
  agentDeepFreeze, compileAgentWire, type AgentObjectSchema } from "./agent-plan";

/** C5 agent (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §2): five read-only lookups plus
 * `propor_plano`, all strict (every property required, optionals nullable, additionalProperties false). Professionals and
 * services enter as directory refs (p#/s#) already published in this message; only a customer is searched by the name the owner
 * wrote. The same six tools, in this order, go in every round (only tool_choice changes), so the cached prefix is stable; the
 * cost guard pins them by AGENT_TOOLS_SHA256. Descriptions say only when to use a tool and what it returns. */
export const AGENT_LOOKUP_NAMES = ["consultar_agenda", "buscar_cliente", "horarios_livres", "catalogo_servicos", "jornada_profissional"] as const;
export type AgentLookupName = (typeof AGENT_LOOKUP_NAMES)[number];
export const AGENT_TOOL_NAMES = [...AGENT_LOOKUP_NAMES, AGENT_PLAN_TOOL] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
/** The SDK's SerializedFunctionTool / the Responses function tool (same keys). */
export type AgentFunctionTool = { type: "function"; name: AgentToolName; description: string; parameters: AgentObjectSchema; strict: true };
export const AGENT_LOOKUP_LIMITS = Object.freeze({ customerName: [2, 80] as const, freeServices: 5, catalogServices: 6 });

const P = AGENT_PATTERNS, date = agentPatternWire(P.date), clock = agentPatternWire(P.clock), professional = agentPatternWire(P.p), service = agentPatternWire(P.s);
const lookup = (name: AgentLookupName, description: string, properties: Record<string, Record<string, unknown>>): AgentFunctionTool =>
  ({ type: "function", name, description, parameters: agentObjectWire(properties), strict: true });
const TOOLS: readonly AgentFunctionTool[] = agentDeepFreeze<AgentFunctionTool[]>([
  lookup("consultar_agenda", "Lê a agenda de uma data, separada por profissional: jornada, pausas, atendimentos (a#) e trechos livres (f#). Serve quando a decisão depende de quem já está marcado. de e ate recortam o horário.",
    { data: date, profissional: agentNullableWire(professional), de: agentNullableWire(clock), ate: agentNullableWire(clock) }),
  lookup("buscar_cliente", "Procura clientes pelo nome como o dono escreveu e traz os próximos atendimentos (a#) de cada cadastro encontrado.",
    { nome: agentTextWire(AGENT_LOOKUP_LIMITS.customerName[1], AGENT_LOOKUP_LIMITS.customerName[0]), a_partir_de: agentNullableWire(date) }),
  lookup("horarios_livres", "Horários de início livres numa data para fazer todos os serviços juntos, por profissional apto, com quantos atendimentos cada um já tem nesse dia.",
    { data: date, servicos: { type: "array", minItems: 1, maxItems: AGENT_LOOKUP_LIMITS.freeServices, items: service }, profissional: agentNullableWire(professional),
      de: agentNullableWire(clock), ate: agentNullableWire(clock) }),
  lookup("catalogo_servicos", "Duração, preço, partes de combo e profissionais que fazem cada serviço.",
    { servicos: { type: "array", minItems: 1, maxItems: AGENT_LOOKUP_LIMITS.catalogServices, items: service } }),
  lookup("jornada_profissional", "Expediente e pausas de um profissional numa data e se o salão fecha; sem data, o próximo dia de trabalho dele.",
    { profissional: professional, data: agentNullableWire(date) }),
  { type: "function", name: AGENT_PLAN_TOOL, description: AGENT_PLAN_DESCRIPTION, parameters: AGENT_PLAN_PARAMETERS, strict: true },
]);
/** A fresh copy of the six tools, in order (the SDK and callers may keep or mutate what they receive; the pinned list never changes). */
export const agentTools = (): AgentFunctionTool[] => structuredClone(TOOLS) as AgentFunctionTool[];
/** Canonical JSON: keys sorted at every level, undefined dropped, array order kept. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => [key, canonical((value as Record<string, unknown>)[key])]))
  : value;
/** Digest of a tool list as sent (SDK SerializedTool[] or the HTTP body's `tools`): every key counts, key order does not. */
export const agentToolsDigest = (tools: readonly unknown[]) => createHash("sha256").update(JSON.stringify(canonical(tools))).digest("hex");
export const AGENT_TOOLS_SHA256 = agentToolsDigest(TOOLS);
/** Serialized bytes of the six tools (the static part of every agent request, with the instructions). */
export const agentToolsBytes = () => Buffer.byteLength(JSON.stringify(TOOLS), "utf8");

const zDate = z.string().regex(new RegExp(P.date)), zClock = z.string().regex(new RegExp(P.clock)), zProfessional = z.string().regex(new RegExp(P.p)), zService = z.string().regex(new RegExp(P.s));
/** Decoders of the lookup arguments (the same constraints as the wire). */
export const agentLookupInputs = {
  consultar_agenda: z.object({ data: zDate, profissional: zProfessional.nullable(), de: zClock.nullable(), ate: zClock.nullable() }).strict(),
  buscar_cliente: z.object({ nome: agentText(...AGENT_LOOKUP_LIMITS.customerName), a_partir_de: zDate.nullable() }).strict(),
  horarios_livres: z.object({ data: zDate, servicos: z.array(zService).min(1).max(AGENT_LOOKUP_LIMITS.freeServices), profissional: zProfessional.nullable(),
    de: zClock.nullable(), ate: zClock.nullable() }).strict(),
  catalogo_servicos: z.object({ servicos: z.array(zService).min(1).max(AGENT_LOOKUP_LIMITS.catalogServices) }).strict(),
  jornada_profissional: z.object({ profissional: zProfessional, data: zDate.nullable() }).strict(),
} as const;
export type AgentLookupInput<K extends AgentLookupName = AgentLookupName> = z.infer<(typeof agentLookupInputs)[K]>;
/** One decoded lookup of a round. `callId` pairs its function_call_output. */
export type AgentLookupCall = { [K in AgentLookupName]: { readonly name: K; readonly callId: string; readonly input: AgentLookupInput<K> } }[AgentLookupName];
export const isAgentLookupName = (name: string): name is AgentLookupName => (AGENT_LOOKUP_NAMES as readonly string[]).includes(name);
const lookupWires = new Map<AgentLookupName, z.ZodType>();
/** A function_call of a lookup round → the typed call. An unknown name (propor_plano included), unreadable JSON or arguments
 * outside the strict schema are a protocol failure of the round (§3.2 AGENT_PROTOCOL): nothing of it is executed. Calendar
 * validity and limits are the executor's (DATA_INVALIDA, FORA_DO_LIMITE), answered to the model as data. */
export function decodeAgentLookupCall(call: { readonly name: string; readonly callId: string; readonly arguments: string }): AgentLookupCall {
  if (!isAgentLookupName(call.name) || typeof call.callId !== "string" || !call.callId) throw Error("AGENT_PROTOCOL");
  let raw: unknown;
  try { raw = JSON.parse(call.arguments); } catch { throw Error("AGENT_PROTOCOL"); }
  const parsed = (agentLookupInputs[call.name] as z.ZodType).safeParse(raw);
  const wire = lookupWires.get(call.name) ?? lookupWires.set(call.name, compileAgentWire(TOOLS.find(tool => tool.name === call.name)!.parameters)).get(call.name)!;
  if (!parsed.success || !wire.safeParse(raw).success) throw Error("AGENT_PROTOCOL");
  return { name: call.name, callId: call.callId, input: parsed.data } as AgentLookupCall;
}
/** §2.1 closed error codes a lookup answers with; database exceptions are INDISPONIVEL and their text never reaches the model. */
export const AGENT_LOOKUP_ERRORS = ["REF_DESCONHECIDA", "DATA_INVALIDA", "FORA_DO_LIMITE", "PROFISSIONAL_INATIVO", "SERVICO_INATIVO", "INDISPONIVEL"] as const;
export type AgentLookupErrorCode = (typeof AGENT_LOOKUP_ERRORS)[number];
/** The output of a failed lookup: `{"erro":"<CÓDIGO>"}`. */
export const agentLookupError = (code: AgentLookupErrorCode) => {
  if (!(AGENT_LOOKUP_ERRORS as readonly string[]).includes(code)) throw Error("AGENT_LOOKUP_ERROR_CODE");
  return JSON.stringify({ erro: code });
};
/** A real Gregorian date in the wire's YYYY-MM-DD form. */
export function agentCalendarDate(value: string): boolean {
  if (!new RegExp(P.date).test(value)) return false;
  const [year, month, day] = value.split("-").map(Number), at = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}
/** Minutes of a wire HH:mm clock (null when it is not one). */
export const agentClockMinutes = (value: string) => new RegExp(P.clock).test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
