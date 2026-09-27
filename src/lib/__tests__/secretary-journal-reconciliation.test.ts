import { expect, it, vi } from 'vitest';
import { actionJournal, confirmJournalAction } from '../secretary-journal';
import type { Tx } from '../prisma-tenant';

it('a lost post-commit response reconciles the durable receipt before considering another mutation', async () => {
  const actor = { salonId: 'fixture', userId: 'owner' };
  const proposal = { proposal_ref: 'proposal', draft_ref: 'draft', draft_revision: 1,
    payload_hash: 'hash', expires_at: '2099-01-01T00:00:00Z' };
  const draft = { draft_ref: 'draft', draft_revision: 1, expires_at: proposal.expires_at };
  const receipt = { proposal_ref: 'proposal', stock: 8, receipt_ref: 'receipt' };
  const order: string[] = [];
  let persisted: typeof receipt | undefined;
  const tx = {
    $executeRaw: vi.fn(async () => { order.push('lock'); }),
    auditLog: {
      findFirst: vi.fn(async ({ where }: { where: { action: string } }) => {
        order.push(where.action);
        return where.action === 'PROPOSED' ? { entityId: 'draft', metadata: proposal }
          : persisted ? { metadata: persisted } : null;
      }),
      create: vi.fn(async ({ data }: { data: { metadata: typeof receipt } }) => { persisted = data.metadata; }),
    },
  } as unknown as Tx;
  const execute = vi.fn(async () => { order.push('mutation'); return receipt; });
  const config = { journal: actionJournal('TEST_JOURNAL'), proposalAction: 'PROPOSED', confirmedAction: 'CONFIRMED',
    authorize: vi.fn(async () => { order.push('authorize'); }), parseProposal: () => proposal,
    parseReceipt: (value: unknown) => value as typeof receipt, latest: async () => draft,
    proposalHash: () => 'hash', draftHash: () => 'hash', execute };
  const confirm = () => confirmJournalAction(tx, actor, { proposal_ref: 'proposal', draft_revision: 1 }, config);
  await expect((async () => { await confirm(); throw Error('RESPONSE_LOST_AFTER_COMMIT'); })()).rejects.toThrow('RESPONSE_LOST_AFTER_COMMIT');
  order.length = 0;
  expect(await confirm()).toEqual({ ...receipt, duplicate: true });
  expect(order).toEqual(['authorize', 'PROPOSED', 'lock', 'CONFIRMED']);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  config.authorize.mockRejectedValueOnce(Error('FORBIDDEN'));
  await expect(confirm()).rejects.toThrow('FORBIDDEN');
  expect(execute).toHaveBeenCalledTimes(1);
});
