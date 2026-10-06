import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { prepareAcceptanceCalibrationPlan } from "./acceptance-calibration-plan";

const priorEvidencePath = "packages/salon-secretary/evaluation/acceptance-calibration-real-2026-09-23.json";
const priorEvidenceSha256 = "c114a7fe1220503ab86bf6913c68056cc7834930b59486e1b9f86843baf19616";

/** Offline scope for a future separately authorized continuation. This function never performs HTTP. */
export function prepareAcceptanceCalibrationContinuation() {
  const frozen = prepareAcceptanceCalibrationPlan();
  const remaining = frozen.cases.slice(17);
  if (frozen.cases.length !== 20 || remaining.length !== 3 ||
    remaining.map(c => c.sequence).join() !== "18,19,20" ||
    remaining.map(c => c.caseId).join() !== "compound-financial-services,outside-financial-write,outside-roles" ||
    remaining[0].message !== "Quanto faturei ontem e altere a massagem para R$80?") throw Error("CONTINUATION_PLAN_MISMATCH");
  const evidenceBytes = readFileSync(priorEvidencePath);
  if (createHash("sha256").update(evidenceBytes).digest("hex") !== priorEvidenceSha256) throw Error("PRIOR_EVIDENCE_MISMATCH");
  const prior = JSON.parse(evidenceBytes.toString("utf8"));
  if (prior.executedEvaluations !== 17 || prior.executedHttp !== 31 || prior.stopReason !== "INVALID_RESPONSE" ||
    JSON.stringify(prior.activeCase?.rounds?.[0]?.request) !== JSON.stringify(remaining[0].discoveryPayload))
    throw Error("PRIOR_EVIDENCE_MISMATCH");
  return {
    version: "jev-calibration-continuation-v1",
    executed: false as const,
    priorCompletedEvaluations: 17,
    priorAttemptedHttp: 31,
    priorEvidenceSha256,
    cases: remaining,
    maxAdditionalEvaluations: 3,
    maxAdditionalHttp: 6,
    zeroRetries: true,
    stopOnInvalidResponse: true,
    requiresSeparateAuthorization: true,
  };
}
