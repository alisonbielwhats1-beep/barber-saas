"use server";

import { revalidatePath } from "next/cache";
import { priceSnapshot } from "@/lib/service-price";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import { assertAllowedStoredImageUrl } from "@/lib/stored-image-url";

const serviceInput = z.object({
  name: z.string().min(2, "Nome muito curto"),
  description: z.string().optional().nullable(),
  durationMin: z.coerce.number().int().min(5).max(600),
  priceCents: z.coerce.number().int().min(0),
  priceType: z.enum(["FIXED", "FROM"]).default("FIXED"),
  priceNote: z.string().trim().max(240).nullable().optional(),
  costCents: z.coerce.number().int().min(0).default(0),
  category: z.string().optional().nullable(),
  imageUrl: z.string().url().optional().or(z.literal("")).nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  variantGroup: z.string().trim().max(100).optional().nullable(),
  variantLabel: z.string().trim().max(100).optional().nullable(),
  processingMin: z.coerce.number().int().min(0).max(599).default(0),
  finishingMin: z.coerce.number().int().min(0).max(599).default(0),
  physicalResourceId: z.string().optional().nullable(),
}).refine(d => d.processingMin + d.finishingMin < d.durationMin, "Execução deve durar pelo menos um minuto dentro da duração total.");

export type ServiceInput = z.infer<typeof serviceInput>;

async function requireActiveResource(tx: Tx, salonId: string, id?: string | null) {
  if (!id) return;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PhysicalResource" WHERE id=${id} AND "salonId"=${salonId} AND active FOR SHARE`;
  if (!rows.length) throw new Error("Recurso inválido ou inativo.");
}

function toData(data: ServiceInput) {
  return {
    name: data.variantGroup && data.variantLabel ? `${data.variantGroup} — ${data.variantLabel}` : data.name,
    variantGroup: data.variantGroup || null, variantLabel: data.variantLabel || null,
    processingMin: data.processingMin, finishingMin: data.finishingMin, physicalResourceId: data.physicalResourceId || null,
    description: data.description ?? null,
    durationMin: data.durationMin,
    priceCents: data.priceCents,
    ...priceSnapshot(data),
    costCents: data.costCents,
    category: data.category ?? null,
    imageUrl: data.imageUrl || null,
    colorHex: data.colorHex ?? null,
  };
}

function revalidateServiceCatalog(salonSlug: string | null | undefined) {
  revalidatePath("/servicos");
  if (salonSlug) revalidatePath(`/book/${salonSlug}`, "layout");
}

export async function createService(input: ServiceInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = serviceInput.parse(input);
  assertAllowedStoredImageUrl(data.imageUrl, ctx.salonId);

  const salon = await withTenant(ctx, async (tx) => {
    await requireActiveResource(tx, ctx.salonId, data.physicalResourceId);
    await tx.service.create({
      data: { ...toData(data), salonId: ctx.salonId },
    });
    return tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } });
  });
  revalidateServiceCatalog(salon?.slug);
}

export async function updateService(id: string, input: ServiceInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = serviceInput.parse(input);
  assertAllowedStoredImageUrl(data.imageUrl, ctx.salonId);

  // Filtro por salonId protege cross-tenant mesmo com id vindo do cliente —
  // e, sob RLS, a policy da tabela reforça o mesmo filtro por trás.
  const salon = await withTenant(ctx, async (tx) => {
    await requireActiveResource(tx, ctx.salonId, data.physicalResourceId);
    await tx.service.updateMany({
      where: { id, salonId: ctx.salonId },
      data: toData(data),
    });
    return tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } });
  });
  revalidateServiceCatalog(salon?.slug);
}

export async function duplicateService(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);

  const salon = await withTenant(ctx, async (tx) => {
    const svc = await tx.service.findFirst({
      where: { id, salonId: ctx.salonId },
      select: {
        name: true, description: true, durationMin: true, priceCents: true, priceType: true, priceNote: true,
        costCents: true, category: true, imageUrl: true, colorHex: true,
        variantGroup: true, variantLabel: true, processingMin: true, finishingMin: true, physicalResourceId: true,
      },
    });
    if (!svc) throw new Error("Serviço não encontrado");
    await tx.service.create({
      data: { ...svc, name: `${svc.name} (cópia)`, salonId: ctx.salonId, active: false },
    });
    return tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } });
  });
  revalidateServiceCatalog(salon?.slug);
}

export async function toggleServiceActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);

  const salon = await withTenant(ctx, async (tx) => {
    const svc = await tx.service.findFirst({
      where: { id, salonId: ctx.salonId },
      select: { active: true, physicalResourceId: true },
    });
    if (!svc) throw new Error("Not found");
    if (!svc.active) await requireActiveResource(tx, ctx.salonId, svc.physicalResourceId);
    // updateMany (não update) para manter o filtro salonId também na
    // escrita — a versão anterior gravava por `id` sozinho, dependendo só
    // do findFirst acima como checagem de posse. Funcionalmente seguro no
    // fluxo atual (o `id` já foi confirmado do salão certo), mas destoava
    // do resto do arquivo e da regra de nunca escrever sem o filtro.
    await tx.service.updateMany({
      where: { id, salonId: ctx.salonId },
      data: { active: !svc.active },
    });
    return tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } });
  });
  revalidateServiceCatalog(salon?.slug);
}

export async function deleteService(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  const salon = await withTenant(ctx, async (tx) => {
    await tx.service.deleteMany({ where: { id, salonId: ctx.salonId } });
    return tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } });
  });
  revalidateServiceCatalog(salon?.slug);
}
