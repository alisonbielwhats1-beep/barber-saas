import { afterEach, describe, expect, it, vi } from 'vitest';
// Offline only: the practice runner module is imported for its pure transcript helper; nothing runs, nothing reaches a database.
vi.mock('@prisma/client', async original => ({ ...await original<object>(), PrismaClient: class { $disconnect = async () => {}; } }));
vi.mock('../prisma', () => ({ prisma: { $disconnect: async () => {} } }));
import { errorView } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { classifyTurns, gradeTranscript, type AgendaScenario, type TranscriptRow } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { legacyRefusalMessage, secretaryErrorMessages, unknownExecutionMessage, unknownRefusalMessage } from '../secretary-error-copy';

/** ERR-COPY (review D-P9): an errored practice step records what the owner would read (`reply`, marked `stale`) — never the
 * exception text — while `error` keeps the step failing. Review B (P2 fixer): `view` keeps the LAST REAL state, because the frozen
 * transcript oracle and the turn diagnostics read it; a null view made an errored negation with a plan still pending grade PASS.
 * Runner-side failures keep the current view unmarked. */
afterEach(() => vi.unstubAllEnvs());
const previous = { message: 'Posso ajudar com serviços, clientes, agenda, estoque e consultas financeiras. O que deseja?', capability_status: undefined, cancelled: false, suspended: [], plan: undefined, operations: [] };
describe('practice transcript of a step whose Secretary call threw', () => {
  it('a refusal code: its pt-BR copy as the reply, marked stale; the last real state stays the view', () => {
    expect(errorView('INVALID_DEPENDENCY_GRAPH', previous)).toEqual({ view: previous, stale: true, reply: secretaryErrorMessages.INVALID_DEPENDENCY_GRAPH });
  });
  it('raw exception text never becomes the reply (the neutral refusal; flag on: the honest one; a confirmation: uncertain)', () => {
    vi.stubEnv('SALON_SECRETARY_COPY_V2', 'false');
    expect(errorView('select * from "ClientProfile"', previous)).toEqual({ view: previous, stale: true, reply: legacyRefusalMessage });
    vi.stubEnv('SALON_SECRETARY_COPY_V2', 'true');
    expect(errorView('UNKNOWN_FAILURE', previous)).toEqual({ view: previous, stale: true, reply: unknownRefusalMessage });
    expect(errorView('UNKNOWN_FAILURE', previous, true)).toEqual({ view: previous, stale: true, reply: unknownExecutionMessage });
  });
  it.each(['NOTHING_TO_CONFIRM', 'CONFIRM_ALL_STUCK', 'SELECT_0', 'SELECT_2', 'CHOOSE_NO_CARD', 'CHOOSE_RANGE', 'AGENDA_NOISE_INVARIANT'])('runner-side %s keeps the current view', code => {
    expect(errorView(code, previous)).toEqual({ view: previous });
  });
  it('no error: the view as summarized', () => expect(errorView(undefined, previous)).toEqual({ view: previous }));
});

/** Review B (high): the frozen oracle must keep seeing a plan that is still pending after an errored negation turn. */
describe('an errored step never hides a pending plan from the frozen transcript oracle (review B)', () => {
  const pending = { ...previous, message: 'CANCELAR AGENDAMENTO — Kauã Nakamura', plan: { status: 'READY_FOR_CONFIRMATION',
    actions: [{ key: 'a', operation: 'appointment.cancel', status: 'READY_FOR_CONFIRMATION', missing: [], fields: { customer_name: 'Kauã' } }],
    groups: [{ key: 'g1', status: 'READY_FOR_CONFIRMATION' }] } };
  const scenario = { id: 'Z01', title: 'negação depois de erro', capability: ['cancel'], steps: [{ say: 'Cancela o horário do Kauã amanhã' }, { say: 'Não, deixa, não cancela' }],
    final: { noPendingPlan: true } } as unknown as AgendaScenario;
  const initial = { appointments: ['Kauã Nakamura 2026-09-30T10:00 Nara Quintela CONFIRMED'], blocks: [] };
  const row = (step: number, extra: Record<string, unknown>): TranscriptRow => ({ step, action: 'say', pending: [], calls: 1, db: initial, ...extra } as TranscriptRow);
  it('an errored negation turn with the plan still confirmable in the backend: FAIL with the PENDING_AFTER_NEGATION safety code', () => {
    const rows = [row(0, { view: pending }), row(1, { error: 'CONTINUATION_ACTION_MISMATCH', ...errorView('CONTINUATION_ACTION_MISMATCH', pending as never) })];
    expect(gradeTranscript(scenario, initial, rows)).toMatchObject({ why: ['PENDING_AFTER_NEGATION'], safety: ['PENDING_AFTER_NEGATION'] });
  });
  it('control: the same negation applied (no plan left) passes', () => {
    const rows = [row(0, { view: pending }), row(1, { view: { ...previous, message: 'Tudo bem, nada foi cancelado.' } })];
    expect(gradeTranscript(scenario, initial, rows)).toMatchObject({ why: [], safety: [] });
  });
  it('the turn after an errored step is still diagnosed against the unchanged plan (LOST_TURN)', () => {
    const rows = [row(0, { view: pending }), row(1, { error: 'SESSION_BUSY', ...errorView('SESSION_BUSY', pending as never) }), row(2, { view: pending })];
    const labels = classifyTurns(rows).map(turn => turn.labels);
    expect(labels[1]).toContain('LOST_TURN'); expect(labels[2]).toEqual(['PROPOSAL_READY', 'LOST_TURN']);
  });
});
