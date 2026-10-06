import { afterEach, describe, expect, it, vi } from "vitest";
import { actionPlanPreview, assessPlanAction, createActionPlan, defaultReviewConfiguration, secretaryContractParts, type ActionPlan } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import type { SecretaryView } from "../salon-secretary";
import { resolvedSubject, suggestedTextLabel } from "../secretary-display";
import { planConversationContext, presentationHints, secretaryPlanMessage } from "../secretary-presentation";
import { clarificationContext, structuredResponse } from "../secretary-clarification";
import { deferredReadAssessment, deferredReadPreview, type ActionUnit } from "../secretary-action-plan";
import { temporalFieldLabels } from "../secretary-scheduling";
import { blockedPlanMessage } from "../scheduling-batch";

/** B7 presentation: resolved names on screen (never in Luna's context with the flag off), human texts instead of codes
 * and raw JSON, operation-aware temporal labels, and the structured clarification context (flag, default off). Offline. */
afterEach(() => vi.unstubAllEnvs());
const component = { ...defaultReviewConfiguration, grouping: "component" as const };
const base = { sessionId: "s", cancelled: false, message: "" } as SecretaryView;
const snapshot = (fields: Record<string, unknown>) => ({ timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false,
  professional_ref: "pro-rodrigo", professional_name: "Rodrigo Lima", startLocal: "2026-09-29T10:00", endLocal: "2026-09-29T11:00", ...fields });
/** Fábio's change is ready (proposal located "Fábio Santos"), Rodrigo's block is ready, Amanda's cancel asks its time
 * (her customer ref was resolved from a single match: "Amanda Souza"). The owner typed lowercase names. */
function owner() {
  let p: ActionPlan = createActionPlan(plan([intent("appointment.change", { item_key: "fabio", customer_name: "fabio", day_offset: 1, time: "10:00" }),
    intent("appointment.cancel", { item_key: "amanda", customer_name: "amanda" }),
    intent("schedule.block", { item_key: "rodrigo", professional_name: "rodrigo", date: "2026-09-29", time: "10:00", end_time: "11:00" })]), component);
  for (const key of ["fabio", "rodrigo"]) p = assessPlanAction(p, key, { status: "READY_FOR_CONFIRMATION", missing_fields: [], preview: `Prévia ${key}`, proposal_token: key });
  p = assessPlanAction(p, "amanda", { status: "NEEDS_INPUT", missing_fields: ["time"], preview: "Qual horário?" });
  const units: ActionUnit[] = p.actions.map(action => ({ keys: [action.key], kind: "single", child: `op-${action.key}` }));
  const children = [
    { operation_ref: "op-fabio", state: { ...base, scheduling: { fields: { customer_ref: "c-fabio" }, message: "", metrics: {}, proposal: { action_snapshot: snapshot({ kind: "appointment.change", customer_name: "Fábio Santos" }) } } } },
    { operation_ref: "op-amanda", state: { ...base, scheduling: { fields: { customer_ref: "c-amanda" }, resolved_names: { "c-amanda": "Amanda Souza", "c-other": "Outra Pessoa" }, waiting_for: "time", message: "Qual horário?", metrics: {} } } },
    { operation_ref: "op-rodrigo", state: { ...base, scheduling: { fields: { professional_ref: "pro-rodrigo" }, message: "", metrics: {}, proposal: { action_snapshot: snapshot({ kind: "schedule.block" }) } } } },
  ] as unknown as { operation_ref: string; state: SecretaryView }[];
  return { p, units, children };
}

describe("resolved names: the screen names the subject as registered once resolved", () => {
  it("the lead, the questions and the problem lines use the resolved subject; the owner's words stay until then", () => {
    const { p, units, children } = owner();
    expect(secretaryPlanMessage(p, units, children)).toBe("Já dá para confirmar: remarcação de Fábio Santos e bloqueio de Rodrigo Lima.\n\nQual horário você quer para Amanda Souza?");
    expect(actionPlanPreview(p)).toBe("Já dá para confirmar: remarcação de fabio e bloqueio de rodrigo.\n\nQual horário você quer para amanda?");
    const hints = presentationHints(p, units, children);
    expect(Object.fromEntries(Object.entries(hints).map(([key, hint]) => [key, hint.subject]))).toEqual({ fabio: "Fábio Santos", amanda: "Amanda Souza", rodrigo: "Rodrigo Lima" });
    const failed = assessPlanAction(p, "fabio", { status: "DOMAIN_CONFLICT", missing_fields: [], preview: "Conflito." });
    expect(secretaryPlanMessage(failed, units, children)).toMatch(/^Remarcar agendamento — Fábio Santos: há um conflito a revisar\./);
  });
  it("Luna's context keeps the historical wording (flag off): the owner's own names, never the resolved ones", () => {
    const { p, units, children } = owner();
    const asked: string[] = [];
    const context = planConversationContext(p, units, children, question => { asked.push(question.question); return 2; });
    const amanda = context.actions.find(action => action.item_key === "amanda")!;
    expect(amanda.clarification).toMatchObject({ previous_response: "Qual horário você quer para amanda?", repeat_count: 2 });
    // The repeat counter compares the question shown on the screen (the one the history recorded).
    expect(asked).toEqual(["Qual horário você quer para Amanda Souza?"]);
    expect(JSON.stringify(context)).not.toMatch(/Souza|Santos|Lima/);
  });
  it("resolvedSubject reads only backend-resolved data per operation (refs never leak; stale names keyed by another ref are ignored)", () => {
    const { children } = owner();
    expect(resolvedSubject({ operation: "appointment.cancel" }, children[1].state)).toBe("Amanda Souza");
    expect(resolvedSubject({ operation: "appointment.cancel" }, { ...base, scheduling: { fields: { customer_ref: "c-new" }, resolved_names: { "c-old": "Antiga" }, message: "", metrics: {} } } as unknown as SecretaryView)).toBeUndefined();
    expect(resolvedSubject({ operation: "schedule.block" }, children[2].state)).toBe("Rodrigo Lima");
    const batch = { ...base, batch: { proposal: { snapshot: { cancel: { customer_name: "Amanda Souza" }, create: { customer_name: "Fábio Santos" } } } } } as unknown as SecretaryView;
    expect([resolvedSubject({ operation: "appointment.cancel" }, batch), resolvedSubject({ operation: "appointment.create" }, batch)]).toEqual(["Amanda Souza", "Fábio Santos"]);
    expect(resolvedSubject({ operation: "customer.message" }, { ...base, communication: { draft: { recipient: { name: "João Pedro" } } } } as unknown as SecretaryView)).toBe("João Pedro");
    expect(resolvedSubject({ operation: "service.change" }, { ...base, proposal: { change: { before: { name: "Massagem Relaxante" } } } } as unknown as SecretaryView)).toBe("Massagem Relaxante");
    expect(resolvedSubject({ operation: "stock.movement" }, { ...base, inventory: { draft: { product: { name: "Óleo Aurora" } } } } as unknown as SecretaryView)).toBe("Óleo Aurora");
    expect(resolvedSubject({ operation: "appointment.create" }, { ...base, scheduling: { fields: {}, message: "", metrics: {} } } as unknown as SecretaryView)).toBeUndefined();
    expect(resolvedSubject({ operation: "appointment.create" }, undefined)).toBeUndefined();
    expect(suggestedTextLabel).toBe("Sugestão de texto — revise antes de confirmar");
  });
});

describe("human texts instead of codes and raw data", () => {
  it("a deferred read says when it runs, never its keys or fields as JSON; the plan message keeps its short title", () => {
    let p = createActionPlan({ ...plan([intent("service.change", { item_key: "a", target_name: "Massagem", priceCents: 8000 }),
      intent("appointment.list", { item_key: "b", depends_on: ["a"], date: "2026-09-29" })]), independent: false });
    const b = p.actions.find(action => action.key === "b")!;
    const assessment = deferredReadAssessment(b);
    expect(assessment.preview).toBe("Esta consulta será feita depois da ação anterior; o resultado aparece aqui.");
    expect(assessment.preview).not.toMatch(/[{}"]|Intenção|Leitura após|\bb\b|2026/);
    expect(deferredReadPreview({ depends_on: ["a", "c"] })).toContain("das ações anteriores");
    p = assessPlanAction(p, "a", { status: "READY_FOR_CONFIRMATION", missing_fields: [], preview: "Massagem R$ 80,00", proposal_token: "t" });
    p = assessPlanAction(p, "b", assessment);
    expect(actionPlanPreview(p)).not.toContain("Esta consulta será feita depois");
    expect(actionPlanPreview(p)).toContain("Consultar agenda: aguardando a ação anterior.");
  });
  it("a blocked cancel→create pair states its cause in pt-BR, never the code", () => {
    for (const code of ["SLOT_CONFLICT", "PRO_SERVICE_MISMATCH", "SCHEDULING_RELATION_NOT_SUPPORTED", "SELECTION_INVALID", "APPOINTMENT_NOT_FOUND", "ALREADY_STARTED_OR_CLOSED", "RESOURCE_UNAVAILABLE", "SOMETHING_NEW"]) {
      const text = blockedPlanMessage(code);
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/); expect(text).toMatch(/^Não consegui preparar o cancelamento com o novo agendamento: .+\. Nenhuma ação foi executada\.$/);
    }
    expect(blockedPlanMessage("SLOT_CONFLICT")).toContain("o horário ficou indisponível");
  });
  it("temporal roles are named for the operation ('destino' only where there is an origin)", () => {
    expect(temporalFieldLabels("appointment.change")).toMatchObject({ date: "data de destino", time: "horário de destino", source_date: "data original" });
    expect(temporalFieldLabels("appointment.create")).toMatchObject({ date: "data do atendimento", time: "horário do atendimento" });
    expect(temporalFieldLabels("appointment.cancel")).toMatchObject({ date: "data do atendimento", time: "horário do atendimento" });
    expect(temporalFieldLabels("schedule.block")).toMatchObject({ date: "data do bloqueio", time: "início do bloqueio", end_time: "fim do bloqueio" });
    expect(temporalFieldLabels("availability.get")).toMatchObject({ date: "data", time: "horário" });
    for (const operation of ["appointment.create", "appointment.cancel", "schedule.block", "availability.get"])
      expect(Object.values(temporalFieldLabels(operation)).join(" ")).not.toContain("destino");
  });
});

describe("structured clarification context (SALON_SECRETARY_STRUCTURED_CONTEXT, default off)", () => {
  const question = "Esse horário está indisponível: Rodrigo Lima já estará com Fábio Santos das 10h às 11h neste mesmo pedido. Qual outro horário você prefere?";
  const input = { operation: "appointment.create", fields: { customer_name: "Amanda", time: "10:00", customer_ref: "hidden" }, missing_fields: ["time"], waiting_for: "time", message: question };
  it("flag off: the historical context, byte for byte", () => {
    const context = clarificationContext(input);
    expect(context).toEqual({ operation: "appointment.create", fields: { customer_name: "Amanda", time: "10:00" },
      clarification: { missing_fields: ["time"], requested_field: "time", previous_response: question } });
    expect(JSON.stringify(context.clarification)).toBe(`{"missing_fields":["time"],"requested_field":"time","previous_response":${JSON.stringify(question)}}`);
    expect(context.clarification).not.toHaveProperty("question_code");
  });
  it("flag on: a question code and a short stable sentence replace the screen prose (no names, dates or clocks)", () => {
    const historical = JSON.stringify(clarificationContext(input));
    vi.stubEnv("SALON_SECRETARY_STRUCTURED_CONTEXT", "true");
    const context = clarificationContext(input);
    expect(context.clarification).toEqual({ missing_fields: ["time"], requested_field: "time", question_code: "FIELD", previous_response: "Pedi o horário." });
    expect(JSON.stringify(context).length).toBeLessThan(historical.length);
    const pick = clarificationContext({ operation: "appointment.create", fields: {}, waiting_for: "customer_ref", message: "Qual Amanda você quis dizer?\n• Amanda Souza · (11) *****-0001",
      selection: { field: "customer_ref", labels: ["Amanda Souza · (11) *****-0001", "Amanda Lima"] } });
    expect(pick.clarification).toEqual({ missing_fields: ["customer_ref"], requested_field: "customer_ref", question_code: "OPTION", previous_response: "Pedi uma das opções.",
      response_fields: ["customer_name"], candidates: [{ option_id: "opt_1", label: "Amanda Souza · (11) *****-0001" }, { option_id: "opt_2", label: "Amanda Lima" }] });
    const daypart = clarificationContext({ operation: "appointment.change", fields: {}, message: "quatro da manhã ou da tarde?",
      pending_temporal_ambiguities: [{ field: "time", kind: "CLOCK_DAYPART", expression: "às quatro", candidates: ["04:00", "16:00"] }] as never });
    expect(daypart.clarification).toMatchObject({ requested_component: "daypart", requested_field: "time", question_code: "DAYPART", previous_response: "Pedi manhã ou tarde." });
    const several = clarificationContext({ operation: "schedule.block", fields: {}, missing_fields: ["time", "end_time"], message: "De que horas até que horas?" });
    expect(several.clarification).toMatchObject({ requested_field: null, question_code: "FIELDS", previous_response: "Pedi o horário e o horário final." });
    const ready = clarificationContext({ operation: "service.change", fields: {}, message: "Massagem\nR$ 100,00 → R$ 80,00\nUse Confirmar." });
    expect(ready.clarification).toEqual({ missing_fields: [], requested_field: null, previous_response: "" });
    expect(structuredResponse("CALENDAR", "date", ["date"])).toBe("Pedi qual data vale.");
  });
  it("flag on: a production-shaped plan context shrinks; the model contract names the flag only when on", () => {
    const { p, units, children } = owner();
    const off = JSON.stringify(planConversationContext(p, units, children));
    vi.stubEnv("SALON_SECRETARY_STRUCTURED_CONTEXT", "true");
    const on = JSON.stringify(planConversationContext(p, units, children));
    expect(on.length).toBeLessThan(off.length);
    expect(on).not.toContain("Prévia"); expect(on).toContain('"question_code":"FIELD"');
    expect(secretaryContractParts().flags).toMatchObject({ structuredContext: true });
    vi.unstubAllEnvs();
    expect(secretaryContractParts().flags).not.toHaveProperty("structuredContext");
  });
});
