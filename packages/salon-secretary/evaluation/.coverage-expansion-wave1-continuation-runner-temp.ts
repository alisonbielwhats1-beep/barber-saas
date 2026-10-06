import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import nextEnv from "@next/env";
import { assessJevAcceptance } from "./acceptance-policy";
import { parseConditionalStage, routeDiscovery } from "./conditional-plan";
import type { EvaluationInput, EvaluationResult, QuestionId } from "./contract";
import { expansionDataset } from "./coverage-expansion-dataset";
import { scoreExpansionVerdict } from "./coverage-expansion-plan";
import { assertFrozenWavePayload, decideWaveDisposition, summarizeWaveQuality } from "./coverage-expansion-wave-harness";
import { prepareWave1Continuation, WAVE1_PRIOR_REPORT } from "./coverage-expansion-wave1-continuation";
import { composeDerived, derivedResult, type DerivedResult } from "./derived-plan";
import { derivationCatalog, derivationCatalogHash, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { INPUT_USD_PER_MILLION, JEV_ENDPOINT, JevDecisionProvider, type JevWireRequest } from "./jev-provider";

// Separate authorization is required for the network branch. No f01–f04 replay.
nextEnv.loadEnvConfig(process.cwd());
const manifestPath = "packages/salon-secretary/evaluation/coverage-expansion-wave1-continuation.json";
const reportPath = "packages/salon-secretary/evaluation/coverage-expansion-wave1-continuation-real-2026-09-23.json";
const fixedHashes: Record<string, string> = {
  [manifestPath]: "6bf14161fb1ddd84f18a2d37ec2529cdab3312abe7c0442a6c3755e9f56dfbd9",
  "packages/salon-secretary/evaluation/coverage-expansion-wave-harness.ts": "3bcea92b40bd7bc049e0fbaa13fc5e55ff7fa6bf4ae60871444026b37827529d",
  "packages/salon-secretary/evaluation/coverage-expansion-wave1-continuation.ts": "876e08e3acbb47b3f5e4d11d6c906e60dfe4ff3eabe1030a5532f3657ea2372e",
  "packages/salon-secretary/evaluation/coverage-expansion-plan.ts": "b723fb6600601b3e8f9b71d3fa1b26812bbd3d444b780436c99dbdd7b367df7a",
  "packages/salon-secretary/evaluation/coverage-expansion.ts": "ffab488c035ef642b85f7c5f98452da79cd3621d30d9177802fd546451e1a223",
  "packages/salon-secretary/evaluation/contract.ts": "bbf02f41950040998327f18db8116d9ca7f844f6e02a90d02984eee26d929f1b",
  "packages/salon-secretary/evaluation/invalid-response-diagnostic.ts": "eab6420e45795d56ff314a0f53d34ebb5369c6b191fea7109d773e005d493267",
};
const prior = JSON.parse(readFileSync(WAVE1_PRIOR_REPORT, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const continuation = prepareWave1Continuation();
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const ensureFrozen = () => {
  for (const [path, expected] of Object.entries({ ...prior.sourceHashes, ...fixedHashes }))
    if (sha(path) !== expected) throw Error("CATALOG_OR_PAYLOAD_HASH_DRIFT");
  if (!isAuditedPublication(publishedDecisionCatalog()) || derivationCatalogHash(derivationCatalog) !==
      "0300667615177bf9d96bb9c96a9f055ff99041db111b0e9fb78e48f407434791")
    throw Error("CATALOG_OR_PAYLOAD_HASH_DRIFT");
};
const key = process.env.TYPESAFE_API_KEY?.trim();
if (!key || process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" || process.env.SALON_SECRETARY_MODEL !== "gpt-6-luna" ||
    INPUT_USD_PER_MILLION !== 0.042 || existsSync(reportPath) || JSON.stringify(continuation) !== JSON.stringify(manifest))
  throw Error("PREFLIGHT_FAILED");
ensureFrozen();
for (const c of continuation.remainingCases) {
  assertFrozenWavePayload(c.payloads.discovery, c.payloads.discovery, key);
  assertFrozenWavePayload(c.payloads.detailBySkill.financial, c.payloads.detailBySkill.financial, key);
}
console.log(JSON.stringify({ preflight: "PASS", executed: false, first: "f05", last: "f32",
  priorEvaluations: 4, priorHttp: 7, remaining: continuation.remainingEvaluations,
  maxAdditionalHttp: continuation.maximumAdditionalHttp,
  maxAdditionalCostUsd: continuation.maximumAdditionalCostUsd,
  frozenPlanSha256: continuation.frozenPlanSha256, priorReportSha256: continuation.priorReportSha256,
  paidFlagFalse: true, keyPresent: true, networkEnabled: process.env.JEV_WAVE1_RESUME_EXECUTE === "1" }));
if (process.env.JEV_WAVE1_RESUME_EXECUTE !== "1") process.exit(0);

type Round = { label: "discovery" | "detail"; request: JevWireRequest; httpStatus: number | null; httpLatencyMs: number | null;
  stageLatencyMs: number; sentBytes: number; requestId: string | null; modelRequested: string | null;
  modelReturned: string | null; status: EvaluationResult["status"]; error: EvaluationResult["error"];
  answers: EvaluationResult["answers"]; usage: EvaluationResult["usage"]; estimatedCostUsd: number | null;
  invalidResponseDiagnostic: EvaluationResult["invalidResponseDiagnostic"] | null };
const report: Record<string, unknown> = { version: "jev-coverage-expansion-wave1-continuation-real-v1", wave: 1,
  priorReportSha256: continuation.priorReportSha256, frozenPlanSha256: continuation.frozenPlanSha256,
  manifestSha256: fixedHashes[manifestPath], sourceHashes: { ...prior.sourceHashes, ...fixedHashes },
  priorEvaluations: 4, priorHttp: 7, cases: [], activeCase: null, executedAdditionalEvaluations: 0,
  executedAdditionalHttp: 0, estimatedAdditionalCostUsdKnown: 0, reservedAdditionalCostUsd: 0,
  metrics: null, stopReason: null, zeroOpenAI: true, zeroTools: true, zeroDatabase: true,
  zeroEverflairEffects: true, paidFlagFalse: true };
const cases = report.cases as Record<string, unknown>[];
const maxPerHttpUsd = 64_000 * INPUT_USD_PER_MILLION / 1_000_000;
let httpCount = 0, knownCost = 0, reservedCost = 0;
const save = () => {
  report.executedAdditionalEvaluations = cases.length;
  report.executedAdditionalHttp = httpCount;
  report.estimatedAdditionalCostUsdKnown = knownCost;
  report.reservedAdditionalCostUsd = reservedCost;
  const content = JSON.stringify(report, null, 2);
  if (content.includes(key)) throw Error("SECRET_IN_REPORT");
  writeFileSync(reportPath, `${content}\n`, "utf8");
};
const now = () => performance.now();
const stageCall = async (input: EvaluationInput, request: JevWireRequest, frozen: JevWireRequest,
  label: Round["label"], rounds: Round[]) => {
  ensureFrozen();
  const expectedBody = assertFrozenWavePayload(request, frozen, key);
  let httpLatencyMs: number | null = null, httpStatus: number | null = null, sentBytes = 0;
  let localGuardFailure: string | null = null;
  const provider = new JevDecisionProvider({ credential: () => key, timeoutMs: 10_000, now,
    protocol: { build: () => request, parse: raw => parseConditionalStage(raw, request) },
    transport: async (url, init) => {
      try {
        ensureFrozen();
        if (url !== JEV_ENDPOINT || init?.method !== "POST" || init.body !== expectedBody ||
            init.redirect !== "error" || httpCount >= continuation.maximumAdditionalHttp ||
            prior.executedHttp + httpCount >= 64 ||
            prior.reservedCostUsd + reservedCost + maxPerHttpUsd > 0.172032 + 1e-12)
          throw Error("WIRE_OR_BUDGET_GUARD");
      } catch (error) {
        localGuardFailure = error instanceof Error ? error.message : "WIRE_OR_BUDGET_GUARD";
        throw error;
      }
      sentBytes = Buffer.byteLength(expectedBody, "utf8");
      httpCount++;
      (report.activeCase as Record<string, unknown>).inFlight = { label, sentBytes, additionalHttpOrdinal: httpCount };
      save();
      const start = now();
      try { const response = await fetch(url, init); httpStatus = response.status; return response; }
      finally { httpLatencyMs = now() - start; }
    },
  });
  const outcome = await provider.evaluate(input);
  if (outcome.estimatedCostUsd !== null) knownCost += outcome.estimatedCostUsd;
  reservedCost += outcome.estimatedCostUsd ?? maxPerHttpUsd;
  rounds.push({ label, request, httpStatus, httpLatencyMs, stageLatencyMs: outcome.latencyMs, sentBytes,
    requestId: outcome.requestId, modelRequested: outcome.modelRequested, modelReturned: outcome.modelReturned,
    status: outcome.status, error: outcome.error, answers: outcome.answers, usage: outcome.usage,
    estimatedCostUsd: outcome.estimatedCostUsd, invalidResponseDiagnostic: outcome.invalidResponseDiagnostic ?? null });
  (report.activeCase as Record<string, unknown>).inFlight = null;
  save();
  if (localGuardFailure) throw Error(localGuardFailure);
  if (prior.reservedCostUsd + reservedCost > 0.172032 + 1e-12) throw Error("BUDGET_EXCEEDED");
  return outcome;
};
const attach = (result: DerivedResult, stage: { kind: "discovery" } | { kind: "detail"; skill: "financial" },
  request: JevWireRequest, outcome: EvaluationResult) => {
  result.stages.push({ stage, request, result: outcome });
  Object.assign(result.answers, outcome.answers);
  for (const id of Object.keys(outcome.answers) as QuestionId[]) result.dimensionSources[id] = "ASKED";
  result.modelRequested = outcome.modelRequested;
  result.modelReturned = outcome.modelReturned;
};
try {
  for (const c of continuation.remainingCases) {
    ensureFrozen();
    const oracle = expansionDataset.find(x => x.id === c.id)!;
    const input = oracle.input, start = now(), rounds: Round[] = [], result = derivedResult();
    report.activeCase = { id: c.id, message: c.message, rounds, inFlight: null };
    save();
    const discovery = await stageCall(input, c.payloads.discovery, c.payloads.discovery, "discovery", rounds);
    attach(result, { kind: "discovery" }, c.payloads.discovery, discovery);
    if (discovery.status === "ERROR") {
      result.status = "ERROR"; result.error = discovery.error; result.fallbackReasons = [...discovery.fallbackReasons];
    } else {
      const route = routeDiscovery(discovery);
      if (route.kind === "stop") {
        result.status = "NO_MATCH";
        result.requiresLuna = route.reason !== "OUT_OF_CATALOG";
        result.fallbackReasons = [...new Set([...discovery.fallbackReasons, route.reason])];
      } else if (route.skill !== "financial") {
        result.status = "NO_MATCH"; result.fallbackReasons = ["SKILL_OUTSIDE_FINANCIAL_WAVE"];
      } else {
        const request = c.payloads.detailBySkill.financial;
        const detail = await stageCall(input, request, request, "detail", rounds);
        attach(result, { kind: "detail", skill: "financial" }, request, detail);
        if (detail.status === "ERROR") {
          result.status = "ERROR"; result.error = detail.error; result.fallbackReasons = [...detail.fallbackReasons];
        } else {
          const composed = composeDerived("financial", discovery, detail);
          if (!composed.ok) {
            result.status = "NO_MATCH"; result.fallbackReasons = [...detail.fallbackReasons, composed.reason];
          } else {
            result.decision = composed.decision; result.dependencies = []; result.derivations = composed.derivations;
            for (const d of composed.derivations) result.dimensionSources[d.dimension] = "DERIVED";
            for (const id of composed.notApplicable) result.dimensionSources[id] = "NOT_APPLICABLE";
            result.closedCoverage = composed.closedCoverage; result.requiresLuna = !composed.closedCoverage;
            result.fallbackReasons = [...composed.reasons, "NO_ACCEPTANCE_POLICY"]; result.status = "OK";
          }
        }
      }
    }
    result.latencyMs = now() - start;
    const inputs = result.stages.map(s => s.result.usage.inputTokens);
    const outputs = result.stages.map(s => s.result.usage.outputTokens);
    result.usage = { inputTokens: inputs.every(v => v !== null) ? inputs.reduce((n, v) => n + (v ?? 0), 0) : null,
      outputTokens: outputs.every(v => v !== null) ? outputs.reduce((n, v) => n + (v ?? 0), 0) : null };
    result.estimatedCostUsd = rounds.every(r => r.estimatedCostUsd !== null) ?
      rounds.reduce((n, r) => n + (r.estimatedCostUsd ?? 0), 0) : null;
    const policyStart = now();
    const verdict = assessJevAcceptance(input, result);
    const policyMs = now() - policyStart;
    const score = scoreExpansionVerdict(oracle, result, verdict);
    const disposition = decideWaveDisposition(result, verdict, score);
    const item = { id: c.id, tag: c.tag, message: c.message, oracle: c.expected, score,
      classification: disposition.classification, disposition, policy: verdict, result, rounds,
      httpCalls: rounds.filter(r => r.sentBytes > 0).length,
      discoveryMs: rounds.find(r => r.label === "discovery")?.stageLatencyMs ?? null,
      detailMs: rounds.find(r => r.label === "detail")?.stageLatencyMs ?? null,
      policyMs, totalEvaluationMs: now() - start, sentBytes: rounds.reduce((n, r) => n + r.sentBytes, 0),
      estimatedCostUsd: result.estimatedCostUsd, wouldAvoidLunaUnderCurrentPolicy: verdict.decision === "ACCEPT_JEV" };
    cases.push(item);
    report.activeCase = null;
    save();
    console.log(JSON.stringify({ id: c.id, classification: disposition.classification, policy: verdict.decision,
      reason: verdict.reason, disposition: disposition.action, stopReason: disposition.reason,
      httpAdditional: httpCount, invalidCategory: disposition.invalidCategory }));
    if (disposition.action === "STOP_WAVE") throw Error(disposition.reason);
  }
  report.stopReason = "COMPLETED_32";
} catch (error) {
  report.stopReason = error instanceof Error ? error.message : "UNHANDLED_ERROR";
} finally {
  try {
    report.metrics = summarizeWaveQuality([...prior.cases, ...cases] as Parameters<typeof summarizeWaveQuality>[0]);
  } catch {
    report.metrics = null;
    report.stopReason ??= "METRICS_FAILURE";
  }
  save();
  console.log(JSON.stringify({ completedAdditional: cases.length, completedTotal: 4 + cases.length,
    httpAdditional: httpCount, httpTotal: 7 + httpCount, stopReason: report.stopReason,
    zeroOpenAI: true, zeroTools: true, zeroDatabase: true,
    paidFlagFalse: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "false" }));
}
