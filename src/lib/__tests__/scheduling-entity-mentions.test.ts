import { describe, it, expect, vi, afterEach } from "vitest";
const search = vi.hoisted(() => vi.fn());
vi.mock("../customer-catalog", () => ({ searchSalonCustomer: search }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn({}) }));
// The validator imports the catalog statically; these cases never reach the selection path.
vi.mock("../scheduling-catalog", () => ({ listSchedulingServices: vi.fn(async () => []) }));
import { assertSeparateServiceMention, validateSchedulingEntityMentions } from "../scheduling-entity-mentions";
import { runServicesTurn, validateSelection, createServicesAgent } from "@everflair/salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import golden from "../../test/fixtures/secretary-real-outputs.json";

afterEach(() => vi.clearAllMocks());
const actor = { salonId: "synthetic", userId: "owner" };
describe("entity mentions are not interchangeable optional fields", () => {
  it.each(["Amanda Communication Sintética", "Maria Clara de Souza", "João Pedro Santos", "Ana Paula Inventory Teste"])("keeps full customer %s in a dependent plan, service absent", async name => {
    const selected = { ...plan([
      intent("appointment.cancel", { item_key: "a", customer_name: name, day_offset: 1, time: "14:00", reason: "teste" }),
      intent("customer.message", { item_key: "b", depends_on: ["a"], communication: { recipient_name: name, channel: "WHATSAPP", message_mode: "EXACT", content: "Cancelado." } }),
    ]), independent: false };
    const model = new ScriptedServicesModel([call("select_capabilities", selected)]);
    const result = await runServicesTurn(model, `Cancele ${name} amanhã às 14h e avise no WhatsApp: “Cancelado.” Motivo: teste.`, {}, {}, "discovery");
    expect(result.operations[0]).toMatchObject({ customer_name: name, depends_on: [] });
    expect(result.operations[0]).not.toHaveProperty("service_name", expect.any(String));
    expect(result.operations[1]).toMatchObject({ depends_on: ["a"], communication: { recipient_name: name, content: "Cancelado." } });
    await validateSchedulingEntityMentions(actor, `Cancele ${name}`, { customer_name: name });
    expect(search).not.toHaveBeenCalled();
    const instructions = createServicesAgent(model, vi.fn(), "discovery").instructions as string;
    expect(instructions).toContain("preserve o nome completo");
    expect(instructions).toContain("Parte do nome de cliente não é evidência de serviço");
    expect(model.requests).toHaveLength(1);
  });
  it("real failed output is structurally valid but fails backend grounding without reassigning fragments", async () => {
    const recorded = golden.find(g => g.id === "gate27-communication-entity-split")!;
    const message = (recorded as typeof recorded & { source_message: string }).source_message;
    const original = structuredClone(recorded.payload);
    const fake = new ScriptedServicesModel([call("select_capabilities", recorded.payload)]);
    const result = await runServicesTurn(fake, message, {}, {}, "discovery");
    const op = validateSelection(result).operations[0] as (typeof result.operations)[number] & { customer_name: string; service_name: string };
    search.mockResolvedValue([{ id: "backend-only", name: "Amanda Communication Sintética" }]);
    await expect(validateSchedulingEntityMentions(actor, message, { customer_name: op.customer_name!, service_name: op.service_name! })).rejects.toThrow("ENTITY_MENTION_CONFLICT");
    expect(recorded.payload).toEqual(original);
    expect(result.operations[1].depends_on).toEqual(["a"]);
  });
  it("allows full name plus a separate explicit service, even if its words overlap", () => {
    expect(() => assertSeparateServiceMention("Cancele Maria Clara de Souza para Clara", "Clara", ["Maria Clara de Souza"])).not.toThrow();
    expect(() => assertSeparateServiceMention("Cancele Maria Clara de Souza para Corte masculino", "Corte masculino", ["Maria Clara de Souza"])).not.toThrow();
  });
  it.each(["Clara de Souza", "Maria Clara de Souza"])("rejects reuse of %s only inside customer mention", service => {
    expect(() => assertSeparateServiceMention("Cancele Maria Clara de Souza amanhã", service, ["Maria Clara de Souza"])).toThrow("ENTITY_MENTION_CONFLICT");
  });
  it("rejects unsupported service text without looking it up or guessing a customer", async () => {
    search.mockResolvedValue([{ id: "1", name: "João Pedro Santos" }]);
    await expect(validateSchedulingEntityMentions(actor, "Cancele João Pedro Santos", { customer_name: "João", service_name: "Corte" })).rejects.toThrow("ENTITY_MENTION_CONFLICT");
  });
  it("does not choose among ambiguous customers or reinterpret absent catalog matches", async () => {
    for (const candidates of [[], [{ id: "1", name: "Maria Clara de Souza" }, { id: "2", name: "Maria Clara de Souza" }]]) {
      search.mockResolvedValue(candidates);
      const fields = { customer_name: "Maria", service_name: "Corte" };
      await validateSchedulingEntityMentions(actor, "Cancele Maria para Corte", fields);
      expect(fields).toEqual({ customer_name: "Maria", service_name: "Corte" });
    }
  });
  it("token boundaries prevent substring matches and preserve Unicode without name lists", () => {
    expect(() => assertSeparateServiceMention("Cancele Maria", "", [])).toThrow();
    expect(() => assertSeparateServiceMention("Cancele Mariana", "Maria", [])).toThrow();
    expect(() => assertSeparateServiceMention("cancele JOÃO PEDRO para CORTE", "Corte", ["João Pedro"])).not.toThrow();
  });
});
