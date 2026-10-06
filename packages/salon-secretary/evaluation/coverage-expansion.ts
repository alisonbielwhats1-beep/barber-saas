import { dataset, validateDataset } from "./dataset";
import { classifyGoldenCase } from "./acceptance-audit";
import { initialAllowlist, operationRisk, risksForPlan } from "./acceptance-policy";
import { operations, operationSkill, type EvaluationCase, type QuestionId } from "./contract";
import { derivedDetailDimensions } from "./derived-plan";
import { derivableDimension, deriveOperation, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import type { Skill } from "./conditional-plan";

/** Planning classifications only. Neither enrollment nor an alternative acceptance policy. */
export const COVERAGE_VERSION = "jev-coverage-expansion-v1";
export const values = ["FULL_JEV_BYPASS", "JEV_ROUTING_ONLY", "LUNA_REQUIRED", "FAST_PATH", "OUT_OF_CATALOG"] as const;
export type CoverageValue = typeof values[number];
export type EvidenceState = "PROVEN" | "CALIBRATION_CANDIDATE" | "FORCED_LUNA";
export type Boundary = "READ_ONLY_CANDIDATE" | "MUTATION_CANDIDATE" | "MUTATION_FORCED_LUNA" | "COMPOUND_FORCED_LUNA" | "OPEN_FORCED_LUNA" | "FAST_PATH" | "OUT_OF_CATALOG";
export const responsibilityClasses = ["JEV_CLOSED_DECISION", "DETERMINISTIC_DERIVATION", "BACKEND_RESOLUTION", "OPEN_EXTRACTION", "COMPLEX_OR_COMPOUND", "FAST_PATH", "OUT_OF_CATALOG"] as const;

const responsibilities: Record<Skill, { open: string[]; backend: string[]; fast: string[]; excluded: string[] }> = {
  services: { open: ["name", "target_name", "priceCents", "durationMin"], backend: ["service_ref", "requirements", "revision", "authorization"], fast: ["durationMin in eligible draft"], excluded: ["status change", "publication", "professional links"] },
  customers: { open: ["name", "target_name", "phone", "email", "requested_fields", "clear_fields"], backend: ["customer_ref", "duplicate detection", "tenant", "authorization"], fast: ["authenticated candidate selection (not free text)"], excluded: ["roles", "credentials", "delete", "clinical notes"] },
  scheduling: { open: ["customer_name", "service_name", "professional_name", "date/time", "reason", "source/destination", "dependency graph"], backend: ["appointment_ref", "customer_ref", "service_ref", "professional_ref", "absolute_time", "availability", "eligibility", "authorization"], fast: ["date/time/end_time in eligible draft"], excluded: ["change work hours", "unblock"] },
  financial: { open: ["compare_period not represented by comparison enum", "group_by", "multiple metrics", "ambiguous/missing period"], backend: ["timezone", "absolute_period", "Payment.paidAt", "values", "differences", "percentages", "rankings", "authorization"], fast: [], excluded: ["refund", "fees", "profit", "forecast", "entity filters"] },
  inventory: { open: ["product_name", "quantity", "reason"], backend: ["product_ref", "stock", "minStock", "unit", "authorization"], fast: ["quantity in eligible draft", "authenticated candidate selection"], excluded: ["product.create", "purchase", "supplier", "unit conversion", "physical count"] },
  communication: { open: ["recipient_name", "EXACT content", "GENERATED content", "channel outside eligible draft", "dependencies"], backend: ["recipient_ref", "phone", "preview integrity", "authorization", "outbox/status"], fast: ["channel in eligible draft"], excluded: ["campaigns", "SMS", "real external provider"] },
};

export function operationMatrix() {
  return operations.map(operation => {
    const skill = operationSkill(operation) as Skill, source = derivableDimension(skill);
    return { operation, skill, riskClass: operationRisk[operation],
      boundary: (skill === "communication" || operationRisk[operation] !== "READ_ONLY" ? "MUTATION_FORCED_LUNA" : "READ_ONLY_CANDIDATE") as Boundary,
      linguistic: ["skill", "shape", ...(source ? derivedDetailDimensions(skill) : ["operation"])] as QuestionId[],
      deterministic: source ? `${source} -> operation; only unique published binding` : "No redundant intent alias; operation remains linguistic",
      ...responsibilities[skill],
      bypassCondition: skill === "financial" ? "one published metric + explicit closed period (none only for current receivables); no filters/ranking/comparison" : operation === "product.search" ? "low_stock only, no entity/filter extraction" : "none in this expansion",
      evidence: [`packages/salon-secretary/src/${skill}-skill.ts`, "packages/salon-secretary/src/skill-registry.ts", "packages/salon-secretary/evaluation/derivation-catalog.ts"],
    };
  });
}

/** Receives an offline oracle, NEVER a provider result or arbitrary runtime text. */
export function classifyExpansionCase(c: EvaluationCase) {
  const e = c.expected, d = e.decision, skill = e.skills.length === 1 ? e.skills[0] : null;
  const compound = e.operations.length > 1 || e.dependencies.length > 0 || ["independent", "dependent", "multiple"].includes(d.shape);
  const source = skill ? derivableDimension(skill) : undefined;
  const derivation = skill && source && !compound ? deriveOperation(skill, d.shape, source, d[source]) : null;
  const financialClosed = skill === "financial" && d.operation === "financial.report" &&
    (d.metric === "outstanding_receivables" ? d.period === "none" : ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"].includes(d.period));
  const inventoryClosed = skill === "inventory" && d.inventory === "low_stock" && d.operation === "product.search";
  const closed = !e.requiresOpenExtraction && !compound && d.shape === "single" && derivation?.ok &&
    derivation.derivation.operation === d.operation && (financialClosed || inventoryClosed);
  const routing = !!skill && e.operations.length === 1 && d.shape === "single" && !c.input.context.waiting_for &&
    !["unclear", "unspecified"].includes(d.communication) && !Object.values(d).includes("unclear");
  const value: CoverageValue = c.category === "A" ? "FAST_PATH" : c.category === "D" ? "OUT_OF_CATALOG" : closed ? "FULL_JEV_BYPASS" : routing ? "JEV_ROUTING_ONLY" : "LUNA_REQUIRED";
  const proven = value === "FULL_JEV_BYPASS" && initialAllowlist.some(x => x.message === c.input.message && x.skill === d.skill && x.operation === d.operation && x.sourceValue === d[x.sourceDimension] && x.period === d.period && Object.keys(c.input.context).length === 0);
  const evidenceState: EvidenceState = proven ? "PROVEN" : value === "FULL_JEV_BYPASS" ? "CALIBRATION_CANDIDATE" : "FORCED_LUNA";
  const risks = e.operations.map(op => operationRisk[op]);
  const boundary: Boundary = value === "FAST_PATH" || value === "OUT_OF_CATALOG" ? value : compound ? "COMPOUND_FORCED_LUNA" : risks.some(r => r !== "READ_ONLY") ? "MUTATION_FORCED_LUNA" : closed ? "READ_ONLY_CANDIDATE" : "OPEN_FORCED_LUNA";
  return { caseId: c.id, currentCategory: c.category, currentRoute: classifyGoldenCase(c).route, proposedValue: value,
    evidenceState, boundary, skills: e.skills, riskClasses: risksForPlan({ operations: e.operations, requiresOpenExtraction: e.requiresOpenExtraction }), fullBypassPotential: value === "FULL_JEV_BYPASS", routingOnlyPotential: value === "JEV_ROUTING_ONLY",
    linguisticDecisions: value === "FAST_PATH" ? [] : ["skill", "shape", ...(skill && !compound ? derivedDetailDimensions(skill) : [])] as QuestionId[],
    derivations: derivation?.ok ? [derivation.derivation] : [],
    backendResolution: [...new Set(e.skills.flatMap(s => responsibilities[s].backend))],
    lunaRequirement: value === "FULL_JEV_BYPASS" ? "No open fields in this oracle; new inputs still fall back under unchanged v1 policy" : value === "FAST_PATH" ? "Use existing deterministic draft handler first" : "Open fields, unrepresented selectors, ambiguity, compound or unsupported request remain outside bypass",
    evidence: c.evidence,
    missingEvidence: proven ? ["generalization to unseen paraphrases", "larger adversarial sample"] : ["intent-level coverage beyond historical micro-sample", "per-intent adversarial calibration", "future intent-based acceptance design/approval"],
  };
}

export function auditExpansionGolden() {
  if (!isAuditedPublication(publishedDecisionCatalog())) throw Error("CATALOG_DRIFT");
  const rows = validateDataset(dataset).map(classifyExpansionCase);
  return { version: COVERAGE_VERSION, empirical: false, rows, counts: Object.fromEntries(values.map(v => [v, rows.filter(r => r.proposedValue === v).length])),
    approvedAllowlistCount: initialAllowlist.length, mutationBypassCandidates: 0,
    note: "Potential in an artificial dataset, not accepted coverage or production frequency" };
}
