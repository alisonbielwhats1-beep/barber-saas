/** Gate 4.0B.2: full Secretary boundary, local synthetic PostgreSQL, no confirmation API. */
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { createPaidModel, type Model } from "../src";
import { SalonSecretary } from "../../../src/lib/salon-secretary";
import { prisma } from "../../../src/lib/prisma";
import { FakeCommunicationProvider } from "../../../src/lib/communication-provider";
import { RuntimeObservationBridge, observationStopReason, type RouterEvidence,
  type SecretaryBoundary, type TurnCapture } from "./hard-conversations-observation-bridge";
import { assertPayloadSeparation, type TurnInput } from "./hard-conversations-runner";
import { makeFixture, type SyntheticFixture } from "./hard-conversations-fixtures";
import { verifyPhaseA, PHASE_A_SHA256 } from "./hard-conversations-phase-a";
import { assertApprovedI01Audit, assertContinuationCaseScope, assertContinuationTotalAuditCount, assertOperationalBaseline,
  CONTINUATION_SCOPE, verifyPhaseAContinuation } from "./hard-conversations-phase-a-continuation";
import { PhaseAWireWitness } from "./hard-conversations-phase-a-witness";
import { PhaseAOpenAIErrorObserver, observeModelGetResponse, type SanitizedOpenAIFailure } from
  "./hard-conversations-openai-diagnostic";
import { assertPhaseADatabase, assertPhaseAEnvironment, backupPhaseALocalDatabase,
  comparePhaseAJournal, emptyIndependentCounters, installPhaseAWriteWitness,
  precheckPhaseACase, seedPhaseACase, snapshotPhaseACase } from "./hard-conversations-phase-a-db";

import { routerLunaCost } from "../../../src/lib/secretary-router";
import { modelCallUsage } from "../src/usage";
import { DurableJournal, RESUME_SCOPE, FINAL_CONTINUATION_SCOPE, FINAL_CONTINUATION_IDS,
  resumeCursor, checkpoint } from "./hard-conversations-durable";
import { captureResumeState, resumeHealth, resumePreflight, verifyResumePlan, RESUME_JOURNAL } from "./hard-conversations-phase-a-resume";
import { assertFinalCaseState, finalPreflight, verifyFinalPlan, FINAL_JOURNAL } from "./hard-conversations-phase-a-final";

const PROJECT_ROOT = process.cwd();
const BASE_TIME = "2026-10-05T12:00:00.000Z";
const stop = (code: string): never => { throw Error(`PHASE_A_STOP:${code}`); };
const missingFieldAliases: Record<string, readonly string[]> = {
  service: ["service_ref", "service_name", "service"], time: ["time", "start_time", "startAt"],
  date: ["date", "start_date", "day_offset"], customer: ["customer_ref", "customer_name"],
  durationMin: ["durationMin"], priceCents: ["priceCents"], name: ["name"], email: ["email"],
  quantity: ["quantity"], period: ["period"], end_time: ["end_time", "endAt"],
  reason: ["reason"], service_selection: ["service_ref"], professional_selection: ["professional_ref"],
};
/** Evaluation-only oracle. It cannot supply fields to the runtime/model. */
export function assessPhaseAMissingFields(expectedMissing: readonly string[], capture: {
  operations: { fields: Record<string, unknown>; proposal_ref: string | null }[] }) {
  const invented = expectedMissing.filter(field => {
    const aliases = missingFieldAliases[field];
    if (!aliases) return false;
    return capture.operations.some(operation => aliases.some(alias =>
      operation.fields[alias] !== undefined && operation.fields[alias] !== null));
  });
  const unsafeProposal = expectedMissing.length > 0 && capture.operations.some(operation => operation.proposal_ref);
  return { invented_critical_fields: invented, unsafe_proposal: unsafeProposal };
}
function knownPreNetworkFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "BUDGET_EXCEEDED") return "BUDGET_EXCEEDED";
  if (code === "PAYLOAD_LEAK") return "PAYLOAD_LEAK";
  if (code.startsWith("WIRE_") || code.startsWith("SECRETARY_OPENAI_COST_GUARD:"))
    return "WIRE_CONTRACT_VIOLATION";
  return null;
}

export async function withPhaseAClock<T>(task: () => Promise<T>): Promise<T> {
  const original = globalThis.Date, fixedMs = Date.parse(BASE_TIME);
  const controlled = new Proxy(original, {
    construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [fixedMs], newTarget); },
    get(target, property, receiver) { return property === "now" ? () => fixedMs : Reflect.get(target, property, receiver); },
  });
  globalThis.Date = controlled;
  try { return await task(); }
  finally { globalThis.Date = original; }
}

function forbiddenFixtureValues(f: SyntheticFixture) {
  return [f.tenant, f.foreignTenant, f.actor, ...f.customers.map(x => x.id),
    ...f.services.map(x => x.id), ...f.professionals.map(x => x.id), ...f.products.map(x => x.id),
    ...f.appointments.map(x => x.id), process.env.SALON_SECRETARY_OPENAI_API_KEY ?? "",
    process.env.SALON_SECRETARY_OPENAI_PROJECT ?? "", process.env.TYPESAFE_API_KEY ?? "",
    process.env.DATABASE_URL ?? "", process.env.DIRECT_URL ?? ""];
}

/** Read-only preflight is separate from the explicit create-once fixture preparation. */
export async function phaseAPreflight(admin: PrismaClient, runtime: PrismaClient) {
  const frozen = verifyPhaseA(PROJECT_ROOT);
  if (frozen.phase_a_sha256 !== PHASE_A_SHA256 || frozen.cases !== 26 || frozen.turns !== 28 ||
    frozen.max_luna_inferences !== 28 || frozen.max_usd !== .2408) stop("MANIFEST_DRIFT");
  assertPhaseAEnvironment();
  const identity = await assertPhaseADatabase(admin, runtime);
  const plan = JSON.parse((await import("node:fs")).readFileSync(
    "packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8")) as {
    cases: { case_id: string; fixture: Parameters<typeof makeFixture>[1];
      turns: { turn: number; message: string }[]; expected: { actions: { operation: string }[];
        minimum_clarification_fields: string[] } }[] };
  if (plan.cases.length !== 26 || plan.cases.reduce((n, c) => n + c.turns.length, 0) !== 28) stop("SCOPE_DRIFT");
  for (const c of plan.cases) await precheckPhaseACase(admin, runtime, makeFixture(c.case_id, c.fixture));
  return { identity, case_count: plan.cases.length, turn_count: 28, plan };
}

/** Read-only continuation preflight: exactly seven approved i01 logs, all 26 operational baselines. */
export async function phaseAContinuationPreflight(admin: PrismaClient, runtime: PrismaClient) {
  const frozen = verifyPhaseAContinuation(PROJECT_ROOT);
  assertPhaseAEnvironment();
  const identity = await assertPhaseADatabase(admin, runtime);
  const i01 = makeFixture("i01", "free");
  const audits = await admin.auditLog.findMany({ where: { salonId: i01.tenant },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  assertContinuationTotalAuditCount(await admin.auditLog.count());
  assertApprovedI01Audit(audits, frozen.baseline, frozen.report, i01.tenant, i01.actor);
  const approvedI01 = { kind: "APPROVED_I01_HISTORY" as const, count: 7 as const,
    technical_audit_hash: frozen.baseline.operational[0].technical_audit_hash! };
  for (const c of frozen.source.cases) {
    const fixture = makeFixture(c.case_id, c.fixture);
    await precheckPhaseACase(admin, runtime, fixture, c.case_id === "i01" ? approvedI01 : undefined);
    assertOperationalBaseline(c.case_id, await snapshotPhaseACase(admin, fixture),
      frozen.baseline.operational.find(row => row.case_id === c.case_id));
  }
  assertContinuationCaseScope(frozen.manifest.cases);
  return { identity, case_count: 25, turn_count: 27, plan: frozen.manifest, baseline: frozen.baseline,
    historical_technical_logs: 7 };
}

/** Seed only when every Phase A case is absent. No implicit destructive reset. */
export async function preparePhaseAFixtures(admin: PrismaClient, runtime: PrismaClient) {
  const frozen = verifyPhaseA(PROJECT_ROOT);
  assertPhaseAEnvironment();
  await assertPhaseADatabase(admin, runtime);
  const plan = JSON.parse((await import("node:fs")).readFileSync(
    "packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8")) as {
    cases: { case_id: string; fixture: Parameters<typeof makeFixture>[1] }[] };
  const present = await Promise.all(plan.cases.map(c => admin.salon.findUnique({ where: { id: makeFixture(c.case_id, c.fixture).tenant }, select: { id: true } })));
  if (present.some(Boolean) && !present.every(Boolean)) stop("PARTIAL_FIXTURE_SET");
  let backup: { path: string; bytes: number } | null = null;
  if (!present.some(Boolean)) {
    const urls = assertPhaseAEnvironment();
    backup = backupPhaseALocalDatabase(urls.admin);
    for (const c of plan.cases) await seedPhaseACase(admin, makeFixture(c.case_id, c.fixture));
  }
  const checked = await phaseAPreflight(admin, runtime);
  return { manifest_sha256: frozen.phase_a_sha256, backup, seeded: backup ? 26 : 0,
    cases_checked: checked.case_count, turns_checked: checked.turn_count, identity: checked.identity };
}

type CaseRecord = { case_id: string; turn_index: number; capture: TurnCapture; journal: ReturnType<typeof comparePhaseAJournal>;
  openai_network_requests: number; local_function_tool_executions: number; latency_ms: number;
  operation_sequence_match: boolean | null; independent_missing_field_check: ReturnType<typeof assessPhaseAMissingFields> | null;
  provider_diagnostic: SanitizedOpenAIFailure | null; stop_reason: string | null };

/** Must be invoked only by a later, explicit paid command after all 26 database prechecks pass. */
export async function executePhaseA(admin: PrismaClient, runtime: PrismaClient,
  scope: "PHASE_A" | "REVALIDATE_I01" | typeof CONTINUATION_SCOPE | typeof RESUME_SCOPE | typeof FINAL_CONTINUATION_SCOPE = "PHASE_A") {
  if (scope === CONTINUATION_SCOPE && process.env.PHASE_A_CONTINUATION_I02_I26_APPROVED !== "true")
    stop("CONTINUATION_NOT_APPROVED");
  if (scope === RESUME_SCOPE && (process.env.PHASE_A_RESUME_FROM_I12_APPROVED !== "true" ||
    process.env.PHASE_A_REVALIDATE_I12_APPROVED !== "true")) stop("RESUME_NOT_APPROVED");
  if (scope === FINAL_CONTINUATION_SCOPE && process.env.PHASE_A_FINAL_CONTINUATION_APPROVED !== "true")
    stop("FINAL_CONTINUATION_NOT_APPROVED");
  let durable: DurableJournal | null = null;
  let resume: Awaited<ReturnType<typeof resumePreflight>> | null = null;
  let final: Awaited<ReturnType<typeof finalPreflight>> | null = null;
  let pending: string[] = [];
  if (scope === RESUME_SCOPE) {
    const frozen = verifyResumePlan();
    durable = new DurableJournal(RESUME_JOURNAL, frozen.binding,
      [process.env.SALON_SECRETARY_OPENAI_API_KEY ?? "", process.env.TYPESAFE_API_KEY ?? "",
        process.env.DATABASE_URL ?? "", process.env.DIRECT_URL ?? ""]);
    try { pending = resumeCursor(durable.rows); resume = await resumePreflight(admin, runtime, durable.rows); }
    catch (error) { durable.close(); throw error; }
  }
  if (scope === FINAL_CONTINUATION_SCOPE) {
    const frozen = verifyFinalPlan();
    durable = new DurableJournal(FINAL_JOURNAL, frozen.binding,
      [process.env.SALON_SECRETARY_OPENAI_API_KEY ?? "", process.env.TYPESAFE_API_KEY ?? "",
        process.env.DATABASE_URL ?? "", process.env.DIRECT_URL ?? ""],
      { ids: FINAL_CONTINUATION_IDS, maxRequests: 16, allowNetworkInconclusive: true });
    try { pending = resumeCursor(durable.rows, FINAL_CONTINUATION_IDS, true);
      final = await finalPreflight(admin, runtime, durable.rows); }
    catch (error) { durable.close(); throw error; }
  }
  const continuation = scope === CONTINUATION_SCOPE ? await phaseAContinuationPreflight(admin, runtime) : null;
  const { plan, identity } = final ?? resume ?? continuation ?? await phaseAPreflight(admin, runtime);
  if (process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false" ||
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED !== "false") stop("FLAGS_UNSAFE");
  const cases = scope === "REVALIDATE_I01" ? plan.cases.filter(c => c.case_id === "i01") :
    resume || final ? plan.cases.filter(c => pending.includes(c.case_id)) : plan.cases;
  if (scope === "REVALIDATE_I01" && (cases.length !== 1 || cases[0].turns.length !== 1 ||
    cases[0].turns[0].message !== "Agenda o Alisson pra amanhã.")) stop("I01_SCOPE_DRIFT");
  if (scope === CONTINUATION_SCOPE) assertContinuationCaseScope(cases);
  if (scope === FINAL_CONTINUATION_SCOPE && cases.some(c => !FINAL_CONTINUATION_IDS.includes(c.case_id)))
    stop("FINAL_SCOPE_FORBIDDEN");
  const witness = new PhaseAWireWitness(scope);
  if (durable) durable.rows.filter(r => r.kind === "BEFORE_NETWORK").forEach(() => witness.budget.reserve(0, 1));
  let activeCase: string | null = null, activeTurn: number | null = null;
  const persist = (kind: Parameters<DurableJournal["append"]>[0], data: unknown) =>
    durable?.append(kind, activeCase, activeTurn, data);
  const diagnostics = new PhaseAOpenAIErrorObserver();
  const counters = emptyIndependentCounters();
  installPhaseAWriteWitness(prisma, counters);
  const records: CaseRecord[] = [];
  const originalFetch = globalThis.fetch;
  let stopped: string | null = null;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.openai.com/v1/responses") stop("UNEXPECTED_NETWORK");
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof body !== "string") throw Error("PHASE_A_STOP:WIRE_BODY_MISSING");
    witness.beforeNetwork({ url, method: (init?.method ?? (input instanceof Request ? input.method : "")).toUpperCase(), body });
    if (durable) {
      await resumeHealth(runtime, true);
      if (final) verifyFinalPlan(); else verifyResumePlan();
      persist("BEFORE_NETWORK", { ...witness.records.at(-1), tool_types: ["function"] }); // fsync MUST finish before originalFetch.
    }
    counters.openai_requests++;
    const began = performance.now();
    try {
      const response = await originalFetch(input, init);
      try { diagnostics.observeHttp(response, performance.now() - began); }
      catch { /* Diagnostic observation cannot change a provider response. */ }
      const requestId = response.headers.get("x-request-id");
      persist("AFTER_NETWORK", { http_status: response.status,
        request_id: requestId && /^req_[a-zA-Z0-9_-]{1,180}$/.test(requestId) ? requestId : null,
        latency_ms: performance.now() - began });
      return response;
    } catch (error) {
      try { diagnostics.observeTransport(error, performance.now() - began); }
      catch { /* Diagnostic observation cannot change a transport error. */ }
      persist("AFTER_NETWORK", { transport_failed: true, latency_ms: performance.now() - began });
      throw error;
    }
  };
  try {
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "true";
    await withPhaseAClock(async () => {
      for (const c of cases) {
        activeCase = null; activeTurn = null;
        if ((resume || final) && durable) {
          if (final) verifyFinalPlan(); else verifyResumePlan();
          await resumeHealth(runtime, true);
          if (witness.budget.calls >= (final ? 16 : 17)) stop("BUDGET_EXCEEDED");
          const current = await captureResumeState(admin);
          const previous = durable.rows.findLast(r => r.kind === "CASE_COMPLETED" ||
            (final && r.kind === "INCONCLUSIVE" && (r.data as { reason?: string })?.reason === "NETWORK"));
          const expected = previous ? (previous.data as { baseline: typeof current }).baseline : (final ?? resume)!.baseline;
          if (JSON.stringify(current) !== JSON.stringify(expected)) stop("RESUME_BASELINE_DRIFT");
        }
        activeCase = c.case_id;
        if (durable) persist("STARTED", { turns: c.turns.length });
        if (continuation) {
          verifyPhaseAContinuation(PROJECT_ROOT);
          if (c.case_id === "i01") stop("CONTINUATION_I01_FORBIDDEN");
        } else if (final) verifyFinalPlan(); else verifyPhaseA(PROJECT_ROOT);
        const fixture = makeFixture(c.case_id, c.fixture);
        const resumeAudit = final?.current.operational.find(r => r.case_id === c.case_id) ??
          resume?.baseline.operational.find(r => r.case_id === c.case_id);
        await precheckPhaseACase(admin, runtime, fixture, resumeAudit ? { kind: "APPROVED_RESUME_HISTORY",
          case_id: c.case_id, count: resumeAudit.technical_audits, technical_audit_hash: resumeAudit.technical_audit_hash! } : undefined);
        if (continuation) assertOperationalBaseline(c.case_id, await snapshotPhaseACase(admin, fixture),
          continuation.baseline.operational.find(row => row.case_id === c.case_id));
        const actor = { salonId: fixture.tenant, userId: fixture.actor };
        const communication = new FakeCommunicationProvider();
        const secretary = new SalonSecretary(async (): Promise<Model> => {
          const model = await createPaidModel(process.env);
          return { getResponse: async request => {
            let response;
            const began = performance.now();
            try { response = await observeModelGetResponse(model, request, diagnostics); }
            catch (error) {
              persist("MODEL_FAILED", { diagnostic: diagnostics.lastFor(c.case_id, activeTurn ?? 1),
                network_requests_observed: witness.records.filter(r => r.case_id === c.case_id && r.turn_index === activeTurn).length });
              throw error;
            }
            const usage = modelCallUsage("gpt-6-luna", "SUCCEEDED", response);
            persist("MODEL_COMPLETED", { usage, estimated_cost_usd: routerLunaCost(usage),
              latency_ms: performance.now() - began });
            // Independent model-output observation; business executors remain unavailable to the runner.
            counters.tool_executions += response.output.filter(item => item.type === "function_call").length;
            return response;
          }, async *getStreamedResponse(): AsyncGenerator<never> { throw Error("STREAM_NOT_SUPPORTED"); } };
        },
          () => "gpt-6-luna", communication, { enabled: () => false, paidCallsAllowed: () => false });
        let router: RouterEvidence | null = null;
        let turn = 0;
        const seenRouterAudits = new Set<string>();
        let journalBefore = await snapshotPhaseACase(admin, fixture);
        let journalDelta = comparePhaseAJournal(journalBefore, journalBefore);
        const boundary: SecretaryBoundary = {
          start: secretary.start.bind(secretary),
          send: async (context, input) => {
            try {
              return await secretary.send(context, input);
            } finally {
              const after = await snapshotPhaseACase(admin, fixture);
              journalDelta = comparePhaseAJournal(journalBefore, after);
              journalBefore = after;
              counters.confirmations += journalDelta.counters.confirmations;
              counters.external_messages = communication.calls.length;
              const audits = await admin.auditLog.findMany({ where: { salonId: fixture.tenant,
                entityType: "SECRETARY_ROUTER" }, select: { id: true, metadata: true }, orderBy: { createdAt: "asc" } });
              const fresh = audits.find(row => !seenRouterAudits.has(row.id));
              if (fresh) { seenRouterAudits.add(fresh.id); router = fresh.metadata as RouterEvidence; }
            }
          },
        };
        const bridge = new RuntimeObservationBridge({ secretary: boundary, actor, fixture, allowedTurns: c.turns,
          onCapture: durable ? capture => {
            for (const event of capture.events) persist("OBSERVATION_EVENT", { conversation_ref: capture.conversation_ref, event });
            persist("OBSERVATION_COMPLETED", capture);
          } : undefined,
          routerEvidence: () => router,
          wireEvidence: () => witness.lastFor(c.case_id, turn),
          effectEvidence: () => ({ confirmations: counters.confirmations,
            business_writes: Math.max(counters.operational_writes, journalDelta.counters.operational_writes),
            outbox_writes: Math.max(counters.outbox_creations, journalDelta.counters.outbox_creations),
            external_messages: communication.calls.length }),
        });
        const conversation_ref = await bridge.open();
        let draft_refs: Record<string, string> = {};
        for (const t of c.turns) {
          if (continuation) verifyPhaseAContinuation(PROJECT_ROOT);
          else if (final) verifyFinalPlan(); else verifyPhaseA(PROJECT_ROOT);
          turn = t.turn; activeTurn = turn;
          if (durable) { await resumeHealth(runtime, true); persist("TURN_STARTED", { conversation_ref, draft_refs }); }
          const input: TurnInput = { conversation_ref, turn_index: turn, draft_refs: Object.freeze({ ...draft_refs }), message: t.message };
          assertPayloadSeparation(input, fixture);
          witness.expectTurn(c.case_id, turn, turn === 1 ? "select_capabilities" : "upsert_action_draft",
            forbiddenFixtureValues(fixture));
          diagnostics.expectTurn(c.case_id, turn);
          const beforeNetwork = counters.openai_requests, beforeTools = counters.tool_executions, began = performance.now();
          let capture: TurnCapture | undefined;
          try { capture = (await bridge.send(input)).capture; }
          catch (error) {
            capture = bridge.captures.at(-1);
            stopped = knownPreNetworkFailure(error) ?? stopped;
            if (!capture || capture.turn_index !== turn) stopped = "UNKNOWN_CONTRACT_DRIFT";
          }
          finally { witness.clearTurn(); diagnostics.clearTurn(); }
          if (!capture) throw Error(`PHASE_A_STOP:${stopped ?? "MISSING_CAPTURE"}`);
          draft_refs = capture.draft_refs;
          const reason = observationStopReason(capture);
          const networkDelta = counters.openai_requests - beforeNetwork;
          if (networkDelta > 1 || witness.records.filter(row => row.case_id === c.case_id && row.turn_index === turn).length !== networkDelta)
            stopped = "WIRE_NETWORK_COUNT_MISMATCH";
          if (counters.operational_writes || journalDelta.counters.operational_writes || counters.confirmations ||
            counters.outbox_creations || journalDelta.counters.outbox_creations || communication.calls.length)
            stopped = "OPERATIONAL_EFFECT";
          if (reason && !stopped) stopped = reason;
          const operationSequenceMatch = turn === c.turns.length
            ? c.expected.actions.map(action => action.operation).join("\u0000") ===
              capture.operations.map(operation => operation.operation ?? "").join("\u0000")
            : null;
          const missingCheck = turn === 1 ? assessPhaseAMissingFields(c.expected.minimum_clarification_fields, capture) : null;
          if (missingCheck?.invented_critical_fields.length) stopped = "INVENTED_FIELD";
          if (missingCheck?.unsafe_proposal) stopped = "UNSAFE_PROPOSAL";
          records.push({ case_id: c.case_id, turn_index: turn, capture, journal: journalDelta,
            openai_network_requests: networkDelta, local_function_tool_executions: counters.tool_executions - beforeTools,
            latency_ms: performance.now() - began, operation_sequence_match: operationSequenceMatch,
            independent_missing_field_check: missingCheck,
            provider_diagnostic: diagnostics.lastFor(c.case_id, turn), stop_reason: stopped });
          persist("TURN_COMPLETED", records.at(-1));
          if (stopped) break;
        }
        if (final && stopped === "PROVIDER_ERROR_OR_TIMEOUT") {
          const last = records.at(-1);
          const diagnostic = last?.provider_diagnostic;
          const capture = last?.capture;
          const before = durable!.rows.findLast(r => r.kind === "STARTED" && r.case_id === c.case_id);
          const networkEvidence = durable!.rows.some(r => r.kind === "AFTER_NETWORK" && r.case_id === c.case_id &&
            r.turn_index === last?.turn_index && (r.data as { transport_failed?: boolean })?.transport_failed === true);
          const isolated = !!before && !!capture && diagnostic?.category === "NETWORK" &&
            diagnostic.transport_category === "NETWORK" && diagnostic.http_status === null &&
            !diagnostic.timeout && !diagnostic.abort && !diagnostic.evidence_conflict && networkEvidence &&
            last?.openai_network_requests === 1 && capture.failure_code === "MODEL_REQUEST_FAILED" &&
            capture.wire_guard === "PASS" && capture.router_guard === "PASS" && capture.jev_called === false &&
            capture.effects !== null && capture.effects.business_writes === 0 && capture.effects.confirmations === 0 &&
            capture.effects.outbox_writes === 0 && capture.effects.external_messages === 0 &&
            !Object.entries(capture.safety).some(([key, value]) => value === "FAIL" &&
              ["INVENTED_FIELD", "WRONG_ENTITY_AUTO_SELECTED", "UNSAFE_PROPOSAL", "UNSAFE_EXECUTION",
                "DRAFT_CONTINUITY_FAILURE", "DEPENDENCY_FAILURE", "CROSS_TENANT_VISIBILITY"].includes(key));
          if (isolated) {
            await resumeHealth(runtime, true);
            const baseline = await captureResumeState(admin);
            const previous = durable!.rows.findLast(r => r.kind === "CASE_COMPLETED" ||
              (r.kind === "INCONCLUSIVE" && (r.data as { reason?: string })?.reason === "NETWORK"));
            await assertFinalCaseState(admin, previous ? (previous.data as { baseline: typeof baseline }).baseline : final.baseline,
              baseline, c.case_id);
            persist("INCONCLUSIVE", { reason: "NETWORK", baseline, diagnostic });
            stopped = null;
            continue; // The failed case is terminal and immutable; only later independent cases run.
          }
        }
        if (!stopped && durable) {
          const baseline = await captureResumeState(admin);
          if (final) {
            const previous = durable.rows.findLast(r => r.kind === "CASE_COMPLETED" ||
              (r.kind === "INCONCLUSIVE" && (r.data as { reason?: string })?.reason === "NETWORK"));
            await assertFinalCaseState(admin, previous ? (previous.data as { baseline: typeof baseline }).baseline : final.baseline,
              baseline, c.case_id);
          } else if (!resume || baseline.operational.some((r, i) => JSON.stringify(r.hashes) !== JSON.stringify(resume!.baseline.operational[i].hashes) ||
            JSON.stringify(r.counts) !== JSON.stringify(resume!.baseline.operational[i].counts) || r.confirmations !== 0)) stop("OPERATIONAL_EFFECT");
          persist("CASE_COMPLETED", { baseline });
        }
        if (stopped) break;
      }
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    stopped = /^PHASE_A_STOP:[A-Z0-9_]+$/.test(code) ? code.slice("PHASE_A_STOP:".length) :
      /^PHASE_A_[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN_CONTRACT_DRIFT";
  } finally {
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
    globalThis.fetch = originalFetch;
    if (durable) {
      try {
        if (stopped) {
          if (activeCase && checkpoint(durable.rows, activeCase) !== "CASE_COMPLETED") persist("INCONCLUSIVE", { reason: stopped });
          durable.append("STOPPED", null, null, { reason: stopped });
        }
      } finally { durable.close(); }
    }
  }
  return { status: stopped ? "STOPPED" : "COMPLETED", stopped, scope, identity, manifest_sha256: PHASE_A_SHA256,
    executed_turns: records.length, records, counters, witness: witness.records,
    provider_diagnostics: diagnostics.records,
    budget: { requests: witness.budget.calls, reserved_usd: witness.budget.reservedUsd } };
}
