import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only (C5 harness fix, 30/09): database, secretary, stage journal and program ledger are replaced; no request reaches the
// network and the clock is fixed (Tuesday 29/09, 12h in São Paulo). The fake secretary asks one question per turn, naming the item.
const guards = vi.hoisted(() => ({ dir: '', sent: [] as string[] }));
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
// "troca o serviço" waits for the service change (service_changes_ref) until an answer says "gel"; any other first message books
// Iolanda and Kwame, each waiting for a time until an answer names that person with a clock ("15h").
vi.mock('../salon-secretary', () => ({ SalonSecretary: class {
  times = new Set<string>(); flow = ''; changed = false;
  async start() { return { sessionId: 'session', message: 'Olá!', capability_status: 'CONVERSATION', operations: [] }; }
  async send(_actor: unknown, input: { message: string }) {
    guards.sent.push(input.message);
    const text = input.message;
    if (!this.flow) this.flow = /troca o servi/i.test(text) ? 'service' : 'time';
    const act = (key: string, customer: string, missing: string[]) => ({ key, operation: this.flow === 'service' ? 'appointment.change' : 'appointment.create', status: missing.length ? 'NEEDS_INPUT' : 'READY',
      mutation: true, missing_fields: missing, depends_on: [], fields: { customer_name: customer } });
    const view = (actions: object[], message: string) => ({ sessionId: 'session', message, capability_status: 'NEEDS_INPUT', operations: [],
      action_plan: { plan_ref: 'plan', status: 'NEEDS_INPUT', revision: 1, confirmation_groups: [], actions } });
    if (this.flow === 'service') {
      if (/gel/i.test(text)) this.changed = true;
      return view([act('a', 'Iolanda', this.changed ? [] : ['a.service_changes_ref'])], this.changed ? 'Pronto para confirmar.' : 'Qual serviço entra no lugar da manicure?');
    }
    for (const name of ['Iolanda', 'Kwame']) if (text.includes(name) && /\d{1,2}h/.test(text)) this.times.add(name);
    const open = ['Iolanda', 'Kwame'].find(n => !this.times.has(n));
    return view([act('a', 'Iolanda', this.times.has('Iolanda') ? [] : ['a.time']), act('b', 'Kwame', this.times.has('Kwame') ? [] : ['b.time'])],
      open ? `Para qual horário devo marcar ${open}?` : 'Tudo pronto para confirmar.');
  }
} }));
import { preflightAgendaPractice, runAgendaPractice, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import type { AgendaClock } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

const STAGE = 'reliability-20260927';
const clock: AgendaClock = { now: () => new Date('2026-09-29T15:00:00.000Z'), sleep: async () => {} };
const people = [{ key: 'iolanda', name: 'Iolanda Prates' }, { key: 'kwame', name: 'Kwame Osei' }];
const scenarios: AgendaScenario[] = [
  { id: 'D01', title: 'Esmalteria: duas pessoas, um horário para cada', capability: ['create'], noise: false, customers: people,
    steps: [{ say: 'Marca Iolanda e Kwame amanhã na manicure.' }], answers: { time: { queue: ['Kwame às 16h.', 'Iolanda às 15h.'] } } },
  { id: 'D02', title: 'Esmalteria: troca de serviço', capability: ['alter'], noise: false, customers: people,
    steps: [{ say: 'Troca o serviço de Iolanda amanhã.' }], answers: { service_ref: 'Esmaltação em gel.' } },
];
type Row = { step: number; action: string; input?: string; answerFor?: { field: string; item?: string } };
type Attempt = { answerDelivery?: string; transcript: Row[] };
const attempt = (out: string, id: string) => JSON.parse(readFileSync(join(out, 'k1', `${id}.json`), 'utf8')) as Attempt;
function setup() {
  guards.dir = mkdtempSync(join(tmpdir(), 'agenda-answers-')); guards.sent = [];
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('NETWORK_FORBIDDEN'); }));
  vi.stubEnv('AGENDA_ANSWER_DELIVERY', ''); // '' = unset (the default), whatever the calling shell exports
  return { out: join(guards.dir, 'run-unit'), lease: join(guards.dir, 'reliability-stage-budget.jsonl.lease') };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); if (guards.dir) rmSync(guards.dir, { recursive: true, force: true }); guards.dir = ''; });

describe('Agenda practice runner: answer delivery switch (offline, evaluation only)', () => {
  it('flag off (default): legacy delivery, no service_changes answer, and no new key in the header, rows or report', async () => {
    const { out } = setup();
    const report = await runAgendaPractice(scenarios, out, { stage: STAGE, clock });
    expect(report.status).toBe('COMPLETE'); expect(report).not.toHaveProperty('answerDelivery');
    const d01 = attempt(out, 'D01'), d02 = attempt(out, 'D02');
    expect(d01.transcript.map(t => [t.action, t.input])).toEqual([['say', 'Marca Iolanda e Kwame amanhã na manicure.'], ['answer:time', 'Kwame às 16h.'], ['answer:time', 'Iolanda às 15h.']]);
    expect(d02.transcript.map(t => t.action)).toEqual(['say']); // the service change question stays unanswered, as in every recorded run
    for (const a of [d01, d02]) { expect(a).not.toHaveProperty('answerDelivery'); expect(a.transcript.every(t => !('answerFor' in t))).toBe(true); }
    expect(guards.sent).toEqual(['Marca Iolanda e Kwame amanhã na manicure.', 'Kwame às 16h.', 'Iolanda às 15h.', 'Troca o serviço de Iolanda amanhã.']);
  }, 60_000);
  it("item: each question gets its own item's answer, service_changes takes the service answer, and the run records it (codes only)", async () => {
    const { out } = setup();
    const report = await runAgendaPractice(scenarios, out, { stage: STAGE, clock, answerDelivery: 'item' });
    expect(report).toMatchObject({ status: 'COMPLETE', answerDelivery: 'item' });
    const d01 = attempt(out, 'D01'), d02 = attempt(out, 'D02');
    expect(d01.answerDelivery).toBe('item'); expect(d02.answerDelivery).toBe('item');
    expect(d01.transcript.map(t => [t.action, t.input, t.answerFor])).toEqual([['say', 'Marca Iolanda e Kwame amanhã na manicure.', undefined],
      ['answer:time', 'Iolanda às 15h.', { field: 'time', item: 'a' }], ['answer:time', 'Kwame às 16h.', { field: 'time', item: 'b' }]]);
    expect(d02.transcript.map(t => [t.action, t.input, t.answerFor])).toEqual([['say', 'Troca o serviço de Iolanda amanhã.', undefined],
      ['answer:service_ref', 'Esmaltação em gel.', { field: 'service_changes_ref', item: 'a' }]]);
    expect(JSON.stringify(report)).not.toMatch(/Iolanda|Kwame|Esmalta/i); // the report carries codes only
  }, 60_000);
  it('AGENDA_ANSWER_DELIVERY=item reaches the runner (CLI and sealed paths build their own options)', async () => {
    const { out } = setup();
    vi.stubEnv('AGENDA_ANSWER_DELIVERY', 'item');
    expect(await runAgendaPractice(scenarios, out, { stage: STAGE, clock })).toMatchObject({ answerDelivery: 'item' });
    expect(attempt(out, 'D01').transcript.map(t => t.input)).toEqual(['Marca Iolanda e Kwame amanhã na manicure.', 'Iolanda às 15h.', 'Kwame às 16h.']);
  }, 60_000);
  it('fail-safe: an unknown value stops before any file, lease or call (preflight, option, environment, handed preflight)', async () => {
    const { out, lease } = setup();
    expect(() => preflightAgendaPractice(scenarios, { stage: STAGE, clock, answerDelivery: 'items' as never })).toThrow('AGENDA_ANSWER_DELIVERY_ARGUMENT');
    await expect(runAgendaPractice(scenarios, out, { stage: STAGE, clock, answerDelivery: 'ITEM' as never })).rejects.toThrow('AGENDA_ANSWER_DELIVERY_ARGUMENT');
    const pre = preflightAgendaPractice(scenarios, { stage: STAGE, clock });
    await expect(runAgendaPractice(scenarios, out, { stage: STAGE, clock, preflight: pre, answerDelivery: 'on' as never })).rejects.toThrow('AGENDA_ANSWER_DELIVERY_ARGUMENT');
    vi.stubEnv('AGENDA_ANSWER_DELIVERY', 'true');
    await expect(runAgendaPractice(scenarios, out, { stage: STAGE, clock })).rejects.toThrow('AGENDA_ANSWER_DELIVERY_ARGUMENT');
    expect(existsSync(out)).toBe(false); expect(existsSync(lease)).toBe(false); expect(guards.sent).toEqual([]);
  }, 60_000);
});
