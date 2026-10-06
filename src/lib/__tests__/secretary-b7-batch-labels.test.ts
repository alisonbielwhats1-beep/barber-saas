import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** B7: the atomic cancel→create adapter labels its options like the single adapter: homonyms with the masked phone the
 * search already returns, appointments with the human date ("ter, 29/09 às 10h", never the ISO value), and a blocked pair
 * states its cause in pt-BR. Fake tenant transaction (fixture pattern of secretary-name-suggestions-adapters), no network. */
const io = vi.hoisted(() => ({ customers: [] as { id: string; name: string; phone: string | null }[], appointments: [] as Record<string, unknown>[] }));
const mask = (phone: string | null) => phone ? `(${phone.slice(0, 2)}) *****-${phone.slice(-4)}` : null;
const tx = {
  $queryRaw: vi.fn(async (parts: readonly string[]) => parts.join("?").includes('"Membership"') ? [{ role: "OWNER" }] : [{ accessStatus: "APPROVED" }]),
  $executeRaw: vi.fn(async () => 0),
  auditLog: { create: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
};
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (t: object) => unknown) => work(tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(),
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, query: string) => io.customers.filter(row => row.name.toLowerCase().includes(query.trim().toLowerCase())).map(row => ({ ...row, phone: mask(row.phone) })) }));
vi.mock("../scheduling-mutations", async original => ({ ...await original<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => io.appointments }));
import { upsertBatchDraft } from "../scheduling-batch";

const actor = { salonId: "ours", userId: "owner" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  io.customers = [{ id: "amanda-1", name: "Amanda Souza", phone: "11999990001" }, { id: "amanda-2", name: "Amanda Souza", phone: "11999990002" }, { id: "fabio", name: "Fábio Santos", phone: null }];
  io.appointments = [];
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const plan = (cancel: Record<string, unknown>) => ({ execution_policy: "all_or_nothing", items: [
  { key: "a", operation: "appointment.cancel", depends_on: [], fields: { customer_name: "Amanda", time: "10:00", ...cancel } },
  { key: "b", operation: "appointment.create", depends_on: ["a"], released_slot_of: "a", fields: { customer_name: "Fábio" } }] });

describe("cancel→create options are told apart like the single adapter", () => {
  it("two customers with the same name: each option carries its masked phone", async () => {
    const draft = await upsertBatchDraft(tx as never, actor, { plan: plan({}) });
    expect(draft).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["a.customer_ref"] });
    expect(draft.candidates?.items).toEqual([{ id: "amanda-1", name: "Amanda Souza · (11) *****-0001" }, { id: "amanda-2", name: "Amanda Souza · (11) *****-0002" }]);
  });
  it("two appointments: each option shows the human date and clock, never the ISO value", async () => {
    io.appointments = [{ appointment_ref: "ap-1", customer_name: "Amanda Souza", start_local: "2026-09-29T10:00", professional_name: "Tatiana Rocha" },
      { appointment_ref: "ap-2", customer_name: "Amanda Souza", start_local: "2027-01-05T10:00", professional_name: "Rodrigo Lima" }];
    const draft = await upsertBatchDraft(tx as never, actor, { plan: plan({ customer_ref: "amanda-1" }) });
    expect(draft).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["a.appointment_ref"] });
    expect(draft.candidates?.items.map(item => item.name)).toEqual(["Amanda Souza — ter, 29/09 às 10h — Tatiana Rocha", "Amanda Souza — ter, 05/01/2027 às 10h — Rodrigo Lima"]);
    expect(JSON.stringify(draft.candidates)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
  it("a ref the search no longer returns blocks the pair with its cause in pt-BR, never the code", async () => {
    const draft = await upsertBatchDraft(tx as never, actor, { plan: plan({ customer_ref: "someone-else" }) });
    expect(draft).toMatchObject({ status: "BLOCKED", message: "Não consegui preparar o cancelamento com o novo agendamento: a opção escolhida não vale mais para este pedido. Nenhuma ação foi executada." });
    expect(draft.message).not.toMatch(/[A-Z]{2,}_[A-Z]/);
  });
});
