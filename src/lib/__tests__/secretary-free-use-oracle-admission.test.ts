import { afterEach, expect, it, vi } from 'vitest';
const guards = vi.hoisted(() => ({ prismaConstructor: vi.fn(), database: vi.fn(), backup: vi.fn(), seed: vi.fn(), readFile: vi.fn() }));
vi.mock('@prisma/client', async original => ({ ...await original<object>(), PrismaClient: class {
  constructor() { guards.prismaConstructor(); throw Error('DATABASE_CONSTRUCTOR_FORBIDDEN'); }
} }));
vi.mock('../prisma', () => ({ prisma: new Proxy({}, { get() { guards.database(); throw Error('DATABASE_FORBIDDEN'); } }) }));
vi.mock('node:fs/promises', async original => ({ ...await original<object>(), readFile: guards.readFile }));
vi.mock('../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-db', async original => ({ ...await original<object>(), backupPhaseALocalDatabase: guards.backup }));
vi.mock('../../../packages/salon-secretary/evaluation/free-use-fixture', async original => ({ ...await original<object>(), seedFreeUseFixture: guards.seed }));
import { prepareFreeUse } from '../../../packages/salon-secretary/evaluation/free-use-runner';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('actual prepare rejects an impossible oracle before the admin Prisma client, queries, backup, seed or provider dispatch', async () => {
  const env = { APP_ENV: 'test', VERCEL_ENV: 'development', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false',
    SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true',
    DATABASE_URL: 'postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp',
    DIRECT_URL: 'postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp' };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const fetch = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); }); vi.stubGlobal('fetch', fetch);
  const input = { schemaVersion: 1, suiteId: 'invalid-projection', timezone: 'America/Sao_Paulo', clock: '2027-04-12T12:00:00Z',
    fixture: { customers: [], professionals: [], services: [], products: [], appointments: [], openWeekdays: [], openMinutes: 480, closeMinutes: 1080 },
    cases: [{ id: 'Synthetic1', family: 'invalid harness path', criterion: 'Reject before any execution.',
      turns: [{ message: 'Mensagem sintética.', expect: { actions: [{ operation: 'service.change', effective: { service_ref: 'any-value' } }] } }] }] };
  const bytes = JSON.stringify(input); guards.readFile.mockResolvedValue(bytes);
  await expect(prepareFreeUse('synthetic-input-not-on-disk.json', 'synthetic-output-not-created')).rejects.toThrow('FREE_USE_ORACLE_PROJECTION_INVALID');
  expect(guards.readFile).toHaveBeenCalledOnce(); expect(JSON.stringify(input)).toBe(bytes);
  expect(guards.prismaConstructor).not.toHaveBeenCalled(); expect(guards.database).not.toHaveBeenCalled();
  expect(guards.backup).not.toHaveBeenCalled(); expect(guards.seed).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
