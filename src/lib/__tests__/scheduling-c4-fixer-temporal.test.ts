import { afterEach, describe, expect, it, vi } from "vitest";
import { dateChoiceAnswer, verifyClockComponent, verifyDayComponent } from "../scheduling-temporal-reference";
import { daypartWrittenOutside, groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { dateChoiceRetry, dateChoiceRetryFor } from "../scheduling-calendar-conflict";
import type { SchedulingFields } from "../scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, fixer of the R1/R2 review (flags SALON_SECRETARY_DATE_RULES_V2 and SALON_SECRETARY_DAYPART_RULES_V2, default off),
 * pure rules and grounding: a negated predicate about a day already past never hints another appointment; a weekday word that may
 * be an option's ordinal, an invalid model component or "ano que vem" never settle a DATE_CHOICE answer, and an answer never books
 * a past day; a free number (a clock) never narrows a DATE_CHOICE; the 'every written daypart' rule with the components Luna can
 * send (review finding rejected, pinned); the retry asks for what tells the two dates apart; the written-daypart guard of the
 * tenant-hours rule. No DB, no network, no model. */
afterEach(() => { vi.unstubAllEnvs(); });
const flags = (dates: boolean, dayparts = false) => { vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", dates ? "true" : "false"); vi.stubEnv("SALON_SECRETARY_DAYPART_RULES_V2", dayparts ? "true" : "false"); };
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent =>
  ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const dom = (d: number | null, month: number | null = null, year: number | null = null) => day({ kind: "DAY_OF_MONTH", day: d, month, year });
const clock = (hour: number, minute = 0, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute, daypart });
const friday = day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" });
const MONDAY = "2026-09-28", TUESDAY = "2026-09-29";
const tz = "America/Sao_Paulo", NOW = new Date("2026-09-29T15:00:00Z"), MONDAY_NOW = new Date("2026-09-28T15:00:00Z"), WEDNESDAY_NOW = new Date("2026-09-30T15:00:00Z");
type Entry = SchedulingTemporalEvidence[number];
const c = (field: Entry["field"], text: string, component: DayComponent | ClockComponent): Entry => ({ field, text, component });
function ground(message: string, operation: string, evidence: SchedulingTemporalEvidence, options: { raw?: SchedulingFields; previous?: SchedulingFields; now?: Date; waitingFor?: string;
  context?: Parameters<typeof groundSchedulingTemporalTurn>[8] } = {}) {
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  return groundSchedulingTemporalTurn(options.previous ?? {}, options.raw ?? {}, message, tz, options.now ?? NOW, options.waitingFor, operation, evidence, options.context);
}
const pending = (expression: string, candidates: [string, string]) => ({ draft_ref: "d-fixer", draft_revision: 2, expires_at: "2099-01-01T00:00:00Z",
  pending_calendar_conflicts: [{ field: "date" as const, kind: "DATE_CHOICE" as const, expression, candidates }] });

describe("B6: a negated predicate about a day already past is never a hint toward another appointment", () => {
  const move = (message: string, name: string | undefined, source: [string, DayComponent], dest: [string, DayComponent], time: [string, ClockComponent], now = NOW) =>
    ground(message, "appointment.change", [c("source_date", ...source), c("date", ...dest), c("time", ...time)], { raw: name ? { customer_name: name } : {}, now });
  it.each([
    // [message, name, source, destination, time, now]: 20/08 already passed on 29/09; "nessa segunda" on Wednesday is 28/09.
    // Migrated (C4 R-A, backup .demo/agenda-core/contract-migration/scheduling-c4-fixer-temporal.test.before-c4-ra-temporal-scope.ts):
    // the day-of-month rows without a month ("dia 25", "no dia 3") moved to the table below; the locator now checks their past day.
    ["A Luz não pôde vir no dia 20/08. Passa ela pro dia 02/10 às 9h", "Luz", ["no dia 20/08", dom(20, 8)], ["dia 02/10", dom(2, 10)], ["às 9h", clock(9)], NOW],
    ["O Kevin não vem mais nessa segunda. Passa ele pra quinta às 10h", "Kevin", ["nessa segunda", day({ kind: "WEEKDAY", weekday: 1, week: "THIS_WEEK" })],
      ["quinta", day({ kind: "WEEKDAY", weekday: 4 })], ["às 10h", clock(10)], WEDNESDAY_NOW],
  ] as const)("adversarial: '%s' keeps the historical denial", (message, name, source, dest, time, now) => {
    flags(true);
    const run = move(message, name, [...source], [...dest], [...time], now);
    expect(run.rejected.map(item => item.field)).toEqual(["source_date"]);expect(run).not.toHaveProperty("locator_hints");expect(run.fields.source_date).toBeUndefined();
    expect(run).not.toHaveProperty("past_readings");
    flags(false);
    expect(move(message, name, [...source], [...dest], [...time], now).rejected.map(item => item.field)).toEqual(["source_date"]);
  });
  // C4 R-A (migrated from the table above): a day of the month with NO month whose reading this month passed ("não pode no dia 1",
  // "não veio dia 25") is never a value: the hint names its next occurrence AND carries the dropped past day, and the locator never
  // selects by it while the customer has an appointment of any status on that past day (secretary-c4-ra-temporal-scope.test.ts).
  it.each([
    ["A Vitória não veio dia 25. Remarca ela pro dia 30 às 10h", "Vitória", ["dia 25", dom(25)], ["dia 30", dom(30)], ["às 10h", clock(10)], "2026-10-25", "2026-09-25"],
    ["O Téo não apareceu no dia 3. Passa ele pro dia 8 às 16h", "Téo", ["no dia 3", dom(3)], ["dia 8", dom(8)], ["às 16h", clock(16)], "2026-10-03", "2026-09-03"],
  ] as const)("'%s': never a value; the hint carries the dropped past day for the locator", (message, name, source, dest, time, next, past) => {
    flags(true);
    const run = move(message, name, [...source], [...dest], [...time]);
    expect(run.fields.source_date).toBeUndefined();expect(run.patch.source_date).toBeUndefined();expect(run).not.toHaveProperty("past_readings");
    expect(run.locator_hints).toEqual([{ field: "source_date", dates: [next], expression: source[0], dropped: [past] }]);
    flags(false);
    expect(move(message, name, [...source], [...dest], [...time]).rejected.map(item => item.field)).toEqual(["source_date"]);
  });
  it.each([
    ["A Céu não pode no dia 30. Passa ela pro dia 02/10 às 11h", "Céu", ["no dia 30", dom(30)], ["dia 02/10", dom(2, 10)], ["às 11h", clock(11)], ["2026-09-30"]],
    ["O Hiroshi não consegue vir no dia 14/10. Remarca ele pro dia 20/10 às 15h", "Hiroshi", ["no dia 14/10", dom(14, 10)], ["dia 20/10", dom(20, 10)], ["às 15h", clock(15)], ["2026-10-14"]],
  ] as const)("a day still ahead keeps the locator hint: '%s'", (message, name, source, dest, time, dates) => {
    flags(true);
    const run = move(message, name, [...source], [...dest], [...time]);
    expect(run.rejected).toEqual([]);expect(run.locator_hints).toEqual([{ field: "source_date", dates, expression: source[0] }]);
  });
});

describe("DATE_CHOICE answer: 'segunda' may be the second option", () => {
  const mixed = ["2026-09-28", "2026-10-28"]; // seg 28/09, qua 28/10
  it.each([["a segunda opção"], ["a segunda data"], ["a segunda"], ["segunda"], ["a 2ª"], ["a segunda, dia 28"], ["a segunda de outubro"]] as const)(
    "adversarial: '%s' selects nothing", quote => { expect(dateChoiceAnswer(quote, mixed, TUESDAY)).toBeUndefined(); });
  it.each([
    ["segunda-feira", "2026-09-28"], ["a de segunda-feira", "2026-09-28"], ["2ª feira", "2026-09-28"], ["segunda dia 28", "2026-09-28"], ["segunda, 28/09", "2026-09-28"],
    ["a quarta", "2026-10-28"], ["a de quarta", "2026-10-28"], ["o de outubro", "2026-10-28"],
  ] as const)("'%s' written as a weekday (or a position no option has) still settles it", (quote, expected) => { expect(dateChoiceAnswer(quote, mixed, TUESDAY)).toBe(expected); });
  const answer = (message: string, component: DayComponent, operation = "appointment.list", expression = "dia 28", candidates: [string, string] = ["2026-09-28", "2026-10-28"]) => {
    flags(true);
    return ground(message, operation, [c("date", message, component)], { previous: { professional_name: "Bianca" }, waitingFor: "date", context: pending(expression, candidates) });
  };
  it("grounding: the echoed or an invalid component with 'a segunda opção' settles nothing; 'segunda-feira' does", () => {
    for (const component of [dom(28), dom(null), day({ kind: "DAY_OF_MONTH", day: null, month: 9 })]) {
      const run = answer("a segunda opção", component);
      expect(run.fields.date).toBeUndefined();expect(run.rejected.map(item => item.field)).toEqual(["date"]);
    }
    expect(answer("segunda-feira", dom(28)).fields.date).toBe("2026-09-28");
  });
  it("adversarial: an invalid model component never agrees with an answer the words name", () => {
    expect(answer("o de outubro", dom(null, 10)).fields.date).toBeUndefined();
    expect(answer("o de outubro", dom(28, 10)).fields.date).toBe("2026-10-28");
  });
  it("a booking's answer never settles a past day (as an explicit past year): asked, never booked", () => {
    const past = answer("o de 2026", dom(20, 4), "appointment.create", "dia 20 de abril", ["2026-04-20", "2027-04-20"]);
    expect(past.fields.date).toBeUndefined();expect(past.rejected).toEqual([{ code: "DATE_IN_PAST", field: "date", value: "2026-04-20" }]);
    expect(answer("a segunda", dom(20, 4), "appointment.create", "dia 20 de abril", ["2026-04-20", "2027-04-20"]).fields.date).toBeUndefined();
    expect(answer("o de 2027", dom(20, 4), "appointment.create", "dia 20 de abril", ["2026-04-20", "2027-04-20"]).fields.date).toBe("2027-04-20");
    // A read may name the past candidate.
    expect(answer("o de 2026", dom(20, 4), "appointment.list", "dia 20 de abril", ["2026-04-20", "2027-04-20"]).fields.date).toBe("2026-04-20");
  });
  it("flag off: no answer settles anything", () => {
    flags(false);
    expect(ground("segunda-feira", "appointment.list", [c("date", "segunda-feira", dom(28))], { waitingFor: "date", context: pending("dia 28", ["2026-09-28", "2026-10-28"]) }).fields.date).toBeUndefined();
  });
});

describe("DATE_CHOICE answer: the year qualifier counts", () => {
  const months = ["2026-09-25", "2026-10-25"], years = ["2026-04-20", "2027-04-20"];
  it.each([["o de outubro do ano que vem", months, undefined], ["o do ano que vem", years, "2027-04-20"], ["o do próximo ano", years, "2027-04-20"], ["o deste ano", years, "2026-04-20"],
    ["o de outubro deste ano", months, "2026-10-25"], ["o do ano passado", years, undefined]] as const)("'%s'", (quote, candidates, expected) => {
    expect(dateChoiceAnswer(quote, candidates, TUESDAY)).toBe(expected);
  });
  it("grounding: 'o de outubro do ano que vem' with a year-less month component settles nothing", () => {
    flags(true);
    const run = ground("o de outubro do ano que vem", "appointment.list", [c("date", "o de outubro do ano que vem", dom(25, 10))], { waitingFor: "date", context: pending("dia 25", ["2026-09-25", "2026-10-25"]) });
    expect(run.fields.date).toBeUndefined();expect(run.rejected.map(item => item.field)).toEqual(["date"]);
  });
});

describe("B2: a free number (a clock) never narrows a DATE_CHOICE", () => {
  it.each([["sexta que vem 2 da tarde", "EXISTING"], ["sexta que vem 9 da noite", "EXISTING"], ["sexta que vem 9 da manhã", "FORWARD"], ["sexta que vem 2", "ANY"]] as const)(
    "adversarial: '%s' (%s) keeps both Fridays", (quote, direction) => {
      flags(true); expect(verifyDayComponent(quote, friday, MONDAY, { direction })).toEqual({ status: "DATE_CHOICE", candidates: ["2026-10-02", "2026-10-09"] });
    });
  it("a date-bound day number still narrows ('sexta que vem, dia 9', 'sexta que vem dia 2')", () => {
    flags(true);
    expect(verifyDayComponent("sexta que vem, dia 9", friday, MONDAY, { direction: "EXISTING" })).toEqual({ status: "OK", date: "2026-10-09" });
    expect(verifyDayComponent("sexta que vem dia 2", friday, MONDAY)).toEqual({ status: "OK", date: "2026-10-02" });
  });
  it("grounding: the clock the owner proved is kept and the day asked, with a component time or a legacy (component-less) one", () => {
    flags(true);
    const withComponent = ground("cancela o Rafael de sexta que vem 9 da noite", "appointment.cancel", [c("date", "sexta que vem", friday), c("time", "9 da noite", clock(9, 0, "NOITE"))],
      { raw: { customer_name: "Rafael" }, now: MONDAY_NOW });
    expect(withComponent.fields.time).toBe("21:00");expect(withComponent.fields.date).toBeUndefined();
    expect(withComponent.pending_calendar_conflicts).toMatchObject([{ field: "date", kind: "DATE_CHOICE", candidates: ["2026-10-02", "2026-10-09"] }]);
    const legacy = ground("cancela o Rafael de sexta que vem 9 da noite", "appointment.cancel", [c("date", "sexta que vem", friday), { field: "time", text: "9 da noite" }],
      { raw: { customer_name: "Rafael" }, now: MONDAY_NOW });
    expect(legacy.fields.date).toBeUndefined();expect(legacy.pending_calendar_conflicts).toMatchObject([{ field: "date", kind: "DATE_CHOICE" }]);
    const book = ground("marca a Gabriela sexta que vem 2 da tarde", "appointment.create", [c("date", "sexta que vem", friday), c("time", "2 da tarde", clock(2, 0, "TARDE"))],
      { raw: { customer_name: "Gabriela" }, now: MONDAY_NOW });
    expect(book.fields.time).toBe("14:00");expect(book.fields.date).toBeUndefined();
  });
});

describe("C1 'every written daypart' with the components Luna can send (the review's MADRUGADA component is not in the wire enum)", () => {
  it.each([["às 6 da madrugada", clock(6)], ["às 6 da madrugada", clock(6, 0, "MANHA")], ["às 5 da madrugada", clock(5)], ["às 9 da noite", clock(9, 0, "NOITE")],
    ["às 6 da manhã", clock(6, 0, "TARDE")], ["às 10 da noite", clock(10, 0, "MANHA")], ["à tarde, às 9", clock(9, 0, "MANHA")]] as const)("'%s' with %j: the same verdict with the flag on and off", (quote, value) => {
    flags(false, false); const off = verifyClockComponent(quote, value);
    flags(false, true); expect(verifyClockComponent(quote, value)).toEqual(off);
  });
  it("one quote spanning 'à noite … da madrugada' is asked with the flag (the night of Saturday may be Sunday 02h), never booked on Saturday 02h", () => {
    flags(false, false); expect(verifyClockComponent("sábado à noite, às 2 da madrugada", clock(2))).toEqual({ status: "OK", time: "02:00" });
    flags(false, true); expect(verifyClockComponent("sábado à noite, às 2 da madrugada", clock(2)).status).toBe("REJECTED");
  });
  it("grounding: 'amanhã às 5 da madrugada' keeps 05:00 with the flag on and off", () => {
    for (const on of [false, true]) {
      flags(false, on);
      const run = ground("marca a Maria Eduarda amanhã às 5 da madrugada", "appointment.create", [c("date", "amanhã", day({ kind: "RELATIVE_DAY", offset: 1 })), c("time", "às 5 da madrugada", clock(5))]);
      expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-09-30", time: "05:00" });
    }
  });
});

describe("DATE_CHOICE retry names what tells the two dates apart", () => {
  it("month, day or year", () => {
    expect(dateChoiceRetryFor(["2026-09-25", "2026-10-25"])).toBe(dateChoiceRetry);
    expect(dateChoiceRetryFor(["2026-12-31", "2027-01-31"])).toBe(dateChoiceRetry);
    expect(dateChoiceRetryFor(["2026-10-02", "2026-10-09"])).toBe("Não encontrei na sua resposta qual das duas datas é a certa: responda com o dia ou com a data completa.");
    expect(dateChoiceRetryFor(["2026-04-20", "2027-04-20"])).toBe("Não encontrei na sua resposta qual das duas datas é a certa: responda com o ano ou com a data completa.");
  });
  it("what each retry asks for settles its choice", () => {
    expect(dateChoiceAnswer("dia 9", ["2026-10-02", "2026-10-09"], MONDAY)).toBe("2026-10-09");
    expect(dateChoiceAnswer("2027", ["2026-04-20", "2027-04-20"], TUESDAY)).toBe("2027-04-20");
    expect(dateChoiceAnswer("outubro", ["2026-10-02", "2026-10-09"], MONDAY)).toBeUndefined();
  });
});

describe("tenant-hours guard: a daypart written elsewhere in the action", () => {
  it.each([
    ["Amanhã de manhã, marca o Hiroshi com o Caio pra barba pras 2", ["pras 2"], true],
    ["Amanhã à noite marca a Luz com a Jade, pras 2", ["pras 2"], true],
    ["marca o Hiroshi pras 2, de tarde fica melhor", ["pras 2"], true],
    ["marca o Hiroshi amanhã pras 2 com o Caio pra barba", ["pras 2"], false],
    ["marca a Luz amanhã às 2 da tarde com a Jade", ["às 2 da tarde"], false],
    ["passa a Bia das 10 da manhã pras 2", ["das 10 da manhã", "pras 2"], false],
  ] as const)("'%s' → %s", (source, quotes, expected) => { flags(false, true); expect(daypartWrittenOutside(source, quotes)).toBe(expected); });
  it("a greeting is never a daypart (flag V2); without it the guard is conservative (the question stays)", () => {
    flags(false, true);
    expect(daypartWrittenOutside("Boa tarde! Marca o Kevin amanhã pras 2 com o Caio", ["pras 2"])).toBe(false);
    expect(daypartWrittenOutside("bom dia, marca o Kevin amanhã pras 2", ["pras 2"])).toBe(false);
    flags(false, false);
    expect(daypartWrittenOutside("Boa tarde! Marca o Kevin amanhã pras 2 com o Caio", ["pras 2"])).toBe(true);
  });
});
