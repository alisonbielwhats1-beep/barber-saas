import { temporalNegativeContextProof } from '../../packages/salon-secretary/src/temporal-negative-context';
export { temporalNegativeContextProof, type TemporalNegativeContextProof } from '../../packages/salon-secretary/src/temporal-negative-context';
import type { SchedulingFields } from "./scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../packages/salon-secretary/src/scheduling-skill";
import type { TemporalSpan } from "./scheduling-temporal-components";
import { isDateKey, weekdayOfDateKey } from "./time";

type DraftIdentity = { draft_ref: string; draft_revision: number };
/** Both sides come from the backend, not from the proof/model. scope_valid must
 * include the caller's tenant/user/session/item binding. expected is the draft
 * routed for this turn; current is re-read from the live action before use. */
export type TemporalNegativeContextBinding = {
  expectedDraft: DraftIdentity;
  liveDraft: DraftIdentity & { expires_at: string; scope_valid: boolean; fields: SchedulingFields };
};
export type TemporalNegativeContextInput = {
  proof: unknown;
  binding?: TemporalNegativeContextBinding;
};
type ContextValidation = { valid: true; ignoredNegators: TemporalSpan[] } | {
  valid: false; ignoredNegators: []; reason: "SHAPE" | "OPERATION" | "LITERAL" | "OVERLAP" | "POSITIVE_PROOF" | "ANCHOR" | "BINDING" | "RESIDUAL_NEGATION";
};
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const intersects = (a: TemporalSpan, b: TemporalSpan) => a.start < b.end && b.start < a.end;
const contains = (a: TemporalSpan, b: TemporalSpan) => a.start <= b.start && a.end >= b.end;
const negativeWords = new Set(["nao", "nunca", "jamais", "nem"]);
const weekdays = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const calendarMonths=/\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/;
function negators(text: string): TemporalSpan[] {
  // Original offsets survive decomposed Unicode. No normalized-text masking.
  return [...text.matchAll(/[\p{L}\p{M}]+/gu)].filter(match => negativeWords.has(normalize(match[0])))
    .map(match => ({ start: match.index!, end: match.index! + match[0].length }));
}
function uniqueSpan(source: string, text: string): TemporalSpan | undefined {
  const start = source.indexOf(text);
  if (start < 0 || source.indexOf(text, start + 1) >= 0) return;
  const end=start+text.length;
  // Check original code points, not normalized offsets or ASCII \b. A proof
  // may not clip letters, digits, combining marks or identifier continuations.
  const word=/[\p{L}\p{M}\p{N}\p{Pc}\u200c\u200d]/u;
  const first=Array.from(text)[0]??"",last=Array.from(text).at(-1)??"";
  const before=Array.from(source.slice(0,start)).at(-1)??"",after=Array.from(source.slice(end))[0]??"";
  if(word.test(first)&&word.test(before)||word.test(last)&&word.test(after))return;
  return { start, end };
}
function completeClause(source: string, span: TemporalSpan) {
  const before = source.slice(0, span.start).trimEnd(), after = source.slice(span.end).trimStart();
  const text = source.slice(span.start, span.end);
  return (!before || /[.!?;,:]$/.test(before)) &&
    (!after || /^[.!?;,:]/.test(after) || /[.!?;,:]$/.test(text)) &&
    !/[.!?;].*\p{L}/u.test(text);
}
const temporalTokens = /\d|\b(?:hoje|amanha|depois|domingo|segunda|terca|quarta|quinta|sexta|sabado|dia|dias|semana|semanas|mes|meses|ano|anos|manha|tarde|noite|seguinte|proxim[oa]|anterior|passad[oa]|hora|horas|minuto|minutos|meio|meia|zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|cem|cento)\b/;
function calendarAnchor(text: string, accepted: string) {
  const normalized = normalize(text);
  if (isDateKey(normalized)) return normalized === accepted;
  const calendar = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (calendar) return `${calendar[3]}-${calendar[2]}-${calendar[1]}` === accepted;
  const weekday = weekdays.indexOf(normalized.replace(/^(segunda|terca|quarta|quinta|sexta)-feira$/, "$1"));
  return weekday >= 0 && weekdayOfDateKey(accepted) === weekday;
}
function bindingMatches(binding: TemporalNegativeContextBinding | undefined, previous: SchedulingFields, now: Date) {
  if (!binding) return false;
  const { liveDraft: current, expectedDraft: expected } = binding;
  return current.scope_valid === true && !!current.draft_ref && Number.isInteger(current.draft_revision) && current.draft_revision > 0 &&
    current.draft_ref === expected.draft_ref && current.draft_revision === expected.draft_revision && Date.parse(current.expires_at) > now.getTime() &&
    Object.keys(current.fields).length === Object.keys(previous).length && Object.entries(previous).every(([key, value]) =>
      JSON.stringify(value) === JSON.stringify(current.fields[key as keyof SchedulingFields]));
}

/** Verify factual separation only. This does not infer the semantic role, change
 * a field, grant override, choose a date or accept a confirmation. A false role
 * label that has no observable factual contradiction remains a model error and
 * requires semantic evaluation; this function is not a Portuguese interpreter. */
export function validateTemporalNegativeContext(input: TemporalNegativeContextInput, args: {
  source: string; previous: SchedulingFields; raw: SchedulingFields;
  evidence: SchedulingTemporalEvidence | undefined; operation: string | undefined; now: Date;
}): ContextValidation {
  const fail = (reason: Extract<ContextValidation, { valid: false }>["reason"]): ContextValidation => ({ valid: false, ignoredNegators: [], reason });
  const proof = temporalNegativeContextProof.safeParse(input.proof);
  if (!proof.success) return fail("SHAPE");
  // Consent/alternative-slot is the existing creation-only domain. No new
  // capability, cancellation or read polarity is introduced here.
  if (args.operation !== "appointment.create") return fail("OPERATION");
  const entries = args.evidence ?? [];
  const positiveSpans: TemporalSpan[] = [];
  for (const entry of entries) {
    const span = uniqueSpan(args.source, entry.text);
    if (!span) return fail("POSITIVE_PROOF");
    positiveSpans.push(span);
  }
  const supplied = ["date", "source_date", "end_date", "time", "source_time", "end_time"] as const;
  const needed = supplied.filter(field => args.raw[field] !== undefined || field === "date" && (args.raw.weekday !== undefined || args.raw.day_offset !== undefined) ||
    field === "source_date" && (args.raw.source_weekday !== undefined || args.raw.source_day_offset !== undefined));
  if (!needed.length || needed.some(field => entries.filter(entry => entry.field === field).length !== 1)) return fail("POSITIVE_PROOF");
  // Named entities and all current temporal witnesses stay visible. The semantic
  // label may not consume them even if the declared context is otherwise literal.
  const protectedSpans = [...positiveSpans];
  const protectedNames: string[]=[];
  for (const fields of [args.previous, args.raw]) for (const key of ["customer_name", "service_name", "professional_name"] as const) {
    const name = fields[key]; if (!name) continue;
    protectedNames.push(normalize(name));
    for (let at = args.source.indexOf(name); at >= 0; at = args.source.indexOf(name, at + 1)) protectedSpans.push({ start: at, end: at + name.length });
  }
  const contexts: TemporalSpan[] = [], ignoredNegators: TemporalSpan[] = [];
  const allNegators = negators(args.source);
  for (const entry of proof.data.negative_context) {
    const span = uniqueSpan(args.source, entry.literal), anchor = uniqueSpan(args.source, entry.anchor.literal);
    if (!span || !anchor || !contains(span, anchor) || !completeClause(args.source, span)) return fail("LITERAL");
    if (contexts.some(other => intersects(span, other)) || protectedSpans.some(other => intersects(span, other))) return fail("OVERLAP");
    const normalizedContext=normalize(entry.literal);
    if(protectedNames.some(name=>new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:$|[^\\p{L}\\p{N}])`,"u").test(normalizedContext)))return fail("OVERLAP");
    const denied = allNegators.filter(negative => contains(span, negative));
    // Each proof witnesses one negative role. Multiple denials in a compound
    // clause require clarification; a label cannot absorb a second refusal.
    if (denied.length!==1) return fail("LITERAL");
    const between=args.source.slice(Math.min(denied[0].end,anchor.end),Math.max(denied[0].start,anchor.start));
    if (/[.!?;,:]/.test(between)) return fail("ANCHOR");
    const rest = normalize(entry.literal.slice(0, anchor.start - span.start) + " " + entry.literal.slice(anchor.end - span.start));
    if (temporalTokens.test(rest)||calendarMonths.test(rest)) return fail("ANCHOR");
    if (entry.role === "OVERRIDE_CONSENT") {
      if (args.raw.override_requested !== false || !["sobreposicao", "encaixe"].includes(normalize(entry.anchor.literal))) return fail("ANCHOR");
    } else {
      if (!bindingMatches(input.binding, args.previous, args.now)) return fail("BINDING");
      const previousDate = args.previous[entry.anchor.field];
      if (!previousDate || !isDateKey(previousDate) || !calendarAnchor(entry.anchor.literal, previousDate)) return fail("ANCHOR");
      const target = args.raw[entry.anchor.field];
      // This finite contract requires an explicit different calendar target. It
      // never resolves a current relative date in order to manufacture separation.
      if (!target || target === previousDate || !isDateKey(target)) return fail("ANCHOR");
    }
    contexts.push(span); ignoredNegators.push(...denied);
  }
  if (!allNegators.length || allNegators.some(negative => !ignoredNegators.some(span => contains(span, negative)))) return fail("RESIDUAL_NEGATION");
  return { valid: true, ignoredNegators };
}
