import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import evidence from "../../test/fixtures/conversational-ux-benchmark.json";
import { actionPlanPreview, conversationalClarifications, createActionPlan, assessPlanAction, type ActionPlan, type PresentationHints } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import { presentationHints, secretaryPlanMessage, planConversationContext } from "../secretary-presentation";
import type { SecretaryView } from "../salon-secretary";

const leaks = /\b(?:\w+_(?:ref|id|name|time)|NEEDS_INPUT|READY_FOR_CONFIRMATION|NORMAL_REVIEW|ADVANCED_REVIEW|service_name|end_time|durationMin|priceCents)\b/;
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const original = (id: string, turn = 1) => structuredClone(evidence.rows.find(row => row.case_id === id && row.turn === turn)!);
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) frozen(child); }
  return value;
}
function hintsFor(row: ReturnType<typeof original>): PresentationHints {
  const hints: Record<string, { selection: { field: string; labels: string[] } }> = {};
  for (const operation of row.capture.operations) {
    const pick = operation.candidates;
    if (pick) {
      const action = row.plan.actions.find(a => a.operation === operation.operation)!;
      hints[action.key] = { selection: { field: pick.kind!, labels: pick.labels } };
    }
  }
  return hints;
}
describe("unchanged benchmark evidence, offline presentation replay", () => {
  it.each(["America/Sao_Paulo", "America/New_York", "America/Argentina/Buenos_Aires"])("preserves complete backend timezone %s while translating actual fields", timezone => {
    const p = original("x41", 2).plan as ActionPlan;
    p.actions[0].assessment.preview = `Horário: 10:00–10:45 (${timezone})\nservice_ref professional_ref end_time`;
    const before = JSON.stringify(p), text = actionPlanPreview(frozen(p));
    expect(text).toContain(`10:00–10:45 (${timezone})`);
    expect(text).not.toMatch(/service_ref|professional_ref|end_time|informação que falta/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it.each(["x41", "x44", "x46", "x49"])("%s real preview retains timezone without changing its plan", id => {
    const p = frozen(original(id, 2).plan as ActionPlan), before = JSON.stringify(p);
    expect(p.actions.some(a => a.assessment.preview?.includes("America/Sao_Paulo"))).toBe(true);
    const text = actionPlanPreview(p);
    expect(text).toContain("America/Sao_Paulo");
    expect(text).not.toContain("America/informação que falta");
    expect(JSON.stringify(p)).toBe(before);
  });
  it.each(["x41", "x42", "x44", "x46", "x49"])("%s removes technical leaks and duplicate questions without mutating the plan", id => {
    for (const turn of [1, 2]) {
      const row = original(id, turn), p = frozen(row.plan as ActionPlan), before = JSON.stringify(p);
      const text = actionPlanPreview(p, hintsFor(row));
      expect(JSON.stringify(p)).toBe(before); expect(text).not.toMatch(leaks);
      expect(text).not.toMatch(/\b(?:Skill|Tool|ActionPlan|backend)\b/i);
      expect(text).not.toContain("Informe somente");
      const count = turn === 1 ? id === "x49" ? 2 : 1 : id === "x42" ? 1 : 0;
      expect(text.match(/\?/g) ?? []).toHaveLength(count);
      if (turn === 1) expect(row.before).toMatch(leaks); // demonstrates the original failure
    }
  });
  it("x41 asks only time; x44 combines service/time and defers professional", () => {
    expect(actionPlanPreview(original("x41").plan as ActionPlan)).toBe("Qual horário você quer para Andrinho?");
    const text = actionPlanPreview(original("x44").plan as ActionPlan);
    expect(text).toBe("Qual serviço e horário você quer para Andrinho?");
    expect(text).not.toMatch(/profissional|Tatiana|bloqueio/);
  });
  it("x42 offers exactly the adapter's real service options, even after 10h", () => {
    for (const turn of [1, 2]) {
      const row = original("x42", turn), text = actionPlanPreview(row.plan as ActionPlan, hintsFor(row));
      expect(text).toContain("Qual serviço você deseja para Andrinho?");
      for (const label of ["Corte + Barba", "Corte Completo", "Corte Infantil"]) expect(text).toContain(`• ${label}`);
      expect(text).not.toMatch(/profissional|horário|confirmar/i);
    }
  });
  it("x46 has one service question, no cancel/create/footer duplication", () => {
    const p = original("x46").plan as ActionPlan;
    expect(actionPlanPreview(p)).toBe("Qual serviço Fábio Santos vai fazer?");
    expect(conversationalClarifications(p)).toEqual([{ action_key: "create_fabio", fields: ["service"], question: "Qual serviço Fábio Santos vai fazer?" }]);
    const after = actionPlanPreview(original("x46", 2).plan as ActionPlan);
    expect(after.match(/ALTERAÇÕES NA AGENDA/g)).toHaveLength(1);
    expect(after).toContain("Corte Completo"); expect(after).toContain("Seu horário foi cancelado.");
  });
  it("x49 asks only service and block end, once each, then proposes all ten", () => {
    const before = original("x49"), after = original("x49", 2);
    const text = actionPlanPreview(before.plan as ActionPlan);
    expect(text).toContain("Só preciso de duas informações:");
    expect(text).toContain("1. Qual serviço Fábio Santos vai fazer?");
    expect(text).toContain("2. Até que horas devo bloquear a agenda de Tatiana?");
    expect(text).not.toContain("8 itens já estão preparados"); // cancel is READY, not a prepared proposal
    expect(after.plan.actions).toHaveLength(10); expect(after.plan.review).toBe("ADVANCED_REVIEW");
    expect(actionPlanPreview(after.plan as ActionPlan)).toContain("16:00");
  });
  it.each(["x41", "x42", "x44", "x46", "x49"])("%s recorded multi-turn continuity and only intended field deltas remain identical", id => {
    const a = original(id), b = original(id, 2);
    expect(b.plan.plan_ref).toBe(a.plan.plan_ref); expect(b.conversation_ref).toBe(a.conversation_ref);
    expect(b.draft_refs).toEqual(a.draft_refs); expect(b.plan.dependencies).toEqual(a.plan.dependencies);
    const changed = b.plan.actions.flatMap(action => {
      const old = a.plan.actions.find(x => x.key === action.key)!;
      return Object.keys(action.fields).filter(k => JSON.stringify(action.fields[k as keyof typeof action.fields]) !== JSON.stringify(old.fields[k as keyof typeof old.fields]));
    });
    expect(changed.sort()).toEqual((id === "x44" ? ["service_name", "time"] : id === "x46" ? ["service_name"] : id === "x49" ? ["service_name", "end_time"] : ["time"]).sort());
  });
});
function incomplete(operation: Parameters<typeof intent>[0], fields: Record<string, unknown>, missing: string[]) {
  return assessPlanAction(createActionPlan(plan([intent(operation, { item_key: "a", ...fields })])), "a", { status: "NEEDS_INPUT", missing_fields: missing, preview: "Informe service_ref. Qual é o serviço?" });
}
it("semantic aliases collapse without text matching or taking fields from preview questions", () => {
  const p = incomplete("appointment.create", { customer_name: "Fábio" }, ["service_ref", "service_name", "professional_ref", "selection", "service_ref"]);
  expect(actionPlanPreview(p)).toBe("Qual serviço Fábio vai fazer?");
});
it("entity ambiguity has priority only within its action; names never auto-select", () => {
  const p = incomplete("appointment.create", { customer_name: "Amanda", service_name: "corte" }, ["customer_ref", "service_ref", "professional_ref", "time", "selection"]);
  expect(actionPlanPreview(p, { a: { selection: { field: "customer_ref", labels: ["Amanda Souza", "Amanda Lima"] } } })).toBe("Qual Amanda você quis dizer?\n• Amanda Souza\n• Amanda Lima");
  expect(p.actions[0].fields).not.toHaveProperty("customer_ref");
});
it.each([
  ["service.create", { name: "Massagem" }, ["durationMin", "priceCents"], "Pode informar duração em minutos e preço de Massagem?"],
  ["customer.create", {}, ["name", "phone"], "Pode informar nome e telefone?"],
  ["financial.report", {}, ["period"], "Qual período você quer consultar?"],
  ["stock.movement", {}, ["mode"], "É uma entrada ou uma saída de estoque?"],
  ["customer.message", {}, ["content", "message_mode"], "Qual texto devo usar na mensagem? Envie entre aspas ou peça uma sugestão."],
] as const)("%s uses natural labels for its own requirements", (op, fields, missing, text) => {
  expect(actionPlanPreview(incomplete(op, fields, [...missing]))).toBe(text);
});
it("runtime display hints respect adapter selection/waiting and resolved service", () => {
  const p = incomplete("appointment.create", { customer_name: "Andrinho" }, ["service_ref", "professional_ref", "time"]);
  const child = { sessionId: "child", cancelled: false, message: "Informe serviço e horário exato.", scheduling: { fields: {}, metrics: {}, message: "Informe serviço e horário exato." } } as SecretaryView;
  const units = [{ keys: ["a"], child: "child", kind: "single" as const }], children = [{ operation_ref: "child", state: child }];
  expect(presentationHints(p, units, children).a.fields).toEqual(["service_ref", "time"]);
  expect(secretaryPlanMessage(p, units, children)).toBe("Qual serviço e horário você quer para Andrinho?");
  child.scheduling!.candidates = { kind: "service_ref", items: [{ id: "one", name: "Corte Completo" }, { id: "two", name: "Corte Infantil" }] };
  expect(secretaryPlanMessage(p, units, children)).not.toContain("horário");
  expect(secretaryPlanMessage(p, units, children)).toContain("• Corte Infantil");
});
it("does not deduplicate distinct customers' missing service into one question", () => {
  let p = createActionPlan(plan([intent("appointment.create", { item_key: "a", customer_name: "Fábio" }), intent("appointment.create", { item_key: "b", customer_name: "Alisson" })]));
  for (const key of ["a", "b"]) p = assessPlanAction(p, key, { status: "NEEDS_INPUT", missing_fields: ["service_name"] });
  expect(actionPlanPreview(p).match(/Qual serviço/g)).toHaveLength(2);
});
it("never rewrites EXACT content even when it contains protocol-looking words/questions", () => {
  const content = "service_ref? Use Confirmar? Não alterar!";
  let p = incomplete("customer.message", { communication: { recipient_name: "Amanda", channel: "WHATSAPP", message_mode: "EXACT", content } }, []);
  p = assessPlanAction(p, "a", { status: "READY_FOR_CONFIRMATION", missing_fields: [], proposal_token: "protected", preview: `Mensagem para Amanda:\n${content}` });
  expect(actionPlanPreview(p)).toContain(content);
});
it("failure status stays visible and does not invent a ready proposal", () => {
  const p = assessPlanAction(incomplete("appointment.create", { customer_name: "Fábio" }, []), "a", { status: "DOMAIN_CONFLICT", missing_fields: [], issue: "SLOT_CONFLICT" });
  expect(actionPlanPreview(p)).toContain("há um conflito a revisar");
  expect(actionPlanPreview(p)).not.toMatch(leaks); expect(p.status).toBe("PARTIAL_FAILURE");
});
it("a cancellation/message shared preview also preserves EXACT bytes and appears only once", () => {
  const content = "service_name?\nUse Confirmar exatamente isto.";
  let p = createActionPlan({ ...plan([intent("appointment.cancel", { item_key: "cancel", customer_name: "Amanda" }),
    intent("customer.message", { item_key: "message", depends_on: ["cancel"], communication: { recipient_name: "Amanda", channel: "WHATSAPP", message_mode: "EXACT", content } })]), independent: false });
  for (const key of ["cancel", "message"]) p = assessPlanAction(p, key, { status: "READY_FOR_CONFIRMATION", missing_fields: [], proposal_token: "same", preview: `Cancelar Amanda\nMensagem:\n${content}` });
  const text = actionPlanPreview(p, { cancel: { previewGroup: "pair" }, message: { previewGroup: "pair" } });
  expect(text).toContain(content); expect(text.split(content)).toHaveLength(2);
});

it.each([
  {pending:["source_time"],expected:"horário original"},
  {pending:["date","source_date"],expected:"data e data original"},
])("temporal clarification precedes a downstream appointment lookup: $pending",({pending,expected})=>{
  const initial=createActionPlan(plan([intent("appointment.change",{item_key:"move",customer_name:"Cliente sintético"})]));
  const p=assessPlanAction(initial,"move",{status:"NEEDS_INPUT",missing_fields:["appointment_ref",...pending]});
  const units=[{kind:"single" as const,keys:["move"],child:"child"}];
  const state={sessionId:"child",message:"Informe os dados temporais.",cancelled:false,scheduling:{operation:"appointment.change",fields:{customer_name:"Cliente sintético"},message:"Informe os dados temporais.",metrics:{},draft:{temporal_missing:pending}}} as unknown as SecretaryView;
  const children=[{operation_ref:"child",state}];
  const text=secretaryPlanMessage(p,units,children);
  expect(text).toContain(expected);expect(text).not.toContain("Qual agendamento");
  const context=planConversationContext(p,units,children).actions[0].clarification;
  expect(context.previous_response).toBe(text);
  if(pending.length===1)expect(context.requested_field).toBe(pending[0]);
});
it("a rejected reason asks for that role while the accepted historical reason stays preserved",()=>{
  const initial=createActionPlan(plan([intent("appointment.cancel",{item_key:"cancel",customer_name:"Cliente sintético",reason:"Motivo original"})]));
  const p=assessPlanAction(initial,"cancel",{status:"NEEDS_INPUT",missing_fields:["reason"]});
  const units=[{kind:"single" as const,keys:["cancel"],child:"child"}];
  const state={sessionId:"child",message:"Informe o motivo.",cancelled:false,scheduling:{operation:"appointment.cancel",fields:{reason:"Motivo original"},message:"Informe o motivo.",metrics:{},draft:{source_missing:["reason"]}}} as unknown as SecretaryView;
  const children=[{operation_ref:"child",state}];
  expect(secretaryPlanMessage(p,units,children)).toBe("Qual o motivo do cancelamento?"); // 2026-09-27 Agenda wording; same requested role
  expect(planConversationContext(p,units,children).actions[0].clarification.requested_field).toBe("reason");
  expect((p.actions[0].fields as Record<string,unknown>).reason).toBe("Motivo original");
});
