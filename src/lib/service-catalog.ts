import type { Tx } from "./prisma-tenant";
import { FOLD_FROM, FOLD_TO, foldedIds, foldedLikePattern } from "./name-search";
import { serviceCreateInput, serviceFields, servicePatchInput, serviceMvpPatch, type ServiceInput } from "./service-contract";
import { assertAllowedStoredImageUrl } from "./stored-image-url";
import { priceSnapshot } from "./service-price";

export type ServiceActor = { salonId: string; userId: string };

export async function requireActiveResource(tx: Tx, salonId: string, id?: string | null) {
  if (!id) return;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PhysicalResource" WHERE id=${id} AND "salonId"=${salonId} AND active FOR SHARE`;
  if (!rows.length) throw new Error("Recurso inválido ou inativo.");
}

function toData(data: ServiceInput) {
  const processingMin = data.processingMin ?? 0;
  const finishingMin = data.finishingMin ?? 0;
  if (processingMin + finishingMin >= data.durationMin) {
    throw new Error("Execução deve durar pelo menos um minuto dentro da duração total.");
  }
  return {
    ...data, processingMin, finishingMin, costCents: data.costCents ?? 0,
    ...priceSnapshot(data),
    name: data.variantGroup && data.variantLabel ? `${data.variantGroup} — ${data.variantLabel}` : data.name,
    variantGroup: data.variantGroup || null, variantLabel: data.variantLabel || null,
    physicalResourceId: data.physicalResourceId || null,
    description: data.description ?? null, category: data.category ?? null,
    imageUrl: data.imageUrl || null, colorHex: data.colorHex ?? null,
  };
}

/** Called within withTenant; locks keep suspension/role revocation serialized. */
export async function assertServiceWriter(tx: Tx, actor: ServiceActor) {
  const salons = await tx.$queryRaw<{ accessStatus: string; currency: string }[]>`
    SELECT "accessStatus", "currency" FROM "Salon"
    WHERE id = ${actor.salonId} FOR SHARE`;
  const memberships = await tx.$queryRaw<{ role: string }[]>`
    SELECT role FROM "Membership"
    WHERE "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} FOR SHARE`;
  if (salons[0]?.accessStatus !== "APPROVED" ||
      !["OWNER", "MANAGER"].includes(memberships[0]?.role ?? "")) {
    throw new Error("FORBIDDEN");
  }
  return salons[0];
}

export async function createCatalogService(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertServiceWriter(tx, actor);
  const data = serviceCreateInput.parse(input);
  assertAllowedStoredImageUrl(data.imageUrl, actor.salonId);
  await requireActiveResource(tx, actor.salonId, data.physicalResourceId);
  return tx.service.create({ data: { ...toData(data), salonId: actor.salonId } });
}

export async function updateCatalogService(
  tx: Tx, actor: ServiceActor, id: string, input: unknown, approvedRevision?: string,
) {
  await assertServiceWriter(tx, actor);
  const parsed = (approvedRevision === undefined ? servicePatchInput : serviceMvpPatch).parse(input);
  // Undefined is omission; null is an explicit clear for nullable fields only.
  const data = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined));
  if (!Object.keys(data).length) throw new Error("EMPTY_PATCH");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${id} AND "salonId"=${actor.salonId} FOR UPDATE`;
  if (approvedRevision !== undefined) {
    const [version] = await tx.$queryRaw<{ revision: string }[]>`SELECT xmin::text AS revision FROM "Service" WHERE id=${id} AND "salonId"=${actor.salonId}`;
    if (version?.revision !== approvedRevision) throw new Error("SERVICE_CHANGED");
  }
  const current = await tx.service.findFirst({ where: { id, salonId: actor.salonId } });
  if (!current) throw new Error("SERVICE_NOT_FOUND");
  if (approvedRevision !== undefined) validateServiceChange(current, parsed);
  const knownFields = Object.fromEntries(Object.keys(serviceFields).map((key) => [key, current[key as keyof typeof current]]));
  const merged = serviceCreateInput.parse({ ...knownFields, ...data });
  assertAllowedStoredImageUrl(merged.imageUrl, actor.salonId);
  await requireActiveResource(tx, actor.salonId, merged.physicalResourceId);
  const result = await tx.service.updateMany({
    where: { id, salonId: actor.salonId },
    // T18 is limited to scalar fields: preserve every omitted column byte-for-byte.
    data: approvedRevision === undefined ? toData(merged) : data,
  });
  if (result.count !== 1) throw new Error("SERVICE_NOT_FOUND");
  return tx.service.findFirstOrThrow({ where: { id, salonId: actor.salonId } });
}

export async function findCatalogServices(tx: Tx, actor: ServiceActor, name: string) {
  await assertServiceWriter(tx, actor);
  // Case- and accent-insensitive, same tenant scope; several matches still require a choice.
  const term = serviceFields.name.parse(name);
  const folded = foldedIds(await tx.$queryRaw`SELECT id FROM "Service" WHERE "salonId"=${actor.salonId} AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) LIKE lower(translate(${foldedLikePattern(term)}, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\\' ORDER BY id LIMIT 21`);
  const byName = { name: { contains: term, mode: "insensitive" as const } };
  return tx.service.findMany({ where: { salonId: actor.salonId, ...(folded.length ? { OR: [byName, { id: { in: folded } }] } : byName) },
    select: { id: true, name: true, priceCents: true, durationMin: true, priceType: true }, orderBy: { id: "asc" }, take: 21 });
}

export async function catalogServiceSnapshot(tx: Tx, actor: ServiceActor, id: string) {
  await assertServiceWriter(tx, actor);
  const [version] = await tx.$queryRaw<{ revision: string }[]>`SELECT xmin::text AS revision FROM "Service" WHERE id=${id} AND "salonId"=${actor.salonId} FOR SHARE`;
  const service = await tx.service.findFirst({ where: { id, salonId: actor.salonId } });
  if (!service || !version) throw new Error("SERVICE_NOT_FOUND");
  return { service, revision: version.revision };
}

export function validateServiceChange(service: { variantGroup: string | null; processingMin: number; finishingMin: number; durationMin: number }, patch: { name?: string; durationMin?: number }) {
  if (patch.name !== undefined && service.variantGroup) throw new Error("VARIANT_RENAME_UNSUPPORTED");
  if (service.processingMin + service.finishingMin >= (patch.durationMin ?? service.durationMin)) throw new Error("DURATION_CONFLICT");
}
