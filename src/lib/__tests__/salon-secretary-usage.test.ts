import { describe, expect, it, vi } from "vitest";
import { instrumentServicesModel, modelCallUsage, billableTokenBasis, runServicesTurn, Usage, type ModelCallUsage } from "@everflair/salon-secretary";
import { ScriptedServicesModel, call, final } from "../../test/scripted-services-model";
import { getOperationRequirements } from "../service-contract";

const output = call("upsert_action_draft", { name: "Massagem", priceCents: 5000, durationMin: null });
const raw = { input_tokens: 400, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 },
  output_tokens: 80, output_tokens_details: { reasoning_tokens: 30 }, total_tokens: 480 };
describe("safe per-call usage", () => {
  it("captures every counter and emits before dispatch and before tool consumption", async () => {
    const events: ModelCallUsage[] = []; const base = new ScriptedServicesModel([output], raw);
    const measured = instrumentServicesModel(base, "fake-services", async e => {
      if(e.status!=='STARTED')expect(events.map(e => e.status)).toEqual(["STARTED"]);
      expect(base.requests).toHaveLength(e.status==='STARTED'?0:1);events.push(e);
    });
    await runServicesTurn(measured, "Massagem R$50", undefined, getOperationRequirements());
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ usage_status: "UNKNOWN", requests: null, input_tokens: null });
    expect(events[1]).toMatchObject({ status: "SUCCEEDED", usage_status: "AVAILABLE", model_id_requested: "fake-services",
      model_id_returned: "fake-services", requests: 1, input_tokens: 400, cached_input_tokens: 100, cache_write_tokens: 50,
      output_tokens: 80, reasoning_tokens: 30, total_tokens: 480, request_id: "req_fake_1", response_id: "resp_fake_1" });
    expect(billableTokenBasis(events[1])).toEqual({ input_tokens: 400, cached_input_tokens: 100, cache_write_tokens: 50, output_tokens: 80 });
    // Never 110: reasoning's 30 tokens are already included in output's 80 tokens.
  });
  it("does not fabricate zero or totals from absent provider fields even if SDK defaults are zero", () => {
    const absent = modelCallUsage("fake", "SUCCEEDED", { usage: new Usage(), output: [] });
    expect(absent).toMatchObject({ usage_status: "UNAVAILABLE", input_tokens: null, output_tokens: null, total_tokens: null,
      cached_input_tokens: null, cache_write_tokens: null, reasoning_tokens: null });
    expect(billableTokenBasis(absent).output_tokens).toBeNull();
    const partial = modelCallUsage("fake", "SUCCEEDED", { usage: new Usage(), output: [], rawUsage: { input_tokens: 0 } });
    expect(partial).toMatchObject({ usage_status: "PARTIAL", input_tokens: 0, output_tokens: null, total_tokens: null });
  });
  it.each(["TimeoutError", "AbortError", "APIError"])("records %s without usage as UNKNOWN without logging bodies", async name => {
    const error = Object.assign(new Error("sk-sensitive prompt phone 11999999999"), { name, request_id: "req_failed" });
    const base = new ScriptedServicesModel([],undefined,{name:error.name,message:error.message,request_id:error.request_id}); const events: ModelCallUsage[] = [];
    const measured = instrumentServicesModel(base, "fake", async e => { events.push(e); });
    await expect(runServicesTurn(measured, "Massagem", undefined, getOperationRequirements())).rejects.toThrow("MODEL_REQUEST_FAILED");
    expect(events[1]).toMatchObject({ status: name === "TimeoutError" ? "TIMEOUT" : name === "AbortError" ? "ABORTED" : "FAILED",
      usage_status: "UNKNOWN", requests: 1, input_tokens: null, output_tokens: null, total_tokens: null, request_id: "req_failed" });
    expect(JSON.stringify(events)).not.toMatch(/sk-sensitive|11999999999|prompt/);
  });
  it("retains usage if interpretation validation fails after provider succeeds", async () => {
    const events: ModelCallUsage[] = [];
    const model = instrumentServicesModel(new ScriptedServicesModel([final("wrong")], raw), "fake", async e => { events.push(e); });
    await expect(runServicesTurn(model, "Massagem", undefined, getOperationRequirements())).rejects.toThrow("INTERPRETATION_INVALID");
    expect(events[1]).toMatchObject({ usage_status: "AVAILABLE", output_tokens: 80 });
  });
  it("fails closed when telemetry cannot persist before dispatch or after response", async () => {
    const before = new ScriptedServicesModel([output], raw);
    await expect(runServicesTurn(instrumentServicesModel(before, "fake", async () => { throw new Error("AUDIT_DOWN"); }), "Massagem", undefined, {})).rejects.toThrow("AUDIT_DOWN");
    expect(before.requests).toHaveLength(0);
    const after = new ScriptedServicesModel([output], raw);
    const record = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("AUDIT_DOWN"));
    await expect(runServicesTurn(instrumentServicesModel(after, "fake", record), "Massagem", undefined, {})).rejects.toThrow("AUDIT_DOWN");
    expect(after.requests).toHaveLength(1); expect(record).toHaveBeenCalledTimes(2);
  });
  it("allowlists counters and removes content, secrets and unsafe identifiers", () => {
    const event = modelCallUsage("fake", "SUCCEEDED", { usage: new Usage(), output: [],
      rawUsage: { ...raw, prompt: "secret", phone: "11999999999" }, requestId: "sk-key",
      providerData: { model: "fake", apiKey: "secret", messages: ["secret"] } });
    expect(event.request_id).toBeNull(); expect(JSON.stringify(event)).not.toMatch(/secret|11999999999|apiKey|prompt|messages/);
  });
});
