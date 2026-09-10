import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";

/**
 * Trilha de auditoria append-only (ver `AuditLog` no schema — a role de
 * runtime só tem GRANT de SELECT/INSERT nessa tabela). O formato genérico
 * registra overbooking, exceções de pausa e outras ações sensíveis sem exigir
 * uma migration para cada novo tipo de evento.
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
    occurredAt?: Date;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      salonId: entry.salonId,
      ...(entry.occurredAt ? { createdAt: entry.occurredAt } : {}),
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
