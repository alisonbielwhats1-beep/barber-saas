import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ANCHOR, ANCHOR_FIELD, ASK_REASON, BASIS, CITED_KIND, CLAIM_STATE, CONSISTENT, DROP, EVIDENCE, OUTCOME, PERIOD, QUALIFIER, UNIT, anchorReadings, decideAnchor,
  type AnchorClaim, type AnchorDecision, type AnchorInput, type CitedClockFact, type CitedDayFact, type DateAnchorInput, type QualifierCode, type TimeAnchorInput } from "../secretary-pilot-anchor";
import { pilotCitedDays, pilotClockReadings, pilotClockShiftReadings, pilotDayShiftReadings, resolveTargetTime, type PilotReader } from "../secretary-pilot-resolver";
import { e2bRandom, saoPauloInstant } from "../../test/secretary-pilot-e2b";

/** A* premise probe, the pure decision module (docs/c5-spike/13-sonda-premissa-astar.md §3), written BEFORE the module. Luna interprets the language
 * once; after her the module sees only enums (numeric codes), integers, booleans and local instants (a day index and a minute of the day): no string
 * ever enters it (two lints below). Readings are LISTS per factual anchor (ORIGIN; PRESENT; CITED only when its reference is contained), each a
 * value or a drop reason; decideAnchor is the spec's rule: an accepted claim (contained, typed, consistent, its anchor factual) is used only when
 * its anchor has exactly one feasible reading and no contained literal competes; without one, the readings decide (one distinct value is used,
 * several are asked, a reading that leaves the day is asked). B2-SIM off, no PLAN anchor, no switches. No network, database or model. */
const DAY_MS = 86_400_000;
const dayOf = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / DAY_MS;
const keyOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const clockOf = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const at = (key: string, clock = "10:00") => ({ day: dayOf(key), minute: minuteOf(clock) });
/** received_at of the fixtures: Monday 2031-03-10, 10:00 local. */
const MON = "2031-03-10";
const claim = (anchor: AnchorClaim["anchor"], evidenceType: AnchorClaim["evidenceType"], contained = true): AnchorClaim => ({ anchor, evidenceType, contained });
const dayNumber = (day: number, month: number | null = null): CitedDayFact => ({ kind: CITED_KIND.DAY_NUMBER, day, month });
const weekday = (value: number, qualifier: QualifierCode = QUALIFIER.NONE): CitedDayFact => ({ kind: CITED_KIND.WEEKDAY, weekday: value, qualifier });
const relativeMonth = (day: number, months: number): CitedDayFact => ({ kind: CITED_KIND.RELATIVE_MONTH, day, months });
const clock = (hour: number, minute = 0, period: CitedClockFact["period"] = PERIOD.NONE): CitedClockFact => ({ hour, minute, period });
/** A day offset said on Monday 10:00 for an appointment on Thursday 2031-03-13 at 15:00: +2 days (ORIGIN 15/03, PRESENT 12/03). */
const dateInput = (over: Partial<DateAnchorInput> = {}): DateAnchorInput => ({ field: ANCHOR_FIELD.DATE, quantity: 2, unit: UNIT.DAYS, claim: null, citedContained: false,
  cited: null, now: at(MON), origin: at("2031-03-13", "15:00"), ...over });
/** A clock offset on the day of received_at (Monday, 10:00) for an appointment that day at 15:00: +30 minutes (ORIGIN 15:30, PRESENT 10:30). */
const timeInput = (over: Partial<TimeAnchorInput> = {}): TimeAnchorInput => ({ field: ANCHOR_FIELD.TIME, minutes: 30, claim: null, citedContained: false, cited: null,
  now: at(MON), origin: at(MON, "15:00"), destinationDay: dayOf(MON), windows: [{ start: minuteOf("08:00"), end: minuteOf("19:00") }], ...over });
const shownValue = (input: AnchorInput, value: number) => input.field === ANCHOR_FIELD.DATE ? keyOf(value) : clockOf(value);
/** The decision as codes and readable values (date keys, or clocks of the destination day). */
const view = (input: AnchorInput) => {
  const d = decideAnchor(input);
  return d.outcome === OUTCOME.USE ? { use: shownValue(input, d.value), basis: d.basis } : { ask: d.reason, options: d.options.map(value => shownValue(input, value)) };
};
const use = (value: string, basis: number) => ({ use: value, basis });
const ask = (reason: number, options: string[] = []) => ({ ask: reason, options });
/** The feasible values of one anchor's readings, readable. */
const feasible = (input: AnchorInput, anchor: number) =>
  (anchorReadings(input).find(list => list.anchor === anchor)?.readings ?? []).filter(reading => reading.drop === null).map(reading => shownValue(input, reading.value as number));
const dropsOf = (input: AnchorInput, anchor: number) => (anchorReadings(input).find(list => list.anchor === anchor)?.readings ?? []).map(reading => reading.drop);

describe("readings: one LIST per factual anchor, each item a value or a drop reason (§3)", () => {
  it("DATE: ORIGIN = the appointment's day + delta; PRESENT = the day of received_at + delta; weeks are 7 days; CITED only when its reference is contained", () => {
    expect(feasible(dateInput(), ANCHOR.ORIGIN)).toEqual(["2031-03-15"]);
    expect(feasible(dateInput(), ANCHOR.PRESENT)).toEqual(["2031-03-12"]);
    expect(feasible(dateInput({ quantity: 1, unit: UNIT.WEEKS }), ANCHOR.ORIGIN)).toEqual(["2031-03-20"]);
    expect(anchorReadings(dateInput()).map(list => list.anchor)).toEqual([ANCHOR.ORIGIN, ANCHOR.PRESENT]);
    expect(anchorReadings(dateInput({ cited: dayNumber(20) })).map(list => list.anchor), "a reference not contained is no anchor").toEqual([ANCHOR.ORIGIN, ANCHOR.PRESENT]);
    expect(anchorReadings(dateInput({ cited: dayNumber(20), citedContained: true })).map(list => list.anchor)).toEqual([ANCHOR.ORIGIN, ANCHOR.PRESENT, ANCHOR.CITED]);
    expect(feasible(dateInput({ cited: dayNumber(20), citedContained: true }), ANCHOR.CITED)).toEqual(["2031-03-22"]);
  });
  it("DATE drops: PAST (before the day of received_at; that day itself is feasible) and NO_SUCH_DATE (a cited day that does not exist, an offset past a year)", () => {
    expect(dropsOf(dateInput({ quantity: -4 }), ANCHOR.PRESENT)).toEqual([DROP.PAST]);
    expect(feasible(dateInput({ quantity: -3 }), ANCHOR.ORIGIN)).toEqual([MON]);
    expect(dropsOf(dateInput({ quantity: -3 }), ANCHOR.PRESENT)).toEqual([DROP.PAST]);
    expect(dropsOf(dateInput({ cited: dayNumber(31, 4), citedContained: true }), ANCHOR.CITED)).toEqual([DROP.NO_SUCH_DATE]);
    expect(dropsOf(dateInput({ cited: relativeMonth(31, 1), citedContained: true }), ANCHOR.CITED)).toEqual([DROP.NO_SUCH_DATE]);
    expect(dropsOf(dateInput({ quantity: 53, unit: UNIT.WEEKS }), ANCHOR.ORIGIN)).toEqual([DROP.NO_SUCH_DATE]);
  });
  it("DATE CITED follows the data_citada rules: a day without month this month and, once passed, the next one that exists; with month the nearest occurrence", () => {
    const cited = (fact: CitedDayFact, quantity = 0) => anchorReadings(dateInput({ quantity, cited: fact, citedContained: true })).find(list => list.anchor === ANCHOR.CITED)!.readings
      .map(reading => reading.value === null ? reading.drop : `${keyOf(reading.value)}${reading.drop === DROP.PAST ? " PAST" : ""}`);
    expect(cited(dayNumber(20))).toEqual(["2031-03-20"]);
    expect(cited(dayNumber(5))).toEqual(["2031-03-05 PAST", "2031-04-05"]);
    expect(cited(dayNumber(5), 7)).toEqual(["2031-03-12", "2031-04-12"]);
    expect(cited(dayNumber(31))).toEqual(["2031-03-31"]);
    expect(cited(dayNumber(2, 4))).toEqual(["2031-04-02"]);
    expect(cited(dayNumber(2, 1))).toEqual(["2031-01-02 PAST"]);
    expect(cited(relativeMonth(3, 1))).toEqual(["2031-04-03"]);
  });
  it("DATE CITED weekday: decision 27's readings (first after today, first after the appointment's day; 'este' only the first; today too unless 'proximo')", () => {
    const cited = (fact: CitedDayFact, origin = "2031-03-15") => anchorReadings(dateInput({ quantity: 0, origin: at(origin, "15:00"), cited: fact, citedContained: true }))
      .find(list => list.anchor === ANCHOR.CITED)!.readings.map(reading => keyOf(reading.value as number));
    expect(cited(weekday(5))).toEqual(["2031-03-14", "2031-03-21"]);
    expect(cited(weekday(5, QUALIFIER.ESTE))).toEqual(["2031-03-14"]);
    expect(cited(weekday(5, QUALIFIER.PROXIMO))).toEqual(["2031-03-14", "2031-03-21"]);
    expect(cited(weekday(1))).toEqual([MON, "2031-03-17"]);
    expect(cited(weekday(1, QUALIFIER.PROXIMO))).toEqual(["2031-03-17"]);
    expect(cited(weekday(5), "2031-03-12")).toEqual(["2031-03-14"]);
  });
  it("TIME: ORIGIN = the appointment's clock + minutes on the destination day; PRESENT only when that day is today (else OTHER_DAY)", () => {
    expect(feasible(timeInput(), ANCHOR.ORIGIN)).toEqual(["15:30"]);
    expect(feasible(timeInput(), ANCHOR.PRESENT)).toEqual(["10:30"]);
    const tomorrow = timeInput({ destinationDay: dayOf("2031-03-11") });
    expect(feasible(tomorrow, ANCHOR.ORIGIN)).toEqual(["15:30"]);
    expect(dropsOf(tomorrow, ANCHOR.PRESENT)).toEqual([DROP.OTHER_DAY]);
  });
  it("TIME drops: LEAVES_DAY (outside 00:00-23:59) and NOT_AHEAD (not ahead of now on today; every clock of a day already gone)", () => {
    expect(dropsOf(timeInput({ origin: at(MON, "23:30"), minutes: 45 }), ANCHOR.ORIGIN)).toEqual([DROP.LEAVES_DAY]);
    expect(dropsOf(timeInput({ minutes: -15 }), ANCHOR.PRESENT)).toEqual([DROP.NOT_AHEAD]);
    expect(dropsOf(timeInput({ minutes: 0 }), ANCHOR.PRESENT), "now itself is not ahead").toEqual([DROP.NOT_AHEAD]);
    expect(dropsOf(timeInput({ origin: at(MON, "10:30"), minutes: -60 }), ANCHOR.ORIGIN)).toEqual([DROP.NOT_AHEAD]);
    expect(dropsOf(timeInput({ destinationDay: dayOf("2031-03-09") }), ANCHOR.ORIGIN)).toEqual([DROP.NOT_AHEAD]);
  });
  it("TIME CITED: a bare hour 1-11 gives h and h+12 filtered by that day's hours (decision 18; none inside: NO_READING_IN_HOURS); one reading is never filtered", () => {
    const cited = (fact: CitedClockFact, windows = [{ start: minuteOf("08:00"), end: minuteOf("19:00") }]) => anchorReadings(timeInput({ minutes: 0,
      destinationDay: dayOf("2031-03-11"), cited: fact, citedContained: true, windows })).find(list => list.anchor === ANCHOR.CITED)!.readings
      .map(reading => reading.value === null ? reading.drop : clockOf(reading.value));
    expect(cited(clock(9))).toEqual(["09:00"]);
    expect(cited(clock(9), [{ start: minuteOf("08:00"), end: minuteOf("22:00") }])).toEqual(["09:00", "21:00"]);
    expect(cited(clock(9), [{ start: minuteOf("10:00"), end: minuteOf("19:00") }])).toEqual([DROP.NO_READING_IN_HOURS]);
    expect(cited(clock(9), [])).toEqual([DROP.NO_READING_IN_HOURS]);
    expect(cited(clock(21), [{ start: minuteOf("08:00"), end: minuteOf("12:00") }])).toEqual(["21:00"]);
    expect(cited(clock(9, 30, PERIOD.NOITE))).toEqual(["21:30"]);
    expect(cited(clock(9, 0, PERIOD.MANHA), [])).toEqual(["09:00"]);
    expect(cited(clock(15, 0, PERIOD.MANHA), [{ start: minuteOf("08:00"), end: minuteOf("19:00") }]), "a contradicting period reads as a bare hour").toEqual(["15:00"]);
  });
});

describe("decideAnchor: the accepted-claim rule and the CONSISTENT table (§3)", () => {
  it("CONSISTENT: nomeia → ORIGIN or CITED; deitico → PRESENT; desloca → ORIGIN; outro → none", () => {
    expect(CONSISTENT[EVIDENCE.NOMEIA]).toEqual([ANCHOR.ORIGIN, ANCHOR.CITED]);
    expect(CONSISTENT[EVIDENCE.DEITICO]).toEqual([ANCHOR.PRESENT]);
    expect(CONSISTENT[EVIDENCE.DESLOCA]).toEqual([ANCHOR.ORIGIN]);
    expect(CONSISTENT[EVIDENCE.OUTRO]).toEqual([]);
  });
  it("without a cited reference (ORIGIN 15/03, PRESENT 12/03): a consistent contained claim is used; anything else falls to the readings, which differ: asked", () => {
    const both = ask(ASK_REASON.TWO_READINGS, ["2031-03-12", "2031-03-15"]);
    const table: [number, number, unknown, number][] = [
      [EVIDENCE.NOMEIA, ANCHOR.ORIGIN, use("2031-03-15", BASIS.EVIDENCE), CLAIM_STATE.ACCEPTED],
      [EVIDENCE.NOMEIA, ANCHOR.PRESENT, both, CLAIM_STATE.TYPE_MISMATCH],
      [EVIDENCE.NOMEIA, ANCHOR.CITED, both, CLAIM_STATE.CITED_MISSING],
      [EVIDENCE.DEITICO, ANCHOR.ORIGIN, both, CLAIM_STATE.TYPE_MISMATCH],
      [EVIDENCE.DEITICO, ANCHOR.PRESENT, use("2031-03-12", BASIS.EVIDENCE), CLAIM_STATE.ACCEPTED],
      [EVIDENCE.DEITICO, ANCHOR.CITED, both, CLAIM_STATE.TYPE_MISMATCH],
      [EVIDENCE.DESLOCA, ANCHOR.ORIGIN, use("2031-03-15", BASIS.EVIDENCE), CLAIM_STATE.ACCEPTED],
      [EVIDENCE.DESLOCA, ANCHOR.PRESENT, both, CLAIM_STATE.TYPE_MISMATCH],
      [EVIDENCE.DESLOCA, ANCHOR.CITED, both, CLAIM_STATE.TYPE_MISMATCH],
      [EVIDENCE.OUTRO, ANCHOR.ORIGIN, both, CLAIM_STATE.TYPE_OTHER],
      [EVIDENCE.OUTRO, ANCHOR.PRESENT, both, CLAIM_STATE.TYPE_OTHER],
      [EVIDENCE.OUTRO, ANCHOR.CITED, both, CLAIM_STATE.TYPE_OTHER],
    ];
    for (const [type, anchor, expected, state] of table) {
      const input = dateInput({ claim: claim(anchor as AnchorClaim["anchor"], type as AnchorClaim["evidenceType"]) });
      expect(view(input), `${type}/${anchor}`).toEqual(expected);
      expect(decideAnchor(input).claim, `${type}/${anchor}`).toBe(state);
    }
    expect(view(dateInput()), "no claim").toEqual(both);
    expect(decideAnchor(dateInput()).claim).toBe(CLAIM_STATE.NONE);
  });
  it("evidence not contained in the message is never accepted (NOT_CONTAINED: the readings decide, as with no claim)", () => {
    const input = dateInput({ claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA, false) });
    expect(view(input)).toEqual(view(dateInput()));
    expect(decideAnchor(input).claim).toBe(CLAIM_STATE.NOT_CONTAINED);
  });
  it("a CITED claim needs its reference contained; with it, the cited reading is used (ORIGIN differs: B2-SIM is off, no competition)", () => {
    const cited = { cited: dayNumber(20), citedContained: true } as const;
    expect(view(dateInput({ ...cited, claim: claim(ANCHOR.CITED, EVIDENCE.NOMEIA) }))).toEqual(use("2031-03-22", BASIS.EVIDENCE));
    expect(view(dateInput({ cited: dayNumber(20), claim: claim(ANCHOR.CITED, EVIDENCE.NOMEIA) }))).toEqual(ask(ASK_REASON.TWO_READINGS, ["2031-03-12", "2031-03-15"]));
    // A contained flag without a reference value: the anchor has no readings (ANCHOR_ABSENT), never accepted.
    const absent = dateInput({ citedContained: true, claim: claim(ANCHOR.CITED, EVIDENCE.NOMEIA) });
    expect(decideAnchor(absent).claim).toBe(CLAIM_STATE.ANCHOR_ABSENT);
    expect(view(absent).ask).toBe(ASK_REASON.TWO_READINGS);
  });
  it("|R| = 0: the accepted anchor's readings are all dropped → asked with the drop reasons, never another anchor's reading (ORIGIN stays feasible)", () => {
    const input = dateInput({ quantity: -3, claim: claim(ANCHOR.PRESENT, EVIDENCE.DEITICO) });
    expect(feasible(input, ANCHOR.ORIGIN)).toEqual([MON]);
    const decision = decideAnchor(input);
    expect(decision).toMatchObject({ outcome: OUTCOME.ASK, reason: ASK_REASON.DROPPED, options: [], drops: [DROP.PAST], claim: CLAIM_STATE.ACCEPTED });
  });
  it("|R| > 1: an accepted anchor with two feasible readings is asked with both (correction 1: a weekday cited before and after the appointment)", () => {
    const input = dateInput({ origin: at("2031-03-15", "15:00"), cited: weekday(5), citedContained: true, claim: claim(ANCHOR.CITED, EVIDENCE.NOMEIA) });
    expect(view(input)).toEqual(ask(ASK_REASON.TWO_READINGS, ["2031-03-16", "2031-03-23"]));
    const clockTwice = timeInput({ minutes: 0, destinationDay: dayOf("2031-03-11"), windows: [{ start: minuteOf("08:00"), end: minuteOf("22:00") }], cited: clock(9),
      citedContained: true, claim: claim(ANCHOR.CITED, EVIDENCE.NOMEIA) });
    expect(view(clockTwice)).toEqual(ask(ASK_REASON.TWO_READINGS, ["09:00", "21:00"]));
  });
  it("LITERAL_COMPETES: an accepted ORIGIN/PRESENT claim beside a contained cited reference whose feasible readings differ is asked with both sets", () => {
    const cited = { cited: dayNumber(20), citedContained: true } as const;
    expect(view(dateInput({ ...cited, claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA) }))).toEqual(ask(ASK_REASON.LITERAL_COMPETES, ["2031-03-15", "2031-03-22"]));
    expect(view(dateInput({ ...cited, claim: claim(ANCHOR.ORIGIN, EVIDENCE.NOMEIA) }))).toEqual(ask(ASK_REASON.LITERAL_COMPETES, ["2031-03-15", "2031-03-22"]));
    expect(view(dateInput({ ...cited, claim: claim(ANCHOR.PRESENT, EVIDENCE.DEITICO) }))).toEqual(ask(ASK_REASON.LITERAL_COMPETES, ["2031-03-12", "2031-03-22"]));
    // The same reading competes with nothing; a reference whose readings are all dropped competes with nothing either.
    expect(view(dateInput({ cited: dayNumber(13), citedContained: true, claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA) }))).toEqual(use("2031-03-15", BASIS.EVIDENCE));
    expect(view(dateInput({ cited: dayNumber(2, 1), citedContained: true, claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA) }))).toEqual(use("2031-03-15", BASIS.EVIDENCE));
    // A clock: the appointment's clock delayed (desloca) beside a cited clock read 11:00 → asked between 12:00 and 11:00.
    const clocked = timeInput({ minutes: 60, origin: at(MON, "11:00"), destinationDay: dayOf("2031-03-11"), cited: clock(10), citedContained: true,
      claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA) });
    expect(view(clocked)).toEqual(ask(ASK_REASON.LITERAL_COMPETES, ["11:00", "12:00"]));
  });
  it("no accepted claim: one distinct feasible value is used (COINCIDE), several are asked, none is asked with the drops", () => {
    expect(view(dateInput({ origin: at(MON, "15:00") }))).toEqual(use("2031-03-12", BASIS.COINCIDE));
    expect(view(dateInput())).toEqual(ask(ASK_REASON.TWO_READINGS, ["2031-03-12", "2031-03-15"]));
    expect(decideAnchor(dateInput({ quantity: -5, origin: at("2031-03-11", "15:00") }))).toMatchObject({ outcome: OUTCOME.ASK, reason: ASK_REASON.DROPPED, options: [], drops: [DROP.PAST] });
    expect(view(timeInput({ destinationDay: dayOf("2031-03-11") }))).toEqual(use("15:30", BASIS.COINCIDE));
  });
  it("no accepted claim and a reading that leaves the day: asked (R2), even when one other reading is feasible", () => {
    const input = timeInput({ origin: at(MON, "23:30"), minutes: 45 });
    expect(dropsOf(input, ANCHOR.ORIGIN)).toEqual([DROP.LEAVES_DAY]);
    expect(feasible(input, ANCHOR.PRESENT)).toEqual(["10:45"]);
    expect(view(input)).toEqual(ask(ASK_REASON.LEAVES_DAY, ["10:45"]));
    // With an accepted claim the other anchor's drop does not matter (the claimed anchor decides).
    expect(view({ ...input, claim: claim(ANCHOR.PRESENT, EVIDENCE.DEITICO) })).toEqual(use("10:45", BASIS.EVIDENCE));
  });
  it("only the three factual anchors exist (no PLAN anchor, no literal origin hint, no switch): every reading list is ORIGIN, PRESENT or CITED", () => {
    const rnd = e2bRandom(91);
    for (let i = 0; i < 300; i++) for (const list of anchorReadings(randomInput(rnd))) expect([ANCHOR.ORIGIN, ANCHOR.PRESENT, ANCHOR.CITED]).toContain(list.anchor);
  });
});

describe("twins: inputs that differ only in the fact that changes the outcome", () => {
  it("the same null claim: the appointment today → USE (the readings coincide); the appointment on another day → ASK (the question comes from the data, M-f)", () => {
    expect(view(dateInput({ origin: at(MON, "17:00") }))).toEqual(use("2031-03-12", BASIS.COINCIDE));
    expect(view(dateInput({ origin: at("2031-03-11", "17:00") }))).toEqual(ask(ASK_REASON.TWO_READINGS, ["2031-03-12", "2031-03-13"]));
  });
  it("the same desloca claim: contained → USE ORIGIN; not contained → ASK", () => {
    expect(view(dateInput({ claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA) }))).toEqual(use("2031-03-15", BASIS.EVIDENCE));
    expect(view(dateInput({ claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA, false) })).ask).toBe(ASK_REASON.TWO_READINGS);
  });
  it("the same anchor: typed desloca → USE; typed outro → ASK", () => {
    expect(view(dateInput({ claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA) })).use).toBe("2031-03-15");
    expect(view(dateInput({ claim: claim(ANCHOR.ORIGIN, EVIDENCE.OUTRO) })).ask).toBe(ASK_REASON.TWO_READINGS);
  });
  it("the same desloca claim: no cited reference → USE; a contained cited reference with another reading → ASK (LITERAL_COMPETES)", () => {
    expect(view(dateInput({ claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA) })).use).toBe("2031-03-15");
    expect(view(dateInput({ claim: claim(ANCHOR.ORIGIN, EVIDENCE.DESLOCA), cited: dayNumber(25), citedContained: true })).ask).toBe(ASK_REASON.LITERAL_COMPETES);
  });
  it("the same clock offset, no claim: on another day → USE ORIGIN (PRESENT is OTHER_DAY); today → ASK", () => {
    expect(view(timeInput({ destinationDay: dayOf("2031-03-12") }))).toEqual(use("15:30", BASIS.COINCIDE));
    expect(view(timeInput())).toEqual(ask(ASK_REASON.TWO_READINGS, ["10:30", "15:30"]));
  });
  it("the same accepted deitico claim: a positive offset → USE; a negative one → ASK (dropped, never another anchor)", () => {
    expect(view(dateInput({ claim: claim(ANCHOR.PRESENT, EVIDENCE.DEITICO) })).use).toBe("2031-03-12");
    expect(view(dateInput({ quantity: -2, claim: claim(ANCHOR.PRESENT, EVIDENCE.DEITICO) })).ask).toBe(ASK_REASON.DROPPED);
  });
});

// ---------------------------------------------------------------- random inputs (deterministic seeds)
const int = (rnd: () => number, low: number, high: number) => low + Math.floor(rnd() * (high - low + 1));
const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
const QUALIFIERS = [QUALIFIER.NONE, QUALIFIER.ESTE, QUALIFIER.PROXIMO] as const, PERIODS = [PERIOD.NONE, PERIOD.MANHA, PERIOD.TARDE, PERIOD.NOITE] as const;
const ANCHORS = [ANCHOR.ORIGIN, ANCHOR.PRESENT, ANCHOR.CITED] as const, TYPES = [EVIDENCE.NOMEIA, EVIDENCE.DEITICO, EVIDENCE.DESLOCA, EVIDENCE.OUTRO] as const;
const randomCitedDay = (rnd: () => number): CitedDayFact => pick(rnd, [() => dayNumber(int(rnd, 1, 31), rnd() < 0.5 ? null : int(rnd, 1, 12)),
  () => weekday(int(rnd, 0, 6), pick(rnd, QUALIFIERS)), () => relativeMonth(int(rnd, 1, 31), int(rnd, 0, 12))])();
const randomClaim = (rnd: () => number): AnchorClaim | null => rnd() < 0.3 ? null : claim(pick(rnd, ANCHORS), pick(rnd, TYPES), rnd() < 0.8);
function randomDate(rnd: () => number): DateAnchorInput {
  const today = dayOf("2031-01-01") + int(rnd, 0, 700), cited = rnd() < 0.3 ? null : randomCitedDay(rnd);
  return { field: ANCHOR_FIELD.DATE, quantity: int(rnd, -21, 21), unit: rnd() < 0.7 ? UNIT.DAYS : UNIT.WEEKS, claim: randomClaim(rnd), citedContained: !!cited && rnd() < 0.7, cited,
    now: { day: today, minute: int(rnd, 0, 1439) }, origin: { day: today + int(rnd, -2, 45), minute: int(rnd, 0, 1439) } };
}
function randomTime(rnd: () => number): TimeAnchorInput {
  const today = dayOf("2031-01-01") + int(rnd, 0, 700), cited = rnd() < 0.3 ? null : clock(int(rnd, 0, 23), pick(rnd, [0, 15, 30, 45]), pick(rnd, PERIODS));
  const start = int(rnd, 6, 12) * 60, end = Math.min(1440, start + int(rnd, 4, 14) * 60);
  return { field: ANCHOR_FIELD.TIME, minutes: pick(rnd, [-120, -60, -30, -15, 15, 30, 45, 60, 90, 120, 180, 600]), claim: randomClaim(rnd), citedContained: !!cited && rnd() < 0.7, cited,
    now: { day: today, minute: int(rnd, 0, 1439) }, origin: { day: today + int(rnd, 0, 3), minute: int(rnd, 0, 1439) }, destinationDay: today + pick(rnd, [-1, 0, 0, 0, 1, 2]),
    windows: rnd() < 0.1 ? [] : [{ start, end }] };
}
const randomInput = (rnd: () => number): AnchorInput => rnd() < 0.5 ? randomDate(rnd) : randomTime(rnd);
const feasibleOf = (input: AnchorInput, only?: number) => [...new Set(anchorReadings(input).filter(list => only === undefined || list.anchor === only)
  .flatMap(list => list.readings.filter(reading => reading.drop === null).map(reading => reading.value as number)))].sort((a, b) => a - b);
const sameDecision = (a: AnchorDecision, b: AnchorDecision) => {
  const strip = (d: AnchorDecision) => d.outcome === OUTCOME.USE ? { outcome: d.outcome, value: d.value, basis: d.basis } : { outcome: d.outcome, reason: d.reason, options: d.options, drops: d.drops };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

describe("invariants (random inputs, deterministic seeds)", () => {
  it("(i) every value used is one of the computed feasible readings (of the accepted anchor when used by evidence)", () => {
    const rnd = e2bRandom(7);
    for (let i = 0; i < 4000; i++) {
      const input = randomInput(rnd), d = decideAnchor(input);
      if (d.outcome !== OUTCOME.USE) continue;
      expect(feasibleOf(input)).toContain(d.value);
      if (d.basis === BASIS.EVIDENCE) expect(feasibleOf(input, input.claim!.anchor)).toEqual([d.value]);
    }
  });
  it("(iii) nothing is used from an unproven anchor unless every feasible reading coincides; evidence is used only from an accepted claim", () => {
    const rnd = e2bRandom(8);
    for (let i = 0; i < 4000; i++) {
      const input = randomInput(rnd), d = decideAnchor(input);
      if (d.outcome !== OUTCOME.USE) continue;
      if (d.basis === BASIS.COINCIDE) { expect(d.claim).not.toBe(CLAIM_STATE.ACCEPTED); expect(feasibleOf(input)).toEqual([d.value]); }
      else {
        const c = input.claim!;
        expect(d.claim).toBe(CLAIM_STATE.ACCEPTED);
        expect(c.contained && c.evidenceType !== EVIDENCE.OUTRO && CONSISTENT[c.evidenceType].includes(c.anchor) && (c.anchor !== ANCHOR.CITED || input.citedContained)).toBe(true);
      }
    }
  });
  it("(ii) M-e: a competing literal only turns USE into ASK (never a new value, never ASK into USE while another reading was feasible)", () => {
    const rnd = e2bRandom(9);
    let changed = 0;
    for (let i = 0; i < 4000; i++) {
      const base = randomInput(rnd);
      if (base.claim?.anchor === ANCHOR.CITED) continue;
      const without = { ...base, citedContained: false, cited: null } as AnchorInput;
      const withLiteral = { ...base, citedContained: true, cited: base.field === ANCHOR_FIELD.DATE ? randomCitedDay(rnd) : clock(int(rnd, 0, 23), 0, pick(rnd, PERIODS)) } as AnchorInput;
      const before = decideAnchor(without), after = decideAnchor(withLiteral);
      if (before.outcome === OUTCOME.USE) {
        if (after.outcome === OUTCOME.USE) expect(after.value).toBe(before.value); else changed++;
      } else if (feasibleOf(without).length > 0 || before.claim === CLAIM_STATE.ACCEPTED) expect(after.outcome).toBe(OUTCOME.ASK);
      // Otherwise nothing was feasible before: the literal's single feasible reading is the only reading (PRINCIPLE-4 fact filter), never a choice.
      else if (after.outcome === OUTCOME.USE) expect(feasibleOf(withLiteral)).toEqual([after.value]);
    }
    expect(changed).toBeGreaterThan(50);
  });
  it("M-b: a claim whose evidence is not contained decides exactly like no claim", () => {
    const rnd = e2bRandom(10);
    for (let i = 0; i < 3000; i++) {
      const input = randomInput(rnd);
      if (!input.claim) continue;
      expect(sameDecision(decideAnchor({ ...input, claim: { ...input.claim, contained: false } }), decideAnchor({ ...input, claim: null }))).toBe(true);
    }
  });
  it("M-d: outro equals no claim; swapping one consistent evidence type for another (ORIGIN: nomeia ↔ desloca) changes nothing", () => {
    const rnd = e2bRandom(11);
    for (let i = 0; i < 3000; i++) {
      const input = randomInput(rnd);
      if (!input.claim) continue;
      expect(sameDecision(decideAnchor({ ...input, claim: { ...input.claim, evidenceType: EVIDENCE.OUTRO } }), decideAnchor({ ...input, claim: null }))).toBe(true);
      const origin = { ...input, claim: { ...input.claim, anchor: ANCHOR.ORIGIN } };
      expect(sameDecision(decideAnchor({ ...origin, claim: { ...origin.claim, evidenceType: EVIDENCE.NOMEIA } }),
        decideAnchor({ ...origin, claim: { ...origin.claim, evidenceType: EVIDENCE.DESLOCA } }))).toBe(true);
    }
  });
  it("M-f: twins that differ only in the agenda: when every feasible reading coincides the value is used, otherwise asked (never from words)", () => {
    const rnd = e2bRandom(12);
    for (let i = 0; i < 3000; i++) {
      const input = { ...randomInput(rnd), claim: null } as AnchorInput, d = decideAnchor(input), values = feasibleOf(input);
      const leaves = anchorReadings(input).some(list => list.readings.some(reading => reading.drop === DROP.LEAVES_DAY));
      if (leaves || values.length !== 1) expect(d.outcome).toBe(OUTCOME.ASK); else expect(d).toMatchObject({ outcome: OUTCOME.USE, value: values[0], basis: BASIS.COINCIDE });
    }
  });
  it("deterministic and pure: the same input twice gives the same decision, and the input is not mutated", () => {
    const rnd = e2bRandom(13);
    for (let i = 0; i < 500; i++) {
      const input = randomInput(rnd), before = JSON.stringify(input);
      expect(JSON.stringify(decideAnchor(input))).toBe(JSON.stringify(decideAnchor(input)));
      expect(JSON.stringify(input)).toBe(before);
    }
  });
});

// ---------------------------------------------------------------- the same rules as the E2-B resolver (integers here, date keys there)
const SAO_PAULO = "America/Sao_Paulo";
const WEEKDAY_NAMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;
const QUALIFIER_NAMES = { [QUALIFIER.NONE]: null, [QUALIFIER.ESTE]: "este", [QUALIFIER.PROXIMO]: "proximo" } as const;
const PERIOD_NAMES = { [PERIOD.NONE]: null, [PERIOD.MANHA]: "manha", [PERIOD.TARDE]: "tarde", [PERIOD.NOITE]: "noite" } as const;
const citedWire = (fact: CitedDayFact) => fact.kind === CITED_KIND.DAY_NUMBER ? { dia: fact.day, mes: fact.month, mencao: "x" }
  : fact.kind === CITED_KIND.WEEKDAY ? { tipo: "dia_semana" as const, dia_semana: WEEKDAY_NAMES[fact.weekday], qualificador: QUALIFIER_NAMES[fact.qualifier], mencao: "x" }
    : { tipo: "mes_relativo" as const, dia: fact.day, meses: fact.months, mencao: "x" };
const pilotClockOf = (input: { now: { day: number; minute: number } }) => ({ receivedAt: new Date(saoPauloInstant(`${keyOf(input.now.day)}T${clockOf(input.now.minute)}`)), timezone: SAO_PAULO });

describe("the module reads like the E2-B resolver (pilotCitedDays, pilotDayShiftReadings, pilotClockShiftReadings, pilotClockReadings, decision 18)", () => {
  it("DATE: ORIGIN, PRESENT and CITED readings (values and PAST) equal pilotDayShiftReadings for the same typed operator", () => {
    const rnd = e2bRandom(21);
    for (let i = 0; i < 3000; i++) {
      const input = { ...randomDate(rnd), cited: randomCitedDay(rnd), citedContained: true };
      const today = keyOf(input.now.day), origin = { date: keyOf(input.origin.day) };
      const shift = { tipo: "deslocamento" as const, quantidade: input.quantity, unidade: input.unit === UNIT.WEEKS ? "semanas" as const : "dias" as const,
        ancoras: ["origem" as const, "hoje" as const, "data_citada" as const], data_citada: citedWire(input.cited), mencao: "x" };
      const theirs = pilotDayShiftReadings(shift, origin, today);
      for (const [anchor, name] of [[ANCHOR.ORIGIN, "origem"], [ANCHOR.PRESENT, "hoje"], [ANCHOR.CITED, "data_citada"]] as const) {
        const ours = anchorReadings(input).find(list => list.anchor === anchor)!.readings;
        expect(ours.map(reading => reading.drop === DROP.NO_SUCH_DATE ? undefined : keyOf(reading.value as number)), `${i}:${name}`)
          .toEqual(theirs.filter(reading => reading.anchor === name).map(reading => reading.date));
        for (const reading of ours) if (reading.value !== null) expect(reading.drop === DROP.PAST, `${i}:${name}`).toBe(keyOf(reading.value) < today);
      }
      expect(anchorReadings({ ...input, quantity: 0 }).find(list => list.anchor === ANCHOR.CITED)!.readings.filter(reading => reading.value !== null).map(reading => keyOf(reading.value as number)))
        .toEqual(pilotCitedDays(citedWire(input.cited), origin, today));
    }
  });
  it("TIME: ORIGIN and PRESENT readings (clock and drop reason) equal pilotClockShiftReadings on the destination day", () => {
    const rnd = e2bRandom(22), reasons: Record<string, number> = { OTHER_DAY: DROP.OTHER_DAY, LEAVES_DAY: DROP.LEAVES_DAY, NOT_AHEAD: DROP.NOT_AHEAD };
    for (let i = 0; i < 3000; i++) {
      const input = randomTime(rnd);
      const theirs = pilotClockShiftReadings({ tipo: "deslocamento", minutos: input.minutes, ancoras: ["origem", "agora"], mencao: "x" },
        { origin: { date: keyOf(input.origin.day), time: clockOf(input.origin.minute) }, date: keyOf(input.destinationDay), clock: pilotClockOf(input) });
      for (const [anchor, name] of [[ANCHOR.ORIGIN, "origem"], [ANCHOR.PRESENT, "agora"]] as const) {
        const [ours] = anchorReadings(input).find(list => list.anchor === anchor)!.readings, their = theirs.find(reading => reading.anchor === name)!;
        expect(ours.drop === null ? clockOf(ours.value as number) : null, `${i}:${name}`).toBe(their.time ?? null);
        expect(ours.drop, `${i}:${name}`).toBe(their.dropped ? reasons[their.dropped.reason] : null);
      }
    }
  });
  it("TIME CITED: the clock readings equal pilotClockReadings, and the hours filter equals the relogio branch of resolveTargetTime (decision 18)", async () => {
    const rnd = e2bRandom(23);
    for (let i = 0; i < 1500; i++) {
      const input = { ...randomTime(rnd), minutes: 0, destinationDay: dayOf("2031-12-01"), now: at("2031-11-01") }, fact = clock(int(rnd, 0, 23), pick(rnd, [0, 30]), pick(rnd, PERIODS));
      const relogio = { tipo: "relogio" as const, hora: fact.hour, minuto: fact.minute, periodo: PERIOD_NAMES[fact.period], mencao: "x" };
      const all = anchorReadings({ ...input, cited: fact, citedContained: true, windows: [{ start: 0, end: 1440 }] }).find(list => list.anchor === ANCHOR.CITED)!.readings;
      expect(all.map(reading => clockOf(reading.value as number)), String(i)).toEqual(pilotClockReadings(relogio));
      const reader = { workingWindows: async () => input.windows } as unknown as PilotReader;
      const theirs = await resolveTargetTime(reader, relogio, { origin: { date: "2031-11-20", time: "10:00" }, date: "2031-12-01", professionalId: null });
      const ours = anchorReadings({ ...input, cited: fact, citedContained: true }).find(list => list.anchor === ANCHOR.CITED)!.readings;
      const expected = theirs.state === "one" ? [theirs.time] : theirs.state === "ask" ? theirs.options : [DROP.NO_READING_IN_HOURS];
      expect(ours.map(reading => reading.value === null ? reading.drop : clockOf(reading.value)), String(i)).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------- lints: no string can reach the decision
const MODULE = "src/lib/secretary-pilot-anchor.ts";
/** String-like literal nodes of a TypeScript source (string, template and regular-expression literals), module specifiers of imports aside. */
function literalNodes(text: string): string[] {
  const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), found: string[] = [];
  const specifier = (node: ts.Node) => (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node;
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isRegularExpressionLiteral(node)
      || node.kind === ts.SyntaxKind.JsxText) && !specifier(node)) found.push(`literal@${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
/** Paths of the (deep) parameter type of `fn` that are string-like, any/unknown or callable, through the TypeScript checker. */
function stringFields(file: string, fn: string, virtual?: string): string[] {
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, types: [] };
  const host = ts.createCompilerHost(options);
  if (virtual !== undefined) {
    const getSourceFile = host.getSourceFile.bind(host), fileExists = host.fileExists.bind(host), readFile = host.readFile.bind(host);
    host.getSourceFile = (name, language) => name === file ? ts.createSourceFile(name, virtual, language) : getSourceFile(name, language);
    host.fileExists = name => name === file || fileExists(name);
    host.readFile = name => name === file ? virtual : readFile(name);
  }
  const program = ts.createProgram([file], options, host), checker = program.getTypeChecker(), source = program.getSourceFile(file);
  if (!source) throw Error("NO_SOURCE");
  let parameter: ts.ParameterDeclaration | undefined;
  const find = (node: ts.Node): void => { if (ts.isFunctionDeclaration(node) && node.name?.text === fn) parameter = node.parameters[0]; ts.forEachChild(node, find); };
  find(source);
  if (!parameter) throw Error("NO_FUNCTION");
  const found = new Set<string>(), seen = new Set<ts.Type>();
  const primitive = ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never;
  const walk = (type: ts.Type, path: string): void => {
    if (seen.has(type)) return;
    seen.add(type);
    if (type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.ESSymbolLike)) { found.add(path); return; }
    if (type.flags & primitive) return;
    if (type.isUnionOrIntersection()) { for (const member of type.types) walk(member, path); return; }
    if (type.getCallSignatures().length || type.getConstructSignatures().length) { found.add(`${path}()`); return; }
    if (checker.isArrayType(type) || checker.isTupleType(type)) { for (const item of checker.getTypeArguments(type as ts.TypeReference)) walk(item, `${path}[]`); return; }
    for (const property of type.getProperties()) walk(checker.getTypeOfSymbolAtLocation(property, parameter!), `${path}.${property.getName()}`);
  };
  walk(checker.getTypeAtLocation(parameter), "input");
  return [...found];
}

describe("lints: the module never sees a string", () => {
  it("Lint 1: the module has no string, template or regular-expression literal (it imports nothing: every enum is a numeric constant of its own)", () => {
    const text = readFileSync(MODULE, "utf8");
    expect(literalNodes(text)).toEqual([]);
    expect(ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true).statements.filter(statement => ts.isImportDeclaration(statement))).toEqual([]);
    // Positive control: the same linter sees a literal (so the empty result above is not vacuous); an import path is allowed.
    expect(literalNodes("import { a } from \"./x\";\nexport const b = a === `y` ? 1 : 2;\nexport const c = /z/;")).toEqual(["literal@2", "literal@3"]);
  });
  it("Lint 2: the input type of decideAnchor has no string field (nor any, unknown or a function), through the checker", () => {
    expect(stringFields(MODULE, "decideAnchor")).toEqual([]);
    expect(stringFields(MODULE, "anchorReadings")).toEqual([]);
    // Positive control: a nested string field, a string-literal enum and an any are found.
    expect(stringFields("virtual-anchor.ts", "decideAnchor", "export function decideAnchor(input: { a: number; b: { c: readonly string[] }; d: 'x' | 'y'; e: any }) { return input; }"))
      .toEqual(["input.b.c[]", "input.d", "input.e"]);
  }, 30_000);
  it("the module never names a text operation either (no String, JSON, RegExp, normalize, case folding, split, match, replace, search, prefix or padding)", () => {
    const text = readFileSync(MODULE, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(text.match(/\b(?:String|JSON|RegExp|normalize|toLowerCase|toUpperCase|localeCompare|split|match|matchAll|replace|replaceAll|search|startsWith|endsWith|charAt|charCodeAt|codePointAt|padStart|padEnd|trim|toString|toISOString)\b/g) ?? []).toEqual([]);
  });
});
