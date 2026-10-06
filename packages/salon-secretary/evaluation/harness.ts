import { createHash } from "node:crypto";
import { emptyResult, operationSkill, type Decision, type EvaluationCase, type EvaluationInput, type EvaluationResult } from "./contract";
import { validateDataset } from "./dataset";

export type EvaluationProvider = { evaluate(input: EvaluationInput): Promise<EvaluationResult> };
export type FastPathParser = (input: EvaluationInput) => Record<string, unknown> | undefined;
export function inputFingerprint(input: EvaluationInput) { return createHash("sha256").update(JSON.stringify({ message: input.message, context: input.context })).digest("hex"); }
export function replayFastPath(input: EvaluationInput, parse: FastPathParser, now = () => performance.now()): EvaluationResult {
  const result = emptyResult("FAST_PATH"), start = now(), patch = parse(input);
  result.latencyMs = now() - start;
  result.estimatedCostUsd = 0; result.usage = { inputTokens: 0, outputTokens: 0 };
  if (!patch || !input.context.operation || !input.context.waiting_for) { result.status = "NO_MATCH"; result.fallbackReasons = ["NO_DETERMINISTIC_MATCH"]; return result; }
  result.status = "OK"; result.fastPathPatch = patch; result.dependencies = [];
  result.decision = { skill: operationSkill(input.context.operation), operation: input.context.operation, shape: "single", period: "none", metric: "none", inventory: input.context.operation === "stock.movement" ? input.context.inventory_mode ?? "unclear" : "none", communication: input.context.operation === "customer.message" ? "unspecified" : "none" };
  return result;
}
export type ArchiveEntry = { caseId: string; inputFingerprint: string; source: string; comparability: "decision_only" | "paired"; result: EvaluationResult };
export type Row = { caseId: string; category: EvaluationCase["category"]; result: EvaluationResult; match: { skill: boolean; operation: boolean; decision: boolean; dependencies: boolean | null; fastPath: boolean | null }; needsFallback: boolean; acceptedByEvaluationPolicy: boolean; unsafeFalsePositive: boolean };
/** Explicit experimental acceptance policy; none exists by default. Never executes its decision. */
export type AcceptancePolicy = (input: EvaluationInput, result: EvaluationResult) => boolean;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function scoreCase(c: EvaluationCase, result: EvaluationResult, policy?: AcceptancePolicy): Row {
  const d = result.decision, expected = c.expected;
  // Multi-skill/operation markers are classification only, not full plan accuracy.
  const skill = result.resolvedSkills ? equal([...result.resolvedSkills].sort(), [...expected.skills].sort()) : !!d && expected.skills.length <= 1 && d.skill === expected.decision.skill;
  const operation = result.interpretedOperations ? equal(result.interpretedOperations, expected.operations) : !!d && expected.operations.length <= 1 && d.operation === expected.decision.operation;
  const decision = !!d && (Object.keys(expected.decision) as (keyof Decision)[]).every(k => d[k] === expected.decision[k]);
  const deps = result.dependencies === null ? null : equal(result.dependencies, expected.dependencies);
  const fastPath = result.provider === "FAST_PATH" ? !!expected.fastPathPatch && equal(result.fastPathPatch, expected.fastPathPatch) : null;
  const hasCoverage = result.status === "OK" && result.fallbackReasons.length === 0 && (result.provider === "FAST_PATH" ? !!result.fastPathPatch : d?.shape === "single" && !expected.requiresOpenExtraction && c.category === "B");
  // Expected may restrict coverage for evaluation; never promotes a prediction or enters the request.
  const accepted = !!hasCoverage && (result.provider === "FAST_PATH" || !!policy?.(c.input, result));
  const predictedWrite = !!d && /\.(create|change|cancel|block|movement|message)$/.test(d.operation);
  return { caseId: c.id, category: c.category, result, match: { skill, operation, decision, dependencies: deps, fastPath }, needsFallback: !accepted, acceptedByEvaluationPolicy: accepted, unsafeFalsePositive: accepted && predictedWrite && (!decision || deps === false || fastPath === false) };
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
export function summarize(rows: Row[]) {
  const rate = (n: number, d = rows.length) => d ? n / d : null;
  const costs = rows.map(r => r.result.estimatedCostUsd), allCostsKnown = costs.every(c => c !== null);
  const totalCost = allCostsKnown ? costs.reduce<number>((sum, c) => sum + (c ?? 0), 0) : null;
  const accepted = rows.filter(r => r.acceptedByEvaluationPolicy), unsafe = rows.filter(r => r.unsafeFalsePositive).length;
  return { cases: rows.length, skillAccuracy: rate(rows.filter(r => r.match.skill).length), operationAccuracy: rate(rows.filter(r => r.match.operation).length), decisionAccuracy: rate(rows.filter(r => r.match.decision).length),
    dependencyAccuracy: rate(rows.filter(r => r.match.dependencies === true).length), dependencyCoverage: rate(rows.filter(r => r.match.dependencies !== null).length),
    unsafeFalsePositives: unsafe, unsafeFalsePositiveRateAmongAccepted: rate(unsafe, accepted.length), unsafeFalsePositiveRateAll: rate(unsafe),
    fallbackRate: rate(rows.filter(r => r.needsFallback).length), accepted: accepted.length, errors: rows.filter(r => r.result.status === "ERROR").length,
    latencyP50Ms: percentile(rows.map(r => r.result.latencyMs), 0.5), latencyP95Ms: percentile(rows.map(r => r.result.latencyMs), 0.95),
    successfulLatencyP50Ms: percentile(rows.filter(r => r.result.status === "OK").map(r => r.result.latencyMs), 0.5),
    totalEstimatedCostUsd: totalCost, costPerRequestUsd: totalCost === null || !rows.length ? null : totalCost / rows.length,
    costPer1000RequestsUsd: totalCost === null || !rows.length ? null : totalCost * 1000 / rows.length,
    unknownCostRequests: costs.filter(c => c === null).length,
  };
}
export async function runEvaluation(cases: EvaluationCase[], options: { jev?: EvaluationProvider; fastPath?: FastPathParser; archives?: ArchiveEntry[]; acceptancePolicy?: AcceptancePolicy; now?: () => number; maxCalls?: number }) {
  const maxCalls = options.maxCalls ?? 0;
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 50) throw Error("INVALID_CALL_BUDGET");
  const checked = validateDataset(cases), jev: Row[] = [], fastPath: Row[] = [], luna: Row[] = [];
  const skippedArchive: string[] = []; let calls = 0;
  for (const c of checked) {
    if (options.fastPath) fastPath.push(scoreCase(c, replayFastPath(c.input, options.fastPath, options.now)));
    if (options.jev && calls < maxCalls) {
      calls++;
      // Pass only input; never expected, evidence, category or domain records to the provider.
      const result = await options.jev.evaluate(structuredClone(c.input));
      jev.push(scoreCase(c, result, options.acceptancePolicy));
      if (result.status === "ERROR") break; // Controlled run: no retries or next case after failure.
    }
    const archive = options.archives?.find(a => a.caseId === c.id);
    if (archive) {
      if (archive.inputFingerprint !== inputFingerprint(c.input)) skippedArchive.push(c.id);
      else luna.push(scoreCase(c, archive.result));
    }
  }
  return { calls, jev: { rows: jev, metrics: summarize(jev) }, fastPath: { rows: fastPath, metrics: summarize(fastPath) }, luna: { rows: luna, metrics: summarize(luna), performanceComparableCaseIds: (options.archives ?? []).filter(a => a.comparability === "paired" && luna.some(r => r.caseId === a.caseId)).map(a => a.caseId) }, skippedArchive };
}
