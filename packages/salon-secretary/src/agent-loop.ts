import OpenAI from "openai";
import { NoopTrace, OpenAIResponsesModel, withTrace, type AgentInputItem, type AgentOutputItem, type FunctionCallItem, type FunctionCallResultItem, type Model,
  type ModelRequest, type ModelResponse } from "@openai/agents";
import { AGENT_LIMITS, agentCallSignal, agentDependenciesSatisfied, agentEnabled, agentMessage, agentRoundEfforts, type AgentDirectory, type AgentEffort,
  type AgentMessageContext, type AgentPath, type AgentRoundEfforts } from "./agent-context";
import { AGENT_PLAN_TOOL, AgentPlanError, decodeAgentPlanArguments, type AgentPlan } from "./agent-plan";
import { agentInstructions, agentSystemContent } from "./agent-prompt";
import { agentLookupError, agentTools, decodeAgentLookupCall, isAgentLookupName, type AgentLookupCall } from "./agent-tools";
import { AGENT_REASONING_INCLUDE, assertSecretaryAgentModelRequest, assertSecretaryModelId } from "./openai-cost-guard";

/** C5 agent (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §3): the explicit loop of ONE owner
 * message, without the SDK Runner (it resets tool_choice after a tool call, needs maxTurns and would run tools in this package). It
 * calls Model.getResponse itself, so the app's usage and timing wrappers stay as they are.
 *   round 1/2: tool_choice "required", parallel calls, 8192 output tokens: exactly one propor_plano alone, or 1..4 lookups, which the
 *              app's executor answers (one tenant transaction per round, reads in sequence) and which go back, with everything the
 *              model emitted in that round in its own order (reasoning with encrypted_content, commentary, calls), as function outputs;
 *   round 3:   always forced into propor_plano (no parallel calls). Bytes or time too short for one more lookup force it earlier.
 * store:false and no previous_response_id: the whole context is re-sent (§3.3). The counter of the message (3 calls, shared with
 * the C4 fallback) is consulted before every call; the plan is decoded strictly and never goes back to the model. Anything else is
 * a failure of the round, and the message goes to the C4 while the budget of calls and time allows it (§3.8), or gets the safe
 * reply. Telemetry: codes and numbers only, never text. Nothing here runs with the flag off. */
export const AGENT_SAFE_REPLY = "Não consegui entender com segurança; nada foi alterado.";
/** §3.7 heuristics, calibrated by the S1 probe (size of the encrypted reasoning items, tokens per byte):
 *  planMinMs       a lookup round needs its call (at its own cap, agentCallLimitMs), its database round (≤ 3 s) and this much left for the plan, or the plan is forced now;
 *  lookupRoomBytes room a lookup round needs after the request (its calls, reasoning and outputs), or the plan is forced now;
 *  escapeFactor    worst growth of a lookup output once JSON-escaped into the body (every byte a quote), deciding compaction before reading. */
export const AGENT_LOOP_LIMITS = Object.freeze({ planMinMs: 10_000, lookupRoomBytes: 16 * 1024, escapeFactor: 2 });
/** S2 fix B1 (§3.2 vs §3.5): the cap of one call. A forced round (only the plan) has min(25 s, remaining − 2 s), as before. The 1st round
 * may also bring the plan with the same 8192 output tokens (in S2 it did in 148 of 176 messages, and every AGENT_DEADLINE was a 1st round cut
 * at 15 s), so it has the plan's 25 s as long as running out still leaves the C4 fallback its 15 s plus the 2 s margin (§3.8), and never less
 * than the historical 15 s. Fixer (review of S2 round 1): only the 1st round. The 2nd keeps the §3.5 lookup cap of 15 s, so after a lookup
 * round that answered the forced plan keeps its time; the stop rule counts each round at this cap (planMinMs holds for any cap). The 25 s of
 * the 1st round still departs from §3.5's "rodadas de consulta ≤ 15 s" and waits for the owner's confirmation (owner decision 19); the
 * deadlines it converts are to be reported apart in the next S2's latency. */
export function agentCallLimitMs(forced: boolean, remainingMs: number, round: 1 | 2 | 3): number {
  if (forced) return Math.min(AGENT_LIMITS.planCallMs, remainingMs - AGENT_LIMITS.planCallMarginMs);
  if (round !== 1) return AGENT_LIMITS.lookupCallMs;
  return Math.min(AGENT_LIMITS.planCallMs, Math.max(AGENT_LIMITS.lookupCallMs, remainingMs - AGENT_LIMITS.fallbackMinMs - AGENT_LIMITS.planCallMarginMs));
}
export const AGENT_LOOP_CODES = ["AGENT_DISABLED", "AGENT_FLAGS_INCOMPLETE", "AGENT_EFFORT_INVALID", "AGENT_DIRECTORY_TRUNCATED", "AGENT_UNAVAILABLE", "AGENT_BUDGET",
  "AGENT_GUARD", "AGENT_PROTOCOL", "AGENT_SCHEMA", "AGENT_TRANSPORT", "AGENT_DEADLINE", "MODEL_CALL_LIMIT"] as const;
export type AgentLoopCode = (typeof AGENT_LOOP_CODES)[number];
/** Why a round was AGENT_PROTOCOL (§3.2): a status other than completed, an item of another kind, a final_answer/unphased message,
 * more than one commentary or one above 1 KB, a tool outside the six, a missing/repeated call id, plan and lookups together, more
 * than one plan, no call at all, a lookup in a forced round, more than 4 lookups, arguments outside the schema, or reasoning that
 * cannot be sent back (no encrypted_content). */
export const AGENT_PROTOCOL_DETAILS = ["STATUS", "ITEM", "FINAL_ANSWER", "COMMENTARY", "UNKNOWN_TOOL", "CALL_ID", "MIXED", "PLAN_COUNT", "NO_CALL", "FORCED_LOOKUP",
  "TOO_MANY_LOOKUPS", "ARGUMENTS", "REASONING"] as const;
export type AgentProtocolDetail = (typeof AGENT_PROTOCOL_DETAILS)[number];
/** ROUND: the 3rd call; TIME/BYTES: not enough left for one more lookup round; LIMITED: the last outputs did not fit and were refused. */
export type AgentForceReason = "ROUND" | "TIME" | "BYTES" | "LIMITED";
/** `effort`: the effort of the last call made (the one that delivered the plan), or of round 1 before any call (null: invalid);
 * `efforts`: the effort of each call made, in order (S1 fix A4). */
export type AgentLoopTelemetry = {
  readonly path: AgentPath; readonly calls: number; readonly lookup_rounds: number; readonly lookup_calls: number; readonly commentary: number;
  readonly compacted: boolean; readonly limited: boolean; readonly forced: AgentForceReason | null; readonly request_bytes: readonly number[];
  readonly fallback_code: AgentLoopCode | null; readonly protocol: AgentProtocolDetail | null; readonly schema: readonly string[]; readonly effort: AgentEffort | null;
  readonly efforts: readonly AgentEffort[];
};
/** PLAN: the decoded plan (the validator checks its facts next). C4: the message goes to the C4, with its repair only when `repair`
 * (C4_SKIPPED before any agent call, C4_FALLBACK after). SAFE_REPLY: no call left or under 15 s, nothing was changed (the caller
 * gives it the B5 interpretation-failure semantics). */
export type AgentLoopOutcome =
  | { readonly kind: "PLAN"; readonly plan: AgentPlan; readonly telemetry: AgentLoopTelemetry }
  | { readonly kind: "C4"; readonly repair: boolean; readonly code: AgentLoopCode; readonly telemetry: AgentLoopTelemetry }
  | { readonly kind: "SAFE_REPLY"; readonly reply: string; readonly code: AgentLoopCode; readonly telemetry: AgentLoopTelemetry };

/** Which call of the message a request is (usage.ts instrumentAgentModel reads it). Set only on the requests this loop builds, never
 * a request property: a copied request has no attempt. AGENT_LOOKUP = a round that may consult (tool_choice required; it may still
 * bring the plan); AGENT_PLAN = a round forced into propor_plano. */
export type AgentAttempt = { readonly attempt: 1 | 2 | 3; readonly purpose: "AGENT_LOOKUP" | "AGENT_PLAN" };
const attempts = new WeakMap<ModelRequest, AgentAttempt>();
export const agentAttempt = (request: ModelRequest): AgentAttempt | undefined => attempts.get(request);

/** §3.8: where a message goes without a plan. The C4 only with a call left and at least 15 s, its repair only with two calls left
 * (the C4's bounded model consults the same counter before each of its calls); otherwise the safe reply, without any call. */
export function agentFallbackRoute(context: AgentMessageContext): { readonly kind: "C4"; readonly repair: boolean } | { readonly kind: "SAFE_REPLY" } {
  const left = context.calls.remaining();
  return left < 1 || context.remainingMs() < AGENT_LIMITS.fallbackMinMs ? { kind: "SAFE_REPLY" } : { kind: "C4", repair: left >= 2 };
}

/** What one answered lookup round adds to the next request: the items the model emitted, unchanged and in order, then one output per call. */
export type AgentRoundBlock = { readonly items: readonly AgentOutputItem[]; readonly results: readonly FunctionCallResultItem[] };
/** `efforts` (S1 fix A4): the effort of the 1st, 2nd and 3rd call; absent, `effort` in every round (the historical request). */
export type AgentRoundInput = { readonly directory: AgentDirectory; readonly owner: readonly string[]; readonly effort: AgentEffort; readonly efforts?: AgentRoundEfforts };
/** The effort of the call that follows `answered` lookup rounds (the round is answered + 1). */
export const agentRoundInputEffort = (input: AgentRoundInput, answered: number): AgentEffort => input.efforts?.[answered] ?? input.effort;
/** The request of a round (§3.6 order: the six static tools, the static instructions, then input[0] system = framing with the cache
 * breakpoint + this message's directory, the owner's messages, the answered rounds). Only tool_choice/parallel (and the reasoning
 * effort, when SALON_SECRETARY_AGENT_EFFORT_ROUNDS varies it) change between rounds, so the cached prefix holds. */
export function agentRoundRequest(input: AgentRoundInput, blocks: readonly AgentRoundBlock[], forced: boolean): ModelRequest {
  // The SDK types a system content as string but forwards the parts as they are (prompt-cache.ts; secretary-c5-prompt-cache.test.ts).
  const messages: AgentInputItem[] = [{ role: "system", content: agentSystemContent(input.directory) as unknown as string },
    ...input.owner.map((text): AgentInputItem => ({ role: "user", content: text }))];
  return {
    systemInstructions: agentInstructions(), input: [...messages, ...blocks.flatMap(block => [...block.items, ...block.results])],
    modelSettings: { toolChoice: forced ? AGENT_PLAN_TOOL : "required", parallelToolCalls: !forced, maxTokens: AGENT_LIMITS.maxOutputTokens, store: false,
      reasoning: { effort: agentRoundInputEffort(input, blocks.length) }, providerData: { include: [AGENT_REASONING_INCLUDE] } },
    tools: agentTools(), toolsExplicitlyProvided: true, outputType: "text", handoffs: [], tracing: false,
  };
}

/** The SDK's own request builder on a client that can never reach the network: the body is measured exactly as it will be sent. */
class AgentBodyProbe extends OpenAIResponsesModel {
  body(request: ModelRequest): unknown { return this._buildResponsesCreateRequest(request, false).requestData; }
}
const probes = new Map<string, AgentBodyProbe>();
const offline: typeof fetch = async () => { throw Error("AGENT_BODY_PROBE_OFFLINE"); };
/** EXACT Responses body of an agent request (the §3.7 measure; request-budget.ts is not edited). */
export function agentRequestBody(request: ModelRequest, modelId: string): Record<string, unknown> {
  assertSecretaryModelId(modelId);
  let probe = probes.get(modelId);
  if (!probe) probes.set(modelId, probe = new AgentBodyProbe(new OpenAI({ apiKey: "offline-body-probe", organization: null, project: null,
    baseURL: "https://api.openai.com/v1", maxRetries: 0, fetch: offline }), modelId));
  return probe.body(request) as Record<string, unknown>;
}
export const agentRequestBodyBytes = (request: ModelRequest, modelId: string) => Buffer.byteLength(JSON.stringify(agentRequestBody(request, modelId)), "utf8");
/** Same bound as the C4: request bytes + the output framing ≤ 64000. */
export const agentRequestFits = (bytes: number) => bytes + AGENT_LIMITS.outputFraming <= AGENT_LIMITS.requestCap;

class AgentProtocolError extends Error { constructor(readonly detail: AgentProtocolDetail) { super("AGENT_PROTOCOL"); this.name = "AgentProtocolError"; } }
function protocol(detail: AgentProtocolDetail): never { throw new AgentProtocolError(detail); }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type RoundAnswer = { readonly kind: "PLAN"; readonly arguments: string; readonly commentary: number } | { readonly kind: "LOOKUPS"; readonly calls: readonly AgentLookupCall[]; readonly commentary: number };
/** §3.2: what a round may answer. Nothing of a refused round is executed. */
function readRound(response: ModelResponse, forced: boolean, seen: Set<string>): RoundAnswer {
  if (object(response.providerData).status !== "completed" || !Array.isArray(response.output)) protocol("STATUS");
  const lookups: FunctionCallItem[] = [], plans: FunctionCallItem[] = [];
  let commentary = 0, commentaryBytes = 0, stateless = false;
  for (const item of response.output) {
    if (item.type === "reasoning") {
      const data = object(item.providerData), encrypted = data.encrypted_content ?? data.encryptedContent;
      if (typeof encrypted !== "string" || !encrypted) stateless = true;
      continue;
    }
    if (item.type === "message" && item.role === "assistant") {
      if ((item.phase ?? object(item.providerData).phase) !== "commentary") protocol("FINAL_ANSWER");
      commentary++;
      for (const part of item.content) commentaryBytes += part.type === "output_text" ? Buffer.byteLength(part.text, "utf8") : AGENT_LIMITS.commentaryBytes + 1;
      continue;
    }
    if (item.type !== "function_call") protocol("ITEM");
    if ((item.status !== undefined && item.status !== "completed") || typeof item.callId !== "string" || !item.callId || seen.has(item.callId)) protocol("CALL_ID");
    seen.add(item.callId);
    if (item.name === AGENT_PLAN_TOOL) plans.push(item); else if (isAgentLookupName(item.name)) lookups.push(item); else protocol("UNKNOWN_TOOL");
  }
  if (commentary > 1 || commentaryBytes > AGENT_LIMITS.commentaryBytes) protocol("COMMENTARY");
  if (plans.length && lookups.length) protocol("MIXED");
  if (plans.length > 1) protocol("PLAN_COUNT");
  if (plans.length) return { kind: "PLAN", arguments: plans[0].arguments, commentary };
  if (!lookups.length) protocol("NO_CALL");
  if (forced) protocol("FORCED_LOOKUP");
  if (lookups.length > AGENT_LIMITS.lookupsPerRound) protocol("TOO_MANY_LOOKUPS");
  // store:false: a reasoning item goes back only with its encrypted content (the next round would be refused without it).
  if (stateless) protocol("REASONING");
  const calls = lookups.map(call => {
    if (Buffer.byteLength(call.arguments, "utf8") > AGENT_LIMITS.argumentsBytes) protocol("ARGUMENTS");
    try { return decodeAgentLookupCall({ name: call.name, callId: call.callId, arguments: call.arguments }); } catch { return protocol("ARGUMENTS"); }
  });
  return { kind: "LOOKUPS", calls, commentary };
}
/** A call that did not return: its deadline (or the message's), the counter, a response the SDK refused (incomplete/failed, or the
 * usage wrapper's code for it), or transport. */
function callFailure(error: unknown, signal: AbortSignal): AgentLoopCode {
  if (signal.aborted) return "AGENT_DEADLINE";
  const name = error instanceof Error ? error.name : "", message = error instanceof Error ? error.message : "";
  return message === "MODEL_CALL_LIMIT" ? "MODEL_CALL_LIMIT" : name === "ModelBehaviorError" || message === "MODEL_RESPONSE_INCOMPLETE" ? "AGENT_PROTOCOL" : "AGENT_TRANSPORT";
}
/** The app's executor (src/lib/secretary-agent-lookups.ts) takes the §3.7 compaction as an optional third argument. */
type AgentCompactingExecutor = { round(calls: readonly AgentLookupCall[], context: AgentMessageContext, options?: { readonly compact?: boolean }): Promise<readonly string[]> };
const UNAVAILABLE = agentLookupError("INDISPONIVEL"), OVER_LIMIT = agentLookupError("FORA_DO_LIMITE");
const outcome = <T extends AgentLoopOutcome>(value: T): T => { Object.freeze(value); return value; };

export type AgentLoopOptions = { readonly modelId: string };
/** One owner message on the agent path, inside withAgentMessage (installed by the app only with the flag). `model` is the app's
 * (instrumented) model; `modelId` measures the body. Never throws for the model's behaviour: a wiring error (no message context, a
 * second loop in the same message) does. */
export async function runAgentTurn(model: Model, options: AgentLoopOptions): Promise<AgentLoopOutcome> {
  const context = agentMessage();
  if (!context) throw Error("AGENT_MESSAGE_MISSING");
  if (context.calls.used() !== 0) throw Error("AGENT_LOOP_REENTERED");
  const modelId = options.modelId;
  assertSecretaryModelId(modelId);
  const t = { calls: 0, lookupRounds: 0, lookupCalls: 0, commentary: 0, compacted: false, limited: false, forced: null as AgentForceReason | null, bytes: [] as number[],
    protocol: null as AgentProtocolDetail | null, schema: [] as string[], effort: null as AgentEffort | null, efforts: [] as AgentEffort[] };
  const telemetry = (path: AgentPath, code: AgentLoopCode | null): AgentLoopTelemetry => Object.freeze({ path, calls: t.calls, lookup_rounds: t.lookupRounds,
    lookup_calls: t.lookupCalls, commentary: t.commentary, compacted: t.compacted, limited: t.limited, forced: t.forced, request_bytes: Object.freeze([...t.bytes]),
    fallback_code: code, protocol: t.protocol, schema: Object.freeze([...t.schema]), effort: t.effort, efforts: Object.freeze([...t.efforts]) });
  const fallback = (code: AgentLoopCode): AgentLoopOutcome => {
    const route = agentFallbackRoute(context);
    return outcome(route.kind === "SAFE_REPLY" ? { kind: "SAFE_REPLY", reply: AGENT_SAFE_REPLY, code, telemetry: telemetry("AGENT", code) }
      : { kind: "C4", repair: route.repair, code, telemetry: telemetry(t.calls ? "C4_FALLBACK" : "C4_SKIPPED", code) });
  };
  // §6.5 and §2.1: anything missing sends the message to the C4 before any call.
  if (!agentEnabled()) return fallback("AGENT_DISABLED");
  if (!agentDependenciesSatisfied()) return fallback("AGENT_FLAGS_INCOMPLETE");
  let efforts: AgentRoundEfforts;
  try { efforts = agentRoundEfforts(); } catch { return fallback("AGENT_EFFORT_INVALID"); }
  t.effort = efforts[0];
  const executor = context.executor;
  if (!executor) return fallback("AGENT_UNAVAILABLE");
  let directory: AgentDirectory;
  try {
    const loaded = await executor.directory(context);
    if (!loaded.ok) return fallback(loaded.code);
    directory = loaded.directory;
  } catch { return fallback("AGENT_UNAVAILABLE"); }
  const input: AgentRoundInput = { directory, owner: context.owner, effort: efforts[0], efforts }, blocks: AgentRoundBlock[] = [], seen = new Set<string>();
  const bytesOf = (request: ModelRequest) => agentRequestBodyBytes(request, modelId);
  let unavailable = 0, force: AgentForceReason | null = null;
  for (let index = 0; index < AGENT_LIMITS.callsPerMessage; index++) {
    const round = (index + 1) as 1 | 2 | 3;
    // §3.4 stop rule: the 3rd call is always the plan; with no time or bytes for one more lookup round, the plan comes now.
    if (round === AGENT_LIMITS.callsPerMessage) force ??= "ROUND";
    else if (!force) { const left = context.remainingMs(); if (left < agentCallLimitMs(false, left, round) + AGENT_LIMITS.dbRoundMs + AGENT_LOOP_LIMITS.planMinMs) force = "TIME"; }
    let request = agentRoundRequest(input, blocks, !!force), bytes = bytesOf(request);
    if (!force && agentRequestFits(bytes) && bytes + AGENT_LIMITS.outputFraming + AGENT_LOOP_LIMITS.lookupRoomBytes > AGENT_LIMITS.requestCap) {
      force = "BYTES"; request = agentRoundRequest(input, blocks, true); bytes = bytesOf(request);
    }
    // §3.7 step 3: a round that does not fit (the first one included) is never sent.
    if (!agentRequestFits(bytes)) return fallback("AGENT_BUDGET");
    const forced = !!force;
    if (!context.calls.allows(1)) return fallback("MODEL_CALL_LIMIT");
    const limit = agentCallLimitMs(forced, context.remainingMs(), round);
    if (limit <= 0 || context.signal.aborted) return fallback("AGENT_DEADLINE");
    const call = agentCallSignal(limit, context), sent: ModelRequest = { ...request, signal: call.signal };
    attempts.set(sent, { attempt: round, purpose: forced ? "AGENT_PLAN" : "AGENT_LOOKUP" });
    let response: ModelResponse;
    try {
      try { assertSecretaryAgentModelRequest(sent, { round, forced }); } catch { return fallback("AGENT_GUARD"); }
      context.calls.take(); t.calls++; t.bytes.push(bytes);
      const effort = agentRoundInputEffort(input, blocks.length);
      t.effort = effort; t.efforts.push(effort);
      if (forced) t.forced = force;
      // The SDK's Responses model opens a response span and throws "No existing trace found" outside a trace context; tracing stays
      // off exactly as in the Runner with tracingDisabled (a NoopTrace), so nothing is exported.
      response = await withTrace(new NoopTrace(), () => model.getResponse(sent));
    } catch (error) {
      const code = callFailure(error, call.signal);
      if (code === "AGENT_PROTOCOL") t.protocol = "STATUS";
      return fallback(code);
    } finally { call.dispose(); }
    let answer: RoundAnswer;
    try { answer = readRound(response, forced, seen); } catch (error) {
      t.protocol = error instanceof AgentProtocolError ? error.detail : "ITEM";
      return fallback("AGENT_PROTOCOL");
    }
    t.commentary += answer.commentary;
    if (answer.kind === "PLAN") {
      let plan: AgentPlan;
      try { plan = decodeAgentPlanArguments(answer.arguments); } catch (error) {
        t.schema = error instanceof AgentPlanError ? [...error.reasons] : ["DECODE"];
        return fallback("AGENT_SCHEMA");
      }
      return outcome({ kind: "PLAN", plan, telemetry: telemetry("AGENT", null) });
    }
    const calls = answer.calls, emitted = response.output;
    t.lookupRounds++; t.lookupCalls += calls.length;
    const results = (outputs: readonly string[]): FunctionCallResultItem[] =>
      calls.map((lookup, position) => ({ type: "function_call_result", callId: lookup.callId, name: lookup.name, status: "completed", output: outputs[position] }));
    // The next request measured forced (its tool_choice is the longer one).
    const nextBytes = (outputs: readonly string[]) => bytesOf(agentRoundRequest(input, [...blocks, { items: emitted, results: results(outputs) }], true));
    // §3.7 step 1: when the worst outputs of this round might not fit, the executor renders them compact from the start (an answered
    // round cannot be read again: the executor counts rounds and binds the refs it delivers).
    const worst = AGENT_LOOP_LIMITS.escapeFactor * Math.min(calls.length * AGENT_LIMITS.lookupOutputBytes, AGENT_LIMITS.roundOutputBytes);
    const compact = !agentRequestFits(nextBytes(calls.map(() => "")) + worst);
    let outputs: readonly string[];
    try { outputs = await (executor as AgentCompactingExecutor).round(calls, context, { compact }); } catch { return fallback("AGENT_UNAVAILABLE"); }
    if (!Array.isArray(outputs) || outputs.length !== calls.length ||
        outputs.some(output => typeof output !== "string" || Buffer.byteLength(output, "utf8") > AGENT_LIMITS.lookupOutputBytes)) return fallback("AGENT_UNAVAILABLE");
    t.compacted ||= compact;
    // §2.1: two INDISPONIVEL in the message abort the agent.
    unavailable += outputs.filter(output => output === UNAVAILABLE).length;
    if (unavailable >= AGENT_LIMITS.unavailablePerMessage) return fallback("AGENT_UNAVAILABLE");
    // §3.7 step 2: outputs that still do not fit are refused as over the limit (the calls keep their outputs, as the API requires)
    // and the plan comes next.
    if (!agentRequestFits(nextBytes(outputs))) {
      outputs = calls.map(() => OVER_LIMIT); t.limited = true; force = "LIMITED";
      if (!agentRequestFits(nextBytes(outputs))) return fallback("AGENT_BUDGET");
    }
    blocks.push(Object.freeze({ items: emitted, results: results(outputs) }));
  }
  return fallback("MODEL_CALL_LIMIT");
}
