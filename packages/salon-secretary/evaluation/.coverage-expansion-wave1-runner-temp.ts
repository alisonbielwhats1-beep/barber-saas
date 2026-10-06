import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import nextEnv from "@next/env";
import { assessJevAcceptance } from "./acceptance-policy";
import { parseConditionalStage, routeDiscovery } from "./conditional-plan";
import { type EvaluationInput, type EvaluationResult, type QuestionId } from "./contract";
import { expansionDataset } from "./coverage-expansion-dataset";
import { prepareCoverageExpansion, scoreExpansionVerdict } from "./coverage-expansion-plan";
import { composeDerived, derivedResult, type DerivedResult } from "./derived-plan";
import { derivationCatalog, derivationCatalogHash, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { INPUT_USD_PER_MILLION, JEV_ENDPOINT, JEV_MODEL, JevDecisionProvider, type JevWireRequest } from "./jev-provider";

// One-use evaluation orchestrator. The frozen plan, policy, parser, catalog and runtime are not modified.
nextEnv.loadEnvConfig(process.cwd());
const planPath = "packages/salon-secretary/evaluation/coverage-expansion-plan.json";
const reportPath = "packages/salon-secretary/evaluation/coverage-expansion-wave1-real-2026-09-23.json";
const hashes: Record<string, string> = {
  [planPath]: "0db86b3cd6087cfaa6a1d8403aeeb481ca2d718cf4afa61df5c0cabe380e2de7",
  "docs/SECRETARIA_JEV_COVERAGE_EXPANSION_WAVE1.md": "e90a67ba10569ae42c2dfc9dfcafc97f949b396a78e17373195284c8c54e4dcc",
  "packages/salon-secretary/evaluation/acceptance-policy.ts": "ba2223442b203b6c0a055662b7a6f861e648bdfe06bb0fc680da7da7eca0958c",
  "packages/salon-secretary/evaluation/conditional-plan.ts": "836ef27063f0a191d409b9103b5d4f6fce8db86b1d85dfa03e74ff03585f0761",
  "packages/salon-secretary/evaluation/jev-provider.ts": "44449d30c852e36fe277ef7572d8de7ed0bf86d6e61f7535894303c065024960",
  "packages/salon-secretary/evaluation/derived-provider.ts": "e0f91cd3fa67058183a92f0f78cc19d3ad504896931e9b03b1e30ddcfea1995c",
  "packages/salon-secretary/evaluation/derived-plan.ts": "9212fd428464f692d49e9d44db240fe64fa3de20b4e4a76d24e7cba282aba52f",
  "packages/salon-secretary/evaluation/derivation-catalog.ts": "93c145a85ad25f32e813a08a61e068f5d7590ef148abc36422a6959c32a9a6b1",
  "packages/salon-secretary/evaluation/coverage-expansion-dataset.ts": "3964c42bcbc60820e83b801bd808b69369ba95a96e2588f8f7358744ccf2dafa",
};
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const ensureFrozen = () => {
  for (const [path, expected] of Object.entries(hashes)) if (digest(path) !== expected) throw Error("CATALOG_OR_PAYLOAD_HASH_DRIFT");
  if (!isAuditedPublication(publishedDecisionCatalog()) || derivationCatalogHash(derivationCatalog) !==
      "0300667615177bf9d96bb9c96a9f055ff99041db111b0e9fb78e48f407434791") throw Error("CATALOG_OR_PAYLOAD_HASH_DRIFT");
};
const key = process.env.TYPESAFE_API_KEY?.trim();
if (!key || process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" || process.env.SALON_SECRETARY_MODEL !== "gpt-6-luna" ||
    INPUT_USD_PER_MILLION !== 0.042 || existsSync(reportPath)) throw Error("PREFLIGHT_FAILED");
ensureFrozen();
const frozen = JSON.parse(readFileSync(planPath, "utf8"));
const prepared = prepareCoverageExpansion();
const wave = frozen.waves?.[0];
if (frozen.version !== prepared.version || frozen.datasetHash !== prepared.datasetHash || frozen.payloadsHash !== prepared.payloadsHash ||
    JSON.stringify(wave) !== JSON.stringify(prepared.waves[0]) || wave?.wave !== 1 || wave.caseCount !== 32 ||
    wave.maxHttpCalls !== 64 || frozen.retries !== 0 || frozen.catalog.version !== prepared.catalog.version ||
    frozen.catalog.hash !== prepared.catalog.hash || frozen.catalog.publicationHash !== prepared.catalog.publicationHash ||
    frozen.pricing.inputUsdPerMillion !== INPUT_USD_PER_MILLION || frozen.pricing.outputUsdPerMillion !== 0)
  throw Error("FROZEN_PLAN_MISMATCH");
const maxHttp = 64, maxInputPerHttp = 64_000;
const maximumCostUsd = maxHttp * maxInputPerHttp * INPUT_USD_PER_MILLION / 1_000_000;
const safeBody = (request: JevWireRequest) => {
  const serialized = JSON.stringify(request);
  if (!serialized || serialized.includes(key) || /"(?:expected|domainFields|evidence|TYPESAFE_API_KEY|phone|customer_ref|salonId|appointment_ref|product_ref)"/i.test(serialized) ||
      /(?:\+?\d[\s().-]*){8,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(serialized)) throw Error("FORBIDDEN_PAYLOAD_DATA");
  if (Object.keys(request).sort().join() !== "model,questions,state" || request.model !== JEV_MODEL) throw Error("FORBIDDEN_PAYLOAD_DATA");
  return serialized;
};
for (let i = 0; i < wave.cases.length; i++) {
  const c = wave.cases[i], oracle = expansionDataset[i];
  if (c.id !== `f${String(i + 1).padStart(2, "0")}` || c.id !== oracle?.id || c.message !== oracle.input.message ||
      JSON.stringify(c.expected) !== JSON.stringify(oracle.expected) ||
      Object.keys(c.payloads.detailBySkill).join() !== "financial" ||
      Object.keys(c.payloads.discovery.questions).join() !== "skill,shape" ||
      Object.keys(c.payloads.detailBySkill.financial.questions).join() !== "metric,period") throw Error("FROZEN_PLAN_MISMATCH");
  safeBody(c.payloads.discovery);
  safeBody(c.payloads.detailBySkill.financial);
}
console.log(JSON.stringify({ preflight: "PASS", wave: 1, cases: wave.caseCount, maxHttp, maximumCostUsd,
  frozenPlanSha256: hashes[planPath], datasetHash: frozen.datasetHash, payloadsHash: frozen.payloadsHash,
  catalogHash: frozen.catalog.hash, keyPresent: true, paidFlagFalse: true, model: process.env.SALON_SECRETARY_MODEL,
  networkEnabled: process.env.JEV_WAVE1_EXECUTE === "1" }));
if (process.env.JEV_WAVE1_EXECUTE !== "1") process.exit(0);

type Round = Record<string, unknown>;
const report: Record<string, unknown> = { version: "jev-coverage-expansion-wave1-real-v1", wave: 1,
  frozenPlanSha256: hashes[planPath], datasetHash: frozen.datasetHash, payloadsHash: frozen.payloadsHash,
  catalog: frozen.catalog, sourceHashes: hashes, pricing: { inputUsdPerMillion: INPUT_USD_PER_MILLION,
    outputUsdPerMillion: 0, estimateNotBilled: true, maximumCostUsd },
  cases: [], activeCase: null, executedEvaluations: 0, executedHttp: 0, estimatedCostUsdKnown: 0,
  reservedCostUsd: 0, stopReason: null, zeroOpenAI: true, zeroTools: true, zeroDatabase: true,
  zeroEverflairEffects: true, paidFlagFalse: true, model: "gpt-6-luna" };
const completed = report.cases as Record<string, unknown>[];
let httpCount = 0, knownCost = 0, reservedCost = 0;
const save = () => {
  report.executedEvaluations = completed.length;
  report.executedHttp = httpCount;
  report.estimatedCostUsdKnown = knownCost;
  report.reservedCostUsd = reservedCost;
  const contents = JSON.stringify(report, null, 2);
  if (contents.includes(key)) throw Error("SECRET_IN_REPORT");
  writeFileSync(reportPath, contents + "\n", "utf8");
};
const now = () => performance.now();
const stageCall = async (input: EvaluationInput, request: JevWireRequest, label: "discovery" | "detail", rounds: Round[]) => {
  ensureFrozen();
  const expectedBody = safeBody(request);
  let httpLatencyMs: number | null = null, httpStatus: number | null = null, sentBytes = 0;
  const provider = new JevDecisionProvider({ credential: () => key, timeoutMs: 10_000, now,
    protocol: { build: () => request, parse: raw => parseConditionalStage(raw, request) },
    transport: async (url, init) => {
      ensureFrozen();
      if (url !== JEV_ENDPOINT || init?.method !== "POST" || init.body !== expectedBody ||
          init.redirect !== "error" || httpCount >= maxHttp ||
          reservedCost + maxInputPerHttp * INPUT_USD_PER_MILLION / 1_000_000 > maximumCostUsd + 1e-12)
        throw Error("WIRE_OR_BUDGET_GUARD");
      sentBytes = Buffer.byteLength(expectedBody, "utf8");
      httpCount++;
      (report.activeCase as Record<string, unknown>).inFlight = { label, sentBytes, httpOrdinal: httpCount };
      save();
      const started = now();
      try { const response = await fetch(url, init); httpStatus = response.status; return response; }
      finally { httpLatencyMs = now() - started; }
    },
  });
  const outcome = await provider.evaluate(input);
  if (outcome.estimatedCostUsd !== null) knownCost += outcome.estimatedCostUsd;
  reservedCost += outcome.estimatedCostUsd ?? maxInputPerHttp * INPUT_USD_PER_MILLION / 1_000_000;
  rounds.push({ label, request, httpStatus, httpLatencyMs, stageLatencyMs: outcome.latencyMs, sentBytes,
    requestId: outcome.requestId, modelRequested: outcome.modelRequested, modelReturned: outcome.modelReturned,
    status: outcome.status, error: outcome.error, answers: outcome.answers, usage: outcome.usage,
    estimatedCostUsd: outcome.estimatedCostUsd, invalidResponseDiagnostic: outcome.invalidResponseDiagnostic ?? null });
  (report.activeCase as Record<string, unknown>).inFlight = null;
  save();
  if (reservedCost > maximumCostUsd + 1e-12) throw Error("BUDGET_EXCEEDED");
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
  for (const c of wave.cases) {
    ensureFrozen();
    const oracle = expansionDataset.find(x => x.id === c.id)!;
    const input = oracle.input, started = now(), rounds: Round[] = [], result = derivedResult();
    report.activeCase = { id: c.id, message: c.message, rounds, inFlight: null };
    save();
    const discovery = await stageCall(input, c.payloads.discovery, "discovery", rounds);
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
        result.status = "NO_MATCH";
        result.fallbackReasons = ["SKILL_OUTSIDE_FINANCIAL_WAVE"];
      } else {
        const detailRequest = c.payloads.detailBySkill.financial;
        const detail = await stageCall(input, detailRequest, "detail", rounds);
        attach(result, { kind: "detail", skill: "financial" }, detailRequest, detail);
        if (detail.status === "ERROR") {
          result.status = "ERROR"; result.error = detail.error; result.fallbackReasons = [...detail.fallbackReasons];
        } else {
          const composed = composeDerived("financial", discovery, detail);
          if (!composed.ok) {
            result.status = "NO_MATCH"; result.fallbackReasons = [...detail.fallbackReasons, composed.reason];
          } else {
            result.decision = composed.decision;
            result.dependencies = [];
            result.derivations = composed.derivations;
            for (const d of composed.derivations) result.dimensionSources[d.dimension] = "DERIVED";
            for (const id of composed.notApplicable) result.dimensionSources[id] = "NOT_APPLICABLE";
            result.closedCoverage = composed.closedCoverage;
            result.requiresLuna = !composed.closedCoverage;
            result.fallbackReasons = [...composed.reasons, "NO_ACCEPTANCE_POLICY"];
            result.status = "OK";
          }
        }
      }
    }
    result.latencyMs = now() - started;
    const inputs = result.stages.map(s => s.result.usage.inputTokens);
    const outputs = result.stages.map(s => s.result.usage.outputTokens);
    result.usage = { inputTokens: inputs.every(v => v !== null) ? inputs.reduce((n, v) => n + (v ?? 0), 0) : null,
      outputTokens: outputs.every(v => v !== null) ? outputs.reduce((n, v) => n + (v ?? 0), 0) : null };
    result.estimatedCostUsd = rounds.every(r => typeof r.estimatedCostUsd === "number") ?
      rounds.reduce((n, r) => n + (r.estimatedCostUsd as number), 0) : null;
    const policyStarted = now();
    const verdict = assessJevAcceptance(input, result);
    const policyMs = now() - policyStarted;
    const score = scoreExpansionVerdict(oracle, result, verdict);
    const invalid = result.error === "INVALID_RESPONSE";
    const classification = invalid ? "INVALID_PROVIDER_RESPONSE" : score.classification === "OUT_OF_CATALOG_FALLBACK" &&
      result.fallbackReasons.includes("OUT_OF_CATALOG") ? "OUT_OF_CATALOG_CORRECT" : score.classification === "CORRECT_FALLBACK_UNDER_V1" ?
      "CORRECT_FALLBACK" : score.classification;
    const item = { id: c.id, tag: c.tag, message: c.message, oracle: c.expected, score, classification,
      policy: verdict, result, rounds, httpCalls: rounds.filter(r => (r.sentBytes as number) > 0).length,
      discoveryMs: rounds.find(r => r.label === "discovery")?.stageLatencyMs ?? null,
      detailMs: rounds.find(r => r.label === "detail")?.stageLatencyMs ?? null,
      policyMs, totalEvaluationMs: now() - started,
      sentBytes: rounds.reduce((n, r) => n + (r.sentBytes as number), 0),
      estimatedCostUsd: result.estimatedCostUsd, wouldAvoidLunaUnderCurrentPolicy: verdict.decision === "ACCEPT_JEV",
      calibrationOnlyCorrectNotAccepted: score.calibrationOnlyCorrectNotAccepted };
    completed.push(item);
    report.activeCase = null;
    save();
    console.log(JSON.stringify({ id: c.id, classification, policy: verdict.decision, reason: verdict.reason,
      linguisticCorrect: score.linguisticCorrect, unsafeShadowCandidate: score.unsafeShadowCandidate,
      httpCount, knownCostUsd: knownCost, providerError: result.error, invalidDiagnostic: rounds.find(r => r.invalidResponseDiagnostic)?.invalidResponseDiagnostic ?? null }));
    if (score.unsafeFalsePositive) throw Error("UNSAFE_FALSE_POSITIVE");
    if (score.unsafeShadowCandidate) throw Error("UNSAFE_SHADOW_CANDIDATE");
    if (invalid) throw Error("STRICT_PROBABILITY_OR_SCHEMA_FAILURE");
    if (result.status === "ERROR") throw Error("UNHANDLED_ERROR");
    if (result.fallbackReasons.some(r => /CATALOG_DRIFT|UNPUBLISHED_OR_INCOMPATIBLE/.test(r)) ||
        verdict.reason === "CATALOG_VERSION_MISMATCH") throw Error("CATALOG_OR_PAYLOAD_HASH_DRIFT");
  }
  report.stopReason = "COMPLETED_32";
} catch (error) {
  report.stopReason = error instanceof Error ? error.message : "UNHANDLED_ERROR";
} finally {
  report.activeCase = report.activeCase ?? null;
  save();
  console.log(JSON.stringify({ completed: completed.length, http: httpCount, stopReason: report.stopReason,
    knownCostUsd: knownCost, reservedCostUsd: reservedCost, zeroOpenAI: true, zeroTools: true,
    zeroDatabase: true, paidFlagFalse: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "false" }));
}
