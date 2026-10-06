import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runServicesTurn, SecretaryNewRequest, withConversationRouting, type CapabilitySelection } from '@everflair/salon-secretary';
import fixture from '../../test/fixtures/secretary-batch-v230-consumed.json';
import { ScriptedServicesModel } from '../../test/scripted-services-model';

const io = vi.hoisted(() => ({ upsert: vi.fn(), propose: vi.fn(), confirm: vi.fn() }));
vi.mock('../prisma-tenant', () => ({ withTenant: (_actor: unknown, work: (tx: unknown) => unknown) => work({}) }));
vi.mock('../scheduling-catalog', async original => ({ ...await original<object>(), schedulingTimezone: async () => 'America/Sao_Paulo' }));
vi.mock('../scheduling-batch', async original => ({ ...await original<object>(), upsertBatchDraft: io.upsert, proposeActionBatch: io.propose, confirmActionBatch: io.confirm }));
import { startBatch } from '../secretary-batch';

const actor = { salonId: 'synthetic-salon', userId: 'synthetic-owner' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date('2027-06-14T12:00:00Z'));
  vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'true');
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); }));
  io.upsert.mockImplementation(async (_tx, _actor, input) => ({
    operation: 'action.batch', plan: structuredClone(input.plan), draft_ref: 'synthetic-draft', draft_revision: 1,
    status: 'NEEDS_INPUT', missing_fields: ['cancel_ivo.appointment_ref'], message: 'Selecione o agendamento real.',
  }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled(); expect(io.confirm).not.toHaveBeenCalled(); expect(io.propose).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
async function consumedSelection() {
  const row = fixture.rows[0];
  expect(createHash('sha256').update(row.arguments).digest('hex')).toBe(row.argumentsSha256);
  const model = new ScriptedServicesModel([[{ type: 'function_call', callId: 'consumed', name: row.tool, arguments: row.arguments }]]);
  const selection = await withConversationRouting(() => runServicesTurn(model, row.message, {}, {}, 'discovery', true)).catch(error => {
    if (error instanceof SecretaryNewRequest && error.mode === 'NEW') return error.selection;
    throw error;
  });
  return { selection, row };
}

describe('consumed batch transport reaches the domain without provenance as mutable fields', () => {
  it('V230 retains the original Luna values, source witnesses and dependency through the strict adapter', async () => {
    const { selection, row } = await consumedSelection();
    const original = structuredClone(selection);
    expect(selection.operations.map(op => op.source_scope)).toEqual([
      'O Ivo Freitas pediu para cancelar terça às 11h porque terá reunião.',
      'Na vaga dele, põe Escova Expressa para Rosa Viana com Bel.',
    ]);
    const state = await startBatch(actor, selection, row.message);
    expect(state.plan.items[0]).toMatchObject({ key: 'cancel_ivo', operation: 'appointment.cancel', depends_on: [], fields: {
      customer_name: 'Ivo Freitas', date: '2027-06-15', time: '11:00', reason: 'porque terá reunião',
    } });
    expect(state.plan.items[1]).toMatchObject({ key: 'create_rosa', depends_on: ['cancel_ivo'], released_slot_of: 'cancel_ivo', fields: {
      customer_name: 'Rosa Viana', service_name: 'Escova Expressa', professional_name: 'Bel', destination_mode: 'SAME_RELEASED_SLOT',
    } });
    expect(state.plan.items[1].fields.date).toBeUndefined(); expect(state.plan.items[1].fields.time).toBeUndefined();
    for (const item of state.plan.items) {
      expect(item.fields).not.toHaveProperty('source_scope'); expect(item.fields).not.toHaveProperty('temporal_evidence');
    }
    expect(state.draft?.status).toBe('NEEDS_INPUT'); expect(io.upsert).toHaveBeenCalledOnce();
    expect(selection).toEqual(original);
  });
  it.each([null, undefined])('keeps legacy neutral source scope %s valid', async source_scope => {
    const { selection, row } = await consumedSelection();
    selection.operations = selection.operations.map(op => ({ ...op, source_scope })) as CapabilitySelection['operations'];
    const state = await startBatch(actor, selection, row.message);
    expect(state.plan.items.map(item => item.fields.customer_name)).toEqual(['Ivo Freitas', 'Rosa Viana']);
    expect(io.upsert).toHaveBeenCalledOnce();
  });
  it.each([
    { unknown_transport: null }, { customer_ref: 'forged-ref' }, { priceCents: 0 },
    { requested_fields: ['phone'] }, { time: '27:00' }, { override_requested: 'true' },
  ])('rejects unsupported keys or values before persistence: %j', async fields => {
    const { selection, row } = await consumedSelection();
    Object.assign(selection.operations[0], fields);
    await expect(startBatch(actor, selection, row.message)).rejects.toThrow();
    expect(io.upsert).not.toHaveBeenCalled();
  });
  it('keeps dependency validation fail closed after projecting the envelope', async () => {
    const { selection, row } = await consumedSelection();
    selection.operations[1].released_slot_of = 'unknown_cancel';
    await expect(startBatch(actor, selection, row.message)).rejects.toThrow('UNSUPPORTED_BATCH');
    expect(io.upsert).not.toHaveBeenCalled();
  });
  it('keeps overlap feature admission before persistence', async () => {
    const { selection, row } = await consumedSelection();
    vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'false');
    // 2026-09-27: SAME_RELEASED_SLOT restates the historical T21 v1 default and no
    // longer requires the overlap feature. A real exception is still refused first.
    Object.assign(selection.operations[1], { destination_mode: 'ALTERNATIVE_SLOT' });
    await expect(startBatch(actor, selection, row.message)).rejects.toThrow('SCHEDULING_OVERLAP_DISABLED');
    expect(io.upsert).not.toHaveBeenCalled();
    Object.assign(selection.operations[1], { destination_mode: 'SAME_RELEASED_SLOT', override_requested: true });
    await expect(startBatch(actor, selection, row.message)).rejects.toThrow(/SCHEDULING_OVERLAP_DISABLED|OVERRIDE_INTENT_NOT_GROUNDED/);
    expect(io.upsert).not.toHaveBeenCalled();
  });
  it('does not let source_scope bypass factual temporal evidence', async () => {
    const { selection, row } = await consumedSelection();
    Object.assign(selection.operations[0], { weekday: 6 });
    const state = await startBatch(actor, selection, row.message);
    expect(state.plan.items[0].fields.date).toBeUndefined();
    expect(state.plan.items[0].temporal_missing).toContain('date');
    expect(state.proposal).toBeUndefined();
  });
  it('does not let source_scope authorize an invented cancellation reason', async () => {
    const { selection, row } = await consumedSelection();
    Object.assign(selection.operations[0], { reason: 'porque foi cobrado errado' });
    const state = await startBatch(actor, selection, row.message);
    expect(state.plan.items[0].fields.reason).toBeUndefined();
    expect(state.plan.items[0].source_missing).toContain('reason');
    expect(state.proposal).toBeUndefined();
  });
});
