/** Pre-existing multi-service appointments of an Agenda practice scenario (ScenarioAppointment.services,
 * MULTI_SERVICE_SEED_VERSION 1), written after the FreeUseFixture exactly as the product stores one. The product path is
 * appointment-service.ts createAppointment (the Secretary's create reaches it through visit-scheduling.ts createVisit: the
 * services of one professional are one group, so one call with every service id, in order):
 *   - ONE "Appointment" row: serviceId = the FIRST service, startAt, endAt = startAt + the SUM of the services' durationMin,
 *     priceCents = the SUM of their prices (priceServicesForDate: a synthetic tenant has no pricing rule, so catalog prices),
 *     status CONFIRMED, the salon timezone, origin ADMIN (a manual/staff create);
 *   - then one "AppointmentService" row per service, position 0..n-1 in the requested order, snapshotting serviceId,
 *     serviceName, durationMin, processingMin/finishingMin (the service's, 0 for a fixture service), priceCents and the
 *     price terms (priceSnapshot: FIXED with a null note for a fixture service).
 * Like every appointment the free-use fixture seeds, a pre-existing booking carries no idempotency key, event, notification
 * or audit row, id = the fixture's deterministic appointment id and version 1. Synthetic tenant of the local disposable DB only. */
import type { PrismaClient } from '@prisma/client';
import type { FixtureIdentity, FreeUseFixture } from './free-use-contract';
import { MULTI_SERVICE_SEED_LIMITS, TZ, fixtureEntityId, type MultiServiceSeed } from './agenda-practice-lib';

export type MultiServiceRows = {
  appointment: { id: string; salonId: string; clientId: string; professionalId: string; serviceId: string; startAt: Date; endAt: Date; priceCents: number; status: 'CONFIRMED';
    timezone: string; origin: 'ADMIN'; version: 1 };
  services: { appointmentId: string; salonId: string; serviceId: string; position: number; serviceName: string; durationMin: number; processingMin: number; finishingMin: number;
    priceCents: number; priceType: 'FIXED'; priceNote: null }[];
};
const refuse = (code: string): never => { throw Error('AGENDA_MULTI_SERVICE_SEED:' + code); };
/** The rows of each seed (pure). Fails closed like the product would refuse the booking: an unknown entity or service, a
 * service the professional does not offer (PRO_SERVICE_MISMATCH), a repeated service, a count outside 2..4 or a key that
 * collides with another seeded appointment. `scope`: the fixture's namespace and case (the appointment id derivation). */
export function multiServiceRows(fixture: FreeUseFixture, seeds: MultiServiceSeed[], identity: Pick<FixtureIdentity, 'tenant' | 'bindings'>, scope: { namespace: string; caseId: string }): MultiServiceRows[] {
  if (seeds.length && identity.tenant !== fixtureEntityId(scope.namespace, scope.caseId, 'tenant')) refuse('SCOPE');
  const keys = new Set(fixture.appointments.map(a => a.key)), bind = (key: string) => identity.bindings[key] ?? refuse('RELATION');
  return seeds.map(seed => {
    if (keys.has(seed.key)) refuse('KEY'); keys.add(seed.key);
    if (seed.status !== 'CONFIRMED') refuse('STATUS');
    const n = seed.serviceKeys.length;
    if (n < MULTI_SERVICE_SEED_LIMITS.min || n > MULTI_SERVICE_SEED_LIMITS.max) refuse('COUNT');
    if (new Set(seed.serviceKeys).size !== n) refuse('DUPLICATE');
    if (!fixture.customers.some(c => c.key === seed.customerKey) || !fixture.professionals.some(p => p.key === seed.professionalKey)) refuse('RELATION');
    const services = seed.serviceKeys.map(k => fixture.services.find(x => x.key === k) ?? refuse('SERVICE'));
    if (services.some(x => !x.professionalKeys.includes(seed.professionalKey))) refuse('ELIGIBILITY');
    const startAt = new Date(seed.startAt);
    if (Number.isNaN(startAt.getTime())) refuse('START');
    const salonId = identity.tenant, appointmentId = fixtureEntityId(scope.namespace, scope.caseId, 'appointment:' + seed.key);
    const durationMin = services.reduce((sum, x) => sum + x.durationMin, 0), priceCents = services.reduce((sum, x) => sum + x.priceCents, 0);
    return {
      appointment: { id: appointmentId, salonId, clientId: bind('customer:' + seed.customerKey), professionalId: bind('professional:' + seed.professionalKey), serviceId: bind('service:' + services[0].key),
        startAt, endAt: new Date(startAt.getTime() + durationMin * 60_000), priceCents, status: 'CONFIRMED', timezone: TZ, origin: 'ADMIN', version: 1 },
      services: services.map((x, position) => ({ appointmentId, salonId, serviceId: bind('service:' + x.key), position, serviceName: x.name, durationMin: x.durationMin,
        processingMin: 0, finishingMin: 0, priceCents: x.priceCents, priceType: 'FIXED', priceNote: null })),
    };
  });
}
/** Seeds them in the scenario's tenant (after seedFreeUseFixture, like applyProfessionalHours), in one transaction under the
 * tenant/actor context: the appointment row first, then its service rows (the product's order). Nothing to seed = no query. */
export async function seedMultiServiceAppointments(admin: Pick<PrismaClient, '$transaction'>, identity: FixtureIdentity, scope: { namespace: string; caseId: string },
  fixture: FreeUseFixture, seeds: MultiServiceSeed[]) {
  if (!seeds.length) return [];
  const rows = multiServiceRows(fixture, seeds, identity, scope);
  await admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${identity.tenant},true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id',${identity.actor},true)`;
    for (const r of rows) {
      await tx.appointment.create({ data: r.appointment });
      await tx.appointmentService.createMany({ data: r.services });
    }
  });
  return rows.map(r => r.appointment.id);
}
