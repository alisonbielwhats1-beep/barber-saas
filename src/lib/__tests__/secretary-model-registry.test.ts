import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SECRETARY_MODEL, OPENROUTER_CHAT_URL, SECRETARY_MODELS, assertSecretaryModelId, assertSecretaryResponsesPayload, longestSecretaryModelId,
  secretaryChatOptions, secretaryContractVersion, secretaryModelContractPart, secretaryModelProfile,
} from "@everflair/salon-secretary";
import { FREE_USE_DEEPSEEK_PRICING, FREE_USE_PRICING } from "../../../packages/salon-secretary/evaluation/free-use-budget";
import { OPENROUTER_RESERVATION_PRICING, PROGRAM_SPEND_WALLETS } from "../../../packages/salon-secretary/evaluation/program-spend";
import { CONTRACT_MODEL } from "../../../packages/salon-secretary/evaluation/contract-version-profiles";

/** Model registry (owner decision 04/10/2026): one place knows each model; everything else reads it. */
afterEach(() => vi.unstubAllEnvs());
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";

describe("model registry", () => {
  it("lists each admitted model once, with its wire, wallet, credentials and endpoint; the default is DeepSeek through OpenRouter", () => {
    expect(new Set(SECRETARY_MODELS.map(profile => profile.id)).size).toBe(SECRETARY_MODELS.length);
    expect(SECRETARY_MODELS.map(profile => profile.id)).toEqual(["gpt-6-luna", "gpt-5.6-luna", DEEPSEEK]);
    expect(DEFAULT_SECRETARY_MODEL).toBe(DEEPSEEK); expect(CONTRACT_MODEL).toBe(DEEPSEEK);
    for (const profile of SECRETARY_MODELS) {
      expect(profile.endpoint.startsWith(`${profile.baseURL}/`), profile.id).toBe(true);
      expect(profile.wire === "chat-completions", profile.id).toBe(profile.chat !== null);
      expect(Object.isFrozen(profile), profile.id).toBe(true);
    }
    expect(secretaryModelProfile("gpt-6-luna")).toMatchObject({ wire: "openai-responses", wallet: "openai", agentCapable: true, apiKeyEnv: "SALON_SECRETARY_OPENAI_API_KEY",
      projectEnv: "SALON_SECRETARY_OPENAI_PROJECT", endpoint: "https://api.openai.com/v1/responses" });
    expect(secretaryModelProfile(DEEPSEEK)).toMatchObject({ wire: "chat-completions", wallet: "openrouter", agentCapable: false, apiKeyEnv: "SALON_SECRETARY_OPENROUTER_API_KEY",
      projectEnv: null, endpoint: OPENROUTER_CHAT_URL, chat: { strictTools: false, temperature: 0, reasoning: "off", provider: "together", completeOmittedNulls: true } });
    expect(longestSecretaryModelId()).toBe(DEEPSEEK);
    for (const unknown of ["gpt-6-sol", "deepseek/deepseek-v4-flash", "", "constructor"]) expect(() => assertSecretaryModelId(unknown)).toThrow("SECRETARY_OPENAI_COST_GUARD");
  });

  it("a chat model's request options come from its profile, and the measurement knobs change them only on purpose", () => {
    const profile = secretaryModelProfile(DEEPSEEK);
    expect(secretaryChatOptions(profile, {})).toEqual({ reasoning: "off", provider: "together" });
    expect(secretaryChatOptions(profile, { SALON_SECRETARY_OPENROUTER_PROVIDER: "any" })).toEqual({ reasoning: "off", provider: undefined });
    expect(secretaryChatOptions(profile, { SALON_SECRETARY_OPENROUTER_PROVIDER: "deepinfra", SALON_SECRETARY_OPENROUTER_REASONING: "low" })).toEqual({ reasoning: "low", provider: "deepinfra" });
    expect(secretaryChatOptions(secretaryModelProfile("gpt-6-luna"), {})).toBeNull();
  });

  it("the request profile of a chat model is a contract part: a knob changes the version; an OpenAI model's version ignores them", () => {
    expect(secretaryModelContractPart(DEEPSEEK, {})).toEqual({ wire: "chat-completions", endpoint: OPENROUTER_CHAT_URL, strictTools: false, temperature: 0, reasoning: "off",
      provider: "together", completeOmittedNulls: true });
    expect(secretaryModelContractPart("gpt-6-luna", {})).toBeUndefined();
    const version = (modelId: string) => secretaryContractVersion({ modelId, presentation: "a".repeat(64) });
    const deepseek = version(DEEPSEEK), luna = version("gpt-6-luna");
    vi.stubEnv("SALON_SECRETARY_OPENROUTER_PROVIDER", "any");
    expect(version(DEEPSEEK)).not.toBe(deepseek); expect(version("gpt-6-luna")).toBe(luna);
    vi.stubEnv("SALON_SECRETARY_OPENROUTER_PROVIDER", "together");
    expect(version(DEEPSEEK)).toBe(deepseek);
    vi.stubEnv("SALON_SECRETARY_OPENROUTER_REASONING", "low");
    expect(version(DEEPSEEK)).not.toBe(deepseek);
  });

  it("prices come from the registry; the sealed evaluation prices agree with it and the OpenRouter reservation bounds every OpenRouter model", () => {
    const luna = secretaryModelProfile("gpt-6-luna").pricing!, deepseek = secretaryModelProfile(DEEPSEEK).pricing!;
    expect([FREE_USE_PRICING.model, FREE_USE_PRICING.inputUsdPerMillion, FREE_USE_PRICING.cacheWriteUsdPerMillion, FREE_USE_PRICING.outputUsdPerMillion])
      .toEqual(["gpt-6-luna", luna.inputUsdPerMillion, luna.cacheWriteUsdPerMillion, luna.outputUsdPerMillion]);
    expect([FREE_USE_DEEPSEEK_PRICING.model, FREE_USE_DEEPSEEK_PRICING.inputUsdPerMillion, FREE_USE_DEEPSEEK_PRICING.outputUsdPerMillion])
      .toEqual([DEEPSEEK, deepseek.inputUsdPerMillion, deepseek.outputUsdPerMillion]);
    for (const profile of SECRETARY_MODELS.filter(candidate => candidate.wallet === "openrouter")) {
      expect(profile.pricing!.inputUsdPerMillion, profile.id).toBeLessThanOrEqual(OPENROUTER_RESERVATION_PRICING.inputUsdPerMillion);
      expect(profile.pricing!.outputUsdPerMillion, profile.id).toBeLessThanOrEqual(OPENROUTER_RESERVATION_PRICING.outputUsdPerMillion);
    }
    expect(Object.keys(PROGRAM_SPEND_WALLETS).sort()).toEqual([...new Set(SECRETARY_MODELS.map(profile => profile.wallet))].sort());
  });

  it("the cost guard checks each wire against the model's profile", () => {
    const responses = { model: DEEPSEEK, instructions: "x", input: [], tools: [{ type: "function", name: "upsert_action_draft", parameters: { type: "object" }, strict: true }],
      tool_choice: { type: "function", name: "upsert_action_draft" }, parallel_tool_calls: false, max_output_tokens: 1200, store: false, stream: false, include: [] };
    expect(() => assertSecretaryResponsesPayload(responses, DEEPSEEK)).toThrow("SECRETARY_OPENAI_COST_GUARD:RESPONSES_MODEL");
    expect(() => assertSecretaryResponsesPayload({ ...responses, model: "gpt-6-luna" }, "gpt-6-luna")).not.toThrow();
  });
});
