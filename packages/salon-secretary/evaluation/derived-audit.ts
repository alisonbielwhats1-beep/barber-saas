import { createHash } from "node:crypto";
import { dataset, validateDataset } from "./dataset";
import { skills, choiceSets, type EvaluationCase, type QuestionId } from "./contract";
import { auditCase } from "./conditional-audit";
import { derivableDimension, deriveOperation, derivationCatalog, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { derivedRequest, derivedDetailDimensions, DERIVED_PLAN_VERSION } from "./derived-plan";
import { INPUT_USD_PER_MILLION } from "./jev-provider";
import type { Skill } from "./conditional-plan";

export const decisionClasses = ["LINGUISTIC_DECISION", "DETERMINISTIC_DERIVATION", "BACKEND_RESOLUTION", "LUNA_REQUIRED", "FAST_PATH"] as const;
export type DecisionClass = typeof decisionClasses[number];
const backendResponsibilities: Record<Skill, string[]> = {
  services: ["service_ref", "normalização", "requirements/patch/revisão/autorização"],
  customers: ["customer_ref", "duplicidade/desambiguação", "validação telefone/e-mail"],
  scheduling: ["customer_ref/service_ref/professional_ref/appointment_ref", "timezone/data absoluta", "preço/duração/disponibilidade/recursos", "grafo/revisão/autorização"],
  financial: ["intervalo absoluto/timezone", "cálculos/agregados/T09", "autorização/tenant"],
  inventory: ["product_ref", "saldo/mínimo/unidade/projeção", "revisão/autorização"],
  communication: ["recipient_ref/telefone", "canal permitido/preview/EXACT", "dependência/outbox/status/idempotência"],
};
const openResponsibilities: Record<Skill, string[]> = {
  services: ["nome/alvo", "valor/duração fora do fast-path"],
  customers: ["nome composto/alvo", "contato/patch explícito"],
  scheduling: ["entidades e papéis nominais", "data/hora/período/reason abertos", "operações/dependências múltiplas"],
  financial: ["períodos de comparação", "múltiplas métricas/agrupamentos"],
  inventory: ["nome do produto", "quantidade/motivo explícitos fora do fast-path"],
  communication: ["destinatário/canal/texto", "geração explícita ou extração literal", "dependência e mesma pessoa"],
};
const fastPathFields: Record<Skill, string[]> = {
  services: ["durationMin"], customers: [], scheduling: ["time", "date"], financial: [], inventory: ["quantity"], communication: ["channel"],
};

/** N/A is deliberately not a decision class: it must not become a question or synthetic probability. */
export function decisionMatrix() {
  return skills.map(skill => ({ skill, dimensions: (Object.keys(choiceSets) as QuestionId[]).map(dimension => {
    const applicable = ["skill", "shape", ...derivedDetailDimensions(skill), ...(derivableDimension(skill) ? ["operation"] : [])].includes(dimension);
    return { dimension, applicable, classification: !applicable ? null : dimension === "operation" && derivableDimension(skill) ? "DETERMINISTIC_DERIVATION" as const : "LINGUISTIC_DECISION" as const };
  }), backend: { classification: "BACKEND_RESOLUTION" as const, responsibilities: backendResponsibilities[skill] },
  open: { classification: "LUNA_REQUIRED" as const, responsibilities: openResponsibilities[skill] },
  continuation: { classification: fastPathFields[skill].length ? "FAST_PATH" as const : "LUNA_REQUIRED" as const, fields: fastPathFields[skill],
    operationSource: "DETERMINISTIC_DERIVATION: contexto autorizado do draft, não reclassificação",
    condition: "Somente contexto de draft autorizado e formato aceito pelo parser existente; caso contrário LUNA_REQUIRED." } }));
}
/** Oracle is used only for offline reporting. Never pass this object to a provider. */
export function auditDerivedCase(c: EvaluationCase) {
  const previous = auditCase(c), continuing = Boolean(c.input.context.waiting_for);
  const skill = !continuing && c.expected.decision.shape === "single" && c.expected.skills.length === 1 ? c.expected.skills[0] : null;
  const requests = continuing ? [] : [derivedRequest(c.input, { kind: "discovery" }), ...(skill ? [derivedRequest(c.input, { kind: "detail", skill })] : [])];
  const decisions = requests.flatMap(r => Object.keys(r.questions)) as QuestionId[];
  const source = skill && derivableDimension(skill);
  const derivation = source && skill ? deriveOperation(skill, "single", source, c.expected.decision[source]) : null;
  return { caseId: c.id, category: c.category, path: previous.path,
    linguistic: { classification: "LINGUISTIC_DECISION" as const, dimensions: decisions },
    deterministic: { classification: "DETERMINISTIC_DERIVATION" as const, operations: derivation?.ok ? [derivation.derivation] : [],
      knownContextOperation: continuing ? c.input.context.operation : null, failure: derivation && !derivation.ok ? derivation.reason : null },
    backend: { classification: "BACKEND_RESOLUTION" as const, responsibilities: [...new Set(c.expected.skills.flatMap(s => backendResponsibilities[s]))] },
    luna: { classification: "LUNA_REQUIRED" as const, required: previous.requiresLuna, responsibilities: previous.requiresLuna ? [...new Set(c.expected.skills.flatMap(s => openResponsibilities[s]))] : [], oracleOpenRequirements: c.expected.domainFields },
    fastPath: { classification: "FAST_PATH" as const, applicable: c.category === "A", waitingFor: c.category === "A" ? c.input.context.waiting_for : null },
    notApplicable: skill ? (["period", "metric", "inventory", "communication"] as QuestionId[]).filter(id => !derivedDetailDimensions(skill).includes(id)) : [],
    expectedUnchanged: c.expected.decision, previousQuestions: previous.plannedQuestions, plannedQuestions: decisions.length,
    previousHttpCalls: previous.plannedHttpCalls, plannedHttpCalls: requests.length, previousJsonBytes: previous.plannedJsonBytes,
    plannedJsonBytes: requests.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r), "utf8"), 0) };
}
export function prepareDerivedAudit() {
  if (!isAuditedPublication(publishedDecisionCatalog())) throw Error("CATALOG_DRIFT");
  const checked = validateDataset(dataset), cases = checked.map(auditDerivedCase);
  const groups = (["A", "B", "C", "D"] as const).map(category => {
    const group = cases.filter(c => c.category === category), questions = group.reduce((sum, c) => sum + c.plannedQuestions, 0);
    return { category, cases: group.length, questions, averageQuestionsPerCase: questions / group.length,
      previousQuestions: group.reduce((sum, c) => sum + c.previousQuestions, 0), httpCalls: group.reduce((sum, c) => sum + c.plannedHttpCalls, 0), jsonBytes: group.reduce((sum, c) => sum + c.plannedJsonBytes, 0) };
  });
  const sum = (key: "plannedQuestions" | "previousQuestions" | "plannedHttpCalls" | "plannedJsonBytes" | "previousJsonBytes") => cases.reduce((n, c) => n + c[key], 0);
  return { planVersion: DERIVED_PLAN_VERSION, executed: false, oracleOnlyOfflinePlan: true, catalog: derivationCatalog,
    datasetFingerprint: createHash("sha256").update(JSON.stringify(checked)).digest("hex"), matrix: decisionMatrix(), cases, groups,
    totals: { cases: cases.length, previousQuestions: sum("previousQuestions"), questions: sum("plannedQuestions"), averageQuestionsPerCase: sum("plannedQuestions") / cases.length,
      httpCalls: sum("plannedHttpCalls"), previousJsonBytes: sum("previousJsonBytes"), jsonBytes: sum("plannedJsonBytes") } };
}
export function prepareDerivedRevalidation() {
  if (!isAuditedPublication(publishedDecisionCatalog())) throw Error("CATALOG_DRIFT");
  return { planVersion: DERIVED_PLAN_VERSION, executed: false, noLuna: true, retries: 0, maxCases: 2, maxHttpCalls: 4, timeoutPerHttpMs: 10000,
    conservativePublishedContextCostUsd: 4 * 64000 * INPUT_USD_PER_MILLION / 1_000_000,
    note: "Proposta offline; não executar. Enviar somente os payloads. Detail apenas após discovery compatível; derivação não autoriza efeito nem altera gabarito.",
    cases: ["financial-revenue", "inventory-low"].map(id => {
      const c = dataset.find(x => x.id === id)!, skill = c.expected.skills[0];
      return { caseId: id, message: c.input.message, discoveryPayload: derivedRequest(c.input, { kind: "discovery" }), continueOnlyIf: { skill, shape: "single" },
        conditionalDetailPayload: derivedRequest(c.input, { kind: "detail", skill }), expected: c.expected.decision, audit: auditDerivedCase(c) };
    }) };
}
