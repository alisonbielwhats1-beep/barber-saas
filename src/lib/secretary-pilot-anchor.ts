/** A* premise probe (docs/c5-spike/13-sonda-premissa-astar.md §3; Adendo 12): the pure anchor decision of a destination offset. Luna interprets
 * the owner once; after her this module sees only enums (numeric codes of its own), integers, booleans and local instants of the salon (a calendar
 * day as a day index, days since 1970-01-01 of the local calendar, and a minute of that day). No string enters it and it holds none: the evidence
 * and the cited mention reach it only as the containment booleans computed on arrival by the existing primitive pilotMentionIn, never as text.
 * Readings, a LIST per factual anchor (ORIGIN; PRESENT; CITED only when its reference is contained), each item a value or a drop reason:
 *  - DATE: ORIGIN = the appointment day + delta; PRESENT = the day of received_at + delta; CITED = each day the cited reference may name + delta,
 *    by the data_citada rules of the E2-B resolver (a day number without month: this month and, once passed, the next one that exists; with its
 *    month: the nearest occurrence; a weekday: decision 27; a relative month). Drops PAST and NO_SUCH_DATE.
 *  - TIME, on the destination day: ORIGIN = the appointment clock + minutes; PRESENT = the clock of received_at + minutes, only when the destination
 *    day is today (else OTHER_DAY); CITED = the cited clock + minutes, a bare hour 1-11 giving h and h+12 filtered by the working windows of that day
 *    (decision 18; none inside: NO_READING_IN_HOURS). Drops LEAVES_DAY and NOT_AHEAD.
 * Decision (spec 13 §3): an accepted claim (contained, typed, consistent with its anchor, its anchor factual) is used only when that anchor has
 * exactly one feasible reading and no contained cited reference competes with another reading; without an accepted claim, a reading that leaves
 * the day is asked, one distinct feasible value is used (COINCIDE) and several are asked. B2-SIM off, no PLAN anchor, no switch. */
type Values<T> = T[keyof T];
/** The field the destination offset sets. */
export const ANCHOR_FIELD = Object.freeze({ DATE: 1, TIME: 2 } as const);
/** The factual anchors: the appointment, the present (today or now) and the cited reference. */
export const ANCHOR = Object.freeze({ ORIGIN: 1, PRESENT: 2, CITED: 3 } as const);
/** tipo_evidencia of the contract (spec 13 §2): nomeia, deitico, desloca, outro. */
export const EVIDENCE = Object.freeze({ NOMEIA: 1, DEITICO: 2, DESLOCA: 3, OUTRO: 4 } as const);
/** Why an item of a reading list is no destination. */
export const DROP = Object.freeze({ PAST: 1, NO_SUCH_DATE: 2, LEAVES_DAY: 3, NOT_AHEAD: 4, NO_READING_IN_HOURS: 5, OTHER_DAY: 6 } as const);
export const OUTCOME = Object.freeze({ USE: 1, ASK: 2 } as const);
/** EVIDENCE: the accepted claim chose the reading; COINCIDE: every feasible reading is that one value (no anchor is settled by it). */
export const BASIS = Object.freeze({ EVIDENCE: 1, COINCIDE: 2 } as const);
export const ASK_REASON = Object.freeze({ DROPPED: 1, TWO_READINGS: 2, LITERAL_COMPETES: 3, LEAVES_DAY: 4 } as const);
/** The first condition of the accepted-claim rule that failed (telemetry), or ACCEPTED. */
export const CLAIM_STATE = Object.freeze({ NONE: 1, NOT_CONTAINED: 2, TYPE_OTHER: 3, TYPE_MISMATCH: 4, CITED_MISSING: 5, ANCHOR_ABSENT: 6, ACCEPTED: 7 } as const);
export const UNIT = Object.freeze({ DAYS: 1, WEEKS: 2 } as const);
/** The three forms of a cited day (CONTRACT-4): a day number with its month when said, a weekday, a day of a relative month. */
export const CITED_KIND = Object.freeze({ DAY_NUMBER: 1, WEEKDAY: 2, RELATIVE_MONTH: 3 } as const);
export const QUALIFIER = Object.freeze({ NONE: 0, ESTE: 1, PROXIMO: 2 } as const);
export const PERIOD = Object.freeze({ NONE: 0, MANHA: 1, TARDE: 2, NOITE: 3 } as const);
/** The bounds of the contract: a year of days either way, a day of minutes; a week is seven days. */
export const ANCHOR_LIMITS = Object.freeze({ days: 366, dayMinutes: 1440, weekDays: 7 });
export type FieldCode = Values<typeof ANCHOR_FIELD>;
export type AnchorCode = Values<typeof ANCHOR>;
export type EvidenceCode = Values<typeof EVIDENCE>;
export type DropCode = Values<typeof DROP>;
export type OutcomeCode = Values<typeof OUTCOME>;
export type BasisCode = Values<typeof BASIS>;
export type AskReasonCode = Values<typeof ASK_REASON>;
export type ClaimStateCode = Values<typeof CLAIM_STATE>;
export type UnitCode = Values<typeof UNIT>;
export type QualifierCode = Values<typeof QUALIFIER>;
export type PeriodCode = Values<typeof PERIOD>;
/** CONSISTENT (spec 13 §3): the anchors each evidence type may name; outro names none. */
export const CONSISTENT: Readonly<Record<EvidenceCode, readonly AnchorCode[]>> = Object.freeze({
  [EVIDENCE.NOMEIA]: Object.freeze([ANCHOR.ORIGIN, ANCHOR.CITED]), [EVIDENCE.DEITICO]: Object.freeze([ANCHOR.PRESENT]),
  [EVIDENCE.DESLOCA]: Object.freeze([ANCHOR.ORIGIN]), [EVIDENCE.OUTRO]: Object.freeze([]) });

/** A local instant of the salon: the calendar day (day index) and the minute of that day. */
export type LocalInstant = { readonly day: number; readonly minute: number };
/** What Luna claimed, as typed values only: the anchor, the evidence type and whether the evidence is contained in the message of the turn. */
export type AnchorClaim = { readonly anchor: AnchorCode; readonly evidenceType: EvidenceCode; readonly contained: boolean };
export type CitedDayFact =
  | { readonly kind: typeof CITED_KIND.DAY_NUMBER; readonly day: number; readonly month: number | null }
  | { readonly kind: typeof CITED_KIND.WEEKDAY; /** 0 Sunday to 6 Saturday */ readonly weekday: number; readonly qualifier: QualifierCode }
  | { readonly kind: typeof CITED_KIND.RELATIVE_MONTH; readonly day: number; readonly months: number };
export type CitedClockFact = { readonly hour: number; readonly minute: number; readonly period: PeriodCode };
/** One working interval of the destination day, in minutes [start, end). */
export type WorkingWindow = { readonly start: number; readonly end: number };
type CommonInput = { readonly claim: AnchorClaim | null; readonly citedContained: boolean; /** the frozen received_at */ readonly now: LocalInstant;
  /** the appointment (day and clock) */ readonly origin: LocalInstant };
export type DateAnchorInput = CommonInput & { readonly field: typeof ANCHOR_FIELD.DATE; readonly quantity: number; readonly unit: UnitCode; readonly cited: CitedDayFact | null };
export type TimeAnchorInput = CommonInput & { readonly field: typeof ANCHOR_FIELD.TIME; readonly minutes: number; readonly cited: CitedClockFact | null;
  /** the day the new clock falls on */ readonly destinationDay: number; readonly windows: readonly WorkingWindow[] };
export type AnchorInput = DateAnchorInput | TimeAnchorInput;
/** A day index (DATE) or a minute of the destination day (TIME); `value` is kept for PAST and NOT_AHEAD, null for the other drops. */
export type AnchorReading = { readonly value: number | null; readonly drop: DropCode | null };
export type AnchorReadingList = { readonly anchor: AnchorCode; readonly readings: readonly AnchorReading[] };
type DecisionCommon = { readonly claim: ClaimStateCode; readonly readings: readonly AnchorReadingList[] };
export type AnchorDecision =
  | (DecisionCommon & { readonly outcome: typeof OUTCOME.USE; readonly value: number; readonly basis: BasisCode; /** the accepted anchor; null for COINCIDE */ readonly anchor: AnchorCode | null })
  | (DecisionCommon & { readonly outcome: typeof OUTCOME.ASK; readonly reason: AskReasonCode; /** distinct, ascending */ readonly options: readonly number[]; readonly drops: readonly DropCode[] });

// ---------------------------------------------------------------- calendar facts (integers only)
const DAY_MS = 86_400_000;
/** The day index of a real calendar date, or null for a date the calendar does not have. */
export function localDay(year: number, month: number, day: number): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? at.getTime() / DAY_MS : null;
}
/** The calendar date of a day index. */
export function dayParts(index: number): { year: number; month: number; day: number } {
  const at = new Date(index * DAY_MS);
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}
/** 0 Sunday to 6 Saturday. */
export const weekdayOfDay = (index: number) => new Date(index * DAY_MS).getUTCDay();
const weekdayAfter = (weekday: number, from: number) => from + (((weekday - weekdayOfDay(from) + 7) % 7) || 7);
const present = (value: number | null): value is number => value !== null;
const distinctSorted = (values: readonly number[]) => [...new Set(values)].sort((a, b) => a - b);
/** The first day with that number from today on (a month without it is skipped). */
function nextDayNumbered(day: number, today: number): number | null {
  const { year, month } = dayParts(today);
  for (let step = 0; step < 24; step++) {
    const index = localDay(year + Math.floor((month - 1 + step) / 12), (month - 1 + step) % 12 + 1, day);
    if (index !== null && index >= today) return index;
  }
  return null;
}
/** That day of the month `months` after the current one (0 this month), never another month in its place. */
function relativeMonthDay(day: number, months: number, today: number): number | null {
  const { year, month } = dayParts(today), at = month - 1 + months;
  return localDay(year + Math.floor(at / 12), at % 12 + 1, day);
}
/** Every day the cited reference may name (the rules of pilotCitedDays). */
function citedDays(cited: CitedDayFact, origin: number, today: number): number[] {
  if (cited.kind === CITED_KIND.RELATIVE_MONTH) { const index = relativeMonthDay(cited.day, cited.months, today); return index === null ? [] : [index]; }
  if (cited.kind === CITED_KIND.WEEKDAY) {
    if (!Number.isInteger(cited.weekday) || cited.weekday < 0 || cited.weekday > 6) return [];
    const onToday = cited.qualifier !== QUALIFIER.PROXIMO && weekdayOfDay(today) === cited.weekday ? [today] : [];
    const afterOrigin = cited.qualifier === QUALIFIER.ESTE ? [] : [weekdayAfter(cited.weekday, origin)];
    return distinctSorted([...onToday, weekdayAfter(cited.weekday, today), ...afterOrigin]);
  }
  const { year, month } = dayParts(today);
  if (cited.month === null) {
    const current = localDay(year, month, cited.day);
    if (current !== null && current >= today) return [current];
    return distinctSorted([current, nextDayNumbered(cited.day, today)].filter(present));
  }
  const occurrences = [year - 1, year, year + 1].map(y => localDay(y, cited.month as number, cited.day)).filter(present);
  if (!occurrences.length) return [];
  const nearest = Math.min(...occurrences.map(index => Math.abs(index - today)));
  return occurrences.filter(index => Math.abs(index - today) === nearest);
}
/** The clocks a cited clock may name (the rules of pilotClockReadings): a bare hour 1-11 both halves; a period adds 12 only to 1-11. */
function clockBases(cited: CitedClockFact): number[] {
  const hour = cited.hour, at = (value: number) => value * 60 + cited.minute;
  switch (cited.period) {
    case PERIOD.MANHA: return hour <= 12 ? [at(hour)] : [at(hour - 12), at(hour)];
    case PERIOD.TARDE: return hour >= 1 && hour <= 11 ? [at(hour + 12)] : hour === 0 ? [at(0), at(12)] : [at(hour)];
    case PERIOD.NOITE: return hour >= 1 && hour <= 11 ? [at(hour + 12)] : hour === 0 || hour === 12 ? [at(0)] : [at(hour)];
    default: return hour >= 1 && hour <= 11 ? [at(hour), at(hour + 12)] : [at(hour)];
  }
}
const insideHours = (minute: number, windows: readonly WorkingWindow[]) => windows.some(window => window.start <= minute && minute < window.end);

// ---------------------------------------------------------------- readings
function dateReadings(input: DateAnchorInput): AnchorReadingList[] {
  const today = input.now.day, delta = input.quantity * (input.unit === UNIT.WEEKS ? ANCHOR_LIMITS.weekDays : 1);
  const within = Number.isInteger(delta) && Math.abs(delta) <= ANCHOR_LIMITS.days;
  const reading = (base: number): AnchorReading => !within ? { value: null, drop: DROP.NO_SUCH_DATE }
    : base + delta < today ? { value: base + delta, drop: DROP.PAST } : { value: base + delta, drop: null };
  const lists: AnchorReadingList[] = [{ anchor: ANCHOR.ORIGIN, readings: [reading(input.origin.day)] }, { anchor: ANCHOR.PRESENT, readings: [reading(today)] }];
  if (input.citedContained === true && input.cited) {
    const bases = citedDays(input.cited, input.origin.day, today);
    lists.push({ anchor: ANCHOR.CITED, readings: bases.length ? bases.map(reading) : [{ value: null, drop: DROP.NO_SUCH_DATE }] });
  }
  return lists;
}
function timeReadings(input: TimeAnchorInput): AnchorReadingList[] {
  const today = input.now.day, day = input.destinationDay;
  const reading = (base: number): AnchorReading => {
    const total = base + input.minutes;
    if (!Number.isInteger(total) || total < 0 || total >= ANCHOR_LIMITS.dayMinutes) return { value: null, drop: DROP.LEAVES_DAY };
    return day < today || (day === today && total <= input.now.minute) ? { value: total, drop: DROP.NOT_AHEAD } : { value: total, drop: null };
  };
  const lists: AnchorReadingList[] = [{ anchor: ANCHOR.ORIGIN, readings: [reading(input.origin.minute)] },
    { anchor: ANCHOR.PRESENT, readings: day === today ? [reading(input.now.minute)] : [{ value: null, drop: DROP.OTHER_DAY }] }];
  if (input.citedContained === true && input.cited) {
    const all = clockBases(input.cited), bases = all.length > 1 ? all.filter(minute => insideHours(minute, input.windows)) : all;
    lists.push({ anchor: ANCHOR.CITED, readings: bases.length ? bases.map(reading) : [{ value: null, drop: DROP.NO_READING_IN_HOURS }] });
  }
  return lists;
}
/** The reading lists of every factual anchor, in the order ORIGIN, PRESENT, CITED. */
export function anchorReadings(input: AnchorInput): AnchorReadingList[] {
  return input.field === ANCHOR_FIELD.DATE ? dateReadings(input) : timeReadings(input);
}

// ---------------------------------------------------------------- decision
const feasibleValues = (lists: readonly AnchorReadingList[]) =>
  distinctSorted(lists.flatMap(list => list.readings.flatMap(reading => reading.drop === null && reading.value !== null ? [reading.value] : [])));
const dropsOf = (lists: readonly AnchorReadingList[]) =>
  [...new Set(lists.flatMap(list => list.readings.flatMap(reading => reading.drop === null ? [] : [reading.drop])))].sort((a, b) => a - b);
const sameValues = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);
/** accepted = claim && contained && type != outro && CONSISTENT[type] has the anchor && (anchor != CITED || citedContained) && the anchor has readings. */
function claimState(input: AnchorInput, lists: readonly AnchorReadingList[]): ClaimStateCode {
  const claim = input.claim;
  if (!claim) return CLAIM_STATE.NONE;
  if (claim.contained !== true) return CLAIM_STATE.NOT_CONTAINED;
  if (claim.evidenceType === EVIDENCE.OUTRO) return CLAIM_STATE.TYPE_OTHER;
  if (!(CONSISTENT[claim.evidenceType] ?? []).includes(claim.anchor)) return CLAIM_STATE.TYPE_MISMATCH;
  if (claim.anchor === ANCHOR.CITED && input.citedContained !== true) return CLAIM_STATE.CITED_MISSING;
  if (!lists.some(list => list.anchor === claim.anchor)) return CLAIM_STATE.ANCHOR_ABSENT;
  return CLAIM_STATE.ACCEPTED;
}
/** The decision of spec 13 §3. Every value used is one of the computed readings; a contained cited reference that competes only turns USE into
 * ASK; nothing is used from an unproven anchor unless every feasible reading coincides. */
export function decideAnchor(input: AnchorInput): AnchorDecision {
  const readings = anchorReadings(input), claim = claimState(input, readings);
  const adopt = (value: number, basis: BasisCode, anchor: AnchorCode | null): AnchorDecision => ({ outcome: OUTCOME.USE, value, basis, anchor, claim, readings });
  const ask = (reason: AskReasonCode, options: readonly number[], drops: readonly DropCode[]): AnchorDecision => ({ outcome: OUTCOME.ASK, reason, options, drops, claim, readings });
  if (claim === CLAIM_STATE.ACCEPTED && input.claim) {
    const anchor = input.claim.anchor, own = readings.filter(list => list.anchor === anchor), chosen = feasibleValues(own);
    if (!chosen.length) return ask(ASK_REASON.DROPPED, [], dropsOf(own));
    if (chosen.length > 1) return ask(ASK_REASON.TWO_READINGS, chosen, []);
    const literal = anchor === ANCHOR.CITED ? [] : feasibleValues(readings.filter(list => list.anchor === ANCHOR.CITED));
    if (literal.length && !sameValues(literal, chosen)) return ask(ASK_REASON.LITERAL_COMPETES, distinctSorted([...chosen, ...literal]), []);
    return adopt(chosen[0], BASIS.EVIDENCE, anchor);
  }
  const all = feasibleValues(readings);
  if (readings.some(list => list.readings.some(reading => reading.drop === DROP.LEAVES_DAY))) return ask(ASK_REASON.LEAVES_DAY, all, dropsOf(readings));
  if (!all.length) return ask(ASK_REASON.DROPPED, [], dropsOf(readings));
  if (all.length === 1) return adopt(all[0], BASIS.COINCIDE, null);
  return ask(ASK_REASON.TWO_READINGS, all, []);
}
