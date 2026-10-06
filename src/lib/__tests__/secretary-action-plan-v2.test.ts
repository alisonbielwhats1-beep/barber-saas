import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionPlan, validateSelection, validateSelectionV2, selectionSchemaV2, dependencyGraph,
  assessPlanAction, patchPlanAction, minimumClarifications, actionPlanPreview, executeConfirmationGroup,
  multiActionConfiguration, createServicesAgent, runServicesTurn, type ActionPlan } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { actionUnits } from "../secretary-action-plan";

const service = (key: string, depends_on: string[] = []) => intent("service.create", { item_key: key, depends_on, name: `Serviço ${key}`, priceCents: 8000, durationMin: 30 });
const selection = (operations: ReturnType<typeof intent>[]) => ({ ...plan(operations), independent: !operations.some(op => (op as { depends_on?: string[] }).depends_on?.length) });
const many = (n: number) => selection(Array.from({ length: n }, (_, index) => service(`a${index}`)));
function prepared(input: unknown): ActionPlan {
  let result = createActionPlan(input);
  for (const action of result.actions) result = assessPlanAction(result, action.key, action.mutation ?
    { status: "READY_FOR_CONFIRMATION", missing_fields: [], proposal_token: `backend-proposal-${action.key}`, preview: `Preview ${action.key}` } :
    { status: "DONE", missing_fields: [], preview: "Leitura backend" });
  return result;
}
const approval = (value: ActionPlan, index = 0) => ({ plan_ref: value.plan_ref, revision: value.revision,
  group_key: value.confirmation_groups[index].key, fingerprint: value.confirmation_groups[index].fingerprint });

/** Synthetic equivalent of the REQUEST, not the unavailable historical u02 arguments. */
export const u02Equivalent = selection([
  intent("appointment.cancel", { item_key: "a", depends_on: [], customer_name: "Amanda Souza", day_offset: 1, time: "10:00", reason: "Pedido dela" }),
  intent("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a", customer_name: "Fábio Santos", service_name: "Corte Completo" }),
  intent("service.change", { item_key: "c", depends_on: [], target_name: "Massagem", priceCents: 8000 }),
  intent("financial.report", { item_key: "d", depends_on: [], financial: { metrics: ["service_revenue"], period: "yesterday" } }),
]);
export const salonTen = selection([
  ...u02Equivalent.operations,
  intent("customer.message", { item_key: "e", depends_on: ["a"], communication: { recipient_name: "Amanda Souza", channel: "WHATSAPP", message_mode: "EXACT", content: "Seu horário foi cancelado. 😊" } }),
  intent("customer.create", { item_key: "f", depends_on: [], name: "Lia Santos" }),
  intent("stock.movement", { item_key: "g", depends_on: [], inventory: { product_name: "Shampoo", mode: "IN", quantity: 10 } }),
  intent("product.search", { item_key: "h", depends_on: [], inventory: { low_stock: true } }),
  intent("schedule.block", { item_key: "i", depends_on: [], professional_name: "Tatiana", day_offset: 2, time: "14:00", end_time: "15:00" }),
  intent("service.create", { item_key: "j", depends_on: [], name: "Barba Expressa", priceCents: 3500, durationMin: 20 }),
]);

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("N-action strict transport, structural scoring, offline only", () => {
  it.each([1, 3, 4, 5, 7, 10, 12, 14, 101])("represents %i actions; policy is independent of capacity", count => {
    const p = prepared(many(count));
    expect(p.actions).toHaveLength(count);
    expect(p.execution_order).toHaveLength(count);
    expect(p.review).toBe(count > 10 ? "SPLIT_REVIEW" : count > 5 ? "ADVANCED_REVIEW" : "NORMAL_REVIEW");
    expect(p.confirmation_groups.flatMap(group => group.action_keys)).toHaveLength(count);
    expect(new Set(p.confirmation_groups.flatMap(group => group.action_keys)).size).toBe(count);
    expect(p.confirmation_groups.every(group => group.action_keys.length <= 10)).toBe(true);
  });
  it("u02 is representable including Corte Completo, independent service/financial and release component", () => {
    expect(selectionSchemaV2.safeParse(u02Equivalent).success).toBe(true);
    expect(() => validateSelection(u02Equivalent)).not.toThrow(); // downstream runtime was narrower, NOT proven u02 root cause
    const p = prepared(u02Equivalent);
    expect(p.actions[1]).toMatchObject({ fields: { service_name: "Corte Completo" }, depends_on: ["a"] });
    expect(dependencyGraph(p.actions).components).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(actionUnits(p).map(unit => unit.kind)).toEqual(["scheduling-batch", "single", "single"]);
    expect(p.actions[3].mutation).toBe(false);
  });
  it("realistic 10 and 14 actions cover six Skills and never cut a component", () => {
    for (const input of [salonTen, selection([...salonTen.operations, ...["k", "l", "m", "n"].map(key => service(key))])]) {
      const p = prepared(input), score = { represented: p.actions.length === input.operations.length,
        allSkills: new Set(p.actions.map(action => action.skill)).size === 6,
        graph: p.dependencies.every(edge => p.execution_order.indexOf(edge.from) < p.execution_order.indexOf(edge.to)),
        grouping: dependencyGraph(p.actions).components.every(component => p.confirmation_groups.some(group => component.every(key => group.action_keys.includes(key)))) };
      expect(Object.values(score).every(Boolean)).toBe(true);
      expect(p.actions.find(action => action.key === "e")!.fields.communication?.content).toBe("Seu horário foi cancelado. 😊");
      expect(p.review).toBe(input.operations.length === 10 ? "ADVANCED_REVIEW" : "SPLIT_REVIEW");
    }
  });
  it.each([1, 2, 3, 4])("V1 independent %i remains compatible, nullable dependencies normalize", n => {
    const input = plan(Array.from({ length: n }, () => intent("service.create", { name: "Massagem", depends_on: null })));
    const old = validateSelection(input), next = validateSelectionV2(input);
    expect(next.operations.map(({ item_key: _key, ...op }) => { void _key; return op; })).toEqual(old.operations);
  });
  it("configurable policy can use 3 or 20; no new engine needed", () => {
    const input = many(12);
    expect(createActionPlan(input, { normalReviewMax: 2, maxActionsPerConfirmationGroup: 3 }).confirmation_groups).toHaveLength(4);
    expect(createActionPlan(input, { normalReviewMax: 8, maxActionsPerConfirmationGroup: 20 }).review).toBe("ADVANCED_REVIEW");
    expect(multiActionConfiguration({}).enabled).toBe(false);
    expect(multiActionConfiguration({ SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(() => multiActionConfiguration({ SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP: "0" })).toThrow();
  });
  it.each([
    [service("a"), service("b", ["a"])],
    [service("a"), service("b", ["a"]), service("c", ["a"])],
    [service("c", ["b"]), service("a"), service("b", ["a"])],
    [service("a"), service("b", ["a"]), service("c"), service("d", ["c"])],
    [service("a"), service("b"), service("c"), service("d", ["a", "b", "c"])],
  ])("validates directed graph %j", (...operations) => {
    const p = createActionPlan(selection(operations));
    for (const edge of p.dependencies) expect(p.execution_order.indexOf(edge.from)).toBeLessThan(p.execution_order.indexOf(edge.to));
  });
  it.each([
    [service("a", ["b"]), service("b", ["a"])], [service("a", ["a"])],
    [service("a", ["missing"])], [service("a"), service("a")], [service("a"), service("b", ["a", "a"])],
  ])("rejects invalid graph before any execution %j", (...operations) => {
    expect(() => createActionPlan(selection(operations))).toThrow("INVALID_DEPENDENCY_GRAPH");
  });
  it("oversized dependent component needs special review, remains intact, never executes", async () => {
    const p = prepared(selection(Array.from({ length: 12 }, (_, i) => service(`a${i}`, i ? [`a${i - 1}`] : []))));
    expect(p.confirmation_groups).toMatchObject([{ action_keys: Array.from({ length: 12 }, (_, i) => `a${i}`), review: "SPECIAL_REVIEW", status: "SPECIAL_REVIEW" }]);
    const executor = vi.fn(); await expect(executeConfirmationGroup(p, approval(p), executor)).rejects.toThrow("SPECIAL_REVIEW_REQUIRED");
    expect(executor).not.toHaveBeenCalled();
  });
  it.each([
    intent("service.create", { extra: "unknown" }), intent("service.create", { operation: "sql.execute" }),
    intent("service.create", { item_key: "bad-key" }), intent("service.create", { customer_name: "Amanda" }),
    intent("service.create", { confirmed: true }), intent("financial.report", { financial: { metric: "service_revenue" } }),
  ])("does not relax safety for coverage %j", operation => { expect(() => validateSelectionV2(plan([operation]))).toThrow(); });
  it("V2 SDK uses one strict local tool, V1 still rejects 5; no model receives backend status", async () => {
    const v2 = new ScriptedServicesModel([call("select_capabilities", many(12))]);
    const parsed = await runServicesTurn(v2, "Prepare os serviços", {}, {}, "discovery", true);
    expect(parsed.operations).toHaveLength(12);
    const agent = createServicesAgent(v2, vi.fn(), "discovery", true);
    expect(agent.tools.map(tool => tool.name)).toEqual(["select_capabilities"]);
    expect(agent.modelSettings).toMatchObject({ store: false, parallelToolCalls: false });
    expect(JSON.stringify(v2.requests[0].tools)).not.toContain("READY_FOR_CONFIRMATION");
    const old = new ScriptedServicesModel([call("select_capabilities", many(5))]);
    await expect(runServicesTurn(old, "Prepare serviços", {}, {}, "discovery")).rejects.toThrow();
  });
  it("estimates context growth structurally without paid calls or invented usage", async () => {
    const model = new ScriptedServicesModel([call("select_capabilities", many(1))]);
    await runServicesTurn(model, "Prepare um serviço.", {}, {}, "discovery", true);
    const schemaBytes = Buffer.byteLength(JSON.stringify(model.requests[0].tools));
    const sizes = [1, 5, 7, 10, 12, 14].map(count => ({ actions: count,
      schema_bytes: schemaBytes, synthetic_output_bytes: Buffer.byteLength(JSON.stringify(many(count))) }));
    process.stdout.write(`MULTI_ACTION_V2_STRUCTURAL_SIZE ${JSON.stringify(sizes)}\n`);
    expect(sizes[5].synthetic_output_bytes).toBeGreaterThan(sizes[0].synthetic_output_bytes);
    expect(sizes.every(size => size.schema_bytes === schemaBytes)).toBe(true);
  });
});

describe("missing fields, revision and partial failures", () => {
  it("scheduling clarification asks only service/time and end_time, not cancel or ready siblings", () => {
    let p = prepared(selection([
      intent("appointment.cancel", { item_key: "a", customer_name: "Amanda", reason: "Pedido dela" }),
      intent("appointment.create", { item_key: "b", depends_on: ["a"], customer_name: "Alisson", day_offset: 1 }),
      service("c"), intent("schedule.block", { item_key: "d", professional_name: "Tatiana", day_offset: 2, time: "14:00" }), service("e"),
    ]));
    p = assessPlanAction(p, "b", { status: "NEEDS_INPUT", missing_fields: ["service_name", "time"] });
    p = assessPlanAction(p, "d", { status: "NEEDS_INPUT", missing_fields: ["end_time"] });
    expect(minimumClarifications(p)).toEqual([{ action_key: "b", fields: ["service_name", "time"] }, { action_key: "d", fields: ["end_time"] }]);
    const next = patchPlanAction(p, "b", { service_name: "Corte Completo", time: "10:00" });
    expect(next.actions[0]).toEqual(p.actions[0]); expect(next.actions[1].depends_on).toEqual(["a"]);
  });
  it("asks only B/D, patch preserves A/C/E, dependency and same plan", () => {
    let p = prepared(selection([service("a"), service("b", ["a"]), service("c"), service("d"), service("e")]));
    p = assessPlanAction(p, "b", { status: "NEEDS_INPUT", missing_fields: ["durationMin", "priceCents"] });
    p = assessPlanAction(p, "d", { status: "NEEDS_INPUT", missing_fields: ["name"] });
    expect(minimumClarifications(p)).toEqual([{ action_key: "b", fields: ["durationMin", "priceCents"] }, { action_key: "d", fields: ["name"] }]);
    const next = patchPlanAction(p, "b", { durationMin: 45, name: null });
    expect(next.plan_ref).toBe(p.plan_ref); expect(next.revision).toBeGreaterThan(p.revision);
    expect(next.actions[1].depends_on).toEqual(["a"]);
    expect(next.actions[1].fields.name).toBe("Serviço b");
    expect([0, 2, 4].map(i => next.actions[i])).toEqual([0, 2, 4].map(i => p.actions[i]));
    // Presentation changed; the structured missing-field expectations above remain identical.
    expect(actionPlanPreview(p)).toContain("duração em minutos e preço de Serviço b");
    expect(actionPlanPreview(p)).toContain("nome de Serviço d");
    expect(() => patchPlanAction(p, "a", { confirmed: true })).toThrow();
    expect(() => patchPlanAction(p, "a", { operation: "customer.create" })).toThrow();
  });
  it("nested EXACT and channel survive a targeted patch", () => {
    const p = createActionPlan(salonTen), next = patchPlanAction(p, "e", { communication: { recipient_name: "Amanda Souza" } });
    expect(next.actions[4].fields.communication).toEqual(p.actions[4].fields.communication);
  });
  it("missing/invalid C prevents silent A/B/D execution", async () => {
    const p = assessPlanAction(prepared(many(4)), "a2", { status: "NEEDS_INPUT", missing_fields: ["name"] });
    const executor = vi.fn(); await expect(executeConfirmationGroup(p, approval(p), executor)).rejects.toThrow("PLAN_NOT_READY");
    expect(executor).not.toHaveBeenCalled(); expect(p.status).toBe("NEEDS_INPUT");
  });
  it("A failure blocks B/C descendants, independent D still executes with explicit group confirmation", async () => {
    const p = prepared(selection([service("a"), service("b", ["a"]), service("c", ["b"]), service("d")]));
    const invoked: string[] = [];
    const result = await executeConfirmationGroup(p, approval(p), async action => {
      invoked.push(action.key); if (action.key === "a") throw Error("domain conflict");
      return { status: "DONE", missing_fields: [] };
    });
    expect(invoked).toEqual(["a", "d"]);
    expect(result.actions.map(action => action.status)).toEqual(["FAILED_SAFE", "BLOCKED_BY_DEPENDENCY", "BLOCKED_BY_DEPENDENCY", "DONE"]);
    expect(result.status).toBe("PARTIAL_FAILURE");
  });
  it("material preview change rejects old confirmation before executor", async () => {
    const p = prepared(many(3)), next = patchPlanAction(p, "a0", { priceCents: 9000 }), executor = vi.fn();
    await expect(executeConfirmationGroup(next, approval(p), executor)).rejects.toThrow("CONFIRMATION_STALE");
    expect(executor).not.toHaveBeenCalled();
  });
  it("review of second independent group survives completion of first; reads stay reads", async () => {
    const p = prepared(many(12)), executor = vi.fn(async () => ({ status: "DONE" as const, missing_fields: [] }));
    const next = await executeConfirmationGroup(p, approval(p), executor);
    expect(executor).toHaveBeenCalledTimes(10);
    const done = await executeConfirmationGroup(next, approval(p, 1), executor);
    expect(executor).toHaveBeenCalledTimes(12); expect(done.status).toBe("DONE");
  });
});
