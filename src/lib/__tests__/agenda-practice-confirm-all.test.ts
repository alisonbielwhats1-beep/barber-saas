import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only: database, secretary, stage journal and program ledger are replaced; no request reaches the network.
const guards = vi.hoisted(() => ({ dir: '', batch: true, calls: [] as { kind: string; approvals: unknown }[] }));
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
// Two independent ready groups; each confirmation path marks the groups it received as DONE.
vi.mock('../salon-secretary', () => {
  const view = (done: string[]) => ({ sessionId: 'session', message: 'Pronto.', capability_status: 'SUPPORTED', operations: [],
    action_plan: { plan_ref: 'plan', status: done.length === 2 ? 'DONE' : 'READY_FOR_CONFIRMATION', revision: 1,
      actions: ['a', 'b'].map(key => ({ key, operation: 'service.create', status: done.includes(`g_${key}`) ? 'DONE' : 'READY_FOR_CONFIRMATION', mutation: true, missing_fields: [], depends_on: [], fields: {} })),
      confirmation_groups: ['a', 'b'].map(key => ({ key: `g_${key}`, action_keys: [key], status: done.includes(`g_${key}`) ? 'DONE' : 'READY_FOR_CONFIRMATION', fingerprint: key.repeat(64) })) } });
  let done: string[] = [];
  return { SalonSecretary: class {
    confirmReadyGroups?: (actor: unknown, id: string, approvals: { group_key: string }[]) => Promise<unknown>;
    constructor() {
      done = [];
      if (guards.batch) this.confirmReadyGroups = async (_actor, _id, approvals) => {
        guards.calls.push({ kind: 'ready', approvals }); done = [...done, ...approvals.map(item => item.group_key)];
        return { ...view(done), confirmation_batch: { executed: approvals.map(item => item.group_key), replayed: [], not_executed: [] } };
      };
    }
    async start() { return { sessionId: 'session', message: 'Olá!', operations: [] }; }
    async send() { return view(done); }
    async confirmActionPlanGroup(_actor: unknown, _id: string, approval: { group_key: string }) {
      guards.calls.push({ kind: 'group', approvals: approval }); done = [...done, approval.group_key]; return view(done);
    }
  } };
});
import { runAgendaPractice, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice';

const scenarios: AgendaScenario[] = [{ id: 'CA1', title: 'synthetic two independent services', capability: ['multi-action'], noise: false,
  steps: [{ say: 'Cadastre os dois serviços.' }, { confirm: 'all' }] }];
type Row = { action: string; confirmed?: string[]; error?: string };
const transcript = (out: string) => (JSON.parse(readFileSync(join(out, 'k1', 'CA1.json'), 'utf8')) as { transcript: Row[] }).transcript;
function setup(batch: boolean) {
  guards.dir = mkdtempSync(join(tmpdir(), 'agenda-confirm-all-')); guards.batch = batch; guards.calls = [];
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('NETWORK_FORBIDDEN'); }));
  return { out: join(guards.dir, 'run-unit') };
}
afterEach(() => { vi.unstubAllGlobals(); if (guards.dir) rmSync(guards.dir, { recursive: true, force: true }); guards.dir = ''; });

describe("Agenda practice runner: {confirm:'all'} (offline)", () => {
  it('sends every READY group in one confirmReadyGroups call and records the executed groups', async () => {
    const { out } = setup(true);
    expect(await runAgendaPractice(scenarios, out, { stage: 'reliability-20260927' })).toMatchObject({ status: 'COMPLETE', requests: 0 });
    expect(guards.calls).toEqual([{ kind: 'ready', approvals: [
      { plan_ref: 'plan', revision: 1, group_key: 'g_a', fingerprint: 'a'.repeat(64) }, { plan_ref: 'plan', revision: 1, group_key: 'g_b', fingerprint: 'b'.repeat(64) }] }]);
    expect(transcript(out)[1]).toMatchObject({ action: 'confirm:all', confirmed: ['g_a', 'g_b'] });
    expect(transcript(out)[1].error).toBeUndefined();
  }, 60_000);
  it("{confirm:true} is one click on the Front's primary control: every ready group in one call (legacy packed plans had them in one group)", async () => {
    const { out } = setup(true);
    await runAgendaPractice([{ ...scenarios[0], steps: [{ say: 'Cadastre os dois serviços.' }, { confirm: true }] }], out, { stage: 'reliability-20260927' });
    expect(guards.calls.map(call => [call.kind, (call.approvals as { group_key: string }[]).map(item => item.group_key)])).toEqual([['ready', ['g_a', 'g_b']]]);
    expect(transcript(out)[1]).toMatchObject({ action: 'confirm', confirmed: ['g_a', 'g_b'] });
  }, 60_000);
  it('without confirmReadyGroups it falls back to one group per call, recomputing from each returned view', async () => {
    const { out } = setup(false);
    await runAgendaPractice(scenarios, out, { stage: 'reliability-20260927' });
    expect(guards.calls.map(call => [call.kind, (call.approvals as { group_key: string }).group_key])).toEqual([['group', 'g_a'], ['group', 'g_b']]);
    expect(transcript(out)[1]).toMatchObject({ action: 'confirm:all', confirmed: ['g_a', 'g_b'] });
  }, 60_000);
});
