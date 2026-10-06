import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assessJevAcceptance } from "./acceptance-policy";
import { expansionDataset } from "./coverage-expansion-dataset";
import { prepareCoverageExpansion, scoreExpansionVerdict } from "./coverage-expansion-plan";
import { decideWaveDisposition, summarizeProviderReliability, WAVE_HARNESS_VERSION } from "./coverage-expansion-wave-harness";
import type { DerivedResult } from "./derived-plan";
import { INPUT_USD_PER_MILLION } from "./jev-provider";

const path = "packages/salon-secretary/evaluation/";
export const WAVE1_PRIOR_REPORT = `${path}coverage-expansion-wave1-real-2026-09-23.json`;
export const WAVE1_FROZEN_PLAN = `${path}coverage-expansion-plan.json`;
export const WAVE1_PRIOR_SHA256 = "6b7d524c4b13e163450fd7404f38f2544c0069c8b8e35adae35db2fa7b06797b";
export const WAVE1_PLAN_SHA256 = "0db86b3cd6087cfaa6a1d8403aeeb481ca2d718cf4afa61df5c0cabe380e2de7";
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** Read-only preparation. Returns only the 28 original cases, without changing the frozen manifest. */
export function prepareWave1Continuation() {
  const priorBytes = readFileSync(WAVE1_PRIOR_REPORT), frozenBytes = readFileSync(WAVE1_FROZEN_PLAN);
  if (sha(priorBytes) !== WAVE1_PRIOR_SHA256 || sha(frozenBytes) !== WAVE1_PLAN_SHA256) throw Error("FROZEN_EVIDENCE_DRIFT");
  const prior = JSON.parse(priorBytes.toString("utf8")), frozen = JSON.parse(frozenBytes.toString("utf8"));
  const prepared = prepareCoverageExpansion(), wave = frozen.waves?.[0];
  if (frozen.datasetHash !== prepared.datasetHash || frozen.payloadsHash !== prepared.payloadsHash ||
      JSON.stringify(wave) !== JSON.stringify(prepared.waves[0]) || frozen.catalog.hash !== prepared.catalog.hash ||
      prior.executedEvaluations !== 4 || prior.executedHttp !== 7 || prior.activeCase !== null ||
      prior.stopReason !== "STRICT_PROBABILITY_OR_SCHEMA_FAILURE" || prior.cases?.length !== 4 ||
      wave.caseCount !== 32 || wave.maxHttpCalls !== 64 || INPUT_USD_PER_MILLION !== 0.042) throw Error("FROZEN_EVIDENCE_DRIFT");
  const expectedClassifications = ["CORRECT_ACCEPT", "CORRECT_FALLBACK", "CORRECT_FALLBACK", "INVALID_PROVIDER_RESPONSE"];
  for (let i = 0; i < 4; i++) {
    const c = prior.cases[i], frozenCase = wave.cases[i], oracle = expansionDataset[i];
    if (c.id !== frozenCase.id || c.id !== oracle.id || c.message !== frozenCase.message ||
        c.classification !== expectedClassifications[i] ||
        JSON.stringify(c.oracle) !== JSON.stringify(frozenCase.expected) ||
        JSON.stringify(c.rounds.map((r: { request: unknown }) => r.request)) !== JSON.stringify([
          frozenCase.payloads.discovery, ...(i < 3 ? [frozenCase.payloads.detailBySkill.financial] : []),
        ])) throw Error("FROZEN_EVIDENCE_DRIFT");
    const result = c.result as DerivedResult;
    const verdict = assessJevAcceptance(oracle.input, result);
    if (JSON.stringify(verdict) !== JSON.stringify(c.policy) ||
        decideWaveDisposition(result, verdict, scoreExpansionVerdict(oracle, result, verdict)).action !== "CONTINUE_WAVE")
      throw Error("FROZEN_EVIDENCE_DRIFT");
  }
  const reliability = summarizeProviderReliability(prior.cases.flatMap((c: { rounds: unknown[] }) => c.rounds));
  if (reliability.attemptedHttp !== 7 || reliability.validResponses !== 6 ||
      reliability.diagnosticCounts.invalid_probability_sum !== 1) throw Error("FROZEN_EVIDENCE_DRIFT");
  const remaining = wave.cases.slice(4);
  if (remaining.length !== 28 || remaining[0]?.id !== "f05" || remaining.at(-1)?.id !== "f32" ||
      remaining.some((c: { id: string }, i: number) => c.id !== `f${String(i + 5).padStart(2, "0")}`))
    throw Error("FROZEN_EVIDENCE_DRIFT");
  const maximumAdditionalHttp = Math.min(64 - prior.executedHttp, remaining.length * 2);
  const maximumAdditionalCostUsd = maximumAdditionalHttp * 64_000 * INPUT_USD_PER_MILLION / 1_000_000;
  return { version: WAVE_HARNESS_VERSION, executed: false, requiresSeparateAuthorization: true, wave: 1,
    priorReportSha256: WAVE1_PRIOR_SHA256, frozenPlanSha256: WAVE1_PLAN_SHA256,
    datasetHash: frozen.datasetHash, payloadsHash: frozen.payloadsHash, catalog: frozen.catalog,
    preservedCases: ["f01", "f02", "f03", "f04"], priorEvaluations: 4, priorHttp: 7,
    remainingCases: remaining, remainingEvaluations: 28, maximumAdditionalHttp,
    maximumAdditionalCostUsd, zeroRetries: true, noOpenAI: true, noBackend: true,
    continueOnly: ["CORRECT_ACCEPT", "CORRECT_FALLBACK", "FALSE_FALLBACK", "OUT_OF_CATALOG_CORRECT",
      "KNOWN_INVALID_RESPONSE_FAIL_CLOSED"],
    stopOn: ["UNSAFE_FALSE_POSITIVE", "UNSAFE_SHADOW_CANDIDATE", "FAIL_CLOSED_UNCERTAIN",
      "CATALOG_OR_PAYLOAD_HASH_DRIFT", "FORBIDDEN_PAYLOAD_DATA", "BUDGET_EXCEEDED", "UNHANDLED_PROVIDER_ERROR",
      "TIMEOUT_NO_RETRY", "HTTP_FAILURE_NO_RETRY", "UNKNOWN_FALLBACK_REASON", "UNKNOWN_CLASSIFICATION"],
    note: "Only the harness stop matrix changes. Original messages, choices, expected and hashes remain frozen; no new enrollment or router.",
  };
}
