import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedOperation } from "@everflair/salon-secretary";
import { selfReferenceProven, distributiveReferenceProven, pickReadRow, readOrdinal, referenceLiteralProven, referenceSetOutcome, type ReadRow } from "../secretary-same-as";
import { statedRecurrence, recurrenceFromTurn, recurrenceQuestion, recurrenceNotice } from "../secretary-recurrence";

/** Fixer of the adversarial reviews A and B of Candidate 4, phase 3: the pure rules (structure only; no tenant, no model).
 * Diverse synthetic names (a brow/nail studio with a barber chair); no gender is inferred from any name. */
const tz = "America/Sao_Paulo", now = new Date("2026-09-28T15:00:00Z");
beforeEach(() => { vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true"); vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "true"); });
afterEach(() => vi.unstubAllEnvs());

describe("A1 D-SELF: only the destination's own temporal words may follow 'no mesmo horário' in its clause", () => {
  const self = (text: string, literal = "no mesmo horário") => selfReferenceProven(text, literal, [0, text.length], "appointment.change", tz, now, "time");
  it.each([
    "passa o Ravi pra sexta no mesmo horário que a Yumi", "passa o Ravi pra sexta no mesmo horário que o da Yumi", "passa o Ravi pra sexta no mesmo horário, o da Yumi",
    "passa o Ravi pra sexta no mesmo horário como a Yumi", "passa o Ravi pra sexta no mesmo horário, igual a Yumi", "passa o Ravi pra sexta no mesmo horário junto com a Yumi",
    "passa o Ravi junto com a Yumi pra sexta no mesmo horário", "passa o Ravi pra sexta no mesmo horário da Yumi", "passa o Ravi pra sexta no mesmo horário dela",
    "passa o Ravi pra sexta no mesmo horário de sempre", "passa o Ravi pra sexta no mesmo horário tipo o da Yumi",
  ])("%j: another term of comparison, never the move's own clock", text => { expect(self(text)).toBe(false); });
  it("'no horário igual' followed by 'ao da Yumi' is refused as well", () => { expect(self("passa o Ravi pra sexta no horário igual ao da Yumi", "no horário igual")).toBe(false); });
  it.each([
    "passa o Ravi pra sexta no mesmo horário", "passa o Ravi no mesmo horário pra sexta", "passa o Ravi no mesmo horário na sexta que vem",
    "passa o Ravi pra sexta no mesmo horário e a Zuri pra sábado às 10h", "passa o Ravi pra sexta no mesmo horário, por favor", "passa o Ravi pra sexta no mesmo horário.",
  ])("%j: the move's own clock", text => { expect(self(text)).toBe(true); });
  it("a negated self reference is still refused", () => { expect(self("passa o Ravi pra sexta mas não no mesmo horário")).toBe(false); });
});

describe("A2 D2: an ordinal is taken only from a literal of the closed classes", () => {
  const row = (i: number, start: string): ReadRow => ({ appointment_ref: `apt-${i}`, customer_ref: `c-${i}`, customer_name: `Cliente ${i}`, professional_name: "Iara Botelho",
    start_local: start, start_at: new Date(`${start}:00-03:00`).toISOString(), status: "CONFIRMED" });
  const day = [row(0, "2026-09-29T09:00"), row(1, "2026-09-29T11:00"), row(2, "2026-09-29T16:00")];
  it.each(["a primeira cliente da tarde dela", "o último cliente dela de manhã", "o último depois das 15h", "o primeiro de sexta", "a última cliente da Zuri"])("%j: a card of the rows, never a pick", literal => {
    expect(pickReadRow(day, literal, now, true, ["Iara Botelho"])).toMatchObject({ kind: "CARD" });
  });
  it("a single row qualified by the owner is a card of it (a click), never a pick", () => {
    expect(pickReadRow(day.slice(0, 1), "a cliente da tarde dela", now)).toMatchObject({ kind: "CARD", rows: [{ appointment_ref: "apt-0" }] });
  });
  it("the read's own subject and a restatement of its own day keep the ordinal", () => {
    expect(pickReadRow(day, "o último cliente da Iara", now, true, ["Iara Botelho"])).toMatchObject({ kind: "ROW", row: { appointment_ref: "apt-2" } });
    expect(pickReadRow(day, "o primeiro dela amanhã", now, true, [], new Set(["amanha"]))).toMatchObject({ kind: "ROW", row: { appointment_ref: "apt-0" } });
    expect(pickReadRow(day, "o último cliente dela de amanhã", now, true, [], new Set(["amanha"]))).toMatchObject({ kind: "ROW", row: { appointment_ref: "apt-2" } });
    expect(pickReadRow(day, "o primeiro dela amanhã", now)).toMatchObject({ kind: "CARD" });
    expect(readOrdinal("o último cliente dela")).toBe("last");
    expect(readOrdinal("a última cliente da tarde")).toBeUndefined();
  });
  it("a customer reference that states a daypart is not a reference (V2 only)", () => {
    const text = "passa a primeira cliente da tarde dela pra sexta";
    expect(referenceLiteralProven(text, "a primeira cliente da tarde dela", [0, text.length], "appointment.change", [], tz, now, "customer")).toBe(false);
    const plain = "passa a cliente dela pra sexta";
    expect(referenceLiteralProven(plain, "a cliente dela", [0, plain.length], "appointment.change", [], tz, now, "customer")).toBe(true);
    // Flag off (Candidate 3): the historical proof, byte for byte in behaviour.
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const control = "marca a Zuri com a mesma profissional da tarde";
    expect(referenceLiteralProven(control, "com a mesma profissional da tarde", [0, control.length], "appointment.create", [], tz, now, "professional")).toBe(true);
  });
});

describe("A3/A4 D4: this action's own region (its clause and the unclaimed text around it)", () => {
  const neutral = { target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
  const kaique = { ...neutral, operation: "appointment.create", item_key: "kai", depends_on: [], released_slot_of: null, source_scope: "marca o Kaique amanhã às 10h com a Iara", customer_name: "Kaique",
    professional_name: "Iara", day_offset: 1, temporal_evidence: [{ field: "date", text: "amanhã" }] } as unknown as SelectedOperation;
  const check = (text: string, clause: string, literal: string, field: "date" | "professional", directory: string[] = []) => {
    const sibling = "marca o Kaique amanhã às 10h com a Iara", mine = [text.indexOf(sibling), text.indexOf(sibling) + sibling.length] as const;
    const own = [text.indexOf(clause), text.indexOf(clause) + clause.length] as const;
    return distributiveReferenceProven(text, literal, field, own, { op: kaique, clause: mine }, [mine, own], "appointment.create", directory);
  };
  it.each(["a Maitê no dia seguinte às 11h", "a Maitê no próximo dia às 11h", "a Maitê noutro dia às 11h", "a Maitê na véspera às 11h", "a Maitê no feriado às 11h", "a Maitê no mês que vem às 11h",
    "a Maitê doutra vez às 11h"])("own day %j: never the sibling's", clause => {
    expect(check(`marca o Kaique amanhã às 10h com a Iara e ${clause}`, clause, "amanhã", "date")).toBe(false);
  });
  it("an unclaimed tail with its own day or another professional belongs to this action", () => {
    expect(check("marca o Kaique amanhã às 10h com a Iara e a Maitê às 11h, essa na sexta", "a Maitê às 11h", "amanhã", "date")).toBe(false);
    expect(check("marca o Kaique amanhã às 10h com a Iara e a Maitê às 11h, só que com outra pessoa", "a Maitê às 11h", "com a Iara", "professional")).toBe(false);
  });
  it("a professional of this action's own region: 'com …', 'comigo', or a word of the salon's team", () => {
    expect(check("marca o Kaique amanhã às 10h com a Iara e a Maitê às 11h com o Cauã", "a Maitê às 11h com o Cauã", "com a Iara", "professional")).toBe(false);
    expect(check("marca o Kaique amanhã às 10h com a Iara e a Maitê às 11h comigo", "a Maitê às 11h comigo", "com a Iara", "professional")).toBe(false);
    expect(check("marca o Kaique amanhã às 10h com a Iara e a Maitê às 11h na agenda do Cauã", "a Maitê às 11h na agenda do Cauã", "com a Iara", "professional", ["Iara Botelho", "Cauã Moreira"])).toBe(false);
  });
  it("controls: a plain coordinated clause and a shared suffix still link", () => {
    expect(check("marca o Kaique amanhã às 10h com a Iara e a Maitê às 11h", "a Maitê às 11h", "amanhã", "date")).toBe(true);
    expect(check("marca o Kaique amanhã às 10h com a Iara e a Maitê às 11h", "a Maitê às 11h", "com a Iara", "professional", ["Iara Botelho", "Cauã Moreira"])).toBe(true);
  });
});

describe("A5/B7: one resolver for a set of values (first preparation and every follow)", () => {
  const services = { services: [{ ref: "s-sobr", name: "Design de sobrancelha" }, { ref: "s-henna", name: "Henna" }] };
  it("several services: a card; with MULTI_SERVICE and a create outside a released slot, the whole list", () => {
    expect(referenceSetOutcome({ operation: "appointment.create", released_slot_of: undefined }, "service", services)).toMatchObject({ card: { kind: "service_ref" }, code: "SAME_AS_SERVICE_CARD" });
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true");
    expect(referenceSetOutcome({ operation: "appointment.create", released_slot_of: undefined }, "service", services)).toMatchObject({ list: { refs: ["s-sobr", "s-henna"] }, code: "SAME_AS_SEEDED_LIST" });
    expect(referenceSetOutcome({ operation: "appointment.create", released_slot_of: "c" }, "service", services)).toMatchObject({ card: { kind: "service_ref" } });
    expect(referenceSetOutcome({ operation: "appointment.create", released_slot_of: undefined }, "service", { service: { ref: "s-sobr", name: "Design de sobrancelha" } })).toBeUndefined();
  });
  it("a read's rows: card, refusal of the named row, or asked", () => {
    const row = { appointment_ref: "a", customer_ref: "c", customer_name: "Zuri Mensah", professional_name: "Iara Botelho", start_local: "2026-09-29T11:00", start_at: "", status: "IN_PROGRESS" };
    expect(referenceSetOutcome({ operation: "appointment.change", released_slot_of: undefined }, "customer", { pick: { kind: "CARD", rows: [row] } })).toMatchObject({ card: { kind: "appointment_ref", items: [{ id: "a" }] } });
    expect(referenceSetOutcome({ operation: "appointment.change", released_slot_of: undefined }, "customer", { pick: { kind: "REFUSED", row } })).toMatchObject({ asked: "customer", code: "SAME_AS_READ_REFUSED" });
    expect(referenceSetOutcome({ operation: "appointment.change", released_slot_of: undefined }, "customer", { pick: { kind: "NONE" } })).toMatchObject({ asked: "customer", code: "SAME_AS_READ_EMPTY" });
  });
});

describe("B4/B5 recurrence: the closed class, extended", () => {
  it.each([
    ["marca a Priya sexta sim, sexta não às 10", "sexta sim, sexta não"], ["uma sexta sim, outra não", "uma sexta sim, outra não"], ["quinzena sim, quinzena não", "quinzena sim, quinzena não"],
    ["marca a Priya uma vez por semana às 10, começa sexta", "uma vez por semana"], ["marca a Priya 2x por mês sexta às 10", "2x por mês"], ["duas vezes por semana, terça e quinta às 9", "duas vezes por semana"],
    ["bloqueia a agenda do Cauã todo final de semana", "todo final de semana"], ["bloqueia a agenda do Cauã nos fins de semana", "nos fins de semana"], ["bloqueia nos finais de semana", "nos finais de semana"],
    ["almoço diário das 12 às 13, bloqueia", "diário"], ["marca ela terças e quintas às 9", "terças e quintas"], ["toda 2ª às 9h", "toda 2ª"], ["às tardes", "às tardes"],
    ["marca a Ana N toda sexta às 10", "toda sexta"], ["de quinze em quinze", "de quinze em quinze"], ["de quinze em quinze, começando sexta", "de quinze em quinze"],
  ])("%j states %j", (text, expression) => { expect(statedRecurrence(text)?.expression).toBe(expression); });
  it.each(["marca as quatro de duas em duas amanhã às 9", "n toda sexta", "só uma vez", "segunda e quarta às 10", "de 15 em 15 minutos"])("%j states no recurrence", text => {
    expect(statedRecurrence(text)).toBeUndefined();
  });
  it("an adjective inside the owner's own names of the action is that name (never a construction outside them)", () => {
    expect(statedRecurrence("marca a Dandara no pacote mensal amanhã às 10", ["pacote mensal"])).toBeUndefined();
    expect(statedRecurrence("hidratação semanal da Dandara amanhã às 10", ["hidratação semanal", "Dandara"])).toBeUndefined();
    expect(statedRecurrence("marca a Dandara no pacote mensal amanhã às 10")?.expression).toBe("mensal");
    expect(statedRecurrence("marca a Dandara no pacote mensal toda sexta às 10", ["pacote mensal"])?.expression).toBe("toda sexta");
    expect(recurrenceFromTurn(undefined, "appointment.create", "marca a Dandara no pacote mensal amanhã às 10", ["pacote mensal"]).stated).toBe(false);
  });
});

describe("B6: moves and cancellations of a series name the one appointment", () => {
  it("the questions and notices", () => {
    expect(recurrenceNotice("appointment.change", "toda quinta")).toBe("Ainda não remarco séries pelo chat (“toda quinta”).");
    expect(recurrenceNotice("appointment.cancel", "toda terça")).toBe("Ainda não cancelo séries pelo chat (“toda terça”).");
    expect(recurrenceQuestion("appointment.change", "toda quinta", "2026-10-01", "15:00", undefined, "2026-09-30T14:00")).toEqual({
      message: "Ainda não remarco séries pelo chat (“toda quinta”). Remarco só o de qua, 30/09 às 14h para qui, 01/10 às 15h? Nada foi preparado para as outras datas.",
      card: { kind: "recurrence_ref", items: [{ id: "recurrence-first-only", name: "Só este: qua, 30/09 às 14h para qui, 01/10 às 15h" }] } });
    expect(recurrenceQuestion("appointment.cancel", "toda terça", "2026-09-29", "09:00", undefined, "2026-09-29T09:00").message)
      .toBe("Ainda não cancelo séries pelo chat (“toda terça”). Cancelo só o de ter, 29/09 às 9h? Nada foi preparado para as outras datas.");
    // Create/block keep their historical copy.
    expect(recurrenceQuestion("appointment.create", "toda sexta", "2026-10-02", "18:00").message).toBe("Ainda não marco horários recorrentes pelo chat (“toda sexta”). Marco só a primeira (sex, 02/10 às 18h)? Nada foi preparado para as outras datas.");
  });
});
