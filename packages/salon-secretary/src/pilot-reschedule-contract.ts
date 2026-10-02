import { createHash } from "node:crypto";
import { z } from "zod";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md §2; owner decisions
 * 25-31). The ONE tool Luna answers with on the pilot path, `interpretar_remarcacao`: Luna reads the owner's Portuguese and copies the owner's
 * own words into every `mencao`; it never decides identity, the appointment, a computed date, availability or approval (the deterministic
 * resolver, src/lib/secretary-pilot-resolver.ts, does, over real records). Strict wire: every property required (null states absence) and nothing
 * else admitted, so the contract has no place for words the owner did not say about a field. E2-A (§10, Adendo 10): `dia_semana` is a text
 * enum (segunda … domingo; the resolver turns it into the weekday by a data table, never by reading the mention); `origem.servico` carries the
 * owner's words and the EXACT catalog names Luna says they may designate (the resolver keeps only names of the salon's catalog); `observacoes`
 * holds reason and context copied from the message (the code never reads it: a count in telemetry only); a `fora_do_escopo` item is a SEPARATE
 * request with its own effect, its words in `pedido`. The request that carries it (prompt, data, limits): pilot-reschedule-prompt.ts. */
export const PILOT_RESCHEDULE_TOOL = "interpretar_remarcacao" as const;
export const PILOT_TURN_KINDS = ["remarcar", "fora_do_escopo", "misto", "conversa", "resposta"] as const;
export const PILOT_OUT_OF_SCOPE_KINDS = ["cancelar", "bloquear", "trocar_servico", "agendar", "consultar", "outra_acao", "recorrencia", "mensagem"] as const;
export const PILOT_PROFESSIONAL_MODES = ["manter", "nomeado", "qualquer"] as const;
export const PILOT_POSITIONS = ["primeiro", "ultimo"] as const;
export const PILOT_QUALIFIERS = ["este", "proximo"] as const;
export const PILOT_PERIODS = ["manha", "tarde", "noite"] as const;
/** §10.2: the weekday as a typed text value (no number anywhere; the resolver's table maps it to the calendar). */
export const PILOT_WEEKDAYS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"] as const;
/** Bounds of the wire (a mention is a short copy of the owner's words; question ids are the plan's own, q1..q999). */
/** `days`/`minutes`: the largest offset a relative day or clock may carry (a year; a day), either way. `observations`/`observation`: §10
 * observacoes, as amended by the E2-A adversarial review OBS-1 (a field the code never reads must never fail the turn: any faithful copy of the
 * owner's words fits, each item up to the message's own 1000 characters, a generous count). `catalogNames`/`catalogName`: the catalog names of a
 * service hint and the length of one. */
export const PILOT_CONTRACT_LIMITS = Object.freeze({ mention: 120, outOfScope: 6, observations: 20, observation: 1000, catalogNames: 10, catalogName: 200,
  questionId: "^q[1-9][0-9]{0,2}$", days: 366, minutes: 1440 });
/** The request of the pilot (the cost guard pins it): the frozen agent's reasoning effort and output cap. */
export const PILOT_REQUEST_LIMITS = Object.freeze({ effort: "medium" as const, maxOutputTokens: 8192 });
export type PilotTurnKind = (typeof PILOT_TURN_KINDS)[number];
export type PilotOutOfScopeKind = (typeof PILOT_OUT_OF_SCOPE_KINDS)[number];
export type PilotProfessionalMode = (typeof PILOT_PROFESSIONAL_MODES)[number];
export type PilotWeekday = (typeof PILOT_WEEKDAYS)[number];

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
/** Review P5: a mention of a name (customer, professional, service) carries only the name's own words: the resolver matches every one of them. */
const nameMention = described({ type: "string", minLength: 1, maxLength: L.mention }, "Só as palavras do próprio nome, como o dono escreveu, sem artigo, preposição ou forma de tratamento.");

const dayWire: Json[] = [
  object({ tipo: constant("data"), dia: integer(1, 31), mes: nullable(integer(1, 12)), mencao: mention }),
  // Review P7: a day of a month said relative to the current one (the resolver counts the months from received_at; Luna never computes it).
  object({ tipo: constant("mes_relativo"), dia: integer(1, 31), meses: described(integer(0, 12), "Meses depois do mês atual: 0 este mês, 1 o seguinte."), mencao: mention }),
  object({ tipo: constant("dia_semana"), dia_semana: described(choice(PILOT_WEEKDAYS), "O dia da semana pelo nome, sem acento e sem \"-feira\"."),
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
/** §10.3: the service of the existing appointment as the owner's words plus the exact catalog names Luna says they may designate. */
const serviceOrNull: Json = { anyOf: [object({
  mencao: described({ type: "string", minLength: 1, maxLength: L.mention }, "Cópia das palavras do dono sobre o serviço do atendimento, como ele escreveu."),
  catalogo: described({ type: "array", maxItems: L.catalogNames, items: { type: "string", minLength: 1, maxLength: L.catalogName } },
    `Os nomes exatos, copiados da lista de Serviços dos dados, que essas palavras podem designar: um ou mais, no máximo ${L.catalogNames}; [] se nenhum couber ou se mais de ${L.catalogNames} couberem.`),
}), { type: "null" }] };
/** §2 wire of `interpretar_remarcacao` (OpenAI strict function schema; plain data, frozen). */
export const PILOT_RESCHEDULE_PARAMETERS: Json = freeze(object({
  tipo: described(choice(PILOT_TURN_KINDS), "remarcar: mudar dia, horário ou profissional de um atendimento já marcado, com ou sem motivo, contexto ou condição; resposta: continuação de uma pergunta aberta; misto: a remarcação mais um pedido separado de fora_do_escopo, inclusive uma segunda remarcação; fora_do_escopo: só pedidos separados, sem remarcação; conversa: nenhum pedido."),
  resposta_a: described(nullable({ type: "string", pattern: L.questionId }), "Id da pergunta aberta que esta mensagem responde; senão null."),
  desistir: described({ type: "boolean" }, "O dono retira o rascunho aberto. Não é cancelar atendimento."),
  aceita_parcial: described(nullable({ type: "boolean" }), "Só na resposta à pergunta de fazer só a remarcação: true se o dono aceita, false se recusa; em qualquer outro caso null."),
  cliente: object({ mencao: nullable(nameMention) }),
  origem: described(object({ dia: dayOrNull, hora: clockOrNull, profissional_mencao: nullable(nameMention), servico: serviceOrNull, posicao: positionOrNull }),
    "Só as pistas que o dono deu sobre o atendimento que já existe."),
  destino: described(object({ dia: dayOrNull, hora: clockOrNull, profissional: object({ modo: choice(PILOT_PROFESSIONAL_MODES, true), mencao: nullable(nameMention) }) }),
    "O que o dono pediu para o novo horário."),
  // §10.1: reason and context have their own place, never read by the code (a count in telemetry only).
  observacoes: described({ type: "array", maxItems: L.observations, items: { type: "string", minLength: 1, maxLength: L.observation } },
    `Motivo, contexto, cortesias e informações que o dono deu junto da remarcação, cada um copiado da mensagem com as palavras dele, no máximo ${L.observations} trechos. Não são pedidos; o sistema não lê este campo.`),
  // Review P4: one appointment per message; a second reschedule is named here (tipo misto), never dropped nor merged into the first. §10.1: only a
  // separate request with its own effect; whatever specifies, corrects, references or explains this reschedule stays inside it.
  fora_do_escopo: described({ type: "array", maxItems: L.outOfScope, items: object({ tipo: choice(PILOT_OUT_OF_SCOPE_KINDS),
    pedido: described({ type: "string", minLength: 1, maxLength: L.mention }, "As palavras do pedido separado, copiadas da mensagem.") }) },
    "Só pedidos separados: uma ação à parte, com efeito próprio, que o dono quer que a Secretária faça além desta remarcação (cancelar um atendimento que fica sem novo horário ou outro atendimento, bloquear, agendar, trocar ou incluir serviço, repetir, recado ao cliente com outro conteúdo, uma consulta pedida por si), inclusive quando o dono só repassa o pedido ou o desejo do cliente, e uma segunda remarcação (outra pessoa ou outro atendimento) como outra_acao. Motivo, contexto, cortesias, correções, referências ao atendimento, condições, informações e preferências do cliente que não pedem nada e a verificação de vaga para esta remarcação ficam dentro dela: vão nos campos ou em observacoes, nunca aqui. Tirar este atendimento de um horário para pôr em outro, mesmo dito como desmarcar e marcar, é a própria remarcação; avisar o cliente desta mudança também, porque o sistema já avisa."),
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
  z.object({ tipo: z.literal("mes_relativo"), dia: int(1, 31), meses: int(0, 12), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("dia_semana"), dia_semana: z.enum(PILOT_WEEKDAYS), qualificador: z.enum(PILOT_QUALIFIERS).nullable(), mencao: mentionShape }).strict(),
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
/** §10.3: the service hint (the owner's words; the catalog names Luna says they may designate, checked by the resolver against the salon's). */
export const pilotServicoShape = z.object({ mencao: mentionShape, catalogo: z.array(text(1, L.catalogName)).max(L.catalogNames) }).strict();
export const pilotOrigemShape = z.object({ dia: pilotTempoDiaShape.nullable(), hora: pilotTempoHoraShape.nullable(), profissional_mencao: mentionShape.nullable(),
  servico: pilotServicoShape.nullable(), posicao: z.object({ valor: z.enum(PILOT_POSITIONS), mencao: mentionShape }).strict().nullable() }).strict();
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
  observacoes: z.array(text(1, L.observation)).max(L.observations),
  fora_do_escopo: z.array(z.object({ tipo: z.enum(PILOT_OUT_OF_SCOPE_KINDS), pedido: mentionShape }).strict()).max(L.outOfScope),
}).strict();
export type PilotTempoDia = z.infer<typeof pilotTempoDiaShape>;
export type PilotTempoHora = z.infer<typeof pilotTempoHoraShape>;
export type PilotInterpretation = z.infer<typeof pilotInterpretationShape>;
export type PilotOrigin = PilotInterpretation["origem"];
export type PilotServiceHint = z.infer<typeof pilotServicoShape>;
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
