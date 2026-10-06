import type { Decision, EvaluationInput, EvaluationResult, QuestionId } from "./contract";
import { composeConditional, conditionalRequest, conditionalResult, detailDimensions, type ConditionalResult, type DimensionSource, type Skill, type Stage } from "./conditional-plan";
import { derivableDimension, deriveOperation, derivationCatalog, publishedDecisionCatalog, type Derivation, type DerivationCatalog, type Publication } from "./derivation-catalog";

export const DERIVED_PLAN_VERSION = "derived-v3";
export const derivedDetailDimensions = (skill: Skill): QuestionId[] => detailDimensions(skill).filter(id => id !== "operation" || !derivableDimension(skill));
export function derivedRequest(input: EvaluationInput, stage: Stage) {
  const request = conditionalRequest(input, stage);
  if (stage.kind === "detail" && derivableDimension(stage.skill)) {
    request.questions = Object.fromEntries(derivedDetailDimensions(stage.skill).map(id => [id, request.questions[id]]));
  }
  return request;
}
export type DerivedResult = Omit<ConditionalResult, "planVersion" | "dimensionSources"> & {
  planVersion: typeof DERIVED_PLAN_VERSION;
  dimensionSources: Record<QuestionId, DimensionSource | "DERIVED">;
  derivations: Derivation[];
};
export const derivedResult = (): DerivedResult => ({ ...conditionalResult(), planVersion: DERIVED_PLAN_VERSION, derivations: [] });
export type Composition = { ok: true; decision: Decision; notApplicable: QuestionId[]; reasons: string[]; closedCoverage: boolean; derivations: Derivation[] } | { ok: false; reason: string };
export function composeDerived(skill: Skill, discovery: EvaluationResult, detail: EvaluationResult,
  catalog: DerivationCatalog = derivationCatalog, publication: Publication = publishedDecisionCatalog()): Composition {
  if (discovery.status !== "OK" || discovery.answers.skill?.choice !== skill || discovery.answers.shape?.choice !== "single" || detail.status !== "OK") throw Error("INVALID_STAGES");
  const relevant = derivedDetailDimensions(skill);
  if (Object.keys(detail.answers).sort().join() !== [...relevant].sort().join()) throw Error("INVALID_DETAIL_DIMENSIONS");
  const source = derivableDimension(skill);
  if (!source) return { ok: true, ...composeConditional(skill, discovery, detail), derivations: [] };
  const derived = deriveOperation(skill, "single", source, detail.answers[source]!.choice, catalog, publication);
  if (!derived.ok) return derived;
  const decision: Decision = { skill, shape: "single", operation: derived.derivation.operation, metric: "none", period: "none", inventory: "none", communication: "none" };
  for (const id of relevant) (decision as Record<string, string>)[id] = detail.answers[id]!.choice;
  const reasons = [...discovery.fallbackReasons, ...detail.fallbackReasons];
  if (Object.values(decision).includes("unclear")) reasons.push("AMBIGUOUS_DECISION");
  if (skill === "financial" && decision.metric === "outstanding_receivables" && decision.period !== "none") reasons.push("RECEIVABLE_IS_CURRENT_BALANCE");
  const financial = skill === "financial" && (decision.metric === "outstanding_receivables" ? decision.period === "none" : !["none", "unclear", "comparison"].includes(decision.period));
  const inventory = skill === "inventory" && decision.inventory === "low_stock";
  if (!financial && !inventory) reasons.push("OPEN_FIELDS_OR_PLAN_REQUIRE_LUNA");
  return { ok: true, decision, derivations: [derived.derivation], reasons: [...new Set(reasons)], closedCoverage: reasons.length === 0 && (financial || inventory),
    notApplicable: (["period", "metric", "inventory", "communication"] as QuestionId[]).filter(id => !relevant.includes(id)) };
}

/** Confidence belongs only to actual model answers. Derived operations never acquire fabricated confidence. */
export function scoreDerivedDecisions(expected: Decision, result: DerivedResult) {
  const asked = (Object.keys(result.answers) as QuestionId[]).filter(id => result.dimensionSources[id] === "ASKED")
    .map(id => ({ dimension: id, predicted: result.answers[id]!.choice, expected: expected[id], correct: result.answers[id]!.choice === expected[id],
      confidence: result.answers[id]!.confidence, probabilities: result.answers[id]!.probabilities }));
  const derived = result.derivations.map(d => ({ ...d, expected: expected.operation, correct: d.operation === expected.operation }));
  return { asked, askedCount: asked.length, correctAsked: asked.filter(x => x.correct).length, derived,
    notApplicable: (Object.keys(result.dimensionSources) as QuestionId[]).filter(id => result.dimensionSources[id] === "NOT_APPLICABLE"),
    unresolved: (Object.keys(result.dimensionSources) as QuestionId[]).filter(id => result.dimensionSources[id] === "NOT_RESOLVED"),
    confidenceForFutureCalibration: asked.map(({ dimension, confidence, correct }) => ({ dimension, confidence, correct })),
    completeDecisionCoverage: result.closedCoverage, accepted: false as const };
}
