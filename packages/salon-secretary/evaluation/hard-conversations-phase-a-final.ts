/** Evaluation-only continuation after both i12 attempts. Frozen predecessor evidence is immutable. */
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { assertPhaseADatabase, assertPhaseAEnvironment, precheckPhaseACase } from "./hard-conversations-phase-a-db";
import { makeFixture } from "./hard-conversations-fixtures";
import { FINAL_CONTINUATION_IDS, FINAL_CONTINUATION_SCOPE, digest, durableFail, readDurable,
  resumeCursor, type DurableRow } from "./hard-conversations-durable";
import { captureResumeState, assertResumeState, resumeHealth, verifyResumePlan,
  RESUME_JOURNAL, type ResumeBaseline } from "./hard-conversations-phase-a-resume";
import { verifyPhaseAContinuation } from "./hard-conversations-phase-a-continuation";

export const FINAL_BASE = "packages/salon-secretary/evaluation/hard-conversations-phase-a-final-baseline.json";
export const FINAL_PLAN = "packages/salon-secretary/evaluation/hard-conversations-phase-a-final.json";
export const FINAL_SEAL = "packages/salon-secretary/evaluation/hard-conversations-phase-a-final-seal.json";
export const FINAL_JOURNAL = "packages/salon-secretary/evaluation/results/hard-conversations-phase-a-final.jsonl";
const HISTORICAL_JOURNAL_SHA = "13fdd285d858530656efbc81a3d08b2d76bdd5d276d39d8fe07bcdca4f75916f";
const HISTORICAL_REPORT_SHA = "1ee5ed717e4247a2df4bdbbc80cd17cc7b7bf105d56b022bc85a781ba18de493";
const HISTORICAL_DUMP_SHA = "9a55470b46e60d21c3d2b9f56b7f30dba26729dc0ed9a69e9d3ef9a1b858c6af";
const check = (ok: unknown, code: string) => { if (!ok) durableFail(code); };
const protectedFile = (path: string, expected: string) => check(digest(readFileSync(path)) === expected, "HISTORICAL_HASH");

export function verifyFinalHistory() {
  const frozen = verifyResumePlan();
  protectedFile(RESUME_JOURNAL, HISTORICAL_JOURNAL_SHA);
  protectedFile("packages/salon-secretary/evaluation/results/hard-conversations-phase-a-resume-result-1790253514992.json", HISTORICAL_REPORT_SHA);
  protectedFile("packages/salon-secretary/evaluation/results/phase-a-resume-after-i12-attempt2.dump", HISTORICAL_DUMP_SHA);
  const rows = readDurable(RESUME_JOURNAL, frozen.binding);
  const started = rows.filter(r => r.kind === "STARTED");
  const wire = rows.filter(r => r.kind === "BEFORE_NETWORK");
  const failure = rows.find(r => r.kind === "TURN_COMPLETED" && r.case_id === "i12");
  const diagnostic = (failure?.data as { provider_diagnostic?: { category?: string; http_status?: number | null; evidence_conflict?: boolean } })?.provider_diagnostic;
  check(started.length === 1 && started[0].case_id === "i12" && started[0].attempt === 2 &&
    wire.length === 1 && wire[0].case_id === "i12" && wire[0].attempt === 2 &&
    !rows.some(r => r.kind === "CASE_COMPLETED") && rows.some(r => r.kind === "INCONCLUSIVE" && r.case_id === "i12") &&
    diagnostic?.category === "NETWORK" && diagnostic.http_status === null && !diagnostic.evidence_conflict,
  "I12_HISTORY_MISMATCH");
  return frozen;
}

export function buildFinalPlan(baselineHash: string) {
  const prior = verifyFinalHistory();
  const cases = verifyPhaseAContinuation(process.cwd()).source.cases.slice(12);
  check(isDeepStrictEqual(cases.map(c => c.case_id), FINAL_CONTINUATION_IDS) &&
    cases.reduce((n, c) => n + c.turns.length, 0) === 16, "FINAL_SCOPE");
  return { gate: "4.0B.final", scope: FINAL_CONTINUATION_SCOPE, baseline_sha256: baselineHash,
    historical_resume_sha256: prior.binding, historical_journal_sha256: HISTORICAL_JOURNAL_SHA,
    historical_report_sha256: HISTORICAL_REPORT_SHA, historical_dump_sha256: HISTORICAL_DUMP_SHA,
    case_count: 14, turn_count: 16, max_inferences: 16, max_usd: .1376,
    per_inference_reserve_usd: .0086, model: "gpt-6-luna", retries: 0, jev: 0, confirmations: 0,
    operational_effects: 0, excluded: { i01: "PASS_IMMUTABLE", i02_i11: "UNKNOWN_IMMUTABLE",
      i12: "INCONCLUSIVE_ATTEMPTS_1_AND_2_IMMUTABLE" }, cases };
}

export function verifyFinalPlan() {
  const seal = JSON.parse(readFileSync(FINAL_SEAL, "utf8")) as { manifest_sha256: string; baseline_sha256: string };
  const planBytes = readFileSync(FINAL_PLAN), baseBytes = readFileSync(FINAL_BASE);
  check(digest(planBytes) === seal.manifest_sha256 && digest(baseBytes) === seal.baseline_sha256,
    "FINAL_FROZEN_HASH");
  const plan = JSON.parse(planBytes.toString()) as ReturnType<typeof buildFinalPlan>;
  check(isDeepStrictEqual(plan, buildFinalPlan(seal.baseline_sha256)), "FINAL_MANIFEST_DRIFT");
  const baseline = JSON.parse(baseBytes.toString()) as ResumeBaseline;
  check(baseline.total_audit_logs === 72 && baseline.audit_row_sha256.length === 72 &&
    baseline.operational.length === 26 && baseline.operational.every(r => r.confirmations === 0 && r.counts.outbox === 0),
  "FINAL_BASELINE_SHAPE");
  return { plan, baseline, seal, binding: seal.manifest_sha256 };
}

/** All 69 old rows and exactly three i12 technical rows; business state remains the pre-i12 baseline. */
export async function assertFinalHistoricalState(admin: PrismaClient, baseline: ResumeBaseline) {
  const old = verifyFinalHistory().baseline;
  check(baseline.total_audit_logs === 72 &&
    isDeepStrictEqual(baseline.audit_row_sha256.slice(0, 69), old.audit_row_sha256), "HISTORICAL_PREFIX");
  const i12 = makeFixture("i12", "free");
  const audits = await admin.auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const tail = audits.slice(69, 72);
  check(audits.length >= 72 && tail.length === 3 && tail.every(r => r.salonId === i12.tenant && r.userId === i12.actor) &&
    isDeepStrictEqual(tail.map(r => r.action), ["MODEL_CALL_STARTED", "MODEL_CALL_FINISHED", "DIRECT_LUNA"]) &&
    tail.every(r => !["CONFIRMED", "EXECUTED"].includes(String((r.metadata as { status?: string })?.status))),
  "I12_TECHNICAL_AUDIT");
  check(baseline.operational.every((r, index) => isDeepStrictEqual(r.hashes, old.operational[index].hashes) &&
    isDeepStrictEqual(r.counts, old.operational[index].counts)), "OPERATIONAL_BASELINE");
}

/** Technical AuditLogs may grow only for the active synthetic tenant; no business table may change. */
export async function assertFinalCaseState(admin: PrismaClient, before: ResumeBaseline,
  after: ResumeBaseline, caseId: string) {
  check(after.total_audit_logs >= before.total_audit_logs &&
    isDeepStrictEqual(after.audit_row_sha256.slice(0, before.total_audit_logs), before.audit_row_sha256),
  "AUDIT_PREFIX_DRIFT");
  const fixture = makeFixture(caseId, verifyFinalPlan().plan.cases.find(c => c.case_id === caseId)!.fixture);
  const audits = await admin.auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  check(audits.length === after.total_audit_logs && audits.slice(before.total_audit_logs).every(r =>
    r.salonId === fixture.tenant && r.userId === fixture.actor &&
    ["SALON_SECRETARY_USAGE", "SECRETARY_SKILL_LOAD", "SECRETARY_SCHEDULING", "SECRETARY_LATENCY",
      "SECRETARY_OPERATION_PLAN", "SECRETARY_ROUTER", "SECRETARY_FINANCIAL", "SECRETARY_INVENTORY",
      "SECRETARY_CUSTOMERS", "SECRETARY_COMMUNICATION", "SECRETARY_SERVICES", "SERVICE_CREATE_MVP",
      "SECRETARY_SCHEDULING_BATCH"].includes(r.entityType)),
  "UNAPPROVED_TECHNICAL_AUDIT");
  check(after.operational.every((r, i) => isDeepStrictEqual(r.hashes, before.operational[i].hashes) &&
    isDeepStrictEqual(r.counts, before.operational[i].counts) && r.confirmations === 0 && r.counts.outbox === 0),
  "OPERATIONAL_EFFECT");
}

export async function finalPreflight(admin: PrismaClient, runtime: PrismaClient, rows: readonly DurableRow[] = []) {
  const frozen = verifyFinalPlan();
  const pending = resumeCursor(rows, FINAL_CONTINUATION_IDS, true);
  assertPhaseAEnvironment(); await resumeHealth(runtime, false);
  const identity = await assertPhaseADatabase(admin, runtime);
  await assertFinalHistoricalState(admin, frozen.baseline);
  const previous = rows.findLast(r => r.kind === "CASE_COMPLETED" ||
    (r.kind === "INCONCLUSIVE" && (r.data as { reason?: string })?.reason === "NETWORK"));
  const expected = previous ? (previous.data as { baseline: ResumeBaseline }).baseline : frozen.baseline;
  check(!!expected, "FINAL_CHECKPOINT_BASELINE_MISSING");
  const current = await captureResumeState(admin);
  assertResumeState(current, expected);
  check(current.operational.every((r, i) => isDeepStrictEqual(r.hashes, frozen.baseline.operational[i].hashes) &&
    isDeepStrictEqual(r.counts, frozen.baseline.operational[i].counts)), "OPERATIONAL_EFFECT");
  for (const c of verifyPhaseAContinuation(process.cwd()).source.cases) {
    const approved = current.operational.find(r => r.case_id === c.case_id)!;
    await precheckPhaseACase(admin, runtime, makeFixture(c.case_id, c.fixture), {
      kind: "APPROVED_RESUME_HISTORY", case_id: c.case_id, count: approved.technical_audits,
      technical_audit_hash: approved.technical_audit_hash! });
  }
  return { ...frozen, current, identity, pending, historical_technical_logs: 72,
    journal: resolve(FINAL_JOURNAL), case_count: 14, turn_count: 16 };
}
