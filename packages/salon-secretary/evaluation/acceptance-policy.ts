import { decisionSchema, inputSchema, operations, skills, type ChoiceAnswer, type Decision, type EvaluationInput, type QuestionId } from "./contract";
import { derivedRequest, DERIVED_PLAN_VERSION, type DerivedResult } from "./derived-plan";
import { deriveOperation, derivationCatalog, derivationCatalogHash, publishedDecisionCatalog, type DerivationCatalog, type Publication } from "./derivation-catalog";
import { JEV_MODEL } from "./jev-provider";

/** Evaluation only. This module has no provider, backend, Tool, or runtime import. */
export const ACCEPTANCE_POLICY_VERSION = "jev-acceptance-v1";
export const riskClasses = ["READ_ONLY", "MUTATION", "COMPOUND_MUTATION", "COMMUNICATION", "OUT_OF_CATALOG", "OPEN_EXTRACTION_REQUIRED"] as const;
export type RiskClass = typeof riskClasses[number];
type Operation = typeof operations[number];
type Skill = typeof skills[number];
export const operationRisk: Readonly<Record<Operation, "READ_ONLY" | "MUTATION" | "COMMUNICATION">> = Object.freeze({
  "service.create": "MUTATION", "service.change": "MUTATION",
  "customer.search": "READ_ONLY", "customer.read": "READ_ONLY", "customer.create": "MUTATION", "customer.change": "MUTATION",
  "appointment.create": "MUTATION", "appointment.list": "READ_ONLY", "appointment.read": "READ_ONLY", "availability.get": "READ_ONLY",
  "appointment.change": "MUTATION", "appointment.cancel": "MUTATION", "schedule.block": "MUTATION",
  "financial.report": "READ_ONLY", "product.search": "READ_ONLY", "stock.balance": "READ_ONLY", "stock.movement": "MUTATION",
  "customer.message": "COMMUNICATION",
});
export function risksForPlan(plan: { operations: readonly Operation[]; requiresOpenExtraction: boolean }): RiskClass[] {
  const tags = new Set<RiskClass>(plan.operations.map(op => operationRisk[op]));
  if (!plan.operations.length) tags.add("OUT_OF_CATALOG");
  if (plan.operations.length > 1 && (tags.has("MUTATION") || tags.has("COMMUNICATION"))) tags.add("COMPOUND_MUTATION");
  if (plan.requiresOpenExtraction) tags.add("OPEN_EXTRACTION_REQUIRED");
  return riskClasses.filter(tag => tags.has(tag));
}

/** Exact enrollment is intentional: two real JEV cases do not calibrate paraphrases. */
export const initialAllowlist = Object.freeze([
  Object.freeze({ id: "financial-revenue", message: "Quanto faturei ontem?", skill: "financial", shape: "single", sourceDimension: "metric", sourceValue: "service_revenue", period: "yesterday", operation: "financial.report" }),
  Object.freeze({ id: "inventory-low", message: "Quais produtos estão com estoque baixo?", skill: "inventory", shape: "single", sourceDimension: "inventory", sourceValue: "low_stock", period: "none", operation: "product.search" }),
] as const);
type Enrollment = typeof initialAllowlist[number];

export const reasonCodes = [
  "ACCEPTED_CLOSED_DECISION", "INVALID_PROVIDER_RESPONSE", "FAST_PATH_PRECEDENCE", "OUT_OF_CATALOG", "COMPOUND_REQUEST",
  "UNSUPPORTED_SKILL", "UNSUPPORTED_RISK_CLASS", "OPEN_EXTRACTION_REQUIRED", "UNCALIBRATED_INPUT", "INCOMPLETE_DECISIONS",
  "UNSPECIFIED_DECISION", "UNCLEAR_DECISION", "CONTRADICTORY_DECISION", "INVALID_DERIVATION", "CATALOG_VERSION_MISMATCH",
  "CONFIDENCE_NOT_CALIBRATED", "AMBIGUOUS_PROBABILITIES",
] as const;
export type ReasonCode = typeof reasonCodes[number];
export type FieldProvenance = "FAST_PATH" | "JEV" | "DETERMINISTIC_DERIVATION" | "BACKEND" | "LUNA";
export type ConfidenceDatum = {
  dimension: QuestionId;
  selected: string;
  selectedProbability: number;
  runnerUpProbability: number;
  margin: number;
  confidence: number | null;
  /** Only the offline scorer may fill this from the golden oracle. */
  correct: null;
};
export type AcceptanceVerdict = {
  policyVersion: typeof ACCEPTANCE_POLICY_VERSION;
  decision: "ACCEPT_JEV" | "FALLBACK_REQUIRED";
  reason: ReasonCode;
  enrollmentId: string | null;
  riskClasses: RiskClass[];
  requiredDecisions: QuestionId[];
  interpretation: Decision | null;
  provenance: Partial<Record<QuestionId, FieldProvenance>>;
  backendOnly: readonly string[];
  confidenceData: ConfidenceDatum[];
  /** A policy result never authorizes domain execution. */
  executable: false;
};
const backendOnly = Object.freeze(["customer_ref", "service_ref", "professional_ref", "appointment_ref", "product_ref", "recipient_ref", "financial_values", "stock", "availability", "authorization", "tenant"]);
const relevant = (e: Enrollment): QuestionId[] => e.skill === "financial" ? ["skill", "shape", "metric", "period"] : ["skill", "shape", "inventory"];
const own = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keys = (v: Record<string, unknown>) => Object.keys(v).sort().join("|");

/** No oracle/expected parameter: the policy can only inspect a known input and provider evidence. */
function assessUnchecked(input: unknown, candidate: unknown, options: { catalog?: DerivationCatalog; publication?: Publication }): AcceptanceVerdict {
  const base: AcceptanceVerdict = { policyVersion: ACCEPTANCE_POLICY_VERSION, decision: "FALLBACK_REQUIRED", reason: "INVALID_PROVIDER_RESPONSE",
    enrollmentId: null, riskClasses: [], requiredDecisions: [], interpretation: null, provenance: {}, backendOnly, confidenceData: [], executable: false };
  const fail = (reason: ReasonCode) => ({ ...base, reason });
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_PROVIDER_RESPONSE");
  const message: EvaluationInput = parsed.data;
  if (message.context.waiting_for) return fail("FAST_PATH_PRECEDENCE");
  if (Object.keys(message.context).length) return fail("UNCALIBRATED_INPUT");
  if (!own(candidate) || candidate.provider !== "JEV" || candidate.planVersion !== DERIVED_PLAN_VERSION || candidate.executable !== false || candidate.accepted !== false) return fail("INVALID_PROVIDER_RESPONSE");
  const result = candidate as DerivedResult;
  const predicted = decisionSchema.safeParse(result.decision);
  if (predicted.success && (operations as readonly string[]).includes(predicted.data.operation)) {
    base.riskClasses = risksForPlan({ operations: [predicted.data.operation as Operation], requiresOpenExtraction: result.requiresLuna === true });
    if (predicted.data.shape === "dependent" || predicted.data.shape === "independent") base.riskClasses = [...new Set([...base.riskClasses, "COMPOUND_MUTATION" as const])];
  }
  if (Array.isArray(result.fallbackReasons) && result.fallbackReasons.some(r => r.startsWith("MISSING_CONFIDENCE:"))) return fail("CONFIDENCE_NOT_CALIBRATED");
  if (result.answers?.communication?.choice === "unspecified") return fail("UNSPECIFIED_DECISION");
  if (result.answers && Object.values(result.answers).some(a => a?.choice === "unclear")) return fail("UNCLEAR_DECISION");
  if (result.status === "NO_MATCH" && result.fallbackReasons?.includes("OUT_OF_CATALOG")) return fail("OUT_OF_CATALOG");
  if (result.status === "NO_MATCH" && result.fallbackReasons?.includes("MULTI_OPERATION_REQUIRES_LUNA")) return fail("COMPOUND_REQUEST");
  if (result.status !== "OK" || result.error !== null || result.modelRequested !== JEV_MODEL || result.modelReturned !== JEV_MODEL || !Array.isArray(result.stages)) return fail("INVALID_PROVIDER_RESPONSE");
  const skill = result.answers?.skill?.choice, shape = result.answers?.shape?.choice;
  if (skill === "out_of_catalog" || shape === "out_of_catalog") return fail("OUT_OF_CATALOG");
  if (skill === "multiple" || shape === "independent" || shape === "dependent") return fail("COMPOUND_REQUEST");
  if (skill === "unclear" || shape === "unclear") return fail("UNCLEAR_DECISION");
  if (!skills.includes(skill as Skill)) return fail("INVALID_PROVIDER_RESPONSE");
  if (shape !== "single") return fail("INVALID_PROVIDER_RESPONSE");
  if (skill !== "financial" && skill !== "inventory") return fail(base.riskClasses.includes("MUTATION") || base.riskClasses.includes("COMMUNICATION") ? "UNSUPPORTED_RISK_CLASS" : "UNSUPPORTED_SKILL");
  if (result.requiresLuna === true) return fail("OPEN_EXTRACTION_REQUIRED");
  const enrollment = initialAllowlist.find(e => e.message === message.message && e.skill === skill);
  if (!enrollment) return fail("UNCALIBRATED_INPUT");
  base.enrollmentId = enrollment.id;
  base.riskClasses = ["READ_ONLY"];
  base.requiredDecisions = relevant(enrollment);
  if (!Array.isArray(result.fallbackReasons)) return fail("INVALID_PROVIDER_RESPONSE");
  if (result.fallbackReasons.some(r => r.startsWith("MISSING_CONFIDENCE:"))) return fail("CONFIDENCE_NOT_CALIBRATED");
  if (result.fallbackReasons.some(r => r === "AMBIGUOUS_DECISION")) return fail("UNCLEAR_DECISION");
  if (result.fallbackReasons.some(r => r === "OPEN_FIELDS_OR_PLAN_REQUIRE_LUNA")) return fail("OPEN_EXTRACTION_REQUIRED");
  if (!same(result.fallbackReasons, ["NO_ACCEPTANCE_POLICY"]) || result.closedCoverage !== true || result.requiresLuna !== false || result.dependencies === null || !same(result.dependencies, [])) return fail("INCOMPLETE_DECISIONS");
  if (result.fastPathPatch !== undefined || (result.resolvedSkills !== undefined && !same(result.resolvedSkills, [enrollment.skill])) ||
      (result.interpretedOperations !== undefined && !same(result.interpretedOperations, [enrollment.operation]))) return fail("CONTRADICTORY_DECISION");
  if (result.stages.length !== 2 || !own(result.answers) || !own(result.dimensionSources) || !Array.isArray(result.derivations)) return fail("INVALID_PROVIDER_RESPONSE");
  const dimensions = relevant(enrollment);
  if (keys(result.answers) !== [...dimensions].sort().join("|")) return fail("INCOMPLETE_DECISIONS");
  const stages = [{ kind: "discovery" } as const, { kind: "detail", skill: enrollment.skill } as const];
  for (let i = 0; i < stages.length; i++) {
    const stage = result.stages[i], expectedRequest = derivedRequest(message, stages[i]);
    if (!stage || !same(stage.stage, stages[i]) || !same(stage.request, expectedRequest) || !stage.result || stage.result.status !== "OK" || !own(stage.result.answers)) return fail("INVALID_PROVIDER_RESPONSE");
    if (keys(stage.result.answers) !== Object.keys(expectedRequest.questions).sort().join("|")) return fail("INCOMPLETE_DECISIONS");
    for (const id of Object.keys(stage.result.answers) as QuestionId[]) if (!same(stage.result.answers[id], result.answers[id])) return fail("INVALID_PROVIDER_RESPONSE");
  }
  for (const id of dimensions) {
    const answer: ChoiceAnswer | undefined = result.answers[id];
    const request = id === "skill" || id === "shape" ? result.stages[0].request : result.stages[1].request;
    const allowed = Object.keys(request.questions[id]?.criteria ?? {});
    if (!answer || !allowed.includes(answer.choice) || !own(answer.probabilities) || keys(answer.probabilities) !== allowed.sort().join("|")) return fail("INVALID_PROVIDER_RESPONSE");
    const values = Object.values(answer.probabilities);
    if (values.some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) || Math.abs(values.reduce<number>((n, v) => n + (v as number), 0) - 1) > 1e-6) return fail("INVALID_PROVIDER_RESPONSE");
    const selected = answer.probabilities[answer.choice], runnerUp = Math.max(...Object.entries(answer.probabilities).filter(([c]) => c !== answer.choice).map(([, p]) => p));
    if (typeof selected !== "number" || selected < runnerUp) return fail("INVALID_PROVIDER_RESPONSE");
    if (typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) return fail("CONFIDENCE_NOT_CALIBRATED");
    base.confidenceData.push({ dimension: id, selected: answer.choice, selectedProbability: selected, runnerUpProbability: runnerUp, margin: selected - runnerUp, confidence: answer.confidence, correct: null });
    if (selected === runnerUp) return fail("AMBIGUOUS_PROBABILITIES");
    if (result.dimensionSources[id] !== "ASKED") return fail("INCOMPLETE_DECISIONS");
    base.provenance[id] = "JEV";
  }
  if (result.dimensionSources.operation !== "DERIVED" || result.answers.operation !== undefined) return fail("INVALID_DERIVATION");
  for (const id of ["period", "metric", "inventory", "communication"] as QuestionId[]) {
    if (!dimensions.includes(id) && result.dimensionSources[id] !== "NOT_APPLICABLE") return fail("INCOMPLETE_DECISIONS");
  }
  if (result.answers.skill?.choice !== enrollment.skill || result.answers.shape?.choice !== enrollment.shape ||
      result.answers[enrollment.sourceDimension]?.choice !== enrollment.sourceValue ||
      (enrollment.skill === "financial" && result.answers.period?.choice !== enrollment.period)) return fail("CONTRADICTORY_DECISION");
  const publication = options.publication ?? publishedDecisionCatalog(), catalog = options.catalog ?? derivationCatalog;
  const derived = deriveOperation(enrollment.skill, "single", enrollment.sourceDimension, enrollment.sourceValue, catalog, publication);
  if (!derived.ok) return fail(derived.reason === "CATALOG_DRIFT" ? "CATALOG_VERSION_MISMATCH" : "INVALID_DERIVATION");
  if (catalog.version !== derivationCatalog.version || catalog.publicationHash !== derived.derivation.publicationHash || derivationCatalogHash(catalog) !== derived.derivation.catalogHash) return fail("CATALOG_VERSION_MISMATCH");
  if (derived.derivation.operation !== enrollment.operation || !same(result.derivations, [derived.derivation])) return fail("INVALID_DERIVATION");
  const decision = decisionSchema.safeParse(result.decision);
  if (!decision.success || decision.data.skill !== enrollment.skill || decision.data.shape !== "single" || decision.data.operation !== enrollment.operation ||
      decision.data[enrollment.sourceDimension] !== enrollment.sourceValue || decision.data.period !== enrollment.period ||
      decision.data.communication !== "none" || (enrollment.skill === "financial" ? decision.data.inventory !== "none" : decision.data.metric !== "none")) return fail("CONTRADICTORY_DECISION");
  base.interpretation = decision.data;
  base.provenance.operation = "DETERMINISTIC_DERIVATION";
  return { ...base, decision: "ACCEPT_JEV", reason: "ACCEPTED_CLOSED_DECISION" };
}

/** Unknown/malformed data never escapes as an exception or an operational decision. */
export function assessJevAcceptance(input: unknown, candidate: unknown, options: { catalog?: DerivationCatalog; publication?: Publication } = {}): AcceptanceVerdict {
  try { return assessUnchecked(input, candidate, options); }
  catch { return { policyVersion: ACCEPTANCE_POLICY_VERSION, decision: "FALLBACK_REQUIRED", reason: "INVALID_PROVIDER_RESPONSE", enrollmentId: null,
    riskClasses: [], requiredDecisions: [], interpretation: null, provenance: {}, backendOnly, confidenceData: [], executable: false }; }
}
