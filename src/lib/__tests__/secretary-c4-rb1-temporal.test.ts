import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedOperation } from "@everflair/salon-secretary";
import { actionScopedSource, siblingScopedMessage } from "../secretary-sibling-scope";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { applyScopeCoverage } from "../scheduling-temporal-source";
import { verifyClockComponent, verifyDayComponent } from "../scheduling-temporal-reference";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import type { SchedulingFields } from "../scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, role R-B1 (temporal readings and unnecessary questions), pure rules, all candidate flags on unless a test turns one off:
 * (1) shared edge (SALON_SECRETARY_REFERENCES_V2): a day said once for coordinated moves that Luna left inside the LAST (FIRST) clause
 *     as its trailing (leading) punctuation segment is read outside that clause, exactly as if the clause closed at the punctuation;
 * (2) unwritten week scope (SALON_SECRETARY_DATE_RULES_V2): "na terça" read as NEXT_WEEK is proven only when it names the very day
 *     the written weekday alone names;
 * (3) written daypart (SALON_SECRETARY_DAYPART_RULES_V2): "uma da tarde" read as hour 1 UNSPECIFIED is the half of the day the words fix;
 * (4) legacy destination (SALON_SECRETARY_DATE_RULES_V2): a destination Luna quoted on the legacy wire counts for the negated-origin rule.
 * No DB, no network, no model. Synthetic, diverse names; no gender is inferred from a name. */
const CANDIDATE = ["TEMPORAL_COMPONENTS", "TEMPORAL_POLARITY", "SAME_AS", "STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE",
  "SCHEDULING_OVERLAP_ENABLED", "MULTI_ACTION_V2_ENABLED", "DATE_RULES_V2", "DAYPART_RULES_V2", "DAYPART_BY_HOURS", "ALTER_APPOINTMENT", "MULTI_SERVICE", "EXCEPTION_RULES_V2",
  "COPY_V2", "REFERENCES_V2", "READS_V2", "RECURRENCE_GUARD"];
const flag = (name: string, on: boolean) => vi.stubEnv(`SALON_SECRETARY_${name}`, on ? "true" : "false");
beforeEach(() => { for (const name of CANDIDATE) flag(name, true); });
afterEach(() => { vi.unstubAllEnvs(); });

const tz = "America/Sao_Paulo", now = new Date("2026-09-29T15:00:00Z"); // Tuesday 29/09, 12h in São Paulo
const TUESDAY = "2026-09-29", THURSDAY = "2026-10-01", NEXT_TUESDAY = "2026-10-06";
const weekday = (value: number, week: DayComponent["week"] = "NEAREST"): DayComponent => ({ kind: "WEEKDAY", offset: null, weekday: value, week, day: null, month: null, year: null, days: null });
const clock = (hour: number, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute: 0, daypart });
type Quote = { field: string; text: string; component: DayComponent | ClockComponent };
const neutral = { depends_on: [], released_slot_of: null, service_names: null, service_name: null, professional_name: null, date: null, time: null, period: null, source_date: null,
  source_time: null, end_time: null, end_date: null, reason: null, target_professional_name: null, service_changes: null, target_name: null, name: null, priceCents: null,
  durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
const move = (item_key: string, customer_name: string, source_scope: string, evidence: Quote[], extra: Record<string, unknown> = {}) =>
  ({ ...neutral, operation: "appointment.change", item_key, customer_name, source_scope, temporal_evidence: evidence, ...extra }) as unknown as SelectedOperation;
const day = (text: string, component: DayComponent = weekday(4)): Quote => ({ field: "date", text, component });
const at = (text: string, hour: number): Quote => ({ field: "time", text, component: clock(hour) });
function ground(message: string, ops: SelectedOperation[], key: string) {
  const op = ops.find(item => item.item_key === key)!, { operation, fields, temporal_evidence } = projectSchedulingOperation(op);
  const source = actionScopedSource(message, op, ops);
  const grounded = groundSchedulingTemporalTurn({}, fields, source.text, tz, now, undefined, operation, temporal_evidence);
  const divergence = source.scoped ? applyScopeCoverage(grounded, source.text, tz, now, operation, fields, temporal_evidence) : [];
  return { source, grounded, divergence };
}

describe("shared edge: a day said once, left by Luna inside the last (first) clause, is read as the shared suffix (prefix)", () => {
  const message = "passa a Zuleica pras 2 e o Kenji pras 3, os dois na quinta mesmo";
  const moves = (kenji: string, kenjiExtra: Record<string, unknown> = {}, zuleicaDay = true) => [
    move("a", "Zuleica", "passa a Zuleica pras 2", [...(zuleicaDay ? [day("na quinta mesmo")] : []), at("pras 2", 2)]),
    move("b", "Kenji", kenji, [day("na quinta mesmo"), at("pras 3", 3)], kenjiExtra)];
  it("the suffix inside Kenji's clause: both moves get Thursday with the very views of the clause closed at the comma", () => {
    const inside = moves("e o Kenji pras 3, os dois na quinta mesmo"), closed = moves("e o Kenji pras 3");
    for (const key of ["a", "b"]) {
      const edge = ground(message, inside, key), comma = ground(message, closed, key);
      expect(edge.source).toEqual(comma.source);expect(edge.source.scoped).toBe(true);expect(edge.source.text).toHaveLength(message.length);
      expect(edge.source.text.slice(message.indexOf(", os"))).toBe(", os      na quinta mesmo");
      expect(edge.grounded.fields.date).toBe(THURSDAY);expect(edge.grounded.rejected.map(item => item.field)).not.toContain("date");
      expect(edge.divergence.filter(code => code.endsWith("_DATE"))).toEqual([]);
    }
  });
  it("the prefix inside the first clause ('na quinta, passa a Lia pras 11 e o Hiroshi pras 4') is the same rule", () => {
    const prefix = "na quinta, passa a Lia pras 11 e o Hiroshi pras 4";
    const list = (lia: string) => [move("a", "Lia", lia, [day("na quinta"), at("pras 11", 11)]), move("b", "Hiroshi", "e o Hiroshi pras 4", [day("na quinta"), at("pras 4", 4)])];
    for (const key of ["a", "b"]) {
      const edge = ground(prefix, list("na quinta, passa a Lia pras 11"), key), comma = ground(prefix, list("passa a Lia pras 11"), key);
      expect(edge.source).toEqual(comma.source);expect(edge.grounded.fields.date).toBe(THURSDAY);
    }
  });
  it("offsets are UTF-16 units: an emoji before the edge moves nothing", () => {
    const emoji = "passa a Zuleica pras 2 😊 e o Kenji pras 3 🙏, os dois na quinta mesmo";
    const list = (kenji: string) => [move("a", "Zuleica", "passa a Zuleica pras 2", [day("na quinta mesmo"), at("pras 2", 2)]), move("b", "Kenji", kenji, [day("na quinta mesmo"), at("pras 3", 3)])];
    for (const key of ["a", "b"]) {
      const edge = ground(emoji, list("e o Kenji pras 3 🙏, os dois na quinta mesmo"), key), comma = ground(emoji, list("e o Kenji pras 3 🙏"), key);
      expect(edge.source).toEqual(comma.source);expect(edge.grounded.fields.date).toBe(THURSDAY);
    }
  });
  it("adversarial: a day only Kenji quotes stays in Kenji's clause (never lent to Zuleica)", () => {
    const list = moves("e o Kenji pras 3, os dois na quinta mesmo", {}, false), zuleica = ground(message, list, "a");
    expect(zuleica.source.text).not.toContain("quinta");expect(zuleica.grounded.fields.date).toBeUndefined();
    // Unchanged for Kenji: with no second action quoting the day, "os dois" is no distributive subject and is asked about as before.
    expect(ground(message, list, "b").grounded.fields.date).toBeUndefined();
  });
  it.each([
    ["the edge holds another quote of Kenji's (his professional)", "passa a Zuleica pras 2 e o Kenji pras 3, os dois na quinta com a Odete", "e o Kenji pras 3, os dois na quinta com a Odete", { professional_name: "Odete" }, "na quinta"],
    ["the day sits in a middle segment", "passa a Zuleica pras 2 e o Kenji pras 3, os dois na quinta, beleza", "e o Kenji pras 3, os dois na quinta, beleza", {}, "na quinta"],
    ["the shared day is denied", "passa a Zuleica pras 2 e o Kenji pras 3, os dois não na quinta", "e o Kenji pras 3, os dois não na quinta", {}, "na quinta"],
  ] as const)("adversarial: %s — no edge is cut; Zuleica's day is not proven", (_label, text, kenji, extra, quote) => {
    const list = [move("a", "Zuleica", "passa a Zuleica pras 2", [day(quote), at("pras 2", 2)]), move("b", "Kenji", kenji, [day(quote), at("pras 3", 3)], extra)];
    const zuleica = ground(text, list, "a");
    expect(zuleica.grounded.fields.date).toBeUndefined();
  });
  it("flag off: byte-identical historical views (sibling masking, not scoped); the day is asked, never taken", () => {
    flag("REFERENCES_V2", false);
    const list = moves("e o Kenji pras 3, os dois na quinta mesmo"), zuleica = list[0];
    const { source, grounded } = ground(message, list, "a");
    expect(source).toEqual({ text: siblingScopedMessage(message, zuleica, list), scoped: false });
    expect(grounded.fields.date).toBeUndefined();expect(grounded.rejected.map(item => item.field)).toContain("date");
  });
});

describe("unwritten week scope: proven only when it names the day the written weekday names", () => {
  it("'na terça' read as NEXT_WEEK on a Tuesday is next Tuesday, the very day NEAREST names", () => {
    expect(verifyDayComponent("na terça", weekday(2, "NEXT_WEEK"), TUESDAY)).toEqual({ status: "OK", date: NEXT_TUESDAY });
    expect(verifyDayComponent("na terça", weekday(2), TUESDAY)).toEqual({ status: "OK", date: NEXT_TUESDAY });
  });
  it.each([
    ["a scope that moves the day ('na sexta' as NEXT_WEEK on a Tuesday)", "na sexta", weekday(5, "NEXT_WEEK")],
    ["THIS_WEEK naming today instead of next Tuesday", "na terça", weekday(2, "THIS_WEEK")],
    ["an unwritten 'que vem' that would be a choice", "na quarta", weekday(3, "AMBIGUOUS_NEXT")],
    ["a written 'que vem' is not NEAREST ('sexta que vem' as NEXT_WEEK)", "sexta que vem", weekday(5, "NEXT_WEEK")],
  ] as const)("adversarial: %s is refused", (_label, quote, component) => {
    expect(verifyDayComponent(quote, component, TUESDAY).status).toBe("REJECTED");
  });
  it("flag off: the historical refusal", () => {
    flag("DATE_RULES_V2", false);
    expect(verifyDayComponent("na terça", weekday(2, "NEXT_WEEK"), TUESDAY).status).toBe("REJECTED");
  });
  it("grounded as an answer: 'então põe na terça às 15' keeps date and time", () => {
    const run = groundSchedulingTemporalTurn({}, {}, "então põe na terça às 15", tz, now, undefined, "appointment.create",
      [{ field: "date", text: "na terça", component: weekday(2, "NEXT_WEEK") }, { field: "time", text: "às 15", component: clock(15) }]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ date: NEXT_TUESDAY, time: "15:00" });
  });
});

describe("written daypart: an hour Luna left UNSPECIFIED is the half of the day the words fix", () => {
  it.each([
    ["uma da tarde", 1, "13:00"], ["8 da noite", 8, "20:00"], ["às 3 da tarde", 3, "15:00"],
    // Unchanged: the hour as said already fits the written daypart.
    ["10 da manhã", 10, "10:00"], ["uma da manhã", 1, "01:00"],
  ] as const)("'%s' (hour %i, UNSPECIFIED) is %s", (quote, hour, time) => {
    expect(verifyClockComponent(quote, clock(hour))).toEqual({ status: "OK", time });
  });
  it.each([
    ["no written daypart: still the half-day question", "uma", clock(1), "DAYPART_CHOICE"],
    ["the twin does not fit the written daypart either ('7 da tarde')", "7 da tarde", clock(7), "REJECTED"],
    ["Luna's own daypart against the written one", "uma da tarde", clock(1, "MANHA"), "REJECTED"],
    ["another written hour", "duas da tarde", clock(1), "REJECTED"],
  ] as const)("adversarial: %s", (_label, quote, component, status) => {
    expect(verifyClockComponent(quote, component).status).toBe(status);
  });
  it("an interval with one written daypart ('das 2 às 5 da tarde') settles both ends", () => {
    const quote = "das 2 às 5 da tarde";
    const run = groundSchedulingTemporalTurn({}, {}, `fecha a agenda da Odete amanhã ${quote}`, tz, now, undefined, "schedule.block",
      [{ field: "date", text: "amanhã", component: { ...weekday(3), kind: "RELATIVE_DAY", offset: 1, weekday: null, week: null } }, { field: "time", text: quote, component: clock(2) }, { field: "end_time", text: quote, component: clock(5) }]);
    expect(run.rejected).toEqual([]);expect(run.fields).toMatchObject({ time: "14:00", end_time: "17:00" });
  });
  it("flag off: the historical refusal", () => {
    flag("DAYPART_RULES_V2", false);
    expect(verifyClockComponent("uma da tarde", clock(1)).status).toBe("REJECTED");
  });
});

describe("legacy destination: a destination on the legacy wire counts for the negated-origin rule", () => {
  type Entry = SchedulingTemporalEvidence[number];
  const legacy = (field: Entry["field"], text: string): Entry => ({ field, text });
  const origin = (text: string): Entry => ({ field: "source_date", text, component: weekday(3) });
  const run = (message: string, raw: SchedulingFields) => groundSchedulingTemporalTurn({}, raw, message, tz, now, undefined, "appointment.change", [legacy("date", "sexta"), origin("na quarta")]);
  const raw = { customer_name: "Bento", date: "2026-10-02" };
  it("'o Bento não vai conseguir vir na quarta, joga ele pra sexta': the origin is a locator hint, the destination stands", () => {
    const grounded = run("o Bento não vai conseguir vir na quarta, joga ele pra sexta", raw);
    expect(grounded.rejected).toEqual([]);expect(grounded.fields.date).toBe("2026-10-02");expect(grounded.fields.source_date).toBeUndefined();
    expect(grounded.locator_hints).toEqual([{ field: "source_date", dates: ["2026-09-30"], expression: "na quarta" }]);
  });
  it("adversarial: a destination before the negated clause keeps the historical denial", () => {
    const grounded = run("joga o Bento pra sexta, ele não vai conseguir vir na quarta", raw);
    expect(grounded.rejected.map(item => item.field)).toContain("source_date");expect(grounded).not.toHaveProperty("locator_hints");
  });
  it("flag off: the historical denial", () => {
    flag("DATE_RULES_V2", false);
    const grounded = run("o Bento não vai conseguir vir na quarta, joga ele pra sexta", raw);
    expect(grounded.rejected.map(item => item.field)).toContain("source_date");expect(grounded).not.toHaveProperty("locator_hints");
  });
});
