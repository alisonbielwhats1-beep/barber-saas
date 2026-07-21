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
  supplier: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  priceCents: z.coerce.number().int().min(0),
  costCents: z.coerce.number().int().min(0).default(0),
  stock: z.coerce.number().int().min(0),
  minStock: z.coerce.number().int().min(0).default(0),
  expiresAt: z.string().optional().nullable(),
  imageUrl: z.string().url().optional().or(z.literal("")).nullable(),
});

export type ProductInput = z.infer<typeof productInput>;

function toData(data: ProductInput) {
  return {
    name: data.name,
    description: data.description ?? null,
    brand: data.brand ?? null,
    category: data.category ?? null,
    supplier: data.supplier ?? null,
    barcode: data.barcode ?? null,
    priceCents: data.priceCents,
    costCents: data.costCents,
    stock: data.stock,
    minStock: data.minStock,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    imageUrl: data.imageUrl || null,
  };
}

export async function createProduct(input: ProductInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = productInput.parse(input);
  await prisma.product.create({ data: { salonId: ctx.salonId, ...toData(data) } });
  revalidatePath("/produtos");
}

export async function updateProduct(id: string, input: ProductInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = productInput.parse(input);
  await prisma.product.updateMany({ where: { id, salonId: ctx.salonId }, data: toData(data) });
  revalidatePath("/produtos");
}

export async function adjustStock(id: string, delta: number) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const prod = await prisma.product.findFirst({
    where: { id, salonId: ctx.salonId },
    select: { stock: true },
  });
  if (!prod) throw new Error("Produto não encontrado");
  const next = Math.max(0, prod.stock + delta);
  await prisma.product.update({ where: { id }, data: { stock: next } });
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
