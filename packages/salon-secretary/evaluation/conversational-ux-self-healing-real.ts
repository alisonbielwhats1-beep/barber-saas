/** Explicitly authorized benchmark only; no mutation confirmation APIs are exposed. */
import { PrismaClient } from "@prisma/client";
import { performance } from "node:perf_hooks";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPaidModel, withSecretaryTiming, markSecretaryTiming, modelCallUsage, type Model, type ModelCallUsage } from "../src";
import { SalonSecretary, type SecretaryView } from "../../../src/lib/salon-secretary";
import { prisma } from "../../../src/lib/prisma";
import { benchmarkFixture, type BenchmarkCase } from "./multi-action-benchmark-cases";
import { scoreBenchmark, persistBenchmark } from "./multi-action-benchmark-harness";
import { DurableJournal, digest, resumeCursor } from "./hard-conversations-durable";
import { assertPhaseAEnvironment, assertPhaseADatabase, snapshotPhaseACase, comparePhaseAJournal,
  installPhaseAWriteWitness, emptyIndependentCounters } from "./hard-conversations-phase-a-db";
import { withPhaseAClock } from "./hard-conversations-phase-a-execution";
import { RuntimeObservationBridge } from "./hard-conversations-observation-bridge";
import { PhaseAOpenAIErrorObserver, observeModelGetResponse } from "./hard-conversations-openai-diagnostic";
import { inspectPostHttpResponse, witnessSdkResponse, classifyPostHttpFailure, type SafePostHttpMetadata, type PostHttpStage } from "./ultimate-10-post-http";
import { BenchmarkWireWitness, selectionDiagnostic } from "./multi-action-benchmark-wire";

import { TARGET_RESULTS as BENCHMARK_RESULTS, targetCases as benchmarkCases, targetHashes as sourceHashes, verifyFrozenTarget, precheckTarget, scoreTargetUX, canStartCompleteCase } from "./conversational-ux-self-healing-target";
import { composerMeasurement } from "./conversational-ux-timing";
const benchmarkTurnCount = 5;
const manifestPath = join(BENCHMARK_RESULTS, "real-manifest.json");
const realPath = "packages/salon-secretary/evaluation/conversational-ux-self-healing-real.ts";
const executionHashes = () => Object.fromEntries([realPath, "scripts/run-conversational-ux-self-healing.ts", "scripts/run-conversational-ux-self-healing.cjs"].map(file => [file, digest(readFileSync(file))]));
export const price = { input: .10, cached: .01, cacheWrite: .125, output: .50, per: 1_000_000,
  source: "https://developers.openai.com/api/docs/models/gpt-6-luna", checked: "2026-09-24", processing: "standard short-context" };
export function estimatedCost(u: ModelCallUsage | null) {
  if (!u || u.input_tokens === null || u.output_tokens === null || u.cached_input_tokens === null) return null;
  const remainder = u.input_tokens - u.cached_input_tokens;
  const known = u.cache_write_tokens;
  if (remainder < 0 || known !== null && known > remainder) return null;
  // Absent cache-write is unknown, not a fabricated zero: publish an interval.
  const base = u.cached_input_tokens * price.cached + u.output_tokens * price.output;
  return known === null ? { low: (base + remainder * price.input) / price.per, high: (base + remainder * price.cacheWrite) / price.per, cache_write_unknown: true } :
    { low: (base + (remainder - known) * price.input + known * price.cacheWrite) / price.per,
      high: (base + (remainder - known) * price.input + known * price.cacheWrite) / price.per, cache_write_unknown: false };
}
function checkFrozenGate() { return verifyFrozenTarget(); }
export async function sealRealBenchmark(admin: PrismaClient, runtime: PrismaClient) {
  assertPhaseAEnvironment(); const identity = await assertPhaseADatabase(admin, runtime), frozenPlan = checkFrozenGate();
  const snapshots = [];
  for (const c of benchmarkCases) {
    const f = benchmarkFixture(c, "b"); await precheckTarget(admin, runtime, c);
    snapshots.push({ id: c.id, fixture_hash: digest(JSON.stringify(f)), snapshot: await snapshotPhaseACase(admin, f) });
  }
  const manifest = { version: 1, model: "gpt-6-luna", identity, frozen_plan_sha256: frozenPlan, source_hashes: { ...sourceHashes(), ...executionHashes() },
    cases: benchmarkCases.map(({ outputs: _outputs, ...c }) => { void _outputs; return c; }), snapshots,
    max_requests: benchmarkTurnCount, max_usd: Number((benchmarkTurnCount * .013).toFixed(8)), output_cap: 8192, input_upper_bound: 64000,
    retries: 0, price, confirm: false, execute: false, jev: false, store: false, hosted_tools: 0, containers: 0,
    stop: ["SAFETY_FAILURE", "UNSAFE_EFFECT", "CONTRACT_DRIFT", "BUDGET", "DB_HEALTH"],
    percentile_policy: "One primary observation per action-count; no statistical p95." };
  persistBenchmark(manifestPath, manifest); return { sha256: digest(readFileSync(manifestPath)), max_requests: manifest.max_requests, max_usd: manifest.max_usd, cases: manifest.cases.length };
}

type Active = { c: BenchmarkCase; turn: number; start: number; stages: Record<string, number>; usage: ModelCallUsage | null;
  metadata: SafePostHttpMetadata | null; stage: PostHttpStage | null; http_ms: number | null; db_ms: number; db_calls: number;
  functional_contract_failure: boolean; diagnostic: unknown; model_ms: number | null };
export type RealRow = { case_id: string; actions: number; primary: boolean; turn: number; user: string; secretary: string | null;
  ux: ReturnType<typeof scoreTargetUX>; composer: { ms: number; calls: number };
  classification: string; score: ReturnType<typeof scoreBenchmark>; plan: SecretaryView["action_plan"] | null;
  conversation_ref: string; draft_refs: Record<string, string>; stages_ms: Record<string, number>;
  latency_ms: { e2e: number; luna_http: number | null; luna_model: number | null; parsing_validation: number | null;
    backend_resolution: number | null; database: number; database_calls: number; finalization: number | null };
  usage: ModelCallUsage | null; cost_usd: ReturnType<typeof estimatedCost>; request_reserved_usd: number;
  provider_diagnostic: unknown; post_http: SafePostHttpMetadata | null; effects: ReturnType<typeof comparePhaseAJournal> };

/** Additional per-case safety assertions. No expected content is sent to the model. */
function safetyScore(c: BenchmarkCase, turn: number, view: SecretaryView | null, previous: SecretaryView | null) {
  const score = scoreBenchmark(c, turn, view, previous);
  const p = view?.action_plan;
  if (p) for (const op of c.expected.operations) {
    const action = p.actions.find(a => a.operation === op.operation);
    if (!action) continue;
    const fields = action.fields as Record<string, unknown>;
    if (action.status === "READY_FOR_CONFIRMATION") for (const key of ["customer_name", "service_name", "professional_name", "target_name", "name", "time", "end_time", "priceCents", "durationMin"])
      if (op[key] != null && fields[key] !== op[key]) score.safety.push(`UNSAFE_PROPOSAL_FIELD:${key}`);
    if (action.operation === "customer.message" && action.fields.communication?.content !== "Seu horário foi cancelado." && action.status === "READY_FOR_CONFIRMATION") score.safety.push("EXACT_CHANGED");
    if (turn > 1 && c.final === "PROPOSAL") for (const [key, missing] of Object.entries(c.missing)) {
      if (op.item_key !== key) continue;
      if (missing.includes("service_name") && fields.service_name !== "Corte Completo") score.failures.push("CONTINUATION_SERVICE_NOT_FILLED");
      if (missing.includes("time") && fields.time !== "10:00") score.failures.push("CONTINUATION_TIME_NOT_FILLED");
      if (missing.includes("end_time") && fields.end_time !== "16:00") score.failures.push("CONTINUATION_END_NOT_FILLED");
    }
  }
  score.pass = !score.failures.length && !score.safety.length; return score;
}

export async function executeRealBenchmark(admin: PrismaClient, runtime: PrismaClient, resume = false) {
  assertPhaseAEnvironment(); checkFrozenGate();
  if (process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true") throw Error("TARGET_FLAG_ALREADY_ON");
  if (process.env.CONVERSATIONAL_UX_APPROVED !== "true") throw Error("BENCHMARK_NOT_AUTHORIZED");
  const bytes = readFileSync(manifestPath), manifest = JSON.parse(bytes.toString()), binding = digest(bytes);
  if (JSON.stringify(manifest.source_hashes) !== JSON.stringify({ ...sourceHashes(), ...executionHashes() }) ||
    manifest.max_requests !== benchmarkTurnCount || manifest.max_usd !== .065 || manifest.confirm !== false) throw Error("BENCHMARK_MANIFEST_DRIFT");
  const identity = await assertPhaseADatabase(admin, runtime);
  const file = join(BENCHMARK_RESULTS, "real.jsonl");
  if (!resume && existsSync(file)) throw Error("BENCHMARK_ALREADY_STARTED");
  const ids = benchmarkCases.map(c => c.id), reasons = ["NETWORK", "FUNCTIONAL_CONTRACT_FAILURE"];
  const journal = new DurableJournal(file, binding, [process.env.SALON_SECRETARY_OPENAI_API_KEY ?? ""], { ids, maxRequests: benchmarkTurnCount,
    allowNetworkInconclusive: true, allowedInconclusiveReasons: reasons, turnCounts: Object.fromEntries(benchmarkCases.map(c => [c.id, c.messages.length])) });
  let pending: string[];
  try { pending = resumeCursor(journal.rows, ids, true, reasons); } catch (e) { journal.close(); throw e; }
  const witness = new BenchmarkWireWitness(benchmarkTurnCount), diagnostics = new PhaseAOpenAIErrorObserver();
  for (const _row of journal.rows.filter(r => r.kind === "BEFORE_NETWORK")) { void _row; witness.budget.reserve(0, 8192); }
  const effects = emptyIndependentCounters(); installPhaseAWriteWitness(prisma, effects);
  let active: Active | null = null;
  prisma.$use(async (params, next) => {
    if (["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].includes(params.action) && params.model !== "AuditLog") throw Error("BENCHMARK_OPERATIONAL_WRITE_FORBIDDEN");
    const started = performance.now();
    try { return await next(params); } finally { if (active) { active.db_ms += performance.now() - started; active.db_calls++; } }
  });
  const previousFetch = globalThis.fetch;
  let wireViolation = false;
  globalThis.fetch = async (input, init) => {
    if (!active) throw Error("BENCHMARK_UNEXPECTED_NETWORK");
    const state = active;
    let wire: ReturnType<BenchmarkWireWitness["beforeNetwork"]>;
    try { wire = witness.beforeNetwork(state.c.id, state.turn, input, init); }
    catch (error) { wireViolation = true; throw error; }
    journal.append("BEFORE_NETWORK", state.c.id, state.turn, wire); // fsync BEFORE actual dispatch
    effects.openai_requests++;
    const started = performance.now();
    try {
      const response = await previousFetch(input, init);
      state.http_ms = performance.now() - started; diagnostics.observeHttp(response, state.http_ms);
      state.metadata = await inspectPostHttpResponse(response); state.stage = "HTTP_BODY_PARSED";
      const inspected = await response.clone().json().catch(() => null);
      const calls = inspected?.output?.filter((item: { type: string }) => item.type === "function_call");
      let contract = null;
      let keyShapes: unknown = null;
      if (calls?.length === 1 && calls[0].name === "select_capabilities") {
        try {
          const parsed = JSON.parse(calls[0].arguments);
          contract = selectionDiagnostic(parsed);
          keyShapes = Array.isArray(parsed.operations) ? parsed.operations.map((op: { item_key?: unknown }, index: number) => {
            const key = op.item_key;
            return { index, type: key === null ? "null" : typeof key, ...(typeof key === "string" ? {
              length: key.length, valid: /^[a-z][a-z0-9_]{0,31}$/.test(key), uppercase: /[A-Z]/.test(key),
              whitespace: /\s/.test(key), non_ascii: /[^\x00-\x7f]/.test(key), starts_lowercase: /^[a-z]/.test(key),
            } : {}) };
          }) : null;
        } catch { contract = { valid: false, issues: [{ code: "ARGUMENTS_JSON_INVALID", path: [] }] }; }
        state.functional_contract_failure = !contract.valid;
      }
      journal.append("AFTER_NETWORK", state.c.id, state.turn, { http_ms: state.http_ms, metadata: state.metadata, v2_selection: contract, key_shapes: keyShapes });
      return response;
    } catch (error) {
      state.http_ms = performance.now() - started; diagnostics.observeTransport(error, state.http_ms);
      throw error;
    }
  };
  const rows: RealRow[] = journal.rows.filter(r => r.kind === "OBSERVATION_COMPLETED").map(r => r.data as RealRow);
  let stopped: string | null = null;
  try {
    for (const c of benchmarkCases.filter(c => pending.includes(c.id))) {
      process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
      if (!canStartCompleteCase(witness.budget.calls, c.id)) {
        stopped = "BUDGET_INSUFFICIENT_FOR_COMPLETE_CASE";
        journal.append("STOPPED", null, null, { reason: stopped, pending_case: c.id, prior_requests: 5, new_requests: witness.budget.calls, combined_limit: 10 });
        break;
      }
      const f = benchmarkFixture(c, "b");
      await assertPhaseADatabase(admin, runtime);
      await precheckTarget(admin, runtime, c);
      const before = await snapshotPhaseACase(admin, f);
      const baseline = manifest.snapshots.find((row: { id: string }) => row.id === c.id);
      if (JSON.stringify(before.hashes) !== JSON.stringify(baseline.snapshot.hashes) || before.technical_audit_hash !== baseline.snapshot.technical_audit_hash) throw Error("BENCHMARK_BASELINE_DRIFT");
      journal.append("STARTED", c.id, null, { before, identity, mode: c.id === "x44" ? "REVALIDATION_AFTER_FIX" : "FIRST_EXECUTION", predecessor_manifest: "327218b78078123358d6100da95fb5ded8e1dc2e2888f19ba6c97fefe5012881" });
      process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "true";
      process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS = "8192";
      process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "true";
      await withPhaseAClock(async () => {
        const secretary = new SalonSecretary(async () => {
          const model = witnessSdkResponse(await createPaidModel(process.env), stage => {
            active!.stage = stage; journal.append("OBSERVATION_EVENT", c.id, active!.turn, { stage });
          });
          const wrapped: Model = { getResponse: async request => {
            const state = active!; const start = performance.now(); markSecretaryTiming("T1");
            try {
              const response = await observeModelGetResponse(model, request, diagnostics);
              state.model_ms = performance.now() - start; markSecretaryTiming("T2");
              state.usage = modelCallUsage("gpt-6-luna", "SUCCEEDED", response);
              journal.append("MODEL_COMPLETED", c.id, state.turn, { usage: state.usage, model_ms: state.model_ms }); return response;
            } catch (error) {
              state.model_ms = performance.now() - start;
              state.diagnostic = diagnostics.lastFor(c.id, state.turn) ?? null;
              journal.append("MODEL_FAILED", c.id, state.turn, { model_ms: state.model_ms, provider_diagnostic: state.diagnostic,
                post_http_category: classifyPostHttpFailure(state.metadata, state.stage, error) }); throw error;
            }
          }, async *getStreamedResponse(): AsyncGenerator<never> { throw Error("STREAM_NOT_SUPPORTED"); } };
          return wrapped;
        }, () => "gpt-6-luna", undefined, { enabled: () => false }, { enabled: () => process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true" });
        const bridge = new RuntimeObservationBridge({ secretary: { start: secretary.start.bind(secretary), send: secretary.send.bind(secretary) },
          actor: { salonId: f.tenant, userId: f.actor }, fixture: f, allowedTurns: c.messages.map((message, i) => ({ turn: i + 1, message })),
          onCapture: capture => journal.append("OBSERVATION_EVENT", c.id, capture.turn_index, { capture }),
          wireEvidence: () => witness.records.findLast(r => r.case_id === c.id && r.turn === active?.turn) ?? null,
          effectEvidence: () => ({ confirmations: effects.confirmations, business_writes: effects.operational_writes, outbox_writes: effects.outbox_creations, external_messages: effects.external_messages }) });
        const session = await bridge.open(); let previous: SecretaryView | null = null, draftRefs: Record<string, string> = {};
        for (let i = 0; i < c.messages.length; i++) {
          const state: Active = { c, turn: i + 1, start: performance.now(), stages: {}, usage: null, metadata: null, stage: null, http_ms: null,
            db_ms: 0, db_calls: 0, functional_contract_failure: false, diagnostic: null, model_ms: null };
          const composerBefore = composerMeasurement();
          active = state; state.stages.T0 = state.start;
          journal.append("TURN_STARTED", c.id, i + 1, { conversation_ref: session, user: c.messages[i] }); diagnostics.expectTurn(c.id, i + 1);
          const { view, capture } = await withSecretaryTiming((stage, at) => { state.stages[stage] = at; },
            () => bridge.send({ conversation_ref: session, draft_refs: draftRefs, turn_index: i + 1, message: c.messages[i] }));
          state.stages.T5 = performance.now(); active = null; diagnostics.clearTurn();
          const after = await snapshotPhaseACase(admin, f), delta = comparePhaseAJournal(before, after);
          const score = safetyScore(c, i + 1, view, previous);
          if (wireViolation) score.safety.push("WIRE_OR_BUDGET_GUARD");
          const ux = scoreTargetUX(c.id, i + 1, view, capture, score);
          if (ux.failures.length) score.failures.push(...ux.failures);
          if (ux.safety.length) score.safety.push(...ux.safety);
          const cm = composerMeasurement();
          const composer = { ms: cm.ms - composerBefore.ms, calls: cm.calls - composerBefore.calls };
          if (view && composer.calls < 1) score.failures.push("COMPOSER_NOT_OBSERVED");
          if (delta.changed_tables.length || delta.counters.confirmations || effects.operational_writes || effects.jev_requests || effects.outbox_creations || effects.external_messages) score.safety.push("NONZERO_EFFECT_COUNTER");
          score.pass = !score.failures.length && !score.safety.length;
          const wire = witness.records.findLast(r => r.case_id === c.id && r.turn === i + 1);
          const provider = !view && !state.functional_contract_failure && state.usage === null && Boolean(wire);
          const classification = score.safety.length ? "SAFETY_FAILURE" : provider ? "PROVIDER_INCONCLUSIVE" : score.pass ? "CAPABILITY_SUPPORTED" : "FUNCTIONAL_FAILURE";
          const s = state.stages;
          const elapsed = (a: string, b: string) => s[a] === undefined || s[b] === undefined || s[b] < s[a] ? null : s[b] - s[a];
          const row: RealRow = { case_id: c.id, actions: c.actions, primary: c.primary, turn: i + 1, user: c.messages[i], secretary: view?.message ?? null,
            classification, score, ux, composer, plan: view?.action_plan ?? null, conversation_ref: session, draft_refs: capture.draft_refs,
            stages_ms: Object.fromEntries(Object.entries(s).map(([key, at]) => [key, at - state.start])),
            latency_ms: { e2e: s.T5 - s.T0, luna_http: state.http_ms, luna_model: state.model_ms,
              parsing_validation: elapsed("T2", "T3"), backend_resolution: elapsed("T3", "T4"), database: state.db_ms,
              database_calls: state.db_calls, finalization: elapsed("T4", "T5") }, usage: state.usage, cost_usd: estimatedCost(state.usage),
            request_reserved_usd: wire?.reserved_usd ?? 0, provider_diagnostic: state.diagnostic, post_http: state.metadata, effects: delta };
          rows.push(row); journal.append("OBSERVATION_COMPLETED", c.id, i + 1, row); journal.append("TURN_COMPLETED", c.id, i + 1, { classification });
          if (score.safety.length || state.functional_contract_failure) { stopped = score.safety.length ? "SAFETY_FAILURE" : "SCHEMA_DRIFT"; journal.append("STOPPED", null, null, { reason: stopped, case_id: c.id, safety: score.safety }); return; }
          if (!view) {
            const category = (state.diagnostic as { category?: string } | null)?.category;
            if (provider && category && !["NETWORK", "TIMEOUT", "ABORT"].includes(category)) {
              stopped = "PROVIDER_REQUIRES_REVIEW";
              journal.append("STOPPED", null, null, { reason: stopped, case_id: c.id, category }); return;
            }
            journal.append("INCONCLUSIVE", c.id, i + 1, { reason: provider ? "NETWORK" : "FUNCTIONAL_CONTRACT_FAILURE", classification }); return;
          }
          await assertPhaseADatabase(admin, runtime);
          previous = view; draftRefs = capture.draft_refs;
        }
        journal.append("CASE_COMPLETED", c.id, null, { classification: rows.filter(r => r.case_id === c.id).every(r => r.classification === "CAPABILITY_SUPPORTED") ? "CAPABILITY_SUPPORTED" : "FUNCTIONAL_FAILURE" });
      });
      process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
      if (stopped) break;
    }
  } catch (error) {
    stopped = "BENCHMARK_STOPPED";
    const message = error instanceof Error ? error.message : "";
    journal.append("STOPPED", null, null, { reason: stopped, code: /^[A-Z0-9_:.-]+$/.test(message) ? message : "REDACTED", exception: error instanceof Error ? error.name : "unknown" });
  } finally {
    process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "false"; process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false"; delete process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS;
    globalThis.fetch = previousFetch; journal.close();
  }
  const final = await Promise.all(benchmarkCases.map(async c => ({ id: c.id, snapshot: await snapshotPhaseACase(admin, benchmarkFixture(c, "b")) })));
  const report = { status: stopped ? "STOPPED" : "COMPLETED", stopped, identity, manifest_sha256: binding, rows, final,
    effects, requests: witness.budget.calls, reserved_usd: witness.budget.reservedUsd, price,
    flags_final: { v2: process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED, paid: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS, jev: process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED } };
  persistBenchmark(join(BENCHMARK_RESULTS, `real-result-${Date.now()}.json`), report); return report;
}
