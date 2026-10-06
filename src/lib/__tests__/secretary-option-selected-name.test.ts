import { beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ customerDraft: vi.fn(), propose: vi.fn() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (tx: object) => unknown) => work({ auditLog: { create: async () => ({}) } }) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), customerDuplicates: async () => [],
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, query: string) => [{ id: "rita-costa", name: "Rita Costa", phone: "***0011" }, { id: "rita-castro", name: "Rita Castro", phone: "***0022" }]
    .filter(row => row.name.toLowerCase().includes(query.toLowerCase())) }));
vi.mock("../customer-actions", async original => ({ ...await original<object>(), upsertCustomerDraft: ports.customerDraft, proposeCustomerChange: ports.propose }));
import { applyCustomerInterpretation, customerState, selectCustomer } from "../secretary-customers";

/** B4: after the owner (or an option id) chose one homonym, Luna re-echoing that candidate's own name
 * is not a new target (no lost turn); naming the OTHER homonym still refuses (TARGET_ALREADY_SELECTED). */
const actor = { salonId: "synthetic", userId: "owner" };
beforeEach(() => {
  vi.clearAllMocks();
  ports.propose.mockResolvedValue({ proposal_ref: crypto.randomUUID(), draft_revision: 1, preview: "Confira" });
  ports.customerDraft.mockImplementation(async (_tx, _a, input) => ({ draft_ref: input.draft_ref ?? crypto.randomUUID(), draft_revision: (input.expected_revision ?? 0) + 1, fields: input.patch, status: "READY", missing_fields: [] }));
});
it("an echo of the chosen candidate's name keeps it; the other homonym is refused", async () => {
  const state = customerState();
  await applyCustomerInterpretation(actor, state, { operation: "customer.change", target_name: "Rita", email: "nova@example.test" });
  expect(state.candidates?.map(row => row.id)).toEqual(["rita-costa", "rita-castro"]);
  await selectCustomer(actor, state, "rita-castro");
  expect(state).toMatchObject({ target: "rita-castro", selected_name: "Rita Castro", query: "Rita" });
  await applyCustomerInterpretation(actor, state, { target_name: "Rita Castro", email: "outra@example.test" });
  expect(state.target).toBe("rita-castro"); expect(state.query).toBe("Rita");
  expect(ports.customerDraft.mock.calls.at(-1)![2]).toMatchObject({ customer_ref: "rita-castro", patch: { email: "outra@example.test" } });
  await expect(applyCustomerInterpretation(actor, state, { target_name: "Rita Costa", email: "x@example.test" })).rejects.toThrow("TARGET_ALREADY_SELECTED");
  expect(state.target).toBe("rita-castro");
});

it("cancel→create pair: a fold-equal re-echo keeps the chosen customer and located appointment; another name retargets", async () => {
  const { validateBatchPlan, patchBatch } = await import("../scheduling-batch");
  const pair = validateBatchPlan({ execution_policy: "all_or_nothing", items: [
    { key: "a", operation: "appointment.cancel", depends_on: [], fields: { customer_name: "Amanda", customer_ref: "c-lima", appointment_ref: "appt-lima", time: "10:00" } },
    { key: "b", operation: "appointment.create", depends_on: ["a"], released_slot_of: "a", fields: { customer_name: "Fábio" } }] });
  const echoed = patchBatch(pair, "a", { customer_name: "amanda", reason: "ela viajou" });
  expect(echoed.items[0].fields).toMatchObject({ customer_name: "Amanda", customer_ref: "c-lima", appointment_ref: "appt-lima", reason: "ela viajou" });
  const retargeted = patchBatch(pair, "a", { customer_name: "Amanda Souza" });
  expect(retargeted.items[0].fields).toMatchObject({ customer_name: "Amanda Souza" });
  expect(retargeted.items[0].fields.customer_ref).toBeUndefined(); expect(retargeted.items[0].fields.appointment_ref).toBeUndefined();
});
