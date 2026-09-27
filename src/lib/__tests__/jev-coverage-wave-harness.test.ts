import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessJevAcceptance, type AcceptanceVerdict } from "../../../packages/salon-secretary/evaluation/acceptance-policy";
import { parseConditionalStage } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import { expansionDataset } from "../../../packages/salon-secretary/evaluation/coverage-expansion-dataset";
import { prepareCoverageExpansion, scoreExpansionVerdict } from "../../../packages/salon-secretary/evaluation/coverage-expansion-plan";
import { assertFrozenWavePayload, decideWaveDisposition, invalidCategory, summarizeProviderReliability, summarizeWaveQuality } from "../../../packages/salon-secretary/evaluation/coverage-expansion-wave-harness";
import { prepareWave1Continuation } from "../../../packages/salon-secretary/evaluation/coverage-expansion-wave1-continuation";
import type { DerivedResult } from "../../../packages/salon-secretary/evaluation/derived-plan";
import { diagnoseInvalidJevResponse, sanitizeInvalidJevResponse } from "../../../packages/salon-secretary/evaluation/invalid-response-diagnostic";
import { JEV_MODEL } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { JevDecisionProvider } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { derivedResult } from "../../../packages/salon-secretary/evaluation/derived-plan";

const evidencePath = "packages/salon-secretary/evaluation/coverage-expansion-wave1-real-2026-09-23.json";
const priorHash = "6b7d524c4b13e163450fd7404f38f2544c0069c8b8e35adae35db2fa7b06797b";
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const oracle = (id: string) => expansionDataset.find(c => c.id === id)!;
const saved = (id: string) => evidence.cases.find((c: { id: string }) => c.id === id)!;
function evaluateSaved(id: string, result: DerivedResult = saved(id).result, verdict: AcceptanceVerdict = saved(id).policy) {
  return decideWaveDisposition(result, verdict, scoreExpansionVerdict(oracle(id), result, verdict));
}
const f04 = () => structuredClone(saved("f04").result) as DerivedResult;
const f04Request = prepareCoverageExpansion().waves[0].cases[3].payloads.discovery;
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); })));
afterEach(() => vi.unstubAllGlobals());

describe("JEV coverage Wave 1 fail-closed harness (offline)", () => {
  it("preserves f01–f04 immutably and continues only known fail-closed f04", () => {
    expect(createHash("sha256").update(readFileSync(evidencePath)).digest("hex")).toBe(priorHash);
    expect(evidence).toMatchObject({ executedEvaluations: 4, executedHttp: 7, stopReason: "STRICT_PROBABILITY_OR_SCHEMA_FAILURE" });
    expect(evidence.cases.map((c: { id: string }) => c.id)).toEqual(["f01", "f02", "f03", "f04"]);
    expect(["f01", "f02", "f03", "f04"].map(id => evaluateSaved(id))).toEqual([
      expect.objectContaining({ action: "CONTINUE_WAVE", classification: "CORRECT_ACCEPT" }),
      expect.objectContaining({ action: "CONTINUE_WAVE", classification: "CORRECT_FALLBACK" }),
      expect.objectContaining({ action: "CONTINUE_WAVE", classification: "CORRECT_FALLBACK" }),
      expect.objectContaining({ action: "CONTINUE_WAVE", classification: "INVALID_PROVIDER_RESPONSE", invalidCategory: "invalid_probability_sum" }),
    ]);
    expect(saved("f04").policy).toMatchObject({ decision: "FALLBACK_REQUIRED", reason: "INVALID_PROVIDER_RESPONSE" });
    expect(saved("f04").result.decision).toBeNull();
    expect(saved("f04").rounds).toHaveLength(1);
  });

  it.each([0.99, 1.01])("rejects probability sum %s while continuing only after typed fallback", sum => {
    const request = f04Request;
    const original = saved("f04").rounds[0].invalidResponseDiagnostic.sanitizedInvalidResponse;
    const raw = { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(original.answers as Record<string, {
      publishedChoice: string; publishedProbabilities: Record<string, number>; confidence: number;
    }>).map(([id, a]) => [id,
      { type: "choice", choice: a.publishedChoice, probabilities: { ...a.publishedProbabilities }, confidence: a.confidence }])),
      usage: { input_tokens: 502, output_tokens: 138 } };
    raw.answers.shape.probabilities.single += sum - 0.99;
    expect(() => parseConditionalStage(raw, request)).toThrow();
    const location = diagnoseInvalidJevResponse(raw, request);
    expect(location).toEqual({ reason: "PROBABILITY_SCHEMA_INVALID", path: "answers.shape.probabilities" });
    const result = f04(), last = result.stages.at(-1)!;
    last.result.invalidResponseDiagnostic = { ...location, httpStatus: 200, requestId: null,
      sanitizedInvalidResponse: sanitizeInvalidJevResponse(raw, request) };
    const verdict = assessJevAcceptance(oracle("f04").input, result);
    expect(verdict.decision).toBe("FALLBACK_REQUIRED");
    expect(evaluateSaved("f04", result, verdict)).toMatchObject({ action: "CONTINUE_WAVE", reason: "KNOWN_INVALID_RESPONSE_FAIL_CLOSED",
      classification: "INVALID_PROVIDER_RESPONSE", invalidCategory: "invalid_probability_sum" });
  });

  it("stops on unknown schema field and unknown diagnostic, without auto-repair", () => {
    const unknownField = f04(), diagnostic = unknownField.stages.at(-1)!.result.invalidResponseDiagnostic!;
    diagnostic.reason = "UNEXPECTED_FIELD"; diagnostic.path = "$";
    diagnostic.sanitizedInvalidResponse.unexpectedTopLevelFieldCount = 1;
    expect(evaluateSaved("f04", unknownField)).toMatchObject({ action: "STOP_WAVE", reason: "FAIL_CLOSED_UNCERTAIN" });
    const unknown = f04(); unknown.stages.at(-1)!.result.invalidResponseDiagnostic!.reason = "UNCLASSIFIED_VALIDATION_FAILURE";
    expect(evaluateSaved("f04", unknown)).toMatchObject({ action: "STOP_WAVE", reason: "FAIL_CLOSED_UNCERTAIN" });
  });

  it("stops unsafe accepted interpretations and catalog drift", () => {
    const wrong = structuredClone(saved("f01").result) as DerivedResult;
    wrong.decision!.metric = "received_revenue";
    const accepted = saved("f01").policy as AcceptanceVerdict;
    expect(evaluateSaved("f01", wrong, accepted)).toMatchObject({ action: "STOP_WAVE", reason: "UNSAFE_FALSE_POSITIVE" });
    const drift = structuredClone(saved("f02").result) as DerivedResult;
    drift.fallbackReasons = ["CATALOG_DRIFT"];
    expect(evaluateSaved("f02", drift)).toMatchObject({ action: "STOP_WAVE", reason: "CATALOG_OR_PAYLOAD_HASH_DRIFT" });
  });

  it("continues a false fallback and a correctly rejected out-of-catalog request", () => {
    const correct = structuredClone(saved("f01").result) as DerivedResult;
    const fallback = { ...saved("f01").policy, decision: "FALLBACK_REQUIRED", reason: "UNCALIBRATED_INPUT" } as AcceptanceVerdict;
    expect(evaluateSaved("f01", correct, fallback)).toMatchObject({ action: "CONTINUE_WAVE", classification: "FALSE_FALLBACK" });
    const outside = derivedResult();
    outside.status = "NO_MATCH"; outside.fallbackReasons = ["OUT_OF_CATALOG"];
    const outsideOracle = oracle("f27"), outsideVerdict = assessJevAcceptance(outsideOracle.input, outside);
    expect(decideWaveDisposition(outside, outsideVerdict, scoreExpansionVerdict(outsideOracle, outside, outsideVerdict)))
      .toMatchObject({ action: "CONTINUE_WAVE", classification: "OUT_OF_CATALOG_CORRECT" });
    outside.fallbackReasons = ["UNKNOWN_NEW_REASON"];
    expect(decideWaveDisposition(outside, outsideVerdict, scoreExpansionVerdict(outsideOracle, outside, outsideVerdict)))
      .toMatchObject({ action: "STOP_WAVE", reason: "UNKNOWN_FALLBACK_REASON" });
  });

  it("rejects a secret or changed expected in payload before any network", () => {
    const frozen = structuredClone(f04Request), key = "synthetic-secret-only";
    expect(assertFrozenWavePayload(frozen, frozen, key)).toBe(JSON.stringify(frozen));
    const secret = structuredClone(frozen); (secret.state as { message: string }).message += key;
    expect(() => assertFrozenWavePayload(secret, secret, key)).toThrow("FORBIDDEN_PAYLOAD_DATA");
    const gabarito = structuredClone(frozen); Object.assign(gabarito, { expected: { skill: "financial" } });
    expect(() => assertFrozenWavePayload(gabarito, gabarito, key)).toThrow("FORBIDDEN_PAYLOAD_DATA");
    expect(() => assertFrozenWavePayload(secret, frozen, key)).toThrow("FORBIDDEN_PAYLOAD_DATA");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["HTTP", "TIMEOUT"] as const)("stops %s without retry", error => {
    const result = f04(); result.error = error; result.fallbackReasons = [error];
    result.stages.at(-1)!.result.error = error;
    delete result.stages.at(-1)!.result.invalidResponseDiagnostic;
    const verdict = assessJevAcceptance(oracle("f04").input, result);
    expect(verdict.decision).toBe("FALLBACK_REQUIRED");
    expect(evaluateSaved("f04", result, verdict)).toMatchObject({ action: "STOP_WAVE",
      reason: error === "HTTP" ? "HTTP_FAILURE_NO_RETRY" : "TIMEOUT_NO_RETRY" });
  });

  it("uses one HTTP attempt for 500 and one timeout attempt, with no retry", async () => {
    const input = oracle("f04").input;
    const httpTransport = vi.fn<typeof fetch>(async () => new Response("", { status: 500 }));
    const http = await new JevDecisionProvider({ credential: () => "synthetic-key", transport: httpTransport,
      protocol: { build: () => f04Request, parse: raw => parseConditionalStage(raw, f04Request) } }).evaluate(input);
    expect(http).toMatchObject({ status: "ERROR", error: "HTTP" });
    expect(httpTransport).toHaveBeenCalledTimes(1);
    const timeoutTransport = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
    const timeout = await new JevDecisionProvider({ credential: () => "synthetic-key", transport: timeoutTransport,
      timeoutMs: 5, protocol: { build: () => f04Request, parse: raw => parseConditionalStage(raw, f04Request) } }).evaluate(input);
    expect(timeout).toMatchObject({ status: "ERROR", error: "TIMEOUT" });
    expect(timeoutTransport).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("continues an HTTP 200 malformed response only with known sanitized diagnosis", () => {
    const result = f04(), diagnosis = result.stages.at(-1)!.result.invalidResponseDiagnostic!;
    diagnosis.reason = "MALFORMED_PROVIDER_RESPONSE"; diagnosis.path = "$";
    diagnosis.sanitizedInvalidResponse.observedType = "undefined";
    const verdict = assessJevAcceptance(oracle("f04").input, result);
    expect(evaluateSaved("f04", result, verdict)).toMatchObject({ action: "CONTINUE_WAVE", classification: "INVALID_PROVIDER_RESPONSE",
      invalidCategory: "other_known_diagnostic" });
    const uncertain = f04(); delete uncertain.stages.at(-1)!.result.invalidResponseDiagnostic;
    expect(evaluateSaved("f04", uncertain)).toMatchObject({ action: "STOP_WAVE", reason: "FAIL_CLOSED_UNCERTAIN" });
  });

  it("never accepts invalid data even with confidence 1.0 or an ACCEPT verdict", () => {
    const result = f04();
    result.stages.at(-1)!.result.invalidResponseDiagnostic!.sanitizedInvalidResponse.answers.skill.confidence = 1;
    const unsafeVerdict = { ...saved("f04").policy, decision: "ACCEPT_JEV" } as AcceptanceVerdict;
    expect(evaluateSaved("f04", result, unsafeVerdict)).toMatchObject({ action: "STOP_WAVE" });
    expect(assessJevAcceptance(oracle("f04").input, result).decision).toBe("FALLBACK_REQUIRED");
  });

  it("separates provider reliability from linguistic and acceptance accuracy", () => {
    const rounds = evidence.cases.flatMap((c: { rounds: unknown[] }) => c.rounds);
    expect(summarizeProviderReliability(rounds)).toMatchObject({ attemptedHttp: 7, httpSuccess: 7,
      validResponses: 6, invalidResponses: 1, probabilityContractFailures: 1, otherSchemaFailures: 0,
      validResponseRate: 6 / 7, invalidResponseRate: 1 / 7, probabilityContractFailureRate: 1 / 7,
      httpSuccessButInvalidRate: 1 / 7, diagnosticCounts: { invalid_probability_sum: 1, invalid_choice: 0,
        invalid_type: 0, invalid_count: 0, semantic_conflict: 0 } });
    expect(["f01", "f02", "f03"].every(id => saved(id).score.linguisticCorrect)).toBe(true);
    expect(saved("f04").score.linguisticCorrect).toBe(false);
    const quality = summarizeWaveQuality(evidence.cases);
    expect(quality).toMatchObject({ evaluations: 4, linguisticCompleteEvaluations: 3,
      linguisticAccuracyAmongComplete: 1, acceptedEvaluations: 1, acceptanceAccuracyAmongAccepted: 1,
      counts: { CORRECT_ACCEPT: 1, CORRECT_FALLBACK: 2, FALSE_FALLBACK: 0,
        UNSAFE_FALSE_POSITIVE: 0, OUT_OF_CATALOG_CORRECT: 0, INVALID_PROVIDER_RESPONSE: 1 } });
    expect(() => summarizeWaveQuality([{ ...saved("f04"), classification: "UNKNOWN" }])).toThrow("UNKNOWN_CLASSIFICATION");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("classifies known diagnostics separately without making them accepted", () => {
    const base = f04().stages.at(-1)!.result.invalidResponseDiagnostic!;
    expect(invalidCategory({ ...base, reason: "INVALID_CHOICE" }, f04Request)).toBe("invalid_choice");
    expect(invalidCategory({ ...base, reason: "INVALID_TYPE" }, f04Request)).toBe("invalid_type");
    expect(invalidCategory({ ...base, reason: "QUESTION_COUNT_MISMATCH" }, f04Request)).toBe("invalid_count");
    expect(invalidCategory({ ...base, reason: "SEMANTIC_CONFLICT" }, f04Request)).toBe("semantic_conflict");
    const missing = structuredClone(base);
    missing.sanitizedInvalidResponse.answers.shape.publishedProbabilityKeys = ["single"];
    missing.sanitizedInvalidResponse.answers.shape.publishedProbabilities = { single: 0.54 };
    expect(invalidCategory(missing, f04Request)).toBe("invalid_probability_other");
  });

  it("prepares exactly f05–f32 from the immutable original plan and evidence", () => {
    const continuation = prepareWave1Continuation();
    const frozen = JSON.parse(readFileSync("packages/salon-secretary/evaluation/coverage-expansion-wave1-continuation.json", "utf8"));
    expect(frozen).toEqual(continuation);
    expect(continuation).toMatchObject({ executed: false, requiresSeparateAuthorization: true, priorEvaluations: 4,
      priorHttp: 7, remainingEvaluations: 28, maximumAdditionalHttp: 56, maximumAdditionalCostUsd: 0.150528,
      zeroRetries: true, noOpenAI: true, noBackend: true });
    expect(continuation.remainingCases.map((c: { id: string }) => c.id)).toEqual(Array.from({ length: 28 }, (_, i) => `f${String(i + 5).padStart(2, "0")}`));
    expect(continuation.remainingCases).toEqual(prepareCoverageExpansion().waves[0].cases.slice(4));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
