import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { coherentIntervalReadings, verifyClockComponent, verifyClockInterval, withoutGreetings } from "../scheduling-temporal-reference";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { groundSchedulingTemporal, quoteTemporalFacts } from "../scheduling-temporal-source";
import type { SchedulingFields } from "../scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";
import type { TemporalAmbiguityContext } from "../scheduling-temporal-ambiguity";

/** Candidate 4, track R2 (flag SALON_SECRETARY_DAYPART_RULES_V2, default off), pure rules: a daypart the owner did not write is
 * never evidence (C1), "bom dia / boa tarde / boa noite / boa madrugada" greet and are never a daypart (C1 guard), and the two
 * ends of one single-day interval keep only coherent readings without the 8-11 default counting as proof (C3, amended).
 * Names, services and salons are varied on purpose; no DB, no network, no model. */
afterEach(() => { vi.unstubAllEnvs(); });
const rules = (on: boolean) => vi.stubEnv("SALON_SECRETARY_DAYPART_RULES_V2", on ? "true" : "false");
const clock = (hour: number, minute = 0, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute, daypart });
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent =>
  ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const tomorrow = day({ kind: "RELATIVE_DAY", offset: 1 });
const ok = (time: string) => ({ status: "OK", time }), choice = (a: string, b: string) => ({ status: "DAYPART_CHOICE", candidates: [a, b] });
const mismatch = { status: "REJECTED", code: "TOKEN_MISMATCH" }, invalid = { status: "REJECTED", code: "COMPONENT_INVALID" };
const tz = "America/Sao_Paulo", NOW = new Date("2026-09-29T15:00:00Z"); // Tuesday, 12h in São Paulo
type Entry = SchedulingTemporalEvidence[number];
const c = (field: Entry["field"], text: string, component: DayComponent | ClockComponent): Entry => ({ field, text, component });
function ground(message: string, operation: string, evidence: SchedulingTemporalEvidence, options: { raw?: SchedulingFields; previous?: SchedulingFields; waitingFor?: string; context?: TemporalAmbiguityContext } = {}) {
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  return groundSchedulingTemporalTurn(options.previous ?? {}, options.raw ?? {}, message, tz, NOW, options.waitingFor, operation, evidence, options.context);
}
const live = (pending: TemporalAmbiguityContext["pending_temporal_ambiguities"]): TemporalAmbiguityContext =>
  ({ draft_ref: "draft-luz", draft_revision: 1, expires_at: "2026-09-29T15:30:00.000Z", pending_temporal_ambiguities: pending });

describe("C1: an unwritten daypart is Luna's reading, never evidence", () => {
  it.each([
    ["às 14h", clock(14, 0, "TARDE"), ok("14:00")], ["às 14h", clock(2, 0, "TARDE"), ok("14:00")],
    ["às 14h30", clock(14, 30, "TARDE"), ok("14:30")], ["às 14h30", clock(2, 30, "TARDE"), ok("14:30")],
    ["pras 17", clock(17, 0, "TARDE"), ok("17:00")], ["às 9", clock(9, 0, "MANHA"), ok("09:00")],
    ["às 9", clock(9, 0, "NOITE"), choice("09:00", "21:00")], ["das 2", clock(2, 0, "TARDE"), choice("02:00", "14:00")],
    ["das 2", clock(14, 0, "TARDE"), choice("02:00", "14:00")], ["às 2", clock(2, 0, "MANHA"), choice("02:00", "14:00")],
    ["às 12", clock(12, 0, "TARDE"), ok("12:00")], ["às 19h", clock(19, 0, "TARDE"), ok("19:00")],
    ["às 2 da madrugada", clock(2, 0, "MANHA"), ok("02:00")], ["umas 4", clock(4, 0, "TARDE"), choice("04:00", "16:00")],
    ["às 21h", clock(9, 0, "NOITE"), ok("21:00")], ["às dezesseis", clock(4, 0, "TARDE"), ok("16:00")],
  ] as const)("flag on: %s with %j", (quote, value, verdict) => { rules(true); expect(verifyClockComponent(quote, value)).toEqual(verdict); });
  it.each([
    ["às 14h", clock(2, 0, "TARDE"), mismatch], ["às 14h", clock(14, 0, "TARDE"), mismatch], ["das 2", clock(2, 0, "TARDE"), mismatch],
    ["às 19h", clock(19, 0, "TARDE"), invalid], ["às 2 da madrugada", clock(2, 0, "MANHA"), mismatch], ["às 9", clock(9, 0, "MANHA"), mismatch],
  ] as const)("flag off keeps today's verdict: %s with %j", (quote, value, verdict) => { rules(false); expect(verifyClockComponent(quote, value)).toEqual(verdict); });
  it.each([
    ["às 2 da tarde", clock(2, 0, "MANHA")], ["às 14h", clock(15, 0, "TARDE")], ["às 14h ou 15h", clock(14, 0, "TARDE")], ["às 14h ou 15h", clock(14)],
    ["às 6 da manhã", clock(6, 0, "TARDE")], ["às 10 da noite", clock(10, 0, "MANHA")], ["às 2h", clock(3, 0, "TARDE")], ["às 9", clock(10, 0, "MANHA")],
    ["às 2h30", clock(2, 0, "TARDE")], ["das 14h", clock(16, 0, "TARDE")],
  ] as const)("adversarial, flag on: %s with %j stays rejected", (quote, value) => { rules(true); expect(verifyClockComponent(quote, value).status).toBe("REJECTED"); });
  it("adversarial, flag on: a limit, a meia-noite tagged as night and Luna's tag alone never pick a half-day", () => {
    rules(true);
    expect(verifyClockComponent("depois das 2", clock(2, 0, "TARDE"), { role: "time", operation: "appointment.create" })).toEqual(mismatch);
    expect(verifyClockComponent("meia-noite", clock(0, 0, "NOITE"))).toEqual(invalid);
    expect(verifyClockComponent("às 2", clock(14, 0, "TARDE"))).toEqual(choice("02:00", "14:00"));
    expect(verifyClockComponent("às 1", clock(13, 0, "TARDE"))).toEqual(choice("01:00", "13:00"));
    expect(verifyClockComponent("pelas sete", clock(19, 0, "NOITE"))).toEqual(choice("07:00", "19:00"));
  });
  const corpus = JSON.parse(readFileSync("src/test/fixtures/temporal-component-phrasings.json", "utf8")) as
    { clocks: [string, string, string, ClockComponent, unknown][]; intervals: [string, string, string, ClockComponent, ClockComponent, unknown[]][] };
  it("the licensed corpus has the same verdicts with the flag on and off, and every perturbed hour is still rejected", () => {
    const run = () => [...corpus.clocks.map(row => verifyClockComponent(row[2], row[3])), ...corpus.intervals.map(row => verifyClockInterval(row[2], row[3], row[4]))];
    rules(false); const before = run(); rules(true); const after = run();
    expect(after).toEqual(before);
    for (const [, , text, component, expected] of corpus.clocks) if (expected !== undefined)
      expect(verifyClockComponent(text, { ...component, hour: component.hour === 23 ? 22 : component.hour + 1 }).status).toBe("REJECTED");
  });
  it("mode: a live 02h/14h question answered '… às 14h' with {2, TARDE} fills 14:00; the same answer with the flag off is lost", () => {
    const message = "a Yasmin às 14h", evidence = [c("time", "às 14h", clock(2, 0, "TARDE"))];
    const context = live([{ field: "time", kind: "CLOCK_DAYPART", expression: "pras 2", candidates: ["02:00", "14:00"] }]);
    rules(true);
    const on = ground(message, "appointment.change", evidence, { waitingFor: "time", context, previous: { customer_name: "Yasmin" } });
    expect(on.fields.time).toBe("14:00");expect(on.pending_temporal_ambiguities).toEqual([]);expect(on.rejected).toEqual([]);
    rules(false);
    const off = ground(message, "appointment.change", evidence, { waitingFor: "time", context, previous: { customer_name: "Yasmin" } });
    expect(off.fields.time).toBeUndefined();expect(off.pending_temporal_ambiguities).toEqual([]);
  });
  it("mode: a bare 'das 2' Luna tagged TARDE stays the half-day question (never a generic missing time)", () => {
    rules(true);
    const cancel = ground("cancela o Hiroshi das 2", "appointment.cancel", [c("time", "das 2", clock(2, 0, "TARDE"))]);
    expect(cancel.pending_temporal_ambiguities).toEqual([{ field: "time", kind: "CLOCK_DAYPART", expression: "das 2", candidates: ["02:00", "14:00"] }]);
    rules(false);
    expect(ground("cancela o Hiroshi das 2", "appointment.cancel", [c("time", "das 2", clock(2, 0, "TARDE"))]).pending_temporal_ambiguities).toEqual([]);
  });
});

describe("C1 greeting guard: 'bom dia / boa tarde / boa noite / boa madrugada' are never a daypart", () => {
  const greetings = [["bom dia", undefined], ["boa tarde", "TARDE"], ["boa noite", "NOITE"], ["boa madrugada", "MADRUGADA"]] as const;
  const clocks = [["às 10h", clock(10), "10:00"], ["às 11 horas", clock(11), "11:00"], ["às 16h", clock(16), "16:00"], ["às 9h30", clock(9, 30), "09:30"]] as const;
  const fits = (time: string, part: string | undefined) => { const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    return part === undefined || (part === "TARDE" ? m >= 720 && m < 1140 : part === "NOITE" ? m >= 1080 || m < 60 : part === "MADRUGADA" ? m < 360 : m < 720); };
  const positions = [["start", (g: string, k: string) => `${g}, amanhã ${k}`], ["end", (g: string, k: string) => `amanhã ${k}, ${g}`],
    ["adjacent", (g: string, k: string) => `${g} amanhã ${k}`], ["separated", (g: string, k: string) => `${g}! a Lia pode amanhã ${k}`]] as const;
  const table = greetings.flatMap(([g, part]) => clocks.flatMap(([k, value, time]) => positions.map(([where, build]) => [g, where, build(g, k), value, time, part] as const)));
  it.each(table)("%s at the %s: '%s'", (_g, where, quote, value, time, part) => {
    rules(true); expect(verifyClockComponent(quote, value)).toEqual(ok(time));
    // Flag off: the greeting noun inside the quote is a daypart fact (today's behavior, kept byte for byte).
    rules(false); expect(verifyClockComponent(quote, value)).toEqual(fits(time, part) || where === "separated" && part === undefined ? ok(time) : mismatch);
  });
  it("through the scanner: a greeting next to the date never proves or contradicts the clock", () => {
    const message = "Boa noite amanhã às 10 a Kevin pode vir pra barba";
    rules(true);
    const plain = ground(message, "appointment.create", [c("date", "amanhã", tomorrow), c("time", "às 10", clock(10))]);
    expect(plain.fields).toMatchObject({ date: "2026-09-30", time: "10:00" });
    // Luna copying the greeting as a daypart never makes it 22h: the half-day is asked.
    const tagged = ground(message, "appointment.create", [c("date", "amanhã", tomorrow), c("time", "às 10", clock(10, 0, "NOITE"))]);
    expect(tagged.fields.time).toBeUndefined();expect(tagged.pending_temporal_ambiguities).toEqual([{ field: "time", kind: "CLOCK_DAYPART", expression: "às 10", candidates: ["10:00", "22:00"] }]);
    rules(false);
    expect(ground(message, "appointment.create", [c("date", "amanhã", tomorrow), c("time", "às 10", clock(10))]).rejected.map(item => item.field)).toContain("time");
    expect(ground(message, "appointment.create", [c("date", "amanhã", tomorrow), c("time", "às 10", clock(10, 0, "NOITE"))]).fields.time).toBe("22:00");
  });
  it("adversarial: 'boa tarde, amanhã às 3' asks 03h/15h and never picks 15h", () => {
    rules(true);
    for (const value of [clock(3), clock(15, 0, "TARDE"), clock(3, 0, "TARDE")]) {
      const result = ground("boa tarde, amanhã às 3 a Duda faz as unhas", "appointment.create", [c("date", "amanhã", tomorrow), c("time", "às 3", value)]);
      expect(result.fields.time).toBeUndefined();expect(result.pending_temporal_ambiguities).toEqual([{ field: "time", kind: "CLOCK_DAYPART", expression: "às 3", candidates: ["03:00", "15:00"] }]);
    }
  });
  it("adversarial: a real daypart next to the clock is kept; a greeting between them never becomes a value", () => {
    rules(true);
    expect(verifyClockComponent("boa noite, hoje à noite às 9", clock(9, 0, "NOITE"))).toEqual(ok("21:00"));
    expect(verifyClockComponent("hoje à noite às 9, boa noite", clock(9, 0, "NOITE"))).toEqual(ok("21:00"));
    expect(verifyClockComponent("às 3 da tarde, boa tarde", clock(3, 0, "TARDE"))).toEqual(ok("15:00"));
    expect(verifyClockComponent("às 3 da tarde, boa tarde", clock(3, 0, "MANHA"))).toEqual(mismatch);
    // "à noite" separated from the clock by the greeting: never 09h; asked (never the unsaid half).
    const separated = ground("hoje à noite, boa noite, às 9 a Téo", "appointment.create", [c("date", "hoje à noite", day({ kind: "RELATIVE_DAY", offset: 0 })), c("time", "às 9", clock(9, 0, "NOITE"))]);
    expect(separated.fields.time).not.toBe("09:00");
  });
  it("adversarial: 'bom dia' with a numeral keeps its date reading; the guard needs the adjective right before the noun", () => {
    rules(true);
    const dated = ground("tá bom dia 5 às 16h pra Maria Eduarda", "appointment.create", [c("date", "dia 5", day({ kind: "DAY_OF_MONTH", day: 5 })), c("time", "às 16h", clock(16))]);
    expect(dated.fields).toMatchObject({ date: "2026-10-05", time: "16:00" });
    expect(verifyClockComponent("boa, à tarde às 3", clock(3, 0, "TARDE"))).toEqual(ok("15:00"));
    expect(verifyClockComponent("bom de tarde às 3", clock(3, 0, "TARDE"))).toEqual(ok("15:00"));
    expect(verifyClockComponent("bom tarde às 3", clock(3, 0, "TARDE"))).toEqual(ok("15:00"));
  });
  it("legacy whole-text checks: a greeting is not a period of the owner's quote and never answers a half-day question", () => {
    rules(true); expect(quoteTemporalFacts("a primeira, boa tarde", tz, NOW).period).toBeUndefined();
    expect(withoutGreetings("boa noite, e da tarde")).toBe("boa      , e da tarde");
    rules(false); expect(quoteTemporalFacts("a primeira, boa tarde", tz, NOW).period).toBe("afternoon");
    expect(withoutGreetings("boa noite, e da tarde")).toBe("boa noite, e da tarde");
    const context = live([{ field: "time", kind: "CLOCK_DAYPART", expression: "pras 2", candidates: ["02:00", "14:00"] }]);
    const answer = (on: boolean) => { rules(on); return groundSchedulingTemporal({ customer_name: "Nando" }, { time: "14:00" }, "boa noite, é da tarde", tz, NOW, "time", "appointment.create", [{ field: "time", text: "da tarde" }], context); };
    expect(answer(true).fields.time).toBe("14:00");
    expect(answer(false).fields.time).toBeUndefined();
  });
});

describe("C3: the two ends of one single-day interval (amended: the 8-11 default is never proof)", () => {
  const block = (message: string, evidence: SchedulingTemporalEvidence, previous?: SchedulingFields) => ground(message, "schedule.block", evidence, { previous });
  const pending = (field: "time" | "end_time", expression: string, a: string, b: string) => ({ field, kind: "CLOCK_DAYPART", expression, candidates: [a, b] });
  it("the excerpt '11 horas. Até as duas' is 11:00-14:00, quoted once or split, with a code; flag off keeps asking the end", () => {
    const message = "Feche o meu horário amanhã, 11 horas. Até as duas.";
    for (const [start, end] of [["11 horas. Até as duas", "11 horas. Até as duas"], ["11 horas", "Até as duas"]]) {
      const evidence = [c("date", "amanhã", tomorrow), c("time", start, clock(11)), c("end_time", end, clock(2))];
      rules(true);
      const on = block(message, evidence);
      expect(on.fields).toMatchObject({ date: "2026-09-30", time: "11:00", end_time: "14:00" });expect(on.pending_temporal_ambiguities).toEqual([]);
      expect(on.daypart_resolutions).toEqual([{ field: "end_time", code: "DAYPART_RESOLVED_BY_INTERVAL", candidates: ["02:00", "14:00"], value: "14:00", expression: end }]);
      rules(false);
      const off = block(message, evidence);
      expect(off.fields.end_time).toBeUndefined();expect(off.pending_temporal_ambiguities).toEqual([pending("end_time", end, "02:00", "14:00")]);expect(off).not.toHaveProperty("daypart_resolutions");
    }
  });
  it.each([
    ["Fecha a agenda da Jade das 10 às 2 amanhã", "das 10 às 2", clock(10), clock(2), { time: "10:00", end_time: "14:00" }],
    ["Bloqueia o Nando amanhã das 10 às 6", "das 10 às 6", clock(10), clock(6), { time: "10:00", end_time: "18:00" }],
    ["Fecha a agenda do Hiroshi amanhã de 2 a 5 da tarde", "de 2 a 5 da tarde", clock(2, 0, "TARDE"), clock(5, 0, "TARDE"), { time: "14:00", end_time: "17:00" }],
    ["Fecha a agenda da Lia amanhã das 2 às 6 da manhã", "das 2 às 6 da manhã", clock(2), clock(6, 0, "MANHA"), { time: "02:00", end_time: "06:00" }],
  ] as const)("%s", (message, literal, start, end, fields) => {
    rules(true);
    const result = block(message, [c("date", "amanhã", tomorrow), c("time", literal, start), c("end_time", literal, end)]);
    expect(result.fields).toMatchObject(fields);expect(result.pending_temporal_ambiguities).toEqual([]);
  });
  it("'das 2 às 6' keeps both questions (three coherent pairs are left for the tenant's hours)", () => {
    rules(true);
    const result = block("Fecha a agenda da Jade amanhã das 2 às 6", [c("date", "amanhã", tomorrow), c("time", "das 2 às 6", clock(2)), c("end_time", "das 2 às 6", clock(6))]);
    expect(result.fields.time).toBeUndefined();expect(result.fields.end_time).toBeUndefined();
    expect(result.pending_temporal_ambiguities).toEqual([pending("time", "das 2 às 6", "02:00", "14:00"), pending("end_time", "das 2 às 6", "06:00", "18:00")]);
  });
  it("adversarial (amendment): 'das 7 às 9' asks both ends; today it silently took 07h-09h", () => {
    const evidence = [c("date", "amanhã", tomorrow), c("time", "das 7 às 9", clock(7)), c("end_time", "das 7 às 9", clock(9))];
    rules(true);
    const on = block("Bloqueia a Yasmin amanhã das 7 às 9", evidence);
    expect(on.fields.time).toBeUndefined();expect(on.fields.end_time).toBeUndefined();
    expect(on.pending_temporal_ambiguities).toEqual([pending("time", "das 7 às 9", "07:00", "19:00"), pending("end_time", "das 7 às 9", "09:00", "21:00")]);
    rules(false);
    const off = block("Bloqueia a Yasmin amanhã das 7 às 9", evidence);
    expect(off.fields.end_time).toBe("09:00");expect(off.pending_temporal_ambiguities).toEqual([pending("time", "das 7 às 9", "07:00", "19:00")]);
  });
  it("adversarial: 'das 22 às 2' never picks 14h; 'das 11 até as 10' and a multi-day block are untouched", () => {
    rules(true);
    const late = block("Fecha a agenda do Kevin amanhã das 22 às 2", [c("date", "amanhã", tomorrow), c("time", "das 22 às 2", clock(22)), c("end_time", "das 22 às 2", clock(2))]);
    expect(late.fields.time).toBe("22:00");expect(late.fields.end_time).toBeUndefined();expect(late.pending_temporal_ambiguities).toEqual([pending("end_time", "das 22 às 2", "02:00", "14:00")]);
    const backwards = (on: boolean) => { rules(on); const { daypart_resolutions: _r, ...rest } = block("Fecha a agenda da Bia amanhã das 11 até as 10",
      [c("date", "amanhã", tomorrow), c("time", "das 11 até as 10", clock(11)), c("end_time", "das 11 até as 10", clock(10))]) as ReturnType<typeof block>; void _r; return rest; };
    expect(backwards(true)).toEqual(backwards(false));
    rules(true);
    const multi = block("Fecha a agenda da Duda de sexta às 18h até segunda às 2", [c("date", "sexta", day({ kind: "WEEKDAY", weekday: 5, week: "NEAREST" })), c("time", "às 18h", clock(18)),
      c("end_date", "segunda", day({ kind: "WEEKDAY", weekday: 1, week: "NEAREST" })), c("end_time", "às 2", clock(2))]);
    expect(multi.fields.end_time).toBeUndefined();expect(multi.pending_temporal_ambiguities).toEqual([pending("end_time", "às 2", "02:00", "14:00")]);
    expect(multi).not.toHaveProperty("daypart_resolutions");
  });
  it("adversarial: a move's origin and destination are never an interval; a negated end stays negated", () => {
    rules(true);
    const move = ground("passa a Lia das 2 pras 4", "appointment.change", [c("source_time", "das 2", clock(2)), c("time", "pras 4", clock(4))], { raw: { customer_name: "Lia" } });
    expect(move.pending_temporal_ambiguities.map(item => item.field)).toEqual(["source_time", "time"]);
    const negated = block("Fecha a agenda do Téo amanhã das 11, não até as 2", [c("date", "amanhã", tomorrow), c("time", "das 11", clock(11)), c("end_time", "até as 2", clock(2))]);
    expect(negated.fields.end_time).toBeUndefined();expect(negated.pending_temporal_ambiguities.some(item => item.field === "end_time")).toBe(false);
  });
  it("the pure pairs never cross midnight", () => {
    expect(coherentIntervalReadings(["11:00", "23:00"], ["02:00", "14:00"])).toEqual([["11:00", "14:00"]]);
    expect(coherentIntervalReadings(["22:00"], ["00:00", "02:00", "14:00"])).toEqual([]);
    expect(coherentIntervalReadings(["02:00", "14:00"], ["06:00", "18:00"])).toEqual([["02:00", "06:00"], ["02:00", "18:00"], ["14:00", "18:00"]]);
  });
});
