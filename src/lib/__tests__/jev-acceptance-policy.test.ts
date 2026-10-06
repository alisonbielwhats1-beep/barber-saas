import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataset } from "../../../packages/salon-secretary/evaluation/dataset";
import { auditAcceptanceDataset, scoreAcceptanceTrials } from "../../../packages/salon-secretary/evaluation/acceptance-audit";
import { prepareAcceptanceCalibrationPlan } from "../../../packages/salon-secretary/evaluation/acceptance-calibration-plan";
import { assessJevAcceptance, initialAllowlist, operationRisk, risksForPlan } from "../../../packages/salon-secretary/evaluation/acceptance-policy";
import { derivationCatalog, publishedDecisionCatalog, type DerivationCatalog } from "../../../packages/salon-secretary/evaluation/derivation-catalog";
import { DerivedJevProvider } from "../../../packages/salon-secretary/evaluation/derived-provider";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";

const get = (id: string) => dataset.find(c => c.id === id)!;
function wire(req: JevWireRequest, choices: Record<string, string>, confidence: number | null = 0.8) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => {
    const values = Object.keys(q.criteria), chosen = choices[id];
    return [id, { type: "choice", choice: chosen, ...(confidence === null ? {} : { confidence }),
      probabilities: Object.fromEntries(values.map(v => [v, v === chosen ? 0.8 : 0.2 / (values.length - 1)])) }];
  })), usage: { input_tokens: 100, output_tokens: 0 } };
}
async function result(id: string, discovery: Record<string, string>, detail?: Record<string, string>, confidence: number | null = 0.8) {
  let call = 0;
  const transport = vi.fn<typeof fetch>(async (_, init) => {
    const req = JSON.parse(init!.body as string) as JevWireRequest;
    return new Response(JSON.stringify(wire(req, [discovery, detail ?? {}][call++], confidence)));
  });
  const value = await new DerivedJevProvider({ transport, credential: () => "synthetic-unit-key", maxCalls: 2, now: () => 1 }).evaluate(get(id).input);
  return { value, transport };
}
const validFinancial = () => result("financial-revenue", { skill: "financial", shape: "single" }, { metric: "service_revenue", period: "yesterday" });
const validInventory = () => result("inventory-low", { skill: "inventory", shape: "single" }, { inventory: "low_stock" });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); })));
afterEach(() => vi.unstubAllGlobals());

describe("JEV acceptance policy — closed evaluation only", () => {
  it("accepts only the two evidenced closed read-only interpretations without executable authority", async () => {
    for (const [id, make] of [["financial-revenue", validFinancial], ["inventory-low", validInventory]] as const) {
      const { value, transport } = await make();
      const verdict = assessJevAcceptance(get(id).input, value);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(verdict).toMatchObject({ decision: "ACCEPT_JEV", reason: "ACCEPTED_CLOSED_DECISION", enrollmentId: id,
        riskClasses: ["READ_ONLY"], provenance: { skill: "JEV", shape: "JEV", operation: "DETERMINISTIC_DERIVATION" }, executable: false });
      expect(verdict.interpretation?.operation).toBe(get(id).expected.decision.operation);
      expect(verdict.confidenceData).toHaveLength(id === "financial-revenue" ? 4 : 3);
      expect(verdict.confidenceData.every(x => x.correct === null && x.margin > 0)).toBe(true);
      expect(value.accepted).toBe(false); expect(value.executable).toBe(false); expect(global.fetch).not.toHaveBeenCalled();
    }
  });
  it("rejects high-confidence wrong Skill and a valid derivation from the wrong metric", async () => {
    const wrongSkill = await result("financial-revenue", { skill: "inventory", shape: "single" }, { inventory: "low_stock" }, 1);
    expect(wrongSkill.value.decision?.operation).toBe("product.search");
    expect(assessJevAcceptance(get("financial-revenue").input, wrongSkill.value).decision).toBe("FALLBACK_REQUIRED");
    const wrongMetric = await result("financial-revenue", { skill: "financial", shape: "single" }, { metric: "received_revenue", period: "yesterday" }, 1);
    expect(wrongMetric.value.decision?.operation).toBe("financial.report");
    expect(assessJevAcceptance(get("financial-revenue").input, wrongMetric.value)).toMatchObject({ decision: "FALLBACK_REQUIRED", reason: "CONTRADICTORY_DECISION" });
  });
  it("rejects unknown phrase with otherwise perfect known decisions", async () => {
    const { value } = await validFinancial();
    expect(assessJevAcceptance({ message: "Quanto recebi ontem?", context: {} }, value).decision).toBe("FALLBACK_REQUIRED");
    expect(assessJevAcceptance({ message: "Quanto faturei ontem? E cancele Amanda.", context: {} }, value).decision).toBe("FALLBACK_REQUIRED");
    expect(assessJevAcceptance({ message: "Quanto faturei ontem?", context: { operation: "financial.report" } }, value).reason).toBe("UNCALIBRATED_INPUT");
  });
  it("does not collapse extra skills, operations, or a changed provider request into a closed case", async () => {
    const { value } = await validFinancial();
    const extraSkill = structuredClone(value); extraSkill.resolvedSkills = ["financial", "services"];
    expect(assessJevAcceptance(get("financial-revenue").input, extraSkill).reason).toBe("CONTRADICTORY_DECISION");
    const extraOperation = structuredClone(value); extraOperation.interpretedOperations = ["financial.report", "service.change"];
    expect(assessJevAcceptance(get("financial-revenue").input, extraOperation).reason).toBe("CONTRADICTORY_DECISION");
    const changedRequest = structuredClone(value); changedRequest.stages[1].request.state = { message: "different" };
    expect(assessJevAcceptance(get("financial-revenue").input, changedRequest).reason).toBe("INVALID_PROVIDER_RESPONSE");
  });
  it("rejects a relevant unspecified, unclear, invalid choice and missing decision", async () => {
    const unspecified = await result("communication-missing-channel", { skill: "communication", shape: "single" }, { communication: "unspecified" });
    expect(assessJevAcceptance(get("communication-missing-channel").input, unspecified.value).reason).toBe("UNSPECIFIED_DECISION");
    const unclear = await result("financial-revenue", { skill: "financial", shape: "single" }, { metric: "unclear", period: "yesterday" });
    expect(assessJevAcceptance(get("financial-revenue").input, unclear.value).reason).toBe("UNCLEAR_DECISION");
    const valid = (await validFinancial()).value;
    const invalid = structuredClone(valid); invalid.answers.metric!.choice = "not_published";
    expect(assessJevAcceptance(get("financial-revenue").input, invalid).decision).toBe("FALLBACK_REQUIRED");
    const missing = structuredClone(valid); delete missing.answers.period;
    expect(assessJevAcceptance(get("financial-revenue").input, missing).reason).toBe("INCOMPLETE_DECISIONS");
  });
  it("fails closed on missing, ambiguous and stale catalog mappings", async () => {
    const { value } = await validInventory(), input = get("inventory-low").input;
    const missing = structuredClone(derivationCatalog) as DerivationCatalog & { bindings: typeof derivationCatalog.bindings extends readonly (infer B)[] ? B[] : never };
    missing.bindings = missing.bindings.filter(b => b.value !== "low_stock");
    expect(assessJevAcceptance(input, value, { catalog: missing }).reason).toBe("INVALID_DERIVATION");
    const ambiguous = structuredClone(derivationCatalog) as { version: string; publicationHash: string; bindings: { skill: "inventory" | "financial" | "communication"; dimension: "inventory" | "metric" | "communication"; value: string; operations: (typeof derivationCatalog.bindings[number]["operations"][number])[]; evidence: string }[] };
    ambiguous.bindings.find(b => b.value === "low_stock")!.operations.push("stock.balance");
    expect(assessJevAcceptance(input, value, { catalog: ambiguous as DerivationCatalog }).reason).toBe("INVALID_DERIVATION");
    const stale = publishedDecisionCatalog(); (stale.registry[0] as { version: string }).version = "future";
    expect(assessJevAcceptance(input, value, { publication: stale }).reason).toBe("CATALOG_VERSION_MISMATCH");
  });
  it("rejects compounds, mutations, out-of-catalog and malformed provider data", async () => {
    const compound = await result("scheduling-batch", { skill: "scheduling", shape: "dependent" });
    expect(assessJevAcceptance(get("scheduling-batch").input, compound.value).reason).toBe("COMPOUND_REQUEST");
    const mutation = await result("scheduling-cancel", { skill: "scheduling", shape: "single" }, { operation: "appointment.cancel" });
    expect(assessJevAcceptance(get("scheduling-cancel").input, mutation.value).reason).toBe("UNSUPPORTED_RISK_CLASS");
    const outside = await result("outside-roles", { skill: "out_of_catalog", shape: "out_of_catalog" });
    expect(assessJevAcceptance(get("outside-roles").input, outside.value).reason).toBe("OUT_OF_CATALOG");
    for (const malformed of [null, {}, { provider: "JEV", planVersion: "derived-v3", accepted: false, executable: false, status: "OK", stages: [null] }]) {
      expect(assessJevAcceptance(get("financial-revenue").input, malformed)).toMatchObject({ decision: "FALLBACK_REQUIRED", reason: "INVALID_PROVIDER_RESPONSE" });
    }
  });
  it("does not accept missing confidence, ties, or incompatible high-confidence contracts", async () => {
    const noConfidence = await result("financial-revenue", { skill: "financial", shape: "single" }, { metric: "service_revenue", period: "yesterday" }, null);
    expect(assessJevAcceptance(get("financial-revenue").input, noConfidence.value).decision).toBe("FALLBACK_REQUIRED");
    const { value } = await validInventory();
    const tied = structuredClone(value), answer = tied.answers.inventory!;
    answer.probabilities = Object.fromEntries(Object.keys(answer.probabilities).map(k => [k, k === "low_stock" || k === "balance" ? 0.5 : 0]));
    tied.stages[1].result.answers.inventory = structuredClone(answer);
    expect(assessJevAcceptance(get("inventory-low").input, tied).reason).toBe("AMBIGUOUS_PROBABILITIES");
    const incompatible = structuredClone(value); incompatible.decision!.operation = "stock.balance";
    expect(assessJevAcceptance(get("inventory-low").input, incompatible).reason).toBe("CONTRADICTORY_DECISION");
    const near = structuredClone(value), nearAnswer = near.answers.inventory!;
    nearAnswer.probabilities = Object.fromEntries(Object.keys(nearAnswer.probabilities).map(k => [k, k === "low_stock" ? 0.50001 : k === "balance" ? 0.49999 : 0]));
    near.stages[1].result.answers.inventory = structuredClone(nearAnswer);
    const verdict = assessJevAcceptance(get("inventory-low").input, near);
    expect(verdict.confidenceData.find(d => d.dimension === "inventory")?.margin).toBeCloseTo(0.00002);
    // No arbitrary margin cut-off: exact enrollment and all structural checks still govern.
    expect(verdict.decision).toBe("ACCEPT_JEV");
  });
  it("gives existing authorized draft paths precedence and records no backend authority", async () => {
    const { value } = await validInventory();
    expect(assessJevAcceptance(get("inventory-quantity").input, value).reason).toBe("FAST_PATH_PRECEDENCE");
    const verdict = assessJevAcceptance(get("inventory-low").input, value);
    expect(verdict.backendOnly).toContain("product_ref"); expect(verdict.provenance.operation).toBe("DETERMINISTIC_DERIVATION");
    expect(verdict.provenance).not.toHaveProperty("product_ref"); expect(verdict.executable).toBe(false);
  });
});

describe("40-case offline coverage and calibration structure", () => {
  it("covers every published operation and routes all 40 without JEV results", () => {
    const audit = auditAcceptanceDataset();
    expect(audit.counts).toEqual({ FAST_PATH: 5, JEV_CANDIDATE: 2, FORCED_LUNA: 30, OUT_OF_CATALOG: 3 });
    expect(audit.riskMatrix).toHaveLength(18);
    expect(Object.keys(operationRisk).sort()).toEqual(audit.riskMatrix.map(x => x.operation).sort());
    expect(audit.cases.filter(c => c.route === "JEV_CANDIDATE").map(c => c.caseId).sort()).toEqual(initialAllowlist.map(x => x.id).sort());
    expect(audit.cases.find(c => c.caseId === "financial-revenue")).toMatchObject({ requiredForAcceptance: ["skill", "shape", "metric", "period"],
      derivations: [{ from: "metric:service_revenue", to: "financial.report" }] });
    expect(audit.cases.find(c => c.caseId === "inventory-low")).toMatchObject({ requiredForAcceptance: ["skill", "shape", "inventory"],
      derivations: [{ from: "inventory:low_stock", to: "product.search" }] });
    for (const c of audit.cases) {
      expect(c.decisionPlanDimensions).toBeDefined(); expect(c.riskClasses.length).toBeGreaterThan(0);
      if (c.route === "JEV_CANDIDATE") expect(c.riskClasses).toEqual(["READ_ONLY"]);
    }
    expect(audit.cases.find(c => c.caseId === "communication-dependent-name")?.riskClasses).toContain("COMPOUND_MUTATION");
    expect(risksForPlan({ operations: ["appointment.cancel", "appointment.create"], requiresOpenExtraction: true })).toContain("COMPOUND_MUTATION");
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("computes offline metrics without presenting synthetic examples as empirical calibration", async () => {
    const good = (await validFinancial()).value, bad = structuredClone((await validInventory()).value);
    bad.fallbackReasons.push("UNVERIFIED_EXTRA_REASON");
    const report = scoreAcceptanceTrials([{ trialId: "f-1", caseId: "financial-revenue", result: good }, { trialId: "i-1", caseId: "inventory-low", result: bad }]);
    expect(report.metrics).toMatchObject({ totalGoldenCases: 40, candidateCoverage: 0.05, acceptedCoverage: 0.5, fallbackRate: 0.5,
      correctAccepted: 1, incorrectAccepted: 0, unsafeFalsePositives: 0, falseFallback: 1, accuracyAmongAccepted: 1 });
    expect(report.metrics.confidenceDistribution.every(x => x.correct !== null && x.margin > 0)).toBe(true);
    expect(report.metrics.confidenceDistribution.filter(x => !x.accepted)).toHaveLength(3);
    expect(report.metrics.marginDistribution).toHaveLength(7);
    expect(report.metrics.coverageBySkill.financial).toEqual({ cases: 1, accepted: 1 });
    expect(report.metrics.coverageByRiskClass.READ_ONLY).toEqual({ cases: 2, accepted: 1 });
    expect(() => scoreAcceptanceTrials([{ trialId: "same", caseId: "financial-revenue", result: good }, { trialId: "same", caseId: "financial-revenue", result: good }])).toThrow("DUPLICATE_TRIAL");
  });
  it("freezes a 20-case, 40-HTTP maximum proposal without sending oracle or secrets", () => {
    const plan = prepareAcceptanceCalibrationPlan();
    expect(plan).toMatchObject({ executed: false, maxCases: 20, maxHttpCalls: 40, retries: 0, conservativeEstimatedMaxCostUsd: 0.10752 });
    expect(plan.cases.filter(c => c.route === "JEV_CANDIDATE")).toHaveLength(6);
    for (const c of plan.cases) {
      for (const payload of [c.discoveryPayload, c.conditionalDetailPayload].filter(x => x !== null)) {
        const serialized = JSON.stringify(payload);
        expect(serialized).toContain(c.message);
        expect(serialized).not.toContain('"expected"'); expect(serialized).not.toContain('"domainFields"');
        expect(serialized).not.toContain("TYPESAFE_API_KEY");
      }
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
