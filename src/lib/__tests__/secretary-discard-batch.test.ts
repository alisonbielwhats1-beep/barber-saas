import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ batchDraft: vi.fn(), batchProposal: vi.fn(), batchConfirm: vi.fn(),
  messageDraft: vi.fn(), messageProposal: vi.fn(), messageConfirm: vi.fn(), serviceDraft: vi.fn(), serviceProposal: vi.fn(), serviceConfirm: vi.fn(),
  auditLog: { create: vi.fn() }, $queryRaw: vi.fn(), salon: { findUniqueOrThrow: vi.fn() } }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(mocks) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => {},
  searchSalonCustomer: async () => [{ id: "amanda-backend", name: "Amanda Souza" }] }));
vi.mock("../service-catalog", async original => ({ ...await original<object>(), assertServiceWriter: async () => ({ currency: "BRL" }),
  findCatalogServices: async () => [{ id: "massagem-backend", name: "Massagem" }] }));
vi.mock("../scheduling-batch", async original => ({ ...await original<object>(), upsertBatchDraft: mocks.batchDraft,
  proposeActionBatch: mocks.batchProposal, confirmActionBatch: mocks.batchConfirm }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(), upsertActionDraft: mocks.serviceDraft,
  proposeServiceChange: mocks.serviceProposal, confirmServiceCreate: mocks.serviceConfirm }));
vi.mock("../communication-actions", async original => ({ ...await original<object>(), assertCommunicationAccess: async () => {},
  getCustomerMessageContext: async () => ({ channel_eligible: true }), upsertMessageDraft: mocks.messageDraft,
  proposeCustomerMessage: mocks.messageProposal, confirmCustomerMessage: mocks.messageConfirm,
  dispatchLocalMessage: async () => ({ status: "SIMULATED", metrics: {} }), communicationMetrics: async () => {} }));
import { SalonSecretary } from "../salon-secretary";
import { validateBatchPlan } from "../scheduling-batch";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import { expandedWire, turnWire } from "../../test/secretary-wire-schema";
import type { ActionPlan } from "@everflair/salon-secretary";

/** B3 DISCARD over atomic units (cancel→create in the released slot, cancel→message) and dependents. */
const actor = { salonId: "synthetic", userId: "synthetic" };
const exact = "  Seu horário foi cancelado.\nObrigada! 😊  ";
const approvals = (p: ActionPlan) => p.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }));
const statuses = (p: ActionPlan) => Object.fromEntries(p.actions.map(action => [action.key, action.status]));
const input = (message = false) => ({ ...plan([
  intent("appointment.cancel", { item_key: "a", depends_on: [], customer_name: "Amanda Souza", day_offset: 1, time: "10:00", reason: "Pedido dela" }),
  intent("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a", customer_name: "Fábio Santos", service_name: "Corte Completo" }),
  intent("service.change", { item_key: "c", depends_on: [], target_name: "Massagem", priceCents: 8000 }),
  intent("financial.report", { item_key: "d", depends_on: [], financial: { metrics: ["service_revenue"], period: "yesterday" } }),
  ...(message ? [intent("customer.message", { item_key: "e", depends_on: ["a"], communication: {
    recipient_name: "Amanda Souza", channel: "WHATSAPP", message_mode: "EXACT", content: "rewritten by fake interpreter" } })] : []),
]), independent: false });
const request = (message: boolean) => `Cancele Amanda. Motivo: Pedido dela; agende Fábio para Corte Completo; altere Massagem para R$80 e consulte ontem.${message ? ` Envie exatamente “${exact}”` : ""}`;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  mocks.auditLog.create.mockResolvedValue({}); mocks.salon.findUniqueOrThrow.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  mocks.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
    if (sql.includes("WITH ranges")) return [{ label: "current", revenue: 12000n, count: 2n, products: 0n, product_invalid: 0n,
      received: 0n, payment_count: 0n, payment_invalid: 0n, receivable: 0n, unpaid_count: 0n, unpaid_invalid: 0n, snapshot_invalid: 0n, groups: [] }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  const draft_ref = crypto.randomUUID(), proposal_ref = crypto.randomUUID();
  mocks.batchDraft.mockImplementation(async (_tx, _actor, value) => ({ plan: validateBatchPlan(value.plan), draft_ref,
    draft_revision: 1, status: "READY", missing_fields: [], message: "Cancelamento + criação, disponibilidade projetada backend", metrics: {},
    snapshot: { cancel: { customer_ref: "amanda-backend" } } }));
  mocks.batchProposal.mockResolvedValue({ draft_ref, draft_revision: 1, proposal_ref, payload_hash: "batch-hash", preview: "Cancelar Amanda; Fábio — Corte Completo" });
  mocks.batchConfirm.mockResolvedValue({ receipt_ref: "batch-receipt", results: [{ key: "a", outcome: "CANCELLED" }, { key: "b", outcome: "CONFIRMED" }] });
  mocks.serviceDraft.mockResolvedValue({ change: true, draft_ref: crypto.randomUUID(), draft_revision: 1, fields: { name: "Massagem", priceCents: 8000, durationMin: 30 }, status: "READY", missing_fields: [] });
  mocks.serviceProposal.mockResolvedValue({ draft_revision: 1, proposal_ref: crypto.randomUUID(), payload_hash: "service-hash", preview: "Massagem R$80", change: true });
  mocks.serviceConfirm.mockResolvedValue({ receipt_ref: "service-receipt", service: { id: "massagem-backend", name: "Massagem" } });
  mocks.messageDraft.mockImplementation(async (_tx, _actor, value) => ({ draft_ref: crypto.randomUUID(), draft_revision: 1, fields: value.patch, status: "READY", missing_fields: [] }));
  mocks.messageProposal.mockResolvedValue({ draft_revision: 1, proposal_ref: crypto.randomUUID(), payload_hash: "message-hash", preview: exact });
  mocks.messageConfirm.mockResolvedValue({ receipt_ref: "message-receipt", message_ref: "fake-outbox-ref" });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function secretary(...outputs: ReturnType<typeof call>[]) {
  const model = new ScriptedServicesModel(outputs);
  return { s: new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true }), model };
}

// Review 2b contract migration: a discard whose closure reaches actions the owner did not name (atomic partner,
// dependents) is asked first and changes nothing; it proceeds only when the owner confirms that whole set
// (the screen's `linked`, or a DISCARD naming every key). The cascade itself is unchanged once confirmed.
it("discarding half of the atomic cancel→create pair asks first; confirmed, it discards the whole unit; the independent write stays confirmable", async () => {
  const { s } = secretary(call("select_capabilities", input(false)));
  const session = await s.start(actor, "auto"), view = await s.send(actor, { sessionId: session.sessionId, message: request(false) });
  expect(statuses(view.action_plan!)).toEqual({ a: "READY_FOR_CONFIRMATION", b: "READY_FOR_CONFIRMATION", c: "READY_FOR_CONFIRMATION", d: "DONE" });
  const asked = await s.discardAction(actor, session.sessionId, { plan_ref: view.action_plan!.plan_ref, action_key: "b" });
  expect(statuses(asked.action_plan!)).toEqual(statuses(view.action_plan!)); expect(asked.action_plan!.revision).toBe(view.action_plan!.revision);
  expect(asked.message).toMatch(/^Descartar o agendamento de Fábio Santos também descarta o cancelamento de Amanda Souza, que está ligado a esse item\. Quer que eu descarte os dois\? Nada foi alterado\.\n\n/);
  // A screen that named another set (stale) is asked again; nothing changes.
  const stale = await s.discardAction(actor, session.sessionId, { plan_ref: view.action_plan!.plan_ref, action_key: "b", linked: ["c"] });
  expect(statuses(stale.action_plan!)).toEqual(statuses(view.action_plan!)); expect(stale.message).toMatch(/^Descartar o agendamento de Fábio Santos também descarta/);
  const after = await s.discardAction(actor, session.sessionId, { plan_ref: view.action_plan!.plan_ref, action_key: "b", linked: ["a"] });
  expect(statuses(after.action_plan!)).toEqual({ a: "DISCARDED", b: "DISCARDED", c: "READY_FOR_CONFIRMATION", d: "DONE" });
  expect(after.message).toMatch(/^Certo, descartei o agendamento de Fábio Santos\. Também descartei o cancelamento de Amanda Souza, que estava ligado a esse item\. Nada foi alterado\.\n\n/);
  expect(after.action_plan!.confirmation_groups.flatMap(group => group.action_keys).sort()).toEqual(["c", "d"]);
  expect(after.operations!.some(op => op.action_keys?.includes("a") || op.action_keys?.includes("b"))).toBe(false);
  expect(after.operations!.every(op => !op.state.batch)).toBe(true);
  await expect(s.confirmReadyGroups(actor, session.sessionId, approvals(view.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
  const done = await s.confirmReadyGroups(actor, session.sessionId, approvals(after.action_plan!));
  expect(statuses(done.action_plan!)).toEqual({ a: "DISCARDED", b: "DISCARDED", c: "DONE", d: "DONE" });
  expect(mocks.batchConfirm).not.toHaveBeenCalled(); expect(mocks.serviceConfirm).toHaveBeenCalledOnce();
});

it("a Luna DISCARD of the cancellation asks before closing its pair and the dependent message; a DISCARD of the whole set then discards it; nothing executes", async () => {
  const discard = (item_keys: string[]) => call("select_capabilities", { turn: { mode: "DISCARD", item_keys } });
  const { s, model } = secretary(call("select_capabilities", input(true)), discard(["a"]), discard(["a"]), discard(["a", "b", "e"]),
    call("upsert_action_draft", { turn: { mode: "CONVERSATION", response: "Combinado." } }));
  const session = await s.start(actor, "auto"), view = await s.send(actor, { sessionId: session.sessionId, message: request(true) });
  expect(statuses(view.action_plan!)).toMatchObject({ a: "READY_FOR_CONFIRMATION", b: "READY_FOR_CONFIRMATION", e: "READY_FOR_CONFIRMATION" });
  const asked = await s.send(actor, { sessionId: session.sessionId, message: "Não, deixa o cancelamento da Amanda." });
  expect(statuses(asked.action_plan!)).toEqual(statuses(view.action_plan!));
  const question = "Descartar o cancelamento de Amanda Souza também descarta o agendamento de Fábio Santos e a mensagem para Amanda Souza, que estão ligados a esse item. Quer que eu descarte os 3? Nada foi alterado.";
  expect(asked.message.startsWith(`${question}\n\n`)).toBe(true);
  // The question is published once to the next turn; a DISCARD of fewer keys (e.g. a "não, deixa" read as DISCARD) asks again.
  const again = await s.send(actor, { sessionId: session.sessionId, message: "Não, deixa." });
  expect(JSON.stringify(model.requests[2])).toContain('\\"pending_discard\\":{');
  expect(statuses(again.action_plan!)).toEqual(statuses(view.action_plan!)); expect(again.message.startsWith(`${question}\n\n`)).toBe(true);
  const after = await s.send(actor, { sessionId: session.sessionId, message: "Pode descartar os três." });
  expect(statuses(after.action_plan!)).toEqual({ a: "DISCARDED", b: "DISCARDED", c: "READY_FOR_CONFIRMATION", d: "DONE", e: "DISCARDED" });
  expect(after.message).toMatch(/^Certo, descartei o cancelamento de Amanda Souza, o agendamento de Fábio Santos e a mensagem para Amanda Souza\. Nada foi alterado\./);
  expect(after.action_plan!.dependencies).toEqual(view.action_plan!.dependencies);
  expect(mocks.batchConfirm).not.toHaveBeenCalled(); expect(mocks.messageConfirm).not.toHaveBeenCalled(); expect(mocks.serviceConfirm).not.toHaveBeenCalled();
  const router = mocks.auditLog.create.mock.calls.map(([arg]) => arg.data).filter(data => data.entityType === "SECRETARY_ROUTER");
  expect(router[3].metadata.outcome).toMatchObject({ kind: "DISCARDED", discarded_actions: 3 });
  // Next turn: discarded keys stay visible as taken, but no branch lets Luna answer or discard them again.
  const next = await s.send(actor, { sessionId: session.sessionId, message: "Beleza." });
  expect(next.capability_status).toBe("CONVERSATION"); expect(model.requests).toHaveLength(5);
  const wire = expandedWire((model.requests[4].tools[0] as { parameters: unknown }).parameters);
  expect((turnWire(wire, "DISCARD").properties!.item_keys.anyOf![0].items!.enum)).toEqual(["c"]);
  expect(turnWire(wire, "PATCH").properties!.operations.items!.properties!.item_key.enum).toEqual(["c"]);
  expect(JSON.stringify(model.requests[4])).toContain('\\"item_key\\":\\"e\\",\\"status\\":\\"DISCARDED\\"');
  expect(JSON.stringify(model.requests[4])).not.toContain('\\"pending_discard\\":');
});

it("completed actions are immutable: DONE is never discarded and a refused discard changes nothing", async () => {
  const { s } = secretary(call("select_capabilities", input(false)));
  const session = await s.start(actor, "auto"), view = await s.send(actor, { sessionId: session.sessionId, message: request(false) });
  const plan = view.action_plan!, service = approvals(plan).find(approval => plan.confirmation_groups.find(group => group.key === approval.group_key)!.action_keys.includes("c"))!;
  const confirmed = await s.confirmActionPlanGroup(actor, session.sessionId, service);
  expect(statuses(confirmed.action_plan!)).toMatchObject({ c: "DONE", d: "DONE" });
  for (const key of ["c", "d"]) await expect(s.discardAction(actor, session.sessionId, { plan_ref: plan.plan_ref, action_key: key })).rejects.toThrow("ALREADY_CONFIRMED");
  const operation = confirmed.operations!.find(op => op.action_keys?.includes("c"))!.operation_ref;
  await expect(s.cancelAutomaticOperation(actor, session.sessionId, operation)).rejects.toThrow("ALREADY_CONFIRMED");
  expect(mocks.serviceConfirm).toHaveBeenCalledOnce();
  // Only DONE and DISCARDED remain after this discard: the plan is retired, never kept for resumption.
  // (Review 2b: the linked create is named and confirmed with the discard; without it the backend asks first.)
  const asked = await s.discardAction(actor, session.sessionId, { plan_ref: plan.plan_ref, action_key: "a" });
  expect(statuses(asked.action_plan!)).toMatchObject({ a: "READY_FOR_CONFIRMATION", b: "READY_FOR_CONFIRMATION" });
  const retired = await s.discardAction(actor, session.sessionId, { plan_ref: plan.plan_ref, action_key: "a", linked: ["b"] });
  expect(retired.action_plan).toBeUndefined(); expect(retired.suspended_plans).toBeUndefined();
  expect(retired.message).toBe("Certo, descartei o cancelamento de Amanda Souza. Também descartei o agendamento de Fábio Santos, que estava ligado a esse item. Nada foi alterado.");
  const recorded = mocks.auditLog.create.mock.calls.map(([arg]) => arg.data).filter(data => data.entityType === "SECRETARY_OPERATION_PLAN").at(-1)!;
  expect(Object.fromEntries(recorded.metadata.action_plan.actions.map((action: { key: string; status: string }) => [action.key, action.status])))
    .toEqual({ a: "DISCARDED", b: "DISCARDED", c: "DONE", d: "DONE" });
  expect(mocks.batchConfirm).not.toHaveBeenCalled(); expect(mocks.serviceConfirm).toHaveBeenCalledOnce();
});
