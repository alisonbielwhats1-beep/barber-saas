import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedOperation } from "@everflair/salon-secretary";
import { betweenBookingsGap, betweenBookingsSpan, pronounReferent, selfReferenceProven, type BookedSlot, type SelfHolder } from "../secretary-same-as";

/** Candidate 4, role R-B2, owner rules of 29/09 (docs/DECISOES_PRODUTO.md, last section), pure rules, flag SALON_SECRETARY_REFERENCES_V2:
 * rule 2/4 — "mantém o horário (dela)" in a change keeps the moved appointment's own value (never another person's);
 * rule 7 — a bare pronoun after a move and a new appointment in the slot it frees is the moved customer; any other unsettled pronoun is
 *          asked (Luna's pick removed), never picked;
 * rule 8 — a block "between" the two appointments the request just defined covers only the free interval between them.
 * No DB, no network, no model. Synthetic, diverse names; no gender is inferred from a name (only from the owner's own articles). */
beforeEach(() => { vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true"); vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); });
afterEach(() => { vi.unstubAllEnvs(); });
const tz = "America/Sao_Paulo", now = new Date("2026-09-29T15:00:00Z");

describe("rule 2/4: an explicit keep of the moved appointment's own value", () => {
  const alone = (customer: string): SelfHolder => ({ customer, others: [] });
  const self = (text: string, literal: string, holder?: SelfHolder, field: "time" | "date" = "time") =>
    selfReferenceProven(text, literal, undefined, "appointment.change", tz, now, field, false, holder);
  it("keep verb + head of the field, with or without the holder's possessive (in the literal or right after it)", () => {
    const text = "desmarca a Yolanda de terça e já remarca ela pra quinta, mantém o horário dela";
    expect(self(text, "mantém o horário dela", alone("Yolanda"))).toBe(true);
    expect(self(text, "mantém o horário", alone("yolanda"))).toBe(true);
    expect(self(text, "o horário dela", alone("Yolanda"))).toBe(true); // the keep verb right before the literal, same clause
    expect(self("passa o Benício pra sexta, mantendo a mesma hora", "mantendo a mesma hora", alone("Benício"))).toBe(true);
    expect(self("joga a Oluwaseun pras 15h e conserva o dia dela", "conserva o dia dela", alone("Oluwaseun"), "date")).toBe(true);
  });
  it.each([
    ["a negated keep", "passa a Yolanda pra sexta, não mantém o horário dela", "mantém o horário dela", alone("Yolanda")],
    ["'sem' before the keep", "passa a Yolanda pra sexta sem manter o horário", "manter o horário", alone("Yolanda")],
    ["a possessive against the owner's own article", "passa o Benício pra sexta, mantém o horário dela", "mantém o horário dela", alone("Benício")],
    ["a possessive with no determiner before the customer", "passa Benício pra sexta, mantém o horário dele", "mantém o horário dele", alone("Benício")],
    ["a possessive while the request names someone else", "passa a Yolanda pra sexta, mantém o horário dela", "mantém o horário dela", { customer: "Yolanda", others: ["Ingrid"] }],
    ["a genitive naming another person", "passa a Yolanda pra sexta, mantém o horário da Ingrid", "mantém o horário", alone("Yolanda")],
    ["a clock of its own", "passa a Yolanda pra sexta, mantém o horário das 10", "mantém o horário", alone("Yolanda")],
    ["a daypart qualifier after it", "passa a Yolanda pra sexta, mantém o horário de manhã", "mantém o horário", alone("Yolanda")],
    ["a comparative after it", "passa a Yolanda pra sexta, mantém o horário igual ao da Ingrid", "mantém o horário", alone("Yolanda")],
    ["the head of the other field", "passa a Yolanda pra sexta, mantém o dia", "mantém o dia", alone("Yolanda")],
    ["a keep verb in another clause", "mantém, passa a Yolanda pra sexta no horário", "o horário", alone("Yolanda")],
    ["a word outside the shape", "passa a Yolanda pra sexta, mantém o horário combinado", "mantém o horário combinado", alone("Yolanda")],
  ] as const)("refuses %s", (_label, text, literal, holder) => { expect(self(text, literal, holder)).toBe(false); });
  it("without a holder (historical callers) or with the flag off, the historical refusal", () => {
    const text = "passa a Yolanda pra sexta, mantém o horário dela";
    expect(self(text, "mantém o horário dela")).toBe(false);
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    expect(self(text, "mantém o horário dela", alone("Yolanda"))).toBe(false);
  });
  it("the historical genitive guard is unchanged: 'no mesmo horário dela' stays refused", () => {
    expect(self("passa a Yolanda pra sexta no mesmo horário dela", "no mesmo horário", alone("Yolanda"))).toBe(false);
  });
});

const op = (item_key: string, operation: string, source_scope: string, fields: Record<string, unknown> = {}) =>
  ({ operation, item_key, depends_on: null, released_slot_of: null, same_as: null, source_scope, customer_name: null, ...fields }) as unknown as SelectedOperation;

describe("rule 7: a pronoun after a move and a new appointment in the slot it frees", () => {
  const text = "passa a Yolanda de quinta pra sexta às 16h, na vaga dela põe a Ingrid pra escova, e cancela o sábado dela que ela vai viajar";
  const move = op("m", "appointment.change", "passa a Yolanda de quinta pra sexta às 16h", { customer_name: "Yolanda" });
  const fill = op("f", "appointment.create", "na vaga dela põe a Ingrid pra escova", { customer_name: "Ingrid", released_slot_of: "m", depends_on: ["m"] });
  const cancel = (customer: string | null, scope = "e cancela o sábado dela que ela vai viajar") => op("c", "appointment.cancel", scope, { customer_name: customer });
  it("the bare pronoun is the moved customer, whatever Luna picked (the other customer, or nobody)", () => {
    for (const pick of ["Ingrid", null, "Yolanda"]) {
      const c = cancel(pick);
      expect(pronounReferent(text, c, [move, fill, c]), String(pick)).toEqual({ kind: "TOPIC", customer: "Yolanda" });
    }
  });
  it("another cue wins: the action names someone (in its clause or in the unclaimed text before it)", () => {
    const named = "passa a Yolanda de quinta pra sexta às 16h, na vaga dela põe a Ingrid pra escova. ah, a Ingrid tinha o sábado né, cancela o horário dela";
    const c = op("c", "appointment.cancel", "cancela o horário dela", { customer_name: "Ingrid" });
    expect(pronounReferent(named, c, [move, op("f", "appointment.create", "na vaga dela põe a Ingrid pra escova", { customer_name: "Ingrid", released_slot_of: "m" }), c])).toBeUndefined();
    const inClause = cancel("Ingrid", "e cancela o sábado da Ingrid que ela vai viajar");
    expect(pronounReferent(text.replace("sábado dela", "sábado da Ingrid"), inClause, [move, fill, inClause])).toBeUndefined();
  });
  it("adversarial: the moved customer's own article contradicts the pronoun: never the topic; the other reading asked unless it is Luna's own", () => {
    const mixed = "passa o Benício de quinta pra sexta às 16h, na vaga dele põe a Ingrid pra escova, e cancela o sábado dela que ela vai viajar";
    const m = op("m", "appointment.change", "passa o Benício de quinta pra sexta às 16h", { customer_name: "Benício" });
    const f = op("f", "appointment.create", "na vaga dele põe a Ingrid pra escova", { customer_name: "Ingrid", released_slot_of: "m" });
    const wrong = cancel("Benício");
    expect(pronounReferent(mixed, wrong, [m, f, wrong])).toEqual({ kind: "AMBIGUOUS" });
    const agreeing = cancel("Ingrid");
    expect(pronounReferent(mixed, agreeing, [m, f, agreeing])).toBeUndefined();
  });
  it.each([
    ["a demonstrative beside the pronoun", "e cancela o sábado dela, dessa aí"],
    ["an alterity word beside the pronoun", "e cancela o sábado da outra, que ela vai viajar"],
    ["a plural pronoun", "e cancela o sábado delas"],
    ["an ordinal beside the pronoun", "e cancela o sábado da primeira, que ela vai viajar"],
    ["pronouns of both genders", "e cancela o sábado dela que ele vai viajar"],
  ] as const)("adversarial: %s is not a bare pronoun: Luna's pick is asked", (_label, scope) => {
    const said = `passa a Yolanda de quinta pra sexta às 16h, na vaga dela põe a Ingrid pra escova, ${scope}`, c = cancel("Ingrid", scope);
    expect(pronounReferent(said, c, [move, fill, c])).toEqual({ kind: "AMBIGUOUS" });
  });
  it("a cue word with no personal pronoun keeps the historical path (it may not name a person: 'nesse dia')", () => {
    for (const scope of ["e cancela o sábado da outra", "e remarca o sábado pra esse dia"]) {
      const said = `passa a Yolanda de quinta pra sexta às 16h, na vaga dela põe a Ingrid pra escova, ${scope}`, c = cancel("Ingrid", scope);
      expect(pronounReferent(said, c, [move, fill, c]), scope).toBeUndefined();
    }
  });
  it("adversarial: without the move + released slot pattern (two creates), a pronoun between two persons is asked, never Luna's pick", () => {
    const said = "marca a Yolanda sexta às 16h pra escova, marca a Ingrid sexta às 17h pra escova e cancela o sábado dela";
    const a = op("a", "appointment.create", "marca a Yolanda sexta às 16h pra escova", { customer_name: "Yolanda" });
    const b = op("b", "appointment.create", "marca a Ingrid sexta às 17h pra escova", { customer_name: "Ingrid" });
    const c = op("c", "appointment.cancel", "e cancela o sábado dela", { customer_name: "Ingrid" });
    expect(pronounReferent(said, c, [a, b, c])).toEqual({ kind: "AMBIGUOUS" });
  });
  it("adversarial: two moves each with a new appointment in its slot: no single topic, asked", () => {
    const said = "passa a Yolanda pra sexta, põe a Ingrid na vaga, passa a Tuane pra sábado, põe a Céu na vaga e cancela o domingo dela";
    const ops = [op("m1", "appointment.change", "passa a Yolanda pra sexta", { customer_name: "Yolanda" }), op("f1", "appointment.create", "põe a Ingrid na vaga", { customer_name: "Ingrid", released_slot_of: "m1" }),
      op("m2", "appointment.change", "passa a Tuane pra sábado", { customer_name: "Tuane" }), op("f2", "appointment.create", "põe a Céu na vaga", { customer_name: "Céu", released_slot_of: "m2" })];
    const c = op("c", "appointment.cancel", "e cancela o domingo dela", { customer_name: "Yolanda" });
    expect(pronounReferent(said, c, [...ops, c])).toEqual({ kind: "AMBIGUOUS" });
  });
  it("adversarial: a pronoun said BEFORE the new appointment in the slot is not rule 7 (asked)", () => {
    const said = "passa a Yolanda de quinta pra sexta às 16h, cancela o sábado dela, e na vaga põe a Ingrid pra escova";
    const m = op("m", "appointment.change", "passa a Yolanda de quinta pra sexta às 16h", { customer_name: "Yolanda" });
    const c = op("c", "appointment.cancel", "cancela o sábado dela", { customer_name: "Ingrid" }), f = op("f", "appointment.create", "e na vaga põe a Ingrid pra escova", { customer_name: "Ingrid", released_slot_of: "m" });
    expect(pronounReferent(said, c, [m, c, f])).toEqual({ kind: "AMBIGUOUS" });
  });
  it("historical path: one person only, no pronoun, a clause that is no verbatim quote, a message op, or the flag off", () => {
    const single = "passa a Yolanda pra sexta e cancela o sábado dela", m = op("m", "appointment.change", "passa a Yolanda pra sexta", { customer_name: "Yolanda" });
    const c1 = op("c", "appointment.cancel", "e cancela o sábado dela", { customer_name: "Yolanda" });
    expect(pronounReferent(single, c1, [m, c1])).toBeUndefined();
    const c2 = cancel("Ingrid", "e cancela o sábado");
    expect(pronounReferent(text.replace(" dela que ela vai viajar", ""), c2, [move, fill, c2])).toBeUndefined();
    const c3 = cancel("Ingrid", "e cancela o sábado da cliente que vai viajar");
    expect(pronounReferent(text, c3, [move, fill, c3])).toBeUndefined();
    const message = op("c", "customer.message", "e avisa ela", { customer_name: null });
    expect(pronounReferent(`${text} e avisa ela`, message, [move, fill, message])).toBeUndefined();
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const c4 = cancel("Ingrid");
    expect(pronounReferent(text, c4, [move, fill, c4])).toBeUndefined();
  });
});

describe("rule 8: a block between the two appointments just defined", () => {
  const span = (message: string, scope: string, customers: [string, string] = ["Yolanda", "Ingrid"]) => {
    const at = message.indexOf(scope), found = betweenBookingsSpan(message, [at, at + scope.length], "schedule.block", customers, tz, now);
    return found && message.slice(found[0], found[1]);
  };
  const lead = "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia e a Ingrid às 11 pra drenagem tb com ela, ";
  it.each([
    ["e bloqueia a Hortênsia entre uma e outra que ela tem curso", "entre uma e outra"],
    ["e bloqueia a Hortênsia entre um e o outro", "entre um e o outro"],
    ["e bloqueia a Hortênsia entre os dois atendimentos pra almoçar", "entre os dois atendimentos"],
    ["e bloqueia a Hortênsia entre elas", "entre elas"],
    ["e bloqueia a Hortênsia entre esses horários, e avisa a equipe", "entre esses horários"],
    ["e bloqueia a Hortênsia entre a Ingrid e a Yolanda", "entre a Ingrid e a Yolanda"],
  ] as const)("accepts %s", (scope, construct) => { expect(span(lead + scope, scope)).toBe(construct); });
  it.each([
    ["a negated block", "e não bloqueia a Hortênsia entre uma e outra"],
    ["a clock range", "e bloqueia a Hortênsia entre 10 e 11"],
    ["a clock reading of 'as duas'", "e bloqueia a Hortênsia entre as duas"],
    ["a numeral pair", "e bloqueia a Hortênsia entre uma e duas"],
    ["a daypart qualifier", "e bloqueia a Hortênsia entre uma e outra de manhã"],
    ["a limit word after it", "e bloqueia a Hortênsia entre uma e outra até o almoço"],
    ["an exclusion after a comma", "e bloqueia a Hortênsia entre elas, sem ser no almoço"],
    ["a qualifier right after it", "e bloqueia a Hortênsia entre uma e outra consulta"],
    ["one customer's name only", "e bloqueia a Hortênsia entre a Ingrid e o almoço"],
    ["the same customer twice", "e bloqueia a Hortênsia entre a Ingrid e a Ingrid"],
    ["two 'entre'", "e bloqueia a Hortênsia entre uma e outra, entre elas"],
    ["no 'entre' at all", "e bloqueia a Hortênsia depois da Yolanda"],
  ] as const)("adversarial: refuses %s", (_label, scope) => { expect(span(lead + scope, scope)).toBeUndefined(); });
  it("flag off: nothing", () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    expect(span(lead + "e bloqueia a Hortênsia entre uma e outra", "e bloqueia a Hortênsia entre uma e outra")).toBeUndefined();
  });
  const slot = (start: string, end: string, pro = "pro-h"): BookedSlot => ({ startLocal: start, endLocal: end, professional_ref: pro, professional_name: "Hortênsia Lobo" });
  it("the free interval is the first one's end to the second one's start, in either order", () => {
    const gap = { date: "2026-10-01", time: "10:00", end_time: "11:00", professional: { ref: "pro-h", name: "Hortênsia Lobo" } };
    expect(betweenBookingsGap([slot("2026-10-01T09:00", "2026-10-01T10:00"), slot("2026-10-01T11:00", "2026-10-01T11:45")])).toEqual(gap);
    expect(betweenBookingsGap([slot("2026-10-01T11:00", "2026-10-01T11:45"), slot("2026-10-01T09:00", "2026-10-01T10:00")])).toEqual(gap);
  });
  it.each([
    ["touching appointments (no free interval)", [slot("2026-10-01T09:00", "2026-10-01T10:00"), slot("2026-10-01T10:00", "2026-10-01T11:00")]],
    ["overlapping appointments", [slot("2026-10-01T09:00", "2026-10-01T10:30"), slot("2026-10-01T10:00", "2026-10-01T11:00")]],
    ["two professionals", [slot("2026-10-01T09:00", "2026-10-01T10:00"), slot("2026-10-01T11:00", "2026-10-01T12:00", "pro-x")]],
    ["two days", [slot("2026-10-01T09:00", "2026-10-01T10:00"), slot("2026-10-02T11:00", "2026-10-02T12:00")]],
  ] as const)("adversarial: no interval for %s", (_label, slots) => { expect(betweenBookingsGap(slots as unknown as [BookedSlot, BookedSlot])).toBeUndefined(); });
});
