import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPaidModel, modelCallUsage, runServicesTurn, type Model } from "@everflair/salon-secretary";
import { DurableJournal, readDurable } from "../../../packages/salon-secretary/evaluation/hard-conversations-durable";
import { classifyPostHttpFailure, inspectPostHttpResponse, safeExceptionClass, ultimate10CliExitCode,
  witnessSdkResponse, type PostHttpStage, type SafePostHttpMetadata } from
  "../../../packages/salon-secretary/evaluation/ultimate-10-post-http";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const validSelection = { skills: [], independent: true, operations: [] };
// Synthetic current-wire transport. The historical minimal result oracle stays separate.
const wireSelection={...validSelection,disposition:null,conversation_response:null,unavailable_capability:null};
const functionCall = (args: string = JSON.stringify(wireSelection)) => ({
  id: "fc_synthetic", call_id: "call_synthetic", type: "function_call", name: "select_capabilities",
  arguments: args, status: "completed" });
const response = (overrides: Record<string, unknown> = {}) => ({ id: "resp_synthetic", object: "response",
  created_at: 0, status: "completed", model: "gpt-6-luna", output: [functionCall()],
  usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, ...overrides });
const fakeResponse = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body),
  { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_offline1234" } });

async function caseRun(body: unknown) {
  const observations: PostHttpStage[] = [];
  let meta: SafePostHttpMetadata | null = null, calls = 0, adapterError: unknown = null;
  vi.stubGlobal("fetch", async () => {
    calls++;
    const result = fakeResponse(body);
    observations.push("HTTP_RESPONSE_RECEIVED");
    meta = await inspectPostHttpResponse(result);
    if (meta.json_state === "OBJECT" || meta.json_state === "OTHER") observations.push("HTTP_BODY_PARSED");
    return result;
  });
  const model = witnessSdkResponse(await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true",
    SALON_SECRETARY_OPENAI_API_KEY: "synthetic-offline-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_offline",
    SALON_SECRETARY_MODEL: "gpt-6-luna" }), stage => observations.push(stage));
  const wrapped: Model = { ...model, getResponse: async request => {
    try {
      const result = await model.getResponse(request);
      observations.push("AGENT_MODEL_RESPONSE_CREATED");
      return result;
    } catch (error) { adapterError = error; throw error; }
  } };
  let result: unknown = null, error: unknown = null;
  try { result = await runServicesTurn(wrapped, "pedido sintético", {}, {}, "discovery"); }
  catch (caught) { error = caught; }
  const rawResult=result;
  if(!error){
    // Exact assertion before canonical projection, so extra keys cannot be hidden.
    expect(rawResult).toEqual(wireSelection);
    const {disposition,conversation_response,unavailable_capability,...canonical}=rawResult as typeof wireSelection;
    void disposition;void conversation_response;void unavailable_capability;result=canonical;
  }
  return { observations, meta: meta!, calls, adapterError, error, result, rawResult };
}

describe("Ultimate 10 post-HTTP stages, offline SDK and adapter", () => {
  it('rejects the unchanged partial legacy selection through live SDK',async()=>{
    const before=JSON.stringify(validSelection),run=await caseRun(response({output:[functionCall(before)]}));
    expect(run.calls).toBe(1);expect(run.error).not.toBeNull();expect(run.rawResult).toBeNull();expect(JSON.stringify(validSelection)).toBe(before);
  });
  it("preserves a valid HTTP 200 function call and its raw usage", async () => {
    const run = await caseRun(response());
    expect(run.calls).toBe(1); expect(run.error).toBeNull();
    expect(run.result).toEqual(validSelection);
    expect(run.observations).toEqual(["HTTP_RESPONSE_RECEIVED", "HTTP_BODY_PARSED", "SDK_RESPONSE_CREATED",
      "AGENT_MODEL_RESPONSE_CREATED"]);
    expect(run.meta).toMatchObject({ body_presence: "PRESENT", json_state: "OBJECT", response_id: "resp_synthetic",
      model: "gpt-6-luna", output_item_count: 1, output_item_types: ["function_call"],
      usage_presence: true, selection_schema_valid: true });
  });

  it.each([
    { label: "empty body", body: "", category: "HTTP_SUCCESS_INVALID_BODY", stage: "HTTP_RESPONSE_RECEIVED" },
    { label: "invalid JSON", body: "{invalid", category: "SDK_PARSE_ERROR", stage: "HTTP_RESPONSE_RECEIVED" },
    { label: "missing output", body: response({ output: undefined }), category: "MODEL_OUTPUT_INVALID", stage: "HTTP_BODY_PARSED" },
    { label: "incomplete", body: response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
      category: "RESPONSE_INCOMPLETE", stage: "SDK_RESPONSE_CREATED" },
    { label: "reasoning only", body: response({ output: [{ id: "rs_1", type: "reasoning", summary: [] }] }),
      category: "MODEL_OUTPUT_INVALID", stage: "AGENT_MODEL_RESPONSE_CREATED" },
    { label: "invalid function arguments", body: response({ output: [functionCall("{not-json")] }),
      category: "TOOL_CALL_SCHEMA_ERROR", stage: "AGENT_MODEL_RESPONSE_CREATED" },
    { label: "schema invalid", body: response({ output: [functionCall(JSON.stringify({ skills: [], operations: [] }))] }),
      category: "TOOL_CALL_SCHEMA_ERROR", stage: "AGENT_MODEL_RESPONSE_CREATED" },
    { label: "unexpected function name", body: response({ output: [{ ...functionCall(), name: "other_function" }] }),
      category: "MODEL_OUTPUT_INVALID", stage: "AGENT_MODEL_RESPONSE_CREATED" },
    { label: "multiple output items", body: response({ output: [functionCall(),
      { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [] }] }),
      category: "MODEL_OUTPUT_INVALID", stage: "AGENT_MODEL_RESPONSE_CREATED" },
    { label: "unknown output type", body: response({ output: [{ id: "other", type: "new_future_output", private: "Alisson" }] }),
      category: "MODEL_OUTPUT_INVALID", stage: "AGENT_MODEL_RESPONSE_CREATED" },
  ] as const)("diagnoses $label without network or retry", async ({ body, category, stage }) => {
    const run = await caseRun(body);
    expect(run.calls).toBe(1); expect(run.error).not.toBeNull();
    expect(run.observations.at(-1)).toBe(stage);
    expect(classifyPostHttpFailure(run.meta, run.observations.at(-1)!, run.adapterError ?? run.error)).toBe(category);
    expect(JSON.stringify(run.meta)).not.toContain("Alisson");
    expect(JSON.stringify(run.meta)).not.toContain("{not-json");
  });

  it("missing usage does not destroy a valid interpretation or invent counters", async () => {
    const run = await caseRun(response({ usage: undefined }));
    expect(run.calls).toBe(1); expect(run.error).toBeNull();
    expect(run.meta.usage_presence).toBe(false);
    expect(run.result).toEqual(validSelection);
    const model = { providerData: { model: "gpt-6-luna" }, output: [] } as never;
    expect(modelCallUsage("gpt-6-luna", "SUCCEEDED", model)).toMatchObject({ usage_status: "UNAVAILABLE",
      input_tokens: null, output_tokens: null });
  });

  it("separates adapter, usage and local instrumentation errors by stage, without persisting exception text", async () => {
    const meta = await inspectPostHttpResponse(fakeResponse(response()));
    expect(classifyPostHttpFailure(meta, "SDK_RESPONSE_CREATED", Error("private"))).toBe("AGENT_ADAPTER_ERROR");
    expect(classifyPostHttpFailure(meta, "AGENT_MODEL_RESPONSE_CREATED", Error("private"), "USAGE")).toBe("USAGE_PARSE_ERROR");
    expect(classifyPostHttpFailure(meta, "HTTP_BODY_PARSED", Error("private"), "OBSERVATION")).toBe("LOCAL_INSTRUMENTATION_ERROR");
    expect(safeExceptionClass(Object.assign(Error("Alisson sk-proj-secret"), { name: "Alisson" }))).toBe("[UNKNOWN_EXCEPTION_CLASS]");
  });

  it("keeps oversized bodies unclassified instead of calling them malformed JSON", async () => {
    const meta = await inspectPostHttpResponse(fakeResponse("x".repeat(1_048_577)));
    expect(meta).toMatchObject({ body_presence: "PRESENT", json_state: "UNREADABLE",
      body_byte_length: 1_048_577 });
    expect(classifyPostHttpFailure(meta, "HTTP_RESPONSE_RECEIVED", Error("private"))).toBe("UNKNOWN_POST_HTTP_ERROR");
  });

  it("fsyncs sanitized stages; restart reads exact stage and never stores free text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ultimate-post-http-")), file = join(dir, "journal.jsonl");
    const scope = { ids: ["u01"], maxRequests: 1, allowNetworkInconclusive: false, turnCounts: { u01: 1 } };
    try {
      const journal = new DurableJournal(file, "a".repeat(64), [], scope);
      journal.append("STARTED", "u01", null);
      journal.append("TURN_STARTED", "u01", 1);
      journal.append("BEFORE_NETWORK", "u01", 1, { store: false });
      const meta = await inspectPostHttpResponse(fakeResponse({ ...response(), private: "Alisson secret" }));
      journal.append("OBSERVATION_EVENT", "u01", 1, { stage: "HTTP_RESPONSE_RECEIVED" });
      journal.append("OBSERVATION_EVENT", "u01", 1, { stage: "POST_HTTP_WITNESS", metadata: meta });
      journal.append("OBSERVATION_EVENT", "u01", 1, { stage: "HTTP_BODY_PARSED" });
      journal.close();
      const serialized = readFileSync(file, "utf8");
      expect(serialized).not.toContain("Alisson");
      expect(readDurable(file, "a".repeat(64)).filter(row => row.kind === "OBSERVATION_EVENT")).toHaveLength(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("CLI maps completed to zero and stopped to nonzero", () => {
    expect(ultimate10CliExitCode("COMPLETED")).toBe(0);
    expect(ultimate10CliExitCode("STOPPED")).toBe(1);
  });
});
