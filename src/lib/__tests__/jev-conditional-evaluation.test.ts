import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dataset } from "../../../packages/salon-secretary/evaluation/dataset";
import { parseJevResponse, JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { conditionalRequest, parseConditionalStage, routeDiscovery, composeConditional, scoreConditionalDecisions, type Skill } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import { ConditionalJevProvider } from "../../../packages/salon-secretary/evaluation/conditional-provider";
import { prepareConditionalAudit, prepareConditionalRevalidation } from "../../../packages/salon-secretary/evaluation/conditional-audit";
import { runEvaluation } from "../../../packages/salon-secretary/evaluation/harness";

const input = dataset.find(c => c.id === "financial-revenue")!.input;
function response(req: JevWireRequest, choices: Record<string, string>, confidence: number | undefined = 1) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { type: "choice", choice: choices[id], ...(confidence === undefined ? {} : { confidence }), probabilities: Object.fromEntries(Object.keys(q.criteria).map(c => [c, Number(c === choices[id])])) }])), usage: { input_tokens: 100, output_tokens: 10 } };
}
function fake(choices: Record<string, string>[], confidence = 1) {
  let index = 0;
  return vi.fn<typeof fetch>(async (_, init) => {
    const req = JSON.parse(init!.body as string) as JevWireRequest;
    return new Response(JSON.stringify(response(req, choices[index++], confidence)));
  });
}
const financial: Record<string, string>[] = [{ skill: "financial", shape: "single" }, { operation: "financial.report", metric: "service_revenue", period: "yesterday" }];
const provider = (send: typeof fetch, maxCalls = 2) => new ConditionalJevProvider({ transport: send, credential: () => "fake-unit-only", maxCalls });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); })));
afterEach(() => vi.unstubAllGlobals());

describe("conditional evaluation v2 — no network", () => {
  it("A: Financial asks discovery then only operation/metric/period, with explicit N/A provenance", async () => {
    const send = fake(financial), p = provider(send); const r = await p.evaluate(input);
    expect(r.status).toBe("OK"); expect(r.closedCoverage).toBe(true); expect(r.requiresLuna).toBe(false); expect(r.accepted).toBe(false);
    expect(r.decision).toEqual(dataset.find(c => c.id === "financial-revenue")!.expected.decision);
    expect(r.stages.map(s => Object.keys(s.request.questions))).toEqual([["skill", "shape"], ["operation", "metric", "period"]]);
    expect(r.dimensionSources.communication).toBe("NOT_APPLICABLE"); expect(r.answers.communication).toBeUndefined();
    expect(r.dimensionSources.metric).toBe("ASKED"); expect(r.usage.inputTokens).toBe(200);
    expect(scoreConditionalDecisions(dataset.find(c => c.id === "financial-revenue")!.expected.decision, r)).toMatchObject({ askedCount: 5, correctAsked: 5, notApplicable: ["inventory", "communication"], accepted: false });
    expect(p.httpCalls).toBe(2); expect(global.fetch).not.toHaveBeenCalled();
  });
  it("B: Inventory only receives operation and inventory questions", async () => {
    const r = await provider(fake([{ skill: "inventory", shape: "single" }, { operation: "product.search", inventory: "low_stock" }])).evaluate(dataset.find(c => c.id === "inventory-low")!.input);
    expect(r.closedCoverage).toBe(true); expect(Object.keys(r.stages[1].request.questions)).toEqual(["operation", "inventory"]);
    expect(r.decision?.communication).toBe("none"); expect(r.answers.communication).toBeUndefined();
  });
  it("C: Scheduling decides operation without pretending to extract client/date/time", async () => {
    const r = await provider(fake([{ skill: "scheduling", shape: "single" }, { operation: "appointment.cancel" }])).evaluate(dataset.find(c => c.id === "scheduling-cancel")!.input);
    expect(r.decision?.operation).toBe("appointment.cancel"); expect(r.requiresLuna).toBe(true); expect(r.closedCoverage).toBe(false);
    expect(r.fallbackReasons).toContain("OPEN_FIELDS_OR_PLAN_REQUIRE_LUNA"); expect(Object.keys(r.stages[1].request.questions)).toEqual(["operation"]);
    expect(r).not.toHaveProperty("customer_ref"); expect(r).not.toHaveProperty("date");
  });
  it.each(["EXACT", "GENERATED"])("D: relevant Communication %s remains a choice, with open extraction fallback", async mode => {
    const r = await provider(fake([{ skill: "communication", shape: "single" }, { operation: "customer.message", communication: mode }])).evaluate(dataset.find(c => c.id === "communication-exact")!.input);
    expect(r.decision?.communication).toBe(mode); expect(r.dimensionSources.communication).toBe("ASKED"); expect(r.requiresLuna).toBe(true);
    expect(r.answers.communication?.choice).toBe(mode); expect(r).not.toHaveProperty("content");
  });
  it("E: multiple dependent capabilities stop after discovery, no arbitrary single-skill choice", async () => {
    const send = fake([{ skill: "multiple", shape: "dependent" }]);
    const r = await provider(send).evaluate(dataset.find(c => c.id === "communication-dependent-name")!.input);
    expect(r.fallbackReasons).toContain("MULTI_OPERATION_REQUIRES_LUNA"); expect(r.decision).toBeNull(); expect(r.dependencies).toBeNull(); expect(send).toHaveBeenCalledTimes(1);
    expect(r.dimensionSources.communication).toBe("NOT_RESOLVED"); expect(r.closedCoverage).toBe(false);
  });
  it("same-skill compound also stops, rather than treating financial multi-metric as single operation", async () => {
    const send = fake([{ skill: "financial", shape: "independent" }]);
    const r = await provider(send).evaluate(dataset.find(c => c.id === "financial-multiple")!.input);
    expect(r.fallbackReasons).toContain("MULTI_OPERATION_REQUIRES_LUNA"); expect(send).toHaveBeenCalledTimes(1);
  });
  it("F: out of catalog does not force a published skill", async () => {
    const send = fake([{ skill: "out_of_catalog", shape: "out_of_catalog" }]); const r = await provider(send).evaluate(dataset.find(c => c.category === "D")!.input);
    expect(r.fallbackReasons).toContain("OUT_OF_CATALOG"); expect(r.decision).toBeNull(); expect(send).toHaveBeenCalledTimes(1); expect(r.accepted).toBe(false);
  });
  it("G: relevant unspecified is preserved and requires fallback, never becomes none", async () => {
    const r = await provider(fake([{ skill: "communication", shape: "single" }, { operation: "customer.message", communication: "unspecified" }])).evaluate(dataset.find(c => c.id === "communication-missing-channel")!.input);
    expect(r.decision?.communication).toBe("unspecified"); expect(r.fallbackReasons).toContain("MESSAGE_MODE_UNSPECIFIED"); expect(r.requiresLuna).toBe(true);
  });
  it("H: legitimate period=none for current receivables is preserved as a real answer", async () => {
    const r = await provider(fake([{ skill: "financial", shape: "single" }, { operation: "financial.report", metric: "outstanding_receivables", period: "none" }])).evaluate(input);
    expect(r.decision?.period).toBe("none"); expect(r.answers.period?.choice).toBe("none"); expect(r.dimensionSources.period).toBe("ASKED"); expect(r.closedCoverage).toBe(true);
  });
  it("I: missing confidence stops before detail; low confidence never means automatic acceptance", async () => {
    const send = vi.fn<typeof fetch>(async (_, init) => { const req = JSON.parse(init!.body as string); const raw = response(req, financial[0]); delete (raw.answers.skill as { confidence?: number }).confidence; return new Response(JSON.stringify(raw)); });
    const missing = await provider(send).evaluate(input); expect(send).toHaveBeenCalledTimes(1); expect(missing.fallbackReasons).toContain("MISSING_CONFIDENCE:skill");
    const low = await provider(fake(financial, 0.15)).evaluate(input); expect(low.accepted).toBe(false); expect(low.executable).toBe(false); expect(low.fallbackReasons).toContain("NO_ACCEPTANCE_POLICY");
  });
  it("old real 7-question output still fails old semantics, and cannot be filtered silently into a v2 response", () => {
    const real = JSON.parse(readFileSync("packages/salon-secretary/evaluation/flat-first-response.json", "utf8"));
    expect(real.response.answers.communication.choice).toBe("unspecified"); expect(real.response.answers.communication.confidence).toBe(0.15);
    expect(() => parseJevResponse(real.response)).toThrow("INVALID_RESPONSE");
    expect(() => parseConditionalStage(real.response, conditionalRequest(input, { kind: "discovery" }))).toThrow("INVALID_RESPONSE");
  });
  it.each(["services", "customers", "scheduling", "financial", "inventory", "communication"] as Skill[])("detail choices for %s never expose operations from another skill", skill => {
    const request = conditionalRequest(input, { kind: "detail", skill });
    const keys = Object.keys(request.questions.operation.criteria);
    expect(keys).toContain("out_of_catalog"); expect(keys).toContain("unclear"); expect(keys).toContain("multiple");
    if (skill !== "communication") expect(request.questions).not.toHaveProperty("communication");
    if (skill !== "financial") { expect(request.questions).not.toHaveProperty("metric"); expect(request.questions).not.toHaveProperty("period"); }
  });
  it("inconsistent discovery stops and injected operation/extra questions fail closed", async () => {
    const r = await provider(fake([{ skill: "multiple", shape: "single" }])).evaluate(input); expect(r.fallbackReasons).toContain("INCONSISTENT_DISCOVERY");
    const req = conditionalRequest(input, { kind: "detail", skill: "financial" });
    const raw = response(req, { operation: "appointment.cancel", metric: "service_revenue", period: "yesterday" });
    expect(() => parseConditionalStage(raw, req)).toThrow();
    const d = parseConditionalStage(response(conditionalRequest(input, { kind: "discovery" }), financial[0]), conditionalRequest(input, { kind: "discovery" }));
    const m = parseConditionalStage(response(req, { operation: "financial.report", metric: "none", period: "yesterday" }), req);
    expect(() => composeConditional("financial", d, m)).toThrow("FINANCIAL_METRIC_MISSING");
  });
  it("Communication none is a conflict, not a message mode; Inventory intent must match operation", async () => {
    const c = await provider(fake([{ skill: "communication", shape: "single" }, { operation: "customer.message", communication: "none" }])).evaluate(input); expect(c.error).toBe("INVALID_RESPONSE");
    const i = await provider(fake([{ skill: "inventory", shape: "single" }, { operation: "stock.movement", inventory: "low_stock" }])).evaluate(input); expect(i.error).toBe("INVALID_RESPONSE");
  });
  it("J: plan and harness deterministic; default zero calls and HTTP budget counts stages", async () => {
    expect(prepareConditionalAudit()).toEqual(prepareConditionalAudit()); expect(prepareConditionalAudit().cases).toHaveLength(40);
    const send = fake(financial), p = provider(send, 0); expect((await p.evaluate(input)).fallbackReasons).toContain("CALL_BUDGET_EXHAUSTED"); expect(send).not.toHaveBeenCalled();
    const one = provider(fake(financial), 1); const r = await one.evaluate(input); expect(one.httpCalls).toBe(1); expect(r.decision).toBeNull(); expect(r.fallbackReasons).toContain("CALL_BUDGET_EXHAUSTED");
    const c = dataset.find(x => x.id === "financial-revenue")!;
    const make = () => runEvaluation([c], { jev: new ConditionalJevProvider({ transport: fake(financial), credential: () => "unit-only", maxCalls: 2, now: () => 1 }), maxCalls: 1 });
    expect(await make()).toEqual(await make());
  });
  it("existing continuations do not reroute; offline A cases have zero JEV questions", async () => {
    for (const c of dataset.filter(c => c.input.context.waiting_for)) { const send = fake([]); const r = await provider(send).evaluate(c.input); expect(r.fallbackReasons).toContain("USE_EXISTING_DRAFT_FLOW"); expect(send).not.toHaveBeenCalled(); }
    expect(prepareConditionalAudit().cases.filter(c => c.category === "A").every(c => c.plannedQuestions === 0)).toBe(true);
  });
  it("provider errors stop without a second stage or retry", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 })); const r = await provider(send).evaluate(input);
    expect(r.error).toBe("AUTH"); expect(send).toHaveBeenCalledTimes(1);
  });
  it("pending revalidation contains ONLY Financial then Inventory, not Scheduling/complex", () => {
    const plan = prepareConditionalRevalidation(); expect(plan.executed).toBe(false); expect(plan.maxHttpCalls).toBe(4);
    expect(plan.cases.map(c => c.caseId)).toEqual(["financial-revenue", "inventory-low"]);
    for (const c of plan.cases) { expect(c.discoveryPayload.state).not.toHaveProperty("expected"); expect(c.conditionalDetailPayload.questions).not.toHaveProperty("communication"); }
    expect(JSON.parse(readFileSync("packages/salon-secretary/evaluation/conditional-audit.json", "utf8"))).toEqual(prepareConditionalAudit());
    expect(JSON.parse(readFileSync("packages/salon-secretary/evaluation/conditional-revalidation.json", "utf8"))).toEqual(plan);
  });
  it("no category/expected controls runtime branch: conflicting input text never supplies an oracle", async () => {
    const send = fake([{ skill: "inventory", shape: "single" }, { operation: "product.search", inventory: "low_stock" }]);
    const r = await provider(send).evaluate(input); expect(r.stages[1].stage).toEqual({ kind: "detail", skill: "inventory" });
    expect(r.stages[1].request.state).toHaveProperty("selected_skill", "inventory");
  });
  it("missing confidence, distribution corruption and unknown skill do not pass stage validation", () => {
    expect(() => conditionalRequest(input, { kind: "detail", skill: "admin" as Skill })).toThrow();
    const req = conditionalRequest(input, { kind: "discovery" }), raw = response(req, financial[0]); raw.answers.skill.probabilities.financial = 0.2;
    expect(() => parseConditionalStage(raw, req)).toThrow();
    expect(routeDiscovery({ ...parseConditionalStage(response(req, { skill: "unclear", shape: "unclear" }), req) }).kind).toBe("stop");
  });
});
