import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessPlanAction, conversationalClarifications, createActionPlan, discardNotice, discardQuestion, rejectedPartsNotice, type ActionPlan } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import type { SecretaryView } from "../salon-secretary";
import type { ActionUnit } from "../secretary-action-plan";
import { planConversationContext, presentationHints } from "../secretary-presentation";
import { temporalAmbiguityQuestion } from "../scheduling-temporal-ambiguity";
import { calendarConflictQuestion } from "../scheduling-calendar-conflict";
import { temporalFieldLabels as fromAdapter } from "../secretary-scheduling";
import { temporalFieldLabels, temporalQuestionLabel } from "../scheduling-field-labels";
import { reviewHeading } from "../secretary-ui";

/** UX-COPY (flag SALON_SECRETARY_COPY_V2): operation-aware questions and labels, registered names in screen-only notices, a review
 * heading from the status. Flag off: every text is the historical one. Display only (no field, value or decision changes). */
beforeEach(() => vi.stubEnv("SALON_SECRETARY_COPY_V2", "true"));
afterEach(() => vi.unstubAllEnvs());
const question = (operation: string, missing: string[], fields: Record<string, unknown> = {}, subject?: string) => {
  let p: ActionPlan = createActionPlan(plan([intent(operation, { item_key: "a", ...fields })]));
  p = assessPlanAction(p, "a", { status: "NEEDS_INPUT", missing_fields: missing, preview: "" });
  return conversationalClarifications(p, subject ? { a: { subject } } : {})[0].question;
};

describe("operation-aware questions (copy table)", () => {
  const celia = { customer_name: "célia" };
  it.each([
    ["appointment.cancel", ["time"], celia, "Qual é o horário do agendamento de célia?"],
    ["appointment.read", ["time"], celia, "Qual é o horário do agendamento de célia?"],
    ["schedule.block", ["time"], { professional_name: "ivone" }, "A partir de que horas devo bloquear a agenda de ivone?"],
    ["appointment.change", ["source_date"], celia, "Em que dia está marcado o agendamento de célia?"],
    ["appointment.change", ["source_time"], celia, "Qual é o horário atual do agendamento de célia?"],
    ["appointment.change", ["source_date", "source_time"], celia, "Em que dia e horário está marcado o agendamento de célia?"],
    // Unchanged wording (pinned elsewhere): create, a move's destination, a cancel's day+time, a block's interval.
    ["appointment.create", ["time"], celia, "Qual horário você quer para célia?"],
    ["appointment.change", ["time"], celia, "Para qual horário devo passar célia?"],
    ["appointment.cancel", ["date", "time"], celia, "Para qual dia e horário é o agendamento de célia?"],
    ["schedule.block", ["time", "end_time"], { professional_name: "ivone" }, "De que horas até que horas devo bloquear a agenda de ivone?"],
  ] as const)("%s %j", (operation, missing, fields, expected) => expect(question(operation, [...missing], fields)).toBe(expected));
  it("the screen names the registered subject once resolved; the question never embeds a raw field id", () => {
    expect(question("appointment.cancel", ["time"], celia, "Célia Paranhos")).toBe("Qual é o horário do agendamento de Célia Paranhos?");
    for (const [operation, missing] of [["appointment.cancel", ["time"]], ["appointment.change", ["source_date"]], ["schedule.block", ["time"]]] as const)
      expect(question(operation, [...missing], celia)).not.toMatch(/_|\bsource\b/);
  });
  it("flag off: the historical questions", () => {
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "false");
    expect(question("appointment.cancel", ["time"], celia)).toBe("Qual horário você quer para célia?");
    expect(question("appointment.change", ["source_date"], celia)).toBe("Pode informar data original?");
    expect(question("schedule.block", ["time"], { professional_name: "ivone" })).toBe("Qual horário você quer?");
  });
});
describe("half-day and calendar questions name the role by what the operation does", () => {
  const daypart = (field: "time" | "end_time" | "source_time") => ({ field, kind: "CLOCK_DAYPART" as const, expression: "das 2", candidates: ["02:00", "14:00"] as [string, string] });
  const choice = (field: "date" | "source_date" | "end_date") => ({ field, kind: "DATE_CHOICE" as const, expression: "dia 1", candidates: ["2026-09-01", "2026-10-01"] as [string, string] });
  it.each([
    ["appointment.cancel", "time", "No horário do atendimento, “das 2” significa 02h ou 14h?"],
    ["schedule.block", "time", "No início do bloqueio, “das 2” significa 02h ou 14h?"],
    ["schedule.block", "end_time", "No fim do bloqueio, “das 2” significa 02h ou 14h?"],
    ["appointment.change", "time", "No horário de destino, “das 2” significa 02h ou 14h?"],
    ["appointment.change", "source_time", "No horário original, “das 2” significa 02h ou 14h?"],
    ["appointment.create", "time", "No horário do atendimento, “das 2” significa 02h ou 14h?"],
  ] as const)("daypart %s %s", (operation, field, expected) => expect(temporalAmbiguityQuestion(daypart(field), operation)).toBe(expected));
  it.each([
    ["appointment.cancel", "date", "Para a data do atendimento, “dia 1” é ter, 01/09 ou qui, 01/10?"],
    ["schedule.block", "date", "Para a data do bloqueio, “dia 1” é ter, 01/09 ou qui, 01/10?"],
    ["appointment.change", "source_date", "Para a data original, “dia 1” é ter, 01/09 ou qui, 01/10?"],
    ["appointment.change", "date", "Para a data de destino, “dia 1” é ter, 01/09 ou qui, 01/10?"],
    // A read keeps the historical label (its generic "data" would say less).
    ["availability.get", "date", "Para a data desejada, “dia 1” é ter, 01/09 ou qui, 01/10?"],
    ["appointment.list", "date", "Para a data desejada, “dia 1” é ter, 01/09 ou qui, 01/10?"],
  ] as const)("calendar %s %s", (operation, field, expected) => expect(calendarConflictQuestion(choice(field), operation)).toBe(expected));
  it("flag off, or no operation: the historical labels exactly", () => {
    expect(temporalAmbiguityQuestion(daypart("time"))).toBe("No horário de destino, “das 2” significa 02h ou 14h?");
    expect(calendarConflictQuestion(choice("date"))).toBe("Para a data desejada, “dia 1” é ter, 01/09 ou qui, 01/10?");
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "false");
    expect(temporalAmbiguityQuestion(daypart("time"), "appointment.cancel")).toBe("No horário de destino, “das 2” significa 02h ou 14h?");
    expect(calendarConflictQuestion(choice("date"), "schedule.block")).toBe("Para a data desejada, “dia 1” é ter, 01/09 ou qui, 01/10?");
    expect(temporalQuestionLabel("end_date", "appointment.cancel")).toBe("data final");
  });
  it("the label map moved without change (the adapter re-exports the same function; the presentation digest reads it)", () => {
    expect(fromAdapter).toBe(temporalFieldLabels);
    expect(temporalFieldLabels("appointment.cancel")).toEqual({ date: "data do atendimento", time: "horário do atendimento", source_date: "data original", source_time: "horário original", end_date: "data final", end_time: "horário final" });
  });
  it("a plan's daypart question for a cancellation is asked as the appointment's own time; Luna's context keeps the owner's words (B7)", () => {
    let p: ActionPlan = createActionPlan(plan([intent("appointment.cancel", { item_key: "a", customer_name: "célia" })]));
    p = assessPlanAction(p, "a", { status: "NEEDS_INPUT", missing_fields: ["time"], preview: "" });
    const units: ActionUnit[] = [{ keys: ["a"], kind: "single", child: "op-a" } as ActionUnit];
    const children = [{ operation_ref: "op-a", state: { sessionId: "s", cancelled: false, message: "", scheduling: { fields: { customer_ref: "c-celia" }, resolved_names: { "c-celia": "Célia Paranhos" },
      waiting_for: "time", pending_temporal_ambiguities: [daypart("time")], message: "", metrics: {} } } as unknown as SecretaryView }];
    expect(presentationHints(p, units, children).a.question).toBe("No horário do atendimento, “das 2” significa 02h ou 14h?");
    expect(JSON.stringify(planConversationContext(p, units, children))).not.toContain("Paranhos");
  });
});
describe("screen-only notices name the registered subject once resolved (B7 hints)", () => {
  const actions = () => {
    let p: ActionPlan = createActionPlan(plan([intent("appointment.cancel", { item_key: "a", customer_name: "bianca" }), intent("appointment.create", { item_key: "b", customer_name: "davi" })]));
    for (const key of ["a", "b"]) p = assessPlanAction(p, key, { status: "NEEDS_INPUT", missing_fields: ["reason"], preview: "" });
    return p.actions;
  };
  it("discardNotice / discardQuestion / rejectedPartsNotice use the hint's subject; without hints the owner's words (backward compatible)", () => {
    const [a, b] = actions(), hints = { a: { subject: "Bianca Siqueira" } };
    expect(discardNotice([a], [], hints)).toBe("Certo, descartei o cancelamento de Bianca Siqueira. Nada foi alterado.");
    expect(discardNotice([a])).toBe("Certo, descartei o cancelamento de bianca. Nada foi alterado.");
    // Only the resolved subject changes; an action without a hint keeps its typed name (an unresolved homonym never shows a candidate).
    expect(discardQuestion([a], [b], hints)).toBe("Descartar o cancelamento de Bianca Siqueira também descarta o agendamento de davi, que está ligado a esse item. Quer que eu descarte os dois? Nada foi alterado.");
    expect(discardQuestion([a], [b])).toBe("Descartar o cancelamento de bianca também descarta o agendamento de davi, que está ligado a esse item. Quer que eu descarte os dois? Nada foi alterado.");
    expect(rejectedPartsNotice([{ dependent: false, action: a }], hints)).toContain("Não apliquei a alteração que você pediu para o cancelamento de Bianca Siqueira;");
    expect(rejectedPartsNotice([{ dependent: false, action: a }])).toContain("para o cancelamento de bianca;");
    // A quoted part stays the owner's own words (never rewritten).
    expect(rejectedPartsNotice([{ dependent: false, quote: "passa a bianca pra sexta" }], hints)).toBe("Não entendi com segurança esta parte do pedido e a deixei de fora: “passa a bianca pra sexta”. Pode repetir essa parte de outro jeito?");
  });
});
describe("review heading from the status (screen)", () => {
  it.each([
    ["AVAILABLE", undefined], ["CONFLICT_OVERRIDABLE", "Horário com conflito"], ["CONFLICT_HARD_BLOCK", "Este horário não pode ser usado"], ["SOMETHING_NEW", "Revise este horário"],
  ] as const)("copy on: %s → %j", (status, heading) => expect(reviewHeading(status, true)).toBe(heading));
  it("copy off: the historical two-way heading (an AVAILABLE review still shows 'Atenção ao horário')", () => {
    expect(reviewHeading("AVAILABLE")).toBe("Atenção ao horário"); expect(reviewHeading("CONFLICT_OVERRIDABLE")).toBe("Atenção ao horário");
    expect(reviewHeading("CONFLICT_HARD_BLOCK")).toBe("Este horário não pode ser usado");
  });
  it("an unknown status is never presented as available", () => expect(reviewHeading("??", true)).not.toMatch(/dispon/i));
});
