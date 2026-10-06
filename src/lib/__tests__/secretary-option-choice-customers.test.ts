import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ logs: [] as Record<string, unknown>[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (tx: object) => unknown) => work({ $executeRaw: async () => 0, auditLog: {
  create: async ({ data }: { data: Record<string, unknown> }) => { db.logs.push(structuredClone(data)); return data; },
  findMany: async () => [], findFirst: async () => null } }) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => undefined, customerDuplicates: async () => [],
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, query: string) => [{ id: "rita-costa", name: "Rita Costa", phone: "***0011" }, { id: "rita-castro", name: "Rita Castro", phone: "***0022" }]
    .filter(row => row.name.toLowerCase().includes(query.toLowerCase())),
  getCustomer: async (_tx: unknown, _actor: unknown, id: string) => ({ id, name: id === "rita-castro" ? "Rita Castro" : "Rita Costa", phone: "***0022", email: null }) }));
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

/** B4 outside the agenda: a customers card chosen by id goes through the same adapter select path as a click. */
const actor = { salonId: "synthetic", userId: "owner" };
beforeEach(() => { db.logs = []; vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const read = { turn: { mode: "NEW", operations: [{ item_key: "a", operation: "customer.read", target_name: "Rita", requested_fields: ["phone"] }] } };
const answer = (fields: Record<string, unknown>, choice: { option_id: string; literal: string }) => call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "a", choice, fields }] } });
async function run(...answers: ReturnType<typeof call>[]) {
  const model = new ScriptedServicesModel([call("select_capabilities", read), ...answers]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await secretary.start(actor, "auto");
  return (message: string) => secretary.send(actor, { sessionId, message });
}
it("the customer card's option chosen by id (with an agreeing name echo) opens exactly that customer", async () => {
  const say = await run(answer({ target_name: "Rita Castro" }, { option_id: "opt_2", literal: "Castro" }));
  const card = await say("Qual o telefone da Rita?");
  expect(card.operations![0].state.customer!.candidates!.map(row => row.id)).toEqual(["rita-costa", "rita-castro"]);
  const chosen = await say("A Castro.");
  expect(chosen.operations![0].state.customer).toMatchObject({ target: "rita-castro", selected_name: "Rita Castro" });
  expect(chosen.operations![0].state.customer!.candidates).toBeUndefined();
});
it("a name that contradicts the chosen option asks again (nothing opened)", async () => {
  const say = await run(answer({ target_name: "Rita Costa" }, { option_id: "opt_2", literal: "Castro" }));
  await say("Qual o telefone da Rita?");
  const asked = await say("A Castro.");
  expect(asked.operations![0].state.customer!.target).toBeUndefined();
  expect(asked.operations![0].state.customer!.candidates).toHaveLength(2);
  expect(asked.message).toContain("Não consegui aplicar essa escolha com segurança");
});
