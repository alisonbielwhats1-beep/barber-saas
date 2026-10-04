import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelRequest } from "@openai/agents";
import { AGENT_EFFORTS, AGENT_LIMITS } from "./agent-context";
import { AGENT_PLAN_TOOL } from "./agent-plan";
import { AGENT_LOOKUP_NAMES, AGENT_TOOL_NAMES, AGENT_TOOLS_SHA256, agentToolsDigest } from "./agent-tools";
import { PILOT_REQUEST_LIMITS, PILOT_RESCHEDULE_TOOL, PILOT_TOOLS_SHA256, pilotToolsDigest } from "./pilot-reschedule-contract";

const FUNCTION_NAMES = ["select_capabilities", "upsert_action_draft"] as const;
const MODELS = ["gpt-5.6-luna", "gpt-6-luna", "deepseek/deepseek-v4.1-flash"] as const;
/** Served by OpenRouter (Chat Completions, C4 only; section at the end of this file). Every other model is OpenAI's Responses API. */
const OPENROUTER_MODELS: readonly string[] = ["deepseek/deepseek-v4.1-flash"];
const RESPONSE_FIELDS = new Set([
  "model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls",
  "max_output_tokens", "store", "stream", "include",
]);

type FunctionName = (typeof FUNCTION_NAMES)[number];
type SecretaryModel = (typeof MODELS)[number];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function fail(reason = "INVALID"): never { throw new Error(`SECRETARY_OPENAI_COST_GUARD:${reason}`); }

export function assertSecretaryModelId(modelId: string): asserts modelId is SecretaryModel {
  if (!MODELS.includes(modelId as SecretaryModel)) fail();
}
export const secretaryModelProvider = (modelId: string): "openai" | "openrouter" => {
  assertSecretaryModelId(modelId);
  return OPENROUTER_MODELS.includes(modelId) ? "openrouter" : "openai";
};

/** SDK boundary: reject hosted/deferred tools and provider overrides before the model is called. */
export function assertSecretaryModelRequest(request: ModelRequest, expectedName: FunctionName): void {
  if (request.prompt || request.previousResponseId || request.conversationId || request.handoffs.length !== 0 ||
      request.tracing !== false || request.modelSettings.store !== false ||
      request.modelSettings.parallelToolCalls !== false || request.modelSettings.toolChoice !== expectedName ||
      request.modelSettings.providerData !== undefined || request.modelSettings.contextManagement !== undefined ||
      request.modelSettings.promptCacheRetention !== undefined || request.modelSettings.promptCacheOptions !== undefined ||
      request.tools.length !== 1 || request.toolsExplicitlyProvided !== true) fail();
  const tool = request.tools[0];
  if (tool.type !== "function" || tool.name !== expectedName || tool.deferLoading || tool.providerData ||
      tool.allowedCallers || tool.namespace || tool.outputSchema) fail();
}

/** HTTP boundary: SDK upgrades and extra_body cannot silently add a hosted capability. C5: the agent's format (§6.3, below) only
 * with an explicit {agent:true}; everything else is checked exactly as before. */
export function assertSecretaryResponsesPayload(value: unknown, expectedModel: string, options: SecretaryGuardOptions = {}): void {
  assertSecretaryModelId(expectedModel);
  if (!record(value)) fail("PAYLOAD_SHAPE");
  // A* premise probe (docs/c5-spike/13-sonda-premissa-astar.md): its own one-tool format only with an explicit {pilotAnchorProbe:true}, and nothing else under it.
  if (options.pilotAnchorProbe === true) return assertPilotAnchorProbePayload(value, expectedModel);
  // Pilot (flag SALON_SECRETARY_PILOT_RESCHEDULE): its one-tool format only with an explicit {pilot:true}; without it the tool is unknown below.
  if (options.pilot === true && pilotShaped(value)) return assertPilotPayload(value, expectedModel);
  if (options.agent === true && !(Array.isArray(value.tools) && value.tools.length === 1)) return assertAgentPayload(value, expectedModel);
  const unexpected = Object.keys(value).filter(key => !RESPONSE_FIELDS.has(key));
  if (unexpected.length) fail(`UNEXPECTED_FIELD:${unexpected.join(",")}`);
  if (value.model !== expectedModel || value.store !== false || value.stream !== false ||
      value.parallel_tool_calls !== false || typeof value.instructions !== "string" ||
      !Array.isArray(value.include) || value.include.length !== 0 ||
      !Array.isArray(value.input) || !Array.isArray(value.tools) || value.tools.length !== 1 ||
      !Number.isInteger(value.max_output_tokens) || !record(value.tool_choice)) fail("PAYLOAD_FIELDS");
  const choice = value.tool_choice;
  const tool = value.tools[0];
  if (!record(tool) || tool.type !== "function" || !FUNCTION_NAMES.includes(tool.name as FunctionName) ||
      choice.type !== "function" || choice.name !== tool.name ||
      Object.keys(choice).some(key => key !== "type" && key !== "name") ||
      Object.keys(tool).some(key => !["type", "name", "description", "parameters", "strict"].includes(key)) ||
      !record(tool.parameters)) fail("TOOL_FIELDS");
  for (const item of value.input) {
    if (!record(item) || (item.type !== undefined && item.type !== "message") ||
        !["user", "system"].includes(String(item.role)) ||
        Object.keys(item).some(key => !["type", "role", "content"].includes(key))) fail("INPUT_ITEM");
    if (typeof item.content === "string") continue;
    if (!Array.isArray(item.content)) fail("INPUT_CONTENT_SHAPE");
    for (const content of item.content) {
      if (!record(content) || content.type !== "input_text" || typeof content.text !== "string") fail("INPUT_CONTENT");
    }
  }
}

/** `{agent:true}` (C5, passed by the model factory when SALON_SECRETARY_AGENT is on): the agent's format is admitted too, and while
 * an agent call observes it (observeSecretaryResponseUsage) the token counts of the response body reach the observer, numbers only,
 * so a response that ends `incomplete` (the SDK throws) still records what it cost. Without the option: as before. */
export function secretaryGuardedFetch(modelId: string, options: SecretaryGuardOptions = {}): typeof fetch {
  // OpenRouter serves only the C4 format: the agent, the pilot and the A* probe stay on OpenAI.
  if (secretaryModelProvider(modelId) === "openrouter") {
    if (options.agent || options.pilot || options.pilotAnchorProbe) fail("OPENROUTER_C4_ONLY");
    return openRouterGuardedFetch(modelId, options.openRouter);
  }
  const agent = options.agent === true, pilot = options.pilot === true, probe = options.pilotAnchorProbe === true;
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : undefined);
    if (url !== "https://api.openai.com/v1/responses" || method?.toUpperCase() !== "POST") fail();
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof body !== "string") fail();
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { fail(); }
    assertSecretaryResponsesPayload(payload, modelId, probe ? { pilotAnchorProbe: true } : pilot ? { agent, pilot } : { agent });
    if (!agent && !pilot && !probe) return globalThis.fetch(input, init);
    const response = await globalThis.fetch(input, init);
    await reportResponseUsage(response);
    return response;
  };
}

// ---------------------------------------------------------------- C5 agent (flag SALON_SECRETARY_AGENT, default off)
/** docs/c5-spike/11-especificacao-agente.md §6.3. The agent's formats are admitted ONLY when the caller says {agent:true}: the guard
 * never reads the flag (the model factory reads it once; the program ledger gets it from the runner), so the C4 formats above stay
 * exactly as they were and an agent format without the option is refused like any unknown one. */
export type SecretaryGuardOptions = { readonly agent?: boolean; readonly pilot?: boolean; /** OpenRouter models only */ readonly openRouter?: OpenRouterOptions;
  /** A* premise probe only (docs/c5-spike/13-sonda-premissa-astar.md): the probe harness says so; nothing else ever passes it. */ readonly pilotAnchorProbe?: boolean };
/** `include` of every agent call: with store:false the reasoning items come back encrypted and are returned as they came (§3.3). */
export const AGENT_REASONING_INCLUDE = "reasoning.encrypted_content";
/** Which call of the message a request is: `forced` = tool_choice propor_plano (the 3rd call always is). */
export type AgentRoundShape = { readonly round: 1 | 2 | 3; readonly forced: boolean };
const AGENT_RESPONSE_FIELDS = new Set([...RESPONSE_FIELDS, "reasoning"]);
const AGENT_SETTINGS = ["toolChoice", "parallelToolCalls", "maxTokens", "store", "reasoning", "providerData"];
const AGENT_BREAKPOINTS = 4;
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const utf8 = (text: string) => Buffer.byteLength(text, "utf8");
const lookupName = (name: unknown) => (AGENT_LOOKUP_NAMES as readonly unknown[]).includes(name);
const effortOnly = (value: unknown) => record(value) && only(value, ["effort"]) && (AGENT_EFFORTS as readonly unknown[]).includes(value.effort);
const outputCap = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= AGENT_LIMITS.maxOutputTokens;
/** One input item as the round grammar reads it (the SDK's protocol items and the HTTP body's items have one reader each). */
type AgentWireItem = { kind: "message"; breakpoints: number } | { kind: "reasoning" } | { kind: "commentary"; bytes: number } | { kind: "call"; callId: string } | { kind: "output"; callId: string };
/** Input = the messages (system/user), then the lookup rounds already answered, one block each: what the model emitted, in its own
 * order (reasoning items, at most one commentary of ≤ 1 KB, 1..4 lookup calls, never propor_plano), then one output per call, in the
 * calls' order. A commentary, an output or a message anywhere else is refused. Returns the number of blocks (the round − 1). */
function agentRoundBlocks(input: readonly unknown[], read: (item: unknown) => AgentWireItem): number {
  const items = input.map(read), seen = new Set<string>();
  let at = 0, blocks = 0, breakpoints = 0;
  for (; at < items.length; at++) { const item = items[at]; if (item.kind !== "message") break; breakpoints += item.breakpoints; }
  if (!at || breakpoints > AGENT_BREAKPOINTS) fail("AGENT_INPUT_MESSAGES");
  while (at < items.length) {
    const calls: string[] = [];
    let commentary = 0, size = 0;
    for (; at < items.length; at++) {
      const item = items[at];
      if (item.kind === "call") { if (seen.has(item.callId)) fail("AGENT_CALL_ID"); seen.add(item.callId); calls.push(item.callId); }
      else if (item.kind === "commentary") { commentary++; size += item.bytes; }
      else if (item.kind !== "reasoning") break;
    }
    if (!calls.length || calls.length > AGENT_LIMITS.lookupsPerRound || commentary > 1 || size > AGENT_LIMITS.commentaryBytes) fail("AGENT_ROUND_BLOCK");
    for (const callId of calls) { const item = items[at++]; if (item?.kind !== "output" || item.callId !== callId) fail("AGENT_CALL_OUTPUT"); }
    blocks++;
  }
  return blocks;
}
/** HTTP item (the body the SDK serialized, openaiResponsesConverter getInputItems): closed keys everywhere. */
function httpAgentItem(item: unknown): AgentWireItem {
  if (!record(item)) fail("AGENT_INPUT_ITEM");
  const { type, role } = item, id = item.id === undefined || typeof item.id === "string", done = item.status === undefined || item.status === "completed";
  if ((type === undefined || type === "message") && (role === "system" || role === "user")) {
    if (!only(item, ["type", "role", "content"])) fail("AGENT_INPUT_ITEM");
    if (typeof item.content === "string") return { kind: "message", breakpoints: 0 };
    if (!Array.isArray(item.content) || !item.content.length) fail("AGENT_INPUT_CONTENT");
    let breakpoints = 0;
    for (const part of item.content) {
      if (!record(part) || !only(part, ["type", "text", "prompt_cache_breakpoint"]) || part.type !== "input_text" || typeof part.text !== "string") fail("AGENT_INPUT_CONTENT");
      const mark = part.prompt_cache_breakpoint;
      if (mark === undefined) continue;
      if (!record(mark) || !only(mark, ["mode"]) || mark.mode !== "explicit") fail("AGENT_INPUT_CONTENT");
      breakpoints++;
    }
    return { kind: "message", breakpoints };
  }
  if (type === "message" && role === "assistant") {
    if (!only(item, ["type", "id", "role", "content", "status", "phase"]) || !id || !done || item.phase !== "commentary" || !Array.isArray(item.content) || !item.content.length) fail("AGENT_COMMENTARY");
    let bytes = 0;
    for (const part of item.content) {
      if (!record(part) || !only(part, ["type", "text", "annotations", "logprobs"]) || part.type !== "output_text" || typeof part.text !== "string" ||
          (part.annotations !== undefined && (!Array.isArray(part.annotations) || part.annotations.length > 0)) || (part.logprobs !== undefined && !Array.isArray(part.logprobs))) fail("AGENT_COMMENTARY");
      bytes += utf8(part.text as string);
    }
    return { kind: "commentary", bytes };
  }
  if (type === "reasoning") {
    if (!only(item, ["type", "id", "summary", "encrypted_content", "status", "content"]) || !id || typeof item.encrypted_content !== "string" || !item.encrypted_content ||
        !Array.isArray(item.summary) || item.summary.some(part => !record(part) || !only(part, ["type", "text"]) || part.type !== "summary_text" || typeof part.text !== "string") ||
        (item.content !== undefined && !Array.isArray(item.content))) fail("AGENT_REASONING");
    return { kind: "reasoning" };
  }
  if (type === "function_call") {
    if (!only(item, ["type", "id", "call_id", "name", "arguments", "status"]) || !id || !done || typeof item.call_id !== "string" || !item.call_id || !lookupName(item.name) ||
        typeof item.arguments !== "string" || utf8(item.arguments) > AGENT_LIMITS.argumentsBytes) fail("AGENT_FUNCTION_CALL");
    return { kind: "call", callId: item.call_id as string };
  }
  if (type === "function_call_output") {
    if (!only(item, ["type", "id", "call_id", "output", "status"]) || !id || !done || typeof item.call_id !== "string" || !item.call_id ||
        typeof item.output !== "string" || utf8(item.output) > AGENT_LIMITS.lookupOutputBytes) fail("AGENT_FUNCTION_OUTPUT");
    return { kind: "output", callId: item.call_id as string };
  }
  fail("AGENT_INPUT_ITEM");
}
/** SDK protocol item (what the loop hands to Model.getResponse). */
function sdkAgentItem(item: unknown): AgentWireItem {
  if (!record(item)) fail("AGENT_INPUT_ITEM");
  const provider = record(item.providerData) ? item.providerData : {};
  if ((item.type === undefined || item.type === "message") && (item.role === "system" || item.role === "user")) {
    if (typeof item.content === "string") return { kind: "message", breakpoints: 0 };
    if (!Array.isArray(item.content)) fail("AGENT_INPUT_CONTENT");
    return { kind: "message", breakpoints: item.content.filter(part => record(part) && part.prompt_cache_breakpoint !== undefined).length };
  }
  if (item.type === "message" && item.role === "assistant") {
    if ((item.phase ?? provider.phase) !== "commentary" || !Array.isArray(item.content)) fail("AGENT_COMMENTARY");
    return { kind: "commentary", bytes: item.content.reduce((sum: number, part: unknown) => sum + (record(part) && typeof part.text === "string" ? utf8(part.text) : 0), 0) };
  }
  if (item.type === "reasoning") {
    const encrypted = provider.encrypted_content ?? provider.encryptedContent;
    if (typeof encrypted !== "string" || !encrypted) fail("AGENT_REASONING");
    return { kind: "reasoning" };
  }
  if (item.type === "function_call") {
    if (typeof item.callId !== "string" || !item.callId || !lookupName(item.name) || typeof item.arguments !== "string" || utf8(item.arguments) > AGENT_LIMITS.argumentsBytes ||
        (item.status !== undefined && item.status !== "completed")) fail("AGENT_FUNCTION_CALL");
    return { kind: "call", callId: item.callId as string };
  }
  if (item.type === "function_call_result") {
    if (typeof item.callId !== "string" || !lookupName(item.name) || item.status !== "completed" || typeof item.output !== "string" ||
        utf8(item.output) > AGENT_LIMITS.lookupOutputBytes) fail("AGENT_FUNCTION_OUTPUT");
    return { kind: "output", callId: item.callId as string };
  }
  fail("AGENT_INPUT_ITEM");
}
/** SDK boundary of one agent call (§6.3): the six tools in order with the pinned digest; tool_choice "required" with parallel calls,
 * or forced into propor_plano without them (the 3rd call always forced); store:false; reasoning = {effort} only; providerData =
 * exactly {include:[reasoning.encrypted_content]}; nothing else in the settings (no cache retention/options, no context management);
 * no prompt, previous response or conversation; no handoffs; tracing off; and an input whose answered rounds match the call. */
export function assertSecretaryAgentModelRequest(request: ModelRequest, shape: AgentRoundShape): void {
  const settings = request.modelSettings, provider = settings.providerData;
  if (![1, 2, 3].includes(shape.round) || (shape.round === 3 && !shape.forced) || request.prompt || request.previousResponseId || request.conversationId ||
      request.handoffs.length !== 0 || request.tracing !== false || request.toolsExplicitlyProvided !== true || request.outputType !== "text" ||
      typeof request.systemInstructions !== "string" || !only(settings as Record<string, unknown>, AGENT_SETTINGS) || settings.store !== false ||
      !outputCap(settings.maxTokens) || !effortOnly(settings.reasoning) ||
      !record(provider) || !only(provider, ["include"]) || !Array.isArray(provider.include) || provider.include.length !== 1 || provider.include[0] !== AGENT_REASONING_INCLUDE ||
      settings.toolChoice !== (shape.forced ? AGENT_PLAN_TOOL : "required") || settings.parallelToolCalls !== !shape.forced) fail("AGENT_REQUEST");
  if (request.tools.length !== AGENT_TOOL_NAMES.length || request.tools.some((tool, index) => tool.type !== "function" || tool.name !== AGENT_TOOL_NAMES[index] ||
      tool.strict !== true || tool.deferLoading || tool.providerData || tool.allowedCallers || tool.namespace || tool.outputSchema) ||
      agentToolsDigest(request.tools) !== AGENT_TOOLS_SHA256) fail("AGENT_TOOLS");
  if (!Array.isArray(request.input) || agentRoundBlocks(request.input, sdkAgentItem) !== shape.round - 1) fail("AGENT_ROUNDS");
}
/** HTTP boundary of the agent format (§6.3): today's keys plus `reasoning` ({effort} only), max_output_tokens 1..8192, include [] or
 * [reasoning.encrypted_content], the six tools by digest, "required" with parallel calls or propor_plano forced without them,
 * messages with string content or input_text parts (only an explicit breakpoint besides type/text; ≤ 4 breakpoints), then at most
 * two answered rounds; after two rounds the call must be forced. */
function assertAgentPayload(value: Record<string, unknown>, expectedModel: string): void {
  const unexpected = Object.keys(value).filter(key => !AGENT_RESPONSE_FIELDS.has(key));
  if (unexpected.length) fail(`UNEXPECTED_FIELD:${unexpected.join(",")}`);
  const include = value.include, choice = value.tool_choice, forced = record(choice);
  if (value.model !== expectedModel || value.store !== false || value.stream !== false || typeof value.instructions !== "string" ||
      !outputCap(value.max_output_tokens) || !effortOnly(value.reasoning) || !Array.isArray(value.input) || !Array.isArray(value.tools) ||
      !Array.isArray(include) || include.length > 1 || (include.length === 1 && include[0] !== AGENT_REASONING_INCLUDE)) fail("AGENT_PAYLOAD_FIELDS");
  if (forced ? !only(choice, ["type", "name"]) || choice.type !== "function" || choice.name !== AGENT_PLAN_TOOL || value.parallel_tool_calls !== false
    : choice !== "required" || value.parallel_tool_calls !== true) fail("AGENT_TOOL_CHOICE");
  const tools = value.tools as unknown[];
  if (tools.length !== AGENT_TOOL_NAMES.length || agentToolsDigest(tools) !== AGENT_TOOLS_SHA256) fail("AGENT_TOOLS");
  const blocks = agentRoundBlocks(value.input as unknown[], httpAgentItem);
  if (blocks > AGENT_LIMITS.lookupRounds || (blocks === AGENT_LIMITS.lookupRounds && !forced)) fail("AGENT_ROUNDS");
}
// ---------------------------------------------------------------- pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off)
/** docs/c5-spike/12-piloto-remarcacao.md §2: ONE strict tool (interpretar_remarcacao, pinned by digest) forced, no parallel calls, store:false,
 * reasoning {effort} only (the frozen agent's), the output cap of PILOT_REQUEST_LIMITS, no hosted capability, no prompt/previous response/
 * conversation, messages only (system/user). Admitted ONLY when the caller says {pilot:true} (the model factory reads the flag); the C4 and
 * agent formats are checked exactly as before. */
const PILOT_SETTINGS = ["toolChoice", "parallelToolCalls", "maxTokens", "store", "reasoning"];
const pilotEffort = (value: unknown) => record(value) && only(value, ["effort"]) && value.effort === PILOT_REQUEST_LIMITS.effort;
const pilotShaped = (value: Record<string, unknown>) => Array.isArray(value.tools) && value.tools.length === 1 && record(value.tools[0]) && value.tools[0].name === PILOT_RESCHEDULE_TOOL;
/** SDK boundary of one pilot call (the interpretation or its single format repair). */
export function assertSecretaryPilotModelRequest(request: ModelRequest): void {
  const settings = request.modelSettings;
  if (request.prompt || request.previousResponseId || request.conversationId || request.handoffs.length !== 0 || request.tracing !== false ||
      request.toolsExplicitlyProvided !== true || request.outputType !== "text" || typeof request.systemInstructions !== "string" ||
      !only(settings as Record<string, unknown>, PILOT_SETTINGS) || settings.store !== false || settings.parallelToolCalls !== false ||
      settings.toolChoice !== PILOT_RESCHEDULE_TOOL || settings.maxTokens !== PILOT_REQUEST_LIMITS.maxOutputTokens || !pilotEffort(settings.reasoning)) fail("PILOT_REQUEST");
  if (request.tools.length !== 1 || request.tools.some(tool => tool.type !== "function" || tool.name !== PILOT_RESCHEDULE_TOOL || tool.strict !== true || tool.deferLoading ||
      tool.providerData || tool.allowedCallers || tool.namespace || tool.outputSchema) || pilotToolsDigest(request.tools) !== PILOT_TOOLS_SHA256) fail("PILOT_TOOLS");
  if (!Array.isArray(request.input) || !request.input.length || request.input.some(item => !record(item) || (item.type !== undefined && item.type !== "message") ||
      !["system", "user"].includes(String(item.role)) || typeof item.content !== "string")) fail("PILOT_INPUT");
}
/** HTTP boundary of the pilot format: today's keys plus `reasoning` ({effort} only), include [], the pinned tool forced. */
function assertPilotPayload(value: Record<string, unknown>, expectedModel: string): void {
  const unexpected = Object.keys(value).filter(key => !AGENT_RESPONSE_FIELDS.has(key));
  if (unexpected.length) fail(`UNEXPECTED_FIELD:${unexpected.join(",")}`);
  const choice = value.tool_choice;
  if (value.model !== expectedModel || value.store !== false || value.stream !== false || value.parallel_tool_calls !== false || typeof value.instructions !== "string" ||
      value.max_output_tokens !== PILOT_REQUEST_LIMITS.maxOutputTokens || !pilotEffort(value.reasoning) || !Array.isArray(value.include) || value.include.length !== 0 ||
      !Array.isArray(value.input) || !value.input.length || !record(choice) || !only(choice, ["type", "name"]) || choice.type !== "function" || choice.name !== PILOT_RESCHEDULE_TOOL) fail("PILOT_PAYLOAD_FIELDS");
  if (pilotToolsDigest(value.tools as unknown[]) !== PILOT_TOOLS_SHA256) fail("PILOT_TOOLS");
  for (const item of value.input as unknown[]) {
    if (!record(item) || (item.type !== undefined && item.type !== "message") || !["user", "system"].includes(String(item.role)) || !only(item, ["type", "role", "content"])) fail("PILOT_INPUT");
    if (typeof item.content === "string") continue;
    if (!Array.isArray(item.content) || !item.content.length || item.content.some(part => !record(part) || !only(part, ["type", "text"]) || part.type !== "input_text" || typeof part.text !== "string")) fail("PILOT_INPUT");
  }
}
// ---------------------------------------------------------------- A* premise probe (docs/c5-spike/13-sonda-premissa-astar.md; Adendo 12)
/** The digest of the probe's tool list (pilot-astar-contract.ts, `pilotToolsDigest([astarTool()])`), pinned here as a literal so the real flow never
 * loads the A* contract (spec 13 §9.6); a test keeps it equal to the digest computed from the variant. */
export const PILOT_ANCHOR_PROBE_TOOLS_SHA256 = "a0299fde45dc6c698b957234f9e88a6c900a97977931cad522325ba5d38480aa";
/** The probe call is the pilot's format with the variant tool, pinned by that literal digest. It is admitted ONLY when the caller says
 * {pilotAnchorProbe:true} (the probe harness, never the app), and under that option nothing else is; every other format is checked as before. */
export function assertSecretaryPilotAnchorProbeModelRequest(request: ModelRequest): void {
  const settings = request.modelSettings;
  if (request.prompt || request.previousResponseId || request.conversationId || request.handoffs.length !== 0 || request.tracing !== false ||
      request.toolsExplicitlyProvided !== true || request.outputType !== "text" || typeof request.systemInstructions !== "string" ||
      !only(settings as Record<string, unknown>, PILOT_SETTINGS) || settings.store !== false || settings.parallelToolCalls !== false ||
      settings.toolChoice !== PILOT_RESCHEDULE_TOOL || settings.maxTokens !== PILOT_REQUEST_LIMITS.maxOutputTokens || !pilotEffort(settings.reasoning)) fail("PROBE_REQUEST");
  if (request.tools.length !== 1 || request.tools.some(tool => tool.type !== "function" || tool.name !== PILOT_RESCHEDULE_TOOL || tool.strict !== true || tool.deferLoading ||
      tool.providerData || tool.allowedCallers || tool.namespace || tool.outputSchema) || pilotToolsDigest(request.tools) !== PILOT_ANCHOR_PROBE_TOOLS_SHA256) fail("PROBE_TOOLS");
  if (!Array.isArray(request.input) || !request.input.length || request.input.some(item => !record(item) || (item.type !== undefined && item.type !== "message") ||
      !["system", "user"].includes(String(item.role)) || typeof item.content !== "string")) fail("PROBE_INPUT");
}
/** HTTP boundary of the probe format: the pilot's keys and limits, include [], the variant tool (by digest) forced, messages only. */
function assertPilotAnchorProbePayload(value: Record<string, unknown>, expectedModel: string): void {
  const unexpected = Object.keys(value).filter(key => !AGENT_RESPONSE_FIELDS.has(key));
  if (unexpected.length) fail(`UNEXPECTED_FIELD:${unexpected.join(",")}`);
  const choice = value.tool_choice;
  if (value.model !== expectedModel || value.store !== false || value.stream !== false || value.parallel_tool_calls !== false || typeof value.instructions !== "string" ||
      value.max_output_tokens !== PILOT_REQUEST_LIMITS.maxOutputTokens || !pilotEffort(value.reasoning) || !Array.isArray(value.include) || value.include.length !== 0 ||
      !Array.isArray(value.input) || !value.input.length || !record(choice) || !only(choice, ["type", "name"]) || choice.type !== "function" || choice.name !== PILOT_RESCHEDULE_TOOL) fail("PROBE_PAYLOAD_FIELDS");
  if (!Array.isArray(value.tools) || value.tools.length !== 1 || pilotToolsDigest(value.tools as unknown[]) !== PILOT_ANCHOR_PROBE_TOOLS_SHA256) fail("PROBE_TOOLS");
  for (const item of value.input as unknown[]) {
    if (!record(item) || (item.type !== undefined && item.type !== "message") || !["user", "system"].includes(String(item.role)) || !only(item, ["type", "role", "content"])) fail("PROBE_INPUT");
    if (typeof item.content === "string") continue;
    if (!Array.isArray(item.content) || !item.content.length || item.content.some(part => !record(part) || !only(part, ["type", "text"]) || part.type !== "input_text" || typeof part.text !== "string")) fail("PROBE_INPUT");
  }
}
/** Token counts of a Responses body (numbers only, never text): what an agent call observes, also for an `incomplete` response. */
export type SecretaryResponseUsage = {
  readonly input_tokens: number | null; readonly output_tokens: number | null; readonly total_tokens: number | null;
  readonly input_tokens_details: { readonly cached_tokens: number | null; readonly cache_write_tokens: number | null };
  readonly output_tokens_details: { readonly reasoning_tokens: number | null };
};
const usageObservers = new AsyncLocalStorage<(usage: SecretaryResponseUsage) => void>();
/** Runs one agent call with an observer of its response's token counts (usage.ts instrumentAgentModel). Only the guarded fetch of an
 * {agent:true} model reports, and only inside this scope; a C4 call never reads its response body here. */
export const observeSecretaryResponseUsage = <T>(observer: (usage: SecretaryResponseUsage) => void, work: () => Promise<T>): Promise<T> => usageObservers.run(observer, work);
const tokenCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
async function reportResponseUsage(response: Response): Promise<void> {
  const observer = usageObservers.getStore();
  if (!observer || !response?.ok) return;
  try {
    const body: unknown = await response.clone().json(), usage = record(body) && record(body.usage) ? body.usage : undefined;
    if (!usage) return;
    const input = record(usage.input_tokens_details) ? usage.input_tokens_details : {}, output = record(usage.output_tokens_details) ? usage.output_tokens_details : {};
    observer({ input_tokens: tokenCount(usage.input_tokens), output_tokens: tokenCount(usage.output_tokens), total_tokens: tokenCount(usage.total_tokens),
      input_tokens_details: { cached_tokens: tokenCount(input.cached_tokens), cache_write_tokens: tokenCount(input.cache_write_tokens) },
      output_tokens_details: { reasoning_tokens: tokenCount(output.reasoning_tokens) } });
  } catch { /* Observation only: the response is returned untouched. */ }
}

// ---------------------------------------------------------------- OpenRouter (Chat Completions): DeepSeek in place of Luna, C4 only
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Added by the guard to every OpenRouter call (the SDK never sends them). Routing as the owner chose it on 04/10: the model's default
 * OpenRouter route, no provider pinned; only providers that honor every parameter sent (the forced tool above all) are eligible.
 * Reasoning off: C4 is one forced call, Luna answered it with 0 reasoning tokens, and reasoning would only add latency and cost. */
/** Measurement knobs (04/10), read once by the model factory from SALON_SECRETARY_OPENROUTER_REASONING / _PROVIDER, never by
 * the guard: a reasoning effort instead of "off", and ONE pinned provider (no fallback) instead of the default route. */
export type OpenRouterOptions = { readonly reasoning?: string; readonly provider?: string };
const OPENROUTER_EFFORTS = ["low", "medium", "high"];
export function openRouterExtras(options: OpenRouterOptions = {}) {
  const reasoning = options.reasoning ?? "off", provider = options.provider;
  if ((reasoning !== "off" && !OPENROUTER_EFFORTS.includes(reasoning)) || (provider !== undefined && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(provider))) fail("OPENROUTER_OPTIONS");
  // temperature 0 (owner decision 04/10): the same sentence gets the same reading; Golden failures moved between runs at the default.
  return { provider: provider ? { require_parameters: true, order: [provider], allow_fallbacks: false } : { require_parameters: true },
    reasoning: reasoning === "off" ? { enabled: false } : { effort: reasoning }, temperature: 0 };
}
export const OPENROUTER_REQUEST_EXTRAS = Object.freeze(openRouterExtras());
const CHAT_FIELDS = new Set(["model", "messages", "tools", "tool_choice", "parallel_tool_calls", "max_tokens", "store", "stream"]);
const CHAT_MAX_OUTPUT_TOKENS = 8192;
type ChatMessage = { role: "system" | "user"; content: string | { type: "text"; text: string }[] };

/** HTTP boundary of the C4 format in Chat Completions (what @openai/agents sends with useResponses:false): exactly one strict local
 * function, forced by name, system/user text messages only, no stream, no hosted or provider extras from the SDK side. */
export function assertSecretaryChatPayload(value: unknown, expectedModel: string): asserts value is Record<string, unknown> & { messages: ChatMessage[] } {
  if (secretaryModelProvider(expectedModel) !== "openrouter") fail("CHAT_MODEL");
  if (!record(value)) fail("PAYLOAD_SHAPE");
  const unexpected = Object.keys(value).filter(key => !CHAT_FIELDS.has(key));
  if (unexpected.length) fail(`UNEXPECTED_FIELD:${unexpected.join(",")}`);
  if (value.model !== expectedModel || value.stream !== false || value.parallel_tool_calls !== false ||
      (value.store !== undefined && value.store !== false) || !Number.isInteger(value.max_tokens) ||
      (value.max_tokens as number) < 1 || (value.max_tokens as number) > CHAT_MAX_OUTPUT_TOKENS ||
      !Array.isArray(value.messages) || value.messages.length === 0 || !Array.isArray(value.tools) || value.tools.length !== 1 ||
      !record(value.tool_choice)) fail("PAYLOAD_FIELDS");
  const tool = value.tools[0], choice = value.tool_choice;
  const fn = record(tool) ? tool.function : undefined, forced = choice.function;
  if (!record(tool) || tool.type !== "function" || Object.keys(tool).some(key => key !== "type" && key !== "function") ||
      !record(fn) || !FUNCTION_NAMES.includes(fn.name as FunctionName) || fn.strict !== true || !record(fn.parameters) ||
      Object.keys(fn).some(key => !["name", "description", "parameters", "strict"].includes(key)) ||
      choice.type !== "function" || Object.keys(choice).some(key => key !== "type" && key !== "function") ||
      !record(forced) || forced.name !== fn.name || Object.keys(forced).some(key => key !== "name")) fail("TOOL_FIELDS");
  for (const message of value.messages) {
    if (!record(message) || !["system", "user"].includes(String(message.role)) ||
        Object.keys(message).some(key => key !== "role" && key !== "content")) fail("INPUT_ITEM");
    if (typeof message.content === "string") continue;
    if (!Array.isArray(message.content) || message.content.length === 0) fail("INPUT_CONTENT_SHAPE");
    for (const part of message.content) {
      if (!record(part) || part.type !== "text" || typeof part.text !== "string" || Object.keys(part).some(key => key !== "type" && key !== "text")) fail("INPUT_CONTENT");
    }
  }
}

/** The body OpenRouter receives: the checked C4 payload with each content as one string (no provider reads OpenAI's cache
 * breakpoints; DeepSeek caches the stable prefix by itself), without OpenAI's `store` and without `parallel_tool_calls` (one
 * forced tool; almost no DeepSeek provider declares it, so with require_parameters it left no route: 404, measured 04/10),
 * with the tool NOT strict, plus OPENROUTER_REQUEST_EXTRAS. Strict made the providers decode our 17 KB schema token by token
 * and DeepSeek's answers came out deformed (Golden 3/30; the same 5 failed requests: 0/5 strict, 5/5 not strict, 04/10). The
 * backend's typed parser still validates every answer before it is used, exactly as with Luna. */
export function openRouterBody(payload: Record<string, unknown> & { messages: ChatMessage[] }, options: OpenRouterOptions = {}) {
  const { store: _store, parallel_tool_calls: _parallel, messages, tools, ...rest } = payload; void _store; void _parallel;
  return { ...rest, tools: (tools as { type: string; function: Record<string, unknown> }[]).map(tool => ({ ...tool, function: { ...tool.function, strict: false } })), messages: messages.map(({ role, content }) => ({ role, content: typeof content === "string" ? content : content.map(part => part.text).join("\n") })),
    ...openRouterExtras(options) };
}

function openRouterGuardedFetch(modelId: string, options: OpenRouterOptions = {}): typeof fetch {
  openRouterExtras(options);
  return async (input, init) => {
    if (input instanceof Request) fail("REQUEST_OBJECT");
    if (String(input) !== OPENROUTER_CHAT_URL || init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string") fail();
    let payload: unknown;
    try { payload = JSON.parse(init.body); } catch { fail(); }
    assertSecretaryChatPayload(payload, modelId);
    const headers = new Headers(init.headers);
    headers.delete("content-length");
    const response = await globalThis.fetch(OPENROUTER_CHAT_URL, { ...init, headers, body: JSON.stringify(openRouterBody(payload, options)) });
    return completedToolArguments(response, payload);
  };
}
/** Without strict decoding a provider omits the keys it would have sent as null (Golden 04/10: answers understood, then refused by
 * the parser for a missing key, "Não entendi"). The tool's arguments are completed by completeOmittedNulls; nothing else changes. */
async function completedToolArguments(response: Response, payload: Record<string, unknown>): Promise<Response> {
  if (!response.ok) return response;
  let body: unknown;
  try { body = await response.clone().json(); } catch { return response; }
  const tool = (payload.tools as { function: { name: string; parameters: unknown } }[])[0].function;
  const choices = record(body) && Array.isArray(body.choices) ? body.choices : [];
  const message = record(choices[0]) && record(choices[0].message) ? choices[0].message : undefined;
  if (!message || !Array.isArray(message.tool_calls)) return response;
  for (const call of message.tool_calls) {
    if (!record(call) || !record(call.function) || call.function.name !== tool.name || typeof call.function.arguments !== "string") continue;
    try { call.function.arguments = JSON.stringify(completeOmittedNulls(JSON.parse(call.function.arguments), tool.parameters, tool.parameters)); } catch { /* left as sent */ }
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length"); headers.delete("content-encoding");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}
const resolveSchema = (schema: unknown, root: unknown): unknown => {
  let node = schema;
  for (let depth = 0; depth < 32 && record(node) && typeof node.$ref === "string"; depth++) {
    if (!node.$ref.startsWith("#/")) return undefined;
    node = node.$ref.slice(2).split("/").reduce<unknown>((at, part) => record(at) ? at[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined, root);
  }
  return node;
};
const admitsNull = (schema: unknown, root: unknown): boolean => {
  const node = resolveSchema(schema, root);
  if (!record(node)) return false;
  if (node.type === "null" || (Array.isArray(node.type) && node.type.includes("null")) || (Array.isArray(node.enum) && node.enum.includes(null))) return true;
  return Array.isArray(node.anyOf) && node.anyOf.some(branch => admitsNull(branch, root));
};
/** The one object branch of an anyOf the value can belong to: its keys all declared (additionalProperties false) and every
 * enum/const key equal. None or several: undefined (nothing is completed). */
function objectBranch(value: Record<string, unknown>, branches: unknown[], root: unknown) {
  const fits = branches.map(branch => resolveSchema(branch, root)).filter((branch): branch is Record<string, unknown> => {
    if (!record(branch) || branch.type !== "object" || !record(branch.properties)) return false;
    const properties = branch.properties;
    if (branch.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) return false;
    return Object.entries(value).every(([key, item]) => {
      const property = resolveSchema(properties[key], root);
      return !record(property) || ((!Array.isArray(property.enum) || property.enum.includes(item)) && (!("const" in property) || property.const === item));
    });
  });
  return fits.length === 1 ? fits[0] : undefined;
}
/** A list the schema requires and that does not admit null: "nothing" can only be written [] (strict decoding forces it). */
const emptyListOnly = (schema: unknown, root: unknown) => { const node = resolveSchema(schema, root); return record(node) && node.type === "array" && !admitsNull(node, root); };
/** Schema-guided completion of a non-strict answer: an omitted REQUIRED key whose schema admits null becomes null (what strict
 * decoding sends for "no value"); null or an omitted REQUIRED key where the schema only admits a list becomes [] (the same
 * "nothing": DeepSeek wrote clear_fields:null and the customer turns were refused, 04/10). Never a value; an ambiguous anyOf is
 * left as sent. */
export function completeOmittedNulls(value: unknown, schema: unknown, root: unknown): unknown {
  const node = resolveSchema(schema, root);
  if (!record(node)) return value;
  if (Array.isArray(node.anyOf)) {
    if (!record(value)) return Array.isArray(value) ? value.map(item => item) : value;
    const branch = objectBranch(value, node.anyOf, root);
    return branch ? completeOmittedNulls(value, branch, root) : value;
  }
  if (Array.isArray(value)) return node.items === undefined ? value : value.map(item => completeOmittedNulls(item, node.items, root));
  if (!record(value) || !record(node.properties)) return value;
  const out: Record<string, unknown> = { ...value }, required = Array.isArray(node.required) ? node.required : [];
  for (const [key, property] of Object.entries(node.properties)) {
    if (Object.hasOwn(out, key)) out[key] = out[key] === null && emptyListOnly(property, root) ? [] : completeOmittedNulls(out[key], property, root);
    else if (required.includes(key)) { if (admitsNull(property, root)) out[key] = null; else if (emptyListOnly(property, root)) out[key] = []; }
  }
  return out;
}
/** The body as it leaves openRouterGuardedFetch (what a paid-spend admission downstream sees): a checked C4 payload without
 * `store` and `parallel_tool_calls`, its tool not strict, with exactly the extras of one admitted OpenRouterOptions. */
export function assertOpenRouterOutboundBody(value: unknown, expectedModel: string): asserts value is Record<string, unknown> {
  if (!record(value)) fail("PAYLOAD_SHAPE");
  const { provider, reasoning, temperature, ...rest } = value;
  const options = { provider: record(provider) && Array.isArray(provider.order) && typeof provider.order[0] === "string" ? provider.order[0] : undefined,
    reasoning: record(reasoning) && typeof reasoning.effort === "string" ? reasoning.effort : "off" };
  let expected: ReturnType<typeof openRouterExtras>;
  try { expected = openRouterExtras(options); } catch { fail("OPENROUTER_EXTRAS"); }
  if (JSON.stringify({ provider, reasoning, temperature }) !== JSON.stringify(expected) || "store" in rest || "parallel_tool_calls" in rest) fail("OPENROUTER_EXTRAS");
  const tools = Array.isArray(rest.tools) ? rest.tools : [];
  if (!tools.every(tool => record(tool) && record(tool.function) && tool.function.strict === false)) fail("OPENROUTER_EXTRAS");
  assertSecretaryChatPayload({ ...rest, tools: tools.map(tool => ({ ...tool, function: { ...tool.function, strict: true } })), parallel_tool_calls: false }, expectedModel);
}
