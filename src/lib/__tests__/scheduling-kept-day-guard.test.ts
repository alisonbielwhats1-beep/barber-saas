import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedOperation } from "@everflair/salon-secretary";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { applyKeptDayGuard, applyScopeCoverage } from "../scheduling-temporal-source";
import { temporalScan } from "../scheduling-temporal-reference";
import { actionScopedSource, foreignClauses } from "../secretary-sibling-scope";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import type { SchedulingFields } from "../scheduling-contract";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4 (flag SALON_SECRETARY_DATE_RULES_V2): a change with no destination day keeps its origin's; a day the owner wrote in the
 * action's own text that no field of it consumed is asked instead (applyKeptDayGuard, the V30 k2 safety failure of 30/09). Pure rules
 * with the components proof the adapter runs; the plan-path replay of V30 is secretary-c4-kept-day-replay.test.ts. Today is Wednesday
 * 30/09/2026 in São Paulo: "amanhã" and "dia 1" cross the month (01/10), "sexta" = 02/10. Synthetic, diverse names. */
const CANDIDATE = ["TEMPORAL_COMPONENTS", "TEMPORAL_POLARITY", "SAME_AS", "STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE",
  "SCHEDULING_OVERLAP_ENABLED", "MULTI_ACTION_V2_ENABLED", "DATE_RULES_V2", "DAYPART_RULES_V2", "DAYPART_BY_HOURS", "ALTER_APPOINTMENT", "MULTI_SERVICE", "EXCEPTION_RULES_V2",
  "COPY_V2", "REFERENCES_V2", "READS_V2", "RECURRENCE_GUARD"];
const flag = (name: string, on: boolean) => vi.stubEnv(`SALON_SECRETARY_${name}`, on ? "true" : "false");
beforeEach(() => { for (const name of CANDIDATE) flag(name, true); });
afterEach(() => { vi.unstubAllEnvs(); });

const tz = "America/Sao_Paulo", now = new Date("2026-09-30T15:00:00Z");
const base = { offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null };
const relative = (offset: number): DayComponent => ({ ...base, kind: "RELATIVE_DAY", offset });
const weekday = (value: number): DayComponent => ({ ...base, kind: "WEEKDAY", weekday: value, week: "NEAREST" });
const dom = (day: number): DayComponent => ({ ...base, kind: "DAY_OF_MONTH", day });
const clock = (hour: number, minute = 0): ClockComponent => ({ hour, minute, daypart: "UNSPECIFIED" });
type Quote = { field: string; text: string; component: DayComponent | ClockComponent };
const date = (text: string, component: DayComponent, field = "date"): Quote => ({ field, text, component });
const at = (text: string, hour: number, minute = 0): Quote => ({ field: "time", text, component: clock(hour, minute) });
type Spans = [number, number][];
type Options = { previous?: SchedulingFields; exempt?: string[]; operation?: string; kept?: string; foreign?: { own: Spans; siblings: Spans } };
/** One change grounded like the adapter (components proof), then the guard on the action's own text. */
function guard(message: string, evidence: Quote[], { previous = {}, exempt = [], operation = "appointment.change", kept, foreign }: Options = {}) {
  const quotes = evidence as never;
  const grounded = groundSchedulingTemporalTurn(previous, {}, message, tz, now, undefined, operation, quotes);
  const codes = applyKeptDayGuard(grounded, message, operation, quotes, exempt, { kept, foreign });
  return { grounded, codes, asked: grounded.rejected.filter(item => item.value === "MISSING").map(item => item.field) };
}

describe("the V30 shape with other names: a day Luna dropped is asked, never replaced by the origin's", () => {
  it("'para amanhã às 10h e meia' with only the clock: the destination day is asked", () => {
    const { grounded, codes, asked } = guard("passa a Iolanda para amanhã às 10h e meia", [at("10h e meia", 10, 30)]);
    expect(asked).toEqual(["date"]);expect(codes).toEqual(["TEMPORAL_KEPT_DAY_UNCLAIMED"]);
    expect(grounded.fields.date).toBeUndefined();expect(grounded.fields.time).toBe("10:30");
  });
  it("the same message with the day sent: nothing changes (Thursday 01/10, across the month)", () => {
    const { grounded, codes, asked } = guard("passa a Iolanda para amanhã às 10h e meia", [date("amanhã", relative(1)), at("10h e meia", 10, 30)]);
    expect(codes).toEqual([]);expect(asked).toEqual([]);expect(grounded.fields).toMatchObject({ date: "2026-10-01", time: "10:30" });
  });
  it.each([
    ["a weekday", "remarca o Caíque pra sexta às 15h", at("às 15h", 15)],
    ["'dia N' across the month", "muda a Vitória pro dia 1 às 9h", at("às 9h", 9)],
    ["a calendar date", "passa a Benedita para 15/10 às 11h", at("às 11h", 11)],
    ["'depois de amanhã'", "joga o Anselmo pra depois de amanhã às 16h", at("às 16h", 16)],
    ["'hj'", "passa a Kênia pra hj as 18h", at("as 18h", 18)],
    ["'semana que vem'", "passa a Odete pra semana que vem às 10h", at("às 10h", 10)],
    ["'daqui a 3 dias'", "passa o Wendel pra daqui a 3 dias às 14h", at("às 14h", 14)],
    ["an abbreviated weekday inside a temporal expression", "passa a Jussara pra sex 10h", at("10h", 10)],
    ["a clock quote that also holds the day (a clock never consumes a day)", "passa a Guiomar para amanhã às 10h e meia", at("amanhã às 10h e meia", 10, 30)],
  ] as const)("%s", (_label, message, quote) => {
    const { codes, asked } = guard(message, [quote]);
    expect(asked).toEqual(["date"]);expect(codes).toEqual(["TEMPORAL_KEPT_DAY_UNCLAIMED"]);
  });
  it.each([
    ["a weekday", "remarca o Caíque pra sexta às 15h", date("sexta", weekday(5)), "2026-10-02"],
    ["'dia N' across the month", "muda a Vitória pro dia 1 às 9h", date("dia 1", dom(1)), "2026-10-01"],
  ] as const)("%s sent by Luna: the day stands, no question", (_label, message, day, value) => {
    const { grounded, codes } = guard(message, [day, at(message.slice(message.lastIndexOf("às")), Number(/às (\d+)h/.exec(message)![1]))]);
    expect(codes).toEqual([]);expect(grounded.fields.date).toBe(value);
  });
});

describe("adversarial: days no question is owed for", () => {
  it("a day consumed as the ORIGIN keeps the origin's day as the destination's (a time-only move)", () => {
    const { grounded, codes } = guard("passa a Heloísa de sexta pras 10h", [date("sexta", weekday(5), "source_date"), at("pras 10h", 10)]);
    expect(codes).toEqual([]);expect(grounded.fields.source_date).toBe("2026-10-02");expect(grounded.fields.date).toBeUndefined();
  });
  it("a clipped origin quote claims its whole expression ('sexta' of 'sexta dia 2')", () => {
    const { codes } = guard("passa a Heloísa da sexta dia 2 pras 10h", [date("sexta", weekday(5), "source_date"), at("pras 10h", 10)]);
    expect(codes).toEqual([]);
  });
  it("an origin day nobody consumed in an explicit move is the ORIGIN's question, not the destination's", () => {
    const { codes, asked } = guard("passa a Heloísa de sexta pras 10h", [at("pras 10h", 10)]);
    expect(asked).toEqual(["source_date"]);expect(codes).toEqual(["TEMPORAL_KEPT_DAY_UNCLAIMED"]);
  });
  it("another action's clause is not this action's text (compound request, verified clauses)", () => {
    const message = "muda o Otto pras 17h e cancela a Lívia de sexta";
    const neutral = { depends_on: [], released_slot_of: null, service_names: null, service_name: null, professional_name: null, date: null, time: null, period: null, source_date: null,
      source_time: null, end_time: null, end_date: null, reason: null, target_professional_name: null, service_changes: null, target_name: null, name: null, priceCents: null,
      durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
    const ops = [{ ...neutral, operation: "appointment.change", item_key: "otto", customer_name: "Otto", source_scope: "muda o Otto pras 17h", temporal_evidence: [at("pras 17h", 17)] },
      { ...neutral, operation: "appointment.cancel", item_key: "livia", customer_name: "Lívia", source_scope: "e cancela a Lívia de sexta", temporal_evidence: [date("sexta", weekday(5))] }] as unknown as SelectedOperation[];
    const { operation, fields, temporal_evidence } = projectSchedulingOperation(ops[0]), source = actionScopedSource(message, ops[0], ops);
    expect(source.scoped).toBe(true);
    const grounded = groundSchedulingTemporalTurn({}, fields, source.text, tz, now, undefined, operation, temporal_evidence);
    expect(applyScopeCoverage(grounded, source.text, tz, now, operation, fields, temporal_evidence)).toEqual([]);
    expect(applyKeptDayGuard(grounded, source.text, operation, temporal_evidence)).toEqual([]);expect(grounded.fields.time).toBe("17:00");
  });
  it("a day inside the action's quoted reason is the reason's; the same words unquoted are asked", () => {
    const message = "passa a Nádia pras 10h porque amanhã ela tem dentista";
    expect(guard(message, [at("pras 10h", 10)], { exempt: ["amanhã ela tem dentista"] }).codes).toEqual([]);
    expect(guard(message, [at("pras 10h", 10)]).asked).toEqual(["date"]);
  });
  it("an explicit keep of the day ('no mesmo dia') states no day; a clock keep never keeps a day the owner said", () => {
    expect(guard("passa a Zuleica pro mesmo dia às 10h", [at("às 10h", 10)], { exempt: ["pro mesmo dia"] }).codes).toEqual([]);
    expect(guard("passa a Zuleica pra amanhã no mesmo horário", [], { exempt: ["no mesmo horário"] }).asked).toEqual(["date"]);
  });
  it.each([
    ["a denied day", "passa a Mirela pras 10h, não amanhã"],
    ["a denied day, negator after", "passa a Mirela pras 10h, amanhã não"],
    ["the verb 'ter' (a weekday abbreviation alone in its expression)", "passa a Mirela pras 10h que ela vai ter que sair cedo"],
    ["a feminine ordinal ('a segunda vez')", "passa a Mirela pras 10h, é a segunda vez que ela pede"],
    ["a past day ('ontem')", "a Mirela faltou ontem, passa ela pras 10h"],
    ["a past weekday ('sexta passada')", "passa a Mirela pras 10h como na sexta passada"],
    ["a count without a duration word", "passa a Mirela pras 10h, ela fica 2 dias fora"],
    ["a greeting", "bom dia! passa a Mirela pras 10h"],
  ] as const)("%s: nothing asked", (_label, message) => {
    expect(guard(message, [at("pras 10h", 10)]).codes).toEqual([]);
  });
  it("a customer named like a weekday is that name (the action's own field consumed it)", () => {
    expect(guard("passa o Plácido Domingo pras 10h", [at("pras 10h", 10)], { exempt: ["Plácido Domingo"] }).codes).toEqual([]);
    expect(guard("passa o Plácido Domingo pras 10h", [at("pras 10h", 10)]).asked).toEqual(["date"]);
  });
  it("a destination day held from an earlier turn is not the origin's: nothing asked", () => {
    expect(guard("amanhã às 10h e meia", [at("10h e meia", 10, 30)], { previous: { date: "2026-10-01" } }).codes).toEqual([]);
  });
  it("a destination day already asked (its quote refused) is not asked twice", () => {
    const { codes, grounded } = guard("passa a Iolanda para amanhã às 10h", [date("sexta", weekday(5)), at("às 10h", 10)]);
    expect(codes).toEqual([]);expect(grounded.rejected.filter(item => item.field === "date")).toHaveLength(1);
  });
  it("only a change keeps an origin day: a create or a cancel is untouched", () => {
    expect(guard("marca a Iolanda para amanhã às 10h", [at("às 10h", 10)], { operation: "appointment.create" }).codes).toEqual([]);
    expect(guard("cancela a Iolanda de amanhã às 10h", [at("às 10h", 10)], { operation: "appointment.cancel" }).codes).toEqual([]);
  });
  it("flag off: nothing asked and the grounding is byte-identical", () => {
    flag("DATE_RULES_V2", false);
    const quotes = [at("10h e meia", 10, 30)] as never, message = "passa a Iolanda para amanhã às 10h e meia";
    const grounded = groundSchedulingTemporalTurn({}, {}, message, tz, now, undefined, "appointment.change", quotes), before = structuredClone(grounded);
    expect(applyKeptDayGuard(grounded, message, "appointment.change", quotes)).toEqual([]);expect(grounded).toEqual(before);
  });
});

describe("temporalScan.days: the proof's day vocabulary over a whole message (ORIGINAL offsets)", () => {
  const days = (message: string) => temporalScan(message)!.days().map(({ token, expression }) => [message.slice(...token), message.slice(...expression)]);
  it("widens each day to its whole expression, accents kept", () => {
    expect(days("Passa a Iolanda para amanhã às 10h e meia.")).toEqual([["amanhã", "amanhã às 10h e meia"]]);
    expect(days("remarca pra sexta, dia 2")).toEqual([["sexta", "sexta, dia 2"], ["2", "sexta, dia 2"]]);
    expect(days("joga pra depois de amanhã")).toEqual([["amanhã", "depois de amanhã"]]);
    expect(days("pra próxima semana")).toEqual([["semana", "próxima semana"]]);
    expect(days("daqui a 2 semanas")).toEqual([["2", "daqui a 2 semanas"]]);
  });
  it.each(["vai ter que sair", "é a segunda vez", "faltou ontem", "na sexta passada", "ficou 2 semanas fora", "bom dia", "às 10h", "semana cheia"])("no day in '%s'", message => {
    expect(days(message)).toEqual([]);
  });
  it("a unit word with a next, other or order qualifier, or under an edge head, is a day no component can carry (review)", () => {
    expect(days("pro dia seguinte às 10h")).toEqual([["dia", "dia seguinte às 10h"]]);
    expect(days("pra outra semana")).toEqual([["semana", "outra semana"]]);
    expect(days("pra outro dia")).toEqual([["dia", "outro dia"]]);
    expect(days("pro dia anterior")).toEqual([["dia", "dia anterior"]]);
    expect(days("pro fim de semana")).toEqual([["semana", "semana"]]);
    expect(days("pro final do mês")).toEqual([["mês", "mês"]]);
    expect(days("no começo do mês que vem")).toEqual([["mês", "mês que vem"]]);
    expect(days("no fim desta semana")).toEqual([["semana", "desta semana"]]);
  });
  it.each(["toda semana", "dias de semana", "o dia todo", "no fim do dia", "no mesmo dia", "na semana passada", "o mês passado", "um dia desses", "3 dias de folga"])("still no day in '%s'", message => {
    expect(days(message)).toEqual([]);
  });
});

describe("review (30/09): a negator elsewhere in the day's clause denies another predicate, never the day", () => {
  it.each([
    ["a negated imperative of reminder", "Não esquece de passar a Ivone pra amanhã, às 10h e meia.", "às 10h e meia"],
    ["a polite negated question", "Você não consegue passar a Ivone pra amanhã? Às 10h e meia.", "Às 10h e meia"],
    ["a negated condition", "Se não tiver problema passa a Ivone pra amanhã, às 10h e meia.", "às 10h e meia"],
    ["a negated predicate about the customer, clock in the next sentence", "A Ivone não pode sexta então passa ela pra amanhã. 10h e meia.", "10h e meia"],
    ["a negated cause before the day", "Como ela não pode na sexta passa a Ivone pra amanhã, às 10h e meia.", "às 10h e meia"],
    ["a trailing negator that opens another predicate", "Passa a Ivone pra amanhã nem que seja cedo, às 10h e meia.", "às 10h e meia"],
  ] as const)("%s: the destination day is asked (never the origin's Friday)", (_label, message, clock) => {
    const { grounded, codes, asked } = guard(message, [at(clock, 10, 30)]);
    expect(asked).toEqual(["date"]);expect(codes).toEqual(["TEMPORAL_KEPT_DAY_UNCLAIMED"]);expect(grounded.fields.date).toBeUndefined();
  });
  it("symmetric with the day sent: its quote in that clause is refused (asked) as before", () => {
    const { grounded } = guard("Não esquece de passar a Ivone pra amanhã, às 10h e meia.", [date("amanhã", relative(1)), at("às 10h e meia", 10, 30)]);
    expect(grounded.rejected.map(item => item.field)).toContain("date");expect(grounded.fields.date).toBeUndefined();
  });
  it.each([
    ["denied through glue", "passa a Mirela pras 10h, não pra amanhã"],
    ["two denied days", "nem amanhã nem sexta: passa a Mirela pras 10h"],
    ["denied after, closing the sentence", "passa a Mirela pras 10h, amanhã não."],
  ] as const)("an attached denial still exempts its day: %s", (_label, message) => {
    expect(guard(message, [at("pras 10h", 10)]).codes).toEqual([]);
  });
});

describe("review (30/09): day expressions no date component can carry are asked when dropped", () => {
  it.each([
    ["dia seguinte", "Passa a Ivone pro dia seguinte às 10h e meia."],
    ["fim de semana", "Passa a Ivone pro fim de semana às 10h e meia."],
    ["outra semana", "Passa a Ivone pra outra semana às 10h e meia."],
    ["fim do mês", "Passa a Ivone pro fim do mês às 10h e meia."],
    ["dia anterior", "Passa a Ivone pro dia anterior às 10h e meia."],
    ["outro dia", "Passa a Ivone pra outro dia às 10h e meia."],
    ["começo do mês", "Passa a Ivone pro começo do mês às 10h e meia."],
  ] as const)("'%s'", (_label, message) => {
    const { codes, asked } = guard(message, [at("às 10h e meia", 10, 30)]);
    expect(asked).toEqual(["date"]);expect(codes).toEqual(["TEMPORAL_KEPT_DAY_UNCLAIMED"]);
  });
  it("an explicit keep of the day and a time of day stay no day ('no mesmo dia', 'no fim do dia')", () => {
    expect(guard("passa a Ivone pro mesmo dia às 10h", [at("às 10h", 10)]).codes).toEqual([]);
    expect(guard("passa a Ivone pro fim do dia, às 18h", [at("às 18h", 18)]).codes).toEqual([]);
  });
});

describe("review (30/09): what consumes a change's day", () => {
  it("an end_date quote (no change has one) consumes nothing: the destination day is asked", () => {
    const { grounded, asked } = guard("passa a Iolanda para amanhã às 10h e meia", [date("amanhã", relative(1), "end_date"), at("10h e meia", 10, 30)]);
    expect(asked).toEqual(["date"]);expect(grounded.fields.date).toBeUndefined();
  });
  it("a refused origin quote proves nothing: the other day its expression holds is still asked", () => {
    const { grounded, asked } = guard("passa a Ivone de sexta amanhã às 10h e meia", [date("sexta", weekday(5), "source_date"), at("10h e meia", 10, 30)]);
    expect(grounded.rejected.map(item => item.field)).toContain("source_date");expect(asked).toEqual(["date"]);
  });
  it("a proven origin quote still consumes its whole expression (unchanged)", () => {
    expect(guard("passa a Heloísa de sexta pras 10h", [date("sexta", weekday(5), "source_date"), at("pras 10h", 10)]).codes).toEqual([]);
  });
});

describe("review (30/09): the origin's day an earlier turn kept is no held day", () => {
  const previous = { date: "2026-10-02", time: "10:00" };
  it("a correction whose day the interpretation dropped is asked, not replaced by the kept Friday", () => {
    const { grounded, asked } = guard("Não, pra amanhã às 10h e meia.", [at("10h e meia", 10, 30)], { previous, kept: "2026-10-02" });
    expect(asked).toEqual(["date"]);expect(grounded.fields.date).toBeUndefined();expect(grounded.fields.time).toBe("10:30");
  });
  it("a day the owner's words proved in an earlier turn stays held (nothing asked)", () => {
    expect(guard("Não, pra amanhã às 10h e meia.", [at("10h e meia", 10, 30)], { previous }).codes).toEqual([]);
  });
  it("the kept day stays when the correction states no day; a day proven now replaces it", () => {
    const clockOnly = guard("Não, pras 11h.", [at("pras 11h", 11)], { previous, kept: "2026-10-02" });
    expect(clockOnly.codes).toEqual([]);expect(clockOnly.grounded.fields).toMatchObject({ date: "2026-10-02", time: "11:00" });
    const proven = guard("Não, pra amanhã às 10h e meia.", [date("amanhã", relative(1)), at("10h e meia", 10, 30)], { previous, kept: "2026-10-02" });
    expect(proven.codes).toEqual([]);expect(proven.grounded.fields.date).toBe("2026-10-01");
  });
});

describe("review (30/09): an unverified clause of a compound request", () => {
  const span = (message: string, text: string): [number, number] => [message.indexOf(text), message.indexOf(text) + text.length];
  it("a day inside another action's clause (and outside this one's) is theirs; any other day is asked", () => {
    const message = "Passa a Ivone pras 10h e meia e cancela a Tereza que vinha amanhã";
    const foreign = { own: [], siblings: [span(message, "e cancela a Tereza que vinha amanhã")] };
    expect(guard(message, [at("pras 10h e meia", 10, 30)], { foreign }).codes).toEqual([]);
    const dropped = "Passa a Ivone pra amanhã às 10h e meia e cancela a Tereza";
    expect(guard(dropped, [at("às 10h e meia", 10, 30)], { foreign: { own: [], siblings: [span(dropped, "e cancela a Tereza")] } }).asked).toEqual(["date"]);
  });
  it("a day inside both clauses (overlapping scopes) is asked", () => {
    const message = "Passa a Ivone pra amanhã às 10h e meia e me mostra a agenda";
    const foreign = { own: [span(message, message)], siblings: [span(message, "pra amanhã às 10h e meia e me mostra a agenda")] };
    expect(guard(message, [at("às 10h e meia", 10, 30)], { foreign }).asked).toEqual(["date"]);
  });
  it("foreignClauses: this action's own clause, and the other actions' clauses and quoted texts (ORIGINAL offsets)", () => {
    const message = "Passa a Ivone pras 10h e meia e cancela a Tereza porque ela viaja amanhã";
    const neutral = { depends_on: [], released_slot_of: null, service_names: null, service_name: null, professional_name: null, date: null, time: null, period: null, source_date: null,
      source_time: null, end_time: null, end_date: null, target_professional_name: null, service_changes: null, requested_fields: [], clear_fields: [] };
    const ops = [{ ...neutral, operation: "appointment.change", item_key: "a", customer_name: "Ivone", reason: null, source_scope: "Passa Ivone pras 10h e meia", temporal_evidence: [at("pras 10h e meia", 10, 30)] },
      { ...neutral, operation: "appointment.cancel", item_key: "b", customer_name: "Tereza", reason: "ela viaja amanhã", source_scope: null, temporal_evidence: [] }] as unknown as SelectedOperation[];
    expect(actionScopedSource(message, ops[0], ops).scoped).toBe(false);
    const clauses = foreignClauses(message, ops[0], ops);
    expect(clauses.own).toEqual([]);expect(clauses.siblings.map(([a, b]) => message.slice(a, b)).sort()).toEqual(["Tereza", "ela viaja amanhã"]);
    expect(guard(message, [at("pras 10h e meia", 10, 30)], { foreign: clauses }).codes).toEqual([]);
  });
  it("foreignClauses: a span of another action holding this action's own quote or name (a greedy boundary) is never theirs", () => {
    const message = "Passa a Ivone pra amanhã às 10h e meia e me mostra a agenda de sexta";
    const neutral = { depends_on: [], released_slot_of: null, service_names: null, service_name: null, professional_name: null, date: null, time: null, period: null, source_date: null,
      source_time: null, end_time: null, end_date: null, target_professional_name: null, service_changes: null, reason: null, requested_fields: [], clear_fields: [] };
    const ops = [{ ...neutral, operation: "appointment.change", item_key: "a", customer_name: "Ivone", source_scope: null, temporal_evidence: [at("às 10h e meia", 10, 30)] },
      { ...neutral, operation: "appointment.list", item_key: "b", customer_name: null, source_scope: message, temporal_evidence: [date("sexta", weekday(5))] }] as unknown as SelectedOperation[];
    const clauses = foreignClauses(message, ops[0], ops);
    expect(clauses.siblings).toEqual([]);
    expect(guard(actionScopedSource(message, ops[0], ops).text, [at("às 10h e meia", 10, 30)], { foreign: clauses }).asked).toEqual(["date"]);
  });
});

describe("review (30/09): flag off", () => {
  it("the new options change nothing: nothing asked, the grounding byte-identical", () => {
    flag("DATE_RULES_V2", false);
    const message = "Não esquece de passar a Ivone pra amanhã, às 10h e meia.", quotes = [at("às 10h e meia", 10, 30)] as never;
    const grounded = groundSchedulingTemporalTurn({ date: "2026-10-02", time: "10:00" }, {}, message, tz, now, undefined, "appointment.change", quotes), before = structuredClone(grounded);
    expect(applyKeptDayGuard(grounded, message, "appointment.change", quotes, [], { kept: "2026-10-02", foreign: { own: [], siblings: [[0, 5]] } })).toEqual([]);
    expect(grounded).toEqual(before);
  });
});
