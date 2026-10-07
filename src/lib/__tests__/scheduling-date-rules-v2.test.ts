import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalDay, dateChoiceAnswer, dayDirection, resolveDayComponent, verifyDayComponent } from "../scheduling-temporal-reference";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { calendarConflictQuestion } from "../scheduling-calendar-conflict";
import type { SchedulingFields } from "../scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";
import { addCalendarDays } from "../time";

/** Candidate 4, track R1 (flag SALON_SECRETARY_DATE_RULES_V2, default off): EXISTING direction for the day of an appointment
 * to cancel/move, the stated weekday narrowing a DATE_CHOICE, WEEKDAY+day read as a day of the month, answers to a live
 * DATE_CHOICE and a negated origin predicate as a locator constraint. Names, services and salons are varied on purpose. */
afterEach(() => { vi.unstubAllEnvs(); });
const rules = (on: boolean) => vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", on ? "true" : "false");
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent =>
  ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const clock = (hour: number, minute = 0, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute, daypart });
const dom = (d: number, month: number | null = null, year: number | null = null, weekday: number | null = null) => day({ kind: "DAY_OF_MONTH", day: d, month, year, weekday });
const ok = (date: string, dropped?: string) => ({ status: "OK", date, ...(dropped ? { dropped } : {}) });
const choice = (a: string, b: string) => ({ status: "DATE_CHOICE", candidates: [a, b] });
const MONDAY = "2026-09-28", TUESDAY = "2026-09-29";
const tz = "America/Sao_Paulo", NOW = new Date("2026-09-29T15:00:00Z"); // Tuesday, 12h in São Paulo
type Entry = SchedulingTemporalEvidence[number];
const c = (field: Entry["field"], text: string, component: DayComponent | ClockComponent): Entry => ({ field, text, component });
function ground(message: string, operation: string, evidence: SchedulingTemporalEvidence, options: { raw?: SchedulingFields; previous?: SchedulingFields; now?: Date; waitingFor?: string;
  context?: Parameters<typeof groundSchedulingTemporalTurn>[8] } = {}) {
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  return groundSchedulingTemporalTurn(options.previous ?? {}, options.raw ?? {}, message, tz, options.now ?? NOW, options.waitingFor, operation, evidence, options.context);
}

describe("flag off: today's rules, unchanged", () => {
  it("the direction table never yields EXISTING and ANY still offers the past day", () => {
    rules(false);
    expect([dayDirection("source_date", "appointment.change"), dayDirection("date", "appointment.cancel"), dayDirection("date", "appointment.read"), dayDirection("date", "appointment.list"),
      dayDirection("date", "appointment.create"), dayDirection("date", "appointment.change"), dayDirection("date", "schedule.block")]).toEqual(["ANY", "ANY", "ANY", "ANY", "FORWARD", "FORWARD", "FORWARD"]);
    expect(resolveDayComponent(dom(25), MONDAY, "ANY")).toEqual(choice("2026-09-25", "2026-10-25"));
    expect(canonicalDay(day({ kind: "WEEKDAY", weekday: 5, day: 2 }))).toEqual(day({ kind: "WEEKDAY", weekday: 5, day: 2 }));
    expect(resolveDayComponent(day({ kind: "WEEKDAY", weekday: 5, day: 2 }), TUESDAY)).toEqual({ status: "REJECTED", code: "COMPONENT_INVALID" });
    expect(verifyDayComponent("na sexta, dia 2", dom(2), TUESDAY, { direction: "ANY" })).toEqual(choice("2026-09-02", "2026-10-02"));
    expect(dateChoiceAnswer("o de outubro", ["2026-09-25", "2026-10-25"], TUESDAY)).toBe("2026-10-25"); // pure helper; the grounding only calls it with the flag
  });
  it("the grounding of every excerpt shape is today's: a past-vs-next question, a lost date, a denied origin", () => {
    rules(false);
    const cancel = ground("Desmarque o horário do Otávio do dia 1 das 17h30.", "appointment.cancel", [c("date", "dia 1", dom(1)), c("time", "das 17h30", clock(17, 30))]);
    expect(cancel.fields.date).toBeUndefined();expect(cancel.pending_calendar_conflicts).toEqual([{ field: "date", kind: "DATE_CHOICE", expression: "dia 1", candidates: ["2026-09-01", "2026-10-01"] }]);
    expect(cancel).not.toHaveProperty("past_readings");
    const weekdayDay = ground("uai desmarque o horário do Tomás de sexta dia dois das onze horas porque ele não vai conseguir vir", "appointment.cancel",
      [c("date", "sexta dia dois", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST", day: 2 })), c("time", "das onze horas", clock(11))]);
    expect(weekdayDay.fields.date).toBeUndefined();expect(weekdayDay.pending_calendar_conflicts).toEqual([]);
    const predicate = ground("Tchê, a Lurdes não pode no dia 06/10. Remarque ela pro dia 02/10 às 20:00.", "appointment.change",
      [c("source_date", "no dia 06/10", dom(6, 10)), c("date", "dia 02/10", dom(2, 10)), c("time", "às 20:00", clock(20))], { raw: { customer_name: "Lurdes" } });
    expect(predicate.rejected.map(item => item.field)).toEqual(["source_date"]);expect(predicate).not.toHaveProperty("locator_hints");
  });
});

describe("B1 EXISTING: the day of an appointment to cancel or move is never a past reading", () => {
  it("direction table with the flag: cancel.date and change.source_date are EXISTING; reads keep ANY; bookings keep FORWARD", () => {
    rules(true);
    expect([dayDirection("source_date", "appointment.change"), dayDirection("date", "appointment.cancel"), dayDirection("date", "appointment.read"), dayDirection("date", "appointment.list"),
      dayDirection("date", "appointment.create"), dayDirection("date", "appointment.change"), dayDirection("date", "schedule.block"), dayDirection("end_date", "schedule.block")])
      .toEqual(["EXISTING", "EXISTING", "ANY", "ANY", "FORWARD", "FORWARD", "FORWARD", "FORWARD"]);
  });
  it.each([
    [dom(25), MONDAY, ok("2026-10-25", "2026-09-25")], [dom(28), MONDAY, ok(MONDAY)], [dom(30), MONDAY, ok("2026-09-30")], [dom(31), TUESDAY, ok("2026-10-31")],
    [dom(5), "2026-12-20", ok("2027-01-05", "2026-12-05")], [dom(20, 4), "2026-10-03", ok("2027-04-20", "2026-04-20")],
    // An explicit year is never shifted (the locator answers "não encontrei").
    [dom(5, 9, 2026), MONDAY, ok("2026-09-05")],
    // Both readings future: still a choice (settled later by the agenda or asked).
    [day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), MONDAY, choice("2026-10-02", "2026-10-09")],
    // A weekly client's "essa segunda" said on Wednesday: this week's past Monday (not found), never next Monday's appointment.
    [day({ kind: "WEEKDAY", weekday: 1, week: "THIS_WEEK" }), "2026-09-30", ok(MONDAY)],
    [dom(30, 2), "2027-02-10", { status: "REJECTED", code: "DATE_INVALID" }],
  ] as const)("resolve %j on %s", (value, today, expected) => { rules(true); expect(resolveDayComponent(value, today, "EXISTING")).toEqual(expected); });
  it("simulated run days (1st, 15th, 28th, 30th, 31st, Dec 20/31, Feb 28 and 29): no mutation role ever resolves to or offers a past day", () => {
    rules(true);
    for (const today of ["2026-09-01", "2026-09-15", "2026-09-28", "2026-09-30", "2026-10-31", "2026-12-20", "2026-12-31", "2027-02-28", "2028-02-29"]) {
      const values: DayComponent[] = [];
      for (let d = 1; d <= 31; d++) { values.push(dom(d)); for (let m = 1; m <= 12; m++) values.push(dom(d, m)); }
      for (let w = 0; w < 7; w++) for (const week of ["NEAREST", "NEXT_WEEK", "AMBIGUOUS_NEXT"] as const) values.push(day({ kind: "WEEKDAY", weekday: w, week }));
      for (const value of values) {
        const result = resolveDayComponent(value, today, "EXISTING");
        if (result.status === "OK") { expect(result.date >= today, `${today} ${JSON.stringify(value)}`).toBe(true); if (result.dropped) expect(result.dropped < today).toBe(true); }
        if (result.status === "DATE_CHOICE") expect(result.candidates.every(date => date >= today), `${today} ${JSON.stringify(value)}`).toBe(true);
      }
    }
  });
  it("bookings and reads are untouched by the flag", () => {
    rules(true);
    expect(resolveDayComponent(dom(25), MONDAY)).toEqual(ok("2026-10-25"));
    expect(resolveDayComponent(dom(25), MONDAY, "ANY")).toEqual(choice("2026-09-25", "2026-10-25"));
    expect(resolveDayComponent(dom(20, 4), "2026-10-03")).toEqual(choice("2026-04-20", "2027-04-20"));
    expect(resolveDayComponent(dom(5, 9, 2026), MONDAY)).toEqual({ status: "REJECTED", code: "DATE_IN_PAST" });
  });
});

describe("B3: WEEKDAY + day number is the day of the month qualified by its weekday", () => {
  const weekdayDay = (weekday: number, d: number, extra: Partial<DayComponent> = {}) => day({ kind: "WEEKDAY", weekday, week: "NEAREST", day: d, ...extra });
  it("'sexta dia dois' is Friday the 2nd for a booking and for an existing appointment; 'sexta 13' is the calendar question", () => {
    rules(true);
    expect(verifyDayComponent("sexta dia dois", weekdayDay(5, 2), TUESDAY)).toEqual(ok("2026-10-02"));
    expect(verifyDayComponent("sexta dia dois", weekdayDay(5, 2, { week: null }), TUESDAY, { direction: "EXISTING" })).toEqual(ok("2026-10-02", "2026-09-02"));
    expect(verifyDayComponent("sexta 13", weekdayDay(5, 13), MONDAY)).toEqual({ status: "WEEKDAY_CONFLICT", calendar_date: "2026-10-13", stated_weekday: 5, actual_weekday: 2 });
  });
  it("only NEAREST (or no week) with no offset/days is read that way; everything else stays invalid", () => {
    rules(true);
    expect(resolveDayComponent(weekdayDay(5, 2, { offset: 1 }), TUESDAY)).toEqual({ status: "REJECTED", code: "COMPONENT_INVALID" });
    expect(resolveDayComponent(weekdayDay(5, 9, { week: "AMBIGUOUS_NEXT" }), TUESDAY)).toEqual({ status: "REJECTED", code: "COMPONENT_INVALID" });
    expect(resolveDayComponent(weekdayDay(5, 9, { week: "NEXT_WEEK" }), TUESDAY)).toEqual({ status: "REJECTED", code: "COMPONENT_INVALID" });
    // The pinned negative stays: a month the owner did not write is rejected.
    expect(verifyDayComponent("dia 28", dom(28, 9), "2026-09-27").status).toBe("REJECTED");
  });
  it.each([
    ["sexta", weekdayDay(5, 2)], ["sexta, dia 2 ou 3", weekdayDay(5, 2)], ["sexta às 2", weekdayDay(5, 2)], ["sexta pras 2", weekdayDay(5, 2)],
    // A model month or year never becomes a written one.
    ["sexta dia dois", weekdayDay(5, 2, { month: 10 })], ["sexta dia dois", weekdayDay(5, 2, { month: 10, year: 2026 })],
  ] as const)("adversarial: '%s' %j never proves a day", (quote, value) => { rules(true); expect(verifyDayComponent(quote, value, TUESDAY).status).toBe("REJECTED"); });
});

describe("B2: a weekday written next to the day number narrows a DATE_CHOICE (adjacency required)", () => {
  it.each([
    // [quote, component, today, direction, expected]
    ["sexta dia 25", dom(25, null, null, 5), TUESDAY, "ANY", ok("2026-09-25")],
    ["sexta dia 25", dom(25), TUESDAY, "ANY", ok("2026-09-25")],
    ["na sexta, dia 2", dom(2), TUESDAY, "ANY", ok("2026-10-02")],
    ["sexta-feira, dia 2", dom(2), TUESDAY, "ANY", ok("2026-10-02")],
    ["dia 2, sexta", dom(2), TUESDAY, "ANY", ok("2026-10-02")],
    ["sexta que vem, dia 9", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), MONDAY, "FORWARD", ok("2026-10-09")],
    ["sexta que vem, dia 9", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), MONDAY, "EXISTING", ok("2026-10-09")],
    ["terça, dia 20 de abril", dom(20, 4), "2026-10-03", "FORWARD", ok("2027-04-20")],
  ] as const)("'%s' %j on %s (%s) is one day", (quote, value, today, direction, expected) => {
    rules(true); expect(verifyDayComponent(quote, value, today, { direction })).toEqual(expected);
    rules(false); expect(verifyDayComponent(quote, value, today, { direction }).status).not.toBe("OK");
  });
  it("both candidates fitting, none fitting, or a past day to book keep asking", () => {
    rules(true);
    // Non-leap February and March: Sunday the 1st both times.
    expect(verifyDayComponent("domingo dia 1", dom(1), "2026-02-15", { direction: "ANY" })).toEqual(choice("2026-02-01", "2026-03-01"));
    // Neither the 3rd of September nor of October is a Friday: the calendar contradiction, never a day.
    expect(verifyDayComponent("sexta dia 3", dom(3), TUESDAY, { direction: "ANY" })).toEqual({ status: "WEEKDAY_CONFLICT", calendar_date: "2026-10-03", stated_weekday: 5, actual_weekday: 6 });
    expect(verifyDayComponent("sexta 13", dom(13, null, null, 5), MONDAY, { direction: "ANY" })).toMatchObject({ status: "WEEKDAY_CONFLICT", calendar_date: "2026-10-13" });
    // The only Monday the 20th of April is past: a booking never picks it (Phase 3a question kept); without a weekday, unchanged.
    expect(verifyDayComponent("segunda, dia 20 de abril", dom(20, 4), "2026-10-03")).toEqual(choice("2026-04-20", "2027-04-20"));
    expect(verifyDayComponent("dia 20 de abril", dom(20, 4), "2026-10-03")).toEqual(choice("2026-04-20", "2027-04-20"));
  });
  it.each([
    ["dia 5, segunda vez que ela remarca", dom(5)], ["dia 5, segunda cliente da tarde", dom(5)],
  ] as const)("adversarial: an ordinal is never a weekday filter ('%s')", (quote, value) => {
    rules(true); expect(verifyDayComponent(quote, value, TUESDAY, { direction: "ANY" })).toEqual(choice("2026-09-05", "2026-10-05"));
  });
  it("adversarial: alternatives, a clock beside the reference and a weekday of another sentence never narrow", () => {
    rules(true);
    expect(verifyDayComponent("quinta ou sexta dia 2", dom(2), TUESDAY, { direction: "ANY" }).status).toBe("REJECTED");
    expect(verifyDayComponent("sexta que vem 10", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }), MONDAY)).toEqual(choice("2026-10-02", "2026-10-09"));
    const read = ground("sexta eu não posso. O que tem dia 2 às 10?", "appointment.list", [c("date", "dia 2", dom(2))]);
    expect(read.fields.date).toBeUndefined();expect(read.pending_calendar_conflicts).toMatchObject([{ kind: "DATE_CHOICE", candidates: ["2026-09-02", "2026-10-02"] }]);
  });
});

describe("UX dateChoiceAnswer: an answer naming one published candidate settles it", () => {
  const month = ["2026-09-25", "2026-10-25"], fridays = ["2026-10-02", "2026-10-09"], firsts = ["2026-09-01", "2026-10-01"];
  it.each([
    ["outubro", month, TUESDAY, "2026-10-25"], ["o de outubro", month, TUESDAY, "2026-10-25"], ["do mês que vem", month, TUESDAY, "2026-10-25"], ["o do próximo mês", month, TUESDAY, "2026-10-25"],
    ["setembro", month, TUESDAY, "2026-09-25"], ["deste mês", month, TUESDAY, "2026-09-25"], ["dia 25 de outubro", month, TUESDAY, "2026-10-25"], ["25/10", month, TUESDAY, "2026-10-25"],
    ["a da semana que vem", fridays, MONDAY, "2026-10-09"], ["a desta semana", fridays, MONDAY, "2026-10-02"], ["dia 9", fridays, MONDAY, "2026-10-09"],
    ["quinta", firsts, TUESDAY, "2026-10-01"], ["a de terça", firsts, TUESDAY, "2026-09-01"], ["2026", ["2026-09-25", "2027-09-25"], TUESDAY, "2026-09-25"],
  ] as const)("'%s' picks exactly one", (quote, candidates, today, expected) => expect(dateChoiceAnswer(quote, candidates, today)).toBe(expected));
  it.each([
    ["dia 25", month], ["sexta", fridays], ["às 10", month], ["10", month], ["dia 26", month], ["outubro ou setembro", month], ["nenhum dos dois", month],
    ["o de outubro às 10", month], ["daqui a 2 semanas", fridays], ["outubro passado", month], ["o outro", month], ["sexta ou sábado", fridays],
  ] as const)("adversarial: '%s' selects nothing", (quote, candidates) => expect(dateChoiceAnswer(quote, candidates, TUESDAY)).toBeUndefined());
});

describe("grounding with the flag: excerpt shapes with new names", () => {
  it("B1 'do dia 1' on a cancel is 01/10 with the dropped past day kept for the owner", () => {
    rules(true);
    const run = ground("Desmarque o horário do Otávio do dia 1 das 17h30.", "appointment.cancel", [c("date", "dia 1", dom(1)), c("time", "das 17h30", clock(17, 30))]);
    expect(run.rejected).toEqual([]);expect(run.pending_calendar_conflicts).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-10-01", time: "17:30" });
    expect(run.past_readings).toEqual([{ field: "date", date: "2026-10-01", dropped: "2026-09-01", expression: "dia 1" }]);
  });
  it("B2 source 'sexta dia dois' of a move is Friday 02/10; the destination is unchanged", () => {
    rules(true);
    const run = ground("remarque pra mim a Heloísa de sexta dia dois pra quarta dia trinta às cinco da tarde com a Luz mesmo viu", "appointment.change", [
      c("source_date", "sexta dia dois", dom(2, null, null, 5)), c("date", "quarta dia trinta", dom(30, null, null, 3)), c("time", "às cinco da tarde", clock(5, 0, "TARDE"))]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ source_date: "2026-10-02", date: "2026-09-30", time: "17:00" });
  });
  it("B3 'de sexta dia dois' given as WEEKDAY+day keeps the date (the reason's 'não' is another clause)", () => {
    rules(true);
    const run = ground("uai desmarque o horário do Tomás de sexta dia dois das onze horas porque ele não vai conseguir vir", "appointment.cancel",
      [c("date", "sexta dia dois", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST", day: 2 })), c("time", "das onze horas", clock(11))]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-10-02", time: "11:00" });
    // A clipped literal is widened to the whole expression and stays consistent.
    const clipped = ground("uai desmarque o horário do Tomás de sexta dia dois das onze horas", "appointment.cancel", [c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST", day: 2 }))]);
    expect(clipped.fields.date).toBe("2026-10-02");
  });
  it("B4/B5: 'do dia três' on a cancel and 'na sexta, dia 2' as a move's origin", () => {
    rules(true);
    expect(ground("desmarque o Caio do dia três ele mudou de cidade e coloca o Levi no lugar dele também pra pé e mão", "appointment.cancel", [c("date", "dia três", dom(3))]).fields.date).toBe("2026-10-03");
    expect(ground("A Senhora Kátia pediu pra vir às 19:00 na sexta, dia 2, em vez das 11:00. Aí mude ela, por fa", "appointment.change", [c("source_date", "na sexta, dia 2", dom(2))]).fields.source_date).toBe("2026-10-02");
  });
  it("adversarial: a read still asks, an explicit past date is never moved, a negated cancel stays denied, an exclusion still refuses", () => {
    rules(true);
    expect(ground("o que teve na agenda dia 25", "appointment.read", [c("date", "dia 25", dom(25))]).pending_calendar_conflicts).toMatchObject([{ kind: "DATE_CHOICE", candidates: ["2026-09-25", "2026-10-25"] }]);
    expect(ground("cancela a Ana Paula do dia 25/09/2026", "appointment.cancel", [c("date", "dia 25/09/2026", dom(25, 9, 2026))]).fields.date).toBe("2026-09-25");
    const denied = ground("não cancela a Ana Paula do dia 25", "appointment.cancel", [c("date", "dia 25", dom(25))]);
    expect(denied.fields.date).toBeUndefined();expect(denied.rejected.map(item => item.field)).toEqual(["date"]);expect(denied).not.toHaveProperty("past_readings");
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", "true");
    const excluded = ground("cancela a Ana Paula do dia 5, não a do dia 3", "appointment.cancel", [c("date", "dia 5", dom(5)), { field: "date", text: "não a do dia 3", excluded: dom(3) }]);
    expect(excluded.fields.date).toBe("2026-10-05");
    const refused = ground("cancela a Ana Paula do dia 3, não a do dia 3", "appointment.cancel", [c("date", "dia 3", dom(3)), { field: "date", text: "não a do dia 3", excluded: dom(3) }]);
    expect(refused.fields.date).toBeUndefined();
  });
});

describe("grounding with the flag: a live DATE_CHOICE answer", () => {
  const context = (candidates = ["2026-09-25", "2026-10-25"] as [string, string], extra: object = {}) => ({ draft_ref: "d-agenda", draft_revision: 2, expires_at: "2099-01-01T00:00:00Z",
    pending_calendar_conflicts: [{ field: "date" as const, kind: "DATE_CHOICE" as const, expression: "dia 25", candidates }], ...extra });
  const answer = (message: string, component: DayComponent, extra: object = {}) =>
    ground(message, "appointment.list", [c("date", message, component)], { previous: { professional_name: "Jade" }, waitingFor: "date", context: context(undefined, extra) });
  it("the month (with or without the model's month) settles the published candidate; the flag off keeps the loop", () => {
    rules(true);
    expect(answer("o de outubro", dom(25, 10)).fields.date).toBe("2026-10-25");
    expect(answer("outubro", dom(25)).fields.date).toBe("2026-10-25");
    expect(answer("do mês que vem", dom(25, 10)).fields.date).toBe("2026-10-25");
    expect(answer("setembro", dom(25, 9)).fields.date).toBe("2026-09-25");
    rules(false);
    expect(answer("o de outubro", dom(25, 10)).fields.date).toBeUndefined();
  });
  it("the same choice re-created by the answer is 'not understood' (no new identical pending); a third date is its own question", () => {
    rules(true);
    const again = answer("dia 25", dom(25));
    expect(again.fields.date).toBeUndefined();expect(again.pending_calendar_conflicts).toEqual([]);expect(again.rejected.map(item => item.field)).toEqual(["date"]);
    const third = answer("dia 26", dom(26));
    expect(third.fields.date).toBeUndefined();expect(third.pending_calendar_conflicts).toMatchObject([{ candidates: ["2026-09-26", "2026-10-26"] }]);
  });
  it("adversarial: a negation, a model/owner disagreement, a stale draft or another role never settle it", () => {
    rules(true);
    expect(answer("não, o de outubro", dom(25, 10)).fields.date).toBeUndefined();
    expect(answer("o de outubro", dom(25, 9)).fields.date).toBeUndefined();
    expect(answer("o de outubro", dom(25, 10), { scope_valid: false }).fields.date).toBeUndefined();
    expect(answer("o de outubro", dom(25, 10), { expires_at: "2000-01-01T00:00:00Z" }).fields.date).toBeUndefined();
    const other = ground("o de outubro", "appointment.change", [c("source_date", "o de outubro", dom(25, 10))], { waitingFor: "date", context: context() });
    expect(other.fields.date).toBeUndefined();
  });
  it("a legacy selector answer may quote only part of the message when its calendar facts name that candidate", () => {
    const run = (on: boolean) => { rules(on); return groundSchedulingTemporalTurn({ professional_name: "Jade" }, { date: "2026-10-25" }, "é o de outubro, por favor", tz, NOW, "date", "appointment.list",
      [{ field: "date", text: "de outubro" }], context()); };
    expect(run(true).fields.date).toBe("2026-10-25");expect(run(false).fields.date).toBeUndefined();
    rules(true);
    expect(groundSchedulingTemporalTurn({}, { date: "2026-09-25" }, "é o de outubro, por favor", tz, NOW, "date", "appointment.list", [{ field: "date", text: "de outubro" }], context()).fields.date).toBeUndefined();
  });
  it("the question wording itself is unchanged", () => {
    expect(calendarConflictQuestion(context().pending_calendar_conflicts[0])).toBe("Para a data desejada, “dia 25” é sex, 25/09 ou dom, 25/10?");
  });
});

describe("B6: a negated predicate about a move's current day is a locator constraint, never a selector", () => {
  const move = (message: string, name: string | undefined, source: [string, DayComponent], dest: [string, DayComponent], time: [string, ClockComponent]) =>
    ground(message, "appointment.change", [c("source_date", ...source), c("date", ...dest), c("time", ...time)], { raw: name ? { customer_name: name } : {} });
  it.each([
    ["Tchê, a Lurdes não pode no dia 06/10. Remarque ela pro dia 02/10 às 20:00.", "Lurdes", ["no dia 06/10", dom(6, 10)], ["dia 02/10", dom(2, 10)], ["às 20:00", clock(20)], ["2026-10-06"], "2026-10-02"],
    ["O Hiroshi não vem mais na sexta. Remarca ele pra segunda às 9h", "Hiroshi", ["na sexta", day({ kind: "WEEKDAY", weekday: 5 })], ["segunda", day({ kind: "WEEKDAY", weekday: 1 })], ["às 9h", clock(9)], ["2026-10-02"], "2026-10-05"],
    ["Ela não tem como ir no dia 06/10. Remarca pro dia 02/10 às 20h", undefined, ["no dia 06/10", dom(6, 10)], ["dia 02/10", dom(2, 10)], ["às 20h", clock(20)], ["2026-10-06"], "2026-10-02"],
  ] as const)("%s", (message, name, source, dest, time, dates, date) => {
    rules(true);
    const run = move(message, name, [...source], [...dest], [...time]);
    expect(run.rejected).toEqual([]);expect(run.fields.source_date).toBeUndefined();expect(run.fields).toMatchObject({ date });
    expect(run.locator_hints).toEqual([{ field: "source_date", dates, expression: source[0] }]);
    rules(false);
    expect(move(message, name, [...source], [...dest], [...time]).rejected.map(item => item.field)).toContain("source_date");
  });
  // Fixer (migrated from the table above), migrated again by C4 R-A (backup .demo/agenda-core/contract-migration/
  // scheduling-date-rules-v2.test.before-c4-ra-temporal-scope.ts): a day of the month with no month whose reading this month
  // already passed is never a value; the hint names its next occurrence and carries the dropped past day, which the locator
  // checks (an appointment of any status on it: never selected by itself). Flag off: the historical denial.
  it.each([
    ["A Yasmin não consegue vir no dia 14. Passa ela pro dia 20 às 15h", "Yasmin", ["no dia 14", dom(14)], ["dia 20", dom(20)], ["às 15h", clock(15)], "2026-10-20", "2026-10-14", "2026-09-14"],
    ["a Maria Eduarda não vai conseguir no dia 16, joga ela pro dia 23 às 10h", "Maria Eduarda", ["no dia 16", dom(16)], ["dia 23", dom(23)], ["às 10h", clock(10)], "2026-10-23", "2026-10-16", "2026-09-16"],
  ] as const)("a past day this month is a hint carrying its dropped day: %s", (message, name, source, dest, time, date, next, past) => {
    rules(true);
    const run = move(message, name, [...source], [...dest], [...time]);
    expect(run.rejected).toEqual([]);expect(run.fields.source_date).toBeUndefined();expect(run.fields).toMatchObject({ date });
    expect(run.locator_hints).toEqual([{ field: "source_date", dates: [next], expression: source[0], dropped: [past] }]);
    rules(false);
    expect(move(message, name, [...source], [...dest], [...time]).rejected.map(item => item.field)).toContain("source_date");
  });
  it.each([
    ["Não remarca a Lurdes do dia 06/10 pro dia 02/10 às 20h", "Lurdes", "dia 06/10", "dia 02/10", "às 20h"],
    ["A Lurdes não pode no dia 06/10. Não remarque ela pro dia 02/10 às 20h.", "Lurdes", "no dia 06/10", "dia 02/10", "às 20h"],
    ["A Lurdes não é no dia 06/10. Remarque ela pro dia 02/10 às 20h.", "Lurdes", "no dia 06/10", "dia 02/10", "às 20h"],
    ["não no dia 06/10, remarca a Lurdes pro dia 02/10 às 20h", "Lurdes", "no dia 06/10", "dia 02/10", "às 20h"],
    ["Lurdes não remarca do dia 06/10. Coloca ela pro dia 02/10 às 20h", "Lurdes", "dia 06/10", "dia 02/10", "às 20h"],
    ["A Lurdes, não remarca ela do dia 06/10. Coloca pro dia 02/10 às 20h", "Lurdes", "dia 06/10", "dia 02/10", "às 20h"],
    ["Não pode no dia 06/10. Remarca a Lurdes pro dia 02/10 às 20h", "Lurdes", "no dia 06/10", "dia 02/10", "às 20h"],
    ["a Lurdes não pode no dia 06/10 e remarca ela pro dia 02/10 às 20h", "Lurdes", "no dia 06/10", "dia 02/10", "às 20h"],
    // Conservative by construction: "dá" folds to the preposition "da" (closed vocabulary), so it keeps the historical denial.
    ["A Lurdes não dá no dia 06/10. Remarque ela pro dia 02/10 às 20h.", "Lurdes", "no dia 06/10", "dia 02/10", "às 20h"],
  ] as const)("adversarial: '%s' keeps the denial", (message, name, source, dest, time) => {
    rules(true);
    const run = move(message, name, [source, dom(6, 10)], [dest, dom(2, 10)], [time, clock(20)]);
    expect(run.rejected.map(item => item.field)).toContain("source_date");expect(run).not.toHaveProperty("locator_hints");
  });
  it("adversarial: a cancel, a model exclusion and a 'não' inside the reason are unchanged", () => {
    rules(true);
    const cancel = ground("A Lurdes não pode no dia 06/10, cancela ela", "appointment.cancel", [c("date", "no dia 06/10", dom(6, 10))], { raw: { customer_name: "Lurdes" } });
    expect(cancel.rejected.map(item => item.field)).toEqual(["date"]);expect(cancel).not.toHaveProperty("locator_hints");
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", "true");
    const excluded = ground("Tchê, a Lurdes não pode no dia 06/10. Remarque ela pro dia 02/10 às 20:00.", "appointment.change", [c("source_date", "no dia 06/10", dom(6, 10)),
      { field: "source_date", text: "não pode no dia 06/10", excluded: dom(6, 10) }, c("date", "dia 02/10", dom(2, 10)), c("time", "às 20:00", clock(20))], { raw: { customer_name: "Lurdes" } });
    expect(excluded).not.toHaveProperty("locator_hints");expect(excluded.fields.source_date).toBeUndefined();
    const reason = ground("Remarca a Lurdes do dia 06/10 pro dia 02/10 às 20h porque ela não pode", "appointment.change",
      [c("source_date", "dia 06/10", dom(6, 10)), c("date", "dia 02/10", dom(2, 10)), c("time", "às 20h", clock(20))], { raw: { customer_name: "Lurdes" } });
    expect(reason.rejected).toEqual([]);expect(reason.fields).toMatchObject({ source_date: "2026-10-06", date: "2026-10-02", time: "20:00" });expect(reason).not.toHaveProperty("locator_hints");
  });
});

describe("run-day matrix through the grounding: a mutation role never asks past-vs-next", () => {
  it.each(["2026-09-01", "2026-09-15", "2026-09-28", "2026-09-30", "2026-10-31", "2026-12-20", "2027-02-28"])("run day %s", today => {
    rules(true);
    const now = new Date(`${today}T15:00:00Z`);
    for (let d = 1; d <= 31; d++) {
      const run = ground(`cancela o Nando do dia ${d}`, "appointment.cancel", [c("date", `dia ${d}`, dom(d))], { now });
      expect(run.pending_calendar_conflicts, `dia ${d}`).toEqual([]);
      if (run.fields.date) { expect(run.fields.date >= today).toBe(true);expect(run.fields.date <= addCalendarDays(today, 62)).toBe(true); }
    }
  });
});

describe("owner 07/10: a spoken month number and 'outra' with the week written", () => {
  const WEDNESDAY_NIGHT = new Date("2026-10-07T04:40:00Z"); // Wednesday 07/10, 01h40 in São Paulo
  const create = (message: string, evidence: SchedulingTemporalEvidence) => { rules(true); return ground(message, "appointment.create", evidence, { now: WEDNESDAY_NIGHT }); };
  it("'dia 16 do 10' (and 'de 10', 'do mês 10') is 16/10, as '16/10' and '16 de outubro' already were", () => {
    for (const text of ["dia 16 do 10", "dia 16 de 10", "dia 16 do mês 10"]) {
      const run = create(`Marca o Edgar Lopes, sexta-feira, ${text}, às oito e meia, corte e barba.`, [c("date", `sexta-feira, ${text}`, dom(16, 10, null, 5)), c("time", "às oito e meia", clock(8, 30))]);
      expect({ date: run.patch.date, time: run.patch.time, rejected: run.rejected }, text).toEqual({ date: "2026-10-16", time: "08:30", rejected: [] });
    }
  });
  it("adversarial: a month number the quote does not write, a different one, or a number after 'do' that is no month stays refused", () => {
    expect(create("Marca o Edgar dia 16 do 10 às 8h30", [c("date", "dia 16 do 10", dom(16, 11)), c("time", "às 8h30", clock(8, 30))]).patch.date).toBeUndefined();
    expect(create("Marca o Edgar dia 16 às 8h30", [c("date", "dia 16", dom(16, 10)), c("time", "às 8h30", clock(8, 30))]).patch.date).toBeUndefined();
    expect(create("Marca o Edgar dia 16 do 13 às 8h30", [c("date", "dia 16 do 13", dom(16, 10)), c("time", "às 8h30", clock(8, 30))]).patch.date).toBeUndefined();
  });
  it("'na outra sexta, na próxima semana' is next week's Friday; 'na outra sexta' alone is still a question", () => {
    const next = (text: string) => [c("date", text, day({ kind: "WEEKDAY", weekday: 5, week: "NEXT_WEEK" }))];
    expect(create("Na outra sexta, na próxima semana.", next("outra sexta, na próxima semana")).patch.date).toBe("2026-10-16");
    expect(create("Na outra sexta.", next("outra sexta")).patch.date).toBeUndefined();
    expect(create("Na outra sexta.", [c("date", "outra sexta", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }))]).patch.date).toBeUndefined();
  });
});

describe("owner 07/10: 'oito e meia da manhã' mid-sentence, and a month kept apart from the next clause", () => {
  const NOON = new Date("2026-10-07T15:00:00Z");
  const time = (message: string) => { rules(true); vi.stubEnv("SALON_SECRETARY_DAYPART_RULES_V2", "true");
    return ground(message, "appointment.create", [c("time", "oito e meia da manhã", clock(8, 30, "MANHA"))], { now: NOON }); };
  it("an hour with its part of the day and no 'às' is the clock, also right after a month and a comma", () => {
    for (const message of ["Eu quero que você marque um horário para o Edgar Lopes todas as sextas-feiras de outubro, oito e meia da manhã, corte e sobrancelha na pinça.",
      "marca o Edgar, oito e meia da manhã, corte", "marca o Edgar em outubro, oito e meia da manhã"])
      expect({ time: time(message).patch.time, rejected: time(message).rejected }, message).toEqual({ time: "08:30", rejected: [] });
  });
  it("adversarial: a month and its day without a break are still a date ('8 de outubro', 'outubro 8')", () => {
    rules(true);
    for (const [message, text] of [["marca o Edgar dia 8 de outubro às 10h", "dia 8 de outubro"], ["marca o Edgar outubro 8 às 10h", "outubro 8"]])
      expect(ground(message, "appointment.create", [c("date", text, dom(8, 10)), c("time", "às 10h", clock(10))], { now: NOON }).patch.date, message).toBe("2026-10-08");
  });
});
