import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { EvaluationResult } from "./contract";
import { assertFrozenWavePayload } from "./coverage-expansion-wave-harness";
import { nextClosedFinancialStage } from "./financial-closed-intent-harness";
import { assertFrozenPredecessors, prepareClosedFinancialPlan } from "./financial-closed-intent-plan";
import type { JevWireRequest } from "./jev-provider";

export const FROZEN_CLOSED_FINANCIAL_PLAN_PATH = "packages/salon-secretary/evaluation/financial-closed-intent-plan.json";
export const FROZEN_CLOSED_FINANCIAL_PLAN_SHA256 = "ffa66093927f6072391c48bffb7acc857fc7a2024c4b4880f5d55e6f43d08ccc";
/** Fails before transport on any changed case, oracle, question, choice, catalog or historical predecessor. */
export function readFrozenClosedFinancialPlan() {
  assertFrozenPredecessors();
  const bytes = readFileSync(FROZEN_CLOSED_FINANCIAL_PLAN_PATH);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== FROZEN_CLOSED_FINANCIAL_PLAN_SHA256) throw Error("FROZEN_CLOSED_FINANCIAL_PLAN_DRIFT");
  const frozen = JSON.parse(bytes.toString("utf8")) as ReturnType<typeof prepareClosedFinancialPlan>;
  if (JSON.stringify(frozen) !== JSON.stringify(prepareClosedFinancialPlan())) throw Error("FROZEN_CLOSED_FINANCIAL_SOURCE_DRIFT");
  return frozen;
}

/** Only this payload may be serialized to JEV; expected/signatures stay outside the body. */
export function assertClosedFinancialPayload(caseId: string, stage: "discovery" | "detail", actual: JevWireRequest,
  credential: string, discovery?: EvaluationResult) {
  const frozen = readFrozenClosedFinancialPlan(), c = frozen.cases.find(item => item.id === caseId);
  if (!c) throw Error("UNKNOWN_FROZEN_CASE");
  if (stage === "detail" && (!discovery || nextClosedFinancialStage(discovery) !== "FINANCIAL_DETAIL"))
    throw Error("FINANCIAL_DETAIL_NOT_AUTHORIZED_BY_DISCOVERY");
  return assertFrozenWavePayload(actual, c.payloads[stage], credential);
}

/** Checked before each future HTTP; missing usage is bounded by the frozen per-call maximum. */
export function assertClosedFinancialBudget(attemptedHttp: number, knownEstimatedCostUsd: number | null) {
  const frozen = readFrozenClosedFinancialPlan();
  if (!Number.isInteger(attemptedHttp) || attemptedHttp < 0 || attemptedHttp > frozen.maxHttpCalls ||
      (knownEstimatedCostUsd !== null && (!Number.isFinite(knownEstimatedCostUsd) || knownEstimatedCostUsd < 0 ||
        knownEstimatedCostUsd > frozen.maximumPlanningEstimateUsd))) throw Error("CLOSED_FINANCIAL_BUDGET_EXCEEDED");
  const worstCaseAtCount = attemptedHttp * frozen.pricing.maxInputTokensPerHttp *
    frozen.pricing.inputUsdPerMillion / 1_000_000;
  if (worstCaseAtCount > frozen.maximumPlanningEstimateUsd + Number.EPSILON) throw Error("CLOSED_FINANCIAL_BUDGET_EXCEEDED");
  return { attemptedHttp, remainingHttp: frozen.maxHttpCalls - attemptedHttp,
    worstCaseUsdAtCount: worstCaseAtCount, ceilingUsd: frozen.maximumPlanningEstimateUsd };
}
