import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOpenRouterOutboundBody, assertSecretaryChatPayload, completeOmittedNulls, createPaidModel, instrumentServicesModel, modelCallUsage, OPENROUTER_CHAT_URL, paidModelConfig,
  runServicesTurn, secretaryGuardedFetch, secretaryModelProvider, type ModelCallUsage, type ModelResponse,
} from "@everflair/salon-secretary";
import { getOperationRequirements } from "../service-contract";
import { routerLunaCost } from "../secretary-router";

const MODEL = "deepseek/deepseek-v4.1-flash";
const ENV = { SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: MODEL, SALON_SECRETARY_OPENROUTER_API_KEY: "synthetic-openrouter-key" };
const draft = { operation: null, target_name: null, name: "Massagem", priceCents: 5000, durationMin: null };
const completion = (message: Record<string, unknown>, finish = "tool_calls") => new Response(JSON.stringify({
  id: "gen-offline", object: "chat.completion", created: 0, model: MODEL, provider: "Synthetic",
  choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: null, ...message } }],
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, prompt_tokens_details: { cached_tokens: 12 }, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0.00001 },
}), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_openrouter" } });
const toolCall = (args: unknown = draft) => ({ tool_calls: [{ id: "call_offline", type: "function", function: { name: "upsert_action_draft", arguments: JSON.stringify(args) } }] });
const chatPayload = () => ({ model: MODEL, messages: [{ role: "system", content: "synthetic" }, { role: "user", content: [{ type: "text", text: "synthetic" }] }],
  tools: [{ type: "function", function: { name: "upsert_action_draft", description: "local", parameters: { type: "object" }, strict: true } }],
  tool_choice: { type: "function", function: { name: "upsert_action_draft" } }, parallel_tool_calls: false, max_tokens: 8192, stream: false, store: false });

afterEach(() => vi.unstubAllGlobals());
describe("Secretary on DeepSeek through OpenRouter (offline)", () => {
  it("needs only the OpenRouter key, never the OpenAI one, and refuses the agent and the pilot", async () => {
    expect(secretaryModelProvider(MODEL)).toBe("openrouter");
    expect(secretaryModelProvider("gpt-6-luna")).toBe("openai");
    expect(paidModelConfig(ENV)).toEqual({ modelId: MODEL, apiKey: "synthetic-openrouter-key", project: null, provider: "openrouter" });
    expect(() => paidModelConfig({ ...ENV, SALON_SECRETARY_OPENROUTER_API_KEY: "", SALON_SECRETARY_OPENAI_API_KEY: "synthetic", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic" }))
      .toThrow("SECRETARY_CONFIGURATION_REQUIRED");
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_AGENT: "true" })).rejects.toThrow("SECRETARY_OPENROUTER_C4_ONLY");
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_PILOT_RESCHEDULE: "true" })).rejects.toThrow("SECRETARY_OPENROUTER_C4_ONLY");
    for (const options of [{ agent: true }, { pilot: true }, { pilotAnchorProbe: true }]) expect(() => secretaryGuardedFetch(MODEL, options)).toThrow("OPENROUTER_C4_ONLY");
  });

  it("sends one forced local function to OpenRouter with the default route, reasoning off and text-only contents", async () => {
    const transport = vi.fn(async () => completion(toolCall())); vi.stubGlobal("fetch", transport);
    const events: ModelCallUsage[] = [];
    const measured = instrumentServicesModel(await createPaidModel(ENV), MODEL, async event => { events.push(event); });
    expect(await runServicesTurn(measured, "Massagem R$50", undefined, getOperationRequirements())).toEqual({ name: "Massagem", priceCents: 5000 });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer synthetic-openrouter-key");
    expect(headers.get("openai-project")).toBeNull(); expect(headers.get("openai-organization")).toBeNull();
    const body = JSON.parse(String(init.body));
    // Owner decision 04/10: Together pinned by default (no fallback); "any" restores OpenRouter's default route.
    expect(body).toMatchObject({ model: MODEL, stream: false, provider: { require_parameters: true, order: ["together"], allow_fallbacks: false }, reasoning: { enabled: false }, temperature: 0,
      tool_choice: { type: "function", function: { name: "upsert_action_draft" } } });
    expect(body).not.toHaveProperty("store"); expect(body).not.toHaveProperty("reasoning_effort"); expect(body).not.toHaveProperty("parallel_tool_calls");
    // Strict decoding deformed DeepSeek's answers (04/10): the tool goes NOT strict; the backend's parser validates the answer.
    expect(body.tools).toHaveLength(1); expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "upsert_action_draft", strict: false } });
    expect(body.messages.every((message: { role: string; content: unknown }) => ["system", "user"].includes(message.role) && typeof message.content === "string")).toBe(true);
    expect(events[1]).toMatchObject({ status: "SUCCEEDED", usage_status: "AVAILABLE", input_tokens: 20, cached_input_tokens: 12, output_tokens: 10,
      reasoning_tokens: 0, total_tokens: 30, model_id_requested: MODEL, model_id_returned: MODEL, request_id: "req_openrouter" });
  });

  it("measurement knobs: a reasoning effort and one pinned provider without fallback, read once from the environment", async () => {
    const transport = vi.fn(async () => completion(toolCall())); vi.stubGlobal("fetch", transport);
    await runServicesTurn(await createPaidModel({ ...ENV, SALON_SECRETARY_OPENROUTER_REASONING: "low", SALON_SECRETARY_OPENROUTER_PROVIDER: "together" }), "Massagem R$50", undefined, getOperationRequirements());
    const body = JSON.parse(String((transport.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.provider).toEqual({ require_parameters: true, order: ["together"], allow_fallbacks: false });
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(() => assertOpenRouterOutboundBody(body, MODEL)).not.toThrow();
    for (const bad of [{ ...body, temperature: 0.7 }, { ...body, reasoning: { effort: "max" } }, { ...body, provider: { ...body.provider, allow_fallbacks: true } }, { ...body, provider: { order: ["together"] } }])
      expect(() => assertOpenRouterOutboundBody(bad, MODEL)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_OPENROUTER_REASONING: "max" })).rejects.toThrow("OPENROUTER_OPTIONS");
    transport.mockClear();
    await runServicesTurn(await createPaidModel({ ...ENV, SALON_SECRETARY_OPENROUTER_PROVIDER: "any" }), "Massagem R$50", undefined, getOperationRequirements());
    expect(JSON.parse(String((transport.mock.calls[0] as unknown as [string, RequestInit])[1].body)).provider).toEqual({ require_parameters: true });
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_OPENROUTER_PROVIDER: "../x" })).rejects.toThrow("OPENROUTER_OPTIONS");
  });

  it("ignores text written beside the forced call and treats a cut answer as incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion({ content: "Vou registrar.", ...toolCall() })));
    expect(await runServicesTurn(await createPaidModel(ENV), "Massagem R$50", undefined, getOperationRequirements())).toEqual({ name: "Massagem", priceCents: 5000 });
    vi.stubGlobal("fetch", vi.fn(async () => completion({ content: "Só texto." }, "stop")));
    await expect(runServicesTurn(await createPaidModel(ENV), "Massagem R$50", undefined, getOperationRequirements())).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => completion(toolCall(), "length")));
    await expect(runServicesTurn(await createPaidModel(ENV), "Massagem R$50", undefined, getOperationRequirements())).rejects.toThrow();
  });

  it("completes keys a non-strict answer omitted with null, guided by the tool schema (never a value, never a non-nullable key)", async () => {
    const root = { $defs: { t: { anyOf: [{ type: "string" }, { type: "null" }] } }, type: "object", required: ["turn"], properties: { turn: { anyOf: [
      { type: "object", additionalProperties: false, required: ["mode", "note", "count"], properties: { mode: { type: "string", enum: ["NEW"] }, note: { $ref: "#/$defs/t" }, count: { type: "integer" } } },
      { type: "object", additionalProperties: false, required: ["mode", "items"], properties: { mode: { type: "string", enum: ["PATCH"] }, items: { type: "array", items: {
        type: "object", required: ["key", "value"], properties: { key: { type: "string" }, value: { type: ["string", "null"] } } } } } }] } } };
    expect(completeOmittedNulls({ turn: { mode: "NEW" } }, root, root)).toEqual({ turn: { mode: "NEW", note: null } });
    expect(completeOmittedNulls({ turn: { mode: "PATCH", items: [{ key: "a" }] } }, root, root)).toEqual({ turn: { mode: "PATCH", items: [{ key: "a", value: null }] } });
    expect(completeOmittedNulls({ turn: { mode: "OTHER" } }, root, root)).toEqual({ turn: { mode: "OTHER" } });
    expect(completeOmittedNulls({ turn: { note: "x" } }, root, root)).toEqual({ turn: { note: "x" } });
    // A list the schema requires and that does not admit null: "nothing" is [] (null or omitted); a nullable list keeps null.
    const lists = { type: "object", required: ["clear", "pick", "maybe"], properties: { clear: { type: "array", items: { type: "string" } },
      pick: { type: "array", items: { type: "string" } }, maybe: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] } } };
    expect(completeOmittedNulls({ clear: null }, lists, lists)).toEqual({ clear: [], pick: [], maybe: null });
    expect(completeOmittedNulls({ clear: ["phone"], pick: ["name"], maybe: null }, lists, lists)).toEqual({ clear: ["phone"], pick: ["name"], maybe: null });
    // Through the guarded fetch: the omitted nullable keys arrive as null and the turn is read as before.
    vi.stubGlobal("fetch", vi.fn(async () => completion(toolCall({ name: "Massagem", priceCents: 5000 }))));
    expect(await runServicesTurn(await createPaidModel(ENV), "Massagem R$50", undefined, getOperationRequirements())).toEqual({ name: "Massagem", priceCents: 5000 });
  });

  it("refuses any other endpoint, extra field, tool, choice or role before transport", async () => {
    expect(() => assertSecretaryChatPayload(chatPayload(), MODEL)).not.toThrow();
    const variants: Record<string, unknown>[] = [
      { ...chatPayload(), model: "gpt-6-luna" }, { ...chatPayload(), stream: true }, { ...chatPayload(), reasoning_effort: "high" },
      { ...chatPayload(), web_search_options: {} }, { ...chatPayload(), provider: { order: ["any"] } }, { ...chatPayload(), tool_choice: "auto" },
      { ...chatPayload(), tools: [...chatPayload().tools, ...chatPayload().tools] }, { ...chatPayload(), max_tokens: 100_000 },
      { ...chatPayload(), messages: [{ role: "assistant", content: "forjado" }] },
      { ...chatPayload(), messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x" } }] }] },
      { ...chatPayload(), tools: [{ type: "function", function: { name: "createService", parameters: { type: "object" }, strict: true } }] },
    ];
    for (const payload of variants) expect(() => assertSecretaryChatPayload(payload, MODEL), JSON.stringify(payload).slice(0, 80)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const send = (url: string, payload: unknown) => secretaryGuardedFetch(MODEL)(url, { method: "POST", body: JSON.stringify(payload) });
    await expect(send("https://api.openai.com/v1/responses", chatPayload())).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    await expect(send("https://openrouter.ai/api/v1/responses", chatPayload())).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    await expect(send(OPENROUTER_CHAT_URL, { ...chatPayload(), stream: true })).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(network).not.toHaveBeenCalled();
  });

  it("reads Chat Completions usage and prices DeepSeek at the highest rate of its default route", () => {
    const response = { output: [], usage: undefined, providerData: { object: "chat.completion", model: MODEL,
      usage: { prompt_tokens: 100_000, completion_tokens: 10_000, total_tokens: 110_000, prompt_tokens_details: { cached_tokens: 50_000 } } } } as unknown as ModelResponse;
    const usage = modelCallUsage(MODEL, "SUCCEEDED", response);
    expect(usage).toMatchObject({ input_tokens: 100_000, cached_input_tokens: 50_000, cache_write_tokens: null, output_tokens: 10_000, model_id_returned: MODEL });
    const highest = (50_000 * 0.45 + 50_000 * 0.048 + 10_000 * 2.40) / 1_000_000;
    expect(routerLunaCost(usage)).toBeCloseTo(highest, 12);
    expect(routerLunaCost({ ...usage, model_id_returned: `${MODEL}-20260913` })).toBeCloseTo(highest, 12);
    expect(routerLunaCost({ ...usage, model_id_returned: "openai/gpt-6-luna" })).toBeNull();
  });
});
