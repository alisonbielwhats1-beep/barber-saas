import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ batchDraft: vi.fn(), batchProposal: vi.fn(), auditLog: { create: vi.fn() }, $queryRaw: vi.fn(), salon: { findUniqueOrThrow: vi.fn() } }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(mocks) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => {} }));
vi.mock("../scheduling-batch", async original => ({ ...await original<object>(), upsertBatchDraft: mocks.batchDraft, proposeActionBatch: mocks.batchProposal }));
import { SalonSecretary } from "../salon-secretary";
import { validateBatchPlan, type BatchPlan } from "../scheduling-batch";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";

/** B4 over the atomic cancel→create pair: the pair's own pick card (a homonym for the new appointment)
 * chosen by id goes through selectBatch like a click; the journal still validates the whole pair. */
const actor = { salonId: "synthetic", userId: "synthetic" };
const fabios = [{ id: "fabio-santos", name: "Fábio Santos" }, { id: "fabio-lima", name: "Fábio Lima" }];
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  mocks.auditLog.create.mockResolvedValue({}); mocks.salon.findUniqueOrThrow.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  mocks.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    return sql.includes('"Membership"') ? [{ role: "OWNER" }] : [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  let revision = 0;
  mocks.batchDraft.mockImplementation(async (_tx, _actor, value: { plan: BatchPlan }) => {
    const accepted = validateBatchPlan(value.plan), chosen = accepted.items[1].fields.customer_ref;
    return { plan: accepted, draft_ref: "11111111-1111-4111-8111-111111111111", draft_revision: ++revision, operation: "action.batch", expires_at: "2099-01-01T00:00:00.000Z", metrics: {},
      ...(chosen ? { status: "READY", missing_fields: [], message: "Plano validado." }
        : { status: "NEEDS_INPUT", missing_fields: ["b.customer_ref"], message: "Selecione a correspondência correta. Nenhuma ação foi executada.", candidates: { item_key: "b", field: "customer_ref", items: fabios } }) };
  });
  mocks.batchProposal.mockImplementation(async (_tx, _actor, value) => ({ ...value, proposal_ref: crypto.randomUUID(), payload_hash: "batch-hash", preview: "Cancelar Amanda; Fábio — Corte" }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const pair = { ...plan([
  intent("appointment.cancel", { item_key: "a", depends_on: [], customer_name: "Amanda Souza", reason: "Pedido dela" }),
  intent("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a", customer_name: "Fábio", service_name: "Corte" })]), independent: false };
const answer = (fields: Record<string, unknown>, choice: { option_id: string; literal: string }) =>
  call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "b", choice, fields }] } });
it.each([
  ["the option chosen by id (agreeing echo) is selected through the pair's own pick", { customer_name: "Fábio Lima" }, { option_id: "opt_2", literal: "Lima" }, "fabio-lima"],
  ["an echo naming the other option asks again", { customer_name: "Fábio Santos" }, { option_id: "opt_2", literal: "Lima" }, undefined],
] as const)("%s", async (_label, fields, choice, chosen) => {
  const model = new ScriptedServicesModel([call("select_capabilities", pair), answer(fields, choice)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await secretary.start(actor, "auto");
  const card = await secretary.send(actor, { sessionId, message: "Cancele a Amanda Souza, Pedido dela, e coloque o Fábio no lugar para Corte" });
  expect(card.operations![0].state.batch!.draft!.candidates!.items).toEqual(fabios);
  const next = await secretary.send(actor, { sessionId, message: "O Fábio Lima." });
  const batch = next.operations![0].state.batch!;
  expect(batch.plan.items[1].fields.customer_ref).toBe(chosen);
  if (chosen) { expect(next.action_plan!.actions.map(action => action.status)).toEqual(["READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]); expect(batch.proposal).toBeDefined(); }
  else { expect(batch.draft!.candidates!.items).toHaveLength(2); expect(next.message).toContain("Não consegui aplicar essa escolha com segurança"); }
  expect(model.requests).toHaveLength(2);
});
