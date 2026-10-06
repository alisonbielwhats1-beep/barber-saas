import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveClockComponent, resolveDayComponent, verifyClockComponent, verifyClockInterval, verifyDayComponent, daypartAnswer } from "../scheduling-temporal-reference";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** C1: deterministic calendar arithmetic and token-consistency of temporal components. */
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent =>
  ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const clock = (hour: number, minute = 0, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute, daypart });
const ok = (date: string) => ({ status: "OK", date });
const at = (time: string) => ({ status: "OK", time });
const rejected = (code: string) => ({ status: "REJECTED", code });
const MONDAY = "2026-09-28";

describe("resolver: relative days, weeks and months from the salon's local date", () => {
  it.each([
    [0, MONDAY], [1, "2026-09-29"], [2, "2026-09-30"],
  ])("RELATIVE_DAY %i", (offset, expected) => expect(resolveDayComponent(day({ kind: "RELATIVE_DAY", offset }), MONDAY)).toEqual(ok(expected)));
  it("year turn and month ends", () => {
    expect(resolveDayComponent(day({ kind: "RELATIVE_DAY", offset: 2 }), "2026-12-30")).toEqual(ok("2027-01-01"));
    expect(resolveDayComponent(day({ kind: "DAYS_FROM_NOW", days: 3 }), "2027-02-27")).toEqual(ok("2027-03-02"));
    expect(resolveDayComponent(day({ kind: "DAY_OF_MONTH", day: 5 }), "2026-12-30")).toEqual(ok("2027-01-05"));
    expect(resolveDayComponent(day({ kind: "WEEKDAY", weekday: 5, week: "NEXT_WEEK" }), "2026-12-30")).toEqual(ok("2027-01-08"));
  });
  it.each([
    // [today, weekday, week, expected]
    [MONDAY, 1, "NEAREST", "2026-10-05"], [MONDAY, 5, "NEAREST", "2026-10-02"], [MONDAY, 0, "NEAREST", "2026-10-04"],
    [MONDAY, 5, "THIS_WEEK", "2026-10-02"], [MONDAY, 1, "THIS_WEEK", MONDAY], ["2026-10-04", 0, "THIS_WEEK", "2026-10-04"],
    [MONDAY, 5, "NEXT_WEEK", "2026-10-09"], ["2026-10-04", 5, "NEXT_WEEK", "2026-10-09"], ["2026-10-04", 1, "NEXT_WEEK", "2026-10-05"],
    ["2026-10-03", 5, "AMBIGUOUS_NEXT", "2026-10-09"], ["2026-10-04", 1, "AMBIGUOUS_NEXT", "2026-10-05"], ["2026-10-02", 5, "AMBIGUOUS_NEXT", "2026-10-09"],
  ] as const)("WEEKDAY on %s: %i %s -> %s (weeks run Monday-Sunday; Saturday/Sunday edges)", (today, weekday, week, expected) =>
    expect(resolveDayComponent(day({ kind: "WEEKDAY", weekday, week }), today)).toEqual(ok(expected)));
  it("'sexta que vem' naming two different Fridays is a choice, never a guess; a past weekday of this week is asked", () => {
    expect(resolveDayComponent(day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), MONDAY)).toEqual({ status: "DATE_CHOICE", candidates: ["2026-10-02", "2026-10-09"] });
    // Phase 3a review: "essa segunda" said on Wednesday is asked (last Monday or the coming one), never "já passou";
    // an existing appointment's day (a read, a cancel, the original day of a move) may be this week's past day.
    expect(resolveDayComponent(day({ kind: "WEEKDAY", weekday: 1, week: "THIS_WEEK" }), "2026-09-30")).toEqual({ status: "DATE_CHOICE", candidates: [MONDAY, "2026-10-05"] });
    expect(resolveDayComponent(day({ kind: "WEEKDAY", weekday: 1, week: "THIS_WEEK" }), "2026-09-30", "ANY")).toEqual(ok(MONDAY));
  });
  it.each([
    [28, MONDAY, MONDAY], [30, MONDAY, "2026-09-30"], [31, MONDAY, "2026-10-31"], [5, MONDAY, "2026-10-05"],
    [31, "2026-11-01", "2026-12-31"], [29, "2027-01-31", "2027-03-29"], [30, "2027-02-01", "2027-03-30"], [31, "2027-04-01", "2027-05-31"],
  ] as const)("DAY_OF_MONTH %i on %s: nearest day not before today, months without it skipped -> %s", (value, today, expected) =>
    expect(resolveDayComponent(day({ kind: "DAY_OF_MONTH", day: value }), today)).toEqual(ok(expected)));
  it("an explicit month/year is validated and never in the past", () => {
    const dom = (d: number, month: number, year: number | null = null, today = MONDAY) => resolveDayComponent(day({ kind: "DAY_OF_MONTH", day: d, month, year }), today);
    expect(dom(28, 9)).toEqual(ok(MONDAY));
    expect(dom(5, 1, null, "2026-12-20")).toEqual(ok("2027-01-05"));
    // Phase 3a review: a month/day without a year whose next occurrence is far is this year's or next year's (asked).
    expect(dom(5, 9)).toEqual({ status: "DATE_CHOICE", candidates: ["2026-09-05", "2027-09-05"] });
    expect(dom(20, 4)).toEqual({ status: "DATE_CHOICE", candidates: ["2026-04-20", "2027-04-20"] });
    expect(dom(5, 9, 2026)).toEqual(rejected("DATE_IN_PAST"));
    expect(dom(14, 4, 2027)).toEqual(ok("2027-04-14"));
    expect(dom(31, 4)).toEqual(rejected("DATE_INVALID"));
    expect(dom(29, 2, 2027)).toEqual(rejected("DATE_INVALID"));
    expect(dom(28, 9, 2031)).toEqual(rejected("DATE_INVALID"));
    expect(resolveDayComponent(day({ kind: "DAY_OF_MONTH", day: 5, year: 2027 }), MONDAY)).toEqual(rejected("COMPONENT_INVALID"));
  });
  it.each([
    day({ kind: "RELATIVE_DAY", offset: 3 }), day({ kind: "RELATIVE_DAY", offset: -1 }), day({ kind: "RELATIVE_DAY", offset: 1, weekday: 2 }),
    day({ kind: "WEEKDAY", weekday: 7 }), day({ kind: "DAYS_FROM_NOW", days: 0 }), day({ kind: "DAY_OF_MONTH", day: 32 }), day({ kind: "DAY_OF_MONTH", day: 1.5 }),
  ])("incoherent component %j is invalid for its role only", value => expect(resolveDayComponent(value, MONDAY)).toEqual(rejected("COMPONENT_INVALID")));
  it("clocks: dayparts, meio-dia/meia-noite and bounds", () => {
    expect(resolveClockComponent(clock(10))).toEqual(at("10:00"));
    expect(resolveClockComponent(clock(2, 0, "TARDE"))).toEqual(at("14:00"));
    expect(resolveClockComponent(clock(14, 0, "TARDE"))).toEqual(at("14:00"));
    expect(resolveClockComponent(clock(8, 0, "NOITE"))).toEqual(at("20:00"));
    expect(resolveClockComponent(clock(12))).toEqual(at("12:00"));
    expect(resolveClockComponent(clock(0))).toEqual(at("00:00"));
    for (const invalid of [clock(12, 0, "MANHA"), clock(10, 0, "TARDE"), clock(3, 0, "NOITE"), clock(24), clock(10, 60)])
      expect(resolveClockComponent(invalid)).toEqual(rejected("COMPONENT_INVALID"));
  });
});

describe("token consistency: accents, case, number words, abbreviations and dictation", () => {
  it.each([
    ["10hs", clock(10), "10:00"], ["10hrs", clock(10), "10:00"], ["10h30min", clock(10, 30), "10:30"], ["10h30", clock(10, 30), "10:30"],
    ["10:30", clock(10, 30), "10:30"], ["às 10 horas", clock(10), "10:00"], ["dez e meia", clock(10, 30), "10:30"], ["DEZ E MEIA", clock(10, 30), "10:30"],
    ["as dez", clock(10), "10:00"], ["duas da tarde", clock(2, 0, "TARDE"), "14:00"], ["duas da tarde", clock(14, 0, "TARDE"), "14:00"],
    ["Duas da Tarde", clock(14, 0, "UNSPECIFIED"), "14:00"], ["às 8", clock(8), "08:00"], ["meio-dia", clock(12), "12:00"], ["meia-noite", clock(0), "00:00"],
    ["onze e quarenta e cinco", clock(11, 45), "11:45"], ["dezoito horas", clock(18), "18:00"], ["as 18h", clock(18), "18:00"],
    ["sete da noite", clock(7, 0, "NOITE"), "19:00"], ["3 da madrugada", clock(3), "03:00"], ["10 horas e 15 minutos", clock(10, 15), "10:15"],
  ] as const)("clock %s", (quote, value, time) => expect(verifyClockComponent(quote, value)).toEqual(at(time)));
  it.each([
    ["10hs", clock(11)], ["10h30", clock(10)], ["10h30", clock(10, 15)], ["dez e meia", clock(10)], ["dez e meia", clock(11, 30)],
    ["duas da tarde", clock(2, 0, "MANHA")], ["duas da tarde", clock(3, 0, "TARDE")], ["duas da tarde", clock(2)], ["das 10 as 11", clock(10, 11)],
    ["as dez", clock(9)], ["dia 28", clock(28 % 24)], ["meio-dia", clock(13)],
  ] as const)("perturbed clock %s %j is rejected", (quote, value) => expect(verifyClockComponent(quote, value).status).toBe("REJECTED"));
  it("GF11 semantics: a 12h-form hour without manhã/tarde/noite is a half-day question, never a promotion", () => {
    expect(verifyClockComponent("às duas", clock(14))).toEqual({ status: "DAYPART_CHOICE", candidates: ["02:00", "14:00"] });
    expect(verifyClockComponent("às duas", clock(2))).toEqual({ status: "DAYPART_CHOICE", candidates: ["02:00", "14:00"] });
    expect(verifyClockComponent("às quatro", clock(16))).toEqual({ status: "DAYPART_CHOICE", candidates: ["04:00", "16:00"] });
    expect(verifyClockComponent("às dez", clock(22))).toEqual({ status: "DAYPART_CHOICE", candidates: ["10:00", "22:00"] });
    expect(daypartAnswer("da tarde", ["02:00", "14:00"])).toBe("14:00");
    expect(daypartAnswer("às 3 da tarde", ["02:00", "14:00"])).toBeUndefined();
  });
  it.each([
    ["das 10 às 11", clock(10), clock(11), ["10:00", "11:00"]], ["de 10 a 11", clock(10), clock(11), ["10:00", "11:00"]],
    ["14h-16h", clock(14), clock(16), ["14:00", "16:00"]], ["das dez as onze", clock(10), clock(11), ["10:00", "11:00"]],
    ["das 2 às 5 da tarde", clock(14), clock(5, 0, "TARDE"), ["14:00", "17:00"]], ["das 10h30 às 11h", clock(10, 30), clock(11), ["10:30", "11:00"]],
    ["das 10 da manhã às 2 da tarde", clock(10, 0, "MANHA"), clock(2, 0, "TARDE"), ["10:00", "14:00"]],
  ] as const)("interval %s binds start to the first clock and end to the second", (quote, start, end, times) =>
    expect(verifyClockInterval(quote, start, end)).toEqual(times.map(at)));
  it("a perturbed or swapped interval is rejected at both ends", () => {
    for (const [start, end] of [[clock(10), clock(12)], [clock(11), clock(10)], [clock(9), clock(11)]] as const)
      expect(verifyClockInterval("das 10 às 11", start, end).map(item => item.status)).toEqual(["REJECTED", "REJECTED"]);
  });
  const today = "2026-09-27"; // Sunday: 'dia vinte e oito' is tomorrow.
  it.each([
    ["amanhã", day({ kind: "RELATIVE_DAY", offset: 1 }), "2026-09-28"], ["pra amanha", day({ kind: "RELATIVE_DAY", offset: 1 }), "2026-09-28"],
    ["AMANHÃ", day({ kind: "RELATIVE_DAY", offset: 1 }), "2026-09-28"], ["depois de amanha", day({ kind: "RELATIVE_DAY", offset: 2 }), "2026-09-29"],
    ["dia vinte e oito", day({ kind: "DAY_OF_MONTH", day: 28 }), "2026-09-28"], ["do dia 28", day({ kind: "DAY_OF_MONTH", day: 28 }), "2026-09-28"],
    ["28/09", day({ kind: "DAY_OF_MONTH", day: 28, month: 9 }), "2026-09-28"], ["28 de setembro", day({ kind: "DAY_OF_MONTH", day: 28, month: 9 }), "2026-09-28"],
    ["28/09/26", day({ kind: "DAY_OF_MONTH", day: 28, month: 9, year: 2026 }), "2026-09-28"], ["1º de outubro", day({ kind: "DAY_OF_MONTH", day: 1, month: 10 }), "2026-10-01"],
    ["sexta", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST" }), "2026-10-02"], ["sex", day({ kind: "WEEKDAY", weekday: 5 }), "2026-10-02"],
    ["6ª feira", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST" }), "2026-10-02"], ["terça-feira", day({ kind: "WEEKDAY", weekday: 2, week: "NEAREST" }), "2026-09-29"],
    // On Sunday the next Monday-Sunday week starts tomorrow.
    ["sexta da semana que vem", day({ kind: "WEEKDAY", weekday: 5, week: "NEXT_WEEK" }), "2026-10-02"],
    ["daqui a 3 dias", day({ kind: "DAYS_FROM_NOW", days: 3 }), "2026-09-30"], ["daqui a duas semanas", day({ kind: "DAYS_FROM_NOW", days: 14 }), "2026-10-11"],
    ["amanhã, dia 28", day({ kind: "DAY_OF_MONTH", day: 28 }), "2026-09-28"], ["segunda, dia 28", day({ kind: "DAY_OF_MONTH", day: 28 }), "2026-09-28"],
  ] as const)("date %s", (quote, value, date) => expect(verifyDayComponent(quote, value, today)).toEqual(ok(date)));
  it.each([
    ["dia 28", day({ kind: "DAY_OF_MONTH", day: 29 })], ["28/09", day({ kind: "DAY_OF_MONTH", day: 28, month: 10 })], ["dia 28", day({ kind: "DAY_OF_MONTH", day: 28, month: 9 })],
    ["amanhã", day({ kind: "RELATIVE_DAY", offset: 2 })], ["depois de amanhã", day({ kind: "RELATIVE_DAY", offset: 1 })], ["sexta", day({ kind: "WEEKDAY", weekday: 4 })],
    ["sexta que vem", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST" })], ["sexta", day({ kind: "WEEKDAY", weekday: 5, week: "NEXT_WEEK" })],
    ["daqui a 3 dias", day({ kind: "DAYS_FROM_NOW", days: 4 })], ["ontem", day({ kind: "RELATIVE_DAY", offset: 0 })], ["amanhã, dia 29", day({ kind: "DAY_OF_MONTH", day: 29 })],
    ["dia 28 de outubro", day({ kind: "DAY_OF_MONTH", day: 28 })], ["dia vinte e nove", day({ kind: "DAY_OF_MONTH", day: 28 })],
  ] as const)("perturbed date %s %j is rejected", (quote, value) => expect(verifyDayComponent(quote, value, today).status).toBe("REJECTED"));
  it("a weekday stated beside an explicit date that falls on another day is the existing calendar question", () => {
    expect(verifyDayComponent("terça, dia 14 de abril de 2027", day({ kind: "DAY_OF_MONTH", day: 14, month: 4, year: 2027 }), today))
      .toEqual({ status: "WEEKDAY_CONFLICT", calendar_date: "2027-04-14", stated_weekday: 2, actual_weekday: 3 });
    expect(verifyDayComponent("sexta que vem", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), "2026-09-28"))
      .toEqual({ status: "DATE_CHOICE", candidates: ["2026-10-02", "2026-10-09"] });
  });
});

type Row = [string, string, string, Record<string, unknown>, unknown];
const corpus = JSON.parse(readFileSync("src/test/fixtures/temporal-component-phrasings.json", "utf8")) as
  { today: string; dates: Row[]; clocks: Row[]; intervals: [string, string, string, ClockComponent, ClockComponent, unknown[]][] };
const expected = (value: unknown, key: "date" | "time") => typeof value === "string" ? { status: "OK", [key]: value } : value;
describe("licensed corpus (Duckling PT, Recognizers-Text PT): phrasings our components represent", () => {
  it("is small, attributed and has unique ids", () => {
    const ids = [...corpus.dates, ...corpus.clocks, ...corpus.intervals].map(row => row[0]);
    expect(new Set(ids).size).toBe(ids.length);expect(ids.length).toBeGreaterThan(120);expect(ids.length).toBeLessThan(400);
    expect([...corpus.dates, ...corpus.clocks, ...corpus.intervals].every(row => ["duckling", "recognizers"].includes(row[1]))).toBe(true);
  });
  it.each(corpus.dates)("%s (%s) %s", (_id, _source, text, component, expect_) =>
    expect(verifyDayComponent(text, day(component as DayComponent), corpus.today)).toEqual(expected(expect_, "date")));
  it.each(corpus.clocks)("%s (%s) %s", (_id, _source, text, component, expect_) =>
    expect(verifyClockComponent(text, component as ClockComponent)).toEqual(expected(expect_, "time")));
  it.each(corpus.intervals)("%s (%s) %s", (_id, _source, text, start, end, times) =>
    expect(verifyClockInterval(text, start, end)).toEqual(times.map(value => expected(value, "time"))));
  const accepted = <T>(rows: T[], pick: (row: T) => unknown) => rows.filter(row => typeof pick(row) === "string");
  it.each(accepted(corpus.dates, row => row[4]))("%s perturbed day/offset/weekday is rejected: %s %s", (_id, _source, text, component) => {
    const c = day(component as DayComponent), perturbed = c.kind === "RELATIVE_DAY" ? { ...c, offset: (c.offset! + 1) % 3 } :
      c.kind === "WEEKDAY" ? { ...c, weekday: (c.weekday! + 1) % 7 } : c.kind === "DAYS_FROM_NOW" ? { ...c, days: c.days! + 1 } : { ...c, day: c.day === 28 ? 27 : c.day! + 1 };
    expect(verifyDayComponent(text, perturbed, corpus.today).status).toBe("REJECTED");
  });
  it.each(corpus.clocks.filter(row => row[4] !== undefined))("%s perturbed hour is rejected: %s %s", (_id, _source, text, component) => {
    const c = component as ClockComponent;
    expect(verifyClockComponent(text, { ...c, hour: c.hour === 23 ? 22 : c.hour + 1 }).status).toBe("REJECTED");
  });
  it.each(accepted(corpus.dates, row => row[4]))("%s survives upper case and stripped accents: %s %s", (_id, _source, text, component, expect_) =>
    expect(verifyDayComponent(text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase(), day(component as DayComponent), corpus.today)).toEqual(expected(expect_, "date")));
});

describe("phone abbreviations of the closed vocabulary (C2 example-bank gate)", () => {
  it.each([
    ["hj", day({ kind: "RELATIVE_DAY", offset: 0 }), ok(MONDAY)],
    ["dps de amanha", day({ kind: "RELATIVE_DAY", offset: 2 }), ok("2026-09-30")],
    ["semana q vem na terça", day({ kind: "WEEKDAY", weekday: 2, week: "NEXT_WEEK" }), ok("2026-10-06")],
    ["sexta q vem", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), { status: "DATE_CHOICE", candidates: ["2026-10-02", "2026-10-09"] }],
  ] as const)("%s", (quote, component, verdict) => expect(verifyDayComponent(quote, component, MONDAY)).toEqual(verdict));
  it("an abbreviation never proves a different day, and a lone q is not a week qualifier", () => {
    expect(verifyDayComponent("hj", day({ kind: "RELATIVE_DAY", offset: 1 }), MONDAY)).toEqual(rejected("TOKEN_MISMATCH"));
    expect(verifyDayComponent("dps de amanha", day({ kind: "RELATIVE_DAY", offset: 1 }), MONDAY)).toEqual(rejected("TOKEN_MISMATCH"));
    expect(verifyDayComponent("q sexta", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), MONDAY)).toEqual(rejected("TOKEN_MISMATCH"));
  });
});

describe("phase 3a review: limits, interval dayparts, anchors and directions", () => {
  it.each(["depois das 10", "antes das 10", "após as 10", "ate as 10", "a partir das 10", "daqui 10 horas", "dentro de 10 horas", "em 10 horas", "entre 10 e 11"])(
    "'%s' is not an exact time", quote => expect(verifyClockComponent(quote, clock(10))).toEqual(rejected("TOKEN_MISMATCH")));
  it("'até' ends and 'a partir de' starts a block; a create gets neither", () => {
    expect(verifyClockComponent("ate as 18h", clock(18), { role: "end_time", operation: "schedule.block" })).toEqual(at("18:00"));
    expect(verifyClockComponent("a partir das 14h", clock(14), { role: "time", operation: "schedule.block" })).toEqual(at("14:00"));
    expect(verifyClockComponent("a partir das 14h", clock(14), { role: "time", operation: "appointment.create" })).toEqual(rejected("TOKEN_MISMATCH"));
    expect(verifyClockInterval("a partir das 14h ate as 18h", clock(14), clock(18), { operation: "schedule.block" })).toEqual([at("14:00"), at("18:00")]);
    expect(verifyClockInterval("entre as 5 e 6 da tarde", clock(5, 0, "TARDE"), clock(6, 0, "TARDE"))).toEqual([at("17:00"), at("18:00")]);
  });
  it("a daypart qualifies its own clock; written once after the end it also qualifies a bare start", () => {
    for (const [quote, start, end] of [["das 7 da manha as 9 da noite", clock(7, 0, "MANHA"), clock(9)], ["das 9 da manha as 10 da noite", clock(9), clock(10)],
      ["das 10 da manha as 2 da tarde", clock(10, 0, "MANHA"), clock(2)]] as const)
      expect(verifyClockInterval(quote, start, end).map(item => item.status)).toEqual(["REJECTED", "REJECTED"]);
    expect(verifyClockInterval("das 7 da manha as 9 da noite", clock(7, 0, "MANHA"), clock(9, 0, "NOITE"))).toEqual([at("07:00"), at("21:00")]);
    expect(verifyClockInterval("das 2 as 4 da tarde", clock(2, 0, "TARDE"), clock(4, 0, "TARDE"))).toEqual([at("14:00"), at("16:00")]);
    expect(verifyClockComponent("as 9 da noite", clock(9))).toEqual(rejected("TOKEN_MISMATCH"));
  });
  it("the minute is adjacent to its hour: another number is never a minute", () => {
    for (const quote of ["as 10, 11", "as 10 com 30 min de intervalo", "as 10 ou 11"]) expect(verifyClockComponent(quote, clock(10, 11)).status).toBe("REJECTED");
    expect(verifyClockComponent("as 10 com 30 min de intervalo", clock(10, 30))).toEqual(rejected("TOKEN_MISMATCH"));
    expect(verifyClockComponent("as 10 mais ou menos", clock(10))).toEqual(at("10:00"));
  });
  it("a day number needs an anchor ('dia', a month, d/m, an ordinal, its weekday) unless it answers a date question", () => {
    for (const quote of ["às 10", "umas 10", "pra 10", "10"]) expect(verifyDayComponent(quote, day({ kind: "DAY_OF_MONTH", day: 10 }), MONDAY)).toEqual(rejected("TOKEN_MISMATCH"));
    expect(verifyDayComponent("10", day({ kind: "DAY_OF_MONTH", day: 10 }), MONDAY, { answer: true })).toEqual(ok("2026-10-10"));
    expect(verifyDayComponent("às 10", day({ kind: "DAY_OF_MONTH", day: 10 }), MONDAY, { answer: true })).toEqual(rejected("TOKEN_MISMATCH"));
    expect(verifyDayComponent("no primeiro", day({ kind: "DAY_OF_MONTH", day: 1 }), MONDAY)).toEqual(ok("2026-10-01"));
    expect(verifyDayComponent("sexta 13", day({ kind: "DAY_OF_MONTH", day: 13, weekday: 5 }), MONDAY)).toMatchObject({ status: "WEEKDAY_CONFLICT", calendar_date: "2026-10-13" });
  });
  it("alternatives, another/past week words, extra day numbers and a December 'dez' are inconsistent", () => {
    const cases: [string, DayComponent][] = [["15 de dez", day({ kind: "DAY_OF_MONTH", day: 15 })], ["dia 2 ou 3", day({ kind: "DAY_OF_MONTH", day: 2 })],
      ["dia 10 e 11", day({ kind: "DAY_OF_MONTH", day: 10 })], ["amanha ou depois", day({ kind: "RELATIVE_DAY", offset: 1 })], ["sexta 13", day({ kind: "WEEKDAY", weekday: 5 })],
      ["sexta da outra semana", day({ kind: "WEEKDAY", weekday: 5, week: "NEXT_WEEK" })], ["sexta da outra semana", day({ kind: "WEEKDAY", weekday: 5 })],
      ["sexta passada", day({ kind: "WEEKDAY", weekday: 5 })], ["depois amanha", day({ kind: "RELATIVE_DAY", offset: 1 })], ["depois d amanha", day({ kind: "RELATIVE_DAY", offset: 1 })],
      ["depois de sexta", day({ kind: "WEEKDAY", weekday: 5 })], ["ate sexta", day({ kind: "WEEKDAY", weekday: 5 })]];
    for (const [quote, value] of cases) expect(verifyDayComponent(quote, value, MONDAY), quote).toEqual(rejected("TOKEN_MISMATCH"));
    expect(verifyDayComponent("15 de dez", day({ kind: "DAY_OF_MONTH", day: 15, month: 12 }), MONDAY)).toEqual(ok("2026-12-15"));
    expect(verifyDayComponent("depois amanha", day({ kind: "RELATIVE_DAY", offset: 2 }), MONDAY)).toEqual(ok("2026-09-30"));
    expect(verifyDayComponent("ate sexta", day({ kind: "WEEKDAY", weekday: 5 }), MONDAY, { role: "end_date" })).toEqual(ok("2026-10-02"));
    expect(verifyDayComponent("sexta 2", day({ kind: "WEEKDAY", weekday: 5 }), MONDAY)).toEqual(ok("2026-10-02"));
  });
  it("an existing appointment's day (ANY) may be past; a day to book (FORWARD) rolls forward or asks", () => {
    const dom = (d: number, month: number | null = null, year: number | null = null) => day({ kind: "DAY_OF_MONTH", day: d, month, year });
    expect(resolveDayComponent(dom(25), MONDAY)).toEqual(ok("2026-10-25"));
    expect(resolveDayComponent(dom(25), MONDAY, "ANY")).toEqual({ status: "DATE_CHOICE", candidates: ["2026-09-25", "2026-10-25"] });
    expect(resolveDayComponent(dom(30), MONDAY, "ANY")).toEqual(ok("2026-09-30"));
    expect(resolveDayComponent(dom(5, 9, 2026), MONDAY, "ANY")).toEqual(ok("2026-09-05"));
    expect(resolveDayComponent(dom(5, 9, 2026), MONDAY)).toEqual(rejected("DATE_IN_PAST"));
    expect(resolveDayComponent(dom(20, 4), "2026-10-03")).toEqual({ status: "DATE_CHOICE", candidates: ["2026-04-20", "2027-04-20"] });
    expect(resolveDayComponent(dom(5, 1), "2026-12-20", "ANY")).toEqual(ok("2027-01-05"));
  });
});
