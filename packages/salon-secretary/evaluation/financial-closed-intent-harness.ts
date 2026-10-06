import { assessJevAcceptance, initialAllowlist } from "./acceptance-policy";
import { routeDiscovery } from "./conditional-plan";
import type { EvaluationResult, QuestionId } from "./contract";
import { derivationCatalog, derivationCatalogHash, deriveOperation, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import type { DerivedResult } from "./derived-plan";
import { invalidCategory, summarizeProviderReliability, type WaveRoundEvidence } from "./coverage-expansion-wave-harness";
import type { ClosedFinancialCase } from "./financial-closed-intent-plan";

/** Discovery drives detail; the golden expected/signature never selects a request branch. */
export function nextClosedFinancialStage(discovery: EvaluationResult): "FINANCIAL_DETAIL" | "FALLBACK_REQUIRED" {
  const route = routeDiscovery(discovery);
  return route.kind === "detail" && route.skill === "financial" ? "FINANCIAL_DETAIL" : "FALLBACK_REQUIRED";
}

/** A reviewed oracle signature is not a runtime modifier detector. */
export function hasReviewedClosedSemantics(c: ClosedFinancialCase) {
  const s = c.semanticSignature, m = s.modifiers;
  return c.expected.fullBypassSemanticallyPossible && s.skill === "financial" && s.shape === "single" &&
    !s.requiresOpenExtraction && s.unsupportedIntent === null &&
    m.comparison === null && m.groupBy === null && m.ranking === null && m.entityFilter === null &&
    m.metricSet === null && m.otherOperation === null;
}

const percentile = (numbers: number[], p: number) => {
  if (!numbers.length) return null;
  const v = [...numbers].sort((a, b) => a - b), index = (v.length - 1) * p, lo = Math.floor(index);
  return v[lo] + (v[Math.ceil(index)] - v[lo]) * (index - lo);
};
const distribution = (values: number[]) => ({ n: values.length, min: values.length ? Math.min(...values) : null,
  p50: percentile(values, 0.5), mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
  p95Descriptive: percentile(values, 0.95), max: values.length ? Math.max(...values) : null });

export type ClosedTrialClassification = "CORRECT_ACCEPT" | "CORRECT_FALLBACK" | "FALSE_FALLBACK" |
  "UNSAFE_FALSE_POSITIVE" | "OUT_OF_CATALOG_CORRECT" | "INVALID_PROVIDER_RESPONSE";
const knownInvalidReasons = new Set(["MALFORMED_PROVIDER_RESPONSE", "MISSING_FIELD", "INVALID_TYPE",
  "INVALID_CHOICE", "QUESTION_COUNT_MISMATCH", "PROBABILITY_SCHEMA_INVALID", "CONFIDENCE_SCHEMA_INVALID",
  "USAGE_SCHEMA_INVALID", "SEMANTIC_CONFLICT"]);

function knownFailClosedInvalid(result: DerivedResult, rounds: readonly WaveRoundEvidence[], policy: ReturnType<typeof assessJevAcceptance>) {
  if (result.status !== "ERROR" || result.error !== "INVALID_RESPONSE" || result.decision !== null ||
      result.closedCoverage || !result.requiresLuna || policy.decision !== "FALLBACK_REQUIRED" ||
      policy.reason !== "INVALID_PROVIDER_RESPONSE" || !result.fallbackReasons.includes("INVALID_RESPONSE")) return null;
  const stage = result.stages.at(-1), round = rounds.at(-1), diagnostic = stage?.result.invalidResponseDiagnostic;
  if (!stage || !round || !diagnostic || round.httpStatus !== 200 || diagnostic.httpStatus !== 200 ||
      result.stages.length !== rounds.length || round.status !== "ERROR" || round.error !== "INVALID_RESPONSE" ||
      JSON.stringify(round.request) !== JSON.stringify(stage.request) ||
      !knownInvalidReasons.has(diagnostic.reason) || !diagnostic.path ||
      diagnostic.sanitizedInvalidResponse.unexpectedTopLevelFieldCount !== 0 ||
      diagnostic.sanitizedInvalidResponse.unexpectedQuestionCount !== 0 ||
      diagnostic.sanitizedInvalidResponse.returnedQuestions.some(id => !(id in stage.request.questions)) ||
      Object.values(diagnostic.sanitizedInvalidResponse.answers).some(a => a.unexpectedFieldCount !== 0 || a.unexpectedProbabilityKeyCount !== 0)) return null;
  const path = diagnostic.path.split(".");
  if (!["$", "model", "answers", "usage"].includes(path[0]) ||
      (path[0] === "answers" && path.length > 1 && !(path[1] in stage.request.questions)) ||
      (diagnostic.reason === "PROBABILITY_SCHEMA_INVALID" && !(path[0] === "answers" && path[2] === "probabilities")) ||
      (diagnostic.reason === "CONFIDENCE_SCHEMA_INVALID" && !(path[0] === "answers" && path[2] === "confidence"))) return null;
  const category = invalidCategory(diagnostic, stage.request);
  return category;
}

/** Evaluation-only score. A selector match is separately exposed as a shadow risk, never as authorization. */
export type EvaluationTimings = { preparationMs?: number | null; policyMs?: number | null; totalMs?: number | null };
export function scoreClosedFinancialTrial(c: ClosedFinancialCase, result: DerivedResult, rounds: readonly WaveRoundEvidence[],
  timings: EvaluationTimings = {}) {
  for (const value of Object.values(timings)) if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0))
    throw Error("INVALID_EVALUATION_TIMING");
  const policy = assessJevAcceptance({ message: c.message, context: {} }, result);
  const expected = c.expected.decision;
  const required: QuestionId[] = expected.skill === "financial" && expected.shape === "single" ?
    ["skill", "shape", "metric", "period"] : ["skill", "shape"];
  const observedDecisions = required.map(dimension => ({ dimension, expected: expected[dimension],
    observed: result.answers[dimension]?.choice ?? null,
    correct: result.answers[dimension]?.choice === expected[dimension] }));
  const providerValid = result.error === null && result.stages.length > 0 && result.stages.every(s => s.result.status === "OK");
  const linguisticCorrect = providerValid && observedDecisions.every(d => d.correct);
  const closedOracle = hasReviewedClosedSemantics(c);
  const expectedDerivation = c.expected.derivation;
  const derivationResult = expectedDerivation ? deriveOperation("financial", "single", "metric", expectedDerivation.sourceValue) : null;
  const derivationValid = expectedDerivation === null ? result.derivations.length === 0 :
    derivationResult?.ok === true && result.derivations.length === 1 &&
    JSON.stringify(result.derivations[0]) === JSON.stringify(derivationResult.derivation);
  const fullyCorrectForThisOracle = linguisticCorrect && closedOracle && derivationValid && result.status === "OK" &&
    result.closedCoverage && !result.requiresLuna && result.decision?.operation === "financial.report";
  const accepted = policy.decision === "ACCEPT_JEV";
  const unsafeFalsePositive = accepted && !fullyCorrectForThisOracle;
  const falseFallback = !accepted && fullyCorrectForThisOracle &&
    initialAllowlist.some(entry => entry.message === c.message && entry.skill === "financial");
  const shadowSelectorCandidate = providerValid && result.closedCoverage && !result.requiresLuna;
  const unsafeShadowCandidate = shadowSelectorCandidate && !fullyCorrectForThisOracle;
  const invalid = result.error === "INVALID_RESPONSE";
  const classification: ClosedTrialClassification = invalid ? "INVALID_PROVIDER_RESPONSE" :
    unsafeFalsePositive ? "UNSAFE_FALSE_POSITIVE" : accepted ? "CORRECT_ACCEPT" : falseFallback ? "FALSE_FALLBACK" :
      c.expected.classification === "OUT_OF_CATALOG" && result.fallbackReasons.includes("OUT_OF_CATALOG") ?
        "OUT_OF_CATALOG_CORRECT" : "CORRECT_FALLBACK";
  const confidence = (Object.keys(result.answers) as QuestionId[]).flatMap(dimension => {
    const a = result.answers[dimension];
    if (!a || result.dimensionSources[dimension] !== "ASKED") return [];
    const sorted = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
    return [{ dimension, selectedChoice: a.choice, selectedProbability: a.probabilities[a.choice] ?? null,
      confidence: a.confidence, runnerUp: sorted.find(([choice]) => choice !== a.choice)?.[0] ?? null,
      runnerUpProbability: sorted.find(([choice]) => choice !== a.choice)?.[1] ?? null,
      margin: sorted.length > 1 ? sorted[0][1] - sorted[1][1] : null,
      correct: a.choice === expected[dimension] }];
  });
  const knownInvalidCategory = invalid ? knownFailClosedInvalid(result, rounds, policy) : null;
  const catalogIntact = isAuditedPublication(publishedDecisionCatalog()) &&
    result.derivations.every(d => d.catalogHash === derivationCatalogHash(derivationCatalog));
  const knownNoMatch = ["OUT_OF_CATALOG", "MULTI_OPERATION_REQUIRES_LUNA", "AMBIGUOUS_DISCOVERY", "INCONSISTENT_DISCOVERY",
    "OPEN_FIELDS_OR_PLAN_REQUIRE_LUNA", "AMBIGUOUS_DECISION", "RECEIVABLE_IS_CURRENT_BALANCE", "MAPPING_MISSING"];
  const stopReason = unsafeFalsePositive ? "UNSAFE_FALSE_POSITIVE" : !catalogIntact ? "CATALOG_OR_HASH_MISMATCH" :
    rounds.some(r => r.httpStatus === 500) ? "HTTP_500" :
    invalid ? knownInvalidCategory ? null : "UNKNOWN_SCHEMA_OR_DIAGNOSTIC" :
    result.error === "TIMEOUT" ? "TIMEOUT" : result.error !== null ? "PROVIDER_ERROR" :
    result.status === "NO_MATCH" && result.fallbackReasons.some(reason => !knownNoMatch.includes(reason)) ? "UNKNOWN_FALLBACK_REASON" :
    !["OK", "NO_MATCH"].includes(result.status) ? "FAIL_CLOSED_UNCERTAIN" : null;
  return { id: c.id, classification, policyDecision: policy.decision, policyReason: policy.reason,
    observedDecisions, linguisticCorrect, providerValid, closedOracle, derivationValid,
    semanticCompletenessForThisOracle: fullyCorrectForThisOracle,
    shadowSelectorCandidate, unsafeShadowCandidate, unsafeFalsePositive,
    knownInvalidCategory, disposition: stopReason ? "STOP_WAVE" as const : "CONTINUE_WAVE" as const, stopReason,
    confidence, provenance: result.dimensionSources, derivations: result.derivations,
    latencyMs: result.latencyMs, stageLatencyMs: result.stages.map(s => ({ stage: s.stage, latencyMs: s.result.latencyMs })),
    preparationLatencyMs: timings.preparationMs ?? null,
    policyLatencyMs: timings.policyMs ?? null,
    totalLatencyMs: timings.totalMs ?? null,
    httpCalls: rounds.filter(r => r.sentBytes > 0).length, sentBytes: rounds.reduce((n, r) => n + r.sentBytes, 0),
    usage: result.usage, estimatedCostUsd: result.estimatedCostUsd, executable: false as const };
}

/** No empirical metrics are emitted until actual saved trial evidence is supplied. */
export function summarizeClosedFinancialTrials(trials: readonly {
  case: ClosedFinancialCase; result: DerivedResult; rounds: readonly WaveRoundEvidence[]; timings?: EvaluationTimings;
}[]) {
  if (new Set(trials.map(t => t.case.id)).size !== trials.length) throw Error("DUPLICATE_TRIAL");
  const rows = trials.map(t => scoreClosedFinancialTrial(t.case, t.result, t.rounds, t.timings));
  const valid = rows.filter(r => r.providerValid), accepted = rows.filter(r => r.policyDecision === "ACCEPT_JEV");
  const confidence = rows.flatMap(r => r.confidence);
  const byFamily = Object.fromEntries([...new Set(trials.map(t => t.case.family))].map(family => {
    const group = rows.filter(r => trials.find(t => t.case.id === r.id)?.case.family === family);
    return [family, { evaluated: group.length, valid: group.filter(r => r.providerValid).length,
      linguisticallyCorrect: group.filter(r => r.linguisticCorrect).length,
      semanticallyCompleteOnOracle: group.filter(r => r.semanticCompletenessForThisOracle).length,
      unsafeShadowCandidates: group.filter(r => r.unsafeShadowCandidate).length,
      unsafeFalsePositives: group.filter(r => r.unsafeFalsePositive).length }];
  }));
  return { rows, counts: {
    evaluated: rows.length, correctAccept: rows.filter(r => r.classification === "CORRECT_ACCEPT").length,
    correctFallback: rows.filter(r => r.classification === "CORRECT_FALLBACK").length,
    falseFallback: rows.filter(r => r.classification === "FALSE_FALLBACK").length,
    unsafeFalsePositive: rows.filter(r => r.unsafeFalsePositive).length,
    outOfCatalogCorrect: rows.filter(r => r.classification === "OUT_OF_CATALOG_CORRECT").length,
    invalidProviderResponse: rows.filter(r => r.classification === "INVALID_PROVIDER_RESPONSE").length },
    providerReliability: summarizeProviderReliability(trials.flatMap(t => t.rounds)),
    linguisticAccuracyAmongValid: valid.length ? valid.filter(r => r.linguisticCorrect).length / valid.length : null,
    semanticCompletenessAmongValid: valid.length ? valid.filter(r => r.semanticCompletenessForThisOracle).length / valid.length : null,
    acceptanceAccuracyAmongAccepted: accepted.length ? accepted.filter(r => r.classification === "CORRECT_ACCEPT").length / accepted.length : null,
    confidenceDistribution: distribution(confidence.flatMap(x => x.confidence === null ? [] : [x.confidence])),
    marginDistribution: distribution(confidence.flatMap(x => x.margin === null ? [] : [x.margin])),
    jevLatencyMs: distribution(rows.map(r => r.latencyMs)),
    discoveryLatencyMs: distribution(rows.flatMap(r => r.stageLatencyMs.filter(s => s.stage.kind === "discovery").map(s => s.latencyMs))),
    detailLatencyMs: distribution(rows.flatMap(r => r.stageLatencyMs.filter(s => s.stage.kind === "detail").map(s => s.latencyMs))),
    preparationLatencyMs: distribution(rows.flatMap(r => r.preparationLatencyMs === null ? [] : [r.preparationLatencyMs])),
    policyLatencyMs: distribution(rows.flatMap(r => r.policyLatencyMs === null ? [] : [r.policyLatencyMs])),
    totalLatencyMs: distribution(rows.flatMap(r => r.totalLatencyMs === null ? [] : [r.totalLatencyMs])),
    httpCalls: rows.reduce((n, r) => n + r.httpCalls, 0), sentBytes: rows.reduce((n, r) => n + r.sentBytes, 0),
    knownInputTokens: rows.reduce((n, r) => n + (r.usage.inputTokens ?? 0), 0),
    knownOutputTokens: rows.reduce((n, r) => n + (r.usage.outputTokens ?? 0), 0),
    knownEstimatedCostUsd: rows.reduce((n, r) => n + (r.estimatedCostUsd ?? 0), 0),
    missingCostEvaluations: rows.filter(r => r.estimatedCostUsd === null).length,
    byFamily, evaluationOnly: true as const };
}
