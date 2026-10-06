import { dataset, validateDataset } from "./dataset";
import { derivedRequest } from "./derived-plan";
import { INPUT_USD_PER_MILLION } from "./jev-provider";
import { auditAcceptanceDataset } from "./acceptance-audit";
import type { Skill } from "./conditional-plan";

/** Proposal only: no provider, transport, credential, or execution path. */
export const proposedCalibrationCaseIds = Object.freeze([
  "financial-revenue", "inventory-low", "financial-revenue", "inventory-low", "financial-revenue", "inventory-low",
  "financial-received", "financial-outstanding", "financial-comparison", "financial-multiple",
  "inventory-balance", "inventory-in", "inventory-out-missing",
  "scheduling-cancel", "scheduling-batch", "communication-exact", "communication-dependent-name",
  "compound-financial-services", "outside-financial-write", "outside-roles",
] as const);
export function prepareAcceptanceCalibrationPlan() {
  const valid = validateDataset(dataset), audit = auditAcceptanceDataset();
  const entries = proposedCalibrationCaseIds.map((caseId, index) => {
    const c = valid.find(c => c.id === caseId), classification = audit.cases.find(x => x.caseId === caseId);
    if (!c || !classification || classification.route === "FAST_PATH") throw Error("INVALID_CALIBRATION_CASE");
    const discoveryPayload = derivedRequest(c.input, { kind: "discovery" });
    const detailPayload = c.expected.skills.length === 1 && c.expected.decision.shape === "single" ? derivedRequest(c.input, { kind: "detail", skill: c.expected.skills[0] as Skill }) : null;
    return { sequence: index + 1, trialId: `${caseId}:${index + 1}`, caseId, route: classification.route, message: c.input.message,
      discoveryPayload, conditionalDetailPayload: detailPayload,
      /** Oracle is for later offline scoring and must never enter either payload. */
      expected: c.expected.decision };
  });
  const maxHttpCalls = entries.length * 2;
  return { version: "jev-calibration-proposal-v1", executed: false as const, retries: 0, noLuna: true, noBusinessTools: true,
    cases: entries, maxCases: entries.length, maxHttpCalls, maxInputTokensPerHttp: 64_000,
    /** Historical audited tariff, not a promise of current pricing or invoice. */
    conservativeEstimatedMaxCostUsd: maxHttpCalls * 64_000 * INPUT_USD_PER_MILLION / 1_000_000,
    stopOn: ["UNSAFE_FALSE_POSITIVE", "PROVIDER_SCHEMA_DRIFT", "CATALOG_DRIFT", "UNEXPECTED_NETWORK_EFFECT", "CALL_BUDGET_EXCEEDED"],
    dataSent: "message and compact published choice questions only; never expected, refs, tenant IDs, phone, finance records, or secrets" };
}
