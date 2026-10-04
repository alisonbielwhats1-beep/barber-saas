import { AsyncLocalStorage } from "node:async_hooks";
import type { Model } from "@openai/agents";
import { uninstrumentedServicesModel } from "./usage";
import type { SecretaryMessageContent } from "./prompt-cache";
import { longestSecretaryModelId } from "./model-registry";

/** Budget-aware request assembly. The hard cap is never raised: request body bytes + the output framing <= 64000 (the
 * same bound as the cost guard's input cap and the wire budget tests). A request that would not fit is degraded in a
 * fixed order, each step only when it applies and only while still over the cap:
 *   1. EXAMPLES_DROPPED   the few-shot examples block is left out (the configured mode asked for one);
 *   2. STRUCTURED_CONTEXT the prose clarifications become the B7 structured form (code + short sentence), and/or
 *      JIT_APPENDIX       the static decision prompt becomes the JIT prompt with its state-bound appendix;
 *   3. SUSPENDED_TRIMMED  each suspended plan keeps only what routing needs (plan_ref; item_key, operation, status).
 * Still over: the request is refused before transport (SECRETARY_REQUEST_TOO_LARGE, a clear pt-BR message). A request
 * under the cap is built exactly as before (no step runs). Telemetry carries codes and byte counts only. */
export const SECRETARY_REQUEST_CAP = 64_000, SECRETARY_OUTPUT_FRAMING = 8192;
export const REQUEST_TOO_LARGE = "SECRETARY_REQUEST_TOO_LARGE";
export const requestTooLargeMessage = "Esse pedido ficou grande demais para eu processar de uma vez; pode dividir em partes?";
export const REQUEST_DEGRADATIONS = ["EXAMPLES_DROPPED", "STRUCTURED_CONTEXT", "JIT_APPENDIX", "SUSPENDED_TRIMMED"] as const;
export type RequestDegradation = (typeof REQUEST_DEGRADATIONS)[number];

/** The longest admitted model id (model-registry.ts) bounds the body when the id cannot be read. */
const LONGEST_MODEL_ID = longestSecretaryModelId();
/** Ids of provider models that do not expose one (the SDK's Chat Completions model keeps it private): set by createPaidModel. */
const rememberedModelIds = new WeakMap<Model, string>();
export function rememberRequestModelId(model: Model, modelId: string): Model { rememberedModelIds.set(model, modelId); return model; }
/** The id the provider model sends (the SDK's Responses model keeps it in `_model`); unknown = the longest allowed id. */
export function requestModelId(model: Model): string {
  const inner = uninstrumentedServicesModel(model) as Model & { _model?: unknown };
  return rememberedModelIds.get(inner) ?? (typeof inner._model === "string" ? inner._model : LONGEST_MODEL_ID);
}
/** EXACT bytes of the Responses body the SDK sends for one Secretary request (same keys and values; order is irrelevant
 * to the size): model, instructions, input [{role, content}], include [], the one strict function tool, max_output_tokens,
 * the forced tool choice and the three transport switches. Pinned against the real body by the request budget test.
 * C5: a content may be the input_text parts of SALON_SECRETARY_PROMPT_CACHE; the SDK sends them as given, so they serialize alike. */
export function secretaryRequestBodyBytes(input: { modelId: string; instructions: string; messages: readonly { role: string; content: SecretaryMessageContent }[]; parameters: unknown; toolName: string;
  toolDescription: string; maxTokens: number }) {
  return Buffer.byteLength(JSON.stringify({ model: input.modelId, instructions: input.instructions, input: input.messages.map(message => ({ role: message.role, content: message.content })), include: [],
    tools: [{ type: "function", name: input.toolName, description: input.toolDescription, parameters: input.parameters, strict: true }], max_output_tokens: input.maxTokens,
    tool_choice: { type: "function", name: input.toolName }, stream: false, store: false, parallel_tool_calls: false }), "utf8");
}
export const fitsRequestCap = (bytes: number) => bytes + SECRETARY_OUTPUT_FRAMING <= SECRETARY_REQUEST_CAP;

export type RequestLevel<T> = { steps: readonly RequestDegradation[]; build: () => T };
export type FittedRequest<T> = { request: T; steps: RequestDegradation[]; bytes: number; initialBytes: number } | { request?: undefined; steps: RequestDegradation[]; bytes: number; initialBytes: number };
/** The configured request when it fits (nothing else is computed); otherwise the first degradation level that fits, in
 * the fixed order (each level cumulative over the previous one; a level with no applicable step is skipped).
 * `steps` = every step applied up to the returned level (all of them when nothing fits). */
export function fitRequest<T>(configured: T, degradations: () => readonly RequestLevel<T>[], bytesOf: (request: T) => number): FittedRequest<T> {
  const initialBytes = bytesOf(configured);
  if (fitsRequestCap(initialBytes)) return { request: configured, steps: [], bytes: initialBytes, initialBytes };
  const steps: RequestDegradation[] = [];let bytes = initialBytes;
  for (const level of degradations()) {
    if (!level.steps.length) continue;
    steps.push(...level.steps.filter(step => !steps.includes(step)));
    const request = level.build();bytes = bytesOf(request);
    if (fitsRequestCap(bytes)) return { request, steps, bytes, initialBytes };
  }
  return { steps, bytes, initialBytes };
}

/** Suspended plans reduced to what routing and RESUME validation read (conversation-routing canonicalActions). */
export function trimSuspendedPlans<T extends { suspended_plans?: { plan_ref: string; actions: unknown[] }[] }>(context: T): T {
  if (!context.suspended_plans?.length) return context;
  return { ...context, suspended_plans: context.suspended_plans.map(plan => ({ plan_ref: plan.plan_ref, actions: plan.actions.map(action => {
    const { item_key, operation, status } = (action ?? {}) as { item_key?: unknown; operation?: unknown; status?: unknown };
    return { item_key, operation, status };
  }) })) };
}

/** Codes and byte counts of one request that did not fit as configured (never text). */
export type RequestBudgetTelemetry = { steps: RequestDegradation[]; fit: boolean; initial_bytes: number; final_bytes: number };
const observer = new AsyncLocalStorage<(entry: RequestBudgetTelemetry) => void>();
export function withRequestBudgetObserver<T>(sink: (entry: RequestBudgetTelemetry) => void, task: () => T): T { return observer.run(sink, task); }
export function reportRequestBudget(entry: RequestBudgetTelemetry) {
  try { observer.getStore()?.({ steps: [...entry.steps], fit: entry.fit, initial_bytes: entry.initial_bytes, final_bytes: entry.final_bytes }); } catch { /* Observation only. */ }
}
