import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only: every database, provider and journal path is replaced; the real Golden is never prepared or run.
const guards = vi.hoisted(() => ({
  journalDir: '', prismaConstructed: 0, backups: 0, seeds: [] as { namespace: string; caseId: string }[], sends: [] as string[],
  outcomes: new Map<string, 'pass' | 'fail' | 'safety' | 'double'>(), prismaUse: 0,
  payload: () => ({ model: 'gpt-6-luna', instructions: 'synthetic instructions', input: [{ role: 'user', content: 'synthetic message' }],
    tools: [{ type: 'function', name: 'upsert_action_draft', parameters: { type: 'object' } }], tool_choice: { type: 'function', name: 'upsert_action_draft' },
    parallel_tool_calls: false, max_output_tokens: 1200, store: false, stream: false, include: [] }),
}));
vi.mock('@prisma/client', async original => ({ ...await original<object>(), PrismaClient: class {
  constructor() { guards.prismaConstructed++; } async $disconnect() {}
} }));
vi.mock('../prisma', () => ({ prisma: { $use: () => { guards.prismaUse++; }, $disconnect: async () => {} } }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-database', () => ({ assertFreeUseDatabase: async () => ({ database: 'synthetic-disposable' }) }));
vi.mock('../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-db', () => ({
  backupPhaseALocalDatabase: () => { guards.backups++; return { file: 'synthetic-backup-not-created' }; },
  snapshotPhaseACase: async () => ({ hashes: { appointments: 'synthetic' }, technical_audit_hash: 'synthetic' }),
  comparePhaseAJournal: () => ({ counters: { confirmations: 0, outbox_creations: 0 }, changed_tables: [] }),
}));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-fixture', async original => ({ ...await original<object>(),
  seedFreeUseFixture: async (_admin: unknown, namespace: string, caseId: string) => { guards.seeds.push({ namespace, caseId }); },
  verifyFreeUseFixture: async () => ({ synthetic: true }) }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-budget', async original => {
  const actual = await original<typeof import('../../../packages/salon-secretary/evaluation/free-use-budget')>();
  // Same fixed basename per mission, redirected to a temporary directory: tests never touch a real mission journal.
  return { ...actual, freeUseMissionJournal: (id: string) => {
    if (!guards.journalDir) throw Error('TEST_JOURNAL_UNSET');
    return join(guards.journalDir, actual.freeUseMission(id).journal.split('/').pop()!);
  } };
});
vi.mock('../../../packages/salon-secretary/evaluation/program-spend', async original => {
  const actual = await original<typeof import('../../../packages/salon-secretary/evaluation/program-spend')>();
  // Same fixed basename, redirected to the temporary directory: runner tests never charge the real program ledger.
  return { ...actual, programSpendLedgerPath: () => {
    if (!guards.journalDir) throw Error('TEST_JOURNAL_UNSET');
    return join(guards.journalDir, actual.PROGRAM_SPEND_BASENAME);
  } };
});
vi.mock('../salon-secretary', () => ({ SalonSecretary: class {
  async start(actor: { salonId: string }) { return { sessionId: 'session-' + actor.salonId }; }
  async send(actor: { salonId: string }) {
    guards.sends.push(actor.salonId);
    const response = await globalThis.fetch('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify(guards.payload()) });
    await response.text();
    const outcome = guards.outcomes.get(actor.salonId) ?? 'pass';
    // A second provider call inside the same attempt share (e.g. a repair) must be admitted separately.
    if (outcome === 'double') await globalThis.fetch('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify(guards.payload()) });
    if (outcome === 'pass') return { sessionId: 'session', message: 'Olá!', capability_status: 'CONVERSATION', action_plan: null, operations: [] };
    if (outcome === 'fail') return { sessionId: 'session', message: 'Não consigo.', capability_status: 'UNSUPPORTED', action_plan: null, operations: [] };
    // A confirmable mutation during casual conversation is a scorer SAFETY failure.
    return { sessionId: 'session', message: 'Confira', capability_status: 'CONVERSATION',
      action_plan: { plan_ref: 'plan', revision: 1, actions: [{ key: 'a', operation: 'service.create', mutation: true, status: 'READY_FOR_CONFIRMATION',
        fields: { name: 'Brilho', priceCents: 6400, durationMin: 40 }, missing_fields: [], assessment: { proposal_token: 'proposal' } }], confirmation_groups: [{ status: 'READY_FOR_CONFIRMATION' }] },
      operations: [{ operation_ref: 'child', action_keys: ['a'], state: { proposal: { proposal_ref: 'proposal', fields: { name: 'Brilho' } } } }] };
  }
} }));
import {
  FreeUseBudget, FREE_USE_DEFAULT_MISSION, FREE_USE_MISSION, FREE_USE_MISSION_CAP_MICRO_USD, FREE_USE_MISSIONS, FREE_USE_PRICING_SHA256,
  FREE_USE_RELIABILITY_MISSION, FREE_USE_RELIABILITY_MISSION_CAP_MICRO_USD, digest, freeUseBindingMaxRequests, freeUseMission, freeUseMissionReservedMicroUsd, selectFreeUseMission,
} from '../../../packages/salon-secretary/evaluation/free-use-budget';
import { FREE_USE_ATTEMPT_MAX_REQUESTS, FREE_USE_MAX_REPEAT, aggregatePassK, attemptNamespace, binomial, freeUseRepeat, freeUseRequestLimit } from '../../../packages/salon-secretary/evaluation/free-use-repeat';
import { assertFreeUseFlags, freeUseFlags, parseFreeUseArgs } from '../../../packages/salon-secretary/evaluation/free-use-options';
import { prepareFreeUse, runFreeUse } from '../../../packages/salon-secretary/evaluation/free-use-runner';
import { goldenSuite } from '../../../packages/salon-secretary/evaluation/free-use-golden';
import { PROGRAM_REAL_CAP_MICRO_USD, PROGRAM_SPEND_BASENAME, guardPaidFetch, programSpendTotals } from '../../../packages/salon-secretary/evaluation/program-spend';

const url = 'https://api.openai.com/v1/responses';
const wire = (extra: object = {}) => ({ method: 'POST', body: JSON.stringify({ ...guards.payload(), ...extra }) });
const legacyJournal = resolve('packages/salon-secretary/evaluation/results/free-use/mission-20260926-admission.jsonl');
const reliabilityJournal = resolve('packages/salon-secretary/evaluation/results/free-use/mission-20260927-reliability-admission.jsonl');
const directories: string[] = [];
const temp = () => { const directory = mkdtempSync(join(tmpdir(), 'free-use-mission-')); directories.push(directory); return directory; };
const rows = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const fileState = (file: string) => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'ABSENT';
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  guards.journalDir = ''; guards.seeds.length = 0; guards.sends.length = 0; guards.outcomes.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('free-use mission allowlist', () => {
  it('defaults to the new reliability mission and accepts only allowlisted ids from CLI or env', () => {
    vi.stubEnv('FREE_USE_MISSION_ID', '');
    expect(FREE_USE_DEFAULT_MISSION).toBe('secretary-reliability-20260927');
    expect(selectFreeUseMission().id).toBe(FREE_USE_RELIABILITY_MISSION);
    expect(selectFreeUseMission(undefined, FREE_USE_MISSION).id).toBe(FREE_USE_MISSION);
    expect(selectFreeUseMission(FREE_USE_MISSION, undefined).id).toBe(FREE_USE_MISSION);
    expect(selectFreeUseMission(FREE_USE_MISSION, FREE_USE_MISSION).id).toBe(FREE_USE_MISSION);
    vi.stubEnv('FREE_USE_MISSION_ID', FREE_USE_MISSION); expect(selectFreeUseMission().id).toBe(FREE_USE_MISSION);
    expect(() => selectFreeUseMission(FREE_USE_RELIABILITY_MISSION)).toThrow('FREE_USE_MISSION_CONFLICT');
    for (const id of ['secretary-reliability-20260928', '../mission.jsonl', 'C:/tmp/mission.jsonl', FREE_USE_MISSIONS[FREE_USE_MISSION].journal,
      'toString', '__proto__', 'constructor', 'hasOwnProperty', '', ' secretary-reliability-20260927'])
      expect(() => freeUseMission(id)).toThrow('FREE_USE_MISSION_UNKNOWN');
    expect(() => freeUseMission(undefined)).toThrow('FREE_USE_MISSION_UNKNOWN');
    expect(Object.keys(FREE_USE_MISSIONS)).toEqual([FREE_USE_MISSION, FREE_USE_RELIABILITY_MISSION]);
  });
  it('binds each mission to one fixed repository journal, never to a CLI path', async () => {
    const actual = await vi.importActual<typeof import('../../../packages/salon-secretary/evaluation/free-use-budget')>('../../../packages/salon-secretary/evaluation/free-use-budget');
    expect(actual.freeUseMissionJournal(FREE_USE_MISSION)).toBe(legacyJournal);
    expect(actual.freeUseMissionJournal(FREE_USE_RELIABILITY_MISSION)).toBe(reliabilityJournal);
    expect(() => actual.freeUseMissionJournal('../../elsewhere' as never)).toThrow('FREE_USE_MISSION_UNKNOWN');
    expect(Object.isFrozen(FREE_USE_MISSIONS)).toBe(true); expect(Object.isFrozen(FREE_USE_MISSIONS[FREE_USE_RELIABILITY_MISSION])).toBe(true);
    const parsed = parseFreeUseArgs(['--prepare', '--out', 'x', '--repeat', '3', '--mission', FREE_USE_MISSION, '--max-requests', '40']);
    expect(parsed).toEqual({ mode: '--prepare', out: 'x', cases: undefined, maxRequests: 40, repeat: 3, mission: FREE_USE_MISSION });
    expect(parseFreeUseArgs(['--run', '--out', 'x']).mission).toBeUndefined();
    for (const argv of [['--prepare', '--out', 'x', '--journal', 'y.jsonl'], ['--prepare', '--out', 'x', '--mission-journal', 'y.jsonl'],
      ['--run', '--out', 'x', '--repeat', '2'], ['--prepare', '--out', 'x', '--mission', FREE_USE_MISSION, '--mission', FREE_USE_MISSION], ['--prepare', '--out', 'x', '--mission']])
      expect(() => parseFreeUseArgs(argv)).toThrow('FREE_USE_ARGUMENT');
    expect(() => parseFreeUseArgs(['--prepare', '--out', 'x', '--mission', '../../results/free-use/other.jsonl'])).toThrow('FREE_USE_MISSION_UNKNOWN');
    expect(parseFreeUseArgs(['--prepare', '--out', 'x', '--repeat', '8']).repeat).toBe(8);
    for (const repeat of ['0', '9', '2.5', '02', '-1', 'k2']) expect(() => parseFreeUseArgs(['--prepare', '--out', 'x', '--repeat', repeat])).toThrow('FREE_USE_REPEAT');
    expect(() => parseFreeUseArgs(['--prepare'])).toThrow('FREE_USE_OUT_REQUIRED'); expect(() => parseFreeUseArgs(['--confirm', '--out', 'x'])).toThrow('FREE_USE_COMMAND');
  });
  it('a known mission journal only ever accepts rows of its own mission', () => {
    const directory = temp();
    expect(() => new FreeUseBudget(join(directory, 'mission-20260927-reliability-admission.jsonl'), 'binding', 1)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(() => new FreeUseBudget(join(directory, 'mission-20260926-admission.jsonl'), 'binding', 1, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(() => new FreeUseBudget(join(directory, 'other.jsonl'), 'binding', 1, 8192, FREE_USE_PRICING_SHA256, 'secretary-other' as never)).toThrow('FREE_USE_MISSION_UNKNOWN');
    const file = join(directory, 'mission-20260927-reliability-admission.jsonl');
    new FreeUseBudget(file, 'binding', 2, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION).reserve('GF01#k1', 1, url, wire());
    expect(rows(file).map(row => row.mission)).toEqual([FREE_USE_RELIABILITY_MISSION]);
    const copy = join(directory, 'copy.jsonl'); writeFileSync(copy, readFileSync(file));
    expect(() => new FreeUseBudget(copy, 'other', 1)).toThrow('FREE_USE_BUDGET_JOURNAL');
  });
});

describe('legacy mission journal compatibility', () => {
  it('keeps the legacy mission, cap and sealed pricing byte-identical', () => {
    expect(FREE_USE_MISSION).toBe('secretary-final-stabilization-20260926');
    expect(FREE_USE_MISSION_CAP_MICRO_USD).toBe(5_000_000);
    expect(FREE_USE_PRICING_SHA256).toBe('7013445cc5240b3cdb76108131d1139ddf32587cd3b6e0c84d7e0f53d17df7c2');
    expect(FREE_USE_MISSIONS[FREE_USE_MISSION]).toEqual({ capMicroUsd: 5_000_000, journal: 'packages/salon-secretary/evaluation/results/free-use/mission-20260926-admission.jsonl' });
  });
  it('writes and reads legacy rows with the unchanged row schema and rejects them under the new mission', () => {
    const file = join(temp(), 'legacy.jsonl'), legacy = new FreeUseBudget(file, 'legacy-binding', 3);
    legacy.reserve('GF01', 1, url, wire()); legacy.reserve('GF02', 1, url, wire());
    const written = rows(file);
    expect(written.map(row => Object.keys(row))).toEqual(written.map(() => ['mission', 'binding', 'id', 'status', 'caseId', 'turn', 'attempt', 'maxRequests', 'bodySha256',
      'bodyBytes', 'model', 'maxOutputTokens', 'inputTokensUpper', 'reservedMicroUsd', 'pricingSha256', 'previousHash', 'rowHash']));
    expect(written.every(row => row.mission === FREE_USE_MISSION)).toBe(true);
    const reopened = new FreeUseBudget(file, 'legacy-binding', 3, 8192, FREE_USE_PRICING_SHA256, FREE_USE_MISSION);
    expect(reopened.requests).toBe(2); expect(reopened.missionMaxUsd).toBe(5);
    expect(freeUseMissionReservedMicroUsd(file, FREE_USE_MISSION)).toBe(written.reduce((sum, row) => sum + row.reservedMicroUsd, 0));
    expect(() => new FreeUseBudget(file, 'new-binding', 1, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION)).toThrow('FREE_USE_BUDGET_JOURNAL');
    expect(() => freeUseMissionReservedMicroUsd(file, FREE_USE_RELIABILITY_MISSION)).toThrow('FREE_USE_BUDGET_JOURNAL');
  });
  it.skipIf(!existsSync(legacyJournal))('still validates the real local legacy journal read-only, without writing to it', () => {
    const before = fileState(legacyJournal);
    expect(() => new FreeUseBudget(legacyJournal, 'read-only-audit', 1, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION)).toThrow('FREE_USE_BUDGET_CONFIG');
    const budget = new FreeUseBudget(legacyJournal, 'read-only-audit-' + randomUUID(), 1, 8192, FREE_USE_PRICING_SHA256, FREE_USE_MISSION);
    expect(budget.requests).toBe(0); expect(budget.missionReservedUsd).toBeGreaterThan(4.5); expect(budget.missionReservedUsd).toBeLessThanOrEqual(5);
    expect(rows(legacyJournal).every(row => row.mission === FREE_USE_MISSION && row.pricingSha256 === FREE_USE_PRICING_SHA256)).toBe(true);
    expect(fileState(legacyJournal)).toBe(before); expect(existsSync(legacyJournal + '.lock')).toBe(false);
  });
});

describe('reliability mission cap', () => {
  it('has its own USD 5 cap and stops admission at the cap without refunds', () => {
    expect(FREE_USE_RELIABILITY_MISSION).toBe('secretary-reliability-20260927');
    expect(FREE_USE_RELIABILITY_MISSION_CAP_MICRO_USD).toBe(5_000_000);
    expect(FREE_USE_MISSIONS[FREE_USE_RELIABILITY_MISSION]).toEqual({ capMicroUsd: 5_000_000,
      journal: 'packages/salon-secretary/evaluation/results/free-use/mission-20260927-reliability-admission.jsonl' });
    const file = join(temp(), 'mission-20260927-reliability-admission.jsonl'), big = wire({ max_output_tokens: 8192, instructions: 'x'.repeat(50_000) });
    const first = new FreeUseBudget(file, 'golden-k5', 300, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION);
    const second = new FreeUseBudget(file, 'holdout', 300, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION);
    for (let i = 0; i < 300; i++) first.reserve('case#k1', i, url, big);
    let stopped = ''; for (let i = 0; i < 300; i++) { try { second.reserve('case#k1', i, url, big); } catch (error) { stopped = (error as Error).message; break; } }
    expect(stopped).toBe('FREE_USE_BUDGET_EXHAUSTED');
    expect(second.missionReservedUsd).toBeLessThanOrEqual(5); expect(second.missionReservedUsd).toBeGreaterThan(4.98); expect(second.missionMaxUsd).toBe(5);
    expect(rows(file).every(row => row.mission === FREE_USE_RELIABILITY_MISSION)).toBe(true);
    expect(readFileSync(file, 'utf8')).not.toContain('synthetic message');
  });
  it('admits a pass^8 binding up to the mission request limit, still stops at the USD cap and rejects rows above the limit', () => {
    expect(freeUseBindingMaxRequests(FREE_USE_MISSION)).toBe(500); expect(freeUseBindingMaxRequests(FREE_USE_RELIABILITY_MISSION)).toBe(1000);
    expect(() => freeUseBindingMaxRequests('secretary-other')).toThrow('FREE_USE_MISSION_UNKNOWN');
    const directory = temp(), file = join(directory, 'mission-20260927-reliability-admission.jsonl');
    expect(() => new FreeUseBudget(file, 'too-many', 1001, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(() => new FreeUseBudget(join(directory, 'legacy.jsonl'), 'legacy-k8', 704)).toThrow('FREE_USE_BUDGET_CONFIG');
    const big = wire({ max_output_tokens: 8192, instructions: 'x'.repeat(50_000) });
    const release = new FreeUseBudget(file, 'golden-k8', 1000, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION);
    let stopped = ''; for (let i = 0; i < 1000; i++) { try { release.reserve('case#k' + (i % 8 + 1), i, url, big); } catch (error) { stopped = (error as Error).message; break; } }
    // The request ceiling never replaces the money ceiling: the USD cap stops the binding first.
    expect(stopped).toBe('FREE_USE_BUDGET_EXHAUSTED'); expect(release.requests).toBeLessThan(1000);
    expect(release.missionReservedUsd).toBeLessThanOrEqual(5); expect(release.missionReservedUsd).toBeGreaterThan(4.98);
    expect(rows(file).every(row => row.maxRequests === 1000 && row.mission === FREE_USE_RELIABILITY_MISSION)).toBe(true);
    // A re-hashed row claiming more than its mission admits invalidates the journal on read (fail closed).
    const rehash = (row: Record<string, unknown>) => { const { rowHash: _old, ...body } = row; void _old; return JSON.stringify({ ...body, rowHash: digest(JSON.stringify(body)) }) + '\n'; };
    const first = rows(file)[0], copy = (name: string, row: Record<string, unknown>) => { const path = join(directory, name); writeFileSync(path, rehash(row)); return path; };
    expect(freeUseMissionReservedMicroUsd(copy('reliability-1000.jsonl', first), FREE_USE_RELIABILITY_MISSION)).toBe(first.reservedMicroUsd);
    expect(() => freeUseMissionReservedMicroUsd(copy('reliability-1001.jsonl', { ...first, maxRequests: 1001 }), FREE_USE_RELIABILITY_MISSION)).toThrow('FREE_USE_BUDGET_JOURNAL');
    expect(freeUseMissionReservedMicroUsd(copy('legacy-500.jsonl', { ...first, mission: FREE_USE_MISSION, maxRequests: 500 }), FREE_USE_MISSION)).toBe(first.reservedMicroUsd);
    expect(() => freeUseMissionReservedMicroUsd(copy('legacy-704.jsonl', { ...first, mission: FREE_USE_MISSION, maxRequests: 704 }), FREE_USE_MISSION)).toThrow('FREE_USE_BUDGET_JOURNAL');
  }, 60_000);
});

describe('pass^k primitives', () => {
  it('bounds repeat to 1..8 (routine k=5, release k=8) and scales the single binding within the mission request limit', () => {
    expect(FREE_USE_MAX_REPEAT).toBe(8); expect(FREE_USE_ATTEMPT_MAX_REQUESTS).toBe(500);
    expect(freeUseRepeat()).toBe(1); expect(freeUseRepeat('5')).toBe(5); expect(freeUseRepeat('8')).toBe(8); expect(freeUseRepeat(8)).toBe(8);
    for (const value of [0, 9, 2.5, '9', '0', null, 'two']) expect(() => freeUseRepeat(value)).toThrow('FREE_USE_REPEAT');
    const goldenPerAttempt = goldenSuite().cases.reduce((sum, c) => sum + c.turns.length * 2, 0), reliability = FREE_USE_RELIABILITY_MISSION;
    expect(goldenPerAttempt).toBe(88); expect(freeUseRequestLimit(goldenPerAttempt, 5, reliability)).toBe(440);
    // Release pass^8: the Golden default and the existing holdout manifests (108, 112 per attempt) fit one approved binding.
    expect(freeUseRequestLimit(goldenPerAttempt, 8, reliability)).toBe(704);
    expect(freeUseRequestLimit(108, 8, reliability)).toBe(864); expect(freeUseRequestLimit(112, 8, reliability)).toBe(896);
    expect(freeUseRequestLimit(108, 5, reliability)).toBe(540); expect(freeUseRequestLimit(125, 8, reliability)).toBe(1000);
    expect(() => freeUseRequestLimit(126, 8, reliability)).toThrow('FREE_USE_BUDGET_CONFIG');
    // One attempt keeps the single-pass ceiling; the legacy mission keeps its sealed 500 per binding.
    expect(freeUseRequestLimit(500, 1, reliability)).toBe(500); expect(() => freeUseRequestLimit(501, 1, reliability)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(freeUseRequestLimit(100, 5, FREE_USE_MISSION)).toBe(500);
    expect(() => freeUseRequestLimit(101, 5, FREE_USE_MISSION)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(() => freeUseRequestLimit(goldenPerAttempt, 8, FREE_USE_MISSION)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(() => freeUseRequestLimit(0, 1, reliability)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(() => freeUseRequestLimit(Number.NaN, 1, reliability)).toThrow('FREE_USE_BUDGET_CONFIG');
    expect(() => freeUseRequestLimit(1, 9, reliability)).toThrow('FREE_USE_REPEAT');
    expect(() => freeUseRequestLimit(1, 1, 'secretary-other')).toThrow('FREE_USE_MISSION_UNKNOWN');
    expect(attemptNamespace('golden-free-use-30-abcd1234', 3)).toBe('golden-free-use-30-abcd1234-k3');
  });
  it('computes per-case c/n and pass^k = C(c,k)/C(n,k), averaged over cases', () => {
    expect(binomial(5, 2)).toBe(10); expect(binomial(3, 5)).toBe(0); expect(binomial(4, 0)).toBe(1);
    const attempt = (n: number, a: string, b: string, c: string) => ({ attempt: n, cases: [{ id: 'A', family: 'f', status: a }, { id: 'B', family: 'f', status: b }, { id: 'C', family: 'g', status: c }] }) as Parameters<typeof aggregatePassK>[0][number];
    const result = aggregatePassK([attempt(1, 'PASS', 'PASS', 'FAIL'), attempt(2, 'PASS', 'FAIL', 'FAIL'), attempt(3, 'PASS', 'PASS', 'FAIL')], 3);
    const b = result.perCase.find(c => c.id === 'B')!;
    expect(b).toMatchObject({ c: 2, n: 3, fail: 1, unknown: 0, statuses: ['PASS', 'FAIL', 'PASS'] });
    expect(b.passK[1]).toBeCloseTo(2 / 3); expect(b.passK[2]).toBeCloseTo(1 / 3); expect(b.passK[3]).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.passK[1]).toBeCloseTo(5 / 9); expect(result.passK[2]).toBeCloseTo(4 / 9); expect(result.passK[3]).toBeCloseTo(1 / 3);
    expect(result.allAttemptsPass).toEqual(['A']); expect(result.flaky).toEqual(['B']); expect(result.neverPass).toEqual(['C']); expect(result.unknown).toEqual([]);
  });
  it('counts NOT_EXECUTED, BLOCKED and missing attempts as UNKNOWN, never as PASS', () => {
    const result = aggregatePassK([
      { attempt: 1, cases: [{ id: 'A', family: 'f', status: 'PASS' }, { id: 'B', family: 'f', status: 'PASS' }] },
      { attempt: 2, cases: [{ id: 'A', family: 'f', status: 'PASS' }, { id: 'B', family: 'f', status: 'NOT_EXECUTED' }] },
    ], 3);
    const a = result.perCase.find(c => c.id === 'A')!, b = result.perCase.find(c => c.id === 'B')!;
    expect(a).toMatchObject({ c: 2, n: 3, unknown: 1, statuses: ['PASS', 'PASS', 'NOT_EXECUTED'] }); expect(b).toMatchObject({ c: 1, unknown: 2 });
    expect(a.passK).toEqual({ 1: null, 2: null, 3: null }); expect(result.passK).toEqual({ 1: null, 2: null, 3: null });
    expect(result.complete).toBe(false); expect(result.unknown).toEqual(['A', 'B']); expect(result.allAttemptsPass).toEqual([]);
    expect(result.passKLowerBound[3]).toBe(0); expect(result.passKLowerBound[1]).toBeCloseTo((2 / 3 + 1 / 3) / 2);
    const blocked = aggregatePassK([{ attempt: 1, cases: [{ id: 'A', family: 'f', status: 'BLOCKED' }] }], 1);
    expect(blocked.perCase[0]).toMatchObject({ c: 0, fail: 0, unknown: 1 }); expect(blocked.passK[1]).toBeNull(); expect(blocked.neverPass).toEqual([]);
    expect(() => aggregatePassK([{ attempt: 1, cases: [] }, { attempt: 1, cases: [] }], 2)).toThrow('FREE_USE_REPEAT');
    expect(() => aggregatePassK([{ attempt: 4, cases: [] }], 3)).toThrow('FREE_USE_REPEAT');
  });
});

describe('SALON_SECRETARY_* flag snapshot', () => {
  const env = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'false', SALON_SECRETARY_MODEL: 'gpt-6-luna',
    SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP: '4', SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS: '8192', SALON_SECRETARY_ENABLED: 'TRUE',
    SALON_SECRETARY_ROUTER_MODE: 'shadow', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-placeholder', SALON_SECRETARY_OPENAI_PROJECT: 'proj_Synthetic0',
    SALON_SECRETARY_ALLOWED_ACTORS: 'actor-a,actor-b', SALON_SECRETARY_WEBHOOK_SECRET: 'placeholder', SALON_SECRETARY_ACCESS_TOKEN: 'placeholder',
    SALON_SECRETARY_STAGING_URL: 'placeholder', SALON_SECRETARY_ODD: 'MixedCaseValue9', SALON_SECRETARY_SPACED: 'a b', OTHER_FLAG: 'true', salon_secretary_lower: 'true' };
  it('records every boolean/enum-like flag and never a key, secret, project or identifier', () => {
    const flags = freeUseFlags(env);
    expect(flags).toEqual({ SALON_SECRETARY_ENABLED: 'TRUE', SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP: '4', SALON_SECRETARY_MODEL: 'gpt-6-luna',
      SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_ROUTER_MODE: 'shadow', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'false',
      SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS: '8192' });
    expect(Object.keys(flags)).toEqual(Object.keys(flags).sort());
    const text = JSON.stringify(flags);
    for (const leaked of ['placeholder', 'proj_', 'API_KEY', 'PROJECT', 'actor-a', 'SECRET_', 'TOKEN"', 'STAGING_URL']) expect(text).not.toContain(leaked);
  });
  it('fails closed on any changed, added or removed flag and on the legacy overlap-only shape', () => {
    const recorded = freeUseFlags(env);
    expect(() => assertFreeUseFlags(JSON.parse(JSON.stringify(recorded)), env)).not.toThrow();
    expect(() => assertFreeUseFlags(recorded, { ...env, SALON_SECRETARY_OPENAI_API_KEY: 'another-placeholder', SALON_SECRETARY_ODD: 'OtherMixed1' })).not.toThrow();
    expect(() => assertFreeUseFlags(recorded, { ...env, SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true' })).toThrow('FREE_USE_FLAG_DRIFT');
    expect(() => assertFreeUseFlags(recorded, { ...env, SALON_SECRETARY_TEMPORAL_COMPONENTS_V3: 'true' })).toThrow('FREE_USE_FLAG_DRIFT');
    const { SALON_SECRETARY_ROUTER_MODE: _removed, ...without } = env; void _removed;
    expect(() => assertFreeUseFlags(recorded, without)).toThrow('FREE_USE_FLAG_DRIFT');
    for (const legacy of [{ overlap: false }, null, [], 'flags']) expect(() => assertFreeUseFlags(legacy, env)).toThrow('FREE_USE_FLAG_DRIFT');
  });
});

describe('read-only Golden runner with repeat, offline', () => {
  const localEnv = { APP_ENV: 'test', VERCEL_ENV: 'development', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false', SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false',
    SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true', FREE_USE_MISSION_ID: '',
    DATABASE_URL: 'postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp', DIRECT_URL: 'postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp' };
  const suite = (ids: string[]) => ({ schemaVersion: 1, suiteId: 'mission-synthetic', timezone: 'America/Sao_Paulo', clock: '2027-04-12T12:00:00Z',
    fixture: { customers: [], professionals: [], services: [], products: [], appointments: [], openWeekdays: [1, 2, 3, 4, 5, 6], openMinutes: 540, closeMinutes: 1140 },
    cases: ids.map(id => ({ id, family: 'synthetic neutral', criterion: 'Resposta neutra sem plano.',
      turns: [{ message: 'Mensagem sintética.', expect: { capabilityStatus: 'CONVERSATION', actionCount: 0, confirmable: false } }] })) });
  const network = vi.fn(async () => new Response(JSON.stringify({ id: 'resp_synthetic', output: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  async function prepare(repeat: number, ids = ['Syn1', 'Syn2'], mission?: string, maxRequests?: number) {
    for (const [key, value] of Object.entries(localEnv)) vi.stubEnv(key, value);
    const directory = temp(), cases = join(directory, 'suite.json'), out = join(directory, 'out');
    writeFileSync(cases, JSON.stringify(suite(ids))); guards.journalDir = directory;
    const prepared = await prepareFreeUse(cases, out, maxRequests, { repeat, mission });
    const bytes = readFileSync(join(out, 'manifest.json'));
    return { directory, out, prepared, manifest: JSON.parse(bytes.toString()), sha: createHash('sha256').update(bytes).digest('hex') };
  }
  const approve = (sha: string) => {
    vi.stubEnv('FREE_USE_APPROVED_MANIFEST', sha); vi.stubEnv('FREE_USE_REAL_LUNA_APPROVED', 'true');
    // Offline placeholder only; the provider is replaced and never reached.
    vi.stubEnv('SALON_SECRETARY_OPENAI_API_KEY', 'synthetic-offline-placeholder'); vi.stubEnv('SALON_SECRETARY_OPENAI_PROJECT', 'proj_IcNUaSBqgYGrPkSBtF9dZ0CF');
    network.mockClear(); vi.stubGlobal('fetch', network);
  };
  it('seeds K independent identity sets (-k1..-kK) under one manifest binding that records repeat, mission and flags', async () => {
    const backups = guards.backups, { out, prepared, manifest, sha } = await prepare(3);
    expect(guards.backups - backups).toBe(1);
    expect(guards.seeds.map(seed => seed.namespace)).toEqual([1, 1, 2, 2, 3, 3].map(k => manifest.namespace + '-k' + k));
    expect(guards.seeds.map(seed => seed.caseId)).toEqual(['Syn1', 'Syn2', 'Syn1', 'Syn2', 'Syn1', 'Syn2']);
    expect(manifest).toMatchObject({ schemaVersion: 2, repeat: 3, confirm: false, execute: false, network: false,
      budget: { maxRequests: 12, maxRequestsPerAttempt: 4, mission: FREE_USE_RELIABILITY_MISSION, missionMaxUsd: 5, pricingSha256: FREE_USE_PRICING_SHA256 } });
    expect(manifest.attempts.map((a: { attempt: number; namespace: string }) => [a.attempt, a.namespace])).toEqual([1, 2, 3].map(k => [k, manifest.namespace + '-k' + k]));
    const tenants = manifest.attempts.flatMap((a: { cases: { identity: { tenant: string } }[] }) => a.cases.map(c => c.identity.tenant));
    expect(new Set(tenants).size).toBe(6);
    expect(manifest.flags).toMatchObject({ SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false' });
    expect(JSON.stringify(manifest.flags)).not.toMatch(/API_KEY|PROJECT/);
    expect(JSON.parse(readFileSync(join(out, 'seal.json'), 'utf8'))).toMatchObject({ sha256: sha, repeat: 3, prepared: 6, blocked: [], status: 'PREPARED_NOT_EXECUTED', missionReservedUsd: 0, missionRemainingUsd: 5 });
    expect(prepared).toMatchObject({ repeat: 3, prepared: 6, blocked: 0 });
  }, 60_000);
  it('rejects an out-of-range repeat or a scaled request limit above the binding cap before any database access', async () => {
    const constructed = guards.prismaConstructed;
    await expect(prepare(9)).rejects.toThrow('FREE_USE_REPEAT');
    await expect(prepare(8, ['Syn1'], undefined, 126)).rejects.toThrow('FREE_USE_BUDGET_CONFIG');
    await expect(prepare(1, ['Syn1'], undefined, 501)).rejects.toThrow('FREE_USE_BUDGET_CONFIG');
    await expect(prepare(5, ['Syn1'], FREE_USE_MISSION, 101)).rejects.toThrow('FREE_USE_BUDGET_CONFIG');
    await expect(prepare(8, ['Syn1'], FREE_USE_MISSION, 88)).rejects.toThrow('FREE_USE_BUDGET_CONFIG');
    await expect(prepare(1, ['Syn1'], '../other-journal.jsonl')).rejects.toThrow('FREE_USE_MISSION_UNKNOWN');
    expect(guards.prismaConstructed).toBe(constructed); expect(guards.seeds).toEqual([]);
  }, 60_000);
  it('runs every attempt, writes per-attempt results and a pass^k aggregate, charging only the new mission journal', async () => {
    const realBefore = [fileState(legacyJournal), fileState(reliabilityJournal)];
    const { directory, out, manifest, sha } = await prepare(2);
    const tenant = (attempt: number, id: string) => manifest.attempts[attempt - 1].cases.find((c: { id: string }) => c.id === id).identity.tenant;
    guards.outcomes.set(tenant(2, 'Syn2'), 'fail');
    approve(sha);
    const result = await runFreeUse(out);
    expect(result).toMatchObject({ stopped: null, repeat: 2, releaseBlocked: false, pass: 3, fail: 1, total: 4, notExecuted: 0, passKComplete: true, requests: 4 });
    expect(result.passK[1]).toBeCloseTo(0.75); expect(result.passK[2]).toBeCloseTo(0.5);
    expect(guards.sends).toEqual([tenant(1, 'Syn1'), tenant(1, 'Syn2'), tenant(2, 'Syn1'), tenant(2, 'Syn2')]); expect(network).toHaveBeenCalledTimes(4);
    const report = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
    expect(report).toMatchObject({ binding: sha, mission: FREE_USE_RELIABILITY_MISSION, repeat: 2, missionMaxUsd: 5, intendedConfirmations: 0,
      providerEvidence: { requests: 4, capturedResponses: 4, complete: true }, observedEffects: { measuredCases: 4, unknownCases: [], confirmations: 0, operationalWrites: 0 } });
    expect(report.passK.perCase.find((c: { id: string }) => c.id === 'Syn2')).toMatchObject({ c: 1, n: 2, fail: 1, unknown: 0, statuses: ['PASS', 'FAIL'] });
    expect(report.attempts.map((a: { dir: string; summary: { pass: number } }) => [a.dir, a.summary.pass])).toEqual([['k1', 2], ['k2', 1]]);
    for (const k of [1, 2]) {
      const attempt = JSON.parse(readFileSync(join(out, 'k' + k, 'results.json'), 'utf8'));
      expect(attempt).toMatchObject({ attempt: k, repeat: 2, namespace: manifest.namespace + '-k' + k, providerEvidence: { requests: 2, capturedResponses: 2, complete: true } });
      expect(rows(join(out, 'k' + k, 'turns.jsonl')).map(row => [row.attempt, row.caseId])).toEqual([[k, 'Syn1'], [k, 'Syn2']]);
      expect(rows(join(out, 'k' + k, 'provider-observations.jsonl')).map(row => [row.repeatAttempt, row.caseId]).sort()).toEqual([[k, 'Syn1'], [k, 'Syn2']]);
    }
    const journal = rows(join(directory, 'mission-20260927-reliability-admission.jsonl'));
    expect(journal.map(row => [row.mission, row.binding, row.caseId, row.maxRequests])).toEqual(['Syn1#k1', 'Syn2#k1', 'Syn1#k2', 'Syn2#k2'].map(id => [FREE_USE_RELIABILITY_MISSION, sha, id, 8]));
    expect(existsSync(join(directory, 'mission-20260926-admission.jsonl'))).toBe(false);
    expect(readFileSync(join(directory, 'mission-20260927-reliability-admission.jsonl'), 'utf8')).not.toContain('Mensagem sintética');
    // Every provider call is also charged to the program real-spend ledger (no usage in the fake response: worst case).
    const programRun = `golden:mission-synthetic:${sha.slice(0, 12)}`, program = rows(join(directory, PROGRAM_SPEND_BASENAME));
    expect(program.filter(row => row.kind === 'RESERVE').map(row => [row.source, row.run, row.item])).toEqual(['Syn1#k1:t1', 'Syn2#k1:t1', 'Syn1#k2:t1', 'Syn2#k2:t1'].map(item => ['golden', programRun, item]));
    expect(program.filter(row => row.kind === 'SETTLE').map(row => [row.outcome, row.httpStatus])).toEqual(Array(4).fill(['NO_USAGE', 200]));
    expect(report.programSpend).toMatchObject({ run: programRun, capUsd: 15, calls: 4, open: 0, thisRun: { source: 'golden', calls: 4, worstCaseCharged: 4 } });
    expect(readFileSync(join(directory, PROGRAM_SPEND_BASENAME), 'utf8')).not.toContain('Mensagem sintética');
    expect([fileState(legacyJournal), fileState(reliabilityJournal)]).toEqual(realBefore);
    expect(existsSync(join(out, 'run.lock'))).toBe(false);
    await expect(runFreeUse(out)).rejects.toThrow('FREE_USE_ALREADY_STARTED');
  }, 60_000);
  it('produces the release pass^8 from one approved binding (K=8)', async () => {
    const { directory, out, manifest, sha } = await prepare(8, ['Syn1']);
    expect(manifest).toMatchObject({ repeat: 8, budget: { maxRequests: 16, maxRequestsPerAttempt: 2, mission: FREE_USE_RELIABILITY_MISSION } });
    expect(manifest.attempts.map((a: { namespace: string }) => a.namespace)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(k => manifest.namespace + '-k' + k));
    guards.outcomes.set(manifest.attempts[7].cases[0].identity.tenant, 'fail');
    approve(sha);
    const result = await runFreeUse(out);
    expect(result).toMatchObject({ stopped: null, repeat: 8, releaseBlocked: false, pass: 7, fail: 1, total: 8, notExecuted: 0, passKComplete: true, requests: 8 });
    expect(Object.keys(result.passK)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(result.passK[1]).toBeCloseTo(7 / 8); expect(result.passK[7]).toBeCloseTo(1 / 8); expect(result.passK[8]).toBe(0);
    const report = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
    expect(report.passK.perCase[0]).toMatchObject({ id: 'Syn1', c: 7, n: 8, fail: 1, unknown: 0 }); expect(report.passK.flaky).toEqual(['Syn1']);
    expect(report.attempts.map((a: { dir: string }) => a.dir)).toEqual(['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
    expect(rows(join(directory, 'mission-20260927-reliability-admission.jsonl')).map(row => [row.binding, row.caseId, row.maxRequests]))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(k => [sha, 'Syn1#k' + k, 16]));
  }, 60_000);
  it('stops every remaining attempt on SAFETY_FAILURE and reports the unexecuted rest as UNKNOWN', async () => {
    const { directory, out, manifest, sha } = await prepare(2);
    guards.outcomes.set(manifest.attempts[0].cases[0].identity.tenant, 'safety');
    approve(sha);
    const result = await runFreeUse(out);
    expect(result).toMatchObject({ stopped: 'SAFETY_FAILURE', releaseBlocked: true, pass: 0, fail: 1, notExecuted: 3, passKComplete: false, requests: 1 });
    expect(result.passK).toEqual({ 1: null, 2: null }); expect(guards.sends).toHaveLength(1);
    const report = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
    expect(report.passK.unknown).toEqual(['Syn1', 'Syn2']); expect(report.passK.allAttemptsPass).toEqual([]);
    const second = JSON.parse(readFileSync(join(out, 'k2', 'results.json'), 'utf8'));
    expect(second.cases.map((c: { status: string; reason: string }) => [c.status, c.reason])).toEqual([['NOT_EXECUTED', 'SAFETY_FAILURE'], ['NOT_EXECUTED', 'SAFETY_FAILURE']]);
    expect(existsSync(join(out, 'k2', 'turns.jsonl'))).toBe(false);
    expect(rows(join(directory, 'mission-20260927-reliability-admission.jsonl'))).toHaveLength(1);
  }, 60_000);
  it('keeps a per-attempt share of the single binding: one attempt never borrows from the next', async () => {
    const { directory, out, manifest, sha } = await prepare(2, ['Syn1'], undefined, 1);
    expect(manifest.budget).toMatchObject({ maxRequests: 2, maxRequestsPerAttempt: 1 });
    guards.outcomes.set(manifest.attempts[0].cases[0].identity.tenant, 'double');
    approve(sha);
    const result = await runFreeUse(out);
    expect(result).toMatchObject({ stopped: 'FREE_USE_ATTEMPT_REQUESTS_EXHAUSTED', releaseBlocked: false, pass: 0, blocked: 1, notExecuted: 1, passKComplete: false, requests: 1 });
    expect(network).toHaveBeenCalledTimes(1); expect(rows(join(directory, 'mission-20260927-reliability-admission.jsonl'))).toHaveLength(1);
    expect(rows(join(out, 'k1', 'turns.jsonl')).map(row => [row.status, row.reason])).toEqual([['BLOCKED', 'FREE_USE_ATTEMPT_REQUESTS_EXHAUSTED']]);
  }, 60_000);
  it('stops on the program-wide real-spend cap before any mission reservation or transport; the rest stays NOT_EXECUTED', async () => {
    const { directory, out, sha } = await prepare(2);
    // Another paid path already spent all but less than one Luna worst case of the shared program ledger.
    const ledger = join(directory, PROGRAM_SPEND_BASENAME), estimate = { estimator: 'test-fixed', model: 'synthetic', bodyBytes: 1, maxOutputTokens: 1, worstCaseMicroUsd: PROGRAM_REAL_CAP_MICRO_USD - 1_000, pricingSha256: 'synthetic' };
    await guardPaidFetch('transcribe', async () => new Response('unavailable', { status: 503 }), { ledger, run: 'transcribe:seed', estimator: { name: 'test-fixed', worstCase: () => estimate, actual: () => null } })('https://example.invalid/synthetic', { method: 'POST', body: 'x' });
    const before = readFileSync(ledger, 'utf8');
    approve(sha);
    const result = await runFreeUse(out);
    expect(result).toMatchObject({ stopped: 'PROGRAM_SPEND_CAP', releaseBlocked: false, pass: 0, blocked: 1, notExecuted: 3, passKComplete: false, requests: 0 });
    expect(network).not.toHaveBeenCalled(); expect(guards.sends).toHaveLength(1);
    expect(rows(join(directory, 'mission-20260927-reliability-admission.jsonl'))).toEqual([]);
    expect(readFileSync(ledger, 'utf8')).toBe(before); expect(programSpendTotals(ledger).remainingMicroUsd).toBe(1_000);
    expect(rows(join(out, 'k1', 'turns.jsonl')).map(row => [row.caseId, row.status, row.reason])).toEqual([['Syn1', 'BLOCKED', 'PROGRAM_SPEND_CAP']]);
    const report = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
    expect(report.passK.unknown).toEqual(['Syn1', 'Syn2']); expect(report.passK.allAttemptsPass).toEqual([]);
    expect(report.programSpend).toMatchObject({ remainingUsd: 0.001, thisRun: null });
    expect(JSON.parse(readFileSync(join(out, 'k2', 'results.json'), 'utf8')).cases.map((c: { status: string; reason: string }) => [c.status, c.reason]))
      .toEqual([['NOT_EXECUTED', 'PROGRAM_SPEND_CAP'], ['NOT_EXECUTED', 'PROGRAM_SPEND_CAP']]);
  }, 60_000);
  it('blocks on flag drift or a mission other than the approved one before database, journal or network', async () => {
    const { directory, out, sha } = await prepare(1, ['Syn1'], FREE_USE_MISSION);
    const constructed = guards.prismaConstructed;
    approve(sha);
    vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'false');
    await expect(runFreeUse(out, FREE_USE_MISSION)).rejects.toThrow('FREE_USE_FLAG_DRIFT');
    vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'true'); vi.stubEnv('SALON_SECRETARY_NEW_BEHAVIOUR', 'on');
    await expect(runFreeUse(out, FREE_USE_MISSION)).rejects.toThrow('FREE_USE_FLAG_DRIFT');
    vi.stubEnv('SALON_SECRETARY_NEW_BEHAVIOUR', undefined);
    await expect(runFreeUse(out)).rejects.toThrow('FREE_USE_MISSION_MISMATCH');
    vi.stubEnv('FREE_USE_MISSION_ID', FREE_USE_RELIABILITY_MISSION);
    await expect(runFreeUse(out, FREE_USE_MISSION)).rejects.toThrow('FREE_USE_MISSION_CONFLICT');
    expect(guards.prismaConstructed).toBe(constructed); expect(network).not.toHaveBeenCalled(); expect(guards.sends).toEqual([]);
    expect(readdirSync(directory).filter(name => name.endsWith('.jsonl'))).toEqual([]);
    expect(readdirSync(out).sort()).toEqual(['manifest.json', 'seal.json']);
    expect(statSync(join(out, 'manifest.json')).isFile()).toBe(true);
  }, 60_000);
});
