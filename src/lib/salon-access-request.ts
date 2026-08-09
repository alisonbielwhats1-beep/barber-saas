import { randomUUID } from "node:crypto";
import type { Tx } from "./prisma-tenant";

/**
 * Registra o pedido inicial sem usar `INSERT ... RETURNING`.
 *
 * A tabela de eventos permite que o dono insira o primeiro REQUESTED, mas a
 * leitura continua restrita ao administrador da plataforma. `create()` sempre
 * pede a linha de volta ao Postgres e, por isso, também exige uma policy de
 * SELECT. `createMany()` executa somente o INSERT e preserva essa separação.
 */
export async function recordSalonAccessRequest(
  tx: Tx,
  input: { salonId: string; actorUserId: string },
): Promise<void> {
  const created = await tx.salonAccessEvent.createMany({
    data: {
      id: randomUUID(),
      salonId: input.salonId,
      actorUserId: input.actorUserId,
      type: "REQUESTED",
      previousStatus: null,
      newStatus: "PENDING",
      previousPlan: null,
      newPlan: "FREE",
    },
  });

  if (created.count !== 1) {
    throw new Error("SALON_ACCESS_REQUEST_NOT_RECORDED");
  }
}
