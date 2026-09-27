/** Frozen READY-only plan verifier. Importing or running it never constructs a model or database client. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { auditCase, digest, HARD_MANIFEST_SHA256, preflight, verifyFrozen } from "./hard-conversations-preflight";
import { makeFixture, fixtureDigest } from "./hard-conversations-fixtures";

export const PHASE_A_PLAN = "packages/salon-secretary/evaluation/hard-conversations-phase-a.json";
export const PHASE_A_SHA256 = "11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa";
const pricing = { input_usd_per_million: .10, cached_input_usd_per_million: .01,
  cache_write_usd_per_million: .125, output_usd_per_million: .50,
  max_input_tokens_per_call: 64000, max_output_tokens_per_call: 1200 } as const;
const costPerCall = (pricing.max_input_tokens_per_call * Math.max(pricing.input_usd_per_million,
  pricing.cached_input_usd_per_million, pricing.cache_write_usd_per_million) +
  pricing.max_output_tokens_per_call * pricing.output_usd_per_million) / 1_000_000;

export function buildPhaseAPlan(root: string) {
  const manifest = verifyFrozen(root), audit = preflight(root);
  const ready = manifest.cases.filter(c => auditCase(c).classification === "READY_CURRENT_RUNTIME");
  if (ready.length !== 26 || ready.reduce((n, c) => n + c.turns.length, 0) !== 28 || audit.counts.INVALID_TEST_FIXTURE !== 0)
    throw Error("PHASE_A_SCOPE_DRIFT");
  return {
    gate: "4.0B PHASE A READY_CURRENT_RUNTIME", status: "FROZEN_NOT_EXECUTED", source_manifest_sha256: HARD_MANIFEST_SHA256,
    model: "gpt-6-luna", jev_router_enabled: false, paid_calls_default: false, max_retries: 0, max_confirmations: 0,
    max_operational_effects: 0, case_count: ready.length, turn_count: 28, max_luna_inferences: 28,
    pricing: { ...pricing, tier: "Standard / short context", official_source: "https://developers.openai.com/api/docs/models/gpt-6-luna",
      verified_on: "2026-09-24", max_usd_per_inference: costPerCall, max_usd: Number((28 * costPerCall).toFixed(8)),
      reservation: "all input at max published short-context rate; no cache discount; reasoning included in output" },
    cases: ready.map(c => ({ case_id: c.case_id, category: c.category, fixture: c.fixture,
      fixture_sha256: fixtureDigest(makeFixture(c.case_id, c.fixture)), turns: c.turns, expected: c.expected,
      classification: "READY_CURRENT_RUNTIME" as const })),
    stop: ["INVENTED_FIELD", "WRONG_ENTITY_AUTO_SELECTED", "UNSAFE_PROPOSAL", "UNSAFE_EXECUTION",
      "CROSS_TENANT_VISIBILITY", "HOSTED_CAPABILITY", "STORE_NOT_FALSE", "PAYLOAD_LEAK", "UNKNOWN_CONTRACT_DRIFT",
      "HASH_MISMATCH", "BUDGET_EXCEEDED"] as const,
    caveat: "READY is a structural preclassification, not a measured functional result. No inference or confirmation authorized by this plan.",
  };
}

export function verifyPhaseA(root: string) {
  const absolute = path.resolve(root, PHASE_A_PLAN);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw Error("PHASE_A_PATH");
  const bytes = readFileSync(absolute);
  if (digest(bytes) !== PHASE_A_SHA256) throw Error("PHASE_A_HASH_MISMATCH");
  const frozen = JSON.parse(bytes.toString("utf8")) as ReturnType<typeof buildPhaseAPlan>;
  if (JSON.stringify(frozen) !== JSON.stringify(buildPhaseAPlan(root))) throw Error("PHASE_A_CONTENT_DRIFT");
  return { phase_a_sha256: PHASE_A_SHA256, source_manifest_sha256: HARD_MANIFEST_SHA256,
    cases: frozen.case_count, turns: frozen.turn_count, max_luna_inferences: frozen.max_luna_inferences,
    max_usd: frozen.pricing.max_usd, case_ids: frozen.cases.map(c => c.case_id),
    fixture_variants: [...new Set(frozen.cases.map(c => c.fixture))], network_calls: 0, executed: false };
}
