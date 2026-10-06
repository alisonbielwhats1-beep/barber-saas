import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ search: vi.fn(), confirm: vi.fn(), upsert: vi.fn(), audit: vi.fn(), query: vi.fn() }));
vi.mock('../prisma-tenant', () => ({ withTenant: (_actor: unknown, work: (tx: object) => unknown) => work({ auditLog: { create: ports.audit }, $queryRaw: ports.query }) }));
vi.mock('../service-catalog', async original => ({ ...await original<object>(), assertServiceWriter: async () => ({ currency: 'BRL' }), findCatalogServices: ports.search }));
vi.mock('../service-create-mvp', async original => ({ ...await original<object>(), upsertActionDraft: ports.upsert, confirmServiceCreate: ports.confirm }));
import { SalonSecretary } from '../salon-secretary';
import { ScriptedServicesModel, call } from '../../test/scripted-services-model';
import { intent, plan } from '../../test/secretary-capability-plan';
const actor = { salonId: 'fixture-salon', userId: 'fixture-owner' };
beforeEach(() => {
  vi.clearAllMocks(); ports.audit.mockResolvedValue({});
  ports.query.mockImplementation(async (parts: readonly string[]) => parts.join('').includes('"Membership"') ? [{ role: 'OWNER' }] : [{ accessStatus: 'APPROVED' }]);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each([
  ['same name', ['Corte', 'Corte']],
  ['distinct matching variants', ['Corte Curto', 'Corte Longo']],
] as const)('reports backend entity ambiguity for %s without a draft or confirmation', async (_title, names) => {
  ports.search.mockResolvedValue(names.map((name, i) => ({ id: `candidate-${i}`, name, priceCents: 4000, durationMin: 30 })));
  const model = new ScriptedServicesModel([call('select_capabilities', plan([intent('service.change', { item_key: 'edit', target_name: 'Corte', priceCents: 5500 })]))]);
  const secretary = new SalonSecretary(async () => model, () => 'synthetic', undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, 'auto');
  const view = await secretary.send(actor, { sessionId: session.sessionId, message: 'O corte fica por cinquenta e cinco.' });
  expect(view.operations![0].state.candidates).toHaveLength(2);
  expect(view.action_plan!.actions[0].missing_fields).toContain('selection');
  expect(view.capability_status).toBe('AMBIGUOUS');
  expect(view.action_plan!.confirmation_groups.every(group => group.status !== 'READY_FOR_CONFIRMATION')).toBe(true);
  expect(ports.upsert).not.toHaveBeenCalled(); expect(ports.confirm).not.toHaveBeenCalled();
});

it('does not label a missing entity as a choice among multiple entities', async () => {
  ports.search.mockResolvedValue([]);
  const model = new ScriptedServicesModel([call('select_capabilities', plan([intent('service.change', { item_key: 'edit', target_name: 'Corte', priceCents: 5500 })]))]);
  const secretary = new SalonSecretary(async () => model, () => 'synthetic', undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, 'auto');
  const view = await secretary.send(actor, { sessionId: session.sessionId, message: 'Ajuste o corte para cinquenta e cinco.' });
  expect(view.capability_status).toBe('NEEDS_INPUT');
  expect(ports.upsert).not.toHaveBeenCalled(); expect(ports.confirm).not.toHaveBeenCalled();
});
