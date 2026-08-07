"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";

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

const productSaleInput = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(999),
  idempotencyKey: z.string().uuid(),
});

export type ProductSaleResult =
  | { ok: true; saleId: string; stockAfter: number; duplicate: boolean }
  | { ok: false; error: string };

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
  await withTenant(ctx, (tx) =>
    tx.product.create({ data: { salonId: ctx.salonId, ...toData(data) } }),
  );
  revalidatePath("/produtos");
}

export async function updateProduct(id: string, input: ProductInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = productInput.parse(input);
  await withTenant(ctx, (tx) =>
    tx.product.updateMany({ where: { id, salonId: ctx.salonId }, data: toData(data) }),
  );
  revalidatePath("/produtos");
}

export async function adjustStock(id: string, delta: number) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    const prod = await tx.product.findFirst({
      where: { id, salonId: ctx.salonId },
      select: { stock: true },
    });
    if (!prod) throw new Error("Produto não encontrado");
    const next = Math.max(0, prod.stock + delta);
    await tx.product.updateMany({ where: { id, salonId: ctx.salonId }, data: { stock: next } });
  });
  revalidatePath("/produtos");
}

export async function registerProductSale(
  input: z.infer<typeof productSaleInput>,
): Promise<ProductSaleResult> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);

  const parsed = productSaleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Quantidade inválida." };
  const data = parsed.data;

  try {
    const result = await withTenant(ctx, async (tx) => {
      const existing = await tx.productSale.findUnique({
        where: {
          salonId_idempotencyKey: {
            salonId: ctx.salonId,
            idempotencyKey: data.idempotencyKey,
          },
        },
        select: { id: true, productId: true, quantity: true },
      });

      if (existing) {
        const product = await tx.product.findFirst({
          where: { id: existing.productId, salonId: ctx.salonId },
          select: { stock: true },
        });
        return { saleId: existing.id, stockAfter: product?.stock ?? 0, duplicate: true };
      }

      const product = await tx.product.findFirst({
        where: { id: data.productId, salonId: ctx.salonId, active: true },
        select: { id: true, priceCents: true, costCents: true, stock: true },
      });
      if (!product) throw new Error("Produto não encontrado ou pausado.");
      if (product.stock < data.quantity) {
        throw new Error(`Estoque insuficiente. Disponível: ${product.stock}.`);
      }

      const decremented = await tx.product.updateMany({
        where: {
          id: product.id,
          salonId: ctx.salonId,
          active: true,
          stock: { gte: data.quantity },
        },
        data: { stock: { decrement: data.quantity } },
      });
      if (decremented.count !== 1) {
        throw new Error("O estoque mudou durante a venda. Confira e tente novamente.");
      }

      const sale = await tx.productSale.create({
        data: {
          salonId: ctx.salonId,
          productId: product.id,
          quantity: data.quantity,
          priceCentsUnit: product.priceCents,
          costCentsUnit: product.costCents,
          soldByUserId: ctx.userId,
          idempotencyKey: data.idempotencyKey,
        },
        select: { id: true },
      });

      return {
        saleId: sale.id,
        stockAfter: product.stock - data.quantity,
        duplicate: false,
      };
    });

    revalidatePath("/produtos");
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
    revalidatePath("/relatorios");
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await withTenant(ctx, (tx) =>
        tx.productSale.findUnique({
          where: {
            salonId_idempotencyKey: {
              salonId: ctx.salonId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          select: { id: true, product: { select: { stock: true } } },
        }),
      );
      if (existing) {
        return {
          ok: true,
          saleId: existing.id,
          stockAfter: existing.product.stock,
          duplicate: true,
        };
      }
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível registrar a venda.",
    };
  }
}

export async function toggleProductActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
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
  await withTenant(ctx, (tx) =>
    tx.product.deleteMany({ where: { id, salonId: ctx.salonId } }),
  );
  revalidatePath("/produtos");
}
