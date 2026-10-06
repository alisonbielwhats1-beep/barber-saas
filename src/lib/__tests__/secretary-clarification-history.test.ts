import { describe, expect, it } from "vitest";
import { assessPlanAction, createActionPlan, type ActionPlan } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import type { SecretaryView } from "../salon-secretary";
import { agendaFallback, agendaFallbackLabel, clarificationAttempt, clarificationsView, planQuestions, questionFingerprint, recordClarifications,
  type ClarificationHistory } from "../secretary-clarification-history";

/** B6 repeated-question limit: pure history and view projection (no tenant, no model). */
const base: SecretaryView = { sessionId: "session", cancelled: false, message: "" };
type Operation = { operation_ref: string; action_keys: string[]; state: SecretaryView };
const units = [{ keys: ["a"], kind: "single" as const, child: "op-a" }];
function waiting(operation: string, fields: Record<string, unknown>, missing: string[]): ActionPlan {
  const p = createActionPlan(plan([intent(operation, { item_key: "a", ...fields })]));
  return assessPlanAction(p, "a", { status: "NEEDS_INPUT", missing_fields: missing, preview: "" });
}
const one = (state: Partial<SecretaryView>): Operation[] => [{ operation_ref: "op-a", action_keys: ["a"], state: { ...base, ...state } as SecretaryView }];
/** A history in which the plan's current questions were each shown `count` times. */
function shown(p: ActionPlan, operations: Operation[], count: number): ClarificationHistory {
  let history: ClarificationHistory | undefined;
  for (let i = 0; i < count; i++) history = recordClarifications(history, p.plan_ref, planQuestions(p, units, operations), () => true);
  return history!;
}

describe("history: once per user turn", () => {
  it("counts the same question, keeps it for a turn about another action, restarts a reworded one and drops what stopped asking", () => {
    const q = { action_key: "a", fields: ["time"], question: "Qual horário você quer para Amanda?" }, other = { action_key: "b", fields: ["reason"], question: "Qual o motivo do cancelamento?" };
    let history = recordClarifications(undefined, "plan-1", [q, other], () => true);
    expect(clarificationAttempt(history, "plan-1", q)).toBe(1);
    history = recordClarifications(history, "plan-1", [q, other], key => key === "b");
    expect([clarificationAttempt(history, "plan-1", q), clarificationAttempt(history, "plan-1", other)]).toEqual([1, 2]);
    history = recordClarifications(history, "plan-1", [q, other], () => true);
    expect([clarificationAttempt(history, "plan-1", q), clarificationAttempt(history, "plan-1", other)]).toEqual([2, 3]);
    // A reworded question is a new question; another plan never inherits a count.
    const reworded = { ...q, question: "Esse horário está indisponível. Qual outro horário você prefere?" };
    history = recordClarifications(history, "plan-1", [reworded], () => true);
    expect(clarificationAttempt(history, "plan-1", reworded)).toBe(1);
    expect(Object.keys(history)).toEqual(["a:time"]);
    expect(clarificationAttempt(history, "plan-2", reworded)).toBe(1);
    // The fingerprint is a sha256 of the question; the history holds no question text.
    expect(history["a:time"].fingerprint).toBe(questionFingerprint(reworded)); expect(history["a:time"].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(history)).not.toContain("indisponível");
  });
});

describe("view: options from the 2nd time, the agenda form from the 3rd", () => {
  const amanda = waiting("appointment.change", { customer_name: "Amanda" }, ["appointment_ref"]);
  const card = one({ scheduling: { operation: "appointment.change", fields: { customer_name: "Amanda", customer_ref: "c-souza", source_date: "2026-10-01" }, message: "Qual agendamento?",
    candidates: { kind: "appointment_ref", items: [{ id: "appt-early", name: "Amanda Souza — qui, 01/10 às 10h — Tatiana" }, { id: "appt-late", name: "Amanda Souza — qui, 01/10 às 14h — Tatiana" }] } } as unknown as SecretaryView["scheduling"] });
  it("entity candidates are offered by their option ids (never refs) only once the question repeats", () => {
    expect(clarificationsView(amanda, units, card, shown(amanda, card, 1))).toEqual([{ action_key: "a", field: "appointment", attempt: 1 }]);
    const second = clarificationsView(amanda, units, card, shown(amanda, card, 2));
    expect(second).toEqual([{ action_key: "a", field: "appointment", attempt: 2, options: [
      { option_id: "opt_1", label: "Amanda Souza — qui, 01/10 às 10h — Tatiana" }, { option_id: "opt_2", label: "Amanda Souza — qui, 01/10 às 14h — Tatiana" }] }]);
    expect(JSON.stringify(second)).not.toContain("appt-");
    // Third time: the appointment is still unknown, so the agenda opens on its day only.
    expect(clarificationsView(amanda, units, card, shown(amanda, card, 3))[0]).toMatchObject({ attempt: 3, fallback: { href: "/agenda?date=2026-10-01", label: agendaFallbackLabel } });
  });
  it("time alternatives the backend offered (B4 slots) are the options of a repeated time question", () => {
    const p = waiting("appointment.create", { customer_name: "Carla" }, ["time"]);
    const slots = one({ options: [{ option_id: "opt_1", label: "sex, 02/10 às 15h" }], scheduling: { operation: "appointment.create", waiting_for: "time", message: "Esse horário está indisponível. Tenho 15h. Qual horário você prefere?",
      fields: { customer_name: "Carla", customer_ref: "c-carla", service_ref: "s-corte", professional_ref: "p-tatiana", date: "2026-10-02" } } as unknown as SecretaryView["scheduling"] });
    const view = clarificationsView(p, units, slots, shown(p, slots, 3))[0];
    expect(view).toMatchObject({ field: "time", attempt: 3, options: [{ option_id: "opt_1", label: "sex, 02/10 às 15h" }] });
    expect(view.fallback!.href).toBe("/agenda?date=2026-10-02&client=c-carla&professional=p-tatiana&service=s-corte&from=secretaria");
  });
  it("a cancellation reason is never offered as options (literal proof), even when repeated", () => {
    const p = waiting("appointment.cancel", { customer_name: "Amanda" }, ["reason"]);
    const reason = one({ scheduling: { operation: "appointment.cancel", waiting_for: "reason", message: "Informe motivo do cancelamento (mínimo 3 caracteres).",
      fields: { customer_name: "Amanda", customer_ref: "c-souza", appointment_ref: "appt-early", date: "2026-10-01" }, candidates: undefined } as unknown as SecretaryView["scheduling"] });
    const [third] = clarificationsView(p, units, reason, shown(p, reason, 3));
    expect(third).toEqual({ action_key: "a", field: "reason", attempt: 3, fallback: { href: "/agenda?date=2026-10-01&appointment=appt-early", label: agendaFallbackLabel } });
  });
});

describe("agenda fallback: server-computed, ids/days/clocks only", () => {
  const action = (operation: string) => createActionPlan(plan([intent(operation, { item_key: "a", ...(operation.startsWith("service.") ? { name: "Corte" } : { customer_name: "Amanda Souza" }) })])).actions[0];
  const state = (fields: Record<string, unknown>, operation: string) => ({ ...base, scheduling: { operation, fields, message: "" } }) as unknown as SecretaryView;
  it("create, change (the appointment's own day), cancel and block", () => {
    expect(agendaFallback(action("appointment.create"), state({ date: "2026-10-02", time: "15:00", customer_ref: "c-1", professional_ref: "p-1", service_ref: "s-1" }, "appointment.create"))!.href)
      .toBe("/agenda?date=2026-10-02&client=c-1&professional=p-1&time=15%3A00&service=s-1&from=secretaria");
    expect(agendaFallback(action("appointment.change"), state({ source_date: "2026-10-01", date: "2026-10-09", time: "11:00", appointment_ref: "appt-1" }, "appointment.change"))!.href)
      .toBe("/agenda?date=2026-10-01&appointment=appt-1");
    expect(agendaFallback(action("appointment.cancel"), state({ appointment_ref: "appt-1" }, "appointment.cancel"))!.href).toBe("/agenda?appointment=appt-1");
    expect(agendaFallback(action("schedule.block"), state({ date: "2026-10-01", time: "10:00", end_time: "11:00", professional_ref: "p-1" }, "schedule.block"))!.href)
      .toBe("/agenda?date=2026-10-01&professional=p-1&block=1&time=10%3A00&end=11%3A00");
    // A block ending on another day keeps only its start in the link.
    expect(agendaFallback(action("schedule.block"), state({ date: "2026-10-01", end_date: "2026-10-02", time: "10:00", end_time: "11:00", professional_ref: "p-1" }, "schedule.block"))!.href)
      .toBe("/agenda?date=2026-10-01&professional=p-1&block=1&time=10%3A00");
    expect(agendaFallback(action("service.create"), base)).toBeUndefined();
    expect(agendaFallback(action("appointment.list"), state({ date: "2026-10-01" }, "appointment.list"))).toBeUndefined();
  });
  it("never carries names, phones, reasons or malformed values", () => {
    const hostile = state({ date: "01/10/2026", time: "10h", customer_ref: "Amanda Souza", professional_ref: "p-1", service_ref: "s 1", customer_name: "Amanda Souza",
      reason: "ela viajou", phone: "(11) 99999-0001" }, "appointment.create");
    const href = agendaFallback(action("appointment.create"), hostile)!.href;
    expect(href).toBe("/agenda?professional=p-1&from=secretaria");
    for (const text of ["Amanda", "Souza", "viajou", "99999", "10h"]) expect(href).not.toContain(text);
    expect(new URL(href, "https://example.test").pathname).toBe("/agenda");
  });
  it("a batch item uses its own fields", () => {
    const batch = { ...base, batch: { plan: { items: [{ key: "a", operation: "appointment.cancel", fields: { appointment_ref: "appt-9", date: "2026-10-03" } }] } } } as unknown as SecretaryView;
    expect(agendaFallback({ ...action("appointment.cancel"), key: "a" }, batch)!.href).toBe("/agenda?date=2026-10-03&appointment=appt-9");
  });
});
