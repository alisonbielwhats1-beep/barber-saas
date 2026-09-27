import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { financialRequirements } from "../src/financial-skill";
import { skillRegistry } from "../src/skill-registry";
import { type Decision, inputSchema } from "./contract";
import { derivedRequest } from "./derived-plan";
import { derivationCatalog, derivationCatalogHash, deriveOperation, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { INPUT_USD_PER_MILLION } from "./jev-provider";

/** Frozen evaluation data only. The semantic oracle must never enter a JEV request or runtime routing. */
export const CLOSED_FINANCIAL_VERSION = "financial-closed-intent-calibration-v1";
export const candidateMetrics = ["service_revenue", "received_revenue", "outstanding_receivables", "average_ticket", "realized_revenue"] as const;
export type CandidateMetric = typeof candidateMetrics[number];
export type SemanticModifiers = {
  comparison: null | { current: "this_week"; previous: "last_week" };
  groupBy: null | "professional" | "service";
  ranking: null | { direction: "highest"; limit: 1 };
  entityFilter: null | { dimension: "professional"; mention: string };
  metricSet: null | readonly ["service_revenue", "received_revenue"];
  otherOperation: null | "service.change";
};
export type FinancialIntentSignature = {
  skill: Decision["skill"];
  shape: Decision["shape"];
  metric: Decision["metric"];
  period: Decision["period"];
  modifiers: SemanticModifiers;
  requiresOpenExtraction: boolean;
  unsupportedIntent: null | "refund" | "historical_receivables" | "professional_filter";
};
export type ExpectedClass = "CLOSED_FAMILY" | "CLOSED_NEIGHBOR" | "MODIFIER_NOT_REPRESENTED" |
  "COMPOUND" | "COMPLETED_COUNT_KEEP_LUNA" | "OUT_OF_CATALOG";
export type ClosedFinancialCase = {
  id: string;
  polarity: "POSITIVE" | "ADVERSARIAL";
  family: CandidateMetric | "boundary";
  message: string;
  semanticSignature: FinancialIntentSignature;
  expected: {
    decision: Decision;
    derivation: null | { sourceDimension: "metric"; sourceValue: Decision["metric"]; operation: "financial.report" };
    classification: ExpectedClass;
    fullBypassSemanticallyPossible: boolean;
    reason: string;
    evidence: readonly string[];
  };
};

const noModifiers = (): SemanticModifiers => ({ comparison: null, groupBy: null, ranking: null,
  entityFilter: null, metricSet: null, otherOperation: null });
const decision = (skill: Decision["skill"], shape: Decision["shape"], metric: Decision["metric"],
  period: Decision["period"], operation: Decision["operation"]): Decision =>
  ({ skill, shape, metric, period, operation, inventory: "none", communication: "none" });
const financialDecision = (metric: Decision["metric"], period: Decision["period"]): Decision =>
  decision("financial", "single", metric, period, "financial.report");
const signature = (metric: Decision["metric"], period: Decision["period"],
  modifiers: SemanticModifiers = noModifiers()): FinancialIntentSignature =>
  ({ skill: "financial", shape: "single", metric, period, modifiers,
    requiresOpenExtraction: false, unsupportedIntent: null });
const derivation = (metric: CandidateMetric) =>
  ({ sourceDimension: "metric" as const, sourceValue: metric, operation: "financial.report" as const });
const positive = (id: string, family: CandidateMetric, message: string, period: Decision["period"],
  evidence: readonly string[]): ClosedFinancialCase => ({ id, polarity: "POSITIVE", family, message,
    semanticSignature: signature(family, period), expected: { decision: financialDecision(family, period),
      derivation: derivation(family), classification: "CLOSED_FAMILY", fullBypassSemanticallyPossible: true,
      reason: "Uma métrica e período compatível; modificadores ausentes somente no oracle revisado.", evidence } });
const adversarial = (id: string, message: string, semanticSignature: FinancialIntentSignature,
  expected: ClosedFinancialCase["expected"]): ClosedFinancialCase =>
  ({ id, polarity: "ADVERSARIAL", family: "boundary", message, semanticSignature, expected });

/** Two new natural paraphrases per family; no exact phrase from the current PROVEN allowlist. */
export const closedFinancialCases: readonly ClosedFinancialCase[] = [
  positive("p01", "service_revenue", "Quanto faturei em serviços ontem?", "yesterday", ["Gate 2.5", "Wave 1 f01–f03"]),
  positive("p02", "service_revenue", "Qual foi o faturamento dos serviços concluídos ontem?", "yesterday", ["Gate 2.5", "Wave 1 f01–f03"]),
  positive("p03", "received_revenue", "Quanto recebi em pagamentos ontem?", "yesterday", ["Gate 2.5", "Wave 1 f04–f06"]),
  positive("p04", "received_revenue", "Qual foi o total de pagamentos recebidos ontem?", "yesterday", ["Gate 2.5", "Wave 1 f04–f06"]),
  positive("p05", "outstanding_receivables", "Quanto ainda tenho a receber dos atendimentos concluídos sem pagamento?", "none", ["Gate 2.5", "Wave 1 f07–f09"]),
  positive("p06", "outstanding_receivables", "Qual é o saldo atual em aberto de atendimentos concluídos sem pagamento?", "none", ["Gate 2.5", "Wave 1 f07–f09"]),
  positive("p07", "average_ticket", "Qual foi meu ticket médio de serviços ontem?", "yesterday", ["Gate 2.5", "Wave 1 f10–f12"]),
  positive("p08", "average_ticket", "Em média, quanto os serviços renderam por atendimento concluído ontem?", "yesterday", ["Gate 2.5", "Wave 1 f10–f12"]),
  positive("p09", "realized_revenue", "Quanto realizei em serviços e produtos de atendimentos concluídos ontem?", "yesterday", ["Gate 2.5", "Wave 1 f13–f15"]),
  positive("p10", "realized_revenue", "Qual foi a receita bruta de serviços e produtos dos atendimentos concluídos ontem?", "yesterday", ["Gate 2.5", "Wave 1 f13–f15"]),
  adversarial("n01", "Qual profissional faturou mais este mês?",
    signature("service_revenue", "this_month", { ...noModifiers(), groupBy: "professional", ranking: { direction: "highest", limit: 1 } }),
    { decision: financialDecision("service_revenue", "this_month"), derivation: derivation("service_revenue"), classification: "MODIFIER_NOT_REPRESENTED",
      fullBypassSemanticallyPossible: false, reason: "Ranking profissional/top 1 não está no decision-plan.", evidence: ["Wave 1 f23"] }),
  adversarial("n02", "Quanto cada profissional faturou este mês?",
    signature("service_revenue", "this_month", { ...noModifiers(), groupBy: "professional" }),
    { decision: financialDecision("service_revenue", "this_month"), derivation: derivation("service_revenue"), classification: "MODIFIER_NOT_REPRESENTED",
      fullBypassSemanticallyPossible: false, reason: "Agrupamento por profissional não está no decision-plan.", evidence: ["Financial T09 group_by"] }),
  adversarial("n03", "Compare meu faturamento desta semana com a passada.",
    signature("service_revenue", "comparison", { ...noModifiers(), comparison: { current: "this_week", previous: "last_week" } }),
    { decision: financialDecision("service_revenue", "comparison"), derivation: derivation("service_revenue"), classification: "MODIFIER_NOT_REPRESENTED",
      fullBypassSemanticallyPossible: false, reason: "Choice comparison não identifica os dois períodos exigidos por T09.", evidence: ["Wave 1 f22"] }),
  adversarial("n04", "Quanto faturei ontem e altere a massagem para R$80?",
    { ...signature("service_revenue", "yesterday", { ...noModifiers(), otherOperation: "service.change" }), skill: "multiple", shape: "independent", requiresOpenExtraction: true },
    { decision: decision("multiple", "independent", "service_revenue", "yesterday", "multiple"), derivation: null, classification: "COMPOUND",
      fullBypassSemanticallyPossible: false, reason: "Financial + Services com nome/preço abertos exige plano composto.", evidence: ["Wave 1 f25"] }),
  adversarial("n05", "Quantos atendimentos concluí ontem?", signature("completed_count", "yesterday"),
    { decision: financialDecision("completed_count", "yesterday"), derivation: { sourceDimension: "metric", sourceValue: "completed_count", operation: "financial.report" },
      classification: "COMPLETED_COUNT_KEEP_LUNA", fullBypassSemanticallyPossible: false,
      reason: "Métrica publicada, mas f16–f18 foram confundidos com Scheduling; fora da calibração de cinco famílias.", evidence: ["Wave 1 f16–f18"] }),
  adversarial("n06", "Quanto faturei em serviços com a profissional Ana Lima ontem?",
    { ...signature("service_revenue", "yesterday", { ...noModifiers(), entityFilter: { dimension: "professional", mention: "Ana Lima" } }),
      requiresOpenExtraction: true, unsupportedIntent: "professional_filter" },
    { decision: financialDecision("service_revenue", "yesterday"), derivation: derivation("service_revenue"), classification: "OUT_OF_CATALOG",
      fullBypassSemanticallyPossible: false, reason: "Filtro por profissional não é publicado e o nome exige resolução aberta.", evidence: ["Financial Skill v1.0.0"] }),
  adversarial("n07", "Estorne um pagamento de ontem.",
    { ...signature("unclear", "yesterday"), skill: "out_of_catalog", shape: "out_of_catalog", unsupportedIntent: "refund" },
    { decision: decision("out_of_catalog", "out_of_catalog", "unclear", "yesterday", "out_of_catalog"), derivation: null, classification: "OUT_OF_CATALOG",
      fullBypassSemanticallyPossible: false, reason: "Estorno não é operação da Skill Financial atual.", evidence: ["Wave 1 f27", "Financial Skill v1.0.0"] }),
  adversarial("n08", "Quanto recebi ontem, e não quanto faturei em serviços?", signature("received_revenue", "yesterday"),
    { decision: financialDecision("received_revenue", "yesterday"), derivation: derivation("received_revenue"), classification: "CLOSED_NEIGHBOR",
      fullBypassSemanticallyPossible: true, reason: "Contraste lexical fecha received_revenue; testa erro de métrica vizinha.", evidence: ["Wave 1 f01/f04–f06"] }),
  adversarial("n09", "Quanto eu tinha a receber ontem?",
    { ...signature("outstanding_receivables", "yesterday"), unsupportedIntent: "historical_receivables" },
    { decision: financialDecision("outstanding_receivables", "yesterday"), derivation: derivation("outstanding_receivables"), classification: "OUT_OF_CATALOG",
      fullBypassSemanticallyPossible: false, reason: "T09 oferece somente recebíveis atuais; histórico é recusado.", evidence: ["Wave 1 f21"] }),
  adversarial("n10", "Quanto faturei e quanto recebi ontem?",
    signature("multiple", "yesterday", { ...noModifiers(), metricSet: ["service_revenue", "received_revenue"] }),
    { decision: financialDecision("multiple", "yesterday"), derivation: null, classification: "MODIFIER_NOT_REPRESENTED",
      fullBypassSemanticallyPossible: false, reason: "Choice multiple não codifica ambas as métricas publicadas.", evidence: ["Wave 1 f31"] }),
  adversarial("n11", "Quanto recebi hoje em pagamentos?", signature("received_revenue", "today"),
    { decision: financialDecision("received_revenue", "today"), derivation: derivation("received_revenue"), classification: "CLOSED_NEIGHBOR",
      fullBypassSemanticallyPossible: true, reason: "Período fechado diferente de ontem; testa troca indevida de período.", evidence: ["Financial period contract"] }),
];

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hashJson = (value: unknown) => sha(JSON.stringify(value));
const root = "packages/salon-secretary/evaluation/";
export const frozenPredecessors = Object.freeze({
  wavePlan: { path: `${root}coverage-expansion-plan.json`, sha256: "0db86b3cd6087cfaa6a1d8403aeeb481ca2d718cf4afa61df5c0cabe380e2de7" },
  waveFirst: { path: `${root}coverage-expansion-wave1-real-2026-09-23.json`, sha256: "6b7d524c4b13e163450fd7404f38f2544c0069c8b8e35adae35db2fa7b06797b" },
  waveContinuation: { path: `${root}coverage-expansion-wave1-continuation-real-2026-09-23.json`, sha256: "ebca4532b0c39ebf97e88aeb75af92184102050473d46d2af995868275130493" },
  semanticAudit: { path: `${root}financial-semantic-boundary-audit.json`, sha256: "507b85e6ce2a8343a8bf9cbd99bc2af9ca30dc107370767a745f999d1331fbcf" },
  parser: { path: `${root}conditional-plan.ts`, sha256: "836ef27063f0a191d409b9103b5d4f6fce8db86b1d85dfa03e74ff03585f0761" },
  provider: { path: `${root}jev-provider.ts`, sha256: "44449d30c852e36fe277ef7572d8de7ed0bf86d6e61f7535894303c065024960" },
  policy: { path: `${root}acceptance-policy.ts`, sha256: "ba2223442b203b6c0a055662b7a6f861e648bdfe06bb0fc680da7da7eca0958c" },
  catalog: { path: `${root}derivation-catalog.ts`, sha256: "93c145a85ad25f32e813a08a61e068f5d7590ef148abc36422a6959c32a9a6b1" },
});
export function assertFrozenPredecessors() {
  for (const source of Object.values(frozenPredecessors))
    if (sha(readFileSync(source.path)) !== source.sha256) throw Error("FROZEN_PREDECESSOR_DRIFT");
}

export function prepareClosedFinancialPlan() {
  assertFrozenPredecessors();
  const publication = publishedDecisionCatalog();
  if (!isAuditedPublication(publication) || skillRegistry.find(s => s.skill_id === "financial")?.operations.join() !== "financial.report" ||
      candidateMetrics.some(metric => !financialRequirements().metrics.includes(metric)) ||
      INPUT_USD_PER_MILLION !== 0.042) throw Error("FINANCIAL_CATALOG_DRIFT");
  const ids = new Set<string>(), cases = closedFinancialCases.map(c => {
    if (ids.has(c.id)) throw Error("DUPLICATE_CASE");
    ids.add(c.id);
    const input = inputSchema.parse({ message: c.message, context: {} });
    if (c.expected.derivation) {
      const d = deriveOperation("financial", "single", "metric", c.expected.derivation.sourceValue);
      if (!d.ok || d.derivation.operation !== c.expected.derivation.operation) throw Error("FINANCIAL_DERIVATION_DRIFT");
    }
    const discovery = derivedRequest(input, { kind: "discovery" });
    const detail = derivedRequest(input, { kind: "detail", skill: "financial" });
    if (Object.keys(discovery.questions).join() !== "skill,shape" || Object.keys(detail.questions).join() !== "metric,period" ||
        JSON.stringify([discovery, detail]).match(/"(?:expected|semanticSignature|evidence|domainFields|TYPESAFE_API_KEY|phone|customer_ref|salonId)"/i))
      throw Error("FINANCIAL_PAYLOAD_DRIFT");
    return { ...c, payloads: { discovery, detail }, payloadBytes: { discovery: Buffer.byteLength(JSON.stringify(discovery)), detail: Buffer.byteLength(JSON.stringify(detail)) } };
  });
  if (cases.length !== 21 || cases.filter(c => c.polarity === "POSITIVE").length !== 10 ||
      cases.filter(c => c.polarity === "ADVERSARIAL").length !== 11) throw Error("FINANCIAL_CASE_COUNT_DRIFT");
  const maxHttpCalls = cases.length * 2;
  return { version: CLOSED_FINANCIAL_VERSION, evaluationOnly: true, executed: false, zeroRetries: true,
    predecessorHashes: frozenPredecessors,
    catalog: { version: derivationCatalog.version, hash: derivationCatalogHash(derivationCatalog), publicationHash: derivationCatalog.publicationHash },
    cases, caseCount: cases.length, positiveCount: 10, adversarialCount: 11,
    datasetHash: hashJson(closedFinancialCases), payloadsHash: hashJson(cases.map(c => c.payloads)),
    maxHttpCalls, maximumPlanningEstimateUsd: maxHttpCalls * 64_000 * INPUT_USD_PER_MILLION / 1_000_000,
    pricing: { inputUsdPerMillion: INPUT_USD_PER_MILLION, outputUsdPerMillion: 0, evidenceDate: "2026-09-22",
      currentRateVerified: false, maxInputTokensPerHttp: 64_000, requiresOfficialRecheckBeforeExecution: true },
    detailRule: "Only a validated financial+single discovery may request Financial detail. Never select a branch using expected or signature.",
    periodRule: "The existing detail question includes none; outstanding_receivables requires none, not an invented relative period.",
    modifierRule: "Oracle-reviewed NONE is evaluation truth only; the current JEV plan does not prove absence for arbitrary runtime input.",
    continueKnownInvalid: "INVALID_RESPONSE + known sanitized diagnostic + FALLBACK_REQUIRED; never accept or normalize probabilities.",
    stopOn: ["UNSAFE_FALSE_POSITIVE", "UNKNOWN_SCHEMA_OR_DIAGNOSTIC", "FAIL_CLOSED_UNCERTAIN", "CATALOG_OR_HASH_MISMATCH",
      "FORBIDDEN_PAYLOAD_DATA", "BUDGET_EXCEEDED", "HTTP_500", "TIMEOUT"],
    noEffects: ["JEV during preparation", "OpenAI", "backend", "database", "business tools", "runtime routing"] };
}
