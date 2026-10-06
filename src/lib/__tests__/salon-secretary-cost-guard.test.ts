import { expandedWire, operationWire } from '../../test/secretary-wire-schema';
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertSecretaryModelId, assertSecretaryModelRequest, assertSecretaryResponsesPayload,
  createPaidModel, paidModelConfig, runServicesTurn, secretaryGuardedFetch, type ModelRequest,
} from "@everflair/salon-secretary";
import realOutputs from "../../test/fixtures/secretary-real-outputs.json";

const model = "gpt-6-luna";
const functionTool = { type: "function", name: "select_capabilities", description: "local", parameters: { type: "object" }, strict: true };
const wire = () => ({ model, instructions: "synthetic", input: [{ role: "user", content: "synthetic" }],
  tools: [{ ...functionTool }], tool_choice: { type: "function", name: functionTool.name },
  parallel_tool_calls: false, max_output_tokens: 1200, store: false, stream: false, include: [] });
const sdk = () => ({ input: [], tools: [{ ...functionTool }], handoffs: [], outputType: "text",
  tracing: false, toolsExplicitlyProvided: true,
  modelSettings: { toolChoice: functionTool.name, parallelToolCalls: false, store: false } }) as unknown as ModelRequest;

describe("Secretary OpenAI cost boundary (offline)", () => {
  it("uses DeepSeek V4.1 Flash in the local template and preserves explicit Luna rollback", () => {
    const template = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(template.match(/^SALON_SECRETARY_MODEL=(.*)$/m)?.[1]?.trim()).toBe("deepseek/deepseek-v4.1-flash");
    expect(template.match(/^SALON_SECRETARY_ALLOW_PAID_CALLS=(.*)$/m)?.[1]?.trim()).toBe("false");
    expect(() => assertSecretaryModelId("gpt-5.6-luna")).not.toThrow();
    expect(() => assertSecretaryModelId(model)).not.toThrow();
    expect(() => assertSecretaryModelId("gpt-6-sol")).toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(paidModelConfig({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: model,
      SALON_SECRETARY_OPENAI_API_KEY: "synthetic", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic" }).modelId).toBe(model);
    expect(paidModelConfig({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: "gpt-5.6-luna",
      SALON_SECRETARY_OPENAI_API_KEY: "synthetic", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic" }).modelId).toBe("gpt-5.6-luna");
    expect(() => paidModelConfig({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: "unknown-model",
      SALON_SECRETARY_OPENAI_API_KEY: "synthetic", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic" })).toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(() => paidModelConfig({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true",
      SALON_SECRETARY_OPENAI_API_KEY: "synthetic", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic" })).toThrow("SECRETARY_CONFIGURATION_REQUIRED");
  });
  it("accepts exactly one local Function Tool, store=false and no hosted extras", () => {
    expect(() => assertSecretaryModelRequest(sdk(), "select_capabilities")).not.toThrow();
    expect(() => assertSecretaryResponsesPayload(wire(), model)).not.toThrow();
  });
  it.each([
    ["web_search", { type: "hosted_tool", name: "web_search", providerData: { type: "web_search" } }],
    ["file_search", { type: "hosted_tool", name: "file_search", providerData: { type: "file_search" } }],
    ["code_interpreter", { type: "hosted_tool", name: "code_interpreter", providerData: { type: "code_interpreter", container: { type: "auto" } } }],
    ["shell", { type: "shell", name: "shell", environment: { type: "container_auto" } }],
    ["computer_use", { type: "computer", name: "computer" }],
    ["image_generation", { type: "hosted_tool", name: "image_generation", providerData: { type: "image_generation" } }],
    ["hosted_mcp", { type: "hosted_tool", name: "mcp", providerData: { type: "mcp" } }],
    ["hosted_tool_search", { type: "hosted_tool", name: "tool_search", providerData: { type: "tool_search" } }],
    ["sandbox", { type: "hosted_tool", name: "sandbox", providerData: { type: "sandbox" } }],
  ])("rejects SDK %s before model call", (_name, tool) => {
    const request = sdk();
    request.tools = [tool] as ModelRequest["tools"];
    expect(() => assertSecretaryModelRequest(request, "select_capabilities")).toThrow("SECRETARY_OPENAI_COST_GUARD");
  });
  it.each(["web_search", "file_search", "code_interpreter", "shell", "computer", "image_generation", "mcp", "tool_search", "container_auto"])(
    "rejects wire tool %s", type => {
      const payload = wire();
      payload.tools = [{ ...functionTool, type }] as typeof payload.tools;
      expect(() => assertSecretaryResponsesPayload(payload, model)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    });
  it.each(["container", "environment", "container_auto", "vector_store_ids", "previous_response_id", "conversation", "prompt", "background", "service_tier"])(
    "rejects unexpected wire field %s", field => {
      expect(() => assertSecretaryResponsesPayload({ ...wire(), [field]: "synthetic" }, model)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    });
  it("rejects SDK provider overrides, hosted state and extra handoffs", () => {
    for (const change of [
      { modelSettings: { ...sdk().modelSettings, providerData: { tools: [{ type: "web_search" }] } } },
      { modelSettings: { ...sdk().modelSettings, store: true } },
      { modelSettings: { ...sdk().modelSettings, contextManagement: [{ type: "compaction" }] } },
      { modelSettings: { ...sdk().modelSettings, promptCacheRetention: "24h" } },
      { previousResponseId: "resp_hosted" },
      { conversationId: "conv_hosted" },
      { prompt: { id: "prompt_hosted" } },
      { handoffs: [{}] },
    ]) expect(() => assertSecretaryModelRequest({ ...sdk(), ...change } as ModelRequest, "select_capabilities")).toThrow("SECRETARY_OPENAI_COST_GUARD");
  });
  it("fails before the network for a forged container payload", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    try {
      await expect(secretaryGuardedFetch(model)("https://api.openai.com/v1/responses", {
        method: "POST", body: JSON.stringify({ ...wire(), container: { type: "auto" } }),
      })).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("rejects the unchanged historical gate25 raw at the live boundary",async()=>{
    const original=(realOutputs as {id:string;payload:unknown}[]).find(item=>item.id==='gate25-0')!,before=JSON.stringify(original.payload);
    const network=vi.fn(async()=>new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model,
      output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:'select_capabilities',arguments:before,status:'completed'}],
      usage:{input_tokens:20,output_tokens:10,total_tokens:30}}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',network);try{
      const provider=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:model,SALON_SECRETARY_OPENAI_API_KEY:'synthetic-test-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_synthetic'});
      await expect(runServicesTurn(provider,'Quanto faturei ontem?',{}, {},'discovery')).rejects.toThrow();
      expect(network).toHaveBeenCalledTimes(1);expect(JSON.stringify(original.payload)).toBe(before);
    }finally{vi.unstubAllGlobals();}
  });
  it("sends the candidate discovery schema through the real SDK with only the local selection Function Tool", async () => {
    const golden = (realOutputs as { id: string; payload: unknown }[]).find(item => item.id === "gate25-0");
    expect(golden).toBeDefined();
    const originalBytes=JSON.stringify(golden!.payload);
    const network = vi.fn(async (_url:unknown,init?:RequestInit) => {
      // Explicit current-wire synthetic counterpart, not replay of the old raw.
      const request=JSON.parse(String(init?.body)),shape=operationWire(expandedWire(request.tools[0].parameters),'financial.report');
      const original=golden!.payload as {skills:string[];independent:boolean;operations:Record<string,unknown>[]};
      const output={disposition:null,conversation_response:null,unavailable_capability:null,skills:original.skills,independent:original.independent,
        operations:original.operations.map(operation=>Object.fromEntries(Object.keys(shape).map(key=>[key,operation[key]??null])))};
      return new Response(JSON.stringify({
      id: "resp_offline", object: "response", created_at: 0, status: "completed", model,
      output: [{ id: "fc_offline", call_id: "call_offline", type: "function_call", name: "select_capabilities",
        arguments: JSON.stringify(output), status: "completed" }],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    }), { status: 200, headers: { "content-type": "application/json" } });});
    vi.stubGlobal("fetch", network);
    try {
      const provider = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: model,
        SALON_SECRETARY_OPENAI_API_KEY: "synthetic-test-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic" });
      const result = await runServicesTurn(provider, "Quanto faturei ontem?", {}, {}, "discovery");
      expect(JSON.stringify(golden!.payload)).toBe(originalBytes);
      expect(result.skills).toEqual(["financial"]);
      expect(network).toHaveBeenCalledTimes(1);
      const [url, init] = network.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      const payload = JSON.parse(String(init.body));
      expect(payload.model).toBe(model);
      expect(payload.store).toBe(false);
      expect(payload.tools.map((tool: { type: string; name: string }) => [tool.type, tool.name])).toEqual([["function", "select_capabilities"]]);
      expect(payload).not.toHaveProperty("container");
    } finally { vi.unstubAllGlobals(); }
  });
});
