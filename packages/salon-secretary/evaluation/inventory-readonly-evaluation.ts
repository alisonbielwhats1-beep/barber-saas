import { assessJevAcceptance, initialAllowlist } from "./acceptance-policy";
import type { QuestionId } from "./contract";
import type { DerivedResult } from "./derived-plan";
import { deriveOperation } from "./derivation-catalog";
import { invalidCategory, summarizeProviderReliability, type WaveRoundEvidence } from "./coverage-expansion-wave-harness";
import type { InventoryCase } from "./inventory-readonly-plan";

/** Pure evaluation of saved/mock evidence. No provider, DB, Tools, router or new acceptance policy. */
export function scoreInventoryReadonly(c: InventoryCase, result: DerivedResult) {
  const policy = assessJevAcceptance({ message: c.message, context: {} }, result);
  const providerValid = result.stages.length > 0 && result.stages.every(s => s.result.status === "OK") && result.error === null;
  const hasDetail = result.stages.some(s => s.stage.kind === "detail" && s.stage.skill === "inventory");
  const selectorCorrect = providerValid && hasDetail && result.answers.skill?.choice === c.expected.skill &&
    result.answers.shape?.choice === c.expected.shape && result.answers.inventory?.choice === c.expected.inventory;
  const expectedDerivation = c.expected.operation ? deriveOperation("inventory", "single", "inventory", c.expected.inventory) : null;
  const derivationCorrect = expectedDerivation?.ok === true && result.derivations.length === 1 &&
    JSON.stringify(result.derivations[0]) === JSON.stringify(expectedDerivation.derivation);
  const selectorOnlyCandidate = providerValid && result.status === "OK" && result.closedCoverage && !result.requiresLuna;
  const fullInterpretation = selectorOnlyCandidate && selectorCorrect && derivationCorrect && c.expected.fullBypassSemanticallyPossible;
  const accepted = policy.decision === "ACCEPT_JEV";
  const unsafeFalsePositive = accepted && !fullInterpretation;
  // This is deliberately separate from actual policy acceptance, just as in the prior Wave harness.
  const unsafeSelectorCandidate = selectorOnlyCandidate && !fullInterpretation;
  const proven = initialAllowlist.some(e => e.message === c.message && e.skill === "inventory");
  const invalid = result.error === "INVALID_RESPONSE", last = result.stages.at(-1);
  const diagnostic = last?.result.invalidResponseDiagnostic;
  const path = diagnostic?.path.split(".") ?? [];
  const diagnosticPathMatches = diagnostic !== undefined && (
    diagnostic.reason === "MALFORMED_PROVIDER_RESPONSE" ? diagnostic.path === "$" && diagnostic.sanitizedInvalidResponse.observedType !== "object" :
    diagnostic.reason === "PROBABILITY_SCHEMA_INVALID" ? path[0] === "answers" && path[2] === "probabilities" :
    diagnostic.reason === "CONFIDENCE_SCHEMA_INVALID" ? path[0] === "answers" && path[2] === "confidence" :
    diagnostic.reason === "INVALID_CHOICE" ? path[0] === "answers" && ["choice", "type"].includes(path[2]) :
    diagnostic.reason === "USAGE_SCHEMA_INVALID" ? path[0] === "usage" : true);
  const knownInvalid = invalid && policy.decision === "FALLBACK_REQUIRED" && result.status === "ERROR" &&
    policy.reason === "INVALID_PROVIDER_RESPONSE" && result.fallbackReasons.includes("INVALID_RESPONSE") && diagnosticPathMatches &&
    result.decision === null && !result.closedCoverage && result.requiresLuna && last?.result.error === "INVALID_RESPONSE" &&
    diagnostic?.httpStatus === 200 && ["MALFORMED_PROVIDER_RESPONSE", "MISSING_FIELD", "INVALID_TYPE", "INVALID_CHOICE",
      "QUESTION_COUNT_MISMATCH", "PROBABILITY_SCHEMA_INVALID", "CONFIDENCE_SCHEMA_INVALID", "USAGE_SCHEMA_INVALID"].includes(diagnostic.reason) &&
    ["$", "model", "answers", "usage"].includes(diagnostic.path.split(".")[0]) &&
    (diagnostic.path.split(".")[0] !== "answers" || !diagnostic.path.split(".")[1] || diagnostic.path.split(".")[1] in last.request.questions) &&
    diagnostic.sanitizedInvalidResponse.unexpectedTopLevelFieldCount === 0 && diagnostic.sanitizedInvalidResponse.unexpectedQuestionCount === 0 &&
    diagnostic.sanitizedInvalidResponse.returnedQuestions.every(id => id in last.request.questions) &&
    Object.keys(diagnostic.sanitizedInvalidResponse.answers).every(id => id in last.request.questions) &&
    Object.values(diagnostic.sanitizedInvalidResponse.answers).every(a => a.unexpectedFieldCount === 0 && a.unexpectedProbabilityKeyCount === 0);
  const classification = invalid ? "INVALID_PROVIDER_RESPONSE" : unsafeFalsePositive ? "UNSAFE_FALSE_POSITIVE" :
    accepted ? "CORRECT_ACCEPT" : proven && fullInterpretation ? "FALSE_FALLBACK" :
      policy.reason === "OUT_OF_CATALOG" && c.category === "OUT_OF_CATALOG" ? "OUT_OF_CATALOG_CORRECT" : "CORRECT_FALLBACK";
  const knownFallback = new Set(["NO_ACCEPTANCE_POLICY", "OUT_OF_CATALOG", "MULTI_OPERATION_REQUIRES_LUNA", "AMBIGUOUS_DISCOVERY",
    "INCONSISTENT_DISCOVERY", "DISCOVERY_UNAVAILABLE", "OPEN_FIELDS_OR_PLAN_REQUIRE_LUNA", "AMBIGUOUS_DECISION",
    "SKILL_OUTSIDE_INVENTORY_WAVE", "MAPPING_MISSING", "MISSING_CONFIDENCE:skill", "MISSING_CONFIDENCE:shape", "MISSING_CONFIDENCE:inventory"]);
  const stopReason = unsafeFalsePositive ? "UNSAFE_FALSE_POSITIVE" : unsafeSelectorCandidate ? "UNSAFE_SELECTOR_ONLY_CANDIDATE" :
    policy.reason === "CATALOG_VERSION_MISMATCH" || result.fallbackReasons.some(r => ["CATALOG_DRIFT", "MAPPING_AMBIGUOUS", "UNPUBLISHED_OR_INCOMPATIBLE_OPERATION"].includes(r)) ? "CATALOG_DRIFT" :
    invalid ? knownInvalid ? null : "UNKNOWN_DIAGNOSTIC_OR_FAIL_CLOSED_UNCERTAIN" :
    result.error ? result.error : result.fallbackReasons.some(r => !knownFallback.has(r)) ? "UNKNOWN_FALLBACK_REASON" :
    result.fallbackReasons.includes("MAPPING_MISSING") && !["none", "unclear"].includes(result.answers.inventory?.choice ?? "") ? "MAPPING_MISSING_FOR_PUBLISHED_INTENT" :
    !["OK", "NO_MATCH"].includes(result.status) ? "UNKNOWN_STATUS" : null;
  const confidence = (Object.keys(result.answers) as QuestionId[]).flatMap(dimension => {
    const a = result.answers[dimension]; if (!a || result.dimensionSources[dimension] !== "ASKED") return [];
    const sorted = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
    const runner = sorted.find(([choice]) => choice !== a.choice);
    return [{ dimension, choice: a.choice, selectedProbability: a.probabilities[a.choice], confidence: a.confidence,
      runnerUp: runner?.[0] ?? null, runnerUpProbability: runner?.[1] ?? null,
      margin: sorted.length > 1 ? sorted[0][1] - sorted[1][1] : null }];
  });
  return { id: c.id, classification, policy, providerValid, selectorCorrect, derivationCorrect,
    semanticCompletenessOnOracle: fullInterpretation, potentialFullBypass: fullInterpretation,
    routingOnlyCorrect: !c.expected.fullBypassSemanticallyPossible && c.evidenceState === "JEV_ROUTING_ONLY" && selectorCorrect && derivationCorrect,
    selectorOnlyCandidate, unsafeSelectorCandidate, unsafeFalsePositive,
    missingSemantics: c.expected.unresolvedByChoices, confidence,
    diagnosticCategory: knownInvalid && diagnostic && last ? invalidCategory(diagnostic, last.request) : null,
    disposition: stopReason ? "STOP" : "CONTINUE", stopReason, executable: false as const };
}

const rate = (n: number, d: number) => d ? n / d : null;
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => { if (!sorted.length) return null; const at = (sorted.length - 1) * p;
    return sorted[Math.floor(at)] + (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at % 1); };
  return { n: values.length, min: sorted[0] ?? null, p50: q(.5), mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    p95Descriptive: q(.95), max: sorted.at(-1) ?? null };
};
/** Scored oracles cannot become future runtime routing. Empty evidence yields null rates. */
export function summarizeInventoryReadonly(trials: readonly { case: InventoryCase; result: DerivedResult; rounds?: readonly WaveRoundEvidence[] }[],
  evidenceKind: "SYNTHETIC" | "REAL_SAVED" = "SYNTHETIC") {
  if (new Set(trials.map(t => t.case.id)).size !== trials.length) throw Error("DUPLICATE_TRIAL");
  const rows = trials.map(t => scoreInventoryReadonly(t.case, t.result));
  const validDetail = rows.filter(r => r.providerValid && trials.find(t => t.case.id === r.id)!.result.stages.length === 2);
  const accepted = rows.filter(r => r.policy.decision === "ACCEPT_JEV");
  return { rows, evaluated: rows.length,
    counts: Object.fromEntries(["CORRECT_ACCEPT", "CORRECT_FALLBACK", "FALSE_FALLBACK", "UNSAFE_FALSE_POSITIVE", "OUT_OF_CATALOG_CORRECT", "INVALID_PROVIDER_RESPONSE"].map(k => [k, rows.filter(r => r.classification === k).length])),
    selectorAccuracyAmongValidDetails: rate(validDetail.filter(r => r.selectorCorrect).length, validDetail.length),
    acceptanceAccuracy: rate(accepted.filter(r => !r.unsafeFalsePositive).length, accepted.length),
    potentialFullBypass: rows.filter(r => r.potentialFullBypass).length,
    routingOnly: rows.filter(r => r.routingOnlyCorrect).length,
    unsafeSelectorOnlyCandidates: rows.filter(r => r.unsafeSelectorCandidate).length,
    confidence: distribution(rows.flatMap(r => r.confidence.flatMap(c => c.confidence === null ? [] : [c.confidence]))),
    margins: distribution(rows.flatMap(r => r.confidence.flatMap(c => c.margin === null ? [] : [c.margin]))),
    evaluationLatencyMs: distribution(trials.map(t => t.result.latencyMs)),
    providerReliability: summarizeProviderReliability(trials.flatMap(t => [...(t.rounds ?? [])])),
    // Wire evidence is supplied explicitly; never infer an HTTP status or sent bytes from a parser result.
    stageUsage: trials.flatMap(t => t.result.stages.map(s => ({ id: t.case.id, stage: s.stage, latencyMs: s.result.latencyMs,
      usage: s.result.usage, estimatedCostUsd: s.result.estimatedCostUsd, diagnostic: s.result.invalidResponseDiagnostic ?? null }))),
    evidenceKind, executable: false as const };
}
