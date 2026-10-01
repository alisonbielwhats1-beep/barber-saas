/** Pure helpers of the Agenda practice harness (evaluation only): budget stages and their
 * hash-chained journals, run-day date templating, scenario/fixture rendering, the exact
 * final-state oracle, the legacy E-map bridge, pass^k and the offline turn classifier.
 * No database and no network here; the journal functions touch only local files. */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { assertSecretaryResponsesPayload } from '../src/openai-cost-guard';
import { AGENT_EFFORTS, AGENT_LIMITS, agentMissingDependencies, agentRoundEfforts } from '../src/agent-context';
import type { FreeUseFixture } from './free-use-contract';
import { armFlags, devBatteryMessages, devBatteryScenarios, exampleBankCorpus, formatRunStats, nameTokens, runStats, scenarioMessages, scenarioNames, similarityStrata,
  type ArmProfile, type PasskArm } from './agenda-practice-stats';

export const TZ = 'America/Sao_Paulo';
export const PRICE = { inputPerM: 0.10, cacheWritePerM: 0.125, outputPerM: 0.50, framing: 8192, maxInput: 64_000 };
/** Fixed allowlist. Each stage owns its journal file and cap; there is no reset, refund or override. A stage cap bounds
 * RESERVATIONS (worst case per call, ~10x the real cost); the real money limit is the program ledger (program-spend.ts,
 * US$ 15.00 since 29/09, see PROGRAM_CAP_HISTORY), enforced for every paid call whatever the stage. `final-20260929`: the final battery (sealed holdouts and
 * validation set), its own journal so development runs never eat its headroom. Candidate 4 (29/09): `c4-dev-20260929` for its
 * real-model DEV checks and `c4-proof-20260930` for its sealed proof, each with its own journal (the older stages keep theirs).
 * Candidate 5 (30/09, docs/c5-spike/11 §10): `c5-agent-20261001` for the paired C4 × agent batteries (S1 to S5, both arms). With
 * up to 3 calls per owner message the agent arm reserves ~3x a C4 run of the same scenarios; the stage never releases a
 * reservation, so its cap (US$ 60 of reservations) covers S1-S5 of both arms with margin, while the program ledger stays the
 * real-money limit. */
export const AGENDA_STAGES = {
  'agenda-core-20260927': { journal: 'stage-budget.jsonl', capMicroUsd: 7_000_000 },
  'reliability-20260927': { journal: 'reliability-stage-budget.jsonl', capMicroUsd: 15_000_000 },
  'final-20260929': { journal: 'final-20260929-stage-budget.jsonl', capMicroUsd: 40_000_000 },
  'c4-dev-20260929': { journal: 'c4-dev-20260929-stage-budget.jsonl', capMicroUsd: 15_000_000 },
  'c4-proof-20260930': { journal: 'c4-proof-20260930-stage-budget.jsonl', capMicroUsd: 40_000_000 },
  'c5-agent-20261001': { journal: 'c5-agent-20261001-stage-budget.jsonl', capMicroUsd: 60_000_000 },
} as const;
export type AgendaStageName = keyof typeof AGENDA_STAGES;
export const LEGACY_AGENDA_STAGE: AgendaStageName = 'agenda-core-20260927';
export const DEFAULT_AGENDA_STAGE: AgendaStageName = 'reliability-20260927';
/** Conservative request size for the headroom preflight (historical bodies: 30-36 KB). */
export const ESTIMATE_BODY_BYTES = 40_000;
export const DEFAULT_OUTPUT_TOKENS = 8192;
export const APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export const LEGACY_CHECK_PATH = 'packages/salon-secretary/evaluation/agenda-practice-check.cjs';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function agendaStage(name: string = DEFAULT_AGENDA_STAGE) {
  if (!Object.hasOwn(AGENDA_STAGES, name)) throw Error('AGENDA_STAGE_UNKNOWN');
  const stage = AGENDA_STAGES[name as AgendaStageName];
  return { name: name as AgendaStageName, journal: stage.journal, capMicroUsd: stage.capMicroUsd };
}
export const stageJournalPath = (resultsRoot: string, stage: AgendaStageName) => join(resultsRoot, agendaStage(stage).journal);

// ---------------------------------------------------------------- stage journal
export type Reservation = { stage: string; id: string; run: string; scenario: string; step: number; bodyBytes: number; maxOutputTokens: number; reservedMicroUsd: number; previousHash: string; rowHash: string };
export const reservationMicroUsd = (bodyBytes: number, maxOutputTokens: number) =>
  Math.ceil((bodyBytes + PRICE.framing) * PRICE.cacheWritePerM + maxOutputTokens * PRICE.outputPerM);
function stageFile(file: string, stage: AgendaStageName) {
  const s = agendaStage(stage);
  if (basename(file) !== s.journal) throw Error('AGENDA_STAGE_JOURNAL');
  return s;
}
export function readStage(file: string, stage: AgendaStageName = LEGACY_AGENDA_STAGE): Reservation[] {
  const { capMicroUsd } = stageFile(file, stage);
  if (!existsSync(file)) return [];
  let prior = 'GENESIS', total = 0; const rows: Reservation[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as Reservation; const { rowHash, ...body } = row;
    if (row.stage !== stage || row.previousHash !== prior || rowHash !== digest(JSON.stringify(body))) throw Error('AGENDA_STAGE_JOURNAL');
    total += row.reservedMicroUsd; if (total > capMicroUsd) throw Error('AGENDA_STAGE_JOURNAL');
    rows.push(row); prior = rowHash;
  }
  return rows;
}
export function stageTotals(file: string, stage: AgendaStageName = LEGACY_AGENDA_STAGE) {
  const rows = readStage(file, stage), reservedMicroUsd = rows.reduce((n, r) => n + r.reservedMicroUsd, 0), cap = agendaStage(stage).capMicroUsd;
  return { name: stage, requests: rows.length, reservedUsd: reservedMicroUsd / 1e6, reservedMicroUsd, remainingMicroUsd: cap - reservedMicroUsd, capUsd: cap / 1e6 };
}
/** `lease`: the run's held stage lease (the runner always passes it; reserve() then refuses a stage leased by anyone else).
 * `lockWaitMs`: the bounded lock wait (default STAGE_LOCK_WAIT_MS; tests shorten it). `agent` (C5): the runner's agent arm
 * (SALON_SECRETARY_AGENT, read once by the runner): the payload guard then admits the agent's wire too; the C4 wire is checked as before. */
export type ReserveOptions = { lease?: StageLease; lockWaitMs?: number; agent?: boolean };
/** Admission before transport: payload guard, input cap, exclusive lock (bounded wait), stage lease, stage cap, fsynced
 * hash-chained row. A lock still held after the wait is AGENDA_STAGE_LOCKED (never a raw errno); the journal is untouched. */
export function reserve(file: string, run: string, scenario: string, step: number, body: string, stage: AgendaStageName = LEGACY_AGENDA_STAGE, opts: ReserveOptions = {}): Reservation {
  const { capMicroUsd } = stageFile(file, stage);
  const payload = JSON.parse(body); assertSecretaryResponsesPayload(payload, 'gpt-6-luna', { agent: opts.agent === true });
  const bodyBytes = Buffer.byteLength(body, 'utf8'), inputUpper = bodyBytes + PRICE.framing;
  if (inputUpper > PRICE.maxInput) throw Error('AGENDA_INPUT_CAP');
  const reservedMicroUsd = reservationMicroUsd(bodyBytes, payload.max_output_tokens);
  assertNotRealJournalInTest(file);
  const lock = takeLock(file + '.lock', { pid: process.pid, host: hostname(), run: codeLabel(run) }, opts.lockWaitMs ?? STAGE_LOCK_WAIT_MS, 'AGENDA_STAGE_LOCKED');
  try {
    checkStageLease(file, stage, opts.lease); // another run's lease (or a lease-less call while one is held) never gets a row
    const rows = readStage(file, stage), spent = rows.reduce((n, r) => n + r.reservedMicroUsd, 0);
    if (spent + reservedMicroUsd > capMicroUsd) throw Error('AGENDA_STAGE_CAP');
    const body2 = { stage, id: randomUUID(), run, scenario, step, bodyBytes, maxOutputTokens: payload.max_output_tokens, reservedMicroUsd, previousHash: rows.at(-1)?.rowHash ?? 'GENESIS' };
    const row = { ...body2, rowHash: digest(JSON.stringify(body2)) };
    const out = openSync(file, 'a', 0o600); try { writeSync(out, JSON.stringify(row) + '\n'); fsyncSync(out); } finally { closeSync(out); }
    if (opts.lease) touchLease(file); // heartbeat
    return row;
  } finally { dropLock(lock); }
}

// ---------------------------------------------------------------- stage lock (bounded wait) and per-stage run lease (F1)
/** Bounded wait of the stage lock: the program ledger's backoff (5 -> 50 ms), with a ~5 s deadline. A concurrent reserve
 * holds it for a few ms; a lock still there after the deadline is another runner or a lock left by a killed process. */
export const STAGE_LOCK_WAIT_MS = 5_000;
/** A lease file younger than this that cannot be parsed yet is being written (BUSY); an older one needs the operator (STALE). */
export const LEASE_WRITE_GRACE_MS = 10_000;
const LOCK_BUSY = ['EEXIST', 'EPERM', 'EACCES', 'EBUSY'], SHARING = ['EPERM', 'EACCES', 'EBUSY'];
const errnoOf = (e: unknown) => String((e as NodeJS.ErrnoException | undefined)?.code ?? '');
const pauseMs = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const codeLabel = (v: string) => String(v).replace(/[^A-Za-z0-9_.:#+-]/g, '_').slice(0, 120);
const vitestWorker = () => { const state: unknown = Reflect.get(globalThis, '__vitest_worker__'); return typeof state === 'object' && state !== null; };
const insidePath = (child: string, parent: string) => {
  const fold = (p: string) => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p), rel = relative(fold(parent), fold(child));
  return rel === '' || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..');
};
/** Evaluation results of this checkout (the real stage journals live there). */
export const REAL_RESULTS_ROOT = 'packages/salon-secretary/evaluation/results';
/** Fail closed: a unit test (the VITEST variable or a vitest worker) never locks, leases or appends to a real journal. */
function assertNotRealJournalInTest(file: string) {
  if ((process.env.VITEST || vitestWorker()) && insidePath(file, join(process.cwd(), REAL_RESULTS_ROOT))) throw Error('AGENDA_STAGE_TEST_JOURNAL');
}
export type LockHolder = { pid: number; host: string; run: string; at: string };
type HeldLock = { fd: number; path: string };
/** O_EXCL lock file with the bounded backoff; it records {pid, host, run, at} for diagnosis only. */
function takeLock(path: string, holder: Omit<LockHolder, 'at'>, waitMs: number, code: string): HeldLock {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (let delay = 5; ; delay = Math.min(delay * 2, 50)) {
    let fd: number;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (e) {
      if (!LOCK_BUSY.includes(errnoOf(e))) throw Error(code === 'AGENDA_STAGE_LOCKED' ? 'AGENDA_STAGE_LOCK_IO' : code);
      if (Date.now() >= deadline) throw Object.assign(Error(code), { details: lockDiagnosis(path) });
      pauseMs(delay); continue;
    }
    try { writeSync(fd, JSON.stringify({ ...holder, at: new Date().toISOString() })); } catch { /* diagnosis only */ }
    return { fd, path };
  }
}
/** Close and remove; a Windows sharing error is retried (~6 s). An unreleasable lock fails closed (every later reserve waits
 * it out and stops with AGENDA_STAGE_LOCKED). */
function dropLock(lock: HeldLock) {
  try { closeSync(lock.fd); } catch { /* already closed */ }
  for (let attempt = 1; ; attempt++) {
    try { unlinkSync(lock.path); return; }
    catch (e) { if (errnoOf(e) === 'ENOENT') return; if (attempt >= 30 || !SHARING.includes(errnoOf(e))) throw Error('AGENDA_STAGE_LOCKED'); pauseMs(Math.min(25 * attempt, 250)); }
  }
}
/** true = the process exists (or exists and is not ours to signal), false = gone, null = not checkable (another host). */
export function processAlive(pid: number, host: string = hostname()): boolean | null {
  if (host !== hostname()) return null;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return errnoOf(e) === 'EPERM'; }
}
/** Who holds a lock file (codes, pid, host and age only). */
export function lockDiagnosis(path: string) {
  let text = '', ageMs: number | null = null;
  try { ageMs = Math.max(0, Date.now() - statSync(path).mtimeMs); text = readFileSync(path, 'utf8'); } catch { return { present: false }; }
  let holder: Partial<LockHolder> = {}; try { holder = JSON.parse(text) as Partial<LockHolder>; } catch { holder = {}; }
  const pid = Number(holder.pid), host = typeof holder.host === 'string' ? holder.host : null;
  return { present: true, pid: Number.isSafeInteger(pid) ? pid : null, host, run: typeof holder.run === 'string' ? codeLabel(holder.run) : null, ageMs,
    alive: Number.isSafeInteger(pid) && host ? processAlive(pid, host) : null };
}
/** Takes and releases an O_EXCL lock with the bounded wait, without doing anything under it (infrastructure preflight). */
export function probeExclusiveLock(path: string, code: string, waitMs: number = STAGE_LOCK_WAIT_MS) {
  assertNotRealJournalInTest(path);
  dropLock(takeLock(path, { pid: process.pid, host: hostname(), run: 'probe' }, waitMs, code));
}
/** The stage journal's lock: free now, or freed within the bounded wait; else AGENDA_STAGE_LOCKED with the holder. */
export function probeStageLock(file: string, stage: AgendaStageName, waitMs: number = STAGE_LOCK_WAIT_MS) {
  stageFile(file, stage);
  mkdirSync(dirname(file), { recursive: true });
  probeExclusiveLock(file + '.lock', 'AGENDA_STAGE_LOCKED', waitMs);
}
/** One runner per stage for a whole run: `<journal>.lease`, created exclusively, never rewritten (the heartbeat is its mtime). */
export type StageLease = { v: 1; stage: AgendaStageName; id: string; run: string; pid: number; host: string; startedAt: string };
export const stageLeasePath = (file: string) => file + '.lease';
const LEASE_KEYS = ['v', 'stage', 'id', 'run', 'pid', 'host', 'startedAt'].join();
function parseLease(text: string, stage: AgendaStageName): StageLease | null {
  let v: unknown; try { v = JSON.parse(text); } catch { return null; }
  const x = v as Record<string, unknown>;
  if (!x || typeof x !== 'object' || Object.keys(x).join() !== LEASE_KEYS || x.v !== 1 || x.stage !== stage || typeof x.id !== 'string' || !/^[0-9a-f-]{36}$/.test(x.id) ||
    typeof x.run !== 'string' || !x.run || typeof x.pid !== 'number' || !Number.isSafeInteger(x.pid) || x.pid <= 0 || typeof x.host !== 'string' || !x.host ||
    typeof x.startedAt !== 'string' || Number.isNaN(Date.parse(x.startedAt))) return null;
  return x as StageLease;
}
export type LeaseState = { state: 'FREE' } | { state: 'HELD' | 'STALE'; lease: StageLease | null; alive: boolean | null; ageMs: number; heartbeatAgeMs: number };
/** FREE; HELD (a live holder on this host, another host, or a file being written); STALE only when provably dead (this host,
 * pid gone) or unreadable for longer than the write grace. STALE is never taken over: the operator releases it. */
export function inspectStageLease(file: string, stage: AgendaStageName): LeaseState {
  stageFile(file, stage);
  let text: string, mtime: number;
  try { text = readFileSync(stageLeasePath(file), 'utf8'); mtime = statSync(stageLeasePath(file)).mtimeMs; }
  catch (e) { if (errnoOf(e) === 'ENOENT') return { state: 'FREE' }; throw Error('AGENDA_STAGE_BUSY'); }
  const lease = parseLease(text, stage), heartbeatAgeMs = Math.max(0, Date.now() - mtime);
  if (!lease) return { state: heartbeatAgeMs < LEASE_WRITE_GRACE_MS ? 'HELD' : 'STALE', lease: null, alive: null, ageMs: heartbeatAgeMs, heartbeatAgeMs };
  const alive = processAlive(lease.pid, lease.host);
  return { state: alive === false ? 'STALE' : 'HELD', lease, alive, ageMs: Math.max(0, Date.now() - Date.parse(lease.startedAt)), heartbeatAgeMs };
}
const leaseDetails = (s: Exclude<LeaseState, { state: 'FREE' }>) => ({ state: s.state, id: s.lease?.id ?? null, run: s.lease ? codeLabel(s.lease.run) : null, pid: s.lease?.pid ?? null,
  host: s.lease?.host ?? null, alive: s.alive, ageMs: s.ageMs, heartbeatAgeMs: s.heartbeatAgeMs });
function leaseRefusal(file: string, stage: AgendaStageName) {
  const s = inspectStageLease(file, stage);
  if (s.state === 'FREE') return Error('AGENDA_STAGE_LEASE_IO');
  return Object.assign(Error(s.state === 'STALE' ? 'AGENDA_STAGE_LEASE_STALE' : 'AGENDA_STAGE_BUSY'), { details: leaseDetails(s) });
}
/** Takes the stage for this run (before any database access, holdout look or network). A held lease is AGENDA_STAGE_BUSY, a
 * dead one AGENDA_STAGE_LEASE_STALE (operator release: scripts/agenda-stage-release.cjs); neither is ever taken over. */
export function acquireStageLease(file: string, stage: AgendaStageName, run: string): StageLease {
  stageFile(file, stage); assertNotRealJournalInTest(file);
  mkdirSync(dirname(file), { recursive: true });
  const lease: StageLease = { v: 1, stage, id: randomUUID(), run: codeLabel(run) || 'run', pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  let fd: number | undefined;
  for (let attempt = 1; fd === undefined; attempt++) {
    try { fd = openSync(stageLeasePath(file), 'wx', 0o600); }
    catch (e) {
      if (!LOCK_BUSY.includes(errnoOf(e))) throw Error('AGENDA_STAGE_LEASE_IO');
      const refusal = leaseRefusal(file, stage); // a holder that released in between: try again (bounded)
      if (refusal.message !== 'AGENDA_STAGE_LEASE_IO' || attempt >= 3) throw refusal;
      pauseMs(20);
    }
  }
  try { writeSync(fd!, JSON.stringify(lease)); fsyncSync(fd!); } finally { closeSync(fd!); }
  return lease;
}
const sameLease = (a: StageLease | null, b: StageLease) => !!a && a.id === b.id && a.run === b.run && a.pid === b.pid && a.host === b.host && a.stage === b.stage && a.startedAt === b.startedAt;
/** Inside the stage lock: no lease on disk admits only a lease-less call; a lease admits only its own holder (this process). */
function checkStageLease(file: string, stage: AgendaStageName, held?: StageLease) {
  let text: string | undefined;
  try { text = readFileSync(stageLeasePath(file), 'utf8'); } catch (e) { if (errnoOf(e) !== 'ENOENT') throw Error('AGENDA_STAGE_BUSY'); }
  if (text === undefined) { if (held) throw Error('AGENDA_STAGE_LEASE_LOST'); return; }
  if (!held || held.pid !== process.pid || held.host !== hostname() || !sameLease(parseLease(text, stage), held)) throw Error('AGENDA_STAGE_BUSY');
}
function touchLease(file: string) { try { const now = new Date(); utimesSync(stageLeasePath(file), now, now); } catch { /* heartbeat is diagnosis only */ } }
/** The lease on disk is still this run's (and this process's); refreshes the heartbeat. */
export function assertStageLeaseHeld(lease: StageLease, file: string, stage: AgendaStageName) {
  stageFile(file, stage);
  if (lease.stage !== stage) throw Error('AGENDA_STAGE_BUSY');
  checkStageLease(file, stage, lease);
  touchLease(file);
}
export const heartbeatStageLease = assertStageLeaseHeld;
/** The holder's own release (end of run). Another run's lease is never removed here. */
export function releaseStageLease(lease: StageLease, file: string, stage: AgendaStageName) {
  stageFile(file, stage);
  let text: string;
  try { text = readFileSync(stageLeasePath(file), 'utf8'); } catch (e) { if (errnoOf(e) === 'ENOENT') return; throw Error('AGENDA_STAGE_LEASE_IO'); }
  if (!sameLease(parseLease(text, stage), lease)) throw Error('AGENDA_STAGE_BUSY');
  for (let attempt = 1; ; attempt++) {
    try { unlinkSync(stageLeasePath(file)); return; }
    catch (e) { if (errnoOf(e) === 'ENOENT') return; if (attempt >= 30 || !SHARING.includes(errnoOf(e))) throw Error('AGENDA_STAGE_LEASE_IO'); pauseMs(Math.min(25 * attempt, 250)); }
  }
}
/** Operator release of a lease left behind (scripts/agenda-stage-release.cjs). `id` must be the lease id the refusal showed
 * ('INVALID' for an unreadable file). A holder that may be alive (this host with a live pid, another host, a file being
 * written) is released only with `force` (the operator checked it is not a runner). Nothing else is touched. */
export function operatorReleaseStageLease(file: string, stage: AgendaStageName, input: { id: string; force?: boolean }) {
  const s = inspectStageLease(file, stage);
  if (s.state === 'FREE') throw Error('AGENDA_STAGE_LEASE_FREE');
  if ((s.lease?.id ?? 'INVALID') !== input.id) throw Object.assign(Error('AGENDA_STAGE_LEASE_ID_MISMATCH'), { details: leaseDetails(s) });
  if (s.state !== 'STALE' && !input.force) throw Object.assign(Error('AGENDA_STAGE_BUSY'), { details: leaseDetails(s) });
  unlinkSync(stageLeasePath(file));
  return { released: 'lease' as const, ...leaseDetails(s) };
}
/** Operator release of a stage lock left by a killed process: only when its recorded holder is provably gone, else `force`. */
export function operatorReleaseStageLock(file: string, stage: AgendaStageName, input: { force?: boolean } = {}) {
  stageFile(file, stage);
  const d = lockDiagnosis(file + '.lock');
  if (!d.present) throw Error('AGENDA_STAGE_LOCK_FREE');
  if (d.alive !== false && !input.force) throw Object.assign(Error('AGENDA_STAGE_LOCKED'), { details: d });
  unlinkSync(file + '.lock');
  return { released: 'lock' as const, ...d };
}

// ---------------------------------------------------------------- dates (America/Sao_Paulo, Intl only)
const DAY_MS = 86_400_000;
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const shortWeekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEKDAYS_PT_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export function dateKeySaoPaulo(instant: Date) {
  const p = Object.fromEntries(ymd.formatToParts(instant).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const todayInSaoPaulo = (now: Date = new Date()) => dateKeySaoPaulo(now);
const clockParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** São Paulo wall clock (Intl with an explicit timeZone: independent of the process TZ; never the shell `date`). */
export function saoPauloTime(now: Date) {
  const p = Object.fromEntries(clockParts.formatToParts(now).map(x => [x.type, x.value]));
  return { date: dateKeySaoPaulo(now), h: Number(p.hour), m: Number(p.minute), s: Number(p.second) };
}
/** Milliseconds until the next 00:00 in São Paulo (a whole day at exactly midnight). No DST since 2019, as noon() assumes. */
export function msUntilSaoPauloMidnight(now: Date) {
  const t = saoPauloTime(now);
  return DAY_MS - ((t.h * 60 + t.m) * 60 + t.s) * 1000 - now.getUTCMilliseconds();
}
/** ICU self-test: 2026-09-29T02:30Z is still the 28th in São Paulo, 03:00Z the 29th; else AGENDA_TZ_UNAVAILABLE (no guessing). */
export function assertSaoPauloClock() {
  try {
    if (dateKeySaoPaulo(new Date('2026-09-29T02:30:00.000Z')) === '2026-09-28' && dateKeySaoPaulo(new Date('2026-09-29T03:00:00.000Z')) === '2026-09-29' &&
      msUntilSaoPauloMidnight(new Date('2026-09-29T02:59:59.000Z')) === 1000) return;
  } catch { /* falls through */ }
  throw Error('AGENDA_TZ_UNAVAILABLE');
}
function noon(dateKey: string) {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? Date.parse(`${dateKey}T12:00:00-03:00`) : NaN;
  if (Number.isNaN(at) || dateKeySaoPaulo(new Date(at)) !== dateKey) throw Error('AGENDA_DATE');
  return at; // America/Sao_Paulo has no DST since 2019; noon keeps any residual offset inside the day.
}
export const addDaysSaoPaulo = (dateKey: string, days: number) => dateKeySaoPaulo(new Date(noon(dateKey) + days * DAY_MS));
export const weekdaySaoPaulo = (dateKey: string) => WD_EN.indexOf(shortWeekday.format(new Date(noon(dateKey))));
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const WEEKDAY_PREFIX = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

/** Day spec: integer offset (1 = tomorrow), "+N"/"-N", or a pt-BR weekday ("sex", "sexta") = its next
 * occurrence after today (1..7 days ahead, like the legacy oracle), optionally "+N" more days ("sex+7").
 * "<weekday>@semana-que-vem" = that weekday of the NEXT calendar week, weeks Monday-Sunday (the runtime's NEXT_WEEK:
 * "terça da semana que vem" said on a Monday is +8, never tomorrow; said on a Sunday it is +2). */
export type DaySpec = number | string;
export function dayOffset(spec: DaySpec, today: string): number {
  if (typeof spec === 'number') { if (!Number.isSafeInteger(spec)) throw Error('AGENDA_DAY_SPEC'); return spec; }
  const numeric = /^\s*([+-]?\d{1,4})\s*$/.exec(spec);
  if (numeric) return Number(numeric[1]);
  const nextWeek = /^\s*(\p{L}+(?:-feira)?)\s*@\s*semana-que-vem\s*$/u.exec(spec);
  if (nextWeek) {
    const weekday = WEEKDAY_PREFIX.indexOf(fold(nextWeek[1]).slice(0, 3));
    if (weekday < 0) throw Error('AGENDA_DAY_SPEC');
    return 7 - (weekdaySaoPaulo(today) + 6) % 7 + (weekday + 6) % 7; // Monday of next week, then Monday-based weekday
  }
  const named = /^\s*(\p{L}+(?:-feira)?)\s*(?:([+-])\s*(\d{1,3}))?\s*$/u.exec(spec);
  const weekday = named ? WEEKDAY_PREFIX.indexOf(fold(named[1]).slice(0, 3)) : -1;
  if (!named || weekday < 0) throw Error('AGENDA_DAY_SPEC');
  let n = 1; while (weekdaySaoPaulo(addDaysSaoPaulo(today, n)) !== weekday) n++;
  return n + (named[2] ? (named[2] === '-' ? -1 : 1) * Number(named[3]) : 0);
}
export const dayDate = (spec: DaySpec, today: string) => addDaysSaoPaulo(today, dayOffset(spec, today));
const DAY_UNITS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DAY_TEENS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
/** Day of month as dictated (speech-to-text): 1 → "primeiro", 28 → "vinte e oito". */
export function dayOfMonthWords(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 31) throw Error('AGENDA_DATE');
  if (n === 1) return 'primeiro'; if (n < 10) return DAY_UNITS[n]; if (n < 20) return DAY_TEENS[n - 10];
  const tens = n < 30 ? 'vinte' : 'trinta', u = n % 10; return u ? `${tens} e ${DAY_UNITS[u]}` : tens;
}
export function formatDay(dateKey: string, format: string) {
  const [y, m, d] = dateKey.split('-');
  switch (format) {
    case 'dd': return d;
    case 'd': return String(Number(d));
    case 'dw': return dayOfMonthWords(Number(d));
    case 'dm': return `${Number(d)}/${Number(m)}`;
    case 'ddmm': return `${d}/${m}`;
    case 'ddmmyyyy': return `${d}/${m}/${y}`;
    case 'weekday': return WEEKDAYS_PT[weekdaySaoPaulo(dateKey)];
    case 'weekdayfull': return WEEKDAYS_PT_FULL[weekdaySaoPaulo(dateKey)];
    case 'iso': noon(dateKey); return dateKey;
    default: throw Error('AGENDA_TEMPLATE_FORMAT');
  }
}
const TOKEN = /\{\{\s*d:\s*([^|{}]+?)\s*\|\s*([a-z]+)\s*\}\}/gi;
/** Renders {{d:+1|dd}}, {{d:sex|ddmm}}, {{d:+2|ddmmyyyy}}, {{d:+3|weekday}}, {{d:+1|iso}} from the run's today;
 * phone/voice forms: {{d:+2|dm}} = "29/9" (no zero padding), {{d:+1|dw}} = "vinte e oito" (dictated day of month). */
export function renderTemplate(text: string, today: string) {
  const out = text.replace(TOKEN, (_, spec: string, format: string) => formatDay(dayDate(spec, today), format.toLowerCase()));
  if (out.includes('{{') || out.includes('}}')) throw Error('AGENDA_TEMPLATE');
  return out;
}
export const templateDaySpecs = (text: string) => [...text.matchAll(TOKEN)].map(m => m[1]);

// ---------------------------------------------------------------- deterministic phrasing (PRNG)
export function hash32(value: string) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(value, 'utf8')) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const prng = (seed: string) => mulberry32(hash32(seed));
export function pickVariant<T>(variants: readonly T[], seed: string): T {
  if (!variants.length) throw Error('AGENDA_ANSWER_EMPTY');
  return variants[Math.floor(prng(seed)() * variants.length)];
}
/** string = one answer; string[] = phrasing variants of one answer; {queue} = several answers for the same field, in order. */
export type AnswerVariants = string | string[];
export type AnswerSpec = AnswerVariants | { queue: AnswerVariants[] };
export const answerInstances = (spec: AnswerSpec): AnswerVariants[] => typeof spec === 'object' && !Array.isArray(spec) ? spec.queue : [spec];
/** Answer delivery of the runner (evaluation only: AGENDA_ANSWER_DELIVERY or the run option, never a product flag).
 * 'field' (default, every run recorded before 30/09): the first pending field with an unused instance, instances in order.
 * 'item': a pending service_changes* field without an answer of its own takes the scenario's service answers (ANSWER_ALIASES),
 * and when the question names an item (answerQuestion) the instance naming that item's customer wins, while one naming only
 * another item waiting for the same field, or a customer only a later scripted say introduces, waits for its own question.
 * Grading never reads it; the pass^k report and the arm profile do (a confound when arms differ). */
export type AnswerDelivery = 'field' | 'item';
export function answerDeliveryMode(value: unknown): AnswerDelivery {
  if (value === undefined || value === '' || value === 'field') return 'field';
  if (value === 'item') return 'item';
  throw Error('AGENDA_ANSWER_DELIVERY_ARGUMENT');
}
/** 'item' delivery: pending fields answered by other answer keys when the scenario has none of their own (same meaning): never
 * when it has one (used up or held), never with a key another pending question asks, and an alias answer is never a guess (one
 * naming someone else, or naming nobody while a later say introduces a customer, waits). */
export const ANSWER_ALIASES: Readonly<Record<string, readonly string[]>> = { service_changes_ref: ['service_ref', 'service_name'], service_changes: ['service_ref', 'service_name'] };
/** Which item a delivered answer went to: the pending field it answered and, when the question named one, the plan item key. */
export type AnswerFor = { field: string; item?: string };
export type AnswerDelivered = { field: string; text: string; use: number; for?: AnswerFor };
/** Per pending field: the item the question asks (`item`), its customer's first name (`own`) and the other waiting items' (`rivals`). */
export type AnswerTarget = { item?: string; own: string[]; rivals: string[][] };
/** `focus`: the one waiting item the message names (its fields are answered first); `future`: first names of customers only a
 * later scripted say introduces. Codes and synthetic fixture first names only (never message text). */
export type AnswerQuestion = { focus?: string; first: string[]; fields: ReadonlyMap<string, AnswerTarget>; future: string[] };
export type AnswerScript = { customers: readonly string[]; said: readonly string[]; later: readonly string[] };
export type AnswerPlanAction = { key: string; status?: string; missing_fields?: unknown; fields?: unknown };
/** Folded letter words of a text (digits, punctuation and marks split). */
const letterWords = (text: unknown) => typeof text === 'string' ? fold(text).split(/[^a-z]+/).filter(Boolean) : [];
/** A customer is identified by the first name (surnames collide with common words: "dias", "santos"); articles aside. */
const firstName = (name: string) => letterWords(name).find(w => w.length > 1 && !ARTICLES.has(w));
/** 'item' delivery context of the view just received: an item "is asked" for a pending field when it is the only item waiting for
 * that field, or the one waiting item whose customer the message names. Names are grounded on the fixture's customers only
 * (a descriptive customer_name such as "última pessoa da tarde" names nobody). Malformed input yields an empty context. */
export function answerQuestion(message: unknown, actions: readonly AnswerPlanAction[] | undefined, script: AnswerScript): AnswerQuestion {
  const known = new Set(script.customers.flatMap(n => firstName(n) ?? [])), names = (text: unknown) => [...new Set(letterWords(text).filter(w => known.has(w)))];
  const told = new Set(names(message)), list = Array.isArray(actions) ? actions.filter(a => a && typeof a === 'object') : [];
  const customer = (a: AnswerPlanAction) => names(a.fields && typeof a.fields === 'object' ? (a.fields as Record<string, unknown>).customer_name : undefined);
  const waiting = list.filter(a => a.status !== 'DONE' && Array.isArray(a.missing_fields)).map(a => ({ key: String(a.key), names: customer(a),
    missing: [...new Set((a.missing_fields as unknown[]).filter((f): f is string => typeof f === 'string').map(bare).filter(f => f && f !== 'selection'))] })).filter(a => a.missing.length);
  const named = waiting.filter(a => a.names.some(w => told.has(w))), focus = named.length === 1 ? named[0] : undefined;
  const fields = new Map<string, AnswerTarget>();
  for (const f of new Set(waiting.flatMap(a => a.missing))) {
    const on = waiting.filter(a => a.missing.includes(f)), mine = on.filter(a => named.includes(a)), asked = on.length === 1 ? on[0] : mine.length === 1 ? mine[0] : undefined;
    fields.set(f, { ...(asked ? { item: asked.key } : {}), own: asked?.names ?? [], rivals: on.filter(a => a !== asked && a.names.length).map(a => a.names) });
  }
  const present = new Set([...list.flatMap(customer), ...script.said.flatMap(names)]);
  return { ...(focus ? { focus: focus.key } : {}), first: focus?.missing ?? [], fields, future: [...new Set(script.later.flatMap(names))].filter(w => !present.has(w)) };
}
/** Answers only fields the runtime actually asks for; each instance is used once. Variant choice is seeded by
 * (scenario, attempt, field, instance) so pass^k samples phrasing without depending on turn order; `use` is the instance
 * number (the noise seed `answer:<field>:<use>` of noiseSources), also when 'item' delivery takes instances out of order. */
export class AnswerBook {
  private readonly used = new Map<string, Set<number>>();
  constructor(private readonly answers: Record<string, AnswerSpec> | undefined, private readonly seed: string, private readonly today: string,
    private readonly delivery: AnswerDelivery = 'field') {}
  private unused(field: string) {
    if (!this.answers || !Object.hasOwn(this.answers, field)) return [];
    const used = this.used.get(field);
    return answerInstances(this.answers[field]).map((value, n) => ({ value, n })).filter(x => !used?.has(x.n));
  }
  has(field: string) { return this.unused(field).length > 0; }
  next(pending: string[], question?: AnswerQuestion): AnswerDelivered | undefined {
    if (this.delivery !== 'item') {
      const field = pending.find(f => this.has(f));
      if (!field) return undefined;
      return this.take(field, this.unused(field)[0].n);
    }
    const order = [...new Set([...(question?.first ?? []).filter(f => pending.includes(f)), ...pending])];
    for (const asked of order) {
      // The scenario's own key only, when it has one; else its aliases that no pending question asks for itself.
      const keys = this.answers && Object.hasOwn(this.answers, asked) ? [asked] : (Object.hasOwn(ANSWER_ALIASES, asked) ? ANSWER_ALIASES[asked] : []).filter(k => !pending.includes(k));
      for (const key of keys) {
        const target = question?.fields.get(asked), n = this.pick(key, target, question?.future ?? [], key !== asked);
        if (n !== undefined) return { ...this.take(key, n), for: { field: asked, ...(target?.item !== undefined ? { item: target.item } : {}) } };
      }
    }
    return undefined;
  }
  /** Without an asked item: the first unused instance. With one: an instance naming it (alone before one also naming another
   * waiting item or a future customer), else one naming nobody; one naming only others is never delivered to this question.
   * `alias` (another field's key): only an instance naming nobody else, and a neutral one only while no later say introduces a customer. */
  private pick(key: string, target: AnswerTarget | undefined, future: readonly string[], alias = false) {
    let best: { n: number; rank: number } | undefined;
    for (const { value, n } of this.unused(key)) {
      const said = new Set((Array.isArray(value) ? value : [value]).flatMap(letterWords));
      const own = !!target?.own.some(w => said.has(w)), other = !!target?.rivals.some(r => r.some(w => said.has(w))) || future.some(w => said.has(w));
      const rank = alias && (other || !own && future.length > 0) ? undefined : target?.item === undefined ? 0 : own ? (other ? 1 : 0) : other ? undefined : 2;
      if (rank !== undefined && (!best || rank < best.rank)) best = { n, rank };
    }
    return best?.n;
  }
  private take(field: string, n: number): AnswerDelivered {
    const used = this.used.get(field) ?? new Set<number>(); used.add(n); this.used.set(field, used);
    const value = answerInstances(this.answers![field])[n];
    const text = Array.isArray(value) ? pickVariant(value, `${this.seed}|${field}|${n}`) : value;
    return { field, text: renderTemplate(text, this.today), use: n + 1 };
  }
}

// ---------------------------------------------------------------- scenarios
/** Step expectations (graded offline from the transcript): say `expect` READY = precondition (unmet → INVALID attempt),
 * READ_DONE = a read finished without error; confirm `expectError` = the step must fail with that code (a probe);
 * choose/select must succeed unless `optional`. */
export type SayExpectation = 'READY' | 'READ_DONE';
export type Step = { say: string; expect?: SayExpectation } | { confirm: true | 'all'; expectError?: string } | { select: string; optional?: true }
  | { choose: number; action?: string; optional?: true } | { note: string };
export type ScenarioCustomer = { key?: string; name: string; phone?: string; email?: string };
export type ScenarioProfessional = { key?: string; name: string; services?: string[]; weekdays?: number[]; from?: string; to?: string;
  /** Salon scenarios only (multi-salon v3, e.g. a morning-only professional): this professional's own weekly windows, each
   * inside one salon window of its weekday, on exactly the weekdays the professional works; replaces the salon windows. */
  hours?: { weekday: number; from: string; to: string }[] };
/** `service`: one catalog key. `services` (MULTI_SERVICE_SEED_VERSION, 29/09; exclusive with `service`): a pre-existing
 * appointment with several services, 2..4 distinct catalog keys in order, seeded as the product stores one (one appointment,
 * one service row per position: agenda-practice-seed.ts) and projected as the names joined by '+' ("A+B"). */
export type ScenarioAppointment = { key: string; customer: string; professional: string; day: DaySpec; time: string } &
  ({ service: string; services?: undefined } | { services: string[]; service?: undefined });
export const MULTI_SERVICE_SEED_VERSION = 1;
export const MULTI_SERVICE_SEED_LIMITS = { min: 2, max: 4 } as const;
/** The catalog keys of a seeded appointment, in order (one for `service`). */
export const appointmentServiceKeys = (a: ScenarioAppointment): string[] => a.services !== undefined ? [...a.services] : [a.service];
/** A multi-service seed as buildScenarioFixture hands it to seedMultiServiceAppointments (never part of the FreeUseFixture). */
export type MultiServiceSeed = { key: string; customerKey: string; professionalKey: string; serviceKeys: string[]; startAt: string; status: 'CONFIRMED' };
/** `reason`: literal core(s) of the cancellation reason (accent/case-folded substring, any of). `reasonNot`: cores this
 * cancellation's stored reason must NOT contain (another customer's name or reason: one sentence stored on both records). */
export type FinalAppointment = { customer: string; service: string; day: DaySpec; time: string; end?: string; professional?: string; status?: string; reason?: string | string[];
  reasonNot?: string | string[] };
export type FinalBlock = { professional: string; day: DaySpec; from: string; to: string; endDay?: DaySpec; reason?: string };
/** A whole synthetic salon replacing the base fixture (multi-salon generator): its own catalog and weekly windows (several
 * windows on one weekday = a break). The scenario's customers and professionals are then the only ones: no base customer,
 * professional or service is seeded. `type` is a label only. */
export type ScenarioSalonService = { key?: string; name: string; durationMin: number; priceCents: number };
export type ScenarioSalon = { type?: string; services: ScenarioSalonService[]; hours: { weekday: number; from: string; to: string }[] };
/** Tenant tables projected as effect digests. The appointment family changes with any appointment write
 * (services of the booking, events, their INTERNAL notifications, resources); the rest never may unless declared. */
export const APPOINTMENT_EFFECTS = ['appointment_services', 'appointment_events', 'resource_bookings', 'outbox_internal'] as const;
export const OTHER_EFFECTS = ['outbox_external', 'customers', 'services', 'products', 'appointment_products', 'closures', 'payments', 'professionals', 'working_hours', 'professional_services'] as const;
export const EFFECT_TABLES = [...APPOINTMENT_EFFECTS, ...OTHER_EFFECTS] as const;
/** Fields a transcript oracle may require as asked ('selection' = a real choice was presented; 'destination_mode' /
 * 'override_requested' = the calendar-conflict questions: another slot, or an explicit overbooking decision). */
export const ASK_FIELDS = ['customer_ref', 'appointment_ref', 'professional_ref', 'service_ref', 'selection', 'time', 'date', 'end_time', 'reason',
  'destination_mode', 'override_requested'] as const;
/** Read-content oracle (28/09 blind oracle audit). Graded on the transcript's FINAL read turn (the last row whose plan has a
 * DONE read action): every DONE read action of that turn must be `operation` (one of), its own name fields must name
 * `professional` / `service` (canonical names; articles aside, every word said is a word of the name) and its date must be
 * `day`; the appointments it lists and the slots it publishes must be of that professional and day. Its reply (the turn's
 * message) must mention every `replyMustMention` entry ("HH:MM" = a clock time of the reply, e.g. "9h15"; anything else =
 * accent/case-folded text) and offer no time t with from < t < to of `replyMustNotOffer` (clock times of the reply and
 * the read's published slots); every other action of that turn fails it (`pending:` still waits for the owner, `stray:`
 * anything else that is not a finished read, e.g. a FAILED write).
 * Tightened after the 28/09 re-review: in a seeded run the resolved refs (`professional_ref`, `service_ref`) must be the
 * expected entities, not only the literal names; an "HH:MM" mention must also be a time the read published (a slot or a
 * listed booking: `unpublished:`); an `appointment.list` with `day` must list exactly the bookings of that day (and
 * professional) in the DB at the read turn (`rows`: a whole-day agenda, any status) and its reply must give each one a line
 * with that time naming that customer and no other (`pair:<HH:MM>`), with no other line carrying a clock (`reply-extra`).
 * Any miss is READ_CONTENT_MISMATCH (a wrong answer, not a write: not SAFETY; a read that never finished stays
 * READ_NOT_DONE, and a safe unanswered question stays a failure without SAFETY).
 * Read projection v2 (29/09, results recorded from READ_PROJECTION_V2_RUN on; see readProjection): the rows of a
 * customer-upcoming read (C32: an appointment read with a resolved customer and no date, on a turn whose router outcome
 * carries READ_UPCOMING) are published too, with the day agenda's strictness: the read's customer is established (the
 * resolved ref in a seeded run, else the one fixture customer its name names: `customer`), every listed row is that
 * customer's and the rows are exactly the first ones of that customer's PENDING/CONFIRMED bookings from the read day on in
 * the DB at the read turn, in order, with the read's professional/service filters (`rows`; only today's bookings before the
 * first listed one may be left out: they may have passed), the reply names that customer by the registered name and no
 * other customer (`customer`), gives each row a line with its dd/mm and clock (`pair:<HH:MM>`) and, when these are the
 * turn's only reads, no other line carrying a clock (`reply-extra`). */
export type TimeWindow = { from: string; to: string };
export type ReadOracle = { operation: string | string[]; professional?: string; service?: string; day?: DaySpec; replyMustMention?: string[];
  replyMustNotOffer?: TimeWindow | TimeWindow[] };
/** Exact final DB state (default exact=true: omitted lists mean "none"); `unchanged` = final equals initial.
 * Transcript oracles: `mustAsk` = one of these fields was asked before the first write (no auto-pick);
 * `noPendingPlan` = the last turn holds no active or suspended plan; `effects` = extra effect tables allowed to change;
 * `read` = the content of the final read (ReadOracle). */
export type FinalOracle = { exact?: boolean; unchanged?: boolean; appointments?: FinalAppointment[]; blocks?: FinalBlock[];
  mustAsk?: string[]; noPendingPlan?: boolean; effects?: string[]; read?: ReadOracle };
export type AgendaScenario = { id: string; title: string; capability: string[]; steps: Step[];
  appointments?: ScenarioAppointment[];
  customers?: ScenarioCustomer[];
  /** Extra professionals merged into the base fixture (services default: all). */
  professionals?: ScenarioProfessional[];
  /** Salon open weekdays override (0=Sunday). */
  openWeekdays?: number[];
  /** A whole salon instead of the base fixture (catalog and weekly windows); exclusive with `openWeekdays`. */
  salon?: ScenarioSalon;
  /** The scenario deliberately targets a closed day; the run-day preflight must not skip it. */
  expectsClosure?: boolean;
  /** Extra relative days the scenario depends on (for the run-day preflight). */
  days?: DaySpec[];
  expect?: string;
  /** Natural replies sent only when the Secretary actually asks for that field (field names without item prefix). */
  answers?: Record<string, AnswerSpec>;
  /** false = every text of the scenario is sent exactly as written whatever --noise says (e.g. exact message content). */
  noise?: boolean;
  /** Literal regions (templates allowed) of say/answer texts that --noise never alters. */
  noNoise?: string[];
  final?: FinalOracle };

export const BASE_FIXTURE = {
  customers: [
    { key: 'amanda', name: 'Amanda Souza', phone: '11987650001' },
    { key: 'joao', name: 'João Pereira', phone: '11987650002' },
    { key: 'fabio', name: 'Fábio Santos', phone: '11987650003' },
    { key: 'carla', name: 'Carla Mendes', phone: '11987650004' },
    { key: 'rosa', name: 'Rosa Viana', phone: '11987650005' },
  ],
  professionals: [{ key: 'tatiana', name: 'Tatiana Rocha' }, { key: 'ricardo', name: 'Ricardo Alves' }],
  services: [
    { key: 'corte', name: 'Corte Completo', durationMin: 60, priceCents: 8000, professionalKeys: ['tatiana', 'ricardo'] },
    { key: 'escova', name: 'Escova', durationMin: 45, priceCents: 6000, professionalKeys: ['tatiana'] },
    { key: 'barba', name: 'Barba', durationMin: 30, priceCents: 4000, professionalKeys: ['ricardo'] },
    { key: 'coloracao', name: 'Coloração', durationMin: 120, priceCents: 20000, professionalKeys: ['tatiana'] },
  ],
  products: [] as never[],
  openWeekdays: [1, 2, 3, 4, 5, 6], openMinutes: 9 * 60, closeMinutes: 19 * 60, closures: [] as never[],
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const slug = (name: string) => { const k = fold(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return /^[a-z]/.test(k) ? k : 'x_' + k; };
const uniqueKey = (key: string, used: Set<string>) => { let k = key, n = 2; while (used.has(k)) k = `${key}_${n++}`; used.add(k); return k; };
/** `windows` (salon scenarios only): the professional's whole weekly schedule, replacing the seeded uniform day. */
export type ProfessionalHours = { key: string; weekdays?: number[]; fromMinutes?: number; toMinutes?: number; windows?: HoursWindow[] };
export type HoursWindow = { weekday: number; startMinutes: number; endMinutes: number };
/** Weekly windows of a salon scenario, by weekday then start. */
export const salonWindows = (salon: ScenarioSalon): HoursWindow[] => salon.hours.map(h => ({ weekday: h.weekday, startMinutes: minutes(h.from), endMinutes: minutes(h.to) }))
  .sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes);
/** Salon services with their fixture keys (given, or derived from the name like customer keys). */
export function salonServices(salon: ScenarioSalon) {
  const used = new Set(salon.services.flatMap(x => x.key !== undefined ? [x.key] : []));
  return salon.services.map(x => ({ key: x.key ?? uniqueKey(slug(x.name), used), name: x.name, durationMin: x.durationMin, priceCents: x.priceCents }));
}
export const scenarioOpenWeekdays = (s: AgendaScenario) => s.salon ? [...new Set(s.salon.hours.map(h => h.weekday))].sort((a, b) => a - b) : s.openWeekdays ?? BASE_FIXTURE.openWeekdays;

/** Relative day 1 = tomorrow in the salon timezone, rendered from the run's stored `today`. With `salon`, the fixture is
 * that salon alone (its catalog, the scenario's customers and professionals) and every professional gets its windows.
 * `multiService`: the appointments with `services`, left out of the FreeUseFixture (one service per appointment there) and
 * seeded after it by seedMultiServiceAppointments; empty for every scenario without them (fixture unchanged). */
export function buildScenarioFixture(s: AgendaScenario, today: string = todayInSaoPaulo()) {
  const salon = s.salon, base = salon ? { customers: [] as typeof BASE_FIXTURE.customers, professionals: [] as typeof BASE_FIXTURE.professionals } : BASE_FIXTURE;
  const customerKeys = new Set(base.customers.map(c => c.key)), proKeys = new Set(base.professionals.map(p => p.key));
  const customers = [...base.customers, ...(s.customers ?? []).map(c => ({ key: c.key ?? uniqueKey(slug(c.name), customerKeys), name: c.name,
    ...(c.phone !== undefined ? { phone: c.phone } : {}), ...(c.email !== undefined ? { email: c.email } : {}) }))];
  const services = salon ? salonServices(salon).map(x => ({ ...x, professionalKeys: [] as string[] })) : BASE_FIXTURE.services.map(x => ({ ...x, professionalKeys: [...x.professionalKeys] }));
  const professionals: { key: string; name: string }[] = [...base.professionals], hours: ProfessionalHours[] = [], windows = salon ? salonWindows(salon) : [];
  for (const p of s.professionals ?? []) {
    const key = p.key ?? uniqueKey(slug(p.name), proKeys);
    professionals.push({ key, name: p.name });
    for (const svc of services) if (!p.services || p.services.includes(svc.name) || p.services.includes(svc.key)) svc.professionalKeys.push(key);
    if (salon) hours.push({ key, windows: (p.hours ? ownWindows(p.hours) : windows.filter(w => !p.weekdays || p.weekdays.includes(w.weekday))).map(w => ({ ...w })) });
    else if (p.weekdays || p.from || p.to) hours.push({ key, ...(p.weekdays ? { weekdays: [...p.weekdays] } : {}), ...(p.from ? { fromMinutes: minutes(p.from) } : {}), ...(p.to ? { toMinutes: minutes(p.to) } : {}) });
  }
  const startAt = (a: ScenarioAppointment) => new Date(`${dayDate(a.day, today)}T${a.time}:00-03:00`).toISOString();
  const appointments = (s.appointments ?? []).filter((a): a is Extract<ScenarioAppointment, { service: string }> => a.services === undefined).map(a => ({ key: a.key, customerKey: a.customer, professionalKey: a.professional, serviceKey: a.service,
    startAt: startAt(a), status: 'CONFIRMED' as const }));
  const multiService: MultiServiceSeed[] = (s.appointments ?? []).flatMap(a => a.services === undefined ? [] : [{ key: a.key, customerKey: a.customer, professionalKey: a.professional,
    serviceKeys: [...a.services], startAt: startAt(a), status: 'CONFIRMED' as const }]);
  const span = salon ? { openMinutes: Math.min(...windows.map(w => w.startMinutes)), closeMinutes: Math.max(...windows.map(w => w.endMinutes)) } : {};
  const fixture = { ...BASE_FIXTURE, customers, professionals, services, appointments, openWeekdays: [...scenarioOpenWeekdays(s)], ...span } as unknown as FreeUseFixture;
  return { fixture, hours, multiService };
}
/** The FreeUseFixture alone: a caller that seeds only it would silently drop multi-service appointments, so they fail closed. */
export const scenarioFixture = (s: AgendaScenario, today: string = todayInSaoPaulo()) => {
  const built = buildScenarioFixture(s, today);
  if (built.multiService.length) throw Error('AGENDA_MULTI_SERVICE_SEED_REQUIRED');
  return built.fixture;
};

function scenarioError(id: string, reason: string): never { throw Error(`AGENDA_SCENARIO_INVALID:${id}:${reason}`); }
const isDaySpec = (v: unknown) => typeof v === 'number' ? Number.isSafeInteger(v) : typeof v === 'string' && v.length > 0 && v.length < 24;
const isWeekdays = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(d => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(v).size === v.length;
const ownWindows = (list: { weekday: number; from: string; to: string }[]): HoursWindow[] => list.map(h => ({ weekday: h.weekday, startMinutes: minutes(h.from), endMinutes: minutes(h.to) }))
  .sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes);
/** A professional's own windows (salon scenarios only): valid clocks, each inside one salon window of its weekday, no
 * overlap, and exactly the weekdays the professional works (hours restrict the time of day, never the run-day preflight). */
function ownWindowsValid(p: ScenarioProfessional, s: AgendaScenario, salonDays: number[]) {
  const list = p.hours as unknown;
  if (!s.salon || !Array.isArray(list) || !list.length || list.some(h => typeof h !== 'object' || h === null || Object.keys(h).sort().join() !== 'from,to,weekday' ||
    !Number.isInteger(h.weekday) || typeof h.from !== 'string' || typeof h.to !== 'string' || !TIME.test(h.from) || !TIME.test(h.to) || minutes(h.from) >= minutes(h.to))) return false;
  const own = ownWindows(p.hours!), salon = salonWindows(s.salon), days = [...(p.weekdays ?? salonDays)].sort((a, b) => a - b);
  return own.every((w, i) => salon.some(x => x.weekday === w.weekday && x.startMinutes <= w.startMinutes && w.endMinutes <= x.endMinutes) &&
    !(i > 0 && own[i - 1].weekday === w.weekday && own[i - 1].endMinutes > w.startMinutes)) && JSON.stringify([...new Set(own.map(w => w.weekday))]) === JSON.stringify(days);
}
/** `salon`: a non-empty catalog (unique names and keys, positive duration, non-negative price) and valid, non-overlapping
 * weekly windows; `openWeekdays` would contradict its hours. */
function validateSalon(id: string, s: AgendaScenario) {
  const salon = s.salon as unknown as Record<string, unknown>;
  if (typeof salon !== 'object' || salon === null || Object.keys(salon).some(k => !['type', 'services', 'hours'].includes(k)) || (salon.type !== undefined && typeof salon.type !== 'string') ||
    !Array.isArray(salon.services) || !salon.services.length || !Array.isArray(salon.hours) || !salon.hours.length) scenarioError(id, 'SALON');
  if (s.openWeekdays !== undefined) scenarioError(id, 'SALON_OPEN_WEEKDAYS');
  const names = new Set<string>(), keys = new Set<string>();
  for (const x of salon.services as ScenarioSalonService[]) {
    if (typeof x?.name !== 'string' || !x.name.trim() || names.has(x.name) || !Number.isInteger(x.durationMin) || x.durationMin <= 0 || !Number.isInteger(x.priceCents) || x.priceCents < 0 ||
      Object.keys(x).some(k => !['key', 'name', 'durationMin', 'priceCents'].includes(k))) scenarioError(id, 'SALON_SERVICE');
    names.add(x.name);
    if (x.key !== undefined) { if (typeof x.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(x.key) || keys.has(x.key)) scenarioError(id, 'SALON_SERVICE_KEY'); keys.add(x.key); }
  }
  for (const h of salon.hours as ScenarioSalon['hours']) if (!Number.isInteger(h?.weekday) || h.weekday < 0 || h.weekday > 6 || typeof h.from !== 'string' || typeof h.to !== 'string' ||
    !TIME.test(h.from) || !TIME.test(h.to) || minutes(h.from) >= minutes(h.to)) scenarioError(id, 'SALON_HOURS');
  const w = salonWindows(s.salon!);
  if (w.some((x, i) => i > 0 && w[i - 1].weekday === x.weekday && w[i - 1].endMinutes > x.startMinutes)) scenarioError(id, 'SALON_HOURS_OVERLAP');
}
/** A read oracle: known read operations, non-empty names, a day spec, mention entries ("HH:MM" must be a clock) and windows. */
function validRead(r: unknown) {
  const x = r as Record<string, unknown>, text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (typeof r !== 'object' || r === null || Array.isArray(r) || Object.keys(x).some(k => !['operation', 'professional', 'service', 'day', 'replyMustMention', 'replyMustNotOffer'].includes(k))) return false;
  const ops = typeof x.operation === 'string' ? [x.operation] : x.operation;
  if (!Array.isArray(ops) || !ops.length || new Set(ops).size !== ops.length || ops.some(o => typeof o !== 'string' || !READ_OPERATIONS.has(o))) return false;
  if ((x.professional !== undefined && !text(x.professional)) || (x.service !== undefined && !text(x.service)) || (x.day !== undefined && !isDaySpec(x.day))) return false;
  const mention = x.replyMustMention;
  if (mention !== undefined && (!Array.isArray(mention) || !mention.length || mention.some(m => !text(m) || (/^\d{1,2}:\d{2}$/.test(m as string) && !TIME.test(m as string))))) return false;
  const windows = x.replyMustNotOffer === undefined ? [] : Array.isArray(x.replyMustNotOffer) ? x.replyMustNotOffer : [x.replyMustNotOffer];
  if (Array.isArray(x.replyMustNotOffer) && !windows.length) return false;
  return windows.every(w => typeof w === 'object' && w !== null && Object.keys(w).sort().join() === 'from,to' && TIME.test((w as TimeWindow).from) && TIME.test((w as TimeWindow).to) &&
    minutes((w as TimeWindow).from) < minutes((w as TimeWindow).to));
}
/** Structural validation only (legacy A/B/C files pass unchanged). Throws AGENDA_SCENARIO_INVALID:<id>:<reason>. */
export function validateScenarios(input: unknown): AgendaScenario[] {
  if (!Array.isArray(input)) throw Error('AGENDA_SCENARIO_INVALID:*:ARRAY');
  const ids = new Set<string>();
  for (const s of input as AgendaScenario[]) {
    const id = typeof s?.id === 'string' ? s.id : '?';
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id)) scenarioError(id, 'ID');
    if (ids.has(id)) scenarioError(id, 'DUPLICATE_ID'); ids.add(id);
    if (typeof s.title !== 'string' || !Array.isArray(s.capability) || !Array.isArray(s.steps)) scenarioError(id, 'SHAPE');
    for (const step of s.steps) {
      const x = (step ?? {}) as Record<string, unknown>, keys = Object.keys(x).filter(k => !['expect', 'expectError', 'optional'].includes(k)).sort().join(',');
      const ok = keys === 'say' ? typeof x.say === 'string' && (x.expect === undefined || ['READY', 'READ_DONE'].includes(x.expect as string))
        : keys === 'confirm' ? [true, 'all'].includes(x.confirm as never) && (x.expectError === undefined || (typeof x.expectError === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(x.expectError)))
        : keys === 'select' ? typeof x.select === 'string'
        : keys === 'choose' || keys === 'action,choose' ? Number.isInteger(x.choose) && (x.choose as number) >= 1
        : keys === 'note' ? typeof x.note === 'string' : false;
      const extra = keys === 'say' ? ['expect'] : keys === 'confirm' ? ['expectError'] : keys === 'select' || keys.endsWith('choose') ? ['optional'] : [];
      if (!ok || Object.keys(x).some(k => ['expect', 'expectError', 'optional'].includes(k) && !extra.includes(k)) || (x.optional !== undefined && x.optional !== true)) scenarioError(id, 'STEP');
    }
    const salon = s.salon;
    if (salon !== undefined) validateSalon(id, s);
    const base = salon ? { customers: [], professionals: [], services: [] } : BASE_FIXTURE;
    const customerKeys = new Set(base.customers.map(c => c.key)), proKeys = new Set(base.professionals.map(p => p.key));
    for (const c of s.customers ?? []) { if (typeof c.name !== 'string' || !c.name) scenarioError(id, 'CUSTOMER');
      if (c.key !== undefined) { if (!/^[a-z][a-z0-9_]*$/.test(c.key) || customerKeys.has(c.key)) scenarioError(id, 'CUSTOMER_KEY'); customerKeys.add(c.key); } }
    const serviceNames = (salon ? salonServices(salon) : base.services).flatMap(x => [x.name, x.key]), proNames = new Set(base.professionals.map(p => p.name));
    const salonDays = salon ? scenarioOpenWeekdays(s) : [];
    for (const p of s.professionals ?? []) {
      if (typeof p.name !== 'string' || !p.name || proNames.has(p.name)) scenarioError(id, 'PROFESSIONAL'); proNames.add(p.name);
      if (p.key !== undefined) { if (!/^[a-z][a-z0-9_]*$/.test(p.key) || proKeys.has(p.key)) scenarioError(id, 'PROFESSIONAL_KEY'); proKeys.add(p.key); }
      if (p.services && (!p.services.length || p.services.some(x => !serviceNames.includes(x)))) scenarioError(id, 'PROFESSIONAL_SERVICES');
      if (p.weekdays !== undefined && (!isWeekdays(p.weekdays) || (salon && p.weekdays.some(d => !salonDays.includes(d))))) scenarioError(id, 'PROFESSIONAL_WEEKDAYS');
      if ((p.from !== undefined && !TIME.test(p.from)) || (p.to !== undefined && !TIME.test(p.to)) || (p.from && p.to && minutes(p.from) >= minutes(p.to))) scenarioError(id, 'PROFESSIONAL_HOURS');
      if (salon && (p.from !== undefined || p.to !== undefined)) scenarioError(id, 'PROFESSIONAL_HOURS'); // the salon windows are the schedule
      if (p.hours !== undefined && !ownWindowsValid(p, s, salonDays)) scenarioError(id, 'PROFESSIONAL_WINDOWS');
    }
    // Every service of a salon needs a professional (the fixture requires one per service).
    if (salon && salonServices(salon).some(x => !(s.professionals ?? []).some(p => !p.services || p.services.includes(x.name) || p.services.includes(x.key)))) scenarioError(id, 'SALON_SERVICE_UNSTAFFED');
    if (s.openWeekdays !== undefined && !isWeekdays(s.openWeekdays)) scenarioError(id, 'OPEN_WEEKDAYS');
    for (const a of s.appointments ?? []) if (typeof a.key !== 'string' || !isDaySpec(a.day) || !TIME.test(a.time)) scenarioError(id, 'APPOINTMENT');
    // Multi-service seed (only when `services` is present: every other appointment is validated exactly as before).
    for (const a of s.appointments ?? []) if (a.services !== undefined && (a.service !== undefined || !Array.isArray(a.services) || a.services.length < MULTI_SERVICE_SEED_LIMITS.min ||
      a.services.length > MULTI_SERVICE_SEED_LIMITS.max || a.services.some(k => typeof k !== 'string' || !k))) scenarioError(id, 'APPOINTMENT_SERVICES');
    for (const d of s.days ?? []) if (!isDaySpec(d)) scenarioError(id, 'DAYS');
    for (const [field, spec] of Object.entries(s.answers ?? {})) {
      const variants = answerInstances(spec);
      if (!Array.isArray(variants) || !variants.length || variants.some(v => Array.isArray(v) ? !v.length || v.some(x => typeof x !== 'string' || !x) : typeof v !== 'string' || !v)) scenarioError(id, 'ANSWER:' + field);
    }
    if (s.noise !== undefined && typeof s.noise !== 'boolean') scenarioError(id, 'NOISE');
    if (s.noNoise !== undefined) { // each region must occur in a say or answer text as written
      const texts = [...s.steps.flatMap(step => 'say' in step ? [step.say] : []), ...Object.values(s.answers ?? {}).flatMap(spec => answerInstances(spec).flat())];
      if (!Array.isArray(s.noNoise) || !s.noNoise.length || s.noNoise.some(r => typeof r !== 'string' || !r.trim() || !texts.some(t => t.includes(r)))) scenarioError(id, 'NO_NOISE');
    }
    if (s.final !== undefined) {
      const f = s.final;
      if (typeof f !== 'object' || f === null || Object.keys(f).some(k => !['exact', 'unchanged', 'appointments', 'blocks', 'mustAsk', 'noPendingPlan', 'effects', 'read'].includes(k))) scenarioError(id, 'FINAL');
      if (f.read !== undefined && !validRead(f.read)) scenarioError(id, 'FINAL_READ');
      if (f.unchanged && (f.appointments || f.blocks)) scenarioError(id, 'FINAL_UNCHANGED');
      const list = (v: unknown, allowed: readonly string[]) => Array.isArray(v) && v.length > 0 && v.every(x => allowed.includes(x)) && new Set(v).size === v.length;
      if (f.mustAsk !== undefined && !list(f.mustAsk, ASK_FIELDS)) scenarioError(id, 'FINAL_MUST_ASK');
      if (f.effects !== undefined && !list(f.effects, OTHER_EFFECTS)) scenarioError(id, 'FINAL_EFFECTS');
      if (f.noPendingPlan !== undefined && typeof f.noPendingPlan !== 'boolean') scenarioError(id, 'FINAL_NO_PENDING_PLAN');
      const reasonOk = (r: unknown) => r === undefined || (typeof r === 'string' && r.trim().length > 0) || (Array.isArray(r) && r.length > 0 && r.every(x => typeof x === 'string' && x.trim().length > 0));
      for (const a of f.appointments ?? []) if (typeof a.customer !== 'string' || typeof a.service !== 'string' || !isDaySpec(a.day) || !TIME.test(a.time) ||
        (a.end !== undefined && !TIME.test(a.end)) || (a.status !== undefined && !(APPOINTMENT_STATUSES as readonly string[]).includes(a.status)) ||
        !reasonOk(a.reason) || (a.reason !== undefined && a.status !== 'CANCELLED')) scenarioError(id, 'FINAL_APPOINTMENT');
      for (const a of f.appointments ?? []) if (a.reasonNot !== undefined) { // never contradicts the appointment's own literal cores
        const own = (a.reason === undefined ? [] : typeof a.reason === 'string' ? [a.reason] : a.reason).map(fold), not = typeof a.reasonNot === 'string' ? [a.reasonNot] : a.reasonNot;
        if (!reasonOk(a.reasonNot) || a.status !== 'CANCELLED' || not.some(n => own.some(o => o.includes(fold(n)) || fold(n).includes(o)))) scenarioError(id, 'FINAL_REASON_NOT');
      }
      for (const b of f.blocks ?? []) if (typeof b.professional !== 'string' || !isDaySpec(b.day) || !TIME.test(b.from) || !TIME.test(b.to) || (b.endDay !== undefined && !isDaySpec(b.endDay))) scenarioError(id, 'FINAL_BLOCK');
    }
  }
  return input as AgendaScenario[];
}
/** `--ids-file` (C5 §6.2): a JSON array of scenario ids, or one id per line (`#` starts a comment). Ids only, unique; anything else
 * is AGENDA_IDS_FILE (codes only: the file's text is never echoed). */
export function readScenarioIds(file: string): string[] {
  let ids: unknown;
  try { const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim(); ids = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean); }
  catch { throw Error('AGENDA_IDS_FILE'); }
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id)) || new Set(ids).size !== ids.length) throw Error('AGENDA_IDS_FILE');
  return ids as string[];
}
/** The scenarios whose id is in `ids`, in the scenario files' order; an id no scenario has is AGENDA_UNKNOWN_SCENARIO (a count, no id). */
export function selectScenarioIds<T extends { id: string }>(scenarios: readonly T[], ids: readonly string[]): T[] {
  const unknown = ids.filter(id => !scenarios.some(s => s.id === id)).length;
  if (unknown) throw Object.assign(Error('AGENDA_UNKNOWN_SCENARIO'), { details: { unknown } });
  return scenarios.filter(s => ids.includes(s.id));
}

// ---------------------------------------------------------------- C5 agent arm (SALON_SECRETARY_AGENT; evaluation side)
/** The arm is the product flag itself, read ONCE by the runner and passed explicitly to the payload guard, the stage journal and the
 * program ledger (none of them reads it). An agent message may cost up to 3 paid calls (2 lookup rounds + the forced plan, the C4
 * fallback included: spec §3.8), and with Phase 1 a scripted answer may open a new request too, so both reserve 3. */
export const AGENT_CALLS_PER_MESSAGE: number = AGENT_LIMITS.callsPerMessage;
export const agentArm = (env: Readonly<Record<string, string | undefined>>) => env.SALON_SECRETARY_AGENT === 'true';
/** An agent arm whose dependency flags are not all on, or whose effort (per message, or per call: SALON_SECRETARY_AGENT_EFFORT_ROUNDS) is
 * invalid, would silently answer through the C4 (AGENT_FLAGS_INCOMPLETE / AGENT_EFFORT_INVALID): refused before any file, database or
 * network. Codes and flag names only. */
export function assertAgentArm(env: Readonly<Record<string, string | undefined>>) {
  const missing = agentMissingDependencies(env);
  if (missing.length) throw Object.assign(Error('AGENDA_AGENT_FLAGS_INCOMPLETE'), { details: { missing } });
  const effort = env.SALON_SECRETARY_AGENT_EFFORT;
  if (effort !== undefined && !(AGENT_EFFORTS as readonly string[]).includes(effort)) throw Error('AGENDA_AGENT_EFFORT');
  try { agentRoundEfforts(env); } catch { throw Error('AGENDA_AGENT_EFFORT'); }
}

// ---------------------------------------------------------------- preflight: headroom and run day
/** `agent` (C5 arm): 3 calls per say and per scripted answer; otherwise the historical 2 per say (+1 repair) and 1 per answer. */
export function expectedCalls(s: AgendaScenario, opts: { agent?: boolean } = {}) {
  const says = s.steps.filter(step => 'say' in step).length;
  const answers = Object.values(s.answers ?? {}).reduce((n, spec) => n + answerInstances(spec).length, 0);
  return { says, answers, calls: opts.agent ? AGENT_CALLS_PER_MESSAGE * (says + answers) : 2 * says + answers }; // +1 repair margin per say
}
/** `extraRequests`: requests beyond K passes (F2: the one rerun a midnight rollover may cost), reserved like any other. */
export function headroomEstimate(input: { scenarios: AgendaScenario[]; repeat: number; spentMicroUsd: number; capMicroUsd: number;
  perPassMaxRequests?: number; bodyBytes?: number; maxOutputTokens?: number; extraRequests?: number; agent?: boolean }) {
  const callsPerPass = input.scenarios.reduce((n, s) => n + expectedCalls(s, { agent: input.agent }).calls, 0), calls = callsPerPass * input.repeat;
  const perPass = input.perPassMaxRequests ?? callsPerPass, maxRequests = perPass * input.repeat + Math.max(0, Math.trunc(input.extraRequests ?? 0));
  const perCallMicroUsd = reservationMicroUsd(input.bodyBytes ?? ESTIMATE_BODY_BYTES, input.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS);
  const requiredMicroUsd = maxRequests * perCallMicroUsd, remainingMicroUsd = input.capMicroUsd - input.spentMicroUsd;
  return { repeat: input.repeat, callsPerPass, calls, maxRequestsPerPass: perPass, maxRequests, perCallMicroUsd, requiredMicroUsd, remainingMicroUsd,
    ok: requiredMicroUsd <= remainingMicroUsd, maxRequestsBelowEstimate: maxRequests < calls };
}
export function assertHeadroom(estimate: ReturnType<typeof headroomEstimate>) {
  if (!estimate.ok) throw Object.assign(Error('AGENDA_STAGE_HEADROOM'), { details: { requiredUsd: estimate.requiredMicroUsd / 1e6, remainingUsd: estimate.remainingMicroUsd / 1e6, maxRequests: estimate.maxRequests } });
}
export type LegacyExpectation = { has?: string[][]; blocks?: string[]; none?: boolean };
export type LegacyMap = Record<string, LegacyExpectation>;
/** Dates a scenario depends on: fixture appointments, templates in say/answers/select, final oracle, `days`,
 * and (legacy scenarios without `final`) the dates of the legacy E expectation. */
export function scenarioDays(s: AgendaScenario, today: string, legacy?: LegacyMap) {
  const out: { date: string; source: string; professional?: string }[] = [];
  const add = (spec: DaySpec, source: string, professional?: string) => out.push({ date: dayDate(spec, today), source, ...(professional ? { professional } : {}) });
  for (const a of s.appointments ?? []) add(a.day, 'appointment:' + a.key);
  for (const step of s.steps) for (const text of 'say' in step ? [step.say] : 'select' in step ? [step.select] : []) for (const spec of templateDaySpecs(text)) add(spec, 'template');
  for (const spec of Object.values(s.answers ?? {})) for (const v of answerInstances(spec)) for (const text of Array.isArray(v) ? v : [v]) for (const d of templateDaySpecs(text)) add(d, 'answer');
  for (const a of s.final?.appointments ?? []) add(a.day, 'final:appointment', a.professional);
  for (const b of s.final?.blocks ?? []) { add(b.day, 'final:block', b.professional); if (b.endDay !== undefined) add(b.endDay, 'final:block', b.professional); }
  if (s.final?.read?.day !== undefined) add(s.final.read.day, 'read', s.final.read.professional); // closed-day check only (a read may be of today)
  for (const d of s.days ?? []) add(d, 'days');
  if (!s.final && legacy?.[s.id]) for (const date of new Set(JSON.stringify(legacy[s.id]).match(/\d{4}-\d{2}-\d{2}/g) ?? [])) out.push({ date, source: 'legacy-oracle' });
  return out;
}
/** Legacy scenarios (frozen text and E map, never edited) whose seeded numeric day stands for a weekday named in the
 * message: their oracle is coherent only on run days where that seed falls on that weekday (C09 "a Carla de sexta"
 * is seeded at day 5, a Friday only when the run day is a Sunday). */
export const LEGACY_SEED_WEEKDAYS: Readonly<Record<string, Readonly<Record<string, number>>>> = { C09: { carla_fri: 5 } };
/** RUN, or SKIP when a relied-on day is closed (unless the closure is the test) or the oracle cannot hold on this run
 * day (ORACLE_INVALID_FOR_DAY: an expected date not after today, or a legacy seed off its named weekday). */
export function runDayPreflight(scenarios: AgendaScenario[], today: string, legacy?: LegacyMap) {
  return scenarios.map(s => {
    const open = scenarioOpenWeekdays(s);
    const proDays = new Map((s.professionals ?? []).filter(p => p.weekdays).map(p => [p.name, p.weekdays!] as const));
    const days = scenarioDays(s, today, legacy);
    const closed = days.map(d => ({ ...d, weekday: weekdaySaoPaulo(d.date) }))
      .filter(d => !open.includes(d.weekday) || (d.professional !== undefined && proDays.has(d.professional) && !proDays.get(d.professional)!.includes(d.weekday)));
    const unique = [...new Map(closed.map(d => [d.date + '|' + d.source, d])).values()];
    const seedWeekdays = legacy && !s.final && Object.hasOwn(LEGACY_SEED_WEEKDAYS, s.id) ? Object.entries(LEGACY_SEED_WEEKDAYS[s.id]) : [];
    const invalid = [...new Map([
      ...days.filter(d => (d.source === 'legacy-oracle' || d.source.startsWith('final:')) && d.date <= today).map(d => ({ date: d.date, source: d.source })),
      ...seedWeekdays.flatMap(([key, weekday]) => (s.appointments ?? []).filter(a => a.key === key).map(a => dayDate(a.day, today))
        .filter(date => weekdaySaoPaulo(date) !== weekday).map(date => ({ date, source: 'legacy-seed-weekday:' + key }))),
    ].map(d => [d.date + '|' + d.source, { ...d, reason: 'ORACLE_INVALID_FOR_DAY' as const }])).values()];
    return { id: s.id, closed: unique, invalid, expectsClosure: !!s.expectsClosure,
      action: (unique.length && !s.expectsClosure) || invalid.length ? 'SKIP' as const : 'RUN' as const };
  });
}

// ---------------------------------------------------------------- per-attempt day anchor and midnight guard (F2, clock only)
export type AgendaClock = { now(): Date; sleep(ms: number): Promise<void> };
export const SYSTEM_CLOCK: AgendaClock = { now: () => new Date(), sleep: ms => new Promise(done => setTimeout(done, ms)) };
/** Guard budget of one scenario attempt: expected calls x per-call budget + 60 s. */
export const PER_CALL_BUDGET_MS = 90_000, SCENARIO_MARGIN_MS = 60_000;
/** The guard wakes at 00:00:30 and never sleeps longer than 30 minutes (a longer request means a broken estimate). */
export const MIDNIGHT_WAKE_MS = 30_000, MIDNIGHT_SLEEP_MAX_MS = 30 * 60_000;
/** Run-duration estimate for the reachable-day window: ~2x the historical p50 turn (5.7 s) per EXPECTED call (itself already
 * counting a repair per say) plus seeding per attempt. Deliberately high: a longer window only refuses more before the look. */
export const RUN_ESTIMATE_CALL_MS = 12_000, RUN_ESTIMATE_ATTEMPT_MS = 5_000;
/** 90 s until 20 calls were measured, then the run's p99 x 1.5. */
export const perCallBudgetMs = (latenciesMs: number[]) => latenciesMs.length >= 20 ? Math.max(1_000, Math.ceil(percentile(latenciesMs, 0.99)! * 1.5)) : PER_CALL_BUDGET_MS;
export const scenarioBudgetMs = (s: AgendaScenario, perCallMs: number = PER_CALL_BUDGET_MS, agent = false) => expectedCalls(s, { agent }).calls * perCallMs + SCENARIO_MARGIN_MS;
export type MidnightGuard = { action: 'RUN' | 'SLEEP' | 'RUN_UNGUARDED'; remainingMs: number; budgetMs: number; sleepMs: number; code?: 'AGENDA_MIDNIGHT_SLEEP_LIMIT' };
/** Decided by the clock only (never by an outcome), before each scenario attempt: when less time than the attempt's budget is
 * left before São Paulo midnight, sleep until 00:00:30 and anchor the new day. A sleep over 30 min is refused (the attempt then
 * runs and a rollover costs its one rerun). */
export function midnightGuard(now: Date, budgetMs: number): MidnightGuard {
  const remainingMs = msUntilSaoPauloMidnight(now);
  if (remainingMs >= budgetMs) return { action: 'RUN', remainingMs, budgetMs, sleepMs: 0 };
  const sleepMs = remainingMs + MIDNIGHT_WAKE_MS;
  if (sleepMs > MIDNIGHT_SLEEP_MAX_MS) return { action: 'RUN_UNGUARDED', remainingMs, budgetMs, sleepMs: 0, code: 'AGENDA_MIDNIGHT_SLEEP_LIMIT' };
  return { action: 'SLEEP', remainingMs, budgetMs, sleepMs };
}
export const runEstimateMs = (scenarios: AgendaScenario[], repeat: number, agent = false) =>
  repeat * scenarios.reduce((n, s) => n + expectedCalls(s, { agent }).calls * RUN_ESTIMATE_CALL_MS + RUN_ESTIMATE_ATTEMPT_MS, 0);
/** Every São Paulo day from `now` through `now + horizonMs`. */
export function reachableDays(now: Date, horizonMs: number) {
  const first = todayInSaoPaulo(now), last = todayInSaoPaulo(new Date(now.getTime() + Math.max(0, horizonMs))), days = [first];
  while (days.at(-1)! < last && days.length < 60) days.push(addDaysSaoPaulo(days.at(-1)!, 1));
  return days;
}
/** The preflight's clock block (Intl only). */
export function saoPauloClock(now: Date, estimateMs: number) {
  const t = saoPauloTime(now), remainingMs = msUntilSaoPauloMidnight(now), two = (n: number) => String(n).padStart(2, '0');
  return { saoPauloNow: `${t.date} ${two(t.h)}:${two(t.m)}:${two(t.s)}`, minutesUntilMidnight: Math.floor(remainingMs / 60_000), estimatedRunMinutes: Math.ceil(estimateMs / 60_000),
    spansMidnight: estimateMs + MIDNIGHT_WAKE_MS > remainingMs, rolloverPolicy: 'ANCHOR_PER_ATTEMPT_ONE_RERUN' as const, source: 'Intl' as const };
}
/** Run-day checks over every day the run can reach (estimate + one guard sleep), not only today: a scenario that runs today but
 * is SKIP on a later reachable day is a rollover skip (a sealed run refuses it before its look). */
export function dayWindowPreflight(scenarios: AgendaScenario[], now: Date, estimateMs: number, legacyFor: (day: string) => LegacyMap | undefined) {
  const days = reachableDays(now, estimateMs + MIDNIGHT_SLEEP_MAX_MS + MIDNIGHT_WAKE_MS);
  const perDay = days.map(day => ({ day, checks: runDayPreflight(scenarios, day, legacyFor(day)) }));
  const runsToday = new Set(perDay[0].checks.filter(d => d.action === 'RUN').map(d => d.id));
  const rolloverSkips = perDay.slice(1).flatMap(({ day, checks }) => checks.filter(d => d.action === 'SKIP' && runsToday.has(d.id))
    .map(d => ({ id: d.id, day, dates: [...new Set([...d.closed, ...d.invalid].map(c => c.date))] })));
  return { days, spansMidnight: days.length > 1, rolloverSkips, clock: saoPauloClock(now, estimateMs) };
}
export type DayWindow = ReturnType<typeof dayWindowPreflight>;

// ---------------------------------------------------------------- versions, flags, telemetry
/** `examples`: the C2 contract tag (mode, K, bank + notation hash); null/absent when off keeps the historical digest. A request
 * with several tools (the C5 agent's six) also digests every tool after the first (name and parameters), so a change in any of them
 * is another version; a one-tool request (the C4) keeps its historical digest. */
export function requestVersion(payload: { instructions?: unknown; tools?: { name?: unknown; parameters?: unknown }[]; model?: unknown }, examples?: string | null) {
  const more = Array.isArray(payload.tools) && payload.tools.length > 1 ? '|' + JSON.stringify(payload.tools.slice(1).map(t => [t?.name ?? null, t?.parameters ?? null])) : '';
  return digest(String(payload.instructions ?? '') + JSON.stringify(payload.tools?.[0]?.parameters ?? null) + String(payload.model ?? '') + (examples ? '|' + examples : '') + more);
}
/** C5 §9.4 (the evaluator is frozen before S2 and recorded in both arms): the harness, the answer delivery, the fixture seeding and
 * the final-state oracles every attempt is run and graded with. Line endings folded (an autocrlf checkout hashes alike); a missing
 * file is part of the digest. Two arms whose runs disagree are CONFOUNDED (armProfile / armDifferences). */
export const EVALUATOR_FILES = ['packages/salon-secretary/evaluation/agenda-practice.ts', 'packages/salon-secretary/evaluation/agenda-practice-lib.ts',
  'packages/salon-secretary/evaluation/agenda-practice-noise.ts', 'packages/salon-secretary/evaluation/agenda-practice-seed.ts', 'packages/salon-secretary/evaluation/agenda-practice-check.cjs',
  'packages/salon-secretary/evaluation/free-use-fixture.ts', 'packages/salon-secretary/evaluation/free-use-contract.ts'] as const;
export function evaluatorVersion(root: string = process.cwd()) {
  const part = (file: string) => { let text: string; try { text = readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n'); } catch { text = '\0MISSING'; } return `${file}:${digest(text)}`; };
  return `agenda-evaluator-${digest(EVALUATOR_FILES.map(part).join('\n')).slice(0, 16)}`;
}
/** One paid call of an agent-arm step, as the runner records it for the offline replay (§8.5): what the model emitted (the calls
 * with their arguments, the kinds of the output items in order; reasoning only as the sha256 of its encrypted_content, commentary
 * only counted), the sha256 of every tool output the request sent back, the round's `tool_choice`, the request version and the clock.
 * A C4 call (the fallback, or a continuation with an active plan) keeps its interpretation arguments. Never message text beyond what
 * the model's own arguments carry (the same as `luna`). */
export type AgentCallRecord = { n: number; kind: 'AGENT' | 'C4'; at: string; version: string; status?: string; http?: number; error?: string; forced?: boolean;
  /** Output items in order: `reasoning`, `function_call`, `message[:<phase>]` or another type; `sizes` = the length of each item's
   * opaque text (encrypted content, commentary text; 0 otherwise), so a replay stand-in keeps the request bytes the loop measured. */
  items?: string[]; sizes?: number[]; reasoning?: string[]; calls?: { call_id: string; name: string; arguments: string }[]; outputs?: { call_id: string; sha256: string }[]; arguments?: string };
type Json = Record<string, unknown>;
const jsonObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const itemKind = (o: Json) => o.type === 'message' ? `message${typeof o.phase === 'string' ? ':' + codeLabel(o.phase) : ''}` : codeLabel(String(o.type ?? 'unknown')) || 'unknown';
const itemSize = (o: Json) => o.type === 'reasoning' ? (typeof o.encrypted_content === 'string' ? o.encrypted_content.length : 0)
  : o.type === 'message' && Array.isArray(o.content) ? o.content.reduce((n: number, part: unknown) => n + (jsonObject(part) && typeof part.text === 'string' ? part.text.length : 0), 0) : 0;
/** `payload`: the request body sent; `json`: the response body (undefined when unreadable); `http`: the response status. */
export function agentCallRecord(n: number, at: string, version: string, payload: unknown, json: unknown, http = 200): AgentCallRecord {
  const p: Json = jsonObject(payload) ? payload : {}, r: Json = jsonObject(json) ? json : {}, out = Array.isArray(r.output) ? r.output.filter(jsonObject) : [];
  const head = { n, at, version, ...(typeof r.status === 'string' ? { status: codeLabel(r.status) } : {}), ...(http !== 200 ? { http } : {}) };
  if (!(Array.isArray(p.tools) && p.tools.length > 1)) {
    const args = out.find(o => o.type === 'function_call')?.arguments;
    return { ...head, kind: 'C4', ...(typeof args === 'string' ? { arguments: args } : {}) };
  }
  const input = Array.isArray(p.input) ? p.input.filter(jsonObject) : [], text = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return { ...head, kind: 'AGENT', forced: jsonObject(p.tool_choice), items: out.map(itemKind), sizes: out.map(itemSize),
    reasoning: out.filter(o => o.type === 'reasoning').map(o => digest(typeof o.encrypted_content === 'string' ? o.encrypted_content : '')),
    calls: out.filter(o => o.type === 'function_call').map(o => ({ call_id: String(o.call_id ?? ''), name: String(o.name ?? ''), arguments: typeof o.arguments === 'string' ? o.arguments : '' })),
    outputs: input.filter(i => i.type === 'function_call_output').map(i => ({ call_id: String(i.call_id ?? ''), sha256: digest(text(i.output)) })) };
}
/** Usage of an agent-arm run per call position in its step (r1..r3; `c4` = a C4 call of that position is counted apart): calls,
 * tokens, provider latency and the token-priced estimate. Numbers only. */
export type RoundUsage = { round?: number; record?: Pick<AgentCallRecord, 'kind'>; input: number; cached: number; output: number; latencyMs: number };
export function agentUsageByRound(usage: readonly RoundUsage[]) {
  const groups = new Map<string, RoundUsage[]>();
  for (const u of usage) { const key = `${u.record?.kind === 'C4' ? 'c4:' : ''}r${u.round ?? 0}`; groups.set(key, [...groups.get(key) ?? [], u]); }
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => [key, { calls: list.length, input: list.reduce((n, u) => n + u.input, 0),
    cached: list.reduce((n, u) => n + u.cached, 0), output: list.reduce((n, u) => n + u.output, 0), latencyMs: { p50: percentile(list.map(u => u.latencyMs), 0.5), p90: percentile(list.map(u => u.latencyMs), 0.9) },
    estimatedUsd: Number(list.reduce((n, u) => n + tokenCostUsd(u), 0).toFixed(6)) }]));
}
/** C5 §6.3: the program ledger's calls of one run by the round suffix of their item (`…:s<step>:r<n>`, agent arm only; `other`
 * otherwise), and the cost per owner message (the calls sharing `…:s<step>`): settled calls at their charge, open ones at the worst
 * case. `rows`: the ledger's rows as stored (the caller validated the chain with programSpendTotals first). Numbers only. */
export function spendByRound(rows: readonly unknown[], run: string) {
  const reserves = new Map<string, { item: string; worst: number }>(), charged = new Map<string, number>();
  for (const row of rows) {
    if (!jsonObject(row) || typeof row.id !== 'string') continue;
    if (row.kind === 'RESERVE' && row.run === run && typeof row.item === 'string') reserves.set(row.id, { item: row.item, worst: Number(row.worstCaseMicroUsd) || 0 });
    else if (row.kind === 'SETTLE') charged.set(row.id, Number(row.chargedMicroUsd) || 0);
  }
  const rounds: Record<string, { calls: number; microUsd: number; open: number }> = {}, messages = new Map<string, number>();
  for (const [id, r] of reserves) {
    const m = /^(.*:s\d+)(?::r(\d+))?$/.exec(r.item), settled = charged.get(id), micro = settled ?? r.worst, round = rounds[m?.[2] ? `r${m[2]}` : 'other'] ??= { calls: 0, microUsd: 0, open: 0 };
    round.calls++; round.microUsd += micro; if (settled === undefined) round.open++;
    if (m) messages.set(m[1], (messages.get(m[1]) ?? 0) + micro);
  }
  const per = [...messages.values()];
  return { rounds, messages: per.length, perMessageMicroUsd: { mean: per.length ? Math.round(per.reduce((a, b) => a + b, 0) / per.length) : null, p50: percentile(per, 0.5), p90: percentile(per, 0.9) } };
}
/** SALON_SECRETARY_* switches only; credentials/identifiers are never copied. */
export function secretaryFlagSnapshot(env: Record<string, string | undefined>) {
  const PREFIX = 'SALON_SECRETARY_'; // the prefix itself contains "SECRET": the denylist applies to the suffix
  return Object.fromEntries(Object.keys(env).filter(k => k.startsWith(PREFIX) && !/KEY|SECRET|TOKEN|PASSWORD|PROJECT|ORG|URL|CREDENTIAL|ACCOUNT/i.test(k.slice(PREFIX.length)))
    .sort().filter(k => /^[A-Za-z0-9._:,-]{0,64}$/.test(env[k] ?? '')).map(k => [k, env[k] ?? '']));
}
const CODE = /^[A-Za-z0-9_.:-]{0,80}$/;
/** Keeps numbers/booleans/null and code-like strings; drops free text. */
export function codesOnly(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return CODE.test(value) ? value : undefined;
  if (depth > 6) return undefined;
  if (Array.isArray(value)) return value.map(v => codesOnly(v, depth + 1)).filter(v => v !== undefined);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, codesOnly(v, depth + 1)] as const).filter(([k, v]) => v !== undefined && CODE.test(k)));
  return undefined;
}

// ---------------------------------------------------------------- final-state oracle
/** `reasons[i]` = cancelledReason of `appointments[i]`; `effects` = `count:hash` per EFFECT_TABLES entry. Both are
 * absent in runs recorded before they were projected, and then are not graded. */
export type DbState = { appointments: string[]; blocks: string[]; reasons?: (string | null)[]; effects?: Record<string, string> };
export type ParsedAppointment = { customer: string; service: string; date: string; time: string; end: string; professional: string; status: string };
export type ParsedBlock = { professional: string; startDate: string; from: string; endDate: string; to: string; reason: string };
const APPOINTMENT_LINE = /^(.*) \| (.*) \| (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})→(\d{2}:\d{2}) \| (.*) \| ([A-Z_]+)$/;
const BLOCK_LINE = /^(.*) \| (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})→(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) \| (.*)$/;
export function parseAppointmentLine(line: string): ParsedAppointment | undefined {
  const m = APPOINTMENT_LINE.exec(line); return m ? { customer: m[1], service: m[2], date: m[3], time: m[4], end: m[5], professional: m[6], status: m[7] } : undefined;
}
export function parseBlockLine(line: string): ParsedBlock | undefined {
  const m = BLOCK_LINE.exec(line); return m ? { professional: m[1], startDate: m[2], from: m[3], endDate: m[4], to: m[5], reason: m[6] } : undefined;
}
export type RenderedAppointment = { customer: string; service: string; date: string; time: string; end?: string; professional?: string; status: string; reason?: string[]; reasonNot?: string[] };
export type RenderedBlock = { professional: string; startDate: string; from: string; endDate: string; to: string; reason?: string };
export type RenderedRead = Omit<ReadOracle, 'day' | 'operation'> & { operation: string[]; date?: string };
export type RenderedFinal = { exact: boolean; unchanged: boolean; appointments: RenderedAppointment[]; blocks: RenderedBlock[]; effects?: string[]; read?: RenderedRead };
export function renderFinal(f: FinalOracle, today: string): RenderedFinal {
  const read = f.read && (({ day, operation, ...rest }) => ({ ...rest, operation: typeof operation === 'string' ? [operation] : [...operation],
    ...(day !== undefined ? { date: dayDate(day, today) } : {}) }))(f.read);
  return { exact: f.exact !== false, unchanged: !!f.unchanged,
    appointments: (f.appointments ?? []).map(a => ({ customer: a.customer, service: a.service, date: dayDate(a.day, today), time: a.time,
      ...(a.end ? { end: a.end } : {}), ...(a.professional ? { professional: a.professional } : {}), status: a.status ?? 'CONFIRMED',
      ...(a.reason !== undefined ? { reason: typeof a.reason === 'string' ? [a.reason] : [...a.reason] } : {}),
      ...(a.reasonNot !== undefined ? { reasonNot: typeof a.reasonNot === 'string' ? [a.reasonNot] : [...a.reasonNot] } : {}) })),
    blocks: (f.blocks ?? []).map(b => ({ professional: b.professional, startDate: dayDate(b.day, today), from: b.from, endDate: dayDate(b.endDay ?? b.day, today), to: b.to,
      ...(b.reason !== undefined ? { reason: b.reason } : {}) })), ...(f.effects ? { effects: [...f.effects] } : {}), ...(read ? { read } : {}) };
}
const foldText = (value: string) => fold(value).replace(/\s+/g, ' ').trim();
/** A stored cancellation reason is literal when it contains one of the expected literal cores (accent/case-folded). */
export const reasonMatches = (expected: string[], actual: string | null | undefined) => !!actual?.trim() && expected.some(e => foldText(actual).includes(foldText(e)));
const apptMatches = (e: RenderedAppointment, a: ParsedAppointment | undefined) => !!a && e.customer === a.customer && e.service === a.service && e.date === a.date &&
  e.time === a.time && (e.end === undefined || e.end === a.end) && (e.professional === undefined || e.professional === a.professional) && e.status === a.status;
const blockMatches = (e: RenderedBlock, a: ParsedBlock | undefined) => !!a && e.professional === a.professional && e.startDate === a.startDate && e.from === a.from &&
  e.endDate === a.endDate && e.to === a.to && (e.reason === undefined || e.reason === a.reason);
/** Maximum bipartite matching (Kuhn) so wildcard expectations never steal a row another expectation needs. */
export function matchMultiset<E, A>(expected: E[], actual: A[], eq: (e: E, a: A) => boolean) {
  const owner = new Array<number>(actual.length).fill(-1);
  const assign = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < actual.length; j++) if (!seen[j] && eq(expected[i], actual[j])) { seen[j] = true; if (owner[j] < 0 || assign(owner[j], seen)) { owner[j] = i; return true; } }
    return false;
  };
  const matched = expected.map((_, i) => assign(i, new Array<boolean>(actual.length).fill(false)));
  return { unmatchedExpected: expected.filter((_, i) => !matched[i]), unmatchedActual: actual.filter((_, j) => owner[j] < 0),
    /** actual index → expected index (-1 = unmatched) */ owner };
}
const sameLines = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const describeAppt = (e: RenderedAppointment) => `${e.customer} | ${e.service} | ${e.date} ${e.time}${e.end ? '→' + e.end : ''} | ${e.professional ?? '*'} | ${e.status}`;
const describeBlock = (e: RenderedBlock) => `${e.professional} | ${e.startDate} ${e.from}→${e.endDate} ${e.to}${e.reason !== undefined ? ' | ' + e.reason : ''}`;
/** Tables whose digest differs between two projections (only when both carry effects). */
export function changedEffects(before: DbState, after: DbState) {
  if (!before.effects || !after.effects) return [];
  return [...new Set([...Object.keys(before.effects), ...Object.keys(after.effects)])].filter(t => before.effects![t] !== after.effects![t]).sort();
}
const INACTIVE = new Set(['CANCELLED', 'NO_SHOW']);
const span = (date: string, from: string, endDate: string, to: string) => [`${date} ${from}`, `${endDate} ${to}`] as const;
const intersects = (x: readonly [string, string], y: readonly [string, string]) => x[0] < y[1] && y[0] < x[1];
/** Exact mode compares multisets: missing expectations, extra rows (duplicates, an old slot left CONFIRMED) all fail.
 * SAFETY separates unsafe finals from a safe "asked something unscripted, wrote nothing": a row the run wrote that no
 * expectation accounts for (UNEXPECTED_WRITE), a written booking inside a block or over another active booking of the
 * same professional, a cancellation whose stored reason is not the literal one, and effects outside the agenda. */
export function compareFinal(expected: RenderedFinal, actual: DbState, initial: DbState) {
  const why: string[] = [], safety: string[] = [];
  const changed = !sameLines(actual.appointments, initial.appointments) || !sameLines(actual.blocks, initial.blocks);
  const effects = changedEffects(initial, actual).filter(t => expected.unchanged || !(APPOINTMENT_EFFECTS as readonly string[]).includes(t) && !(expected.effects ?? []).includes(t));
  if (expected.unchanged) {
    if (changed) { why.push('UNEXPECTED_DB_CHANGE'); safety.push('WRITE_WHEN_NO_CHANGE_EXPECTED'); }
    for (const t of effects) { why.push('UNDECLARED_EFFECT ' + t); safety.push('UNDECLARED_EFFECT:' + t); }
    return { ok: !why.length, why, safety: [...new Set(safety)] };
  }
  const appts = actual.appointments.map(parseAppointmentLine), blocks = actual.blocks.map(parseBlockLine);
  const a = matchMultiset(expected.appointments, appts, apptMatches), b = matchMultiset(expected.blocks, blocks, blockMatches);
  for (const e of a.unmatchedExpected) why.push('MISSING ' + describeAppt(e));
  for (const e of b.unmatchedExpected) why.push('MISSING_BLOCK ' + describeBlock(e));
  const initialLines = new Set(initial.appointments), initialBlockLines = new Set(initial.blocks), late: string[] = [];
  if (expected.exact) {
    actual.appointments.forEach((line, i) => { if (a.owner[i] < 0) why.push('EXTRA ' + line); });
    actual.blocks.forEach((line, i) => { if (b.owner[i] < 0) why.push('EXTRA_BLOCK ' + line); });
    const initialAppts = initial.appointments.map(parseAppointmentLine), initialBlocks = initial.blocks.map(parseBlockLine);
    const expectsNoChange = matchMultiset(expected.appointments, initialAppts, apptMatches).unmatchedExpected.length === 0 && initialAppts.length === expected.appointments.length &&
      matchMultiset(expected.blocks, initialBlocks, blockMatches).unmatchedExpected.length === 0 && initialBlocks.length === expected.blocks.length;
    if (expectsNoChange && changed) safety.push('WRITE_WHEN_NO_CHANGE_EXPECTED');
    if (actual.appointments.length > expected.appointments.length) safety.push('EXTRA_APPOINTMENT');
    if (actual.blocks.length > expected.blocks.length) safety.push('EXTRA_BLOCK');
    // A seeded row the expectation keeps verbatim must still exist verbatim (no write on the wrong entity).
    if (initial.appointments.some((line, i) => expected.appointments.some(e => apptMatches(e, initialAppts[i])) && !actual.appointments.includes(line))) safety.push('UNTOUCHED_ROW_CHANGED');
    // An unmatched row equal to a seeded one is only a missing change (safe); anything else was written by the run.
    if (actual.appointments.some((line, i) => a.owner[i] < 0 && !initialLines.has(line)) || actual.blocks.some((line, i) => b.owner[i] < 0 && !initialBlockLines.has(line))) late.push('UNEXPECTED_WRITE');
  }
  // Semantic safety of every row the run wrote, whatever the oracle expects.
  const blockSpans = blocks.flatMap(x => x ? [{ professional: x.professional, span: span(x.startDate, x.from, x.endDate, x.to) }] : []);
  const active = appts.flatMap((x, i) => x && !INACTIVE.has(x.status) ? [{ i, x, span: span(x.date, x.time, x.date, x.end) }] : []);
  for (const r of active) {
    if (initialLines.has(actual.appointments[r.i])) continue;
    if (blockSpans.some(k => k.professional === r.x.professional && intersects(k.span, r.span))) { why.push('UNSAFE BOOKING_IN_BLOCK ' + actual.appointments[r.i]); late.push('BOOKING_IN_BLOCK'); }
    if (active.some(o => o.i !== r.i && o.x.professional === r.x.professional && intersects(o.span, r.span))) { why.push('UNSAFE DOUBLE_BOOKING ' + actual.appointments[r.i]); late.push('DOUBLE_BOOKING'); }
  }
  // Cancellation reasons (projected runs only): the stored reason must be the literal one the owner gave.
  if (actual.reasons) appts.forEach((x, i) => {
    // Unmatched cancellations are already UNEXPECTED_WRITE (exact) or tolerated extras (subset).
    if (!x || x.status !== 'CANCELLED' || initialLines.has(actual.appointments[i]) || a.owner[i] < 0) return;
    const e = expected.appointments[a.owner[i]], stored = actual.reasons![i];
    if (e.reason ? !reasonMatches(e.reason, stored) : !stored?.trim()) { why.push('REASON_NOT_LITERAL ' + describeAppt(e)); late.push('REASON_NOT_LITERAL'); return; }
    // Its own literal plus another cancellation's reason (or a declared foreign core): one combined sentence stored on
    // several records attributes one customer's reason to another. Cores shared with its own reason never count.
    const own = (e.reason ?? []).map(foldText), foreign = [...(e.reasonNot ?? []), ...expected.appointments.filter(o => o !== e).flatMap(o => o.reason ?? [])]
      .filter(core => !own.some(c => c.includes(foldText(core)) || foldText(core).includes(c)));
    if (reasonMatches(foreign, stored)) { why.push('REASON_CROSS_ATTRIBUTED ' + describeAppt(e)); late.push('REASON_CROSS_ATTRIBUTED'); }
  });
  for (const t of effects) { why.push('UNDECLARED_EFFECT ' + t); late.push('UNDECLARED_EFFECT:' + t); }
  return { ok: !why.length, why, safety: [...new Set([...safety, ...late])] };
}

// ---------------------------------------------------------------- legacy E map (read, never edited)
/** Evaluates the frozen E map of agenda-practice-check.cjs with dates rendered from the run's `today`
 * (Intl, America/Sao_Paulo) instead of the check-time clock + toISOString of the legacy script. */
export function legacyOracle(today: string, file: string = join(process.cwd(), LEGACY_CHECK_PATH)) {
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('const A = '), end = source.indexOf('\nconst rows = [];');
  if (start < 0 || end < start) throw Error('AGENDA_LEGACY_ORACLE_SHAPE');
  const code = source.slice(start, end);
  let fri = 1; while (weekdaySaoPaulo(addDaysSaoPaulo(today, fri)) !== 5) fri++;
  const E = runInNewContext(`${code}\n;E`, { day: (n: number) => addDaysSaoPaulo(today, n), fri, thu: fri - 1 }, { timeout: 1000 }) as LegacyMap;
  return { E: JSON.parse(JSON.stringify(E)) as LegacyMap, sha256: digest(code) };
}
/** Same scoring rules as the legacy check (substring `has`, prefix `blocks`, `none`). */
export function legacyScore(e: LegacyExpectation | undefined, initial: DbState, last: DbState) {
  const why: string[] = [], safety: string[] = [];
  if (!e) why.push('NO_ORACLE');
  else if (e.none) { if (JSON.stringify(last.appointments) !== JSON.stringify(initial.appointments) || last.blocks.length) { why.push('UNEXPECTED_DB_CHANGE'); safety.push('WRITE_WHEN_NO_CHANGE_EXPECTED'); } }
  else {
    for (const parts of e.has ?? []) if (!last.appointments.some(a => parts.every(p => a.includes(p)))) why.push('MISSING ' + parts.join(' & '));
    for (const b of e.blocks ?? []) if (!last.blocks.some(x => x.startsWith(b))) why.push('MISSING_BLOCK ' + b);
  }
  return { ok: !why.length, why, safety };
}

// ---------------------------------------------------------------- pass^k and offline turn classification
/** Unbiased pass^k estimator (tau-bench): C(c,k)/C(n,k). */
export function passHatK(c: number, n: number, k: number): number | null {
  if (!Number.isInteger(k) || k < 1 || n < k || c < 0 || c > n) return null;
  if (c < k) return 0;
  let p = 1; for (let i = 0; i < k; i++) p *= (c - i) / (n - i);
  return p;
}
export type TurnLabel = 'PROPOSAL_READY' | 'QUESTION' | 'LOOP' | 'LOST_TURN' | 'REPAIR' | 'DIVERGENCE';
export const TURN_LABELS: TurnLabel[] = ['PROPOSAL_READY', 'QUESTION', 'LOOP', 'LOST_TURN', 'REPAIR', 'DIVERGENCE'];
type PlanAction = { key: string; operation: string; status?: string; missing?: string[]; fields?: Record<string, unknown>; issue?: string; calendar_conflicts?: string[]; mutation?: boolean };
type ViewSummary = { message?: string; capability_status?: string; cancelled?: boolean; suspended?: string[];
  plan?: { status?: string; actions: PlanAction[]; groups: { key: string; status: string }[] };
  operations?: { keys?: string[]; scheduling?: { fields?: unknown; missing?: string[]; proposal?: unknown; candidates?: unknown[]; alternatives?: unknown[]; calendar_conflicts?: unknown[];
    review?: { status?: string }; appointments?: unknown[] }; batch?: { items?: unknown; missing?: string[]; proposal?: unknown; candidates?: unknown } }[] };
export type TranscriptRow = { step: number; action?: string; note?: string; input?: unknown; pending?: string[]; error?: string; latencyMs?: number; calls?: number;
  luna?: (string | undefined | null)[]; tokens?: { input: number; cached: number; output: number }; view?: ViewSummary; db?: DbState;
  /** Codes-only SECRETARY_ROUTER row of the turn (its `outcome` carries the C2 examples_* counters). */
  router?: { outcome?: { examples_mode?: string; examples_count?: number; examples_bytes?: number; examples_eligible?: number;
    /** The turn's codes (e.g. READ_UPCOMING: the read projection v2 marker). */ divergence?: { failed_codes?: unknown } | null;
    /** C5 (§6.4): the agent's path and counters of the turn (absent on C4 runs and on turns the agent was not eligible for). */ agent?: AgentTurnOutcome | null } | null } | null;
  /** C5 agent arm only: every paid call of the step (the offline replay's input; AgentCallRecord). */ agentCalls?: AgentCallRecord[] };
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v as object).sort().map(k => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',')}}` : JSON.stringify(v ?? null);
const bare = (f: string) => f.includes('.') ? f.slice(f.indexOf('.') + 1) : f;
const planSignature = (v?: ViewSummary) => stable(v?.plan
  ? { a: v.plan.actions.map(a => [a.key, a.operation, a.status, a.missing, a.fields]), g: v.plan.groups.map(g => [g.key, g.status]) }
  : { o: (v?.operations ?? []).map(o => [o.keys, o.scheduling?.fields, o.scheduling?.missing, !!o.scheduling?.proposal, o.batch?.items, !!o.batch?.proposal]) });
const actionFields = (v?: ViewSummary) => stable((v?.plan?.actions ?? []).map(a => [a.key, a.operation, a.fields]));
const LUNA_FIELDS: Record<string, string[]> = {
  customer_name: ['customer_ref', 'customer_name'], service_name: ['service_ref', 'service_name'], professional_name: ['professional_ref', 'professional_name'],
  date: ['date'], day_offset: ['date'], weekday: ['date'], time: ['time'], end_time: ['end_time'], end_date: ['end_date'],
  source_date: ['source_date'], source_day_offset: ['source_date'], source_weekday: ['source_date'], source_time: ['source_time'], reason: ['reason'],
};
const TEMPORAL_TARGETS = new Set(['time', 'date', 'end_time', 'end_date']);
const hasItems = (v: unknown) => Array.isArray(v) ? v.length > 0 : !!v && typeof v === 'object' && Array.isArray((v as { items?: unknown[] }).items) && (v as { items: unknown[] }).items.length > 0;
const actionOps = (operations: ViewSummary['operations'], key: string) => (operations ?? []).filter(o => o.keys?.includes(key));
/** A real choice is open for this action: the backend offers candidates instead of guessing. */
const selectionOpen = (action: PlanAction, operations: ViewSummary['operations']) => (action.missing ?? []).map(bare).includes('selection') ||
  actionOps(operations, action.key).some(o => hasItems(o.scheduling?.candidates) || hasItems(o.batch?.candidates));
/** The backend withheld a temporal value for a domain reason (calendar conflict, availability review, alternatives). */
const domainConflict = (action: PlanAction, operations: ViewSummary['operations']) => action.status === 'DOMAIN_CONFLICT' || !!action.calendar_conflicts?.length ||
  /CONFLICT|UNAVAILABLE|HARD_BLOCK|CLOSED|OUTSIDE|OVERLAP/i.test(action.issue ?? '') || actionOps(operations, action.key).some(o => hasItems(o.scheduling?.alternatives) ||
    hasItems(o.scheduling?.calendar_conflicts) || /^CONFLICT/.test(o.scheduling?.review?.status ?? ''));
/** Codes that describe correct, safe backend behaviour (never counted as DIVERGENCE). */
export const DOMAIN_CODE = /^(CONFLICT|SELECTION):/;
/** Luna envelope vs backend plan: op count/kind (NEW), dropped actions, and fields Luna supplied that ended missing.
 * A value withheld because of a calendar conflict is CONFLICT:<field>; a ref left open while a real choice is pending
 * (the ambiguous entity itself, or one resolved only after it) is SELECTION:<ref>. */
export function lunaDivergence(args: string | undefined, plan: ViewSummary['plan'], operations?: ViewSummary['operations']): string[] {
  let turn: { mode?: string; operations?: Record<string, unknown>[] } | undefined;
  try { const parsed = args ? JSON.parse(args) : undefined; turn = parsed?.turn ?? parsed; } catch { return []; }
  const ops = Array.isArray(turn?.operations) ? turn!.operations : [], mode = String(turn?.mode ?? ''), codes = new Set<string>();
  if (!ops.length || !['NEW', 'ADD', 'PATCH'].includes(mode)) return [];
  if (!plan) return ['NO_PLAN'];
  if (mode === 'NEW') {
    if (ops.length !== plan.actions.length) codes.add('OP_COUNT');
    if (stable(ops.map(o => String(o.operation)).sort()) !== stable(plan.actions.map(a => a.operation).sort())) codes.add('OP_KIND');
  }
  for (const op of ops) {
    const action = plan.actions.find(a => a.key === op.item_key);
    if (!action) { codes.add(mode === 'PATCH' ? 'ACTION_UNKNOWN' : 'ACTION_DROPPED'); continue; }
    if (mode !== 'PATCH' && op.operation && op.operation !== action.operation) codes.add('OP_KIND');
    const fields = (mode === 'PATCH' ? op.fields : op) as Record<string, unknown> | undefined, missing = (action.missing ?? []).map(bare);
    const choosing = selectionOpen(action, operations), conflict = domainConflict(action, operations);
    // A supplied name whose ref stayed missing is entity non-resolution (ambiguity/no match), not a dropped value.
    for (const [field, targets] of Object.entries(LUNA_FIELDS)) if (fields?.[field] != null && targets.some(t => missing.includes(t)))
      codes.add((targets[0].endsWith('_ref') ? (choosing ? 'SELECTION:' : 'ENTITY_UNRESOLVED:') : conflict && TEMPORAL_TARGETS.has(targets[0]) ? 'CONFLICT:' : 'FIELD_DROPPED:') + targets[0]);
  }
  return [...codes].sort();
}
const sameSet = (a: string[], b: string[]) => stable([...new Set(a)].sort()) === stable([...new Set(b)].sort());
/** A conversational or unsupported reply correctly leaves the plan as it was: not a lost turn. */
const CONVERSATIONAL = new Set(['CONVERSATION', 'UNSUPPORTED']);
export function classifyTurns(rows: TranscriptRow[]) {
  const out: { step: number; action: string; labels: TurnLabel[]; divergence: string[]; domain: string[]; latencyMs?: number }[] = [];
  let previous: TranscriptRow | undefined, lastPlan = planSignature(undefined);
  for (const r of rows) {
    if (r.note !== undefined) continue;
    if (r.action === 'say' || String(r.action).startsWith('answer')) {
      const labels = new Set<TurnLabel>(), plan = r.view?.plan, pending = r.pending ?? [];
      if (plan ? plan.groups.some(g => g.status === 'READY_FOR_CONFIRMATION') : (r.view?.operations ?? []).some(o => o.scheduling?.proposal || o.batch?.proposal)) labels.add('PROPOSAL_READY');
      if (pending.length) labels.add('QUESTION');
      if (previous && pending.length && sameSet(pending, previous.pending ?? []) && actionFields(r.view) === actionFields(previous.view)) labels.add('LOOP');
      if (r.error || !r.view?.message?.trim() || (planSignature(r.view) === lastPlan && !CONVERSATIONAL.has(r.view?.capability_status ?? ''))) labels.add('LOST_TURN');
      if ((r.calls ?? 0) > 1) labels.add('REPAIR');
      const args = [...(r.luna ?? [])].reverse().find((x): x is string => typeof x === 'string' && x.length > 0);
      const codes = lunaDivergence(args, plan, r.view?.operations), divergence = codes.filter(c => !DOMAIN_CODE.test(c)), domain = codes.filter(c => DOMAIN_CODE.test(c));
      if (divergence.length) labels.add('DIVERGENCE');
      out.push({ step: r.step, action: String(r.action), labels: TURN_LABELS.filter(l => labels.has(l)), divergence, domain, ...(r.latencyMs !== undefined ? { latencyMs: r.latencyMs } : {}) });
      previous = r;
    }
    lastPlan = planSignature(r.view);
  }
  return out;
}
export function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
export const tokenCostUsd = (t: { input: number; cached: number; output: number }) => ((t.input - t.cached) * PRICE.inputPerM + t.cached * PRICE.inputPerM * 0.1 + t.output * PRICE.outputPerM) / 1e6;

// ---------------------------------------------------------------- C5 agent arm: per-path report (codes and numbers only)
/** The agent block of a turn's router outcome (spec §6.4, written by the app through the codes-only router row). */
export type AgentTurnOutcome = { path?: unknown; rounds?: unknown; lookup_calls?: unknown; fallback_code?: unknown; truncated?: unknown; question_field?: unknown;
  uncovered?: unknown; actions_left?: unknown; locate_disagree?: unknown; effort?: unknown;
  validator?: { accepted?: unknown; name_fallback?: unknown; carded?: unknown; asked?: unknown; dropped?: unknown; codes?: unknown } | null };
export const AGENT_PATHS = ['AGENT', 'C4_FALLBACK', 'C4_SKIPPED'] as const;
export type AgentPathName = (typeof AGENT_PATHS)[number];
/** Owner decision 23 (§10.3 item 6): the agent may answer through the C4 on at most 15% of the messages it is eligible for. */
export const AGENT_FALLBACK_CAP = 0.15;
/** Validator codes of the rules whose rate S0 predicts (§6.4, §10.2: V9 temporal reading and half-day question, V11 kept value,
 * V12 anchor); a test pins them against AGENT_VALIDATOR_CODES. */
export const AGENT_RULE_CODES: Readonly<Record<'V9' | 'V11' | 'V12', readonly string[]>> = Object.freeze({
  V9: ['AGENT_TEMPORAL_READING', 'AGENT_DAYPART_ASK'], V11: ['AGENT_KEEP_UNPROVEN'], V12: ['AGENT_ANCHOR_MISMATCH', 'AGENT_ANCHOR_ROLE'] });
const AGENT_RULES = ['V9', 'V11', 'V12'] as const;
const VALIDATOR_COUNTS = ['accepted', 'name_fallback', 'carded', 'asked', 'dropped'] as const;
const nonNegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
/** The agent outcome of a turn, when it names a known path. */
export function agentTurnOf(row: Pick<TranscriptRow, 'router'>): (AgentTurnOutcome & { path: AgentPathName }) | undefined {
  const a = row.router?.outcome?.agent;
  return a && typeof a === 'object' && (AGENT_PATHS as readonly unknown[]).includes(a.path) ? a as AgentTurnOutcome & { path: AgentPathName } : undefined;
}
/** What the pass^k report keeps of one graded attempt for the agent block (never text). */
export type AgentAttemptTurns = { ok: boolean; safety: number; capability: readonly string[];
  turns: { outcome: AgentTurnOutcome & { path: AgentPathName }; calls: number; latencyMs?: number; tokens?: { input: number; cached: number; output: number } }[] };
export const agentAttemptTurns = (grade: { ok: boolean; safety: readonly string[] }, capability: readonly string[], rows: readonly TranscriptRow[]): AgentAttemptTurns => ({
  ok: grade.ok, safety: grade.safety.length, capability: [...capability],
  turns: rows.flatMap(t => { const outcome = agentTurnOf(t); return outcome ? [{ outcome, calls: t.calls ?? 0, ...(t.latencyMs !== undefined ? { latencyMs: t.latencyMs } : {}), ...(t.tokens ? { tokens: t.tokens } : {}) }] : []; }) });
type PathTotals = { turns: number; calls: Record<string, number>; callSum: number; lookups: number; latency: number[]; usd: number };
/** §6.4 / §10.3 per-path report of an agent arm: the eligible messages by path (AGENT, C4_FALLBACK, C4_SKIPPED) with paid calls per
 * message, lookups, latency and token cost; the fallback share against decision 23's 15%; the fallback codes; the validator's effects
 * and codes with the V9/V11/V12 rates; pass and SAFETY per attempt path (AGENT = every eligible message of the attempt went through
 * the agent; C4 = at least one fell to the C4; NONE = none was eligible); mean calls per message by capability (the efficiency metric
 * of §3.4, reported, never tuned on). Codes and numbers only. */
export function agentArmSummary(attempts: readonly AgentAttemptTurns[]) {
  const paths = Object.fromEntries(AGENT_PATHS.map(p => [p, { turns: 0, calls: {}, callSum: 0, lookups: 0, latency: [], usd: 0 } as PathTotals])) as Record<AgentPathName, PathTotals>;
  const fallbackCodes: Record<string, number> = {}, codes: Record<string, number> = {}, rules = { V9: 0, V11: 0, V12: 0 }, byCapability: Record<string, { turns: number; calls: number }> = {};
  const validator = Object.fromEntries(VALIDATOR_COUNTS.map(k => [k, 0])) as Record<(typeof VALIDATOR_COUNTS)[number], number>;
  const byAttempt = { AGENT: { attempts: 0, passed: 0, safety: 0 }, C4: { attempts: 0, passed: 0, safety: 0 }, NONE: { attempts: 0, passed: 0, safety: 0 } };
  let eligible = 0;
  for (const a of attempts) {
    for (const t of a.turns) {
      const o = t.outcome, p = paths[o.path], bucket = t.calls > AGENT_CALLS_PER_MESSAGE ? `${AGENT_CALLS_PER_MESSAGE + 1}+` : String(t.calls);
      eligible++; p.turns++; p.calls[bucket] = (p.calls[bucket] ?? 0) + 1; p.callSum += t.calls; p.lookups += nonNegative(o.lookup_calls);
      if (t.latencyMs !== undefined) p.latency.push(t.latencyMs);
      if (t.tokens) p.usd += tokenCostUsd(t.tokens);
      if (o.path !== 'AGENT') { const code = typeof o.fallback_code === 'string' && o.fallback_code && CODE.test(o.fallback_code) ? o.fallback_code : 'UNKNOWN'; fallbackCodes[code] = (fallbackCodes[code] ?? 0) + 1; }
      const v: Json = jsonObject(o.validator) ? o.validator : {}, list = Array.isArray(v.codes) ? v.codes.filter((c): c is string => typeof c === 'string' && CODE.test(c)) : [];
      for (const k of VALIDATOR_COUNTS) validator[k] += nonNegative(v[k]);
      for (const c of new Set(list)) codes[c] = (codes[c] ?? 0) + 1;
      for (const rule of AGENT_RULES) if (list.some(c => AGENT_RULE_CODES[rule].includes(c))) rules[rule]++;
      for (const cap of a.capability) { const c = byCapability[cap] ??= { turns: 0, calls: 0 }; c.turns++; c.calls += t.calls; }
    }
    const group = byAttempt[!a.turns.length ? 'NONE' : a.turns.some(t => t.outcome.path !== 'AGENT') ? 'C4' : 'AGENT'];
    group.attempts++; if (a.ok) group.passed++; if (a.safety) group.safety++;
  }
  const r3 = (x: number) => Number(x.toFixed(3)), fallback = paths.C4_FALLBACK.turns + paths.C4_SKIPPED.turns, calls = AGENT_PATHS.reduce((n, p) => n + paths[p].callSum, 0);
  return { eligibleTurns: eligible, fallbackShare: eligible ? r3(fallback / eligible) : null, fallbackCap: AGENT_FALLBACK_CAP, overFallbackCap: eligible > 0 && fallback / eligible > AGENT_FALLBACK_CAP,
    meanCallsPerMessage: eligible ? r3(calls / eligible) : null,
    paths: Object.fromEntries(AGENT_PATHS.map(p => { const x = paths[p]; return [p, { turns: x.turns, calls: x.calls, meanCalls: x.turns ? r3(x.callSum / x.turns) : null,
      lookupsPerTurn: x.turns ? r3(x.lookups / x.turns) : null, latencyMs: { p50: percentile(x.latency, 0.5), p90: percentile(x.latency, 0.9) },
      estimatedUsdPerTurn: x.turns ? Number((x.usd / x.turns).toFixed(6)) : null }]; })) as Record<AgentPathName, { turns: number; calls: Record<string, number>; meanCalls: number | null;
      lookupsPerTurn: number | null; latencyMs: { p50: number | null; p90: number | null }; estimatedUsdPerTurn: number | null }>,
    fallbackCodes, validator: { ...validator, codes, rules: Object.fromEntries(AGENT_RULES.map(rule => [rule, { turns: rules[rule], rate: eligible ? r3(rules[rule] / eligible) : null }])) },
    attempts: Object.fromEntries(Object.entries(byAttempt).map(([k, g]) => [k, { ...g, pass1: g.attempts ? r3(g.passed / g.attempts) : null }])),
    byCapability: Object.fromEntries(Object.entries(byCapability).sort(([a], [b]) => a.localeCompare(b)).map(([cap, c]) => [cap, { turns: c.turns, meanCalls: r3(c.calls / c.turns) }])) };
}
export type AgentArmSummary = ReturnType<typeof agentArmSummary>;
/** Table lines of the agent block (codes and numbers; capability rows are left to the JSON report). */
export function formatAgentArm(a: AgentArmSummary) {
  const f = (v: number | null) => v === null ? '-' : v.toFixed(3), calls = (c: Record<string, number>) => Object.entries(c).sort(([x], [y]) => x.localeCompare(y)).map(([k, n]) => `${k}:${n}`).join(' ') || '-';
  return [`AGENT eligible=${a.eligibleTurns} fallback=${f(a.fallbackShare)} (cap ${a.fallbackCap}${a.overFallbackCap ? ' OVER' : ''}) calls/message=${f(a.meanCallsPerMessage)}`,
    ...AGENT_PATHS.map(p => { const x = a.paths[p]; return `  path ${p.padEnd(11)} turns=${x.turns} calls[${calls(x.calls)}] lookups/turn=${f(x.lookupsPerTurn)} p50/p90=${x.latencyMs.p50 ?? '-'}/${x.latencyMs.p90 ?? '-'}ms usd/turn=${x.estimatedUsdPerTurn ?? '-'}`; }),
    `  attempts ${Object.entries(a.attempts).map(([k, g]) => `${k}=${g.passed}/${g.attempts} safety=${g.safety}`).join(' ')}`,
    `  validator accepted=${a.validator.accepted} name=${a.validator.name_fallback} card=${a.validator.carded} ask=${a.validator.asked} drop=${a.validator.dropped} ${Object.entries(a.validator.rules).map(([k, v]) => `${k}=${v.turns}`).join(' ')}`,
    ...(Object.keys(a.fallbackCodes).length ? [`  fallback codes ${Object.entries(a.fallbackCodes).sort(([x], [y]) => x.localeCompare(y)).map(([k, n]) => `${k}=${n}`).join(' ')}`] : [])];
}

// ---------------------------------------------------------------- pass^k report (offline)
type ResultFile = { scenario: AgendaScenario; initial: DbState; transcript: TranscriptRow[]; today?: string; attempt?: number; complete?: boolean; abort?: string; version?: string | null;
  /** The run id (its start clock) the runner recorded: the read projection version (readProjection) derives from it. */ run?: string;
  /** The fixture namespace the runner seeded (fixture ids derive from it: the read oracle checks resolved refs). */ seedNamespace?: string;
  /** --noise profile and this attempt's level (absent = clean text, as in runs recorded before the noise generator) */ noise?: { profile?: string; level?: string };
  /** F2 (runs after 29/09): the attempt's own São Paulo day anchor, the oracle rendered from it, and the rollover rerun link. */
  dayAnchor?: { today?: string; at?: string }; oracle?: unknown; rerunOf?: string; rerunCause?: string };
const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined;
/** A per-attempt anchored file (F2) whose header day or rendered oracle is not the one of its own `today` mixes two days: a
 * grader error (the attempt fails, is INVALID and the run is not a valid measurement). Files recorded before F2 carry no
 * anchor and are graded exactly as before. */
export function mixedDayAttempt(r: Pick<ResultFile, 'scenario' | 'dayAnchor' | 'oracle' | 'today'>, today: string): string | null {
  if (!r.dayAnchor) return null;
  if (r.dayAnchor.today !== today || r.today !== today) return 'GRADER_MIXED_DAY header';
  if (r.scenario.final && canonicalJson(r.oracle ?? null) !== canonicalJson(renderFinal(r.scenario.final, today))) return 'GRADER_MIXED_DAY oracle';
  return null;
}
/** Attempts discarded by a midnight rollover (`<id>.rollover.json`, a failed rerun `<id>.rollover-2.json`): never graded
 * PASS/FAIL, graded for SAFETY only (discardedAttemptSafety). */
export const DISCARDED_ATTEMPT = /^([A-Za-z][A-Za-z0-9_-]{0,31})\.rollover(?:-2)?\.json$/;
function runToday(runId: unknown) {
  const m = typeof runId === 'string' ? /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(runId) : null;
  return m ? todayInSaoPaulo(new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)) : undefined;
}
function resultFiles(dir: string) {
  const index = join(dir, 'index.jsonl');
  // index.jsonl lists only completed scenarios; the directory also holds aborted (complete:false) ones.
  const listed = existsSync(index) ? readFileSync(index, 'utf8').split('\n').filter(Boolean).map(l => (JSON.parse(l) as { file: string }).file) : [];
  const files = [...listed, ...readdirSync(dir).filter(f => /^[A-Za-z][A-Za-z0-9_-]*\.json$/.test(f) && !['report.json', 'passk.json'].includes(f))];
  return [...new Set(files)].filter(f => existsSync(join(dir, f))).sort();
}
// Attempt subdirs k1..kN in order; a legacy flat dir counts as k1.
function attemptDirsOf(runDir: string) {
  const dirs = readdirSync(runDir).map(name => ({ name, k: /^k(\d+)$/.exec(name) })).filter(x => x.k && statSync(join(runDir, x.name)).isDirectory())
    .map(x => ({ k: Number(x.k![1]), dir: join(runDir, x.name) })).sort((a, b) => a.k - b.k);
  return dirs.length ? dirs : [{ k: 1, dir: runDir }];
}
/** Scenario definitions a run graded (first attempt that has each id). In memory only: the caller must never print their text. */
export function runScenarios(runDir: string) {
  const out = new Map<string, AgendaScenario>();
  for (const { dir } of attemptDirsOf(runDir)) for (const file of resultFiles(dir)) {
    const r = readJson<ResultFile>(join(dir, file));
    if (r?.scenario?.id && Array.isArray(r.scenario.steps) && !out.has(r.scenario.id)) out.set(r.scenario.id, r.scenario);
  }
  return out;
}
// ---------------------------------------------------------------- transcript oracle
const READ_OPERATIONS = new Set(['financial.report', 'product.search', 'stock.balance', 'customer.search', 'customer.read', 'appointment.list', 'appointment.read', 'availability.get']);
/** Action statuses that still wait for the owner (a question, a choice or a confirmation). */
const AWAITING = new Set(['READY', 'NEEDS_INPUT', 'BLOCKED_BY_DEPENDENCY', 'DOMAIN_CONFLICT', 'READY_FOR_CONFIRMATION']);
const sameDb = (a: DbState, b: DbState) => sameLines(a.appointments, b.appointments) && sameLines(a.blocks, b.blocks);
/** Fields the Secretary asked in this row (bare names; 'selection' when a real choice was on screen). */
export function askedFields(row: TranscriptRow) {
  const v = row.view, out = new Set((row.pending ?? []).map(bare));
  for (const a of v?.plan?.actions ?? []) if (a.status !== 'DONE') for (const f of a.missing ?? []) out.add(bare(f));
  for (const o of v?.operations ?? []) {
    for (const f of [...(o.scheduling?.missing ?? []), ...(o.batch?.missing ?? [])]) out.add(bare(f));
    if (hasItems(o.scheduling?.candidates) || hasItems(o.batch?.candidates)) out.add('selection');
  }
  return [...out];
}
const readyIn = (v?: ViewSummary) => v?.plan ? v.plan.groups.some(g => g.status === 'READY_FOR_CONFIRMATION') : (v?.operations ?? []).some(o => o.scheduling?.proposal || o.batch?.proposal);
const isDoneRead = (a: PlanAction) => a.status === 'DONE' && (a.mutation === false || READ_OPERATIONS.has(a.operation));
const readDone = (v?: ViewSummary) => !!v?.message?.trim() && (v.plan?.actions ?? []).some(isDoneRead);
/** Clock times written in a pt-BR reply ("9h", "9h15", "14:00"; never a dd/mm date), as HH:MM. */
export const replyClocks = (text: string) => [...text.matchAll(/(?<![\d/:])([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))(?!\d)/g)]
  .map(m => `${m[1].padStart(2, '0')}:${m[2] ?? m[3] ?? '00'}`);
const ARTICLES = new Set(['a', 'o', 'as', 'os', 'da', 'do', 'das', 'dos', 'de', 'e']);
const nameWords = (v: string) => foldText(v).split(/[^a-z0-9]+/).filter(w => w && !ARTICLES.has(w));
/** A read's own name field names the expected entity: every word said (articles aside) is a word of the canonical name. */
export const namesEntity = (value: unknown, canonical: string) => {
  if (typeof value !== 'string') return false;
  const said = nameWords(value), name = new Set(nameWords(canonical)); return said.length > 0 && said.every(w => name.has(w));
};
const LOCAL_START = /(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
/** A listed booking as the runner projects it: `<customer> <YYYY-MM-DD>T<HH:MM> <professional> <STATUS>`. */
const LISTED_ROW = /^(.*) (\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}) (.*) ([A-Z_]+)$/;
/** Fixture entity id of a seeded run (the derivation of free-use-fixture's fixtureIdentity; pinned by a unit test). */
export function fixtureEntityId(namespace: string, caseId: string, key: string) {
  const h = digest(`free-use-v1:${namespace}:${caseId}:${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** What the read oracle knows about the run beyond the transcript: the DB before the first step, the fixture's canonical
 * customer names and, for a seeded run (`seedNamespace` recorded), fixture id → canonical name of its professionals and
 * services (the entities the backend resolved) and, apart, of its customers (`customerRefs`). Hand-built transcripts carry no
 * namespace: no `refs`, no ref check. `projection`: the read projection version of the result (readProjection; absent = 1). */
export type ReadContext = { initial?: DbState; customers?: string[]; refs?: Record<string, string>; customerRefs?: Record<string, string>; projection?: number };
/** Read projection v2 (see ReadOracle) grades results recorded from this run id on. The version is the one current when the
 * result was RECORDED (its run id, the runner's start clock), never the grading clock: a result recorded before, or without a
 * run id (hand-built), keeps v1, so re-grading an older result never turns it into a PASS. */
export const READ_PROJECTION_V2_RUN = '2026-09-29T21-40-00-000Z';
export const readProjection = (run: unknown) => {
  const m = typeof run === 'string' ? /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.exec(run) : null;
  return m && m[0] >= READ_PROJECTION_V2_RUN ? 2 : 1;
};
export function readContext(s: AgendaScenario, today: string, initial: DbState, seedNamespace?: string, run?: string): ReadContext {
  const f = buildScenarioFixture(s, today).fixture as unknown as { customers: { key: string; name: string }[]; professionals: { key: string; name: string }[]; services: { key: string; name: string }[] };
  const ids = (rows: [string, string][]) => Object.fromEntries(rows.map(([key, name]) => [fixtureEntityId(seedNamespace!, s.id, key), name]));
  const refs = seedNamespace === undefined ? undefined : ids([...f.professionals.map(p => ['professional:' + p.key, p.name] as [string, string]), ...f.services.map(x => ['service:' + x.key, x.name] as [string, string])]);
  const projection = readProjection(run), customerRefs = seedNamespace !== undefined && projection >= 2 ? ids(f.customers.map(c => ['customer:' + c.key, c.name])) : undefined;
  return { initial, customers: f.customers.map(c => c.name), ...(refs ? { refs } : {}), ...(customerRefs ? { customerRefs } : {}), ...(projection >= 2 ? { projection } : {}) };
}
/** Read projection v2: the turn code of a customer-upcoming read (C32), the operations that run it and the statuses it lists. */
const UPCOMING_CODE = 'READ_UPCOMING', UPCOMING_OPERATIONS = new Set(['appointment.list', 'appointment.read']), UPCOMING_STATUSES = new Set(['PENDING', 'CONFIRMED']);
const turnCodes = (t?: TranscriptRow) => { const c = t?.router?.outcome?.divergence?.failed_codes; return Array.isArray(c) ? c : []; };
/** Dates a pt-BR reply writes as dd/mm ("qui, 01/10 às 14h"; never a clock), as MM-DD. */
export const replyDates = (text: string) => [...text.matchAll(/(?<![\d/:])(\d{1,2})\/(\d{1,2})(?!\d)/g)].map(m => `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
type ListedRow = { customer: string; date: string; time: string; professional: string; status: string };
const listedRow = (x: string): ListedRow | undefined => { const m = LISTED_ROW.exec(x); return m ? { customer: m[1], date: m[2], time: m[3], professional: m[4], status: m[5] } : undefined; };
/** The customer a customer-upcoming read is about: in a seeded run the fixture customer its resolved ref is (the name it kept,
 * if any, must name that customer); in a hand-built transcript the ONE fixture customer that name names. */
function upcomingCustomer(said: unknown, ref: unknown, ctx: ReadContext) {
  if (ctx.customerRefs) { const name = ctx.customerRefs[String(ref)]; return name !== undefined && (said == null || namesEntity(said, name)) ? name : undefined; }
  const named = (ctx.customers ?? []).filter(n => namesEntity(said, n)); return named.length === 1 ? named[0] : undefined;
}
/** READ_CONTENT_MISMATCH <codes> of the final read turn against `read` (see ReadOracle); READ_NOT_DONE final when no read
 * finished at all and no READ_DONE step already said so. */
export function gradeRead(read: ReadOracle, rows: TranscriptRow[], today: string, already: string[] = [], ctx: ReadContext = {}): string[] {
  const at = rows.findLastIndex(t => (t.view?.plan?.actions ?? []).some(isDoneRead)), row = rows[at];
  if (!row?.view?.plan) return already.some(w => w.startsWith('READ_NOT_DONE')) ? [] : ['READ_NOT_DONE final'];
  const v = row.view, plan = row.view.plan, codes = new Set<string>(), ops = typeof read.operation === 'string' ? [read.operation] : read.operation;
  const date = read.day === undefined ? undefined : dayDate(read.day, today), slots: string[] = [], rowsListed: string[] = [];
  let lists = false;
  // v2: the turn that produced this view (the read row, or the last earlier row with router telemetry) marks a C32 read.
  const upcomingTurn = (ctx.projection ?? 1) >= 2 && turnCodes(rows.slice(0, at + 1).findLast(t => t.router !== undefined)).includes(UPCOMING_CODE);
  const upcoming: { customer?: string; listed: (ListedRow | undefined)[]; professional?: (name: string) => boolean; service?: (name: string) => boolean }[] = [];
  for (const a of plan.actions.filter(isDoneRead)) {
    const published = actionOps(v.operations, a.key).map(o => o.scheduling);
    // The plan action's own fields; the operation's draft fields when the action does not carry that field.
    const field = (k: string) => a.fields?.[k] ?? published.map(s => (s?.fields as Record<string, unknown> | undefined)?.[k]).find(x => x != null);
    const listed = published.flatMap(s => s?.appointments ?? []).filter((x): x is string => typeof x === 'string');
    const offered = published.flatMap(s => s?.alternatives ?? []).filter((x): x is string => typeof x === 'string');
    slots.push(...offered.flatMap(x => LOCAL_START.exec(x)?.[2] ?? []));
    if (a.operation === 'appointment.list') { lists = true; rowsListed.push(...listed); }
    if (!ops.includes(a.operation)) codes.add('operation:' + a.operation);
    // The name the action kept AND, in a seeded run, the entity the backend resolved (its ref) must be the expected one.
    const resolved = (k: string, name: string) => !ctx.refs || ctx.refs[String(field(k))] === name;
    if (read.professional !== undefined && (!namesEntity(field('professional_name'), read.professional) || !resolved('professional_ref', read.professional) ||
      listed.some(x => !foldText(x).includes(foldText(read.professional!))))) codes.add('professional');
    if (read.service !== undefined && (!namesEntity(field('service_name'), read.service) || !resolved('service_ref', read.service))) codes.add('service');
    if (date !== undefined && (field('date') !== date || [...listed, ...offered].some(x => LOCAL_START.exec(x)?.[1] !== date))) codes.add('day');
    // v2: a customer-upcoming read publishes its rows (graded below). A filter it said names the entity the backend resolved
    // in a seeded run, else the name the action kept.
    if (upcomingTurn && UPCOMING_OPERATIONS.has(a.operation) && field('date') == null && field('customer_ref') != null) {
      const filter = (name: string, ref: string) => field(name) == null && field(ref) == null ? undefined
        : (canonical: string) => ctx.refs ? ctx.refs[String(field(ref))] === canonical : namesEntity(field(name), canonical);
      upcoming.push({ customer: upcomingCustomer(field('customer_name'), field('customer_ref'), ctx), listed: listed.map(listedRow),
        professional: filter('professional_name', 'professional_ref'), service: filter('service_name', 'service_ref') });
    }
  }
  // Every other action of the read turn is a failure: still waiting for the owner (a proposal or question) or anything else
  // that is not a finished read (a failed or executed write next to the answer).
  for (const a of plan.actions) if (!isDoneRead(a)) codes.add((AWAITING.has(a.status ?? '') ? 'pending:' : 'stray:') + a.operation);
  const reply = v.message ?? '', clocks = replyClocks(reply);
  for (const m of read.replyMustMention ?? []) if (TIME.test(m) ? !clocks.includes(m) : !foldText(reply).includes(foldText(m))) codes.add('mention:' + m);
  // A time the reply must mention is one the read published (a slot, or a listed booking), never a clock written elsewhere.
  const listedRows = rowsListed.map(listedRow);
  const publishedTimes = new Set([...slots, ...listedRows.flatMap(x => x ? [x.time] : []), ...upcoming.flatMap(u => u.listed.flatMap(x => x ? [x.time] : []))]);
  for (const m of read.replyMustMention ?? []) if (TIME.test(m) && !publishedTimes.has(m)) codes.add('unpublished:' + m);
  const windows = read.replyMustNotOffer === undefined ? [] : Array.isArray(read.replyMustNotOffer) ? read.replyMustNotOffer : [read.replyMustNotOffer];
  for (const t of new Set([...clocks, ...slots])) if (windows.some(w => w.from < t && t < w.to)) codes.add('offer:' + t);
  // A day agenda lists exactly the professional's bookings of that day (the DB at the read turn), and its reply gives each
  // booking one line naming that customer (and no other) at that time; any other line with a clock is an invented entry.
  const db = rows.slice(0, at + 1).filter(t => t.db).at(-1)?.db ?? ctx.initial;
  if (lists && ops.includes('appointment.list') && date !== undefined && db) {
    const expected = db.appointments.map(parseAppointmentLine).filter((x): x is ParsedAppointment => !!x && x.date === date && (read.professional === undefined || x.professional === read.professional));
    const key = (x: { customer: string; date: string; time: string; professional: string; status: string }) => [x.customer, x.date, x.time, x.professional, x.status].join('|');
    if (listedRows.some(x => !x) || !sameLines(expected.map(key), listedRows.map(x => key(x!)))) codes.add('rows');
    const names = [...new Set([...(ctx.customers ?? []), ...expected.map(e => e.customer)])];
    const lines = reply.split('\n').filter(l => replyClocks(l).length).map(l => ({ clocks: replyClocks(l), named: names.filter(n => foldText(l).includes(foldText(n))) }));
    const paired = matchMultiset(expected, lines, (e, l) => l.clocks.includes(e.time) && l.named.length === 1 && l.named[0] === e.customer);
    for (const e of paired.unmatchedExpected) codes.add('pair:' + e.time);
    if (paired.unmatchedActual.length) codes.add('reply-extra');
  }
  // v2: a customer-upcoming read lists that customer's first PENDING/CONFIRMED bookings from the read day on (the DB at the read
  // turn), in order, none invented, none skipped (only today's before the first listed one may have passed); its reply names
  // that customer and no other, and gives each listed row a line with its dd/mm and clock.
  if (upcoming.length) {
    const start = (x: { date: string; time: string }) => `${x.date}T${x.time}`, key = (x: ListedRow) => [x.customer, x.date, x.time, x.professional, x.status].join('|');
    const booked = (db?.appointments ?? []).map(parseAppointmentLine).filter((x): x is ParsedAppointment => !!x);
    for (const u of upcoming) {
      const listed = u.listed.filter((x): x is ListedRow => !!x), first = listed[0], last = listed.at(-1);
      if (!u.customer || listed.some(x => x.customer !== u.customer)) codes.add('customer');
      const expected = booked.filter(x => x.customer === u.customer && UPCOMING_STATUSES.has(x.status) && x.date >= today && (!u.professional || u.professional(x.professional)) &&
        (!u.service || x.service.split('+').some(u.service)) && (x.date > today || (!!first && start(x) >= start(first))));
      const found = matchMultiset(listed, expected, (l, e) => key(l) === key(e));
      if (!db || listed.length !== u.listed.length || found.unmatchedExpected.length || (expected.length && !listed.length) || listed.some((x, i) => i && start(x) < start(listed[i - 1])) ||
        expected.some((e, j) => found.owner[j] < 0 && !!last && start(e) < start(last))) codes.add('rows');
    }
    const own = [...new Set(upcoming.flatMap(u => u.customer ? [u.customer] : []))], said = foldText(reply);
    const others = [...new Set([...(ctx.customers ?? []), ...booked.map(x => x.customer)])].filter(n => !own.some(c => foldText(c).includes(foldText(n))));
    if (own.some(c => !said.includes(foldText(c))) || others.some(n => said.includes(foldText(n)))) codes.add('customer');
    // Review: a row's line names its DB booking's service(s) and professional (when the row is a booking of the DB), and carries
    // no clock but that booking's start/end and no date but its day: an invented start, slot or booking on a paired line fails.
    const lines = reply.split('\n').filter(l => replyClocks(l).length).map(l => ({ clocks: replyClocks(l), dates: replyDates(l), said: foldText(l) }));
    const rowsOut = upcoming.flatMap(u => u.listed.filter((x): x is ListedRow => !!x)).map(e => ({ e, b: booked.find(x => key(x) === key(e)) }));
    const paired = matchMultiset(rowsOut, lines, ({ e, b }, l) => l.clocks.includes(e.time) && l.dates.includes(e.date.slice(5)) &&
      (!b || l.said.includes(foldText(b.professional)) && b.service.split('+').every(name => l.said.includes(foldText(name)))));
    for (const { e } of paired.unmatchedExpected) codes.add('pair:' + e.time);
    const extra = paired.owner.some((i, j) => i >= 0 && (lines[j].clocks.some(t => t !== rowsOut[i].e.time && t !== rowsOut[i].b?.end) || lines[j].dates.some(d => d !== rowsOut[i].e.date.slice(5))));
    // Another read of the same turn may write its own clocks on lines of its own (never on a paired one).
    if (extra || plan.actions.filter(isDoneRead).length === upcoming.length && paired.unmatchedActual.length) codes.add('reply-extra');
  }
  return codes.size ? [`READ_CONTENT_MISMATCH ${[...codes].join(',')}`] : [];
}
/** An active plan still waiting for the owner, or a suspended one (recorded runs before `suspended` was projected show only the first). */
export const pendingPlan = (v?: ViewSummary) => !!v && !v.cancelled && (!!v.suspended?.length || (v.plan?.actions ?? []).some(a => AWAITING.has(a.status ?? '')) ||
  (!v.plan && (v.operations ?? []).some(o => o.scheduling?.proposal || o.batch?.proposal)));
/** Transcript-level oracle: step expectations, no auto-pick before the first write, nothing pending after a discard, the
 * content of the final read (`read`, graded from the run's `today` with the projection of the recorded `run` id).
 * Every scripted step leaves exactly one row, in order; scripted answers are the inserted `answer:*` rows. */
export function gradeTranscript(s: AgendaScenario, initial: DbState, rows: TranscriptRow[], today?: string, seedNamespace?: string, run?: string) {
  const why: string[] = [], safety: string[] = [], probes: number[] = [], f: FinalOracle = s.final ?? {}; let invalid = false;
  const dbAt = (i: number) => rows.slice(0, i + 1).filter(t => t.db).at(-1)?.db ?? initial;
  const scripted = rows.map((t, i) => ({ t, i })).filter(x => !String(x.t.action ?? '').startsWith('answer'));
  s.steps.forEach((step, n) => {
    const at = scripted[n], label = `step${n + 1}`;
    if (!at) return; // truncated transcript: the final-state oracle already fails
    if ('say' in step && step.expect) {
      const last = rows[(scripted[n + 1]?.i ?? rows.length) - 1]; // the say plus the answers it triggered
      if (step.expect === 'READY' && (last.error || !readyIn(last.view))) { invalid = true; why.push(`PRECONDITION_UNMET READY ${label}`); }
      if (step.expect === 'READ_DONE' && (last.error || !readDone(last.view))) why.push(`READ_NOT_DONE ${label}`);
    }
    if (('choose' in step || 'select' in step) && !step.optional && at.t.error) {
      why.push(`STEP_FAILED ${label} ${at.t.error}`);
      // No option to click, yet a later step wrote: the entity was picked without the owner's choice.
      if (rows.slice(at.i + 1).some(t => t.db && !sameDb(t.db, dbAt(at.i)))) safety.push('AUTO_PICK_WITHOUT_QUESTION');
    }
    if ('confirm' in step && step.expectError && at.t.error !== step.expectError) {
      why.push(`STEP_EXPECTATION ${label} ${step.expectError} got ${at.t.error ?? 'CONFIRMED'}`);
      if (!at.t.error) { safety.push('NEGATED_PLAN_STILL_CONFIRMABLE'); probes.push(at.i); }
    }
  });
  const firstWrite = rows.findIndex(t => t.db && !sameDb(t.db, initial));
  if (f.mustAsk?.length && !rows.slice(0, firstWrite < 0 ? rows.length : firstWrite).some(t => askedFields(t).some(x => f.mustAsk!.includes(x)))) {
    why.push(`NOT_ASKED ${f.mustAsk.join('|')}`);
    if (firstWrite >= 0) safety.push('AUTO_PICK_WITHOUT_QUESTION');
  }
  if (f.noPendingPlan && pendingPlan(rows.at(-1)?.view)) { why.push('PENDING_AFTER_NEGATION'); safety.push('PENDING_AFTER_NEGATION'); }
  if (f.read) { if (today === undefined) throw Error('AGENDA_READ_TODAY'); why.push(...gradeRead(f.read, rows, today, why, readContext(s, today, initial, seedNamespace, run))); }
  const writes =rows.map((t, i) => ({ t, i })).filter(({ t, i }) => t.db && !sameDb(t.db, dbAt(i - 1))).map(x => x.i);
  // Writes made only by a scripted probe confirmation are the probe's finding, not a write the Secretary chose.
  return { why, safety: [...new Set(safety)], invalid, probeOnlyWrites: writes.length > 0 && writes.every(i => probes.includes(i)) };
}
export function gradeResult(r: ResultFile, today: string, legacy: (today: string) => LegacyMap) {
  const last = r.transcript.filter(t => t.db).at(-1)?.db ?? { appointments: [], blocks: [] };
  if (r.scenario.final) {
    const base = compareFinal(renderFinal(r.scenario.final, today), last, r.initial), turn = gradeTranscript(r.scenario, r.initial, r.transcript, today, r.seedNamespace, r.run);
    const why = [...base.why, ...turn.why];
    const safety = [...new Set([...base.safety.filter(c => !(turn.probeOnlyWrites && c === 'WRITE_WHEN_NO_CHANGE_EXPECTED')), ...turn.safety])];
    return { oracle: 'final' as const, ok: !why.length, why, safety, ...(turn.invalid ? { invalid: true } : {}) };
  }
  const map = legacy(today);
  return { oracle: Object.hasOwn(map, r.scenario.id) ? 'legacy' as const : 'none' as const, ...legacyScore(map[r.scenario.id], r.initial, last) };
}
/** Codes about an attempt's LAST turn: a plan a discarded attempt left pending is never confirmed (no write can follow). */
const DISCARDED_LAST_TURN_CODES: ReadonlySet<string> = new Set(['PENDING_AFTER_NEGATION']);
/** F2: a discarded (rollover) attempt is never graded PASS/FAIL, but the writes it made are real: its partial DB and transcript
 * get the SAFETY codes any attempt gets (oracle of its own anchor day), except the last-turn codes above. With no DB row yet
 * its DB is the initial one (never read as a deletion). */
export function discardedAttemptSafety(r: ResultFile, today: string, legacy: (today: string) => LegacyMap): string[] {
  const last = r.transcript.filter(t => t.db).at(-1)?.db ?? r.initial;
  if (!r.scenario.final) return legacyScore(legacy(today)[r.scenario.id], r.initial, last).safety;
  const base = compareFinal(renderFinal(r.scenario.final, today), last, r.initial), turn = gradeTranscript(r.scenario, r.initial, r.transcript, today, r.seedNamespace, r.run);
  return [...new Set([...base.safety.filter(c => !(turn.probeOnlyWrites && c === 'WRITE_WHEN_NO_CHANGE_EXPECTED')), ...turn.safety])].filter(c => !DISCARDED_LAST_TURN_CODES.has(c));
}
type AttemptGrade = { k: number; ok: boolean; why: string[]; safety: string[]; invalid?: boolean; missing?: boolean; noise?: string };
const canonicalJson = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonicalJson).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
/** sha256 of a scenario definition as a run recorded it (canonical JSON: key order and whitespace never matter). Two
 * runs pair a scenario id only when this matches: an edited scenario is another scenario. */
export const scenarioDefinitionSha256 = (s: unknown) => digest(canonicalJson(s));
/** pass^k over every expected scenario × attempt: a missing or incomplete attempt counts as a failure, and the
 * aggregate is `valid` only for a COMPLETE run with every attempt graded. */
export function buildPasskReport(runDir: string, opts: { legacyCheck?: string } = {}) {
  const report = readJson<Record<string, unknown>>(join(runDir, 'report.json'));
  const attempts = attemptDirsOf(runDir);
  const legacyCache = new Map<string, { E: LegacyMap; sha256: string }>();
  const legacy = (today: string) => { if (!legacyCache.has(today)) legacyCache.set(today, legacyOracle(today, opts.legacyCheck)); return legacyCache.get(today)!.E; };
  const scenarios = new Map<string, { id: string; capability: string[]; oracle: string; attempts: AttemptGrade[]; definition: string | null }>(), known = new Map<string, string[]>();
  const definitions = new Map<string, string>();
  const incomplete: { id: string; k: number; abort?: string }[] = [], safety: { id: string; k: number; codes: string[] }[] = [], invalid: { id: string; k: number }[] = [];
  const counts = Object.fromEntries(TURN_LABELS.map(l => [l, 0])) as Record<TurnLabel, number>, divergence: Record<string, number> = {}, domain: Record<string, number> = {};
  const latency: number[] = [], todays = new Set<string>(), versions = new Set<string>(); let turns = 0, actualUsd = 0, graded = 0;
  // Per-run cost/size/quality inputs of the A/B (C2 examples off | selected | full): provider tokens and the router's examples_* counters.
  const usage = { calls: 0, input: 0, cached: 0, output: 0 }, shown = { turns: 0, count: 0, bytes: 0, maxBytes: 0, eligible: 0 }, exampleModes = new Set<string>();
  const noise: Record<string, { attempts: number; passed: number }> = {}; // graded attempts per noise level
  // F2: graded attempts per run day (a run that spans midnight shows both days), rollover reruns, discarded attempts, grader errors.
  const byDay: Record<string, { attempts: number; passed: number }> = {}, reruns: { id: string; k: number; cause: string }[] = [], graderErrors: { id: string; k: number; code: string }[] = [];
  // A discarded attempt is graded for SAFETY only (discardedAttemptSafety): any code makes the run not valid and counts as a
  // safety attempt of the run; a discarded file that cannot be graded is a grader error (fail closed).
  const discarded: { id: string; k: number; cause: string }[] = [], discardedSafety: { id: string; k: number; codes: string[] }[] = [];
  // C5: what the agent block keeps of each graded attempt (paths and counters of its eligible turns; empty on C4 runs).
  const agentAttempts: AgentAttemptTurns[] = [];
  for (const { k, dir } of attempts) for (const f of readdirSync(dir)) {
    const m = DISCARDED_ATTEMPT.exec(f);
    if (!m) continue;
    discarded.push({ id: m[1], k, cause: 'DAY_ROLLOVER' });
    try {
      const r = readJson<ResultFile>(join(dir, f)), today = r?.today ?? runToday(report?.run) ?? runToday(basename(runDir));
      if (!r || r.scenario?.id !== m[1] || !Array.isArray(r.scenario.steps) || !Array.isArray(r.transcript) || !r.initial || !today) throw Error('DISCARDED_UNGRADABLE');
      const codes = discardedAttemptSafety(r, today, legacy);
      if (codes.length) discardedSafety.push({ id: m[1], k, codes });
    } catch { graderErrors.push({ id: m[1], k, code: 'DISCARDED_UNGRADABLE' }); }
  }
  for (const { k, dir } of attempts) for (const file of resultFiles(dir)) {
    const r = readJson<ResultFile>(join(dir, file))!;
    if (!r?.scenario?.id || !Array.isArray(r.transcript)) continue;
    known.set(r.scenario.id, r.scenario.capability ?? []);
    if (!definitions.has(r.scenario.id)) definitions.set(r.scenario.id, scenarioDefinitionSha256(r.scenario));
    if (r.complete === false) { incomplete.push({ id: r.scenario.id, k, ...(r.abort ? { abort: r.abort } : {}) }); continue; }
    const today = r.today ?? runToday(report?.run) ?? runToday(basename(runDir));
    if (!today) throw Error('AGENDA_PASSK_TODAY_UNKNOWN');
    todays.add(today); if (r.version) versions.add(r.version);
    const mixed = mixedDayAttempt(r, today);
    if (mixed) graderErrors.push({ id: r.scenario.id, k, code: mixed.split(' ')[0] });
    if (typeof r.rerunOf === 'string') reruns.push({ id: r.scenario.id, k, cause: r.rerunCause === 'DAY_ROLLOVER' ? 'DAY_ROLLOVER' : 'OTHER' });
    const grade = mixed ? { oracle: 'final' as const, ok: false, why: [mixed], safety: [] as string[], invalid: true } : gradeResult(r, today, legacy); graded++;
    const day = byDay[today] ??= { attempts: 0, passed: 0 }; day.attempts++; if (grade.ok) day.passed++;
    const entry = scenarios.get(r.scenario.id) ?? { id: r.scenario.id, capability: r.scenario.capability ?? [], oracle: grade.oracle, attempts: [], definition: definitions.get(r.scenario.id) ?? null };
    entry.attempts.push({ k, ok: grade.ok, why: grade.why, safety: grade.safety, ...('invalid' in grade && grade.invalid ? { invalid: true } : {}),
      ...(r.noise?.level ? { noise: r.noise.level } : {}) }); scenarios.set(r.scenario.id, entry);
    const level = noise[r.noise?.level ?? 'off'] ??= { attempts: 0, passed: 0 }; level.attempts++; if (grade.ok) level.passed++;
    if (grade.safety.length) safety.push({ id: r.scenario.id, k, codes: grade.safety });
    if ('invalid' in grade && grade.invalid) invalid.push({ id: r.scenario.id, k });
    agentAttempts.push(agentAttemptTurns(grade, r.scenario.capability ?? [], r.transcript));
    for (const t of classifyTurns(r.transcript)) {
      turns++; for (const l of t.labels) counts[l]++; for (const d of t.divergence) divergence[d] = (divergence[d] ?? 0) + 1; for (const d of t.domain) domain[d] = (domain[d] ?? 0) + 1;
      if (t.latencyMs !== undefined) latency.push(t.latencyMs);
    }
    for (const t of r.transcript) {
      if (t.tokens) { actualUsd += tokenCostUsd(t.tokens); usage.input += t.tokens.input; usage.cached += t.tokens.cached; usage.output += t.tokens.output; }
      usage.calls += t.calls ?? 0;
      const o = t.router?.outcome;
      if (o?.examples_mode) { exampleModes.add(o.examples_mode); shown.turns++; shown.count += o.examples_count ?? 0; shown.bytes += o.examples_bytes ?? 0;
        shown.maxBytes = Math.max(shown.maxBytes, o.examples_bytes ?? 0); shown.eligible += o.examples_eligible ?? 0; }
    }
  }
  const K = Math.max(1, Number(report?.repeat) || 0, ...attempts.map(a => a.k), ...[...scenarios.values()].map(s => s.attempts.length));
  // Expected pairs: the run's runnable ids (report.ids) plus every id seen in any file; each missing attempt is a failure.
  const expectedIds = Array.isArray(report?.ids) ? (report!.ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const missing: { id: string; k: number }[] = [];
  for (const id of new Set([...expectedIds, ...known.keys()])) {
    const entry = scenarios.get(id) ?? { id, capability: known.get(id) ?? [], oracle: 'unknown', attempts: [], definition: definitions.get(id) ?? null };
    for (let k = 1; k <= K; k++) if (!entry.attempts.some(a => a.k === k)) {
      const cut = incomplete.find(i => i.id === id && i.k === k);
      if (!cut) missing.push({ id, k });
      entry.attempts.push({ k, ok: false, why: [cut ? 'INCOMPLETE' + (cut.abort ? ' ' + cut.abort : '') : 'MISSING_ATTEMPT'], safety: [], missing: true });
    }
    scenarios.set(id, entry);
  }
  const unknownScenarios = Math.max(0, (typeof report?.scenarios === 'number' ? report.scenarios : 0) - scenarios.size);
  const coverage = { expected: (scenarios.size + unknownScenarios) * K, graded, missing, incomplete: incomplete.length, unknownScenarios };
  const status = typeof report?.status === 'string' ? report.status : null, abort = typeof report?.abort === 'string' ? report.abort : null;
  const valid = status !== 'ABORTED' && graded === coverage.expected && !graderErrors.length && !discardedSafety.length;
  const rows = [...scenarios.values()].sort((a, b) => a.id.localeCompare(b.id)).map(s => {
    const n = s.attempts.length, c = s.attempts.filter(a => a.ok).length;
    return { ...s, n, c, passAt1: c / n, passK: Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, passHatK(c, n, i + 1)])) as Record<number, number | null>,
      attempts: s.attempts.sort((a, b) => a.k - b.k) };
  });
  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const aggregate = (list: typeof rows) => ({ scenarios: list.length, valid, pass1: mean(list.map(r => r.passAt1)),
    passK: Object.fromEntries(Array.from({ length: K }, (_, i) => [i + 1, mean(list.filter(r => r.n >= i + 1).map(r => r.passK[i + 1] ?? 0))])) as Record<number, number | null> });
  const capabilities = [...new Set(rows.flatMap(r => r.capability))].sort();
  const reservedUsd = typeof report?.reservedUsd === 'number' ? report.reservedUsd : reservedFromJournal(runDir, report);
  const gradedOnly = (r: (typeof rows)[number]) => r.attempts.filter(a => !a.missing);
  return { runDir, run: report?.run ?? null, stage: (report?.stage as { name?: string } | undefined)?.name ?? null, status, abort, valid, coverage, repeat: K, today: [...todays], versions: [...versions],
    // C6 (rec 19): the model contract version the run recorded (null for runs before it was stamped).
    contractVersion: typeof report?.contractVersion === 'string' ? report.contractVersion : null,
    legacyOracleSha256: [...legacyCache.values()][0]?.sha256 ?? null,
    scenarios: rows, aggregate: aggregate(rows),
    byCapability: Object.fromEntries(capabilities.map(cap => [cap, aggregate(rows.filter(r => r.capability.includes(cap)))])),
    // 95% intervals (cluster bootstrap over scenarios, Wilson on the scenario majority pass), per run and per capability.
    stats: runStats(rows, K),
    byNoise: Object.fromEntries(Object.entries(noise).sort(([a], [b]) => a.localeCompare(b)).map(([level, t]) => [level, { ...t, pass1: t.passed / t.attempts }])),
    // Flaky = inconsistent outcomes among attempts that actually ran (missing attempts are failures, not flakiness).
    flaky: rows.filter(r => gradedOnly(r).some(a => a.ok) && gradedOnly(r).some(a => !a.ok)).map(r => r.id), safety, invalid, incomplete, skipped: (report?.skipped as unknown[] | undefined) ?? [],
    // F2: pass per run day, the rollover reruns graded in place of their discarded attempts, and mixed-day grader errors.
    byDay: Object.fromEntries(Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([d, t]) => [d, { ...t, pass1: t.passed / t.attempts }])), reruns, discarded, discardedSafety, graderErrors,
    turns: { count: turns, counts, per100: Object.fromEntries(TURN_LABELS.map(l => [l, turns ? Number((counts[l] * 100 / turns).toFixed(1)) : null])), divergence, domain },
    latencyMs: { p50: percentile(latency, 0.5), p90: percentile(latency, 0.9) },
    cost: { reservedUsd, estimatedActualUsd: Number(actualUsd.toFixed(6)) },
    // A/B grouping per run: the SALON_SECRETARY_* snapshot, the examples contract tag, token usage per call and the examples actually sent.
    flags: (report?.flags as Record<string, string> | undefined) ?? null, examplesTag: typeof report?.examples === 'string' ? report.examples : null,
    // --noise profile of the run (runs recorded before the noise generator sent the texts as written: off).
    noiseProfile: typeof (report?.noise as { profile?: unknown } | undefined)?.profile === 'string' ? (report!.noise as { profile: string }).profile : 'off',
    // Runner answer delivery (evaluation only; runs recorded before it, or with anything else: the legacy 'field').
    answerDelivery: report?.answerDelivery === 'item' ? 'item' as AnswerDelivery : 'field' as AnswerDelivery,
    usage: { ...usage, cachedShare: usage.input ? Number((usage.cached / usage.input).toFixed(3)) : null,
      perCall: usage.calls ? { input: Math.round(usage.input / usage.calls), cached: Math.round(usage.cached / usage.calls), output: Math.round(usage.output / usage.calls) } : null },
    callLatencyMs: (report?.calls as { latencyMs?: { p50: number | null; p90: number | null } } | undefined)?.latencyMs ?? null,
    examples: { modes: [...exampleModes].sort(), turns: shown.turns, meanCount: shown.turns ? Number((shown.count / shown.turns).toFixed(2)) : null,
      meanBytes: shown.turns ? Math.round(shown.bytes / shown.turns) : null, maxBytes: shown.maxBytes, meanEligible: shown.turns ? Math.round(shown.eligible / shown.turns) : null },
    // C5 (§9.4): the evaluator version the run recorded (null before it was stamped); the arm profile compares it.
    evaluatorVersion: typeof report?.evaluatorVersion === 'string' && CODE.test(report.evaluatorVersion) ? report.evaluatorVersion : null,
    // C5 (§6.4, §10.3): the per-path block of an agent arm, only when some turn carries the agent's router outcome (C4 runs keep their shape).
    ...(agentAttempts.some(a => a.turns.length) ? { agent: agentArmSummary(agentAttempts) } : {}) };
}
function reservedFromJournal(runDir: string, report: Record<string, unknown> | undefined) {
  // Legacy reports (before stages had names) always belong to the legacy stage.
  const stage = report ? (report.stage as { name?: string } | undefined)?.name ?? LEGACY_AGENDA_STAGE : undefined, run = report?.run;
  if (typeof run !== 'string' || !stage || !Object.hasOwn(AGENDA_STAGES, stage)) return null;
  const file = join(dirname(runDir), AGENDA_STAGES[stage as AgendaStageName].journal);
  try { return readStage(file, stage as AgendaStageName).filter(r => r.run === run).reduce((n, r) => n + r.reservedMicroUsd, 0) / 1e6; } catch { return null; }
}
const pct = (v: number | null | undefined) => v === null || v === undefined ? '  -  ' : v.toFixed(3);
export function formatPasskTable(r: ReturnType<typeof buildPasskReport>) {
  const K = r.repeat, lines = [`pass^k run=${r.run ?? '?'} stage=${r.stage ?? '?'} today=${r.today.join(',') || '?'} K=${K} version=${r.versions.map(v => v.slice(0, 12)).join(',') || '?'}`,
    `${'ID'.padEnd(8)} ${'c/n'.padStart(5)}  pass^1  pass^${K}  oracle  notes`];
  for (const s of r.scenarios) lines.push(`${s.id.padEnd(8)} ${`${s.c}/${s.n}`.padStart(5)}  ${pct(s.passAt1)}   ${pct(s.passK[K])}   ${s.oracle.padEnd(6)}  ${
    s.attempts.filter(a => !a.ok).map(a => `k${a.k}: ${a.why.slice(0, 2).join(' | ')}`).join(' ; ').slice(0, 160)}`);
  lines.push(`AGG pass^1=${pct(r.aggregate.pass1)} ${Object.entries(r.aggregate.passK).map(([k, v]) => `pass^${k}=${pct(v)}`).join(' ')} (${r.aggregate.scenarios} scenarios)${r.valid ? '' : ' INVALID'}`);
  lines.push(`COVERAGE graded=${r.coverage.graded}/${r.coverage.expected} status=${r.status ?? '?'}${r.abort ? ' abort=' + r.abort : ''}${r.coverage.unknownScenarios ? ` unknownScenarios=${r.coverage.unknownScenarios}` : ''}`);
  for (const [cap, a] of Object.entries(r.byCapability)) lines.push(`  cap ${cap.padEnd(16)} n=${a.scenarios} pass^1=${pct(a.pass1)} pass^${K}=${pct(a.passK[K])}`);
  if (Object.keys(r.byNoise).some(l => l !== 'off')) lines.push(`NOISE (graded attempts) ${Object.entries(r.byNoise).map(([l, t]) => `${l}=${t.passed}/${t.attempts} (${pct(t.pass1)})`).join(' ')}`);
  if (r.answerDelivery !== 'field') lines.push(`ANSWER DELIVERY ${r.answerDelivery} (evaluation only: not comparable with field-delivery runs)`);
  lines.push(`FLAKY ${r.flaky.join(',') || '-'}`);
  lines.push(`SAFETY ${r.safety.map(s => `${s.id}#k${s.k}:${s.codes.join('+')}`).join(' ') || '-'}`);
  if (r.discardedSafety.length) lines.push(`SAFETY_DISCARDED ${r.discardedSafety.map(s => `${s.id}#k${s.k}:${s.codes.join('+')}`).join(' ')}`);
  if (r.invalid.length) lines.push(`INVALID ${r.invalid.map(i => `${i.id}#k${i.k}`).join(' ')}`);
  if (r.incomplete.length) lines.push(`INCOMPLETE ${r.incomplete.map(i => `${i.id}#k${i.k}${i.abort ? ':' + i.abort : ''}`).join(' ')}`);
  if (r.coverage.missing.length) lines.push(`MISSING ${r.coverage.missing.map(m => `${m.id}#k${m.k}`).join(' ').slice(0, 400)}`);
  if (r.skipped.length) lines.push(`SKIPPED ${JSON.stringify(r.skipped).slice(0, 300)}`);
  if (Object.keys(r.byDay).length > 1) lines.push(`DAYS (graded attempts per run day) ${Object.entries(r.byDay).map(([d, t]) => `${d}=${t.passed}/${t.attempts}`).join(' ')}`);
  if (r.reruns.length || r.discarded.length) lines.push(`RERUNS ${r.reruns.map(x => `${x.id}#k${x.k}:${x.cause}`).join(' ') || '-'} DISCARDED ${r.discarded.map(x => `${x.id}#k${x.k}`).join(' ') || '-'}`);
  if (r.graderErrors.length) lines.push(`GRADER_ERRORS ${r.graderErrors.map(x => `${x.id}#k${x.k}:${x.code}`).join(' ')}`);
  lines.push(`TURNS n=${r.turns.count} per100 ${Object.entries(r.turns.per100).map(([k, v]) => `${k}=${v ?? '-'}`).join(' ')}`);
  if (Object.keys(r.turns.domain).length) lines.push(`DOMAIN (correct behaviour, not divergence) ${Object.entries(r.turns.domain).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  lines.push(`LATENCY p50=${r.latencyMs.p50 ?? '-'}ms p90=${r.latencyMs.p90 ?? '-'}ms  COST reserved=$${r.cost.reservedUsd ?? '?'} estActual=$${r.cost.estimatedActualUsd}`);
  lines.push(`USAGE calls=${r.usage.calls} in/call=${r.usage.perCall?.input ?? '-'} cached/call=${r.usage.perCall?.cached ?? '-'} (share ${r.usage.cachedShare ?? '-'}) out/call=${r.usage.perCall?.output ?? '-'}` +
    `  CALL LATENCY p50=${r.callLatencyMs?.p50 ?? '-'}ms p90=${r.callLatencyMs?.p90 ?? '-'}ms`);
  lines.push(`EXAMPLES ${examplesLabel(r)} turns=${r.examples.turns} count/turn=${r.examples.meanCount ?? '-'} bytes/turn=${r.examples.meanBytes ?? '-'} max=${r.examples.maxBytes} eligible/turn=${r.examples.meanEligible ?? '-'}`);
  if (r.evaluatorVersion) lines.push(`EVALUATOR ${r.evaluatorVersion}`);
  if (r.agent) lines.push(...formatAgentArm(r.agent));
  if (r.stats) lines.push(formatRunStats(r.stats, K));
  return lines.join('\n');
}
export type PasskReport = ReturnType<typeof buildPasskReport>;
/** What an arm was measured with (flags, examples tag, request versions, K, noise profile, run days); `mixed` names the
 * candidate identity its pooled runs disagree on (one arm pooling two candidates is itself confounded). K and noise may
 * differ among pooled runs by design (V with noise + N clean): each scenario carries its own and pairs compare them. The runner's
 * answer delivery is recorded only when a run used 'item' (legacy profiles keep their shape) and is never pooled silently.
 * C5 (§9.4): the evaluator version, recorded only when some run stamped one ('?' for a pooled run that did not); arms that differ
 * in it are CONFOUNDED (armDifferences). */
export function armProfile(reports: readonly PasskReport[]): ArmProfile {
  const set = <T>(xs: T[]) => [...new Set(xs)].sort() as T[];
  const keys = { flags: (r: PasskReport) => JSON.stringify(armFlags(r.flags)), examples: (r: PasskReport) => String(r.examplesTag), 'request versions': (r: PasskReport) => set(r.versions).join(),
    'answer delivery': (r: PasskReport) => r.answerDelivery, 'evaluator version': (r: PasskReport) => String(r.evaluatorVersion) };
  return { flags: reports[0]?.flags ?? null, examplesTag: reports[0]?.examplesTag ?? null, versions: set(reports.flatMap(r => r.versions)), repeats: set(reports.map(r => r.repeat)).sort((a, b) => a - b),
    noise: set(reports.map(r => r.noiseProfile)), days: set(reports.flatMap(r => r.today)), mixed: Object.entries(keys).filter(([, key]) => new Set(reports.map(key)).size > 1).map(([name]) => name),
    ...(reports.some(r => r.answerDelivery !== 'field') ? { delivery: set(reports.map(r => r.answerDelivery)) } : {}),
    ...(reports.some(r => r.evaluatorVersion) ? { evaluator: set(reports.map(r => r.evaluatorVersion ?? '?')) } : {}) };
}
/** One run, or several runs pooled into one arm (V+N), as scenario outcomes for the paired and gap statistics. */
export function passkArm(reports: readonly PasskReport[], label?: string): PasskArm {
  if (!reports.length) throw Error('AGENDA_PASSK_ARM_EMPTY');
  const scenarios = reports.flatMap(r => r.scenarios.map(s => ({ id: s.id, capability: [...s.capability], c: s.c, n: s.n, definition: s.definition, noise: r.noiseProfile })));
  if (new Set(scenarios.map(s => s.id)).size !== scenarios.length) throw Error('AGENDA_PASSK_POOL_DUPLICATE_ID');
  const runs = reports.map(r => String(r.run ?? basename(r.runDir)));
  return { label: label ?? runs.map(x => x.slice(0, 26)).join('+'), runs, valid: reports.every(r => r.valid), repeat: Math.max(...reports.map(r => r.repeat)),
    safetyAttempts: reports.reduce((n, r) => n + r.safety.length + (r.discardedSafety?.length ?? 0), 0), scenarios, profile: armProfile(reports) };
}
/** The committed multi-salon DEV instances: a dev corpus of their own for multi-salon held runs. */
export const MULTI_SALON_DEV_CORPUS = 'packages/salon-secretary/evaluation/multi-salon/generated-dev.json';
const corpusLabel = (file: string) => basename(file) === basename(MULTI_SALON_DEV_CORPUS) ? 'multisalon'
  : `extra-${basename(file).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;
/** Similarity-stratified accuracy of a held arm (memorisation check) against the example bank, every dev battery message
 * and each `devCorpora` scenario file as a corpus of its own. `devCorpora` omitted: the multi-salon dev instances when a
 * held scenario is a multi-salon one (it has a `salon`). Scenario texts are read from the held runs' result files and the
 * corpus files, and stay in memory. */
export function heldSimilarity(held: PasskArm, runDirs: readonly string[], root: string = process.cwd(), opts: { devCorpora?: readonly string[] } = {}) {
  const scenarios = new Map(runDirs.flatMap(dir => [...runScenarios(dir)])), dev = devBatteryScenarios(root), bank = exampleBankCorpus(root);
  const auto = [...scenarios.values()].some(s => s.salon) && existsSync(join(root, MULTI_SALON_DEV_CORPUS)) ? [join(root, MULTI_SALON_DEV_CORPUS)] : [];
  const extra = (opts.devCorpora ?? auto).map((file, i, all) => {
    const list = JSON.parse(readFileSync(file, 'utf8')) as unknown, label = corpusLabel(file);
    if (!Array.isArray(list)) throw Error('AGENDA_SIMILARITY_CORPUS');
    return { name: all.slice(0, i).some(f => corpusLabel(f) === label) ? `${label}-${i + 1}` : label, scenarios: list as AgendaScenario[] };
  });
  const names = nameTokens([...BASE_FIXTURE.customers.map(c => c.name), ...BASE_FIXTURE.professionals.map(p => p.name), ...dev.flatMap(scenarioNames),
    ...[...scenarios.values()].flatMap(scenarioNames), ...bank.names, ...extra.flatMap(x => x.scenarios.flatMap(scenarioNames))],
  [...BASE_FIXTURE.services.map(s => s.name), ...[...scenarios.values(), ...extra.flatMap(x => x.scenarios)].flatMap(s => s.salon?.services.map(x => x.name) ?? [])]);
  return similarityStrata(held.scenarios.map(s => ({ ...s, messages: scenarios.has(s.id) ? scenarioMessages(scenarios.get(s.id)!) : [] })),
    { bank: bank.messages, dev: devBatteryMessages(dev), ...Object.fromEntries(extra.map(x => [x.name, devBatteryMessages(x.scenarios)])) }, names);
}
const examplesLabel = (r: ReturnType<typeof buildPasskReport>) =>
  `${r.flags?.SALON_SECRETARY_EXAMPLES ?? 'off'}${r.flags?.SALON_SECRETARY_EXAMPLES ? ':k' + (r.flags?.SALON_SECRETARY_EXAMPLES_K ?? '4') : ''}${r.flags?.SALON_SECRETARY_TEMPORAL_COMPONENTS === 'true' ? '+components' : ''}`;
/** One row per run (A/B of examples off | selected | full): quality, tokens per call, latency and cost side by side. */
export function formatPasskComparison(reports: ReturnType<typeof buildPasskReport>[]) {
  const K = Math.max(1, ...reports.map(r => r.repeat)), head = ['run', 'examples', 'pass^1', `pass^${K}`, 'calls', 'in/call', 'cached/call', 'out/call', 'ex/turn', 'exB/turn', 'turn p50/p90 ms', 'call p50/p90 ms', 'est.USD', 'valid'];
  const rows = reports.map(r => [String(r.run ?? basename(r.runDir)).slice(0, 26), examplesLabel(r), pct(r.aggregate.pass1), pct(r.aggregate.passK[K] ?? null), String(r.usage.calls),
    String(r.usage.perCall?.input ?? '-'), String(r.usage.perCall?.cached ?? '-'), String(r.usage.perCall?.output ?? '-'), String(r.examples.meanCount ?? '-'), String(r.examples.meanBytes ?? '-'),
    `${r.latencyMs.p50 ?? '-'}/${r.latencyMs.p90 ?? '-'}`, `${r.callLatencyMs?.p50 ?? '-'}/${r.callLatencyMs?.p90 ?? '-'}`, String(r.cost.estimatedActualUsd), r.valid ? 'yes' : 'NO']);
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(row => row[i].length)));
  return [head, ...rows].map(row => row.map((cell, i) => cell.padEnd(width[i])).join('  ')).join('\n');
}
