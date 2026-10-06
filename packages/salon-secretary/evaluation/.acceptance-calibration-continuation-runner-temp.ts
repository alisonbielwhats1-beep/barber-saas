import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import nextEnv from "@next/env";
import { prepareAcceptanceCalibrationContinuation } from "./acceptance-calibration-continuation";
import { assessJevAcceptance } from "./acceptance-policy";
import { scoreAcceptanceTrials } from "./acceptance-audit";
import { dataset } from "./dataset";
import { parseConditionalStage, routeDiscovery } from "./conditional-plan";
import { composeDerived, derivedResult } from "./derived-plan";
import { deriveOperation, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { INPUT_USD_PER_MILLION, JEV_ENDPOINT, JEV_MODEL, JevDecisionProvider } from "./jev-provider";
import type { EvaluationInput, EvaluationResult } from "./contract";

nextEnv.loadEnvConfig(process.cwd());
const plan = prepareAcceptanceCalibrationContinuation();
const prior = JSON.parse(readFileSync("packages/salon-secretary/evaluation/acceptance-calibration-real-2026-09-23.json", "utf8"));
const reportPath = "packages/salon-secretary/evaluation/acceptance-calibration-continuation-real-2026-09-23.json";
const expectedHashes: Record<string, string> = {
  "packages/salon-secretary/evaluation/acceptance-policy.ts": "ba2223442b203b6c0a055662b7a6f861e648bdfe06bb0fc680da7da7eca0958c",
  "packages/salon-secretary/evaluation/acceptance-calibration-plan.ts": "e919a7100d1487dc5c93cb96e14ac313c5c6f2c000c433f18e5034678356e70d",
  "packages/salon-secretary/evaluation/dataset.ts": "af7ca3a568dbc6bfe96452cc92e0f36bbe65ce3a6b0c046de7f665fa08be5300",
  "packages/salon-secretary/evaluation/derivation-catalog.ts": "93c145a85ad25f32e813a08a61e068f5d7590ef148abc36422a6959c32a9a6b1",
  "packages/salon-secretary/evaluation/derived-plan.ts": "9212fd428464f692d49e9d44db240fe64fa3de20b4e4a76d24e7cba282aba52f",
  "packages/salon-secretary/evaluation/conditional-plan.ts": "836ef27063f0a191d409b9103b5d4f6fce8db86b1d85dfa03e74ff03585f0761",
  "packages/salon-secretary/evaluation/jev-provider.ts": "44449d30c852e36fe277ef7572d8de7ed0bf86d6e61f7535894303c065024960",
  "packages/salon-secretary/evaluation/invalid-response-diagnostic.ts": "eab6420e45795d56ff314a0f53d34ebb5369c6b191fea7109d773e005d493267",
  "packages/salon-secretary/evaluation/acceptance-calibration-continuation.ts": "48d310cfaaaafe7eb617cf13ec7facf53eb55f97144ae10a264edf47dd6b640e",
};
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const ensureFrozen = () => {
  for (const [path, expected] of Object.entries(expectedHashes)) if (digest(path) !== expected) throw Error("FROZEN_SOURCE_CHANGED");
  if (!isAuditedPublication(publishedDecisionCatalog()) || !deriveOperation("financial", "single", "metric", "service_revenue").ok ||
      !deriveOperation("inventory", "single", "inventory", "low_stock").ok) throw Error("CATALOG_DRIFT");
};
const safePayload = (payload: unknown, key: string) => {
  const serialized = JSON.stringify(payload);
  if (!serialized || serialized.includes(key) || /"(?:expected|domainFields|evidence|TYPESAFE_API_KEY|phone|customer_ref|salonId|appointment_ref)"/i.test(serialized) ||
      /(?:\+?\d[\s().-]*){8,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(serialized)) throw Error("PROHIBITED_PAYLOAD_DATA");
  const data = payload as Record<string, unknown>;
  if (Object.keys(data).sort().join() !== "model,questions,state" || data.model !== JEV_MODEL) throw Error("UNAPPROVED_PAYLOAD_SHAPE");
  return serialized;
};
const key = process.env.TYPESAFE_API_KEY?.trim();
if (!key || process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" || process.env.SALON_SECRETARY_MODEL !== "gpt-6-luna" ||
    plan.maxAdditionalEvaluations !== 3 || plan.maxAdditionalHttp !== 6 || plan.zeroRetries !== true ||
    INPUT_USD_PER_MILLION !== 0.042 || prior.cases?.length !== 17 || prior.scoring?.unsafeFalsePositives !== 0 ||
    existsSync(reportPath)) throw Error("PREFLIGHT_FAILED");
ensureFrozen();
for (const c of plan.cases) {
  safePayload(c.discoveryPayload, key);
  if (c.conditionalDetailPayload) safePayload(c.conditionalDetailPayload, key);
  const oracle = dataset.find(x => x.id === c.caseId);
  if (!oracle || oracle.input.message !== c.message || JSON.stringify(oracle.expected.decision) !== JSON.stringify(c.expected)) throw Error("PLAN_DRIFT");
}
const maxAdditionalCostUsd = plan.maxAdditionalHttp * 64_000 * INPUT_USD_PER_MILLION / 1_000_000;
console.log(JSON.stringify({ preflight: "PASS", priorCompleted: 17, priorHttp: 31, remaining: plan.cases.map(c => c.sequence),
  maxAdditionalHttp: plan.maxAdditionalHttp, maxAdditionalCostUsd, sourceFrozen: true, secretPresent: true,
  paidFlagFalse: true, networkEnabled: process.env.JEV_CONTINUATION_EXECUTE === "1" }));
if (process.env.JEV_CONTINUATION_EXECUTE !== "1") process.exit(0);

type Round = Record<string, unknown>;
const report: Record<string, unknown> = { version: "jev-calibration-continuation-real-v1", priorReportSha256: plan.priorEvidenceSha256,
  cases: [], activeCase: null, executedEvaluations: 0, executedHttp: 0, estimatedCostUsdKnown: 0, reservedCostUsd: 0,
  sourceHashes: expectedHashes, stopReason: null, zeroOpenAI: true, zeroTools: true, zeroDatabase: true, zeroEverflairEffects: true };
const cases = report.cases as Record<string, unknown>[];
let httpCount = 0, knownCost = 0, reservedCost = 0;
const save = () => {
  report.executedEvaluations = cases.length; report.executedHttp = httpCount;
  report.estimatedCostUsdKnown = knownCost; report.reservedCostUsd = reservedCost;
  const data = JSON.stringify(report, null, 2);
  if (data.includes(key)) throw Error("SECRET_IN_REPORT");
  writeFileSync(reportPath, data + "\n", "utf8");
};
const now = () => performance.now();
const stageCall = async (input: EvaluationInput, request: typeof plan.cases[number]["discoveryPayload"], label: "discovery" | "detail", rounds: Round[]) => {
  ensureFrozen();
  const expectedBody = safePayload(request, key);
  let httpLatencyMs: number | null = null, httpStatus: number | null = null, sentBytes = 0;
  const provider = new JevDecisionProvider({ credential: () => key, timeoutMs: 10_000, now,
    protocol: { build: () => request, parse: raw => parseConditionalStage(raw, request) },
    transport: async (url, init) => {
      ensureFrozen();
      if (url !== JEV_ENDPOINT || init?.method !== "POST" || init.body !== expectedBody || httpCount >= plan.maxAdditionalHttp ||
          prior.executedHttp + httpCount >= 40) throw Error("WIRE_GUARD");
      sentBytes = Buffer.byteLength(expectedBody, "utf8"); httpCount++;
      const started = now();
      try { const response = await fetch(url, init); httpStatus = response.status; return response; }
      finally { httpLatencyMs = now() - started; }
    } });
  const outcome = await provider.evaluate(input);
  if (outcome.estimatedCostUsd !== null) knownCost += outcome.estimatedCostUsd;
  reservedCost += outcome.estimatedCostUsd ?? 64_000 * INPUT_USD_PER_MILLION / 1_000_000;
  rounds.push({ label, request, httpStatus, httpLatencyMs, totalStageMs: outcome.latencyMs, sentBytes,
    requestId: outcome.requestId, modelRequested: outcome.modelRequested, modelReturned: outcome.modelReturned,
    status: outcome.status, error: outcome.error, answers: outcome.answers, usage: outcome.usage,
    estimatedCostUsd: outcome.estimatedCostUsd, invalidResponseDiagnostic: outcome.invalidResponseDiagnostic ?? null });
  save();
  if (reservedCost > maxAdditionalCostUsd || prior.executedHttp + httpCount > 40) throw Error("CALL_BUDGET_EXCEEDED");
  return outcome;
};

try {
  for (const c of plan.cases) {
    ensureFrozen();
    const input = dataset.find(x => x.id === c.caseId)!.input;
    const started = now(), rounds: Round[] = [], derived = derivedResult();
    report.activeCase = { sequence: c.sequence, caseId: c.caseId, message: c.message, expected: c.expected, rounds }; save();
    const discovery = await stageCall(input, c.discoveryPayload, "discovery", rounds);
    derived.stages.push({ stage: { kind: "discovery" }, request: c.discoveryPayload, result: discovery });
    Object.assign(derived.answers, discovery.answers);
    for (const id of Object.keys(discovery.answers) as (keyof typeof derived.dimensionSources)[]) derived.dimensionSources[id] = "ASKED";
    derived.modelRequested = discovery.modelRequested; derived.modelReturned = discovery.modelReturned;
    if (discovery.status === "ERROR") {
      derived.status = "ERROR"; derived.error = discovery.error; derived.fallbackReasons = [...discovery.fallbackReasons];
      const diagnosis = discovery.invalidResponseDiagnostic;
      if (c.sequence !== 18 || discovery.error !== "INVALID_RESPONSE" || !diagnosis ||
          diagnosis.reason === "UNCLASSIFIED_VALIDATION_FAILURE") throw Error(discovery.error ?? "UNHANDLED_PROVIDER_ERROR");
    } else {
      const route = routeDiscovery(discovery);
      if (route.kind === "stop") {
        derived.status = "NO_MATCH"; derived.requiresLuna = route.reason !== "OUT_OF_CATALOG";
        derived.fallbackReasons = [...new Set([...discovery.fallbackReasons, route.reason])];
      } else if (!c.conditionalDetailPayload || c.conditionalDetailPayload.state.selected_skill !== route.skill) {
        derived.status = "NO_MATCH"; derived.fallbackReasons = ["DETAIL_NOT_IN_FROZEN_PLAN"];
      } else {
        const detail = await stageCall(input, c.conditionalDetailPayload, "detail", rounds);
        derived.stages.push({ stage: { kind: "detail", skill: route.skill }, request: c.conditionalDetailPayload, result: detail });
        Object.assign(derived.answers, detail.answers);
        for (const id of Object.keys(detail.answers) as (keyof typeof derived.dimensionSources)[]) derived.dimensionSources[id] = "ASKED";
        derived.modelRequested = detail.modelRequested; derived.modelReturned = detail.modelReturned;
        if (detail.status === "ERROR") { derived.status = "ERROR"; derived.error = detail.error; derived.fallbackReasons = [...detail.fallbackReasons];
          throw Error(detail.error ?? "UNHANDLED_PROVIDER_ERROR"); }
        const composed = composeDerived(route.skill, discovery, detail);
        if (!composed.ok) { derived.status = "NO_MATCH"; derived.fallbackReasons = [...detail.fallbackReasons, composed.reason]; }
        else {
          derived.decision = composed.decision; derived.dependencies = []; derived.derivations = composed.derivations;
          for (const d of composed.derivations) derived.dimensionSources[d.dimension] = "DERIVED";
          for (const id of composed.notApplicable) derived.dimensionSources[id] = "NOT_APPLICABLE";
          derived.closedCoverage = composed.closedCoverage; derived.requiresLuna = !composed.closedCoverage;
          derived.fallbackReasons = [...composed.reasons, "NO_ACCEPTANCE_POLICY"]; derived.status = "OK";
        }
      }
    }
    derived.latencyMs = now() - started;
    const inputUsages = derived.stages.map(s => s.result.usage.inputTokens);
    const outputUsages = derived.stages.map(s => s.result.usage.outputTokens);
    derived.usage = { inputTokens: inputUsages.every(x => x !== null) ? inputUsages.reduce((n, x) => n + (x ?? 0), 0) : null,
      outputTokens: outputUsages.every(x => x !== null) ? outputUsages.reduce((n, x) => n + (x ?? 0), 0) : null };
    derived.estimatedCostUsd = rounds.every(r => typeof r.estimatedCostUsd === "number") ?
      rounds.reduce((n, r) => n + (r.estimatedCostUsd as number), 0) : null;
    const policyStarted = now(), verdict = assessJevAcceptance(input, derived), policyMs = now() - policyStarted;
    const correct = !!derived.decision && Object.keys(c.expected).every(k =>
      (derived.decision as Record<string, unknown>)[k] === (c.expected as Record<string, unknown>)[k]);
    const accepted = verdict.decision === "ACCEPT_JEV";
    const classification = accepted ? correct ? "CORRECT_ACCEPT" : "UNSAFE_FALSE_POSITIVE" : c.route === "OUT_OF_CATALOG" &&
      discovery.answers.skill?.choice === "out_of_catalog" && discovery.answers.shape?.choice === "out_of_catalog" ? "OUT_OF_CATALOG_CORRECT" :
      c.route === "JEV_CANDIDATE" && correct ? "FALSE_FALLBACK" : "CORRECT_FALLBACK";
    const item = { sequence: c.sequence, trialId: c.trialId, caseId: c.caseId, message: c.message, expected: c.expected,
      predicted: derived.decision, answers: derived.answers, derivations: derived.derivations, providerStatus: derived.status,
      providerFallbackReasons: derived.fallbackReasons, policy: verdict, classification, rounds, derivedResult: derived,
      httpCalls: rounds.filter(r => typeof r.sentBytes === "number" && r.sentBytes > 0).length,
      totalJevMs: rounds.reduce((n, r) => n + (typeof r.totalStageMs === "number" ? r.totalStageMs : 0), 0),
      policyMs, totalEvaluationMs: now() - started, usage: derived.usage, estimatedCostUsd: derived.estimatedCostUsd,
      wouldAvoidLuna: accepted, fallbackWouldBeGpt6Luna: !accepted };
    cases.push(item); report.activeCase = null; save();
    console.log(JSON.stringify({ sequence: c.sequence, caseId: c.caseId, classification, policy: verdict.decision, reason: verdict.reason,
      actualHttp: httpCount, knownCostUsd: knownCost, invalidDiagnostic: discovery.invalidResponseDiagnostic?.reason ?? null }));
    if (classification === "UNSAFE_FALSE_POSITIVE") throw Error("UNSAFE_FALSE_POSITIVE");
    if (derived.fallbackReasons.some(x => /CATALOG_DRIFT|MAPPING_|UNPUBLISHED_OR_INCOMPATIBLE/.test(x)) ||
        verdict.reason === "CATALOG_VERSION_MISMATCH") throw Error("CATALOG_DRIFT");
    if (verdict.reason === "INVALID_PROVIDER_RESPONSE" && discovery.error !== "INVALID_RESPONSE" &&
        !derived.fallbackReasons.includes("DETAIL_NOT_IN_FROZEN_PLAN")) throw Error("UNHANDLED_PROVIDER_RESPONSE");
  }
  report.stopReason = "COMPLETED_20";
} catch (error) {
  report.stopReason = error instanceof Error ? error.message : "UNKNOWN_STOP";
} finally {
  try {
    report.scoring = scoreAcceptanceTrials([...prior.cases, ...cases].map((x: Record<string, unknown>) =>
      ({ trialId: x.trialId as string, caseId: x.caseId as string, result: x.derivedResult }))).metrics;
  } catch { report.scoring = null; }
  save();
  console.log(JSON.stringify({ completedNew: cases.length, completedTotal: 17 + cases.length, httpNew: httpCount, httpTotal: prior.executedHttp + httpCount,
    stopReason: report.stopReason, knownCostUsd: knownCost, zeroOpenAI: true,
    paidFlagFalse: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "false" }));
}
