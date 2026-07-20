"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";

const productInput = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  priceCents: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0),
  imageUrl: z.string().url().optional().or(z.literal("")).nullable(),
});

export type ProductInput = z.infer<typeof productInput>;

export async function createProduct(input: ProductInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = productInput.parse(input);

  await prisma.product.create({
    data: {
      salonId: ctx.salonId,
      name: data.name,
      description: data.description ?? null,
      brand: data.brand ?? null,
      category: data.category ?? null,
      priceCents: data.priceCents,
      stock: data.stock,
      imageUrl: data.imageUrl || null,
    },
  });
  revalidatePath("/produtos");
}

export async function updateProduct(id: string, input: ProductInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = productInput.parse(input);

  await prisma.product.updateMany({
    where: { id, salonId: ctx.salonId },
    data: {
      name: data.name,
      description: data.description ?? null,
      brand: data.brand ?? null,
      category: data.category ?? null,
      priceCents: data.priceCents,
      stock: data.stock,
      imageUrl: data.imageUrl || null,
    },
  });
  revalidatePath("/produtos");
}

export async function toggleProductActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const p = await prisma.product.findFirst({
    where: { id, salonId: ctx.salonId },
    select: { active: true },
  });
  if (!p) throw new Error("Not found");
  await prisma.product.update({ where: { id }, data: { active: !p.active } });
  revalidatePath("/produtos");
}

export async function deleteProduct(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  await prisma.product.deleteMany({ where: { id, salonId: ctx.salonId } });
  revalidatePath("/produtos");
}
