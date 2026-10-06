import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Reschedule pilot arm of the practice runner (final review H2/H3/H4; docs/c5-spike/12-piloto-remarcacao.md, Adendo 9). Offline only: the database,
// the secretary, the stage journal and the program ledger are replaced; the network is a fake fetch. The secretary stand-in posts, for each owner
// message, the pilot's own request (built by the pilot's request builder, so the cost guard sees the real wire) and returns a scripted view with the
// pilot's open question. Synthetic salon and texts.
const guards = vi.hoisted(() => ({ dir: '', script: [] as string[][], views: [] as unknown[], selected: [] as unknown[][] }));
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
const idle = { sessionId: 'session', message: 'Pronto.', operations: [] };
vi.mock('../salon-secretary', () => ({ SalonSecretary: class {
  async start() { return { sessionId: 'session', message: 'Olá!', operations: [] }; }
  async send() {
    for (const body of guards.script.shift() ?? []) {
      try { const response = await globalThis.fetch('https://api.openai.com/v1/responses', { method: 'POST', body }); await response.text(); }
      catch { /* the product answers a failed call with its safe reply; the stand-in only posts */ }
    }
    return guards.views.shift() ?? idle;
  }
  async selectAutomatic(...args: unknown[]) { guards.selected.push(args.slice(2)); return guards.views.shift() ?? idle; }
} }));
import { runAgendaPractice, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { askedFields, buildPasskReport, classifyTurns, type TranscriptRow } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { PROGRAM_SPEND_BASENAME, guardPaidFetch, programSpendTotals, runSpendCapReached, worstCaseMicroUsd } from '../../../packages/salon-secretary/evaluation/program-spend';
import { agentRequestBody } from '../../../packages/salon-secretary/src/agent-loop';
import { pilotRequest } from '../../../packages/salon-secretary/src/pilot-reschedule-prompt';

const clock = { now: () => new Date('2031-05-06T15:00:00.000Z'), sleep: async () => {} };
const STAGE = 'c5-agent-20261001', URL = 'https://api.openai.com/v1/responses';
const pilotBody = () => JSON.stringify(agentRequestBody(pilotRequest({ today: { date: '2031-05-06', weekday: 'terça-feira', timezone: 'America/Sao_Paulo' },
  team: ['Ícaro Monteiro', 'Ícaro Pestana'], services: ['Limpeza de pele'] }, 'mensagem sintética do dono'), 'gpt-6-luna'));
const answer = () => new Response(JSON.stringify({ id: 'resp_synthetic', object: 'response', status: 'completed', model: 'gpt-6-luna', output: [],
  usage: { input_tokens: 2_000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 300 } }), { status: 200 });
const network = vi.fn(async () => answer());
const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) { if (!(name in saved)) saved[name] = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
function setup() {
  guards.dir = mkdtempSync(join(tmpdir(), 'agenda-pilot-runner-')); guards.script = []; guards.views = []; guards.selected = [];
  network.mockReset(); network.mockImplementation(async () => answer()); vi.stubGlobal('fetch', network);
  return { ledger: join(guards.dir, PROGRAM_SPEND_BASENAME), out: join(guards.dir, 'run-pilot') };
}
beforeEach(() => setEnv({ SALON_SECRETARY_PILOT_RESCHEDULE: 'true', SALON_SECRETARY_AGENT: undefined }));
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; delete saved[name]; }
  if (guards.dir) rmSync(guards.dir, { recursive: true, force: true }); guards.dir = '';
});
/** A pilot view asking `field` (the action's missing field) with real options on the pilot's own operation (a1). */
const asking = (revision: number, reason: string, options: { id: string; label: string }[]) => ({ sessionId: 'session', message: 'Qual deles?', capability_status: 'NEEDS_INPUT',
  action_plan: { plan_ref: 'plan', revision: revision + 2, status: 'NEEDS_INPUT', confirmation_groups: [{ key: 'group_1', status: 'NEEDS_REVIEW', action_keys: ['a1'] }],
    actions: [{ key: 'a1', operation: 'appointment.change', status: 'NEEDS_INPUT', mutation: true, missing_fields: ['target_professional_ref'], depends_on: [], fields: {}, assessment: {} }] },
  operations: [{ operation_ref: 'op-pilot', action_keys: ['a1'], state: { sessionId: 'child', message: 'Qual deles?' } }],
  pilot: { planId: 'pilot-plan', revision, status: 'pending', fields: { professional: { value: null, display: null, provenance: 'unresolved' } },
    questions: [{ questionId: `q${revision}`, field: 'professional', reason, options }], proposal: null, turn: { turnId: 't', clientTurnId: null, receivedAt: '', replayed: false } } });

describe('Agenda practice runner, reschedule pilot arm (offline)', () => {
  it("H2: the run stops at its own dollar ceiling before the call that would pass it (AGENDA_RUN_SPEND_CAP), never after the run", async () => {
    const { ledger, out } = setup();
    network.mockImplementation(async () => new Response('indisponível', { status: 503 }));
    guards.script = [[pilotBody()], [pilotBody()], [pilotBody()]];
    const scenarios: AgendaScenario[] = [{ id: 'P01', title: 'synthetic pilot turns', capability: ['agenda'], steps: [{ say: 'mensagem um' }, { say: 'mensagem dois' }, { say: 'mensagem três' }] }];
    await expect(runAgendaPractice(scenarios, out, { stage: STAGE, clock, runCapUsd: 0.01 })).rejects.toThrow('AGENDA_RUN_SPEND_CAP');
    expect(network).toHaveBeenCalledTimes(1);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    expect(report).toMatchObject({ status: 'ABORTED', abort: 'AGENDA_RUN_SPEND_CAP', arm: 'PILOT', runCapUsd: 0.01 });
    expect(programSpendTotals(ledger).spentMicroUsd).toBeLessThanOrEqual(10_000);
    // An invalid ceiling is refused before anything.
    await expect(runAgendaPractice(scenarios, join(guards.dir, 'other'), { stage: STAGE, clock, runCapUsd: -1 })).rejects.toThrow('AGENDA_RUN_CAP_ARGUMENT');
  }, 60_000);
  it("H2: runSpendCapReached counts the run's calls since its baseline (open calls at their worst case) plus the next call's worst case", async () => {
    const { ledger } = setup();
    const body = pilotBody(), init = { method: 'POST', body }, worst = worstCaseMicroUsd(Buffer.byteLength(body, 'utf8'), 8192);
    const options = { ledger, run: 'practice:pilot-cap', pilot: true };
    expect(runSpendCapReached(URL, init, { ...options, capMicroUsd: worst })).toBe(false);
    await guardPaidFetch('practice', async () => new Response('indisponível', { status: 503 }), { ...options, item: 'P01:s1' })(URL, init);
    expect(runSpendCapReached(URL, init, { ...options, capMicroUsd: 2 * worst - 1 })).toBe(true);
    expect(runSpendCapReached(URL, init, { ...options, capMicroUsd: 2 * worst })).toBe(false);
    expect(runSpendCapReached(URL, init, { ...options, capMicroUsd: worst, baselineMicroUsd: worst })).toBe(false);
  });
  it("H3/H4: a select step taps the pilot's own option bound to its question; the row records the pilot's question as a choice and its progress", async () => {
    const { out } = setup();
    const options = [{ id: 'pro-monteiro', label: 'Ícaro Monteiro' }, { id: 'pro-pestana', label: 'Ícaro Pestana' }];
    guards.script = [[pilotBody()]];
    guards.views = [asking(1, 'PROFESSIONAL_AMBIGUOUS', options), asking(2, 'SLOT_UNAVAILABLE', [{ id: '16:00', label: '16h' }, { id: '17:00', label: '17h' }])];
    const scenarios: AgendaScenario[] = [{ id: 'P02', title: 'synthetic pilot choice', capability: ['agenda'], steps: [{ say: 'mensagem com o Ícaro' }, { select: 'Pestana' }] }];
    const report = await runAgendaPractice(scenarios, out, { stage: STAGE, clock });
    expect(report).toMatchObject({ status: 'COMPLETE', arm: 'PILOT' });
    expect(guards.selected).toEqual([['op-pilot', 'q1/pro-pestana']]);
    const attempt = JSON.parse(readFileSync(join(out, 'k1', 'P02.json'), 'utf8'));
    const [say, select] = attempt.transcript as (TranscriptRow & { error?: string })[];
    expect(select.error).toBeUndefined();
    expect(say.view?.pilot).toEqual({ revision: 1, status: 'pending', questions: [{ field: 'professional', reason: 'PROFESSIONAL_AMBIGUOUS', options: 2 }], provenance: { professional: 'unresolved' } });
    expect(askedFields(say)).toContain('selection');
    expect(JSON.stringify(attempt)).not.toContain('Ícaro Pestana'); // codes and counts only
    expect(buildPasskReport(out).turns.asked).toEqual({ count: 1, per100: 100 });
  }, 60_000);
  it("H4: a pilot turn that moved its plan (new revision, other question) is neither a loop nor a lost turn; one that did not is", () => {
    const row = (step: number, revision: number, reason: string): TranscriptRow => ({ step, action: 'say', pending: ['target_professional_ref'],
      view: { message: 'Qual?', plan: { status: 'NEEDS_INPUT', actions: [{ key: 'a1', operation: 'appointment.change', status: 'NEEDS_INPUT', missing: ['target_professional_ref'], fields: {} }],
        groups: [{ key: 'group_1', status: 'NEEDS_REVIEW' }] }, operations: [], pilot: { revision, status: 'pending', questions: [{ field: 'professional', reason, options: 0 }], provenance: null } } });
    expect(classifyTurns([row(1, 1, 'PROFESSIONAL_NOT_FOUND'), row(2, 3, 'PROFESSIONAL_AMBIGUOUS')]).map(t => t.labels)).toEqual([['QUESTION'], ['QUESTION']]);
    expect(classifyTurns([row(1, 1, 'PROFESSIONAL_NOT_FOUND'), row(2, 1, 'PROFESSIONAL_NOT_FOUND')]).map(t => t.labels)).toEqual([['QUESTION'], ['QUESTION', 'LOOP', 'LOST_TURN']]);
    const plain = (step: number): TranscriptRow => { const r = row(step, 1, 'X'); delete r.view!.pilot; return r; };
    expect(classifyTurns([plain(1), plain(2)]).map(t => t.labels)).toEqual([['QUESTION'], ['QUESTION', 'LOOP', 'LOST_TURN']]);
  });
});
