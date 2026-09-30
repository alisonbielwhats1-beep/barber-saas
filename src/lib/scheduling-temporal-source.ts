import { resolveSchedulingDate, type SchedulingFields } from "./scheduling-contract";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, weekdayOfDateKey } from "./time";
import { temporalEvidence, type SchedulingTemporalEvidence } from "../../packages/salon-secretary/src/scheduling-skill";
import { matchesSchedulingPeriod, type TemporalRejection } from "./scheduling-temporal";
import type { PendingTemporalAmbiguity, TemporalAmbiguityContext } from "./scheduling-temporal-ambiguity";
import { pendingCalendarConflicts, type PendingCalendarConflict } from "./scheduling-calendar-conflict";
import { clockComponents, componentClockWitness, maskTemporalSpans, relativeDayComponents, sharedIntervalWitness } from "./scheduling-temporal-components";
import { validateTemporalNegativeContext, type TemporalNegativeContextInput } from "./scheduling-temporal-negative-context";
import { literalSpans, normalizedOffsets } from "../../packages/salon-secretary/src/literal-match";
import { temporalComponentsEnabled } from "../../packages/salon-secretary/src/temporal-components";
import { maskExcludedAtoms, ownedNegators, rejectExcludedValues, splitTemporalExclusions, verifyTemporalExclusions, type TemporalExclusions } from "./scheduling-temporal-polarity";
import { UNSPECIFIED_DAYPART_ASKED_HOURS } from "./scheduling-temporal-reference";
import { dateChoiceAnswer, dateRulesV2Enabled, quoteTemporalShape, temporalScan, temporalVocabulary, withoutGreetings } from "./scheduling-temporal-reference";

const weekdays = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const numbers: Record<string, number> = { zero: 0, uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };
function number(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(" e ");
  return parts.every(p => numbers[p] !== undefined) ? parts.reduce((sum, p) => sum + numbers[p], 0) : NaN;
}
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** The normalized text the grammar reads, with offsets back to what the user wrote.
 * A Luna quote is located by tolerant whole-token spans of the ORIGINAL message
 * (case, accents, spacing), never by the first normalized occurrence. Several
 * occurrences prefer the only one inside the caller's role range; an unresolved
 * repeat keeps the historical first occurrence (and so its rejection). */
function sourceView(source: string) {
  const map = normalizedOffsets(source, normalize);
  const text = map?.text ?? normalize(source), toText = (at: number) => map ? map.toNormalized(at) : at;
  const toRaw = (at: number) => map ? map.toOriginal(at) : at;
  const locate = (literal: string, range?: readonly [number, number]) => {
    // Unmappable normalization (exotic mark reordering): keep the exact legacy proof.
    if (!map) { const quote = normalize(literal), at = source.includes(literal) ? text.indexOf(quote) : -1; return at < 0 ? undefined : { start: at, end: at + quote.length, unique: false }; }
    const spans = literalSpans(source, literal).map(([start, end]) => ({ start: toText(start), end: toText(end), exact: source.slice(start, end) === literal.trim() }));
    if (!spans.length) return;
    const exact = (list: typeof spans) => list.some(span => span.exact) ? list.filter(span => span.exact) : list;
    const scoped = range ? spans.filter(span => span.start < range[1] && span.end > range[0]) : spans;
    const pool = exact(scoped.length ? scoped : spans), chosen = pool.length === 1 ? pool[0] : exact(spans)[0];
    return { start: chosen.start, end: chosen.end, unique: pool.length === 1 };
  };
  /** Every occurrence of a quote (normalized offsets), for coverage rather than proof. */
  const all = (literal: string): [number, number][] => {
    if (!map) { const quote = normalize(literal).trim(), found: [number, number][] = []; if (!quote) return found;
      for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) found.push([at, at + quote.length]); return found; }
    return literalSpans(source, literal).map(([start, end]) => [toText(start), toText(end)]);
  };
  /** C4: owned negator spans (original offsets) in this view's offsets; none when the text cannot be mapped (fail closed). */
  const owned = (spans: readonly (readonly [number, number])[] | undefined): [number, number][] => map && spans ? spans.map(([start, end]) => [toText(start), toText(end)]) : [];
  return { text, toRaw, locate, all, owned };
}
const dateFields = ["date", "source_date", "end_date"] as const;
const timeFields = ["time", "source_time", "end_time"] as const;
const words = Object.keys(numbers).join("|");
const numeral = `(?:\\d{1,2}|(?:${words})(?: e (?:${words}))?)`;
const hourWords = Object.keys(numbers).filter(k => numbers[k] < 20).join("|");
const hourNumeral = `(?:\\d{1,2}|vinte(?: e (?:uma|um|duas|dois|tres))?|${hourWords})`;


/** Factual recognizers only: no operation, intent or source/destination choice. `text` is already normalized (NFD without marks,
 * lowercase); the atoms' offsets are that text's. Exported for the C5 agent validator (temporalAtomSpans maps them back). */
export function temporalFacts(text: string, fields: SchedulingFields, timezone: string, now: Date) {
  const today = dateKeyInTimeZone(now, timezone);
  // A denial directly attached to a factual atom is different from denying an
  // operation elsewhere in the message. This does not choose the operation.
  let negated = false;
  // Every recognized atom keeps its span and its own attached denial (coverage only).
  const atoms: { kind: "date" | "clock"; start: number; end: number; negated: boolean }[] = [];
  const inspect = (at: number, kind?: "date" | "clock", end = at) => {
    const denied = /\b(?:nao|nunca|jamais)(?:\s+(?:em|na|no|nas|nos|a|as|ao|aos|para|de|do|da|das|dos)){0,3}\s*$/.test(text.slice(0, at));
    if (denied) negated = true;
    if (kind) atoms.push({ kind, start: at, end, negated: denied });
  };
  const dates: string[] = [];
  for(const part of relativeDayComponents(text)){
    inspect(part.start,"date",part.end);dates.push(part.days===undefined?"INVALID":addCalendarDays(today,part.days));
  }
  let unanchoredCalendarYear = false;
  const days: number[] = [];
  const weekdayMatches = [...text.matchAll(/\b(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/g)].map(m => { inspect(m.index!, "date", m.index! + m[0].length); return weekdays.indexOf(m[1].replace("-feira", "")); });
  for (const m of text.matchAll(/\b(depois de amanha|amanha|hoje)\b/g)) { inspect(m.index!, "date", m.index! + m[0].length); dates.push(addCalendarDays(today, m[1] === "hoje" ? 0 : m[1] === "amanha" ? 1 : 2)); }
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) { inspect(m.index!, "date", m.index! + m[0].length); dates.push(m[1]); }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
    inspect(m.index!, "date", m.index! + m[0].length);
    if (!m[3]) unanchoredCalendarYear = true;
    // An omitted year is a constraint, not permission to infer a different year.
    const year = m[3] ?? fields.date?.slice(0, 4) ?? today.slice(0, 4);
    dates.push(`${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de (\d{4}))?\b/g)) {
    inspect(m.index!, "date", m.index! + m[0].length);
    if (!m[3]) unanchoredCalendarYear = true;
    dates.push(`${m[3] ?? fields.date?.slice(0, 4) ?? today.slice(0, 4)}-${String(months.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/\bdia (\d{1,2})\b/g)) { inspect(m.index!, "date", m.index! + m[0].length); days.push(Number(m[1])); }
  const components=clockComponents(text);
  const clocks: string[] = components.map(part=>{inspect(part.start,"clock",part.end);return part.value??"INVALID";});
  const scalarText=maskTemporalSpans(text,components.map(part=>part.interval??part));
  for (const m of scalarText.matchAll(/\b(\d{1,2})(?:h(?:(\d{2}))?|:(\d{2}))\b/g)) { inspect(m.index!, "clock", m.index! + m[0].length); clocks.push(`${m[1].padStart(2, "0")}:${m[2] ?? m[3] ?? "00"}`); }
  const clockPattern = new RegExp(`(?:\\b(?:as|pelas) |^\\s*)(${hourNumeral})(?:\\s*horas?)?(?: e (meia|${numeral})(?: minutos?)?)?\\b`, "g");
  const wordClockText = scalarText.replace(/\b\d{1,2}(?:h(?:\d{2})?|:\d{2})\b/g, match => " ".repeat(match.length));
  for (const m of wordClockText.matchAll(clockPattern)) {
    if (!/\b(as|pelas)\b/.test(m[0]) && !/^[\s.!?,]*(?:(?:da|a) (?:manha|tarde|noite)[\s.!?,]*)?$/.test(wordClockText.slice(m.index! + m[0].length))) continue;
    inspect(m.index!, "clock", m.index! + m[0].length);
    let hour = number(m[1]); const minute = m[2] === "meia" ? 30 : m[2] ? number(m[2]) : 0;
    // "dez e meia" must not be consumed as a compound number.
    if (hour < 12 && /\b(?:da|a) (tarde|noite)\b/.test(text)) hour += 12;
    clocks.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return { dates, days, weekdayMatches, clocks, negated, unanchoredCalendarYear, atoms };
}
/** B4 option choice: what a short quote of the owner states, only to compare with the coordinates of options
 * the backend published (never a value to apply). Dates are absolute (relative days from today), `days` days
 * of the month, clocks "HH:MM" as written (the half-day reading is the caller's). A weekday word that is also
 * an ordinal ("a segunda") is `bare`. A malformed atom makes the quote `invalid`. */
export function quoteTemporalFacts(quote: string, timezone: string, now: Date) {
  const text = normalize(quote), facts = temporalFacts(text, {}, timezone, now);
  const named = [...text.matchAll(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(-feira|\s+feira)?\b/g)]
    .map(m => ({ weekday: weekdays.indexOf(m[1]), bare: !m[2] && ["segunda", "quarta", "quinta", "sexta"].includes(m[1]) }));
  const spoken = withoutGreetings(text);
  const period = /\bmanha\b/.test(spoken) ? "morning" as const : /\btarde\b/.test(spoken) ? "afternoon" as const : /\bnoite\b/.test(spoken) ? "evening" as const : undefined;
  return { dates: facts.dates.filter(date => date !== "INVALID"), days: facts.days, weekdays: named, clocks: facts.clocks.filter(clock => clock !== "INVALID"), period,
    invalid: facts.dates.includes("INVALID") || facts.clocks.includes("INVALID") };
}
export type QuoteTemporalFacts = ReturnType<typeof quoteTemporalFacts>;

/** A denial scopes only the clause of the literal it could govern. The clause is
 * the punctuation-delimited segment containing the literal. Any negator before
 * the literal in that segment counts (including "não quero que ... às 10h");
 * a negator after it counts unless a connector opens a new clause first
 * ("às 10h e não precisa encaixar"). This never infers intent or chooses a
 * value: it only decides whether the conservative rejection applies. */
const clauseBoundary = /[,.;!?()\n]/;
const connectorWord = /\b(?:e|mas|porem|pois|porque|que|se|quando|caso|entao)\b/;
type Owned = readonly (readonly [number, number])[];
/** C4 polarity: a negator lying inside an `ignore` span (same offsets as `text`) is owned by a proven exclusion
 * ("para 11h não 10h") and does not deny; every other negator of the clause still does. */
const ownedAt = (ignore: Owned, at: number, length: number) => ignore.some(([start, end]) => at >= start && at + length <= end);
export function temporalLiteralNegated(text: string, start: number, end: number, ignore: Owned = []) {
  if (start < 0 || end <= start) return true;
  let from = start, to = end;
  while (from > 0 && !clauseBoundary.test(text[from - 1])) from--;
  while (to < text.length && !clauseBoundary.test(text[to])) to++;
  for (const match of text.slice(from, to).matchAll(/\b(?:nao|nunca|jamais|nem)\b/g)) {
    const at = from + match.index!;
    if (ownedAt(ignore, at, match[0].length)) continue;
    // Before the literal or inside the quoted literal itself.
    if (at < end) return true;
    if (!connectorWord.test(text.slice(end, at))) return true;
  }
  return false;
}
/** A read loses a filter only to a denial inside the quote or attached right before it (owned ones excepted). */
function readQuoteDenied(text: string, start: number, end: number, ignore: Owned = []) {
  for (const match of text.slice(start, end).matchAll(/\b(?:nao|nunca|jamais|nem)\b/g)) if (!ownedAt(ignore, start + match.index!, match[0].length)) return true;
  const lead = /\b(?:nao|nunca|jamais|nem)(?:\s+(?:em|na|no|nas|nos|a|as|ao|aos|para|de|do|da|das|dos)){0,3}\s*$/.exec(text.slice(0, start));
  return !!lead && !ownedAt(ignore, lead.index, /^\S+/.exec(lead[0])![0].length);
}
/** Negators that govern the clause [start,end) of `source` whoever quotes them: those in its
 * lead back to the previous clause boundary or connector, and those after it before the next
 * boundary or connector (the ones temporalLiteralNegated counts at the clause edges). Original
 * offsets; undefined when the normalization cannot be mapped back.
 * V2 (flag SALON_SECRETARY_DATE_RULES_V2): the lead is the one coordinatedLead reads, and a lead negator
 * inside an `owned` span (ORIGINAL offsets: a sibling's proven reason, see actionScopedSource) is that
 * reason's own content. Flag off: `owned` is ignored (the historical rule). */
export function governingNegators(source: string, start: number, end: number, owned: Owned = []): [number, number][] | undefined {
  const map = normalizedOffsets(source, normalize);
  if (!map) return;
  const text = map.text, from = map.toNormalized(start), to = map.toNormalized(end), connectors = new RegExp(connectorWord.source, "g");
  const { lead, trail } = punctuationClause(text, from, to);
  const spans: [number, number][] = [];
  if (dateRulesV2Enabled()) {
    const { head, next, valued } = coordinatedLead(source, map, lead, from, to, trail);
    for (const [a, b, before] of [[head, from, true], [to, next, false]] as const) for (const match of text.slice(a, b).matchAll(/\b(?:nao|nunca|jamais|nem)\b/g)) {
      const at = a + match.index!, span: [number, number] = [map.toOriginal(at), map.toOriginal(at + match[0].length)];
      if (!before || !valued(at + match[0].length) && !ownedAt(owned, span[0], span[1] - span[0])) spans.push(span);
    }
    return spans;
  }
  const last = [...text.slice(lead, from).matchAll(connectors)].at(-1), next = connectorWord.exec(text.slice(to, trail));
  for (const [a, b] of [[last ? lead + last.index! + last[0].length : lead, from], [to, next ? to + next.index : trail]] as const) {
    for (const match of text.slice(a, b).matchAll(/\b(?:nao|nunca|jamais|nem)\b/g)) spans.push([map.toOriginal(a + match.index!), map.toOriginal(a + match.index! + match[0].length)]);
  }
  return spans;
}
/** Connectors that open a new MAIN clause (adversative or sequential): a negation before them never reaches past them. */
const newMainClause = new Set(["mas", "porem", "entao"]);
/** Closed class of the prepositions and articles between a negator and the temporal atom it denies ("não às três", "nem no sábado"). */
const valueGlue = /^(?:\s+(?:em|na|no|nas|nos|a|as|ao|aos|para|pra|pro|de|do|da|das|dos)){0,3}\s+/;
/** C4 (flag SALON_SECRETARY_DATE_RULES_V2): the lead of the clause [from,to) whose negators govern it, the same whatever the
 * interpretation's scope took in. The clause's own opening connectors (at the start of its scope, or right before it with only
 * blanks between) are transparent when additive ("e") or subordinating, so a predicate negator of the conjunct before it keeps
 * governing it ("não precisa trocar a Lia e bloquear a Iara amanhã"); a subordinator the opener repeats is transparent too ("não
 * quero que desmarque a Lia e que feche…"). An adversative or sequential opener ("mas", "porém", "então") starts a new main clause
 * and cuts the lead. The verb "é" (folded to "e") is no connector. `valued`: a negator directly attached to a temporal atom
 * ("às duas não às três") corrects that value in its own clause and governs no other clause. Normalized offsets. */
function coordinatedLead(source: string, map: NonNullable<ReturnType<typeof normalizedOffsets>>, lead: number, from: number, to: number, trail: number) {
  const text = map.text, blank = (a: number, b: number) => !text.slice(a, b).trim();
  const list = [...text.slice(lead, trail).matchAll(new RegExp(connectorWord.source, "g"))].map(match => ({ w: match[0], at: lead + match.index!, end: lead + match.index! + match[0].length }))
    .filter(item => item.w !== "e" || /^e$/i.test(source.slice(map.toOriginal(item.at), map.toOriginal(item.end))));
  const chain: typeof list = [];
  for (let at = from, k = list.findIndex(item => item.at >= from); k >= 0 && k < list.length && list[k].end <= to && blank(at, list[k].at); at = list[k++].end) chain.push(list[k]);
  for (let at = from, k = list.findLastIndex(item => item.end <= from); k >= 0 && blank(list[k].end, at); at = list[k--].at) chain.unshift(list[k]);
  const next = list.find(item => item.at >= to)?.at ?? trail;
  const atoms = temporalFacts(text, {}, "UTC", new Date(0)).atoms;
  const valued = (after: number) => { const glue = valueGlue.exec(text.slice(after)); return !!glue && atoms.some(atom => atom.start >= after && atom.start <= after + glue[0].length); };
  if (chain.some(item => newMainClause.has(item.w))) return { head: from, next, valued, list };
  const prior = list.filter(item => item.end <= (chain[0]?.at ?? from)), repeated = new Set(chain.map(item => item.w).filter(word => word !== "e"));
  let k = prior.length - 1;
  if (k >= 0 && repeated.has(prior[k].w)) k--;
  return { head: k >= 0 ? prior[k].end : lead, next, valued, list };
}
/** The punctuation clause [lead, trail) around the normalized span [from, to): back to the previous boundary, on to the next. */
function punctuationClause(text: string, from: number, to: number) {
  let lead = from, trail = to;
  while (lead > 0 && !clauseBoundary.test(text[lead - 1])) lead--;
  while (trail < text.length && !clauseBoundary.test(text[trail])) trail++;
  return { lead, trail };
}
/** C5 agent validator V0 (docs/c5-spike/11-especificacao-agente.md §5.1): the backend's clause of an owner quote [start, end), in
 * ORIGINAL offsets, read as governingNegators reads it (punctuation `[,.;!?()\n]` and the connectors of coordinatedLead; the verb "é"
 * is no connector). `start`/`end`: the quote's own segment, from the end of the last connector or boundary before it (the quote
 * itself when it opens with a connector) to the next connector or boundary after it; `lead`: where the negators that govern it may
 * start (across a transparent "e" or a subordinator, never across "mas/porém/então" or punctuation). The segment always holds the
 * whole quote. Undefined when the text cannot be mapped (the caller fails closed). The historical rules are unchanged. */
export function clauseBounds(source: string, start: number, end: number) {
  const map = normalizedOffsets(source, normalize);
  if (!map || start < 0 || end <= start || end > source.length) return;
  const text = map.text, from = map.toNormalized(start), to = map.toNormalized(end), { lead, trail } = punctuationClause(text, from, to);
  const { head, next, list } = coordinatedLead(source, map, lead, from, to, trail);
  const own = list.some(item => item.at === from) ? from : list.filter(item => item.end <= from).at(-1)?.end ?? lead;
  return { lead: map.toOriginal(Math.min(head, own)), start: map.toOriginal(own), end: map.toOriginal(Math.max(next, to)) };
}
/** C5 agent validator: the temporal atoms (days and clocks) of an owner's text, in ORIGINAL offsets, each with its attached denial
 * (temporalFacts). Undefined when the normalization cannot be mapped back. */
export function temporalAtomSpans(source: string, timezone: string, now: Date) {
  const map = normalizedOffsets(source, normalize);
  if (!map) return;
  return temporalFacts(map.text, {}, timezone, now).atoms.map(atom => ({ ...atom, start: map.toOriginal(atom.start), end: map.toOriginal(atom.end) }));
}

/** Denial of one quote located at ORIGINAL offsets [start,end), with the evidence path's rule:
 * a read loses a filter only to a denial attached to (or inside) the quote; a mutation to any
 * negator of the quote's own clause (temporalLiteralNegated). Unmappable text denies. */
export function temporalQuoteDenied(source: string, start: number, end: number, operation?: string, owned?: Owned) {
  const map = normalizedOffsets(source, normalize);
  if (!map) return true;
  const text = map.text, from = map.toNormalized(start), to = map.toNormalized(end), ignore = (owned ?? []).map(([a, b]) => [map.toNormalized(a), map.toNormalized(b)] as const);
  return ["appointment.read", "appointment.list", "availability.get"].includes(operation ?? "")
    ? readQuoteDenied(text, from, to, ignore) : temporalLiteralNegated(text, from, to, ignore);
}
/** The privative preposition "sem" (a closed grammatical class of one word) directly governing a quote, through at most one
 * article or indefinite/negative determiner (closed classes): "sem barba", "sem a barba", "sem nenhuma escova". */
const privativeLead = /(?:^|[^\p{L}\p{N}])sem(?:\s+(?:o|a|os|as|um|uma|uns|umas|nenhum|nenhuma|qualquer))?\s+$/u;
/** Review A (entity literals only: services and professionals of P2a/P2b): a quote is denied by any negator of its own clause
 * (temporalQuoteDenied) or when the privative "sem" governs it directly. An entity the owner excluded ("pezinho também, sem
 * barba") is never read as affirmed. Temporal quotes keep temporalQuoteDenied. Unmappable text denies. */
export function entityQuoteDenied(source: string, start: number, end: number, operation?: string) {
  if (temporalQuoteDenied(source, start, end, operation)) return true;
  const map = normalizedOffsets(source, normalize);
  return !map || privativeLead.test(map.text.slice(0, map.toNormalized(start)));
}
/** Subject pronouns (a closed grammatical class): the customer as the subject of a predicate ("ela não pode…"). */
const subjectPronouns = new Set(["ela", "ele", "elas", "eles"]);
/** Origin prepositions (a closed grammatical class): "do dia 6" is where a move starts, i.e. the operation's own argument. */
const originPrepositions = new Set(["de", "do", "da", "dos", "das"]);
/** B6 (flag SALON_SECRETARY_DATE_RULES_V2): the only denial of a change's ORIGIN quote is a negated predicate ABOUT the
 * customer ("a Rosângela não pode no dia 06/10. Remarque ela pro dia 02/10"), not a denial of the value or of the operation.
 * Structural conditions, all required (ORIGINAL offsets; unmappable text never qualifies):
 * - the quote's punctuation clause holds exactly one negator, before the quote, and the predicate's subject (the customer
 *   name the interpretation gave, or a subject pronoun) is written before that negator in the clause — a negated command
 *   puts the negator first ("não remarque a Rosângela do dia 06/10") and keeps the historical denial;
 * - a content word (outside the closed temporal vocabulary and glue) separates the negator from the quote ("não no dia 6"
 *   keeps the denial), and no origin preposition governs the quote ("não remarca do dia 6");
 * - every destination quote (at least one) lies after that clause, in a clause without a negator.
 * The quote is then only a locator constraint (it may turn a single match into a card), never a selector or a value. */
export function negatedPredicate(source: string, quote: readonly [number, number], destinations: readonly (readonly [number, number])[], subject?: string) {
  const map = normalizedOffsets(source, normalize);
  if (!map || !destinations.length || !dateRulesV2Enabled()) return false;
  const text = map.text, from = map.toNormalized(quote[0]), to = map.toNormalized(quote[1]);
  let lead = from, trail = to;
  while (lead > 0 && !clauseBoundary.test(text[lead - 1])) lead--;
  while (trail < text.length && !clauseBoundary.test(text[trail])) trail++;
  const negators = [...text.slice(lead, trail).matchAll(/\b(?:nao|nunca|jamais|nem)\b/g)].map(match => [lead + match.index!, lead + match.index! + match[0].length] as const);
  if (negators.length !== 1 || negators[0][1] > from) return false;
  const [negator, negatorEnd] = negators[0], before = text.slice(lead, negator);
  const named = subject?.trim() ? literalSpans(source, subject).some(([start, end]) => map.toNormalized(start) >= lead && map.toNormalized(end) <= negator) : false;
  if (!named && !(before.match(/[a-z]+/g) ?? []).some(word => subjectPronouns.has(word))) return false;
  const between = text.slice(negatorEnd, to).match(/[a-z]+|\d+/g) ?? [];
  const anchor = between.findIndex(word => /^\d/.test(word) || word === "dia" || quoteTemporalShape(word).day);
  if (anchor < 1 || !between.slice(0, anchor).some(word => !temporalVocabulary(word)) || originPrepositions.has(between[anchor - 1])) return false;
  return destinations.every(([start, end]) => { const a = map.toNormalized(start), b = map.toNormalized(end); return a >= trail && !temporalLiteralNegated(text, a, b); });
}

function sourceNegatesTemporal(text: string, fields: SchedulingFields, timezone: string, now: Date, operation?: string) {
  // A read cannot carry out a negated mutation. Its explicit factual filters
  // remain usable; direct denial of a date/clock still requires clarification.
  if (["appointment.read", "appointment.list", "availability.get"].includes(operation ?? "")) return temporalFacts(text, fields, timezone, now).negated;
  return /\bnao\b/.test(text.replace(/^\s*nao,\s*/, ""));
}

/** The model chooses a semantic role and selector kind. This only narrows its
 * literal evidence to one complete factual atom of that kind. Disconnected
 * discourse dates do not become constraints on an explicitly supplied weekday;
 * adjacent qualifiers (weekday + calendar date) remain one indivisible atom. */
function dateExpressions() {
  const atom = `(?:depois de amanha|amanha|hoje|${weekdays.join("|")})(?:-feira)?|(?:dia )?(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{4})?|\\d{1,2} de (?:${months.join("|")})(?: de \\d{4})?)|dia \\d{1,2}`;
  return new RegExp(`\\b(?:${atom})(?:[\\s,]+(?:${atom}))*\\b`, "g");
}
function clockExpressions() {
  return new RegExp("\\b(?:\\d{1,2}(?:h(?:\\d{2})?|:\\d{2})|"+hourNumeral+"(?:\\s*horas?)?(?: e (?:meia|"+numeral+")(?: minutos?)?)?)(?:\\s+(?:da|a) (?:manha|tarde|noite))?\\b","g");
}
/** A short factual reply contains only recognized temporal atoms and their
 * connectors. Quote length is not evidence of a conversational decision. */
function isTemporalFragment(text: string) {
  const rest=text.replace(dateExpressions()," ").replace(clockExpressions()," ")
    .replace(/\b(?:manha|tarde|noite)\b/g," ")
    .replace(/\b(?:as|a|ao|aos|em|no|na|nas|nos|de|do|da|das|dos|pelas|para|ate|e)\b/g," ")
    .replace(/[\s.,!?;:()[\]-]/g,"");
  return rest.length===0;
}
const canonicalTemporalFragment = (text: string) => normalize(text).replace(/^[\s.,!?;:()[\]-]+|[\s.,!?;:()[\]-]+$/g, "");
function dateWitness(quote: string, raw: SchedulingFields, field: typeof dateFields[number]) {
  const weekday = field === "source_date" ? raw.source_weekday : field === "date" ? raw.weekday : undefined;
  const offset = field === "source_date" ? raw.source_day_offset : field === "date" ? raw.day_offset : undefined;
  const relative=relativeDayComponents(quote);
  const atoms = [...quote.matchAll(dateExpressions())].filter(atom=>!relative.some(part=>atom.index!>=part.start&&atom.index!+atom[0].length<=part.end)).map(atom=>({text:atom[0],offset:atom.index!,relative:false}));
  atoms.push(...relative.map(atom=>({text:quote.slice(atom.start,atom.end),offset:atom.start,relative:true})));
  const candidates = weekday !== undefined ? atoms.filter(atom => new RegExp(`\\b(?:${weekdays.join("|")})\\b`).test(atom.text))
    : offset !== undefined ? atoms.filter(atom => atom.relative||/\b(?:hoje|amanha)\b/.test(atom.text)) : atoms;
  return candidates.length === 1 ? {text:candidates[0].text, offset:candidates[0].offset} : undefined;
}

/** A quote must contain complete temporal atoms. For example, 'amanhã' is
 * literal inside 'depois de amanhã', but is not evidence for day_offset=1.
 * `at` is the located occurrence; the first occurrence is only the legacy default. */
function completeTemporalQuote(source: string, quote: string, at = source.indexOf(quote)) {
  if (at < 0 || source.slice(at, at + quote.length) !== quote) return false;
  const end = at + quote.length;
  const components=clockComponents(source);
  for(const part of [...components,...relativeDayComponents(source)]){
    if(part.start<end&&part.end>at&&(part.start<at||part.end>end))return false;
  }
  // One literal temporal expression includes all its numeric/weekday/daypart
  // qualifiers. Clipping a recognized atom must not hide a factual conflict.
  const dateExpression = dateExpressions();
  const clockExpression = new RegExp(`\\b(?:\\d{1,2}(?:h(?:\\d{2})?|:\\d{2})|${hourNumeral}(?:\\s*horas?)?(?: e (?:meia|${numeral})(?: minutos?)?)?)(?:\\s+(?:da|a) (?:manha|tarde|noite))?\\b`, "g");
  const scalarSource=maskTemporalSpans(source,components.map(part=>part.interval??part));
  for (const expression of [dateExpression, clockExpression]) for (const match of (expression===clockExpression?scalarSource:source).matchAll(expression)) {
    const from = match.index!, to = from + match[0].length;
    if (from < end && to > at && (from < at || to > end)) return false;
  }
  return true;
}

/** Bind only explicit relational clauses. This does not choose dates/clocks:
 * each clause still has to corroborate the corresponding model field below.
 * Unrecognized/negative relations keep the conservative clarification path. */
function temporalRoleClauses(text: string, operation?: string, colloquial = false, ignore: Owned = []) {
  if (!["appointment.change","schedule.block"].includes(operation??"")) return;
  const temporalStart = `(?:\\d|hoje\\b|amanha\\b|depois de amanha\\b|dia\\b|${weekdays.join("\\b|")}\\b|${Object.keys(numbers).join("\\b|")}\\b)`;
  const origin = new RegExp(`\\b(?:de|das|do)\\s+(?=${temporalStart})`).exec(text);
  if (!origin) return;
  const rest = text.slice(origin.index + origin[0].length);
  // Components mode also reads the colloquial destination ("de amanhã às 10 pra sexta").
  const to = colloquial && operation === "appointment.change" ? "(?:para|pra|pro|pras|pros)" : "para";
  const destination = (operation==="schedule.block" ? /\b(?:ate|as)\s+(?:as\s+)?/ : new RegExp(`\\b${to}\\s+(?:(?:as|o dia|dia)\\s+)?`)).exec(rest);
  if (!destination || /[.;!?]/.test(rest.slice(0, destination.index)) || new RegExp(`\\b${to}\\b`).test(rest.slice(destination.index + destination[0].length))) return;
  // A denial inside the origin→destination relation keeps the conservative path;
  // a separate clause (for example a cancellation or block reason) does not.
  const relationEnd = origin.index + origin[0].length + destination.index + destination[0].length;
  const tail = text.slice(relationEnd).search(clauseBoundary);
  if (temporalLiteralNegated(text, origin.index, tail < 0 ? text.length : relationEnd + tail, ignore)) return;
  const prefix=text.slice(0,origin.index);
  // A date before the origin clause of a move has no proven role. Keep the
  // fail-safe path instead of silently treating it as origin or destination.
  if(operation==="appointment.change"&&new RegExp(`\\b(?:hoje|amanha|${weekdays.join("|")})\\b|\\d`).test(prefix))return;
  const split = origin.index + origin[0].length + destination.index;
  return { source: (operation==="schedule.block"?prefix:"")+rest.slice(0, destination.index), destination: rest.slice(destination.index + destination[0].length),
    sourceRange: [operation === "schedule.block" ? 0 : origin.index + origin[0].length, split] as const,
    destinationRange: [split + destination[0].length, text.length] as const };
}
/** Components mode: the explicit origin→destination (move) or start→end (block) relation of a
 * message in ORIGINAL offsets, the colloquial "pra/pro" destination included; undefined when the
 * message states no such relation. `endSegment` is the end clock's own segment (up to a clause
 * boundary or connector), where the only day of a single-day block may follow its interval. */
export function componentRoleRelation(source: string, operation?: string, owned?: Owned) {
  const view = sourceView(source), clauses = temporalRoleClauses(view.text, operation, true, view.owned(owned));
  if (!clauses) return;
  const [from, to] = clauses.destinationRange, cut = view.text.slice(from, to).search(new RegExp(`${clauseBoundary.source}|${connectorWord.source}`));
  const raw = ([a, b]: readonly [number, number]): [number, number] => [view.toRaw(a), view.toRaw(b)];
  return { origin: raw(clauses.sourceRange), destination: raw(clauses.destinationRange), endSegment: raw([from, cut < 0 ? to : from + cut]) };
}
/** Complete date atoms (adjacent qualifiers are one atom) plus relative-day components. */
function dateAtomCount(text: string) {
  const relative = relativeDayComponents(text);
  return [...text.matchAll(dateExpressions())].filter(atom => !relative.some(part => atom.index! >= part.start && atom.index! + atom[0].length <= part.end)).length + relative.length;
}
type TemporalRole = typeof dateFields[number] | typeof timeFields[number];
/** Role ranges of an explicit relation. A block whose only day is written AFTER its
 * interval ("das 10 às 11 do dia 28", "das 14h às 18h de sexta") states one day: with no
 * date in the start clause and no different end date sent, the single date atom of the end
 * clause is the block's `date` and no end date is demanded. That atom must belong to the end
 * clock's own segment (before any clause boundary or connector): a date in a following
 * clause ("… às 11 e cancela a Amanda de amanhã", "… porque ele vai ao médico amanhã") is
 * not the block's day. A real multi-day block names its start day in the start clause
 * ("de sexta às 18h até segunda às 9h") and still needs end_date. */
function temporalRoles(text: string, operation: string | undefined, raw: SchedulingFields, ignore: Owned = []) {
  const clauses = temporalRoleClauses(text, operation, false, ignore);
  if (!clauses) return { clauses, ranges: {} as Partial<Record<TemporalRole, readonly [number, number]>>, singleDay: false };
  const [endFrom, endTo] = clauses.destinationRange, cut = text.slice(endFrom, endTo).search(new RegExp(`${clauseBoundary.source}|${connectorWord.source}`));
  const segmentEnd = cut < 0 ? endTo : endFrom + cut;
  // One atom can only name one day: an end date equal to the start date is still a single day.
  const singleDay = operation === "schedule.block" && (raw.end_date === undefined || raw.end_date === raw.date) && !dateAtomCount(clauses.source) &&
    dateAtomCount(clauses.destination) === 1 && dateAtomCount(text.slice(endFrom, segmentEnd)) === 1;
  const ranges: Partial<Record<TemporalRole, readonly [number, number]>> = operation === "schedule.block"
    ? { date: singleDay ? [clauses.sourceRange[0], segmentEnd] : clauses.sourceRange, time: clauses.sourceRange, end_date: clauses.destinationRange, end_time: clauses.destinationRange }
    : { source_date: clauses.sourceRange, source_time: clauses.sourceRange, date: clauses.destinationRange, time: clauses.destinationRange };
  // Each clause names the date/time roles its atoms prove.
  const roles = operation === "schedule.block"
    ? [[clauses.source, "date", "time"], [clauses.destination, singleDay ? "date" : "end_date", "end_time"]] as const
    : [[clauses.source, "source_date", "source_time"], [clauses.destination, "date", "time"]] as const;
  return { clauses, ranges, singleDay, roles };
}

/** This month's date with that day, or its next occurrence from today (months without it skipped). */
function dayOfMonthReading(date: string, today: string) {
  if (date.slice(0, 7) === today.slice(0, 7)) return true;
  const day = Number(date.slice(8)), [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let k = 0; k < 13; k++) {
    const key = `${year + Math.floor((month - 1 + k) / 12)}-${String((month - 1 + k) % 12 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isDateKey(key) && key >= today) return key === date;
  }
  return false;
}
/** A conservative source guard, not an interpreter. Never substitutes a model
 * value with a guessed correction. Ambiguous references require clarification. */
function groundSchedulingTemporalBase(previous: SchedulingFields, raw: SchedulingFields, source: string | undefined, timezone: string, now: Date, waitingFor?: string, operation?: string, evidence?: SchedulingTemporalEvidence, retargetedFields = new Set<string>(), negativeContextValid?: boolean, owned?: Owned, fallbackSource?: string): { fields: SchedulingFields; patch: SchedulingFields; rejected: TemporalRejection[] } {
  const unambiguous = { ...raw };
  const selectorConflicts: ("date" | "source_date")[] = [];
  for (const [dateKey, offsetKey, weekdayKey] of [["date", "day_offset", "weekday"], ["source_date", "source_day_offset", "source_weekday"]] as const) {
    const date = raw[dateKey], offset = raw[offsetKey], weekday = raw[weekdayKey];
    if ([date, offset, weekday].filter(v => v !== undefined).length < 2) continue;
    // Multiple selectors may corroborate an explicit date; never override a
    // contradictory one by choosing the model's preferred field.
    const compatible = date && (weekday === undefined || weekdayOfDateKey(date) === weekday) && (offset === undefined || resolveSchedulingDate({day_offset:offset}, timezone, now).date === date);
    delete unambiguous[offsetKey]; delete unambiguous[weekdayKey];
    if (!compatible) { delete unambiguous[dateKey]; selectorConflicts.push(dateKey); }
  }
  const patch = resolveSchedulingDate(unambiguous, timezone, now);
  const fields: SchedulingFields = { ...previous, ...patch };
  const rejected: TemporalRejection[] = [];
  for (const field of selectorConflicts) {
    rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:raw[field] ?? "AMBIGUOUS"});
    delete fields[field]; delete patch[field];
  }
  if (evidence?.length) {
    const proof = temporalEvidence.safeParse(evidence);
    const view = source === undefined ? undefined : sourceView(source);
    const text = view?.text;
    // C4: only the negators of proven exclusions are neutralized, and only on this evidence path.
    const ignore = view?.owned(owned) ?? [];
    const relation = text === undefined ? undefined : temporalRoles(text, operation, raw, ignore);
    const roleRanges = relation?.ranges ?? {};
    const temporalKeys = [...dateFields, ...timeFields];
    // Evidence verifies effective values; it cannot create an absent value or
    // an additional required selector. Actual missing facts in explicit role
    // clauses are still detected below, independently of evidence labels.
    const keys = temporalKeys.filter(field => patch[field] !== undefined || fields[field] !== undefined && evidence.some(item => item.field === field));
    if (relation?.roles) {
      for (const [clause, dateKey, timeKey] of relation.roles) {
        const facts = temporalFacts(clause, { date: fields[dateKey] }, timezone, now);
        if (!fields[dateKey] && facts.dates.length + facts.days.length + facts.weekdayMatches.length && !keys.includes(dateKey)) keys.push(dateKey);
        if (!fields[timeKey] && facts.clocks.length && !keys.includes(timeKey)) keys.push(timeKey);
      }
    }
    // A dormant backend proof, when supplied, keeps its all-or-nothing contract.
    // Otherwise each quoted literal is checked against a denial in its own clause.
    const proofNegative = negativeContextValid === undefined ? undefined : !negativeContextValid;
    // What the user actually wrote for a quote (normalized), else the quote itself.
    const located = (literal: string) => { const at = view?.locate(literal); return at && text !== undefined ? text.slice(at.start, at.end) : normalize(literal); };
    for (const field of keys) {
      const entries = proof.success ? proof.data.filter(item => item.field === field) : [];
      const companion = ({date:"time",time:"date",source_date:"source_time",source_time:"source_date",end_date:"end_time",end_time:"end_date"} as const)[field];
      const sameRole = proof.success ? proof.data.filter(item => item.field === companion) : [];
      const range = roleRanges[field as keyof typeof roleRanges];
      const roles = new Set(temporalKeys.filter(key=>patch[key]!==undefined).map(key=>key.startsWith("source_")?"source":key.startsWith("end_")?"end":"target"));
      // A role range (or the whole single-role message) is an explicit span, never re-located by text.
      const scope = range && text !== undefined ? range : roles.size <= 1 && text !== undefined ? [0, text.length] as const : undefined;
      // Partial evidence is local to a role. A missing date quote must not erase
      // an otherwise proven date just because the clock has its own quote.
      const candidates: { text?: string; span?: readonly [number, number] }[] = entries.length ? entries.length === 1 ? entries : []
        : proof.success ? [...(sameRole.length===1?sameRole:[]),...(scope&&scope[1]>scope[0]?[{span:scope}]:[])] : [];
      const value = fields[field];
      const isDate = dateFields.some(key => key === field);
      const canonicalField = isDate ? "date" : "time";
      if (proof.success && !entries.length && previous[field] === value && value !== undefined &&
        !candidates.some(entry=>{const facts=temporalFacts(entry.span?text!.slice(entry.span[0],entry.span[1]):normalize(entry.text!),{date:isDate?value:undefined},timezone,now);return isDate?facts.dates.length+facts.days.length+facts.weekdayMatches.length>0:facts.clocks.length>0;})) continue;
      const verified = candidates.some(entry => {
        if (!value || view === undefined || text === undefined || proofNegative === true) return false;
        // Presence, denial, role and atom checks all read the span the user wrote.
        const at = entry.span ? { start: entry.span[0], end: entry.span[1], unique: true } : view.locate(entry.text!, range);
        if (!at) return false;
        const context = text.slice(at.start, at.end);
        const contextAt = at.start;
        // Reads keep their factual scope: only a denial attached to the quoted
        // atom (or inside it) removes a filter; a denied mutation elsewhere does not.
        const read = ["appointment.read", "appointment.list", "availability.get"].includes(operation ?? "");
        const denied = read ? readQuoteDenied(text, contextAt, at.end, ignore) : temporalLiteralNegated(text, contextAt, at.end, ignore);
        if (proofNegative === undefined && denied) return false;
        const atom = isDate ? dateWitness(context, raw, field as typeof dateFields[number]) : {text:context,offset:0};
        if (!atom) return false;
        const quote = atom.text;
        const facts = temporalFacts(quote, {date:isDate?value:undefined}, timezone, now);
        const witnessed = (isDate ? facts.dates.length + facts.days.length + facts.weekdayMatches.length : facts.clocks.length) > 0;
        const quoteAt = contextAt + atom.offset;
        const intersectsRole = !range || quoteAt < range[1] && quoteAt + quote.length > range[0];
        // Components mode (flag) only: time and end_time quoting ONE interval span bind by position.
        const interval=!isDate&&temporalComponentsEnabled()&&(field==="time"||field==="end_time")&&entries.length===1&&proof.success?(()=>{
          const other=proof.data.filter(item=>item.field===(field==="time"?"end_time":"time")),span=other.length===1?view.locate(other[0].text):undefined;
          return span&&span.start===at.start&&span.end===at.end?sharedIntervalWitness(text,{start:quoteAt,end:quoteAt+quote.length},field,value):undefined;
        })():undefined;
        if(interval!==undefined)return interval&&completeTemporalQuote(text,quote,quoteAt)&&intersectsRole;
        const componentProof=isDate?undefined:componentClockWitness(text,quote,field,value,proof.success?proof.data.map(item=>({...item,text:located(item.text)})):[],raw,at.unique?quoteAt:undefined);
        return completeTemporalQuote(text, quote, quoteAt) && (witnessed||componentProof===true) && intersectsRole &&
          (componentProof===true?facts.clocks.length<=1:componentProof??!groundSchedulingTemporalBase({}, {[canonicalField]:value}, quote, timezone, now).rejected.some(item=>item.field===canonicalField));
      });
      if (!verified) {
        if (!rejected.some(item => item.field === field)) rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field, value: value ?? "MISSING" });
        delete fields[field]; delete patch[field];
      }
    }
    // A short answer has a backend-established role. Evidence may corroborate
    // its value but cannot silently retarget it to a different field.
    if (text !== undefined && temporalKeys.some(field => field === waitingFor)) {
      const requested = waitingFor as typeof temporalKeys[number];
      const quote = evidence.length === 1 ? located(evidence[0].text) : undefined;
      if (quote !== undefined && canonicalTemporalFragment(quote) === canonicalTemporalFragment(text) && isTemporalFragment(text) && evidence[0].field !== requested) {
        for (const field of new Set([requested, evidence[0].field])) {
          retargetedFields.add(field);
          if (!rejected.some(item => item.field === field)) rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field, value: fields[field] ?? "MISSING" });
          delete fields[field]; delete patch[field];
          if (field !== requested && previous[field] !== undefined) { fields[field] = previous[field]; rejected.find(item=>item.field===field)!.retained_value = previous[field]; }
        }
      }
    }
    if (rejected.length) delete fields.appointment_ref;
    return { fields, patch, rejected };
  }
  if (source === undefined) return { fields, patch, rejected };
  // C4: proven excluded atoms are masked here (their negators are not): see maskExcludedAtoms.
  const text = normalize(fallbackSource ?? source);
  const relation = temporalRoles(text, operation, raw);
  if (relation.roles) {
    for (const [clause, dateKey, timeKey] of relation.roles) {
      const result = groundSchedulingTemporalBase({}, { ...(fields[dateKey] ? {date:fields[dateKey]} : {}), ...(fields[timeKey] ? {time:fields[timeKey]} : {}) }, clause, timezone, now);
      for (const r of result.rejected) {
        const field = r.field === "date" ? dateKey : r.field === "time" ? timeKey : r.field;
        rejected.push({...r,field}); delete fields[field]; delete patch[field];
      }
    }
    if (rejected.length) delete fields.appointment_ref;
    return {fields,patch,rejected};
  }
  const { dates, days, weekdayMatches, clocks } = temporalFacts(text, fields, timezone, now);
  const hasDate = dates.length > 0 || weekdayMatches.length > 0 || days.length > 0;
  const hasTime = clocks.length > 0;
  // Mutations retain the conservative legacy negation guard. Reads validate
  // factual denials without reinterpreting a negated mutation as their intent.
  const negative = sourceNegatesTemporal(text, fields, timezone, now, operation);
  function reject(keys: readonly (typeof dateFields[number] | typeof timeFields[number])[], fallback: typeof dateFields[number] | typeof timeFields[number]) {
    const active = keys.filter(k => fields[k] !== undefined);
    for (const field of active.length ? active : [fallback]) {
      rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field, value: fields[field] ?? "MISSING" });
      delete fields[field]; delete patch[field];
    }
  }
  if (hasDate) {
    const changed = dateFields.filter(k => patch[k] !== undefined && patch[k] !== previous[k]);
    const target = dateFields.find(k => k === waitingFor);
    const active = target ? [target] : changed.length ? changed : dateFields.filter(k => fields[k] !== undefined);
    const ambiguous = negative || new Set(dates).size > 1 || new Set(weekdayMatches).size > 1 || new Set(days).size > 1 || active.length > 1;
    const date = active.length === 1 ? fields[active[0]] : undefined;
    let match = !ambiguous && !!date && isDateKey(date);
    if (match && date) {
      match = dates.every(d => isDateKey(d) && d === date) && days.every(d => d === Number(date.slice(8)));
      // "dia N" said without a month or year proves only this month's day or its next occurrence,
      // never a farther month or year (for example one copied from a few-shot example clock).
      if (!dates.length && days.length) match = match && dayOfMonthReading(date, dateKeyInTimeZone(now, timezone));
      if (weekdayMatches.length) match = match && weekdayMatches.every(w => w === weekdayOfDateKey(date));
      if (!dates.length && !days.length && weekdayMatches.length) match = match && date === resolveSchedulingDate({ weekday: weekdayMatches[0] }, timezone, now).date;
    }
    if (!match) reject(active.length ? active : dateFields, target ?? "date");
    if(target)for(const field of dateFields.filter(k=>k!==target&&patch[k]!==undefined&&patch[k]!==previous[k])) {
      reject([field],field); if(previous[field]!==undefined){fields[field]=previous[field];rejected.find(item=>item.field===field)!.retained_value=previous[field];}
    }
  }
  if (hasTime) {
    const changed = timeFields.filter(k => patch[k] !== undefined && patch[k] !== previous[k]);
    const active = changed.length ? changed : timeFields.filter(k => fields[k] !== undefined);
    // Explicit numeric origin -> destination is not an ambiguous list of clocks.
    // Validate each role; never swap or replace a conflicting model value.
    const numericClock = "(\\d{1,2}(?:h(?:\\d{2})?|:\\d{2}))";
    const move = new RegExp(`\\b(?:das|de)\\s+${numericClock}\\s+para\\s+(?:(?:amanha|hoje|depois de amanha)\\s+)?(?:(?:as|pelas)\\s+)?${numericClock}[\\s.!?]*$`).exec(text);
    const clockValue = (value: string) => {
      const [hour, minute = "00"] = value.split(/[h:]/);
      return `${hour.padStart(2, "0")}:${minute || "00"}`;
    };
    if (!negative && move && clocks.length === 2 && !fields.end_time) {
      for (const [field, value] of [["source_time", clockValue(move[1])], ["time", clockValue(move[2])]] as const) {
        if (fields[field] !== value) {
          rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:fields[field] ?? "MISSING"});
          delete fields[field]; delete patch[field];
        }
      }
    } else if (!negative && clocks.length === 1 && timeFields.some(k => k === waitingFor)) {
      // Without role evidence, a referential reply keeps the backend's pending
      // role. Recognizing non-temporal words does not authorize a role change;
      // explicit corrections of another role use the evidence path above.
      const target = waitingFor as typeof timeFields[number];
      if (fields[target] !== clocks[0]) {
        rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field:target,value:fields[target] ?? "MISSING"});
        delete fields[target]; delete patch[target];
      }
      // Answering one pending clock cannot change a different clock implicitly.
      for (const field of timeFields.filter(k => k !== target && patch[k] !== undefined && patch[k] !== previous[k])) {
        retargetedFields.add(field);retargetedFields.add(target);
        rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:patch[field]!});
        delete fields[field]; delete patch[field];
        // The rejected update answers another role; its prior accepted value
        // was not contradicted by the user and remains effective.
        if (previous[field] !== undefined) { fields[field] = previous[field]; rejected.find(item=>item.field===field)!.retained_value = previous[field]; }
      }
    } else if (negative || new Set(clocks).size > 1 || active.length !== 1 || clocks.some(t => t !== fields[active[0]])) reject(active.length ? active : timeFields, "time");
  }
  // Removing a selector also invalidates a previously located appointment.
  if (rejected.length) delete fields.appointment_ref;
  return { fields, patch, rejected };
}

/** Keep a proven clock expression when only its half-day remains unresolved.
 * This never changes the historical interpretation of a directly matching clock. */
function residualClockAmbiguities(raw: SchedulingFields, source: string | undefined, timezone: string,
  now: Date, operation: string | undefined, evidence: SchedulingTemporalEvidence | undefined, rejected: TemporalRejection[], retargetedFields: ReadonlySet<string>, owned?: Owned) {
  const pending: PendingTemporalAmbiguity[] = [];
  if (source === undefined) return pending;
  const view=sourceView(source), text=view.text, ignore=evidence?.length?view.owned(owned):[], ranges=temporalRoles(text,operation,raw,ignore).ranges;
  const proof=evidence?.length?temporalEvidence.safeParse(evidence):undefined;
  if(proof&&!proof.success)return pending;
  for(const rejection of rejected){
    if(rejection.code!=="SOURCE_TEMPORAL_CONFLICT"||!timeFields.some(field=>field===rejection.field))continue;
    const field=rejection.field as typeof timeFields[number], value=raw[field];
    if(!value)continue;
    // Rejection of a retargeted answer is not a half-day ambiguity. The pending
    // role remains authoritative until explicitly resolved in its own context.
    if(retargetedFields.has(field))continue;
    const range=ranges[field];
    const entries=proof?.success?proof.data.filter(item=>item.field===field):[];
    if(entries.length>1)continue;
    const roleCount=timeFields.filter(key=>raw[key]!==undefined).length;
    // The question repeats what the user wrote, located by its tolerant span.
    const span=entries[0]?view.locate(entries[0].text,range):range?{start:range[0],end:range[1]}:roleCount===1?{start:0,end:text.length}:undefined;
    if(!span||span.end<=span.start)continue;
    const expression=source.slice(view.toRaw(span.start),view.toRaw(span.end));
    const quote=text.slice(span.start,span.end), at=span.start;
    if(!expression.trim()||!completeTemporalQuote(text,quote,at)||range&&(at<range[0]||at+quote.length>range[1]))continue;
    if(temporalLiteralNegated(text,at,at+quote.length,ignore))continue;
    if(/\b(manha|tarde|noite)\b/.test(withoutGreetings(quote)))continue;
    const facts=temporalFacts(quote,raw,timezone,now);
    if(facts.negated||facts.clocks.length!==1)continue;
    const clockAtoms=new RegExp("\\b(?:\\d{1,2}(?:h(?:\\d{2})?|:\\d{2})|(?:"+hourNumeral+")(?:\\s*horas?)?(?: e (?:meia|"+numeral+")(?: minutos?)?)?)\\b","g");
    if([...quote.replace(dateExpressions()," ").matchAll(clockAtoms)].length!==1)continue;

    const literal=facts.clocks[0], hour=Number(literal.slice(0,2));
    if(hour<1||hour>12)continue;
    const other=String((hour+12)%24).padStart(2,"0")+literal.slice(2);
    if(value!==other)continue;
    pending.push({field,kind:"CLOCK_DAYPART",expression,candidates:[literal,other]});
  }
  return pending;
}

/** Explain only a contradiction inside one complete, role-bound calendar atom.
 * A model/date disagreement alone does not mean the user contradicted themself. */
function calendarContradictions(raw: SchedulingFields, source: string | undefined, timezone: string,
  now: Date, operation: string | undefined, evidence: SchedulingTemporalEvidence | undefined,
  rejected: TemporalRejection[], retargetedFields: ReadonlySet<string>, owned?: Owned) {
  const pending: PendingCalendarConflict[] = [];
  if (source === undefined) return pending;
  const view = sourceView(source), text = view.text, ignore = evidence?.length ? view.owned(owned) : [], ranges = temporalRoles(text, operation, raw, ignore).ranges;
  const proof = evidence?.length ? temporalEvidence.safeParse(evidence) : undefined;
  if (proof && !proof.success) return pending;
  const activeRoles = new Set(dateFields.filter(field => raw[field] !== undefined ||
    field === "date" && (raw.weekday !== undefined || raw.day_offset !== undefined) ||
    field === "source_date" && (raw.source_weekday !== undefined || raw.source_day_offset !== undefined)));
  const atoms = [...text.matchAll(dateExpressions())];
  for (const field of dateFields) {
    if (retargetedFields.has(field) || !rejected.some(item => item.code === "SOURCE_TEMPORAL_CONFLICT" && item.field === field)) continue;
    const range = ranges[field];
    const entries = proof?.success ? proof.data.filter(item => item.field === field) : [];
    if (entries.length > 1) continue;
    const quote = entries[0]?.text;
    const quoted = quote === undefined ? undefined : view.locate(quote, range);
    if (quote && !quoted) continue;
    // A clipped literal still points to its indivisible adjacent calendar atom.
    // Never collect a weekday from another role or a disconnected sentence.
    const candidates = atoms.filter(atom => {
      const start = atom.index!, end = start + atom[0].length;
      if (range && (start < range[0] || end > range[1])) return false;
      if (temporalLiteralNegated(text, start, end, ignore)) return false;
      if (quoted !== undefined) return start < quoted.end && end > quoted.start;
      return !!range || activeRoles.size === 1 && activeRoles.has(field);
    });
    if (candidates.length !== 1) continue;
    const conflicts = candidates.flatMap(atom => {
      const facts = temporalFacts(atom[0], {date:raw[field]}, timezone, now);
      const dates = [...new Set(facts.dates)], stated = [...new Set(facts.weekdayMatches)];
      // A model-inferred year is not evidence of a contradiction by the user.
      if (facts.negated || facts.unanchoredCalendarYear || dates.length !== 1 || stated.length !== 1 || !isDateKey(dates[0])) return [];
      const actual = weekdayOfDateKey(dates[0]);
      if (actual === stated[0]) return [];
      return [{field, kind:"WEEKDAY_DATE_CONFLICT" as const, expression:atom[0], calendar_date:dates[0], stated_weekday:stated[0], actual_weekday:actual}];
    });
    if (conflicts.length === 1) pending.push(conflicts[0]);
  }
  return pendingCalendarConflicts.parse(pending);
}

/** Scope coverage of a VERIFIED per-action view (compound requests only): the action's own
 * clause plus every text no verified sibling clause claims. Every date or clock atom the user
 * wrote there must be claimed by one of this action's own quotes. An unclaimed atom means the
 * interpretation dropped part of what was said ("para amanhã às 10 horas" sent as a clock
 * only), so a role it belongs to that has no proven value cannot be completed by a default
 * (e.g. "a time-only change keeps the original day"). Uses the same atom recognizers as the grammar; never
 * returns a value. A directly denied atom ("não 10h") or one inside the action's own reason
 * quote is not a claim to cover. */
export function unclaimedScopeRoles(source: string, timezone: string, now: Date, operation: string | undefined, raw: SchedulingFields,
  evidence: SchedulingTemporalEvidence, exempt: readonly string[] = [], owned?: Owned) {
  const view = sourceView(source), text = view.text;
  // C4: an exclusion claims its atom only once proven (the caller passes its literal in `exempt`).
  const claimed = [...evidence.filter(item => item.excluded === undefined).map(item => item.text), ...exempt].flatMap(literal => literal.trim() ? view.all(literal) : []);
  const { ranges } = temporalRoles(text, operation, raw, view.owned(owned));
  const roles: { field: TemporalRole; kind: "date" | "clock" }[] = [];
  for (const atom of temporalFacts(text, {}, timezone, now).atoms) {
    if (atom.negated || claimed.some(([start, end]) => start < atom.end && atom.start < end)) continue;
    const order = atom.kind === "date" ? dateFields : timeFields;
    const field = order.find(key => { const range = ranges[key]; return !!range && atom.start >= range[0] && atom.start < range[1]; }) ?? order[0];
    if (!roles.some(role => role.field === field)) roles.push({ field, kind: atom.kind });
  }
  return roles;
}
/** Applies scope coverage to a grounding result. A role left without a proven value while the
 * user wrote an atom for it is asked (never completed by a default such as "a time-only
 * change keeps the original day"), and the located appointment is dropped with it. A role the
 * action's own quote already proved is kept: an extra atom there (a duration such as
 * "coloração de 2h") is only reported. Returns codes-only divergence for telemetry. */
export function applyScopeCoverage(grounded: { fields: SchedulingFields; patch: SchedulingFields; rejected: TemporalRejection[]; exclusions?: TemporalExclusions }, source: string, timezone: string, now: Date,
  operation: string | undefined, raw: SchedulingFields, evidence: SchedulingTemporalEvidence | undefined) {
  const excluded = grounded.exclusions?.verified ?? [];
  const gaps = unclaimedScopeRoles(source, timezone, now, operation, raw, evidence ?? [], [raw.reason, raw.override_reason, ...excluded.map(item => item.literal)].filter((value): value is string => typeof value === "string"),
    ownedNegators(grounded.exclusions, source));
  const proven = new Set(gaps.filter(gap => grounded.fields[gap.field] !== undefined && !grounded.rejected.some(item => item.field === gap.field)).map(gap => gap.field));
  const asked = gaps.filter(gap => !proven.has(gap.field));
  for (const gap of asked) {
    if (!grounded.rejected.some(item => item.field === gap.field)) grounded.rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field: gap.field, value: grounded.fields[gap.field] ?? "MISSING" });
    delete grounded.fields[gap.field]; delete grounded.patch[gap.field];
  }
  if (asked.length) delete grounded.fields.appointment_ref;
  return [...new Set(gaps.map(gap => `TEMPORAL_SCOPE_${proven.has(gap.field) ? "EXTRA" : "UNCLAIMED"}_${gap.kind === "date" ? "DATE" : "CLOCK"}`))];
}
/** C4 (applyKeptDayGuard): a denial attached to the day expression [start,end) of `source` (ORIGINAL offsets): a negator inside it, one
 * right before it through at most three words of valueGlue's closed class ("não amanhã", "não pra amanhã"), or one right after it that
 * closes its clause ("pras 10h, amanhã não."). A negator a proven exclusion owns (`owned`) never attaches; one elsewhere in the clause
 * ("não esquece de passar a Lia pra amanhã", "se não tiver problema…") denies another predicate, never this day. */
function attachedDenial(source: string, start: number, end: number, owned: Owned) {
  const map = normalizedOffsets(source, normalize);
  if (!map) return false;
  const text = map.text, from = map.toNormalized(start), to = map.toNormalized(end), ignore = owned.map(([a, b]) => [map.toNormalized(a), map.toNormalized(b)] as const);
  const free = (at: number, length: number) => !ownedAt(ignore, at, length);
  for (const match of text.slice(from, to).matchAll(/\b(?:nao|nunca|jamais|nem)\b/g)) if (free(from + match.index!, match[0].length)) return true;
  const lead = /\b(?:nao|nunca|jamais|nem)(?:\s+(?:em|na|no|nas|nos|a|as|ao|aos|para|pra|pro|de|do|da|das|dos)){0,3}\s*$/.exec(text.slice(0, from));
  if (lead && free(lead.index, /^\S+/.exec(lead[0])![0].length)) return true;
  const trail = /^\s+((?:nao|nunca|jamais|nem)\b)\s*(?:[,.;!?()\n]|$)/.exec(text.slice(to));
  return !!trail && free(to + trail[0].indexOf(trail[1]), trail[1].length);
}
/** Spans [start,end) of a text (ORIGINAL offsets). */
type Spans = readonly (readonly [number, number])[];
/** C4 (flag SALON_SECRETARY_DATE_RULES_V2): a change with no destination day keeps its origin's ("passa pras 10h"). `source` is the
 * action's own text (its verified clause, the whole message of a one-action request, or the sibling-masked message of a compound
 * request whose clause is not verified). A day the owner wrote there that no field of the action consumed is a day the interpretation
 * dropped, so the origin's day is never kept silently in its place: every day expression of the text (temporalScan.days) outside the
 * widened span of each proven DAY quote of the change (date, source_date: a refused quote, a clock quote, or an end_date no change has,
 * never consumes a day) and outside every other literal the action owns (`exempt`: its names, reason and same_as literals; a proven
 * exclusion), with no denial attached to it (attachedDenial), has its role asked like a missing value: the origin's in the origin clause of an explicit
 * move (nothing to ask when that role is already proven: the day is the origin's), the destination's otherwise.
 * `kept`: the day an earlier preparation kept from the origin (never the owner's words): a date still holding it is not held.
 * `foreign`: an unverified clause's own scope and the other actions' clauses and quotes: a day inside the latter and outside the
 * former is theirs. Nothing when the destination day is held or already asked. Codes only; never returns a value. */
export function applyKeptDayGuard(grounded: { fields: SchedulingFields; patch: SchedulingFields; rejected: TemporalRejection[]; exclusions?: TemporalExclusions }, source: string,
  operation: string | undefined, evidence: SchedulingTemporalEvidence | undefined, exempt: readonly string[] = [], options: { kept?: string; foreign?: { own: Spans; siblings: Spans } } = {}): string[] {
  const date = grounded.fields.date;
  if (!dateRulesV2Enabled() || operation !== "appointment.change" || date !== undefined && (date !== options.kept || grounded.patch.date !== undefined) ||
    grounded.rejected.some(item => item.field === "date")) return [];
  const scan = temporalScan(source);
  if (!scan) return [];
  const owned = ownedNegators(grounded.exclusions, source), relation = componentRoleRelation(source, operation, owned);
  // A refused quote proved nothing: the days its expression holds are still the owner's to ask about.
  const days = (evidence ?? []).filter(item => item.excluded === undefined && (item.field === "date" || item.field === "source_date") &&
    !grounded.rejected.some(rejection => rejection.field === item.field)).map(item => item.text);
  const claimed = [...days.flatMap(text => literalSpans(source, text).map(([start, end]) => scan.expression(start, end))),
    ...[...exempt, ...(grounded.exclusions?.verified ?? []).map(item => item.literal)].filter(text => text.trim()).flatMap(text => literalSpans(source, text))];
  const within = (spans: Spans, [start, end]: readonly [number, number]) => spans.some(([a, b]) => a <= start && end <= b);
  const foreign = (token: [number, number]) => !!options.foreign && within(options.foreign.siblings, token) && !within(options.foreign.own, token);
  const held = (field: "source_date") => grounded.fields[field] !== undefined && !grounded.rejected.some(item => item.field === field);
  const asked = new Set<"date" | "source_date">();
  for (const { token, expression } of scan.days()) {
    if (claimed.some(([start, end]) => token[0] < end && start < token[1]) || foreign(token) || attachedDenial(source, expression[0], expression[1], owned)) continue;
    const origin = !!relation && token[0] >= relation.origin[0] && token[1] <= relation.origin[1];
    // An origin role already refused is already asked.
    if (!origin) asked.add("date"); else if (!held("source_date") && !grounded.rejected.some(item => item.field === "source_date")) asked.add("source_date");
  }
  for (const field of asked) {
    if (!grounded.rejected.some(item => item.field === field)) grounded.rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field, value: "MISSING" });
    delete grounded.fields[field]; delete grounded.patch[field];
  }
  if (asked.size) delete grounded.fields.appointment_ref;
  return asked.size ? ["TEMPORAL_KEPT_DAY_UNCLAIMED"] : [];
}

/** A short qualifier can select only one candidate of a live, requested role.
 * A backend draft contains the earlier literal; the current quote proves the
 * remaining component. Neither message alone authorizes an invented clock. */
export function groundSchedulingTemporal(previous: SchedulingFields, raw: SchedulingFields,
  source: string | undefined, timezone: string, now: Date, waitingFor?: string, operation?: string,
  evidence?: SchedulingTemporalEvidence, context?: TemporalAmbiguityContext, negativeContext?: TemporalNegativeContextInput): GroundedTemporal {
  const { positive, excluded } = splitTemporalExclusions(evidence);
  // Without exclusions (always with the flag off) the historical guard runs on exactly its inputs.
  if (!excluded.length) return groundSchedulingTemporalCore(previous, raw, source, timezone, now, waitingFor, operation, evidence === undefined || positive.length === evidence.length ? evidence : positive, context, negativeContext);
  return groundWithExclusions(previous, raw, source, timezone, now, waitingFor, operation, positive, context, negativeContext,
    temporalExclusionsOf(source, positive, excluded, operation, timezone, now));
}
/** C4: grounding of the affirmed quotes (`positive`) with already proven exclusions: their owned negators do not deny,
 * and an effective value they exclude is refused. The components wrapper proves them once against every quote. */
export function groundWithExclusions(previous: SchedulingFields, raw: SchedulingFields, source: string | undefined, timezone: string, now: Date,
  waitingFor: string | undefined, operation: string | undefined, positive: SchedulingTemporalEvidence, context: TemporalAmbiguityContext | undefined,
  negativeContext: TemporalNegativeContextInput | undefined, exclusions: TemporalExclusions): GroundedTemporal {
  const grounded = groundSchedulingTemporalCore(previous, raw, source, timezone, now, waitingFor, operation, positive, context, negativeContext,
    source === undefined ? [] : ownedNegators(exclusions, source), source === undefined ? undefined : maskExcludedAtoms(source, exclusions));
  return { ...rejectExcludedValues(grounded, exclusions), exclusions };
}
/** The grounding result; `exclusions` (C4) only when the turn carried exclusions (flag on). */
export type GroundedTemporal = ReturnType<typeof groundSchedulingTemporalCore> & { exclusions?: TemporalExclusions };
/** C4: the exclusions of one action proven against the message it is grounded on (legacy values by this grammar). */
export function temporalExclusionsOf(source: string | undefined, positive: SchedulingTemporalEvidence, excluded: SchedulingTemporalEvidence, operation: string | undefined, timezone: string, now: Date) {
  return verifyTemporalExclusions(source, positive, excluded, { today: dateKeyInTimeZone(now, timezone), operation,
    legacy: (remainder, field, value) => legacyExcludedValues(remainder, field, value, timezone, now) });
}
/** C4: the historical grammar's reading of an exclusion without its marker: exactly one date or clock atom of the
 * role's kind stating the value. A bare 12-hour clock without a daypart proves either half (like the residual
 * half-day question); one the components resolver would ask about (1-7) excludes both halves. */
function legacyExcludedValues(remainder: string, field: string, value: string, timezone: string, now: Date): string[] | undefined {
  const text = normalize(remainder), facts = temporalFacts(text, {}, timezone, now), date = field.endsWith("date");
  if (facts.atoms.length !== 1 || facts.atoms[0].kind !== (date ? "date" : "clock")) return;
  if (date) return isDateKey(value) && !groundSchedulingTemporalBase({}, { date: value }, text, timezone, now).rejected.length ? [value] : undefined;
  const clock = facts.clocks[0];
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || !clock || clock === "INVALID") return;
  const hour = Number(clock.slice(0, 2)), bare = hour >= 1 && hour <= 12 && !/\b(?:manha|tarde|noite)\b/.test(withoutGreetings(text));
  const twin = `${String((hour + 12) % 24).padStart(2, "0")}${clock.slice(2)}`;
  if (value !== clock && !(bare && value === twin)) return;
  return bare && hour >= UNSPECIFIED_DAYPART_ASKED_HOURS[0] && hour <= UNSPECIFIED_DAYPART_ASKED_HOURS[1] ? [clock, twin] : [value];
}
function groundSchedulingTemporalCore(previous: SchedulingFields, raw: SchedulingFields,
  source: string | undefined, timezone: string, now: Date, waitingFor?: string, operation?: string,
  evidence?: SchedulingTemporalEvidence, context?: TemporalAmbiguityContext, negativeContext?: TemporalNegativeContextInput, owned?: Owned, fallbackSource?: string) {
  const patch={...raw};
  let resolved: PendingTemporalAmbiguity|undefined;
  let resolvedCalendar: {field: typeof dateFields[number]; date: string}|undefined;
  const live=context&&context.draft_ref&&Number.isInteger(context.draft_revision)&&context.draft_revision>0&&
    context.scope_valid!==false&&Date.parse(context.expires_at)>now.getTime();
  const responseFacts=source===undefined?undefined:temporalFacts(normalize(source),{},timezone,now);
  // A short answer's quote is proven by the span the user wrote (case, accents, spacing tolerant).
  const view=source===undefined?undefined:sourceView(source);
  const said=(quote:string|undefined)=>{const at=quote===undefined?undefined:view?.locate(quote);return at&&{...at,text:view!.text.slice(at.start,at.end)};};
  const referential=!!responseFacts&&!responseFacts.dates.length&&!responseFacts.days.length&&!responseFacts.weekdayMatches.length&&!responseFacts.clocks.length;
  const calendar=context?.pending_calendar_conflicts?.find(item=>item.field===waitingFor);
  if(live&&calendar&&referential&&source!==undefined&&/[\p{L}\p{N}]/u.test(source)&&
    !/\b(?:nao|nunca|jamais|nem)\b/.test(normalize(source))&&!sourceNegatesTemporal(normalize(source),raw,timezone,now,operation)){
    const proof=temporalEvidence.safeParse(evidence??[]);
    const entries=proof.success?proof.data.filter(item=>item.field===calendar.field):[];
    const quote=said(entries.length===1?entries[0].text:undefined)?.text;
    const weekdayKey=calendar.field==="date"?"weekday":calendar.field==="source_date"?"source_weekday":undefined;
    const allowed=new Set<string>([calendar.field,...(weekdayKey?[weekdayKey]:[])]);
    const scopeUnchanged=Object.entries(raw).every(([key,value])=>allowed.has(key)||value===previous[key as keyof SchedulingFields]);
    const selectedDate=raw[calendar.field];
    const selectedWeekday=weekdayKey?raw[weekdayKey]:undefined;
    // Luna selects one published reference through existing typed date/weekday
    // fields. The backend binds that semantic choice to this exact pending role;
    // it does not infer which Portuguese phrase means "use the calendar date".
    // A DATE_CHOICE (components mode) is answered with one of its two published dates. UX (flag): the quote may be part
    // of the answer when the answer's own calendar facts single out that very candidate ("é o de outubro, por favor").
    const namedChoice=calendar.kind==="DATE_CHOICE"&&dateRulesV2Enabled()&&!!quote&&selectedDate!==undefined&&selectedWeekday===undefined&&
      dateChoiceAnswer(source,calendar.candidates,dateKeyInTimeZone(now,timezone))===selectedDate;
    if(scopeUnchanged&&quote&&(namedChoice||canonicalTemporalFragment(quote)===canonicalTemporalFragment(source))&&(calendar.kind==="DATE_CHOICE"
      ?selectedDate!==undefined&&selectedWeekday===undefined&&calendar.candidates.includes(selectedDate)
      :(selectedDate===calendar.calendar_date&&selectedWeekday===undefined)||
       (selectedDate===undefined&&selectedWeekday===calendar.stated_weekday))){
      const chosen=selectedDate??resolveSchedulingDate({weekday:(calendar as {stated_weekday:number}).stated_weekday},timezone,now).date!;
      resolvedCalendar={field:calendar.field,date:chosen};
      delete patch[calendar.field];if(weekdayKey)delete patch[weekdayKey];
    }
  }
  if(live&&source!==undefined){
    const candidate=context.pending_temporal_ambiguities?.find(item=>item.field===waitingFor);
    const proof=temporalEvidence.safeParse(evidence??[]);
    const entries=proof.success?proof.data.filter(item=>item.field===waitingFor):[];
    const quoted=said(entries.length===1?entries[0].text:undefined), quote=quoted?.text;
    if(candidate&&quoted&&quote&&raw[candidate.field]&&candidate.candidates.includes(raw[candidate.field]!)&&
      !/\b(?:nao|nunca|jamais|nem)\b/.test(normalize(source))){
      const facts=temporalFacts(normalize(source),{},timezone,now);
      const dayparts=[...new Set([...withoutGreetings(normalize(source)).matchAll(/\b(manha|tarde|noite)\b/g)].map(match=>({manha:"morning",tarde:"afternoon",noite:"evening"} as const)[match[1] as "manha"|"tarde"|"noite"]))];
      const quotedDayparts=[...new Set([...withoutGreetings(normalize(quote)).matchAll(/\b(manha|tarde|noite)\b/g)].map(match=>({manha:"morning",tarde:"afternoon",noite:"evening"} as const)[match[1] as "manha"|"tarde"|"noite"]))];
      if(Object.entries(raw).every(([key,value])=>["time","source_time","end_time","period"].includes(key)||value===previous[key as keyof SchedulingFields])&&
        !facts.clocks.length&&!facts.dates.length&&!facts.days.length&&!facts.weekdayMatches.length&&dayparts.length===1&&
        quotedDayparts.length===1&&quotedDayparts[0]===dayparts[0]&&
        completeTemporalQuote(view!.text,quote,quoted.start)&&
        candidate.candidates.filter(time=>matchesSchedulingPeriod(time,dayparts[0])).length===1&&
        matchesSchedulingPeriod(raw[candidate.field]!,dayparts[0])&&
        timeFields.every(field=>field===candidate.field||raw[field]===undefined||raw[field]===previous[field])){
        resolved=candidate;delete patch[candidate.field];
        // A qualifier for the original/final clock is not a destination filter.
        delete patch.period;
      }
    }
  }
  const proof=resolved||resolvedCalendar?evidence?.filter(item=>item.field!==resolved?.field&&item.field!==resolvedCalendar?.field):evidence;
  const retargetedFields=new Set<string>();
  const negativeContextValid=negativeContext===undefined?undefined:source!==undefined&&validateTemporalNegativeContext(negativeContext,
    {source,previous,raw:patch,evidence:proof,operation,now}).valid;
  const result=groundSchedulingTemporalBase(previous,patch,source,timezone,now,waitingFor,operation,proof,retargetedFields,negativeContextValid,owned,fallbackSource);
  if(negativeContextValid===false){
    const present=[...dateFields,...timeFields].filter(field=>result.fields[field]!==undefined);
    for(const field of present.length?present:["date"] as const){
      if(!result.rejected.some(item=>item.field===field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:result.fields[field]??"MISSING"});
      delete result.fields[field];delete result.patch[field];
    }
    delete result.fields.appointment_ref;
  }
  if((source===undefined||referential)&&!resolvedCalendar&&(context?.pending_calendar_conflicts?.length||dateFields.some(field=>field===waitingFor)))for(const field of dateFields){
    const supplied=raw[field]!==undefined&&raw[field]!==previous[field]||field==="date"&&(raw.weekday!==undefined||raw.day_offset!==undefined)||field==="source_date"&&(raw.source_weekday!==undefined||raw.source_day_offset!==undefined);
    if(supplied){
      if(!result.rejected.some(item=>item.field===field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:raw[field]??"AMBIGUOUS"});
      delete result.fields[field];delete result.patch[field];
      if(previous[field]!==undefined){result.fields[field]=previous[field];result.rejected.find(item=>item.field===field)!.retained_value=previous[field];}
    }
  }
  if(!resolved&&source!==undefined&&/\b(manha|tarde|noite)\b/.test(withoutGreetings(normalize(source)))&&!temporalFacts(normalize(source),{},timezone,now).clocks.length){
    for(const field of timeFields)if(raw[field]!==undefined&&raw[field]!==previous[field]){
      if(!result.rejected.some(item=>item.field===field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:raw[field]!});
      delete result.fields[field];delete result.patch[field];
    }
  }
  if(!resolved)for(const item of context?.pending_temporal_ambiguities??[]){
    if(raw[item.field]!==undefined&&(source===undefined||!temporalFacts(normalize(source),{},timezone,now).clocks.length)){
      if(!result.rejected.some(rejection=>rejection.field===item.field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field:item.field,value:raw[item.field]!});
      delete result.fields[item.field];delete result.patch[item.field];
    }
  }
  if(resolved&&!result.rejected.length){
    result.fields[resolved.field]=raw[resolved.field];result.patch[resolved.field]=raw[resolved.field];
  }
  if(resolvedCalendar&&!result.rejected.length){
    result.fields[resolvedCalendar.field]=resolvedCalendar.date;result.patch[resolvedCalendar.field]=resolvedCalendar.date;
  }
  return {...result,pending_temporal_ambiguities:residualClockAmbiguities(raw,source,timezone,now,operation,evidence,result.rejected,retargetedFields,owned),
    pending_calendar_conflicts:calendarContradictions(raw,source,timezone,now,operation,evidence,result.rejected,retargetedFields,owned)};
}
