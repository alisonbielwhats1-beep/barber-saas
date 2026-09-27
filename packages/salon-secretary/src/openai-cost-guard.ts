import type { ModelRequest } from "@openai/agents";

const FUNCTION_NAMES = ["select_capabilities", "upsert_action_draft"] as const;
const MODELS = ["gpt-5.6-luna", "gpt-6-luna"] as const;
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

/** HTTP boundary: SDK upgrades and extra_body cannot silently add a hosted capability. */
export function assertSecretaryResponsesPayload(value: unknown, expectedModel: string): void {
  assertSecretaryModelId(expectedModel);
  if (!record(value)) fail("PAYLOAD_SHAPE");
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

export function secretaryGuardedFetch(modelId: string): typeof fetch {
  assertSecretaryModelId(modelId);
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : undefined);
    if (url !== "https://api.openai.com/v1/responses" || method?.toUpperCase() !== "POST") fail();
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof body !== "string") fail();
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { fail(); }
    assertSecretaryResponsesPayload(payload, modelId);
    return globalThis.fetch(input, init);
  };
}
