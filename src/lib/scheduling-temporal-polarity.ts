import { literalProofSpans, literalSpans } from "../../packages/salon-secretary/src/literal-match";
import { temporalPolarityEnabled } from "../../packages/salon-secretary/src/temporal-polarity";
import type { SchedulingTemporalEvidence } from "../../packages/salon-secretary/src/scheduling-skill";
import type { ClockComponent, DayComponent } from "../../packages/salon-secretary/src/temporal-components";
import type { SchedulingFields } from "./scheduling-contract";
import type { TemporalRejection } from "./scheduling-temporal";
import type { PendingTemporalAmbiguity } from "./scheduling-temporal-ambiguity";
import type { PendingCalendarConflict } from "./scheduling-calendar-conflict";
import { dayDirection, quoteTemporalShape, resolveClockComponent, resolveDayComponent, verifyClockComponent, verifyDayComponent, UNSPECIFIED_DAYPART_ASKED_HOURS } from "./scheduling-temporal-reference";
import { isDateKey } from "./time";

/** C4 polarity (rec 13, flag SALON_SECRETARY_TEMPORAL_POLARITY). Luna reports a value the user negated
 * ("para 11h, não 10h") as an exclusion {field, value, literal}. This module only proves STRUCTURE and
 * never reads intent: the literal must be ONE whole-token span of the (scoped) message, disjoint from
 * every positive quote and every other exclusion, contain exactly one negation marker, and without that
 * marker be one temporal expression (closed temporal vocabulary and glue, no verb, name or other content
 * word; no sentence boundary inside) that states the excluded value by the grammar of its own shape.
 * Only then, and only when the marker's attachment is unambiguous (ownsMarker), its marker is OWNED: that one negator
 * no longer denies a positive quote of its clause. Every other negator keeps denying. Whatever the proof, an affirmed value equal to an excluded one is refused
 * (asked), and proven clock exclusions narrow the alternatives the backend offers. Never a value source. */
type Entry = SchedulingTemporalEvidence[number];
type Span = [number, number];
export type ExcludedField = "date" | "time" | "source_date" | "source_time" | "end_time";
/** `owned` (review): the marker is a negator whose attachment to this exclusion is unambiguous (ownsMarker). */
export type TemporalExclusionProof = { field: ExcludedField; values: string[]; literal: string; span: Span; marker: Span; owned: boolean };
export type TemporalExclusions = {
  /** Proven exclusions (values in the domain format), their literal spans and marker spans (original offsets). */
  verified: TemporalExclusionProof[];
  /** Every exclusion's own reading of its value, proven or not (the self-contradiction check). */
  claimed: { field: ExcludedField; values: string[] }[];
  /** Codes only (telemetry): TEMPORAL_EXCLUSION_VERIFIED or TEMPORAL_EXCLUSION_<cause>. */
  codes: string[];
};
/** The rejection value of an affirmed value that the same message excluded (codes, like SELECTOR_CONFLICT). */
export const EXCLUDED_VALUE = "EXCLUDED_VALUE";
/** Negators the clause rule reads, plus the exclusion-only markers ("qualquer horário menos 14h", "terça, digo, quarta"),
 * which prove an exclusion but own nothing (they never deny a clause). */
const negators = new Set(["nao", "nunca", "jamais", "nem"]);
const markers = new Set([...negators, "menos", "exceto", "digo"]);
/** Negators that only ever precede what they deny ("às 15h nem às 10"): they cannot close the constituent before them. */
const leadOnly = new Set(["nem"]);
const clauseBoundary = /[,.;!?()\n]/;
const connector = /(?<![\p{L}\p{N}])(?:e|mas|porem|pois|porque|que|se|quando|caso|entao)(?![\p{L}\p{N}])/u;
/** Self-repair cues (closed class of spoken Portuguese: "pera", "quer dizer", "ou melhor"...). Right after a negator that
 * closes an atom ("às dez não pera às onze"), the cue opens the correction: the negator can only deny what precedes it. */
const repairCue = /^[\s,]*(?:pera(?:i|ai)?|espera(?:i|ai)?|espere|quer dizer|digo|ou melhor|melhor dizendo|na verdade|opa|ops|corrigindo)(?![\p{L}\p{N}])/u;
/** Two points of one clause with nothing that opens another between them (no boundary punctuation, no connector). */
const joined = (gap: string) => !clauseBoundary.test(gap) && !connector.test(fold(gap));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const clockValue = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isDateField = (field: string) => field.endsWith("date");

/** Splits per-turn evidence into the affirmed quotes and the exclusions (dropped entirely with the flag off). */
export function splitTemporalExclusions(evidence: SchedulingTemporalEvidence | undefined) {
  const list = evidence ?? [];
  return { positive: list.filter(entry => entry.excluded === undefined), excluded: temporalPolarityEnabled() ? list.filter(entry => entry.excluded !== undefined) : [] };
}
/** The legacy grammar's reading of an exclusion without its marker (supplied by the temporal source guard). */
export type LegacyExclusionReader = (remainder: string, field: ExcludedField, value: string) => string[] | undefined;
const pad = (value: number) => String(value).padStart(2, "0");
/** What an exclusion value says by itself (no proof): the domain values it names. A component clock without a daypart
 * whose hour the components resolver asks about (1-7) names both halves; 8-11 keep the historical reading. */
function claimedValues(field: ExcludedField, value: NonNullable<Entry["excluded"]>, today: string, operation?: string): string[] {
  if (typeof value === "string") return isDateField(field) ? isDateKey(value) ? [value] : [] : clockValue.test(value) ? [value] : [];
  if (isDateField(field)) {
    if (!("kind" in value)) return [];
    const resolved = resolveDayComponent(value as DayComponent, today, dayDirection(field, operation));
    return resolved.status === "OK" ? [resolved.date] : resolved.status === "DATE_CHOICE" ? [...resolved.candidates] : [];
  }
  if (!("hour" in value)) return [];
  const resolved = resolveClockComponent(value as ClockComponent);
  if (resolved.status !== "OK") return [];
  const hour = Number(resolved.time.slice(0, 2)), [low, high] = UNSPECIFIED_DAYPART_ASKED_HOURS;
  return (value as ClockComponent).daypart === "UNSPECIFIED" && hour >= low && hour <= high ? [resolved.time, `${pad((hour + 12) % 24)}${resolved.time.slice(2)}`] : [resolved.time];
}
/** The exclusion's located span and its single marker, or the structural cause it fails. */
function locate(source: string, entry: Entry, positive: readonly Span[]): { span: Span; marker: Span; remainder: string } | { code: string } {
  const spans = literalProofSpans(source, entry.text);
  if (spans.length !== 1) return { code: "LITERAL" };
  const span = spans[0], text = source.slice(span[0], span[1]);
  if (positive.some(([a, b]) => a < span[1] && span[0] < b)) return { code: "OVERLAP" };
  // One clause fragment: no sentence boundary inside it (a trailing one is not inside).
  if (/[.;!?\n]/.test(text.replace(/[\s.;!?]+$/u, ""))) return { code: "SHAPE" };
  const found = [...text.matchAll(/[\p{L}\p{M}]+/gu)].filter(match => markers.has(fold(match[0])));
  if (!found.length) { const adopted = adjacentMarker(source, span);
    return !adopted ? { code: "MARKER" } : positive.some(([a, b]) => a < adopted.span[1] && adopted.span[0] < b) ? { code: "OVERLAP" } : adopted; }
  if (found.length !== 1) return { code: "MARKER" };
  const at = found[0].index!, end = at + found[0][0].length;
  return { span, marker: [span[0] + at, span[0] + end], remainder: text.slice(0, at) + " ".repeat(end - at) + text.slice(end) };
}
/** A literal that quotes only the atom ("às dez") adopts the marker word right next to it ("às dez não"), when exactly one
 * side has one (only spaces or commas between). The extended span then goes through the same proof and ownership rules. */
function adjacentMarker(source: string, span: Span): { span: Span; marker: Span; remainder: string } | undefined {
  const after = /^[\s,]*([\p{L}\p{M}]+)/u.exec(source.slice(span[1])), before = /([\p{L}\p{M}]+)[\s,]*$/u.exec(source.slice(0, span[0]));
  const next = after && markers.has(fold(after[1])) ? after : undefined, previous = before && markers.has(fold(before[1])) ? before : undefined;
  if (!next === !previous || next && leadOnly.has(fold(next[1]))) return undefined;
  const marker: Span = next ? [span[1] + next[0].length - next[1].length, span[1] + next[0].length] : [before!.index!, before!.index! + before![1].length];
  const extended: Span = next ? [span[0], marker[1]] : [marker[0], span[1]];
  const text = source.slice(extended[0], extended[1]), at = marker[0] - extended[0], end = marker[1] - extended[0];
  return { span: extended, marker, remainder: text.slice(0, at) + " ".repeat(end - at) + text.slice(end) };
}
/** Values the remainder states for the exclusion's own value, by the reading of its shape (legacy string or component). */
function provenValues(remainder: string, entry: Entry, today: string, operation: string | undefined, legacy: LegacyExclusionReader): string[] | "SHAPE" | undefined {
  const field = entry.field as ExcludedField, value = entry.excluded!, shape = quoteTemporalShape(remainder);
  // One temporal expression of the role's own kind, nothing else.
  if (!shape.temporalOnly || (isDateField(field) ? shape.clock : shape.day)) return "SHAPE";
  if (typeof value === "string") return legacy(remainder, field, value);
  if (isDateField(field)) {
    if (!("kind" in value)) return;
    const verdict = verifyDayComponent(remainder, value as DayComponent, today, { direction: dayDirection(field, operation), role: field, operation });
    return verdict.status === "OK" ? [verdict.date] : verdict.status === "DATE_CHOICE" ? [...verdict.candidates] : undefined;
  }
  if (!("hour" in value)) return;
  const verdict = verifyClockComponent(remainder, value as ClockComponent, { role: field, operation });
  return verdict.status === "OK" ? [verdict.time] : verdict.status === "DAYPART_CHOICE" ? [...verdict.candidates] : undefined;
}

/** Review (C4 ownership): a proven exclusion owns its negator only when that attachment is unambiguous. The marker must be
 * the exclusion's edge token with no boundary punctuation between it and its own atom ("não, quarta" and "às dez, não"
 * stand alone and may belong to either side). No affirmed quote of the action may sit in the marker's reach, in its
 * clause with no connector between: on the marker's other side (the reverse reading, "às dez não às onze"; a lead-only
 * "nem" cannot close what precedes it) or, for a leading marker, right after the atom ("não amanhã às 10h": the clock is
 * inside the denied scope). Otherwise the marker is not owned and the historical clause denial applies (asked). */
const repairGap = new RegExp(repairCue.source + String.raw`[\s,]*$`, "u");
function ownsMarker(source: string, span: Span, marker: Span, positive: readonly Span[], field: string, typed: readonly { span: Span; field: string }[]) {
  const word = fold(source.slice(marker[0], marker[1]));
  if (!negators.has(word)) return false;
  const lead = source.slice(span[0], marker[0]), trail = source.slice(marker[1], span[1]), content = /[\p{L}\p{N}]/u;
  const leading = !content.test(lead), trailing = !content.test(trail);
  if (leading === trailing) return false;
  // A negator closing its atom and followed by a self-repair cue ("às dez não pera às onze") cannot reach forward.
  if (trailing && leadOnly.has(word)) return false;
  if (trailing && repairCue.test(fold(source.slice(marker[1])))) {
    const next = typed.filter(item => item.span[0] >= marker[1]).sort((a, b) => a.span[0] - b.span[0])[0];
    if (next && next.field === field && repairGap.test(fold(source.slice(marker[1], next.span[0])))) return true;
  }
  if (clauseBoundary.test(leading ? /^[^\p{L}\p{N}]*/u.exec(trail)![0] : /[^\p{L}\p{N}]*$/u.exec(lead)![0])) return false;
  return !positive.some(([start, end]) => leading
    ? end <= marker[0] && !leadOnly.has(word) && joined(source.slice(end, marker[0])) || start >= span[1] && joined(source.slice(span[1], start))
    : start >= marker[1] && joined(source.slice(marker[1], start)));
}
/** Proves the exclusions of one action against the message it is grounded on. `positive`: the action's affirmed quotes. */
export function verifyTemporalExclusions(source: string | undefined, positive: SchedulingTemporalEvidence, excluded: SchedulingTemporalEvidence,
  options: { today: string; operation?: string; legacy: LegacyExclusionReader }): TemporalExclusions {
  const result: TemporalExclusions = { verified: [], claimed: [], codes: [] };
  const positiveSpans = source === undefined ? [] : positive.flatMap(entry => literalSpans(source, entry.text));
  const typed = source === undefined ? [] : positive.flatMap(entry => literalSpans(source, entry.text).map(span => ({ span, field: entry.field as string })));
  const located: { entry: Entry; proof: ReturnType<typeof locate> }[] = [];
  for (const entry of excluded) {
    const field = entry.field as ExcludedField;
    if (!["date", "time", "source_date", "source_time", "end_time"].includes(field)) { result.codes.push("TEMPORAL_EXCLUSION_FIELD"); continue; }
    result.claimed.push({ field, values: claimedValues(field, entry.excluded!, options.today, options.operation) });
    located.push({ entry, proof: source === undefined ? { code: "LITERAL" } : locate(source, entry, positiveSpans) });
  }
  // Exclusions are disjoint from each other too: overlapping ones prove nothing.
  const spans = located.flatMap(item => "span" in item.proof ? [item.proof.span] : []);
  for (const { entry, proof } of located) {
    if (!("span" in proof)) { result.codes.push(`TEMPORAL_EXCLUSION_${proof.code}`); continue; }
    if (spans.filter(([a, b]) => a < proof.span[1] && proof.span[0] < b).length > 1) { result.codes.push("TEMPORAL_EXCLUSION_OVERLAP"); continue; }
    const values = provenValues(proof.remainder, entry, options.today, options.operation, options.legacy);
    if (values === "SHAPE" || !values?.length) { result.codes.push(`TEMPORAL_EXCLUSION_${values === "SHAPE" ? "SHAPE" : "VALUE"}`); continue; }
    const owned = ownsMarker(source!, proof.span, proof.marker, positiveSpans, entry.field, typed);
    result.verified.push({ field: entry.field as ExcludedField, values, literal: entry.text, span: proof.span, marker: proof.marker, owned });
    result.codes.push("TEMPORAL_EXCLUSION_VERIFIED");
    // A negator marker whose attachment is ambiguous keeps denying (codes only).
    if (!owned && negators.has(fold(source!.slice(proof.marker[0], proof.marker[1])))) result.codes.push("TEMPORAL_EXCLUSION_UNOWNED");
  }
  return result;
}
/** The message for the evidence-less (regex) fallback: a proven exclusion's atom is not a value to demand or match,
 * but its marker stays, so the historical global negation guard still reads it (never a weaker acceptance). */
export function maskExcludedAtoms(source: string, exclusions: TemporalExclusions) {
  const chars = source.split("");
  for (const { span, marker } of exclusions.verified) for (let at = span[0]; at < span[1]; at++) if (at < marker[0] || at >= marker[1]) chars[at] = " ";
  return chars.join("");
}
/** Marker spans (original offsets) of proven exclusions that OWN their negator (unambiguous attachment): the only
 * negators neutralized. */
export const ownedNegators = (exclusions: TemporalExclusions | undefined, source: string): Span[] =>
  (exclusions?.verified ?? []).filter(item => item.owned && negators.has(fold(source.slice(item.marker[0], item.marker[1])))).map(item => item.marker);

type Grounded = { fields: SchedulingFields; patch: SchedulingFields; rejected: TemporalRejection[];
  pending_temporal_ambiguities: PendingTemporalAmbiguity[]; pending_calendar_conflicts: PendingCalendarConflict[] };
/** An effective value the same message excluded (by the exclusion's own value, proven or not) is refused and asked
 * (never swapped for another value); its pending half-day/calendar question goes with it and so does a located appointment. */
export function rejectExcludedValues<T extends Grounded>(grounded: T, exclusions: TemporalExclusions): T {
  const excluded = new Map<string, Set<string>>();
  for (const item of exclusions.claimed) for (const value of item.values) excluded.set(item.field, new Set([...excluded.get(item.field) ?? [], value]));
  let rejected = false;
  for (const [field, values] of excluded) {
    const key = field as ExcludedField, value = grounded.fields[key];
    if (value === undefined || !values.has(value)) continue;
    delete grounded.fields[key]; delete grounded.patch[key]; rejected = true;
    grounded.rejected = [...grounded.rejected.filter(item => item.field !== key), { code: "SOURCE_TEMPORAL_CONFLICT", field: key, value: EXCLUDED_VALUE }];
    grounded.pending_temporal_ambiguities = grounded.pending_temporal_ambiguities.filter(item => item.field !== key);
    grounded.pending_calendar_conflicts = grounded.pending_calendar_conflicts.filter(item => item.field !== key);
  }
  if (rejected) delete grounded.fields.appointment_ref;
  return grounded;
}
/** Codes-only divergence of one grounding's exclusions (telemetry). */
export const polarityCodes = (grounded: { rejected: readonly TemporalRejection[]; exclusions?: TemporalExclusions }) => grounded.exclusions
  ? [...new Set([...grounded.exclusions.codes, ...grounded.rejected.some(item => item.value === EXCLUDED_VALUE) ? ["TEMPORAL_EXCLUDED_AFFIRMED"] : []])] : [];
/** Proven destination clocks the owner excluded: the backend does not offer them as alternatives. */
export function excludedClocks(exclusions: TemporalExclusions | undefined): ReadonlySet<string> | undefined {
  const clocks = new Set((exclusions?.verified ?? []).filter(item => item.field === "time").flatMap(item => item.values));
  return clocks.size ? clocks : undefined;
}

/** An action's STRUCTURALLY proven exclusions (unique, one marker, temporal-only without it, disjoint from its quotes). */
function structuralExclusions(source: string, evidence: SchedulingTemporalEvidence | undefined): { span: Span; marker: Span }[] {
  const { positive, excluded } = splitTemporalExclusions(evidence);
  const positiveSpans = positive.flatMap(entry => literalSpans(source, entry.text));
  return excluded.flatMap(entry => {
    const proof = locate(source, entry, positiveSpans);
    if (!("span" in proof)) return [];
    const shape = quoteTemporalShape(proof.remainder);
    return shape.temporalOnly && !(isDateField(entry.field) ? shape.clock : shape.day) ? [{ span: proof.span, marker: proof.marker }] : [];
  });
}
/** Sibling masking (no clock needed): the literal spans of an action's structurally proven exclusions (its own text,
 * never blanked by a sibling). A sibling's value check needs its own grounding. */
export const exclusionSpans = (source: string, evidence: SchedulingTemporalEvidence | undefined): Span[] => structuralExclusions(source, evidence).map(item => item.span);
/** What a SIBLING's view blanks of those exclusions: the atom only. The marker stays visible (as maskExcludedAtoms does),
 * so the negator never disappears from another action's view (review). */
export const exclusionAtomSpans = (source: string, evidence: SchedulingTemporalEvidence | undefined): Span[] =>
  structuralExclusions(source, evidence).flatMap(({ span, marker }) => ([[span[0], marker[0]], [marker[1], span[1]]] as Span[]).filter(([start, end]) => end > start));
