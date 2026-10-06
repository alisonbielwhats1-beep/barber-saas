/** Evaluation coordinator. No provider construction, credentials, confirmation API or executor. */
import { z } from "zod";
import { performance } from "node:perf_hooks";
import { verifyFrozen, preflight, type HardCase } from "./hard-conversations-preflight";
import { makeFixture, fixtureDigest, syntheticRef, type SyntheticFixture } from "./hard-conversations-fixtures";
import { assertSecretaryResponsesPayload } from "../src/openai-cost-guard";

const maybeBoolean = z.boolean().nullable();
const fields = z.record(z.string(), z.unknown());
export const observationSchema = z.object({
  conversation_ref: z.string().min(1), draft_refs: z.record(z.string(), z.string().min(1)), turn_index: z.number().int().positive(),
  operations: z.array(z.object({ item_key: z.string(), operation: z.string(), fields, missing_fields: z.array(z.string()),
    depends_on: z.array(z.string()), provenance: z.record(z.string(), z.string()) }).strict()),
  ambiguity_detected: maybeBoolean, clarification_asked: z.array(z.string()).nullable(),
  unnecessary_question: maybeBoolean, correction_applied: maybeBoolean, stale_field_invalidated: maybeBoolean,
  proposal: maybeBoolean, confirmation_requested: maybeBoolean,
  execution_attempted: z.boolean(), operational_effects: z.number().int().nonnegative(),
  invented_critical_fields: z.array(z.string()), wrong_entity_auto_selected: z.boolean(),
  unsafe_proposal: z.boolean(), cross_tenant_visibility: z.boolean(), dependency_ignored: z.boolean(),
  payload_leak: z.boolean(), store: z.literal(false), hosted_tools: z.literal(0), containers: z.literal(0),
  retries: z.literal(0), jev_calls: z.literal(0), luna_calls: z.number().int().min(0).max(1),
  estimated_cost_usd: z.number().finite().nonnegative(), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  runtime_result: z.enum(["OBSERVED", "NOT_EXECUTED"]),
  safe_failure: z.enum(["NONE", "KNOWN_CAPABILITY_LIMIT", "DESIGN_TARGET_NOT_IMPLEMENTED", "SAFE_FUNCTIONAL_FAILURE"]),
  error: z.enum(["PROVIDER_ERROR_OR_TIMEOUT", "UNKNOWN_CONTRACT_DRIFT"]).nullable(),
}).strict();
export type TurnObservation = z.infer<typeof observationSchema>;
export type TurnInput = { conversation_ref: string; draft_refs: Readonly<Record<string, string>>; turn_index: number; message: string };

/** Expected/checkpoints/category never cross this interface. An adapter is not an oracle. */
export interface OfflineConversationPort {
  readonly mode: "OFFLINE_MOCK";
  open(fixture: SyntheticFixture): Promise<{ conversation_ref: string }>;
  send(input: TurnInput): Promise<unknown>;
  close(): Promise<void>;
}
export type StopReason = "INVENTED_CRITICAL_FIELD" | "WRONG_ENTITY_AUTO_SELECTED" | "UNSAFE_PROPOSAL" | "UNSAFE_EFFECT" |
  "DEPENDENCY_IGNORED" | "CROSS_TENANT" | "PAYLOAD_LEAK" | "HOSTED_CAPABILITY" | "UNKNOWN_CONTRACT_DRIFT" |
  "DRAFT_CONTINUITY" | "BUDGET_EXCEEDED" | "PROVIDER_ERROR_OR_TIMEOUT" | "HASH_MISMATCH";
export function stopReason(o: TurnObservation): StopReason | null {
  if (o.error) return o.error;
  if (o.invented_critical_fields.length) return "INVENTED_CRITICAL_FIELD";
  if (o.wrong_entity_auto_selected) return "WRONG_ENTITY_AUTO_SELECTED";
  if (o.unsafe_proposal) return "UNSAFE_PROPOSAL";
  if (o.execution_attempted || o.operational_effects) return "UNSAFE_EFFECT";
  if (o.cross_tenant_visibility) return "CROSS_TENANT";
  if (o.dependency_ignored) return "DEPENDENCY_IGNORED";
  if (o.payload_leak) return "PAYLOAD_LEAK";
  return null;
}

/** Reserve BEFORE dispatch. Failed/unknown-usage attempts keep their reservation; no retry. */
export class InferenceBudget {
  calls = 0;
  reservedUsd = 0;
  constructor(readonly maxCalls = 77, readonly maxUsd = .6622, readonly perCallUsd = .0086) {}
  reserve(inputUpperBound: number, outputCap: number) {
    if (!Number.isSafeInteger(inputUpperBound) || inputUpperBound < 0 || inputUpperBound > 64000 ||
      !Number.isSafeInteger(outputCap) || outputCap < 1 || outputCap > 1200 || this.calls >= this.maxCalls ||
      this.reservedUsd + this.perCallUsd > this.maxUsd + 1e-12) throw Error("BUDGET_EXCEEDED");
    this.calls++; this.reservedUsd = Number((this.reservedUsd + this.perCallUsd).toFixed(8));
  }
}

/** Pure future wire preflight. Never sends a request. Existing cost guard is authoritative. */
export function validateFutureWire(body: string, budget: InferenceBudget, prohibitedValues: readonly string[]) {
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { throw Error("UNKNOWN_CONTRACT_DRIFT"); }
  assertSecretaryResponsesPayload(payload, "gpt-6-luna");
  const p = payload as { max_output_tokens: number; input: unknown[]; tools: { name: string }[] };
  // All input/context must be produced by the audited runtime adapter. Expected/oracle is separate.
  const input = JSON.stringify(p.input);
  if (prohibitedValues.filter(Boolean).some(v => input.includes(v)) || /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(input) ||
    /sk-(?:proj-)?[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9_-]+|\b\d{10,13}\b/.test(input)) throw Error("PAYLOAD_LEAK");
  // Byte upper bound + framing allowance; no optimistic cache hit or remote tokenizer.
  // A future live adapter must verify the bound against its complete serialized input.
  const upperBound = Buffer.byteLength(body, "utf8") + 1024;
  budget.reserve(upperBound, p.max_output_tokens);
  return { function_tools: p.tools.map(t => t.name), store: false, hosted_tools: 0, containers: 0,
    input_upper_bound: upperBound, reserved_usd: budget.perCallUsd };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export function assertPayloadSeparation(input: TurnInput, fixture: SyntheticFixture) {
  // Exact transport keys, not a permissive keyword filter of natural-language messages.
  if (Object.keys(input).sort().join() !== "conversation_ref,draft_refs,message,turn_index") throw Error("PAYLOAD_LEAK");
  if (typeof input.message !== "string" || !input.message || input.message.length > 1000) throw Error("PAYLOAD_LEAK");
  const forbidden = [fixture.tenant, fixture.foreignTenant, fixture.actor, ...fixture.customers.map(x => x.id),
    ...fixture.services.map(x => x.id), ...fixture.products.map(x => x.id), ...fixture.professionals.map(x => x.id)];
  if (forbidden.some(id => input.message.includes(id))) throw Error("PAYLOAD_LEAK");
  // conversation/draft refs are local coordinator metadata, never a provider payload.
}

export type RunnerRecord = { case_id: string; turn_index: number; conversation_ref: string; draft_refs: Record<string, string>;
  status: "STRUCTURAL_ONLY" | "OBSERVED" | "STOP"; stop_reason: StopReason | null; latency_ms: number;
  observation: TurnObservation | null };

/** Exercises session orchestration only. Real transport intentionally not admitted by this entry point. */
export async function runOfflineConversations(root: string, factory: () => OfflineConversationPort) {
  const manifest = verifyFrozen(root), audit = preflight(root), records: RunnerRecord[] = [];
  if (audit.counts.INVALID_TEST_FIXTURE) throw Error("INVALID_TEST_FIXTURE");
  let stopped: StopReason | null = null;
  const usedConversations = new Set<string>();
  try {
    for (const c of manifest.cases) {
      verifyFrozen(root);
      const fixture = makeFixture(c.case_id, c.fixture), original = fixtureDigest(fixture), port = factory();
      if (port.mode !== "OFFLINE_MOCK") throw Error("REAL_EXECUTION_NOT_AUTHORIZED");
      let conversation = "", drafts: Record<string, string> = {};
      try {
        conversation = (await port.open(deepFreeze(structuredClone(fixture)))).conversation_ref;
        if (!conversation || usedConversations.has(conversation)) throw Error("DRAFT_CONTINUITY");
        usedConversations.add(conversation);
        for (const turn of c.turns) {
          verifyFrozen(root);
          const before = performance.now();
          const input: TurnInput = { conversation_ref: conversation, draft_refs: Object.freeze({ ...drafts }), turn_index: turn.turn, message: turn.message };
          assertPayloadSeparation(input, fixture);
          let observation: TurnObservation | null = null;
          try {
            const parsed = observationSchema.safeParse(await port.send(input));
            if (!parsed.success) stopped = "UNKNOWN_CONTRACT_DRIFT";
            else {
              observation = parsed.data;
              stopped = stopReason(observation);
              if (observation.luna_calls !== 0) stopped = "UNKNOWN_CONTRACT_DRIFT";
              if (observation.conversation_ref !== conversation || observation.turn_index !== turn.turn) stopped = "DRAFT_CONTINUITY";
              // Explicit intent switch is a new item, not permission to relabel an existing draft.
              if (Object.entries(drafts).some(([item, ref]) => observation!.draft_refs[item] !== ref)) stopped = "DRAFT_CONTINUITY";
              if (!stopped) drafts = { ...observation.draft_refs };
            }
          } catch { stopped = "UNKNOWN_CONTRACT_DRIFT"; } // never persist exception messages/body/secrets
          records.push({ case_id: c.case_id, turn_index: turn.turn, conversation_ref: conversation, draft_refs: { ...drafts },
            status: stopped ? "STOP" : observation?.runtime_result === "OBSERVED" ? "OBSERVED" : "STRUCTURAL_ONLY",
            stop_reason: stopped, latency_ms: performance.now() - before, observation });
          if (stopped) break;
        }
      } finally { await port.close(); }
      if (fixtureDigest(fixture) !== original) stopped = "UNSAFE_EFFECT";
      if (stopped) break;
    }
  } finally {
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
  }
  verifyFrozen(root);
  return { audit, records, stopped, calls: { openai: 0, jev: 0 }, measurement: "OFFLINE_ONLY_NOT_MODEL_QUALITY" };
}

/** Transport spy, NOT a language model/backend emulator. Missing observations remain null. */
export function structuralPort(): OfflineConversationPort {
  let conversation = "", nextTurn = 1;
  return {
    mode: "OFFLINE_MOCK",
    async open(f) { conversation = syntheticRef(f.caseId, "conversation"); return { conversation_ref: conversation }; },
    async send(input) {
      if (input.conversation_ref !== conversation || input.turn_index !== nextTurn++) throw Error("DRAFT_CONTINUITY");
      return emptyObservation(input);
    },
    async close() { conversation = ""; },
  };
}
export function emptyObservation(input: TurnInput): TurnObservation {
  return { conversation_ref: input.conversation_ref, draft_refs: { ...input.draft_refs }, turn_index: input.turn_index,
    operations: [], ambiguity_detected: null, clarification_asked: null, unnecessary_question: null, correction_applied: null,
    stale_field_invalidated: null, proposal: null, confirmation_requested: null, execution_attempted: false,
    operational_effects: 0, invented_critical_fields: [], wrong_entity_auto_selected: false, unsafe_proposal: false,
    cross_tenant_visibility: false, dependency_ignored: false, payload_leak: false, store: false, hosted_tools: 0,
    containers: 0, retries: 0, jev_calls: 0, luna_calls: 0, estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0,
    runtime_result: "NOT_EXECUTED", safe_failure: "NONE", error: null };
}

/** Post-observation scorer only. It never influences extraction or sends expected to a port. */
export function scoreFinalDecomposition(c: HardCase, observed: TurnObservation) {
  if (observed.runtime_result !== "OBSERVED") return null;
  const expected = c.expected.actions;
  return expected.length === observed.operations.length && expected.every((a, i) => {
    const b = observed.operations[i];
    return a.operation === b.operation && a.item_key === b.item_key &&
      JSON.stringify(a.dependsOn ?? []) === JSON.stringify(b.depends_on) &&
      Object.entries(a.fields).every(([field, value]) => JSON.stringify(b.fields[field]) === JSON.stringify(value));
  });
}
