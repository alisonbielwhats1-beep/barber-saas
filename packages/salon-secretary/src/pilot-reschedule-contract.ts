import { createHash } from "node:crypto";
import { z } from "zod";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md §2; owner decisions
 * 25-31). The ONE tool Luna answers with on the pilot path, `interpretar_remarcacao`: Luna reads the owner's Portuguese and copies the owner's
 * own words into every `mencao`; it never decides identity, the appointment, a computed date, availability or approval (the deterministic
 * resolver, src/lib/secretary-pilot-resolver.ts, does, over real records). Strict wire: every property required (null states absence) and nothing
 * else admitted, so the contract has no place for words the owner did not say about a field. `dia_semana` counts as the Portuguese names do:
 * 1 domingo, 2 segunda, 3 terça, 4 quarta, 5 quinta, 6 sexta, 7 sábado (UTC weekday + 1). The request that carries it (prompt, data,
 * limits): pilot-reschedule-prompt.ts. */
export const PILOT_RESCHEDULE_TOOL = "interpretar_remarcacao" as const;
export const PILOT_TURN_KINDS = ["remarcar", "fora_do_escopo", "misto", "conversa", "resposta"] as const;
export const PILOT_OUT_OF_SCOPE_KINDS = ["cancelar", "bloquear", "trocar_servico", "agendar", "consultar", "outra_acao", "recorrencia", "mensagem"] as const;
export const PILOT_PROFESSIONAL_MODES = ["manter", "nomeado", "qualquer"] as const;
export const PILOT_POSITIONS = ["primeiro", "ultimo"] as const;
export const PILOT_QUALIFIERS = ["este", "proximo"] as const;
export const PILOT_PERIODS = ["manha", "tarde", "noite"] as const;
/** Bounds of the wire (a mention is a short copy of the owner's words; question ids are the plan's own, q1..q999). */
/** `days`/`minutes`: the largest offset a relative day or clock may carry (a year; a day), either way. */
export const PILOT_CONTRACT_LIMITS = Object.freeze({ mention: 120, outOfScope: 6, questionId: "^q[1-9][0-9]{0,2}$", days: 366, minutes: 1440 });
/** The request of the pilot (the cost guard pins it): the frozen agent's reasoning effort and output cap. */
export const PILOT_REQUEST_LIMITS = Object.freeze({ effort: "medium" as const, maxOutputTokens: 8192 });
export type PilotTurnKind = (typeof PILOT_TURN_KINDS)[number];
export type PilotOutOfScopeKind = (typeof PILOT_OUT_OF_SCOPE_KINDS)[number];
export type PilotProfessionalMode = (typeof PILOT_PROFESSIONAL_MODES)[number];

type Json = { [key: string]: unknown };
const L = PILOT_CONTRACT_LIMITS;
const object = (properties: Record<string, Json>, description?: string): Json =>
  ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) });
const nullable = (schema: Json): Json => ({ ...schema, type: [schema.type, "null"] });
const described = (schema: Json, description: string): Json => ({ ...schema, description });
const integer = (minimum?: number, maximum?: number): Json => ({ type: "integer", ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) });
const constant = (value: string): Json => ({ type: "string", enum: [value] });
const choice = (values: readonly string[], orNull = false): Json => orNull ? { type: ["string", "null"], enum: [...values, null] } : { type: "string", enum: [...values] };
const freeze = <T>(value: T): T => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const mention = described({ type: "string", minLength: 1, maxLength: L.mention }, "Cópia das palavras do dono para este valor, como ele escreveu.");

const dayWire: Json[] = [
  object({ tipo: constant("data"), dia: integer(1, 31), mes: nullable(integer(1, 12)), mencao: mention }),
  object({ tipo: constant("dia_semana"), dia_semana: described(integer(1, 7), "1 domingo, 2 segunda, 3 terça, 4 quarta, 5 quinta, 6 sexta, 7 sábado."),
    qualificador: choice(PILOT_QUALIFIERS, true), mencao: mention }),
  object({ tipo: constant("relativo_hoje"), dias: integer(-L.days, L.days), mencao: mention }),
  object({ tipo: constant("mesmo_da_origem"), mencao: mention }),
  object({ tipo: constant("origem_mais_dias"), dias: integer(-L.days, L.days), mencao: mention }),
];
const clockWire: Json[] = [
  object({ tipo: constant("relogio"), hora: integer(0, 23), minuto: integer(0, 59), periodo: choice(PILOT_PERIODS, true), mencao: mention }),
  object({ tipo: constant("mesmo_da_origem"), mencao: mention }),
  object({ tipo: constant("origem_mais_minutos"), minutos: integer(-L.minutes, L.minutes), mencao: mention }),
  object({ tipo: constant("a_definir"), mencao: mention }),
];
const dayOrNull: Json = { anyOf: [...dayWire, { type: "null" }] };
const clockOrNull: Json = { anyOf: [...clockWire, { type: "null" }] };
/** First or last appointment of the day, with the owner's own words (the resolver's provenance check reads them like any hint's). */
const positionOrNull: Json = { anyOf: [object({ valor: choice(PILOT_POSITIONS), mencao: mention }), { type: "null" }] };
/** §2 wire of `interpretar_remarcacao` (OpenAI strict function schema; plain data, frozen). */
export const PILOT_RESCHEDULE_PARAMETERS: Json = freeze(object({
  tipo: described(choice(PILOT_TURN_KINDS), "remarcar: mudar dia, horário ou profissional de um atendimento já marcado; resposta: continuação de uma pergunta aberta; misto: parte remarcação e parte outra coisa."),
  resposta_a: described(nullable({ type: "string", pattern: L.questionId }), "Id da pergunta aberta que esta mensagem responde; senão null."),
  desistir: described({ type: "boolean" }, "O dono retira o rascunho aberto. Não é cancelar atendimento."),
  aceita_parcial: described(nullable({ type: "boolean" }), "Só na resposta à pergunta de fazer só a remarcação: true se o dono aceita, false se recusa; em qualquer outro caso null."),
  cliente: object({ mencao: nullable(mention) }),
  origem: described(object({ dia: dayOrNull, hora: clockOrNull, profissional_mencao: nullable(mention), servico_mencao: nullable(mention), posicao: positionOrNull }),
    "Só as pistas que o dono deu sobre o atendimento que já existe."),
  destino: described(object({ dia: dayOrNull, hora: clockOrNull, profissional: object({ modo: choice(PILOT_PROFESSIONAL_MODES, true), mencao: nullable(mention) }) }),
    "O que o dono pediu para o novo horário."),
  fora_do_escopo: described({ type: "array", maxItems: L.outOfScope, items: object({ tipo: choice(PILOT_OUT_OF_SCOPE_KINDS), mencao: mention }) },
    "Pedidos desta mensagem que não são remarcar um atendimento."),
}));
export const PILOT_RESCHEDULE_DESCRIPTION = "Devolve o que o dono pediu sobre remarcar um atendimento, com as palavras dele em cada menção. Nada é gravado: o sistema confere os registros e o dono confirma pelo botão.";
/** The SDK's SerializedFunctionTool / the Responses function tool of the pilot (the only tool of its request, strict). */
export type PilotFunctionTool = { type: "function"; name: typeof PILOT_RESCHEDULE_TOOL; description: string; parameters: Json; strict: true };
/** A fresh copy of the tool (the SDK and callers may keep or mutate what they receive). */
export const pilotTool = (): PilotFunctionTool => ({ type: "function", name: PILOT_RESCHEDULE_TOOL, description: PILOT_RESCHEDULE_DESCRIPTION,
  parameters: structuredClone(PILOT_RESCHEDULE_PARAMETERS), strict: true });
/** Canonical JSON (keys sorted at every level, undefined dropped) of a tool list as sent: every key counts, key order does not. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().filter(key => (value as Json)[key] !== undefined).map(key => [key, canonical((value as Json)[key])])) : value;
/** sha256 of a tool list (SDK SerializedTool[] or the HTTP body's `tools`), pinned by the cost guard. */
export const pilotToolsDigest = (tools: readonly unknown[]) => createHash("sha256").update(JSON.stringify(canonical(tools))).digest("hex");
export const PILOT_TOOLS_SHA256 = pilotToolsDigest([pilotTool()]);

/** Length in code points (JSON Schema minLength/maxLength), not UTF-16 units. */
const text = (min: number, max: number) => z.string().refine(value => { const n = [...value].length; return n >= min && n <= max; }, "LENGTH");
const mentionShape = text(1, L.mention);
const int = (minimum?: number, maximum?: number) => { let shape = z.number().int(); if (minimum !== undefined) shape = shape.min(minimum); if (maximum !== undefined) shape = shape.max(maximum); return shape; };
export const pilotTempoDiaShape = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("data"), dia: int(1, 31), mes: int(1, 12).nullable(), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("dia_semana"), dia_semana: int(1, 7), qualificador: z.enum(PILOT_QUALIFIERS).nullable(), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("relativo_hoje"), dias: int(-L.days, L.days), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("mesmo_da_origem"), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("origem_mais_dias"), dias: int(-L.days, L.days), mencao: mentionShape }).strict(),
]);
export const pilotTempoHoraShape = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("relogio"), hora: int(0, 23), minuto: int(0, 59), periodo: z.enum(PILOT_PERIODS).nullable(), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("mesmo_da_origem"), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("origem_mais_minutos"), minutos: int(-L.minutes, L.minutes), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("a_definir"), mencao: mentionShape }).strict(),
]);
/** Structural decoder of the wire: the same shape as PILOT_RESCHEDULE_PARAMETERS, strict at every level. */
/** The origin hints and the destination as typed operators (also the shape of the pilot's pending operators kept in the session). */
export const pilotOrigemShape = z.object({ dia: pilotTempoDiaShape.nullable(), hora: pilotTempoHoraShape.nullable(), profissional_mencao: mentionShape.nullable(),
  servico_mencao: mentionShape.nullable(), posicao: z.object({ valor: z.enum(PILOT_POSITIONS), mencao: mentionShape }).strict().nullable() }).strict();
export const pilotDestinoShape = z.object({ dia: pilotTempoDiaShape.nullable(), hora: pilotTempoHoraShape.nullable(),
  profissional: z.object({ modo: z.enum(PILOT_PROFESSIONAL_MODES).nullable(), mencao: mentionShape.nullable() }).strict() }).strict();
export const pilotInterpretationShape = z.object({
  tipo: z.enum(PILOT_TURN_KINDS),
  resposta_a: z.string().regex(new RegExp(L.questionId)).nullable(),
  desistir: z.boolean(),
  aceita_parcial: z.boolean().nullable(),
  cliente: z.object({ mencao: mentionShape.nullable() }).strict(),
  origem: pilotOrigemShape,
  destino: pilotDestinoShape,
  fora_do_escopo: z.array(z.object({ tipo: z.enum(PILOT_OUT_OF_SCOPE_KINDS), mencao: mentionShape }).strict()).max(L.outOfScope),
}).strict();
export type PilotTempoDia = z.infer<typeof pilotTempoDiaShape>;
export type PilotTempoHora = z.infer<typeof pilotTempoHoraShape>;
export type PilotInterpretation = z.infer<typeof pilotInterpretationShape>;
export type PilotOrigin = PilotInterpretation["origem"];
export type PilotDestination = PilotInterpretation["destino"];
export type PilotOutOfScopeItem = PilotInterpretation["fora_do_escopo"][number];

/** Rejection of a payload: `reasons` are codes and schema paths only, never a string the model wrote. */
export class PilotContractError extends Error {
  readonly code = "PILOT_CONTRACT";
  constructor(readonly reasons: readonly string[]) { super("PILOT_CONTRACT"); this.name = "PilotContractError"; }
}
/** The published wire compiled once (JSON Schema → zod), checked beside the typed shape: what Luna is told is what is accepted. */
let pilotWire: z.ZodType | undefined;
const compiledPilotWire = () => pilotWire ??= z.fromJSONSchema(structuredClone(PILOT_RESCHEDULE_PARAMETERS) as Parameters<typeof z.fromJSONSchema>[0]);
/** Strict decode of an `interpretar_remarcacao` payload: the typed shape and the published wire must both accept it; the value is returned as
 * it came (never transformed). Throws PilotContractError. */
export function decodePilotInterpretation(raw: unknown): PilotInterpretation {
  const parsed = pilotInterpretationShape.safeParse(raw);
  if (!parsed.success) throw new PilotContractError([...new Set(parsed.error.issues.map(issue => `SCHEMA:${issue.code}@${issue.path.map(String).join(".")}`))]);
  if (!compiledPilotWire().safeParse(raw).success) throw new PilotContractError(["WIRE"]);
  const rules = pilotContractRules(parsed.data);
  if (rules.length) throw new PilotContractError(rules);
  return raw as PilotInterpretation;
}
/** What the schema cannot say: a mixed request names its out-of-scope part; a named professional comes with the owner's words for it. A
 * violation is a format failure of the call (its single repair follows), never a value the code picks. */
export function pilotContractRules(value: PilotInterpretation): string[] {
  return [...(value.tipo === "misto" && !value.fora_do_escopo.length ? ["RULE:misto_sem_fora_do_escopo"] : []),
    ...(value.destino.profissional.modo === "nomeado" && value.destino.profissional.mencao === null ? ["RULE:nomeado_sem_mencao"] : [])];
}
/** The function-call arguments string of `interpretar_remarcacao` (invalid JSON is a PilotContractError too). */
export function decodePilotInterpretationArguments(json: string): PilotInterpretation {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new PilotContractError(["JSON"]); }
  return decodePilotInterpretation(raw);
}
