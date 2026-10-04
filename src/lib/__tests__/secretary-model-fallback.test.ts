import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import {
  MODEL_FALLBACK_BREAKER, createPaidModel, certifiedModelEnv, instrumentServicesModel, modelFallbackReason, parseModelCertificates, registeredModelOfReturnedId,
  resetModelFallbackBreakers, runServicesTurn, withModelFallback, type Model, type ModelCallUsage, type ModelRequest, type ModelResponse,
} from "@everflair/salon-secretary";
import { getOperationRequirements } from "../service-contract";

/** Plan B (owner decision 04/10/2026): a certified reserve model answers when the main model's provider fails. Offline only. */
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";
const ENV = { SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: DEEPSEEK, SALON_SECRETARY_OPENROUTER_API_KEY: "synthetic-openrouter-key",
  SALON_SECRETARY_OPENAI_API_KEY: "synthetic-openai-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic", SALON_SECRETARY_FALLBACK_MODEL: "gpt-6-luna" };
const draft = { operation: null, target_name: null, name: "Massagem", priceCents: 5000, durationMin: null };
const lunaAnswer = () => new Response(JSON.stringify({ id: "resp_reserve", object: "response", created_at: 0, status: "completed", model: "gpt-6-luna",
  output: [{ id: "fc_reserve", call_id: "call_reserve", type: "function_call", name: "upsert_action_draft", arguments: JSON.stringify(draft), status: "completed" }],
  usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_reserve" } });
const failure = (status: number) => new Response(JSON.stringify({ error: { message: "synthetic provider failure" } }), { status, headers: { "content-type": "application/json" } });
const httpError = (status: number) => APIError.generate(status, { message: "synthetic" }, "synthetic", new Headers());
const wrapped = (message: string) => new APIConnectionError({ cause: new Error(message) });
const answer = { output: [], usage: undefined, providerData: {} } as unknown as ModelResponse;
const scripted = (steps: (() => Promise<ModelResponse>)[]) => { const calls = vi.fn(async () => (steps.shift() ?? (async () => answer))());
  return { calls, model: { getResponse: calls, async *getStreamedResponse() { throw Error("no"); } } as unknown as Model }; };
const request = {} as ModelRequest;

beforeEach(() => resetModelFallbackBreakers());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("plan B: which failures the reserve may cover", () => {
  it("provider and transport failures yes; our own refusals, a cancelled call and an unreadable answer never", () => {
    for (const status of [500, 502, 503, 404, 429, 402, 401, 400]) expect(modelFallbackReason(httpError(status)), String(status)).toBe(`HTTP_${status}`);
    expect(modelFallbackReason(new APIConnectionError({ cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) }))).toBe("CONNECTION");
    expect(modelFallbackReason(new APIConnectionTimeoutError())).toBe("TIMEOUT");
    for (const refusal of ["SECRETARY_OPENAI_COST_GUARD:PAYLOAD_FIELDS", "LOCAL_DEMO_OPENROUTER_BUDGET_EXCEEDED", "PROGRAM_SPEND_CAP"])
      expect(modelFallbackReason(wrapped(refusal)), refusal).toBeNull();
    expect(modelFallbackReason(new APIUserAbortError())).toBeNull();
    expect(modelFallbackReason(httpError(500), { signal: AbortSignal.abort() })).toBeNull();
    expect(modelFallbackReason(new Error("INTERPRETATION_INVALID"))).toBeNull();
  });

  it("the breaker sends calls straight to the reserve after consecutive failures, then tries the main model again after the cooldown", async () => {
    let now = 1_000_000;
    const main = scripted([async () => { throw httpError(503); }, async () => { throw new APIConnectionTimeoutError(); }]), reserve = scripted([]);
    const events: unknown[] = [];
    const model = withModelFallback({ id: DEEPSEEK, model: main.model }, { id: "gpt-6-luna", model: reserve.model }, { now: () => now, onFallback: event => events.push(event) });
    await model.getResponse(request); await model.getResponse(request);
    expect(main.calls).toHaveBeenCalledTimes(2); expect(reserve.calls).toHaveBeenCalledTimes(2);
    await model.getResponse(request); // breaker open: the main model is not tried
    expect(main.calls).toHaveBeenCalledTimes(2); expect(reserve.calls).toHaveBeenCalledTimes(3);
    expect(events).toEqual([{ from: DEEPSEEK, to: "gpt-6-luna", reason: "HTTP_503", breaker: "CLOSED" }, { from: DEEPSEEK, to: "gpt-6-luna", reason: "TIMEOUT", breaker: "OPEN" },
      { from: DEEPSEEK, to: "gpt-6-luna", reason: "BREAKER_OPEN", breaker: "OPEN" }]);
    now += MODEL_FALLBACK_BREAKER.cooldownMs + 1; // half-open: the main model answers again and the breaker closes
    await model.getResponse(request); await model.getResponse(request);
    expect(main.calls).toHaveBeenCalledTimes(4); expect(reserve.calls).toHaveBeenCalledTimes(3);
  });

  it("our refusal surfaces as it is and the reserve is never called", async () => {
    const main = scripted([async () => { throw wrapped("SECRETARY_OPENAI_COST_GUARD:TOOL_FIELDS"); }]), reserve = scripted([]);
    const model = withModelFallback({ id: DEEPSEEK, model: main.model }, { id: "gpt-6-luna", model: reserve.model });
    await expect(model.getResponse(request)).rejects.toThrow(APIConnectionError);
    expect(reserve.calls).not.toHaveBeenCalled();
  });
});

describe("plan B through the model factory (real SDK, offline transport)", () => {
  it("OpenRouter fails, GPT-6 Luna answers the same turn; telemetry shows who answered and the event names codes only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const transport = vi.fn(async (input: unknown) => String(input).startsWith("https://openrouter.ai/") ? failure(502) : lunaAnswer());
    vi.stubGlobal("fetch", transport);
    const events: ModelCallUsage[] = [];
    const measured = instrumentServicesModel(await createPaidModel(ENV), DEEPSEEK, async event => { events.push(event); });
    expect(await runServicesTurn(measured, "Massagem R$50", undefined, getOperationRequirements())).toEqual({ name: "Massagem", priceCents: 5000 });
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual(["https://openrouter.ai/api/v1/chat/completions", "https://api.openai.com/v1/responses"]);
    expect(events.at(-1)).toMatchObject({ status: "SUCCEEDED", model_id_requested: DEEPSEEK, model_id_returned: "gpt-6-luna", input_tokens: 20, output_tokens: 10 });
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([{ event: "SECRETARY_MODEL_FALLBACK", from: DEEPSEEK, to: "gpt-6-luna", reason: "HTTP_502", breaker: "CLOSED" }]);
    // The reserve went out through its own guarded wire (OpenAI's Responses API with its own credentials).
    expect(new Headers((transport.mock.calls[1] as unknown as [string, RequestInit])[1].headers).get("authorization")).toBe("Bearer synthetic-openai-key");
  });

  it("refuses a reserve that cannot stand in: the same model, missing credentials, or no agent support while the agent is on", async () => {
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_FALLBACK_MODEL: DEEPSEEK })).rejects.toThrow("SECRETARY_FALLBACK_INCOMPATIBLE");
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_OPENAI_API_KEY: "" })).rejects.toThrow("SECRETARY_CONFIGURATION_REQUIRED");
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_FALLBACK_MODEL: "gpt-6-sol" })).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    await expect(createPaidModel({ ...ENV, SALON_SECRETARY_MODEL: "gpt-6-luna", SALON_SECRETARY_FALLBACK_MODEL: DEEPSEEK, SALON_SECRETARY_AGENT: "true" }))
      .rejects.toThrow("SECRETARY_FALLBACK_INCOMPATIBLE");
    // No reserve configured: exactly the single model of before.
    vi.stubGlobal("fetch", vi.fn(async () => failure(502)));
    await expect(runServicesTurn(await createPaidModel({ ...ENV, SALON_SECRETARY_FALLBACK_MODEL: "" }), "Massagem R$50", undefined, getOperationRequirements())).rejects.toThrow();
  });
});

describe("plan B under the quality gate", () => {
  const certificate = (model: string, contractVersion: string) => ({ model, contractVersion, contractEnv: {}, certifiedAt: "2026-10-04T18:00:00.000Z",
    evidence: { suite: "golden-free-use-30", run: "golden-x", binding: "b".repeat(64), repeat: 3, cases: 30, passed: 90, total: 90, safetyFailures: 0, p50Ms: 1, p90Ms: 2 } });
  const versions: Record<string, string> = { [DEEPSEEK]: "a".repeat(64), "gpt-6-luna": "c".repeat(64) };
  const versionOf = (modelId: string) => versions[modelId] ?? "0".repeat(64);
  const staging = { ...ENV, APP_ENV: "staging" };
  it("staging/production: the main model must be certified; an uncertified reserve is left out, a certified one stays", () => {
    const onlyMain = parseModelCertificates({ schema: "secretary-model-certificates-v1", note: "", certificates: [certificate(DEEPSEEK, versions[DEEPSEEK])] });
    expect(certifiedModelEnv(staging, versionOf, onlyMain)).toEqual({ env: { ...staging, SALON_SECRETARY_FALLBACK_MODEL: undefined }, reserveDropped: true });
    const both = parseModelCertificates({ schema: "secretary-model-certificates-v1", note: "", certificates: [certificate(DEEPSEEK, versions[DEEPSEEK]), certificate("gpt-6-luna", versions["gpt-6-luna"])] });
    expect(certifiedModelEnv(staging, versionOf, both)).toEqual({ env: staging, reserveDropped: false });
    expect(() => certifiedModelEnv({ ...staging, SALON_SECRETARY_MODEL: "gpt-6-luna" }, versionOf, onlyMain)).toThrow("SECRETARY_MODEL_NOT_CERTIFIED");
    expect(certifiedModelEnv({ ...ENV, APP_ENV: "test" }, versionOf, onlyMain)).toEqual({ env: { ...ENV, APP_ENV: "test" }, reserveDropped: false });
  });
  it("the model that answered is read from the provider's returned id (the id itself or a dated variant)", () => {
    expect(registeredModelOfReturnedId("gpt-6-luna")?.id).toBe("gpt-6-luna");
    expect(registeredModelOfReturnedId("gpt-6-luna-2026-09-01")?.id).toBe("gpt-6-luna");
    expect(registeredModelOfReturnedId(`${DEEPSEEK}-20260913`)?.id).toBe(DEEPSEEK);
    for (const other of ["gpt-6-luna-pro", "openai/gpt-6-luna", null, ""]) expect(registeredModelOfReturnedId(other), String(other)).toBeUndefined();
  });
});
