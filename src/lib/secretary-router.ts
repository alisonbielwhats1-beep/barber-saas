import { validateSelection, measureServicesModel, type CapabilitySelection, type Model, type ModelCallUsage } from "@everflair/salon-secretary";
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
    return { schema_version: 1, router_path: this.path, jev_eligible: this.eligible, jev_called: this.jevCalled,
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
      operational_authority: false, retries: this.literalRepairCalls, transport_repair_calls: this.literalRepairCalls };
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
