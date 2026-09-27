import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { financialRequirements } from "../src/financial-skill";
import { skillRegistry } from "../src/skill-registry";
import { expansionDataset } from "./coverage-expansion-dataset";

/** Offline oracle audit. None of these annotations may be sent to JEV or used as a runtime router. */
export const FINANCIAL_SEMANTIC_AUDIT_VERSION = "financial-semantic-boundary-v1";
export type SemanticClass =
  | "CLOSED_FINANCIAL"
  | "CLOSED_BUT_UNCALIBRATED"
  | "MODIFIER_NOT_REPRESENTED"
  | "OPEN_EXTRACTION_REQUIRED"
  | "COMPOUND"
  | "OUT_OF_CATALOG";
export type UnrepresentedDimension =
  | "current_period" | "compare_period" | "group_by" | "ranking_direction" | "top_limit"
  | "metric_set" | "required_period" | "metric_ambiguity" | "sales_semantics"
  | "historical_receivables" | "other_skill_operation" | "open_entity" | "open_value"
  | "unsupported_capability";
export type FinancialSemanticIntentSignature = {
  skill: "financial";
  shape: "single";
  metric: string;
  period: string;
  comparisonPeriod: string | null;
  groupBy: "professional" | "service" | null;
  rankingDirection: "highest" | null;
  topLimit: number | null;
  metricSet: readonly string[] | null;
  entityFilter: string | null;
};
type Annotation = {
  semanticClass: SemanticClass;
  unrepresented: readonly UnrepresentedDimension[];
  comparisonPeriod?: string;
  groupBy?: "professional" | "service";
  rankingDirection?: "highest";
  topLimit?: number;
  metricSet?: readonly string[];
  explanation: string;
};
const closed = (explanation: string): Annotation => ({ semanticClass: "CLOSED_BUT_UNCALIBRATED", unrepresented: [], explanation });
const closedSimple = "Uma métrica publicada e período fechado; valores e datas absolutas continuam no backend.";
const currentBalance = "Saldo atual a receber: period=none é correto; o backend não aceita período histórico.";
export const financialCaseAnnotations: Readonly<Record<string, Annotation>> = Object.freeze({
  f01: { semanticClass: "CLOSED_FINANCIAL", unrepresented: [], explanation: "Frase exata atualmente inscrita na Policy; ausência de modificadores revisada somente para esta entrada." },
  f02: closed(closedSimple), f03: closed(closedSimple),
  f04: closed("Pedido fechado, mas a resposta real do provider foi estruturalmente inválida; não conta como acerto JEV."),
  f05: closed(closedSimple), f06: closed(closedSimple),
  f07: closed(currentBalance), f08: closed(currentBalance), f09: closed(currentBalance),
  f10: closed(closedSimple), f11: closed(closedSimple), f12: closed(closedSimple),
  f13: closed(closedSimple), f14: closed(closedSimple), f15: closed(closedSimple),
  f16: closed("completed_count é métrica Financial publicada, embora JEV tenha escolhido Scheduling neste ensaio."),
  f17: closed("completed_count é métrica Financial publicada, embora JEV tenha escolhido Scheduling neste ensaio."),
  f18: closed("completed_count é métrica Financial publicada, embora JEV tenha escolhido Scheduling neste ensaio."),
  f19: { semanticClass: "OPEN_EXTRACTION_REQUIRED", unrepresented: ["required_period"], explanation: "Período obrigatório não foi informado; solicitar esclarecimento, nunca inventar período." },
  f20: { semanticClass: "OPEN_EXTRACTION_REQUIRED", unrepresented: ["metric_ambiguity"], explanation: "Entrou pode significar recebido, realizado ou outro conceito; pedir esclarecimento." },
  f21: { semanticClass: "OUT_OF_CATALOG", unrepresented: ["historical_receivables"], explanation: "Recebíveis publicados são saldo atual; T09 rejeita recorte histórico." },
  f22: { semanticClass: "MODIFIER_NOT_REPRESENTED", unrepresented: ["current_period", "compare_period"], comparisonPeriod: "last_week", explanation: "comparison não identifica os dois períodos; T09 exige period e compare_period separados." },
  f23: { semanticClass: "MODIFIER_NOT_REPRESENTED", unrepresented: ["group_by", "ranking_direction", "top_limit"], groupBy: "professional", rankingDirection: "highest", topLimit: 1, explanation: "T09 aceita group_by=professional e ordena receita decrescente, mas JEV não perguntou agrupamento/ranking/top; T09 devolve até dez, sem seletor limit=1." },
  f24: { semanticClass: "MODIFIER_NOT_REPRESENTED", unrepresented: ["group_by", "ranking_direction", "top_limit"], groupBy: "service", rankingDirection: "highest", topLimit: 1, explanation: "T09 aceita group_by=service com cobertura de snapshots; JEV não perguntou agrupamento/ranking/top." },
  f25: { semanticClass: "COMPOUND", unrepresented: ["other_skill_operation", "open_entity", "open_value"], explanation: "Financial read-only + service.change independente; nome do serviço e preço exigem extração aberta e proposta separada." },
  f26: { semanticClass: "COMPOUND", unrepresented: ["other_skill_operation", "open_entity"], explanation: "Financial read-only + appointment.cancel independente; cliente/data/motivo exigem plano composto e resolução backend." },
  f27: { semanticClass: "OUT_OF_CATALOG", unrepresented: ["unsupported_capability"], explanation: "Estorno financeiro não é publicado." },
  f28: { semanticClass: "OUT_OF_CATALOG", unrepresented: ["unsupported_capability"], explanation: "Lucro líquido não é publicado; não substituir por faturamento." },
  f29: { semanticClass: "OUT_OF_CATALOG", unrepresented: ["unsupported_capability"], explanation: "Taxas de pagamento não são modeladas nesta Skill." },
  f30: { semanticClass: "OUT_OF_CATALOG", unrepresented: ["unsupported_capability", "open_entity"], explanation: "Baixa financeira/escrita não é publicada." },
  f31: { semanticClass: "MODIFIER_NOT_REPRESENTED", unrepresented: ["metric_set"], metricSet: ["service_revenue", "received_revenue"], explanation: "Um financial.report pode solicitar múltiplas métricas, mas choice=multiple não identifica quais duas." },
  f32: { semanticClass: "OPEN_EXTRACTION_REQUIRED", unrepresented: ["sales_semantics"], explanation: "Vendi não desambigua serviços, produtos ou pagamento; pedir esclarecimento." },
});

const root = "packages/salon-secretary/evaluation/";
export const financialAuditSources = Object.freeze({
  plan: { path: `${root}coverage-expansion-plan.json`, sha256: "0db86b3cd6087cfaa6a1d8403aeeb481ca2d718cf4afa61df5c0cabe380e2de7" },
  prior: { path: `${root}coverage-expansion-wave1-real-2026-09-23.json`, sha256: "6b7d524c4b13e163450fd7404f38f2544c0069c8b8e35adae35db2fa7b06797b" },
  continuation: { path: `${root}coverage-expansion-wave1-continuation-real-2026-09-23.json`, sha256: "ebca4532b0c39ebf97e88aeb75af92184102050473d46d2af995868275130493" },
});
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const readFrozen = (entry: { path: string; sha256: string }) => {
  const bytes = readFileSync(entry.path);
  if (sha256(bytes) !== entry.sha256) throw Error("FINANCIAL_HISTORICAL_EVIDENCE_DRIFT");
  return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
};

/** A signature is an evaluation oracle, not evidence that JEV detected absent modifiers. */
export function semanticIntentSignature(metric: string, period: string, options: {
  comparisonPeriod?: string | null; groupBy?: "professional" | "service" | null;
  rankingDirection?: "highest" | null; topLimit?: number | null;
  metricSet?: readonly string[] | null; entityFilter?: string | null;
} = {}): FinancialSemanticIntentSignature {
  return { skill: "financial", shape: "single", metric, period,
    comparisonPeriod: options.comparisonPeriod ?? null, groupBy: options.groupBy ?? null,
    rankingDirection: options.rankingDirection ?? null, topLimit: options.topLimit ?? null,
    metricSet: options.metricSet ?? null, entityFilter: options.entityFilter ?? null };
}

/** Offline-only check: it receives reviewed semantics and historical model output. Never call it on raw user text to authorize a request. */
export function assessFinancialSemanticCoverage(input: {
  semanticClass: SemanticClass; expected: { skill: string; shape: string; metric: string; period: string; operation: string };
  observed: { skill?: string; shape?: string; metric?: string; period?: string; operation?: string } | null;
  unrepresented: readonly UnrepresentedDimension[]; providerValid: boolean; policyAccepted: boolean;
}) {
  const dimensions = ["skill", "shape", "metric", "period", "operation"] as const;
  const matching = input.observed ? dimensions.filter(key =>
    !["unclear", "multiple", "out_of_catalog"].includes(input.expected[key]) &&
    !(key === "period" && input.unrepresented.includes("required_period")) &&
    input.observed?.[key] === input.expected[key]) : [];
  const missing = dimensions.filter(key => !matching.includes(key));
  const semanticallyClosed = ["CLOSED_FINANCIAL", "CLOSED_BUT_UNCALIBRATED"].includes(input.semanticClass) &&
    input.unrepresented.length === 0 && input.providerValid && missing.length === 0;
  return { matchingDimensions: matching, missingCoreDimensions: missing,
    missingSemanticDimensions: input.unrepresented,
    semanticallyClosed, fullJevBypassObserved: semanticallyClosed && input.policyAccepted };
}

type ObservedCase = {
  id: string; classification: string; result: { status: string; error: string | null;
    answers: Record<string, { choice: string }>; derivations: { operation: string }[] };
  policy: { decision: string; reason: string }; rounds: { status: string; error: string | null }[];
};

export function buildFinancialSemanticBoundaryAudit() {
  const plan = readFrozen(financialAuditSources.plan), prior = readFrozen(financialAuditSources.prior), continuation = readFrozen(financialAuditSources.continuation);
  const frozen = (plan.waves as { cases: { id: string; message: string; expected: unknown }[] }[])[0].cases;
  const previous = (prior.cases as ObservedCase[]), next = (continuation.cases as ObservedCase[]);
  if (previous.map(c => c.id).join() !== ["f01", "f02", "f03", "f04"].join() ||
      next.map(c => c.id).join() !== Array.from({ length: 19 }, (_, i) => `f${String(i + 5).padStart(2, "0")}`).join() ||
      continuation.stopReason !== "UNSAFE_SHADOW_CANDIDATE" || frozen.length !== 32 ||
      Object.keys(financialCaseAnnotations).length !== 32 ||
      financialRequirements().metrics.length !== 6 ||
      skillRegistry.find(s => s.skill_id === "financial")?.operations.join() !== "financial.report")
    throw Error("FINANCIAL_AUDIT_SOURCE_DRIFT");
  const observed = new Map([...previous, ...next].map(c => [c.id, c]));
  const rows = frozen.map((caseInPlan, index) => {
    const original = expansionDataset[index], annotation = financialCaseAnnotations[caseInPlan.id], real = observed.get(caseInPlan.id);
    if (!original || original.id !== caseInPlan.id || original.input.message !== caseInPlan.message ||
        JSON.stringify(original.expected) !== JSON.stringify(caseInPlan.expected) || !annotation)
      throw Error("FINANCIAL_AUDIT_SOURCE_DRIFT");
    const d = original.expected.decision;
    const answers = real?.result.answers ?? {};
    const observedSelectors = real ? { skill: answers.skill?.choice, shape: answers.shape?.choice,
      metric: answers.metric?.choice, period: answers.period?.choice,
      operation: real.result.derivations[0]?.operation } : null;
    const providerValid = real ? real.rounds.length > 0 && real.rounds.every(round => round.status === "OK" && round.error === null) : null;
    const coverage = real ? assessFinancialSemanticCoverage({ semanticClass: annotation.semanticClass,
      expected: { skill: d.skill, shape: d.shape, metric: d.metric, period: d.period, operation: d.operation },
      observed: observedSelectors, unrepresented: annotation.unrepresented,
      providerValid: providerValid === true, policyAccepted: real.policy.decision === "ACCEPT_JEV" }) : null;
    const signature = d.skill === "financial" && d.shape === "single" ? semanticIntentSignature(d.metric, d.period,
      { comparisonPeriod: annotation.comparisonPeriod, groupBy: annotation.groupBy,
        rankingDirection: annotation.rankingDirection, topLimit: annotation.topLimit,
        metricSet: annotation.metricSet }) : null;
    return { id: original.id, message: original.input.message, historicalBaseline: original.baseline,
      originalExpected: original.expected, semanticClass: annotation.semanticClass,
      reviewedSemanticRequirement: { signature, unrepresented: annotation.unrepresented, explanation: annotation.explanation },
      observed: real ? { status: real.result.status, providerValid, selectors: observedSelectors,
        policy: real.policy, historicalClassification: real.classification, coverage } : null,
      semanticallyPossibleFullBypass: ["CLOSED_FINANCIAL", "CLOSED_BUT_UNCALIBRATED"].includes(annotation.semanticClass),
      nextHandling: annotation.semanticClass === "OUT_OF_CATALOG" ? "REJECT_OR_CLARIFY" :
        real?.policy.decision === "ACCEPT_JEV" ? "BACKEND" : "LUNA_OR_CLARIFICATION" };
  });
  return { version: FINANCIAL_SEMANTIC_AUDIT_VERSION, executed: false, evaluationOnly: true,
    originalReportsUnchanged: true, sourceHashes: financialAuditSources,
    observedCount: rows.filter(row => row.observed !== null).length,
    unexecutedCount: rows.filter(row => row.observed === null).length,
    counts: Object.fromEntries((["CLOSED_FINANCIAL", "CLOSED_BUT_UNCALIBRATED", "MODIFIER_NOT_REPRESENTED",
      "OPEN_EXTRACTION_REQUIRED", "COMPOUND", "OUT_OF_CATALOG"] as SemanticClass[])
      .map(label => [label, rows.filter(row => row.semanticClass === label).length])),
    rows, note: "Oracle-based offline audit. No message matcher, runtime gate, JEV question, policy change or new accepted intent." };
}
