import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import nextEnv from "@next/env";
import { prepareAcceptanceCalibrationPlan } from "./acceptance-calibration-plan";
import { assessJevAcceptance } from "./acceptance-policy";
import { scoreAcceptanceTrials } from "./acceptance-audit";
import { dataset } from "./dataset";
import { parseConditionalStage, routeDiscovery } from "./conditional-plan";
import { composeDerived, derivedResult } from "./derived-plan";
import { derivationCatalog, deriveOperation, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { INPUT_USD_PER_MILLION, JEV_ENDPOINT, JevDecisionProvider } from "./jev-provider";

nextEnv.loadEnvConfig(process.cwd());
const plan = prepareAcceptanceCalibrationPlan();
const reportPath = "packages/salon-secretary/evaluation/acceptance-calibration-real-2026-09-23.json";
const sourcePaths = [
  "packages/salon-secretary/evaluation/acceptance-calibration-plan.ts",
  "packages/salon-secretary/evaluation/acceptance-policy.ts",
  "packages/salon-secretary/evaluation/acceptance-audit.ts",
  "packages/salon-secretary/evaluation/dataset.ts",
  "packages/salon-secretary/evaluation/derived-plan.ts",
  "packages/salon-secretary/evaluation/derivation-catalog.ts",
  "packages/salon-secretary/evaluation/jev-provider.ts",
];
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const baselineHashes = Object.fromEntries(sourcePaths.map(path => [path, digest(path)]));
const ensureFrozen = () => {
  for (const path of sourcePaths) if (digest(path) !== baselineHashes[path]) throw Error("FROZEN_SOURCE_CHANGED");
  if (!isAuditedPublication(publishedDecisionCatalog()) || !deriveOperation("financial", "single", "metric", "service_revenue").ok ||
      !deriveOperation("inventory", "single", "inventory", "low_stock").ok) throw Error("CATALOG_DRIFT");
};
const safePayload = (payload: unknown, key: string) => {
  const text = JSON.stringify(payload);
  if (!text || text.includes(key) || /"(?:expected|domainFields|evidence|TYPESAFE_API_KEY|phone|customer_ref|salonId|appointment_ref)"/i.test(text) ||
      /(?:\+?\d[\s().-]*){8,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(text)) throw Error("PROHIBITED_PAYLOAD_DATA");
  const data = payload as Record<string, unknown>;
  if (Object.keys(data).sort().join() !== "model,questions,state" || data.model !== "jev-1.13.0") throw Error("UNAPPROVED_PAYLOAD_SHAPE");
  return text;
};
const key = process.env.TYPESAFE_API_KEY?.trim();
if (!key || process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" || process.env.SALON_SECRETARY_MODEL !== "gpt-6-luna" ||
    plan.maxCases !== 20 || plan.maxHttpCalls !== 40 || plan.retries !== 0 || INPUT_USD_PER_MILLION !== 0.042) throw Error("PREFLIGHT_FAILED");
ensureFrozen();
for (const c of plan.cases) {
  safePayload(c.discoveryPayload, key);
  if (c.conditionalDetailPayload) safePayload(c.conditionalDetailPayload, key);
  const oracle = dataset.find(x => x.id === c.caseId);
  if (!oracle || oracle.input.message !== c.message || JSON.stringify(oracle.expected.decision) !== JSON.stringify(c.expected)) throw Error("PLAN_DRIFT");
}
console.log(JSON.stringify({ preflight: "PASS", cases: plan.maxCases, maxHttp: plan.maxHttpCalls, pricePerMillionInputUsd: INPUT_USD_PER_MILLION,
  maxEstimatedUsd: plan.conservativeEstimatedMaxCostUsd, secretPresent: true, paidFlagFalse: true, sourceFrozen: true, networkEnabled: process.env.JEV_CALIBRATION_EXECUTE === "1" }));
if (process.env.JEV_CALIBRATION_EXECUTE !== "1") process.exit(0);

const report: Record<string, unknown> = { version: "jev-calibration-real-v1", scope: "Gate 3.1C-B", sourceHashes: baselineHashes,
  officialPricePerMillionInputUsd: INPUT_USD_PER_MILLION, maxEstimatedUsd: plan.conservativeEstimatedMaxCostUsd,
  executedEvaluations: 0, executedHttp: 0, estimatedCostUsd: 0, cases: [], activeCase: null, stopReason: null,
  zeroOpenAI: true, zeroTools: true, zeroDatabase: true, zeroEverflairEffects: true };
const cases = report.cases as Record<string, unknown>[];
let httpCount = 0, estimatedCost = 0;
const save = () => {
  report.executedHttp = httpCount; report.executedEvaluations = cases.length; report.estimatedCostUsd = estimatedCost;
  const data = JSON.stringify(report, null, 2);
  if (data.includes(key)) throw Error("SECRET_IN_REPORT");
  writeFileSync(reportPath, data + "\n", "utf8");
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const now = () => performance.now();
const stageCall = async (input: typeof dataset[number]["input"], request: typeof plan.cases[number]["discoveryPayload"], label: "discovery" | "detail", rounds: Record<string, unknown>[]) => {
  ensureFrozen();
  const expectedBody = safePayload(request, key);
  let httpLatencyMs: number | null = null, httpStatus: number | null = null, sentBytes = 0;
  const provider = new JevDecisionProvider({ credential: () => key, timeoutMs: 10_000, now,
    protocol: { build: () => request, parse: raw => parseConditionalStage(raw, request) },
    transport: async (url, init) => {
      ensureFrozen();
      if (url !== JEV_ENDPOINT || init?.method !== "POST" || init.body !== expectedBody || httpCount >= plan.maxHttpCalls) throw Error("WIRE_GUARD");
      sentBytes = Buffer.byteLength(expectedBody, "utf8");
      httpCount++;
      const started = now();
      try { const response = await fetch(url, init); httpStatus = response.status; return response; }
      finally { httpLatencyMs = now() - started; }
    } });
  const outcome = await provider.evaluate(input);
  const cost = outcome.estimatedCostUsd;
  if (cost !== null) estimatedCost += cost;
  rounds.push({ label, request, httpStatus, httpLatencyMs, totalStageMs: outcome.latencyMs, sentBytes,
    requestId: outcome.requestId, modelRequested: outcome.modelRequested, modelReturned: outcome.modelReturned,
    status: outcome.status, error: outcome.error, answers: outcome.answers, usage: outcome.usage, estimatedCostUsd: cost });
  save();
  if (outcome.status === "ERROR" || cost === null || estimatedCost > plan.conservativeEstimatedMaxCostUsd) throw Error(outcome.error ?? "UNKNOWN_USAGE_OR_COST");
  return outcome;
};

try {
  for (const c of plan.cases) {
    ensureFrozen();
    const input = dataset.find(x => x.id === c.caseId)!.input;
    const started = now(), rounds: Record<string, unknown>[] = [], derived = derivedResult();
    report.activeCase = { sequence: c.sequence, caseId: c.caseId, message: c.message, expected: c.expected, rounds };
    save();
    const discovery = await stageCall(input, c.discoveryPayload, "discovery", rounds);
    derived.stages.push({ stage: { kind: "discovery" }, request: c.discoveryPayload, result: discovery });
    Object.assign(derived.answers, discovery.answers);
    for (const id of Object.keys(discovery.answers) as (keyof typeof derived.dimensionSources)[]) derived.dimensionSources[id] = "ASKED";
    derived.modelRequested = discovery.modelRequested; derived.modelReturned = discovery.modelReturned;
    const route = routeDiscovery(discovery);
    if (route.kind === "stop") {
      derived.status = "NO_MATCH"; derived.requiresLuna = route.reason !== "OUT_OF_CATALOG";
      derived.fallbackReasons = [...new Set([...discovery.fallbackReasons, route.reason])];
    } else if (!c.conditionalDetailPayload || c.conditionalDetailPayload.state.selected_skill !== route.skill) {
      // Frozen plan does not authorize another detail question. The discovery remains evidence; no second HTTP is sent.
      derived.status = "NO_MATCH"; derived.fallbackReasons = ["DETAIL_NOT_IN_FROZEN_PLAN"];
    } else {
      const detail = await stageCall(input, c.conditionalDetailPayload, "detail", rounds);
      derived.stages.push({ stage: { kind: "detail", skill: route.skill }, request: c.conditionalDetailPayload, result: detail });
      Object.assign(derived.answers, detail.answers);
      for (const id of Object.keys(detail.answers) as (keyof typeof derived.dimensionSources)[]) derived.dimensionSources[id] = "ASKED";
      derived.modelRequested = detail.modelRequested; derived.modelReturned = detail.modelReturned;
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
    derived.latencyMs = now() - started;
    const inputUsages = derived.stages.map(s => s.result.usage.inputTokens);
    const outputUsages = derived.stages.map(s => s.result.usage.outputTokens);
    derived.usage = { inputTokens: inputUsages.every(x => x !== null) ? inputUsages.reduce((n, x) => n + (x ?? 0), 0) : null,
      outputTokens: outputUsages.every(x => x !== null) ? outputUsages.reduce((n, x) => n + (x ?? 0), 0) : null };
    derived.estimatedCostUsd = rounds.reduce((n, x) => n + (typeof x.estimatedCostUsd === "number" ? x.estimatedCostUsd : 0), 0);
    const policyStarted = now(), verdict = assessJevAcceptance(input, derived), policyMs = now() - policyStarted;
    const expected = c.expected, correct = !!derived.decision && Object.keys(expected).every(k => (derived.decision as Record<string, unknown>)[k] === (expected as Record<string, unknown>)[k]);
    const accepted = verdict.decision === "ACCEPT_JEV";
    const classification = accepted ? correct ? "CORRECT_ACCEPT" : "UNSAFE_FALSE_POSITIVE" : c.route === "OUT_OF_CATALOG" &&
      discovery.answers.skill?.choice === "out_of_catalog" && discovery.answers.shape?.choice === "out_of_catalog" ? "OUT_OF_CATALOG_CORRECT" :
      c.route === "JEV_CANDIDATE" && correct ? "FALSE_FALLBACK" : "CORRECT_FALLBACK";
    const item = { sequence: c.sequence, trialId: c.trialId, caseId: c.caseId, message: c.message, expected,
      predicted: derived.decision, answers: derived.answers, derivations: derived.derivations, providerStatus: derived.status,
      providerFallbackReasons: derived.fallbackReasons, policy: verdict, classification, rounds,
      derivedResult: derived,
      httpCalls: rounds.filter(r => typeof r.sentBytes === "number" && r.sentBytes > 0).length, totalJevMs: rounds.reduce((n, r) => n + (typeof r.totalStageMs === "number" ? r.totalStageMs : 0), 0),
      policyMs, totalEvaluationMs: now() - started, usage: derived.usage, estimatedCostUsd: derived.estimatedCostUsd,
      wouldAvoidLuna: accepted, fallbackWouldBeGpt6Luna: !accepted };
    cases.push(item); report.activeCase = null; save();
    console.log(JSON.stringify({ sequence: c.sequence, caseId: c.caseId, classification, policy: verdict.decision, reason: verdict.reason,
      actualHttp: httpCount, estimatedCostUsd: estimatedCost }));
    if (classification === "UNSAFE_FALSE_POSITIVE") throw Error("UNSAFE_FALSE_POSITIVE");
    if (derived.fallbackReasons.some(x => /CATALOG_DRIFT|MAPPING_|UNPUBLISHED_OR_INCOMPATIBLE/.test(x)) || verdict.reason === "CATALOG_VERSION_MISMATCH") throw Error("CATALOG_DRIFT");
    if (verdict.reason === "INVALID_PROVIDER_RESPONSE" && !derived.fallbackReasons.includes("DETAIL_NOT_IN_FROZEN_PLAN")) throw Error("UNHANDLED_PROVIDER_RESPONSE");
  }
  report.stopReason = "COMPLETED_20";
} catch (error) {
  report.stopReason = error instanceof Error ? error.message : "UNKNOWN_STOP";
} finally {
  try { report.scoring = scoreAcceptanceTrials(cases.map(x => ({ trialId: x.trialId as string, caseId: x.caseId as string, result: x.derivedResult }))).metrics; }
  catch { report.scoring = null; }
  save();
  console.log(JSON.stringify({ completed: cases.length, http: httpCount, stopReason: report.stopReason, estimatedCostUsd: estimatedCost,
    zeroOpenAI: true, paidFlagFalse: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "false" }));
}
