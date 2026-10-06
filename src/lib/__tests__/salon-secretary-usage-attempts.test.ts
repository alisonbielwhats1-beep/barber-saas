import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelCallUsage } from '@everflair/salon-secretary';
import { usageRecorder } from '../salon-secretary-usage';
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../prisma-tenant', () => ({ withTenant: (_actor: unknown, callback: (tx: object) => unknown) => callback({ auditLog: { create: mock.create } }) }));
const actor = { salonId: 'tenant-offline', userId: 'owner-offline' }, sessionId = '10000000-0000-4000-8000-000000000001', runId = '20000000-0000-4000-8000-000000000001';
beforeEach(() => { mock.create.mockReset(); mock.create.mockResolvedValue({}); });
const first = (status: Parameters<typeof modelCallUsage>[1]) => modelCallUsage('gpt-6-luna', status);
const repair = (status: Parameters<typeof modelCallUsage>[1]) => ({ ...first(status), attempt: 2 as const, purpose: 'SOURCE_LITERAL_REPAIR' as const });
describe('durable call identities inside one interpretation run', () => {
  it('writes separate call and terminal IDs for both attempts, retaining the common run/session/tenant', async () => {
    const record = usageRecorder(actor, sessionId, runId, 'gpt-6-luna');
    for (const event of [first('STARTED'), first('SUCCEEDED'), repair('STARTED'), repair('SUCCEEDED')]) await record(event);
    const rows = mock.create.mock.calls.map(([value]) => value.data);
    expect(new Set(rows.map(row => row.id)).size).toBe(4);
    expect(rows[0].entityId).toBe(rows[1].entityId); expect(rows[2].entityId).toBe(rows[3].entityId); expect(rows[0].entityId).not.toBe(rows[2].entityId);
    expect(rows.every(row => row.metadata.run_id === runId && row.metadata.session_id === sessionId && row.metadata.salon_id === actor.salonId)).toBe(true);
    expect(rows.map(row => row.metadata.attempt)).toEqual([1, 1, 2, 2]);
    expect(rows.map(row => row.metadata.purpose)).toEqual(['INTERPRETATION', 'INTERPRETATION', 'SOURCE_LITERAL_REPAIR', 'SOURCE_LITERAL_REPAIR']);
  });
  it('rejects duplicated, reordered or mislabelled attempts before persistence', async () => {
    const record = usageRecorder(actor, sessionId, runId, 'gpt-6-luna');
    await expect(record(repair('STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    await expect(record(first('SUCCEEDED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    await expect(record({ ...first('STARTED'), purpose: 'SOURCE_LITERAL_REPAIR' })).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    expect(mock.create).not.toHaveBeenCalled();
    await record(first('STARTED')); await expect(record(first('STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    await record(first('FAILED')); await expect(record(repair('STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    expect(mock.create).toHaveBeenCalledTimes(2);
  });
  it('failed terminal persistence cannot authorize the second STARTED', async () => {
    const record = usageRecorder(actor, sessionId, runId, 'gpt-6-luna'); await record(first('STARTED'));
    mock.create.mockRejectedValueOnce(Error('AUDIT_DOWN'));
    await expect(record(first('SUCCEEDED'))).rejects.toThrow('AUDIT_DOWN');
    await expect(record(repair('STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID'); expect(mock.create).toHaveBeenCalledTimes(2);
  });
});
