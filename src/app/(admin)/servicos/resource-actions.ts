"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { writeAuditLog } from "@/lib/audit";

export async function listResources() {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  return withTenant(ctx, tx => tx.physicalResource.findMany({ where: { salonId: ctx.salonId }, orderBy: { name: "asc" } }));
}
export async function createResource(input: { name: string; kind: string }) {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = z.object({ name: z.string().trim().min(2).max(100), kind: z.enum(["ROOM", "EQUIPMENT"]) }).parse(input);
  await withTenant(ctx, async tx => {
    const item = await tx.physicalResource.create({ data: { ...data, salonId: ctx.salonId } });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "RESOURCE_CREATED", entityType: "PhysicalResource", entityId: item.id });
  });
  revalidatePath("/servicos");
}
export async function setResourceActive(id: string, active: boolean) {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async tx => {
    await tx.$queryRaw`SELECT id FROM "PhysicalResource" WHERE id=${id} AND "salonId"=${ctx.salonId} FOR UPDATE`;
    if (!active && (await tx.resourceBooking.count({ where: { salonId: ctx.salonId, resourceId: id, active: true, endAt: { gt: new Date() } } }) || await tx.service.count({ where: { salonId: ctx.salonId, physicalResourceId: id, active: true } }))) throw new Error("Realoque os serviços e reservas futuras antes de desativar este recurso.");
    await tx.physicalResource.updateMany({ where: { id, salonId: ctx.salonId }, data: { active } });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "RESOURCE_UPDATED", entityType: "PhysicalResource", entityId: id, metadata: { active } });
  });
  revalidatePath("/servicos");
}
