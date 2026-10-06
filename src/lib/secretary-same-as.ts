import { multiServiceEnabled, referencesV2Enabled, type PlanAction, type SameAsField, type SelectedOperation } from "@everflair/salon-secretary";
import { formatLocal } from "./secretary-datetime-format";
import { foldedLiteral, literalSpans } from "../../packages/salon-secretary/src/literal-match";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { getSchedulingAppointment, listSchedulingProfessionals, schedulingTimezone } from "./scheduling-catalog";
import { dateKeyInTimeZone, weekdayOfDateKey } from "./time";
import { getCustomer } from "./customer-catalog";
import { quoteTemporalFacts, temporalQuoteDenied } from "./scheduling-temporal-source";
import { groundSchedulingTemporalTurn } from "./scheduling-temporal-mode";
import { dayDirection, temporalQuoteFacts, temporalScan, temporalVocabulary, verifyClockComponent, verifyDayComponent } from "./scheduling-temporal-reference";
import { weekScopes, type ClockComponent, type DayComponent } from "../../packages/salon-secretary/src/temporal-components";
import { projectSchedulingOperation } from "./secretary-operation-projection";
import type { SchedulingReferences, SchedulingState } from "./secretary-scheduling";
import type { BatchState } from "./secretary-batch";

/** C5 (rec 14, flag SALON_SECRETARY_SAME_AS): backend side of cross-action references. Everything here reads backend
 * state (journal drafts, the located appointment, catalog names); Luna's own values are only compared, never copied. */

/** The accepted value of each field of one referenced action: a date/clock as its journal draft holds it, a person as a
 * backend ref with the canonical name; `appointment`: the appointment a cancellation (or change) located.
 * V2 (flag SALON_SECRETARY_REFERENCES_V2): `service`, the one service the action holds (D3), or `services` when it holds
 * several (a card, never a pick); `pick`, which of a read's rows a customer reference names (D2). */
export type ReferencedValues = { date?: string; time?: string; professional?: { ref: string; name: string }; customer?: { ref: string; name: string }; appointment?: string;
  service?: { ref: string; name: string }; services?: { ref: string; name: string }[]; pick?: ReadPick };
export type ReferenceCarrier = { scheduling?: SchedulingState; batch?: BatchState };
type Person = { ref: string; name: string };
const person = (ref: string | undefined, name: string | undefined): Person | undefined => ref && name ? { ref, name } : undefined;
const READS = ["appointment.list", "appointment.read", "availability.get"];
/** D3: one service is the value; several are a card (their order kept); none is unknown. */
const serviceValues = (items: readonly Person[]): Pick<ReferencedValues, "service" | "services"> => items.length === 1 ? { service: items[0] } : items.length > 1 ? { services: [...items] } : {};

/** What another action has ACCEPTED so far (never its interpretation): an unknown field is simply absent. `ref` (V2): the
 * reference being resolved (a read's customer is ONE of its rows, named by that reference's own literal). */
export async function referencedValues(actor: ServiceActor, action: PlanAction, carrier: ReferenceCarrier, ref?: { field: SameAsField; literal: string }): Promise<ReferencedValues> {
  const v2 = referencesV2Enabled();
  if (carrier.batch) {
    const snapshot = carrier.batch.draft?.snapshot;
    if (!snapshot) return {};
    const cancel = action.operation === "appointment.cancel", item = cancel ? snapshot.cancel : snapshot.create;
    return { date: item.startLocal.slice(0, 10), time: item.startLocal.slice(11, 16), professional: { ref: item.professional_ref, name: item.professional_name },
      ...(person(item.customer_ref, item.customer_name) ? { customer: person(item.customer_ref, item.customer_name) } : {}),
      ...(cancel && snapshot.cancel.appointment_ref ? { appointment: snapshot.cancel.appointment_ref } : {}),
      ...(v2 ? serviceValues(cancel ? snapshot.cancel.services.map(s => ({ ref: s.id, name: s.name })) : [{ ref: snapshot.create.service_ref, name: snapshot.create.service_name }]) : {}) };
  }
  const draft = carrier.scheduling?.draft;
  if (!draft) return {};
  const f = draft.fields, locator = action.operation === "appointment.cancel" || action.operation === "appointment.change";
  const proName = async () => draft.snapshot?.professional_name ?? draft.action_snapshot?.professional_name ??
    (await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, {}))).find(row => row.id === f.professional_ref)?.name ?? f.professional_name;
  // D2 (V2): a read gives its accepted filters (day, professional) and, for a customer, ONE of its rows as it showed them.
  if (v2 && READS.includes(action.operation)) {
    const professional = f.professional_ref ? person(f.professional_ref, await proName()) : undefined;
    // P3b (flag SALON_SECRETARY_READS_V2): a read that showed only its first rows ("há mais") is not the whole list.
    // Review A: the literal may name the read's own subject and restate its own day; anything else makes the rows a card.
    const rows = carrier.scheduling?.appointments, pick = ref?.field === "customer" && rows ? pickReadRow(rows, ref.literal, new Date(), !carrier.scheduling?.read_partial,
      [professional?.name, f.professional_name, f.customer_name].filter((name): name is string => typeof name === "string"), await restatedDay(actor, ref.literal, f.date)) : undefined;
    return { ...(f.date ? { date: f.date } : {}), ...(professional ? { professional } : {}), ...(pick ? { pick } : {}),
      ...(pick?.kind === "ROW" ? { customer: { ref: pick.row.customer_ref, name: pick.row.customer_name }, appointment: pick.row.appointment_ref } : {}) };
  }
  const located = locator && f.appointment_ref ? await withTenant(actor, tx => getSchedulingAppointment(tx, actor, f.appointment_ref!)) : undefined;
  const slot = action.operation === "appointment.cancel" ? located && { date: located.start_local.slice(0, 10), time: located.start_local.slice(11, 16) }
    : { ...(f.date ? { date: f.date } : {}), ...(f.time ? { time: f.time } : {}) };
  // D3 (V2): the located appointment's own services (the prepared snapshot's, with their ids; before an alteration, if any).
  const booked = v2 && located ? draft.action_snapshot ? serviceValues((draft.action_snapshot.before_services ?? draft.action_snapshot.services).map(s => ({ ref: s.id, name: s.name })))
    : located.services.length === 1 && located.service_ref ? { service: { ref: located.service_ref, name: located.services[0].serviceName } } : {} : {};
  if (located) return { ...slot, professional: { ref: located.professional_ref, name: located.professional_name }, customer: { ref: located.customer_ref, name: located.customer_name },
    appointment: located.appointment_ref, ...booked };
  if (locator) return action.operation === "appointment.change" ? slot ?? {} : {};
  const professional = f.professional_ref ? person(f.professional_ref, await proName()) : undefined;
  const customer = f.customer_ref ? person(f.customer_ref, draft.snapshot?.customer_name ?? await withTenant(actor, tx => getCustomer(tx, actor, f.customer_ref!)).then(row => row.name, () => f.customer_name)) : undefined;
  const offered = v2 && action.operation === "appointment.create" ? draft.snapshot?.services ? serviceValues(draft.snapshot.services.map(s => ({ ref: s.service_ref, name: s.service_name })))
    : f.service_ref ? serviceValues([{ ref: f.service_ref, name: draft.snapshot?.service_name ?? carrier.scheduling?.resolved_names?.[f.service_ref] ?? f.service_name ?? "" }].filter(s => s.name)) : {} : {};
  return { ...slot, ...(professional ? { professional } : {}), ...(customer ? { customer } : {}), ...offered };
}
/** Review A (D2): the words of a literal that restate the read's own day ("o primeiro cliente dela hoje" of today's read): a
 * relative day or weekday whose only reading is that day. Nothing when the read has no day. */
async function restatedDay(actor: ServiceActor, literal: string, date: string | undefined): Promise<ReadonlySet<string>> {
  if (!date) return new Set();
  const timezone = await withTenant(actor, tx => schedulingTimezone(tx, actor)), now = new Date();
  return new Set(words(literal).filter(word => {
    const facts = quoteTemporalFacts(word, timezone, now);
    return !facts.invalid && !facts.clocks.length && !facts.period && (facts.dates.length ? facts.dates.every(day => day === date) :
      facts.weekdays.length > 0 && facts.weekdays.every(item => item.weekday === weekdayOfDateKey(date)));
  }));
}
/** The comparable key of a referenced value: the date/clock itself, a person's (or a service's) backend ref. */
export const referenceKey = (field: SameAsField, values: ReferencedValues) => field === "date" || field === "time" ? values[field] : values[field]?.ref;

/** D2 (V2): a read's row, as the read showed it. */
export type ReadRow = { appointment_ref: string; customer_ref: string; customer_name: string; professional_name: string; start_local: string; start_at: string; status: string };
/** ROW: the named row (mutable); CARD: the rows to choose from (no ordinal, a tie, or an ordinal that cannot be computed
 * exactly); REFUSED: the named row cannot be changed any more (never another row instead); NONE: the read showed nothing. */
export type ReadPick = { kind: "ROW" | "REFUSED"; row: ReadRow } | { kind: "CARD"; rows: ReadRow[] } | { kind: "NONE" };
/** Closed grammatical class of the position words an owner uses for one row of a list ("o último cliente dela"). The ordinal
 * "segundo/segunda" is left out: it is also the weekday ("segunda"). */
const ORDINALS: Readonly<Record<string, "first" | "last" | "penultimate">> = { primeiro: "first", primeira: "first", ultimo: "last", ultima: "last", penultimo: "penultimate", penultima: "penultimate" };
/** Review A (D2): the only other words a pick of a read's row may hold (closed classes): articles, the head nouns of a row of an
 * agenda (cliente/agendamento/horário/atendimento), the personal and anaphoric pronouns (ela/ele, dela/dele…), the demonstratives,
 * a genitive naming the read's own subject ("da Nara", `subjects`) and a day word restating the read's own day (`restating`). Any
 * other word (a daypart, "depois", a clock, another day, a name) narrows the rows in a way no ranking honors: `qualified`, so the
 * rows are a card, never a pick (not even of a single row). */
const ORDINAL_PARTS = new Set(["o", "a", "os", "as", "cliente", "clientes", "agendamento", "agendamentos", "horario", "horarios", "atendimento", "atendimentos",
  "ele", "ela", "eles", "elas", "dele", "dela", "deles", "delas", "esse", "essa", "este", "esta", "aquele", "aquela"]);
function ordinalOf(literal: string, subjects: readonly string[], restating: ReadonlySet<string>) {
  const list = words(literal), named = new Set(subjects.flatMap(words).filter(word => word.length >= 3)), ordinals = list.filter(word => ORDINALS[word]);
  const qualified = ordinals.length > 1 || list.some((word, i) => !ORDINALS[word] && !ORDINAL_PARTS.has(word) && !named.has(word) && !restating.has(word) &&
    !(["de", "da", "do"].includes(word) && (named.has(list[i + 1] ?? "") || restating.has(list[i + 1] ?? ""))));
  return { ordinal: !qualified && ordinals.length === 1 ? ORDINALS[ordinals[0]] : undefined, qualified };
}
export function readOrdinal(literal: string, subjects: readonly string[] = [], restating: ReadonlySet<string> = new Set()) {
  return ordinalOf(literal, subjects, restating).ordinal;
}
/** Review D2 (amended): the ordinal is taken over EVERY row of the read as shown, ranked by start; only then is the row's
 * mutability checked (a started first appointment is refused, never replaced by the second). A tie at that position asks.
 * `complete` (P3b): false when the read showed only its first rows; a position counted from the end ("o último") is then not
 * computable from them, and a single row shown is not the only one: the rows shown are a card. */
export function pickReadRow(rows: readonly ReadRow[], literal: string, now: Date, complete = true, subjects: readonly string[] = [], restating: ReadonlySet<string> = new Set()): ReadPick {
  if (!rows.length) return { kind: "NONE" };
  const ranked = rows.map((row, index) => ({ row, index })).sort((a, b) => a.row.start_local.localeCompare(b.row.start_local) || a.index - b.index).map(item => item.row);
  const mutable = (row: ReadRow) => ["PENDING", "CONFIRMED"].includes(row.status) && Date.parse(row.start_at) > now.getTime();
  // A card is the owner's own choice: it offers only rows the Secretária may still change (none: the first one is refused).
  const card = (options: ReadRow[]): ReadPick => options.some(mutable) ? { kind: "CARD", rows: options.filter(mutable) } : { kind: "REFUSED", row: options[0] };
  const { ordinal, qualified } = ordinalOf(literal, subjects, restating);
  const position = qualified ? -1 : ordinal === "first" ? 0 : !complete ? -1 : ordinal === "last" ? ranked.length - 1 : ordinal === "penultimate" ? ranked.length - 2 : ranked.length === 1 ? 0 : -1;
  if (position < 0) return card(ranked);
  const row = ranked[position], tied = ranked.filter(other => other.start_local === row.start_local);
  if (tied.length > 1) return card(tied);
  return mutable(row) ? { kind: "ROW", row } : { kind: "REFUSED", row };
}

/** Closed grammatical class of anaphora/identity words ("no mesmo dia", "no horário dela", "com ela", "junto", "nesse dia").
 * Demonstratives (esse/este/aquele and their contractions with em/de) point back like the personal pronouns. The bare
 * "esta(s)" is left out: folded, it is also the verb "está(s)". */
const DEMONSTRATIVES = ["esse", "essa", "esses", "essas", "este", "esta", "estes", "estas", "aquele", "aquela", "aqueles", "aquelas"];
const MARKERS = new Set(["mesmo", "mesma", "mesmos", "mesmas", "igual", "iguais", "ele", "ela", "eles", "elas", "dele", "dela", "deles", "delas",
  "nele", "nela", "neles", "nelas", "junto", "junta", "juntos", "juntas",
  ...DEMONSTRATIVES.flatMap(word => [...word === "esta" || word === "estas" ? [] : [word], "n" + word, "d" + word])]);
const words = (text: string) => foldedLiteral(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** "sem (ser) no horário dela" / "menos nesse dia" deny a reference: a "sem", "menos" or "exceto" of the literal's clause
 * before it or inside it. */
function withoutDenied(message: string, start: number, end: number) {
  let from = start;
  while (from > 0 && !/[,.;!?()\n]/.test(message[from - 1])) from--;
  return /(?<![\p{L}\p{N}])(?:sem|menos|exceto)(?![\p{L}\p{N}])/u.test(foldedLiteral(message.slice(from, end)));
}
/** Review (demonstratives): a date/time reference is the whole temporal expression around its literal, never a clipped
 * part of it. The widened expression may not state a value of the field's own kind ("nesse dia 2", "no mesmo dia, sexta",
 * "naquele horário das 3") nor open with a limit word up to the literal ("depois desse dia", "até aquele horário"); a
 * limit after it belongs to what follows ("nesse dia até as 16h"). `stated`: Luna also gave her own value of the field. */
function temporalReferenceClipped(message: string, spans: readonly [number, number][], field: "date" | "time", stated: boolean) {
  const scan = temporalScan(message);
  if (!scan) return true;
  return spans.some(([start, end]) => {
    const wide = scan.widen(start, end), facts = scan.facts(wide.from, wide.to);
    if (scan.bounded(wide.from, scan.folded(end))) return true;
    // Luna stating her own value of the field is reconciled by agreement (SAME_AS_AGREED / SAME_AS_CONFLICT asks).
    if (stated) return false;
    return field === "date" ? facts.relative.length + facts.weekdays.length + facts.months.length + facts.dateNums.length + facts.countNums.length > 0 ||
      facts.semana || facts.alternatives : facts.clockSeq.length > 0;
  });
}
/** A reference literal is the owner's own words for "that other action's value" (structure only, never intent): a
 * whole-token span of the message (inside this action's verified clause when there is one) that no negator of its clause
 * denies, that states no date or clock of its own, and that holds an anaphora/identity word or a word of the referenced
 * action's subject ("no horário da Amanda"). Otherwise the reference is not honored and the field is asked.
 * Review: without a verified clause the literal must occur exactly once (a sibling's occurrence never proves this
 * action's own negated one); every occurrence considered must be undenied, and "sem (ser)" denies like a negator. */
export function referenceLiteralProven(message: string, literal: string, clause: readonly [number, number] | undefined, operation: string,
  subjects: readonly string[], timezone: string, now: Date, field?: SameAsField, stated = false) {
  if (!literalGrounded(message, literal, clause, operation, timezone, now, field, stated)) return false;
  const names = new Set(subjects.flatMap(words).filter(word => word.length >= 3));
  return words(literal).some(word => MARKERS.has(word) || names.has(word));
}
/** The structural part of the proof of a reference literal (everything but its anaphora/identity word). */
function literalGrounded(message: string, literal: string, clause: readonly [number, number] | undefined, operation: string, timezone: string, now: Date,
  field?: SameAsField, stated = false) {
  // Review: every tolerant occurrence counts (one differing only in case or accents may be the negated one).
  const spans = literalSpans(message, literal).filter(([start, end]) => !clause || start >= clause[0] && end <= clause[1]);
  if (!spans.length || !clause && spans.length !== 1) return false;
  if (spans.some(([start, end]) => temporalQuoteDenied(message, start, end, operation) || withoutDenied(message, start, end))) return false;
  if ((field === "date" || field === "time") && temporalReferenceClipped(message, spans, field, stated)) return false;
  const facts = quoteTemporalFacts(literal, timezone, now);
  if (facts.invalid || facts.dates.length || facts.days.length || facts.weekdays.length || facts.clocks.length) return false;
  // Review A (V2): a person's or service's reference that states a daypart ("a primeira cliente da tarde") narrows it: not a reference.
  return !(referencesV2Enabled() && field !== undefined && field !== "date" && field !== "time" && facts.period);
}

/** C4 R-B (V2, flag SALON_SECRETARY_REFERENCES_V2): a same_as literal that is no reference at all but THIS action's own value
 * ("e a Lia tb depois de amanhã às 11" with a date literal "depois de amanhã"; "e o Téo no mesmo dia às 11, também para barba"
 * with a service literal "também para barba"). It stays refused as a reference; it may only become this action's OWN value
 * (never the referenced action's) when: the field is a day, a clock or a service; its single occurrence lies inside this
 * action's verified clause; no negator or "sem/menos/exceto" of its clause denies it; a day/clock literal opens with no limit
 * word; and it holds no anaphora/identity word nor a word of the referenced subject (a reference that also states a value keeps
 * being asked). Returns that message span; the value it states is then derived (statedDayComponent / statedClockComponent /
 * statedServiceSpan: only the value's own words and closed glue, OWN_GLUE; never an exclusion or an offset from the other
 * action) and verified by the ordinary proof. */
export function ownLiteralSpan(message: string, literal: string, clause: readonly [number, number] | undefined, operation: string, subjects: readonly string[],
  field: SameAsField): [number, number] | undefined {
  if (!referencesV2Enabled() || !clause || (field !== "date" && field !== "time" && field !== "service")) return;
  const spans = literalSpans(message, literal).filter(([start, end]) => start >= clause[0] && end <= clause[1]);
  if (spans.length !== 1) return;
  const [start, end] = spans[0];
  if (temporalQuoteDenied(message, start, end, operation) || withoutDenied(message, start, end)) return;
  const names = new Set(subjects.flatMap(words).filter(word => word.length >= 3));
  if (words(literal).some(word => MARKERS.has(word) || names.has(word))) return;
  if (field !== "service") {
    const scan = temporalScan(message);
    if (!scan || scan.bounded(scan.widen(start, end).from, scan.folded(end))) return;
  }
  return spans[0];
}
const noDay = { offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null };
/** Review of R-B (V2): the closed grammatical classes that may stand beside an own value inside a literal without changing it:
 * the articles; the prepositions and their contractions with the articles, which attach a value to its action ("pra barba", "na
 * sexta", "às 11"); and the additive focus adverbs "também"/"tb"/"tbm", which only add this action to the value's set. Every other
 * word must be the value itself (a catalog service's own words, or the closed temporal vocabulary of scheduling-temporal-reference).
 * Any other word (an exclusion or substitution head such as "fora", "tirando", "salvo", "exceção", "nada de", "em vez de"; an offset
 * from the other action such as "mais tarde", "dali a", "a mais"; a verb or a name) is a word the backend does not read here: the
 * literal states no own value, and the field is asked as before. A whitelist: an unknown word never becomes a value. */
const OWN_GLUE = new Set(["o", "a", "os", "as", "um", "uma", "de", "da", "do", "das", "dos", "d", "em", "no", "na", "nos", "nas", "ao", "aos", "pra", "pro", "pras", "pros", "para", "p",
  "tambem", "tb", "tbm"]);
type TemporalFacts = ReturnType<typeof temporalQuoteFacts>;
/** The facts of a temporal literal that may state an own value: every word closed temporal vocabulary or OWN_GLUE (numbers and
 * clock forms are tokens of their own) and no limit word ("depois", "até"…: a boundary, never a value; "depois de amanhã" is a day). */
function ownTemporalFacts(text: string): TemporalFacts | undefined {
  const facts = temporalQuoteFacts(text), scan = temporalScan(text);
  if (!scan || scan.bounded(0, scan.folded(text.length))) return;
  return facts.list.every(token => token.k !== "word" || temporalVocabulary(token.w) || OWN_GLUE.has(token.w)) ? facts : undefined;
}
/** Review of R-B (V2): closed class of the leads that anchor a count of days on TODAY: "daqui" (de + aqui: "daqui a dois dias") and
 * "em" before the count ("em 3 dias"). A count without one ("dois dias", "dali a dois dias", "2 dias a mais") is an offset from
 * something else (in a reference, the other action's day), never a day from today; "dentro de" (a deadline) and "durante" (a span)
 * state no single day either. Only the article/preposition "a" may stand between the lead and the count. */
const NOW_ANCHORS = new Set(["daqui", "em"]);
const anchoredOnToday = (facts: TemporalFacts, token: TemporalFacts["countNums"][number]) => {
  let i = facts.list.indexOf(token) - 1;
  while (i >= 0 && facts.list[i].k === "word" && (facts.list[i] as { w: string }).w === "a") i--;
  const lead = facts.list[i];
  return lead?.k === "word" && NOW_ANCHORS.has((lead as { w: string }).w);
};
/** The day component a literal states by itself: each published kind its own tokens could state, kept only when the ordinary
 * component proof accepts it (verifyDayComponent). A literal with a clock or a daypart, or with no single reading, states none;
 * nor does one with a word outside the temporal vocabulary and OWN_GLUE, or a count of days not anchored on today. */
export function statedDayComponent(text: string, today: string, operation: string): DayComponent | undefined {
  const facts = ownTemporalFacts(text);
  if (!facts || facts.clockSeq.length || facts.dayparts.length) return;
  const months = [...facts.months, ...facts.dateNums.filter(token => token.part === "month").map(token => token.n)], years = facts.dateNums.filter(token => token.part === "year").map(token => token.n);
  const candidates: DayComponent[] = [...facts.relative.map(offset => ({ ...noDay, kind: "RELATIVE_DAY" as const, offset })),
    ...facts.countNums.filter(token => anchoredOnToday(facts, token)).map(token => ({ ...noDay, kind: "DAYS_FROM_NOW" as const, days: token.n * (token.unit ?? 1) })),
    ...facts.weekdays.flatMap(weekday => weekScopes.map(week => ({ ...noDay, kind: "WEEKDAY" as const, weekday, week }))),
    ...facts.dateNums.filter(token => token.part === "day").map(token => ({ ...noDay, kind: "DAY_OF_MONTH" as const, day: token.n, month: months[0] ?? null, year: years[0] ?? null,
      weekday: facts.weekdays.length === 1 ? facts.weekdays[0] : null }))];
  const found = candidates.filter(value => verifyDayComponent(text, value, today, { direction: dayDirection("date", operation), role: "date", operation }).status !== "REJECTED");
  return found.length === 1 ? found[0] : undefined;
}
/** Review of R-B (V2): closed class of the words that introduce a clock time, as scheduling-temporal-reference reads them ("às 11",
 * "pelas 3", "umas 10", "pras 9", "das 10", "lá pelas"; its limit "até" aside, a limit is never an own value). A number of hours
 * without one ("duas horas mais tarde", "dali a duas horas", "2 horas") may be a duration from something else, never a clock; a
 * clock written in a clock form ("11h", "10h30", "10:30") or an anchor ("meio-dia") needs none. */
const CLOCK_LEADS = new Set(["as", "pelas", "umas", "pras", "pra", "das", "las"]);
const clockForm = (facts: TemporalFacts, hour: TemporalFacts["clockSeq"][number]) => {
  const lead = facts.list[hour.i - 1];
  return hour.anchor || /^\d{1,2}(?::\d{2}|h\d{0,2})$/.test(facts.text.slice(hour.at, hour.to)) || lead?.k === "word" && CLOCK_LEADS.has((lead as { w: string }).w);
};
/** The clock component a literal states by itself: its one written hour as said, the daypart it writes (else UNSPECIFIED) and
 * the minute the ordinary proof accepts. A literal that states only a day (or a day too) states no clock; nor does one with a word
 * outside the temporal vocabulary and OWN_GLUE, or an hour not written as a clock. */
export function statedClockComponent(text: string, operation: string): ClockComponent | undefined {
  const facts = ownTemporalFacts(text), hours = facts?.clockSeq.filter(token => token.part !== "minute") ?? [];
  if (!facts || facts.relative.length || facts.weekdays.length || facts.months.length || facts.dateNums.length || facts.countNums.length || facts.dayparts.length > 1 || hours.length !== 1) return;
  if (!clockForm(facts, hours[0])) return;
  const daypart = (facts.dayparts[0] ?? "UNSPECIFIED") as ClockComponent["daypart"];
  const found = [0, ...facts.clockSeq.filter(token => token !== hours[0]).map(token => token.n)].map(minute => ({ hour: hours[0].n, minute, daypart }))
    .filter(value => verifyClockComponent(text, value, { role: "time", operation }).status !== "REJECTED");
  return found.length === 1 ? found[0] : undefined;
}
/** The one span of a literal that names exactly one service of the salon's catalog (tenant facts; whole tokens, case and accents
 * folded), every other word of the literal being OWN_GLUE ("também pra barba"; never "fora a barba", "em vez de barba"). Two
 * services, a repeated or no mention: none. Offsets are relative to `text`. */
export function statedServiceSpan(text: string, catalog: readonly string[]): [number, number] | undefined {
  const hits = catalog.flatMap(name => literalSpans(text, name).map(span => ({ name: foldedLiteral(name), span })));
  if (hits.length !== 1) return;
  const [start, end] = hits[0].span;
  return words(text.slice(0, start) + " " + text.slice(end)).every(word => OWN_GLUE.has(word)) ? hits[0].span : undefined;
}
/** An own value taken from a literal: a temporal evidence entry of its role (a component, as Luna would have quoted it) or the
 * owner's own service words. */
export type OwnLiteral = { field: "date" | "time"; text: string; component: DayComponent | ClockComponent } | { field: "service"; text: string };
/** The operation with an own value added: the evidence entry goes after the affirmed ones and before the exclusions. */
export function withOwnLiteral(op: SelectedOperation, own: OwnLiteral): SelectedOperation {
  if (own.field === "service") return { ...op, service_name: own.text } as SelectedOperation;
  const evidence = (op.temporal_evidence ?? []) as NonNullable<SelectedOperation["temporal_evidence"]>, entry = { field: own.field, text: own.text, component: own.component };
  return { ...op, temporal_evidence: [...evidence.filter(item => item.excluded === undefined), entry, ...evidence.filter(item => item.excluded !== undefined)] } as SelectedOperation;
}
/** The ordinary grounding of this action's own source proves a temporal own value: the role gets a value, or a precise question
 * of that role (a half-day or calendar choice). Anything else is not used (the field is asked as before). */
export function ownLiteralGrounds(op: SelectedOperation, own: Extract<OwnLiteral, { field: "date" | "time" }>, source: string | undefined, timezone: string, now: Date) {
  try {
    const projected = projectSchedulingOperation(withOwnLiteral(op, own));
    const grounded = groundSchedulingTemporalTurn({}, projected.fields, source, timezone, now, undefined, projected.operation, projected.temporal_evidence);
    return typeof grounded.patch[own.field] === "string" || grounded.pending_temporal_ambiguities.some(item => item.field === own.field) ||
      grounded.pending_calendar_conflicts.some(item => item.field === own.field);
  } catch { return false; }
}
/** The own value a refused literal states for its field, verified by the ordinary proof (see ownLiteralSpan). */
export function ownLiteralValue(op: SelectedOperation, message: string, span: readonly [number, number], field: SameAsField, source: string | undefined, timezone: string, now: Date,
  catalog?: readonly string[]): OwnLiteral | undefined {
  const text = message.slice(span[0], span[1]);
  if (field === "service") {
    const said = op as { service_name?: string | null; service_names?: readonly string[] | null };
    const found = catalog && said.service_name == null && said.service_names == null ? statedServiceSpan(text, catalog) : undefined;
    return found ? { field, text: text.slice(found[0], found[1]) } : undefined;
  }
  if (field !== "date" && field !== "time") return;
  const component = field === "date" ? statedDayComponent(text, dateKeyInTimeZone(now, timezone), op.operation) : statedClockComponent(text, op.operation);
  const own = component ? { field, text, component } : undefined;
  return own && ownLiteralGrounds(op, own, source, timezone, now) ? own : undefined;
}

/** Closed grammatical class of genitive/possessive heads ("de/da/do/das/dos", "dele/dela/deles/delas" and the contractions of
 * "de" with the demonstratives): what follows them names SOMEONE (or something) whose value is meant. */
const GENITIVES = new Set(["de", "da", "do", "das", "dos", "dele", "dela", "deles", "delas", ...DEMONSTRATIVES.map(word => "d" + word)]);
/** D-SELF-ORIGIN (V2): a change naming ITS OWN origin ("pra sexta no mesmo horário"): the ordinary proof (inside this action's
 * clause, never negated, no own clock or date, an identity marker) plus the genitive guard of the review: the literal is
 * widened across a following genitive or possessive complement, and any such complement means another value ("no mesmo
 * horário da Bia", "no mesmo horário dela"): never a self-reference, so the field is asked. */
export function selfReferenceProven(message: string, literal: string, clause: readonly [number, number] | undefined, operation: string, timezone: string, now: Date,
  field: SameAsField, stated = false, holder?: SelfHolder) {
  const kept = keptOwnValue(message, literal, clause, operation, timezone, now, field, stated, holder);
  if (kept !== undefined) return kept;
  if (!referenceLiteralProven(message, literal, clause, operation, [], timezone, now, field, stated)) return false;
  return !literalSpans(message, literal).filter(([start, end]) => !clause || start >= clause[0] && end <= clause[1]).some(([start, end]) => {
    // C4 R-B2: a relative clause naming the appointment's own holder is transparent (neither a comparative nor a complement).
    const held = heldRelative(message, [start, end], holder), stop = Math.max(end, held?.[1] ?? end);
    const own = held ? `${message.slice(start, Math.min(end, held[0]))} ${message.slice(Math.min(end, held[1]), end)}` : message.slice(start, end);
    if (words(own).some(word => GENITIVES.has(word) || COMPARATIVES.has(word) && word !== "igual" && word !== "iguais" || COMITATIVES.has(word))) return true;
    const next = /^\s*([\p{L}\p{N}]+)/u.exec(message.slice(stop)); return !!next && GENITIVES.has(words(next[1])[0] ?? "") || selfComplemented(message, start, stop);
  });
}
/** C4 R-B2 (owner rules 2 and 4, V2): closed class of the verbs that keep a value as it is (manter, conservar; accents folded), and
 * the connectors that may open a literal before one. */
const KEEP_VERBS = new Set(["manter", "mantem", "mantenha", "mantenham", "mantendo", "mantenho", "mantemos", "mantido", "mantida", "conservar", "conserva", "conserve",
  "conservem", "conservando"]);
const KEEP_LEADS = new Set(["e", "mas", "so"]);
/** The shape of an explicit keep of the moved appointment's own value, read on the literal's words (or on the literal with the one word
 * of its clause right before it, when that word is the keep verb): [connector] keep-verb [o|a] [mesmo|mesma] head-of-the-field
 * [dela|dele], and nothing else. The head names the field (time: horário/hora; date: dia/data). */
function keepShape(message: string, [start, end]: readonly [number, number], field: SameAsField): { possessive?: "ela" | "ele" } | undefined {
  const heads = field === "time" ? ["horario", "hora"] : field === "date" ? ["dia", "data"] : [];
  let list = words(message.slice(start, end));
  if (!KEEP_VERBS.has(list.find(word => !KEEP_LEADS.has(word)) ?? "")) {
    const before = /([\p{L}\p{N}]+)[^\p{L}\p{N}]*$/u.exec(message.slice(0, start));
    if (!before || /[,.;!?()\n]/.test(message.slice(before.index + before[1].length, start))) return;
    list = [...words(before[1]), ...list];
  }
  let i = 0;
  while (KEEP_LEADS.has(list[i] ?? "")) i++;
  if (!KEEP_VERBS.has(list[i++] ?? "")) return;
  if (list[i] === "o" || list[i] === "a") i++;
  if (list[i] === "mesmo" || list[i] === "mesma") i++;
  if (!heads.includes(list[i++] ?? "")) return;
  const possessive = list[i] === "dela" ? "ela" : list[i] === "dele" ? "ele" : undefined;
  if (possessive) i++;
  return i === list.length ? { ...(possessive ? { possessive } : {}) } : undefined;
}
/** C4 R-B2 (owner rules 2 and 4, V2): "mantém o horário (dela)" in a change is an explicit request to keep the moved appointment's own
 * value, never another person's: the ordinary structural proof (inside this action's clause, never negated, no own clock or date) of a
 * literal of the keep shape, whose possessive (in the literal or right after it) is the holder's (the request names nobody else and the
 * pronoun agrees with the owner's own article before the customer), with no genitive, comparative or comitative complement after it.
 * Undefined when the literal has no keep shape (the historical rules apply); only with a holder (the V2 self-origin path). */
function keptOwnValue(message: string, literal: string, clause: readonly [number, number] | undefined, operation: string, timezone: string, now: Date,
  field: SameAsField, stated: boolean, holder: SelfHolder | undefined): boolean | undefined {
  if (!holder || !referencesV2Enabled()) return;
  const spans = literalSpans(message, literal).filter(([start, end]) => !clause || start >= clause[0] && end <= clause[1]);
  const shapes = spans.map(span => keepShape(message, span, field));
  if (!spans.length || shapes.some(shape => !shape)) return;
  if (!literalGrounded(message, literal, clause, operation, timezone, now, field, stated)) return false;
  return !spans.some(([start, end], k) => {
    let stop = end, possessive = shapes[k]!.possessive;
    const next = /^\s*([\p{L}\p{N}]+)/u.exec(message.slice(end)), word = next ? words(next[1])[0] ?? "" : "";
    if (!possessive && (word === "dela" || word === "dele")) { possessive = word === "dela" ? "ela" : "ele"; stop = end + next![0].length; }
    if (possessive && !holderPronoun(message, holder, possessive)) return true;
    const after = /^\s*([\p{L}\p{N}]+)/u.exec(message.slice(stop));
    return !!after && GENITIVES.has(words(after[1])[0] ?? "") || selfComplemented(message, start, stop);
  });
}
/** A singular personal pronoun is the holder's only when the request names nobody else and the owner wrote a determiner of the
 * pronoun's gender before at least one mention of the customer and none of the other gender (never read from the name). */
function holderPronoun(message: string, holder: SelfHolder, pronoun: "ela" | "ele") {
  if (holder.others.length) return false;
  const mine = new Set(words(holder.customer ?? "").filter(word => word.length >= 3)), all = words(message);
  const marks = all.filter((word, k) => mine.has(all[k + 1] ?? "") && (FEMININE.has(word) || MASCULINE.has(word)));
  return marks.length > 0 && !marks.some(mark => (pronoun === "ela" ? MASCULINE : FEMININE).has(mark));
}
/** C4 R-B2 (D-SELF, V2): who holds the moved appointment, for a relative clause that names that holder ("pra sexta no mesmo horário
 * que ela já tinha"): the action's own customer as Luna quoted it, and every other person the request names (the other actions of the
 * active plan, this action's professional). */
export type SelfHolder = { customer?: string | null; others: readonly string[] };
export function selfHolder(actions: readonly PlanAction[], action: PlanAction, op: SelectedOperation): SelfHolder {
  const said = (fields: object) => { const f = fields as { customer_name?: unknown; professional_name?: unknown; target_professional_name?: unknown; communication?: { recipient_name?: unknown } | null };
    return [f.customer_name, f.professional_name, f.target_professional_name, f.communication?.recipient_name]; };
  const customer = (op as { customer_name?: string | null }).customer_name ?? null, mine = said(op).slice(1);
  const others = [...actions.filter(item => item.key !== action.key).flatMap(item => said(item.fields)), ...mine]
    .filter((name): name is string => typeof name === "string" && name.trim() !== "" && !(customer && (nameAgrees(name, customer) || nameAgrees(customer, name))));
  return { customer, others };
}
/** Closed classes of a relative clause stating that the value is the one the appointment already HOLDS ("que ela já tinha", "que
 * estava marcado", "que a Iara tinha antes"): the head nouns of "o mesmo X"; the verbs of having, being and booking as typed (ter,
 * estar, ser, marcar, agendar, reservar; accents folded), the auxiliaries that only take a booking participle ("foi marcado", "está
 * agendada") and those participles; the aspect adverbs "já"/"antes". Any other verb ("que ela pediu", "que ela quer") or a bare
 * comparative ("que a Bia") states another value. */
const SELF_HEADS = new Set(["horario", "horarios", "hora", "dia", "data"]);
const HELD_VERBS = new Set(["tinha", "tinham", "tem", "teve", "tiveram", "estava", "estavam", "tava", "tavam", "era", "eram", "marcou", "marcaram", "agendou", "agendaram", "reservou", "reservaram"]);
const HELD_AUX = new Set([...HELD_VERBS, "esta", "ta", "foi", "foram"]);
const HELD_PARTICIPLES = new Set(["marcado", "marcada", "marcados", "marcadas", "agendado", "agendada", "agendados", "agendadas", "reservado", "reservada", "reservados", "reservadas"]);
/** Closed class of the determiners that mark a person's grammatical gender in the owner's own words ("a Hana", "da Hana", "o Téo"). */
const FEMININE = new Set(["a", "da", "na", "pela"]), MASCULINE = new Set(["o", "do", "no", "pelo", "pro", "ao"]);
/** The relative clause right after the identity head of a self reference ("mesmo/mesma [horário|dia…] que …", in the literal's clause,
 * before any boundary punctuation, followed by nothing but a new clause), when it says the value is the one the appointment's holder
 * already has: its subject is this action's own customer (words of her own mention), or it is omitted or a singular personal pronoun
 * ("ela"/"ele") while the request names nobody else; a pronoun must also agree with the determiner the owner wrote before every mention
 * of that customer (at least one; the gender is read from the owner's article, never from the name). Its message span, or nothing
 * (the historical refusal). */
function heldRelative(message: string, span: readonly [number, number], holder: SelfHolder | undefined): [number, number] | undefined {
  if (!holder || !referencesV2Enabled()) return;
  let stop = span[0];
  while (stop < message.length && !/[,.;!?()\n]/.test(message[stop])) stop++;
  const list = [...message.slice(span[0], stop).matchAll(/[\p{L}\p{N}]+/gu)].map(m => ({ w: foldedLiteral(m[0]), at: span[0] + m.index!, to: span[0] + m.index! + m[0].length }));
  const w = (i: number) => list[i]?.w ?? "", mine = new Set(words(holder.customer ?? "").filter(word => word.length >= 3));
  let i = list.findIndex(token => token.at < span[1] && (token.w === "mesmo" || token.w === "mesma")) + 1;
  if (i <= 0) return;
  if (SELF_HEADS.has(w(i))) i++;
  if (w(i) !== "que" && w(i) !== "q") return;
  const from = list[i++].at;
  let subject: "name" | "ela" | "ele" | undefined;
  if ((FEMININE.has(w(i)) || MASCULINE.has(w(i))) && mine.has(w(i + 1))) i++;
  if (mine.has(w(i))) {
    subject = "name"; const said: string[] = [];
    while (mine.has(w(i))) said.push(w(i++));
    // Fixer: the subject must single out the customer: words that are also the whole mention of another person of the request
    // ("que a Ana tinha" beside an Ana Clara and an Ana Paula) name either of them, so the relative stays a comparative term.
    if (holder.others.some(other => nameAgrees(said.join(" "), other))) return;
  }
  else if (w(i) === "ela" || w(i) === "ele") subject = w(i++) as "ela" | "ele";
  while (w(i) === "ja") i++;
  if (HELD_AUX.has(w(i)) && HELD_PARTICIPLES.has(w(i + 1))) i += 2;
  else if (HELD_VERBS.has(w(i))) i++;
  else return;
  while (w(i) === "ja" || w(i) === "antes") i++;
  // Only a new MAIN clause may follow it before the boundary: a word after the relative ("que ela tinha no sábado") and a
  // subordinate clause ("que ela tinha quando vinha de manhã", "… se for de manhã") qualify the held slot.
  if (i < list.length && !NEW_MAIN_CLAUSE.has(w(i))) return;
  if (subject !== "name") {
    if (holder.others.length) return;
    if (subject) {
      const all = words(message), marks = all.filter((word, k) => mine.has(all[k + 1] ?? "") && (FEMININE.has(word) || MASCULINE.has(word)));
      if (!marks.length || marks.some(mark => (subject === "ela" ? MASCULINE : FEMININE).has(mark))) return;
    }
  }
  return [from, list[i - 1].to];
}
/** Review A (D-SELF): closed grammatical classes of the heads that attach a term of comparison to "o mesmo X": the comparative
 * heads (que, quanto, como, qual, igual/iguais, idêntico(s)/idêntica(s) and the colloquial comparative preposition "tipo") and the
 * comitative ones ("junto(s)/junta(s)", "com"). */
const COMPARATIVES = new Set(["que", "quanto", "como", "qual", "igual", "iguais", "identico", "identica", "identicos", "identicas", "tipo"]);
const COMITATIVES = new Set(["junto", "junta", "juntos", "juntas", "com"]);
/** Clause connectors that open a new clause after a self-reference (the comparative "que" is not one here). */
const SELF_CONNECTORS = new Set(["e", "mas", "porem", "pois", "porque", "se", "quando", "caso", "entao"]);
/** Fixer (V2): the coordinators among them that open a new MAIN clause; the subordinators ("quando", "se", "caso", "porque",
 * "pois") open a clause that qualifies what precedes it ("no mesmo horário quando ela vinha de manhã"). */
const NEW_MAIN_CLAUSE = new Set(["e", "mas", "porem", "entao"]);
/** The destination's own temporal words that may follow a self-reference in its clause ("no mesmo horário na sexta que vem"):
 * prepositions and articles that join them, the calendar and clock nouns and their qualifiers (closed classes). */
const SELF_TEMPORAL = new Set(["em", "no", "na", "nos", "nas", "pra", "pro", "para", "a", "as", "o", "os", "ao", "aos", "dia", "dias", "semana", "semanas", "mes", "meses",
  "hora", "horas", "h", "feira", "vem", "proxima", "proximo", "seguinte", "hoje", "hj", "amanha", "domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado",
  "manha", "tarde", "noite", "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]);
/** Review A (D-SELF): "no mesmo horário" is complete by itself. Anything else attached to it names the term of the comparison
 * (someone else's value): in its clause only the destination's own temporal words may follow it ("pra sexta no mesmo horário",
 * "no mesmo horário na sexta que vem"; never "que a Bia", "igual ao da Bia", "junto com a Bia"); past punctuation, a next segment
 * that is not a new clause may not hold a genitive, comparative or comitative head (", o da Bia", ", igual a Bia"); and no
 * comparative or comitative head leads it in its own clause ("junto com a Bia no mesmo horário"). Structure only. */
function selfComplemented(message: string, start: number, end: number) {
  const boundary = /[,.;!?()\n]/, after = (from: number) => { let to = from; while (to < message.length && !boundary.test(message[to])) to++; return to; };
  let from = start;
  while (from > 0 && !boundary.test(message[from - 1])) from--;
  // The lead of its own clause (after the last connector): "junto com a Bia no mesmo horário", "igual a Bia, no mesmo horário".
  const lead = words(message.slice(from, start)), opened = lead.map(word => SELF_CONNECTORS.has(word)).lastIndexOf(true);
  if (lead.slice(opened + 1).some(word => word.startsWith("junt") && COMITATIVES.has(word) || COMPARATIVES.has(word) && word !== "que" && word !== "tipo")) return true;
  const stop = after(end), tail = words(message.slice(end, stop));
  for (const [i, word] of tail.entries()) {
    // Fixer: a coordinator opens a new main clause; a subordinator in the same clause qualifies the reference ("no mesmo horário
    // quando ela vinha de manhã", "… se for de manhã"), so it is a complement.
    if (SELF_CONNECTORS.has(word)) return !NEW_MAIN_CLAUSE.has(word);
    if (/^\d/.test(word) || SELF_TEMPORAL.has(word) || word === "que" && tail[i + 1] === "vem" || word === "de" && tail[i + 1] === "amanha" || word === "depois" && tail[i + 1] === "de" && tail[i + 2] === "amanha") continue;
    return true;
  }
  if (stop >= message.length) return false;
  const next = words(message.slice(stop + 1, after(stop + 1)));
  return !!next.length && !SELF_CONNECTORS.has(next[0]) && next.some(word => GENITIVES.has(word) || COMPARATIVES.has(word) || COMITATIVES.has(word));
}

/** Closed grammatical classes that make a clause speak of ANOTHER value than a sibling's: negators ("não", "nem", "nunca",
 * "sem", "menos", "exceto") and alterity words ("outro(s)/outra(s)", "diferente(s)"). */
const NOT_SHARED = new Set(["nao", "nem", "nunca", "sem", "menos", "exceto", "outro", "outra", "outros", "outras", "diferente", "diferentes",
  // Review A: the contractions of "em"/"de" with the alterity words ("noutro dia", "doutra vez").
  "noutro", "noutra", "noutros", "noutras", "doutro", "doutra", "doutros", "doutras"]);
/** Review A: closed class of the calendar nouns: a clause naming one ("no dia seguinte", "na véspera", "no feriado", "no mês que
 * vem") speaks of a day of its own. */
const CALENDAR_NOUNS = new Set(["dia", "dias", "data", "datas", "vespera", "feriado", "feriados", "semana", "semanas", "mes", "meses"]);
/** Review A: the words that mention a professional in a clause: the comitative (the owner's "com X", "comigo") and any word of the
 * salon's professional directory (tenant facts, `directory`). */
const COMITATIVE_PRONOUNS = new Set(["com", "comigo", "c"]);
/** Closed class of function words that may precede a mention in a quote ("com a", "pra", "no"): stripped before comparing. */
const LEADING = new Set(["com", "a", "o", "as", "os", "pra", "pro", "para", "de", "da", "do", "na", "no", "em", "e"]);
const core = (text: string) => { const list = words(text); while (list.length && LEADING.has(list[0])) list.shift(); return list.join(" "); };
/** The sibling's own evidence for a field, as it quoted it: its affirmed temporal quotes (date/time) or its professional mention. */
export function ownEvidence(op: SelectedOperation, field: SameAsField): string[] {
  if (field === "professional") { const name = (op as { professional_name?: string | null }).professional_name; return typeof name === "string" && name.trim() ? [name] : []; }
  if (field !== "date" && field !== "time") return [];
  try { return (projectSchedulingOperation(op).temporal_evidence ?? []).filter(entry => entry.field === field && entry.excluded === undefined).map(entry => entry.text); } catch { return []; }
}
/** D4 (V2, review D4-DISTRIBUTIVE): a day or professional said ONCE for coordinated actions ("marca a Lia e o Téo amanhã",
 * "com a Nara"): the link's literal is the same span the referenced sibling quotes for that field. Accepted outside this
 * action's clause only when (a) it is span-identical (tolerant) to that sibling's own evidence and occurs inside the
 * sibling's verified clause or outside every clause (a shared prefix/suffix), never in this action's own clause; (b) this
 * action's own region (its clause and the unclaimed text around it) states no value of the field (a day: temporal facts,
 * qualifiers and calendar nouns; a professional: "com …"/"comigo" or a word of the salon's `directory`); (c) no negator or
 * alterity word is in that region; and no considered occurrence is negated. Structure only: the backend then copies the
 * sibling's ACCEPTED value, never this literal. A literal from a previous turn is not in the message and never proves. */
export function distributiveReferenceProven(message: string, literal: string, field: SameAsField, own: readonly [number, number] | undefined,
  sibling: { op: SelectedOperation; clause?: readonly [number, number] }, clauses: readonly (readonly [number, number])[], operation: string, directory: readonly string[] = []) {
  if (!own || (field !== "date" && field !== "professional")) return false;
  const wanted = core(literal);
  if (!wanted || !ownEvidence(sibling.op, field).some(text => core(text) === wanted)) return false;
  const inside = (span: readonly [number, number], clause?: readonly [number, number]) => !!clause && span[0] >= clause[0] && span[1] <= clause[1];
  const spans = literalSpans(message, literal);
  if (!spans.length || spans.some(span => inside(span, own))) return false;
  // Review A: this action's own region is its clause widened across the unclaimed text around it, up to the neighbouring verified
  // clauses (a clipped scope never hides ", esse na sexta" or ", só que com outra pessoa"); the linked literal's own occurrences
  // (a shared prefix/suffix) are blanked, so only this action's own words are read.
  const lead = Math.max(0, ...clauses.filter(clause => clause[1] <= own[0]).map(clause => clause[1]));
  const tail = Math.min(message.length, ...clauses.filter(clause => clause[0] >= own[1]).map(clause => clause[0]));
  const chars = message.split("");
  for (const [start, end] of spans) for (let i = start; i < end; i++) chars[i] = " ";
  const blanked = chars.join(""), region = words(blanked.slice(lead, tail));
  if (region.some(word => NOT_SHARED.has(word))) return false;
  if (field === "date") {
    const scan = temporalScan(blanked), facts = scan?.facts(scan.folded(lead), scan.folded(tail));
    // C4 R-B2: a calendar noun is a word of the region as the temporal scan reads it: the "dia" of a clock anchor ("meio-dia", "meio
    // dia") or of a greeting ("bom dia") names no day.
    if (!scan || !facts || facts.relative.length + facts.weekdays.length + facts.months.length + facts.dateNums.length + facts.countNums.length > 0 || facts.semana || facts.alternatives ||
      facts.next || facts.past || facts.other || facts.thisWeek || facts.list.some(token => token.k === "word" && CALENDAR_NOUNS.has(token.w))) return false;
  } else {
    const team = new Set(directory.flatMap(words).filter(word => word.length >= 3));
    if (region.some(word => COMITATIVE_PRONOUNS.has(word) || team.has(word))) return false;
  }
  const shared = spans.filter(span => inside(span, sibling.clause) || !clauses.some(clause => inside(span, clause)));
  // FX6 (review, safety): a value said outside every clause whose own segment singles one person out ("…, só ele na quinta") is not shared.
  if (shared.some(span => !clauses.some(clause => inside(span, clause)) && singlesOut(message, span, clauses))) return false;
  return shared.length > 0 && !shared.some(([start, end]) => temporalQuoteDenied(message, start, end, operation) || withoutDenied(message, start, end));
}
/** FX6 (review): closed classes that single ONE person out of coordinated actions: the restrictors ("só", "somente", "apenas") and
 * exception words, and the singular third-person pronouns (subject, genitive and locative contractions). */
const SINGLING = new Set(["so", "somente", "apenas", "exceto", "salvo", "menos", "tirando", "ele", "ela", "dele", "dela", "nele", "nela"]);
/** Whether the segment of a value said outside every clause (up to the punctuation or clause edges around it) singles one person out. */
export function singlesOut(message: string, span: readonly [number, number], clauses: readonly (readonly [number, number])[]) {
  let lead = span[0], tail = span[1];
  while (lead > 0 && !/[,.;!?()\n]/.test(message[lead - 1]) && !clauses.some(clause => clause[1] === lead)) lead--;
  while (tail < message.length && !/[,.;!?()\n]/.test(message[tail]) && !clauses.some(clause => clause[0] === tail)) tail++;
  return words(message.slice(lead, tail)).some(word => SINGLING.has(word));
}

const selectors = { date: ["date", "day_offset", "weekday"], time: ["time"] } as const;
/** A name Luna wrote agrees with a referenced person when every word of it is a word of the canonical name. */
export const nameAgrees = (said: string, canonical: string) => { const own = words(said), full = new Set(words(canonical)); return own.length > 0 && own.every(word => full.has(word)); };
/** Luna's own value, in this operation, of a field it also references. `stated`: she wrote one; `value`: a date/clock
 * grounded exactly as the adapter would (so "quinta" and its date agree), or the name she wrote. */
export function ownValue(op: SelectedOperation, field: SameAsField, source: string | undefined, timezone: string, now: Date): { stated: boolean; value?: string } {
  if (field === "professional" || field === "customer" || field === "service") {
    const names = op as { professional_name?: string | null; customer_name?: string | null; service_name?: string | null };
    const said = field === "professional" ? names.professional_name : field === "service" ? names.service_name : names.customer_name ?? op.communication?.recipient_name;
    return typeof said === "string" && said.trim() ? { stated: true, value: said } : { stated: false };
  }
  const projected = projectSchedulingOperation(op), fields = projected.fields as Record<string, unknown>;
  const quoted = (projected.temporal_evidence ?? []).some(entry => entry.field === field && entry.excluded === undefined);
  if (!quoted && !selectors[field].some(key => fields[key] !== undefined)) return { stated: false };
  const grounded = groundSchedulingTemporalTurn({}, projected.fields, source, timezone, now, undefined, projected.operation, projected.temporal_evidence);
  const value = grounded.patch[field];
  return { stated: true, ...(typeof value === "string" ? { value } : {}) };
}
/** The operation without Luna's own values of these fields (a contradicted or unusable one); exclusions stay. */
export function withoutOwn(op: SelectedOperation, fields: readonly SameAsField[]): SelectedOperation {
  const next = { ...op } as Record<string, unknown>;
  for (const field of fields) {
    if (field === "date" || field === "time") {
      for (const key of selectors[field]) if (key in next) next[key] = null;
      if (Array.isArray(next.temporal_evidence)) next.temporal_evidence = (next.temporal_evidence as { field: string; excluded?: unknown }[]).filter(entry => entry.field !== field || entry.excluded !== undefined);
    } else if (field === "professional") { if ("professional_name" in next) next.professional_name = null; }
    else if (field === "service") { if ("service_name" in next) next.service_name = null; if ("service_names" in next) next.service_names = null; }
    else {
      if ("customer_name" in next) next.customer_name = null;
      if (next.communication && typeof next.communication === "object") next.communication = { ...next.communication, recipient_name: null };
    }
  }
  if (Array.isArray(next.temporal_evidence) && !next.temporal_evidence.length) next.temporal_evidence = null;
  return next as SelectedOperation;
}
/** V2 (review A): the outcome of a reference whose value is a SET — a read's rows without one named mutable row, or several
 * services — the same at the first preparation and at every later follow: a card of the real options, the refusal notice, asked,
 * or (P2b, flag SALON_SECRETARY_MULTI_SERVICE; review B) the whole service list for a create outside a released slot (the owner
 * said the same services: all of them, never one picked). Undefined for a single value (or nothing known yet). */
export type ReferenceSetOutcome = { card?: NonNullable<SchedulingReferences["card"]>; notice?: string; asked?: SameAsField; list?: { names: string[]; refs: string[]; key: string }; code: string };
export function referenceSetOutcome(action: Pick<PlanAction, "operation" | "released_slot_of">, field: SameAsField, values: ReferencedValues): ReferenceSetOutcome | undefined {
  if (values.pick && values.pick.kind !== "ROW") {
    if (values.pick.kind === "CARD") return { card: { kind: "appointment_ref", items: values.pick.rows.map(row => ({ id: row.appointment_ref, name: `${row.customer_name} — ${formatLocal(row.start_local)} — ${row.professional_name}` })) }, code: "SAME_AS_READ_CARD" };
    if (values.pick.kind === "REFUSED") return { notice: `O agendamento indicado (${values.pick.row.customer_name} — ${formatLocal(values.pick.row.start_local)}) já começou ou foi encerrado e não pode ser alterado pela Secretária. Nada foi preparado para ele.`,
      asked: "customer", code: "SAME_AS_READ_REFUSED" };
    return { asked: field, code: "SAME_AS_READ_EMPTY" };
  }
  if (field !== "service" || !values.services?.length) return undefined;
  if (multiServiceEnabled() && action.operation === "appointment.create" && !action.released_slot_of)
    return { list: { names: values.services.map(item => item.name), refs: values.services.map(item => item.ref), key: serviceListKey(values.services.map(item => item.ref)) }, code: "SAME_AS_SEEDED_LIST" };
  return { card: { kind: "service_ref", items: values.services.map(item => ({ id: item.ref, name: item.name })) }, code: "SAME_AS_SERVICE_CARD" };
}
/** The comparable key of a seeded service list (its refs in order). */
export const serviceListKey = (refs: readonly string[]) => `list:${refs.join(",")}`;
/** Draft fields of a seeded service list; the single-service form is cleared (undefined: removed by the reseed). */
export const seededListFields = (list: { names: string[]; refs: string[] }) => ({ service_names: [...list.names], service_list_ref: [...list.refs], service_name: undefined, service_ref: undefined });
/** Draft fields that carry a referenced value in a scheduling dependent. */
export function seededFields(field: SameAsField, values: ReferencedValues): Record<string, string | undefined> {
  if (field === "date" || field === "time") return { [field]: values[field]! };
  const who = values[field]!;
  // A single service replaces a list seeded before (P2b; undefined: removed by the reseed).
  if (field === "service") return { service_ref: who.ref, service_name: who.name, ...(multiServiceEnabled() ? { service_names: undefined, service_list_ref: undefined } : {}) };
  // D2 (V2): a row of a read is that exact appointment (pinned by ref; the target never locates another one).
  return field === "professional" ? { professional_ref: who.ref, professional_name: who.name } : { customer_ref: who.ref, customer_name: who.name,
    ...(values.pick?.kind === "ROW" && values.appointment ? { appointment_ref: values.appointment } : {}) };
}
/** Comparable form of a link state (arrays as sets). */
export function referencesKey(state: SchedulingReferences | undefined) {
  const { blocked: _blocked, ...rest }: SchedulingReferences = state ?? {}; void _blocked;
  return JSON.stringify({ ...rest, waiting: [...rest.waiting ?? []].sort(), asked: [...rest.asked ?? []].sort(), seeded: Object.fromEntries(Object.entries(rest.seeded ?? {}).sort()) });
}
/** A referenced action that can no longer give a value it does not have (its value then never arrives). */
export const referenceGone = (status: string) => ["FAILED_SAFE", "UNSUPPORTED", "BLOCKED_BY_DEPENDENCY", "DISCARDED", "DONE"].includes(status);

/** C4 R-B2 (owner rule 7, flag SALON_SECRETARY_REFERENCES_V2): who a scheduling action names by a bare third-person pronoun ("e
 * desmarca o sábado dela"), read from the request's structure, never from Luna's pick. Closed classes: the singular personal and
 * possessive pronouns (their gender), the plural ones, and the words that single a person out otherwise (demonstratives and their
 * contractions, alterity words, the position ordinals, "mesmo/mesma"; the bare "esta(s)" is left out: folded, it is also the verb). */
const PERSONAL_PRONOUNS: Readonly<Record<string, "f" | "m">> = { ela: "f", dela: "f", nela: "f", ele: "m", dele: "m", nele: "m" };
const PLURAL_PRONOUNS = new Set(["elas", "eles", "delas", "deles", "nelas", "neles"]);
const PERSON_CUES = new Set([...DEMONSTRATIVES.flatMap(word => [...word === "esta" || word === "estas" ? [] : [word], "n" + word, "d" + word]),
  "outro", "outra", "outros", "outras", "noutro", "noutra", "doutro", "doutra", ...Object.keys(ORDINALS), "mesmo", "mesma"]);
const CUSTOMER_ACTIONS = ["appointment.cancel", "appointment.change", "appointment.create"];
/** The one span of a verbatim quote in the message (none when absent or repeated). */
const spanOnce = (message: string, text: string | null | undefined): [number, number] | undefined => {
  if (!text) return;
  const at = message.indexOf(text);
  return at < 0 || message.indexOf(text, at + 1) >= 0 ? undefined : [at, at + text.length];
};
const customerOf = (op: SelectedOperation) => { const name = (op as { customer_name?: string | null }).customer_name; return typeof name === "string" && name.trim() ? name : undefined; };
const samePerson = (a: string, b: string) => nameAgrees(a, b) || nameAgrees(b, a);
/** The determiners the owner wrote right before the mentions of a person ("a Jéssica", "o Téo"): the grammatical gender she gave. */
const genderMarks = (message: string, name: string) => {
  const mine = new Set(words(name).filter(word => word.length >= 3)), all = words(message);
  return all.filter((word, k) => mine.has(all[k + 1] ?? "") && (FEMININE.has(word) || MASCULINE.has(word)));
};
/** TOPIC (owner rule 7): the action's own region (its verified clause widened across the unclaimed text around it, up to the neighbouring
 * clauses) names nobody, holds a bare singular pronoun of one gender and no other cue, and the request said BEFORE it exactly one move of a
 * customer plus a new appointment of another customer in the slot that move frees: the pronoun is the moved customer (the topic), unless
 * her own article contradicts the pronoun's gender. AMBIGUOUS: otherwise, when the persons the other actions name still leave two or more
 * readings (a pronoun of a gender the owner's articles do not exclude), or Luna's pick is not one of them: the customer is asked, never
 * picked (a plural pronoun is never one of them). Undefined (the historical path): the flag is off, the action is not a
 * create/change/cancel, its clause is not a verbatim quote of the message (or overlaps another), it names someone itself, holds no
 * personal pronoun, or the request names fewer than two persons. */
export type PronounReferent = { kind: "TOPIC"; customer: string } | { kind: "AMBIGUOUS" };
export function pronounReferent(message: string, op: SelectedOperation, siblings: readonly SelectedOperation[]): PronounReferent | undefined {
  if (!referencesV2Enabled() || !CUSTOMER_ACTIONS.includes(op.operation)) return;
  const own = spanOnce(message, op.source_scope);
  if (!own) return;
  const others = siblings.filter(item => item !== op && item.item_key !== op.item_key), clauses = new Map(others.map(item => [item, spanOnce(message, item.source_scope)] as const));
  const spans = [...clauses.values()].filter((span): span is [number, number] => !!span);
  if (spans.some(span => span[0] < own[1] && own[0] < span[1])) return;
  const lead = Math.max(0, ...spans.filter(span => span[1] <= own[0]).map(span => span[1]));
  const tail = Math.min(message.length, ...spans.filter(span => span[0] >= own[1]).map(span => span[0]));
  const region = words(message.slice(lead, tail)), said = customerOf(op), candidates: string[] = [];
  for (const item of others) { const name = customerOf(item); if (name && literalSpans(message, name).length && !candidates.some(seen => samePerson(seen, name))) candidates.push(name); }
  const named = new Set([...candidates, ...said ? [said] : []].flatMap(words).filter(word => word.length >= 3));
  if (region.some(word => named.has(word))) return;
  const genders = new Set(region.flatMap(word => PERSONAL_PRONOUNS[word] ? [PERSONAL_PRONOUNS[word]] : [])), plural = region.some(word => PLURAL_PRONOUNS.has(word));
  if (!genders.size && !plural || candidates.length < 2) return;
  // FX6 (review, safety): a region word that shortens a person's name word (its first 3+ letters: "tami" for "Tamires"; closed-class
  // words aside) names that person: Luna's pick of that person stands (the historical path); a pick of anyone else is asked.
  const short = (word: string) => word.length >= 3 && !PERSONAL_PRONOUNS[word] && !PLURAL_PRONOUNS.has(word) && !PERSON_CUES.has(word) && !FEMININE.has(word) && !MASCULINE.has(word);
  const shortened = [...candidates, ...said ? [said] : []].filter(name => words(name).some(part => region.some(word => short(word) && part.length > word.length && part.startsWith(word))));
  if (shortened.length) return said && !shortened.every(name => samePerson(name, said)) ? { kind: "AMBIGUOUS" } : undefined;
  const bare = genders.size === 1 && !plural && !region.some(word => PERSON_CUES.has(word)), gender = [...genders][0];
  const fits = bare ? candidates.filter(name => !genderMarks(message, name).some(mark => (gender === "f" ? MASCULINE : FEMININE).has(mark))) : candidates;
  const before = (item: SelectedOperation) => { const span = clauses.get(item); return !!span && span[1] <= own[0]; };
  const moves = others.filter(change => change.operation === "appointment.change" && before(change) && customerOf(change) && others.some(fill => fill.operation === "appointment.create" &&
    fill.released_slot_of === change.item_key && before(fill) && customerOf(fill) && !samePerson(customerOf(fill)!, customerOf(change)!)));
  if (bare && moves.length === 1 && fits.some(name => samePerson(name, customerOf(moves[0])!))) {
    const topic = customerOf(moves[0])!;
    // FX6 (review, safety): the topic replaces a DIFFERENT pick of Luna's only on the owner's own article before the topic's name that
    // agrees with the pronoun ("a Jéssica … dela"); without it (gender is never read from a name) the customer is asked.
    if (said && !samePerson(said, topic) && !genderMarks(message, topic).some(mark => (gender === "f" ? FEMININE : MASCULINE).has(mark))) return { kind: "AMBIGUOUS" };
    return { kind: "TOPIC", customer: topic };
  }
  return fits.length >= 2 || said && !fits.some(name => samePerson(name, said)) ? { kind: "AMBIGUOUS" } : undefined;
}

/** C4 R-B2 (owner rule 8, flag SALON_SECRETARY_REFERENCES_V2): a block "between" the two appointments this request just defined ("e
 * bloqueia entre uma e outra"). Closed classes after the preposition "entre": the correlative pair ("uma e (a) outra", "um e (o)
 * outro"); a plural of the two ("elas", "eles", "ambas", "ambos", "as duas", "os dois", optionally with a demonstrative or article
 * and a plural head noun of an agenda: "os dois atendimentos", "esses horários"); or the two customers' own names ("entre a Lia e a
 * Duda"). The construct must close its clause or be followed by a new clause (a reason, a purpose, a coordinated action), never by a
 * qualifier; the block's clause states no clock and no daypart of its own; no negator or "sem/menos/exceto" denies it. Returns the
 * construct's message span; undefined (the block's times are asked, as before) otherwise. */
const BETWEEN_DETERMINERS = new Set(["os", "as", "esses", "essas", "estes", "estas", "aqueles", "aquelas"]);
const BETWEEN_PLURALS = new Set(["elas", "eles", "ambas", "ambos"]), BETWEEN_COUNTS = new Set(["dois", "duas"]);
const BETWEEN_HEADS = new Set(["atendimentos", "agendamentos", "horarios", "clientes", "marcacoes", "sessoes"]);
const BETWEEN_NEXT = new Set(["que", "q", "porque", "pq", "pois", "pra", "para", "e", "mas", "ai", "entao"]);
/** Closed class of the negators, exclusion heads and limit words that would narrow the interval after the construct. */
const BETWEEN_LIMITS = new Set(["nao", "nem", "nunca", "sem", "menos", "exceto", "tirando", "fora", "salvo", "ate", "depois", "antes", "desde", "partir", "so", "apenas", "somente"]);
export function betweenBookingsSpan(message: string, clause: readonly [number, number], operation: string, customers: readonly [string, string], timezone: string, now: Date): [number, number] | undefined {
  if (!referencesV2Enabled()) return;
  const text = message.slice(clause[0], clause[1]), facts = quoteTemporalFacts(text, timezone, now);
  if (facts.invalid || facts.clocks.length || facts.period) return;
  const list = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(m => ({ w: foldedLiteral(m[0]), at: clause[0] + m.index!, to: clause[0] + m.index! + m[0].length }));
  const heads = list.flatMap((token, i) => token.w === "entre" ? [i] : []);
  if (heads.length !== 1) return;
  const w = (k: number) => list[k]?.w ?? "";
  let i = heads[0] + 1;
  // The correlative pair: its length ("uma e outra": 3, "uma e a outra": 4), 0 when absent.
  const pair = (one: string, other: string, article: string) => w(i) !== one || w(i + 1) !== "e" ? 0 : w(i + 2) === other ? 3 : w(i + 2) === article && w(i + 3) === other ? 4 : 0;
  const correlative = pair("uma", "outra", "a") || pair("um", "outro", "o");
  if (correlative) i += correlative;
  else {
    const start = i;
    if (BETWEEN_DETERMINERS.has(w(i))) i++;
    if (BETWEEN_PLURALS.has(w(i))) { i++; if (BETWEEN_COUNTS.has(w(i))) i++; }
    else { const counted = BETWEEN_COUNTS.has(w(i)); if (counted) i++; if (BETWEEN_HEADS.has(w(i))) i++; else if (!counted || !BETWEEN_DETERMINERS.has(w(start))) i = start; }
    if (i === start) {
      // The two customers' own names, each once, in either order ("entre a Lia e a Duda").
      const person = (k: number) => {
        const at = FEMININE.has(w(k)) || MASCULINE.has(w(k)) ? k + 1 : k;
        for (const [n, who] of customers.entries()) { const mine = new Set(words(who).filter(word => word.length >= 3)); let size = 0; while (mine.has(w(at + size))) size++; if (size) return { n, to: at + size }; }
      };
      const first = person(i), second = first && w(first.to) === "e" ? person(first.to + 1) : undefined;
      if (!first || !second || first.n === second.n) return;
      i = second.to;
    }
  }
  const from = list[heads[0]].at, to = list[i - 1].to;
  if (/[,.;!?()\n]/.test(message.slice(from, to))) return;
  if (i < list.length && !/[,.;!?()\n]/.test(message.slice(to, list[i].at)) && !BETWEEN_NEXT.has(w(i))) return;
  // Nothing after it in the block's clause narrows or denies the interval ("…, sem ser no almoço", "… até o almoço", "… só depois").
  if (list.slice(i).some(token => BETWEEN_LIMITS.has(token.w))) return;
  return temporalQuoteDenied(message, from, to, operation) || withoutDenied(message, from, to) ? undefined : [from, to];
}
/** The free interval between two appointments of one professional on one day (start-sorted): the end of the first and the start of the
 * second, only when the first ends strictly before the second starts. */
export type BookedSlot = { startLocal: string; endLocal: string; professional_ref: string; professional_name: string };
export function betweenBookingsGap(slots: readonly [BookedSlot, BookedSlot]): { date: string; time: string; end_time: string; professional: { ref: string; name: string } } | undefined {
  const [first, second] = [...slots].sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  if (first.professional_ref !== second.professional_ref || first.startLocal.slice(0, 10) !== second.startLocal.slice(0, 10) || first.endLocal.slice(0, 10) !== first.startLocal.slice(0, 10)) return;
  if (!(first.endLocal < second.startLocal)) return;
  return { date: first.startLocal.slice(0, 10), time: first.endLocal.slice(11, 16), end_time: second.startLocal.slice(11, 16), professional: { ref: first.professional_ref, name: first.professional_name } };
}
