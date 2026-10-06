import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedOperation } from "@everflair/salon-secretary";
import { actionScopedSource, siblingScopedMessage } from "../secretary-sibling-scope";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { applyScopeCoverage } from "../scheduling-temporal-source";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, role R-A (temporal scope), pure rules: (1) B6, flag SALON_SECRETARY_DATE_RULES_V2: a negated predicate about a
 * move's current day of the month with no month ("não pode no dia 1", its reading this month already past) is a locator hint
 * carrying the dropped past day, never a value; (2) D4 for direct quotes, flag SALON_SECRETARY_REFERENCES_V2: a day said once in
 * a shared prefix/suffix for coordinated moves is proven in each action's own view, its distributive quantifier ("os dois")
 * never read as a number beside that day. The adapter-level locate and alteration rules are in secretary-date-rules-v2-locate
 * and secretary-alter-appointment-adapter. No DB, no network, no model. Names are synthetic and diverse. */
const CANDIDATE = ["TEMPORAL_COMPONENTS", "TEMPORAL_POLARITY", "SAME_AS", "STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE",
  "SCHEDULING_OVERLAP_ENABLED", "MULTI_ACTION_V2_ENABLED", "DATE_RULES_V2", "DAYPART_RULES_V2", "DAYPART_BY_HOURS", "ALTER_APPOINTMENT", "MULTI_SERVICE", "EXCEPTION_RULES_V2",
  "COPY_V2", "REFERENCES_V2", "READS_V2", "RECURRENCE_GUARD"];
const flag = (name: string, on: boolean) => vi.stubEnv(`SALON_SECRETARY_${name}`, on ? "true" : "false");
beforeEach(() => { for (const name of CANDIDATE) flag(name, true); });
afterEach(() => { vi.unstubAllEnvs(); });

const tz = "America/Sao_Paulo", now = new Date("2026-09-29T15:00:00Z"); // Tuesday 29/09, 12h in São Paulo: quinta = 01/10
const THURSDAY = "2026-10-01";
const weekday = (value: number): DayComponent => ({ kind: "WEEKDAY", offset: null, weekday: value, week: "NEAREST", day: null, month: null, year: null, days: null });
const dom = (day: number, month: number | null = null): DayComponent => ({ kind: "DAY_OF_MONTH", offset: null, weekday: null, week: null, day, month, year: null, days: null });
const clock = (hour: number): ClockComponent => ({ hour, minute: 0, daypart: "UNSPECIFIED" });
type Quote = { field: string; text: string; component: DayComponent | ClockComponent };
const neutral = { depends_on: [], released_slot_of: null, service_names: null, service_name: null, professional_name: null, date: null, time: null, period: null, source_date: null,
  source_time: null, end_time: null, end_date: null, reason: null, target_professional_name: null, service_changes: null, target_name: null, name: null, priceCents: null,
  durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
const move = (item_key: string, customer_name: string, source_scope: string, evidence: Quote[]) =>
  ({ ...neutral, operation: "appointment.change", item_key, customer_name, source_scope, temporal_evidence: evidence }) as unknown as SelectedOperation;
const day = (text: string, component: DayComponent = weekday(4)): Quote => ({ field: "date", text, component });
const at = (text: string, hour: number): Quote => ({ field: "time", text, component: clock(hour) });
/** One action grounded exactly like the adapter: its scoped view, the component proof, then scope coverage when scoped. */
function ground(message: string, ops: SelectedOperation[], key: string) {
  const op = ops.find(item => item.item_key === key)!, { operation, fields, temporal_evidence } = projectSchedulingOperation(op);
  const source = actionScopedSource(message, op, ops);
  const grounded = groundSchedulingTemporalTurn({}, fields, source.text, tz, now, undefined, operation, temporal_evidence);
  const divergence = source.scoped ? applyScopeCoverage(grounded, source.text, tz, now, operation, fields, temporal_evidence) : [];
  return { source, grounded, divergence };
}
const pair = (message: string, first: [string, string, Quote[]], second: [string, string, Quote[]]) =>
  [move("a", first[0], first[1], first[2]), move("b", second[0], second[1], second[2])];

describe("D4 for direct quotes: a day said once for coordinated moves is proven in each action's own view", () => {
  const message = "passa a Nara pras 2 e o Kevin pras 3, os dois na quinta mesmo";
  const ops = () => pair(message, ["Nara", "passa a Nara pras 2", [day("na quinta mesmo"), at("pras 2", 2)]], ["Kevin", "e o Kevin pras 3", [day("na quinta mesmo"), at("pras 3", 3)]]);
  it("both moves are scoped and get Thursday; only the quantifier 'dois' is blanked, offsets never move", () => {
    for (const key of ["a", "b"]) {
      const { source, grounded, divergence } = ground(message, ops(), key);
      expect(source.scoped).toBe(true);expect(source.text).toHaveLength(message.length);
      expect(source.text.slice(message.indexOf(", os"))).toBe(", os      na quinta mesmo");
      expect(grounded.fields.date).toBe(THURSDAY);expect(grounded.rejected.map(item => item.field)).not.toContain("date");
      expect(divergence.filter(code => code.endsWith("_DATE"))).toEqual([]);
      // The half-day reading is still the backend's question here (settled later by the tenant's hours, never by this rule).
      expect(grounded.pending_temporal_ambiguities.map(item => item.field)).toEqual(["time"]);
    }
    const nara = ground(message, ops(), "a").source.text, kevin = ground(message, ops(), "b").source.text;
    expect(nara.startsWith("passa a Nara pras 2 ")).toBe(true);expect(nara).not.toContain("Kevin");
    expect(kevin.startsWith(" ".repeat("passa a Nara pras 2 ".length))).toBe(true);expect(kevin).toContain("e o Kevin pras 3");
  });
  it("flag off: byte-identical historical view (sibling masking, not scoped) and the day is asked, never taken", () => {
    flag("REFERENCES_V2", false);
    for (const key of ["a", "b"]) {
      const list = ops(), own = list.find(item => item.item_key === key)!;
      const { source, grounded } = ground(message, list, key);
      expect(source).toEqual({ text: siblingScopedMessage(message, own, list), scoped: false });
      expect(grounded.fields.date).toBeUndefined();expect(grounded.rejected.map(item => item.field)).toContain("date");
    }
  });
  it("a shared prefix is the same rule ('na quinta, passa a Lia pras 11 e o Hiroshi pras 4')", () => {
    const prefix = "na quinta, passa a Lia pras 11 e o Hiroshi pras 4";
    const list = pair(prefix, ["Lia", "passa a Lia pras 11", [day("na quinta"), at("pras 11", 11)]], ["Hiroshi", "e o Hiroshi pras 4", [day("na quinta"), at("pras 4", 4)]]);
    for (const key of ["a", "b"]) { const { source, grounded } = ground(prefix, list, key); expect(source.scoped).toBe(true);expect(grounded.fields.date).toBe(THURSDAY); }
  });
  it("a feminine 'as duas' is left to the grammar (a clock lead): the day is still proven, nothing is blanked", () => {
    const feminine = "passa a Jade pras 2 e a Yasmin pras 3, as duas na quinta mesmo";
    const list = pair(feminine, ["Jade", "passa a Jade pras 2", [day("na quinta mesmo"), at("pras 2", 2)]], ["Yasmin", "e a Yasmin pras 3", [day("na quinta mesmo"), at("pras 3", 3)]]);
    for (const key of ["a", "b"]) {
      const { source, grounded } = ground(feminine, list, key);
      expect(source.scoped).toBe(true);expect(source.text.slice(feminine.indexOf(", as"))).toBe(", as duas na quinta mesmo");expect(grounded.fields.date).toBe(THURSDAY);
    }
  });
});

describe("D4 for direct quotes, adversarial: anything short of the distributive shape keeps today's question", () => {
  const dateOf = (message: string, list: SelectedOperation[], key: string) => ground(message, list, key).grounded.fields.date;
  it("an action whose own clause states a day of its own: no action takes the shared day", () => {
    const message = "passa a Nara pra sexta pras 2 e o Kevin pras 3, os dois na quinta";
    const list = pair(message, ["Nara", "passa a Nara pra sexta pras 2", [day("na quinta"), at("pras 2", 2)]], ["Kevin", "e o Kevin pras 3", [day("na quinta"), at("pras 3", 3)]]);
    for (const key of ["a", "b"]) { expect(ground(message, list, key).source.scoped).toBe(false);expect(dateOf(message, list, key)).toBeUndefined(); }
  });
  it.each([
    ["a negator in the shared clause", "passa a Duda pras 2 e o Téo pras 3, os dois não na quinta", "e o Téo pras 3"],
    ["an alterity word in an action's region", "passa a Duda pras 2 e o Téo pras 3 em outro horário, os dois na quinta", "e o Téo pras 3 em outro horário"],
    ["a calendar noun in an action's region", "passa a Duda pras 2 e o Téo pras 3 no dia seguinte, os dois na quinta", "e o Téo pras 3 no dia seguinte"],
  ] as const)("%s: nothing is taken", (_label, message, second) => {
    const list = pair(message, ["Duda", "passa a Duda pras 2", [day("na quinta"), at("pras 2", 2)]], ["Téo", second, [day("na quinta"), at("pras 3", 3)]]);
    for (const key of ["a", "b"]) expect(dateOf(message, list, key)).toBeUndefined();
  });
  it("the day written twice is never a shared occurrence", () => {
    const message = "passa a Bia pras 2 na quinta e o Nando pras 3, os dois na quinta";
    const list = pair(message, ["Bia", "passa a Bia pras 2 na quinta", [day("na quinta"), at("pras 2", 2)]], ["Nando", "e o Nando pras 3", [day("na quinta"), at("pras 3", 3)]]);
    expect(ground(message, list, "b").source.scoped).toBe(false);expect(dateOf(message, list, "b")).toBeUndefined();
  });
  it("only one action quotes it: not distributive (the other said its own day)", () => {
    const message = "passa o Kevin na sexta pras 3 e a Nara pras 2, ela na quinta";
    const list = pair(message, ["Kevin", "passa o Kevin na sexta pras 3", [day("na sexta", weekday(5)), at("pras 3", 3)]], ["Nara", "e a Nara pras 2", [day("na quinta"), at("pras 2", 2)]]);
    expect(ground(message, list, "b").source.scoped).toBe(false);
  });
  it("a quantifier that does not count the actions sharing the day is never blanked (a number beside the day: asked)", () => {
    const message = "passa a Lia pras 2 e o Hiroshi pras 3, os três na quinta mesmo";
    const list = pair(message, ["Lia", "passa a Lia pras 2", [day("na quinta mesmo"), at("pras 2", 2)]], ["Hiroshi", "e o Hiroshi pras 3", [day("na quinta mesmo"), at("pras 3", 3)]]);
    for (const key of ["a", "b"]) { const { source, grounded } = ground(message, list, key); expect(source.text).toContain("os três na quinta");expect(grounded.fields.date).toBeUndefined(); }
  });
  it("a cancel and a move sharing the day follow the same rule; a sibling's own clause never proves this action's day", () => {
    const message = "cancela a Céu e passa o Téo pras 4, os dois na quinta";
    const cancel = { ...neutral, operation: "appointment.cancel", item_key: "a", customer_name: "Céu", source_scope: "cancela a Céu", reason: null,
      temporal_evidence: [day("na quinta")] } as unknown as SelectedOperation;
    const list = [cancel, move("b", "Téo", "e passa o Téo pras 4", [day("na quinta"), at("pras 4", 4)])];
    expect(ground(message, list, "a").grounded.fields.date).toBe(THURSDAY);expect(ground(message, list, "b").grounded.fields.date).toBe(THURSDAY);
  });
});

describe("B6: a monthless day whose reading this month passed is a locator hint carrying the dropped day", () => {
  const change = (message: string, source: Quote, destination: Quote[], name = "Odete") =>
    groundSchedulingTemporalTurn({}, { customer_name: name }, message, tz, now, undefined, "appointment.change", [{ ...source, field: "source_date" }, ...destination] as never);
  it("'a odete nao pode no dia 1, passa ela pro dia 3 as 10': never a value, the hint is 01/10 with 01/09 dropped; flag off: denial", () => {
    const message = "a odete nao pode no dia 1, passa ela pro dia 3 as 10";
    const run = change(message, day("dia 1", dom(1)), [day("dia 3", dom(3)), at("as 10", 10)]);
    expect(run.rejected).toEqual([]);expect(run.fields.source_date).toBeUndefined();expect(run.fields).toMatchObject({ date: "2026-10-03", time: "10:00" });
    expect(run.locator_hints).toEqual([{ field: "source_date", dates: ["2026-10-01"], expression: "dia 1", dropped: ["2026-09-01"] }]);expect(run).not.toHaveProperty("past_readings");
    flag("DATE_RULES_V2", false);
    expect(change(message, day("dia 1", dom(1)), [day("dia 3", dom(3)), at("as 10", 10)]).rejected.map(item => item.field)).toEqual(["source_date"]);
  });
  it("a day still ahead this month carries no dropped day ('não pode no dia 30')", () => {
    const run = change("a Kaique não pode no dia 30, passa ele pro dia 02/10 às 11h", day("no dia 30", dom(30)), [day("dia 02/10", dom(2, 10)), at("às 11h", 11)], "Kaique");
    expect(run.locator_hints).toEqual([{ field: "source_date", dates: ["2026-09-30"], expression: "no dia 30" }]);
  });
  it.each([
    ["a negated command", "nao passa a Odete do dia 1 pro dia 3 as 10", "dia 1"],
    ["a negated destination", "a Odete nao pode no dia 1, nao passa ela pro dia 3 as 10", "dia 1"],
    ["a written month already past", "a Odete nao pode no dia 01/09, passa ela pro dia 3 as 10", "dia 01/09"],
    ["no subject before the negator", "nao pode no dia 1, passa a Odete pro dia 3 as 10", "dia 1"],
  ] as const)("adversarial (%s): the historical denial, no hint", (_label, message, quote) => {
    const run = change(message, day(quote, quote === "dia 01/09" ? dom(1, 9) : dom(1)), [day("dia 3", dom(3)), at("as 10", 10)]);
    expect(run.rejected.map(item => item.field)).toContain("source_date");expect(run).not.toHaveProperty("locator_hints");expect(run.fields.source_date).toBeUndefined();
  });
  it("adversarial: a cancel's negated day is never a hint (B6 is the move's origin only)", () => {
    const run = groundSchedulingTemporalTurn({}, { customer_name: "Odete" }, "a Odete nao pode no dia 1, cancela ela", tz, now, undefined, "appointment.cancel", [day("dia 1", dom(1))] as never);
    expect(run.rejected.map(item => item.field)).toEqual(["date"]);expect(run).not.toHaveProperty("locator_hints");
  });
});
