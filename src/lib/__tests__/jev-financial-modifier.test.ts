import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseConditionalStage } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import { modifierCases, modifierDetailRequest, modifierDiscoveryRequest, prepareModifierPlan } from "../../../packages/salon-secretary/evaluation/financial-modifier-plan";
import { evaluateModifierObservation, scoreModifierObservation } from "../../../packages/salon-secretary/evaluation/financial-modifier-evaluation";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { initialAllowlist } from "../../../packages/salon-secretary/evaluation/acceptance-policy";

const plan = prepareModifierPlan();
function response(request: JevWireRequest, selections: Record<string, string>) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id,
    { type: "choice", choice: selections[id], probabilities: Object.fromEntries(Object.keys(question.criteria).map(c => [c, c === selections[id] ? 1 : 0])), confidence: 1 as number | undefined }])),
  usage: { input_tokens: 100, output_tokens: 40 } };
}
const c = (id: string) => plan.cases.find(c => c.id === id)!;
function trial(id: string, overrides: Record<string, string> = {}) {
  const row = c(id), discovery = response(row.payloads.discovery, { skill: "financial", shape: "single" });
  const detail = response(row.payloads.detail, { metric: row.expected.metric, period: row.expected.period,
    financial_complexity: row.expected.complexity, ...overrides });
  return { row, discovery, detail, run: () => evaluateModifierObservation(row.message, discovery, detail) };
}

describe("Financial modifier design: synthetic offline checks, not calibration evidence", () => {
  it("freezes 40 cases, payloads and immutable predecessors", () => {
    const bytes = readFileSync("packages/salon-secretary/evaluation/financial-modifier-plan.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("f2bb218a6744fab61cefe9748cecde1c1276c420219ecd118815a8b15b7a7af2");
    expect(JSON.parse(bytes.toString())).toEqual(plan);
    expect(plan.counts).toEqual({ SIMPLE: 14, MODIFIED: 18, UNCLEAR: 8 });
    expect(plan.maxHttpCalls).toBe(80);
    expect(plan.executed).toBe(false);
    expect(plan.pricing.maximumPlanningEstimateUsd).toBe(0.21504);
    expect(new Set(modifierCases.map(c => c.message)).size).toBe(40);
    expect(initialAllowlist).toHaveLength(2);
  });
  it("sends only old discovery and conditional Financial detail plus ONE Choice; no oracle", () => {
    for (const row of plan.cases) {
      expect(Object.keys(row.payloads.discovery.questions)).toEqual(["skill", "shape"]);
      expect(Object.keys(row.payloads.detail.questions)).toEqual(["metric", "period", "financial_complexity"]);
      expect(Object.keys(row.payloads.detail.questions.financial_complexity.criteria)).toEqual(["SIMPLE", "MODIFIED", "UNCLEAR"]);
      expect(row.payloads.detail.state).toEqual({ message: row.message, context: {}, selected_skill: "financial", selection_source: "prior_jev_discovery" });
      expect(JSON.stringify(row.payloads)).not.toMatch(/"(?:expected|semanticSignature|boundary|polarity|phone|customer_ref|salonId|operation)"\s*:/);
      expect(row.payloadBytes.detail - row.payloadBytes.oldDetail).toBe(1529);
    }
  });
  it.each(["scheduling", "inventory", "communication", "services", "customers", "out_of_catalog", "unclear", "multiple"])("never asks Financial complexity for discovery %s", skill => {
    const request = modifierDiscoveryRequest("Consulta sintética"), result = parseConditionalStage(response(request, { skill, shape: "single" }), request);
    expect(modifierDetailRequest("Consulta sintética", result)).toBeNull();
  });
  it.each(["independent", "dependent", "unclear", "out_of_catalog"])("short circuits shape %s", shape => {
    const request = c("s01").payloads.discovery, result = parseConditionalStage(response(request, { skill: "financial", shape }), request);
    expect(modifierDetailRequest(c("s01").message, result)).toBeNull();
  });
  it.each(plan.cases.filter(c => c.expected.complexity === "SIMPLE").map(c => c.id))("%s closes the reviewed signature but NEVER changes policy acceptance", id => {
    const t = trial(id), observation = t.run(), scored = scoreModifierObservation(t.row, observation);
    expect(observation).toMatchObject({ providerValid: true, signatureCandidate: true, accepted: false, requiresLuna: true });
    expect(observation.derivation).toMatchObject({ operation: "financial.report", provenance: "DETERMINISTIC_DERIVATION" });
    expect(observation.derivation).not.toHaveProperty("confidence");
    expect(scored).toMatchObject({ potentialFullBypass: true, falseSimple: false, unsafeAccepted: false });
  });
  it.each(plan.cases.filter(c => c.expected.complexity === "MODIFIED").map(c => c.id))("%s never becomes candidate with MODIFIED", id => {
    const t = trial(id), result = t.run();
    expect(result.signatureCandidate).toBe(false);
    expect(result.accepted).toBe(false);
  });
  it.each(plan.cases.filter(c => c.expected.complexity === "UNCLEAR").map(c => c.id))("%s remains fallback even if discovery mistakenly says Financial", id => {
    expect(trial(id).run()).toMatchObject({ signatureCandidate: false, accepted: false, requiresLuna: true });
  });
  it.each([["s01", "m01"], ["s02", "m02"], ["s04", "m03"], ["s06", "m04"], ["s08", "m05"], ["s12", "m06"]])("%s vs %s: identical metric/period cannot hide modifier", (simple, modified) => {
    expect(c(simple).expected.metric).toBe(c(modified).expected.metric);
    expect(c(simple).expected.period).toBe(c(modified).expected.period);
    expect(trial(simple).run().signatureCandidate).toBe(true);
    expect(trial(modified).run().signatureCandidate).toBe(false);
    const wrong = trial(modified, { financial_complexity: "SIMPLE" });
    expect(scoreModifierObservation(wrong.row, wrong.run())).toMatchObject({ falseSimple: true, detectorFalseSimple: true, disposition: "STOP", accepted: false });
  });
  it("detects linguistic error even if derived operation is structurally correct", () => {
    const wrong = trial("s04", { metric: "service_revenue" });
    expect(wrong.run().signatureCandidate).toBe(true);
    expect(scoreModifierObservation(wrong.row, wrong.run())).toMatchObject({ unsafeSignature: true, potentialFullBypass: false, disposition: "STOP" });
  });
  it("no lexical bans: com, cada, mais, and a negated neighboring metric can still be SIMPLE", () => {
    for (const id of ["s09", "s11", "s13", "s14"]) expect(trial(id).run().signatureCandidate).toBe(true);
  });
  it("current receivables require none, no historical period; missing required period fails closed", () => {
    expect(trial("s06").run().signatureCandidate).toBe(true);
    expect(trial("s06", { period: "yesterday" }).run()).toMatchObject({ signatureCandidate: false, reason: "PERIOD_INCOMPATIBLE" });
    expect(trial("s01", { period: "none" }).run().signatureCandidate).toBe(false);
  });
  it.each(["completed_count", "none", "multiple", "unclear"])("%s cannot bypass even with SIMPLE/confidence 1", metric => {
    expect(trial("s01", { metric }).run()).toMatchObject({ signatureCandidate: false, reason: "METRIC_EXCLUDED_OR_UNRESOLVED" });
  });
  it("missing or UNCLEAR complexity never qualifies", () => {
    expect(trial("s01", { financial_complexity: "UNCLEAR" }).run().signatureCandidate).toBe(false);
    const t = trial("s01"); delete t.detail.answers.financial_complexity;
    expect(t.run()).toMatchObject({ providerValid: false, signatureCandidate: false, reason: "INVALID_PROVIDER_RESPONSE" });
  });
  it.each([0.99, 1.01, 0.98, 1.02])("sum %s remains invalid, no repair, diagnosed fallback can continue", sum => {
    const t = trial("s01"), a = t.detail.answers.financial_complexity;
    a.probabilities = { SIMPLE: sum - 0.2, MODIFIED: 0.1, UNCLEAR: 0.1 };
    const before = JSON.stringify(t.detail), result = t.run();
    expect(result).toMatchObject({ providerValid: false, signatureCandidate: false, accepted: false, disposition: "CONTINUE" });
    expect(result.detail?.diagnostic).toMatchObject({ reason: "PROBABILITY_SCHEMA_INVALID", path: "answers.financial_complexity.probabilities" });
    expect(JSON.stringify(t.detail)).toBe(before);
  });
  it("unknown field stops; no permissive recovery", () => {
    const t = trial("s01");
    expect(evaluateModifierObservation(t.row.message, t.discovery, { ...t.detail, unexpected: true })).toMatchObject({ disposition: "STOP", accepted: false });
  });
  it("confidence missing fails closed, low confidence/small margin is data not a threshold or authorization", () => {
    const t = trial("s01"); t.detail.answers.financial_complexity.confidence = undefined;
    expect(t.run()).toMatchObject({ signatureCandidate: false, reason: "MISSING_CONFIDENCE" });
    t.detail.answers.financial_complexity.confidence = 0.01;
    t.detail.answers.financial_complexity.probabilities = { SIMPLE: 0.34, MODIFIED: 0.33, UNCLEAR: 0.33 };
    expect(t.run()).toMatchObject({ signatureCandidate: true, accepted: false });
    expect(t.run().decisions.financial_complexity.margin).toBeCloseTo(0.01);
  });
  it("out-of-catalog short circuit is safe but no detector correctness observation", () => {
    const row = c("u01"), raw = response(row.payloads.discovery, { skill: "out_of_catalog", shape: "out_of_catalog" });
    const observed = evaluateModifierObservation(row.message, raw);
    expect(observed).toMatchObject({ signatureCandidate: false, accepted: false, detail: null });
    expect(scoreModifierObservation(row, observed).detectorEvaluated).toBe(false);
    expect(evaluateModifierObservation(row.message, raw, {}).disposition).toBe("STOP");
  });
  it("input privacy guard rejects a phone before any provider invocation", () => {
    expect(() => modifierDiscoveryRequest("Ligue para +55 11 99999-0000")).toThrow();
  });
});

// Historical source seals verify archived bytes; module execution uses the current implementation.
// Live admission against these old seals remains fail-closed, checked independently.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
