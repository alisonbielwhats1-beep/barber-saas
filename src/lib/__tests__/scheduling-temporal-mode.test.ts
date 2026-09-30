import { afterEach, describe, expect, it, vi } from "vitest";
import { groundSchedulingTemporalTurn, withTemporalShadowObserver, type TemporalShadowEntry } from "../scheduling-temporal-mode";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import { calendarConflictQuestion } from "../scheduling-calendar-conflict";
import { RouterTrace } from "../secretary-router";
import type { SchedulingFields } from "../scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** C1 grounding: components verified by span + clause negation + token consistency; the legacy
 * grammar decides alone with the flag off and becomes a codes-only shadow for component roles. */
afterEach(() => { vi.unstubAllEnvs(); });
const flag = (on: boolean) => vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", on ? "true" : "false");
const tz = "America/Sao_Paulo", SUNDAY = new Date("2026-09-27T15:00:00Z"), MONDAY = new Date("2026-09-28T15:00:00Z");
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent =>
  ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const clock = (hour: number, minute = 0, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute, daypart });
type Entry = SchedulingTemporalEvidence[number];
const c = (field: Entry["field"], text: string, component: DayComponent | ClockComponent): Entry => ({ field, text, component });
function ground(message: string, operation: string, evidence: SchedulingTemporalEvidence, options: { raw?: SchedulingFields; previous?: SchedulingFields; now?: Date; waitingFor?: string;
  context?: Parameters<typeof groundSchedulingTemporalTurn>[8] } = {}) {
  const shadow: TemporalShadowEntry[] = [];
  const result = withTemporalShadowObserver(entries => shadow.push(...entries), () => groundSchedulingTemporalTurn(options.previous ?? {}, options.raw ?? {}, message, tz,
    options.now ?? MONDAY, options.waitingFor, operation, evidence, options.context));
  return { ...result, shadow };
}

describe("flag off: exactly the historical grounding", () => {
  it.each([
    ["Passa a Amanda para amanhã às 11h", "appointment.change", { day_offset: 1, time: "11:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 11h" }]],
    ["Fecha a agenda do Rodrigo das 10 às 11 do dia 29", "schedule.block", { date: "2026-09-29", time: "10:00", end_time: "11:00" }, [{ field: "date", text: "dia 29" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]],
    ["Não marca a Amanda amanhã às 10h", "appointment.create", { day_offset: 1, time: "10:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]],
  ] as const)("without components the wrapper IS the historical function (%s)", (message, operation, raw, evidence) => {
    for (const on of [false, true]) {
      flag(on);
      expect(groundSchedulingTemporalTurn({}, raw as SchedulingFields, message, tz, MONDAY, undefined, operation, [...evidence]))
        .toEqual(groundSchedulingTemporal({}, raw as SchedulingFields, message, tz, MONDAY, undefined, operation, [...evidence]));
    }
  });
  it("phase 3a review: 'dia N' proves only this month's day or its next occurrence, never a month/year copied from elsewhere", () => {
    for (const on of [false, true]) {
      flag(on);
      const run = (date: string) => groundSchedulingTemporal({}, { date, time: "10:00" }, "marca a Ana dia 16 as 10", tz, MONDAY, undefined, "appointment.create", [{ field: "date", text: "dia 16" }, { field: "time", text: "as 10" }]);
      expect(run("2026-10-16").fields.date).toBe("2026-10-16");expect(run("2026-09-16").fields.date).toBe("2026-09-16");
      for (const far of ["2027-04-16", "2026-11-16", "2027-10-16"]) expect(run(far).rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "date", value: far }]);
      const worded = groundSchedulingTemporal({}, { date: "2027-04-28" }, "troca a ana pra dia 28 as 9 e meia", tz, MONDAY, undefined, "appointment.change", [{ field: "date", text: "dia 28" }]);
      expect(worded.fields.date).toBeUndefined();
    }
  });
  it("a component-only quote proves nothing with the flag off; the shadow still reports codes", () => {
    flag(false);
    const run = ground("passa o fabio pra amanha 10hs", "appointment.change", [c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })), c("time", "10hs", clock(10))], { previous: { appointment_ref: "a-fabio" } });
    // Exactly the historical result without any temporal selector (the grammar still sees 'amanha' in the message).
    expect(run.fields.date).toBeUndefined();expect(run.fields.time).toBeUndefined();
    const { shadow: _shadow, ...effective } = run; void _shadow;
    expect(effective).toEqual(groundSchedulingTemporal({ appointment_ref: "a-fabio" }, {}, "passa o fabio pra amanha 10hs", tz, MONDAY, undefined, "appointment.change", []));
    expect(run.shadow).toEqual([{ field: "date", legacy: "OK", components: "OK", equal: true }, { field: "time", legacy: "REJECTED", components: "OK", equal: false }]);
  });
});

describe("flag on: components decide their roles", () => {
  it("N02 'passa o fabio pra amanha 10hs': the date is computed, '10hs' is read by token consistency", () => {
    flag(true);
    const run = ground("passa o fabio pra amanha 10hs", "appointment.change", [c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })), c("time", "10hs", clock(10))], { previous: { appointment_ref: "a-fabio" } });
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-09-29", time: "10:00", appointment_ref: "a-fabio" });
    expect(run.patch).toMatchObject({ date: "2026-09-29", time: "10:00" });
    // Shadow: the historical grammar cannot read '10hs' (codes only, no text/values).
    expect(run.shadow).toEqual([{ field: "date", legacy: "OK", components: "OK", equal: true }, { field: "time", legacy: "REJECTED", components: "OK", equal: false }]);
    expect(JSON.stringify(run.shadow)).not.toMatch(/fabio|10hs|2026|10:00/);
  });
  it.each(["10hrs", "10h30min", "14h-16h"])("'%s' is covered by the token check", quote => {
    flag(true);
    const message = `passa o fabio pra amanha ${quote}`;
    const evidence = quote === "14h-16h" ? [c("time", quote, clock(14)), c("end_time", quote, clock(16))] : [c("time", quote, clock(10, quote === "10h30min" ? 30 : 0))];
    const run = ground(message, quote === "14h-16h" ? "schedule.block" : "appointment.change", [c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })), ...evidence]);
    expect(run.rejected).toEqual([]);
    expect(run.fields).toMatchObject(quote === "14h-16h" ? { time: "14:00", end_time: "16:00" } : { time: quote === "10h30min" ? "10:30" : "10:00" });
  });
  it("V02 'das 10 as 11 do dia 29': time and end_time quoting the same interval bind start and end", () => {
    flag(true);
    const message = "feche a agenda do profissional rodrigo das 10 as 11 do dia 29";
    const run = ground(message, "schedule.block", [c("date", "do dia 29", day({ kind: "DAY_OF_MONTH", day: 29 })), c("time", "das 10 as 11", clock(10)), c("end_time", "das 10 as 11", clock(11))]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-09-29", time: "10:00", end_time: "11:00" });
    expect(run.fields.end_date).toBeUndefined();
    const swapped = ground(message, "schedule.block", [c("date", "do dia 29", day({ kind: "DAY_OF_MONTH", day: 29 })), c("time", "das 10 as 11", clock(11)), c("end_time", "das 10 as 11", clock(10))]);
    expect(swapped.rejected.map(item => item.field).sort()).toEqual(["end_time", "time"]);
  });
  it("V02 with the recorded legacy pairs: bound by position only with the flag on (flag off keeps the historical question)", () => {
    const message = "feche a agenda do profissional rodrigo das 10 as 11 do dia 29";
    const raw = { date: "2026-09-29", time: "10:00", end_time: "11:00" }, evidence = [{ field: "date" as const, text: "dia 29" }, { field: "time" as const, text: "das 10 as 11" }, { field: "end_time" as const, text: "das 10 as 11" }];
    flag(false);
    expect(groundSchedulingTemporalTurn({}, raw, message, tz, MONDAY, undefined, "schedule.block", evidence).rejected.map(item => item.field).sort()).toEqual(["end_time", "time"]);
    flag(true);
    const bound = groundSchedulingTemporalTurn({}, raw, message, tz, MONDAY, undefined, "schedule.block", evidence);
    expect(bound.rejected).toEqual([]);expect(bound.fields).toMatchObject(raw);
    expect(groundSchedulingTemporalTurn({}, { ...raw, time: "11:00", end_time: "12:00" }, message, tz, MONDAY, undefined, "schedule.block", evidence).rejected.map(item => item.field).sort()).toEqual(["end_time", "time"]);
  });
  it("owner's block in voice style: 'das dez as onze do dia vinte e oito'", () => {
    flag(true);
    const run = ground("fecha a agenda do rodrigo das dez as onze do dia vinte e oito", "schedule.block",
      [c("date", "dia vinte e oito", day({ kind: "DAY_OF_MONTH", day: 28 })), c("time", "das dez as onze", clock(10)), c("end_time", "das dez as onze", clock(11))], { now: SUNDAY });
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-09-28", time: "10:00", end_time: "11:00" });
    expect(run.shadow.find(entry => entry.field === "date")).toEqual({ field: "date", legacy: "REJECTED", components: "OK", equal: false });
  });
  it("'sexta que vem' naming two Fridays asks with both dates; neither becomes a field", () => {
    flag(true);
    const run = ground("marca a julia sexta que vem as 10", "appointment.create", [c("date", "sexta que vem", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" })), c("time", "as 10", clock(10))]);
    expect(run.fields.date).toBeUndefined();expect(run.fields.time).toBe("10:00");
    expect(run.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "date", value: "AMBIGUOUS" }]);
    expect(run.pending_calendar_conflicts).toEqual([{ field: "date", kind: "DATE_CHOICE", expression: "sexta que vem", candidates: ["2026-10-02", "2026-10-09"] }]);
    expect(calendarConflictQuestion(run.pending_calendar_conflicts[0])).toBe("Para a data desejada, “sexta que vem” é sex, 02/10 ou sex, 09/10?");
  });
  it("a past explicit date is a question, never shifted; a weekday beside a wrong date is the calendar question", () => {
    flag(true);
    const past = ground("marca a julia dia 5 de setembro de 2026 as 10", "appointment.create", [c("date", "dia 5 de setembro de 2026", day({ kind: "DAY_OF_MONTH", day: 5, month: 9, year: 2026 })), c("time", "as 10", clock(10))], { previous: { date: "2026-10-01" } });
    expect(past.rejected).toEqual([{ code: "DATE_IN_PAST", field: "date", value: "MISSING" }]);expect(past.fields.date).toBeUndefined();
    // Phase 3a review: without a year the phrase may name next year's day: this year's or next year's is asked.
    const noYear = ground("marca a julia dia 5 de setembro as 10", "appointment.create", [c("date", "dia 5 de setembro", day({ kind: "DAY_OF_MONTH", day: 5, month: 9 })), c("time", "as 10", clock(10))], { previous: { date: "2026-10-01" } });
    expect(noYear.fields.date).toBeUndefined();
    expect(noYear.pending_calendar_conflicts).toEqual([{ field: "date", kind: "DATE_CHOICE", expression: "dia 5 de setembro", candidates: ["2026-09-05", "2027-09-05"] }]);
    const conflict = ground("marca a julia terça, dia 14 de abril de 2027", "appointment.create", [c("date", "terça, dia 14 de abril de 2027", day({ kind: "DAY_OF_MONTH", day: 14, month: 4, year: 2027 }))]);
    expect(conflict.pending_calendar_conflicts).toEqual([{ field: "date", kind: "WEEKDAY_DATE_CONFLICT", expression: "terça, dia 14 de abril de 2027", calendar_date: "2027-04-14", stated_weekday: 2, actual_weekday: 3 }]);
  });
  it("GF11: 'às duas' without a daypart is the half-day question", () => {
    flag(true);
    const run = ground("Passa a Lara de terça às duas para quarta às quatro", "appointment.change", [
      c("source_date", "terça", day({ kind: "WEEKDAY", weekday: 2 })), c("source_time", "às duas", clock(14)), c("date", "quarta", day({ kind: "WEEKDAY", weekday: 3 })), c("time", "às quatro", clock(16))]);
    expect(run.fields).toMatchObject({ source_date: "2026-09-29", date: "2026-09-30" });
    expect(run.fields.time).toBeUndefined();expect(run.fields.source_time).toBeUndefined();
    expect(run.pending_temporal_ambiguities).toEqual([{ field: "source_time", kind: "CLOCK_DAYPART", expression: "às duas", candidates: ["02:00", "14:00"] },
      { field: "time", kind: "CLOCK_DAYPART", expression: "às quatro", candidates: ["04:00", "16:00"] }]);
  });
  it("a live half-day question is answered by 'da tarde' alone", () => {
    flag(true);
    const context = { draft_ref: "d1", draft_revision: 2, expires_at: "2099-01-01T00:00:00Z", pending_temporal_ambiguities: [{ field: "time" as const, kind: "CLOCK_DAYPART" as const, expression: "às duas", candidates: ["02:00", "14:00"] as [string, string] }] };
    const run = ground("da tarde", "appointment.create", [c("time", "da tarde", clock(2, 0, "TARDE"))], { previous: { date: "2026-09-30" }, waitingFor: "time", context });
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-09-30", time: "14:00" });
    const stale = ground("da tarde", "appointment.create", [c("time", "da tarde", clock(2, 0, "TARDE"))], { previous: { date: "2026-09-30" }, waitingFor: "time", context: { ...context, expires_at: "2000-01-01T00:00:00Z" } });
    expect(stale.fields.time).toBeUndefined();
  });
  it("a live DATE_CHOICE is answered by one published candidate (legacy selector) or by a verified component", () => {
    flag(true);
    const context = { draft_ref: "d1", draft_revision: 2, expires_at: "2099-01-01T00:00:00Z",
      pending_calendar_conflicts: [{ field: "date" as const, kind: "DATE_CHOICE" as const, expression: "sexta que vem", candidates: ["2026-10-02", "2026-10-09"] as [string, string] }] };
    const chosen = groundSchedulingTemporalTurn({ time: "10:00" }, { date: "2026-10-09" }, "a da semana que vem", tz, MONDAY, "date", "appointment.create",
      [{ field: "date", text: "a da semana que vem" }], context);
    expect(chosen.rejected).toEqual([]);expect(chosen.fields).toMatchObject({ date: "2026-10-09", time: "10:00" });
    const other = groundSchedulingTemporalTurn({ time: "10:00" }, { date: "2026-10-16" }, "a da semana que vem", tz, MONDAY, "date", "appointment.create",
      [{ field: "date", text: "a da semana que vem" }], context);
    expect(other.fields.date).toBeUndefined();
    const component = ground("dia 9", "appointment.create", [c("date", "dia 9", day({ kind: "DAY_OF_MONTH", day: 9 }))], { previous: { time: "10:00" }, waitingFor: "date", context });
    expect(component.rejected).toEqual([]);expect(component.fields.date).toBe("2026-10-09");
  });
  it("GF14: a new day without a time proves only the day (the time is asked later)", () => {
    flag(true);
    const run = ground("Quero mudar a reserva da Célia de quarta às 15h para sexta.", "appointment.change", [
      c("source_date", "quarta", day({ kind: "WEEKDAY", weekday: 3 })), c("source_time", "às 15h", clock(15)), c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 }))]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ source_date: "2026-09-30", source_time: "15:00", date: "2026-10-02" });
    expect(run.fields.time).toBeUndefined();
  });
});

describe("shadow telemetry boundary", () => {
  it("the router trace keeps only closed role names and stable codes, and the observer never fails the turn", () => {
    const trace = new RouterTrace();
    trace.shadow([{ field: "time", legacy: "REJECTED", components: "OK", equal: false }, { field: "customer_name", legacy: "OK", components: "OK", equal: true },
      { field: "date", legacy: "amanhã", components: "OK", equal: true }, { field: "end_time", legacy: "OK", components: "OK", equal: "yes" as unknown as boolean }]);
    expect(trace.temporalShadow).toEqual([{ field: "time", legacy: "REJECTED", components: "OK", equal: false }, { field: "end_time", legacy: "OK", components: "OK", equal: false }]);
    flag(true);
    const result = withTemporalShadowObserver(() => { throw Error("SINK_DOWN"); }, () => groundSchedulingTemporalTurn({}, {}, "amanha", tz, MONDAY, undefined, "appointment.list",
      [c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 }))]));
    expect(result.fields.date).toBe("2026-09-29");
  });
});

describe("flag on: safety invariants", () => {
  it.each([
    ["Não marca a Amanda amanhã às 10h", [c("date", "amanhã", day({ kind: "RELATIVE_DAY", offset: 1 })), c("time", "às 10h", clock(10))], ["date", "time"]],
    ["Passa a Amanda para 11h, não 10h", [c("time", "não 10h", clock(10))], ["time"]],
    ["nunca marque a amanda pra amanha", [c("date", "pra amanha", day({ kind: "RELATIVE_DAY", offset: 1 }))], ["date"]],
  ] as const)("a negated value is never accepted: %s", (message, evidence, fields) => {
    flag(true);
    const run = ground(message, message.startsWith("Passa") ? "appointment.change" : "appointment.create", [...evidence], { previous: { appointment_ref: "a1" } });
    expect(run.rejected.map(item => item.field).sort()).toEqual([...fields]);
    for (const field of fields) expect(run.fields[field]).toBeUndefined();
    expect(run.fields.appointment_ref).toBeUndefined();
    expect(run.shadow.every(entry => entry.components === "NEGATED")).toBe(true);
  });
  it("the positive clause of a corrected value stays accepted ('para 11h, não 10h')", () => {
    flag(true);
    expect(ground("Passa a Amanda para 11h, não 10h", "appointment.change", [c("time", "para 11h", clock(11))]).fields.time).toBe("11:00");
  });
  it("an absent, repeated or perturbed quote rejects only its own role", () => {
    flag(true);
    const absent = ground("marca a julia amanha as 10", "appointment.create", [c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 })), c("time", "as 10", clock(10))]);
    expect(absent.rejected.map(item => item.field)).toEqual(["date"]);expect(absent.fields.time).toBe("10:00");
    const repeated = ground("marca a julia as 10 e a bia tambem as 10", "appointment.create", [c("time", "as 10", clock(10))]);
    expect(repeated.rejected.map(item => item.field)).toEqual(["time"]);
    expect(ground("marca a julia amanha as 10", "appointment.create", [c("time", "as 10", clock(11))]).rejected.map(item => item.field)).toEqual(["time"]);
  });
  it("a legacy selector restating the role must agree with the component", () => {
    flag(true);
    const agree = ground("marca a julia amanha as 10", "appointment.create", [{ ...c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })) }], { raw: { day_offset: 1 } });
    expect(agree.fields.date).toBe("2026-09-29");
    const disagree = ground("marca a julia amanha as 10", "appointment.create", [c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 }))], { raw: { date: "2026-09-30" } });
    expect(disagree.fields.date).toBeUndefined();expect(disagree.rejected.map(item => item.field)).toEqual(["date"]);
  });
  it("a short answer keeps its backend role: a whole-message component for another role is rejected, the prior value retained", () => {
    flag(true);
    const run = ground("amanhã", "appointment.change", [c("date", "amanhã", day({ kind: "RELATIVE_DAY", offset: 1 }))], { previous: { date: "2026-10-01", appointment_ref: "a1" }, waitingFor: "time" });
    expect(run.rejected.map(item => item.field).sort()).toEqual(["date", "time"]);
    expect(run.fields.date).toBe("2026-10-01");expect(run.rejected.find(item => item.field === "date")!.retained_value).toBe("2026-10-01");
  });
});

/** Phase 3a review regressions (flag on). Every case below was accepted before the review. */
describe("flag on: role clauses of an explicit relation", () => {
  const fields = (run: ReturnType<typeof ground>) => run.rejected.map(item => item.field).sort();
  it.each(["para", "pra"])("a clock of the original appointment sent as the new time is rejected, so a new day without a time asks (GF14, '%s')", to => {
    flag(true);
    const run = ground(`passa a Ana de amanha as 10 ${to} sexta`, "appointment.change", [c("source_date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })),
      c("time", "as 10", clock(10)), c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 }))]);
    // The historical relation grammar may also ask the original clock it saw unclaimed (source_time).
    expect(fields(run)).toContain("time");expect(fields(run)).not.toContain("date");expect(fields(run)).not.toContain("source_date");
    expect(run.fields).toMatchObject({ source_date: "2026-09-29", date: "2026-10-02" });expect(run.fields.time).toBeUndefined();
    expect(run.shadow.find(entry => entry.field === "time")).toMatchObject({ components: "ROLE_RANGE" });
  });
  it("swapped source/destination clocks are both rejected; the right roles are accepted", () => {
    flag(true);
    const message = "passa a Ana de amanha as 10 para sexta as 15h", dates = [c("source_date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })), c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 }))];
    expect(fields(ground(message, "appointment.change", [...dates, c("source_time", "as 15h", clock(15)), c("time", "as 10", clock(10))]))).toEqual(["source_time", "time"]);
    const right = ground(message, "appointment.change", [...dates, c("source_time", "as 10", clock(10)), c("time", "as 15h", clock(15))]);
    expect(right.rejected).toEqual([]);expect(right.fields).toMatchObject({ source_time: "10:00", time: "15:00" });
  });
  it("a block's end clock sent as its start (and back) is rejected; separate start/end quotes bind", () => {
    flag(true);
    const message = "bloqueia a agenda do Rodrigo amanha das 10 as 12", date = c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 }));
    expect(fields(ground(message, "schedule.block", [date, c("time", "as 12", clock(12)), c("end_time", "das 10", clock(10))]))).toEqual(["end_time", "time"]);
    const right = ground(message, "schedule.block", [date, c("time", "das 10", clock(10)), c("end_time", "as 12", clock(12))]);
    expect(right.rejected).toEqual([]);expect(right.fields).toMatchObject({ date: "2026-09-29", time: "10:00", end_time: "12:00" });
  });
  it("a block from one day until another keeps its start and end days apart", () => {
    flag(true);
    const message = "trava a agenda da fernanda de quinta ate sabado";
    const run = ground(message, "schedule.block", [c("date", "quinta", day({ kind: "WEEKDAY", weekday: 4 })), c("end_date", "sabado", day({ kind: "WEEKDAY", weekday: 6 }))]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-10-01", end_date: "2026-10-03" });
    expect(fields(ground(message, "schedule.block", [c("date", "sabado", day({ kind: "WEEKDAY", weekday: 6 })), c("end_date", "quinta", day({ kind: "WEEKDAY", weekday: 4 }))]))).toEqual(["date", "end_date"]);
  });
});

describe("flag on: a quote is verified with the whole expression around it (clipped literals)", () => {
  const only = (run: ReturnType<typeof ground>) => run.rejected.map(item => item.field).sort();
  it.each([
    ["marca a ana depois de amanha as 10", "date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 }), day({ kind: "RELATIVE_DAY", offset: 2 }), "2026-09-30"],
    ["marca a ana dia 29 de outubro as 10", "date", "dia 29", day({ kind: "DAY_OF_MONTH", day: 29 }), day({ kind: "DAY_OF_MONTH", day: 29, month: 10 }), "2026-10-29"],
    ["marca a ana dia 15 de novembro as 10", "date", "dia 15", day({ kind: "DAY_OF_MONTH", day: 15 }), day({ kind: "DAY_OF_MONTH", day: 15, month: 11 }), "2026-11-15"],
    ["marca a ana dia 20 de outubro de 2027 as 10", "date", "dia 20 de outubro", day({ kind: "DAY_OF_MONTH", day: 20, month: 10 }), day({ kind: "DAY_OF_MONTH", day: 20, month: 10, year: 2027 }), "2027-10-20"],
    ["marca a ana sexta que vem as 10", "date", "sexta", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST" }), undefined, undefined],
    ["marca a ana na proxima sexta as 10", "date", "sexta", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST" }), undefined, undefined],
    ["marca a ana sexta da semana que vem as 10", "date", "sexta", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST" }), day({ kind: "WEEKDAY", weekday: 5, week: "NEXT_WEEK" }), "2026-10-09"],
    ["marca a ana amanha as 10 e meia", "time", "as 10", clock(10), clock(10, 30), "10:30"],
    ["marca a ana amanha as 10 e 15", "time", "as 10", clock(10), clock(10, 15), "10:15"],
    ["marca a ana amanha as 9 da noite", "time", "as 9", clock(9), clock(9, 0, "NOITE"), "21:00"],
    ["marca a ana amanha as 10 da noite", "time", "as 10", clock(10), clock(10, 0, "NOITE"), "22:00"],
    ["marca a ana amanha as 10:45", "time", "as 10", clock(10), clock(10, 45), "10:45"],
  ] as const)("%s: the clipped quote is asked; the whole expression is accepted", (message, role, literal, clipped, whole, value) => {
    flag(true);
    const other = role === "time" ? c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })) : c("time", "as 10", clock(10));
    const run = ground(message, "appointment.create", [other, c(role, literal, clipped)]);
    expect(only(run)).toEqual([role]);expect(run.fields[role]).toBeUndefined();expect(run.fields[other.field]).toBeDefined();
    if (!whole) return;
    const ok = ground(message, "appointment.create", [other, c(role, literal, whole)]);
    expect(ok.rejected).toEqual([]);expect(ok.fields[role]).toBe(value);
  });
  it("a weekday written beside a day number that falls on another weekday is the calendar question", () => {
    flag(true);
    const run = ground("marca a ana terca dia 14 as 10", "appointment.create", [c("date", "dia 14", day({ kind: "DAY_OF_MONTH", day: 14 })), c("time", "as 10", clock(10))]);
    expect(run.fields.date).toBeUndefined();
    expect(run.pending_calendar_conflicts).toEqual([{ field: "date", kind: "WEEKDAY_DATE_CONFLICT", expression: "dia 14", calendar_date: "2026-10-14", stated_weekday: 2, actual_weekday: 3 }]);
  });
  it.each([
    ["marca a ana amanha antes das 10", "antes das 10"], ["marca a ana amanha depois das 10", "depois das 10"], ["marca a ana amanha depois das 10", "10"],
    ["marca a ana amanha ate as 10", "ate as 10"], ["marca a ana amanha a partir das 14h", "a partir das 14h"], ["marca a ana hoje daqui 10 horas", "10 horas"],
    ["marca a ana amanha em 2 horas", "2 horas"], ["marca a ana amanha entre 10 e 11", "entre 10 e 11"],
  ])("a limit or a duration is not an exact time: %s (quote %s)", (message, literal) => {
    flag(true);
    const hour = /14h/.test(literal) ? 14 : /2 horas/.test(literal) ? 2 : 10, today = /hoje/.test(message);
    const run = ground(message, "appointment.create", [c("date", today ? "hoje" : "amanha", day({ kind: "RELATIVE_DAY", offset: today ? 0 : 1 })), c("time", literal, clock(hour))]);
    expect(only(run)).toEqual(["time"]);
  });
  it("a block starts 'a partir das' and ends 'até as'", () => {
    flag(true);
    const run = ground("bloqueia a agenda do rodrigo amanha a partir das 14h ate as 18h", "schedule.block", [c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })),
      c("time", "a partir das 14h", clock(14)), c("end_time", "ate as 18h", clock(18))]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: "2026-09-29", time: "14:00", end_time: "18:00" });
  });
});

describe("flag on: day numbers, alternatives and unknown qualifiers", () => {
  const only = (run: ReturnType<typeof ground>) => run.rejected.map(item => item.field).sort();
  const time = c("time", "as 10", clock(10));
  it.each([
    ["marca a ana dia 15 de dez as 10", "dia 15 de dez", day({ kind: "DAY_OF_MONTH", day: 15 })],
    ["marca a ana dia 2 ou 3 as 10", "dia 2", day({ kind: "DAY_OF_MONTH", day: 2 })],
    ["marca a ana dia 10 e 11 as 10", "dia 10", day({ kind: "DAY_OF_MONTH", day: 10 })],
    ["marca a ana amanha ou depois as 10", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })],
    ["marca a ana sexta da outra semana as 10", "sexta da outra semana", day({ kind: "WEEKDAY", weekday: 5, week: "NEXT_WEEK" })],
    ["marca a ana na outra sexta as 10", "sexta", day({ kind: "WEEKDAY", weekday: 5 })],
    ["marca a ana sexta retrasada as 10", "sexta", day({ kind: "WEEKDAY", weekday: 5 })],
    ["marca a ana depois amanha as 10", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })],
    ["marca a ana depois d amanha as 10", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })],
  ] as const)("%s: asked, never the value the text does not support", (message, literal, component) => {
    flag(true);
    const run = ground(message, "appointment.create", [c("date", literal, component), time]);
    expect(only(run)).toContain("date");expect(run.fields.date).toBeUndefined();
  });
  it("'15 de dez' names December; 'depois amanhã' typed without 'de' is the day after tomorrow", () => {
    flag(true);
    expect(ground("marca a ana dia 15 de dez as 10", "appointment.create", [c("date", "dia 15 de dez", day({ kind: "DAY_OF_MONTH", day: 15, month: 12 })), time]).fields.date).toBe("2026-12-15");
    expect(ground("marca a ana depois amanha as 10", "appointment.create", [c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 2 })), time]).fields.date).toBe("2026-09-30");
  });
  it("'quem veio sexta passada' never becomes the coming Friday", () => {
    flag(true);
    expect(only(ground("quem veio sexta passada", "appointment.list", [c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 }))]))).toEqual(["date"]);
  });
  it("a day number needs a date anchor; a clock number never proves a day", () => {
    flag(true);
    const both = ground("marca a ana as 10", "appointment.create", [c("date", "as 10", day({ kind: "DAY_OF_MONTH", day: 10 })), time]);
    expect(only(both)).toEqual(["date"]);expect(both.fields.time).toBe("10:00");
    for (const [message, literal, value] of [["marca a ana umas 10", "umas 10", 10], ["marca a ana pra 15", "pra 15", 15], ["marca a ana 15", "15", 15]] as const)
      expect(only(ground(message, "appointment.create", [c("date", literal, day({ kind: "DAY_OF_MONTH", day: value }))]))).toEqual(["date"]);
    // A bare number answers a date question.
    const answer = ground("15", "appointment.create", [c("date", "15", day({ kind: "DAY_OF_MONTH", day: 15 }))], { previous: { time: "10:00" }, waitingFor: "date" });
    expect(answer.rejected).toEqual([]);expect(answer.fields.date).toBe("2026-10-15");
  });
  it("a number beside a day is its clock only when a clock role proves it; one number never proves both", () => {
    flag(true);
    const date = c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 }));
    const proven = ground("passa o fabio pra amanha 10", "appointment.change", [date, c("time", "10", clock(10))]);
    expect(proven.rejected).toEqual([]);expect(proven.fields).toMatchObject({ date: "2026-09-29", time: "10:00" });
    expect(only(ground("passa o fabio pra amanha 30", "appointment.change", [date]))).toEqual(["date"]);
    expect(only(ground("marca a ana sexta 13", "appointment.create", [c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 }))]))).toEqual(["date"]);
    // Friday is the 2nd: "2" is the day beside "sexta" and cannot also be the clock.
    const shared = ground("marca a ana sexta 2", "appointment.create", [c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 })), c("time", "2", clock(2))]);
    expect(only(shared)).toEqual(["date", "time"]);expect(shared.shadow.map(entry => entry.components)).toEqual(["WITNESS_SHARED", "WITNESS_SHARED"]);
  });
});

describe("flag on: days of existing appointments, week and year choices", () => {
  it.each([
    ["cancela a Ana do dia 25", "appointment.cancel"], ["o que teve na agenda dia 25", "appointment.read"], ["o que tem na agenda dia 25", "appointment.list"],
  ] as const)("%s: a day already past this month is this month's or next month's, asked", (message, operation) => {
    flag(true);
    const run = ground(message, operation, [c("date", "dia 25", day({ kind: "DAY_OF_MONTH", day: 25 }))]);
    expect(run.fields.date).toBeUndefined();
    expect(run.pending_calendar_conflicts).toEqual([{ field: "date", kind: "DATE_CHOICE", expression: "dia 25", candidates: ["2026-09-25", "2026-10-25"] }]);
  });
  it("the original day of a move is asked the same way; a new booking rolls forward", () => {
    flag(true);
    const move = ground("passa a Ana do dia 25 para sexta as 10", "appointment.change", [c("source_date", "dia 25", day({ kind: "DAY_OF_MONTH", day: 25 })),
      c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5 })), c("time", "as 10", clock(10))]);
    expect(move.fields).toMatchObject({ date: "2026-10-02", time: "10:00" });expect(move.fields.source_date).toBeUndefined();
    expect(move.pending_calendar_conflicts).toMatchObject([{ field: "source_date", kind: "DATE_CHOICE", candidates: ["2026-09-25", "2026-10-25"] }]);
    expect(ground("marca a Ana dia 25 as 10", "appointment.create", [c("date", "dia 25", day({ kind: "DAY_OF_MONTH", day: 25 })), c("time", "as 10", clock(10))]).fields.date).toBe("2026-10-25");
  });
  it("'essa sexta' on Saturday and 'dia 20 de abril' in September are choices, never 'já passou'", () => {
    flag(true);
    const saturday = ground("marca a ana essa sexta as 10", "appointment.create", [c("date", "essa sexta", day({ kind: "WEEKDAY", weekday: 5, week: "THIS_WEEK" })), c("time", "as 10", clock(10))],
      { now: new Date("2026-10-03T15:00:00Z") });
    expect(saturday.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "date", value: "AMBIGUOUS" }]);
    expect(saturday.pending_calendar_conflicts).toMatchObject([{ kind: "DATE_CHOICE", candidates: ["2026-10-02", "2026-10-09"] }]);
    const april = ground("marca a noiva dia 20 de abril as 10", "appointment.create", [c("date", "dia 20 de abril", day({ kind: "DAY_OF_MONTH", day: 20, month: 4 })), c("time", "as 10", clock(10))]);
    expect(april.rejected.map(item => item.code)).toEqual(["SOURCE_TEMPORAL_CONFLICT"]);
    expect(april.pending_calendar_conflicts).toMatchObject([{ kind: "DATE_CHOICE", candidates: ["2026-04-20", "2027-04-20"] }]);
  });
  it("shadow rows without a historical value report equal: null", () => {
    flag(true);
    const run = ground("marca a julia dia 5 de setembro de 2026 as 10", "appointment.create", [c("date", "dia 5 de setembro de 2026", day({ kind: "DAY_OF_MONTH", day: 5, month: 9, year: 2026 })), c("time", "as 10", clock(10))]);
    expect(run.shadow.find(entry => entry.field === "date")).toEqual({ field: "date", legacy: "NOT_EVALUATED", components: "DATE_IN_PAST", equal: null });
    const trace = new RouterTrace();trace.shadow(run.shadow);
    expect(trace.temporalShadow.find(entry => entry.field === "date")!.equal).toBeNull();
  });
});

describe("flag on: interval dayparts bind to their own clock", () => {
  it("'das 10 da manhã às 2 da tarde' never reads the end as 02:00", () => {
    flag(true);
    const message = "bloqueia o rodrigo amanha das 10 da manha as 2 da tarde", date = c("date", "amanha", day({ kind: "RELATIVE_DAY", offset: 1 })), quote = "das 10 da manha as 2 da tarde";
    const wrong = ground(message, "schedule.block", [date, c("time", quote, clock(10, 0, "MANHA")), c("end_time", quote, clock(2))]);
    expect(wrong.rejected.map(item => item.field).sort()).toEqual(["end_time", "time"]);
    const right = ground(message, "schedule.block", [date, c("time", quote, clock(10, 0, "MANHA")), c("end_time", quote, clock(2, 0, "TARDE"))]);
    expect(right.rejected).toEqual([]);expect(right.fields).toMatchObject({ time: "10:00", end_time: "14:00" });
  });
});
