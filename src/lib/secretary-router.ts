import { validateSelection, measureServicesModel, selectionSchemaV2, communicationInterpretation, financialInterpretation, inventoryInterpretation, REQUEST_DEGRADATIONS,
  type CapabilitySelection, type Model, type ModelCallUsage, type RequestBudgetTelemetry, type RequestDegradation } from "@everflair/salon-secretary";
import { assessJevAcceptance, initialAllowlist, ACCEPTANCE_POLICY_VERSION, type AcceptanceVerdict } from "../../packages/salon-secretary/evaluation/acceptance-policy";
import { DerivedJevProvider } from "../../packages/salon-secretary/evaluation/derived-provider";
import { derivedRequest, DERIVED_PLAN_VERSION } from "../../packages/salon-secretary/evaluation/derived-plan";
import { JEV_ENDPOINT } from "../../packages/salon-secretary/evaluation/jev-provider";
import { derivationCatalog, derivationCatalogHash, type Derivation } from "../../packages/salon-secretary/evaluation/derivation-catalog";
import { createHash } from "node:crypto";

/** Audited V1 enrollment/catalog fingerprints. A later evaluation expansion cannot activate itself. */
export function routerV1Integrity() {
  return ACCEPTANCE_POLICY_VERSION === "jev-acceptance-v1" && DERIVED_PLAN_VERSION === "derived-v3" &&
    derivationCatalog.version === "decision-derivations-v1" &&
    derivationCatalogHash(derivationCatalog) === "0300667615177bf9d96bb9c96a9f055ff99041db111b0e9fb78e48f407434791" &&
    createHash("sha256").update(JSON.stringify(initialAllowlist)).digest("hex") === "e7ca7f2e3aa8c6753f9808484558ac8ab16255e3edcbba7303448302b350f70a";
}

export type RouterOptions = {
  enabled?: () => boolean;
  paidCallsAllowed?: () => boolean;
  credential?: () => string | undefined;
  transport?: typeof fetch;
};
export type RouterPath = "FAST_PATH" | "JEV_ACCEPTED" | "JEV_FALLBACK_LUNA" | "DIRECT_LUNA";
type Usage = Pick<ModelCallUsage, "model_id_requested" | "model_id_returned" | "status" | "input_tokens" | "cached_input_tokens" | "cache_write_tokens" | "output_tokens" | "reasoning_tokens" | "total_tokens">;

/** An estimate, never a wallet debit. Missing counters and rollback pricing remain unknown.
 * Standard short-context GPT-6 rates already audited in Gate 3.1B (2026-09-22).
 * Reasoning is included in output; absent cache-write is NOT fabricated as zero. */
export function routerLunaCost(usage: Usage): number | null {
  const { input_tokens: input, cached_input_tokens: cached, cache_write_tokens: write, output_tokens: output } = usage;
  if (usage.model_id_requested !== "gpt-6-luna" || usage.model_id_returned !== "gpt-6-luna" ||
      [input, cached, write, output].some(v => v === null || !Number.isSafeInteger(v) || v < 0) ||
      input! > 272_000 || cached! + write! > input!) return null;
  return ((input! - cached! - write!) * 0.10 + cached! * 0.01 + write! * 0.125 + output! * 0.50) / 1_000_000;
}

/** NOT_UNDERSTOOD (B5): the model's answer could not be read and an active plan was kept unchanged. */
export type TurnOutcomeKind = "PROPOSAL_READY" | "QUESTION" | "CONVERSATION" | "UNSUPPORTED" | "READ_RESULT" | "DONE" | "DISCARDED" | "NOT_UNDERSTOOD" | "LOST_TURN" | "ERROR";
/** Codes/counts only: field names from a closed vocabulary, keyed hashes of questions, whitelisted codes. */
export type TurnOutcome = { kind: TurnOutcomeKind; groups_ready: number; groups_total: number;
  open_question_fields: string[]; question_fingerprints: string[]; repeated_question_count: number;
  divergence: { luna_operations: number; plan_actions: number; dropped_fields: string[]; failed_codes: string[] };
  repairs: number; error_code: string | null;
  /** C1 components: per-field agreement of the historical grammar and the component proof (present only when computed). */
  temporal_shadow?: TemporalShadow[];
  /** C2 few-shot examples of this message's interpretation requests (present only with SALON_SECRETARY_EXAMPLES on):
   * mode, requests carrying a block, examples and request bytes added (summed), eligible examples (max), bank ids. */
  examples_mode?: "selected" | "full"; examples_requests?: number; examples_count?: number; examples_bytes?: number; examples_eligible?: number; examples_ids?: string[];
  /** C3 names: whether a customer/professional name Luna emitted is written in the message (booleans only), and how the
   * backend resolved each entity lookup (closed outcome codes and counts). Present only when something was checked. */
  name_checks?: NameCheck[]; name_resolution?: NameResolution[];
  /** DISCARD: actions of the active plan the owner gave up in this message (present only when > 0). */
  discarded_actions?: number;
  /** B5: operations left out of a partially accepted interpretation (their codes are in failed_codes). */
  rejected_operations?: number;
  /** C6 (rec 19): secretaryContractVersion() of this message (sha256 hex of prompt templates, wire, model, limits, flags). */
  contract_version?: string;
  /** Request budget (present only when a request of this message did not fit the cap as configured): requests
   * degraded or refused, the degradation codes applied, and the largest request bytes before/after (counts only). */
  request_budget?: RequestBudgetOutcome;
  /** C5 agent (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §6.4): present only when the agent path ran for this
   * message. Codes and numbers only. */
  agent?: AgentTurnOutcome };
/** C5 agent telemetry of one message (§6.4): its path (AGENT, or the C4 with/without an agent call before), the loop's calls and lookups,
 * the validator's per-action effects and codes, the backend premises shown and Luna's notes dropped. Never a name, a quote or a text. */
export type AgentTurnOutcome = { path: "AGENT" | "C4_FALLBACK" | "C4_SKIPPED"; rounds: number; lookup_calls: number; lookup_kinds: string[]; rows: number; output_bytes: number;
  truncated: boolean; fallback_code: string | null; validator: { accepted: number; name_fallback: number; carded: number; asked: number; dropped: number; codes: string[] };
  question_field: string | null; premises_backend: number; premise_note_dropped: number; uncovered: number; actions_left: number; locate_disagree: number; effort: string | null };
const agentPaths = new Set(["AGENT", "C4_FALLBACK", "C4_SKIPPED"]), lookupKinds = new Set(["T1", "T2", "T3", "T4", "T5"]);
/** §6.4: the agent block through the same whitelist discipline as the rest of the outcome (closed values, counts, stable codes). */
function safeAgent(agent: AgentTurnOutcome): AgentTurnOutcome | undefined {
  if (!agent || !agentPaths.has(agent.path)) return undefined;
  const count = (value: number) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
  const code = (value: string | null) => typeof value === "string" && stableCode.test(value) ? value : null;
  const v = agent.validator ?? { accepted: 0, name_fallback: 0, carded: 0, asked: 0, dropped: 0, codes: [] };
  return { path: agent.path, rounds: count(agent.rounds), lookup_calls: count(agent.lookup_calls), lookup_kinds: (agent.lookup_kinds ?? []).filter(kind => lookupKinds.has(kind)).slice(0, 6),
    rows: count(agent.rows), output_bytes: count(agent.output_bytes), truncated: agent.truncated === true, fallback_code: code(agent.fallback_code),
    validator: { accepted: count(v.accepted), name_fallback: count(v.name_fallback), carded: count(v.carded), asked: count(v.asked), dropped: count(v.dropped),
      codes: [...new Set((v.codes ?? []).filter(item => stableCode.test(item)))].slice(0, 32) },
    question_field: agent.question_field === null ? null : outcomeField(agent.question_field), premises_backend: count(agent.premises_backend),
    premise_note_dropped: count(agent.premise_note_dropped), uncovered: count(agent.uncovered), actions_left: count(agent.actions_left), locate_disagree: count(agent.locate_disagree),
    effort: agent.effort === "medium" || agent.effort === "high" ? agent.effort : null };
}
export type RequestBudgetOutcome = { requests: number; rejected: number; steps: RequestDegradation[]; initial_bytes: number; final_bytes: number };
const degradationCodes = new Set<string>(REQUEST_DEGRADATIONS);
/** C7 `directory_proof` (present only when true): a directory name Luna expanded from the owner's words was proven by
 * the exact-token subset rule; role "service" appears only for that proof of a service name. */
export type NameCheck = { role: "customer" | "professional" | "service"; in_message: boolean; option_echo: boolean; directory_proof?: true };
// ALIAS (D1, SALON_SECRETARY_NAME_ALIASES): a learned alias proposed the entity (one option to confirm; never a resolution).
export const NAME_RESOLUTION_OUTCOMES = ["MATCH", "AMBIGUOUS", "TOO_MANY", "NO_MATCH", "SUGGEST", "DETAIL", "CONFIRM", "NOT_ELIGIBLE", "ALIAS"] as const;
export type NameResolution = { kind: "customer" | "service" | "professional"; outcome: (typeof NAME_RESOLUTION_OUTCOMES)[number]; n: number };
const nameRoles = new Set(["customer", "professional", "service"]), nameKinds = new Set(["customer", "service", "professional"]), nameOutcomes = new Set<string>(NAME_RESOLUTION_OUTCOMES);
const nameCheck = (entry: NameCheck): NameCheck | undefined => nameRoles.has(entry?.role) ? { role: entry.role, in_message: entry.in_message === true, option_echo: entry.option_echo === true,
  ...(entry.directory_proof === true ? { directory_proof: true as const } : {}) } : undefined;
const nameResolution = (entry: NameResolution): NameResolution | undefined => nameKinds.has(entry?.kind) && nameOutcomes.has(entry.outcome) ?
  { kind: entry.kind, outcome: entry.outcome, n: Number.isSafeInteger(entry.n) && entry.n >= 0 ? Math.min(entry.n, 1000) : 0 } : undefined;
/** equal: null when the historical grammar had no value to compare for the role. */
export type TemporalShadow = { field: string; legacy: string; components: string; equal: boolean | null };
const shadowEqual = (value: unknown) => value === null ? null : value === true;
export type ExamplesTrace = { mode: "selected" | "full"; count: number; bytes: number; eligible: number; ids: string[] };
const exampleId = /^[SMR]\d{3}$/;
const temporalRoles = new Set(["date", "source_date", "end_date", "time", "source_time", "end_time"]);
const outcomeKinds = new Set<string>(["PROPOSAL_READY", "QUESTION", "CONVERSATION", "UNSUPPORTED", "READ_RESULT", "DONE", "DISCARDED", "NOT_UNDERSTOOD", "LOST_TURN", "ERROR"]);
const stableCode = /^[A-Z][A-Z0-9_]{1,79}$/;
/** Same whitelist as the Server Action log: exception text may carry provider or customer data.
 * A non-code message falls back to its error class (ZodError -> ZOD_ERROR), never to the text. */
export function outcomeCode(error: unknown) {
  const code = error instanceof Error ? error.message : "", name = error instanceof Error ? error.name : "";
  if (stableCode.test(code)) return code;
  return name !== "Error" && /^[A-Z][A-Za-z]{0,40}Error$/.test(name) ? name.replace(/(?<=[a-z])(?=[A-Z])/g, "_").toUpperCase() : "UNCLASSIFIED_ERROR";
}
// Backend clarification names (conversational-presentation) and backend-only refs.
const clarificationFields = ["service", "customer", "professional", "appointment", "recipient", "end", "time", "date", "duration", "price",
  "target", "name", "phone", "email", "product", "quantity", "mode", "period", "reason", "content", "channel", "originalDate", "originalTime",
  "endDate", "selection", "details", "overrideReason", "overrideConsent", "destination", "request", "service_ref", "customer_ref",
  "professional_ref", "appointment_ref", "product_ref", "other"];
let fieldVocabulary: ReadonlySet<string> | undefined;
/** Closed vocabulary. Anything else (an item_key, a literal, a name) is reported only as "other". */
export function outcomeField(field: string) {
  fieldVocabulary ??= new Set([...Object.keys(selectionSchemaV2.shape.operations.element.shape),
    ...Object.entries({ communication: communicationInterpretation, financial: financialInterpretation, inventory: inventoryInterpretation })
      .flatMap(([parent, schema]) => Object.keys(schema.shape).flatMap(key => [key, `${parent}.${key}`])), ...clarificationFields]);
  return fieldVocabulary.has(field) ? field : "other";
}
/** Last boundary before persistence: a malformed outcome is dropped, never allowed to break the router row. */
function safeOutcome(outcome: TurnOutcome | null): TurnOutcome | null {
  try {
    if (!outcome || !outcomeKinds.has(outcome.kind)) return null;
    const count = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const fields = (list: readonly string[]) => [...new Set(list.map(outcomeField))].slice(0, 32);
    const codes = (list: readonly string[]) => [...new Set(list.filter(code => stableCode.test(code)))].slice(0, 32);
    const { divergence: d } = outcome;
    return { kind: outcome.kind, groups_ready: count(outcome.groups_ready), groups_total: count(outcome.groups_total),
      open_question_fields: fields(outcome.open_question_fields),
      question_fingerprints: [...new Set(outcome.question_fingerprints.filter(f => /^[0-9a-f]{64}$/.test(f)))].slice(0, 32),
      repeated_question_count: count(outcome.repeated_question_count),
      divergence: { luna_operations: count(d.luna_operations), plan_actions: count(d.plan_actions), dropped_fields: fields(d.dropped_fields), failed_codes: codes(d.failed_codes) },
      repairs: count(outcome.repairs), error_code: outcome.error_code === null ? null : stableCode.test(outcome.error_code) ? outcome.error_code : "UNCLASSIFIED_ERROR",
      ...(outcome.temporal_shadow?.length ? { temporal_shadow: outcome.temporal_shadow.filter(entry => temporalRoles.has(entry.field) &&
        stableCode.test(entry.legacy) && stableCode.test(entry.components)).slice(0, 32)
        .map(entry => ({ field: entry.field, legacy: entry.legacy, components: entry.components, equal: shadowEqual(entry.equal) })) } : {}),
      ...(outcome.examples_mode === "selected" || outcome.examples_mode === "full" ? { examples_mode: outcome.examples_mode, examples_requests: count(outcome.examples_requests ?? 0),
        examples_count: count(outcome.examples_count ?? 0), examples_bytes: count(outcome.examples_bytes ?? 0), examples_eligible: count(outcome.examples_eligible ?? 0),
        examples_ids: [...new Set((outcome.examples_ids ?? []).filter(id => exampleId.test(id)))].slice(0, 32) } : {}),
      ...(outcome.name_checks?.length ? { name_checks: outcome.name_checks.flatMap(entry => nameCheck(entry) ?? []).slice(0, 16) } : {}),
      ...(outcome.name_resolution?.length ? { name_resolution: outcome.name_resolution.flatMap(entry => nameResolution(entry) ?? []).slice(0, 16) } : {}),
      ...(count(outcome.discarded_actions ?? 0) ? { discarded_actions: count(outcome.discarded_actions ?? 0) } : {}),
      ...(count(outcome.rejected_operations ?? 0) ? { rejected_operations: count(outcome.rejected_operations ?? 0) } : {}),
      ...(typeof outcome.contract_version === "string" && /^[0-9a-f]{64}$/.test(outcome.contract_version) ? { contract_version: outcome.contract_version } : {}),
      ...(outcome.request_budget && count(outcome.request_budget.requests) ? { request_budget: { requests: count(outcome.request_budget.requests), rejected: count(outcome.request_budget.rejected),
        steps: [...new Set((outcome.request_budget.steps ?? []).filter(step => degradationCodes.has(step)))], initial_bytes: count(outcome.request_budget.initial_bytes),
        final_bytes: count(outcome.request_budget.final_bytes) } } : {}),
      ...(outcome.agent && safeAgent(outcome.agent) ? { agent: safeAgent(outcome.agent)! } : {}) };
  } catch { return null; }
}

/** Per-message, no text/IDs/errors/provider bodies. Nested draft continuations share one trace. */
export class RouterTrace {
  readonly started = performance.now();
  path: RouterPath = "DIRECT_LUNA";
  eligible = false;
  jevCalled = false;
  jevHttpCalls = 0;
  policy: AcceptanceVerdict["decision"] | null = null;
  policyReason: AcceptanceVerdict["reason"] | null = null;
  reason = "NOT_ELIGIBLE";
  jevMs = 0;
  lunaMs = 0;
  interpretationMs: number | null = null;
  providerInvalid = false;
  timeout = false;
  wireRejected = false;
  jevUsage: { inputTokens: number | null; outputTokens: number | null } | null = null;
  jevCost: number | null = 0;
  lunaUsage: (Usage & Pick<ModelCallUsage, 'attempt' | 'purpose'>)[] = [];
  literalRepairCalls = 0;
  provenance: Record<string, string> = { domain: "BACKEND" };
  derivations: Omit<Derivation, "evidence">[] = [];
  jevStages: { stage: string; latency_ms: number; input_tokens: number | null; output_tokens: number | null; estimated_cost_usd: number | null }[] = [];
  confidence: AcceptanceVerdict["confidenceData"] = [];
  /** Set once per outer message by the Secretary; divergence counters accumulate across nested continuations. */
  outcome: TurnOutcome | null = null;
  lunaOperations = 0;
  /** DISCARD: plan actions withdrawn during this message (a count only). */
  discardedActions = 0;
  /** B5: operations left out of a partially accepted interpretation (count; codes in failedCodes), and
   * whether the model's answer could not be read while an active plan was kept (NOT_UNDERSTOOD). */
  rejectedOperations = 0;
  unreadTurn = false;
  /** C5 agent (flag SALON_SECRETARY_AGENT): this message's agent block (§6.4), set once by the Secretary; null on the C4 path. */
  agent: AgentTurnOutcome | null = null;
  readonly droppedFields = new Set<string>();
  readonly failedCodes = new Set<string>();
  readonly temporalShadow: TemporalShadow[] = [];
  readonly examplesSeen: ExamplesTrace[] = [];
  /** Requests of this message that did not fit the cap as configured (degraded or refused): codes and counts only. */
  readonly budgetSeen: RequestBudgetTelemetry[] = [];
  readonly nameChecks: NameCheck[] = [];
  readonly nameResolutions: NameResolution[] = [];
  interpreted(operations: number) { this.lunaOperations += operations; }
  discard(actions: number) { if (Number.isSafeInteger(actions) && actions > 0) this.discardedActions += actions; }
  rejected(codes: readonly string[]) { this.failed(...codes); this.rejectedOperations += codes.length; }
  unread(code: string) { this.failed(code); this.unreadTurn = true; }
  /** C3: codes/booleans only; never the name or the message. */
  names(entry: { check?: NameCheck; resolution?: NameResolution }) {
    const check = entry.check && nameCheck(entry.check), resolution = entry.resolution && nameResolution(entry.resolution);
    if (check && this.nameChecks.length < 16) this.nameChecks.push(check);
    if (resolution && this.nameResolutions.length < 16) this.nameResolutions.push(resolution);
  }
  /** C2: one row per interpretation request that carried a few-shot block (codes, counts and bank ids only). */
  examples(entry: ExamplesTrace) {
    if (this.examplesSeen.length < 8 && (entry.mode === "selected" || entry.mode === "full"))
      this.examplesSeen.push({ mode: entry.mode, count: entry.count, bytes: entry.bytes, eligible: entry.eligible, ids: entry.ids.filter(id => exampleId.test(id)).slice(0, 8) });
  }
  /** Request budget: one row per request degraded or refused (closed codes, byte counts). */
  requestBudget(entry: RequestBudgetTelemetry) {
    const bytes = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    if (this.budgetSeen.length < 8) this.budgetSeen.push({ steps: entry.steps.filter(step => degradationCodes.has(step)), fit: entry.fit === true,
      initial_bytes: bytes(entry.initial_bytes), final_bytes: bytes(entry.final_bytes) });
  }
  /** A request of this message was refused for its size (the reply asks to split it). */
  get requestTooLarge() { return this.budgetSeen.some(entry => !entry.fit); }
  /** Codes-only agreement rows (closed role names, stable codes); never text or values. */
  shadow(entries: readonly TemporalShadow[]) {
    for (const entry of entries) if (this.temporalShadow.length < 32 && temporalRoles.has(entry.field) && stableCode.test(entry.legacy) && stableCode.test(entry.components))
      this.temporalShadow.push({ field: entry.field, legacy: entry.legacy, components: entry.components, equal: shadowEqual(entry.equal) });
  }
  dropped(fields: readonly string[]) { for (const field of fields) this.droppedFields.add(outcomeField(field)); }
  failed(...codes: unknown[]) { for (const code of codes) if (typeof code === "string" && stableCode.test(code)) this.failedCodes.add(code); }
  fastPath() { this.path = "FAST_PATH"; this.reason = "FAST_PATH_PRECEDENCE"; this.provenance.interpretation = "FAST_PATH"; this.interpretationMs = 0; }
  measure(model: Model, modelId: string): Model {
    return measureServicesModel(model,modelId,(u,elapsed)=>{
          if (u.purpose === 'SOURCE_LITERAL_REPAIR') this.literalRepairCalls++;
          this.lunaMs += elapsed;
          this.lunaUsage.push({ attempt: u.attempt, purpose: u.purpose, model_id_requested: u.model_id_requested, model_id_returned: u.model_id_returned, status: u.status,
            input_tokens: u.input_tokens, cached_input_tokens: u.cached_input_tokens, cache_write_tokens: u.cache_write_tokens,
            output_tokens: u.output_tokens, reasoning_tokens: u.reasoning_tokens, total_tokens: u.total_tokens });
          this.provenance.interpretation = "LUNA";
    });
  }
  snapshot() {
    const costs = this.lunaUsage.map(routerLunaCost);
    const lunaCost = costs.some(c => c === null) ? null : costs.reduce<number>((s, c) => s + c!, 0);
    const total = performance.now() - this.started;
    return { schema_version: 2, router_path: this.path, jev_eligible: this.eligible, jev_called: this.jevCalled,
      jev_http_calls: this.jevHttpCalls, policy_result: this.policy, policy_reason: this.policyReason,
      fallback_reason: this.path === "JEV_ACCEPTED" ? null : this.reason,
      luna_called: this.lunaUsage.length > 0, luna_calls: this.lunaUsage.length,
      durations_ms: { jev: this.jevMs, luna_http: this.lunaMs, interpretation: this.interpretationMs,
        backend_and_orchestration: Math.max(0, total - Math.max(this.interpretationMs ?? 0, this.jevMs + this.lunaMs)), total },
      usage_jev: this.jevUsage, usage_luna: this.lunaUsage, jev_stages: this.jevStages,
      estimated_cost_usd: { jev: this.jevCost, openai: lunaCost, total: this.jevCost === null || lunaCost === null ? null : this.jevCost + lunaCost },
      provider_invalid: this.providerInvalid, jev_timeout: this.timeout, wire_rejected: this.wireRejected,
      provenance: this.provenance, derivations: this.derivations, confidence: this.confidence,
      backend_fields: ["tenant", "permissions", "customer_ref", "service_ref", "professional_ref", "appointment_ref", "product_ref", "absolute_period", "financial_values", "stock", "availability"],
      operational_authority: false, retries: this.literalRepairCalls, transport_repair_calls: this.literalRepairCalls,
      outcome: safeOutcome(this.outcome) };
  }
}

/** Exact enrollment, only a fresh server-owned session. No text normalization or generalization. */
export function jevEligibility(message: string, fresh: boolean, scope: string) {
  if (!fresh) return null;
  return initialAllowlist.find(e => e.message === message && (scope === "auto" || scope === e.skill)) ?? null;
}

/** Returns only a validated interpretation. The caller must still authorize and resolve in the backend. */
export async function tryJevInterpretation(message: string, fresh: boolean, scope: string, options: RouterOptions, trace: RouterTrace): Promise<CapabilitySelection | null> {
  let start: number | undefined;
  try {
    const enrollment = jevEligibility(message, fresh, scope);
    trace.eligible = enrollment !== null;
    if (options.enabled?.() !== true) { trace.reason = "ROUTER_DISABLED"; return null; }
    if (!enrollment) return null;
    if (!routerV1Integrity()) { trace.reason = "CATALOG_VERSION_MISMATCH"; trace.policy = "FALLBACK_REQUIRED"; return null; }
    if (options.paidCallsAllowed?.() !== true) { trace.reason = "PAID_CALLS_DISABLED"; return null; }
    start = performance.now();
    const input = { message, context: {} };
    // Reuse the audited adapter, plan, parser, catalog and policy unchanged. No evaluation runner/dataset imports.
    const allowedBodies = [derivedRequest(input, { kind: "discovery" }), derivedRequest(input, { kind: "detail", skill: enrollment.skill })].map(v => JSON.stringify(v));
    const provider = new DerivedJevProvider({ credential: options.credential ?? (() => undefined), maxCalls: 2,
      transport: async (url, init) => {
        if (String(url) !== JEV_ENDPOINT || init?.method !== "POST" || init.redirect !== "error" ||
            init.body !== allowedBodies[trace.jevHttpCalls] || trace.jevHttpCalls >= 2) { trace.wireRejected = true; throw Error("JEV_WIRE_NOT_ALLOWED"); }
        if (!options.transport) throw Error("JEV_UNAVAILABLE");
        trace.jevCalled = true; trace.jevHttpCalls++; trace.path = "JEV_FALLBACK_LUNA";
        return options.transport(url, init);
      } });
    const result = await provider.evaluate(input);
    trace.jevUsage = result.usage; trace.jevCost = trace.jevCalled ? result.estimatedCostUsd : 0;
    trace.jevStages = result.stages.map(s=>({stage:s.stage.kind,latency_ms:s.result.latencyMs,input_tokens:s.result.usage.inputTokens,
      output_tokens:s.result.usage.outputTokens,estimated_cost_usd:s.result.estimatedCostUsd}));
    trace.providerInvalid = result.error === "INVALID_RESPONSE";
    trace.timeout = result.error === "TIMEOUT";
    const verdict = assessJevAcceptance(input, result);
    trace.policy = verdict.decision;
    trace.policyReason = verdict.reason;
    trace.reason = trace.wireRejected ? "WIRE_NOT_ALLOWED" : result.fallbackReasons.includes("CATALOG_DRIFT") ? "CATALOG_VERSION_MISMATCH" : result.error ?? verdict.reason;
    trace.confidence = verdict.confidenceData;
    if (verdict.decision !== "ACCEPT_JEV" || !verdict.interpretation) return null;
    const d = verdict.interpretation;
    // Mechanical DTO adaptation only; operation always comes from the revalidated catalog derivation.
    const fields = d.skill === "financial" ? { financial: { metrics: [d.metric], period: d.period } } : { inventory: { low_stock: true } };
    const selection = validateSelection({ skills: [d.skill], independent: true, operations: [{ operation: d.operation,
      target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [], ...fields }] });
    trace.provenance = { ...verdict.provenance, domain: "BACKEND" };
    trace.derivations = result.derivations.map(d => ({ dimension: d.dimension, operation: d.operation, source: d.source,
      catalogVersion: d.catalogVersion, catalogHash: d.catalogHash, publicationHash:d.publicationHash }));
    trace.path = "JEV_ACCEPTED";
    return selection;
  } catch {
    trace.reason = "UNKNOWN_JEV_FAILURE"; trace.policy = "FALLBACK_REQUIRED";
    if (trace.jevCalled) trace.path = "JEV_FALLBACK_LUNA";
    return null;
  } finally { if (start !== undefined) trace.jevMs += performance.now() - start; }
}
