import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanAction, SelectedOperation } from "@everflair/salon-secretary";
import { distributiveReferenceProven, selfHolder, selfReferenceProven, type SelfHolder } from "../secretary-same-as";
import { actionScopedSource } from "../secretary-sibling-scope";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { governingNegators } from "../scheduling-temporal-source";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, role R-B2 (temporal references), pure rules, all candidate flags on unless a test turns one off:
 * (1) D-SELF (SALON_SECRETARY_REFERENCES_V2): a relative clause that names the moved appointment's own holder ("pra sexta no mesmo
 *     horário que ela já tinha") is the origin's own value, never a comparative term;
 * (2) D4 (SALON_SECRETARY_REFERENCES_V2): the "dia" of a clock anchor ("pro meio-dia") is no calendar noun in an action's region;
 * (3) scope (SALON_SECRETARY_DATE_RULES_V2): the clause before a coordinated one reaches it only through a predicate negator; its value
 *     negator ("às quatro não às cinco") governs nothing else, whether or not the scope took the connector in (fixer: a predicate
 *     negator keeps governing, see secretary-c4-fixer-rr.test.ts).
 * No DB, no network, no model. Synthetic, diverse names (spa, barber chair, nail studio); no gender is inferred from a name. */
const CANDIDATE = ["TEMPORAL_COMPONENTS", "TEMPORAL_POLARITY", "SAME_AS", "STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE",
  "SCHEDULING_OVERLAP_ENABLED", "MULTI_ACTION_V2_ENABLED", "DATE_RULES_V2", "DAYPART_RULES_V2", "DAYPART_BY_HOURS", "ALTER_APPOINTMENT", "MULTI_SERVICE", "EXCEPTION_RULES_V2",
  "COPY_V2", "REFERENCES_V2", "READS_V2", "RECURRENCE_GUARD"];
const flag = (name: string, on: boolean) => vi.stubEnv(`SALON_SECRETARY_${name}`, on ? "true" : "false");
beforeEach(() => { for (const name of CANDIDATE) flag(name, true); });
afterEach(() => { vi.unstubAllEnvs(); });
const tz = "America/Sao_Paulo", now = new Date("2026-09-29T15:00:00Z"); // Tuesday 29/09: amanhã = 30/09, sexta = 02/10
const neutral = { depends_on: [], released_slot_of: null, service_names: null, service_name: null, professional_name: null, customer_name: null, date: null, time: null,
  period: null, source_date: null, source_time: null, end_time: null, end_date: null, reason: null, target_professional_name: null, service_changes: null, target_name: null,
  name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };

describe("D-SELF: a relative clause naming the appointment's own holder is the origin, never another term", () => {
  const alone = (customer: string): SelfHolder => ({ customer, others: [] });
  const self = (text: string, literal: string, holder?: SelfHolder, field: "time" | "date" = "time") =>
    selfReferenceProven(text, literal, undefined, "appointment.change", tz, now, field, false, holder);
  it("the relative inside the literal, or right after it, with a pronoun agreeing with the owner's own article", () => {
    const text = "a Nayara era terça, coloca ela na sexta no mesmo horário que ela já tinha";
    expect(self(text, "no mesmo horário que ela já tinha", alone("Nayara"))).toBe(true);
    expect(self(text, "no mesmo horário", alone("nayara"))).toBe(true);
    expect(self("passa o Ícaro pra quinta no mesmo horário que ele tinha antes", "no mesmo horário", alone("Ícaro"))).toBe(true);
  });
  it("the customer's own name as the subject, or no subject at all", () => {
    expect(self("passa a Lívia pra sábado no mesmo horário que a Lívia tinha", "no mesmo horário que a Lívia tinha", { customer: "Lívia", others: ["Tomás"] })).toBe(true);
    expect(self("passa a Lívia pra sábado no mesmo horário que estava marcado", "no mesmo horário que estava marcado", alone("Lívia"))).toBe(true);
    expect(self("joga o Otto pra quinta no mesmo horário que já tava agendado", "no mesmo horário", alone("Otto"))).toBe(true);
  });
  it("a new clause may follow the relative ('… que ela já tinha e avisa ela')", () => {
    expect(self("passa a Nayara pra sexta no mesmo horário que ela já tinha e avisa ela", "no mesmo horário que ela já tinha", alone("Nayara"))).toBe(true);
  });
  it("the same rule for a kept day ('pras 15h no mesmo dia que ela tinha')", () => {
    expect(self("passa a Nayara pras 15h no mesmo dia que ela tinha", "no mesmo dia que ela tinha", alone("Nayara"), "date")).toBe(true);
  });
  it.each([
    ["another person as the subject", "passa a Nayara pra sexta no mesmo horário que a Bruna tinha", "no mesmo horário que a Bruna tinha", alone("Nayara")],
    ["a pronoun while the request names someone else", "passa a Nayara pra sexta no mesmo horário que ela tinha", "no mesmo horário que ela tinha", { customer: "Nayara", others: ["Bruna"] }],
    ["an omitted subject while the request names someone else", "passa a Nayara pra sexta no mesmo horário que estava marcado", "no mesmo horário que estava marcado", { customer: "Nayara", others: ["Iara Monteiro"] }],
    ["a pronoun against the owner's own article", "passa o Ícaro pra sexta no mesmo horário que ela tinha", "no mesmo horário que ela tinha", alone("Ícaro")],
    ["a pronoun with no determiner before the customer", "passa Ícaro pra sexta no mesmo horário que ele tinha", "no mesmo horário que ele tinha", alone("Ícaro")],
    ["a verb that states another value", "passa a Nayara pra sexta no mesmo horário que ela pediu", "no mesmo horário que ela pediu", alone("Nayara")],
    ["a bare comparative with a pronoun", "passa a Nayara pra sexta no mesmo horário que ela", "no mesmo horário que ela", alone("Nayara")],
    ["a plural pronoun", "passa a Nayara pra sexta no mesmo horário que elas tinham", "no mesmo horário que elas tinham", alone("Nayara")],
    ["a complement after the relative", "passa a Nayara pra sexta no mesmo horário que ela tinha com a Bruna", "no mesmo horário que ela tinha", alone("Nayara")],
    ["a relative past a comma", "passa a Nayara pra sexta no mesmo horário, que ela tinha", "no mesmo horário", alone("Nayara")],
    ["a negated reference", "passa a Nayara pra sexta, mas não no mesmo horário que ela tinha", "no mesmo horário que ela tinha", alone("Nayara")],
    ["a genitive, with the holder given", "passa a Nayara pra sexta no mesmo horário dela", "no mesmo horário", alone("Nayara")],
    ["a participle without its auxiliary", "passa a Nayara pra sexta no mesmo horário que ela marcado", "no mesmo horário que ela marcado", alone("Nayara")],
    ["a day qualifying the held slot", "passa a Nayara pra sexta no mesmo horário que ela tinha no sábado", "no mesmo horário que ela tinha", alone("Nayara")],
    ["a clock after the relative", "passa a Nayara pra sexta no mesmo horário que ela tinha às 9h", "no mesmo horário", alone("Nayara")],
  ] as const)("refuses %s", (_label, text, literal, holder) => { expect(self(text, literal, holder)).toBe(false); });
  it("without a holder (historical callers) a relative clause is refused exactly as before", () => {
    expect(self("a Nayara era terça, coloca ela na sexta no mesmo horário que ela já tinha", "no mesmo horário que ela já tinha")).toBe(false);
    expect(self("passa a Nayara pra sexta no mesmo horário", "no mesmo horário")).toBe(true);
  });
  it("flag off: no self reference at all (the historical refusal)", () => {
    flag("REFERENCES_V2", false);
    const text = "a Nayara era terça, coloca ela na sexta no mesmo horário que ela já tinha";
    expect(self(text, "no mesmo horário que ela já tinha", alone("Nayara"))).toBe(false);
  });
});

describe("selfHolder: the persons the rest of the request names", () => {
  const op = (fields: Record<string, unknown>) => ({ operation: "appointment.change", item_key: "a", customer_name: null, professional_name: null, target_professional_name: null, ...fields }) as unknown as SelectedOperation;
  const action = (key: string, fields: Record<string, unknown>) => ({ key, operation: "appointment.cancel", fields }) as unknown as PlanAction;
  it("other actions' people and this action's professional are others; the same customer is not", () => {
    const own = action("a", {}), list = [own, action("b", { customer_name: "Bruna" }), action("c", { customer_name: "Nayara Duarte", professional_name: null })];
    expect(selfHolder(list, own, op({ customer_name: "nayara" }))).toEqual({ customer: "nayara", others: ["Bruna"] });
    expect(selfHolder([own], own, op({ customer_name: "Otto", professional_name: "Iara" }))).toEqual({ customer: "Otto", others: ["Iara"] });
    expect(selfHolder([own], own, op({ customer_name: "Otto" }))).toEqual({ customer: "Otto", others: [] });
  });
});

describe("D4: the 'dia' of a clock anchor names no day in the action's region", () => {
  const block = { ...neutral, operation: "schedule.block", item_key: "a", professional_name: "Bento",
    temporal_evidence: [{ field: "date", text: "amanha" }, { field: "time", text: "de 10 a 11" }, { field: "end_time", text: "de 10 a 11" }] } as unknown as SelectedOperation;
  const proven = (message: string, own: string, first = "fecha a agenda do Bento amanha de 10 a 11") => {
    const at = (part: string) => { const start = message.indexOf(part); return [start, start + part.length] as const; };
    const sibling = { op: { ...block, source_scope: first } as SelectedOperation, clause: at(first) };
    return distributiveReferenceProven(message, "amanha", "date", at(own), sibling, [sibling.clause, at(own)], "appointment.change", ["Bento Salles", "Iara Monteiro"]);
  };
  it.each([
    ["fecha a agenda do Bento amanha de 10 a 11 e passa o Otto pro meio dia", "passa o Otto pro meio dia"],
    ["fecha a agenda do Bento amanha de 10 a 11 e passa o Otto pro meio-dia", "e passa o Otto pro meio-dia"],
    ["fecha a agenda do Bento amanha de 10 a 11 e joga a Nayara pra meia-noite", "e joga a Nayara pra meia-noite"],
  ] as const)("%j: the day said once for the block is shared", (message, own) => { expect(proven(message, own)).toBe(true); });
  it.each([
    ["a calendar noun after the anchor", "fecha a agenda do Bento amanha de 10 a 11 e passa o Otto pro meio-dia do dia seguinte", "e passa o Otto pro meio-dia do dia seguinte"],
    ["another day by an alterity word", "fecha a agenda do Bento amanha de 10 a 11 e passa o Otto pro meio-dia de outro dia", "e passa o Otto pro meio-dia de outro dia"],
    ["an own weekday", "fecha a agenda do Bento amanha de 10 a 11 e passa o Otto pro meio-dia de sexta", "e passa o Otto pro meio-dia de sexta"],
    ["a calendar noun of its own", "fecha a agenda do Bento amanha de 10 a 11 e passa o Otto pro meio-dia no dia", "e passa o Otto pro meio-dia no dia"],
    ["a negator", "fecha a agenda do Bento amanha de 10 a 11 e o Otto não, só meio-dia", "e o Otto não, só meio-dia"],
  ] as const)("refuses %s", (_label, message, own) => { expect(proven(message, own)).toBe(false); });
});

describe("scope: a value negator of the clause before a coordinated clause does not reach it, whatever the scope took in", () => {
  const clock = (hour: number, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute: 0, daypart });
  const tomorrow: DayComponent = { kind: "RELATIVE_DAY", offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null };
  const friday: DayComponent = { kind: "WEEKDAY", offset: null, weekday: 5, week: "NEAREST", day: null, month: null, year: null, days: null };
  const message = "passa o Ravi pra sexta às quatro não às cinco da tarde e fecha a agenda da Iara amanhã das 9 às 10";
  const move = { ...neutral, operation: "appointment.change", item_key: "a", customer_name: "Ravi", source_scope: "passa o Ravi pra sexta às quatro não às cinco da tarde",
    temporal_evidence: [{ field: "date", text: "pra sexta", component: friday }, { field: "time", text: "às cinco da tarde", component: clock(5, "TARDE") },
      { field: "time", text: "às quatro não", excluded: clock(4) }] } as unknown as SelectedOperation;
  const block = (scope: string) => ({ ...neutral, operation: "schedule.block", item_key: "b", professional_name: "Iara", source_scope: scope,
    temporal_evidence: [{ field: "date", text: "amanhã", component: tomorrow }, { field: "time", text: "das 9 às 10", component: clock(9) },
      { field: "end_time", text: "das 9 às 10", component: clock(10) }] }) as unknown as SelectedOperation;
  const ground = (ops: SelectedOperation[], key: string, text = message) => {
    const op = ops.find(item => item.item_key === key)!, { operation, fields, temporal_evidence } = projectSchedulingOperation(op);
    const source = actionScopedSource(text, op, ops);
    return { source, grounded: groundSchedulingTemporalTurn({}, fields, source.text, tz, now, undefined, operation, temporal_evidence) };
  };
  it("the block keeps its day and interval whether or not its scope took the 'e'; the ambiguous 'X não Y' of the move is still asked", () => {
    for (const scope of ["e fecha a agenda da Iara amanhã das 9 às 10", "fecha a agenda da Iara amanhã das 9 às 10"]) {
      const ops = [move, block(scope)], { source, grounded } = ground(ops, "b");
      expect(source.scoped).toBe(true);expect(source.text).not.toMatch(/n[aã]o/);
      expect(grounded.fields).toMatchObject({ date: "2026-09-30", time: "09:00", end_time: "10:00" });expect(grounded.rejected).toEqual([]);
      const own = ground(ops, "a").grounded;
      expect(own.fields.time).toBeUndefined();expect(own.rejected.map(item => item.field)).toContain("time");
    }
  });
  it("flag off: the historical view (the move's negator still reaches a scope that took the 'e')", () => {
    flag("DATE_RULES_V2", false);
    const { source, grounded } = ground([move, block("e fecha a agenda da Iara amanhã das 9 às 10")], "b");
    expect(source.text).toContain("não");expect(grounded.fields.date).toBeUndefined();
    expect(grounded.rejected.map(item => item.field)).toEqual(expect.arrayContaining(["date", "time", "end_time"]));
  });
  it("a negator inside the clause itself still denies it", () => {
    const text = "passa o Ravi pra sexta às quatro não às cinco da tarde e não fecha a agenda da Iara amanhã das 9 às 10";
    const { source, grounded } = ground([move, block("e não fecha a agenda da Iara amanhã das 9 às 10")], "b", text);
    expect(source.text).toContain("e não fecha");expect(grounded.fields.date).toBeUndefined();expect(grounded.rejected.map(item => item.field)).toContain("date");
  });
  it("governingNegators: only the opening connector changes, never a lead without one nor the trail", () => {
    const within = (text: string, part: string) => { const at = text.indexOf(part); return [text, at, at + part.length] as const; };
    expect(governingNegators(...within(message, "e fecha a agenda da Iara amanhã das 9 às 10"))).toEqual([]);
    expect(governingNegators(...within("não bloqueia a Iara amanhã", "bloqueia a Iara amanhã"))).toEqual([[0, 3]]);
    const trail = "fecha a agenda da Iara amanhã não, só depois";
    expect(governingNegators(...within("e fecha a agenda da Iara amanhã não", "e fecha a agenda da Iara amanhã"))).toEqual([[32, 35]]);
    expect(governingNegators(...within(trail, "fecha a agenda da Iara amanhã"))).toEqual([[30, 33]]);
    flag("DATE_RULES_V2", false);
    const [text, start, end] = within(message, "e fecha a agenda da Iara amanhã das 9 às 10"), at = message.indexOf("não");
    expect(governingNegators(text, start, end)).toEqual([[at, at + 3]]);
  });
});
