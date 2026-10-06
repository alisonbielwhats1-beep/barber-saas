"use server";

import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { createCatalogService, updateCatalogService, requireActiveResource } from "@/lib/service-catalog";
import type { ServiceInput, ServicePatch } from "@/lib/service-contract";
export type { ServiceInput } from "@/lib/service-contract";

function revalidateServiceCatalog(salonSlug: string | null | undefined) {
  revalidatePath("/servicos");
  if (salonSlug) revalidatePath(`/book/${salonSlug}`, "layout");
}

export async function createService(input: ServiceInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const { service, salon } = await withTenant(ctx, async (tx) => ({
    service: await createCatalogService(tx, ctx, input),
    salon: await tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } }),
  }));
  revalidateServiceCatalog(salon?.slug);
  return service;
}

export async function updateService(id: string, input: ServicePatch) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const { service, salon } = await withTenant(ctx, async (tx) => ({
    service: await updateCatalogService(tx, ctx, id, input),
    salon: await tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } }),
  }));
  revalidateServiceCatalog(salon?.slug);
  return service;
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
