import { expandedWire, operationWire } from '../../test/secretary-wire-schema';
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaidModel, runServicesTurn, selectionSchemaV2, validateSelectionV2 } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import { canStartCompleteCase } from "../../../packages/salon-secretary/evaluation/conversational-ux-self-healing-target";
import { verifyFrozenTarget, canStartCompleteCase as canStartFinalCase } from "../../../packages/salon-secretary/evaluation/conversational-ux-final-target";
import { verifyFrozenTarget as verifyOriginal } from "../../../packages/salon-secretary/evaluation/conversational-ux-target";

afterEach(() => vi.unstubAllGlobals());
describe("item key publication matches local validation", () => {
  it.each([false, true])("publishes the existing regex through SDK serialization (V2=%s)", async v2 => {
    const transport = vi.fn(async (_url:unknown,init?:RequestInit) => {
      const wire=JSON.parse(String(init?.body)),shape=operationWire(expandedWire(wire.tools[0].parameters),'appointment.create');
      const operation={...Object.fromEntries(Object.keys(shape).map(key=>[key,null])),operation:'appointment.create',item_key:'a',customer_name:'Andrinho'};
      const output=v2?{turn:{mode:'NEW',operations:[operation]}}:{disposition:'SUPPORTED',conversation_response:null,unavailable_capability:null,skills:['scheduling'],independent:true,operations:[operation]};
      return new Response(JSON.stringify({ id: "resp_offline", object: "response", created_at: 0,
      status: "completed", model: "gpt-6-luna", output: [{ id: "fc_offline", call_id: "call_offline", type: "function_call",
        name: "select_capabilities", arguments: JSON.stringify(output), status: "completed" }],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } }), { status: 200, headers: { "content-type": "application/json" } });});
    vi.stubGlobal("fetch", transport);
    const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: "gpt-6-luna",
      SALON_SECRETARY_OPENAI_API_KEY: "synthetic-test-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_synthetic" });
    await runServicesTurn(model, "Pedido sintético", {}, {}, "discovery", v2);
    expect(transport).toHaveBeenCalledTimes(1);
    const [, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    const wire = JSON.parse(String(init.body));
    const schema = operationWire(expandedWire(wire.tools[0].parameters), "appointment.create");
    expect(wire.store).toBe(false); expect(wire.tools).toHaveLength(1); expect(wire.tools[0].strict).toBe(true);
    expect(schema.item_key.anyOf!.find(s => s.type === "string")!.pattern).toBe("^[a-z][a-z0-9_]{0,31}$");
    if (v2) expect(schema.depends_on.anyOf!.find(s => s.type === "array")!.items!.pattern).toBe("^[a-z][a-z0-9_]{0,31}$");
    for (const key of ["a", "action_1", "a".repeat(32), "A", "1", "a-b", "a b", "á", "a".repeat(33)])
      expect(new RegExp(String(schema.item_key.anyOf![0].pattern)).test(key)).toBe(selectionSchemaV2.shape.operations.element.shape.item_key.safeParse(key).success);
  });
  it.each(["A", "1", "a-b", "a b", "á", "a".repeat(33)])("does not normalize or accept invalid key %s", key => {
    const input = plan([intent("appointment.create", { item_key: key })]);
    const before = structuredClone(input);
    expect(() => validateSelectionV2(input)).toThrow(); expect(input).toEqual(before);
  });
  it("retains historical guards: T21 cannot reuse the prior clarification authorization", () => {
    expect(() => verifyOriginal()).toThrow("TARGET_COMPOSER_DRIFT");
    expect(()=>verifyFrozenTarget()).toThrow("FINAL_TIMEZONE_DELTA");
  });
  it("admits only the two frozen turns of x49 under the new authorization", () => {
    expect(canStartFinalCase(0, "x49")).toBe(true);
    expect(canStartFinalCase(1, "x49")).toBe(false);
    for (const id of ["x41", "x42", "x44", "x46"]) expect(() => canStartFinalCase(0, id)).toThrow();
  });
  it("reserves all frozen turns and never repeats passed cases or raises the combined budget", () => {
    expect(canStartCompleteCase(0, "x44")).toBe(true);
    expect(canStartCompleteCase(2, "x46")).toBe(true);
    expect(canStartCompleteCase(4, "x49")).toBe(false);
    expect(canStartCompleteCase(3, "x49")).toBe(true);
    for (const id of ["x41", "x42"]) expect(() => canStartCompleteCase(0, id)).toThrow("SELF_HEALING_CASE_BUDGET");
    for (const count of [-1, 6, 1.5]) expect(() => canStartCompleteCase(count, "x44")).toThrow("SELF_HEALING_CASE_BUDGET");
  });
});
