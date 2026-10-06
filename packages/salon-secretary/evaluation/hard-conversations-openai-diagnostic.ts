/** Evaluation-only, allowlisted observations of a failed OpenAI Responses call. */
import { performance } from "node:perf_hooks";
import type { Model, ModelRequest, ModelResponse } from "@openai/agents";

export type OpenAIFailureCategory = "HTTP_4XX" | "HTTP_5XX" | "RATE_LIMIT" | "MODEL_ACCESS" |
  "AUTH" | "TIMEOUT" | "ABORT" | "NETWORK" | "INVALID_PROVIDER_RESPONSE" |
  "SDK_ERROR" | "UNKNOWN_PROVIDER_ERROR";
type SafeHeaders = { x_request_id: string | null; retry_after_seconds: number | null;
  openai_processing_ms: number | null };
type HttpEvidence = { status: number; headers: SafeHeaders; latency_ms: number };
type TransportEvidence = { name: string | null; code: string | null; latency_ms: number };
export type SanitizedOpenAIFailure = {
  case_id: string; turn_index: number; provider: "OpenAI"; model: "gpt-6-luna";
  endpoint_class: "POST /v1/responses"; category: OpenAIFailureCategory;
  http_status: number | null; request_id: string | null;
  error: { type: string | null; code: string | null; param: string | null;
    message_sanitized: string; message_redacted: boolean };
  safe_headers: SafeHeaders; transport_category: "NONE" | "TIMEOUT" | "ABORT" | "NETWORK" | "UNKNOWN";
  transport_code: string | null; timeout: boolean; abort: boolean;
  latency_ms: { model: number; fetch: number | null }; evidence_conflict: boolean;
};

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const property = (value: unknown, name: string): unknown => {
  try { return object(value)[name]; } catch { return undefined; }
};
const safeTypes = new Set(["invalid_request_error", "authentication_error", "permission_error",
  "rate_limit_error", "server_error", "api_error"]);
const safeCodes = new Set(["invalid_value", "invalid_api_key", "model_not_found", "model_access_denied",
  "model_not_available", "rate_limit_exceeded", "internal_error", "insufficient_quota",
  "project_forbidden"]);
const safeMachine = (value: unknown, allowed: ReadonlySet<string>): string | null =>
  typeof value === "string" && allowed.has(value) ? value : null;
const safeParam = (value: unknown): string | null =>
  typeof value === "string" && /^(?:model|input|instructions|tools(?:\[\d{1,2}\])?(?:\.[a-z_]+)?|tool_choice|max_output_tokens|store|stream|parallel_tool_calls|include)$/.test(value)
    ? value : null;
const safeRequestId = (value: unknown): string | null =>
  typeof value === "string" && /^req_[A-Za-z0-9_-]{4,120}$/.test(value) ? value : null;
const safeStatus = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const elapsed = (value: number): number => Number.isFinite(value) && value >= 0 ? Number(value.toFixed(3)) : 0;
const knownTransportCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
  "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
const transportCode = (error: unknown): string | null => {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    const code = property(current, "code");
    if (typeof code === "string" && knownTransportCodes.has(code)) return code;
    current = property(current, "cause");
    if (!current) break;
  }
  return null;
};
const errorName = (error: unknown): string | null => {
  const name = property(error, "name");
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : null;
};
const numericHeader = (headers: Headers, key: string): number | null => {
  const value = headers.get(key);
  if (value === null || !/^\d{1,8}(?:\.\d{1,3})?$/.test(value)) return null;
  return Number(value);
};
function safeHeaders(value: unknown): SafeHeaders {
  if (!(value instanceof Headers)) return { x_request_id: null, retry_after_seconds: null, openai_processing_ms: null };
  return { x_request_id: safeRequestId(value.get("x-request-id")),
    retry_after_seconds: numericHeader(value, "retry-after"),
    openai_processing_ms: numericHeader(value, "openai-processing-ms") };
}

const harmlessMessages = new Set(["Connection error.", "fetch failed", "Request timed out.",
  "Request was aborted.", "Unexpected end of JSON input"]);
function sanitizedMessage(raw: unknown, category: OpenAIFailureCategory, status: number | null) {
  if (typeof raw === "string" && harmlessMessages.has(raw))
    return { message_sanitized: raw, message_redacted: false };
  return { message_sanitized: status === null ? `OpenAI ${category}` : `OpenAI HTTP ${status}: ${category}`,
    message_redacted: typeof raw === "string" && raw.length > 0 };
}
function categoryFor(status: number | null, code: string | null, name: string | null,
  transport: TransportEvidence | null, aborted: boolean, timedOut: boolean): OpenAIFailureCategory {
  if (status === 429) return "RATE_LIMIT";
  if (status === 401) return "AUTH";
  if (status !== null && status >= 400 && status < 500) {
    if (["model_not_found", "model_access_denied", "model_not_available"].includes(code ?? "")) return "MODEL_ACCESS";
    return "HTTP_4XX";
  }
  if (status !== null && status >= 500) return "HTTP_5XX";
  if (timedOut || name === "APIConnectionTimeoutError" || name === "TimeoutError" ||
    transport?.name === "TimeoutError") return "TIMEOUT";
  if (aborted || name === "APIUserAbortError" || name === "AbortError" ||
    transport?.name === "AbortError") return "ABORT";
  if (status !== null && status >= 200 && status < 300 &&
    (name === "SyntaxError" || name === "APIResponseValidationError")) return "INVALID_PROVIDER_RESPONSE";
  if (name === "APIConnectionError" || transport?.code || transport?.name === "TypeError") return "NETWORK";
  if (name?.startsWith("API") || name === "OpenAIError") return "SDK_ERROR";
  return "UNKNOWN_PROVIDER_ERROR";
}

/** Never stores an Error, Response, request/response body, or arbitrary header. */
export class PhaseAOpenAIErrorObserver {
  readonly records: SanitizedOpenAIFailure[] = [];
  private current: { case_id: string; turn_index: number; http: HttpEvidence | null;
    transport: TransportEvidence | null } | null = null;

  expectTurn(caseId: string, turnIndex: number) {
    if (this.current || !/^[iadtmxu]\d{2}$/.test(caseId) || !Number.isSafeInteger(turnIndex) || turnIndex < 1)
      throw Error("PROVIDER_DIAGNOSTIC_STATE");
    this.current = { case_id: caseId, turn_index: turnIndex, http: null, transport: null };
  }
  clearTurn() { this.current = null; }
  observeHttp(response: Response, latencyMs: number) {
    if (this.current) this.current.http = { status: response.status, headers: safeHeaders(response.headers),
      latency_ms: elapsed(latencyMs) };
  }
  observeTransport(error: unknown, latencyMs: number) {
    if (this.current) this.current.transport = { name: errorName(error), code: transportCode(error),
      latency_ms: elapsed(latencyMs) };
  }
  observeModelFailure(error: unknown, latencyMs: number, signal?: AbortSignal): SanitizedOpenAIFailure | null {
    const turn = this.current;
    if (!turn) return null;
    const detail = property(error, "error");
    const sdkStatus = safeStatus(property(error, "status"));
    const httpStatus = turn.http?.status ?? sdkStatus;
    const code = safeMachine(property(error, "code"), safeCodes) ?? safeMachine(property(detail, "code"), safeCodes);
    const name = errorName(error);
    const reasonName = errorName(signal?.reason);
    const aborted = signal?.aborted === true || reasonName === "AbortError";
    const timedOut = reasonName === "TimeoutError";
    const conflict = sdkStatus !== null && turn.http !== null && sdkStatus !== turn.http.status;
    const category = conflict ? "UNKNOWN_PROVIDER_ERROR" :
      categoryFor(httpStatus, code, name, turn.transport, aborted, timedOut);
    const headers = turn.http?.headers ?? safeHeaders(property(error, "headers"));
    const rawMessage = property(detail, "message") ?? property(error, "message");
    const diagnostic: SanitizedOpenAIFailure = {
      case_id: turn.case_id, turn_index: turn.turn_index, provider: "OpenAI", model: "gpt-6-luna",
      endpoint_class: "POST /v1/responses", category, http_status: httpStatus,
      request_id: safeRequestId(property(error, "requestID")) ??
        safeRequestId(property(error, "request_id")) ?? headers.x_request_id,
      error: { type: safeMachine(property(error, "type"), safeTypes) ??
          safeMachine(property(detail, "type"), safeTypes),
        code, param: safeParam(property(error, "param")) ?? safeParam(property(detail, "param")),
        ...sanitizedMessage(rawMessage, category, httpStatus) },
      safe_headers: headers,
      transport_category: category === "TIMEOUT" ? "TIMEOUT" : category === "ABORT" ? "ABORT" :
        category === "NETWORK" ? "NETWORK" : turn.transport ? "UNKNOWN" : "NONE",
      transport_code: turn.transport?.code ?? transportCode(error), timeout: category === "TIMEOUT",
      abort: category === "ABORT", latency_ms: { model: elapsed(latencyMs),
        fetch: turn.http?.latency_ms ?? turn.transport?.latency_ms ?? null },
      evidence_conflict: conflict,
    };
    this.records.push(diagnostic);
    return diagnostic;
  }
  lastFor(caseId: string, turnIndex: number) {
    return this.records.findLast(row => row.case_id === caseId && row.turn_index === turnIndex) ?? null;
  }
}

/** Capture before instrumentServicesModel replaces the error; rethrow the exact original object. */
export async function observeModelGetResponse(model: Model, request: ModelRequest,
  observer: PhaseAOpenAIErrorObserver): Promise<ModelResponse> {
  const started = performance.now();
  try { return await model.getResponse(request); }
  catch (error) {
    try { observer.observeModelFailure(error, performance.now() - started, request.signal); }
    catch { /* Observation must not change the model failure. */ }
    throw error;
  }
}
