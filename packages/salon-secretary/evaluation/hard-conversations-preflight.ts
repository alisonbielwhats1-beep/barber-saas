import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hardConversations, conversationFixtures } from "./hard-conversations";
import { reviewGraph } from "./conversational-resolution";
import { operationSkill, publishedOperation } from "../src/skill-registry";
import { getOperationRequirements } from "../../../src/lib/service-contract";
import { makeFixture, validateFixture, fixtureDigest } from "./hard-conversations-fixtures";

export const HARD_MANIFEST = "packages/salon-secretary/evaluation/hard-conversations-plan.json";
export const HARD_MANIFEST_SHA256 = "b8c4c39b9ea338dbd2cbe80b9fe9f2efeb940391109da034b11bb480cbb0076e";
export type HardCase = typeof hardConversations[number];
export type Preclassification = "READY_CURRENT_RUNTIME" | "KNOWN_CAPABILITY_LIMIT" | "DESIGN_TARGET_NOT_IMPLEMENTED" | "INVALID_TEST_FIXTURE";
export const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
type Manifest = {
  cases: HardCase[]; fixtures: typeof conversationFixtures; predecessors: Record<string, string>; frozen_files: Record<string, string>;
  max_luna_inferences: number; max_retries: number; max_confirmations: number; max_operational_effects: number;
  model: string; router_enabled: boolean; paid_calls_default: boolean;
  pricing: { input_usd_per_million: number; cached_input_usd_per_million: number; cache_write_usd_per_million: number;
    output_usd_per_million: number; max_input_tokens_per_call: number; max_output_tokens_per_call: number; estimated_max_usd: number };
};
export function verifyFrozen(root: string) {
  const bytes = readFileSync(path.join(root, HARD_MANIFEST));
  if (digest(bytes) !== HARD_MANIFEST_SHA256) throw Error("HASH_MISMATCH:MANIFEST");
  const manifest = JSON.parse(bytes.toString("utf8")) as Manifest;
  for (const [file, hash] of Object.entries({ ...manifest.predecessors, ...manifest.frozen_files })) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(path.resolve(root) + path.sep) || digest(readFileSync(absolute)) !== hash) throw Error(`HASH_MISMATCH:${file}`);
  }
  if (JSON.stringify(manifest.cases) !== JSON.stringify(hardConversations) || JSON.stringify(manifest.fixtures) !== JSON.stringify(conversationFixtures)) throw Error("FROZEN_SPEC_MISMATCH");
  if (manifest.model !== "gpt-6-luna" || manifest.router_enabled || manifest.paid_calls_default || manifest.max_luna_inferences !== 77 ||
    manifest.max_confirmations !== 0 || manifest.max_retries !== 0 || manifest.max_operational_effects !== 0) throw Error("SAFETY_CONTRACT_DRIFT");
  return manifest;
}

export function dependencySupport(c: HardCase): "SUPPORTED_CURRENTLY" | "DESIGN_TARGET" {
  if (!c.expected.actions.some(a => a.dependsOn?.length)) return "SUPPORTED_CURRENTLY";
  const [a, b] = c.expected.actions;
  return c.expected.actions.length === 2 && a.operation === "appointment.cancel" && !a.dependsOn?.length &&
    ["appointment.create", "customer.message"].includes(b.operation) && b.dependsOn?.length === 1 && b.dependsOn[0] === a.item_key
    ? "SUPPORTED_CURRENTLY" : "DESIGN_TARGET";
}
const approximateCases = new Set(["a01", "a08", "t01"]);
// Current Communication reconciliation only accepts literal EXACT content inside quotes.
// These original CURRENT_CONTRACT labels predate this runner audit; preserve the manifest,
// record a separate design/runtime divergence instead of modifying the message.
const unquotedExactCases = new Set(["i13", "m06", "d08", "m10"]);
// Explicitly audited coordinator behavior, despite conservative Gate 4.0A DESIGN_TARGET labels.
const auditedCurrentCases = new Set(["i01", "i02", "i03", "i04", "i05", "a02", "a04", "a09"]);
export function classify(c: HardCase, fixtureErrors: string[] = []): Preclassification {
  if (fixtureErrors.length) return "INVALID_TEST_FIXTURE";
  if (c.expected.actions.length > 4 || dependencySupport(c) === "DESIGN_TARGET") return "KNOWN_CAPABILITY_LIMIT";
  if (unquotedExactCases.has(c.case_id)) return "DESIGN_TARGET_NOT_IMPLEMENTED";
  return c.support === "CURRENT_CONTRACT" || auditedCurrentCases.has(c.case_id) ? "READY_CURRENT_RUNTIME" : "DESIGN_TARGET_NOT_IMPLEMENTED";
}

function requirements(operation: string) {
  // Read-only catalog operations have no draft; avoid routing them to service requirements.
  if (operation === "product.search") return { required_fields: [], query_or_low_stock_required: true };
  if (operation === "stock.balance") return { required_fields: ["product_ref"], backend_resolution: true };
  if (operation === "customer.search" || operation === "customer.read") return { required_fields: ["query_or_customer_ref"], backend_resolution: true };
  return getOperationRequirements(operation as "service.create"); // overloaded dispatcher, publishedOperation validated below
}
export function auditCase(c: HardCase) {
  if (!/^[iadtmx]\d{2}$/.test(c.case_id) || c.base_time !== conversationFixtures.baseTime || !c.turns.length) throw Error("INVALID_CASE_STRUCTURE");
  if (!Object.hasOwn(conversationFixtures.variants, c.fixture)) throw Error("UNKNOWN_FIXTURE");
  if (!c.turns.every((t, i) => t.turn === i + 1 && t.message.length > 0 && t.message.length <= 1000 && t.expected_checkpoint.length > 0)) throw Error("INVALID_TURNS");
  if (c.expected.operational_effects !== 0 || c.expected.confirmation_allowed !== false || c.expected.model_refs_allowed !== false ||
    c.expected.invented_fields !== 0 || c.expected.wrong_entity_auto_selected !== 0) throw Error("UNSAFE_EXPECTED");
  if (c.expected.actions.length) reviewGraph(c.expected.actions.map(a => ({ itemKey: a.item_key, operation: a.operation, dependsOn: a.dependsOn ?? [], independent: a.independent, state: "READY" as const })));
  const fixture = makeFixture(c.case_id, c.fixture), fixtureErrors = validateFixture(fixture);
  return {
    case_id: c.case_id, category: c.category, classification: classify(c, fixtureErrors),
    fixture: c.fixture, fixture_sha256: fixtureDigest(fixture), fixture_errors: fixtureErrors,
    turn_count: c.turns.length, action_count: c.expected.actions.length,
    linguistic_intent_count: c.case_id === "m01" ? 3 : c.expected.actions.length,
    dependency_support: dependencySupport(c),
    current_runtime_behavior: approximateCases.has(c.case_id) ? "UNIQUE_CONTAINS_CAN_AUTO_SELECT" : c.support,
    design_target: approximateCases.has(c.case_id) ? "APPROXIMATE_SINGLE_CANDIDATE_REQUIRES_CONFIRMATION" : "FROZEN_CHECKPOINTS",
    limitations: [
      ...(c.expected.actions.length > 4 ? ["REGISTRY_MAX_FOUR_ACTIONS"] : []),
      ...(dependencySupport(c) === "DESIGN_TARGET" ? ["ONLY_CANCEL_CREATE_OR_CANCEL_MESSAGE_DEPENDENCY"] : []),
      ...(approximateCases.has(c.case_id) ? ["UNCONFIRMED_APPROXIMATION_IS_NOT_AUTHORITY"] : []),
      ...(unquotedExactCases.has(c.case_id) ? ["EXACT_UNQUOTED_CONTENT_REVIEW_REQUIRED_BY_CURRENT_RUNTIME"] : []),
      ...(c.support === "DESIGN_TARGET" && !auditedCurrentCases.has(c.case_id) ? ["FULL_DESIGN_CHECKPOINT_NOT_IMPLEMENTED_OR_NOT_ESTABLISHED"] : []),
    ],
    operations: c.expected.actions.map(a => {
      publishedOperation.parse(a.operation);
      return { item_key: a.item_key, operation: a.operation, skill: operationSkill(a.operation), fields: a.fields,
        requirements: requirements(a.operation), depends_on: a.dependsOn ?? [], independent: a.independent,
        confirmation_required: ["service.create", "service.change", "customer.create", "customer.change", "appointment.create", "appointment.change", "appointment.cancel", "schedule.block", "stock.movement", "customer.message"].includes(a.operation), confirmation_allowed: false };
    }),
    minimum_clarification_fields: c.expected.minimum_clarification_fields,
    // Never forward this analysis object to a runtime/model.
    turns: c.turns.map(t => ({ turn_index: t.turn, message: t.message, expected_checkpoint: t.expected_checkpoint, observation: "NOT_EXECUTED" })),
  };
}

export function preflight(root: string) {
  const manifest = verifyFrozen(root), rows = manifest.cases.map(auditCase);
  const categories = Object.fromEntries(["INCOMPLETE", "AMBIGUITY", "CONFLICT", "CONTINUATION", "MULTI_ACTION", "ADVERSARIAL"].map(k => [k, rows.filter(r => r.category === k).length]));
  if (JSON.stringify(Object.values(categories)) !== JSON.stringify([15, 10, 10, 10, 10, 5]) || rows.length !== 60 ||
    new Set(rows.map(r => r.case_id)).size !== 60 || rows.reduce((n, r) => n + r.turn_count, 0) !== 77) throw Error("DATASET_COUNTS");
  const counts = Object.fromEntries((["READY_CURRENT_RUNTIME", "KNOWN_CAPABILITY_LIMIT", "DESIGN_TARGET_NOT_IMPLEMENTED", "INVALID_TEST_FIXTURE"] as const).map(k => [k, rows.filter(r => r.classification === k).length]));
  const p = manifest.pricing;
  const perCall = (p.max_input_tokens_per_call * Math.max(p.input_usd_per_million, p.cached_input_usd_per_million, p.cache_write_usd_per_million) + p.max_output_tokens_per_call * p.output_usd_per_million) / 1e6;
  const ceiling = Number((perCall * 77).toFixed(8));
  if (ceiling > p.estimated_max_usd) throw Error("BUDGET_EXCEEDED");
  return { mode: "OFFLINE_STRUCTURAL_DRY_RUN", manifest_sha256: HARD_MANIFEST_SHA256,
    protected_files_verified: Object.keys(manifest.predecessors).length + Object.keys(manifest.frozen_files).length,
    cases_validated: 60, turns_validated: 77, categories, counts,
    functional_model_results: "NOT_MEASURED", current_runtime_results: "SEPARATE_MOCK_PROBES_ONLY",
    real_execution_ready: false,
    real_execution_blockers: ["CURRENT_RUNTIME_ADAPTER_MUST_HAVE_COMPLETE_INDEPENDENT_TURN_ORACLE", "OFFICIAL_PRICING_REVERIFY_BEFORE_NETWORK", "NEW_USER_AUTHORIZATION_REQUIRED"],
    max_inferences: 77, max_cost_usd_conditional: ceiling, max_cost_per_inference_usd: perCall,
    cache_assumption: "NO_DISCOUNT; ALL_INPUT_AT_MAX_PUBLISHED_PLANNING_RATE", pricing_status: "HISTORICAL_NOT_RECONFIRMED",
    database_calls: 0, openai_calls: 0, jev_calls: 0, confirmations: 0, rows };
}
