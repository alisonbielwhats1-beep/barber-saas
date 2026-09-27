/** Consumed V230, unchanged recorded provider arguments and original oracle.
 * SDK/coordinator/grounding/batch assessment/journal/proposals remain real.
 * Only factual reads, transaction transport and mutation sinks are simulated. */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import raw from '../../test/fixtures/secretary-batch-v230-consumed.json';
import evidence from '../../test/fixtures/secretary-batch-v230-factual.json';
import type { Tx } from '../prisma-tenant';
import type { SchedulingFields } from '../scheduling-contract';
import type { ServiceActor } from '../service-catalog';
import { turnExpectationSchema } from '../../../packages/salon-secretary/evaluation/free-use-contract';

const io = vi.hoisted(() => ({ tx: null as unknown as Tx, logs: [] as Record<string, unknown>[], authorize: vi.fn(),
  customers: vi.fn(), services: vi.fn(), professionals: vi.fn(), locate: vi.fn(), cancelSnapshot: vi.fn(),
  createSnapshot: vi.fn(), availability: vi.fn(), executeCancel: vi.fn(), executeCreate: vi.fn(), financialQueries: vi.fn() }));
vi.mock('../prisma-tenant', () => ({ withTenant: async (_actor: unknown, work: (tx: Tx) => unknown) => work(io.tx) }));
vi.mock('../customer-catalog', async original => ({ ...await original<object>(), searchSalonCustomer: io.customers }));
vi.mock('../scheduling-catalog', async original => ({ ...await original<object>(), schedulingTimezone: async () => 'America/Sao_Paulo',
  listSchedulingServices: io.services, listSchedulingProfessionals: io.professionals, getSchedulingAvailability: io.availability }));
vi.mock('../scheduling-mutations', async original => ({ ...await original<object>(), authorizeSchedulingOperation: io.authorize,
  locateSchedulingAppointments: io.locate, schedulingActionSnapshot: io.cancelSnapshot, executeSchedulingMutation: io.executeCancel }));
vi.mock('../scheduling-actions', async original => ({ ...await original<object>(), schedulingSnapshot: io.createSnapshot, executeSchedulingCreate: io.executeCreate }));
import { SalonSecretary } from '../salon-secretary';
import { ScriptedServicesModel, call } from '../../test/scripted-services-model';
import { observeView, scoreTurn } from '../../../packages/salon-secretary/evaluation/free-use-score';
import { intent } from '../../test/secretary-capability-plan';

const actor = { salonId: evidence.identity.tenant, userId: evidence.identity.actor };
const fixture = evidence.fixture;
const bindings: Record<string, string> = evidence.identity.bindings;
const ref = (type: string, key: string) => bindings[`${type}:${key}`];
const endLocal = (start: string, minutes: number) => new Date(new Date(start + 'Z').getTime() + minutes * 60000).toISOString().slice(0, 16);
const assertActor = (actual: ServiceActor) => expect(actual).toEqual(actor);
const oldAppointment = fixture.appointments.find(row => row.key === 'ivo_tue')!;
const oldService = fixture.services.find(row => row.key === oldAppointment.serviceKey)!;

function factualCreate(fields: SchedulingFields, options?: { releasedAppointmentId?: string }) {
  const customer = fixture.customers.find(row => ref('customer', row.key) === fields.customer_ref);
  const service = fixture.services.find(row => ref('service', row.key) === fields.service_ref);
  const professional = fixture.professionals.find(row => ref('professional', row.key) === fields.professional_ref);
  if (!customer || !service || !professional || !service.professionalKeys.includes(professional.key)) throw Error('PRO_SERVICE_MISMATCH');
  if (!fields.date || !fields.time) throw Error('NEEDS_INPUT');
  const start = `${fields.date}T${fields.time}`, end = endLocal(start, service.durationMin);
  const utc = new Date(start + '-03:00'), minutes = Number(fields.time.slice(0, 2)) * 60 + Number(fields.time.slice(3));
  if (utc <= new Date() || !fixture.openWeekdays.includes(new Date(fields.date + 'T12:00:00Z').getUTCDay())
    || minutes < fixture.openMinutes || minutes + service.durationMin > fixture.closeMinutes) throw Error('SLOT_CONFLICT');
  const conflict = fixture.appointments.some(row => row.status === 'CONFIRMED' && row.professionalKey === professional.key
    && ref('appointment', row.key) !== options?.releasedAppointmentId && row.startAt.slice(0, 16) < end
    && endLocal(row.startAt.slice(0, 16), fixture.services.find(service => service.key === row.serviceKey)!.durationMin) > start);
  if (conflict) throw Error('SLOT_CONFLICT');
  return { customer_ref: fields.customer_ref, customer_name: customer.name, service_ref: fields.service_ref, service_name: service.name,
    service_revision: '1', professional_ref: fields.professional_ref, professional_name: professional.name,
    date: fields.date, startLocal: start, endLocal: end, timezone: evidence.timezone,
    priceCents: service.priceCents, priceType: 'FIXED', durationMin: service.durationMin, quote: 'backend fixture quote' };
}
beforeEach(() => {
  vi.clearAllMocks(); io.logs = [];
  vi.useFakeTimers(); vi.setSystemTime(new Date(evidence.clock));
  vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'true');
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); }));
  io.authorize.mockImplementation(async (_tx: Tx, actual: ServiceActor) => { assertActor(actual); return 'OWNER'; });
  io.customers.mockImplementation(async (_tx: Tx, actual: ServiceActor, query: string) => {
    assertActor(actual); return fixture.customers.filter(row => row.name.toLowerCase().includes(query.toLowerCase())).map(row => ({ id: ref('customer', row.key), name: row.name }));
  });
  io.services.mockImplementation(async (_tx: Tx, actual: ServiceActor, query: string) => {
    assertActor(actual); return fixture.services.filter(row => row.name.toLowerCase().includes(query.toLowerCase())).map(row => ({ id: ref('service', row.key), name: row.name }));
  });
  io.professionals.mockImplementation(async (_tx: Tx, actual: ServiceActor, query: { query?: string; service_ref?: string }) => {
    assertActor(actual); const service = fixture.services.find(row => ref('service', row.key) === query.service_ref);
    return fixture.professionals.filter(row => (!query.query || row.name.toLowerCase().includes(query.query.toLowerCase()))
      && (!service || service.professionalKeys.includes(row.key))).map(row => ({ id: ref('professional', row.key), name: row.name }));
  });
  io.locate.mockImplementation(async (_tx: Tx, actual: ServiceActor, fields: SchedulingFields) => {
    assertActor(actual); return fixture.appointments.filter(row => row.status === 'CONFIRMED'
      && (!fields.customer_ref || ref('customer', row.customerKey) === fields.customer_ref)
      && (!fields.date || row.startAt.startsWith(fields.date)) && (!fields.time || row.startAt.slice(11, 16) === fields.time))
      .map(row => ({ appointment_ref: ref('appointment', row.key), customer_name: fixture.customers.find(c => c.key === row.customerKey)!.name,
        start_local: row.startAt.slice(0, 16), professional_name: fixture.professionals.find(p => p.key === row.professionalKey)!.name }));
  });
  io.cancelSnapshot.mockImplementation(async (_tx: Tx, actual: ServiceActor, operation: string, fields: SchedulingFields) => {
    assertActor(actual); expect(operation).toBe('appointment.cancel'); expect(fields.appointment_ref).toBe(ref('appointment', 'ivo_tue'));
    const start = oldAppointment.startAt.slice(0, 16), end = endLocal(start, oldService.durationMin);
    return { kind: operation, appointment_ref: fields.appointment_ref, revision: 1,
      customer_ref: ref('customer', 'ivo'), customer_name: 'Ivo Freitas', professional_ref: ref('professional', 'bel'), professional_name: 'Bel',
      timezone: evidence.timezone, startLocal: start, endLocal: end, before_start: start, before_end: end, before_timezone: evidence.timezone,
      priceCents: oldService.priceCents, services: [{ id: ref('service', 'escova'), name: oldService.name, durationMin: oldService.durationMin,
        priceCents: oldService.priceCents, priceType: 'FIXED', priceNote: null, processingMin: 0, finishingMin: 0 }],
      requires_acceptance: false, resource_ids: [], waiting_count: 0, waiting_hash: 'fixture-empty', affected: [] };
  });
  io.createSnapshot.mockImplementation(async (_tx: Tx, actual: ServiceActor, fields: SchedulingFields, _now: Date, options: { releasedAppointmentId?: string }) => {
    assertActor(actual); expect(options.releasedAppointmentId).toBe(ref('appointment', 'ivo_tue')); return factualCreate(fields, options);
  });
  io.availability.mockImplementation(async (_tx: Tx, actual: ServiceActor, fields: SchedulingFields, _now: Date, options: { releasedAppointmentId?: string }) => {
    assertActor(actual); expect(options.releasedAppointmentId).toBe(ref('appointment', 'ivo_tue'));
    const snapshot = factualCreate({ ...fields, customer_ref: ref('customer', 'rosa') }, options);
    return { plan: snapshot, alternatives: [], timezone: evidence.timezone, review: { status: 'AVAILABLE', startLocal: snapshot.startLocal,
      endLocal: snapshot.endLocal, durationMin: snapshot.durationMin, causes: [], conflicts: [], override_allowed: false, missing_fields: [], message: 'Disponível', alternatives: [] } };
  });
  const find = (where: Record<string, unknown>) => io.logs.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  io.tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn(async (query: readonly string[] | { sql?: string }) => {
      const sql = Array.isArray(query) ? query.join('') : (query as { sql?: string }).sql ?? '';
      if (sql.includes('"Membership"')) return [{ role: 'OWNER' }];
      if (sql.includes('xmin::text')) return [{ revision: '1' }];
      if (sql.includes('WITH ranges')) {
        io.financialQueries();
        const dates = (query as { values: unknown[] }).values.filter((value): value is Date => value instanceof Date);
        const payments = fixture.appointments.flatMap(row => row.payment ? [row.payment] : []).filter(row => new Date(row.paidAt) >= dates[0] && new Date(row.paidAt) < dates[1]);
        return [{ label: 'current', revenue: 0n, count: 0n, products: 0n, product_invalid: 0n,
          received: BigInt(payments.reduce((sum, row) => sum + row.amountCents, 0)), payment_count: BigInt(payments.length), payment_invalid: 0n,
          receivable: 0n, unpaid_count: 0n, unpaid_invalid: 0n, snapshot_invalid: 0n, groups: [] }];
      }
      return [{ accessStatus: 'APPROVED', timezone: evidence.timezone, currency: 'BRL' }];
    }),
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { io.logs.push(structuredClone(data)); return data; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => structuredClone(find(where))),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => structuredClone(find(where)[0] ?? null)) },
    service: { findFirstOrThrow: vi.fn(async () => ({ physicalResourceId: null })) },
  } as unknown as Tx;
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled(); expect(io.executeCreate).not.toHaveBeenCalled(); expect(io.executeCancel).not.toHaveBeenCalled();
  expect(io.logs.filter(row => row.action === 'CONFIRMED')).toHaveLength(0);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
const frames = () => raw.rows.map(row => {
  expect(createHash('sha256').update(row.arguments).digest('hex')).toBe(row.argumentsSha256);
  return [{ type: 'function_call' as const, callId: `recorded_${row.turn}`, name: row.tool, arguments: row.arguments }];
});
async function replay(extraFinancial = false, adaptToolName = false) {
  const outputs = frames();
  // Explicit controlled transport-only replay: T1 is fixed and now routes a
  // single ready batch to its adapter, unlike the failed historical T1.
  // The original frames and all argument bytes remain immutable.
  if (adaptToolName) outputs[1][0].name = 'upsert_action_draft';
  if (extraFinancial) {
    // Separate synthetic extension, never reclassified as original V230.
    const parsed = JSON.parse(outputs[0][0].arguments);
    parsed.turn.operations.push(intent('financial.report', { item_key: 'read_received', depends_on: [], financial: { metrics: ['received_revenue'], period: 'last_week' } }));
    outputs[0] = call('select_capabilities', parsed) as typeof outputs[number];
  }
  const model = new ScriptedServicesModel(outputs), secretary = new SalonSecretary(async () => model, () => 'gpt-6-luna', undefined, {}, { enabled: () => true });
  const failures = vi.spyOn(secretary as unknown as { failActionUnit: (...args: unknown[]) => unknown }, 'failActionUnit');
  const session = await secretary.start(actor, 'auto');
  const first = await secretary.send(actor, { sessionId: session.sessionId, message: raw.rows[0].message + (extraFinancial ? ' E consulte quanto recebi na semana passada.' : '') });
  const second = await secretary.send(actor, { sessionId: session.sessionId, message: raw.rows[1].message });
  return { first, second, model, failures };
}

describe('original consumed V230 through SDK, coordinator and real batch journal/proposals', () => {
  it('documents original tool-name replay mismatch fail-closed, without claiming full-byte V230 completion', async () => {
    const { first, second, model, failures } = await replay();
    expect(first.action_plan?.status, JSON.stringify(first)).toBe('READY_FOR_CONFIRMATION');
    expect(second.action_plan?.status).toBe('PARTIAL_FAILURE');
    expect(failures.mock.calls.map(args => args[2]).some(error => error instanceof Error && error.message === 'INTERPRETATION_INVALID')).toBe(true);
    const a = first.operations![0].state.batch!, b = second.operations![0].state.batch!;
    expect(first.action_plan!.actions).toHaveLength(2); expect(second.action_plan!.actions).toHaveLength(2);
    expect(second.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref); expect(second.action_plan!.dependencies).toEqual(first.action_plan!.dependencies);
    expect(b.draft!.draft_ref).toBe(a.draft!.draft_ref); expect(b.draft!.draft_revision).toBe(a.draft!.draft_revision);
    expect(b.plan.items[0]).toEqual(a.plan.items[0]);
    expect(a.proposal?.snapshot?.create).toMatchObject({ customer_ref: ref('customer', 'rosa'), service_ref: ref('service', 'escova'),
      professional_ref: ref('professional', 'bel'), date: '2028-06-13', startLocal: '2028-06-13T11:00', durationMin: 25, priceCents: 4600 });
    expect(b.proposal).toBeUndefined(); expect(b.plan.items).toEqual(a.plan.items);
    expect(model.requests).toHaveLength(2); expect(io.financialQueries).not.toHaveBeenCalled();
    expect(io.logs.filter(row => row.entityType === 'SECRETARY_SCHEDULING_BATCH' && row.action === 'PROPOSAL')).toHaveLength(1);
  });
  it('retains immutable oracle failures for unavailable single-action paths in the batch public view', async () => {
    const { first, second } = await replay(false, true);
    const observations = [observeView(first), observeView(second)];
    const scores = evidence.case.turns.map((turn, index) => scoreTurn(turnExpectationSchema.parse(turn.expect), observations[index], bindings,
      observations[index - 1], { confirmations: 0, operationalWrites: 0, externalMessages: 0 }, turn.message, observations.slice(0, index)));
    const originalPathFailures = ['PROPOSAL:appointment.cancel:action_snapshot.appointment_ref', 'EFFECTIVE:appointment.create:date',
      'PROPOSAL:appointment.create:snapshot.customer_ref', 'PROPOSAL:appointment.create:snapshot.service_ref',
      'PROPOSAL:appointment.create:snapshot.professional_ref', 'PROPOSAL:appointment.create:snapshot.date',
      'PROPOSAL:appointment.create:snapshot.durationMin', 'PROPOSAL:appointment.create:snapshot.priceCents'];
    expect(scores[0].pass).toBe(false); expect(scores[0].failures).toEqual([originalPathFailures[0], originalPathFailures[1], 'EFFECTIVE:appointment.create:time', ...originalPathFailures.slice(2)]);
    expect(scores[1].pass).toBe(false); expect(scores[1].failures).toEqual(originalPathFailures);
    // These automated safety flags remain FAIL. They are projection mismatches,
    // not a new claim that the immutable evaluation passed.
    expect(scores.map(score => score.safety)).toEqual(scores.map(score => score.failures));
  });
  it('controlled transport-only replay keeps original argument bytes while matching the corrected adapter tool', async () => {
    const { first, second, model } = await replay(false, true);
    expect(first.action_plan?.status, JSON.stringify(first)).toBe('READY_FOR_CONFIRMATION');
    expect(second.action_plan?.status, JSON.stringify(second)).toBe('READY_FOR_CONFIRMATION');
    const a = first.operations![0].state.batch!, b = second.operations![0].state.batch!;
    expect(b.plan.items[0]).toEqual(a.plan.items[0]);
    expect(b.proposal?.snapshot?.create).toMatchObject({ customer_ref: ref('customer', 'rosa'), service_ref: ref('service', 'escova'),
      professional_ref: ref('professional', 'bel'), date: '2028-06-13', startLocal: '2028-06-13T11:30', durationMin: 25, priceCents: 4600 });
    expect(b.proposal?.snapshot?.cancel).toEqual(a.proposal?.snapshot?.cancel);
    expect(b.draft!.draft_ref).toBe(a.draft!.draft_ref); expect(b.proposal?.proposal_ref).not.toBe(a.proposal?.proposal_ref);
    expect(b.draft!.draft_revision).toBeGreaterThan(a.draft!.draft_revision); expect(b.proposal?.payload_hash).not.toBe(a.proposal?.payload_hash);
    expect(second.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref); expect(second.action_plan!.dependencies).toEqual(first.action_plan!.dependencies);
    expect(model.requests).toHaveLength(2);
  });
  it('separate synthetic three-action variant preserves an independent factual read across the same scheduling correction', async () => {
    const { first, second, model } = await replay(true, true);
    expect(first.action_plan?.status, JSON.stringify(first)).toBe('READY_FOR_CONFIRMATION');
    expect(second.action_plan?.status, JSON.stringify(second)).toBe('READY_FOR_CONFIRMATION');
    const readBefore = observeView(first).actions.find(action => action.operation === 'financial.report')!;
    const readAfter = observeView(second).actions.find(action => action.operation === 'financial.report')!;
    expect(readBefore.status).toBe('DONE'); expect(readBefore.result).toMatchObject({ metrics: [{ id: 'received_revenue', value: 31050 }] });
    expect(readAfter.result).toEqual(readBefore.result); expect(readAfter.fields).toEqual(readBefore.fields); expect(readAfter.status).toBe('DONE');
    expect(io.financialQueries).toHaveBeenCalledOnce(); expect(model.requests).toHaveLength(2);
    expect(second.action_plan!.actions).toHaveLength(3);
  });
});
