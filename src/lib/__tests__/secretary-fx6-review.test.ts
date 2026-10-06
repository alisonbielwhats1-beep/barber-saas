import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedOperation } from "@everflair/salon-secretary";
import { distributiveReferenceProven, pronounReferent } from "../secretary-same-as";
import { actionScopedSource } from "../secretary-sibling-scope";
import { isFirstPersonReference } from "../secretary-first-person";
import { comboCover, isSingleComboQuestion, singleServiceCombo, type ServiceLister } from "../secretary-multi-service";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** FX6 (Candidate 4 review round), pure rules behind the Candidate 4 flags. Owner rules of 29/09 (docs/DECISOES_PRODUTO.md, last section):
 * rule 7 — the moved customer (the topic) replaces a DIFFERENT pick of Luna's only on the owner's own agreeing article; a region word that
 *          shortens a person's name names that person (Luna's pick of that person stands; another pick is asked);
 * rule 5 — the two-word first-person forms ("minha agenda", "eu mesma") are the owner's own reference;
 * D4     — a day said once whose segment singles one person out ("…, só ele na quinta") is never lent to another action;
 * rule 9 — a combo's label word ("Combo", "Kit") is never a part the owner left unsaid; ONE combo found for words whose parts are also
 *          registered apart is a card on the single-service paths, never a pick.
 * No DB, no network, no model. Synthetic, diverse names; no gender is inferred from a name (only from the owner's own articles). */
const CANDIDATE = ["TEMPORAL_COMPONENTS", "TEMPORAL_POLARITY", "SAME_AS", "STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE",
  "SCHEDULING_OVERLAP_ENABLED", "MULTI_ACTION_V2_ENABLED", "DATE_RULES_V2", "DAYPART_RULES_V2", "DAYPART_BY_HOURS", "ALTER_APPOINTMENT", "MULTI_SERVICE", "EXCEPTION_RULES_V2",
  "COPY_V2", "REFERENCES_V2", "READS_V2", "RECURRENCE_GUARD"];
const flag = (name: string, on: boolean) => vi.stubEnv(`SALON_SECRETARY_${name}`, on ? "true" : "false");
beforeEach(() => { for (const name of CANDIDATE) flag(name, true); });
afterEach(() => { vi.unstubAllEnvs(); });

const op = (item_key: string, operation: string, source_scope: string, fields: Record<string, unknown> = {}) =>
  ({ operation, item_key, depends_on: null, released_slot_of: null, same_as: null, source_scope, customer_name: null, ...fields }) as unknown as SelectedOperation;

describe("rule 7: the topic never overrides Luna's pick without the owner's own evidence", () => {
  const plan = (text: string, moved: string, filler: string, pick: string | null, scope = "e cancela o sábado dela que ela vai viajar") => {
    const moveScope = text.slice(0, text.indexOf(",")), fillScope = text.slice(text.indexOf(",") + 2, text.lastIndexOf(","));
    const move = op("m", "appointment.change", moveScope, { customer_name: moved });
    const fill = op("f", "appointment.create", fillScope, { customer_name: filler, released_slot_of: "m", depends_on: ["m"] });
    const cancel = op("c", "appointment.cancel", scope, { customer_name: pick });
    return pronounReferent(text, cancel, [move, fill, cancel]);
  };
  it("no article before the names: Luna's different pick is asked (never replaced by the topic); no pick or the topic itself stays the topic", () => {
    const text = "passa Graziela de quinta pra sexta às 16h, na vaga põe Valentina pra escova, e cancela o sábado dela que ela vai viajar";
    expect(plan(text, "Graziela", "Valentina", "Valentina")).toEqual({ kind: "AMBIGUOUS" });
    expect(plan(text, "Graziela", "Valentina", "Graziela")).toEqual({ kind: "TOPIC", customer: "Graziela" });
    expect(plan(text, "Graziela", "Valentina", null)).toEqual({ kind: "TOPIC", customer: "Graziela" });
  });
  it("control: the owner's article before the topic agrees with the pronoun: the topic replaces Luna's other pick (feminine and masculine)", () => {
    const fem = "passa a Graziela de quinta pra sexta às 16h, na vaga põe a Valentina pra escova, e cancela o sábado dela que ela vai viajar";
    expect(plan(fem, "Graziela", "Valentina", "Valentina")).toEqual({ kind: "TOPIC", customer: "Graziela" });
    const masc = "passa o Teodoro de quinta pra sexta às 16h, na vaga põe a Valentina pra escova, e cancela o sábado dele que ele vai viajar";
    expect(plan(masc, "Teodoro", "Valentina", "Valentina", "e cancela o sábado dele que ele vai viajar")).toEqual({ kind: "TOPIC", customer: "Teodoro" });
  });
  it("adversarial: an article of the filler agreeing while the topic has none: still asked, never the topic over Luna's pick", () => {
    const text = "passa Graziela de quinta pra sexta às 16h, na vaga põe a Valentina pra escova, e cancela o sábado dela que ela vai viajar";
    expect(plan(text, "Graziela", "Valentina", "Valentina")).toEqual({ kind: "AMBIGUOUS" });
  });
  it("a nickname in the action's region (the first letters of a name word) names that person: Luna's pick of her stands; another pick is asked", () => {
    const text = "passa a Graziela de quinta pra sexta às 16h, na vaga põe a Valentina pra escova, e cancela o sábado da Val que ela vai viajar";
    const scope = "e cancela o sábado da Val que ela vai viajar";
    expect(plan(text, "Graziela", "Valentina", "Valentina", scope)).toBeUndefined();
    expect(plan(text, "Graziela", "Valentina", "Graziela", scope)).toEqual({ kind: "AMBIGUOUS" });
    expect(plan(text, "Graziela", "Valentina", null, scope)).toBeUndefined();
    const topic = text.replace("da Val", "da Grazi"), own = scope.replace("da Val", "da Grazi");
    expect(plan(topic, "Graziela", "Valentina", "Graziela", own)).toBeUndefined();
    expect(plan(topic, "Graziela", "Valentina", "Valentina", own)).toEqual({ kind: "AMBIGUOUS" });
  });
  it("adversarial: a pronoun or another closed-class word is never read as a shortened name ('ela' is not 'Elaine')", () => {
    const text = "passa a Elaine de quinta pra sexta às 16h, na vaga põe a Valentina pra escova, e cancela o sábado dela que ela vai viajar";
    expect(plan(text, "Elaine", "Valentina", "Valentina")).toEqual({ kind: "TOPIC", customer: "Elaine" });
  });
  it("flag off: nothing (the historical path)", () => {
    flag("REFERENCES_V2", false);
    const text = "passa Graziela de quinta pra sexta às 16h, na vaga põe Valentina pra escova, e cancela o sábado dela que ela vai viajar";
    expect(plan(text, "Graziela", "Valentina", "Valentina")).toBeUndefined();
  });
});

describe("rule 5: the owner's own agenda in two words", () => {
  it.each(["minha agenda", "a minha agenda", "Minha Agenda", "meus horários", "meu horario", "eu mesma", "eu mesmo", "comigo mesma", "Eu mesma."])("'%s' is the owner's own reference", said =>
    expect(isFirstPersonReference(said)).toBe(true));
  it.each(["minha cliente", "meu irmão", "minha agenda nova", "Romeu", "Eduardo", "eu Lúcia", "mesma", "agenda", "meu mesmo", "nossa agenda"])("adversarial: '%s' is not", said =>
    expect(isFirstPersonReference(said)).toBe(false));
  it("the one-word forms keep their meaning; flag off: never", () => {
    for (const said of ["eu", "minha", "comigo", "o meu"]) expect(isFirstPersonReference(said), said).toBe(true);
    flag("REFERENCES_V2", false);
    for (const said of ["minha agenda", "eu mesma", "eu"]) expect(isFirstPersonReference(said), said).toBe(false);
  });
});

const tz = "America/Sao_Paulo", now = new Date("2026-09-29T15:00:00Z"); // Tuesday 29/09, 12h in São Paulo
const THURSDAY = "2026-10-01";
const weekday = (value: number): DayComponent => ({ kind: "WEEKDAY", offset: null, weekday: value, week: "NEAREST", day: null, month: null, year: null, days: null });
const clock = (hour: number): ClockComponent => ({ hour, minute: 0, daypart: "UNSPECIFIED" });
type Quote = { field: string; text: string; component: DayComponent | ClockComponent };
const neutral = { depends_on: [], released_slot_of: null, service_names: null, service_name: null, professional_name: null, date: null, time: null, period: null, source_date: null,
  source_time: null, end_time: null, end_date: null, reason: null, target_professional_name: null, service_changes: null, target_name: null, name: null, priceCents: null,
  durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
const move = (item_key: string, customer_name: string, source_scope: string, evidence: Quote[]) =>
  ({ ...neutral, operation: "appointment.change", item_key, customer_name, source_scope, temporal_evidence: evidence }) as unknown as SelectedOperation;
const day = (text: string): Quote => ({ field: "date", text, component: weekday(4) });
const at = (text: string, hour: number): Quote => ({ field: "time", text, component: clock(hour) });
function dayOf(message: string, ops: SelectedOperation[], key: string) {
  const own = ops.find(item => item.item_key === key)!, { operation, fields, temporal_evidence } = projectSchedulingOperation(own);
  return groundSchedulingTemporalTurn({}, fields, actionScopedSource(message, own, ops).text, tz, now, undefined, operation, temporal_evidence).fields.date;
}

describe("D4: a day said once in a segment that singles one person out is never lent to another action", () => {
  const message = "passa a Zuleica pras 2 e o Kenji pras 3, só ele na quinta";
  const both = (kenji: string) => [move("a", "Zuleica", "passa a Zuleica pras 2", [day("na quinta"), at("pras 2", 2)]), move("b", "Kenji", kenji, [day("na quinta"), at("pras 3", 3)])];
  it("Luna left the segment inside Kenji's clause: Kenji keeps Thursday; Zuleica's Thursday is not proven (asked)", () => {
    const list = both("e o Kenji pras 3, só ele na quinta");
    expect(dayOf(message, list, "b")).toBe(THURSDAY);
    expect(dayOf(message, list, "a")).toBeUndefined();
  });
  it("Luna closed both clauses before it: neither action takes the day on its own (asked), never both moved", () => {
    const list = both("e o Kenji pras 3");
    expect(dayOf(message, list, "a")).toBeUndefined();
    expect(dayOf(message, list, "b")).toBeUndefined();
  });
  it.each(["somente ele", "apenas o Kenji", "menos ela", "dele"])("adversarial: '%s' in the segment singles one out", words => {
    const text = `passa a Zuleica pras 2 e o Kenji pras 3, ${words} na quinta`, list = both("e o Kenji pras 3");
    expect(dayOf(text, list, "a")).toBeUndefined();
  });
  it("control: a distributive subject ('os dois', 'ambos', 'as duas') shares the day, in either form", () => {
    for (const words of ["os dois", "ambos", "as duas"]) {
      const text = `passa a Zuleica pras 2 e o Kenji pras 3, ${words} na quinta`;
      for (const kenji of ["e o Kenji pras 3", `e o Kenji pras 3, ${words} na quinta`]) {
        const list = both(kenji);
        expect(dayOf(text, list, "a"), `${words} | ${kenji}`).toBe(THURSDAY); expect(dayOf(text, list, "b"), `${words} | ${kenji}`).toBe(THURSDAY);
      }
    }
  });
  it("control: a day only ONE action quotes, in a segment with that person's pronoun, stays that action's (nothing is shared)", () => {
    const text = "passa a Zuleica pras 2 e o Kenji pras 3, ele prefere na quinta";
    const list = [move("a", "Zuleica", "passa a Zuleica pras 2", [at("pras 2", 2)]), move("b", "Kenji", "e o Kenji pras 3", [day("na quinta"), at("pras 3", 3)])];
    expect(dayOf(text, list, "b")).toBe(THURSDAY);
  });
  it("a trailing segment inside the last clause with no distributive subject is not cut out of it (Kenji's own clause stays Luna's)", () => {
    const text = "passa a Zuleica pras 2 e o Kenji pras 3, na quinta", list = both("e o Kenji pras 3, na quinta");
    expect(actionScopedSource(text, list[1], list)).toEqual({ text: text.replace("pras 2", "      "), scoped: true });
  });
  it("the same_as link (D4 rule): a day whose segment singles one out is not the sibling's for the other action", () => {
    const text = "marca a Lia às 9 e o Téo às 10, só ele na quinta";
    const lia = move("a", "Lia", "marca a Lia às 9", [at("às 9", 9)]), teo = move("b", "Téo", "e o Téo às 10", [day("na quinta"), at("às 10", 10)]);
    const span = (scope: string) => [text.indexOf(scope), text.indexOf(scope) + scope.length] as const;
    const clauses = [span("marca a Lia às 9"), span("e o Téo às 10")];
    expect(distributiveReferenceProven(text, "na quinta", "date", clauses[0], { op: teo, clause: clauses[1] }, clauses, "appointment.change")).toBe(false);
    const shared = text.replace("só ele", "os dois");
    expect(distributiveReferenceProven(shared, "na quinta", "date", clauses[0], { op: teo, clause: clauses[1] }, clauses, "appointment.change")).toBe(true);
    void lia;
  });
  it("flag off: views unchanged by this rule", () => {
    flag("REFERENCES_V2", false);
    const list = both("e o Kenji pras 3, só ele na quinta");
    expect(actionScopedSource(message, list[0], list).text).toContain("na quinta");
  });
});

type Row = { id: string; name: string };
const lister = (catalog: readonly Row[]): ServiceLister => async name => {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return catalog.filter(row => fold(row.name).includes(fold(name.trim())));
};
describe("rule 9: combo label words and the single-service paths", () => {
  const combo = { id: "k-che", name: "Combo hidratação e escova" }, hid = { id: "k-hid", name: "Hidratação" }, esc = { id: "k-esc", name: "Escova" };
  it("a label word naming no service apart ('Combo') is never an unsaid part; a word that names a service apart is", async () => {
    expect(await comboCover(lister([combo]), "hidratação e escova")).toMatchObject({ combos: [combo], apart: false, unsaid: [] });
    const progressive = { id: "p-combo", name: "Escova progressiva e hidratação" };
    expect(await comboCover(lister([progressive]), "escova e hidratação")).toMatchObject({ apart: false, unsaid: [] });
    expect(await comboCover(lister([progressive, { id: "p-prog", name: "Progressiva" }]), "escova e hidratação")).toMatchObject({ unsaid: ["Escova progressiva"] });
  });
  it("one combo found for words whose parts exist apart: a card of that combo, with the reason (never a pick)", async () => {
    const card = await singleServiceCombo(lister([combo, hid, esc]), "hidratacao e escova", [combo]);
    expect(card).toEqual({ items: [combo], notice: expect.stringContaining("“Combo hidratação e escova” já junta hidratacao e escova, e esses serviços também existem separados") });
    expect(isSingleComboQuestion(card!.notice)).toBe(true);
  });
  it("the combo alone registered (rule 9, case 1), the owner writing the combo's registered name, a homonym search or a single part: no card", async () => {
    expect(await singleServiceCombo(lister([combo]), "hidratação e escova", [combo])).toBeUndefined();
    expect(await singleServiceCombo(lister([combo, hid, esc]), "Combo hidratação e escova", [combo])).toBeUndefined();
    expect(await singleServiceCombo(lister([combo, hid, esc]), "hidratação e escova", [combo, hid])).toBeUndefined();
    expect(await singleServiceCombo(lister([combo, hid, esc]), "hidratação", [hid])).toBeUndefined();
  });
  it("flag off: never a card", async () => {
    flag("MULTI_SERVICE", false);
    expect(await singleServiceCombo(lister([combo, hid, esc]), "hidratacao e escova", [combo])).toBeUndefined();
  });
});
