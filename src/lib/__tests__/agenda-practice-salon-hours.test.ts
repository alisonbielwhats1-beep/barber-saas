import { describe, expect, it, vi } from 'vitest';
// Offline only: the runner module is imported for its hours seeding; the secretary and the shared client are replaced.
vi.mock('../salon-secretary', () => ({ SalonSecretary: class {} }));
vi.mock('../prisma', () => ({ prisma: { $disconnect: async () => {} } }));
import { applyProfessionalHours } from '../../../packages/salon-secretary/evaluation/agenda-practice';
import { buildScenarioFixture, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

const identity = { tenant: 'tenant', actor: 'actor', foreignTenant: 'f', foreignActor: 'fa', bindings: { 'professional:ana': 'pro-ana', 'professional:bia': 'pro-bia', 'professional:rodrigo': 'pro-rodrigo' } };
function fakeAdmin() {
  const calls: { op: string; args: unknown }[] = [];
  const tx = { $executeRaw: vi.fn(async () => 0), workingHours: {
    deleteMany: vi.fn(async (args: unknown) => { calls.push({ op: 'deleteMany', args }); return { count: 1 }; }),
    createMany: vi.fn(async (args: unknown) => { calls.push({ op: 'createMany', args }); return { count: 1 }; }),
    updateMany: vi.fn(async (args: unknown) => { calls.push({ op: 'updateMany', args }); return { count: 1 }; }) } };
  return { admin: { $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx) } as never, calls, tx };
}

describe('runner: salon weekly windows (multi-salon scenarios)', () => {
  it('replaces each professional\'s seeded uniform day with the salon windows (a break = two windows)', async () => {
    const s: AgendaScenario = { id: 'S1', title: 't', capability: ['create'], steps: [{ say: 'x' }],
      salon: { services: [{ key: 'mao', name: 'Mão', durationMin: 40, priceCents: 3000 }], hours: [{ weekday: 2, from: '09:00', to: '12:00' }, { weekday: 2, from: '13:00', to: '18:00' }, { weekday: 6, from: '08:00', to: '13:00' }] },
      professionals: [{ key: 'ana', name: 'Ana Lima' }, { key: 'bia', name: 'Bia Reis', weekdays: [2] }], customers: [{ key: 'cli', name: 'Kelly Moraes' }] };
    const { fixture, hours } = buildScenarioFixture(s, '2026-09-28'), { admin, calls, tx } = fakeAdmin();
    await applyProfessionalHours(admin, identity, hours, fixture.openWeekdays, fixture.openMinutes, fixture.closeMinutes);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2); // tenant and actor context first
    expect(calls).toEqual([
      { op: 'deleteMany', args: { where: { salonId: 'tenant', professionalId: 'pro-ana' } } },
      { op: 'createMany', args: { data: [{ salonId: 'tenant', professionalId: 'pro-ana', weekday: 2, startMinutes: 540, endMinutes: 720 }, { salonId: 'tenant', professionalId: 'pro-ana', weekday: 2, startMinutes: 780, endMinutes: 1080 },
        { salonId: 'tenant', professionalId: 'pro-ana', weekday: 6, startMinutes: 480, endMinutes: 780 }] } },
      { op: 'deleteMany', args: { where: { salonId: 'tenant', professionalId: 'pro-bia' } } },
      { op: 'createMany', args: { data: [{ salonId: 'tenant', professionalId: 'pro-bia', weekday: 2, startMinutes: 540, endMinutes: 720 }, { salonId: 'tenant', professionalId: 'pro-bia', weekday: 2, startMinutes: 780, endMinutes: 1080 }] } },
    ]);
    expect(tx.workingHours.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the legacy per-professional path unchanged for base-fixture scenarios', async () => {
    const s: AgendaScenario = { id: 'S2', title: 't', capability: ['create'], steps: [{ say: 'x' }], professionals: [{ key: 'rodrigo', name: 'Rodrigo Lima', weekdays: [1, 2], from: '10:00' }] };
    const { fixture, hours } = buildScenarioFixture(s, '2026-09-28'), { admin, calls } = fakeAdmin();
    expect(hours).toEqual([{ key: 'rodrigo', weekdays: [1, 2], fromMinutes: 600 }]);
    await applyProfessionalHours(admin, identity, hours, fixture.openWeekdays, fixture.openMinutes, fixture.closeMinutes);
    expect(calls).toEqual([
      { op: 'deleteMany', args: { where: { salonId: 'tenant', professionalId: 'pro-rodrigo', weekday: { notIn: [1, 2] } } } },
      { op: 'updateMany', args: { where: { salonId: 'tenant', professionalId: 'pro-rodrigo' }, data: { startMinutes: 600 } } },
    ]);
  });

  it('fails closed on an unknown professional binding', async () => {
    const { admin } = fakeAdmin();
    await expect(applyProfessionalHours(admin, identity, [{ key: 'ghost', windows: [] }], [1], 540, 1140)).rejects.toThrow('AGENDA_PROFESSIONAL_BINDING');
  });
});
