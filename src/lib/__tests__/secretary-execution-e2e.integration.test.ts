import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertMvpTestDatabase } from '../../../scripts/service-mvp-test-safety';
import { assertFreeUseDatabase } from '../../../packages/salon-secretary/evaluation/free-use-database';
import { createHash } from 'node:crypto';
import { prisma } from '../prisma';
import { withTenant } from '../prisma-tenant';
import { SalonSecretary, type SecretaryView } from '../salon-secretary';
import { FakeCommunicationProvider } from '../communication-provider';
import { confirmServiceCreate, upsertActionDraft } from '../service-create-mvp';
import { confirmStockMovement } from '../inventory-actions';
import { confirmAppointmentCreate } from '../scheduling-actions';
import { confirmActionBatch } from '../scheduling-batch';
import * as visit from '../visit-scheduling';
import * as inventoryMetrics from '../secretary-inventory';
import { ScriptedServicesModel, call } from '../../test/scripted-services-model';
import { intent, plan } from '../../test/secretary-capability-plan';
import { snapshotDatabase, assertEffects, hashes, saveEvidence, digest, type Snapshot } from '../../test/secretary-execution-evidence';
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc } from '../time';
import type { ActionPlan } from '@everflair/salon-secretary';
import executionSource from '../../test/fixtures/secretary-execution-source.json';

const suite = process.env.RUN_SECRETARY_EXECUTION_E2E === '1' ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
const tz = 'America/Sao_Paulo';
const approval = (p: ActionPlan, i = 0) => ({ plan_ref: p.plan_ref, revision: p.revision,
  group_key: p.confirmation_groups[i].key, fingerprint: p.confirmation_groups[i].fingerprint });
const pi = (p: { proposal_ref: string; draft_revision: number }) => ({ proposal_ref: p.proposal_ref, draft_revision: p.draft_revision });
const service = (price = 8000, key = 'service') => intent('service.change', { item_key: key, target_name: 'Massagem', priceCents: price });
const stock = () => intent('stock.movement', { item_key: 'stock', inventory: { product_name: 'Shampoo X', mode: 'OUT', quantity: 2 } });
const change = () => intent('appointment.change', { item_key: 'move', customer_name: 'Amanda Souza', source_day_offset: 1, source_time: '10:00', time: '11:00' });
const exact = 'Seu horário foi cancelado. Obrigada!';
const dependency = (message = false, overlap = false) => [
  intent('appointment.cancel', { item_key: 'cancel', customer_name: 'Amanda Souza', day_offset: 1, time: '10:00', reason: 'Pedido da cliente' }),
  intent('appointment.create', { item_key: 'create', depends_on: ['cancel'], released_slot_of: 'cancel', customer_name: 'Fábio Santos', service_name: overlap ? 'Corte Completo' : 'Massagem',
    ...(overlap ? { override_requested: true, override_reason: 'Cliente já está aguardando' } : {}) }),
  ...(message ? [intent('customer.message', { item_key: 'message', depends_on: ['cancel'], communication: {
    recipient_name: 'Amanda Souza', channel: 'WHATSAPP', message_mode: 'EXACT', content: exact } })] : []),
];
async function fixture() {
  const salonId = randomUUID(), date = addCalendarDays(dateKeyInTimeZone(new Date(), tz), 1);
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: 'Tatiana', email: `${salonId}@execution.test`, passwordHash: 'synthetic-no-login' } });
    const denied = await tx.user.create({ data: { name: 'Recepção', email: `denied-${salonId}@execution.test`, passwordHash: 'synthetic-no-login' } });
    await tx.salon.create({ data: { id: salonId, slug: `execution-${salonId}`, name: 'Execution E2E fixture', accessStatus: 'APPROVED', plan: 'PRO', timezone: tz, currency: 'BRL', minBookingLeadMinutes: 0, bufferMinutes: 0 } });
    await tx.membership.createMany({ data: [{ salonId, userId: owner.id, role: 'OWNER' }, { salonId, userId: denied.id, role: 'RECEPTIONIST' }] });
    const amanda = await tx.clientProfile.create({ data: { salonId, name: 'Amanda Souza', phone: '11987654321' } });
    const fabio = await tx.clientProfile.create({ data: { salonId, name: 'Fábio Santos', phone: '11987654322' } });
    const massagem = await tx.service.create({ data: { salonId, name: 'Massagem', priceCents: 10000, durationMin: 30, description: 'Preservar descrição', category: 'Bem-estar', costCents: 700 } });
    const cut = await tx.service.create({ data: { salonId, name: 'Corte Completo', priceCents: 5000, durationMin: 45 } });
    const professional = await tx.professional.create({ data: { salonId, userId: owner.id } });
    await tx.professionalService.createMany({ data: [massagem, cut].map(s => ({ serviceId: s.id, professionalId: professional.id })) });
    await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
    const product = await tx.product.create({ data: { salonId, name: 'Shampoo X', stock: 10, minStock: 2, priceCents: 2000, costCents: 500 } });
    const untouched = await tx.product.create({ data: { salonId, name: 'Condicionador', stock: 7, priceCents: 3000 } });
    const startAt = localDateTimeToUtc(`${date}T10:00`, tz);
    const appointment = await tx.appointment.create({ data: { salonId, clientId: amanda.id, serviceId: massagem.id, professionalId: professional.id,
      startAt, endAt: new Date(+startAt + 30 * 60000), timezone: tz, priceCents: 10000, status: 'CONFIRMED', notes: 'Preservar notas',
      serviceItems: { create: { serviceId: massagem.id, position: 0, serviceName: massagem.name, durationMin: 30, priceCents: 10000 } } } });
    return { actor: { salonId, userId: owner.id }, denied: { salonId, userId: denied.id }, amanda, fabio, massagem, cut, professional, product, untouched, appointment, date };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Permission = NonNullable<Parameters<typeof assertEffects>[3]>;
let registeredCase = 0;
const selectedCases = process.env.EXECUTION_E2E_CASES?.split(',').map(Number);
const caseTest = (title: string, test: () => Promise<void>) => {
  const id = ++registeredCase;
  (selectedCases && !selectedCases.includes(id) ? it.skip : it)(`${id}: ${title}`, test);
};
const fixtureRows = (snapshot: Snapshot, salonId: string) => Object.fromEntries(Object.entries(snapshot)
  .map(([table, rows]) => [table, rows.filter(row => row.salonId === salonId || (table === 'Salon' && row.id === salonId))]));

suite('Secretary execution V1 — actual PostgreSQL, exact effects, no network', () => {
  let f: Fixture, other: Fixture, baseline: Snapshot, cursor: Snapshot, sequence = 0, step = 0;
  const network = vi.fn(() => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); });
  const cases: { case: number; title: string }[] = [];
  beforeAll(async () => {
    expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe('false');
    expect(process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED).toBe('false');
    const proof = JSON.parse(readFileSync(join(process.env.EXECUTION_E2E_OUTPUT!, 'preflight.json'), 'utf8'));
    expect(createHash('sha256').update(readFileSync(proof.dump)).digest('hex')).toBe(proof.sha256);
    await assertMvpTestDatabase(admin);
    saveEvidence('database-preflight', await assertFreeUseDatabase(admin, prisma));
    baseline = await snapshotDatabase(admin); saveEvidence('global-baseline', hashes(baseline));
    vi.stubGlobal('fetch', network);
    other = await fixture();
    expect(await withTenant(other.actor, tx => tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Product"`)).toHaveLength(2);
    expect(await prisma.$queryRaw`SELECT id FROM "Product"`).toEqual([]);
  });
  beforeEach(async context => {
    sequence = Number(context.task.name.split(':')[0]); step = 0; cases.push({ case: sequence, title: context.task.name });
    f = await fixture(); cursor = await snapshotDatabase(admin);
    saveEvidence(`case-${sequence}-baseline`, { tenant: f.actor.salonId, actor: f.actor, hashes: hashes(cursor), rows: fixtureRows(cursor, f.actor.salonId) });
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    // A missing check cannot hide a write. Every test must consume all intended effects.
    if (cursor && f) await check('final-no-extra-effects');
    expect(network).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    try {
      if (baseline) {
        const final = await snapshotDatabase(admin);
        for (const [table, rows] of Object.entries(baseline)) {
          const retained = new Set(final[table].map(digest));
          expect(rows.every(row => retained.has(digest(row))), `BASELINE_CORRUPTION:${table}`).toBe(true);
        }
        saveEvidence('global-final', { tables: hashes(final), legacy_rows_preserved: true, cases, external_calls: network.mock.calls.length,
          flags_final: { paid: false, jev: false, multi_action_v2: false, overlap: false }, topic14: 'COMPLETE' });
      }
    } finally { vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); }
  });
  async function check(label: string, permission: Permission = {}) {
    const after = await snapshotDatabase(admin);
    saveEvidence(`case-${sequence}-${step + 1}-${label}-observation`, { tenant: f.actor.salonId,
      before: hashes(cursor), after: hashes(after), rows: fixtureRows(after, f.actor.salonId), permission });
    const effects = assertEffects(cursor, after, f.actor.salonId, permission);
    saveEvidence(`case-${sequence}-${++step}-${label}`, { tenant: f.actor.salonId, before: hashes(cursor), after: hashes(after), effects });
    cursor = after; return effects;
  }
  async function prepare(operations = [service()], options: { message?: string; max?: number; failProvider?: boolean; replies?: object[] } = {}) {
    const selection = { ...plan(operations), independent: !operations.some(op => 'depends_on' in op && (op as { depends_on: string[] }).depends_on.length) };
    const model = new ScriptedServicesModel([call('select_capabilities', selection), ...(options.replies ?? []).map(reply => call('upsert_action_draft', reply))]);
    const provider = new FakeCommunicationProvider(options.failProvider);
    const secretary = new SalonSecretary(async () => model, () => 'synthetic-execution', provider, {}, { enabled: () => true,
      ...(options.max ? { policy: () => ({ normalReviewMax: options.max!, maxActionsPerConfirmationGroup: options.max! }) } : {}) });
    const session = await secretary.start(f.actor, 'auto');
    const message = options.message ?? executionSource.service;
    const view = await secretary.send(f.actor, { sessionId: session.sessionId, message });
    saveEvidence(`case-${sequence}-proposal`, { input: message, view, model: 'SCRIPTED_LOCAL', paid_calls: 0 });
    await check('proposal-zero-operational-writes');
    return { secretary, view, model, provider, session: session.sessionId };
  }
  const confirm = async (c: Awaited<ReturnType<typeof prepare>>, view = c.view, group = 0) => {
    const request = { actor: f.actor, session: c.session, confirmation: approval(view.action_plan!, group) };
    const ref = `case-${sequence}-confirmation-${randomUUID()}`;
    saveEvidence(`${ref}-request`, request);
    try {
      const result = await c.secretary.confirmActionPlanGroup(f.actor, c.session, request.confirmation);
      saveEvidence(`${ref}-result`, { result }); return result;
    } catch (error) {
      saveEvidence(`${ref}-result`, { error: error instanceof Error ? error.message : String(error) }); throw error;
    }
  };
  const read = () => withTenant(f.actor, tx => tx.appointment.findFirstOrThrow({ where: { id: f.appointment.id, salonId: f.actor.salonId } }));
  const price = () => withTenant(f.actor, tx => tx.service.findFirstOrThrow({ where: { id: f.massagem.id, salonId: f.actor.salonId } }));
  const balance = () => withTenant(f.actor, tx => tx.product.findFirstOrThrow({ where: { id: f.product.id, salonId: f.actor.salonId }, select: { stock: true } }));
  const serviceEffect = (): Permission => ({ updates: { Service: { [f.massagem.id]: ['priceCents', 'updatedAt'] } } });
  const stockEffect = (): Permission => ({ updates: { Product: { [f.product.id]: ['stock', 'updatedAt'] } } });
  function scheduleEffects(outcome: 'move' | 'batch'): Permission {
    return { updates: { Appointment: { [f.appointment.id]: outcome === 'move' ? ['startAt', 'endAt', 'version', 'updatedAt'] : ['status', 'version', 'updatedAt', 'cancelledAt', 'cancelledByType', 'cancelledById', 'cancelledReason'] } },
      // The manual rescheduler rewrites the same composite-key service snapshot.
      // A time-only change has zero net service-row changes, not one new ID.
      inserts: outcome === 'move' ? { AppointmentEvent: 1, NotificationOutbox: 2 } : { Appointment: 1, AppointmentService: 1, AppointmentEvent: 2, NotificationOutbox: 4 } };
  }
  async function receiptAudit(done: SecretaryView) {
    const logs = await withTenant(f.actor, tx => tx.auditLog.findMany({ where: { salonId: f.actor.salonId }, orderBy: { createdAt: 'asc' } }));
    const confirmed = logs.filter(row => /CONFIRMED$/.test(row.action));
    expect(confirmed.length).toBeGreaterThan(0);
    for (const row of confirmed) {
      expect(row.userId).toBe(f.actor.userId); expect(row.createdAt).toBeInstanceOf(Date);
      const metadata = row.metadata as { proposal_ref: string; draft_ref: string; draft_revision: number };
      expect(row.entityId).toBe(metadata.draft_ref);
      expect(logs.find(log => log.id === metadata.proposal_ref)).toBeDefined();
    }
    const planLog = logs.filter(row => row.entityType === 'SECRETARY_OPERATION_PLAN').at(-1)!;
    expect((planLog.metadata as { action_plan: { plan_ref: string } }).action_plan.plan_ref).toBe(done.action_plan!.plan_ref);
    saveEvidence(`case-${sequence}-receipts`, { result: done, confirmed, plan_audit: planLog });
  }

  caseTest('A: service.change uses proposal, changes only price, durable receipt and replay', async () => {
    const c = await prepare([service()], { message: 'Altera a Massagem para R$80.' });
    expect((await price()).priceCents).toBe(10000);
    const proposal = c.view.operations![0].state.proposal!;
    expect(proposal.change?.before.priceCents).toBe(10000);
    const done = await confirm(c); expect(done.action_plan!.status).toBe('DONE');
    expect(done.operations![0].state.receipt?.service).toMatchObject({ id: f.massagem.id, priceCents: 8000 });
    expect((await price()).priceCents).toBe(8000); await check('service-applied', serviceEffect());
    await confirm(c); await check('group-replay');
    const replay = await withTenant(f.actor, tx => confirmServiceCreate(tx, f.actor, pi(proposal)));
    expect(replay.duplicate).toBe(true); await check('durable-replay'); await receiptAudit(done);
    expect(c.model.requests).toHaveLength(1);
  });
  caseTest('confirmation missing, forged, wrong revision, direct-child bypass all blocked', async () => {
    const c = await prepare(), p = c.view.action_plan!, child = c.view.operations![0];
    for (const input of [{}, { ...approval(p), fingerprint: '0'.repeat(64) }, { ...approval(p), revision: p.revision + 1 }])
      await expect(c.secretary.confirmActionPlanGroup(f.actor, c.session, input)).rejects.toThrow();
    await expect(c.secretary.confirm(f.actor, child.operation_ref, pi(child.state.proposal!))).rejects.toThrow('CONFIRMATION_GROUP_REQUIRED');
    await expect(c.secretary.confirmAutomatic(f.actor, c.session, child.operation_ref, pi(child.state.proposal!))).rejects.toThrow('CONFIRMATION_GROUP_REQUIRED');
    await expect(withTenant(f.actor, tx => confirmServiceCreate(tx, f.actor, { proposal_ref: randomUUID(), draft_revision: 1 }))).rejects.toThrow('PROPOSAL_NOT_FOUND');
    expect((await price()).priceCents).toBe(10000);
  });
  caseTest('stale draft R$80 → R$90 invalidates old group and persisted proposal', async () => {
    const c = await prepare([service()], { message: 'Altera a Massagem para R$80.', replies: [{ name: null, durationMin: null, priceCents: 9000 }] }), old = c.view.operations![0].state.proposal!;
    const changed = await c.secretary.send(f.actor, { sessionId: c.session, message: 'Na verdade R$90.' });
    const fresh = changed.operations![0].state.proposal!;
    expect(fresh.draft_ref).toBe(old.draft_ref);
    expect(fresh.draft_revision).toBeGreaterThan(old.draft_revision);
    expect(fresh.proposal_ref).not.toBe(old.proposal_ref);
    expect(fresh.payload_hash).not.toBe(old.payload_hash);
    expect(changed.action_plan!.revision).toBeGreaterThan(c.view.action_plan!.revision);
    saveEvidence('case-3-correction', { old, fresh, view: changed, confirmation: approval(changed.action_plan!) });
    await expect(confirm(c)).rejects.toThrow('CONFIRMATION_STALE');
    await expect(withTenant(f.actor, tx => confirmServiceCreate(tx, f.actor, pi(old)))).rejects.toThrow('REVISION_CONFLICT');
    await check('stale-blocked'); expect((await price()).priceCents).toBe(10000);
    const done = await confirm(c, changed); expect(done.action_plan!.status).toBe('DONE');
    expect((await price()).priceCents).toBe(9000); await check('new-approval-only', serviceEffect());
    expect(done.operations![0].state.receipt?.service).toMatchObject({ id: f.massagem.id, priceCents: 9000 });
    await confirm(c, changed); await check('new-group-replay');
    const replay = await withTenant(f.actor, tx => confirmServiceCreate(tx, f.actor, pi(fresh)));
    expect(replay.duplicate).toBe(true); expect((await price()).priceCents).toBe(9000);
    saveEvidence('case-3-idempotency', replay); await check('new-durable-replay'); await receiptAudit(done);
  });
  caseTest('expired proposal fails safely without an invented success', async () => {
    const c = await prepare(), now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60000);
    try {
      const done = await confirm(c); expect(done.action_plan!.actions[0].status).toBe('FAILED_SAFE');
      expect(done.operations![0].state.receipt).toBeUndefined(); expect(done.message).not.toContain('Serviço alterado');
    } finally { clock.mockRestore(); }
    expect((await price()).priceCents).toBe(10000);
  });
  caseTest('C: inventory 10 → 8; double click and durable concurrent retry never reach 6', async () => {
    const c = await prepare([stock()], { message: 'Dá baixa em 2 unidades do Shampoo X.' }), p = c.view.operations![0].state.inventory!.proposal!;
    const outcomes = await Promise.allSettled([confirm(c), confirm(c)]);
    expect(outcomes.some(r => r.status === 'fulfilled')).toBe(true);
    expect(await balance()).toEqual({ stock: 8 }); await check('stock-once', stockEffect());
    const retries = await Promise.all([1, 2].map(() => withTenant(f.actor, tx => confirmStockMovement(tx, f.actor, pi(p)))));
    expect(retries.every(r => r.duplicate && r.stock === 8)).toBe(true);
    expect(retries[0].receipt_ref).toBe(retries[1].receipt_ref);
    await confirm(c); await check('stock-replays');
    const movement = await withTenant(f.actor, tx => tx.auditLog.findMany({ where: { salonId: f.actor.salonId, action: 'STOCK_ADJUSTED' } }));
    expect(movement).toHaveLength(1); expect(movement[0]).toMatchObject({ userId: f.actor.userId, entityId: f.product.id, reason: 'Ajuste rápido', metadata: { delta: -2, previousStock: 10, newStock: 8 } });
  });
  caseTest('B: appointment 10h → 11h preserves identity, service, duration and receipts', async () => {
    const c = await prepare([change()], { message: 'Muda Amanda de 10h para 11h.' });
    const p = c.view.operations![0].state.scheduling!.proposal!;
    const done = await confirm(c); expect(done.action_plan!.status).toBe('DONE');
    const updated = await read(); expect(updated).toMatchObject({ id: f.appointment.id, clientId: f.amanda.id, professionalId: f.professional.id, serviceId: f.massagem.id, priceCents: 10000, notes: 'Preservar notas' });
    expect(+updated.endAt - +updated.startAt).toBe(30 * 60000); expect(updated.startAt).toEqual(localDateTimeToUtc(`${f.date}T11:00`, tz));
    const serviceSnapshot = await withTenant(f.actor, tx => tx.appointmentService.findMany({ where: { appointmentId: f.appointment.id, salonId: f.actor.salonId } }));
    expect(serviceSnapshot).toEqual(cursor.AppointmentService.filter(row => row.appointmentId === f.appointment.id));
    await check('appointment-applied', scheduleEffects('move'));
    expect((await withTenant(f.actor, tx => confirmAppointmentCreate(tx, f.actor, pi(p)))).duplicate).toBe(true);
    await check('appointment-replay'); await receiptAudit(done);
  });
  caseTest('D: independent actions, approved group only, receipts mapped to each action', async () => {
    const c = await prepare([service(), stock(), intent('service.create', { item_key: 'new', name: 'Barba Expressa', durationMin: 15, priceCents: 2500 })], { max: 2, message: executionSource.grouped });
    expect(c.view.action_plan!.confirmation_groups).toHaveLength(2);
    const first = await confirm(c); expect(first.action_plan!.actions.map(a => a.status)).toEqual(['DONE', 'DONE', 'READY_FOR_CONFIRMATION']);
    await check('first-group-only', { updates: { ...serviceEffect().updates, ...stockEffect().updates } });
    const done = await confirm(c, c.view, 1); expect(done.action_plan!.status).toBe('DONE');
    expect(done.operations![2].state.receipt?.service.name).toBe('Barba Expressa');
    await check('second-group-only', { inserts: { Service: 1 } }); await receiptAudit(done);
  });
  caseTest('E: dependency cancel → create is atomic, ordered and idempotent', async () => {
    const c = await prepare(dependency(), { message: 'Cancele Amanda e coloque Fábio no lugar. Motivo: Pedido da cliente.' }), p = c.view.operations![0].state.batch!.proposal!;
    const done = await confirm(c); expect(done.action_plan!.actions.map(a => a.status)).toEqual(['DONE', 'DONE']);
    const receipt = done.operations![0].state.batch!.receipt!;
    expect(receipt.results.map(r => [r.key, r.outcome])).toEqual([['cancel', 'CANCELLED'], ['create', 'CONFIRMED']]);
    expect((await read()).status).toBe('CANCELLED');
    const created = await withTenant(f.actor, tx => tx.appointment.findFirstOrThrow({ where: { id: receipt.results[1].appointment_ref, salonId: f.actor.salonId } }));
    expect(created).toMatchObject({ clientId: f.fabio.id, professionalId: f.professional.id, startAt: f.appointment.startAt });
    await check('atomic-pair', scheduleEffects('batch'));
    expect((await withTenant(f.actor, tx => confirmActionBatch(tx, f.actor, pi(p)))).duplicate).toBe(true);
    await check('atomic-replay'); await receiptAudit(done);
  });
  caseTest('transaction failure after create rolls back cancellation, creation, events, Outbox and receipt', async () => {
    const c = await prepare(dependency(true), { message: `Cancele Amanda e coloque Fábio. Motivo: Pedido da cliente. Envie exatamente “${exact}”` });
    const real = visit.createVisit;
    const failure = vi.spyOn(visit, 'createVisit').mockImplementationOnce(async (tx, input) => { await real(tx, input); throw Error('SYNTHETIC_TRANSACTION_FAILURE'); });
    let done: SecretaryView;
    try { done = await confirm(c); } finally { failure.mockRestore(); }
    expect(done.action_plan!.actions.map(a => a.status)).toEqual(['FAILED_SAFE', 'BLOCKED_BY_DEPENDENCY', 'BLOCKED_BY_DEPENDENCY']);
    expect(await read()).toEqual(f.appointment); expect(c.provider.calls).toHaveLength(0);
    await check('all-rolled-back');
  });
  caseTest('F: cancel → create and message fan-out; Outbox only after dependency and fake dispatch', async () => {
    const c = await prepare(dependency(true), { message: `Cancele Amanda e coloque Fábio. Motivo: Pedido da cliente. Envie exatamente “${exact}”` });
    expect(c.provider.calls).toHaveLength(0);
    const done = await confirm(c); expect(done.action_plan!.status).toBe('DONE');
    expect(c.provider.calls).toHaveLength(1);
    const receipt = done.operations!.find(op => op.state.communication)!.state.communication!.receipt!;
    const row = await withTenant(f.actor, tx => tx.notificationOutbox.findFirstOrThrow({ where: { id: receipt.message_ref, salonId: f.actor.salonId } }));
    expect(row).toMatchObject({ recipientId: f.amanda.id, channel: 'WHATSAPP', attempts: 1, payload: { provider: 'LOCAL_FAKE', content: exact } });
    expect(done.operations!.find(op => op.state.communication)!.state.communication!.delivery?.external_delivery).toBe(false);
    const permissions = scheduleEffects('batch'); permissions.inserts!.NotificationOutbox = 5;
    await check('fanout-with-fake', permissions); await confirm(c); await check('fanout-replay');
    expect(c.provider.calls).toHaveLength(1); await receiptAudit(done);
  });
  caseTest('TOCTOU: another appointment takes destination before confirmation; original stays intact', async () => {
    const c = await prepare([change()], { message: executionSource.move });
    await admin.appointment.create({ data: { salonId: f.actor.salonId, clientId: f.fabio.id, professionalId: f.professional.id, serviceId: f.massagem.id,
      startAt: localDateTimeToUtc(`${f.date}T11:00`, tz), endAt: localDateTimeToUtc(`${f.date}T11:30`, tz), timezone: tz, priceCents: 10000, status: 'CONFIRMED' } });
    await check('controlled-competing-booking', { inserts: { Appointment: 1 } });
    const done = await confirm(c); expect(done.action_plan!.actions[0].status).toBe('FAILED_SAFE');
    expect(done.operations![0].state.scheduling?.receipt).toBeUndefined(); expect(await read()).toEqual(f.appointment);
    await check('stale-slot-blocked');
  });
  caseTest('partial failure A SUCCESS / B FAILED / C SUCCESS reflects actual receipts', async () => {
    const c = await prepare([service(), stock(), intent('service.create', { item_key: 'new', name: 'Barba Expressa', durationMin: 15, priceCents: 2500 })], { message: executionSource.grouped });
    await admin.product.update({ where: { id: f.product.id }, data: { stock: 1 } });
    await check('controlled-stock-change', stockEffect());
    // B2: per-component groups (runtime default); every ready group is approved explicitly in one call.
    const p = c.view.action_plan!;
    expect(p.confirmation_groups.map(g => g.action_keys)).toHaveLength(3);
    const done = await c.secretary.confirmReadyGroups(f.actor, c.session, p.confirmation_groups.map((_, i) => approval(p, i)));
    saveEvidence(`case-${sequence}-confirmation-ready-groups-result`, { result: done });
    expect(done.action_plan!.status).toBe('PARTIAL_FAILURE');
    expect(done.action_plan!.actions.map(a => a.status)).toEqual(['DONE', 'FAILED_SAFE', 'DONE']);
    expect(done.operations![0].state.receipt).toBeDefined(); expect(done.operations![1].state.inventory?.receipt).toBeUndefined(); expect(done.operations![2].state.receipt).toBeDefined();
    expect(await balance()).toEqual({ stock: 1 }); await check('independent-partial', { ...serviceEffect(), inserts: { Service: 1 } });
    await confirm(c); await check('partial-no-retry'); await receiptAudit(done);
  });
  caseTest('unauthorized role and cross-tenant confirmation denied, runtime RLS positively isolates', async () => {
    const c = await prepare(), p = c.view.operations![0].state.proposal!;
    await expect(c.secretary.confirmActionPlanGroup(f.denied, c.session, approval(c.view.action_plan!))).rejects.toThrow('SESSION_NOT_FOUND');
    await expect(withTenant(f.denied, tx => confirmServiceCreate(tx, f.denied, pi(p)))).rejects.toThrow('FORBIDDEN');
    const foreign = { ...f.actor, salonId: randomUUID() };
    await expect(c.secretary.confirmActionPlanGroup(foreign, c.session, approval(c.view.action_plan!))).rejects.toThrow('SESSION_NOT_FOUND');
    await expect(withTenant(foreign, tx => confirmServiceCreate(tx, foreign, pi(p)))).rejects.toThrow('FORBIDDEN');
    await expect(withTenant(other.actor, tx => confirmServiceCreate(tx, other.actor, pi(p)))).rejects.toThrow('PROPOSAL_NOT_FOUND');
    await expect(withTenant(other.actor, tx => upsertActionDraft(tx, other.actor, { service_ref: f.massagem.id, patch: { priceCents: 1 } }))).rejects.toThrow('SERVICE_NOT_FOUND');
    expect(await withTenant(other.actor, tx => tx.product.updateMany({ where: { id: f.product.id }, data: { stock: 0 } }))).toEqual({ count: 0 });
    expect(await withTenant(f.actor, tx => tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Product"`)).toHaveLength(2);
    expect(await withTenant(foreign, tx => tx.$queryRaw`SELECT id FROM "Product"`)).toEqual([]);
    expect(await prisma.$queryRaw`SELECT id FROM "Product"`).toEqual([]);
    expect(await withTenant(foreign, tx => tx.product.updateMany({ where: { id: f.product.id }, data: { stock: 0 } }))).toEqual({ count: 0 });
  });
  caseTest('validation failure cannot persist a proposal or mutate a service', async () => {
    await expect(withTenant(f.actor, tx => upsertActionDraft(tx, f.actor, { service_ref: f.massagem.id, patch: { priceCents: -1 } }))).rejects.toThrow();
    expect((await price()).priceCents).toBe(10000);
  });
  caseTest('role revoked after proposal blocks execution and replay authorization', async () => {
    const c = await prepare();
    const membership = cursor.Membership.find(row => row.salonId === f.actor.salonId && row.userId === f.actor.userId)!;
    await admin.membership.updateMany({ where: f.actor, data: { role: 'RECEPTIONIST' } });
    await check('controlled-role-revocation', { updates: { Membership: { [String(membership.id)]: ['role'] } } });
    await expect(confirm(c)).rejects.toThrow('FORBIDDEN');
  });
  caseTest('changed service snapshot is revalidated at execution', async () => {
    const c = await prepare();
    await admin.service.update({ where: { id: f.massagem.id }, data: { priceCents: 11000 } });
    await check('controlled-catalog-change', serviceEffect());
    const done = await confirm(c); expect(done.action_plan!.actions[0].status).toBe('FAILED_SAFE');
    expect(done.operations![0].state.receipt).toBeUndefined(); expect((await price()).priceCents).toBe(11000);
  });
  caseTest('fake provider failure preserves business commit and never claims external delivery', async () => {
    const c = await prepare(dependency(true), { failProvider: true, message: `Cancele Amanda e coloque Fábio. Motivo: Pedido da cliente. Envie exatamente “${exact}”` });
    const done = await confirm(c), communication = done.operations!.find(op => op.state.communication)!.state.communication!;
    expect((await read()).status).toBe('CANCELLED');
    expect(communication.receipt?.status).toBe('QUEUED');
    expect(communication.delivery).toMatchObject({ status: 'FAILED', external_delivery: false, attempts: 1 });
    expect(communication.message).toContain('fake falhou');
    const permissions = scheduleEffects('batch'); permissions.inserts!.NotificationOutbox = 5;
    await check('fake-failed-business-preserved', permissions);
  });
  caseTest('post-commit inventory telemetry failure reports committed result, never FAILED_SAFE or double debit', async () => {
    const c = await prepare([stock()], { message: executionSource.stock });
    const proposal = c.view.operations![0].state.inventory!.proposal!;
    const metric = vi.spyOn(inventoryMetrics, 'persistInventoryMetrics').mockRejectedValueOnce(Error('SYNTHETIC_TIMING_FAILURE'));
    let done: SecretaryView;
    try { done = await confirm(c); } finally { metric.mockRestore(); }
    expect(done.action_plan!.status).toBe('DONE');
    expect(done.operations![0].state.execution_warnings).toEqual(['POST_COMMIT_TELEMETRY_UNAVAILABLE']);
    expect(done.operations![0].state.inventory?.receipt?.stock).toBe(8);
    await check('committed-despite-telemetry', stockEffect());
    await confirm(c); expect(await balance()).toEqual({ stock: 8 }); await check('post-commit-replay');
    // Simulate a client that lost the committed response. The durable authority must
    // reconcile from its journal under the draft lock, before calling the mutation.
    const reconciled = await withTenant(f.actor, tx => confirmStockMovement(tx, f.actor, pi(proposal)));
    expect(reconciled.duplicate).toBe(true);
    expect(reconciled.receipt_ref).toBe(done.operations![0].state.inventory!.receipt!.receipt_ref);
    expect(reconciled.stock).toBe(8); expect(await balance()).toEqual({ stock: 8 });
    const movements = await withTenant(f.actor, tx => tx.auditLog.findMany({ where: { salonId: f.actor.salonId, action: 'STOCK_ADJUSTED' } }));
    expect(movements).toHaveLength(1);
    saveEvidence('case-18-reconciliation', { transaction: 'COMMIT_SUCCEEDED', telemetry: 'POST_COMMIT_TECHNICAL_ERROR', reconciled, movements });
    await check('authoritative-reconciliation-no-second-debit'); await receiptAudit(done);
  });
  caseTest('controlled overlap uses manual authority, explicit reason, confirmation and immutable audit', async () => {
    vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'true');
    const neighbor = await admin.appointment.create({ data: { salonId: f.actor.salonId, clientId: f.fabio.id, professionalId: f.professional.id, serviceId: f.massagem.id,
      startAt: localDateTimeToUtc(`${f.date}T10:30`, tz), endAt: localDateTimeToUtc(`${f.date}T11:00`, tz), timezone: tz, priceCents: 10000, status: 'CONFIRMED' } });
    await check('controlled-neighbor', { inserts: { Appointment: 1 } });
    const c = await prepare(dependency(false, true), { message: 'Cancele Amanda a pedido da cliente e coloque Fábio com Corte Completo no lugar. Pode encaixar. Motivo: Cliente já está aguardando.' });
    expect(c.view.action_plan!.status).toBe('READY_FOR_CONFIRMATION');
    expect(c.view.operations![0].state.batch?.proposal?.preview).toContain('ENCAIXE');
    const done = await confirm(c); expect(done.action_plan!.status).toBe('DONE');
    const receipt = done.operations![0].state.batch!.receipt!;
    const created = await withTenant(f.actor, tx => tx.appointment.findFirstOrThrow({ where: { id: receipt.results[1].appointment_ref } }));
    expect(created.isOverbooked).toBe(true);
    const audit = await withTenant(f.actor, tx => tx.auditLog.findFirstOrThrow({ where: { salonId: f.actor.salonId, action: 'APPOINTMENT_OVERRIDE_CREATE', entityId: created.id } }));
    expect(audit).toMatchObject({ userId: f.actor.userId, reason: 'Cliente já está aguardando', metadata: { violation: 'SLOT_TAKEN' } });
    expect(await admin.appointment.findUnique({ where: { id: neighbor.id } })).toEqual(neighbor);
    await check('override-authorized', scheduleEffects('batch'));
  });
  caseTest('HARD_BLOCK salon closure never yields executable override', async () => {
    vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'true');
    await admin.salonClosure.create({ data: { salonId: f.actor.salonId, startAt: localDateTimeToUtc(`${f.date}T09:00`, tz), endAt: localDateTimeToUtc(`${f.date}T18:00`, tz), reason: 'Fechamento sintético' } });
    await check('controlled-hard-block', { inserts: { SalonClosure: 1 } });
    const c = await prepare(dependency(false, true), { message: 'Cancele Amanda a pedido da cliente e coloque Fábio com Corte Completo no lugar. Pode encaixar. Motivo: Cliente já está aguardando.' });
    expect(c.view.operations![0].state.batch?.draft?.review).toMatchObject({ status: 'CONFLICT_HARD_BLOCK', override_allowed: false });
    expect(c.view.operations![0].state.batch?.proposal).toBeUndefined();
    await expect(confirm(c)).rejects.toThrow('PLAN_NOT_READY'); expect(await read()).toEqual(f.appointment);
  });
});
