"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { lockProductMutations } from "@/lib/inventory-lock";
import { adjustProductStockReliably } from "@/lib/appointment-product-service";
import { assertPlanFeature } from "@/lib/plan-entitlements";
import type { Tx } from "@/lib/prisma-tenant";

async function assertInventoryEnabled(tx: Tx, salonId: string) {
  const salon = await tx.salon.findUnique({
    where: { id: salonId },
    select: { plan: true },
  });
  assertPlanFeature(salon?.plan, "INVENTORY");
}

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
  await withTenant(ctx, async (tx) => {
    await assertInventoryEnabled(tx, ctx.salonId);
    await tx.product.create({ data: { salonId: ctx.salonId, ...toData(data) } });
  });
  revalidatePath("/produtos");
}

export async function updateProduct(id: string, input: ProductInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = productInput.parse(input);
  await withTenant(ctx, async (tx) => {
    await assertInventoryEnabled(tx, ctx.salonId);
    await lockProductMutations(tx, [id]);
    await tx.product.updateMany({ where: { id, salonId: ctx.salonId }, data: toData(data) });
  });
  revalidatePath("/produtos");
}

export async function adjustStock(id: string, delta: number, options?: {
  reason?: string;
  kind?: "PURCHASE" | "LOSS" | "INVENTORY" | "ADJUSTMENT";
}) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = z.object({
    id: z.string().min(1),
    delta: z.number().int().min(-100_000).max(100_000).refine((value) => value !== 0, "Informe uma quantidade"),
    reason: z.string().trim().min(3).max(300).default("Ajuste rápido"),
    kind: z.enum(["PURCHASE", "LOSS", "INVENTORY", "ADJUSTMENT"]).default("ADJUSTMENT"),
  }).parse({ id, delta, reason: options?.reason, kind: options?.kind });
  await withTenant(ctx, async (tx) => {
    await assertInventoryEnabled(tx, ctx.salonId);
    const actor = await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    await adjustProductStockReliably(tx, {
      salonId: ctx.salonId,
      productId: data.id,
      delta: data.delta,
      userId: ctx.userId,
      actorName: actor?.name ?? "Usuário",
      reason: data.reason,
      kind: data.kind,
    });
  });
  revalidatePath("/produtos");
}

export async function toggleProductActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    await assertInventoryEnabled(tx, ctx.salonId);
    await lockProductMutations(tx, [id]);
    const p = await tx.product.findFirst({
      where: { id, salonId: ctx.salonId },
      select: { active: true },
    });
    if (!p) throw new Error("Not found");
    await tx.product.updateMany({ where: { id, salonId: ctx.salonId }, data: { active: !p.active } });
  });
  revalidatePath("/produtos");
}

export async function deleteProduct(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  await withTenant(ctx, async (tx) => {
    await assertInventoryEnabled(tx, ctx.salonId);
    await lockProductMutations(tx, [id]);
    await tx.product.deleteMany({ where: { id, salonId: ctx.salonId } });
  });
  revalidatePath("/produtos");
}
