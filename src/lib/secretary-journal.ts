import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";

/** Shared append-only journal, used by Services and Customers. No schema or second storage. */
export function actionJournal(entityType: string) {
  const scope = (actor: ServiceActor) => ({ salonId: actor.salonId, userId: actor.userId, entityType });
  return {
    scope,
    async lock(tx: Tx, actor: ServiceActor, draftRef: string) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${entityType}:${actor.salonId}:${draftRef}`}, 0))`;
    },
    async append(tx: Tx, actor: ServiceActor, action: string, entityId: string, metadata: Prisma.InputJsonObject, id: string = randomUUID()) {
      await tx.auditLog.create({ data: { ...scope(actor), id, actorName: "Equipe autenticada", action, entityId, metadata } });
    },
  };
}
export function assertCurrent(draft: { draft_revision: number }, expected: number) {
  if (draft.draft_revision !== expected) throw new Error("REVISION_CONFLICT");
}
export function assertUnexpired(expires: string) {
  if (Date.parse(expires) <= Date.now()) throw new Error("EXPIRED");
}

/** Same lock/revision/hash/receipt order for every confirmed capability. Call inside withTenant. */
export async function confirmJournalAction<D extends { draft_ref: string; draft_revision: number; expires_at: string },
  P extends { proposal_ref: string; draft_ref: string; draft_revision: number; payload_hash: string; expires_at: string },
  R extends { proposal_ref: string }>(tx: Tx, actor: ServiceActor, input: { proposal_ref: string; draft_revision: number }, config: {
    journal: ReturnType<typeof actionJournal>; proposalAction: string; confirmedAction: string;
    authorize: () => Promise<unknown>; parseProposal: (x: unknown) => P; parseReceipt: (x: unknown) => R;
    latest: (draftRef: string) => Promise<D>; proposalHash: (p: P) => string; draftHash: (d: D) => string;
    execute: (p: P, d: D) => Promise<R>;
  }) {
  await config.authorize();
  const scope = config.journal.scope(actor);
  const row = await tx.auditLog.findFirst({ where: { ...scope, id: input.proposal_ref, action: config.proposalAction } });
  if (!row) throw new Error("PROPOSAL_NOT_FOUND");
  const proposal = config.parseProposal(row.metadata);
  if (proposal.proposal_ref !== input.proposal_ref || row.entityId !== proposal.draft_ref || proposal.payload_hash !== config.proposalHash(proposal)) throw new Error("PROPOSAL_MISMATCH");
  await config.journal.lock(tx, actor, proposal.draft_ref);
  const draft = await config.latest(proposal.draft_ref);
  assertCurrent(draft, input.draft_revision);
  if (proposal.draft_revision !== input.draft_revision || proposal.payload_hash !== config.draftHash(draft)) throw new Error("PROPOSAL_MISMATCH");
  const previous = await tx.auditLog.findFirst({ where: { ...scope, action: config.confirmedAction, entityId: draft.draft_ref } });
  if (previous) {
    const receipt = config.parseReceipt(previous.metadata);
    if (receipt.proposal_ref !== proposal.proposal_ref) throw new Error("ALREADY_CONFIRMED");
    return { ...receipt, duplicate: true };
  }
  assertUnexpired(draft.expires_at); assertUnexpired(proposal.expires_at);
  const receipt = await config.execute(proposal, draft);
  await config.journal.append(tx, actor, config.confirmedAction, draft.draft_ref, receipt as Prisma.InputJsonObject);
  return { ...receipt, duplicate: false };
}
