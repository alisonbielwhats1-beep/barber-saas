import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only: database, secretary, stage journal and program ledger are replaced; the network is a fake fetch.
const guards = vi.hoisted(() => ({ dir: '', sent: [] as string[],
  payload: () => JSON.stringify({ model: 'gpt-6-luna', instructions: 'synthetic instructions', input: [{ role: 'user', content: 'synthetic message' }],
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
// A cancellation asks for the reason once; everything else is a plain reply. The message actually sent is recorded.
vi.mock('../salon-secretary', () => ({ SalonSecretary: class {
  async start() { return { sessionId: 'session', message: 'Olá!', capability_status: 'CONVERSATION', operations: [] }; }
  async send(_actor: unknown, input: { message: string }) {
    guards.sent.push(input.message);
    const response = await globalThis.fetch('https://api.openai.com/v1/responses', { method: 'POST', body: guards.payload() });
    await response.text();
    if (!/cancela/i.test(input.message)) return { sessionId: 'session', message: 'Pronto.', capability_status: 'CONVERSATION', operations: [] };
    return { sessionId: 'session', message: 'Qual o motivo?', capability_status: 'NEEDS_INPUT', operations: [],
      action_plan: { plan_ref: 'plan', status: 'NEEDS_INPUT', revision: 1, confirmation_groups: [],
        actions: [{ key: 'a', operation: 'appointment.cancel', status: 'NEEDS_INPUT', mutation: true, missing_fields: ['a.reason'], depends_on: [], fields: {} }] } };
  }
} }));
import { runAgendaPractice, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { buildPasskReport, formatPasskTable } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

const scenarios: AgendaScenario[] = [
  { id: 'N01', title: 'synthetic cancel with reason', capability: ['cancel'], steps: [{ say: 'Cancela o horário da Amanda amanhã às 10h, por favor.' }],
    answers: { reason: ['Ela viajou para a praia.'] } },
  { id: 'N02', title: 'synthetic exact message', capability: ['communication'], noise: false, steps: [{ say: 'Manda para a Carla: Olá, Carla! Está confirmado.' }] },
];
const network = vi.fn(async () => new Response(JSON.stringify({ id: 'resp_synthetic', output: [{ type: 'function_call', arguments: '{}' }],
  usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10 } }), { status: 200 }));
type Row = { step: number; action: string; input?: string; noise?: { profile: string; level: string; seed: string; scenario: string; attempt: number; step: number; source: string; original: string; sent: string; rules: string[] } };
const attempt = (out: string, k: number, id: string) => JSON.parse(readFileSync(join(out, `k${k}`, `${id}.json`), 'utf8')) as { noise?: { profile: string; level: string }; transcript: Row[] };
function setup() {
  guards.dir = mkdtempSync(join(tmpdir(), 'agenda-noise-')); guards.sent = [];
  network.mockClear(); vi.stubGlobal('fetch', network);
  return { out: join(guards.dir, 'run-unit') };
}
afterEach(() => { vi.unstubAllGlobals(); if (guards.dir) rmSync(guards.dir, { recursive: true, force: true }); guards.dir = ''; });

describe('Agenda practice runner: --noise wiring (offline)', () => {
  it('mixed: attempt 1 clean, then light/heavy; each user turn records profile, level, seed, ORIGINAL and SENT', async () => {
    const { out } = setup();
    const report = await runAgendaPractice(scenarios, out, { stage: 'reliability-20260927', repeat: 3, noise: 'mixed' });
    expect(report).toMatchObject({ status: 'COMPLETE', noise: { profile: 'mixed', levels: ['off', 'light', 'heavy'] }, requests: 9 });
    const rows: Row[] = [];
    for (const [k, level] of [[1, 'off'], [2, 'light'], [3, 'heavy']] as const) {
      const n01 = attempt(out, k, 'N01'), n02 = attempt(out, k, 'N02');
      expect(n01.noise).toEqual({ profile: 'mixed', level }); expect(n02.noise).toEqual({ profile: 'mixed', level: 'off' });
      expect(n01.transcript.map(t => [t.action, t.noise?.source, t.noise?.seed])).toEqual([['say', 'say:1', `noise|N01#k${k}|say:1`], ['answer:reason', 'answer:reason:1', `noise|N01#k${k}|answer:reason:1`]]);
      for (const t of [...n01.transcript, ...n02.transcript]) {
        expect(t.noise).toMatchObject({ profile: 'mixed', attempt: k, step: t.step });
        expect(t.input).toBe(t.noise!.sent);
        rows.push(t);
      }
      expect(n01.transcript.map(t => t.noise!.original)).toEqual(['Cancela o horário da Amanda amanhã às 10h, por favor.', 'Ela viajou para a praia.']);
      expect(n01.transcript.every(t => t.noise!.level === level)).toBe(true);
      // noise:false: always sent exactly as written
      expect(n02.transcript[0].noise).toMatchObject({ level: 'off', sent: 'Manda para a Carla: Olá, Carla! Está confirmado.', rules: [] });
    }
    expect(guards.sent).toEqual(rows.map(t => t.noise!.sent)); // what Luna received is exactly the recorded SENT text, in order
    const k1 = attempt(out, 1, 'N01').transcript, k2 = attempt(out, 2, 'N01').transcript, k3 = attempt(out, 3, 'N01').transcript;
    expect(k1.map(t => t.noise!.sent)).toEqual(k1.map(t => t.noise!.original));
    expect(k2[0].noise!.sent).toMatch(/^cancela o horario da amanda amanha as 10h, por favor$/);
    expect(k3[0].noise!.sent).not.toMatch(/[A-ZÀ-ÿ]/); expect(k3[0].noise!.sent).toContain('amanda');
    expect(readFileSync(join(guards.dir, 'reliability-stage-budget.jsonl'), 'utf8')).not.toMatch(/amanda|praia|Carla/i); // journals carry no text
    const passk = buildPasskReport(out);
    expect(passk.byNoise).toEqual({ heavy: { attempts: 1, passed: 0, pass1: 0 }, light: { attempts: 1, passed: 0, pass1: 0 }, off: { attempts: 4, passed: 0, pass1: 0 } });
    expect(formatPasskTable(passk)).toContain('NOISE (graded attempts) heavy=0/1 (0.000) light=0/1 (0.000) off=0/4 (0.000)');
  }, 60_000);
  it('default off keeps the legacy transcript shape and sends texts exactly as written', async () => {
    const { out } = setup();
    const report = await runAgendaPractice(scenarios, out, { stage: 'reliability-20260927' });
    expect(report).toMatchObject({ status: 'COMPLETE', noise: { profile: 'off', levels: ['off'] } });
    const n01 = attempt(out, 1, 'N01');
    expect(n01.noise).toBeUndefined(); expect(n01.transcript.every(t => !('noise' in t))).toBe(true);
    expect(guards.sent).toEqual(['Cancela o horário da Amanda amanhã às 10h, por favor.', 'Ela viajou para a praia.', 'Manda para a Carla: Olá, Carla! Está confirmado.']);
    await expect(runAgendaPractice(scenarios, join(guards.dir, 'bad'), { noise: 'loud' as never })).rejects.toThrow('AGENDA_NOISE_ARGUMENT');
  }, 60_000);
});
