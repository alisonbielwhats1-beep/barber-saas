import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** C3 suggestions in the other select paths: the customers skill and the cancel→create batch. A clicked suggestion is
 * rechecked by the same suggest function; anything else is SELECTION_INVALID. Fake tenant transaction, no network. */
const io = vi.hoisted(() => ({ customers: [] as { id: string; name: string; phone: string | null }[], appended: [] as unknown[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const mask = (phone: string | null) => phone ? `(${phone.slice(0, 2)}) *****-${phone.slice(-4)}` : null;
const tx = {
  $queryRaw: vi.fn(async (parts: readonly string[], ...values: unknown[]) => {
    const sql = parts.join("?");
    if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
    if (sql.includes('"ClientProfile"')) { const pattern = new RegExp(String(values.at(-1))); return io.customers.filter(row => pattern.test(fold(row.name))); }
    return [{ accessStatus: "APPROVED" }];
  }),
  $executeRaw: vi.fn(async () => 0),
  auditLog: { create: vi.fn(async (input: unknown) => { io.appended.push(input); return {}; }), findFirst: vi.fn(async () => null) },
};
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (t: object) => unknown) => work(tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(),
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, query: string) => io.customers.filter(row => fold(row.name).includes(fold(query.trim()))).map(row => ({ ...row, phone: mask(row.phone) })),
  getCustomer: async (_tx: unknown, _actor: unknown, id: string) => { const row = io.customers.find(item => item.id === id); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return { ...row, email: null }; } }));
vi.mock("../scheduling-mutations", async original => ({ ...await original<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [] }));
import { applyCustomerInterpretation, customerState, selectCustomer } from "../secretary-customers";
import { upsertBatchDraft } from "../scheduling-batch";

const actor = { salonId: "ours", userId: "owner" };
beforeEach(() => {
  vi.clearAllMocks(); io.appended.length = 0;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  io.customers = [{ id: "tatiana", name: "Tatiana Rocha", phone: "11999990001" }, { id: "fabio", name: "Fábio Santos", phone: null }];
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const flag = (on: boolean) => vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", on ? "true" : "false");

describe("customers skill", () => {
  it("flag off: an unknown name is not found, exactly as today", async () => {
    flag(false);
    const state = customerState();
    await applyCustomerInterpretation(actor, state, { operation: "customer.read", target_name: "Tatiane" } as never);
    expect(state.message).toBe("Não encontrei esse cliente neste salão."); expect(state.candidates).toEqual([]); expect(state).not.toHaveProperty("suggested");
  });
  it("flag on: suggestions are options; the click is rechecked by the same function and then resolved", async () => {
    flag(true);
    const state = customerState();
    await applyCustomerInterpretation(actor, state, { operation: "customer.read", target_name: "Tatiane" } as never);
    expect(state).toMatchObject({ suggested: true, candidates: [{ id: "tatiana", name: "Tatiana Rocha", phone: "(11) *****-0001" }] });
    expect(state.target).toBeUndefined();
    expect(state.message).toBe("Não encontrei “Tatiane”. Você quis dizer: 1. Tatiana Rocha · (11) *****-0001? Selecione uma opção ou escreva o nome completo.");
    await selectCustomer(actor, state, "tatiana");
    expect(state.target).toBe("tatiana"); expect(state.suggested).toBeUndefined(); expect(state.customer?.name).toBe("Tatiana Rocha");
  });
  it("flag on: a stale suggestion is SELECTION_INVALID", async () => {
    flag(true);
    const state = customerState();
    await applyCustomerInterpretation(actor, state, { operation: "customer.read", target_name: "Tatiane" } as never);
    io.customers = io.customers.filter(row => row.id !== "tatiana");
    await expect(selectCustomer(actor, state, "tatiana")).rejects.toThrow("SELECTION_INVALID");
    expect(state.target).toBeUndefined();
  });
});

describe("cancel→create batch", () => {
  const plan = (customerRef?: string) => ({ execution_policy: "all_or_nothing", items: [
    { key: "a", operation: "appointment.cancel", depends_on: [], fields: { customer_name: "Tatiane", time: "10:00", ...(customerRef ? { customer_ref: customerRef } : {}) } },
    { key: "b", operation: "appointment.create", depends_on: ["a"], released_slot_of: "a", fields: { customer_name: "Fábio" } }] });
  it("flag off: nothing is suggested and a ref the search does not return is refused", async () => {
    flag(false);
    const draft = await upsertBatchDraft(tx as never, actor, { plan: plan() });
    expect(draft).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["a.customer_ref"], message: "Não encontrei esse cadastro neste salão. Confira o nome." });
    expect(draft.candidates).toBeUndefined();
    expect(await upsertBatchDraft(tx as never, actor, { plan: plan("tatiana") })).toMatchObject({ status: "BLOCKED", message: "Não consegui preparar o cancelamento com o novo agendamento: a opção escolhida não vale mais para este pedido. Nenhuma ação foi executada." });
  });
  it("flag on: the suggestion card is journaled with its source; the clicked ref passes the same recheck, any other ref is refused", async () => {
    flag(true);
    const draft = await upsertBatchDraft(tx as never, actor, { plan: plan() });
    expect(draft).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["a.customer_ref"],
      candidates: { item_key: "a", field: "customer_ref", source: "suggest", items: [{ id: "tatiana", name: "Tatiana Rocha · (11) *****-0001" }] } });
    expect(draft.message).toMatch(/^Não encontrei “Tatiane”\. Você quis dizer: 1\. Tatiana Rocha/);
    // The accepted suggestion moves the plan on to the next real question (the appointment), never an automatic pick.
    const next = await upsertBatchDraft(tx as never, actor, { plan: plan("tatiana") });
    expect(next).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["a.appointment_ref"] });
    expect(next.plan.items[1].fields.customer_ref).toBe("fabio");
    expect(await upsertBatchDraft(tx as never, actor, { plan: plan("fabio") })).toMatchObject({ status: "BLOCKED", message: "Não consegui preparar o cancelamento com o novo agendamento: a opção escolhida não vale mais para este pedido. Nenhuma ação foi executada." });
  });
});
