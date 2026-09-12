import type { Tx } from "./prisma-tenant";
import { writeAuditLog } from "./audit";

const actions = ["CLIENT_HIDDEN_FROM_LIST", "CLIENT_RESTORED_TO_LIST"];

/** Listing preference only: account access and every historical relation stay intact. */
export async function hiddenClientIds(tx: Tx, salonId: string): Promise<Set<string>> {
  const latest = await tx.auditLog.findMany({
    where: { salonId, entityType: "ClientProfile", action: { in: actions } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["entityId"],
    select: { entityId: true, action: true },
  });
  return new Set(latest.filter(event => event.action === actions[0]).map(event => event.entityId));
}

export async function setClientListVisibility(tx: Tx, input: {
  salonId: string; clientId: string; userId: string; hidden: boolean;
}) {
  await tx.$queryRaw`SELECT 1::integer FROM pg_advisory_xact_lock(hashtextextended(${`client-merge:${input.salonId}:${input.clientId}`}, 0))`;
  const client = await tx.clientProfile.findFirst({
    where: { id: input.clientId, salonId: input.salonId, mergedIntoId: null },
    select: { id: true, name: true },
  });
  if (!client) throw new Error("Cliente não encontrado neste estabelecimento.");
  const latest = await tx.auditLog.findFirst({
    where: { salonId: input.salonId, entityType: "ClientProfile", entityId: client.id, action: { in: actions } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { action: true, createdAt: true },
  });
  if ((latest?.action === actions[0]) === input.hidden) return;
  const actor = await tx.user.findUnique({ where: { id: input.userId }, select: { name: true } });
  await writeAuditLog(tx, {
    salonId: input.salonId, userId: input.userId, actorName: actor?.name ?? "Proprietário",
    action: input.hidden ? actions[0] : actions[1], entityType: "ClientProfile", entityId: client.id,
    // A transaction may have started before waiting for the lock; order by actual operation time.
    occurredAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)),
    reason: input.hidden ? "Exclusão da lista pelo proprietário" : "Restauração à lista pelo proprietário",
    metadata: { clientName: client.name, accountAccessPreserved: true, historyPreserved: true },
  });
}
