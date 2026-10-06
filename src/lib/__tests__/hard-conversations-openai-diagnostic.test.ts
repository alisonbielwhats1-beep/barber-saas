import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import type { Model, ModelRequest, ModelResponse } from "../../../packages/salon-secretary/src";
import { instrumentServicesModel } from "../../../packages/salon-secretary/src/usage";
import { PhaseAOpenAIErrorObserver, observeModelGetResponse } from
  "../../../packages/salon-secretary/evaluation/hard-conversations-openai-diagnostic";
import { PhaseAWireWitness } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-witness";

async function sdkFailure(status: number, body: unknown, headerId = "req_local1234") {
  const observer = new PhaseAOpenAIErrorObserver();
  observer.expectTurn("i01", 1);
  let calls = 0;
  const client = new OpenAI({ apiKey: "sk-local-test-only", maxRetries: 0,
    fetch: async () => {
      calls++;
      const response = new Response(typeof body === "string" ? body : JSON.stringify(body),
        { status, headers: { "content-type": "application/json", "x-request-id": headerId,
          Authorization: "Bearer sk-proj-never-record-this", "retry-after": "2" } });
      observer.observeHttp(response, 3.25);
      return response;
    } });
  try { await client.responses.create({ model: "gpt-6-luna", input: "synthetic-only", store: false }); }
  catch (error) { return { diagnostic: observer.observeModelFailure(error, 8), calls }; }
  throw Error("FAKE_PROVIDER_SHOULD_FAIL");
}

describe("Phase A OpenAI error observation, offline fake transport", () => {
  it.each([
    [400, "HTTP_4XX", "invalid_request_error", "invalid_value"],
    [401, "AUTH", "authentication_error", "invalid_api_key"],
    [403, "MODEL_ACCESS", "permission_error", "model_access_denied"],
    [429, "RATE_LIMIT", "rate_limit_error", "rate_limit_exceeded"],
    [500, "HTTP_5XX", "server_error", "internal_error"],
  ] as const)("classifies HTTP %i using only status and machine fields", async (status, category, type, code) => {
    const { diagnostic, calls } = await sdkFailure(status, { error: {
      type, code, param: "model", message: "Alisson user@example.com sk-proj-never-record-this postgres://secret" } });
    expect(calls).toBe(1);
    expect(diagnostic).toMatchObject({ category, http_status: status, request_id: "req_local1234",
      error: { type, code, param: "model", message_redacted: true },
      safe_headers: { x_request_id: "req_local1234", retry_after_seconds: 2 } });
    const serialized = JSON.stringify(diagnostic);
    for (const secret of ["Alisson", "user@example.com", "sk-proj-never-record-this", "postgres://secret", "Bearer"])
      expect(serialized).not.toContain(secret);
  });

  it("does not assume any HTTP 403 means model access", async () => {
    const { diagnostic } = await sdkFailure(403, { error: {
      type: "permission_error", code: "project_forbidden", message: "Not allowed" } });
    expect(diagnostic?.category).toBe("HTTP_4XX");
  });

  it.each([
    ["TimeoutError", "TIMEOUT"], ["AbortError", "ABORT"], ["TypeError", "NETWORK"],
  ] as const)("classifies %s without inventing an HTTP response", async (name, category) => {
    const observer = new PhaseAOpenAIErrorObserver(); observer.expectTurn("i01", 1);
    const transport = Object.assign(new Error("sk-proj-hidden user@example.com"), { name,
      cause: Object.assign(new Error("private"), { code: "ECONNRESET" }) });
    const client = new OpenAI({ apiKey: "sk-local-test-only", maxRetries: 0,
      fetch: async () => { observer.observeTransport(transport, 2.5); throw transport; } });
    let diagnostic = null;
    try { await client.responses.create({ model: "gpt-6-luna", input: "synthetic-only", store: false }); }
    catch (error) { diagnostic = observer.observeModelFailure(error, 5); }
    expect(diagnostic).toMatchObject({ category, http_status: null });
    expect(JSON.stringify(diagnostic)).not.toContain("user@example.com");
  });

  it("marks HTTP 200 with invalid JSON as invalid provider response", async () => {
    const { diagnostic } = await sdkFailure(200, "{malformed-json");
    expect(diagnostic).toMatchObject({ category: "INVALID_PROVIDER_RESPONSE", http_status: 200,
      request_id: "req_local1234" });
  });

  it("classifies an SDK exception without HTTP and redacts arbitrary content", () => {
    const observer = new PhaseAOpenAIErrorObserver(); observer.expectTurn("i01", 1);
    const diagnostic = observer.observeModelFailure(Object.assign(new Error("Alisson sk-proj-secret"),
      { name: "OpenAIError" }), 4);
    expect(diagnostic).toMatchObject({ category: "SDK_ERROR", http_status: null,
      error: { message_redacted: true } });
    expect(JSON.stringify(diagnostic)).not.toContain("Alisson");
  });

  it("does not persist an unknown code or type carrying a secret", () => {
    const observer = new PhaseAOpenAIErrorObserver(); observer.expectTurn("i01", 1);
    const diagnostic = observer.observeModelFailure({ status: 400, code: "sk-proj-private-secret",
      type: "Alisson", param: "customer_phone", message: "private body" }, 4);
    expect(diagnostic?.error).toMatchObject({ code: null, type: null, param: null,
      message_redacted: true });
    expect(JSON.stringify(diagnostic)).not.toMatch(/sk-proj|Alisson|customer_phone|private body/);
  });

  it("preserves the same public MODEL_REQUEST_FAILED and successful response object", async () => {
    const observer = new PhaseAOpenAIErrorObserver(); observer.expectTurn("i01", 1);
    const original = Object.assign(new Error("private provider body"), { status: 500,
      headers: new Headers({ "x-request-id": "req_failure1234" }) });
    const failing = { getResponse: async () => { throw original; } } as unknown as Model;
    const events: string[] = [];
    const wrapped = instrumentServicesModel({ getResponse: (request: ModelRequest) =>
      observeModelGetResponse(failing, request, observer) } as Model, "gpt-6-luna",
    async event => { events.push(event.status); });
    await expect(wrapped.getResponse({} as ModelRequest)).rejects.toThrow("MODEL_REQUEST_FAILED");
    expect(events).toEqual(["STARTED", "FAILED"]);
    expect(observer.records).toHaveLength(1);
    const response = { output: [], responseId: "resp_synthetic" } as unknown as ModelResponse;
    const successful = { getResponse: async () => response } as unknown as Model;
    expect(await observeModelGetResponse(successful, {} as ModelRequest, observer)).toBe(response);
    expect(observer.records).toHaveLength(1);
  });

  it("caps the separately authorized i01 revalidation at one serialized request", () => {
    const witness = new PhaseAWireWitness("REVALIDATE_I01");
    const body = JSON.stringify({ model: "gpt-6-luna", instructions: "synthetic", input: [
      { role: "user", content: "Agenda o Alisson pra amanhã." }], tools: [
      { type: "function", name: "select_capabilities", parameters: {} }],
      tool_choice: { type: "function", name: "select_capabilities" }, parallel_tool_calls: false,
      max_output_tokens: 1200, store: false, stream: false, include: [] });
    const request = { url: "https://api.openai.com/v1/responses", method: "POST", body };
    witness.expectTurn("i01", 1, "select_capabilities", []); witness.beforeNetwork(request); witness.clearTurn();
    witness.expectTurn("i01", 2, "select_capabilities", []);
    expect(() => witness.beforeNetwork(request)).toThrow("BUDGET_EXCEEDED");
    expect(witness.budget.calls).toBe(1);
    expect(witness.budget.reservedUsd).toBe(.0086);
  });
});
