import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";

/**
 * Trilha de auditoria append-only (ver `AuditLog` no schema — a role de
 * runtime só tem GRANT de SELECT/INSERT nessa tabela). Hoje o único emissor
 * é o overbooking deliberado na Agenda; o formato é genérico o bastante pra
 * outras ações sensíveis futuras sem migration nova.
 */
export async function writeAuditLog(
  tx: Tx,
  entry: {
    salonId: string;
    userId: string | null;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      salonId: entry.salonId,
      userId: entry.userId,
      actorName: entry.actorName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      reason: entry.reason ?? null,
      metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
