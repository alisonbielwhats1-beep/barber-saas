import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dataset, validateDataset } from "../../../packages/salon-secretary/evaluation/dataset";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { conditionalRequest, parseConditionalStage, composeConditional, type Skill } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import { derivationCatalog, deriveOperation, isAuditedPublication, publishedDecisionCatalog, type DerivationCatalog } from "../../../packages/salon-secretary/evaluation/derivation-catalog";
import { derivedRequest, scoreDerivedDecisions } from "../../../packages/salon-secretary/evaluation/derived-plan";
import { DerivedJevProvider } from "../../../packages/salon-secretary/evaluation/derived-provider";
import { decisionMatrix, prepareDerivedAudit, prepareDerivedRevalidation } from "../../../packages/salon-secretary/evaluation/derived-audit";
import { runEvaluation } from "../../../packages/salon-secretary/evaluation/harness";

const financial = dataset.find(c => c.id === "financial-revenue")!;
const inventory = dataset.find(c => c.id === "inventory-low")!;
function response(req: JevWireRequest, choices: Record<string, string>, confidence: number | undefined = 1) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { type: "choice", choice: choices[id],
    ...(confidence === undefined ? {} : { confidence }), probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, Number(k === choices[id])])) }])), usage: { input_tokens: 100, output_tokens: 10 } };
}
function fake(choices: Record<string, string>[], confidence = 1) {
  let at = 0;
  return vi.fn<typeof fetch>(async (_, init) => new Response(JSON.stringify(response(JSON.parse(init!.body as string), choices[at++], confidence))));
}
const make = (send: typeof fetch, maxCalls = 2) => new DerivedJevProvider({ transport: send, credential: () => "unit-not-a-secret", maxCalls, now: () => 1 });
const mutableCatalog = () => structuredClone(derivationCatalog) as { version: string; publicationHash: string; bindings: { skill: Skill; dimension: string; value: string; operations: string[]; evidence: string }[] };
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); })));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("closed derivation catalogue (no provider)", () => {
  it("matches the actual enabled publication and its audited semantics", () => {
    expect(isAuditedPublication(publishedDecisionCatalog())).toBe(true);
    expect(derivationCatalog.bindings).toHaveLength(13);
  });
  it.each(derivationCatalog.bindings)("uniquely derives $skill/$value from catalog", b => {
    const r = deriveOperation(b.skill, "single", b.dimension, b.value);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.derivation.operation).toBe(b.operations[0]); expect(r.derivation.evidence).toBe(b.evidence); expect(r.derivation).not.toHaveProperty("confidence"); }
  });
  it.each(["unclear", "none", "multiple", "unspecified"])("does not invent an operation from %s", value => {
    for (const [skill, dim] of [["financial", "metric"], ["inventory", "inventory"], ["communication", "communication"]] as const) {
      expect(deriveOperation(skill, "single", dim, value).ok).toBe(false);
    }
  });
  it("fails when a mapping is missing", () => {
    const c = mutableCatalog(); c.bindings = c.bindings.filter(b => b.value !== "low_stock");
    expect(deriveOperation("inventory", "single", "inventory", "low_stock", c as DerivationCatalog)).toEqual({ ok: false, reason: "MAPPING_MISSING" });
  });
  it("fails on multiple targets or duplicate matching bindings, not first-match wins", () => {
    const c = mutableCatalog(), b = c.bindings.find(b => b.value === "low_stock")!;
    b.operations.push("stock.balance");
    expect(deriveOperation("inventory", "single", "inventory", "low_stock", c as DerivationCatalog)).toEqual({ ok: false, reason: "MAPPING_AMBIGUOUS" });
    b.operations.pop(); c.bindings.push(structuredClone(b));
    expect(deriveOperation("inventory", "single", "inventory", "low_stock", c as DerivationCatalog)).toEqual({ ok: false, reason: "MAPPING_AMBIGUOUS" });
  });
  it.each(["financial.report", "admin.sql"])("rejects incompatible/unpublished operation %s", operation => {
    const c = mutableCatalog(); c.bindings.find(b => b.value === "low_stock")!.operations = [operation];
    expect(deriveOperation("inventory", "single", "inventory", "low_stock", c as DerivationCatalog)).toEqual({ ok: false, reason: "UNPUBLISHED_OR_INCOMPATIBLE_OPERATION" });
  });
  it("detects same-skill mapping corruption instead of teaching low_stock a different operation", () => {
    const c = mutableCatalog(); c.bindings.find(b => b.value === "low_stock")!.operations = ["stock.balance"];
    expect(deriveOperation("inventory", "single", "inventory", "low_stock", c as DerivationCatalog)).toEqual({ ok: false, reason: "CATALOG_DRIFT" });
  });
  it("rejects incompatible skill/dimension and unknown decision, preserving none vs unspecified", () => {
    expect(deriveOperation("financial", "single", "inventory", "low_stock")).toMatchObject({ ok: false, reason: "INCOMPATIBLE_DECISION" });
    expect(deriveOperation("inventory", "single", "inventory", "../../admin")).toMatchObject({ ok: false, reason: "UNKNOWN_DECISION" });
    expect(deriveOperation("scheduling", "single", "communication", "EXACT").ok).toBe(false);
  });
  it.each(["dependent", "independent"] as const)("never collapses a %s plan into a single operation", shape => {
    expect(deriveOperation("communication", shape, "communication", "EXACT")).toMatchObject({ ok: false, reason: "DEPENDENT_OR_COMPOUND_PLAN" });
  });
  it("changed catalog publication blocks before transport", async () => {
    const pub = publishedDecisionCatalog(); (pub.registry[0] as { version: string }).version = "future";
    const send = fake([]), r = await new DerivedJevProvider({ transport: send, credential: () => "unit", publication: () => pub, maxCalls: 2 }).evaluate(inventory.input);
    expect(r.fallbackReasons).toEqual(["CATALOG_DRIFT"]); expect(send).not.toHaveBeenCalled(); expect(r.decision).toBeNull();
  });
});

describe("derived evaluation — decisions plus deterministic derivation", () => {
  it("Financial asks skill/shape then metric/period; never asks operation or Communication", async () => {
    const send = fake([{ skill: "financial", shape: "single" }, { metric: "service_revenue", period: "yesterday" }]);
    const r = await make(send).evaluate(financial.input);
    expect(r.decision).toEqual(financial.expected.decision); expect(r.closedCoverage).toBe(true); expect(r.accepted).toBe(false);
    expect(r.stages.map(s => Object.keys(s.request.questions))).toEqual([["skill", "shape"], ["metric", "period"]]);
    expect(r.dimensionSources.operation).toBe("DERIVED"); expect(r.answers.operation).toBeUndefined();
    expect(scoreDerivedDecisions(financial.expected.decision, r)).toMatchObject({ askedCount: 4, correctAsked: 4, derived: [{ operation: "financial.report", correct: true }] });
    expect(scoreDerivedDecisions(financial.expected.decision, r).confidenceForFutureCalibration.map(x => x.dimension)).not.toContain("operation");
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("Inventory low_stock has only one detail decision, derived canonical product.search", async () => {
    const r = await make(fake([{ skill: "inventory", shape: "single" }, { inventory: "low_stock" }])).evaluate(inventory.input);
    expect(r.decision).toEqual(inventory.expected.decision); expect(r.closedCoverage).toBe(true); expect(r.requiresLuna).toBe(false);
    expect(Object.keys(r.stages[1].request.questions)).toEqual(["inventory"]);
    expect(r.answers).not.toHaveProperty("operation"); expect(r.answers).not.toHaveProperty("communication");
    expect(scoreDerivedDecisions(inventory.expected.decision, r)).toMatchObject({ askedCount: 3, correctAsked: 3 });
  });
  it.each(["EXACT", "GENERATED"])("Communication %s derives only operation; text/recipient/dependency remain open", async mode => {
    const r = await make(fake([{ skill: "communication", shape: "single" }, { communication: mode }])).evaluate(dataset.find(c => c.id === "communication-exact")!.input);
    expect(r.decision).toMatchObject({ operation: "customer.message", communication: mode });
    expect(Object.keys(r.stages[1].request.questions)).toEqual(["communication"]); expect(r.requiresLuna).toBe(true); expect(r.closedCoverage).toBe(false);
    expect(r).not.toHaveProperty("content"); expect(r).not.toHaveProperty("recipient_ref");
  });
  it("relevant unspecified/unclear keeps the answer and falls back, never becomes none", async () => {
    for (const mode of ["unspecified", "unclear", "none"]) {
      const r = await make(fake([{ skill: "communication", shape: "single" }, { communication: mode }])).evaluate(financial.input);
      expect(r.answers.communication?.choice).toBe(mode); expect(r.decision).toBeNull(); expect(r.requiresLuna).toBe(true); expect(r.fallbackReasons).toContain("MAPPING_MISSING");
    }
  });
  it("receivables legitimately uses period none; explicit incompatible period requires fallback", async () => {
    const r = await make(fake([{ skill: "financial", shape: "single" }, { metric: "outstanding_receivables", period: "none" }])).evaluate(financial.input);
    expect(r.decision?.period).toBe("none"); expect(r.answers.period?.choice).toBe("none"); expect(r.closedCoverage).toBe(true);
    const bad = await make(fake([{ skill: "financial", shape: "single" }, { metric: "outstanding_receivables", period: "yesterday" }])).evaluate(financial.input);
    expect(bad.closedCoverage).toBe(false); expect(bad.fallbackReasons).toContain("RECEIVABLE_IS_CURRENT_BALANCE");
  });
  it.each(["none", "unclear", "comparison"])("Financial period %s is not complete coverage", async period => {
    const r = await make(fake([{ skill: "financial", shape: "single" }, { metric: "service_revenue", period }])).evaluate(financial.input);
    expect(r.requiresLuna).toBe(true); expect(r.closedCoverage).toBe(false);
  });
  it.each(["balance", "search", "IN", "OUT"])("Inventory %s still needs open extraction/backend", async inventoryIntent => {
    const r = await make(fake([{ skill: "inventory", shape: "single" }, { inventory: inventoryIntent }])).evaluate(inventory.input);
    expect(r.derivations).toHaveLength(1); expect(r.closedCoverage).toBe(false); expect(r.requiresLuna).toBe(true);
  });
  it.each([["services", "service.change"], ["customers", "customer.read"], ["scheduling", "appointment.cancel"]] as const)("%s still asks operation without claiming open fields", async (skill, operation) => {
    const r = await make(fake([{ skill, shape: "single" }, { operation }])).evaluate(financial.input);
    expect(r.decision?.operation).toBe(operation); expect(r.dimensionSources.operation).toBe("ASKED"); expect(r.derivations).toEqual([]); expect(r.requiresLuna).toBe(true);
    expect(Object.keys(r.stages[1].request.questions)).toEqual(["operation"]);
  });
  it.each([{ skill: "multiple", shape: "dependent" }, { skill: "financial", shape: "independent" }, { skill: "unclear", shape: "unclear" }, { skill: "out_of_catalog", shape: "out_of_catalog" }])("discovery $skill/$shape stops without derivation/detail", async choice => {
    const send = fake([choice]), r = await make(send).evaluate(financial.input);
    expect(send).toHaveBeenCalledTimes(1); expect(r.decision).toBeNull(); expect(r.derivations).toEqual([]); expect(r.dependencies).toBeNull(); expect(r.executable).toBe(false);
  });
  it("missing confidence requires fallback; confidence 0.33 or 1 never authorizes execution", async () => {
    const send = vi.fn<typeof fetch>(async (_, init) => { const req = JSON.parse(init!.body as string); const r = response(req, { skill: "inventory", shape: "single" }); delete (r.answers.skill as { confidence?: number }).confidence; return new Response(JSON.stringify(r)); });
    expect((await make(send).evaluate(inventory.input)).fallbackReasons).toContain("MISSING_CONFIDENCE:skill"); expect(send).toHaveBeenCalledTimes(1);
    for (const confidence of [0.33, 1]) {
      const r = await make(fake([{ skill: "inventory", shape: "single" }, { inventory: "low_stock" }], confidence)).evaluate(inventory.input);
      expect(r.accepted).toBe(false); expect(r.executable).toBe(false); expect(r.fallbackReasons).toContain("NO_ACCEPTANCE_POLICY");
      expect(r.answers.inventory?.confidence).toBe(confidence); expect(r.derivations[0]).not.toHaveProperty("confidence");
    }
  });
  it("extra operation from provider fails transport validation; it is not silently overridden", async () => {
    const send = vi.fn<typeof fetch>(async (_, init) => { const req = JSON.parse(init!.body as string), raw = response(req, req.questions.skill ? { skill: "inventory", shape: "single" } : { inventory: "low_stock" });
      if (!req.questions.skill) raw.answers.operation = { type: "choice", choice: "stock.balance", confidence: 1, probabilities: { "stock.balance": 1 } };
      return new Response(JSON.stringify(raw)); });
    const r = await make(send).evaluate(inventory.input); expect(r.error).toBe("INVALID_RESPONSE"); expect(r.decision).toBeNull(); expect(r.derivations).toEqual([]);
  });
  it("retains real v2 Inventory error (confidence .33) as failure, never recasts it as a successful v3 call", () => {
    const real = JSON.parse(readFileSync("packages/salon-secretary/evaluation/conditional-real-response.json", "utf8"));
    const c = real.cases.find((c: { caseId: string }) => c.caseId === "inventory-low");
    expect(c.roundTrips[1].response.answers.operation).toMatchObject({ choice: "stock.balance", confidence: 0.33 });
    const d = parseConditionalStage(c.roundTrips[0].response, conditionalRequest(inventory.input, { kind: "discovery" }));
    const m = parseConditionalStage(c.roundTrips[1].response, conditionalRequest(inventory.input, { kind: "detail", skill: "inventory" }));
    expect(() => composeConditional("inventory", d, m)).toThrow("INVENTORY_OPERATION_CONFLICT");
    expect(() => parseConditionalStage(c.roundTrips[1].response, derivedRequest(inventory.input, { kind: "detail", skill: "inventory" }))).toThrow("INVALID_RESPONSE");
  });
  it("budget defaults to zero; counts round-trips, with no retry/fallback effects", async () => {
    const send = fake([{ skill: "financial", shape: "single" }]);
    expect((await make(send, 0).evaluate(financial.input)).fallbackReasons).toContain("CALL_BUDGET_EXHAUSTED"); expect(send).not.toHaveBeenCalled();
    expect((await make(send, 1).evaluate(financial.input)).fallbackReasons).toContain("CALL_BUDGET_EXHAUSTED"); expect(send).toHaveBeenCalledTimes(1);
    const auth = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 }));
    expect((await make(auth).evaluate(financial.input)).error).toBe("AUTH"); expect(auth).toHaveBeenCalledTimes(1);
  });
  it("all 40 cases deterministic, expected untouched, fast-path before model, no oracle sent", async () => {
    const before = JSON.stringify(dataset);
    const evaluate = async () => {
      const rows = [];
      for (const c of validateDataset(dataset)) {
        const send = fake([c.expected.decision, c.expected.decision]);
        const r = await make(send).evaluate(c.input); rows.push(r);
        for (const [, init] of send.mock.calls) { const req = JSON.parse(init!.body as string); expect(req.state).not.toHaveProperty("expected"); expect(req.state).not.toHaveProperty("domainFields"); expect(req.state).not.toHaveProperty("category"); }
        if (c.input.context.waiting_for) { expect(send).not.toHaveBeenCalled(); expect(r.fallbackReasons).toContain("USE_EXISTING_DRAFT_FLOW"); }
        if (c.expected.decision.shape !== "single") expect(r.derivations).toEqual([]);
      }
      return rows;
    };
    expect(await evaluate()).toEqual(await evaluate()); expect(JSON.stringify(dataset)).toBe(before); expect(global.fetch).not.toHaveBeenCalled();
  });
  it("wrong discovery is never corrected by the message/expected", async () => {
    const r = await make(fake([{ skill: "inventory", shape: "single" }, { inventory: "low_stock" }])).evaluate(financial.input);
    expect(r.decision?.skill).toBe("inventory"); expect(r.decision?.operation).toBe("product.search");
  });
  it("harness remains reproducible with derived provider, no new acceptance policy", async () => {
    const run = () => runEvaluation([financial], { jev: make(fake([{ skill: "financial", shape: "single" }, { metric: "service_revenue", period: "yesterday" }])), maxCalls: 1 });
    expect(await run()).toEqual(await run()); expect((await run()).jev.rows[0]).toMatchObject({ match: { decision: true }, acceptedByEvaluationPolicy: false });
  });
  it("offline matrix, audit and revalidation artifacts are generated, not hand-edited gabaritos", () => {
    const audit = prepareDerivedAudit(), plan = prepareDerivedRevalidation();
    expect(audit.cases).toHaveLength(40); expect(decisionMatrix()).toHaveLength(6);
    expect(audit.cases.filter(c => c.category === "A").every(c => c.plannedQuestions === 0)).toBe(true);
    expect(audit.cases.every(c => c.plannedQuestions <= c.previousQuestions)).toBe(true);
    expect(plan.cases.map(c => c.caseId)).toEqual(["financial-revenue", "inventory-low"]);
    expect(plan.cases.map(c => Object.keys(c.conditionalDetailPayload.questions))).toEqual([["metric", "period"], ["inventory"]]);
    expect(plan.maxHttpCalls).toBe(4); expect(plan.executed).toBe(false);
    expect(JSON.parse(readFileSync("packages/salon-secretary/evaluation/derived-audit.json", "utf8"))).toEqual(audit);
    expect(JSON.parse(readFileSync("packages/salon-secretary/evaluation/derived-revalidation.json", "utf8"))).toEqual(plan);
    for (const c of audit.cases) expect(c.expectedUnchanged).toEqual(dataset.find(x => x.id === c.caseId)!.expected.decision);
  });
});
