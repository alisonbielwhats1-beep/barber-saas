"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";

const serviceInput = z.object({
  name: z.string().min(2, "Nome muito curto"),
  description: z.string().optional().nullable(),
  durationMin: z.coerce.number().int().min(5).max(600),
  priceCents: z.coerce.number().int().min(0),
  costCents: z.coerce.number().int().min(0).default(0),
  category: z.string().optional().nullable(),
  imageUrl: z.string().url().optional().or(z.literal("")).nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
});

export type ServiceInput = z.infer<typeof serviceInput>;

function toData(data: ServiceInput) {
  return {
    name: data.name,
    description: data.description ?? null,
    durationMin: data.durationMin,
    priceCents: data.priceCents,
    costCents: data.costCents,
    category: data.category ?? null,
    imageUrl: data.imageUrl || null,
    colorHex: data.colorHex ?? null,
  };
}

export async function createService(input: ServiceInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = serviceInput.parse(input);

  await prisma.service.create({
    data: { ...toData(data), salonId: ctx.salonId },
  });
  revalidatePath("/servicos");
}

export async function updateService(id: string, input: ServiceInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = serviceInput.parse(input);

  // Filtro por salonId protege cross-tenant mesmo com id vindo do cliente
  await prisma.service.updateMany({
    where: { id, salonId: ctx.salonId },
    data: toData(data),
  });
  revalidatePath("/servicos");
}

export async function duplicateService(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const svc = await prisma.service.findFirst({
    where: { id, salonId: ctx.salonId },
    select: {
      name: true, description: true, durationMin: true, priceCents: true,
      costCents: true, category: true, imageUrl: true, colorHex: true,
    },
  });
  if (!svc) throw new Error("Serviço não encontrado");
  await prisma.service.create({
    data: { ...svc, name: `${svc.name} (cópia)`, salonId: ctx.salonId, active: false },
  });
  revalidatePath("/servicos");
}

export async function toggleServiceActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const svc = await prisma.service.findFirst({
    where: { id, salonId: ctx.salonId },
    select: { active: true },
  });
  if (!svc) throw new Error("Not found");
  await prisma.service.update({ where: { id }, data: { active: !svc.active } });
  revalidatePath("/servicos");
}

export async function deleteService(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  await prisma.service.deleteMany({ where: { id, salonId: ctx.salonId } });
  revalidatePath("/servicos");
}
