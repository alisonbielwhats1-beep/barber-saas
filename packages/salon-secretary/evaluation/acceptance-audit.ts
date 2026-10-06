import { dataset, validateDataset } from "./dataset";
import { isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { auditDerivedCase } from "./derived-audit";
import { initialAllowlist, operationRisk, risksForPlan, assessJevAcceptance, type AcceptanceVerdict, type ConfidenceDatum, type RiskClass } from "./acceptance-policy";
import { choiceSets, decisionSchema, skills, type Decision, type EvaluationCase, type QuestionId } from "./contract";

export const evaluationRoutes = ["FAST_PATH", "JEV_CANDIDATE", "FORCED_LUNA", "OUT_OF_CATALOG"] as const;
export type EvaluationRoute = typeof evaluationRoutes[number];
const backendResponsibilities: Record<typeof skills[number], readonly string[]> = {
  services: ["service_ref", "requirements", "authorization"],
  customers: ["customer_ref", "ambiguity", "authorization"],
  scheduling: ["appointment_ref", "customer_ref", "service_ref", "professional_ref", "absolute_time", "availability", "authorization"],
  financial: ["absolute_period", "financial_values", "authorization"],
  inventory: ["product_ref", "stock", "authorization"],
  communication: ["recipient_ref", "phone", "channel", "preview", "authorization"],
};
export type AuditRow = {
  caseId: string;
  route: EvaluationRoute;
  riskClasses: RiskClass[];
  /** No oracle is sent to JEV; this is an offline planning projection. */
  decisionPlanDimensions: QuestionId[];
  requiredForAcceptance: QuestionId[];
  derivations: { from: string; to: string }[];
  backendResolution: string[];
  requiresOpenExtraction: boolean;
};
export function classifyGoldenCase(c: EvaluationCase): AuditRow {
  const audited = auditDerivedCase(c);
  const enrollment = initialAllowlist.find(x => x.id === c.id && x.message === c.input.message && x.skill === c.expected.decision.skill &&
    x.operation === c.expected.decision.operation && x.sourceValue === c.expected.decision[x.sourceDimension] && x.period === c.expected.decision.period);
  const route: EvaluationRoute = c.category === "A" ? "FAST_PATH" : c.category === "D" ? "OUT_OF_CATALOG" : enrollment &&
    !c.expected.requiresOpenExtraction && c.expected.operations.length === 1 && c.expected.dependencies.length === 0 ? "JEV_CANDIDATE" : "FORCED_LUNA";
  return { caseId: c.id, route, riskClasses: risksForPlan({ operations: c.expected.operations, requiresOpenExtraction: c.expected.requiresOpenExtraction }),
    decisionPlanDimensions: audited.linguistic.dimensions,
    requiredForAcceptance: route === "JEV_CANDIDATE" ? enrollment!.skill === "financial" ? ["skill", "shape", "metric", "period"] : ["skill", "shape", "inventory"] : [],
    derivations: route === "JEV_CANDIDATE" ? [{ from: `${enrollment!.sourceDimension}:${enrollment!.sourceValue}`, to: enrollment!.operation }] : [],
    backendResolution: [...new Set(c.expected.skills.flatMap(s => backendResponsibilities[s]))], requiresOpenExtraction: c.expected.requiresOpenExtraction };
}
export function auditAcceptanceDataset() {
  if (!isAuditedPublication(publishedDecisionCatalog())) throw Error("CATALOG_VERSION_MISMATCH");
  const rows = validateDataset(dataset).map(classifyGoldenCase);
  if (rows.length !== 40 || new Set(rows.map(x => x.caseId)).size !== 40) throw Error("DATASET_DRIFT");
  return { executed: false as const, cases: rows, counts: Object.fromEntries(evaluationRoutes.map(route => [route, rows.filter(c => c.route === route).length])) as Record<EvaluationRoute, number>,
    riskMatrix: Object.entries(operationRisk).map(([operation, risk]) => ({ operation, risk })) };
}

export type OfflineTrial = { trialId: string; caseId: string; result: unknown };
export type ScoredTrial = { trialId: string; caseId: string; route: EvaluationRoute; verdict: AcceptanceVerdict; linguisticallyCorrect: boolean; unsafeFalsePositive: boolean;
  confidenceData: (Omit<ConfidenceDatum, "correct"> & { correct: boolean | null })[] };
function matchesExpected(expected: Decision, result: unknown): boolean {
  const raw = result && typeof result === "object" && "decision" in result ? result.decision : null;
  const parsed = decisionSchema.safeParse(raw), d = parsed.success ? parsed.data : null;
  return !!d && (Object.keys(expected) as (keyof Decision)[]).every(k => d[k] === expected[k]);
}
/** Calibration uses provider answers even when the policy correctly falls back. */
function observedConfidence(expected: Decision, result: unknown): ScoredTrial["confidenceData"] {
  if (!result || typeof result !== "object" || !("answers" in result) || !result.answers || typeof result.answers !== "object") return [];
  const answers = result.answers as Record<string, unknown>;
  return (Object.keys(choiceSets) as QuestionId[]).flatMap(dimension => {
    if ("dimensionSources" in result && result.dimensionSources && typeof result.dimensionSources === "object" &&
        (result.dimensionSources as Record<string, unknown>)[dimension] !== "ASKED") return [];
    const raw = answers[dimension];
    if (!raw || typeof raw !== "object" || !("choice" in raw) || !("probabilities" in raw)) return [];
    const a = raw as { choice: unknown; probabilities: unknown; confidence?: unknown };
    if (typeof a.choice !== "string" || !a.probabilities || typeof a.probabilities !== "object" || Array.isArray(a.probabilities)) return [];
    const p = a.probabilities as Record<string, unknown>, selected = p[a.choice];
    const others = Object.entries(p).filter(([key]) => key !== a.choice).map(([, value]) => value);
    if (typeof selected !== "number" || !Number.isFinite(selected) || selected < 0 || selected > 1 || !others.length ||
        others.some(x => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1) ||
        Math.abs(selected + (others as number[]).reduce((n, x) => n + x, 0) - 1) > 1e-6) return [];
    const runnerUpProbability = Math.max(...others as number[]);
    return [{ dimension, selected: a.choice, selectedProbability: selected, runnerUpProbability,
      margin: selected - runnerUpProbability, confidence: typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : null,
      correct: a.choice === expected[dimension] }];
  });
}
/** Oracle appears only in this offline scorer, never inside assessJevAcceptance or provider payloads. */
export function scoreAcceptanceTrials(trials: readonly OfflineTrial[]) {
  const audit = auditAcceptanceDataset(), cases = new Map(dataset.map(c => [c.id, c]));
  if (new Set(trials.map(t => t.trialId)).size !== trials.length) throw Error("DUPLICATE_TRIAL");
  const rows: ScoredTrial[] = trials.map(t => {
    const c = cases.get(t.caseId), plan = audit.cases.find(x => x.caseId === t.caseId);
    if (!c || !plan) throw Error("UNKNOWN_CASE");
    const verdict = assessJevAcceptance(c.input, t.result);
    const correct = matchesExpected(c.expected.decision, t.result);
    const accepted = verdict.decision === "ACCEPT_JEV";
    return { trialId: t.trialId, caseId: c.id, route: plan.route, verdict, linguisticallyCorrect: correct,
      unsafeFalsePositive: accepted && !correct,
      confidenceData: observedConfidence(c.expected.decision, t.result) };
  });
  const accepted = rows.filter(r => r.verdict.decision === "ACCEPT_JEV"), candidate = rows.filter(r => r.route === "JEV_CANDIDATE");
  const rate = (n: number, d: number): number | null => d ? n / d : null;
  const coverageBy = (kind: "skill" | "riskClass") => {
    const labels = kind === "skill" ? [...skills, "out_of_catalog"] : ["READ_ONLY", "MUTATION", "COMPOUND_MUTATION", "COMMUNICATION", "OUT_OF_CATALOG", "OPEN_EXTRACTION_REQUIRED"];
    return Object.fromEntries(labels.map(label => {
      const group = rows.filter(r => { const c = cases.get(r.caseId)!; return kind === "skill" ? c.expected.decision.skill === label : audit.cases.find(x => x.caseId === r.caseId)!.riskClasses.includes(label as RiskClass); });
      return [label, { cases: group.length, accepted: group.filter(r => r.verdict.decision === "ACCEPT_JEV").length }];
    }));
  };
  return { rows, metrics: { evaluated: rows.length, totalGoldenCases: audit.cases.length, candidateCoverage: rate(audit.counts.JEV_CANDIDATE, audit.cases.length),
    acceptedCoverage: rate(accepted.length, rows.length), fallbackRate: rate(rows.length - accepted.length, rows.length),
    correctAccepted: accepted.filter(r => r.linguisticallyCorrect).length, incorrectAccepted: accepted.filter(r => !r.linguisticallyCorrect).length,
    unsafeFalsePositives: rows.filter(r => r.unsafeFalsePositive).length,
    unsafeFalsePositiveRate: rate(rows.filter(r => r.unsafeFalsePositive).length, accepted.length),
    falseFallback: candidate.filter(r => r.verdict.decision === "FALLBACK_REQUIRED" && r.linguisticallyCorrect).length,
    accuracyAmongAccepted: rate(accepted.filter(r => r.linguisticallyCorrect).length, accepted.length),
    coverageBySkill: coverageBy("skill"), coverageByRiskClass: coverageBy("riskClass"),
    confidenceDistribution: rows.flatMap(r => r.confidenceData.map(d => ({ trialId: r.trialId, caseId: r.caseId, accepted: r.verdict.decision === "ACCEPT_JEV", riskClasses: audit.cases.find(c => c.caseId === r.caseId)!.riskClasses, ...d }))),
    marginDistribution: rows.flatMap(r => r.confidenceData.map(d => ({ trialId: r.trialId, caseId: r.caseId, dimension: d.dimension, margin: d.margin, accepted: r.verdict.decision === "ACCEPT_JEV" }))),
  } };
}
