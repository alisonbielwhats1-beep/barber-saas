/** The one place that knows the Secretary's models (owner decision 04/10/2026: changing the model must be configuration plus
 * proof, never a rewrite). Each profile says how its provider is reached (wire, endpoint, credentials, spend wallet), what it
 * can serve (the C5 agent and the reschedule pilot need OpenAI-only Responses features), the request profile the cost guard
 * applies (chat models: strict tools, temperature, reasoning, pinned provider, completion of omitted nulls) and its prices.
 * Everything else reads it: the cost guard (allowlist, endpoint, wire checks), the model factory, the contract version (the
 * request profile is a contract part), telemetry costs, the request budget and the evaluation harness. Adding a model: a
 * profile here, its sealed evaluation pricing, then the Golden pass^k certificate (docs/SECRETARY_MODEL_ARCHITECTURE.md). */

/** `openai-responses`: OpenAI's Responses API (store:false). `chat-completions`: an OpenAI-compatible Chat Completions API. */
export type SecretaryWire = "openai-responses" | "chat-completions";
/** Who is billed: each wallet has its own evaluation spend ledger and caps. */
export type SecretaryWallet = "openai" | "openrouter";
export type SecretaryReasoning = "off" | "low" | "medium" | "high";
/** US$ per million tokens used for telemetry estimates: never below what the provider can charge on the admitted routes.
 * `cacheWriteUsdPerMillion` null: the provider has no cache-write charge. */
export type SecretaryModelPricing = Readonly<{ inputUsdPerMillion: number; cachedUsdPerMillion: number; cacheWriteUsdPerMillion: number | null;
  outputUsdPerMillion: number; basis: string }>;
/** What the cost guard applies to a chat model's request and answer (measured on the Golden, 04/10/2026). */
export type SecretaryChatProfile = Readonly<{
  /** false: providers that decode a strict schema token by token deformed the answers (Golden 3/30 strict, 30/30 not). */
  strictTools: boolean;
  temperature: number;
  reasoning: SecretaryReasoning;
  /** One provider pinned without fallback (OpenRouter `provider.order`), or null for the default route. */
  provider: string | null;
  /** Omitted keys the schema admits as null (or as an empty list) are completed before the parser reads the answer. */
  completeOmittedNulls: boolean;
}>;
export type SecretaryModelProfile = Readonly<{
  id: string;
  label: string;
  wire: SecretaryWire;
  wallet: SecretaryWallet;
  /** The client's base URL and the one endpoint the cost guard admits. */
  baseURL: string;
  endpoint: string;
  apiKeyEnv: string;
  projectEnv: string | null;
  /** The C5 agent and the reschedule pilot (encrypted reasoning, prompt-cache breakpoints, Responses formats). */
  agentCapable: boolean;
  chat: SecretaryChatProfile | null;
  /** null: unknown, telemetry records no cost estimate. */
  pricing: SecretaryModelPricing | null;
}>;

const OPENAI_BASE = "https://api.openai.com/v1", OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const SECRETARY_MODELS: readonly SecretaryModelProfile[] = Object.freeze([
  Object.freeze({ id: "gpt-6-luna", label: "GPT-6 Luna (OpenAI)", wire: "openai-responses", wallet: "openai", baseURL: OPENAI_BASE,
    endpoint: `${OPENAI_BASE}/responses`, apiKeyEnv: "SALON_SECRETARY_OPENAI_API_KEY", projectEnv: "SALON_SECRETARY_OPENAI_PROJECT", agentCapable: true, chat: null,
    pricing: Object.freeze({ inputUsdPerMillion: 0.10, cachedUsdPerMillion: 0.01, cacheWriteUsdPerMillion: 0.125, outputUsdPerMillion: 0.50,
      basis: "OpenAI standard short-context rates audited in Gate 3.1B (22/09/2026)" }) }),
  Object.freeze({ id: "gpt-5.6-luna", label: "GPT-5.6 Luna (OpenAI, rollback)", wire: "openai-responses", wallet: "openai", baseURL: OPENAI_BASE,
    endpoint: `${OPENAI_BASE}/responses`, apiKeyEnv: "SALON_SECRETARY_OPENAI_API_KEY", projectEnv: "SALON_SECRETARY_OPENAI_PROJECT", agentCapable: true, chat: null,
    pricing: null }),
  Object.freeze({ id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash (OpenRouter, Together)", wire: "chat-completions", wallet: "openrouter",
    baseURL: OPENROUTER_BASE, endpoint: `${OPENROUTER_BASE}/chat/completions`, apiKeyEnv: "SALON_SECRETARY_OPENROUTER_API_KEY", projectEnv: null, agentCapable: false,
    chat: Object.freeze({ strictTools: false, temperature: 0, reasoning: "off", provider: "together", completeOmittedNulls: true }),
    // Highest rate of each item among the providers of OpenRouter's default route (catalog of 04/10/2026), so the estimate never
    // falls below the real cost even when SALON_SECRETARY_OPENROUTER_PROVIDER=any; no cache-write charge.
    pricing: Object.freeze({ inputUsdPerMillion: 0.45, cachedUsdPerMillion: 0.048, cacheWriteUsdPerMillion: null, outputUsdPerMillion: 2.40,
      basis: "highest rates of OpenRouter's default route for the model (catalog of 04/10/2026)" }) }),
]);
/** The Secretary's model (owner decision 04/10/2026). */
export const DEFAULT_SECRETARY_MODEL = "deepseek/deepseek-v4.1-flash";

function unknownModel(): never { throw new Error("SECRETARY_OPENAI_COST_GUARD:INVALID"); }
/** The profile of an admitted model; any other id is refused (the cost guard's historical code). */
export function secretaryModelProfile(modelId: string): SecretaryModelProfile {
  return SECRETARY_MODELS.find(profile => profile.id === modelId) ?? unknownModel();
}
export const secretaryModelIds = () => SECRETARY_MODELS.map(profile => profile.id);
/** The longest admitted id: bounds a request body when the model in use cannot tell its own. */
export const longestSecretaryModelId = () => secretaryModelIds().reduce((longest, id) => id.length > longest.length ? id : longest, "");

/** A chat model's request options for this process: the profile, unless a measurement knob says otherwise
 * (SALON_SECRETARY_OPENROUTER_REASONING; SALON_SECRETARY_OPENROUTER_PROVIDER, "any" = the default route). Read once by the model
 * factory and by the contract version, never by the cost guard. */
export function secretaryChatOptions(profile: SecretaryModelProfile, env: Record<string, string | undefined> = process.env) {
  if (!profile.chat) return null;
  const provider = env.SALON_SECRETARY_OPENROUTER_PROVIDER || undefined, reasoning = env.SALON_SECRETARY_OPENROUTER_REASONING || undefined;
  return { reasoning: reasoning ?? profile.chat.reasoning, provider: provider === "any" ? undefined : provider ?? profile.chat.provider ?? undefined };
}
/** The model's request profile as the contract version names it: chat models only (every OpenAI version recorded before is kept). */
export function secretaryModelContractPart(modelId: string, env: Record<string, string | undefined> = process.env) {
  const profile = SECRETARY_MODELS.find(candidate => candidate.id === modelId);
  if (!profile?.chat) return undefined;
  const options = secretaryChatOptions(profile, env)!;
  return { wire: profile.wire, endpoint: profile.endpoint, strictTools: profile.chat.strictTools, temperature: profile.chat.temperature,
    reasoning: options.reasoning, provider: options.provider ?? null, completeOmittedNulls: profile.chat.completeOmittedNulls };
}
