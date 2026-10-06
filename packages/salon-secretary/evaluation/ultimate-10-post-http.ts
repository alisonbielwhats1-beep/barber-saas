/** Evaluation-only post-HTTP evidence. Never persists a response body or free text. */
import type { Model } from "@openai/agents";
import { validateSelection } from "../src/skill-registry";

export type PostHttpStage = "HTTP_RESPONSE_RECEIVED" | "HTTP_BODY_PARSED" | "SDK_RESPONSE_CREATED" |
  "AGENT_MODEL_RESPONSE_CREATED" | "TOOL_CALL_VALIDATED" | "MODEL_RESULT_READY";
export type PostHttpCategory = "HTTP_SUCCESS_INVALID_BODY" | "SDK_PARSE_ERROR" | "MODEL_OUTPUT_INVALID" |
  "AGENT_ADAPTER_ERROR" | "TOOL_CALL_SCHEMA_ERROR" | "RESPONSE_INCOMPLETE" | "USAGE_PARSE_ERROR" |
  "LOCAL_INSTRUMENTATION_ERROR" | "UNKNOWN_POST_HTTP_ERROR";
export type SafePostHttpMetadata = {
  http_status: number; request_id: string | null; content_type: "application/json" | "application/*+json" | "other" | "missing";
  body_presence: "PRESENT" | "EMPTY" | "UNREADABLE"; body_byte_length: number | null;
  json_state: "OBJECT" | "OTHER" | "INVALID" | "EMPTY" | "UNREADABLE";
  top_level_keys: string[]; response_object_type: "object" | "array" | "string" | "number" | "boolean" | "null" | "unknown";
  response_id: string | null; model: "gpt-6-luna" | "other" | "missing";
  status: "completed" | "incomplete" | "failed" | "other" | "missing";
  incomplete_reason: "max_output_tokens" | "content_filter" | "other" | "missing";
  output_item_count: number | null; output_item_types: string[];
  usage_presence: boolean; function_call_count: number; function_names: string[];
  arguments_json_valid: boolean | null; selection_schema_valid: boolean | null;
};

const keys = new Set(["id", "object", "created_at", "status", "model", "output", "usage", "incomplete_details", "error", "parallel_tool_calls"]);
const outputTypes = new Set(["function_call", "reasoning", "message", "function_call_output", "web_search_call",
  "file_search_call", "code_interpreter_call", "computer_call", "image_generation_call", "tool_search_call",
  "tool_search_output", "program", "program_output"]);
const requestId = (value: unknown) => typeof value === "string" && /^req_[A-Za-z0-9_-]{4,120}$/.test(value) ? value : null;
const responseId = (value: unknown) => typeof value === "string" && /^resp_[A-Za-z0-9_-]{1,120}$/.test(value) ? value : null;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const responseType = (value: unknown): SafePostHttpMetadata["response_object_type"] =>
  value === null ? "null" : Array.isArray(value) ? "array" :
    ["object", "string", "number", "boolean"].includes(typeof value) ? typeof value as SafePostHttpMetadata["response_object_type"] : "unknown";
const safeType = (value: unknown) => typeof value === "string" && outputTypes.has(value) ? value : "[UNKNOWN_OUTPUT_TYPE]";
const safeName = (value: unknown) => value === "select_capabilities" || value === "upsert_action_draft" ? value : "[UNEXPECTED_FUNCTION]";
const safeStatus = (value: unknown): SafePostHttpMetadata["status"] =>
  value === "completed" || value === "incomplete" || value === "failed" ? value : value === undefined ? "missing" : "other";
const safeReason = (value: unknown): SafePostHttpMetadata["incomplete_reason"] =>
  value === "max_output_tokens" || value === "content_filter" ? value : value === undefined ? "missing" : "other";

function summarize(parsed: unknown, base: SafePostHttpMetadata): SafePostHttpMetadata {
  const data = object(parsed), output = Array.isArray(data.output) ? data.output : null;
  const functions = output?.filter(item => object(item).type === "function_call") ?? [];
  let argumentsJsonValid: boolean | null = null, selectionSchemaValid: boolean | null = null;
  if (functions.length === 1) {
    const item = object(functions[0]);
    if (typeof item.arguments === "string") {
      try {
        const argumentsValue = JSON.parse(item.arguments);
        argumentsJsonValid = true;
        if (item.name === "select_capabilities") {
          try { validateSelection(argumentsValue); selectionSchemaValid = true; }
          catch { selectionSchemaValid = false; }
        }
      } catch { argumentsJsonValid = false; }
    } else argumentsJsonValid = false;
  }
  return { ...base, json_state: responseType(parsed) === "object" ? "OBJECT" : "OTHER",
    top_level_keys: Object.keys(data).filter(key => keys.has(key)).sort(), response_object_type: responseType(parsed),
    response_id: responseId(data.id), model: data.model === "gpt-6-luna" ? "gpt-6-luna" : data.model === undefined ? "missing" : "other",
    status: safeStatus(data.status), incomplete_reason: safeReason(object(data.incomplete_details).reason),
    output_item_count: output?.length ?? null, output_item_types: output?.map(item => safeType(object(item).type)) ?? [],
    usage_presence: data.usage !== undefined && data.usage !== null,
    function_call_count: functions.length, function_names: functions.map(item => safeName(object(item).name)),
    arguments_json_valid: argumentsJsonValid, selection_schema_valid: selectionSchemaValid };
}

/** Reads only a clone. Any inspection failure is evidence, not a replacement response. */
export async function inspectPostHttpResponse(response: Response): Promise<SafePostHttpMetadata> {
  const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const base: SafePostHttpMetadata = { http_status: response.status, request_id: requestId(response.headers.get("x-request-id")),
    content_type: mediaType === "application/json" ? "application/json" : mediaType?.startsWith("application/") &&
      mediaType.endsWith("+json") ? "application/*+json" : mediaType ? "other" : "missing",
    body_presence: "UNREADABLE", body_byte_length: null, json_state: "UNREADABLE", top_level_keys: [],
    response_object_type: "unknown", response_id: null, model: "missing", status: "missing", incomplete_reason: "missing",
    output_item_count: null, output_item_types: [], usage_presence: false, function_call_count: 0,
    function_names: [], arguments_json_valid: null, selection_schema_valid: null };
  let body: string;
  try { body = await response.clone().text(); }
  catch { return base; }
  const byteLength = Buffer.byteLength(body, "utf8");
  const read = { ...base, body_presence: body.length ? "PRESENT" as const : "EMPTY" as const,
    body_byte_length: byteLength, json_state: body.length ? "INVALID" as const : "EMPTY" as const };
  if (!body.length) return read;
  if (byteLength > 1_048_576) return { ...read, json_state: "UNREADABLE" };
  try { return summarize(JSON.parse(body), read); }
  catch { return read; }
}

/** One evaluated Model instance, no SDK/runtime monkey-patch outside the isolated run. */
export function witnessSdkResponse(model: Model, reached: (stage: PostHttpStage) => void): Model {
  type Internals = Model & { _fetchResponse?: (...args: unknown[]) => Promise<unknown> };
  const internal = model as Internals;
  if (typeof internal._fetchResponse !== "function") throw Error("ULTIMATE10_SDK_STAGE_UNAVAILABLE");
  const original = internal._fetchResponse;
  internal._fetchResponse = async function (...args: unknown[]) {
    const response = await original.apply(this, args);
    reached("SDK_RESPONSE_CREATED");
    return response;
  };
  return model;
}

const exceptionNames = new Set(["SyntaxError", "TypeError", "ModelBehaviorError", "UserError", "ZodError",
  "APIResponseValidationError", "Error", "AbortError", "TimeoutError"]);
export function safeExceptionClass(error: unknown): string {
  const name = object(error).name;
  return typeof name === "string" && exceptionNames.has(name) ? name : "[UNKNOWN_EXCEPTION_CLASS]";
}

/** Classification uses stage and sanitized shape; it never infers the missing historical u01 body. */
export function classifyPostHttpFailure(meta: SafePostHttpMetadata | null, stage: PostHttpStage | null,
  error: unknown, context: "MODEL" | "USAGE" | "OBSERVATION" = "MODEL"): PostHttpCategory {
  if (context === "USAGE") return "USAGE_PARSE_ERROR";
  if (context === "OBSERVATION") return "LOCAL_INSTRUMENTATION_ERROR";
  if (!meta || meta.http_status < 200 || meta.http_status >= 300) return "UNKNOWN_POST_HTTP_ERROR";
  if (meta.body_presence === "EMPTY" || meta.json_state === "OTHER" ||
    meta.content_type !== "application/json" && meta.content_type !== "application/*+json")
    return "HTTP_SUCCESS_INVALID_BODY";
  if (meta.json_state === "INVALID") return "SDK_PARSE_ERROR";
  if (meta.json_state === "UNREADABLE") return "UNKNOWN_POST_HTTP_ERROR";
  if (meta.status === "incomplete" || meta.status === "failed") return "RESPONSE_INCOMPLETE";
  if (meta.output_item_count === null || meta.output_item_count === 0 ||
    meta.output_item_types.some(type => type === "[UNKNOWN_OUTPUT_TYPE]")) return "MODEL_OUTPUT_INVALID";
  if (meta.output_item_types.filter(type => type !== "reasoning").length !== 1) return "MODEL_OUTPUT_INVALID";
  if (meta.arguments_json_valid === false || meta.selection_schema_valid === false) return "TOOL_CALL_SCHEMA_ERROR";
  if (meta.function_call_count !== 1 || meta.function_names[0] !== "select_capabilities" &&
    meta.function_names[0] !== "upsert_action_draft") return "MODEL_OUTPUT_INVALID";
  if (stage === "SDK_RESPONSE_CREATED" || stage === "HTTP_BODY_PARSED") return "AGENT_ADAPTER_ERROR";
  if (safeExceptionClass(error) === "APIResponseValidationError") return "SDK_PARSE_ERROR";
  return "UNKNOWN_POST_HTTP_ERROR";
}

export function ultimate10CliExitCode(status: "COMPLETED" | "STOPPED"): number {
  return status === "COMPLETED" ? 0 : 1;
}
