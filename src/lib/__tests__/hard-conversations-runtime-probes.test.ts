import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntheticFixture } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
const ports = vi.hoisted(() => ({ fixture: undefined as SyntheticFixture | undefined,
  upsert: vi.fn(), availability: vi.fn(), propose: vi.fn(), confirm: vi.fn(), balance: vi.fn() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (actor: { salonId: string }, fn: (tx: object) => unknown) => {
  if (actor.salonId !== ports.fixture!.tenant) throw Error("FORBIDDEN"); return fn({});
} }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), searchSalonCustomer: async (_tx: unknown, _a: unknown, q: string) =>
  ports.fixture!.customers.filter(c => c.tenant === ports.fixture!.tenant && c.name.toLowerCase().includes(q.toLowerCase())) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(),
  listSchedulingServices: async (_tx: unknown, _a: unknown, q: string) => ports.fixture!.services.filter(s => s.name.toLowerCase().includes(q.toLowerCase())),
  listSchedulingProfessionals: async (_tx: unknown, _a: unknown, input: { service_ref?: string; query?: string }) =>
    ports.fixture!.professionals.filter(p => (!input.query || p.name.toLowerCase().includes(input.query.toLowerCase())) &&
      (!input.service_ref || ports.fixture!.services.find(s => s.id === input.service_ref)!.professionalIds.includes(p.id))),
  schedulingTimezone: async () => "America/Sao_Paulo", getSchedulingAvailability: ports.availability,
}));
vi.mock("../scheduling-mutations", async original => ({ ...await original<object>(), authorizeSchedulingOperation: async () => {}, isSchedulingMutation: (op: string) => ["appointment.change", "appointment.cancel", "schedule.block"].includes(op) }));
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(), upsertSchedulingDraft: ports.upsert, proposeAppointmentCreate: ports.propose,
  proposeSchedulingAction: ports.propose, confirmAppointmentCreate: ports.confirm }));
vi.mock("../inventory-catalog", async original => ({ ...await original<object>(), assertInventoryAccess: async () => {},
  searchProducts: async (_tx: unknown, _a: unknown, input: { query: string }) => ports.fixture!.products.filter(p => p.name.toLowerCase().includes(input.query.toLowerCase())),
  getStockBalance: ports.balance,
}));
import { makeFixture, syntheticRef } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
import { schedulingState, applySchedulingInterpretation } from "../secretary-scheduling";
import { inventoryState, applyInventoryInterpretation } from "../secretary-inventory";
import { schedulingRequirements } from "../scheduling-contract";
import { reconcileMessageContent } from "../secretary-communication";
import { hardConversations } from "../../../packages/salon-secretary/evaluation/hard-conversations";
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  ports.fixture = makeFixture("a01", "approximate");
  ports.upsert.mockImplementation(async (_tx: unknown, _actor: unknown, v: { operation: Parameters<typeof schedulingRequirements>[0]; fields: Record<string, unknown>; expected_revision?: number }) => ({
    draft_ref: syntheticRef(ports.fixture!.caseId, "draft"), draft_revision: (v.expected_revision ?? 0) + 1, fields: structuredClone(v.fields),
    status: "NEEDS_INPUT", missing_fields: schedulingRequirements(v.operation).required_fields.filter(k => v.fields[k] === undefined),
  }));
  ports.propose.mockImplementation(() => { throw Error("UNEXPECTED_PROPOSAL"); });
  ports.confirm.mockImplementation(() => { throw Error("EXECUTION_FORBIDDEN"); });
  ports.balance.mockImplementation(async (_tx: unknown, _a: unknown, id: string) => ports.fixture!.products.find(p => p.id === id));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const actor = () => ({ salonId: ports.fixture!.tenant, userId: ports.fixture!.actor });
describe("CURRENT_RUNTIME_BEHAVIOR vs DESIGN_TARGET, real coordinators / mocked data only", () => {
  it.each([
    ["i01", { customer_name: "Alisson", day_offset: 1 }, ["serviço", "horário exato"]],
    ["i02", { customer_name: "Alisson", day_offset: 1, time: "10:00" }, ["serviço"]],
    ["i03", { customer_name: "Alisson", day_offset: 1, service_name: "Corte Completo" }, ["horário exato"]],
    ["i04", { customer_name: "Alisson", time: "15:00", service_name: "Corte Completo" }, ["data"]],
    ["i05", { time: "15:00", day_offset: 1, service_name: "Corte Completo" }, ["cliente"]],
  ] as const)("%s actual minimum clarification frontier", async (id, fields, labels) => {
    ports.fixture = makeFixture(id, "free"); const s = schedulingState();
    await applySchedulingInterpretation(actor(), s, { operation: "appointment.create", ...fields });
    expect(s.message).toBe(`Informe ${labels.join(" e ")}.`);
    expect(ports.availability).not.toHaveBeenCalled(); expect(ports.propose).not.toHaveBeenCalled();
  });
  it("a04 asks between eligible professionals; a09 never creates/substitutes missing service", async () => {
    ports.fixture = makeFixture("a04", "multiple_professionals"); const s = schedulingState();
    await applySchedulingInterpretation(actor(), s, { operation: "appointment.create", customer_name: "Alisson", day_offset: 1, time: "15:00", service_name: "Corte Infantil" });
    expect(s.fields.professional_ref).toBeUndefined(); expect(s.candidates?.items).toHaveLength(2);
    ports.fixture = makeFixture("a09", "free"); const missing = schedulingState();
    await applySchedulingInterpretation(actor(), missing, { operation: "appointment.create", customer_name: "Alisson", day_offset: 1, time: "10:00", service_name: "Escova Premium" });
    expect(missing.fields.service_ref).toBeUndefined(); expect(missing.message).toContain("Não encontrei esse serviço");
    expect(ports.propose).not.toHaveBeenCalled();
  });
  it.each(["i13", "m06", "d08", "m10"])("%s: unquoted EXACT is rejected by current runtime, manifest preserved", id => {
    const c = hardConversations.find(c => c.case_id === id)!;
    const content = c.expected.actions.find(a => a.operation === "customer.message")!.fields.content as string;
    expect(() => reconcileMessageContent({}, { message_mode: "EXACT", content }, c.turns[0].message)).toThrow("MESSAGE_CONTENT_REVIEW_REQUIRED");
  });
  it("unique contains approximation is currently selected without confirmation: known divergence", async () => {
    const s = schedulingState();
    await applySchedulingInterpretation(actor(), s, { operation: "appointment.create", customer_name: "Alisson", service_name: "corte", day_offset: 1 });
    expect(s.fields.service_ref).toBe(ports.fixture!.services[0].id); // record actual gap, do not fix it in runner
    expect(s.waiting_for).toBe("time");
    expect(ports.propose).not.toHaveBeenCalled(); expect(ports.confirm).not.toHaveBeenCalled();
  });
  it("product approximation currently yields balance automatically, still a design divergence", async () => {
    ports.fixture = makeFixture("a08", "free"); const s = inventoryState();
    await applyInventoryInterpretation(actor(), s, { operation: "stock.balance", product_name: "Shampoo" });
    expect(s.status).toBe("DONE"); expect(s.target).toBe(ports.fixture.products[0].id);
    expect(ports.balance).toHaveBeenCalledTimes(1); expect(global.fetch).not.toHaveBeenCalled();
  });
  it("multiple cuts ask selection, never first candidate", async () => {
    ports.fixture = makeFixture("a02", "many_cuts"); const s = schedulingState();
    await applySchedulingInterpretation(actor(), s, { operation: "appointment.create", customer_name: "Alisson", service_name: "corte", day_offset: 1 });
    expect(s.fields.service_ref).toBeUndefined(); expect(s.candidates?.items).toHaveLength(3);
  });
  it("time without service never checks availability prematurely", async () => {
    const s = schedulingState();
    await applySchedulingInterpretation(actor(), s, { operation: "appointment.create", customer_name: "Alisson", time: "10:00", day_offset: 1 });
    expect(s.fields.service_ref).toBeUndefined(); expect(s.fields.professional_ref).toBeUndefined();
    expect(s.message).toContain("serviço"); expect(ports.availability).not.toHaveBeenCalled();
  });
  it("correction keeps draft ref/revisions and invalidates selected service/professional", async () => {
    ports.fixture = makeFixture("t04", "free"); const s = schedulingState();
    await applySchedulingInterpretation(actor(), s, { operation: "appointment.create", customer_name: "Alisson", service_name: "Corte Completo", day_offset: 1 });
    const ref = s.draft!.draft_ref;
    await applySchedulingInterpretation(actor(), s, { service_name: "Corte Infantil" });
    expect(s.draft!.draft_ref).toBe(ref); expect(s.draft!.draft_revision).toBe(2);
    expect(s.fields.professional_ref).toBeUndefined(); expect(s.candidates?.items).toHaveLength(2);
    expect(ports.confirm).not.toHaveBeenCalled();
  });
  it("cross-tenant Alisson is absent even from mocked current coordinator", async () => {
    ports.fixture = makeFixture("x03", "foreign"); const s = schedulingState();
    await applySchedulingInterpretation(actor(), s, { operation: "appointment.create", customer_name: "Alisson", day_offset: 1 });
    expect(s.fields.customer_ref).toBeUndefined(); expect(s.message).toContain("Não encontrei");
  });
});
