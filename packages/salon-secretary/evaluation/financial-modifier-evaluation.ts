import { parseConditionalStage } from "./conditional-plan";
import { candidateMetrics, type CandidateMetric } from "./financial-closed-intent-plan";
import { deriveOperation } from "./derivation-catalog";
import { diagnoseInvalidJevResponse, sanitizeInvalidJevResponse } from "./invalid-response-diagnostic";
import { modifierDetailRequest, modifierDiscoveryRequest, type ModifierCase } from "./financial-modifier-plan";
import type { JevWireRequest } from "./jev-provider";
import { financialRequirements } from "../src/financial-skill";

/** Pure offline evaluator: reuses the unchanged, request-keyed KEEP_STRICT parser.
 * It does not instantiate a provider or implement a router/Acceptance Policy.
 */
function inspect(raw: unknown, request: JevWireRequest) {
  try {
    const result = parseConditionalStage(raw, request);
    const decisions = Object.fromEntries(Object.entries(result.answers).flatMap(([id, a]) => {
      if (!a) return [];
      const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
      const runner = ranked.find(([label]) => label !== a.choice);
      return [[id, { ...a, selectedProbability: a.probabilities[a.choice], runnerUp: runner?.[0] ?? null,
        runnerUpProbability: runner?.[1] ?? null, margin: ranked[0][1] - (ranked[1]?.[1] ?? ranked[0][1]),
        source: "JEV" as const }]];
    }));
    return { valid: true as const, result, decisions, diagnostic: null, continueKnownInvalid: false };
  } catch {
    const failure = diagnoseInvalidJevResponse(raw, request), sanitized = sanitizeInvalidJevResponse(raw, request);
    const known = ["MALFORMED_PROVIDER_RESPONSE", "MISSING_FIELD", "INVALID_TYPE", "INVALID_CHOICE",
      "QUESTION_COUNT_MISMATCH", "PROBABILITY_SCHEMA_INVALID", "CONFIDENCE_SCHEMA_INVALID",
      "USAGE_SCHEMA_INVALID", "SEMANTIC_CONFLICT"].includes(failure.reason);
    const noUnknownFields = sanitized.unexpectedTopLevelFieldCount === 0 && sanitized.unexpectedQuestionCount === 0 &&
      Object.values(sanitized.answers).every(a => a.unexpectedFieldCount === 0 && a.unexpectedProbabilityKeyCount === 0);
    return { valid: false as const, result: null, decisions: {},
      diagnostic: { ...failure, sanitizedInvalidResponse: sanitized }, continueKnownInvalid: known && noUnknownFields };
  }
}

export function evaluateModifierObservation(message: string, discoveryRaw: unknown, detailRaw?: unknown) {
  const discovery = inspect(discoveryRaw, modifierDiscoveryRequest(message));
  const detailRequest = discovery.valid ? modifierDetailRequest(message, discovery.result) : null;
  const detail = detailRequest && detailRaw !== undefined ? inspect(detailRaw, detailRequest) : null;
  const decisions = { ...discovery.decisions, ...detail?.decisions };
  const invalid = !discovery.valid ? discovery : detail && !detail.valid ? detail : null;
  const value = (dimension: string) => decisions[dimension]?.choice ?? null;
  const metric = value("metric"), period = value("period"), complexity = value("financial_complexity");
  const candidateMetric = candidateMetrics.includes(metric as CandidateMetric);
  const periodCompatible = metric === "outstanding_receivables" ? period === "none" :
    (financialRequirements().periods as readonly string[]).includes(period ?? "");
  const derivation = candidateMetric && detail?.valid ? deriveOperation("financial", "single", "metric", metric!) : null;
  const missingConfidence = Object.values(decisions).some(a => a.confidence === null);
  const extraUnrequestedDetail = !detailRequest && detailRaw !== undefined;
  const signatureCandidate = !extraUnrequestedDetail && discovery.valid && detail?.valid === true && !missingConfidence &&
    value("skill") === "financial" && value("shape") === "single" && complexity === "SIMPLE" &&
    candidateMetric && periodCompatible && derivation?.ok === true;
  const reason = invalid ? "INVALID_PROVIDER_RESPONSE" : extraUnrequestedDetail ? "UNREQUESTED_DETAIL" :
    !detailRequest ? "DISCOVERY_REQUIRES_FALLBACK" : !detail ? "MISSING_DETAIL" : missingConfidence ? "MISSING_CONFIDENCE" :
    !candidateMetric ? "METRIC_EXCLUDED_OR_UNRESOLVED" : !periodCompatible ? "PERIOD_INCOMPATIBLE" :
    !derivation?.ok ? "INVALID_DERIVATION" : complexity === "MODIFIED" ? "MODIFIED" :
    complexity !== "SIMPLE" ? "UNCLEAR" : "EXPERIMENTAL_SIGNATURE_ONLY";
  return { discovery, detail, decisions, derivation: derivation?.ok ? { ...derivation.derivation, provenance: "DETERMINISTIC_DERIVATION" as const } : null,
    providerValid: discovery.valid && (!detailRequest || detail?.valid === true),
    signatureCandidate, reason,
    disposition: extraUnrequestedDetail || (derivation !== null && !derivation.ok) ||
      (invalid && !invalid.continueKnownInvalid) ? "STOP" as const : "CONTINUE" as const,
    // This experiment never turns a signature into authorization or a new policy acceptance.
    accepted: false as const, requiresLuna: true as const, policyDecision: "NOT_EVALUATED_POLICY_UNCHANGED" as const };
}

/** Oracle enters only AFTER inference evidence, never request generation or stage selection. */
export function scoreModifierObservation(c: ModifierCase, observation: ReturnType<typeof evaluateModifierObservation>) {
  const complexity = observation.decisions.financial_complexity?.choice ?? null;
  const decisionMatch = observation.providerValid && ["skill", "shape", "metric", "period"].every(key =>
    observation.decisions[key]?.choice === c.expected[key as "skill" | "shape" | "metric" | "period"]);
  const falseSimple = observation.signatureCandidate && !c.expected.potentialClosedInterpretation;
  const detectorFalseSimple = observation.detail?.valid === true && complexity === "SIMPLE" && c.expected.complexity !== "SIMPLE";
  const unsafeSignature = observation.signatureCandidate && (!decisionMatch || c.expected.complexity !== "SIMPLE");
  return { id: c.id, falseSimple, detectorFalseSimple, unsafeSignature,
    complexityCorrect: observation.detail?.valid === true ? complexity === c.expected.complexity : null,
    linguisticCorrect: decisionMatch, potentialFullBypass: observation.signatureCandidate && decisionMatch && c.expected.potentialClosedInterpretation,
    accepted: false as const, unsafeAccepted: false as const,
    disposition: falseSimple || detectorFalseSimple || unsafeSignature || observation.disposition === "STOP" ? "STOP" : "CONTINUE",
    // A valid discovery short-circuit is safe but supplies no detector accuracy sample.
    detectorEvaluated: observation.detail?.valid === true };
}
