import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only: database, secretary, stage journal and program ledger are replaced; the network is a fake fetch.
// Instructions sized like a real Luna request, so the synthetic usage below (20 000 input tokens) respects the sealed bound.
const guards = vi.hoisted(() => ({ dir: '', sends: 0,
  payload: () => JSON.stringify({ model: 'gpt-6-luna', instructions: 'synthetic instructions ' + 'x'.repeat(12_000), input: [{ role: 'user', content: 'synthetic message' }],
    tools: [{ type: 'function', name: 'upsert_action_draft', parameters: { type: 'object' }, strict: true }], tool_choice: { type: 'function', name: 'upsert_action_draft' },
    parallel_tool_calls: false, max_output_tokens: 8192, store: false, stream: false, include: [] }) }));
vi.mock('@prisma/client', async original => ({ ...await original<object>(), PrismaClient: class {
  constructor() {
    const table = { findMany: async () => [], findFirst: async () => null };
    return new Proxy(this, { get: (_target, prop) => prop === '$disconnect' ? async () => {} : prop === 'then' || typeof prop === 'symbol' ? undefined : table });
  }
} }));
vi.mock('../prisma', () => ({ prisma: { $disconnect: async () => {} } }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-database', () => ({ assertFreeUseDatabase: async () => ({ database: 'synthetic-disposable' }) }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-fixture', async original => ({ ...await original<object>(),
  seedFreeUseFixture: async (_admin: unknown, namespace: string, caseId: string) => ({ tenant: `tenant-${namespace}-${caseId}`, actor: 'actor-synthetic', bindings: {} }) }));
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
  async send() {
    guards.sends++;
    const response = await globalThis.fetch('https://api.openai.com/v1/responses', { method: 'POST', body: guards.payload() });
    await response.text();
    return { sessionId: 'session', message: 'Pronto.', capability_status: 'CONVERSATION', operations: [] };
  }
} }));
import { runAgendaPractice, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { PROGRAM_REAL_CAP_MICRO_USD, PROGRAM_SPEND_BASENAME, guardPaidFetch, programSpendTotals, worstCaseMicroUsd } from '../../../packages/salon-secretary/evaluation/program-spend';

const scenarios: AgendaScenario[] = [
  { id: 'P01', title: 'synthetic two turns', capability: ['agenda'], steps: [{ say: 'Oi' }, { say: 'Tudo bem?' }] },
  { id: 'P02', title: 'synthetic one turn', capability: ['agenda'], steps: [{ say: 'Olá' }] },
];
const usage = { input_tokens: 20_000, input_tokens_details: { cached_tokens: 5_000 }, output_tokens: 700, output_tokens_details: { reasoning_tokens: 300 } };
const network = vi.fn(async () => new Response(JSON.stringify({ id: 'resp_synthetic', output: [{ type: 'function_call', arguments: '{}' }], usage }), { status: 200 }));
const rows = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
function setup() {
  guards.dir = mkdtempSync(join(tmpdir(), 'agenda-program-')); guards.sends = 0;
  network.mockClear(); vi.stubGlobal('fetch', network);
  return { ledger: join(guards.dir, PROGRAM_SPEND_BASENAME), stage: join(guards.dir, 'reliability-stage-budget.jsonl'), out: join(guards.dir, 'run-unit') };
}
async function spend(ledger: string, micro: number) {
  await guardPaidFetch('transcribe', async () => new Response('unavailable', { status: 503 }), { ledger, run: 'transcribe:seed',
    estimator: { name: 'test-fixed', actual: () => null, worstCase: () => ({ estimator: 'test-fixed', model: 'synthetic', bodyBytes: 1, maxOutputTokens: 1, worstCaseMicroUsd: micro, pricingSha256: 'synthetic' }) } })
  ('https://example.invalid/synthetic', { method: 'POST', body: 'x' });
}
afterEach(() => { vi.unstubAllGlobals(); if (guards.dir) rmSync(guards.dir, { recursive: true, force: true }); guards.dir = ''; });

describe('Agenda practice runner: program real-spend cap wiring (offline)', () => {
  it('charges every paid call to the program ledger with its actual usage, in addition to the stage journal', async () => {
    const { ledger, stage, out } = setup();
    const report = await runAgendaPractice(scenarios, out, { stage: 'reliability-20260927' });
    expect(report).toMatchObject({ status: 'COMPLETE', requests: 3, incomplete: null, notExecuted: [], reservedRequests: 3 });
    expect(network).toHaveBeenCalledTimes(3); expect(rows(stage)).toHaveLength(3);
    const program = rows(ledger);
    expect(program.filter(r => r.kind === 'RESERVE').map(r => [r.source, r.run, r.item])).toEqual(['P01#k1:s1', 'P01#k1:s2', 'P02#k1:s1'].map(item => ['practice', 'practice:run-unit', item]));
    expect(program.filter(r => r.kind === 'SETTLE').map(r => [r.outcome, r.chargedMicroUsd])).toEqual(Array(3).fill(['USAGE', 2_725]));
    expect(report.programSpend).toMatchObject({ run: 'practice:run-unit', spentUsd: 8_175 / 1e6, calls: 3, open: 0, thisRun: { source: 'practice', calls: 3, spentMicroUsd: 3 * 2_725 } });
    expect(readFileSync(ledger, 'utf8')).not.toMatch(/synthetic message|Oi|Tudo bem/);
  }, 60_000);
  it('stops the run cleanly when the next call could exceed the cap: no transport, no stage reservation, the rest NOT_EXECUTED', async () => {
    const { ledger, stage, out } = setup(), worst = worstCaseMicroUsd(Buffer.byteLength(guards.payload()), 8192);
    // Exactly one more Luna call fits; after its actual charge the second call no longer does.
    await spend(ledger, PROGRAM_REAL_CAP_MICRO_USD - worst - 1_000);
    await expect(runAgendaPractice(scenarios, out, { stage: 'reliability-20260927', repeat: 2 })).rejects.toThrow('PROGRAM_SPEND_CAP');
    expect(network).toHaveBeenCalledTimes(1); expect(guards.sends).toBe(2); expect(rows(stage)).toHaveLength(1);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    expect(report).toMatchObject({ status: 'ABORTED', abort: 'PROGRAM_SPEND_CAP', scenarioAttempts: 0, incomplete: 'P01#k1', notExecuted: ['P02#k1', 'P01#k2', 'P02#k2'] });
    const attempt = JSON.parse(readFileSync(join(out, 'k1', 'P01.json'), 'utf8'));
    expect(attempt).toMatchObject({ complete: false, abort: 'PROGRAM_SPEND_CAP' });
    expect(attempt.transcript.map((t: { error?: string }) => t.error ?? null)).toEqual([null, 'PROGRAM_SPEND_CAP']);
    expect(existsSync(join(out, 'k1', 'P02.json'))).toBe(false); expect(existsSync(join(out, 'k2'))).toBe(false);
    const totals = programSpendTotals(ledger);
    expect(totals).toMatchObject({ calls: 2, open: 0 }); expect(totals.remainingMicroUsd).toBe(worst + 1_000 - 2_725); expect(totals.remainingMicroUsd).toBeLessThan(worst);
  }, 60_000);
  it('the final-battery stage (USD 40 of reservations) never relaxes the program ledger: every call is charged there and its cap still stops the run', async () => {
    const { ledger, out } = setup(), final = join(guards.dir, 'final-20260929-stage-budget.jsonl'), worst = worstCaseMicroUsd(Buffer.byteLength(guards.payload()), 8192);
    const first = await runAgendaPractice(scenarios, out, { stage: 'final-20260929' });
    expect(first).toMatchObject({ status: 'COMPLETE', requests: 3, reservedRequests: 3, stage: { name: 'final-20260929', journal: 'final-20260929-stage-budget.jsonl', capUsd: 40 }, stageCapUsd: 40 });
    expect(rows(final).map(r => r.stage)).toEqual(Array(3).fill('final-20260929'));
    expect(existsSync(join(guards.dir, 'reliability-stage-budget.jsonl'))).toBe(false);
    expect(rows(ledger).filter(r => r.kind === 'SETTLE').map(r => r.chargedMicroUsd)).toEqual(Array(3).fill(2_725));
    // The stage still has ~USD 40 of headroom; the program cap (US$ 15.00 real) is what stops the next run.
    await spend(ledger, PROGRAM_REAL_CAP_MICRO_USD - 3 * 2_725 - worst - 1_000);
    await expect(runAgendaPractice(scenarios, join(guards.dir, 'run-unit-2'), { stage: 'final-20260929', repeat: 2 })).rejects.toThrow('PROGRAM_SPEND_CAP');
    expect(network).toHaveBeenCalledTimes(4); expect(rows(final)).toHaveLength(4);
    const report = JSON.parse(readFileSync(join(guards.dir, 'run-unit-2', 'report.json'), 'utf8'));
    expect(report).toMatchObject({ status: 'ABORTED', abort: 'PROGRAM_SPEND_CAP', stage: { name: 'final-20260929' }, notExecuted: ['P02#k1', 'P01#k2', 'P02#k2'] });
    expect(report.stage.remainingMicroUsd).toBeGreaterThan(39_000_000);
    expect(programSpendTotals(ledger).remainingMicroUsd).toBeLessThan(worst);
  }, 60_000);
});
