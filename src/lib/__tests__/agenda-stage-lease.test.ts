import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LEASE_WRITE_GRACE_MS, MIDNIGHT_SLEEP_MAX_MS, MIDNIGHT_WAKE_MS, REAL_RESULTS_ROOT, STAGE_LOCK_WAIT_MS, acquireStageLease, assertSaoPauloClock, assertStageLeaseHeld, buildPasskReport,
  dayWindowPreflight, formatPasskTable, inspectStageLease, lockDiagnosis, midnightGuard, mixedDayAttempt, msUntilSaoPauloMidnight, operatorReleaseStageLease,
  operatorReleaseStageLock, perCallBudgetMs, probeStageLock, reachableDays, readStage, releaseStageLease, renderFinal, reserve, saoPauloClock, scenarioBudgetMs, stageJournalPath,
  stageLeasePath, todayInSaoPaulo, type AgendaScenario, type AgendaStageName, type StageLease,
} from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

// Temp folders only: no real stage journal, program ledger, database or network. Child processes are plain node (lock holders)
// or node + tsx loading the lib (concurrent reservers) on the same temp journal.
const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'agenda-lease-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const STAGE: AgendaStageName = 'reliability-20260927';
const journal = () => stageJournalPath(temp(), STAGE);
const payload = () => JSON.stringify({ model: 'gpt-6-luna', instructions: 'synthetic instructions', input: [{ role: 'user', content: 'synthetic message' }],
  tools: [{ type: 'function', name: 'upsert_action_draft', parameters: { type: 'object' }, strict: true }], tool_choice: { type: 'function', name: 'upsert_action_draft' },
  parallel_tool_calls: false, max_output_tokens: 8192, store: false, stream: false, include: [] });
const lines = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e as Error & { details?: Record<string, unknown> }; } throw Error('expected a refusal'); };
/** A pid that existed and is gone now (an exited child). */
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
const leaseFile = (file: string, lease: Record<string, unknown>) => { mkdirSync(resolve(file, '..'), { recursive: true }); writeFileSync(stageLeasePath(file), JSON.stringify(lease)); };
const forged = (over: Partial<StageLease> = {}): StageLease => ({ v: 1, stage: STAGE, id: '11111111-2222-4333-8444-555555555555', run: 'forged', pid: process.pid, host: hostname(),
  startedAt: new Date().toISOString(), ...over });
/** Holds `<file>.lock` in another process for `ms`, resolving once it is held. */
function holdLock(file: string, ms: number) {
  const child = spawn(process.execPath, ['-e', `const fs=require('fs');const fd=fs.openSync(${JSON.stringify(file + '.lock')},'wx');process.stdout.write('LOCKED');` +
    `setTimeout(()=>{fs.closeSync(fd);fs.unlinkSync(${JSON.stringify(file + '.lock')});},${ms});`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const held = new Promise<void>((done, fail) => { child.stdout.on('data', d => { if (String(d).includes('LOCKED')) done(); }); child.on('error', fail); });
  const exited = new Promise<number | null>(done => child.on('exit', c => done(c)));
  return { held, exited };
}

describe('F1 stage lock: bounded wait instead of a raw EEXIST', () => {
  it('waits out a lock another process holds for 300 ms: exactly one new row and a valid chain', async () => {
    const file = journal(); mkdirSync(resolve(file, '..'), { recursive: true });
    reserve(file, 'seed-run', 'S01#k1', 1, payload(), STAGE);
    const holder = holdLock(file, 300); await holder.held;
    const started = Date.now(), row = reserve(file, 'wait-run', 'S02#k1', 1, payload(), STAGE), waited = Date.now() - started;
    expect(await holder.exited).toBe(0);
    expect(waited).toBeGreaterThanOrEqual(150); expect(waited).toBeLessThan(STAGE_LOCK_WAIT_MS);
    const rows = readStage(file, STAGE);
    expect(rows.map(r => r.run)).toEqual(['seed-run', 'wait-run']); expect(rows[1].id).toBe(row.id); expect(rows[1].previousHash).toBe(rows[0].rowHash);
    expect(existsSync(file + '.lock')).toBe(false);
  }, 30_000);
  it('a lock held past the deadline is AGENDA_STAGE_LOCKED with its holder, and the journal bytes stay identical', () => {
    const file = journal(); mkdirSync(resolve(file, '..'), { recursive: true });
    reserve(file, 'seed-run', 'S01#k1', 1, payload(), STAGE);
    const before = readFileSync(file), gone = deadPid();
    writeFileSync(file + '.lock', JSON.stringify({ pid: gone, host: hostname(), run: 'killed-run', at: new Date().toISOString() }));
    const e = code(() => reserve(file, 'late-run', 'S02#k1', 1, payload(), STAGE, { lockWaitMs: 200 }));
    expect(e.message).toBe('AGENDA_STAGE_LOCKED'); expect(e.message).not.toMatch(/EEXIST/);
    expect(e.details).toMatchObject({ present: true, pid: gone, host: hostname(), run: 'killed-run', alive: false });
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(STAGE_LOCK_WAIT_MS).toBe(5_000);
  });
  it('4 processes x 25 reserve() on one journal: 100 rows, one unforked hash chain, within the cap', async () => {
    const file = journal(); mkdirSync(resolve(file, '..'), { recursive: true });
    const lib = resolve('packages/salon-secretary/evaluation/agenda-practice-lib.ts'), worker = join(resolve(file, '..'), 'worker.cjs');
    const tsx = createRequire(import.meta.url).resolve('tsx/cjs');
    writeFileSync(worker, `require(${JSON.stringify(tsx)});const lib=require(${JSON.stringify(lib)});const body=${JSON.stringify(payload())};` +
      `for(let i=0;i<25;i++)lib.reserve(${JSON.stringify(file)},'proc-'+process.argv[2],'P'+process.argv[2]+'#k1',i+1,body,${JSON.stringify(STAGE)});`);
    const env = { ...process.env }; delete env.VITEST; // a plain launcher (the temp journal is outside the repo anyway)
    const exits = await Promise.all([1, 2, 3, 4].map(n => new Promise<number | null>(done => {
      const child = spawn(process.execPath, [worker, String(n)], { cwd: process.cwd(), env, stdio: ['ignore', 'ignore', 'inherit'] }); child.on('exit', c => done(c));
    })));
    expect(exits).toEqual([0, 0, 0, 0]);
    const rows = readStage(file, STAGE); // throws AGENDA_STAGE_JOURNAL on any fork, gap or foreign row
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map(r => r.previousHash)).size).toBe(100);
    for (const n of [1, 2, 3, 4]) expect(rows.filter(r => r.run === `proc-${n}`).map(r => r.step)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(rows.reduce((s, r) => s + r.reservedMicroUsd, 0)).toBeLessThanOrEqual(15_000_000);
    expect(existsSync(file + '.lock')).toBe(false);
  }, 120_000);
});

describe('F1 per-stage run lease', () => {
  it('acquire; a second runner is AGENDA_STAGE_BUSY; release; acquire again', () => {
    const file = journal(), a = acquireStageLease(file, STAGE, 'run-a');
    expect(JSON.parse(readFileSync(stageLeasePath(file), 'utf8'))).toEqual(a);
    expect(a).toMatchObject({ v: 1, stage: STAGE, run: 'run-a', pid: process.pid, host: hostname() });
    const busy = code(() => acquireStageLease(file, STAGE, 'run-b'));
    expect(busy.message).toBe('AGENDA_STAGE_BUSY'); expect(busy.details).toMatchObject({ state: 'HELD', id: a.id, run: 'run-a', alive: true });
    expect(() => assertStageLeaseHeld(a, file, STAGE)).not.toThrow();
    releaseStageLease(a, file, STAGE); expect(existsSync(stageLeasePath(file))).toBe(false);
    const b = acquireStageLease(file, STAGE, 'run-b');
    // The old holder can neither release nor use the new lease.
    expect(code(() => releaseStageLease(a, file, STAGE)).message).toBe('AGENDA_STAGE_BUSY');
    expect(code(() => assertStageLeaseHeld(a, file, STAGE)).message).toBe('AGENDA_STAGE_BUSY');
    expect(JSON.parse(readFileSync(stageLeasePath(file), 'utf8'))).toEqual(b);
    releaseStageLease(b, file, STAGE);
    expect(inspectStageLease(file, STAGE)).toEqual({ state: 'FREE' });
  });
  it('a lease of a dead process on this host is AGENDA_STAGE_LEASE_STALE, stays fail-closed and needs the operator release', () => {
    const file = journal(), gone = deadPid(), stale = forged({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', run: 'crashed', pid: gone });
    leaseFile(file, stale);
    for (let i = 0; i < 2; i++) { // never taken over, however often it is retried
      const e = code(() => acquireStageLease(file, STAGE, 'next-run'));
      expect(e.message).toBe('AGENDA_STAGE_LEASE_STALE'); expect(e.details).toMatchObject({ state: 'STALE', id: stale.id, pid: gone, alive: false });
    }
    expect(code(() => reserve(file, 'next-run', 'S01#k1', 1, payload(), STAGE)).message).toBe('AGENDA_STAGE_BUSY'); // lease-less while one exists
    expect(lines(file)).toEqual([]);
    expect(code(() => operatorReleaseStageLease(file, STAGE, { id: 'INVALID' })).message).toBe('AGENDA_STAGE_LEASE_ID_MISMATCH');
    expect(operatorReleaseStageLease(file, STAGE, { id: stale.id })).toMatchObject({ released: 'lease', state: 'STALE', pid: gone });
    const next = acquireStageLease(file, STAGE, 'next-run'); releaseStageLease(next, file, STAGE);
  });
  it('a forged lease (live pid with another id, another host, garbage) is refused; the operator must name it and force a possibly-live one', () => {
    const file = journal();
    leaseFile(file, forged()); // this very process's pid, not this run's lease
    expect(code(() => acquireStageLease(file, STAGE, 'run')).message).toBe('AGENDA_STAGE_BUSY');
    expect(code(() => reserve(file, 'run', 'S01#k1', 1, payload(), STAGE, { lease: forged({ id: '99999999-2222-4333-8444-555555555555' }) })).message).toBe('AGENDA_STAGE_BUSY');
    expect(code(() => operatorReleaseStageLease(file, STAGE, { id: forged().id })).message).toBe('AGENDA_STAGE_BUSY'); // alive: only with force
    leaseFile(file, forged({ host: 'another-machine', pid: 4242 }));
    expect(code(() => acquireStageLease(file, STAGE, 'run')).details).toMatchObject({ state: 'HELD', host: 'another-machine', alive: null });
    writeFileSync(stageLeasePath(file), '{"v":1,"stage":'); // being written: young garbage is BUSY
    expect(code(() => acquireStageLease(file, STAGE, 'run')).message).toBe('AGENDA_STAGE_BUSY');
    const old = new Date(Date.now() - LEASE_WRITE_GRACE_MS - 60_000); utimesSync(stageLeasePath(file), old, old); // unreadable for long: STALE
    expect(code(() => acquireStageLease(file, STAGE, 'run')).message).toBe('AGENDA_STAGE_LEASE_STALE');
    expect(operatorReleaseStageLease(file, STAGE, { id: 'INVALID' })).toMatchObject({ released: 'lease', id: null });
    leaseFile(file, forged({ host: 'another-machine', pid: 4242 }));
    expect(operatorReleaseStageLease(file, STAGE, { id: forged().id, force: true })).toMatchObject({ released: 'lease', host: 'another-machine' });
    expect(lines(file)).toEqual([]);
  });
  it('reserve() appends only for the run holding the lease; a lost lease stops it', () => {
    const file = journal(), a = acquireStageLease(file, STAGE, 'run-a'), b = forged({ id: '33333333-2222-4333-8444-555555555555', run: 'run-b' });
    expect(code(() => reserve(file, 'run-b', 'S01#k1', 1, payload(), STAGE, { lease: b })).message).toBe('AGENDA_STAGE_BUSY');
    expect(code(() => reserve(file, 'run-b', 'S01#k1', 1, payload(), STAGE)).message).toBe('AGENDA_STAGE_BUSY');
    expect(lines(file)).toEqual([]);
    const beat = statSync(stageLeasePath(file)).mtimeMs, old = new Date(beat - 120_000); utimesSync(stageLeasePath(file), old, old);
    const row = reserve(file, 'run-a', 'S01#k1', 1, payload(), STAGE, { lease: a });
    expect(readStage(file, STAGE).map(r => r.id)).toEqual([row.id]);
    expect(statSync(stageLeasePath(file)).mtimeMs).toBeGreaterThan(old.getTime() + 60_000); // heartbeat = mtime, content unchanged
    expect(JSON.parse(readFileSync(stageLeasePath(file), 'utf8'))).toEqual(a);
    releaseStageLease(a, file, STAGE);
    expect(code(() => reserve(file, 'run-a', 'S01#k1', 2, payload(), STAGE, { lease: a })).message).toBe('AGENDA_STAGE_LEASE_LOST');
    expect(readStage(file, STAGE)).toHaveLength(1);
  });
  it('the preflight lock probe reports a lock left by a killed process; the operator releases it only when its holder is gone', () => {
    const file = journal(); mkdirSync(resolve(file, '..'), { recursive: true });
    writeFileSync(file + '.lock', JSON.stringify({ pid: deadPid(), host: hostname(), run: 'killed', at: new Date().toISOString() }));
    const e = code(() => probeStageLock(file, STAGE, 150));
    expect(e.message).toBe('AGENDA_STAGE_LOCKED'); expect(e.details).toMatchObject({ present: true, alive: false, run: 'killed' });
    expect(operatorReleaseStageLock(file, STAGE)).toMatchObject({ released: 'lock', alive: false });
    expect(() => probeStageLock(file, STAGE, 150)).not.toThrow(); expect(existsSync(file + '.lock')).toBe(false);
    writeFileSync(file + '.lock', JSON.stringify({ pid: process.pid, host: hostname(), run: 'live', at: new Date().toISOString() }));
    expect(code(() => operatorReleaseStageLock(file, STAGE)).message).toBe('AGENDA_STAGE_LOCKED');
    expect(lockDiagnosis(file + '.lock')).toMatchObject({ alive: true });
    expect(operatorReleaseStageLock(file, STAGE, { force: true })).toMatchObject({ released: 'lock' });
  });
  it('a unit test never locks, leases or appends to a real journal of the checkout', () => {
    const real = stageJournalPath(join(process.cwd(), REAL_RESULTS_ROOT, 'agenda-core'), STAGE), before = existsSync(real) ? readFileSync(real) : null;
    expect(code(() => acquireStageLease(real, STAGE, 'unit')).message).toBe('AGENDA_STAGE_TEST_JOURNAL');
    expect(code(() => reserve(real, 'unit', 'S01#k1', 1, payload(), STAGE)).message).toBe('AGENDA_STAGE_TEST_JOURNAL');
    expect(code(() => probeStageLock(real, STAGE, 10)).message).toBe('AGENDA_STAGE_TEST_JOURNAL');
    expect(existsSync(real) ? readFileSync(real) : null).toEqual(before);
    expect(existsSync(stageLeasePath(real))).toBe(false);
  });
  it('the operator command releases a stale lease by id and prints codes only', () => {
    const cwd = temp(), file = stageJournalPath(join(cwd, 'packages/salon-secretary/evaluation/results/agenda-core'), STAGE), gone = deadPid();
    leaseFile(file, forged({ id: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', run: 'crashed', pid: gone }));
    const env = { ...process.env }; delete env.VITEST;
    const cli = (...args: string[]) => spawnSync(process.execPath, [resolve('scripts/agenda-stage-release.cjs'), '--stage', STAGE, ...args], { cwd, env, encoding: 'utf8' });
    const status = cli('--status');
    expect(status.status).toBe(0); expect(JSON.parse(status.stdout)).toMatchObject({ status: 'STATUS', lease: { state: 'STALE', lease: { pid: gone } }, lock: { present: false } });
    const wrong = cli('--lease', 'INVALID');
    expect(wrong.status).toBe(1); expect(JSON.parse(wrong.stderr)).toMatchObject({ status: 'BLOCKED', code: 'AGENDA_STAGE_LEASE_ID_MISMATCH' });
    const ok = cli('--lease', 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(ok.status).toBe(0); expect(JSON.parse(ok.stdout)).toMatchObject({ status: 'RELEASED', released: 'lease' });
    expect(existsSync(stageLeasePath(file))).toBe(false);
  }, 60_000);
});

describe('F2 São Paulo clock (Intl only)', () => {
  it('midnight arithmetic around 02:59:59Z / 03:00:00Z and the year turn; the ICU self-test passes', () => {
    expect(() => assertSaoPauloClock()).not.toThrow();
    expect(msUntilSaoPauloMidnight(new Date('2026-09-29T02:59:59.000Z'))).toBe(1_000);
    expect(msUntilSaoPauloMidnight(new Date('2026-09-29T03:00:00.000Z'))).toBe(86_400_000);
    expect(msUntilSaoPauloMidnight(new Date('2026-09-29T02:30:00.000Z'))).toBe(30 * 60_000);
    expect(msUntilSaoPauloMidnight(new Date('2027-01-01T02:59:59.250Z'))).toBe(750);
    expect([todayInSaoPaulo(new Date('2027-01-01T02:59:59.999Z')), todayInSaoPaulo(new Date('2027-01-01T03:00:00.000Z'))]).toEqual(['2026-12-31', '2027-01-01']);
    expect(reachableDays(new Date('2027-01-01T02:00:00Z'), 2 * 3_600_000)).toEqual(['2026-12-31', '2027-01-01']);
    expect(saoPauloClock(new Date('2026-09-29T02:30:00.000Z'), 45 * 60_000)).toEqual({ saoPauloNow: '2026-09-28 23:30:00', minutesUntilMidnight: 30, estimatedRunMinutes: 45,
      spansMidnight: true, rolloverPolicy: 'ANCHOR_PER_ATTEMPT_ONE_RERUN', source: 'Intl' });
  });
  it('gives the same day and clock whatever the process TZ (UTC, America/Sao_Paulo, a garbage zone)', () => {
    const instants = ['2026-09-29T02:59:59.000Z', '2026-09-29T03:00:00.000Z', '2027-01-01T02:59:59.000Z', '2027-01-01T03:00:01.000Z', '2028-02-29T12:00:00.000Z'];
    const env = { ...process.env }; delete env.VITEST;
    const script = `import(${JSON.stringify(pathToFileURL(resolve('packages/salon-secretary/evaluation/agenda-practice-lib.ts')).href)}).then(m=>process.stdout.write(JSON.stringify(` +
      `${JSON.stringify(instants)}.map(i=>[m.todayInSaoPaulo(new Date(i)),m.msUntilSaoPauloMidnight(new Date(i))]))))`;
    const outputs = ['UTC', 'America/Sao_Paulo', 'Garbage/Nowhere'].map(TZ => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { env: { ...env, TZ }, encoding: 'utf8' });
      expect(r.status).toBe(0); return JSON.parse(r.stdout) as [string, number][];
    });
    expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0]);
    expect(outputs[0].map(x => x[0])).toEqual(['2026-09-28', '2026-09-29', '2026-12-31', '2027-01-01', '2028-02-29']);
  }, 60_000);
  it('the midnight guard is clock-only: RUN when the attempt fits, SLEEP to 00:00:30 otherwise, never a sleep over 30 minutes', () => {
    const s: AgendaScenario = { id: 'G1', title: 'guard', capability: ['x'], steps: [{ say: 'a' }, { say: 'b' }], answers: { time: '10h' } }; // 5 expected calls
    expect(scenarioBudgetMs(s)).toBe(5 * 90_000 + 60_000);
    expect(midnightGuard(new Date('2026-09-29T02:00:00Z'), scenarioBudgetMs(s))).toEqual({ action: 'RUN', remainingMs: 3_600_000, budgetMs: 510_000, sleepMs: 0 });
    expect(midnightGuard(new Date('2026-09-29T02:55:00Z'), scenarioBudgetMs(s))).toEqual({ action: 'SLEEP', remainingMs: 300_000, budgetMs: 510_000, sleepMs: 300_000 + MIDNIGHT_WAKE_MS });
    const huge = 40 * 60_000; // a broken estimate: sleeping 35.5 min is refused, the attempt runs (a rollover then costs its one rerun)
    expect(midnightGuard(new Date('2026-09-29T02:25:00Z'), huge)).toMatchObject({ action: 'RUN_UNGUARDED', sleepMs: 0, code: 'AGENDA_MIDNIGHT_SLEEP_LIMIT' });
    expect(midnightGuard(new Date('2026-09-29T02:31:00Z'), huge)).toMatchObject({ action: 'SLEEP', sleepMs: 29 * 60_000 + MIDNIGHT_WAKE_MS });
    expect(29 * 60_000 + MIDNIGHT_WAKE_MS).toBeLessThanOrEqual(MIDNIGHT_SLEEP_MAX_MS);
    expect(perCallBudgetMs(Array(19).fill(4_000))).toBe(90_000); // fewer than 20 measured calls: the default
    expect(perCallBudgetMs([...Array(19).fill(4_000), 10_000])).toBe(15_000); // p99 x 1.5
  });
  it('the reachable-day window: a run that may cross midnight covers d+1, and a scenario SKIP there is a rollover skip', () => {
    // Friday 23:45 in São Paulo (estimate + one guard sleep reaches Saturday): "+1" is Saturday (open) today, Sunday (closed) when anchored on Saturday.
    const s: AgendaScenario = { id: 'W1', title: 'window', capability: ['create'], customers: [{ key: 'yasmin', name: 'Yasmin Okabe' }],
      professionals: [{ key: 'teo', name: 'Téo Barros' }], appointments: [{ key: 'a1', customer: 'yasmin', professional: 'teo', service: 'corte', day: 1, time: '10:00' }], steps: [{ say: 'oi' }] };
    const late = dayWindowPreflight([s], new Date('2026-10-03T02:45:00Z'), 60_000, () => undefined);
    expect(late.days).toEqual(['2026-10-02', '2026-10-03']); expect(late.spansMidnight).toBe(true);
    expect(late.rolloverSkips).toEqual([{ id: 'W1', day: '2026-10-03', dates: ['2026-10-04'] }]);
    const morning = dayWindowPreflight([s], new Date('2026-10-02T13:00:00Z'), 60_000, () => undefined);
    expect(morning).toMatchObject({ days: ['2026-10-02'], spansMidnight: false, rolloverSkips: [] });
  });
});

describe('F2 grader: per-attempt day, reruns, discarded attempts, mixed-day headers', () => {
  const scenario: AgendaScenario = { id: 'M1', title: 'mixed', capability: ['create'], steps: [{ say: 'Marca a Hiroshi amanhã às 10h' }],
    customers: [{ key: 'hiroshi', name: 'Hiroshi Tanaka' }], final: { unchanged: true } };
  function runDir(files: Record<string, unknown>) {
    const dir = temp(); mkdirSync(join(dir, 'k1'));
    writeFileSync(join(dir, 'report.json'), JSON.stringify({ run: 'unit', status: 'COMPLETE', repeat: 1, ids: ['M1'], scenarios: 1, skipped: [] }));
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, 'k1', name), JSON.stringify(value));
    return dir;
  }
  const attempt = (today: string, extra: Record<string, unknown> = {}) => ({ scenario, today, attempt: 1, complete: true, initial: { appointments: [], blocks: [] },
    transcript: [{ step: 1, action: 'say', db: { appointments: [], blocks: [] } }], dayAnchor: { today, at: `${today}T12:00:00.000Z` }, oracle: renderFinal(scenario.final!, today), ...extra });
  it('grades an anchored attempt normally and turns a mixed-day header into a grader error (never PASS, run not valid)', () => {
    const ok = buildPasskReport(runDir({ 'M1.json': attempt('2026-09-30') }));
    expect(ok).toMatchObject({ valid: true, graderErrors: [], byDay: { '2026-09-30': { attempts: 1, passed: 1 } } }); expect(ok.scenarios[0].c).toBe(1);
    const header = buildPasskReport(runDir({ 'M1.json': { ...attempt('2026-09-30'), dayAnchor: { today: '2026-10-01', at: 'x' } } }));
    expect(header).toMatchObject({ valid: false, graderErrors: [{ id: 'M1', k: 1, code: 'GRADER_MIXED_DAY' }], invalid: [{ id: 'M1', k: 1 }] }); expect(header.scenarios[0].c).toBe(0);
    const withRead: AgendaScenario = { ...scenario, final: { appointments: [{ customer: 'Hiroshi Tanaka', service: 'Corte Completo', day: 1, time: '10:00' }] } };
    expect(mixedDayAttempt({ scenario: withRead, today: '2026-09-30', dayAnchor: { today: '2026-09-30' }, oracle: renderFinal(withRead.final!, '2026-10-01') }, '2026-09-30'))
      .toBe('GRADER_MIXED_DAY oracle');
    expect(formatPasskTable(header)).toMatch(/^GRADER_ERRORS M1#k1:GRADER_MIXED_DAY$/m);
    // Files recorded before F2 have no anchor: graded exactly as before.
    const legacy = attempt('2026-09-30') as Record<string, unknown>; delete legacy.dayAnchor; delete legacy.oracle;
    expect(buildPasskReport(runDir({ 'M1.json': legacy }))).toMatchObject({ valid: true, graderErrors: [] });
  });
  it('a rollover rerun is graded in place of its discarded attempt, which is listed and never graded', () => {
    const r = buildPasskReport(runDir({ 'M1.rollover.json': { ...attempt('2026-09-30'), complete: false, discarded: true },
      'M1.json': attempt('2026-10-01', { rerunOf: 'M1.rollover.json', rerunCause: 'DAY_ROLLOVER' }) }));
    expect(r).toMatchObject({ valid: true, coverage: { graded: 1, expected: 1, incomplete: 0 }, reruns: [{ id: 'M1', k: 1, cause: 'DAY_ROLLOVER' }],
      discarded: [{ id: 'M1', k: 1, cause: 'DAY_ROLLOVER' }], today: ['2026-10-01'] });
    expect(formatPasskTable(r)).toMatch(/^RERUNS M1#k1:DAY_ROLLOVER DISCARDED M1#k1$/m);
    expect(r.scenarios[0].attempts).toEqual([{ k: 1, ok: true, why: [], safety: [] }]);
  });
});
