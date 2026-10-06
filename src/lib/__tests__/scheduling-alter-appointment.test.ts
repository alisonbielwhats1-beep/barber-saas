import { afterEach, describe, expect, it, vi } from "vitest";
import { discardNotice, conversationalClarifications, type PlanAction, type ActionPlan } from "@everflair/salon-secretary";
import { actionSnapshot, alteredServiceIds, alterationFromFields, schedulingActionPreview, type ActionSnapshot } from "../scheduling-mutations";
import { schedulingMissingRequired, schedulingRequiredFields, schedulingAlteration, schedulingPatch, schedulingResolved } from "../scheduling-contract";
import { actionTitle, confirmationLabel, legacyConfirmLabel } from "../secretary-ui";
import type { SecretaryView } from "../salon-secretary";

/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT): pure parts of "alterar dados de um agendamento" — the resulting service list
 * (swap in place, refusals, never a guess), what a change's fields ask for, what a kept slot requires, the ANTES → DEPOIS
 * preview (services, professional, slot, duration, price, customer acceptance) and the labels. Services of a barbershop
 * ("pezinho"), a nail salon, an aesthetics studio, a lash studio and a spa. */
afterEach(() => { vi.unstubAllEnvs(); });
const change = (mode: "SET" | "INCLUDE" | "REMOVE", ref: string) => ({ mode, ref });

describe("alteredServiceIds: the list an alteration asks for", () => {
  it("SET is the complete new list (in the owner's order, without repeats)", () => {
    expect(alteredServiceIds(["s-corte"], [change("SET", "s-barba"), change("SET", "s-pezinho")])).toEqual({ ids: ["s-barba", "s-pezinho"] });
    expect(alteredServiceIds(["s-corte"], [change("SET", "s-barba"), change("SET", "s-barba")])).toEqual({ ids: ["s-barba"] });
  });
  it("INCLUDE appends; REMOVE takes out; a swap keeps the position of what it replaces", () => {
    expect(alteredServiceIds(["s-pe"], [change("INCLUDE", "s-mao")])).toEqual({ ids: ["s-pe", "s-mao"] });
    expect(alteredServiceIds(["s-limpeza", "s-peeling"], [change("REMOVE", "s-peeling")])).toEqual({ ids: ["s-limpeza"] });
    expect(alteredServiceIds(["s-corte", "s-barba", "s-pezinho"], [change("REMOVE", "s-barba"), change("INCLUDE", "s-sobrancelha")])).toEqual({ ids: ["s-corte", "s-sobrancelha", "s-pezinho"] });
    expect(alteredServiceIds(["s-volume-russo", "s-manutencao"], [change("INCLUDE", "s-lifting"), change("REMOVE", "s-volume-russo")])).toEqual({ ids: ["s-lifting", "s-manutencao"] });
  });
  it("refuses, never guesses: the only service, one the appointment does not have, one it already has, more than 10, SET mixed with a delta", () => {
    expect(alteredServiceIds(["s-massagem"], [change("REMOVE", "s-massagem")])).toEqual({ error: "SERVICE_CHANGE_EMPTY" });
    expect(alteredServiceIds(["s-corte"], [change("REMOVE", "s-barba")])).toEqual({ error: "SERVICE_NOT_IN_APPOINTMENT", index: 0 });
    expect(alteredServiceIds(["s-corte", "s-barba"], [change("INCLUDE", "s-pezinho"), change("INCLUDE", "s-barba")])).toEqual({ error: "SERVICE_ALREADY_IN_APPOINTMENT", index: 1 });
    expect(alteredServiceIds(Array.from({ length: 10 }, (_, i) => `s-${i}`), [change("INCLUDE", "s-extra")])).toEqual({ error: "SERVICE_CHANGE_TOO_MANY" });
    expect(alteredServiceIds(["s-corte"], [change("SET", "s-barba"), change("INCLUDE", "s-pezinho")])).toEqual({ error: "SERVICE_CHANGE_MIXED" });
  });
});

describe("alterationFromFields: what a change's fields alter", () => {
  const fields = { appointment_ref: "a-1", target_professional_name: "Yasmin", target_professional_ref: "p-yasmin", service_changes: [{ mode: "INCLUDE" as const, service_name: "barba" }], service_changes_ref: ["s-barba"] };
  it("nothing to alter is empty, with the flag off too (a plain reschedule is untouched)", () => {
    expect(alterationFromFields({ appointment_ref: "a-1", date: "2026-10-02", time: "15:00" }, ["s-corte"])).toEqual({});
  });
  it("flag off: an alteration never reaches the domain", () => {
    vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "false");
    expect(() => alterationFromFields(fields, ["s-corte"])).toThrow("ALTER_APPOINTMENT_DISABLED");
  });
  it("flag on: the new professional and the resulting list; an unresolved name or a refused delta never executes", () => {
    vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "true");
    expect(alterationFromFields(fields, ["s-corte"])).toEqual({ professional_ref: "p-yasmin", service_ids: ["s-corte", "s-barba"] });
    expect(() => alterationFromFields({ ...fields, target_professional_ref: undefined }, ["s-corte"])).toThrow("NEEDS_INPUT");
    expect(() => alterationFromFields({ ...fields, service_changes_ref: [null] }, ["s-corte"])).toThrow("NEEDS_INPUT");
    expect(() => alterationFromFields({ ...fields, service_changes: [{ mode: "REMOVE", service_name: "barba" }] }, ["s-corte"])).toThrow("SERVICE_NOT_IN_APPOINTMENT");
  });
});

describe("what a change requires: the slot is kept only when no destination was said", () => {
  it("a plain change still needs the destination day and clock", () => {
    expect(schedulingRequiredFields("appointment.change", { appointment_ref: "a-1" })).toEqual(["appointment_ref", "date", "time"]);
    expect(schedulingMissingRequired("appointment.change", { appointment_ref: "a-1", time: "15:00" })).toEqual(["date"]);
    expect(schedulingAlteration({ appointment_ref: "a-1" })).toBe(false);
  });
  it("only a new professional or services: no day or clock is required (the appointment's own start)", () => {
    expect(schedulingMissingRequired("appointment.change", { appointment_ref: "a-1", target_professional_name: "Yasmin", target_professional_ref: "p-st" })).toEqual([]);
    expect(schedulingMissingRequired("appointment.change", { appointment_ref: "a-1", service_changes: [{ mode: "SET", service_name: "esmaltação em gel" }], service_changes_ref: ["s-gel"] })).toEqual([]);
  });
  it("a day without a clock still asks the clock (GF14); a period is a destination too; names must be resolved", () => {
    expect(schedulingMissingRequired("appointment.change", { appointment_ref: "a-1", target_professional_ref: "p-st", date: "2026-10-02" })).toEqual(["time"]);
    expect(schedulingMissingRequired("appointment.change", { appointment_ref: "a-1", target_professional_ref: "p-st", period: "afternoon" })).toEqual(["date", "time"]);
    expect(schedulingMissingRequired("appointment.change", { appointment_ref: "a-1", target_professional_name: "Yasmin" })).toEqual(["target_professional_ref"]);
    expect(schedulingMissingRequired("appointment.change", { appointment_ref: "a-1", service_changes: [{ mode: "INCLUDE", service_name: "hidratação" }, { mode: "INCLUDE", service_name: "pezinho" }], service_changes_ref: ["s-hid", null] })).toEqual(["service_changes_ref"]);
  });
  it("other operations are unchanged; the domain patch keeps the service delta strict", () => {
    expect(schedulingRequiredFields("appointment.cancel", { appointment_ref: "a-1", target_professional_ref: "p-st" })).toEqual(["appointment_ref", "reason"]);
    expect(() => schedulingPatch.parse({ service_changes: [{ mode: "TROCA", service_name: "barba" }] })).toThrow();
    expect(() => schedulingPatch.parse({ service_changes: [{ mode: "SET", service_name: "barba", service_ref: "s-barba" }] })).toThrow();
    expect(schedulingResolved.parse({ service_changes: [{ mode: "SET", service_name: "barba" }], service_changes_ref: [null] })).toMatchObject({ service_changes_ref: [null] });
  });
});

const service = (id: string, name: string, durationMin: number, priceCents: number, priceType = "FIXED") => ({ id, name, durationMin, priceCents, priceType, priceNote: null, processingMin: 0, finishingMin: 0 });
const base: ActionSnapshot = actionSnapshot.parse({ kind: "appointment.change", appointment_ref: "a-luana", revision: 3, customer_ref: "c-luana", customer_name: "Luana Prado",
  professional_ref: "p-jonas", professional_name: "Jonas Ferraz", timezone: "America/Sao_Paulo", before_start: "2026-10-01T14:00", before_end: "2026-10-01T14:30", before_timezone: "America/Sao_Paulo",
  startLocal: "2026-10-01T14:00", endLocal: "2026-10-01T14:30", priceCents: 4000, services: [service("s-corte", "Corte", 30, 4000)], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] });
/** Intl separates the currency with a no-break space. */
const preview = (s: ActionSnapshot) => schedulingActionPreview(s).replace(/\u00a0/g, " ");
describe("the ANTES → DEPOIS preview of an alteration", () => {
  it("a new professional at the same slot: TROCAR PROFISSIONAL, the slot and the price kept", () => {
    const text = preview({ ...base, professional_ref: "p-yasmin", professional_name: "Yasmin Toledo", before_professional_ref: "p-jonas", before_professional_name: "Jonas Ferraz" });
    expect(text.split("\n")).toEqual(["TROCAR PROFISSIONAL", "Luana Prado", "ANTES: Corte com Jonas Ferraz — qui, 01/10 às 14h–14h30", "DEPOIS: Corte com Yasmin Toledo — qui, 01/10 às 14h–14h30",
      "Horário mantido.", "Preço mantido: R$ 40,00", "Lista de espera: ninguém."]);
  });
  it("new services: the list, the new duration and the new price", () => {
    const text = preview({ ...base, endLocal: "2026-10-01T14:35", priceCents: 4200, services: [service("s-barba", "Barba", 20, 3000), service("s-pezinho", "Pezinho", 15, 1200)],
      before_services: base.services, before_price_cents: 4000 });
    expect(text.split("\n")).toEqual(["ALTERAR AGENDAMENTO", "Luana Prado", "ANTES: Corte com Jonas Ferraz — qui, 01/10 às 14h–14h30", "DEPOIS: Barba e Pezinho com Jonas Ferraz — qui, 01/10 às 14h–14h35",
      "Horário mantido.", "Duração: 30 min → 35 min", "Preço: R$ 40,00 → R$ 42,00", "Lista de espera: ninguém."]);
  });
  it("a price 'a partir de' stays qualified; a moved slot is not 'mantido'; an account customer's acceptance is said", () => {
    const text = preview({ ...base, startLocal: "2026-10-01T16:00", endLocal: "2026-10-01T17:00", priceCents: 9000, requires_acceptance: true, waiting_count: 1,
      services: [service("s-limpeza", "Limpeza de pele", 60, 9000, "FROM")], before_services: base.services, before_price_cents: 4000,
      professional_ref: "p-iris", professional_name: "Íris Campos", before_professional_ref: "p-jonas", before_professional_name: "Jonas Ferraz" });
    expect(text).toContain("ALTERAR AGENDAMENTO\n"); expect(text).not.toContain("Horário mantido");
    expect(text).toContain("DEPOIS: Limpeza de pele com Íris Campos — qui, 01/10 às 16h–17h");
    expect(text).toContain("Preço: R$ 40,00 → a partir de R$ 90,00");
    expect(text).toContain("A alteração ficará aguardando o aceite do cliente.");
    expect(text).toContain("Lista de espera: 1 pessoa(s); o horário liberado pode ser oferecido a elas.");
  });
  it("a plain reschedule keeps its historical preview (no alteration keys)", () => {
    expect(schedulingActionPreview({ ...base, startLocal: "2026-10-02T15:00", endLocal: "2026-10-02T15:30" }).split("\n").slice(0, 6))
      .toEqual(["REMARCAR AGENDAMENTO", "Luana Prado", "Corte", "Jonas Ferraz", "ANTES: qui, 01/10 às 14h–14h30", "DEPOIS: sex, 02/10 às 15h–15h30"]);
  });
});

const planAction = (fields: Record<string, unknown>, status: PlanAction["status"] = "READY_FOR_CONFIRMATION"): PlanAction => ({ key: "a", skill: "scheduling", operation: "appointment.change",
  fields: fields as PlanAction["fields"], depends_on: [], missing_fields: status === "NEEDS_INPUT" ? ["target_professional_name"] : [], provenance: { intention: "LUNA", assessment: "BACKEND" },
  status, assessment: { status: status === "NEEDS_INPUT" ? "NEEDS_INPUT" : "READY_FOR_CONFIRMATION", missing_fields: [] }, blocked_by: [], mutation: true });
describe("labels: an alteration is not only a new time (data-driven; flag off these fields never exist)", () => {
  it("titles, confirmation nouns and the confirm button", () => {
    const altered = planAction({ customer_name: "Luana Prado", target_professional_name: "Yasmin" }), moved = planAction({ customer_name: "Luana Prado", time: "15:00" });
    expect(actionTitle(altered)).toBe("Alterar agendamento — Luana Prado"); expect(actionTitle(moved)).toBe("Mudar horário — Luana Prado");
    expect(confirmationLabel([altered])).toBe("alteração do agendamento de Luana Prado"); expect(confirmationLabel([moved])).toBe("remarcação de Luana Prado");
    expect(discardNotice([altered])).toBe("Certo, descartei a alteração do agendamento de Luana Prado. Nada foi alterado.");
    expect(discardNotice([moved])).toBe("Certo, descartei a remarcação de Luana Prado. Nada foi alterado.");
    const view = (fields: Record<string, unknown>) => ({ sessionId: "s", message: "", cancelled: false, scheduling: { operation: "appointment.change", fields, message: "", metrics: {} } }) as unknown as SecretaryView;
    expect(legacyConfirmLabel(view({ service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }))).toBe("Confirmar alteração");
    expect(legacyConfirmLabel(view({ time: "15:00" }))).toBe("Confirmar remarcação");
  });
  it("an alteration question uses the adapter's own words (never a generic field label)", () => {
    const plan = { actions: [planAction({ customer_name: "Luana Prado", target_professional_name: "Yasmin" }, "NEEDS_INPUT")] } as unknown as ActionPlan;
    const question = "Yasmin Toledo não faz Corte. Quem faz: Ana Paula Dias. Quem vai atender?";
    expect(conversationalClarifications(plan, { a: { fields: ["target_professional_name"], question } })[0].question).toBe(question);
    expect(conversationalClarifications(plan, { a: { fields: ["target_professional_name"] } })[0].question).toBe("Pode informar novo profissional?");
  });
});
