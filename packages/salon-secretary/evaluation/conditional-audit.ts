import { dataset, validateDataset } from "./dataset";
import { choiceSets, type EvaluationCase, type QuestionId } from "./contract";
import { buildJevRequest, INPUT_USD_PER_MILLION } from "./jev-provider";
import { conditionalRequest, detailDimensions, PLAN_VERSION, type Skill } from "./conditional-plan";

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
/** Oracle is used ONLY for counterfactual planning, never fed to the provider/coordinator. */
export function auditCase(c: EvaluationCase) {
  const previous = buildJevRequest(c.input), continuing = !!c.input.context.waiting_for;
  const detail = !continuing && c.expected.decision.shape === "single" && c.expected.skills.length === 1 ? c.expected.skills[0] : null;
  const conditional = detail ? detailDimensions(detail) : [];
  const requests = continuing ? [] : [conditionalRequest(c.input, { kind: "discovery" }), ...(detail ? [conditionalRequest(c.input, { kind: "detail", skill: detail })] : [])];
  const asked = requests.flatMap(r => Object.keys(r.questions)) as QuestionId[];
  const removed = (Object.keys(choiceSets) as QuestionId[]).filter(k => !asked.includes(k));
  return { caseId: c.id, category: c.category, path: c.category === "A" ? "EXISTING_FAST_PATH" : continuing ? "EXISTING_DRAFT_MODEL_FALLBACK" : detail ? "DISCOVERY_THEN_CONDITIONAL_DETAIL" : "DISCOVERY_THEN_FALLBACK_OR_UNAVAILABLE",
    unconditional: continuing ? [] : ["skill", "shape"], conditional, condition: detail ? `validated discovery: skill=${detail}, shape=single` : null,
    omitted: removed, notApplicable: detail ? removed : [], unresolved: !detail && !continuing ? removed : [],
    requiresLuna: c.category !== "A" && c.category !== "D" && (c.expected.requiresOpenExtraction || c.category === "C"), openRequirements: c.expected.domainFields,
    previousQuestions: 7, plannedQuestions: asked.length, previousHttpCalls: 1, plannedHttpCalls: requests.length,
    previousJsonBytes: bytes(previous), plannedJsonBytes: requests.reduce((s, r) => s + bytes(r), 0),
    // Not tokens, not billable usage: a clearly identified sensitivity scenario.
    hypotheticalInputCostAt4BytesPerTokenUsd: requests.reduce((s, r) => s + bytes(r), 0) / 4 * INPUT_USD_PER_MILLION / 1_000_000 };
}
export function prepareConditionalAudit() {
  const cases = validateDataset(dataset).map(auditCase);
  const eligible = cases.filter(c => c.plannedHttpCalls > 0);
  return { planVersion: PLAN_VERSION, executed: false, oracleOnlyOfflinePlan: true, cases,
    sameEligibleCasesComparison: { cases: eligible.length, previousQuestions: eligible.length * 7, plannedQuestions: eligible.reduce((s, c) => s + c.plannedQuestions, 0), previousHttpCalls: eligible.length, plannedHttpCalls: eligible.reduce((s, c) => s + c.plannedHttpCalls, 0), previousJsonBytes: eligible.reduce((s, c) => s + c.previousJsonBytes, 0), plannedJsonBytes: eligible.reduce((s, c) => s + c.plannedJsonBytes, 0) },
    totals: { cases: cases.length, previousQuestions: cases.reduce((s, c) => s + c.previousQuestions, 0), plannedQuestions: cases.reduce((s, c) => s + c.plannedQuestions, 0), previousHttpCalls: 40, plannedHttpCalls: cases.reduce((s, c) => s + c.plannedHttpCalls, 0), previousJsonBytes: cases.reduce((s, c) => s + c.previousJsonBytes, 0), plannedJsonBytes: cases.reduce((s, c) => s + c.plannedJsonBytes, 0) } };
}
export function prepareConditionalRevalidation() {
  return { planVersion: PLAN_VERSION, executed: false, noLuna: true, retries: 0, maxHttpCalls: 4, maxCases: 2, timeoutPerHttpMs: 10_000,
    note: "Detail requests shown below are conditional on the matching real discovery. Stop on any other discovery, error or material mismatch; no extra calls.",
    conservativePublishedContextCostUsd: 4 * 64_000 * INPUT_USD_PER_MILLION / 1_000_000,
    cases: ["financial-revenue", "inventory-low"].map(id => {
      const c = dataset.find(x => x.id === id)!;
      return { caseId: id, message: c.input.message, discoveryPayload: conditionalRequest(c.input, { kind: "discovery" }),
        continueOnlyIf: { skill: c.expected.decision.skill, shape: "single" },
        conditionalDetailPayload: conditionalRequest(c.input, { kind: "detail", skill: c.expected.skills[0] as Skill }), expected: c.expected.decision, audit: auditCase(c) };
    }) };
}
