import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedOperation } from "@everflair/salon-secretary";
import { selfReferenceProven, type SelfHolder } from "../secretary-same-as";
import { actionScopedSource } from "../secretary-sibling-scope";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { governingNegators } from "../scheduling-temporal-source";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, fixer of the Track R adversarial review (round 2). Pure rules, all candidate flags on unless a test turns one off:
 * (1) SALON_SECRETARY_DATE_RULES_V2: a predicate negator of the conjunct before a coordinated clause keeps governing it whatever the
 *     scope shape ("não precisa trocar X e bloquear Y"); only a negator attached to a temporal atom ("às dez não às onze") is a value
 *     correction of its own clause; an adversative opener ("mas") starts a new main clause; the verb "é" is no connector.
 * (2) SALON_SECRETARY_REFERENCES_V2 (D-SELF): a relative subject that also names another person of the request does not single out
 *     the customer; a subordinate clause after the self reference ("quando vinha de manhã", "se for de manhã") qualifies it.
 * No DB, no network, no model. Synthetic diverse names (a barbershop chair, a spa, a nail studio); no gender is inferred from a name. */
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
const clock = (hour: number, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute: 0, daypart });
const tomorrow: DayComponent = { kind: "RELATIVE_DAY", offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null };
const friday: DayComponent = { kind: "WEEKDAY", offset: null, weekday: 5, week: "NEAREST", day: null, month: null, year: null, days: null };

describe("(1) a coordinated clause keeps the predicate negation of the conjunct before it, whatever its scope took in", () => {
  const cancel = (scope: string) => ({ ...neutral, operation: "appointment.cancel", item_key: "a", customer_name: "Otávio", source_scope: scope, temporal_evidence: [] }) as unknown as SelectedOperation;
  const block = (scope: string) => ({ ...neutral, operation: "schedule.block", item_key: "b", professional_name: "Yara", source_scope: scope,
    temporal_evidence: [{ field: "date", text: "amanhã", component: tomorrow }, { field: "time", text: "das 9 às 10", component: clock(9) },
      { field: "end_time", text: "das 9 às 10", component: clock(10) }] }) as unknown as SelectedOperation;
  const ground = (message: string, ops: SelectedOperation[], key: string) => {
    const op = ops.find(item => item.item_key === key)!, { operation, fields, temporal_evidence } = projectSchedulingOperation(op);
    const source = actionScopedSource(message, op, ops);
    return { source, grounded: groundSchedulingTemporalTurn({}, fields, source.text, tz, now, undefined, operation, temporal_evidence) };
  };
  const denied = (message: string, cancelScope: string, blockScope: string) => {
    const { source, grounded } = ground(message, [cancel(cancelScope), block(blockScope)], "b");
    expect(source.scoped, blockScope).toBe(true);
    expect(grounded.fields.date, blockScope).toBeUndefined(); expect(grounded.fields.time, blockScope).toBeUndefined();
    expect(grounded.rejected.map(item => item.field), blockScope).toEqual(expect.arrayContaining(["date", "time", "end_time"]));
  };
  it.each([
    ["a predicate negator ('não precisa')", "não precisa desmarcar o Otávio e fechar a agenda da Yara amanhã das 9 às 10", "não precisa desmarcar o Otávio"],
    ["a negated copula ('não é pra'; the verb 'é' is no connector)", "não é pra cancelar o Otávio e bloquear a Yara amanhã das 9 às 10", "não é pra cancelar o Otávio"],
    ["a negated matrix verb over coordinated complements ('não quero que … e que …')", "não quero que desmarque o Otávio e que feche a agenda da Yara amanhã das 9 às 10", "não quero que desmarque o Otávio"],
    ["a negator inside the previous conjunct's subordinate clause that no reason quote proves (ambiguous attachment: asked)", "cancela o Otávio que ele não vem e fecha a agenda da Yara amanhã das 9 às 10", "cancela o Otávio que ele não vem"],
  ] as const)("the block is never grounded under %s, with or without the 'e' in its scope", (_label, message, cancelScope) => {
    const opened = message.slice(message.lastIndexOf(" e ") + 1), bare = opened.replace(/^e (que )?/, "");
    for (const scope of [opened, bare]) denied(message, cancelScope, scope);
  });
  it("a negator inside the previous action's own proven reason ('que não vem mais') is that reason's content: the block is grounded in both shapes", () => {
    const message = "Cancela a Priscila que não vem mais e fecha a agenda da Yara das 10 às 11 amanhã.";
    const priscila = { ...neutral, operation: "appointment.cancel", item_key: "a", customer_name: "Priscila", reason: "que não vem mais", source_scope: "Cancela a Priscila que não vem mais", temporal_evidence: [] } as unknown as SelectedOperation;
    const yara = (scope: string) => ({ ...neutral, operation: "schedule.block", item_key: "b", professional_name: "Yara", source_scope: scope,
      temporal_evidence: [{ field: "date", text: "amanhã", component: tomorrow }, { field: "time", text: "das 10 às 11", component: clock(10) },
        { field: "end_time", text: "das 10 às 11", component: clock(11) }] }) as unknown as SelectedOperation;
    for (const scope of ["e fecha a agenda da Yara das 10 às 11 amanhã", "fecha a agenda da Yara das 10 às 11 amanhã"]) {
      const { source, grounded } = ground(message, [priscila, yara(scope)], "b");
      expect(source.text, scope).not.toMatch(/n[aã]o/);
      expect(grounded.fields, scope).toMatchObject({ date: "2026-09-30", time: "10:00", end_time: "11:00" }); expect(grounded.rejected, scope).toEqual([]);
    }
    // Without a quoted reason the same words are not proven to be one: asked (the conservative reading above).
    const bare = { ...priscila, reason: null } as unknown as SelectedOperation;
    expect(ground(message, [bare, yara("e fecha a agenda da Yara das 10 às 11 amanhã")], "b").grounded.fields.date).toBeUndefined();
  });
  it("adversarial: a 'reason' that heads its own clause ('não precisa' quoted as the reason) is no reason: the predicate negator still governs", () => {
    const message = "não precisa desmarcar o Otávio e fechar a agenda da Yara amanhã das 9 às 10";
    const quoted = { ...cancel("não precisa desmarcar o Otávio"), reason: "não precisa" } as unknown as SelectedOperation;
    for (const scope of ["e fechar a agenda da Yara amanhã das 9 às 10", "fechar a agenda da Yara amanhã das 9 às 10"]) {
      const { grounded } = ground(message, [quoted, block(scope)], "b");
      expect(grounded.fields.date, scope).toBeUndefined(); expect(grounded.rejected.map(item => item.field), scope).toEqual(expect.arrayContaining(["date", "time", "end_time"]));
    }
  });
  it("a negator attached to a temporal atom of the previous clause ('às dez não às onze') corrects that value only: the block is grounded in both shapes", () => {
    const message = "passa a Wanda pra sexta às dez não às onze e fecha a agenda da Yara amanhã das 9 às 10";
    const move = { ...neutral, operation: "appointment.change", item_key: "a", customer_name: "Wanda", source_scope: "passa a Wanda pra sexta às dez não às onze",
      temporal_evidence: [{ field: "date", text: "pra sexta", component: friday }, { field: "time", text: "às onze", component: clock(11) }] } as unknown as SelectedOperation;
    for (const scope of ["e fecha a agenda da Yara amanhã das 9 às 10", "fecha a agenda da Yara amanhã das 9 às 10"]) {
      const { source, grounded } = ground(message, [move, block(scope)], "b");
      expect(source.text).not.toMatch(/n[aã]o/);
      expect(grounded.fields).toMatchObject({ date: "2026-09-30", time: "09:00", end_time: "10:00" }); expect(grounded.rejected).toEqual([]);
    }
  });
  it("an adversative opener ('mas') starts a new main clause: the block after it is grounded", () => {
    const message = "não precisa desmarcar o Otávio mas fecha a agenda da Yara amanhã das 9 às 10";
    for (const scope of ["mas fecha a agenda da Yara amanhã das 9 às 10", "fecha a agenda da Yara amanhã das 9 às 10"]) {
      const { grounded } = ground(message, [cancel("não precisa desmarcar o Otávio"), block(scope)], "b");
      expect(grounded.fields, scope).toMatchObject({ date: "2026-09-30", time: "09:00", end_time: "10:00" });
    }
  });
  it("governingNegators: lead negators by class, trail unchanged, flag off byte-identical to the historical rule", () => {
    const within = (text: string, part: string) => { const at = text.lastIndexOf(part); return [text, at, at + part.length] as const; };
    const predicate = "não precisa desmarcar o Otávio e fechar a agenda da Yara amanhã";
    expect(governingNegators(...within(predicate, "e fechar a agenda da Yara amanhã"))).toEqual([[0, 3]]);
    expect(governingNegators(...within(predicate, "fechar a agenda da Yara amanhã"))).toEqual([[0, 3]]);
    const valued = "passa a Wanda pra sexta às dez não às onze e fecha a agenda da Yara amanhã";
    expect(governingNegators(...within(valued, "e fecha a agenda da Yara amanhã"))).toEqual([]);
    // A value negator never governs its own clause differently: inside the scope it is not a lead negator at all.
    expect(governingNegators(...within("fecha a agenda da Yara amanhã não", "fecha a agenda da Yara amanhã"))).toEqual([[30, 33]]);
    expect(governingNegators(...within("não bloqueia a Yara amanhã", "bloqueia a Yara amanhã"))).toEqual([[0, 3]]);
    // A reason span owned by a verified sibling exempts its negator (V2 only; flag off it is ignored).
    const reason = "cancela o Otávio que ele não vem e fecha a agenda da Yara amanhã", owned = [[reason.indexOf("que ele"), reason.indexOf(" e fecha")]] as const;
    expect(governingNegators(...within(reason, "e fecha a agenda da Yara amanhã"))).toEqual([[25, 28]]);
    expect(governingNegators(...within(reason, "e fecha a agenda da Yara amanhã"), owned)).toEqual([]);
    flag("DATE_RULES_V2", false);
    expect(governingNegators(...within(reason, "e fecha a agenda da Yara amanhã"), owned)).toEqual([[25, 28]]);
    // Historical rule: the lead is cut at the last connector before the scope, whatever it is.
    expect(governingNegators(...within(predicate, "e fechar a agenda da Yara amanhã"))).toEqual([[0, 3]]);
    expect(governingNegators(...within(predicate, "fechar a agenda da Yara amanhã"))).toEqual([]);
    expect(governingNegators(...within(valued, "e fecha a agenda da Yara amanhã"))).toEqual([[31, 34]]);
  });
});

describe("(2) D-SELF: the relative must single out the customer and be followed by nothing but a new main clause", () => {
  const self = (text: string, literal: string, holder: SelfHolder) => selfReferenceProven(text, literal, undefined, "appointment.change", tz, now, "time", false, holder);
  const two = { customer: "Ana Clara", others: ["Ana Paula"] };
  it("a subject that is also the whole mention of another person of the request is refused; the full name that singles her out is accepted", () => {
    const text = (subject: string) => `desmarca a Ana Paula de quinta e passa a Ana Clara pra quinta no mesmo horário que ${subject} tinha`;
    expect(self(text("a Ana"), "no mesmo horário que a Ana tinha", two)).toBe(false);
    expect(self(text("a Ana Clara"), "no mesmo horário que a Ana Clara tinha", two)).toBe(true);
    expect(self(text("a Clara"), "no mesmo horário que a Clara tinha", two)).toBe(true);
    // Controls: the other person's own word, and nobody else named.
    expect(self(text("a Paula"), "no mesmo horário que a Paula tinha", two)).toBe(false);
    expect(self("passa a Ana Clara pra quinta no mesmo horário que a Ana tinha", "no mesmo horário que a Ana tinha", { customer: "Ana Clara", others: [] })).toBe(true);
  });
  it.each([
    ["quando", "passa a Benedita pra sexta no mesmo horário que ela tinha quando vinha de manhã", "no mesmo horário que ela tinha"],
    ["quando (name)", "passa a Benedita pra sexta no mesmo horário que a Benedita tinha quando era cliente do outro salão", "no mesmo horário que a Benedita tinha"],
    ["se", "passa a Benedita pra sexta no mesmo horário que ela tinha se for de manhã", "no mesmo horário que ela tinha"],
    ["caso", "passa a Benedita pra sexta no mesmo horário que ela tinha caso seja antes do almoço", "no mesmo horário que ela tinha"],
    ["porque", "passa a Benedita pra sexta no mesmo horário que ela tinha porque era cedo", "no mesmo horário que ela tinha"],
    ["pois", "passa a Benedita pra sexta no mesmo horário que ela tinha pois era de tarde", "no mesmo horário que ela tinha"],
    ["quando, no bare reference", "passa a Benedita pra sexta no mesmo horário quando ela vinha de manhã", "no mesmo horário"],
    ["se, no bare reference", "passa a Benedita pra sexta no mesmo horário se for de manhã", "no mesmo horário"],
  ] as const)("a subordinate clause after the reference (%s) qualifies it: refused", (_label, text, literal) => {
    expect(self(text, literal, { customer: "Benedita", others: [] })).toBe(false);
  });
  it.each([
    ["e", "passa a Benedita pra sexta no mesmo horário que ela tinha e avisa ela", "no mesmo horário que ela tinha"],
    ["mas", "passa a Benedita pra sexta no mesmo horário que ela tinha mas confirma antes", "no mesmo horário que ela tinha"],
    ["então", "passa a Benedita pra sexta no mesmo horário que ela tinha então libera a terça", "no mesmo horário que ela tinha"],
    ["e, no bare reference", "passa a Benedita pra sexta no mesmo horário e avisa ela", "no mesmo horário"],
    ["nothing after it", "passa a Benedita pra sexta no mesmo horário", "no mesmo horário"],
  ] as const)("a new main clause (%s) may follow it: accepted", (_label, text, literal) => {
    expect(self(text, literal, { customer: "Benedita", others: [] })).toBe(true);
  });
  it("flag off: no self reference through a relative at all (unchanged)", () => {
    flag("REFERENCES_V2", false);
    expect(self("passa a Benedita pra sexta no mesmo horário que ela tinha e avisa ela", "no mesmo horário que ela tinha", { customer: "Benedita", others: [] })).toBe(false);
  });
});
