import type { Tx } from "./prisma-tenant";

type OperationalLockSet = {
  appointmentIds?: string[];
  professionalIds?: string[];
  productIds?: string[];
};

async function lockKeys(tx: Tx, keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))
    `;
  }
}

/**
 * Ordem global das mutações operacionais:
 * appointment -> professional -> product.
 *
 * Cada grupo é ordenado por id. Uma operação que precise de mais de um grupo
 * deve adquiri-los em uma única chamada antes de alterar status ou estoque.
 * Operações que só tocam produto continuam usando `lockProductMutations`.
 */
export async function lockOperationalResources(
  tx: Tx,
  resources: OperationalLockSet,
): Promise<void> {
  await lockKeys(
    tx,
    (resources.appointmentIds ?? []).map((id) => `appointment:appointment:${id}`),
  );
  await lockKeys(
    tx,
    (resources.professionalIds ?? []).map((id) => `appointment:professional:${id}`),
  );
  await lockKeys(
    tx,
    (resources.productIds ?? []).map((id) => `product:${id}`),
  );
}

/** Serializa mutações do mesmo conjunto de produtos sem risco de deadlock. */
export async function lockProductMutations(
  tx: Tx,
  productIds: string[],
): Promise<void> {
  await lockOperationalResources(tx, { productIds });
}
