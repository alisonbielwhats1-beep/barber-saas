import type { Tx } from "./prisma-tenant";
import { setSalonGuc } from "./prisma-tenant";

const entityType = "SalonListVisibility";
function isArchived(metadata: unknown) {
  return Boolean(metadata && typeof metadata === "object" && "archived" in metadata && metadata.archived === true);
}
export async function archivedSalonIds(tx: Tx): Promise<string[]> {
  const events = await tx.hqActivities.findMany({
    where: { entityType, entityId: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], distinct: ["entityId"],
    select: { entityId: true, metadata: true },
  });
  return events.filter(event => isArchived(event.metadata)).map(event => event.entityId!);
}

export async function setSalonArchived(tx: Tx, actorId: string, salonId: string, archived: boolean) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { platformRole: true } });
  if (actor?.platformRole !== "SUPER_ADMIN") throw new Error("Acesso restrito à administração.");
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`salon-history:${salonId}`}, 0))`;
  await setSalonGuc(tx, salonId);
  await tx.$queryRaw`SELECT id FROM "Salon" WHERE id=${salonId} FOR SHARE`;
  const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { name: true, slug: true, accessStatus: true } });
  if (!salon) throw new Error("Estabelecimento não encontrado.");
  if (archived && !["SUSPENDED", "REJECTED"].includes(salon.accessStatus)) throw new Error("Suspenda o estabelecimento antes de movê-lo para o histórico.");
  const latest = await tx.hqActivities.findFirst({
    where: { entityType, entityId: salonId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { metadata: true, createdAt: true },
  });
  if (isArchived(latest?.metadata) === archived) return;
  await tx.hqActivities.create({ data: {
    actorId, entityType, entityId: salonId, kind: "Mudança de status", metadata: { archived },
    description: `${salon.name} (${salon.slug}): ${archived ? "movido para o histórico" : "restaurado à lista"}. Dados e acesso preservados.`,
    createdAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)),
  } });
}
