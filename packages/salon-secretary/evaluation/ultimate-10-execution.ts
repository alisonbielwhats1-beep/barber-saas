/** Paid entry is deliberately separate from --prepare/--preflight. Never exposes a confirm operation. */
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { createPaidModel, type Model } from "../src";
import { SalonSecretary } from "../../../src/lib/salon-secretary";
import { prisma } from "../../../src/lib/prisma";
import { FakeCommunicationProvider } from "../../../src/lib/communication-provider";
import { routerLunaCost } from "../../../src/lib/secretary-router";
import { modelCallUsage } from "../src/usage";
import { RuntimeObservationBridge, observationStopReason, type RouterEvidence, type SecretaryBoundary,
  type TurnCapture } from "./hard-conversations-observation-bridge";
import { assertPayloadSeparation, type TurnInput } from "./hard-conversations-runner";
import { PhaseAWireWitness } from "./hard-conversations-phase-a-witness";
import { PhaseAOpenAIErrorObserver, observeModelGetResponse } from "./hard-conversations-openai-diagnostic";
import { withPhaseAClock } from "./hard-conversations-phase-a-execution";
import { assertPhaseAEnvironment, comparePhaseAJournal, emptyIndependentCounters,
  installPhaseAWriteWitness, snapshotPhaseACase } from "./hard-conversations-phase-a-db";
import { checkpoint, readDurable, resumeCursor } from "./hard-conversations-durable";
import { resumeHealth } from "./hard-conversations-phase-a-resume";
import { inspectUltimate10Turn } from "./ultimate-10-observation";
import { classifyPostHttpFailure, inspectPostHttpResponse, safeExceptionClass, witnessSdkResponse,
  type PostHttpStage, type SafePostHttpMetadata } from "./ultimate-10-post-http";
import { ultimate10Cases, ULTIMATE10_SHA256, verifyUltimate10Plan } from "./ultimate-10";
import { refuseUnwiredPaidPath } from "./program-spend";
import { inspectUltimate10CaseState, openUltimate10Journal, readUltimate10Baseline,
  ultimate10Fixture, ULTIMATE10_IDS, ULTIMATE10_JOURNAL, ultimate10Preflight,
  ultimate10ResumePreflight, ULTIMATE10_REVALIDATION_JOURNAL, ultimate10U01RevalidationPreflight,
  openUltimate10U01RevalidationJournal, readUltimate10U01History,
  assertUltimate10RevalidationRequest, ULTIMATE10_CONTINUATION_IDS, ULTIMATE10_CONTINUATION_JOURNAL,
  ULTIMATE10_CONTINUATION_SHA256, verifyUltimate10ContinuationPlan,
  ultimate10ContinuationPreflight, openUltimate10ContinuationJournal,
  readUltimate10U01RevalidationHistory } from "./ultimate-10-harness";

const fail = (code: string): never => { throw Error(`ULTIMATE10_STOP:${code}`); };
function forbiddenValues(caseId: string) {
  const f = ultimate10Fixture(caseId);
  return [f.tenant, f.foreignTenant, f.actor, ...f.customers.map(x => x.id),
    ...f.services.map(x => x.id), ...f.professionals.map(x => x.id), ...f.products.map(x => x.id),
    ...f.appointments.map(x => x.id), process.env.SALON_SECRETARY_OPENAI_API_KEY ?? "",
    process.env.SALON_SECRETARY_OPENAI_PROJECT ?? "", process.env.TYPESAFE_API_KEY ?? "",
    process.env.DATABASE_URL ?? "", process.env.DIRECT_URL ?? ""];
}
function preNetworkCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message === "BUDGET_EXCEEDED" ? "BUDGET_EXCEEDED" :
    message === "PAYLOAD_LEAK" ? "PAYLOAD_LEAK" :
      message.startsWith("WIRE_") || message.startsWith("SECRETARY_OPENAI_COST_GUARD:") ?
        "WIRE_CONTRACT_VIOLATION" : null;
}

/** The command invoking this function must carry a fresh explicit execution approval. */
export async function executeUltimate10(admin: PrismaClient, runtime: PrismaClient, resume = false) {
  return executeUltimate10Mode(admin, runtime, resume ? "RESUME" : "INITIAL");
}

/** This entry can run u01 once only, and never resumes the ten-case cursor. */
export async function revalidateUltimate10U01(admin: PrismaClient, runtime: PrismaClient) {
  return executeUltimate10Mode(admin, runtime, "REVALIDATION_U01");
}

/** Separate one-way cursor: neither historical u01 attempt can enter this scope. */
export async function continueUltimate10U02U10(admin: PrismaClient, runtime: PrismaClient) {
  return executeUltimate10Mode(admin, runtime, "CONTINUATION_U02_U10");
}

async function executeUltimate10Mode(admin: PrismaClient, runtime: PrismaClient,
  mode: "INITIAL" | "RESUME" | "REVALIDATION_U01" | "CONTINUATION_U02_U10") {
  const revalidation = mode === "REVALIDATION_U01";
  const continuation = mode === "CONTINUATION_U02_U10";
  if (process.env.ULTIMATE10_REAL_EXECUTION_APPROVED !== "true" ||
    mode === "RESUME" && process.env.ULTIMATE10_RESUME_APPROVED !== "true" ||
    revalidation && process.env.ULTIMATE10_REVALIDATE_U01_APPROVED !== "true" ||
    continuation && process.env.ULTIMATE10_CONTINUATION_U02_U10_APPROVED !== "true") fail("NOT_AUTHORIZED");
  refuseUnwiredPaidPath(); // not admitted by the program real-spend ledger
  verifyUltimate10Plan(process.cwd());
  assertPhaseAEnvironment();
  const existing = readDurable(continuation ? ULTIMATE10_CONTINUATION_JOURNAL :
    revalidation ? ULTIMATE10_REVALIDATION_JOURNAL : ULTIMATE10_JOURNAL,
    continuation ? ULTIMATE10_CONTINUATION_SHA256 : ULTIMATE10_SHA256);
  if (mode === "INITIAL") await ultimate10Preflight(admin, runtime);
  else if (mode === "RESUME") {
    if (!existing.length) fail("RESUME_EMPTY");
    await ultimate10ResumePreflight(admin, runtime, existing, false);
  } else if (revalidation) await ultimate10U01RevalidationPreflight(admin, runtime);
  else {
    if (existing.length) fail("CONTINUATION_ALREADY_STARTED");
    await ultimate10ContinuationPreflight(admin, runtime);
  }
  const durable = continuation ? openUltimate10ContinuationJournal() :
    revalidation ? openUltimate10U01RevalidationJournal() : openUltimate10Journal();
  let activeCase: string | null = null, activeTurn: number | null = null;
  const persist = (kind: Parameters<typeof durable.append>[0], data: unknown) =>
    durable.append(kind, activeCase, activeTurn, data);
  let postHttpMeta: SafePostHttpMetadata | null = null, postHttpStage: PostHttpStage | null = null;
  const reached = (stage: PostHttpStage) => {
    postHttpStage = stage;
    persist("OBSERVATION_EVENT", { stage });
  };
  let stopped: string | null = null;
  const witness = new PhaseAWireWitness("ULTIMATE_10");
  const diagnostics = new PhaseAOpenAIErrorObserver();
  const counters = emptyIndependentCounters();
  const results: { case_id: string; turn_index: number; capture: TurnCapture;
    inspection: ReturnType<typeof inspectUltimate10Turn>; provider_diagnostic: ReturnType<typeof diagnostics.lastFor>;
    latency_ms: number; journal: ReturnType<typeof comparePhaseAJournal> }[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const pending = revalidation ? ["u01"] : continuation ? [...ULTIMATE10_CONTINUATION_IDS] :
      resumeCursor(durable.rows, ULTIMATE10_IDS, true);
    durable.rows.filter(row => row.kind === "BEFORE_NETWORK").forEach(() => witness.budget.reserve(0, 1));
    installPhaseAWriteWitness(prisma, counters);
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://api.openai.com/v1/responses") fail("UNEXPECTED_NETWORK");
      const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
      if (typeof body !== "string") throw Error("ULTIMATE10_STOP:WIRE_BODY_MISSING");
      if (revalidation) assertUltimate10RevalidationRequest(activeCase, activeTurn,
        counters.openai_requests, witness.records.length);
      if (continuation && (!activeCase || !ULTIMATE10_CONTINUATION_IDS.includes(activeCase) ||
        activeTurn === null || counters.openai_requests >= 10 || witness.records.length >= 10))
        fail("CONTINUATION_REQUEST_SCOPE");
      witness.beforeNetwork({ url, method: (init?.method ?? (input instanceof Request ? input.method : "")).toUpperCase(), body });
      await resumeHealth(runtime, true);
      verifyUltimate10Plan(process.cwd());
      if (revalidation) readUltimate10U01History();
      if (continuation) { verifyUltimate10ContinuationPlan(); readUltimate10U01RevalidationHistory(); }
      persist("BEFORE_NETWORK", { ...witness.records.at(-1), tool_types: ["function"] });
      counters.openai_requests++;
      const began = performance.now();
      let response: Response;
      try {
        response = await originalFetch(input, init);
      } catch (error) {
        diagnostics.observeTransport(error, performance.now() - began);
        persist("AFTER_NETWORK", { transport_failed: true, latency_ms: performance.now() - began });
        throw error;
      }
      diagnostics.observeHttp(response, performance.now() - began);
      const requestId = response.headers.get("x-request-id");
      persist("AFTER_NETWORK", { http_status: response.status,
        request_id: requestId && /^req_[A-Za-z0-9_-]{1,180}$/.test(requestId) ? requestId : null,
        latency_ms: performance.now() - began });
      reached("HTTP_RESPONSE_RECEIVED");
      postHttpMeta = await inspectPostHttpResponse(response);
      persist("OBSERVATION_EVENT", { stage: "POST_HTTP_WITNESS", metadata: postHttpMeta });
      if (postHttpMeta.json_state === "OBJECT" || postHttpMeta.json_state === "OTHER") reached("HTTP_BODY_PARSED");
      return response;
    };
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "true";
    await withPhaseAClock(async () => {
      for (const id of pending) {
        activeCase = null; activeTurn = null;
        if (revalidation) {
          if (id !== "u01" || durable.rows.length !== 0) fail("U01_REVALIDATION_SCOPE");
          await resumeHealth(runtime, true);
          readUltimate10U01History();
        } else if (continuation) await ultimate10ContinuationPreflight(admin, runtime, durable.rows, true);
        else await ultimate10ResumePreflight(admin, runtime, durable.rows, true);
        verifyUltimate10Plan(process.cwd());
        activeCase = id;
        const c = ultimate10Cases.find(spec => spec.case_id === id)!;
        persist("STARTED", { turns: c.turns.length, capability: c.capability,
          ...(revalidation ? { attempt: "REVALIDATION_U01" } : {}) });
        const fixture = ultimate10Fixture(id);
        const actor = { salonId: fixture.tenant, userId: fixture.actor };
        const communication = new FakeCommunicationProvider();
        const secretary = new SalonSecretary(async (): Promise<Model> => {
          const model = witnessSdkResponse(await createPaidModel(process.env), reached);
          return { getResponse: async request => {
            const began = performance.now();
            let agentResponseCreated = false;
            try {
              const response = await observeModelGetResponse(model, request, diagnostics);
              reached("AGENT_MODEL_RESPONSE_CREATED");
              agentResponseCreated = true;
              const usage = modelCallUsage("gpt-6-luna", "SUCCEEDED", response);
              persist("MODEL_COMPLETED", { usage, estimated_cost_usd: routerLunaCost(usage),
                latency_ms: performance.now() - began });
              counters.tool_executions += response.output.filter(item => item.type === "function_call").length;
              return response;
            } catch (error) {
              const category = classifyPostHttpFailure(postHttpMeta, postHttpStage, error,
                agentResponseCreated ? "USAGE" : "MODEL");
              persist("OBSERVATION_EVENT", { stage: "POST_HTTP_FAILURE", category,
                last_reached: postHttpStage, exception_class: safeExceptionClass(error) });
              persist("MODEL_FAILED", { diagnostic: diagnostics.lastFor(id, activeTurn ?? 1),
                post_http_category: category, exception_class: safeExceptionClass(error), last_reached: postHttpStage });
              throw error;
            }
          }, async *getStreamedResponse(): AsyncGenerator<never> { throw Error("STREAM_NOT_SUPPORTED"); } };
        }, () => "gpt-6-luna", communication, { enabled: () => false, paidCallsAllowed: () => false });
        let router: RouterEvidence | null = null;
        const seenRouterAudits = new Set<string>();
        let journalBefore = await snapshotPhaseACase(admin, fixture);
        let journalDelta = comparePhaseAJournal(journalBefore, journalBefore);
        const boundary: SecretaryBoundary = { start: secretary.start.bind(secretary),
          send: async (context, input) => {
            try { return await secretary.send(context, input); }
            finally {
              const after = await snapshotPhaseACase(admin, fixture);
              journalDelta = comparePhaseAJournal(journalBefore, after);
              journalBefore = after;
              counters.confirmations += journalDelta.counters.confirmations;
              counters.external_messages = communication.calls.length;
              const audits = await admin.auditLog.findMany({ where: { salonId: fixture.tenant,
                entityType: "SECRETARY_ROUTER" }, select: { id: true, metadata: true },
              orderBy: { createdAt: "asc" } });
              const fresh = audits.find(row => !seenRouterAudits.has(row.id));
              if (fresh) { seenRouterAudits.add(fresh.id); router = fresh.metadata as RouterEvidence; }
            }
          } };
        const bridge = new RuntimeObservationBridge({ secretary: boundary, actor, fixture,
          allowedTurns: c.turns.map(turn => ({ turn: turn.turn_index, message: turn.message })),
          onCapture: capture => {
            if (capture.failure_code === null && postHttpStage === "AGENT_MODEL_RESPONSE_CREATED" &&
              durable.rows.some(row => row.case_id === id && row.turn_index === activeTurn && row.kind === "MODEL_COMPLETED")) {
              reached("TOOL_CALL_VALIDATED");
              reached("MODEL_RESULT_READY");
            } else if (capture.failure_code !== null && postHttpStage === "AGENT_MODEL_RESPONSE_CREATED" && postHttpMeta) {
              const category = classifyPostHttpFailure(postHttpMeta, postHttpStage, null);
              if (category === "TOOL_CALL_SCHEMA_ERROR" || category === "MODEL_OUTPUT_INVALID")
                persist("OBSERVATION_EVENT", { stage: "POST_HTTP_FAILURE", category,
                  last_reached: postHttpStage, exception_class: "[NOT_OBSERVED_BY_BRIDGE]" });
            }
            for (const event of capture.events) persist("OBSERVATION_EVENT", { conversation_ref: capture.conversation_ref, event });
            persist("OBSERVATION_COMPLETED", capture);
          },
          routerEvidence: () => router,
          wireEvidence: () => witness.lastFor(id, activeTurn ?? 1),
          effectEvidence: () => ({ confirmations: counters.confirmations,
            business_writes: Math.max(counters.operational_writes, journalDelta.counters.operational_writes),
            outbox_writes: Math.max(counters.outbox_creations, journalDelta.counters.outbox_creations),
            external_messages: communication.calls.length }),
        });
        const conversationRef = await bridge.open();
        let draftRefs: Record<string, string> = {};
        for (const turn of c.turns) {
          await resumeHealth(runtime, true);
          verifyUltimate10Plan(process.cwd());
          activeTurn = turn.turn_index;
          postHttpMeta = null; postHttpStage = null;
          persist("TURN_STARTED", { conversation_ref: conversationRef, draft_refs: draftRefs });
          const input: TurnInput = { conversation_ref: conversationRef, draft_refs: Object.freeze({ ...draftRefs }),
            turn_index: turn.turn_index, message: turn.message };
          assertPayloadSeparation(input, fixture);
          witness.expectTurn(id, turn.turn_index, turn.turn_index === 1 ? "select_capabilities" :
            "upsert_action_draft", forbiddenValues(id));
          diagnostics.expectTurn(id, turn.turn_index);
          const beforeRequests = counters.openai_requests, began = performance.now();
          let capture: TurnCapture | undefined;
          try { capture = (await bridge.send(input)).capture; }
          catch (error) {
            capture = bridge.captures.at(-1);
            stopped = preNetworkCode(error) ?? stopped;
            if (!capture || capture.turn_index !== turn.turn_index) stopped = "UNKNOWN_CONTRACT_DRIFT";
          } finally { witness.clearTurn(); diagnostics.clearTurn(); }
          if (!capture) throw Error(`ULTIMATE10_STOP:${stopped ?? "MISSING_CAPTURE"}`);
          draftRefs = capture.draft_refs;
          const inspection = inspectUltimate10Turn(c, turn.turn_index, capture);
          const networkDelta = counters.openai_requests - beforeRequests;
          if (networkDelta > 1 || witness.records.filter(row => row.case_id === id &&
            row.turn_index === turn.turn_index).length !== networkDelta) stopped = "WIRE_NETWORK_COUNT_MISMATCH";
          if (counters.operational_writes || journalDelta.counters.operational_writes || counters.confirmations ||
            counters.outbox_creations || journalDelta.counters.outbox_creations || communication.calls.length)
            stopped = "OPERATIONAL_EFFECT";
          const reason = observationStopReason(capture);
          if (reason && !stopped) stopped = reason;
          const record = { case_id: id, turn_index: turn.turn_index, capture, inspection,
            provider_diagnostic: diagnostics.lastFor(id, turn.turn_index),
            latency_ms: performance.now() - began, journal: journalDelta };
          results.push(record);
          persist("TURN_COMPLETED", record);
          if (stopped) break;
        }
        if (stopped === "PROVIDER_ERROR_OR_TIMEOUT") {
          const last = results.at(-1), diagnostic = last?.provider_diagnostic;
          const transport = durable.rows.some(row => row.case_id === id && row.kind === "AFTER_NETWORK" &&
            row.turn_index === last?.turn_index && (row.data as { transport_failed?: boolean })?.transport_failed);
          const isolated = diagnostic?.category === "NETWORK" && diagnostic.http_status === null &&
            !diagnostic.timeout && !diagnostic.abort && !diagnostic.evidence_conflict && transport &&
            last?.capture.failure_code === "MODEL_REQUEST_FAILED" &&
            last.capture.wire_guard === "PASS" && last.capture.router_guard === "PASS" &&
            last.capture.jev_called === false && last.capture.effects !== null &&
            Object.values(last.capture.effects).every(n => n === 0) &&
            last.inspection.unsafe_metrics.length === 0;
          if (isolated) {
            await resumeHealth(runtime, true);
            const snapshot = await inspectUltimate10CaseState(admin, runtime, durable.rows,
              readUltimate10Baseline(), id,
              continuation ? { u01: readUltimate10U01RevalidationHistory() } : undefined);
            persist("INCONCLUSIVE", { reason: "NETWORK", snapshot, diagnostic });
            if (revalidation) { stopped = "PROVIDER_ERROR_OR_TIMEOUT"; break; }
            stopped = null; continue;
          }
          if (continuation && last?.capture.failure_code === "MODEL_REQUEST_FAILED" &&
            last.capture.wire_guard === "PASS" && last.capture.router_guard === "PASS" &&
            last.capture.jev_called === false && last.capture.effects !== null &&
            Object.values(last.capture.effects).every(n => n === 0) &&
            last.inspection.unsafe_metrics.length === 0 && diagnostic?.http_status === 200 &&
            postHttpMeta?.http_status === 200 &&
            !durable.rows.some(row => row.case_id === id && row.kind === "MODEL_COMPLETED")) {
            const failure = durable.rows.findLast(row => row.case_id === id &&
              row.turn_index === last.turn_index && row.kind === "MODEL_FAILED");
            const category = (failure?.data as { post_http_category?: string } | undefined)?.post_http_category;
            if (["HTTP_SUCCESS_INVALID_BODY", "SDK_PARSE_ERROR", "MODEL_OUTPUT_INVALID",
              "TOOL_CALL_SCHEMA_ERROR", "RESPONSE_INCOMPLETE", "AGENT_ADAPTER_ERROR",
              "USAGE_PARSE_ERROR"].includes(category ?? "")) {
              await resumeHealth(runtime, true);
              const snapshot = await inspectUltimate10CaseState(admin, runtime, durable.rows,
                readUltimate10Baseline(), id, { u01: readUltimate10U01RevalidationHistory() });
              persist("INCONCLUSIVE", { reason: "KNOWN_FAIL_CLOSED_POST_HTTP", category, snapshot,
                diagnostic });
              stopped = null; continue;
            }
          }
        }
        if (stopped) break;
        const snapshot = await inspectUltimate10CaseState(admin, runtime, durable.rows,
          readUltimate10Baseline(), id,
          continuation ? { u01: readUltimate10U01RevalidationHistory() } : undefined);
        persist("CASE_COMPLETED", { snapshot, functional_result: "UNKNOWN_PENDING_REVIEW" });
      }
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    stopped = /^ULTIMATE10_STOP:[A-Z0-9_]+$/.test(code) ? code.slice(16) :
      /^ULTIMATE10_[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN_CONTRACT_DRIFT";
  } finally {
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
    globalThis.fetch = originalFetch;
    try {
      if (stopped) {
        if (activeCase && checkpoint(durable.rows, activeCase) !== "CASE_COMPLETED" &&
          checkpoint(durable.rows, activeCase) !== "INCONCLUSIVE")
          persist("INCONCLUSIVE", { reason: stopped });
        durable.append("STOPPED", null, null, { reason: stopped });
      }
    } finally { durable.close(); }
  }
  return { status: stopped ? "STOPPED" as const : "COMPLETED" as const, stopped,
    manifest_sha256: continuation ? ULTIMATE10_CONTINUATION_SHA256 : ULTIMATE10_SHA256,
    attempt: revalidation ? "REVALIDATION_U01" as const : null,
    cases: revalidation ? 1 : continuation ? ULTIMATE10_CONTINUATION_IDS.length : ULTIMATE10_IDS.length,
    executed_turns: results.length, records: results, counters, witness: witness.records,
    provider_diagnostics: diagnostics.records,
    budget: { requests: witness.budget.calls, reserved_usd: witness.budget.reservedUsd },
    checkpoint: Object.fromEntries((revalidation ? ["u01"] :
      continuation ? ULTIMATE10_CONTINUATION_IDS : ULTIMATE10_IDS)
      .map(id => [id, checkpoint(durable.rows, id)])) };
}
