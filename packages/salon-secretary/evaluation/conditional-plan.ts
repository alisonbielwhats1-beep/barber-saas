import { z } from "zod";
import { choiceSets, emptyResult, operations, operationSkill, skills, type Decision, type EvaluationInput, type EvaluationResult, type QuestionId } from "./contract";
import { buildJevRequest, JEV_MODEL, INPUT_USD_PER_MILLION, type JevWireRequest } from "./jev-provider";

export const PLAN_VERSION = "conditional-v2";
export type Skill = typeof skills[number];
export type Stage = { kind: "discovery" } | { kind: "detail"; skill: Skill };
export const detailDimensions = (skill: Skill): QuestionId[] => skill === "financial" ? ["operation", "metric", "period"] : skill === "inventory" ? ["operation", "inventory"] : skill === "communication" ? ["operation", "communication"] : ["operation"];

/** No oracle/category argument. A detail stage is selected only after a validated discovery. */
export function conditionalRequest(input: EvaluationInput, stage: Stage): JevWireRequest {
  const flat = buildJevRequest(input); // same input privacy guard; never sends the flat request
  if (stage.kind === "discovery") return { model: JEV_MODEL, state: flat.state, questions: { skill: flat.questions.skill, shape: flat.questions.shape } };
  if (!skills.includes(stage.skill)) throw Error("UNPUBLISHED_SKILL");
  const questions = Object.fromEntries(detailDimensions(stage.skill).map(id => [id, flat.questions[id]]));
  questions.operation = { ...questions.operation, criteria: Object.fromEntries([...operations.filter(op => operationSkill(op) === stage.skill), "multiple", "unclear", "out_of_catalog"].map(op => [op, null])) };
  return { model: JEV_MODEL, state: { ...flat.state, selected_skill: stage.skill, selection_source: "prior_jev_discovery" }, questions };
}

const answer = z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number().min(0).max(1)), confidence: z.number().min(0).max(1).optional() }).strict();
const response = z.object({ model: z.literal(JEV_MODEL), answers: z.record(z.string(), answer), usage: z.object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).strict().optional() }).strict();
export function parseConditionalStage(raw: unknown, request: JevWireRequest): EvaluationResult {
  const data = response.parse(raw), result = emptyResult("JEV");
  if (Object.keys(data.answers).sort().join() !== Object.keys(request.questions).sort().join()) throw Error("INVALID_RESPONSE");
  for (const [id, a] of Object.entries(data.answers)) {
    const allowed = Object.keys(request.questions[id].criteria);
    if (!allowed.includes(a.choice) || Object.keys(a.probabilities).sort().join() !== allowed.sort().join()) throw Error("INVALID_RESPONSE");
    if (Math.abs(Object.values(a.probabilities).reduce((s, p) => s + p, 0) - 1) > 1e-6 || a.probabilities[a.choice] < Math.max(...Object.values(a.probabilities)) - 1e-6) throw Error("INVALID_RESPONSE");
    result.answers[id as QuestionId] = { choice: a.choice, probabilities: a.probabilities, confidence: a.confidence ?? null };
    if (a.confidence === undefined) result.fallbackReasons.push(`MISSING_CONFIDENCE:${id}`);
  }
  result.status = "OK"; result.modelRequested = JEV_MODEL; result.modelReturned = data.model;
  result.usage = { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null };
  result.estimatedCostUsd = result.usage.inputTokens === null ? null : result.usage.inputTokens * INPUT_USD_PER_MILLION / 1_000_000;
  return result;
}

export type DiscoveryRoute = { kind: "detail"; skill: Skill } | { kind: "stop"; reason: string };
export function routeDiscovery(result: EvaluationResult): DiscoveryRoute {
  if (result.status !== "OK" || result.fallbackReasons.length) return { kind: "stop", reason: "DISCOVERY_UNAVAILABLE" };
  const skill = result.answers.skill?.choice, shape = result.answers.shape?.choice;
  if (skill === "out_of_catalog" && shape === "out_of_catalog") return { kind: "stop", reason: "OUT_OF_CATALOG" };
  if (skill === "unclear" || shape === "unclear") return { kind: "stop", reason: "AMBIGUOUS_DISCOVERY" };
  if ((skill === "multiple" || skills.includes(skill as Skill)) && (shape === "dependent" || shape === "independent")) return { kind: "stop", reason: "MULTI_OPERATION_REQUIRES_LUNA" };
  if (skills.includes(skill as Skill) && shape === "single") return { kind: "detail", skill: skill as Skill };
  return { kind: "stop", reason: "INCONSISTENT_DISCOVERY" };
}

export type DimensionSource = "ASKED" | "NOT_APPLICABLE" | "NOT_RESOLVED";
export type ConditionalResult = EvaluationResult & {
  planVersion: typeof PLAN_VERSION;
  stages: { stage: Stage; request: JevWireRequest; result: EvaluationResult }[];
  dimensionSources: Record<QuestionId, DimensionSource>;
  closedCoverage: boolean;
  requiresLuna: boolean;
  accepted: false;
};
export function conditionalResult(): ConditionalResult {
  return { ...emptyResult("JEV"), planVersion: PLAN_VERSION, stages: [], dimensionSources: Object.fromEntries(Object.keys(choiceSets).map(k => [k, "NOT_RESOLVED"])) as Record<QuestionId, DimensionSource>, closedCoverage: false, requiresLuna: true, accepted: false };
}

/** Keep provider answers separate from canonical N/A projections in benchmark reporting. */
export function scoreConditionalDecisions(expected: Decision, result: ConditionalResult) {
  const asked = (Object.keys(result.answers) as QuestionId[]).filter(id => result.dimensionSources[id] === "ASKED")
    .map(id => ({ dimension: id, predicted: result.answers[id]!.choice, expected: expected[id], correct: result.answers[id]!.choice === expected[id] }));
  return { asked, askedCount: asked.length, correctAsked: asked.filter(q => q.correct).length,
    askedDecisionAccuracy: asked.length ? asked.filter(q => q.correct).length / asked.length : null,
    notApplicable: (Object.keys(result.dimensionSources) as QuestionId[]).filter(id => result.dimensionSources[id] === "NOT_APPLICABLE"),
    unresolved: (Object.keys(result.dimensionSources) as QuestionId[]).filter(id => result.dimensionSources[id] === "NOT_RESOLVED"),
    completeDecisionCoverage: result.closedCoverage, accepted: false as const };
}

/** Domain consistency remains mandatory; no unspecified -> none conversion. */
export function composeConditional(skill: Skill, discovery: EvaluationResult, detail: EvaluationResult): { decision: Decision; notApplicable: QuestionId[]; reasons: string[]; closedCoverage: boolean } {
  if (discovery.status !== "OK" || discovery.answers.skill?.choice !== skill || discovery.answers.shape?.choice !== "single" || detail.status !== "OK") throw Error("INVALID_STAGES");
  const base: Decision = { skill, shape: "single", operation: "unclear", period: "none", metric: "none", inventory: "none", communication: "none" };
  const relevant = detailDimensions(skill), reasons = [...discovery.fallbackReasons, ...detail.fallbackReasons];
  if (Object.keys(detail.answers).sort().join() !== [...relevant].sort().join()) throw Error("INVALID_DETAIL_DIMENSIONS");
  for (const id of relevant) (base as Record<string, string>)[id] = detail.answers[id]!.choice;
  const op = base.operation;
  if (op === "multiple" || op === "unclear" || op === "out_of_catalog") reasons.push("UNRESOLVED_OPERATION");
  else if (operationSkill(op) !== skill) throw Error("CROSS_SKILL_OPERATION");
  if (skill === "communication") {
    if (base.communication === "none") throw Error("COMMUNICATION_INTENT_CONFLICT");
    if (base.communication === "unspecified") reasons.push("MESSAGE_MODE_UNSPECIFIED");
  }
  if (skill === "financial" && base.metric === "none") throw Error("FINANCIAL_METRIC_MISSING");
  if (skill === "inventory") {
    if (base.inventory === "none") throw Error("INVENTORY_INTENT_CONFLICT");
    const needed = base.inventory === "balance" ? "stock.balance" : ["low_stock", "search"].includes(base.inventory) ? "product.search" : ["IN", "OUT"].includes(base.inventory) ? "stock.movement" : null;
    if (needed && ![needed, "unclear", "multiple", "out_of_catalog"].includes(op)) throw Error("INVENTORY_OPERATION_CONFLICT");
  }
  if (Object.values(base).includes("unclear")) reasons.push("AMBIGUOUS_DECISION");
  const simpleFinancial = skill === "financial" && op === "financial.report" && !["none", "unclear", "multiple"].includes(base.metric) && (base.metric === "outstanding_receivables" ? base.period === "none" : !["none", "unclear", "comparison"].includes(base.period));
  const simpleInventory = skill === "inventory" && op === "product.search" && base.inventory === "low_stock";
  if (!simpleFinancial && !simpleInventory) reasons.push("OPEN_FIELDS_OR_PLAN_REQUIRE_LUNA");
  return { decision: base, notApplicable: (["period", "metric", "inventory", "communication"] as QuestionId[]).filter(k => !relevant.includes(k)), reasons: [...new Set(reasons)], closedCoverage: reasons.length === 0 && (simpleFinancial || simpleInventory) };
}
