import { afterEach, describe, expect, it, vi } from "vitest";
import { createServicesAgent, runServicesTurn, paidModelConfig, createPaidModel, instrumentServicesModel, type ModelCallUsage } from "@everflair/salon-secretary";
import { getOperationRequirements } from "../service-contract";
import { serviceScript, ScriptedServicesModel, call, final } from "../../test/scripted-services-model";

afterEach(() => vi.unstubAllGlobals());
describe("isolated Services Agent SDK (no network)", () => {
  it("exposes only U03 extraction function, stops immediately, no handoffs or hosted tools", () => {
    const agent = createServicesAgent(serviceScript(), vi.fn());
    expect(agent.tools.map(t => t.type)).toEqual(["function"]);
    expect(agent.tools.map(t => t.name)).toEqual(["upsert_action_draft"]);
    expect(agent.toolUseBehavior).toBe("stop_on_first_tool");
    expect(agent.handoffs).toHaveLength(0); expect(agent.name).toContain("Services");
  });
  it.each([
    "Cadastre uma massagem por R$50", "Crie um serviço de massagem por cinquenta reais.",
    "Quero cadastrar massagem, valor 50.", "Adicione massagem por R$50.",
  ])("uses exactly one inference per message for scripted interpretation: %s", async message => {
    const network = vi.fn(() => { throw new Error("NO_NETWORK_ALLOWED"); }); vi.stubGlobal("fetch", network);
    const model = serviceScript();
    const first = await runServicesTurn(model, message, undefined, getOperationRequirements());
    expect(first).toEqual({ name: "Massagem", priceCents: 5000 }); expect(model.requests).toHaveLength(1);
    const next = await runServicesTurn(model, "Uma hora", first, getOperationRequirements());
    expect(next).toEqual({ durationMin: 60 }); expect(model.requests).toHaveLength(2);
    expect(model.requests.every(r => r.tracing === false && r.modelSettings.preserveRawUsage === true)).toBe(true);
    expect(JSON.stringify(model.requests[0].input)).toContain(message);
    expect(JSON.stringify(model.requests[1].input)).not.toContain(message);
    expect(JSON.stringify(model.requests[1].input)).toContain("Massagem");
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    final("Cadastrado!"), call("createService", {}), call("get_operation_requirements"),
    [...call("upsert_action_draft", { name: "Massagem", priceCents: 5000, durationMin: null }), ...call("propose_service_create")],
    call("upsert_action_draft", { name: "Massagem", priceCents: 5000, durationMin: null, salonId: "forged" }),
  ].map(output => ({ output })))("rejects invalid/unexpected interpretation in one call without fallback inference", async ({ output }) => {
    const model = new ScriptedServicesModel([output]);
    await expect(runServicesTurn(model, "Cadastre", undefined, getOperationRequirements())).rejects.toThrow();
    expect(model.requests).toHaveLength(1);
  });
  it("blocks paid calls by default and refuses missing dedicated project", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(createPaidModel({ OPENAI_API_KEY: "synthetic-hq-key" })).rejects.toThrow("PAID_CALLS_DISABLED");
    expect(() => paidModelConfig({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true", OPENAI_API_KEY: "synthetic-hq-key" })).toThrow("SECRETARY_CONFIGURATION_REQUIRED");
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["gpt-5.6-luna", "gpt-6-luna"])("serializes %s with one local function and store=false using offline transport only", async modelId => {
    const transport = vi.fn(async () => new Response(JSON.stringify({
      id: "resp_fake", object: "response", created_at: 0, status: "completed", model: modelId,
      output: [{ id: "fc_fake", call_id: "call_fake", type: "function_call", name: "upsert_action_draft",
        arguments: JSON.stringify({ operation:null,target_name:null,name: "Massagem", priceCents: 5000, durationMin: null }), status: "completed" }],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_offline" } }));
    vi.stubGlobal("fetch", transport);
    const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true",
      SALON_SECRETARY_OPENAI_API_KEY: "synthetic-test-key-not-a-real-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic",
      SALON_SECRETARY_MODEL: modelId });
    const events: ModelCallUsage[] = [];
    const measured = instrumentServicesModel(model, modelId, async event => { events.push(event); });
    expect(await runServicesTurn(measured, "Massagem R$50", undefined, getOperationRequirements())).toEqual({ name: "Massagem", priceCents: 5000 });
    expect(events[1]).toMatchObject({ input_tokens: 20, output_tokens: 10, total_tokens: 30,
      cached_input_tokens: null, reasoning_tokens: null, cache_write_tokens: null, model_id_returned: modelId, request_id: "req_offline" });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe(modelId); expect(payload.store).toBe(false);
    expect(payload.tools.map((t: { type: string }) => t.type)).toEqual(["function"]);
    expect(payload).not.toHaveProperty("environment"); expect(payload).not.toHaveProperty("container");
    expect(new Headers(init.headers).get("OpenAI-Project")).toBe("proj_synthetic");
  });
});
