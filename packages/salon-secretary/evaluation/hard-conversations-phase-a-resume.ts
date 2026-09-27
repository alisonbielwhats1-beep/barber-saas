/** Gate 4.0B.5: strict evaluation baseline; no business writes or inference. */
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { assertApprovedI01Audit, verifyPhaseAContinuation } from "./hard-conversations-phase-a-continuation";
import { makeFixture } from "./hard-conversations-fixtures";
import { assertPhaseADatabase, assertPhaseAEnvironment, precheckPhaseACase, snapshotPhaseACase } from "./hard-conversations-phase-a-db";
import { digest, durableFail, RESUME_IDS, RESUME_SCOPE, type DurableRow } from "./hard-conversations-durable";

export const RESUME_BASE = "packages/salon-secretary/evaluation/hard-conversations-phase-a-resume-baseline.json";
export const RESUME_PLAN = "packages/salon-secretary/evaluation/hard-conversations-phase-a-resume.json";
export const RESUME_SEAL = "packages/salon-secretary/evaluation/hard-conversations-phase-a-resume-seal.json";
export const RESUME_JOURNAL = "packages/salon-secretary/evaluation/results/hard-conversations-phase-a-resume.jsonl";
export const INTERRUPTION_AUDIT = "packages/salon-secretary/evaluation/results/hard-conversations-phase-a-continuation-interruption-audit.json";
const INTERRUPTION_SHA = "fc88321db1acbfd52cf2fa90d493b805d01648f877411cc7cb0274ffc3173e94";
const INTERRUPTION_DUMP_SHA = "ee34ec847fb8b122f64b730f51c7e925d2869902b2d891dcbb144a9017887fbe";
const expectedCounts = [7, 7, 7, 7, 6, 6, 5, 3, 6, 7, 1];
const check = (ok: unknown, code: string) => { if (!ok) durableFail(code); };
export const rowHashes = (rows: readonly unknown[]) => rows.map(row => digest(JSON.stringify(row)));
export async function captureResumeState(admin: PrismaClient) {
  const frozen = verifyPhaseAContinuation(process.cwd());
  const audits = await admin.auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const operational = [];
  for (const c of frozen.source.cases) operational.push({ case_id: c.case_id,
    ...await snapshotPhaseACase(admin, makeFixture(c.case_id, c.fixture)) });
  return { total_audit_logs: audits.length, audit_row_sha256: rowHashes(audits), operational };
}
export type ResumeBaseline = Awaited<ReturnType<typeof captureResumeState>>;

export function assertResumeState(actual: ResumeBaseline, expected: ResumeBaseline) {
  check(isDeepStrictEqual(actual, expected), "BASELINE_MISMATCH");
  check(actual.operational.every(row => row.confirmations === 0 && row.counts.outbox === 0), "OPERATIONAL_EFFECT");
}

/** Initial enrollment only: compare all business tables with the previously approved baseline. */
export async function buildResumeBaseline(admin: PrismaClient, runtime: PrismaClient) {
  const frozen = verifyPhaseAContinuation(process.cwd());
  check(digest(readFileSync(INTERRUPTION_AUDIT)) === INTERRUPTION_SHA, "HISTORICAL_HASH");
  check(digest(readFileSync("packages/salon-secretary/evaluation/results/phase-a-after-interrupted-continuation.dump")) === INTERRUPTION_DUMP_SHA, "HISTORICAL_HASH");
  assertPhaseAEnvironment(); await assertPhaseADatabase(admin, runtime);
  const all = await admin.auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  check(all.length === 69, "HISTORICAL_COUNT");
  const i01 = makeFixture("i01", "free");
  assertApprovedI01Audit(all.filter(r => r.salonId === i01.tenant), frozen.baseline, frozen.report, i01.tenant, i01.actor);
  const evidence = JSON.parse(readFileSync(INTERRUPTION_AUDIT, "utf8")) as { cases: { case_id: string; technical_events?: string[] }[] };
  for (let index = 0; index < 11; index++) {
    const c = frozen.manifest.cases[index], f = makeFixture(c.case_id, c.fixture);
    const own = all.filter(r => r.salonId === f.tenant);
    check(own.length === expectedCounts[index] && own.every(r => r.userId === f.actor) &&
      isDeepStrictEqual(own.map(r => r.action), evidence.cases.find(r => r.case_id === c.case_id)?.technical_events), "HISTORICAL_EVENTS");
  }
  const baseline = await captureResumeState(admin);
  for (let index = 0; index < baseline.operational.length; index++) {
    const actual = baseline.operational[index], original = frozen.baseline.operational[index];
    check(isDeepStrictEqual(actual.hashes, original.hashes) && isDeepStrictEqual(actual.counts, original.counts) &&
      actual.confirmations === 0 && actual.counts.outbox === 0, "OPERATIONAL_BASELINE");
    if (index > 11) check(actual.technical_audits === 0, "UNEXPECTED_HISTORY");
  }
  return baseline;
}

export function buildResumePlan(baselineHash: string) {
  const frozen = verifyPhaseAContinuation(process.cwd());
  const cases = frozen.source.cases.slice(11);
  check(isDeepStrictEqual(cases.map(c => c.case_id), [...RESUME_IDS]) && cases.reduce((n, c) => n + c.turns.length, 0) === 17, "SCOPE");
  return { gate: "4.0B.5", scope: RESUME_SCOPE, status: "PREPARED_NOT_AUTHORIZED", baseline_sha256: baselineHash,
    historical_manifest_sha256: frozen.manifest.source_manifest_sha256, interruption_audit_sha256: INTERRUPTION_SHA,
    interruption_dump_sha256: INTERRUPTION_DUMP_SHA, case_count: 15, turn_count: 17, max_inferences: 17,
    max_usd: .1462, per_inference_reserve_usd: .0086, model: "gpt-6-luna", retries: 0, jev: 0,
    confirmations: 0, operational_effects: 0, i12: { historical: "INCONCLUSIVE_ATTEMPT_1", new_attempt: 2, maximum_new_inferences: 1 },
    excluded: { i01: "PASS_IMMUTABLE", i02_i11: "MODEL_COMPLETED_OBSERVATION_MISSING_FUNCTIONAL_UNKNOWN" }, cases };
}
export function verifyResumePlan() {
  const seal = JSON.parse(readFileSync(RESUME_SEAL, "utf8")) as { manifest_sha256: string; baseline_sha256: string };
  check(seal.manifest_sha256 === "dfc4d20d8ef05acf3003d5170f98fa1639d2beb387e75ce08067c22a5f950f5c" &&
    seal.baseline_sha256 === "fc3f7fd6a10ee2195ceeef15f37b9570e07e4404c673fcb88e253cab4548925e", "SEAL_DRIFT");
  const bytes = readFileSync(RESUME_PLAN), baselineBytes = readFileSync(RESUME_BASE);
  check(digest(bytes) === seal.manifest_sha256 && digest(baselineBytes) === seal.baseline_sha256, "FROZEN_HASH");
  const plan = JSON.parse(bytes.toString()) as ReturnType<typeof buildResumePlan>;
  check(isDeepStrictEqual(plan, buildResumePlan(seal.baseline_sha256)), "MANIFEST_DRIFT");
  check(digest(readFileSync(INTERRUPTION_AUDIT)) === INTERRUPTION_SHA, "HISTORICAL_HASH");
  check(digest(readFileSync("packages/salon-secretary/evaluation/results/phase-a-after-interrupted-continuation.dump")) === INTERRUPTION_DUMP_SHA, "HISTORICAL_HASH");
  return { plan, baseline: JSON.parse(baselineBytes.toString()) as ResumeBaseline, binding: seal.manifest_sha256, seal };
}

/** Health query is read-only, bound to the disposable runtime, bounded without retries. */
export async function resumeHealth(runtime: PrismaClient, paid: boolean) {
  check(process.env.SALON_SECRETARY_MODEL === "gpt-6-luna" && process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED === "false" &&
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === String(paid), "FLAGS");
  process.kill(process.pid, 0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      runtime.$queryRaw<{ db: string; role: string; port: number; super: boolean; bypass: boolean }[]>`
        SELECT current_database() AS db, current_user AS role, inet_server_port() AS port,
        rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("PHASE_A_DURABLE_DB_TIMEOUT")), 5000); }),
    ]);
    check(rows.length === 1 && rows[0].db === "everflair_service_mvp" && rows[0].role === "mvp_service_runtime" &&
      rows[0].port === 55441 && !rows[0].super && !rows[0].bypass, "DB_IDENTITY");
  } catch { durableFail("DB_HEALTH"); }
  finally { clearTimeout(timer); }
}

export async function resumePreflight(admin: PrismaClient, runtime: PrismaClient, rows: readonly DurableRow[] = []) {
  const frozen = verifyResumePlan();
  assertPhaseAEnvironment(); await resumeHealth(runtime, false);
  const identity = await assertPhaseADatabase(admin, runtime);
  const last = rows.findLast(r => r.kind === "CASE_COMPLETED");
  const expected = last ? (last.data as { baseline: ResumeBaseline }).baseline : frozen.baseline;
  const actual = await captureResumeState(admin);
  assertResumeState(actual, expected);
  // On restart the business baseline must still be the original one, independently of journal technical deltas.
  check(actual.operational.every((r, i) => isDeepStrictEqual(r.hashes, frozen.baseline.operational[i].hashes) &&
    isDeepStrictEqual(r.counts, frozen.baseline.operational[i].counts)), "OPERATIONAL_EFFECT");
  const source = verifyPhaseAContinuation(process.cwd()).source;
  for (const c of source.cases) {
    const approved = actual.operational.find(r => r.case_id === c.case_id)!;
    await precheckPhaseACase(admin, runtime, makeFixture(c.case_id, c.fixture), { kind: "APPROVED_RESUME_HISTORY",
      case_id: c.case_id, count: approved.technical_audits, technical_audit_hash: approved.technical_audit_hash! });
  }
  return { ...frozen, identity, case_count: 15, turn_count: 17, historical_technical_logs: 69,
    journal: resolve(RESUME_JOURNAL), current: actual };
}
