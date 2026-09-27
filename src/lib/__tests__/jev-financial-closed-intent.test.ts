import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessJevAcceptance, initialAllowlist } from "../../../packages/salon-secretary/evaluation/acceptance-policy";
import { parseConditionalStage } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import { choiceSets, emptyResult, type EvaluationResult, type QuestionId } from "../../../packages/salon-secretary/evaluation/contract";
import { derivationCatalog, derivationCatalogHash, deriveOperation } from "../../../packages/salon-secretary/evaluation/derivation-catalog";
import { derivedResult, type DerivedResult } from "../../../packages/salon-secretary/evaluation/derived-plan";
import { assertClosedFinancialBudget, assertClosedFinancialPayload, readFrozenClosedFinancialPlan,
  FROZEN_CLOSED_FINANCIAL_PLAN_SHA256 } from "../../../packages/salon-secretary/evaluation/financial-closed-intent-freeze";
import { hasReviewedClosedSemantics, nextClosedFinancialStage, scoreClosedFinancialTrial,
  summarizeClosedFinancialTrials } from "../../../packages/salon-secretary/evaluation/financial-closed-intent-harness";
import { candidateMetrics, closedFinancialCases, prepareClosedFinancialPlan,
  type ClosedFinancialCase } from "../../../packages/salon-secretary/evaluation/financial-closed-intent-plan";
import { diagnoseInvalidJevResponse, sanitizeInvalidJevResponse } from "../../../packages/salon-secretary/evaluation/invalid-response-diagnostic";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";
import type { WaveRoundEvidence } from "../../../packages/salon-secretary/evaluation/coverage-expansion-wave-harness";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK_IN_CLOSED_FINANCIAL_TEST"); })));
afterEach(() => vi.unstubAllGlobals());
const byId = (id: string) => closedFinancialCases.find(c => c.id === id)!;
const plan = prepareClosedFinancialPlan();
const frozen = readFrozenClosedFinancialPlan();
const payload = (id: string, stage: "discovery" | "detail") => frozen.cases.find(c => c.id === id)!.payloads[stage];
const selected = (request: JevWireRequest, id: QuestionId, choice: string) => ({ choice,
  probabilities: Object.fromEntries(Object.keys(request.questions[id].criteria).map(value => [value, value === choice ? 1 : 0])), confidence: 1 });
const successfulStage = (request: JevWireRequest, choices: Partial<Record<QuestionId, string>>): EvaluationResult => {
  const r = emptyResult("JEV");
  r.status = "OK"; r.modelRequested = JEV_MODEL; r.modelReturned = JEV_MODEL;
  for (const [id, choice] of Object.entries(choices)) r.answers[id as QuestionId] = selected(request, id as QuestionId, choice);
  return r;
};
const roundsFor = (result: DerivedResult): WaveRoundEvidence[] => result.stages.map(s => ({
  httpStatus: 200, status: s.result.status, error: s.result.error,
  sentBytes: Buffer.byteLength(JSON.stringify(s.request)), request: s.request,
  invalidResponseDiagnostic: s.result.invalidResponseDiagnostic ?? null,
}));
function validFinancialResult(c: ClosedFinancialCase, metric = c.expected.decision.metric, period = c.expected.decision.period): DerivedResult {
  const discoveryRequest = payload(c.id, "discovery"), detailRequest = payload(c.id, "detail");
  const discovery = successfulStage(discoveryRequest, { skill: "financial", shape: "single" });
  const detail = successfulStage(detailRequest, { metric, period });
  const result = derivedResult(), d = deriveOperation("financial", "single", "metric", metric);
  result.status = "OK"; result.error = null; result.modelRequested = JEV_MODEL; result.modelReturned = JEV_MODEL;
  result.stages = [{ stage: { kind: "discovery" }, request: discoveryRequest, result: discovery },
    { stage: { kind: "detail", skill: "financial" }, request: detailRequest, result: detail }];
  result.answers = { ...discovery.answers, ...detail.answers };
  for (const id of ["skill", "shape", "metric", "period"] as QuestionId[]) result.dimensionSources[id] = "ASKED";
  for (const id of ["inventory", "communication"] as QuestionId[]) result.dimensionSources[id] = "NOT_APPLICABLE";
  if (d.ok) { result.derivations = [d.derivation]; result.dimensionSources.operation = "DERIVED"; }
  result.decision = { skill: "financial", shape: "single", metric, period,
    operation: d.ok ? d.derivation.operation : "unclear", inventory: "none", communication: "none" };
  result.dependencies = []; result.closedCoverage = d.ok; result.requiresLuna = !d.ok;
  result.fallbackReasons = ["NO_ACCEPTANCE_POLICY"];
  result.usage = { inputTokens: 90, outputTokens: 0 }; result.estimatedCostUsd = 90 * 0.042 / 1_000_000;
  return result;
}

describe("frozen Financial closed-intent calibration, offline only", () => {
  it("freezes exactly 10 positives in five equal-signature paraphrase pairs and 11 adversarials", () => {
    expect(plan).toEqual(frozen);
    expect(FROZEN_CLOSED_FINANCIAL_PLAN_SHA256).toHaveLength(64);
    expect(frozen).toMatchObject({ executed: false, evaluationOnly: true, caseCount: 21,
      positiveCount: 10, adversarialCount: 11, maxHttpCalls: 42,
      maximumPlanningEstimateUsd: 0.112896 });
    const positives = closedFinancialCases.filter(c => c.polarity === "POSITIVE");
    expect(positives).toHaveLength(10);
    for (const family of candidateMetrics) {
      const pair = positives.filter(c => c.family === family);
      expect(pair).toHaveLength(2);
      expect(pair[0].message).not.toBe(pair[1].message);
      expect(pair[0].semanticSignature).toEqual(pair[1].semanticSignature);
      expect(pair[0].expected.decision).toEqual(pair[1].expected.decision);
      expect(pair.every(c => hasReviewedClosedSemantics(c))).toBe(true);
    }
    expect(positives.some(c => initialAllowlist.some(a => a.message === c.message))).toBe(false);
  });

  it("keeps current receivables periodless while every other positive has a published closed period", () => {
    for (const c of closedFinancialCases.filter(c => c.polarity === "POSITIVE")) {
      expect(c.semanticSignature.period).toBe(c.family === "outstanding_receivables" ? "none" : "yesterday");
      expect(c.expected.decision.period).toBe(c.semanticSignature.period);
    }
    expect(byId("n09").semanticSignature).toMatchObject({ metric: "outstanding_receivables",
      period: "yesterday", unsupportedIntent: "historical_receivables" });
    expect(hasReviewedClosedSemantics(byId("n09"))).toBe(false);
    // The unchanged Financial detail asks period=none to detect an erroneous historical request.
    expect(Object.keys(payload("p05", "detail").questions)).toEqual(["metric", "period"]);
  });

  it("derives the same published operation from each of the five closed metrics without operation questions", () => {
    for (const metric of candidateMetrics) {
      const d = deriveOperation("financial", "single", "metric", metric);
      expect(d).toMatchObject({ ok: true, derivation: { operation: "financial.report", source: { value: metric },
        catalogVersion: derivationCatalog.version, catalogHash: derivationCatalogHash(derivationCatalog) } });
    }
    for (const c of frozen.cases) {
      expect(Object.keys(c.payloads.discovery.questions)).toEqual(["skill", "shape"]);
      expect(Object.keys(c.payloads.detail.questions)).toEqual(["metric", "period"]);
      expect(Object.keys(c.payloads.detail.questions)).not.toContain("operation");
      expect(Object.keys(c.payloads.discovery.questions.skill.criteria)).toEqual(choiceSets.skill);
      expect(Object.keys(c.payloads.detail.questions.metric.criteria)).toEqual(choiceSets.metric);
    }
  });

  it("does not route detail using expected or a non-Financial discovery", () => {
    const financial = successfulStage(payload("p01", "discovery"), { skill: "financial", shape: "single" });
    expect(nextClosedFinancialStage(financial)).toBe("FINANCIAL_DETAIL");
    expect(assertClosedFinancialPayload("p01", "detail", payload("p01", "detail"), "synthetic-key", financial)).toContain('"questions"');
    const other = successfulStage(payload("n07", "discovery"), { skill: "out_of_catalog", shape: "out_of_catalog" });
    expect(nextClosedFinancialStage(other)).toBe("FALLBACK_REQUIRED");
    expect(() => assertClosedFinancialPayload("n07", "detail", payload("n07", "detail"), "synthetic-key", other)).toThrow("FINANCIAL_DETAIL_NOT_AUTHORIZED_BY_DISCOVERY");
    expect(() => assertClosedFinancialPayload("p01", "detail", payload("p01", "detail"), "synthetic-key")).toThrow();
  });

  it("freezes only sendable questions/choices and rejects oracle or credential leakage", () => {
    for (const c of frozen.cases) {
      for (const stage of ["discovery", "detail"] as const) {
        const body = JSON.stringify(c.payloads[stage]);
        expect(body).not.toMatch(/"(?:expected|semanticSignature|classification|evidence|domainFields|TYPESAFE_API_KEY)"/i);
        expect(body).not.toMatch(/"(?:phone|customer_ref|salonId|product_ref)"/i);
        expect(body).not.toContain("synthetic-key");
        expect(c.payloadBytes[stage]).toBe(Buffer.byteLength(body));
      }
    }
    expect(() => assertClosedFinancialPayload("p01", "discovery", { ...payload("p01", "discovery"),
      state: { message: byId("p01").message, expected: byId("p01").expected } }, "synthetic-key")).toThrow("FORBIDDEN_PAYLOAD_DATA");
    expect(() => assertClosedFinancialPayload("p01", "discovery", payload("p01", "discovery"), "")).toThrow();
    expect(readFileSync("packages/salon-secretary/evaluation/financial-closed-intent-plan.json", "utf8")).not.toContain("TYPESAFE_API_KEY=");
  });

  it("enforces the frozen HTTP and planning-cost ceilings before a future request", () => {
    expect(assertClosedFinancialBudget(0, null)).toMatchObject({ remainingHttp: 42, ceilingUsd: 0.112896 });
    expect(assertClosedFinancialBudget(42, null).remainingHttp).toBe(0);
    expect(() => assertClosedFinancialBudget(43, null)).toThrow("CLOSED_FINANCIAL_BUDGET_EXCEEDED");
    expect(() => assertClosedFinancialBudget(2, 0.12)).toThrow("CLOSED_FINANCIAL_BUDGET_EXCEEDED");
    expect(() => assertClosedFinancialBudget(-1, 0)).toThrow("CLOSED_FINANCIAL_BUDGET_EXCEEDED");
  });

  it("labels ranking, grouping, comparison, filter, metric set and compound as incomplete even with matching core", () => {
    for (const id of ["n01", "n02", "n03", "n04", "n06", "n10"]) {
      const c = byId(id);
      expect(c.expected.fullBypassSemanticallyPossible).toBe(false);
      expect(hasReviewedClosedSemantics(c)).toBe(false);
    }
    expect(byId("n01").semanticSignature.modifiers).toMatchObject({ groupBy: "professional", ranking: { direction: "highest", limit: 1 } });
    expect(byId("n03").semanticSignature.modifiers.comparison).toEqual({ current: "this_week", previous: "last_week" });
    expect(byId("n06").semanticSignature).toMatchObject({ requiresOpenExtraction: true,
      modifiers: { entityFilter: { dimension: "professional", mention: "Ana Lima" } } });
    expect(byId("n04").semanticSignature).toMatchObject({ skill: "multiple", shape: "independent", requiresOpenExtraction: true });
  });

  it("keeps completed_count and out-of-catalog actions outside the five calibrated families", () => {
    expect(byId("n05")).toMatchObject({ expected: { classification: "COMPLETED_COUNT_KEEP_LUNA", fullBypassSemanticallyPossible: false } });
    expect(byId("n07")).toMatchObject({ semanticSignature: { unsupportedIntent: "refund" },
      expected: { classification: "OUT_OF_CATALOG", derivation: null } });
    expect(byId("n09")).toMatchObject({ expected: { classification: "OUT_OF_CATALOG" } });
  });

  it("uses contrast and a different period as closed adversarial probes, without adding them to the allowlist", () => {
    expect(byId("n08")).toMatchObject({ semanticSignature: { metric: "received_revenue", period: "yesterday" },
      expected: { classification: "CLOSED_NEIGHBOR", fullBypassSemanticallyPossible: true } });
    expect(byId("n11")).toMatchObject({ semanticSignature: { metric: "received_revenue", period: "today" },
      expected: { classification: "CLOSED_NEIGHBOR", fullBypassSemanticallyPossible: true } });
    expect(initialAllowlist).toHaveLength(2);
    expect(initialAllowlist.some(a => a.message === byId("n08").message || a.message === byId("n11").message)).toBe(false);
  });

  it("records a high-confidence selector-only ranking as unsafe shadow but never accepts it", () => {
    const c = byId("n01"), result = validFinancialResult(c);
    const score = scoreClosedFinancialTrial(c, result, roundsFor(result));
    expect(score).toMatchObject({ linguisticCorrect: true, providerValid: true, closedOracle: false,
      shadowSelectorCandidate: true, unsafeShadowCandidate: true, unsafeFalsePositive: false,
      policyDecision: "FALLBACK_REQUIRED", disposition: "CONTINUE_WAVE" });
    expect(score.confidence.every(x => x.confidence === 1)).toBe(true);
    expect(assessJevAcceptance({ message: c.message, context: {} }, result).decision).toBe("FALLBACK_REQUIRED");
  });

  it("marks wrong metric as unsafe selector-only projection despite high confidence", () => {
    const c = byId("p01"), wrong = validFinancialResult(c, "received_revenue");
    const score = scoreClosedFinancialTrial(c, wrong, roundsFor(wrong));
    expect(score).toMatchObject({ linguisticCorrect: false, unsafeShadowCandidate: true,
      unsafeFalsePositive: false, policyDecision: "FALLBACK_REQUIRED" });
  });

  it("scores a correct new paraphrase for calibration without silently promoting the Policy", () => {
    const c = byId("p02"), result = validFinancialResult(c);
    const score = scoreClosedFinancialTrial(c, result, roundsFor(result));
    expect(score).toMatchObject({ linguisticCorrect: true, semanticCompletenessForThisOracle: true,
      shadowSelectorCandidate: true, unsafeShadowCandidate: false, policyDecision: "FALLBACK_REQUIRED",
      policyReason: "UNCALIBRATED_INPUT", classification: "CORRECT_FALLBACK" });
  });

  it.each([0.99, 1.01])("keeps strict probability sum %s invalid, fail-closed, and continuable only with a known diagnosis", sum => {
    const c = byId("p01"), request = payload(c.id, "discovery");
    const raw = { model: JEV_MODEL, answers: {
      skill: { type: "choice", choice: "financial", probabilities: Object.fromEntries(Object.keys(request.questions.skill.criteria)
        .map(choice => [choice, choice === "financial" ? sum : 0])), confidence: 1 },
      shape: { type: "choice", ...selected(request, "shape", "single") },
    }, usage: { input_tokens: 80, output_tokens: 0 } };
    expect(() => parseConditionalStage(raw, request)).toThrow();
    const location = diagnoseInvalidJevResponse(raw, request), stage = emptyResult("JEV");
    expect(location).toMatchObject({ reason: "PROBABILITY_SCHEMA_INVALID", path: expect.stringMatching(/^answers\.skill\.probabilities(?:\.financial)?$/) });
    stage.error = "INVALID_RESPONSE";
    stage.invalidResponseDiagnostic = { ...location, httpStatus: 200, requestId: "synthetic-request",
      sanitizedInvalidResponse: sanitizeInvalidJevResponse(raw, request) };
    const result = derivedResult();
    result.status = "ERROR"; result.error = "INVALID_RESPONSE"; result.fallbackReasons = ["INVALID_RESPONSE"];
    result.stages = [{ stage: { kind: "discovery" }, request, result: stage }];
    const rounds: WaveRoundEvidence[] = [{ httpStatus: 200, status: "ERROR", error: "INVALID_RESPONSE",
      request, sentBytes: Buffer.byteLength(JSON.stringify(request)), invalidResponseDiagnostic: stage.invalidResponseDiagnostic }];
    const score = scoreClosedFinancialTrial(c, result, rounds);
    expect(score).toMatchObject({ classification: "INVALID_PROVIDER_RESPONSE", policyDecision: "FALLBACK_REQUIRED",
      knownInvalidCategory: sum === 0.99 ? "invalid_probability_sum" : "invalid_probability_other", disposition: "CONTINUE_WAVE",
      semanticCompletenessForThisOracle: false, unsafeFalsePositive: false });
    stage.invalidResponseDiagnostic = { ...stage.invalidResponseDiagnostic, reason: "UNEXPECTED_FIELD" as typeof location.reason };
    expect(scoreClosedFinancialTrial(c, result, rounds).disposition).toBe("STOP_WAVE");
  });

  it("stops on HTTP 500 and timeout without retries", () => {
    const c = byId("p01"), result = validFinancialResult(c), rounds = roundsFor(result);
    rounds[0].httpStatus = 500;
    expect(scoreClosedFinancialTrial(c, result, rounds)).toMatchObject({ disposition: "STOP_WAVE", stopReason: "HTTP_500" });
    result.error = "TIMEOUT"; result.status = "ERROR";
    rounds[0].httpStatus = null;
    expect(scoreClosedFinancialTrial(c, result, rounds)).toMatchObject({ disposition: "STOP_WAVE", stopReason: "TIMEOUT" });
  });

  it("keeps provider reliability, linguistic correctness and Policy acceptance separate", () => {
    const good = byId("p02"), ranking = byId("n01");
    const goodResult = validFinancialResult(good), rankingResult = validFinancialResult(ranking);
    const report = summarizeClosedFinancialTrials([
      { case: good, result: goodResult, rounds: roundsFor(goodResult), timings: { preparationMs: 1, policyMs: 2, totalMs: 5 } },
      { case: ranking, result: rankingResult, rounds: roundsFor(rankingResult), timings: { preparationMs: 2, policyMs: 3, totalMs: 8 } },
    ]);
    expect(report).toMatchObject({ counts: { evaluated: 2, correctAccept: 0, unsafeFalsePositive: 0 },
      providerReliability: { attemptedHttp: 4, validResponses: 4 }, linguisticAccuracyAmongValid: 1,
      semanticCompletenessAmongValid: 0.5, acceptanceAccuracyAmongAccepted: null, httpCalls: 4,
      missingCostEvaluations: 0, evaluationOnly: true,
      policyLatencyMs: { n: 2, p50: 2.5 }, totalLatencyMs: { n: 2, p50: 6.5 } });
    expect(() => scoreClosedFinancialTrial(good, goodResult, roundsFor(goodResult), { policyMs: -1 })).toThrow("INVALID_EVALUATION_TIMING");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

// Historical source seals verify archived bytes; module execution uses the current implementation.
// Live admission against these old seals remains fail-closed, checked independently.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
