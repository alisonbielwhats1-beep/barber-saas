import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Offline only (like the salon-hours and day-anchor harness tests): the database is an in-memory store behind the Prisma calls
// the harness makes, the secretary and the shared client are replaced, and no request reaches the network. The product side is
// the real appointment-service.ts createAppointment over a fake transaction (as in appointment-service.test.ts).
const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { dir: '', appointments: [] as Row[], items: [] as Row[], names: new Map<string, string>(), calls: [] as string[], queries: [] as Row[] };
  const reset = () => { state.appointments = []; state.items = []; state.names = new Map(); state.calls = []; state.queries = []; };
  const table = (name: string) => ({
    create: async ({ data }: { data: Row }) => { state.calls.push(`${name}.create`); if (name === 'appointment') state.appointments.push({ ...data }); return { ...data }; },
    // A heap has no order: rows come back reversed unless the query orders them.
    createMany: async ({ data }: { data: Row[] }) => { state.calls.push(`${name}.createMany`); if (name === 'appointmentService') state.items.push(...[...data].reverse().map(d => ({ ...d }))); return { count: data.length }; },
    deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }), findFirst: async () => null,
    findMany: async (args: Row = {}) => {
      if (name === 'appointmentService') return state.items.filter(i => i.salonId === args.where?.salonId).sort((a, b) => a.appointmentId.localeCompare(b.appointmentId) || a.position - b.position);
      if (name !== 'appointment') return [];
      state.queries.push(args);
      const byPosition = args.include?.serviceItems?.orderBy?.position === 'asc';
      return state.appointments.filter(a => a.salonId === args.where?.salonId).sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).map(a => ({ ...a,
        client: { name: state.names.get(a.clientId) }, professional: { user: { name: state.names.get(a.professionalId) } },
        serviceItems: state.items.filter(i => i.appointmentId === a.id).sort((x, y) => byPosition ? x.position - y.position : 0).map(i => ({ serviceName: i.serviceName })) }));
    },
  });
  const admin: any = new Proxy({}, { get: (_t, prop) => prop === '$transaction' ? async (cb: (tx: unknown) => unknown) => { state.calls.push('$transaction'); return cb(admin); }
    : prop === '$executeRaw' ? async () => { state.calls.push('$executeRaw'); return 0; } : prop === '$disconnect' ? async () => {} : prop === 'then' || typeof prop === 'symbol' ? undefined : table(String(prop)) });
  /** What seedFreeUseFixture leaves for the projection: entity names and each fixture appointment with its ONE service row. */
  const remember = (identity: { tenant: string; bindings: Record<string, string> }, f: any) => {
    for (const c of f.customers) state.names.set(identity.bindings['customer:' + c.key], c.name);
    for (const p of f.professionals) state.names.set(identity.bindings['professional:' + p.key], p.name);
    for (const a of f.appointments) {
      const svc = f.services.find((x: Row) => x.key === a.serviceKey), id = identity.bindings['appointment:' + a.key], startAt = new Date(a.startAt);
      state.appointments.push({ id, salonId: identity.tenant, clientId: identity.bindings['customer:' + a.customerKey], professionalId: identity.bindings['professional:' + a.professionalKey],
        serviceId: identity.bindings['service:' + a.serviceKey], startAt, endAt: new Date(startAt.getTime() + svc.durationMin * 60000), priceCents: svc.priceCents, status: a.status });
      state.items.push({ appointmentId: id, salonId: identity.tenant, serviceId: identity.bindings['service:' + a.serviceKey], position: 0, serviceName: svc.name, durationMin: svc.durationMin, priceCents: svc.priceCents });
    }
  };
  return { state, reset, admin, remember };
});
vi.mock('@prisma/client', async original => ({ ...await original<object>(), PrismaClient: class { constructor() { return h.admin; } } }));
vi.mock('../prisma', () => ({ prisma: { $disconnect: async () => {} } }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-database', () => ({ assertFreeUseDatabase: async () => ({ database: 'synthetic-disposable' }) }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-fixture', async original => {
  const actual = await original<typeof import('../../../packages/salon-secretary/evaluation/free-use-fixture')>();
  return { ...actual, seedFreeUseFixture: async (_admin: unknown, namespace: string, caseId: string, fixture: never) => {
    const identity = actual.fixtureIdentity(namespace, caseId, fixture); h.remember(identity, fixture); return identity;
  } };
});
vi.mock('../../../packages/salon-secretary/evaluation/agenda-practice-lib', async original => {
  const actual = await original<typeof import('../../../packages/salon-secretary/evaluation/agenda-practice-lib')>();
  return { ...actual, stageJournalPath: (_root: string, stage: string) => { if (!h.state.dir) throw Error('TEST_DIR_UNSET'); return join(h.state.dir, actual.agendaStage(stage).journal); } };
});
vi.mock('../../../packages/salon-secretary/evaluation/program-spend', async original => {
  const actual = await original<typeof import('../../../packages/salon-secretary/evaluation/program-spend')>();
  return { ...actual, programSpendLedgerPath: () => { if (!h.state.dir) throw Error('TEST_DIR_UNSET'); return join(h.state.dir, actual.PROGRAM_SPEND_BASENAME); } };
});
vi.mock('../salon-secretary', () => ({ SalonSecretary: class {
  async start() { return { sessionId: 'session', message: 'Olá!', capability_status: 'CONVERSATION', operations: [] }; }
  async send() { return { sessionId: 'session', message: 'Certo.', capability_status: 'CONVERSATION', operations: [] }; }
} }));
import type { Tx } from '../prisma-tenant';
import { createAppointment } from '../appointment-service';
import { runAgendaPractice, tenantState } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { MULTI_SERVICE_SEED_VERSION, buildScenarioFixture, compareFinal, fixtureEntityId, renderFinal, type AgendaClock, type AgendaScenario, type ScenarioAppointment }
  from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { multiServiceRows, seedMultiServiceAppointments } from '../../../packages/salon-secretary/evaluation/agenda-practice-seed';
import { fixtureIdentity } from '../../../packages/salon-secretary/evaluation/free-use-fixture';

const MONDAY = '2026-09-28', NS = 'unit-multi', HOURS = [2, 3, 4, 5, 6].flatMap(weekday => [{ weekday, from: '09:00', to: '12:00' }, { weekday, from: '13:00', to: '18:00' }]);
const multi: ScenarioAppointment = { key: 'ben_qua', customer: 'benedito', professional: 'iara', services: ['limpeza', 'sobrancelha'], day: 'qua', time: '10:00' };
const scenario = (appointments: ScenarioAppointment[] = [multi], id = 'M01'): AgendaScenario => ({ id, title: 'Atendimento com dois serviços', capability: ['read'], noise: false,
  salon: { type: 'estética', services: [{ key: 'limpeza', name: 'Limpeza de Pele', durationMin: 60, priceCents: 12000 }, { key: 'sobrancelha', name: 'Design de Sobrancelha', durationMin: 30, priceCents: 4500 },
    { key: 'massagem', name: 'Massagem Relaxante', durationMin: 50, priceCents: 9000 }], hours: HOURS },
  professionals: [{ key: 'iara', name: 'Iara Nakamura', services: ['Limpeza de Pele', 'Design de Sobrancelha'] }, { key: 'otavio', name: 'Otávio Lemos', services: ['Massagem Relaxante'] }],
  customers: [{ key: 'benedito', name: 'Benedito Arruda' }, { key: 'zuleica', name: 'Zuleica Paixão' }], appointments,
  steps: [{ say: 'como ta a agenda da iara na quarta', expect: 'READ_DONE' }], final: { unchanged: true } });
const LINE = 'Benedito Arruda | Limpeza de Pele+Design de Sobrancelha | 2026-09-30 10:00→11:30 | Iara Nakamura | CONFIRMED';
function seeded(s = scenario()) {
  const { fixture, multiService } = buildScenarioFixture(s, MONDAY), identity = fixtureIdentity(NS, s.id, fixture);
  h.remember(identity, fixture);
  return { fixture, multiService, identity, scope: { namespace: NS, caseId: s.id } };
}
/** The product's own booking of the same visit: createAppointment (the create the Secretary's createVisit makes for one professional). */
async function productBooking(fixture: ReturnType<typeof seeded>['fixture'], identity: ReturnType<typeof seeded>['identity'], serviceKeys: string[]) {
  const bind = (k: string) => identity.bindings[k];
  // A fixture-seeded "Service" row as the DB returns it (stage and price terms at their defaults).
  const catalog = fixture.services.map(x => ({ id: bind('service:' + x.key), name: x.name, durationMin: x.durationMin, priceCents: x.priceCents, priceType: 'FIXED', priceNote: null,
    processingMin: 0, finishingMin: 0, physicalResourceId: null }));
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'product-appointment', startAt: data.startAt as Date, endAt: data.endAt as Date, version: 1,
    clientId: data.clientId as string, professionalId: data.professionalId as string }));
  const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    salon: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo', minBookingLeadMinutes: 0, maxBookingLeadDays: 365, bufferMinutes: 0, cancelPolicyHours: 2 }) },
    service: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => catalog.filter(x => where.id.in.includes(x.id)).reverse()) }, // out of order on purpose
    waitlistOffer: { findFirst: vi.fn().mockResolvedValue(null) }, servicePricingRule: { findFirst: vi.fn().mockResolvedValue(null) },
    professionalService: { findMany: vi.fn(async ({ where }: { where: { serviceId: { in: string[] } } }) => fixture.services.filter(x => x.professionalKeys.includes('iara'))
      .map(x => ({ serviceId: bind('service:' + x.key) })).filter(x => where.serviceId.in.includes(x.serviceId))) },
    workingHours: { findMany: vi.fn().mockResolvedValue([{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1080 }]) },
    professionalOpening: { findMany: vi.fn().mockResolvedValue([]) }, salonClosure: { findFirst: vi.fn().mockResolvedValue(null) }, timeOff: { findFirst: vi.fn().mockResolvedValue(null) },
    appointment: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null), create }, appointmentService: { createMany },
    clientProfile: { findFirst: vi.fn().mockResolvedValue({ id: bind('customer:benedito') }) }, membership: { findMany: vi.fn().mockResolvedValue([{ userId: identity.actor }]) },
    professional: { findFirst: vi.fn().mockResolvedValue({ userId: 'pro-user' }) },
    appointmentEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'event' }) },
    notificationOutbox: { createMany: vi.fn().mockResolvedValue({ count: 2 }) }, auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) } };
  await createAppointment(tx as unknown as Tx, { salonId: identity.tenant, professionalId: bind('professional:iara'), clientId: bind('customer:benedito'),
    serviceIds: serviceKeys.map(k => bind('service:' + k)), startLocal: '2026-09-30T10:00', origin: 'ADMIN', actor: { type: 'STAFF', id: identity.actor, name: 'Secretária — equipe autenticada' },
    idempotencyKey: 'visit:unit:0', enforceBookingWindow: false });
  expect(create).toHaveBeenCalledOnce(); expect(createMany).toHaveBeenCalledOnce();
  return { appointment: create.mock.calls[0][0].data, services: createMany.mock.calls[0][0].data as Record<string, unknown>[] };
}
beforeEach(() => { h.reset(); vi.stubEnv('MERCADOPAGO_BILLING_ENABLED', 'false'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (h.state.dir) rmSync(h.state.dir, { recursive: true, force: true }); h.state.dir = ''; });

describe('agenda practice: a seeded multi-service appointment is stored like one the product creates', () => {
  it('one appointment (first service, summed duration and price, CONFIRMED) and one service row per position, as createAppointment writes them', async () => {
    const { fixture, multiService, identity, scope } = seeded();
    const ids = await seedMultiServiceAppointments(h.admin, identity, scope, fixture, multiService);
    const id = fixtureEntityId(NS, 'M01', 'appointment:ben_qua');
    expect(ids).toEqual([id]);
    expect(h.state.calls).toEqual(['$transaction', '$executeRaw', '$executeRaw', 'appointment.create', 'appointmentService.createMany']); // tenant context, then the product's order
    const [row] = multiServiceRows(fixture, multiService, identity, scope), product = await productBooking(fixture, identity, ['limpeza', 'sobrancelha']);
    const columns = ['salonId', 'clientId', 'professionalId', 'serviceId', 'startAt', 'endAt', 'priceCents', 'status', 'timezone', 'origin'] as const;
    const pick = (x: Record<string, unknown>) => Object.fromEntries(columns.map(k => [k, x[k]]));
    expect(pick(row.appointment)).toEqual(pick(product.appointment));
    expect(row.appointment).toMatchObject({ serviceId: identity.bindings['service:limpeza'], startAt: new Date('2026-09-30T13:00:00.000Z'), endAt: new Date('2026-09-30T14:30:00.000Z'),
      priceCents: 16500, status: 'CONFIRMED', timezone: 'America/Sao_Paulo', origin: 'ADMIN', id, version: 1 });
    // Only the product's idempotency bookkeeping differs; its other columns are the DB defaults the seeded row keeps.
    expect(Object.keys(product.appointment).filter(k => !(k in row.appointment)).sort()).toEqual(['idempotencyFingerprint', 'idempotencyKey', 'isOverbooked', 'notes', 'seriesId']);
    expect(product.appointment).toMatchObject({ notes: null, isOverbooked: false, seriesId: null });
    // The service rows are identical, column for column (serviceId, position order, name, duration, stages, price and price terms).
    expect(product.services.map(x => ({ ...x, appointmentId: id }))).toEqual(row.services);
    expect(row.services.map(x => [x.position, x.serviceName, x.durationMin, x.priceCents])).toEqual([[0, 'Limpeza de Pele', 60, 12000], [1, 'Design de Sobrancelha', 30, 4500]]);
    // The order is the scenario's: the reversed list is another booking (first service, row order), same total.
    const [reversed] = multiServiceRows(fixture, [{ ...multiService[0], serviceKeys: ['sobrancelha', 'limpeza'] }], identity, scope);
    const productReversed = await productBooking(fixture, identity, ['sobrancelha', 'limpeza']);
    expect(pick(reversed.appointment)).toEqual(pick(productReversed.appointment));
    expect(productReversed.services.map(x => ({ ...x, appointmentId: id }))).toEqual(reversed.services);
    expect(reversed.appointment.serviceId).toBe(identity.bindings['service:sobrancelha']);
  });

  it('the runner projection prints it as "A+B" in position order, identical for the seeded and the product-created booking, and the final oracle reads it', async () => {
    const { fixture, multiService, identity, scope } = seeded();
    await seedMultiServiceAppointments(h.admin, identity, scope, fixture, multiService);
    const mine = await tenantState(h.admin, identity.tenant);
    expect(mine.appointments).toEqual([LINE]);
    expect(h.state.queries[0].include.serviceItems).toEqual({ select: { serviceName: true }, orderBy: { position: 'asc' } });
    // The same visit booked by the product, stored under the same id: same line and same appointment_services digest.
    const product = await productBooking(fixture, identity, ['limpeza', 'sobrancelha']), id = fixtureEntityId(NS, 'M01', 'appointment:ben_qua'), names = h.state.names;
    h.reset(); h.state.names = names;
    h.state.appointments.push({ ...product.appointment, id });
    h.state.items.push(...[...product.services].reverse().map(x => ({ ...x, appointmentId: id })));
    const theirs = await tenantState(h.admin, identity.tenant);
    expect(theirs.appointments).toEqual(mine.appointments);
    expect(theirs.effects.appointment_services).toBe(mine.effects.appointment_services);
    // The final oracle already renders multi-service rows as "A+B": an oracle naming the booking that way matches it.
    const keep = renderFinal({ appointments: [{ customer: 'Benedito Arruda', service: 'Limpeza de Pele+Design de Sobrancelha', day: 'qua', time: '10:00', end: '11:30', professional: 'Iara Nakamura' }] }, MONDAY);
    expect(compareFinal(keep, mine, mine)).toMatchObject({ ok: true, why: [], safety: [] });
    // Removing one service: the remaining booking is "A" ending after A alone, and the "A+B" row is gone.
    const removed = { ...mine, appointments: ['Benedito Arruda | Limpeza de Pele | 2026-09-30 10:00→11:00 | Iara Nakamura | CONFIRMED'] };
    const target = renderFinal({ appointments: [{ customer: 'Benedito Arruda', service: 'Limpeza de Pele', day: 'qua', time: '10:00', end: '11:00', professional: 'Iara Nakamura' }] }, MONDAY);
    expect(compareFinal(target, removed, mine).ok).toBe(true);
    expect(compareFinal(target, mine, mine)).toMatchObject({ ok: false, why: ['MISSING Benedito Arruda | Limpeza de Pele | 2026-09-30 10:00→11:00 | Iara Nakamura | CONFIRMED', `EXTRA ${LINE}`] });
  });

  it('fails closed like the product would refuse the booking, and does nothing without multi-service seeds', async () => {
    const { fixture, multiService, identity, scope } = seeded();
    const seed = multiService[0], bad = (patch: Partial<typeof seed>) => () => multiServiceRows(fixture, [{ ...seed, ...patch }], identity, scope);
    expect(bad({ serviceKeys: ['limpeza', 'peeling'] })).toThrow('AGENDA_MULTI_SERVICE_SEED:SERVICE');
    expect(bad({ serviceKeys: ['limpeza', 'limpeza'] })).toThrow('AGENDA_MULTI_SERVICE_SEED:DUPLICATE');
    expect(bad({ serviceKeys: ['limpeza'] })).toThrow('AGENDA_MULTI_SERVICE_SEED:COUNT');
    expect(bad({ serviceKeys: ['limpeza', 'sobrancelha', 'massagem', 'limpeza', 'sobrancelha'] })).toThrow('AGENDA_MULTI_SERVICE_SEED:COUNT');
    expect(bad({ serviceKeys: ['limpeza', 'massagem'] })).toThrow('AGENDA_MULTI_SERVICE_SEED:ELIGIBILITY'); // PRO_SERVICE_MISMATCH in the product
    expect(bad({ customerKey: 'ninguem' })).toThrow('AGENDA_MULTI_SERVICE_SEED:RELATION');
    expect(() => multiServiceRows(fixture, [seed, seed], identity, scope)).toThrow('AGENDA_MULTI_SERVICE_SEED:KEY');
    expect(() => multiServiceRows(fixture, [seed], identity, { namespace: NS, caseId: 'OTHER' })).toThrow('AGENDA_MULTI_SERVICE_SEED:SCOPE');
    const clash = seeded(scenario([{ key: 'ben_qua', customer: 'zuleica', professional: 'iara', service: 'sobrancelha', day: 'qua', time: '14:00' }], 'M02'));
    expect(() => multiServiceRows(clash.fixture, [{ ...seed }], clash.identity, clash.scope)).toThrow('AGENDA_MULTI_SERVICE_SEED:KEY'); // collides with a fixture appointment
    await expect(seedMultiServiceAppointments(h.admin, identity, scope, fixture, [{ ...seed, serviceKeys: ['limpeza', 'massagem'] }])).rejects.toThrow('AGENDA_MULTI_SERVICE_SEED:ELIGIBILITY');
    h.state.calls = [];
    expect(await seedMultiServiceAppointments(h.admin, identity, scope, fixture, [])).toEqual([]);
    expect(h.state.calls).toEqual([]); // no transaction for every scenario without `services`
  });
});

describe('agenda practice runner: multi-service seeds end to end (offline)', () => {
  it('seeds it after the fixture, records the seed format and projects it as "A+B" in the initial state next to single-service rows', async () => {
    h.state.dir = mkdtempSync(join(tmpdir(), 'agenda-multi-service-'));
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('NETWORK_FORBIDDEN'); }));
    const clock: AgendaClock = { now: () => new Date('2026-09-28T15:00:00.000Z'), sleep: async () => {} }; // Monday noon in São Paulo
    const zuleica: ScenarioAppointment = { key: 'zu_qua', customer: 'zuleica', professional: 'iara', service: 'sobrancelha', day: 'qua', time: '14:00' };
    const out = join(h.state.dir, 'run-unit');
    const report = await runAgendaPractice([scenario([multi, zuleica]), scenario([zuleica], 'S01')], out, { stage: 'reliability-20260927', clock });
    expect(report).toMatchObject({ status: 'COMPLETE' });
    const file = (id: string) => JSON.parse(readFileSync(join(out, 'k1', `${id}.json`), 'utf8'));
    const m01 = file('M01'), s01 = file('S01');
    expect(m01.seedFormat).toEqual({ multiService: MULTI_SERVICE_SEED_VERSION });
    expect(m01.initial.appointments).toEqual([LINE, 'Zuleica Paixão | Design de Sobrancelha | 2026-09-30 14:00→14:30 | Iara Nakamura | CONFIRMED']);
    expect(m01.transcript.at(-1).db.appointments).toEqual(m01.initial.appointments);
    expect('seedFormat' in s01).toBe(false); // a scenario without `services` records exactly what it recorded before
    expect(s01.initial.appointments).toEqual(['Zuleica Paixão | Design de Sobrancelha | 2026-09-30 14:00→14:30 | Iara Nakamura | CONFIRMED']);
    const writes = h.state.calls.filter(c => c.endsWith('create') || c.endsWith('createMany'));
    expect(writes.filter(c => c.startsWith('appointment'))).toEqual(['appointment.create', 'appointmentService.createMany']); // only M01's multi-service booking
  }, 60_000);
});
