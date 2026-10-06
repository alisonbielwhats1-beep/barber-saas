import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only: database, secretary, stage journal and program ledger are replaced; no request reaches the network. The clock is
// injected: every send() moves it forward by `stepMs`, so midnight is crossed where each test says.
const guards = vi.hoisted(() => ({ dir: '', t: 0, stepMs: 0, sleeps: [] as number[], seeds: [] as { namespace: string; caseId: string; starts: string[] }[], sends: 0 }));
vi.mock('@prisma/client', async original => ({ ...await original<object>(), PrismaClient: class {
  constructor() {
    const table = { findMany: async () => [], findFirst: async () => null };
    return new Proxy(this, { get: (_target, prop) => prop === '$disconnect' ? async () => {} : prop === 'then' || typeof prop === 'symbol' ? undefined : table });
  }
} }));
vi.mock('../prisma', () => ({ prisma: { $disconnect: async () => {} } }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-database', () => ({ assertFreeUseDatabase: async () => ({ database: 'synthetic-disposable' }) }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-fixture', async original => ({ ...await original<object>(),
  seedFreeUseFixture: async (_admin: unknown, namespace: string, caseId: string, fixture: { appointments: { startAt: string }[] }) => {
    guards.seeds.push({ namespace, caseId, starts: fixture.appointments.map(a => a.startAt) });
    return { tenant: `tenant-${namespace}-${caseId}`, actor: 'actor-synthetic', bindings: {} };
  } }));
vi.mock('../../../packages/salon-secretary/evaluation/agenda-practice-lib', async original => {
  const actual = await original<typeof import('../../../packages/salon-secretary/evaluation/agenda-practice-lib')>();
  return { ...actual, stageJournalPath: (_root: string, stage: string) => { if (!guards.dir) throw Error('TEST_DIR_UNSET'); return join(guards.dir, actual.agendaStage(stage).journal); } };
});
vi.mock('../../../packages/salon-secretary/evaluation/program-spend', async original => {
  const actual = await original<typeof import('../../../packages/salon-secretary/evaluation/program-spend')>();
  return { ...actual, programSpendLedgerPath: () => { if (!guards.dir) throw Error('TEST_DIR_UNSET'); return join(guards.dir, actual.PROGRAM_SPEND_BASENAME); } };
});
vi.mock('../salon-secretary', () => ({ SalonSecretary: class {
  async start() { return { sessionId: 'session', message: 'Olá!', capability_status: 'CONVERSATION', operations: [] }; }
  async send() { guards.sends++; guards.t += guards.stepMs; return { sessionId: 'session', message: 'Certo.', capability_status: 'CONVERSATION', operations: [] }; }
} }));
import { preflightAgendaPractice, runAgendaPractice, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { acquireStageLease, buildPasskReport, digest, releaseStageLease, stageLeasePath, type AgendaClock } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

const STAGE = 'reliability-20260927';
/** 23:50 in São Paulo on Wednesday 2026-09-30 (02:50Z on Thursday). */
const T0 = Date.parse('2026-10-01T02:50:00.000Z'), D = '2026-09-30', D1 = '2026-10-01';
const clock: AgendaClock = { now: () => new Date(guards.t), sleep: async ms => { guards.sleeps.push(ms); guards.t += ms; } };
/** Diverse synthetic tenant; "+1" renders from the attempt's own day. */
const base = (id: string, says: number, final?: AgendaScenario['final']): AgendaScenario => ({ id, title: `synthetic ${id}`, capability: ['create'], noise: false,
  customers: [{ key: 'yasmin', name: 'Yasmin Okabe' }], professionals: [{ key: 'teo', name: 'Téo Barros' }],
  appointments: [{ key: 'a1', customer: 'yasmin', professional: 'teo', service: 'corte', day: 1, time: '10:00' }],
  steps: Array.from({ length: says }, (_, i) => ({ say: `Mensagem sintética ${i + 1}` })), ...(final ? { final } : {}) });
const file = (out: string, k: number, name: string) => JSON.parse(readFileSync(join(out, `k${k}`, name), 'utf8'));
function setup(start = T0, stepMs = 0) {
  guards.dir = mkdtempSync(join(tmpdir(), 'agenda-day-anchor-')); guards.t = start; guards.stepMs = stepMs; guards.sleeps = []; guards.seeds = []; guards.sends = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('NETWORK_FORBIDDEN'); }));
  return { out: join(guards.dir, 'run-unit'), stageFile: join(guards.dir, 'reliability-stage-budget.jsonl') };
}
afterEach(() => { vi.unstubAllGlobals(); if (guards.dir) rmSync(guards.dir, { recursive: true, force: true }); guards.dir = ''; });

describe('F2 runner: per-attempt day anchor and clock-only midnight guard (offline)', () => {
  it('the guard sleeps until 00:00:30 when the next attempt does not fit, and that attempt is anchored on the new day (fixture, oracle, header)', async () => {
    // S1 (4 min budget) fits at 23:50 and ends at 23:57; S2 no longer fits: sleep, then run on 01/10.
    const { out } = setup(T0, 7 * 60_000);
    const report = await runAgendaPractice([base('S1', 1, { unchanged: true }), base('S2', 1, { unchanged: true })], out, { stage: STAGE, clock });
    expect(guards.sleeps).toEqual([3 * 60_000 + 30_000]);
    expect(report).toMatchObject({ status: 'COMPLETE', today: D, days: [D, D1], attemptDays: { 'S1#k1': D, 'S2#k1': D1 }, reruns: [],
      midnightGuard: { sleeps: 1, sleptMs: 210_000, unguarded: 0 } });
    const [s1, s2] = [file(out, 1, 'S1.json'), file(out, 1, 'S2.json')];
    expect([s1.today, s1.dayAnchor.today, s2.today, s2.dayAnchor.today]).toEqual([D, D, D1, D1]);
    expect(guards.seeds.map(s => [s.caseId, s.starts])).toEqual([['S1', ['2026-10-01T13:00:00.000Z']], ['S2', ['2026-10-02T13:00:00.000Z']]]); // "+1" from each anchor
    const passk = buildPasskReport(out);
    expect(passk).toMatchObject({ valid: true, today: [D, D1], graderErrors: [], byDay: { [D]: { attempts: 1 }, [D1]: { attempts: 1 } } });
  }, 60_000);
  it('a rollover inside an attempt discards it (even a PASS) and reruns it once, in a fresh seed namespace, on the new day', async () => {
    // Two says of 6 min each from 23:50 (7 min budget fits): the second ends at 00:02, the attempt had already done everything.
    const { out } = setup(T0, 6 * 60_000);
    const report = await runAgendaPractice([base('R1', 2, { unchanged: true })], out, { stage: STAGE, clock });
    expect(report).toMatchObject({ status: 'COMPLETE', days: [D, D1], reruns: [{ id: 'R1', k: 1, from: D, to: D1, discarded: 'R1.rollover.json' }], scenarioAttempts: 1 });
    const discarded = file(out, 1, 'R1.rollover.json'), rerun = file(out, 1, 'R1.json');
    expect(discarded).toMatchObject({ complete: false, discarded: true, discardCause: 'DAY_ROLLOVER', today: D });
    expect(discarded.transcript).toHaveLength(2); // both steps had run: the trigger is the clock, never the outcome
    expect(rerun).toMatchObject({ complete: true, today: D1, dayAnchor: { today: D1 }, rerunOf: 'R1.rollover.json', rerunCause: 'DAY_ROLLOVER' });
    expect(rerun.seedNamespace).toMatch(/-k1-r1$/);
    expect(guards.seeds.map(s => s.namespace.replace(/^.*(-k1(?:-r1)?)$/, '$1'))).toEqual(['-k1', '-k1-r1']);
    const passk = buildPasskReport(out);
    expect(passk).toMatchObject({ valid: true, coverage: { graded: 1, expected: 1 }, reruns: [{ id: 'R1', k: 1, cause: 'DAY_ROLLOVER' }], discarded: [{ id: 'R1', k: 1 }], today: [D1] });
    expect(passk.scenarios[0]).toMatchObject({ c: 1, n: 1 });
  }, 60_000);
  it('a FAIL outcome without a rollover is never rerun', async () => {
    const { out } = setup(Date.parse('2026-09-30T15:00:00.000Z'), 60_000); // noon: no midnight near
    const failing = base('F1', 1, { appointments: [{ customer: 'Yasmin Okabe', service: 'Corte Completo', day: 2, time: '11:00' }] });
    const report = await runAgendaPractice([failing], out, { stage: STAGE, clock });
    expect(report).toMatchObject({ status: 'COMPLETE', reruns: [], days: [D], midnightGuard: { sleeps: 0 } });
    expect(readdirSync(join(out, 'k1')).filter(f => f.includes('rollover'))).toEqual([]);
    expect(buildPasskReport(out).scenarios[0]).toMatchObject({ c: 0, n: 1 });
  }, 60_000);
  it('a second rollover in the same scenario stops the run (at most one rerun) and nothing of it is graded', async () => {
    const { out } = setup(T0, 13 * 3_600_000); // each send crosses a São Paulo midnight
    await expect(runAgendaPractice([base('X1', 1), base('X2', 1)], out, { stage: STAGE, clock })).rejects.toThrow('AGENDA_DAY_ROLLOVER');
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    expect(report).toMatchObject({ status: 'ABORTED', abort: 'AGENDA_DAY_ROLLOVER', incomplete: 'X1#k1', notExecuted: ['X2#k1'], scenarioAttempts: 0 });
    expect(readdirSync(join(out, 'k1')).sort()).toEqual(['X1.json', 'X1.rollover-2.json', 'X1.rollover.json']);
    expect(file(out, 1, 'X1.json')).toMatchObject({ complete: false, abort: 'AGENDA_DAY_ROLLOVER', transcript: [] });
    expect(buildPasskReport(out)).toMatchObject({ valid: false, discarded: [{ id: 'X1', k: 1 }, { id: 'X1', k: 1 }], incomplete: [{ id: 'X1', k: 1, abort: 'AGENDA_DAY_ROLLOVER' }] });
    expect(existsSync(stageLeasePath(join(guards.dir, 'reliability-stage-budget.jsonl')))).toBe(false); // released on abort too
  }, 60_000);
  it('a guard sleep over 30 minutes is refused: the attempt runs unguarded and the report says so', async () => {
    const { out } = setup(Date.parse('2026-10-01T02:25:00.000Z')); // 23:25, 35 min left
    const long = base('L1', 12); // 24 expected calls: 37 min budget; sleeping would take 35.5 min
    const report = await runAgendaPractice([long], out, { stage: STAGE, clock });
    expect(guards.sleeps).toEqual([]);
    expect(report).toMatchObject({ status: 'COMPLETE', days: [D], midnightGuard: { sleeps: 0, unguarded: 1, events: [{ label: 'L1#k1', action: 'RUN_UNGUARDED', code: 'AGENDA_MIDNIGHT_SLEEP_LIMIT' }] } });
  }, 60_000);
  it('a closed day the run can reach after midnight: refused up front with --closed-day fail, an unexecuted (never graded) attempt with skip', async () => {
    // Friday 23:50: "+1" is Saturday (open) today but Sunday (closed) for an attempt anchored on Saturday.
    const FRI = Date.parse('2026-10-03T02:50:00.000Z');
    let { out } = setup(FRI, 7 * 60_000);
    await expect(runAgendaPractice([base('C0', 1), base('C1', 1)], out, { stage: STAGE, clock, closedDay: 'fail' })).rejects.toThrow('AGENDA_CLOSED_DAY');
    expect(guards.seeds).toEqual([]); expect(existsSync(out)).toBe(false);
    ({ out } = setup(FRI, 7 * 60_000));
    const report = await runAgendaPractice([base('C0', 1), base('C1', 1)], out, { stage: STAGE, clock, closedDay: 'skip' });
    expect(report).toMatchObject({ status: 'COMPLETE', days: ['2026-10-02', '2026-10-03'], closedDayAttempts: [{ id: 'C1', k: 1, day: '2026-10-03' }], notExecuted: ['C1#k1'] });
    expect(guards.seeds.map(s => s.caseId)).toEqual(['C0']);
    expect(file(out, 1, 'C1.json')).toMatchObject({ complete: false, abort: 'AGENDA_CLOSED_DAY', today: '2026-10-03' });
    expect(buildPasskReport(out)).toMatchObject({ valid: false, incomplete: [{ id: 'C1', k: 1, abort: 'AGENDA_CLOSED_DAY' }] });
  }, 60_000);
});

describe('F1 runner: one runner per stage (offline)', () => {
  it('a stage leased by another run is AGENDA_STAGE_BUSY before any file, database access or network', async () => {
    const { out, stageFile } = setup(Date.parse('2026-09-30T15:00:00.000Z'));
    const other = acquireStageLease(stageFile, STAGE, 'other-run');
    await expect(runAgendaPractice([base('B1', 1)], out, { stage: STAGE, clock })).rejects.toThrow('AGENDA_STAGE_BUSY');
    expect(guards.seeds).toEqual([]); expect(guards.sends).toBe(0); expect(existsSync(out)).toBe(false);
    expect(JSON.parse(readFileSync(stageLeasePath(stageFile), 'utf8'))).toEqual(other); // never taken over
    releaseStageLease(other, stageFile, STAGE);
    const report = await runAgendaPractice([base('B1', 1)], out, { stage: STAGE, clock });
    expect(report).toMatchObject({ status: 'COMPLETE', lease: { own: true, released: true } });
    expect(existsSync(stageLeasePath(stageFile))).toBe(false);
  }, 60_000);
  it('headroom is re-checked under the lease: a stage that filled up after the preflight is refused before any database access', async () => {
    const { out, stageFile } = setup(Date.parse('2026-09-30T15:00:00.000Z'));
    const scenarios = [base('F9', 1)], pre = preflightAgendaPractice(scenarios, { stage: STAGE, clock });
    const body = { stage: STAGE, id: '00000000-0000-4000-8000-000000000000', run: 'other', scenario: 'X', step: 1, bodyBytes: 1, maxOutputTokens: 1, reservedMicroUsd: 14_999_000, previousHash: 'GENESIS' };
    writeFileSync(stageFile, JSON.stringify({ ...body, rowHash: digest(JSON.stringify(body)) }) + '\n'); // another run spent the stage meanwhile
    await expect(runAgendaPractice(scenarios, out, { stage: STAGE, clock, preflight: pre })).rejects.toThrow('AGENDA_STAGE_HEADROOM');
    expect(guards.seeds).toEqual([]); expect(existsSync(out)).toBe(false); expect(existsSync(stageLeasePath(stageFile))).toBe(false);
  }, 60_000);
  it('a handed-in lease (sealed flow) must be the one on disk, and the runner neither takes nor releases it', async () => {
    const { out, stageFile } = setup(Date.parse('2026-09-30T15:00:00.000Z'));
    const held = acquireStageLease(stageFile, STAGE, 'sealed-run');
    const report = await runAgendaPractice([base('H1', 1)], out, { stage: STAGE, clock, lease: held });
    expect(report).toMatchObject({ status: 'COMPLETE', lease: { id: held.id, own: false, released: null } });
    expect(JSON.parse(readFileSync(stageLeasePath(stageFile), 'utf8'))).toEqual(held);
    const forged = { ...held, id: '12345678-2222-4333-8444-555555555555' };
    await expect(runAgendaPractice([base('H1', 1)], join(guards.dir, 'run-2'), { stage: STAGE, clock, lease: forged })).rejects.toThrow('AGENDA_STAGE_BUSY');
    expect(existsSync(join(guards.dir, 'run-2'))).toBe(false);
    releaseStageLease(held, stageFile, STAGE);
  }, 60_000);
});
