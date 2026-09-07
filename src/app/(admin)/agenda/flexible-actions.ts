"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { promoteFlexible } from "@/lib/flexible-waitlist";
import { dateKeyInTimeZone } from "@/lib/time";
export async function listFlexibleRequests() {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  return withTenant(ctx, async tx => {
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
    return tx.flexibleWaitlist.findMany({ where: { salonId: ctx.salonId, status: "WAITING", toDate: { gte: dateKeyInTimeZone(new Date(), salon.timezone) } }, include: { client: { select: { name: true } }, professional: { select: { user: { select: { name: true } } } }, services: { select: { service: { select: { name: true, durationMin: true, priceCents: true } } } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 });
  });
}
export async function promoteFlexibleRequest(id: string, startLocal: string) {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  z.string().min(1).max(100).parse(id); z.string().length(16).parse(startLocal);
  const result = await withTenant(ctx, tx => promoteFlexible(tx, ctx, id, startLocal));
  revalidatePath("/agenda"); revalidatePath("/book", "layout"); return result;
}
