/** Ultimate 10 evaluation adapter. Reuses Phase A's disposable DB, journal, witness and bridge. */
import { createHash } from "node:crypto";
import { constants, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, statSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PrismaClient } from "@prisma/client";
import { assertPhaseADatabase, assertPhaseAEnvironment, backupPhaseALocalDatabase,
  emptyIndependentCounters, precheckPhaseACase, seedPhaseACase, snapshotPhaseACase,
  type OperationalSnapshot } from "./hard-conversations-phase-a-db";
import { checkpoint, DurableJournal, readDurable, resumeCursor, type DurableRow } from "./hard-conversations-durable";
import { PhaseAWireWitness } from "./hard-conversations-phase-a-witness";
import { resumeHealth } from "./hard-conversations-phase-a-resume";
import { fixtureDigest } from "./hard-conversations-fixtures";
import { makeUltimate10Fixture, ultimate10Cases, ULTIMATE10_SHA256, verifyUltimate10Plan } from "./ultimate-10";

export const ULTIMATE10_SCOPE = "ULTIMATE_10" as const;
export const ULTIMATE10_JOURNAL = "packages/salon-secretary/evaluation/results/ultimate-10.jsonl";
export const ULTIMATE10_BASELINE = "packages/salon-secretary/evaluation/results/ultimate-10-baseline.json";
export const ULTIMATE10_BASELINE_SEAL = `${ULTIMATE10_BASELINE}.sha256`;
export const ULTIMATE10_READY_DUMP = "packages/salon-secretary/evaluation/results/ultimate-10-ready-before-paid.dump";
export const ULTIMATE10_READY_DUMP_SEAL = `${ULTIMATE10_READY_DUMP}.sha256`;
export const ULTIMATE10_REVALIDATION_JOURNAL = "packages/salon-secretary/evaluation/results/ultimate-10-revalidation-u01.jsonl";
export const ULTIMATE10_CONTINUATION_PLAN = "packages/salon-secretary/evaluation/ultimate-10-continuation-u02-u10.json";
export const ULTIMATE10_CONTINUATION_SHA256 = "76576edd4006b99df3df5a2ad8490f8893796de695406f43a3fe1ba91bbb3346";
export const ULTIMATE10_CONTINUATION_JOURNAL = "packages/salon-secretary/evaluation/results/ultimate-10-continuation-u02-u10.jsonl";
export const ULTIMATE10_U01_REVALIDATION_SHA256 = "d52e4cfa06f5b0bf826682f26fc83682a6e41d724032bfb1e3285e0ed89a069e";
const ULTIMATE10_APPROVED_BASELINE_SHA256 = "be9e96bf1a7a29464a725c5faca0d7216d176103a5259db782647add068c2135";
const ULTIMATE10_APPROVED_READY_DUMP_SHA256 = "28a58bde883a49eabce86b010fb2902aabe0aa64d27185b77b95de545234c02f";
export const ULTIMATE10_U01_HISTORY_SHA256 = "9030451287e796920c346396a9dcd7b63661d3761ccae40ea8f61884dfee96c9";
export const ULTIMATE10_U01_HISTORY_REQUEST_ID = "req_fdcc0a46fe504c41b87af68be6e04e08";
const ULTIMATE10_U01_TECHNICAL_AUDIT_SHA256 = "428baaea66989b48bc824ac22557da919f00fbc516b40beeabe9ff4cb3ffdf3c";
export const ULTIMATE10_IDS = Array.from({ length: 10 }, (_, i) => `u${String(i + 1).padStart(2, "0")}`);
export const ULTIMATE10_CONTINUATION_IDS = ULTIMATE10_IDS.slice(1);
const financialCases = new Set(["u02", "u08", "u09"]);
const technicalEntityTypes = new Set(["SALON_SECRETARY_USAGE", "SECRETARY_SKILL_LOAD",
  "SECRETARY_SCHEDULING", "SECRETARY_LATENCY", "SECRETARY_OPERATION_PLAN", "SECRETARY_ROUTER",
  "SECRETARY_FINANCIAL", "SECRETARY_INVENTORY", "SECRETARY_CUSTOMERS", "SECRETARY_COMMUNICATION",
  "SECRETARY_SERVICES", "SERVICE_CREATE_MVP", "SECRETARY_SCHEDULING_BATCH"]);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fail = (code: string): never => { throw Error(`ULTIMATE10_${code}`); };
function requireSafe(ok: unknown, code: string): asserts ok { if (!ok) fail(code); }

export function ultimate10Scope() {
  return { ids: ULTIMATE10_IDS, maxRequests: 11, allowNetworkInconclusive: true,
    turnCounts: Object.fromEntries(ULTIMATE10_IDS.map(id => [id, id === "u06" ? 2 : 1])) };
}

export function ultimate10RevalidationScope() {
  return { ids: ["u01"], maxRequests: 1, allowNetworkInconclusive: false, turnCounts: { u01: 1 } };
}

export function ultimate10ContinuationScope() {
  return { ids: ULTIMATE10_CONTINUATION_IDS, maxRequests: 10, allowNetworkInconclusive: true,
    allowedInconclusiveReasons: ["NETWORK", "KNOWN_FAIL_CLOSED_POST_HTTP"],
    turnCounts: Object.fromEntries(ULTIMATE10_CONTINUATION_IDS.map(id => [id, id === "u06" ? 2 : 1])) };
}

export function verifyUltimate10ContinuationPlan() {
  verifyUltimate10Plan(process.cwd());
  const bytes = readFileSync(ULTIMATE10_CONTINUATION_PLAN);
  requireSafe(sha(bytes) === ULTIMATE10_CONTINUATION_SHA256 &&
    readFileSync(`${ULTIMATE10_CONTINUATION_PLAN}.sha256`, "utf8").trim() === ULTIMATE10_CONTINUATION_SHA256,
  "CONTINUATION_HASH");
  const plan = JSON.parse(bytes.toString("utf8")) as { scope: string; source_manifest_sha256: string;
    case_count: number; turn_count: number; max_inferences: number; max_usd: number;
    excluded: string[]; cases: { case_id: string; turns: unknown[] }[] };
  const original = JSON.parse(readFileSync("packages/salon-secretary/evaluation/ultimate-10-plan.json", "utf8")) as
    { cases: { case_id: string; turns: unknown[] }[] };
  requireSafe(plan.scope === "ULTIMATE10_CONTINUATION_U02_U10" &&
    plan.source_manifest_sha256 === ULTIMATE10_SHA256 && plan.case_count === 9 &&
    plan.turn_count === 10 && plan.max_inferences === 10 && plan.max_usd === .086 &&
    isDeepStrictEqual(plan.excluded, ["u01"]) &&
    isDeepStrictEqual(plan.cases, original.cases.slice(1)) &&
    isDeepStrictEqual(plan.cases.map(c => c.case_id), ULTIMATE10_CONTINUATION_IDS),
  "CONTINUATION_SCOPE");
  return plan;
}

/** The two concluded u01 attempts are fixed evidence, never a continuation cursor. */
export function readUltimate10U01RevalidationHistory() {
  readUltimate10U01History();
  requireSafe(existsSync(ULTIMATE10_REVALIDATION_JOURNAL) &&
    sha(readFileSync(ULTIMATE10_REVALIDATION_JOURNAL)) === ULTIMATE10_U01_REVALIDATION_SHA256,
  "U01_REVALIDATION_HASH");
  const rows = readDurable(ULTIMATE10_REVALIDATION_JOURNAL, ULTIMATE10_SHA256);
  const kinds = ["STARTED", "TURN_STARTED", "BEFORE_NETWORK", "AFTER_NETWORK", "OBSERVATION_EVENT",
    "MODEL_FAILED", "OBSERVATION_EVENT", "OBSERVATION_COMPLETED", "TURN_COMPLETED", "INCONCLUSIVE", "STOPPED"];
  const after = rows[3]?.data as { transport_failed?: boolean; http_status?: number };
  const failed = rows[5]?.data as { diagnostic?: { category?: string; http_status?: number | null } };
  const last = rows[9]?.data as { reason?: string; snapshot?: OperationalSnapshot };
  requireSafe(rows.length === kinds.length && rows.every((row, i) => row.kind === kinds[i] &&
    row.case_id === (i === 10 ? null : "u01")) &&
    (rows[0].data as { attempt?: string }).attempt === "REVALIDATION_U01" &&
    after.transport_failed === true && after.http_status === undefined &&
    failed.diagnostic?.category === "NETWORK" && failed.diagnostic.http_status === null &&
    last.reason === "NETWORK" && last.snapshot?.technical_audits === 6 &&
    last.snapshot.technical_audit_hash === "e50ad3f67ba53d15180949874b08dd095a67ffbce7e4257ff60deecef118d0a5" &&
    (rows[10].data as { reason?: string }).reason === "PROVIDER_ERROR_OR_TIMEOUT" &&
    !rows.some(row => row.kind === "CASE_COMPLETED" || row.case_id && row.case_id !== "u01"),
  "U01_REVALIDATION_SHAPE");
  return last.snapshot;
}

/** Called before witness reservation, journal append and network. */
export function assertUltimate10RevalidationRequest(caseId: string | null, turn: number | null,
  requests: number, witnessRecords: number) {
  requireSafe(caseId === "u01" && turn === 1, "U01_REVALIDATION_SCOPE");
  requireSafe(requests === 0 && witnessRecords === 0, "U01_REVALIDATION_REQUEST_LIMIT");
}

/** Both the byte hash and the semantic shape are fixed; this never accepts an arbitrary resume history. */
export function assertUltimate10U01History(rows: readonly DurableRow[], actualSha256: string,
  approvedSha256 = ULTIMATE10_U01_HISTORY_SHA256) {
  requireSafe(actualSha256 === approvedSha256, "U01_HISTORY_HASH");
  const kinds = ["STARTED", "TURN_STARTED", "BEFORE_NETWORK", "AFTER_NETWORK", "MODEL_FAILED",
    "OBSERVATION_EVENT", "OBSERVATION_COMPLETED", "TURN_COMPLETED", "INCONCLUSIVE", "STOPPED"];
  requireSafe(rows.length === kinds.length && rows.every((row, index) => row.kind === kinds[index] &&
    row.case_id === (index === kinds.length - 1 ? null : "u01") &&
    row.turn_index === (index === 0 || index === kinds.length - 1 ? null : 1) &&
    row.attempt === (index === kinds.length - 1 ? null : 1)) &&
    (rows[3].data as { http_status?: number; request_id?: string }).http_status === 200 &&
    (rows[3].data as { request_id?: string }).request_id === ULTIMATE10_U01_HISTORY_REQUEST_ID &&
    (rows[8].data as { reason?: string }).reason === "PROVIDER_ERROR_OR_TIMEOUT" &&
    (rows[9].data as { reason?: string }).reason === "PROVIDER_ERROR_OR_TIMEOUT" &&
    !rows.some(row => row.kind === "CASE_COMPLETED" || row.case_id && row.case_id !== "u01"),
  "U01_HISTORY_SHAPE");
}

export function readUltimate10U01History() {
  requireSafe(existsSync(ULTIMATE10_JOURNAL), "U01_HISTORY_MISSING");
  const bytes = readFileSync(ULTIMATE10_JOURNAL);
  const rows = readDurable(ULTIMATE10_JOURNAL, ULTIMATE10_SHA256);
  assertUltimate10U01History(rows, sha(bytes));
  return rows;
}

export function assertUltimate10RevalidationJournalEmpty(file = ULTIMATE10_REVALIDATION_JOURNAL) {
  const rows = readDurable(file, ULTIMATE10_SHA256);
  requireSafe(rows.length === 0 && !existsSync(file + ".lock"),
    "U01_REVALIDATION_ALREADY_ATTEMPTED");
}

export function ultimate10Fixture(caseId: string) {
  const plan = verifyUltimate10Plan(process.cwd());
  requireSafe(plan.cases === 10 && ULTIMATE10_IDS.includes(caseId), "CASE_SCOPE");
  const source = JSON.parse(readFileSync("packages/salon-secretary/evaluation/ultimate-10-plan.json", "utf8")) as {
    cases: { case_id: string; fixture_sha256: string }[] };
  const spec = source.cases.find(c => c.case_id === caseId);
  requireSafe(!!spec, "CASE_SCOPE");
  // Fixture construction uses the already frozen typed specification, never a mutable DB oracle.
  const c = ultimate10Cases.find(c => c.case_id === caseId)!;
  const fixture = makeUltimate10Fixture(c);
  requireSafe(fixtureDigest(fixture) === spec.fixture_sha256, "FIXTURE_HASH");
  return fixture;
}

export async function captureUltimate10State(admin: PrismaClient) {
  const snapshots: Record<string, OperationalSnapshot> = {};
  for (const id of ULTIMATE10_IDS) snapshots[id] = await snapshotPhaseACase(admin, ultimate10Fixture(id));
  return snapshots;
}
export type Ultimate10Baseline = { manifest_sha256: string; snapshots: Record<string, OperationalSnapshot> };

export function assertUltimate10BusinessUnchanged(original: OperationalSnapshot, current: OperationalSnapshot) {
  requireSafe(isDeepStrictEqual(current.hashes, original.hashes) &&
    isDeepStrictEqual(current.counts, original.counts) && current.confirmations === 0 &&
    current.counts.outbox === 0, "OPERATIONAL_EFFECT");
}

function writeSealedBaseline(file: string, baseline: Ultimate10Baseline) {
  mkdirSync(dirname(file), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(baseline, null, 2) + "\n");
  const fd = openSync(file, "wx", 0o600);
  try { writeSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  const seal = openSync(ULTIMATE10_BASELINE_SEAL, "wx", 0o600);
  try { writeSync(seal, sha(bytes) + "\n"); fsyncSync(seal); } finally { closeSync(seal); }
  return sha(bytes);
}

function readyDumpHash(requirePresent: boolean) {
  const present = existsSync(ULTIMATE10_READY_DUMP), sealed = existsSync(ULTIMATE10_READY_DUMP_SEAL);
  requireSafe(present === sealed && (!requirePresent || present), "READY_DUMP_MISSING");
  if (!present) return null;
  const digest = sha(readFileSync(ULTIMATE10_READY_DUMP));
  requireSafe(statSync(ULTIMATE10_READY_DUMP).size > 0 &&
    readFileSync(ULTIMATE10_READY_DUMP_SEAL, "utf8").trim() === digest, "READY_DUMP_HASH");
  return digest;
}

function ensureReadyDump(adminUrl: URL) {
  const existing = readyDumpHash(false);
  if (existing) return existing;
  const dump = backupPhaseALocalDatabase(adminUrl);
  copyFileSync(dump.path, ULTIMATE10_READY_DUMP, constants.COPYFILE_EXCL);
  const fd = openSync(ULTIMATE10_READY_DUMP, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); }
  const digest = sha(readFileSync(ULTIMATE10_READY_DUMP));
  const seal = openSync(ULTIMATE10_READY_DUMP_SEAL, "wx", 0o600);
  try { writeSync(seal, digest + "\n"); fsyncSync(seal); } finally { closeSync(seal); }
  return digest;
}

export function readUltimate10Baseline(): Ultimate10Baseline {
  requireSafe(existsSync(ULTIMATE10_BASELINE) && existsSync(ULTIMATE10_BASELINE_SEAL), "BASELINE_MISSING");
  const bytes = readFileSync(ULTIMATE10_BASELINE);
  const seal = readFileSync(ULTIMATE10_BASELINE_SEAL, "utf8").trim();
  requireSafe(sha(bytes) === seal, "BASELINE_HASH");
  const baseline = JSON.parse(bytes.toString("utf8")) as Ultimate10Baseline;
  requireSafe(baseline.manifest_sha256 === ULTIMATE10_SHA256 &&
    isDeepStrictEqual(Object.keys(baseline.snapshots), ULTIMATE10_IDS) &&
    Object.values(baseline.snapshots).every(s => s.technical_audits === 0 && s.confirmations === 0 &&
      s.counts.outbox === 0 && s.counts.appointment_events === 0), "BASELINE_SHAPE");
  return baseline;
}

function approvedAuditFor(rows: readonly DurableRow[], id: string, baseline: Ultimate10Baseline,
  prior?: Readonly<Record<string, OperationalSnapshot>>) {
  const latest = rows.findLast(row => row.case_id === id &&
    (row.kind === "CASE_COMPLETED" || row.kind === "INCONCLUSIVE"));
  if (!latest) return prior?.[id] ?? baseline.snapshots[id];
  requireSafe(latest.kind === "CASE_COMPLETED" ||
    ["NETWORK", "KNOWN_FAIL_CLOSED_POST_HTTP"].includes((latest.data as { reason?: string })?.reason ?? ""),
  "UNAPPROVED_CHECKPOINT");
  const snapshot = (latest.data as { snapshot?: OperationalSnapshot })?.snapshot;
  requireSafe(!!snapshot && snapshot.confirmations === 0 && snapshot.counts.outbox === 0, "CHECKPOINT_SNAPSHOT");
  return snapshot;
}

/** Read-only: compare business rows to the sealed prepared state and technical rows to the exact checkpoint. */
export async function assertUltimate10State(admin: PrismaClient, runtime: PrismaClient,
  rows: readonly DurableRow[], baseline: Ultimate10Baseline,
  prior?: Readonly<Record<string, OperationalSnapshot>>) {
  for (const id of ULTIMATE10_IDS) {
    const fixture = ultimate10Fixture(id);
    const expected = approvedAuditFor(rows, id, baseline, prior);
    const current = await snapshotPhaseACase(admin, fixture);
    assertUltimate10BusinessUnchanged(baseline.snapshots[id], current);
    requireSafe(current.technical_audits === expected.technical_audits &&
      current.technical_audit_hash === expected.technical_audit_hash, "STATE_DRIFT");
    await precheckPhaseACase(admin, runtime, fixture,
      expected.technical_audits ? { kind: "APPROVED_RESUME_HISTORY", case_id: fixture.caseId,
        count: expected.technical_audits, technical_audit_hash: expected.technical_audit_hash! } : undefined,
      { financialYesterday: financialCases.has(id) });
  }
}

/** Before a terminal checkpoint, independently prove that only approved technical rows changed. */
export async function inspectUltimate10CaseState(admin: PrismaClient, runtime: PrismaClient,
  rows: readonly DurableRow[], baseline: Ultimate10Baseline, caseId: string,
  prior?: Readonly<Record<string, OperationalSnapshot>>) {
  requireSafe(ULTIMATE10_IDS.includes(caseId), "CASE_SCOPE");
  const fixture = ultimate10Fixture(caseId);
  for (const id of ULTIMATE10_IDS) {
    const f = id === caseId ? fixture : ultimate10Fixture(id);
    const current = await snapshotPhaseACase(admin, f);
    const original = baseline.snapshots[id];
    assertUltimate10BusinessUnchanged(original, current);
    if (id !== caseId) {
      const approved = approvedAuditFor(rows, id, baseline, prior);
      requireSafe(current.technical_audits === approved.technical_audits &&
        current.technical_audit_hash === approved.technical_audit_hash, "OTHER_CASE_DRIFT");
    }
  }
  const audits = await admin.auditLog.findMany({ where: { salonId: fixture.tenant },
    select: { entityType: true, userId: true, action: true } });
  requireSafe(audits.every(audit => audit.userId === fixture.actor &&
    technicalEntityTypes.has(audit.entityType) &&
    !/(?:^|_)CONFIRMED$|^BATCH_EXECUTED$|^STOCK_MOVEMENT_EXECUTED$/.test(audit.action)),
  "UNAPPROVED_TECHNICAL_AUDIT");
  const snapshot = await snapshotPhaseACase(admin, fixture);
  await precheckPhaseACase(admin, runtime, fixture, { kind: "APPROVED_RESUME_HISTORY",
    case_id: fixture.caseId, count: snapshot.technical_audits,
    technical_audit_hash: snapshot.technical_audit_hash! },
  { financialYesterday: financialCases.has(caseId) });
  return snapshot;
}

/** Seed-only mode: no inference, no resets. The existing local-only Phase A seeder is reused. */
export async function prepareUltimate10(admin: PrismaClient, runtime: PrismaClient) {
  verifyUltimate10Plan(process.cwd());
  const urls = assertPhaseAEnvironment();
  await assertPhaseADatabase(admin, runtime);
  await resumeHealth(runtime, false);
  requireSafe(!existsSync(ULTIMATE10_JOURNAL) || readFileSync(ULTIMATE10_JOURNAL).length === 0,
    "JOURNAL_NOT_EMPTY");
  const fixtures = ULTIMATE10_IDS.map(ultimate10Fixture);
  const present = await Promise.all(fixtures.map(f => admin.salon.findUnique({ where: { id: f.tenant }, select: { id: true } })));
  requireSafe(present.every(Boolean) || present.every(x => !x), "PARTIAL_FIXTURE_SET");
  let backup: { path: string; bytes: number; sha256: string } | null = null;
  if (present.every(x => !x)) {
    requireSafe(!existsSync(ULTIMATE10_BASELINE) && !existsSync(ULTIMATE10_BASELINE_SEAL), "BASELINE_ALREADY_EXISTS");
    const dump = backupPhaseALocalDatabase(urls.admin);
    backup = { ...dump, sha256: sha(readFileSync(dump.path)) };
    for (let index = 0; index < fixtures.length; index++)
      await seedPhaseACase(admin, fixtures[index], { financialYesterday: financialCases.has(ULTIMATE10_IDS[index]) });
  }
  if (!existsSync(ULTIMATE10_BASELINE) && !existsSync(ULTIMATE10_BASELINE_SEAL)) {
    for (let i = 0; i < fixtures.length; i++)
      await precheckPhaseACase(admin, runtime, fixtures[i], undefined,
        { financialYesterday: financialCases.has(ULTIMATE10_IDS[i]) });
    writeSealedBaseline(ULTIMATE10_BASELINE, { manifest_sha256: ULTIMATE10_SHA256,
      snapshots: await captureUltimate10State(admin) });
  }
  await ultimate10Preflight(admin, runtime, false);
  const readyDumpSha256 = ensureReadyDump(urls.admin);
  const result = await ultimate10Preflight(admin, runtime);
  return { ...result, seeded: backup ? 10 : 0, backup, ready_dump_sha256: readyDumpSha256 };
}

/** Initial preflight requires a fresh Ultimate-only durable journal; old Phase A audit history is untouched. */
export async function ultimate10Preflight(admin: PrismaClient, runtime: PrismaClient, requireReadyDump = true) {
  const frozen = verifyUltimate10Plan(process.cwd());
  assertPhaseAEnvironment();
  await resumeHealth(runtime, false);
  const identity = await assertPhaseADatabase(admin, runtime);
  const baseline = readUltimate10Baseline();
  const rows = readDurable(ULTIMATE10_JOURNAL, ULTIMATE10_SHA256);
  requireSafe(rows.length === 0 && !existsSync(ULTIMATE10_JOURNAL + ".lock"), "JOURNAL_NOT_EMPTY");
  const [outbox, audits] = await Promise.all([admin.notificationOutbox.count(),
    admin.auditLog.findMany({ select: { action: true } })]);
  requireSafe(outbox === 0 && !audits.some(a =>
    /(?:^|_)CONFIRMED$|^BATCH_EXECUTED$|^STOCK_MOVEMENT_EXECUTED$/.test(a.action)),
  "GLOBAL_OPERATIONAL_DIRT");
  await assertUltimate10State(admin, runtime, rows, baseline);
  const witness = new PhaseAWireWitness("ULTIMATE_10");
  requireSafe(witness.budget.calls === 0 && witness.records.length === 0 &&
    Object.values(emptyIndependentCounters()).every(value => value === 0), "COUNTERS_NOT_FRESH");
  return { status: "ULTIMATE10_PREFLIGHT_OK" as const, identity, cases: frozen.cases,
    turns: frozen.turns, max_inferences: frozen.max_inferences, max_usd: frozen.max_usd,
    baseline_sha256: readFileSync(ULTIMATE10_BASELINE_SEAL, "utf8").trim(),
    ready_dump_sha256: readyDumpHash(requireReadyDump),
    manifest_sha256: ULTIMATE10_SHA256, current_runtime: frozen.current_runtime,
    design_target: frozen.design_target, network_calls: 0, paid_calls: false, jev_router: false };
}

/** Resume preflight is strict: only CASE_COMPLETED or isolated NETWORK INCONCLUSIVE can advance. */
export async function ultimate10ResumePreflight(admin: PrismaClient, runtime: PrismaClient,
  rows: readonly DurableRow[], paid = false) {
  verifyUltimate10Plan(process.cwd());
  await resumeHealth(runtime, paid);
  await assertPhaseADatabase(admin, runtime);
  const pending = resumeCursor(rows, ULTIMATE10_IDS, true);
  const baseline = readUltimate10Baseline();
  await assertUltimate10State(admin, runtime, rows, baseline);
  return { pending, baseline };
}

/** Read-only contextual preflight for exactly one new u01 attempt in a separate durable journal. */
export async function ultimate10U01RevalidationPreflight(admin: PrismaClient, runtime: PrismaClient) {
  const frozen = verifyUltimate10Plan(process.cwd());
  assertPhaseAEnvironment();
  await resumeHealth(runtime, false);
  const identity = await assertPhaseADatabase(admin, runtime);
  const baseline = readUltimate10Baseline();
  readUltimate10U01History();
  assertUltimate10RevalidationJournalEmpty();
  const [outbox, audits] = await Promise.all([admin.notificationOutbox.count(),
    admin.auditLog.findMany({ select: { action: true } })]);
  requireSafe(outbox === 0 && !audits.some(a =>
    /(?:^|_)CONFIRMED$|^BATCH_EXECUTED$|^STOCK_MOVEMENT_EXECUTED$/.test(a.action)),
  "GLOBAL_OPERATIONAL_DIRT");
  for (const id of ULTIMATE10_IDS) {
    const fixture = ultimate10Fixture(id);
    const current = await snapshotPhaseACase(admin, fixture);
    assertUltimate10BusinessUnchanged(baseline.snapshots[id], current);
    const approved = id === "u01" ? { count: 3, hash: ULTIMATE10_U01_TECHNICAL_AUDIT_SHA256 } :
      { count: 0, hash: baseline.snapshots[id].technical_audit_hash };
    requireSafe(current.technical_audits === approved.count && current.technical_audit_hash === approved.hash,
      "U01_REVALIDATION_STATE_DRIFT");
    await precheckPhaseACase(admin, runtime, fixture, id === "u01" ? {
      kind: "APPROVED_RESUME_HISTORY", case_id: fixture.caseId, count: approved.count,
      technical_audit_hash: ULTIMATE10_U01_TECHNICAL_AUDIT_SHA256,
    } : undefined, { financialYesterday: financialCases.has(id) });
  }
  const witness = new PhaseAWireWitness("ULTIMATE_10");
  requireSafe(witness.budget.calls === 0 && witness.records.length === 0 &&
    Object.values(emptyIndependentCounters()).every(value => value === 0), "COUNTERS_NOT_FRESH");
  return { status: "ULTIMATE10_REVALIDATE_U01_PREFLIGHT_OK" as const, identity,
    cases: 1, turns: 1, max_inferences: 1, max_usd: .0086,
    manifest_sha256: ULTIMATE10_SHA256, history_sha256: ULTIMATE10_U01_HISTORY_SHA256,
    baseline_sha256: readFileSync(ULTIMATE10_BASELINE_SEAL, "utf8").trim(),
    ready_dump_sha256: readyDumpHash(true), historical_request_id: ULTIMATE10_U01_HISTORY_REQUEST_ID,
    original_cases: frozen.cases, original_turns: frozen.turns,
    network_calls: 0, paid_calls: false, jev_router: false };
}

/** Contextual, read-only preflight: only the two pinned u01 attempts may precede u02. */
export async function ultimate10ContinuationPreflight(admin: PrismaClient, runtime: PrismaClient,
  rows?: readonly DurableRow[], paid = false) {
  const plan = verifyUltimate10ContinuationPlan();
  if (!paid) assertPhaseAEnvironment();
  const journalRows = rows ?? readDurable(ULTIMATE10_CONTINUATION_JOURNAL, ULTIMATE10_CONTINUATION_SHA256);
  if (!paid) requireSafe(journalRows.length === 0, "CONTINUATION_ALREADY_STARTED");
  await resumeHealth(runtime, paid);
  const identity = await assertPhaseADatabase(admin, runtime);
  const u01 = readUltimate10U01RevalidationHistory();
  const baseline = readUltimate10Baseline();
  requireSafe(readFileSync(ULTIMATE10_BASELINE_SEAL, "utf8").trim() ===
    ULTIMATE10_APPROVED_BASELINE_SHA256, "CONTINUATION_BASELINE_HASH");
  const pending = resumeCursor(journalRows, ULTIMATE10_CONTINUATION_IDS, true,
    ultimate10ContinuationScope().allowedInconclusiveReasons);
  const [outbox, audits] = await Promise.all([admin.notificationOutbox.count(),
    admin.auditLog.findMany({ select: { action: true } })]);
  requireSafe(outbox === 0 && !audits.some(a =>
    /(?:^|_)CONFIRMED$|^BATCH_EXECUTED$|^STOCK_MOVEMENT_EXECUTED$/.test(a.action)),
  "GLOBAL_OPERATIONAL_DIRT");
  await assertUltimate10State(admin, runtime, journalRows, baseline, { u01 });
  if (!paid) requireSafe(!existsSync(ULTIMATE10_CONTINUATION_JOURNAL + ".lock"), "CONTINUATION_LOCKED");
  requireSafe(readyDumpHash(true) === ULTIMATE10_APPROVED_READY_DUMP_SHA256,
    "CONTINUATION_READY_DUMP_HASH");
  return { status: "ULTIMATE10_CONTINUATION_PREFLIGHT_OK" as const, identity,
    cases: plan.case_count, turns: plan.turn_count, max_inferences: plan.max_inferences,
    max_usd: plan.max_usd, pending, baseline, prior: { u01 },
    manifest_sha256: ULTIMATE10_CONTINUATION_SHA256,
    source_manifest_sha256: ULTIMATE10_SHA256,
    historical_revalidation_sha256: ULTIMATE10_U01_REVALIDATION_SHA256,
    paid_calls: paid, jev_router: false };
}

export function openUltimate10Journal() {
  verifyUltimate10Plan(process.cwd());
  return new DurableJournal(resolve(ULTIMATE10_JOURNAL), ULTIMATE10_SHA256,
    [process.env.SALON_SECRETARY_OPENAI_API_KEY ?? "", process.env.TYPESAFE_API_KEY ?? "",
      process.env.DATABASE_URL ?? "", process.env.DIRECT_URL ?? ""], ultimate10Scope());
}

export function openUltimate10U01RevalidationJournal() {
  verifyUltimate10Plan(process.cwd());
  readUltimate10U01History();
  assertUltimate10RevalidationJournalEmpty();
  return new DurableJournal(resolve(ULTIMATE10_REVALIDATION_JOURNAL), ULTIMATE10_SHA256,
    [process.env.SALON_SECRETARY_OPENAI_API_KEY ?? "", process.env.TYPESAFE_API_KEY ?? "",
      process.env.DATABASE_URL ?? "", process.env.DIRECT_URL ?? ""], ultimate10RevalidationScope());
}

export function openUltimate10ContinuationJournal() {
  verifyUltimate10ContinuationPlan();
  readUltimate10U01RevalidationHistory();
  return new DurableJournal(resolve(ULTIMATE10_CONTINUATION_JOURNAL), ULTIMATE10_CONTINUATION_SHA256,
    [process.env.SALON_SECRETARY_OPENAI_API_KEY ?? "", process.env.TYPESAFE_API_KEY ?? "",
      process.env.DATABASE_URL ?? "", process.env.DIRECT_URL ?? ""], ultimate10ContinuationScope());
}

export function ultimate10Checkpoint(rows: readonly DurableRow[]) {
  return Object.fromEntries(ULTIMATE10_IDS.map(id => [id, checkpoint(rows, id)]));
}
