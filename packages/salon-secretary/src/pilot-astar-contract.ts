import { z } from "zod";
import { PILOT_CONTRACT_LIMITS, PILOT_OFFSET_UNITS, PILOT_PERIODS, PILOT_POSITIONS, PILOT_QUALIFIERS, PILOT_RESCHEDULE_DESCRIPTION, PILOT_RESCHEDULE_PARAMETERS,
  PILOT_RESCHEDULE_TOOL, PILOT_WEEKDAYS, PilotContractError, pilotCitedShape, pilotDestinoShape, pilotInterpretationShape, pilotServicoShape, pilotToolsDigest,
  type PilotCitedDay } from "./pilot-reschedule-contract";

/** A* premise probe (docs/c5-spike/13-sonda-premissa-astar.md §2 and §4; Adendo 12): the VARIANT of the reschedule contract the probe sends. Only the
 * probe uses it; the E2-B contract (pilot-reschedule-contract.ts) is untouched and the real flow never reads this file. It is the E2-B wire with
 * only the destination offsets changed:
 *  - day: { tipo, quantidade, unidade, data_citada, ancora, mencao }; clock: { tipo, minutos, hora_citada, ancora, mencao } (the order Luna writes);
 *  - ancora = { evidencia, tipo_evidencia, tipo } or null: first an exact copy of the owner words that say where the count starts (0..120, and an
 *    empty one counts as null), then what those words do (nomeia, deitico, desloca, outro), then the starting point they name (origem, hoje or
 *    data_citada for a day; origem, agora or hora_citada for a clock). Luna never says whether something is ambiguous;
 *  - the cited reference is a typed field of its own beside the anchor (data_citada keeps the three CONTRACT-4 forms; hora_citada is the clock as
 *    said, with periodo), filled whenever the owner cites one, whether or not it is the starting point;
 *  - an offset used as an origin hint has no ancora (and the origin clock offset no hora_citada).
 * The three anchor repair rules of E2-B are gone (the pure module decides what a claim is worth). §4: the repeated description of every operator
 * mencao is left out of this variant behind PILOT_ASTAR_MENTION_DESCRIPTIONS, so both variants can be built and measured; whether that is safe is
 * decided by the independent verification of §4, never here. */
export const PILOT_ASTAR_CONTRACT_VERSION = "pilot-astar-probe-1";
export const PILOT_ASTAR_EVIDENCE_TYPES = ["nomeia", "deitico", "desloca", "outro"] as const;
export const PILOT_ASTAR_DAY_ANCHORS = ["origem", "hoje", "data_citada"] as const;
export const PILOT_ASTAR_TIME_ANCHORS = ["origem", "agora", "hora_citada"] as const;
/** §4 byte reclaim of this variant (pending the independent verification of spec 13 §4): false leaves out the 21 copies of the description of an
 * operator or position mencao, a sentence rule 1 of the prompt already states; true keeps them as in E2-B. */
export const PILOT_ASTAR_MENTION_DESCRIPTIONS = false;
export type AstarEvidenceType = (typeof PILOT_ASTAR_EVIDENCE_TYPES)[number];
export type AstarDayAnchor = (typeof PILOT_ASTAR_DAY_ANCHORS)[number];
export type AstarTimeAnchor = (typeof PILOT_ASTAR_TIME_ANCHORS)[number];

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
/** The E2-B wire, reused as is for everything the variant does not change (root fields, client, origin hints, who attends, descriptions). */
const E2B = (PILOT_RESCHEDULE_PARAMETERS as { properties: Record<string, Json> }).properties;
const E2B_ORIGIN = E2B.origem as { properties: Record<string, Json>; description: string }, E2B_DESTINATION = E2B.destino as { properties: Record<string, Json>; description: string };
/** The E2-B sentence of every operator mencao (rule 1 of the prompt says the same). */
const MENTION_DESCRIPTION = "Cópia das palavras do dono para este valor, como ele escreveu.";
const citedMention: Json = { type: "string", minLength: 1, maxLength: L.mention };
const anchorOrNull = (anchors: readonly string[]): Json => ({ anyOf: [object({ evidencia: { type: "string", maxLength: L.mention }, tipo_evidencia: choice(PILOT_ASTAR_EVIDENCE_TYPES),
  tipo: choice(anchors) }), { type: "null" }] });

/** The strict wire of the variant, with (true) or without (false) the description of every operator or position mencao. */
export function astarParameters(mentionDescriptions: boolean): Json {
  const plain: Json = { type: "string", minLength: 1, maxLength: L.mention }, mention = mentionDescriptions ? described(plain, MENTION_DESCRIPTION) : plain;
  const citedOrNull: Json = { anyOf: [object({ dia: integer(1, 31), mes: nullable(integer(1, 12)), mencao: citedMention }),
    object({ tipo: constant("dia_semana"), dia_semana: choice(PILOT_WEEKDAYS), qualificador: choice(PILOT_QUALIFIERS, true), mencao: citedMention }),
    object({ tipo: constant("mes_relativo"), dia: integer(1, 31), meses: integer(0, 12), mencao: citedMention }), { type: "null" }] };
  const citedClockOrNull: Json = { anyOf: [object({ hora: integer(0, 23), minuto: integer(0, 59), periodo: choice(PILOT_PERIODS, true), mencao: citedMention }), { type: "null" }] };
  const days = (shift: Json): Json => ({ anyOf: [
    object({ tipo: constant("data"), dia: integer(1, 31), mes: nullable(integer(1, 12)), mencao: mention }),
    object({ tipo: constant("mes_relativo"), dia: integer(1, 31), meses: described(integer(0, 12), "Meses depois do mês atual: 0 este mês, 1 o seguinte."), mencao: mention }),
    object({ tipo: constant("dia_semana"), dia_semana: described(choice(PILOT_WEEKDAYS), "O dia da semana pelo nome, sem acento e sem \"-feira\"."),
      qualificador: choice(PILOT_QUALIFIERS, true), mencao: mention }),
    object({ tipo: constant("mesmo_da_origem"), mencao: mention }), shift, object({ tipo: constant("a_definir"), mencao: mention }), { type: "null" }] });
  const clocks = (shift: Json): Json => ({ anyOf: [
    object({ tipo: constant("relogio"), hora: integer(0, 23), minuto: integer(0, 59), periodo: choice(PILOT_PERIODS, true), mencao: mention }),
    object({ tipo: constant("mesmo_da_origem"), mencao: mention }), shift, object({ tipo: constant("a_definir"), mencao: mention }), { type: "null" }] });
  const quantity = { quantidade: integer(-L.days, L.days), unidade: choice(PILOT_OFFSET_UNITS) };
  const originDay = object({ tipo: constant("deslocamento"), ...quantity, data_citada: citedOrNull, mencao: mention });
  const destinationDay = object({ tipo: constant("deslocamento"), ...quantity, data_citada: citedOrNull, ancora: anchorOrNull(PILOT_ASTAR_DAY_ANCHORS), mencao: mention });
  const originClock = object({ tipo: constant("deslocamento"), minutos: integer(-L.minutes, L.minutes), mencao: mention });
  const destinationClock = object({ tipo: constant("deslocamento"), minutos: integer(-L.minutes, L.minutes), hora_citada: citedClockOrNull, ancora: anchorOrNull(PILOT_ASTAR_TIME_ANCHORS),
    mencao: mention });
  const position: Json = { anyOf: [object({ valor: choice(PILOT_POSITIONS), mencao: mention }), { type: "null" }] };
  return freeze(object({
    tipo: E2B.tipo, resposta_a: E2B.resposta_a, desistir: E2B.desistir, aceita_parcial: E2B.aceita_parcial, cliente: E2B.cliente,
    origem: object({ dia: days(originDay), hora: clocks(originClock), profissional_mencao: E2B_ORIGIN.properties.profissional_mencao, servico: E2B_ORIGIN.properties.servico,
      posicao: position }, E2B_ORIGIN.description),
    destino: object({ dia: days(destinationDay), hora: clocks(destinationClock), profissional: E2B_DESTINATION.properties.profissional }, E2B_DESTINATION.description),
    observacoes: E2B.observacoes, fora_do_escopo: E2B.fora_do_escopo,
  }));
}
/** The wire the probe sends (the variant PILOT_ASTAR_MENTION_DESCRIPTIONS selects). */
export const PILOT_ASTAR_PARAMETERS: Json = astarParameters(PILOT_ASTAR_MENTION_DESCRIPTIONS);
export type AstarFunctionTool = { type: "function"; name: typeof PILOT_RESCHEDULE_TOOL; description: string; parameters: Json; strict: true };
/** A fresh copy of the tool: the E2-B name and description, the variant wire. */
export const astarTool = (parameters: Json = PILOT_ASTAR_PARAMETERS): AstarFunctionTool => ({ type: "function", name: PILOT_RESCHEDULE_TOOL, description: PILOT_RESCHEDULE_DESCRIPTION,
  parameters: structuredClone(parameters), strict: true });
/** sha256 of the tool list as sent (pinned by the cost guard under {pilotAnchorProbe:true} only). */
export const PILOT_ASTAR_TOOLS_SHA256 = pilotToolsDigest([astarTool()]);

/** Length in code points (JSON Schema minLength/maxLength), not UTF-16 units. */
const text = (min: number, max: number) => z.string().refine(value => { const n = [...value].length; return n >= min && n <= max; }, "LENGTH");
const mentionShape = text(1, L.mention);
const int = (minimum?: number, maximum?: number) => { let shape = z.number().int(); if (minimum !== undefined) shape = shape.min(minimum); if (maximum !== undefined) shape = shape.max(maximum); return shape; };
const anchorShape = <T extends readonly [string, ...string[]]>(anchors: T) =>
  z.object({ evidencia: text(0, L.mention), tipo_evidencia: z.enum(PILOT_ASTAR_EVIDENCE_TYPES), tipo: z.enum(anchors) }).strict();
export const astarCitedClockShape = z.object({ hora: int(0, 23), minuto: int(0, 59), periodo: z.enum(PILOT_PERIODS).nullable(), mencao: mentionShape }).strict();
const dayForms = [
  z.object({ tipo: z.literal("data"), dia: int(1, 31), mes: int(1, 12).nullable(), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("mes_relativo"), dia: int(1, 31), meses: int(0, 12), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("dia_semana"), dia_semana: z.enum(PILOT_WEEKDAYS), qualificador: z.enum(PILOT_QUALIFIERS).nullable(), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("mesmo_da_origem"), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("a_definir"), mencao: mentionShape }).strict(),
] as const;
const clockForms = [
  z.object({ tipo: z.literal("relogio"), hora: int(0, 23), minuto: int(0, 59), periodo: z.enum(PILOT_PERIODS).nullable(), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("mesmo_da_origem"), mencao: mentionShape }).strict(),
  z.object({ tipo: z.literal("a_definir"), mencao: mentionShape }).strict(),
] as const;
const quantityShape = { quantidade: int(-L.days, L.days), unidade: z.enum(PILOT_OFFSET_UNITS) };
export const astarOriginDayShape = z.discriminatedUnion("tipo", [...dayForms,
  z.object({ tipo: z.literal("deslocamento"), ...quantityShape, data_citada: pilotCitedShape.nullable(), mencao: mentionShape }).strict()]);
export const astarDestinationDayShape = z.discriminatedUnion("tipo", [...dayForms,
  z.object({ tipo: z.literal("deslocamento"), ...quantityShape, data_citada: pilotCitedShape.nullable(), ancora: anchorShape(PILOT_ASTAR_DAY_ANCHORS).nullable(), mencao: mentionShape }).strict()]);
export const astarOriginClockShape = z.discriminatedUnion("tipo", [...clockForms,
  z.object({ tipo: z.literal("deslocamento"), minutos: int(-L.minutes, L.minutes), mencao: mentionShape }).strict()]);
export const astarDestinationClockShape = z.discriminatedUnion("tipo", [...clockForms,
  z.object({ tipo: z.literal("deslocamento"), minutos: int(-L.minutes, L.minutes), hora_citada: astarCitedClockShape.nullable(), ancora: anchorShape(PILOT_ASTAR_TIME_ANCHORS).nullable(),
    mencao: mentionShape }).strict()]);
export const astarOrigemShape = z.object({ dia: astarOriginDayShape.nullable(), hora: astarOriginClockShape.nullable(), profissional_mencao: mentionShape.nullable(),
  servico: pilotServicoShape.nullable(), posicao: z.object({ valor: z.enum(PILOT_POSITIONS), mencao: mentionShape }).strict().nullable() }).strict();
export const astarDestinoShape = z.object({ dia: astarDestinationDayShape.nullable(), hora: astarDestinationClockShape.nullable(),
  profissional: pilotDestinoShape.shape.profissional }).strict();
const root = pilotInterpretationShape.shape;
export const astarInterpretationShape = z.object({ tipo: root.tipo, resposta_a: root.resposta_a, desistir: root.desistir, aceita_parcial: root.aceita_parcial, cliente: root.cliente,
  origem: astarOrigemShape, destino: astarDestinoShape, observacoes: root.observacoes, fora_do_escopo: root.fora_do_escopo }).strict();
export type AstarInterpretation = z.infer<typeof astarInterpretationShape>;
export type AstarDayShift = Extract<z.infer<typeof astarDestinationDayShape>, { tipo: "deslocamento" }>;
export type AstarClockShift = Extract<z.infer<typeof astarDestinationClockShape>, { tipo: "deslocamento" }>;
export type AstarAnchor = NonNullable<AstarDayShift["ancora"]> | NonNullable<AstarClockShift["ancora"]>;
export type AstarCitedClock = z.infer<typeof astarCitedClockShape>;
export type AstarCitedDay = PilotCitedDay;

/** A published wire compiled (JSON Schema → zod), checked beside the typed shape: what Luna is told is what is accepted. */
export const compileAstarWire = (parameters: Json): z.ZodType => z.fromJSONSchema(structuredClone(parameters) as Parameters<typeof z.fromJSONSchema>[0]);
let astarWire: z.ZodType | undefined;
const compiledAstarWire = () => astarWire ??= compileAstarWire(PILOT_ASTAR_PARAMETERS);
/** Strict decode of the variant payload: the typed shape and the published wire must both accept it; the value is returned as it came. Throws
 * PilotContractError (codes and schema paths only, never a string the model wrote). */
export function decodeAstarInterpretation(raw: unknown): AstarInterpretation {
  const parsed = astarInterpretationShape.safeParse(raw);
  if (!parsed.success) throw new PilotContractError([...new Set(parsed.error.issues.map(issue => `SCHEMA:${issue.code}@${issue.path.map(String).join(".")}`))]);
  if (!compiledAstarWire().safeParse(raw).success) throw new PilotContractError(["WIRE"]);
  const rules = astarContractRules(parsed.data);
  if (rules.length) throw new PilotContractError(rules);
  return raw as AstarInterpretation;
}
/** What the schema cannot say, as in E2-B minus the three anchor rules: a mixed request names its separate part; a named professional comes with the
 * owner words for it; an exclusion list only beside a delegated mode. A violation is a format failure of the call (its single repair follows). */
export function astarContractRules(value: AstarInterpretation): string[] {
  const professional = value.destino.profissional;
  return [...(value.tipo === "misto" && !value.fora_do_escopo.length ? ["RULE:misto_sem_fora_do_escopo"] : []),
    ...(professional.modo === "nomeado" && professional.mencao === null ? ["RULE:nomeado_sem_mencao"] : []),
    ...(Array.isArray(professional.excluidos) && professional.excluidos.length && professional.modo !== "qualquer" && professional.modo !== "outro" ? ["RULE:excluidos_sem_delegacao"] : [])];
}
/** The function-call arguments string of the variant (invalid JSON is a PilotContractError too). */
export function decodeAstarInterpretationArguments(json: string): AstarInterpretation {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new PilotContractError(["JSON"]); }
  return decodeAstarInterpretation(raw);
}
