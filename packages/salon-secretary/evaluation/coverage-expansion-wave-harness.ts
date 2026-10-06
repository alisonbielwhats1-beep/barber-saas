import type { AcceptanceVerdict } from "./acceptance-policy";
import type { DerivedResult } from "./derived-plan";
import type { InvalidJevResponseDiagnostic, InvalidResponseReason } from "./invalid-response-diagnostic";
import type { JevWireRequest } from "./jev-provider";
import type { scoreExpansionVerdict } from "./coverage-expansion-plan";

/** Evaluation-only control. This is not an acceptance policy or runtime router. */
export const WAVE_HARNESS_VERSION = "wave1-fail-closed-continuation-v1";
export type WaveClassification = "CORRECT_ACCEPT" | "CORRECT_FALLBACK" | "FALSE_FALLBACK" |
  "UNSAFE_FALSE_POSITIVE" | "OUT_OF_CATALOG_CORRECT" | "INVALID_PROVIDER_RESPONSE";
export type InvalidCategory = "invalid_probability_sum" | "invalid_probability_other" | "invalid_choice" |
  "invalid_type" | "invalid_count" | "semantic_conflict" | "other_known_diagnostic";
export type WaveDisposition = { action: "CONTINUE_WAVE" | "STOP_WAVE"; reason: string;
  classification: WaveClassification | null; invalidCategory: InvalidCategory | null };

const knownInvalidReasons: readonly InvalidResponseReason[] = [
  "MALFORMED_PROVIDER_RESPONSE", "MISSING_FIELD", "INVALID_TYPE", "INVALID_CHOICE",
  "QUESTION_COUNT_MISMATCH", "PROBABILITY_SCHEMA_INVALID", "CONFIDENCE_SCHEMA_INVALID",
  "USAGE_SCHEMA_INVALID", "SEMANTIC_CONFLICT",
];
const knownFallbackReasons = new Set([
  "NO_ACCEPTANCE_POLICY", "OUT_OF_CATALOG", "MULTI_OPERATION_REQUIRES_LUNA",
  "AMBIGUOUS_DISCOVERY", "INCONSISTENT_DISCOVERY", "SKILL_OUTSIDE_FINANCIAL_WAVE",
  "MAPPING_MISSING", "RECEIVABLE_IS_CURRENT_BALANCE", "AMBIGUOUS_DECISION",
  "OPEN_FIELDS_OR_PLAN_REQUIRE_LUNA", "DISCOVERY_UNAVAILABLE",
]);
const own = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function safeDiagnostic(diagnostic: InvalidJevResponseDiagnostic, request: JevWireRequest): boolean {
  if (!knownInvalidReasons.includes(diagnostic.reason) || diagnostic.httpStatus !== 200 ||
      typeof diagnostic.path !== "string" || !diagnostic.path || !own(diagnostic.sanitizedInvalidResponse)) return false;
  const ids = Object.keys(request.questions);
  const path = diagnostic.path.split(".");
  if (!["$", "model", "answers", "usage"].includes(path[0]) ||
      (path[0] === "answers" && path.length > 1 && !ids.includes(path[1]))) return false;
  if (diagnostic.reason === "MALFORMED_PROVIDER_RESPONSE" &&
      (diagnostic.path !== "$" || diagnostic.sanitizedInvalidResponse.observedType === "object")) return false;
  if (diagnostic.reason === "PROBABILITY_SCHEMA_INVALID" &&
      !(path[0] === "answers" && ids.includes(path[1]) && path[2] === "probabilities")) return false;
  if (diagnostic.reason === "CONFIDENCE_SCHEMA_INVALID" &&
      !(path[0] === "answers" && ids.includes(path[1]) && path[2] === "confidence")) return false;
  if (diagnostic.reason === "INVALID_CHOICE" &&
      !(path[0] === "answers" && ids.includes(path[1]) && ["choice", "type"].includes(path[2]))) return false;
  if (diagnostic.reason === "USAGE_SCHEMA_INVALID" && path[0] !== "usage") return false;
  if (diagnostic.reason === "SEMANTIC_CONFLICT" &&
      (!ids.includes("operation") || !ids.includes("skill") || !ids.includes("shape") ||
        !(path[0] === "answers" && ids.includes(path[1]) && path[2] === "choice"))) return false;
  const sanitized = diagnostic.sanitizedInvalidResponse;
  if (sanitized.unexpectedTopLevelFieldCount !== 0 || sanitized.unexpectedQuestionCount !== 0 ||
      sanitized.returnedQuestions.some(id => !ids.includes(id)) ||
      Object.keys(sanitized.answers).some(id => !ids.includes(id))) return false;
  for (const answer of Object.values(sanitized.answers)) {
    if (answer.unexpectedFieldCount !== 0 || answer.unexpectedProbabilityKeyCount !== 0) return false;
  }
  return true;
}

export function invalidCategory(diagnostic: InvalidJevResponseDiagnostic, request: JevWireRequest): InvalidCategory {
  if (diagnostic.reason === "INVALID_CHOICE") return "invalid_choice";
  if (diagnostic.reason === "INVALID_TYPE") return "invalid_type";
  if (diagnostic.reason === "QUESTION_COUNT_MISMATCH") return "invalid_count";
  if (diagnostic.reason === "SEMANTIC_CONFLICT") return "semantic_conflict";
  if (diagnostic.reason !== "PROBABILITY_SCHEMA_INVALID") return "other_known_diagnostic";
  const [, id, field] = diagnostic.path.split(".");
  const answer = field === "probabilities" ? diagnostic.sanitizedInvalidResponse.answers[id] : undefined;
  if (!answer || answer.unexpectedProbabilityKeyCount !== 0 ||
      answer.publishedProbabilityKeys.length !== Object.keys(request.questions[id]?.criteria ?? {}).length ||
      answer.publishedProbabilityKeys.length !== Object.keys(answer.publishedProbabilities).length) return "invalid_probability_other";
  const sum = Object.values(answer.publishedProbabilities).reduce((n, probability) => n + probability, 0);
  return Math.abs(sum - 1) > 1e-6 ? "invalid_probability_sum" : "invalid_probability_other";
}

function observedClassification(score: ReturnType<typeof scoreExpansionVerdict>, result: DerivedResult): WaveClassification | null {
  if (result.error === "INVALID_RESPONSE") return "INVALID_PROVIDER_RESPONSE";
  if (score.unsafeFalsePositive) return "UNSAFE_FALSE_POSITIVE";
  if (score.classification === "OUT_OF_CATALOG_FALLBACK" && result.fallbackReasons.includes("OUT_OF_CATALOG"))
    return "OUT_OF_CATALOG_CORRECT";
  if (score.classification === "OUT_OF_CATALOG_FALLBACK" || score.classification === "CORRECT_FALLBACK_UNDER_V1")
    return "CORRECT_FALLBACK";
  if (score.classification === "CORRECT_ACCEPT" || score.classification === "FALSE_FALLBACK")
    return score.classification;
  return null;
}

export function decideWaveDisposition(result: DerivedResult, verdict: AcceptanceVerdict,
  score: ReturnType<typeof scoreExpansionVerdict>): WaveDisposition {
  const classification = observedClassification(score, result);
  const stop = (reason: string): WaveDisposition => ({ action: "STOP_WAVE", reason, classification, invalidCategory: null });
  const proceed = (reason: string, category: InvalidCategory | null = null): WaveDisposition =>
    ({ action: "CONTINUE_WAVE", reason, classification, invalidCategory: category });
  if (score.unsafeFalsePositive || classification === "UNSAFE_FALSE_POSITIVE") return stop("UNSAFE_FALSE_POSITIVE");
  if (classification === null) return stop("UNKNOWN_CLASSIFICATION");
  // Frozen Wave 1 rule remains: selector-only overreach is a separate stop signal.
  if (score.unsafeShadowCandidate) return stop("UNSAFE_SHADOW_CANDIDATE");
  if (result.fallbackReasons.some(reason => /CATALOG_DRIFT|UNPUBLISHED_OR_INCOMPATIBLE|MAPPING_AMBIGUOUS/.test(reason)) ||
      verdict.reason === "CATALOG_VERSION_MISMATCH") return stop("CATALOG_OR_PAYLOAD_HASH_DRIFT");
  if (result.error === "INVALID_RESPONSE") {
    const last = result.stages.at(-1);
    const diagnostic = last?.result.invalidResponseDiagnostic;
    if (result.status !== "ERROR" || result.decision !== null || result.closedCoverage || !result.requiresLuna ||
        !result.fallbackReasons.includes("INVALID_RESPONSE") || last?.result.error !== "INVALID_RESPONSE" ||
        verdict.decision !== "FALLBACK_REQUIRED" || verdict.reason !== "INVALID_PROVIDER_RESPONSE" ||
        !diagnostic || !safeDiagnostic(diagnostic, last.request)) return stop("FAIL_CLOSED_UNCERTAIN");
    return proceed("KNOWN_INVALID_RESPONSE_FAIL_CLOSED", invalidCategory(diagnostic, last.request));
  }
  if (result.error === "TIMEOUT") return stop("TIMEOUT_NO_RETRY");
  if (result.error === "HTTP") return stop("HTTP_FAILURE_NO_RETRY");
  if (result.error !== null || result.status === "ERROR") return stop("UNHANDLED_PROVIDER_ERROR");
  if (result.fallbackReasons.some(reason => !knownFallbackReasons.has(reason) &&
      !/^MISSING_CONFIDENCE:(skill|shape|metric|period)$/.test(reason))) return stop("UNKNOWN_FALLBACK_REASON");
  if (result.fallbackReasons.includes("MAPPING_MISSING") &&
      !["none", "multiple", "unclear"].includes(result.answers.metric?.choice ?? "")) return stop("CATALOG_OR_PAYLOAD_HASH_DRIFT");
  if (verdict.decision === "ACCEPT_JEV") {
    return classification === "CORRECT_ACCEPT" && result.status === "OK" ?
      proceed("CORRECT_ACCEPT") : stop("FAIL_CLOSED_UNCERTAIN");
  }
  if (verdict.decision !== "FALLBACK_REQUIRED") return stop("UNKNOWN_POLICY_DECISION");
  if (!["CORRECT_FALLBACK", "FALSE_FALLBACK", "OUT_OF_CATALOG_CORRECT"].includes(classification))
    return stop("UNKNOWN_CLASSIFICATION");
  return proceed(classification);
}

/** Verifies the exact frozen body before transport; no expected or secret can enter the wire. */
export function assertFrozenWavePayload(actual: JevWireRequest, frozen: JevWireRequest, credential: string): string {
  const body = JSON.stringify(actual);
  if (!credential || body !== JSON.stringify(frozen) || body.includes(credential) ||
      /"(?:expected|domainFields|evidence|TYPESAFE_API_KEY|phone|customer_ref|salonId|appointment_ref|product_ref)"/i.test(body) ||
      /(?:\+?\d[\s().-]*){8,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(body) ||
      Object.keys(actual).sort().join() !== "model,questions,state") throw Error("FORBIDDEN_PAYLOAD_DATA");
  return body;
}

export type WaveRoundEvidence = { httpStatus: number | null; status: string; error: string | null;
  invalidResponseDiagnostic?: InvalidJevResponseDiagnostic | null; sentBytes: number; request: JevWireRequest };
const rate = (part: number, total: number) => total ? part / total : null;
/** HTTP transport reliability is independent of linguistic and acceptance accuracy. */
export function summarizeProviderReliability(rounds: readonly WaveRoundEvidence[]) {
  const attempted = rounds.filter(round => round.sentBytes > 0);
  const successful = attempted.filter(round => round.httpStatus === 200);
  const valid = successful.filter(round => round.status === "OK" && round.error === null);
  const invalid = successful.filter(round => round.error === "INVALID_RESPONSE");
  const probability = invalid.filter(round => round.invalidResponseDiagnostic?.reason === "PROBABILITY_SCHEMA_INVALID");
  const schema = invalid.filter(round => round.invalidResponseDiagnostic?.reason !== "PROBABILITY_SCHEMA_INVALID");
  const diagnosticCounts = { invalid_probability_sum: 0, invalid_probability_other: 0, invalid_choice: 0,
    invalid_type: 0, invalid_count: 0, semantic_conflict: 0, other_known_diagnostic: 0 };
  for (const round of invalid) if (round.invalidResponseDiagnostic)
    diagnosticCounts[invalidCategory(round.invalidResponseDiagnostic, round.request)]++;
  return { attemptedHttp: attempted.length, httpSuccess: successful.length, validResponses: valid.length,
    invalidResponses: invalid.length, probabilityContractFailures: probability.length, otherSchemaFailures: schema.length,
    validResponseRate: rate(valid.length, attempted.length), invalidResponseRate: rate(invalid.length, attempted.length),
    probabilityContractFailureRate: rate(probability.length, attempted.length), schemaFailureRate: rate(schema.length, attempted.length),
    httpSuccessButInvalidRate: rate(invalid.length, successful.length), diagnosticCounts };
}

export type WaveCaseEvidence = { classification: WaveClassification; score: { linguisticCorrect: boolean };
  policy: { decision: "ACCEPT_JEV" | "FALLBACK_REQUIRED" }; result: { status: string }; rounds: WaveRoundEvidence[] };
/** Invalid provider responses affect reliability, never the linguistic-success numerator. */
export function summarizeWaveQuality(cases: readonly WaveCaseEvidence[]) {
  const classes: readonly WaveClassification[] = ["CORRECT_ACCEPT", "CORRECT_FALLBACK", "FALSE_FALLBACK",
    "UNSAFE_FALSE_POSITIVE", "OUT_OF_CATALOG_CORRECT", "INVALID_PROVIDER_RESPONSE"];
  if (cases.some(c => !classes.includes(c.classification))) throw Error("UNKNOWN_CLASSIFICATION");
  const counts = Object.fromEntries(classes.map(label => [label, cases.filter(c => c.classification === label).length])) as Record<WaveClassification, number>;
  const complete = cases.filter(c => c.result.status === "OK" && c.classification !== "INVALID_PROVIDER_RESPONSE");
  const accepted = cases.filter(c => c.policy.decision === "ACCEPT_JEV");
  return { evaluations: cases.length, counts,
    linguisticCompleteEvaluations: complete.length,
    linguisticAccuracyAmongComplete: rate(complete.filter(c => c.score.linguisticCorrect).length, complete.length),
    acceptedEvaluations: accepted.length,
    acceptanceAccuracyAmongAccepted: rate(accepted.filter(c => c.classification === "CORRECT_ACCEPT").length, accepted.length),
    providerReliability: summarizeProviderReliability(cases.flatMap(c => c.rounds)) };
}
