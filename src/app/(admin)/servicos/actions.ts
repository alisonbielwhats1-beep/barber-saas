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
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
});

export type ServiceInput = z.infer<typeof serviceInput>;

export async function createService(input: ServiceInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = serviceInput.parse(input);

  await prisma.service.create({
    data: { ...data, salonId: ctx.salonId },
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
    data,
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
