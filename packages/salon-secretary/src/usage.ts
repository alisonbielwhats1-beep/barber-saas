import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { servicesAttempt, isSourceRepairOf, type ServicesAttempt } from './source-literal-repair';
import { agentAttempt, type AgentAttempt } from './agent-loop';
import { observeSecretaryResponseUsage, type SecretaryResponseUsage } from './openai-cost-guard';
// Read-only provenance for wrappers constructed here. No arbitrary registration API.
const instrumentedSources=new WeakMap<Model,Model>();
export function uninstrumentedServicesModel(model:Model):Model {
  let current=model;while(instrumentedSources.has(current))current=instrumentedSources.get(current)!;return current;
}

export type ModelCallUsage = ServicesAttempt & {
  timestamp: string;
  status: "STARTED" | "SUCCEEDED" | "FAILED" | "TIMEOUT" | "ABORTED";
  usage_status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNKNOWN";
  model_id_requested: string;
  model_id_returned: string | null;
  request_id: string | null;
  response_id: string | null;
  requests: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  /** Owner 06/10/2026: the call's real cost as the provider reports it (OpenRouter `usage.cost`, USD), in micro-USD; absent when the
   * provider does not report it (OpenAI Responses). The prepaid credit charges this x10 when present. */
  cost_micro_usd?: number;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
/** OpenRouter model ids carry the vendor ("deepseek/…"): one slash between two plain segments. */
const identifier = (value: unknown): string | null =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$|^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,60}\/[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,138}$/.test(value) && !value.startsWith("sk-") ? value : null;

/** Allowlist only. Never use SDK-normalized Usage: absent counters may already have become zero.
 * Responses usage (OpenAI) or Chat Completions usage (OpenRouter: prompt/completion tokens and their details). */
export function modelCallUsage(modelId: string, status: ModelCallUsage["status"], response?: ModelResponse): ModelCallUsage {
  const provider = object(response?.providerData);
  const raw = object(response?.rawUsage ?? provider.usage);
  const chat = raw.input_tokens === undefined && raw.prompt_tokens !== undefined;
  const input = object(chat ? raw.prompt_tokens_details : raw.input_tokens_details);
  const output = object(chat ? raw.completion_tokens_details : raw.output_tokens_details);
  const tokens = {
    input_tokens: count(chat ? raw.prompt_tokens : raw.input_tokens), cached_input_tokens: count(input.cached_tokens),
    cache_write_tokens: count(input.cache_write_tokens), output_tokens: count(chat ? raw.completion_tokens : raw.output_tokens),
    reasoning_tokens: count(output.reasoning_tokens), total_tokens: count(raw.total_tokens),
  };
  const complete = [tokens.input_tokens, tokens.output_tokens, tokens.total_tokens].every(v => v !== null);
  const partial = Object.values(tokens).some(v => v !== null);
  return {
    attempt: 1, purpose: 'INTERPRETATION',
    timestamp: new Date().toISOString(), status,
    usage_status: complete ? "AVAILABLE" : partial ? "PARTIAL" : status === "SUCCEEDED" ? "UNAVAILABLE" : "UNKNOWN",
    model_id_requested: identifier(modelId) ?? "unavailable",
    model_id_returned: identifier(provider.model), request_id: identifier(response?.requestId),
    response_id: identifier(response?.responseId), requests: status === "STARTED" ? null : 1,
    ...tokens,
    ...(typeof raw.cost === "number" && Number.isFinite(raw.cost) && raw.cost >= 0 && raw.cost < 10 ? { cost_micro_usd: Math.ceil(raw.cost * 1e6) } : {}),
  };
}

/** Per-run wrapper. Records before dispatch and before business tools, also on provider failure. */
export function instrumentServicesModel(model: Model, modelId: string, emit: (event: ModelCallUsage) => Promise<void>): Model {
  let original: ModelRequest | undefined;
  let calls = 0;
  let firstCompleted = false;
  const measured:Model={
    async getResponse(request) {
      if (calls && (calls !== 1 || !firstCompleted || !original || !isSourceRepairOf(request, original))) throw new Error("MODEL_CALL_LIMIT");
      if (!calls) { if (servicesAttempt(request).attempt !== 1) throw Error('MODEL_CALL_LIMIT'); original = request; }
      calls++;
      const attempt = servicesAttempt(request);
      // Failed STARTED persistence prevents dispatch; failed terminal persistence prevents business writes.
      await emit({ ...modelCallUsage(modelId, "STARTED"), ...attempt });
      let response: ModelResponse;
      try {
        request.signal?.throwIfAborted();
        response = await model.getResponse(request);
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        const reason = request.signal?.reason;
        const status = name.includes("Timeout") || (reason instanceof Error && reason.name === "TimeoutError")
          ? "TIMEOUT" : request.signal?.aborted || name === "AbortError" ? "ABORTED" : "FAILED";
        await emit({ ...modelCallUsage(modelId, status), ...attempt, request_id: identifier(object(error).request_id) });
        // No provider message/body/headers enters logs or the caller error.
        throw new Error("MODEL_REQUEST_FAILED");
      }
      const providerStatus = object(response.providerData).status;
      await emit({ ...modelCallUsage(modelId, providerStatus && providerStatus !== "completed" ? "FAILED" : "SUCCEEDED", response), ...attempt });
      if (calls === 1) firstCompleted = !providerStatus || providerStatus === 'completed';
      return response;
    },
    async *getStreamedResponse(): AsyncGenerator<never> { throw new Error("STREAM_NOT_SUPPORTED"); },
  };
  instrumentedSources.set(measured,model);return Object.freeze(measured);
}

/** C5 agent (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §6.2, §6.4): one usage event pair per agent call,
 * attempts 1..3 of ONE message, with the purpose of the request (AGENT_LOOKUP: a round that may consult; AGENT_PLAN: forced plan). */
export type AgentModelCallUsage = Omit<ModelCallUsage, 'attempt' | 'purpose'> & AgentAttempt;
/** Per-message wrapper of the agent loop, the sibling of instrumentServicesModel (which does not change). The attempt is the loop's
 * identity of the request (agent-loop.ts WeakMap, like repairRequests): a request the loop did not build, attempts out of order, a
 * call after a failed one or after the forced plan are MODEL_CALL_LIMIT before any dispatch or event. STARTED is persisted before
 * dispatch; a response that ends incomplete/failed (the SDK throws) is recorded FAILED WITH its token counts, read by the {agent}
 * guarded fetch (numbers only), since it was billed. No provider message, body or header reaches the events or the caller error. */
export function instrumentAgentModel(model: Model, modelId: string, emit: (event: AgentModelCallUsage) => Promise<void>): Model {
  let last = 0, open = true;
  const measured:Model={
    async getResponse(request) {
      const attempt = agentAttempt(request);
      if (!attempt || !open || attempt.attempt !== last + 1) throw new Error("MODEL_CALL_LIMIT");
      last = attempt.attempt; open = false;
      await emit({ ...modelCallUsage(modelId, "STARTED"), ...attempt });
      let response: ModelResponse;
      const seen: { usage?: SecretaryResponseUsage } = {};
      try {
        request.signal?.throwIfAborted();
        response = await observeSecretaryResponseUsage(usage => { seen.usage = usage; }, () => model.getResponse(request));
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        const reason = request.signal?.reason;
        const status = name.includes("Timeout") || (reason instanceof Error && reason.name === "TimeoutError")
          ? "TIMEOUT" : request.signal?.aborted || name === "AbortError" ? "ABORTED" : "FAILED";
        const billed: ModelResponse | undefined = seen.usage ? { usage: new Usage(), output: [], rawUsage: { ...seen.usage } } : undefined;
        await emit({ ...modelCallUsage(modelId, status, billed), ...attempt, request_id: identifier(object(error).request_id) });
        throw new Error(name === "ModelBehaviorError" ? "MODEL_RESPONSE_INCOMPLETE" : "MODEL_REQUEST_FAILED");
      }
      const providerStatus = object(response.providerData).status;
      const succeeded = !providerStatus || providerStatus === 'completed';
      await emit({ ...modelCallUsage(modelId, succeeded ? "SUCCEEDED" : "FAILED", response), ...attempt });
      open = succeeded && attempt.purpose === 'AGENT_LOOKUP' && attempt.attempt < 3;
      return response;
    },
    async *getStreamedResponse(): AsyncGenerator<never> { throw new Error("STREAM_NOT_SUPPORTED"); },
  };
  instrumentedSources.set(measured,model);return Object.freeze(measured);
}

/** Passive timing wrapper: always returns the source response, never an observer result. */
export function measureServicesModel(model:Model,modelId:string,emit:(event:ModelCallUsage,elapsedMs:number)=>void):Model {
  const measured:Model={
    async getResponse(request){
      const start=performance.now();let event:ModelCallUsage;
      try{const response=await model.getResponse(request);event=modelCallUsage(modelId,'SUCCEEDED',response);return response;}
      catch(error){event=modelCallUsage(modelId,'FAILED');throw error;}
      finally{
        // Timing is passive, unlike the awaited durable admission/usage writer above.
        // Do not await observers or let synchronous/asynchronous failure replace the source result.
        try{void Promise.resolve(emit({ ...event!, ...servicesAttempt(request) },performance.now()-start)).catch(()=>{});}catch{/* Observation only. */}
      }
    },
    async *getStreamedResponse():AsyncGenerator<never>{throw Error('STREAM_NOT_SUPPORTED');},
  };
  instrumentedSources.set(measured,model);return Object.freeze(measured);
}

/** Future pricing must use output_tokens as-is. reasoning_tokens is a subset, never an addition. */
export function billableTokenBasis(usage: ModelCallUsage) {
  return {
    input_tokens: usage.input_tokens, cached_input_tokens: usage.cached_input_tokens,
    cache_write_tokens: usage.cache_write_tokens, output_tokens: usage.output_tokens,
  };
}
