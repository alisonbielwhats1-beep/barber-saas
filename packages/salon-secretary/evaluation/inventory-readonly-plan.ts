import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Decision, EvaluationResult } from "./contract";
import { routeDiscovery } from "./conditional-plan";
import { derivedRequest } from "./derived-plan";
import { derivationCatalog, derivationCatalogHash, deriveOperation } from "./derivation-catalog";
import { assertFrozenPredecessors } from "./financial-closed-intent-plan";
import { INPUT_USD_PER_MILLION } from "./jev-provider";

export const INVENTORY_WAVE_VERSION = "inventory-readonly-wave2-v1";
export type InventoryCategory = "FULL_JEV_BYPASS_CANDIDATE" | "JEV_ROUTING_ONLY" | "OPEN_EXTRACTION_REQUIRED" |
  "MUTATION_FORCED_LUNA" | "COMPOUND_FORCED_LUNA" | "OUT_OF_CATALOG" | "FAST_PATH";
export type InventoryCase = {
  id: string; message: string; category: InventoryCategory;
  evidenceState: "PROVEN" | "CALIBRATION_CANDIDATE" | "JEV_ROUTING_ONLY" | "FORCED_LUNA";
  expected: {
    skill: Decision["skill"]; shape: Decision["shape"]; inventory: Decision["inventory"];
    operation: Decision["operation"] | null;
    /** Full semantic oracle, not model input; a selector match alone never implies completeness. */
    fields: Record<string, string | number | boolean | string[]>;
    unresolvedByChoices: readonly string[];
    fullBypassSemanticallyPossible: boolean;
    domainSupport: "SUPPORTED" | "UNSUPPORTED" | "NEEDS_INPUT";
    expectedPolicy: "PROVEN_IF_VALID_CORRECT" | "FALLBACK_REQUIRED";
  };
};
function low(id: string, message: string): InventoryCase {
  return { id, message, category: "FULL_JEV_BYPASS_CANDIDATE", evidenceState: id === "i01" ? "PROVEN" : "CALIBRATION_CANDIDATE",
    expected: { skill: "inventory", shape: "single", inventory: "low_stock", operation: "product.search",
      fields: { low_stock: true, relation: "stock <= minStock", includeInactive: true, scope: "current_tenant", presentationLimit: 20 },
      unresolvedByChoices: [], fullBypassSemanticallyPossible: true, domainSupport: "SUPPORTED",
      expectedPolicy: id === "i01" ? "PROVEN_IF_VALID_CORRECT" : "FALLBACK_REQUIRED" } };
}
function negative(id: string, message: string, category: InventoryCategory, intent: Decision["inventory"],
  fields: InventoryCase["expected"]["fields"], unresolved: string[], support: InventoryCase["expected"]["domainSupport"] = "SUPPORTED",
  skill: Decision["skill"] = "inventory", shape: Decision["shape"] = "single"): InventoryCase {
  const derived = skill === "inventory" && shape === "single" ? deriveOperation("inventory", "single", "inventory", intent) : null;
  return { id, message, category,
    evidenceState: category === "JEV_ROUTING_ONLY" || category === "OPEN_EXTRACTION_REQUIRED" ? "JEV_ROUTING_ONLY" : "FORCED_LUNA",
    expected: { skill, shape, inventory: intent, operation: derived?.ok ? derived.derivation.operation : null,
      fields, unresolvedByChoices: unresolved, domainSupport: support, fullBypassSemanticallyPossible: false, expectedPolicy: "FALLBACK_REQUIRED" } };
}

/** Only global low-stock queries are positive. No user data, IDs, stock values or new classifiers. */
export const inventoryReadonlyCases: readonly InventoryCase[] = [
  low("i01", "Quais produtos estão com estoque baixo?"),
  low("i02", "Quais produtos estão acabando?"),
  low("i03", "Mostre os produtos com estoque baixo."),
  low("i04", "Liste os itens com estoque baixo."),
  low("i05", "Quero ver os produtos com saldo no mínimo ou abaixo dele."),
  low("i06", "Quais produtos estão no mínimo ou abaixo do estoque mínimo configurado?"),
  low("i07", "Me mostra o que está acabando no estoque."),
  low("i08", "Consulte os produtos cujo saldo é menor ou igual ao mínimo cadastrado."),
  negative("n01", "Quanto tenho de Shampoo X?", "JEV_ROUTING_ONLY", "balance", { product_name: "Shampoo X" }, ["product_name"]),
  negative("n02", "Qual o saldo do Shampoo X?", "JEV_ROUTING_ONLY", "balance", { product_name: "Shampoo X" }, ["product_name"]),
  negative("n03", "Tenho Shampoo X em estoque?", "JEV_ROUTING_ONLY", "balance", { product_name: "Shampoo X", availabilityQuestion: true }, ["product_name"]),
  negative("n04", "Procure o produto Shampoo X.", "OPEN_EXTRACTION_REQUIRED", "search", { product_name: "Shampoo X" }, ["product_name"]),
  negative("n05", "Liste os produtos do estoque.", "JEV_ROUTING_ONLY", "search", { genericListing: true }, ["current_flow_requires_name_or_low_stock"], "NEEDS_INPUT"),
  negative("n06", "Quais shampoos estão com estoque baixo?", "OPEN_EXTRACTION_REQUIRED", "low_stock", { low_stock: true, product_name: "shampoos" }, ["product_name"]),
  negative("n07", "Quais produtos estão estritamente abaixo do mínimo, sem incluir os que estão exatamente no mínimo?", "OUT_OF_CATALOG", "low_stock", { relation: "stock < minStock", excludeEquality: true }, ["strict_inequality"], "UNSUPPORTED"),
  negative("n08", "Quais produtos ativos estão com estoque baixo?", "OUT_OF_CATALOG", "low_stock", { low_stock: true, active: true }, ["active_filter"], "UNSUPPORTED"),
  negative("n09", "Quais produtos estão com saldo exatamente zero?", "OUT_OF_CATALOG", "search", { stockEquals: 0 }, ["exact_stock_filter"], "UNSUPPORTED"),
  negative("n10", "Tenho pelo menos três unidades de Shampoo X?", "OPEN_EXTRACTION_REQUIRED", "balance", { product_name: "Shampoo X", threshold: 3 }, ["product_name", "quantity_comparison"], "UNSUPPORTED"),
  negative("n11", "Dê entrada em 10 shampoos.", "MUTATION_FORCED_LUNA", "IN", { product_name: "shampoos", quantity: 10, mode: "IN" }, ["product_name", "quantity"]),
  negative("n12", "Baixe 3 condicionadores.", "MUTATION_FORCED_LUNA", "OUT", { product_name: "condicionadores", quantity: 3, mode: "OUT" }, ["product_name", "quantity"]),
  negative("n13", "Dê baixa nos produtos que estão acabando.", "MUTATION_FORCED_LUNA", "OUT", { mode: "OUT", low_stock: true, bulk: true }, ["product_set", "quantity", "bulk_movement"], "UNSUPPORTED"),
  negative("n14", "Qual o saldo de Shampoo X e Condicionador Y?", "COMPOUND_FORCED_LUNA", "balance", { products: ["Shampoo X", "Condicionador Y"] }, ["multiple_products", "product_names"], "NEEDS_INPUT", "inventory", "independent"),
  negative("n15", "Quais produtos estão com estoque baixo e cancele a Amanda?", "COMPOUND_FORCED_LUNA", "low_stock", { low_stock: true, other_operation: "appointment.cancel" }, ["other_operation", "customer_name", "appointment_resolution"], "SUPPORTED", "multiple", "independent"),
  negative("n16", "Como está o estoque?", "OPEN_EXTRACTION_REQUIRED", "unclear", {}, ["ambiguous_intent"], "NEEDS_INPUT", "inventory", "unclear"),
  negative("n17", "Cadastre o produto Shampoo X.", "OUT_OF_CATALOG", "none", { product_name: "Shampoo X", requestedOperation: "product.create" }, ["unpublished_operation"], "UNSUPPORTED", "out_of_catalog", "out_of_catalog"),
  negative("n18", "Quais produtos estavam com estoque baixo ontem?", "OUT_OF_CATALOG", "low_stock", { low_stock: true, period: "yesterday" }, ["historical_balance"], "UNSUPPORTED"),
];

export const inventoryAuditPins = Object.freeze({
  "packages/salon-secretary/src/inventory-skill.ts": "6924ac110b5e26220f44907c56f5132a7cbc4a318a0ecea7203df3befd78d79c",
  "src/lib/inventory-catalog.ts": "2901aacfd741cf650d829e39302da4c1d2e29e9c0604c13ea52b053691e3192f",
  "src/lib/secretary-inventory.ts": "91ae08553532e5a04b473ca8a17877943ff2a3cda0f798cc7fab9fa936edbcd6",
  "packages/salon-secretary/src/skill-registry.ts": "44ea31bbbbb45008da701f1210f3a51975d3e253df3770e9783ee8262ca222f2",
  "packages/salon-secretary/evaluation/dataset.ts": "af7ca3a568dbc6bfe96452cc92e0f36bbe65ce3a6b0c046de7f665fa08be5300",
  "packages/salon-secretary/evaluation/financial-modifier-real-2026-09-23.json": "cccde482f4bf61a3bca0f5a0a799c0094ac8a7a3e8507710191f0c2dcec5f988",
});
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
export function assertInventoryAuditPins() {
  assertFrozenPredecessors();
  for (const [path, hash] of Object.entries(inventoryAuditPins)) if (sha(readFileSync(path)) !== hash) throw Error("INVENTORY_AUDIT_DRIFT");
}
export const inventoryDiscovery = (message: string) => derivedRequest({ message, context: {} }, { kind: "discovery" });
/** Conditional branch depends on observed validated discovery, never the oracle. */
export function nextInventoryDetail(message: string, discovery: EvaluationResult) {
  const route = routeDiscovery(discovery);
  return route.kind === "detail" && route.skill === "inventory" ?
    derivedRequest({ message, context: {} }, { kind: "detail", skill: "inventory" }) : null;
}
export function prepareInventoryReadonlyPlan() {
  assertInventoryAuditPins();
  const cases = inventoryReadonlyCases.map(c => {
    const discovery = inventoryDiscovery(c.message);
    const detail = derivedRequest({ message: c.message, context: {} }, { kind: "detail", skill: "inventory" });
    if (Object.keys(discovery.questions).join() !== "skill,shape" || Object.keys(detail.questions).join() !== "inventory") throw Error("QUESTION_DRIFT");
    if (c.expected.operation) {
      const d = deriveOperation("inventory", "single", "inventory", c.expected.inventory);
      if (!d.ok || d.derivation.operation !== c.expected.operation) throw Error("DERIVATION_DRIFT");
    }
    return { ...c, payloads: { discovery, detail }, payloadBytes: { discovery: Buffer.byteLength(JSON.stringify(discovery)), detail: Buffer.byteLength(JSON.stringify(detail)) } };
  });
  if (cases.length !== 26 || new Set(cases.map(c => c.id)).size !== 26 || INPUT_USD_PER_MILLION !== 0.042) throw Error("PLAN_DRIFT");
  return { version: INVENTORY_WAVE_VERSION, evaluationOnly: true, executed: false, caseCount: 26,
    positives: 8, adversarial: 18, maxHttpCalls: 52, retries: 0, cases,
    predecessorPins: inventoryAuditPins, catalog: { version: derivationCatalog.version, hash: derivationCatalogHash(derivationCatalog) },
    datasetHash: sha(JSON.stringify(inventoryReadonlyCases)), payloadsHash: sha(JSON.stringify(cases.map(c => c.payloads))),
    pricing: { inputUsdPerMillion: INPUT_USD_PER_MILLION, outputUsdPerMillion: 0, lastOfficialCheck: "2026-09-23",
      checkedInThisGate: false, mustRecheckBeforeExecution: true, maxInputTokensPerHttpPlanning: 64_000,
      maximumPlanningEstimateUsd: 52 * 64_000 * INPUT_USD_PER_MILLION / 1_000_000 },
    payloadBytesMaximum: cases.reduce((n, c) => n + c.payloadBytes.discovery + c.payloadBytes.detail, 0),
    knownEvidence: ["Gate 2.6 Inventory Core", "derived-revalidation.json", "acceptance-calibration-real-2026-09-23.json"],
    stopOn: ["UNSAFE_FALSE_POSITIVE", "UNSAFE_SELECTOR_ONLY_CANDIDATE", "UNKNOWN_DIAGNOSTIC", "FAIL_CLOSED_UNCERTAIN",
      "HASH_OR_CATALOG_DRIFT", "FORBIDDEN_PAYLOAD", "BUDGET_EXCEEDED", "HTTP_500", "TIMEOUT"],
    semanticLimitation: "inventory=low_stock does not prove absence of name/status/history/threshold modifiers. Oracle completeness is evaluation-only, never a runtime guard.",
    prohibited: ["new classifiers", "policy expansion", "runtime router", "mutation execution", "backend/database", "OpenAI", "Luna fallback"] };
}
