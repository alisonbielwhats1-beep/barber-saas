/** Controlled PostgreSQL validation. Imports no live execution entrypoint. */
import { PrismaClient } from "@prisma/client";
import { performance } from "node:perf_hooks";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DurableJournal, digest, checkpoint, readDurable } from "./hard-conversations-durable";
import { assertPhaseAEnvironment, assertPhaseADatabase, backupPhaseALocalDatabase, seedPhaseACase, precheckPhaseACase,
  snapshotPhaseACase, comparePhaseAJournal, installPhaseAWriteWitness, emptyIndependentCounters } from "./hard-conversations-phase-a-db";
import { RuntimeObservationBridge, type TurnCapture } from "./hard-conversations-observation-bridge";
import { withPhaseAClock } from "./hard-conversations-phase-a-execution";
import { benchmarkCases, benchmarkFixture, benchmarkTurnCount, type BenchmarkCase } from "./multi-action-benchmark-cases";
import { ScriptedServicesModel, call } from "../../../src/test/scripted-services-model";
import { SalonSecretary, type SecretaryView } from "../../../src/lib/salon-secretary";
import { prisma } from "../../../src/lib/prisma";
import { createServicesAgent, createPaidModel, withSecretaryTiming, markSecretaryTiming, type Model, type ActionPlan } from "../src";
import { PhaseAWireWitness } from "./hard-conversations-phase-a-witness";
import { BenchmarkWireWitness, selectionDiagnostic } from "./multi-action-benchmark-wire";
import { PhaseAOpenAIErrorObserver, observeModelGetResponse } from "./hard-conversations-openai-diagnostic";
import { inspectPostHttpResponse, witnessSdkResponse } from "./ultimate-10-post-http";

export const BENCHMARK_RESULTS = "packages/salon-secretary/evaluation/results/multi-action-benchmark";
export const sourceFiles = ["packages/salon-secretary/src/index.ts", "packages/salon-secretary/src/skill-registry.ts",
  "packages/salon-secretary/src/action-plan.ts", "packages/salon-secretary/src/dependency-graph.ts",
  "packages/salon-secretary/src/timing.ts",
  "src/lib/salon-secretary.ts", "src/lib/secretary-action-plan.ts",
  "packages/salon-secretary/evaluation/multi-action-benchmark-cases.ts",
  "packages/salon-secretary/evaluation/multi-action-benchmark-wire.ts",
  "packages/salon-secretary/evaluation/multi-action-benchmark-harness.ts"];
export function sourceHashes() { return Object.fromEntries(sourceFiles.map(file => [file, digest(readFileSync(file))])); }
export function persistBenchmark(file: string, value: unknown) {
  // Only synthetic case data and allowlisted diagnostics are admitted by the caller/journal.
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
}
export function scoreBenchmark(c: BenchmarkCase, turn: number, view: SecretaryView | null, previous: SecretaryView | null) {
  const p = view?.action_plan, failures: string[] = [], safety: string[] = [];
  if (!p) return { failures: ["ACTION_PLAN_MISSING"], safety, pass: false };
  if (p.actions.length !== c.actions) failures.push("ACTION_COUNT");
  const map = new Map(c.expected.operations.map(op => [op.item_key!, p.actions.find(a => a.operation === op.operation)]));
  for (const op of c.expected.operations) {
    const action = map.get(op.item_key!);
    if (!action) { failures.push(`OPERATION:${op.operation}`); continue; }
    const actionFields = action.fields as Record<string, unknown>;
    for (const field of ["customer_name", "service_name", "professional_name", "time", "end_time", "target_name", "name", "priceCents", "durationMin"] as const) {
      const expected = (op as Record<string, unknown>)[field];
      if (expected != null && actionFields[field] !== expected) failures.push(`FIELD_LOST:${op.item_key}.${field}`);
    }
    for (const parent of (op.depends_on ?? []) as string[]) if (!action.depends_on.includes(map.get(parent)?.key ?? "")) failures.push(`DEPENDENCY:${op.item_key}`);
    if (action.skill === "scheduling" && actionFields.day_offset == null && actionFields.date && actionFields.date !== "2026-10-06") safety.push("WRONG_DATE");
    if (action.status === "FAILED_SAFE" || action.status === "UNSUPPORTED") failures.push(`ACTION_${action.status}:${op.item_key}`);
  }
  if (turn === 1) for (const [key, fields] of Object.entries(c.missing)) {
    const action = map.get(key);
    const actionFields = action?.fields as Record<string, unknown> | undefined;
    for (const field of fields) {
      const aliases = field === "service_name" || field === "service_ref" ? ["service_name", "service_ref", "selection"] : [field];
      if (!action?.missing_fields.some(m => aliases.includes(m))) failures.push(`MISSING_NOT_DETECTED:${key}.${field}`);
      if (field === "service_name" && actionFields?.service_name || field === "time" && actionFields?.time || field === "end_time" && actionFields?.end_time) safety.push(`INVENTED_REQUIRED_FIELD:${key}.${field}`);
    }
    if (action?.status === "READY_FOR_CONFIRMATION") safety.push(`UNSAFE_PROPOSAL:${key}`);
  }
  if (previous?.action_plan) {
    if (p.plan_ref !== previous.action_plan.plan_ref || view?.sessionId !== previous.sessionId) failures.push("PLAN_CONTINUITY");
    if (JSON.stringify(p.dependencies) !== JSON.stringify(previous.action_plan.dependencies)) failures.push("GRAPH_CONTINUITY");
    for (const action of previous.action_plan.actions) if (!action.missing_fields.length) {
      const after = p.actions.find(a => a.key === action.key);
      if (JSON.stringify(after?.fields) !== JSON.stringify(action.fields)) failures.push(`SIBLING_FIELDS_CHANGED:${action.key}`);
    }
    for (const old of previous.operations ?? []) {
      const next = view?.operations?.find(op => op.operation_ref === old.operation_ref);
      const refs = (v: SecretaryView) => v.draft?.draft_ref ?? v.batch?.draft?.draft_ref ?? v.scheduling?.draft?.draft_ref ?? v.communication?.draft?.draft_ref ?? v.customer?.draft?.draft_ref ?? v.inventory?.draft?.draft_ref;
      if (refs(old.state) && (!next || refs(next.state) !== refs(old.state))) failures.push("DRAFT_CONTINUITY");
    }
  }
  if (turn === c.messages.length) {
    if (c.final === "PROPOSAL" && p.confirmation_groups.some(g => !["READY_FOR_CONFIRMATION", "DONE"].includes(g.status))) failures.push("PROPOSAL_NOT_READY");
    if (c.final === "CONFLICT" && !p.actions.some(a => a.status === "DOMAIN_CONFLICT")) failures.push("CONFLICT_NOT_DETECTED");
    if (c.final === "CONFLICT" && map.get("b")?.status === "READY_FOR_CONFIRMATION") safety.push("UNSAFE_OVERLAP_PROPOSAL");
    if (c.final === "AMBIGUOUS" && p.actions.some(a => a.status === "READY_FOR_CONFIRMATION")) safety.push("WRONG_ENTITY_AUTO_SELECTED");
  }
  if (p.review !== (c.actions > 5 ? "ADVANCED_REVIEW" : "NORMAL_REVIEW")) failures.push("REVIEW_POLICY");
  return { pass: !failures.length && !safety.length, failures: [...new Set(failures)], safety: [...new Set(safety)] };
}

export async function prepareBenchmark(admin: PrismaClient, runtime: PrismaClient, phase: "a" | "b") {
  const env = assertPhaseAEnvironment(), identity = await assertPhaseADatabase(admin, runtime);
  if (process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true") throw Error("BENCHMARK_FLAG_ALREADY_ON");
  const fixtures = benchmarkCases.map(c => benchmarkFixture(c, phase));
  const exists = await Promise.all(fixtures.map(f => admin.salon.count({ where: { id: f.tenant } })));
  // Preparation is resumable only at committed fixture boundaries. Existing fixtures
  // must match the complete schema/data precheck; never repair/reset them silently.
  for (let i = 0; i < fixtures.length; i++) if (exists[i])
    await precheckPhaseACase(admin, runtime, fixtures[i], undefined, { financialYesterday: true });
  const backup = exists.every(Boolean) ? null : backupPhaseALocalDatabase(env.admin);
  if (backup) {
    persistBenchmark(join(BENCHMARK_RESULTS, `preparation-backup-${Date.now()}.json`), { backup, identity, phase, present: fixtures.filter((_, i) => exists[i]).map(f => f.caseId) });
    for (let i = 0; i < fixtures.length; i++) if (!exists[i]) {
      try { await seedPhaseACase(admin, fixtures[i], { financialYesterday: true }); }
      catch (error) {
        const e = error as { code?: string; name?: string; message?: string };
        persistBenchmark(join(BENCHMARK_RESULTS, `preparation-failed-${Date.now()}.json`), { case_id: fixtures[i].caseId,
          code: e.code ?? null, exception: e.name ?? null, timeout: /timed out|timeout|expired/i.test(e.message ?? "") });
        throw error;
      }
    }
  }
  for (const f of fixtures) await precheckPhaseACase(admin, runtime, f, undefined, { financialYesterday: true });
  return { identity, backup, fixtures: fixtures.map(f => ({ case_id: f.caseId, sha256: digest(JSON.stringify(f)), services: f.services.map(s => ({ name: s.name, durationMin: s.durationMin })) })), seeded: exists.filter(count => !count).length };
}

/** Reuse the immutable V1 wire witness as a conservative no-network contract probe.
 * V2 output resource budget gets an independent serialized-payload check in its own harness. */
export function offlineWireProbe() {
  const witness = new PhaseAWireWitness();
  witness.expectTurn("x90", 1, "select_capabilities", []);
  const old = process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS;
  process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS = "1200";
  try {
    const agent = createServicesAgent(new ScriptedServicesModel([]), () => {}, "discovery", true);
    const tool = agent.tools[0] as { type: string; name: string; description: string; parameters: unknown; strict?: boolean };
    witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST", body: JSON.stringify({ model: "gpt-6-luna",
      instructions: agent.instructions, input: [{ role: "user", content: "Mensagem sintética" }], store: false, stream: false, include: [],
      max_output_tokens: 1200, parallel_tool_calls: false, tool_choice: { type: "function", name: "select_capabilities" },
      tools: [{ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }] }) });
    return witness.records;
  } finally { if (old === undefined) delete process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS; else process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS = old; }
}

export async function controlledValidation(admin: PrismaClient, runtime: PrismaClient, timingValidation = false) {
  assertPhaseAEnvironment(); const identity = await assertPhaseADatabase(admin, runtime);
  const basename = timingValidation ? "phase-a-timing" : "phase-a";
  const prior = timingValidation ? JSON.parse(readFileSync(join(BENCHMARK_RESULTS, "phase-a-result.json"), "utf8")) : null;
  if (timingValidation && prior.status !== "PASS") throw Error("BENCHMARK_PHASE_A_REQUIRED");
  const file = join(BENCHMARK_RESULTS, `${basename}.jsonl`), binding = digest(JSON.stringify(sourceHashes()));
  mkdirSync(BENCHMARK_RESULTS, { recursive: true });
  const journal = new DurableJournal(file, binding, [], { ids: benchmarkCases.map(c => c.id), maxRequests: benchmarkTurnCount,
    allowNetworkInconclusive: false, turnCounts: Object.fromEntries(benchmarkCases.map(c => [c.id, c.messages.length])) });
  if (journal.rows.length) { journal.close(); throw Error("BENCHMARK_PHASE_A_ALREADY_STARTED"); }
  const effects = emptyIndependentCounters(); installPhaseAWriteWitness(prisma, effects);
  prisma.$use(async (params, next) => {
    if (["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].includes(params.action) && params.model !== "AuditLog") throw Error("BENCHMARK_OPERATIONAL_WRITE_FORBIDDEN");
    return next(params);
  });
  const originalFetch = globalThis.fetch, records: { case_id: string; turn: number; message: string; reply: string | null; plan: ActionPlan | null; score: ReturnType<typeof scoreBenchmark>; capture: TurnCapture; elapsed_ms: number }[] = [];
  const sdkWitness = new BenchmarkWireWitness(benchmarkTurnCount), diagnostics = new PhaseAOpenAIErrorObserver();
  let current: { c: BenchmarkCase; turn: number; output: ReturnType<typeof call> } | null = null;
  let simulatedRequests = 0;
  globalThis.fetch = async (input, init) => {
    if (!current) throw Error("BENCHMARK_PHASE_A_NETWORK_FORBIDDEN");
    const { c, turn, output } = current;
    const wire = sdkWitness.beforeNetwork(c.id, turn, input, init);
    journal.append("BEFORE_NETWORK", c.id, turn, { ...wire, simulated_transport: true });
    simulatedRequests++;
    const response = new Response(JSON.stringify({ id: `resp_synthetic_${simulatedRequests}`, object: "response", created_at: 0,
      status: "completed", model: "gpt-6-luna", output: output.map(item => {
        if (item.type !== "function_call") throw Error("BENCHMARK_SCRIPT_INVALID");
        return { id: "fc_synthetic", call_id: item.callId, type: item.type, name: item.name, arguments: item.arguments, status: "completed" };
      }) }), { status: 200, headers: { "content-type": "application/json", "x-request-id": `req_synthetic_${simulatedRequests}` } });
    diagnostics.observeHttp(response, 0);
    const metadata = await inspectPostHttpResponse(response);
    // The legacy metadata boolean describes V1 only; V2 diagnostic is independently explicit.
    const args = output[0]?.type === "function_call" ? JSON.parse(output[0].arguments) : null;
    journal.append("AFTER_NETWORK", c.id, turn, { simulated_transport: true, metadata,
      v2_selection: output[0]?.type === "function_call" && output[0].name === "select_capabilities" ? selectionDiagnostic(args) : null });
    return response;
  };
  let stopped: string | null = null;
  try {
    const wire = offlineWireProbe();
    process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "true";
    process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS = "8192";
    for (const c of benchmarkCases) {
      const fixture = benchmarkFixture(c, "a");
      const approved = prior?.snapshots.find((r: { id: string }) => r.id === c.id)?.snapshot;
      await precheckPhaseACase(admin, runtime, fixture, approved ? { kind: "APPROVED_RESUME_HISTORY", case_id: fixture.caseId,
        count: approved.technical_audits, technical_audit_hash: approved.technical_audit_hash } : undefined, { financialYesterday: true });
      const before = await snapshotPhaseACase(admin, fixture);
      journal.append("STARTED", c.id, null, { phase: "A", identity, before, wire, source_hashes: sourceHashes() });
      await withPhaseAClock(async () => {
        const secretary = new SalonSecretary(async () => {
          const model = witnessSdkResponse(await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true",
            SALON_SECRETARY_OPENAI_API_KEY: "synthetic-offline-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_offline", SALON_SECRETARY_MODEL: "gpt-6-luna" }),
          stage => journal.append("OBSERVATION_EVENT", c.id, current!.turn, { stage, simulated_transport: true }));
          const wrapped: Model = { getResponse: async request => {
            markSecretaryTiming("T1");
            const response = await observeModelGetResponse(model, request, diagnostics);
            markSecretaryTiming("T2");
            journal.append("MODEL_COMPLETED", c.id, current!.turn, { simulated_transport: true }); return response;
          }, async *getStreamedResponse(): AsyncGenerator<never> { throw Error("STREAM_NOT_SUPPORTED"); } };
          return wrapped;
        }, () => "gpt-6-luna", undefined, {}, { enabled: () => process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true" });
        const bridge = new RuntimeObservationBridge({ secretary: { start: secretary.start.bind(secretary), send: secretary.send.bind(secretary) },
          actor: { salonId: fixture.tenant, userId: fixture.actor }, fixture, allowedTurns: c.messages.map((message, i) => ({ turn: i + 1, message })),
          onCapture: capture => journal.append("OBSERVATION_EVENT", c.id, capture.turn_index, capture),
          effectEvidence: () => ({ confirmations: effects.confirmations, business_writes: effects.operational_writes, outbox_writes: effects.outbox_creations, external_messages: effects.external_messages }) });
        const session = await bridge.open(); let previous: SecretaryView | null = null, draftRefs: Record<string, string> = {};
        for (let i = 0; i < c.messages.length; i++) {
          journal.append("TURN_STARTED", c.id, i + 1, { conversation_ref: session, message: c.messages[i] });
          current = { c, turn: i + 1, output: i === 0 ? call("select_capabilities", c.expected) : c.outputs[i - 1] };
          diagnostics.expectTurn(c.id, i + 1);
          const start = performance.now();
          const stages: Record<string, number> = { T0: start };
          const { view, capture } = await withSecretaryTiming((stage, at) => { stages[stage] = at; },
            () => bridge.send({ conversation_ref: session, draft_refs: draftRefs, turn_index: i + 1, message: c.messages[i] }));
          stages.T5 = performance.now();
          journal.append("OBSERVATION_EVENT", c.id, i + 1, { stages, simulated_transport: true });
          journal.append("OBSERVATION_EVENT", c.id, i + 1, { provider_diagnostic: diagnostics.lastFor(c.id, i + 1) ?? null });
          diagnostics.clearTurn(); current = null;
          const score = scoreBenchmark(c, i + 1, view, previous);
          const after = await snapshotPhaseACase(admin, fixture), delta = comparePhaseAJournal(before, after);
          if (delta.changed_tables.length || delta.counters.confirmations || effects.operational_writes || effects.openai_requests) score.safety.push("NONZERO_EFFECT_COUNTER");
          const row = { case_id: c.id, turn: i + 1, message: c.messages[i], reply: view?.message ?? null, plan: view?.action_plan ?? null, score, capture, elapsed_ms: performance.now() - start };
          records.push(row);
          journal.append("OBSERVATION_COMPLETED", c.id, i + 1, { ...row, delta, effects });
          journal.append("TURN_COMPLETED", c.id, i + 1, { pass: score.pass, simulated_requests: simulatedRequests });
          if (!score.pass || score.safety.length) { stopped = `PHASE_A_VALIDATION_FAILED:${c.id}:${i + 1}`; journal.append("STOPPED", null, null, { reason: stopped, failures: score.failures, safety: score.safety }); return; }
          previous = view; draftRefs = capture.draft_refs;
        }
        journal.append("CASE_COMPLETED", c.id, null, { status: "PASS", effects });
      });
      if (stopped) break;
    }
  } catch (error) {
    stopped = "PHASE_A_HARNESS_FAILED";
    const message = error instanceof Error ? error.message : "";
    journal.append("STOPPED", null, null, { reason: stopped, exception: error instanceof Error ? error.name : "unknown",
      code: /^[A-Z0-9_:.-]+$/.test(message) ? message : "REDACTED" });
  } finally {
    process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "false";
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false"; process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
    delete process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS;
    globalThis.fetch = originalFetch; journal.close();
  }
  const snapshots = await Promise.all(benchmarkCases.map(async c => ({ id: c.id, snapshot: await snapshotPhaseACase(admin, benchmarkFixture(c, "a")) })));
  const report = { status: stopped ? "FAIL" : "PASS", stopped, phase: "A", identity, records, effects, snapshots,
    source_hashes: sourceHashes(), journal_sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    checkpoints: Object.fromEntries(benchmarkCases.map(c => [c.id, checkpoint(readDurable(file, binding), c.id)])),
    flags_final: { multi_action_v2: process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED, paid: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS, jev: process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED } };
  persistBenchmark(join(BENCHMARK_RESULTS, `${basename}-result.json`), report);
  return report;
}
