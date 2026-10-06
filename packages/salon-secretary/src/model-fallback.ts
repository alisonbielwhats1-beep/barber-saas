import { APIConnectionError, APIError, APIUserAbortError } from "openai";
import type { Model, ModelRequest } from "@openai/agents";

/** Plan B (owner decision 04/10/2026): when the main model's provider fails, the same request goes to a reserve model of another
 * provider (SALON_SECRETARY_FALLBACK_MODEL, a registry model; outside local development and tests it must be certified for its own
 * contract like the main one, salon-secretary-runtime.ts). Only provider and transport failures trigger it: an HTTP error from the
 * provider (no route, no credit, rate limit, outage...), a connection failure or a timeout. Never one of our own deliberate
 * refusals (cost guard, spend caps), never a call the caller cancelled, never an answer the parser refused (that is a quality
 * failure, and the reserve would hide it). A breaker sends every call straight to the reserve for a cooldown after consecutive
 * failures, so an outage does not cost each message a full timeout; the first call after the cooldown tries the main one again. */
export const MODEL_FALLBACK_BREAKER = Object.freeze({ failures: 2, cooldownMs: 60_000 });
/** The main model's timeout when a reserve exists: well above its measured worst turn (DeepSeek: 8.8 s in 270 Golden turns). */
export const PRIMARY_TIMEOUT_WITH_FALLBACK_MS = 15_000;
export type ModelFallbackEvent = Readonly<{ from: string; to: string; reason: string; breaker: "CLOSED" | "OPEN" }>;
const OUR_REFUSAL = /^(SECRETARY_|LOCAL_DEMO_|PROGRAM_SPEND_)/;

/** The reason a failure may go to the reserve (a code), or null when it must surface as it is. */
export function modelFallbackReason(error: unknown, request?: Pick<ModelRequest, "signal">): string | null {
  if (request?.signal?.aborted || error instanceof APIUserAbortError) return null;
  // Our refusals reach the SDK from inside fetch and come back wrapped as connection errors: look through the cause chain.
  for (let current: unknown = error, depth = 0; current && depth < 8; current = (current as { cause?: unknown }).cause, depth++)
    if (current instanceof Error && OUR_REFUSAL.test(current.message)) return null;
  if (error instanceof APIError && typeof error.status === "number") return `HTTP_${error.status}`;
  if (error instanceof APIConnectionError) return error.constructor.name === "APIConnectionTimeoutError" ? "TIMEOUT" : "CONNECTION";
  return null;
}

type Breaker = { failures: number; openUntil: number };
const breakers = new Map<string, Breaker>();
/** Tests only: a fresh breaker per pair. */
export const resetModelFallbackBreakers = () => breakers.clear();

/** One Model: the main one, or the reserve when the main one's provider failed (or its breaker is open). */
export function withModelFallback(main: { id: string; model: Model }, reserve: { id: string; model: Model },
  options: { now?: () => number; onFallback?: (event: ModelFallbackEvent) => void } = {}): Model {
  const now = options.now ?? Date.now, key = `${main.id}>${reserve.id}`;
  const fallback = (reason: string, breaker: Breaker, request: ModelRequest) => {
    options.onFallback?.(Object.freeze({ from: main.id, to: reserve.id, reason, breaker: breaker.openUntil > now() ? "OPEN" : "CLOSED" }));
    return reserve.model.getResponse(request);
  };
  return {
    async getResponse(request) {
      const breaker = breakers.get(key) ?? { failures: 0, openUntil: 0 };
      if (breaker.openUntil > now()) return fallback("BREAKER_OPEN", breaker, request);
      try {
        const response = await main.model.getResponse(request);
        breakers.set(key, { failures: 0, openUntil: 0 });
        return response;
      } catch (error) {
        const reason = modelFallbackReason(error, request);
        if (!reason) throw error;
        const failures = breaker.failures + 1, next = { failures, openUntil: failures >= MODEL_FALLBACK_BREAKER.failures ? now() + MODEL_FALLBACK_BREAKER.cooldownMs : 0 };
        breakers.set(key, next);
        return fallback(reason, next, request);
      }
    },
    async *getStreamedResponse(): AsyncGenerator<never> { throw new Error("STREAM_NOT_SUPPORTED"); },
  };
}
