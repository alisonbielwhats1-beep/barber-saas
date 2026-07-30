import type { Prisma } from "@prisma/client";

/**
 * Serializa mutações da agenda por profissional no PostgreSQL.
 *
 * O SELECT projeta um inteiro porque `pg_advisory_xact_lock` retorna void,
 * que o Prisma não desserializa. O lock é liberado automaticamente ao fim da
 * transação.
 */
export async function lockProfessionalSchedule(
  tx: Prisma.TransactionClient,
  professionalId: string,
): Promise<void> {
  const lockKey = `appointment:${professionalId}`;
  await tx.$queryRaw`
    SELECT 1 AS locked
    FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;
}
