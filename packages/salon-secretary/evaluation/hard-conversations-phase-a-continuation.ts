/** Frozen, evaluation-only continuation of Phase A after the approved i01 run. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import type { AuditLog } from "@prisma/client";
import { makeFixture } from "./hard-conversations-fixtures";
import { buildPhaseAPlan, PHASE_A_PLAN, PHASE_A_SHA256, verifyPhaseA } from "./hard-conversations-phase-a";
import type { OperationalSnapshot } from "./hard-conversations-phase-a-db";

export const CONTINUATION_SCOPE = "PHASE_A_CONTINUATION_I02_I26" as const;
export const CONTINUATION_PLAN = "packages/salon-secretary/evaluation/hard-conversations-phase-a-continuation.json";
export const CONTINUATION_PLAN_SHA256 = "25fabe2e60163bc61764bbeabf8d5fad3a5bcd2cca008d5377ddc54374c63582";
export const CONTINUATION_BASELINE = "packages/salon-secretary/evaluation/hard-conversations-phase-a-continuation-baseline.json";
export const CONTINUATION_BASELINE_SHA256 = "c66c6307b2877a61b8a74b50a206132671a80026940f40d996789ee0699398a8";
export const I01_RESULT_SHA256 = "069dab551c9e655988b5f17830ebd96b8f604d3cd25cef6ac3b388b5def0d33f";
export const PRE_I01_DUMP_SHA256 = "28c02b254017e4be377591898ec30e31e1405e22868d4de790597269bb6f6093";
export const POST_I01_DUMP_SHA256 = "3f6cfe3f7b2a04aff99dcb06cbeacd00c43c7179668812295ada3d1f434aaaad";
export const CONTINUATION_CASE_IDS = ["i02", "i03", "i04", "i05", "i06", "i07", "i08", "i09", "i10", "i11", "i12",
  "i14", "i15", "a02", "a04", "a09", "d09", "t07", "t08", "m02", "m03", "m05", "m07", "x01", "x02"] as const;
export const CONTINUATION_TURNS = 27;
export const CONTINUATION_MAX_USD = 0.2322;

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fail = (code: string): never => { throw Error(`PHASE_A_${code}`); };
function requireSafe(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function readFrozen(root: string, relative: string, expectedHash: string) {
  const absolute = path.resolve(root, relative);
  requireSafe(absolute.startsWith(path.resolve(root) + path.sep), "CONTINUATION_PATH");
  const bytes = readFileSync(absolute);
  requireSafe(sha256(bytes) === expectedHash, "CONTINUATION_HASH_MISMATCH");
  return bytes;
}

type PhaseAPlan = ReturnType<typeof buildPhaseAPlan>;
export function assertContinuationCaseScope(cases: readonly { case_id: string; turns: readonly unknown[] }[]) {
  requireSafe(cases.length === 25 && cases.every((row, index) =>
    row.case_id === CONTINUATION_CASE_IDS[index]) &&
    cases.reduce((total, row) => total + row.turns.length, 0) === CONTINUATION_TURNS,
  "CONTINUATION_SCOPE_DRIFT");
}

export function buildContinuationPlan(source: PhaseAPlan) {
  requireSafe(source.cases.length === 26 && source.cases[0]?.case_id === "i01", "CONTINUATION_SOURCE_SCOPE");
  const cases = source.cases.slice(1);
  assertContinuationCaseScope(cases);
  return {
    gate: "4.0B.3.2 PHASE_A_CONTINUATION_I02_I26", status: "FROZEN_NOT_EXECUTED",
    source_manifest_sha256: PHASE_A_SHA256, historical_i01_result_sha256: I01_RESULT_SHA256,
    baseline_sha256: CONTINUATION_BASELINE_SHA256, model: "gpt-6-luna", jev_router_enabled: false,
    paid_calls_default: false, max_retries: 0, max_confirmations: 0, max_operational_effects: 0,
    case_count: 25, turn_count: CONTINUATION_TURNS, max_luna_inferences: CONTINUATION_TURNS,
    max_usd: CONTINUATION_MAX_USD, cases,
  } as const;
}

export type ContinuationBaseline = {
  gate: string; source_manifest_sha256: string; historical_i01_result_sha256: string;
  pre_i01_dump_sha256: string; post_i01_dump_sha256: string;
  historical_technical_logs: number; total_audit_logs: number;
  i01_audit: { tenant_sha256: string; conversation_sha256: string; draft_sha256: string;
    rows: { row_sha256: string; action: string; entity_type: string; created_at: string; status: string | null }[] };
  operational: ({ case_id: string } & OperationalSnapshot)[];
};

type I01Report = { status: string; scope: string; executed_turns: number;
  records: { case_id: string; turn_index: number; capture: {
    conversation_ref: string; input: string; skill: string; operations: {
      operation: string | null; fields: Record<string, unknown>; missing_fields: string[];
      draft_ref: string | null; draft_status: string | null; proposal_ref: string | null }[] };
    journal: { changed_tables: string[]; technical_audit_delta: number; counters: { confirmations: number;
      operational_writes: number; outbox_creations: number; external_messages: number } };
    openai_network_requests: number; independent_missing_field_check: {
      invented_critical_fields: string[]; unsafe_proposal: boolean } | null }[];
  counters: { confirmations: number; operational_writes: number; appointment_mutations: number;
    service_mutations: number; customer_mutations: number; inventory_mutations: number;
    outbox_creations: number; external_messages: number; openai_requests: number; jev_requests: number;
    hosted_tools: number; containers: number };
  witness: { model: string; store: boolean; hosted_tools: number; containers: number; retries: number }[] };

export function assertApprovedI01Report(report: I01Report) {
  const row = report.records?.[0], operation = row?.capture?.operations?.[0];
  requireSafe(report.status === "COMPLETED" && report.scope === "REVALIDATE_I01" &&
    report.executed_turns === 1 && report.records.length === 1 && row.case_id === "i01" &&
    row.turn_index === 1 && row.capture.input === "Agenda o Alisson pra amanhã." &&
    row.capture.skill === "scheduling" && row.capture.operations.length === 1 &&
    operation.operation === "appointment.create" && operation.fields.customer_name === "Alisson" &&
    operation.fields.date === "2026-10-06" && !operation.fields.service_ref && !operation.fields.time &&
    operation.missing_fields.includes("service_ref") && operation.missing_fields.includes("time") &&
    operation.draft_status === "NEEDS_INPUT" && !operation.proposal_ref &&
    row.journal.changed_tables.length === 0 && row.journal.technical_audit_delta === 7 &&
    row.openai_network_requests === 1 && row.independent_missing_field_check?.invented_critical_fields.length === 0 &&
    row.independent_missing_field_check.unsafe_proposal === false &&
    report.counters.openai_requests === 1 && report.counters.jev_requests === 0 &&
    report.witness.length === 1 && report.witness[0].model === "gpt-6-luna" &&
    report.witness[0].store === false && report.witness[0].hosted_tools === 0 &&
    report.witness[0].containers === 0 && report.witness[0].retries === 0 &&
    [report.counters.confirmations, report.counters.operational_writes,
      report.counters.appointment_mutations, report.counters.service_mutations,
      report.counters.customer_mutations, report.counters.inventory_mutations,
      report.counters.outbox_creations, report.counters.external_messages,
      row.journal.counters.confirmations, row.journal.counters.operational_writes,
      row.journal.counters.outbox_creations, row.journal.counters.external_messages].every(value => value === 0),
  "CONTINUATION_I01_RESULT");
}

export function assertApprovedI01Audit(rows: readonly AuditLog[], baseline: ContinuationBaseline,
  report: I01Report, tenant: string, actor: string) {
  const expected = baseline.i01_audit.rows;
  const actionTypes = [
    ["MODEL_CALL_STARTED", "SALON_SECRETARY_USAGE"], ["MODEL_CALL_FINISHED", "SALON_SECRETARY_USAGE"],
    ["SKILLS_LOADED", "SECRETARY_SKILL_LOAD"], ["DRAFT", "SECRETARY_SCHEDULING"],
    ["SCHEDULING_TIMINGS", "SECRETARY_LATENCY"], ["OPERATIONS_PREPARED", "SECRETARY_OPERATION_PLAN"],
    ["DIRECT_LUNA", "SECRETARY_ROUTER"],
  ];
  requireSafe(rows.length === 7 && expected.length === 7 && baseline.historical_technical_logs === 7 &&
    baseline.total_audit_logs === 7 && baseline.i01_audit.tenant_sha256 === sha256(tenant) &&
    baseline.i01_audit.conversation_sha256 === sha256(report.records[0].capture.conversation_ref) &&
    baseline.i01_audit.draft_sha256 === sha256(report.records[0].capture.operations[0].draft_ref ?? "") &&
    rows.every((row, index) => row.salonId === tenant && row.userId === actor &&
      row.action === actionTypes[index][0] && row.entityType === actionTypes[index][1] &&
      row.action === expected[index].action && row.entityType === expected[index].entity_type &&
      row.createdAt.toISOString() === expected[index].created_at &&
      sha256(JSON.stringify(row)) === expected[index].row_sha256 &&
      (typeof row.metadata === "object" && row.metadata && !Array.isArray(row.metadata) ?
        (row.metadata as Record<string, unknown>).status ?? null : null) === expected[index].status),
  "CONTINUATION_I01_AUDIT");
  const metadata = (index: number) => rows[index].metadata as Record<string, unknown>;
  const conversation = report.records[0].capture.conversation_ref;
  requireSafe([0, 1, 2, 5].every(index => metadata(index)?.session_id === conversation) &&
    metadata(0)?.status === "STARTED" && metadata(1)?.status === "SUCCEEDED" &&
    metadata(1)?.model_id_requested === "gpt-6-luna" &&
    metadata(1)?.model_id_returned === "gpt-6-luna" &&
    typeof metadata(1)?.request_id === "string" && typeof metadata(1)?.response_id === "string" &&
    metadata(3)?.draft_ref === report.records[0].capture.operations[0].draft_ref &&
    metadata(3)?.operation === "appointment.create" && metadata(4)?.operation === "appointment.create" &&
    Array.isArray(metadata(5)?.operations) && (metadata(5).operations as { operation?: string }[]).length === 1 &&
    (metadata(5).operations as { operation?: string }[])[0]?.operation === "appointment.create" &&
    metadata(6)?.router_path === "DIRECT_LUNA" && metadata(6)?.jev_http_calls === 0 &&
    metadata(6)?.retries === 0,
  "CONTINUATION_I01_CORRELATION");
}

export function assertContinuationTotalAuditCount(count: number) {
  requireSafe(count === 7, "CONTINUATION_EXTRA_AUDIT");
}

export function assertOperationalBaseline(caseId: string, actual: OperationalSnapshot,
  expected: ContinuationBaseline["operational"][number] | undefined) {
  requireSafe(expected?.case_id === caseId && isDeepStrictEqual(actual.hashes, expected.hashes) &&
    isDeepStrictEqual(actual.counts, expected.counts) && actual.confirmations === 0 &&
    expected.confirmations === 0 && actual.counts.outbox === 0 &&
    actual.technical_audits === (caseId === "i01" ? 7 : 0) &&
    actual.technical_audits === expected.technical_audits &&
    actual.technical_audit_hash === expected.technical_audit_hash &&
    isDeepStrictEqual(actual.technical_by_kind, expected.technical_by_kind),
  "CONTINUATION_OPERATIONAL_BASELINE");
}

export function verifyPhaseAContinuation(root: string) {
  verifyPhaseA(root); // Also verifies the original 60 cases and protected predecessor hashes.
  const source = JSON.parse(readFrozen(root, PHASE_A_PLAN, PHASE_A_SHA256).toString("utf8")) as PhaseAPlan;
  const manifest = JSON.parse(readFrozen(root, CONTINUATION_PLAN, CONTINUATION_PLAN_SHA256).toString("utf8")) as
    ReturnType<typeof buildContinuationPlan>;
  requireSafe(isDeepStrictEqual(manifest, buildContinuationPlan(source)), "CONTINUATION_MANIFEST_DRIFT");
  const baseline = JSON.parse(readFrozen(root, CONTINUATION_BASELINE, CONTINUATION_BASELINE_SHA256).toString("utf8")) as
    ContinuationBaseline;
  requireSafe(baseline.gate === manifest.gate && baseline.source_manifest_sha256 === PHASE_A_SHA256 &&
    baseline.historical_i01_result_sha256 === I01_RESULT_SHA256 &&
    baseline.pre_i01_dump_sha256 === PRE_I01_DUMP_SHA256 &&
    baseline.post_i01_dump_sha256 === POST_I01_DUMP_SHA256 &&
    baseline.operational.length === 26 && baseline.operational.every((row, index) =>
      row.case_id === source.cases[index]?.case_id), "CONTINUATION_BASELINE_DRIFT");
  const report = JSON.parse(readFrozen(root,
    "packages/salon-secretary/evaluation/results/hard-conversations-revalidate-i01-result.json",
    I01_RESULT_SHA256).toString("utf8")) as I01Report;
  assertApprovedI01Report(report);
  readFrozen(root, "packages/salon-secretary/evaluation/results/phase-a-ready-before-paid-battery.dump",
    PRE_I01_DUMP_SHA256);
  readFrozen(root, "packages/salon-secretary/evaluation/results/phase-a-after-i01-revalidation.dump",
    POST_I01_DUMP_SHA256);
  requireSafe(baseline.i01_audit.tenant_sha256 === sha256(makeFixture("i01", "free").tenant),
    "CONTINUATION_I01_TENANT");
  return { manifest, baseline, report, source };
}
