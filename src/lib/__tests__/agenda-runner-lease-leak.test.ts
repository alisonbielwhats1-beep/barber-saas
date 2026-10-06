import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only (same doubles as agenda-practice-day-anchor.test.ts): database, secretary, stage journal and program ledger are
// replaced; no request reaches the network.
const guards = vi.hoisted(() => ({ dir: '', seeds: 0 }));
vi.mock('@prisma/client', async original => ({ ...await original<object>(), PrismaClient: class {
  constructor() {
    const table = { findMany: async () => [], findFirst: async () => null };
    return new Proxy(this, { get: (_target, prop) => prop === '$disconnect' ? async () => {} : prop === 'then' || typeof prop === 'symbol' ? undefined : table });
  }
} }));
vi.mock('../prisma', () => ({ prisma: { $disconnect: async () => {} } }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-database', () => ({ assertFreeUseDatabase: async () => ({ database: 'synthetic-disposable' }) }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-fixture', async original => ({ ...await original<object>(),
  seedFreeUseFixture: async (_admin: unknown, namespace: string, caseId: string) => { guards.seeds++; return { tenant: `tenant-${namespace}-${caseId}`, actor: 'actor-synthetic', bindings: {} }; } }));
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
  async send() { return { sessionId: 'session', message: 'Certo.', capability_status: 'CONVERSATION', operations: [] }; }
} }));
import { preflightAgendaPractice, runAgendaPractice, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { acquireStageLease, releaseStageLease, stageLeasePath, type AgendaClock } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { PROGRAM_SPEND_BASENAME, acquireProofLease, releaseProofLease } from '../../../packages/salon-secretary/evaluation/program-spend';

const STAGE = 'reliability-20260927';
const clock: AgendaClock = { now: () => new Date('2026-09-30T15:00:00.000Z'), sleep: async () => {} }; // noon in São Paulo
const scenario: AgendaScenario = { id: 'L1', title: 'synthetic L1', capability: ['create'], noise: false, customers: [{ key: 'iara', name: 'Iara Nunes' }],
  professionals: [{ key: 'teo', name: 'Téo Barros' }], appointments: [{ key: 'a1', customer: 'iara', professional: 'teo', service: 'corte', day: 1, time: '10:00' }],
  steps: [{ say: 'Mensagem sintética' }], final: { unchanged: true } };
function setup() {
  guards.dir = mkdtempSync(join(tmpdir(), 'agenda-lease-leak-')); guards.seeds = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('NETWORK_FORBIDDEN'); }));
  return { out: join(guards.dir, 'run-unit'), stageFile: join(guards.dir, 'reliability-stage-budget.jsonl'), ledger: join(guards.dir, PROGRAM_SPEND_BASENAME) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); if (guards.dir) rmSync(guards.dir, { recursive: true, force: true }); guards.dir = ''; });

describe('standalone runner: no stage lease is left behind by an early refusal (F1 review fix)', () => {
  it('an invalid SALON_SECRETARY_EXAMPLES is refused before the lease: no lease, no file, the next run takes the stage', async () => {
    const { out, stageFile } = setup();
    vi.stubEnv('SALON_SECRETARY_EXAMPLES', 'bogus-mode');
    await expect(runAgendaPractice([scenario], out, { stage: STAGE, clock })).rejects.toThrow('INVALID_EXAMPLES_MODE');
    expect(existsSync(stageLeasePath(stageFile))).toBe(false);
    expect(existsSync(out)).toBe(false); expect(guards.seeds).toBe(0);
    const next = acquireStageLease(stageFile, STAGE, 'next-run'); // not AGENDA_STAGE_BUSY / _LEASE_STALE
    releaseStageLease(next, stageFile, STAGE);
  });
  it('the same run with a valid environment completes and releases its lease', async () => {
    const { out, stageFile } = setup();
    await expect(runAgendaPractice([scenario], out, { stage: STAGE, clock })).resolves.toMatchObject({ status: 'COMPLETE', lease: { own: true, released: true } });
    expect(existsSync(stageLeasePath(stageFile))).toBe(false);
  });
  it('while a proof holds the program-wide lease a DEV run is refused at its preflight (no stage lease, no seed)', async () => {
    const { out, stageFile, ledger } = setup(), proof = acquireProofLease(ledger, 'sealed-run');
    expect(() => preflightAgendaPractice([scenario], { stage: STAGE, clock }, clock.now())).toThrow('PROGRAM_SPEND_PROOF_BUSY');
    await expect(runAgendaPractice([scenario], out, { stage: STAGE, clock })).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY');
    expect(existsSync(stageLeasePath(stageFile))).toBe(false); expect(guards.seeds).toBe(0);
    expect(preflightAgendaPractice([scenario], { stage: STAGE, clock, proofLease: proof }, clock.now()).runnable).toHaveLength(1); // the proof's own run
    expect(() => preflightAgendaPractice([scenario], { stage: STAGE, clock, proofLease: { ...proof, id: '00000000-0000-4000-8000-000000000000' } }, clock.now()))
      .toThrow('PROGRAM_SPEND_PROOF_BUSY'); // a forged holder
    releaseProofLease(proof, ledger);
    expect(preflightAgendaPractice([scenario], { stage: STAGE, clock }, clock.now()).runnable).toHaveLength(1);
  });
});
