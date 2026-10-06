import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import { assertServiceWriter, type ServiceActor } from "./service-catalog";
import { assertPlanFeature } from "./plan-entitlements";

export async function assertInventoryAccess(tx: Tx, actor: ServiceActor, write = false) {
  await assertServiceWriter(tx, actor);
  if (write) {
    const salon = await tx.salon.findFirstOrThrow({ where: { id: actor.salonId }, select: { plan: true } });
    assertPlanFeature(salon.plan, "INVENTORY");
  }
}
export const productDTO = z.object({ id: z.string().min(1), name: z.string(), stock: z.number().int(), minStock: z.number().int(), active: z.boolean(), unit: z.literal("un"), revision: z.string().length(64) }).strict();
const select = { id: true, name: true, stock: true, minStock: true, active: true, updatedAt: true } as const;
function dto(p: { id: string; name: string; stock: number; minStock: number; active: boolean; updatedAt: Date }) {
  return productDTO.parse({ id: p.id, name: p.name, stock: p.stock, minStock: p.minStock, active: p.active, unit: "un",
    revision: createHash("sha256").update(JSON.stringify(p)).digest("hex") });
}
/** T24: bounded explicit projection; low-stock comparison is performed by PostgreSQL. */
export async function searchProducts(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertInventoryAccess(tx, actor);
  const q = z.object({ query: z.string().trim().min(1).max(200).optional(), low_stock: z.boolean().default(false) }).strict().parse(input);
  const rows = await tx.product.findMany({ where: { salonId: actor.salonId,
    ...(q.query ? { name: { contains: q.query, mode: "insensitive" as const } } : {}),
    ...(q.low_stock ? { stock: { lte: tx.product.fields.minStock } } : {}) }, select, orderBy: [{ name: "asc" }, { id: "asc" }], take: 21 });
  return rows.map(dto);
}
/** T25 and T26 use the same authorized, minimized real balance projection. */
export async function getProduct(tx: Tx, actor: ServiceActor, ref: string) {
  await assertInventoryAccess(tx, actor);
  const p = await tx.product.findFirst({ where: { id: z.string().min(1).max(200).parse(ref), salonId: actor.salonId }, select });
  if (!p) throw Error("PRODUCT_NOT_FOUND");
  return dto(p);
}
export const getStockBalance = getProduct;
