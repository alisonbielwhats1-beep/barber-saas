import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import nextEnv from "@next/env";
import { parseConditionalStage, routeDiscovery } from "./conditional-plan";
import type { EvaluationInput, EvaluationResult, QuestionId } from "./contract";
import { assertFrozenWavePayload } from "./coverage-expansion-wave-harness";
import { composeDerived, derivedResult, type DerivedResult } from "./derived-plan";
import { derivationCatalog, derivationCatalogHash, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { inventoryReadonlyCases, nextInventoryDetail, prepareInventoryReadonlyPlan, type InventoryCase } from "./inventory-readonly-plan";
import { scoreInventoryReadonly, summarizeInventoryReadonly } from "./inventory-readonly-evaluation";
import { INPUT_USD_PER_MILLION, JEV_ENDPOINT, JevDecisionProvider, type JevWireRequest } from "./jev-provider";

// Evaluation-only execution. Offline preflight is the default; no retry, DB, Tools, or LLM fallback.
nextEnv.loadEnvConfig(process.cwd());
const manifestPath = "packages/salon-secretary/evaluation/inventory-readonly-plan.json";
const reportPath = "packages/salon-secretary/evaluation/inventory-readonly-real-2026-09-23.json";
const expectedSha = "dcc9bd919ec2ea1a678a7443abc7d35213d9906b63aacf12dc4c924d198cbe0a";
const expectedCatalogHash = "0300667615177bf9d96bb9c96a9f055ff99041db111b0e9fb78e48f407434791";
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const immutablePaths = [
  manifestPath,
  "packages/salon-secretary/evaluation/inventory-readonly-plan.ts",
  "packages/salon-secretary/evaluation/inventory-readonly-evaluation.ts",
  "packages/salon-secretary/evaluation/jev-provider.ts",
  "packages/salon-secretary/evaluation/contract.ts",
  "packages/salon-secretary/evaluation/conditional-plan.ts",
  "packages/salon-secretary/evaluation/derived-plan.ts",
  "packages/salon-secretary/evaluation/derivation-catalog.ts",
  "packages/salon-secretary/evaluation/acceptance-policy.ts",
  "packages/salon-secretary/evaluation/coverage-expansion-wave-harness.ts",
  "packages/salon-secretary/evaluation/invalid-response-diagnostic.ts",
  "packages/salon-secretary/evaluation/.inventory-readonly-runner-temp.ts",
] as const;
const initialHashes = Object.fromEntries(immutablePaths.map(path => [path, sha(path)]));
const frozen = prepareInventoryReadonlyPlan();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof frozen;
const key = process.env.TYPESAFE_API_KEY?.trim();
const executionEnabled = process.env.JEV_INVENTORY_WAVE2_EXECUTE === "1";
const maxCost = 0.139776, reservePerHttp = 64_000 * INPUT_USD_PER_MILLION / 1_000_000;
function ensureFrozen() {
  for (const [path, hash] of Object.entries(initialHashes)) if (sha(path) !== hash) throw Error("FROZEN_ARTIFACT_DRIFT");
  if (sha(manifestPath) !== expectedSha || !isAuditedPublication(publishedDecisionCatalog()) ||
      derivationCatalogHash(derivationCatalog) !== expectedCatalogHash) throw Error("CATALOG_OR_MANIFEST_DRIFT");
}
if (!key || process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" ||
    process.env.SALON_SECRETARY_MODEL !== "gpt-6-luna" || INPUT_USD_PER_MILLION !== 0.042 ||
    sha(manifestPath) !== expectedSha || JSON.stringify(frozen) !== JSON.stringify(manifest) ||
    manifest.caseCount !== 26 || manifest.positives !== 8 || manifest.adversarial !== 18 ||
    manifest.maxHttpCalls !== 52 || manifest.retries !== 0 || manifest.cases.length !== 26 ||
    new Set(manifest.cases.map(c => c.id)).size !== 26 ||
    JSON.stringify(manifest.cases.map(c => c.id)) !== JSON.stringify(inventoryReadonlyCases.map(c => c.id)) ||
    existsSync(reportPath)) throw Error("PREFLIGHT_FAILED");
ensureFrozen();
for (const c of manifest.cases) {
  assertFrozenWavePayload(c.payloads.discovery, c.payloads.discovery, key);
  assertFrozenWavePayload(c.payloads.detail, c.payloads.detail, key);
}
console.log(JSON.stringify({ precheck: "PASS", manifestSha256: expectedSha, predecessors: "PASS", cases: 26,
  positives: 8, adversarial: 18, maxHttp: 52, maxCostEstimateUsd: maxCost,
  keyPresent: true, paidFlagFalse: true, model: "gpt-6-luna", officialTariffRechecked: true,
  executionEnabled, reportExists: false }));
if (!executionEnabled) process.exit(0);

type Round = { label: "discovery" | "detail"; request: JevWireRequest; httpStatus: number | null;
  httpLatencyMs: number | null; stageLatencyMs: number; sentBytes: number; requestId: string | null;
  modelRequested: string | null; modelReturned: string | null; status: EvaluationResult["status"];
  error: EvaluationResult["error"]; answers: EvaluationResult["answers"]; usage: EvaluationResult["usage"];
  estimatedCostUsd: number | null; invalidResponseDiagnostic: EvaluationResult["invalidResponseDiagnostic"] | null };
const report: Record<string, unknown> = { version: "inventory-readonly-real-v1", frozenPlanSha256: expectedSha,
  sourceHashes: initialHashes, catalogHash: expectedCatalogHash, tariffUsdPerMillionInput: INPUT_USD_PER_MILLION,
  tariffOfficialSource: "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
  cases: [], activeCase: null, executedEvaluations: 0, executedHttp: 0,
  knownCostUsd: 0, reservedCostUsd: 0, metrics: null, stopReason: null,
  zeroOpenAI: true, zeroDatabase: true, zeroTools: true, zeroEverflairEffects: true,
  paidFlagFalse: true, policyChanged: false, allowlistChanged: false };
const cases = report.cases as Record<string, unknown>[];
const trials: { case: InventoryCase; result: DerivedResult; rounds: Round[] }[] = [];
const now = () => performance.now();
let httpCount = 0, knownCost = 0, reservedCost = 0;
function save() {
  report.executedEvaluations = cases.length;
  report.executedHttp = httpCount;
  report.knownCostUsd = knownCost;
  report.reservedCostUsd = reservedCost;
  const serialized = JSON.stringify(report, null, 2);
  if (serialized.includes(key!)) throw Error("SECRET_IN_REPORT");
  writeFileSync(reportPath, serialized + "\n", "utf8");
}
async function stageCall(input: EvaluationInput, request: JevWireRequest, frozenRequest: JevWireRequest,
  label: Round["label"], rounds: Round[]) {
  ensureFrozen();
  const expectedBody = assertFrozenWavePayload(request, frozenRequest, key!);
  let httpStatus: number | null = null, httpLatencyMs: number | null = null, sentBytes = 0;
  let localGuardFailure: string | null = null;
  const provider = new JevDecisionProvider({ credential: () => key, timeoutMs: 10_000, now,
    protocol: { build: () => request, parse: raw => parseConditionalStage(raw, request) },
    transport: async (url, init) => {
      try {
        ensureFrozen();
        if (url !== JEV_ENDPOINT || init?.method !== "POST" || init.body !== expectedBody ||
            init.redirect !== "error" || httpCount >= 52 || reservedCost + reservePerHttp > maxCost + 1e-12)
          throw Error("WIRE_OR_BUDGET_GUARD");
      } catch (error) {
        localGuardFailure = error instanceof Error ? error.message : "WIRE_OR_BUDGET_GUARD";
        throw error;
      }
      sentBytes = Buffer.byteLength(expectedBody, "utf8");
      httpCount++;
      (report.activeCase as Record<string, unknown>).inFlight = { label, sentBytes, httpOrdinal: httpCount };
      save();
      const start = now();
      try { const response = await fetch(url, init); httpStatus = response.status; return response; }
      finally { httpLatencyMs = now() - start; }
    },
  });
  const outcome = await provider.evaluate(input);
  if (outcome.estimatedCostUsd !== null) knownCost += outcome.estimatedCostUsd;
  reservedCost += outcome.estimatedCostUsd ?? reservePerHttp;
  rounds.push({ label, request, httpStatus, httpLatencyMs, stageLatencyMs: outcome.latencyMs, sentBytes,
    requestId: outcome.requestId, modelRequested: outcome.modelRequested, modelReturned: outcome.modelReturned,
    status: outcome.status, error: outcome.error, answers: outcome.answers, usage: outcome.usage,
    estimatedCostUsd: outcome.estimatedCostUsd, invalidResponseDiagnostic: outcome.invalidResponseDiagnostic ?? null });
  (report.activeCase as Record<string, unknown>).inFlight = null;
  save();
  if (localGuardFailure) throw Error(localGuardFailure);
  if (reservedCost > maxCost + 1e-12) throw Error("BUDGET_EXCEEDED");
  return outcome;
}
function attach(result: DerivedResult, stage: { kind: "discovery" } | { kind: "detail"; skill: "inventory" },
  request: JevWireRequest, outcome: EvaluationResult) {
  result.stages.push({ stage, request, result: outcome });
  Object.assign(result.answers, outcome.answers);
  for (const id of Object.keys(outcome.answers) as QuestionId[]) result.dimensionSources[id] = "ASKED";
  result.modelRequested = outcome.modelRequested;
  result.modelReturned = outcome.modelReturned;
}
try {
  for (const c of manifest.cases) {
    ensureFrozen();
    const input = { message: c.message, context: {} }, started = now(), rounds: Round[] = [], result = derivedResult();
    report.activeCase = { id: c.id, message: c.message, rounds, inFlight: null };
    save();
    const discovery = await stageCall(input, c.payloads.discovery, c.payloads.discovery, "discovery", rounds);
    attach(result, { kind: "discovery" }, c.payloads.discovery, discovery);
    if (discovery.status === "ERROR") {
      result.status = "ERROR"; result.error = discovery.error; result.fallbackReasons = [...discovery.fallbackReasons];
    } else {
      const route = routeDiscovery(discovery);
      if (route.kind === "stop") {
        result.status = "NO_MATCH"; result.requiresLuna = route.reason !== "OUT_OF_CATALOG";
        result.fallbackReasons = [...new Set([...discovery.fallbackReasons, route.reason])];
      } else if (route.skill !== "inventory") {
        result.status = "NO_MATCH"; result.fallbackReasons = ["SKILL_OUTSIDE_INVENTORY_WAVE"];
      } else {
        const request = nextInventoryDetail(c.message, discovery);
        if (!request || JSON.stringify(request) !== JSON.stringify(c.payloads.detail)) throw Error("CONDITIONAL_DETAIL_DRIFT");
        const detail = await stageCall(input, request, c.payloads.detail, "detail", rounds);
        attach(result, { kind: "detail", skill: "inventory" }, request, detail);
        if (detail.status === "ERROR") {
          result.status = "ERROR"; result.error = detail.error; result.fallbackReasons = [...detail.fallbackReasons];
        } else {
          const composed = composeDerived("inventory", discovery, detail);
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
    result.latencyMs = now() - started;
    const inputTokens = result.stages.map(s => s.result.usage.inputTokens);
    const outputTokens = result.stages.map(s => s.result.usage.outputTokens);
    result.usage = { inputTokens: inputTokens.every(n => n !== null) ? inputTokens.reduce((n, v) => n + (v ?? 0), 0) : null,
      outputTokens: outputTokens.every(n => n !== null) ? outputTokens.reduce((n, v) => n + (v ?? 0), 0) : null };
    result.estimatedCostUsd = rounds.every(r => r.estimatedCostUsd !== null) ?
      rounds.reduce((n, r) => n + (r.estimatedCostUsd ?? 0), 0) : null;
    const policyStart = now();
    const score = scoreInventoryReadonly(c, result);
    const policyMs = now() - policyStart;
    const classification = score.classification === "CORRECT_ACCEPT" || score.potentialFullBypass ? "CORRECT_CANDIDATE" : score.classification;
    const item = { id: c.id, message: c.message, oracle: c.expected, category: c.category, evidenceState: c.evidenceState,
      classification, score, result, rounds, httpCalls: rounds.filter(r => r.sentBytes > 0).length,
      discoveryMs: rounds.find(r => r.label === "discovery")?.stageLatencyMs ?? null,
      detailMs: rounds.find(r => r.label === "detail")?.stageLatencyMs ?? null,
      policyMs, totalEvaluationMs: now() - started, sentBytes: rounds.reduce((n, r) => n + r.sentBytes, 0),
      estimatedCostUsd: result.estimatedCostUsd };
    cases.push(item);
    trials.push({ case: c, result, rounds });
    report.activeCase = null;
    save();
    console.log(JSON.stringify({ id: c.id, classification, policy: score.policy.decision, reason: score.policy.reason,
      disposition: score.disposition, stopReason: score.stopReason, http: httpCount, diagnostic: score.diagnosticCategory }));
    if (score.disposition === "STOP") throw Error(score.stopReason ?? "UNSAFE_OR_UNKNOWN");
  }
  report.stopReason = "COMPLETED_26";
} catch (error) {
  report.stopReason = error instanceof Error ? error.message : "UNHANDLED_ERROR";
} finally {
  try { report.metrics = summarizeInventoryReadonly(trials, "REAL_SAVED"); }
  catch { report.metrics = null; report.stopReason ??= "METRICS_FAILURE"; }
  save();
  console.log(JSON.stringify({ completed: cases.length, http: httpCount, stopReason: report.stopReason,
    knownCostUsd: knownCost, paidFlagFalse: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "false",
    zeroOpenAI: true, zeroDatabase: true, zeroTools: true }));
}
