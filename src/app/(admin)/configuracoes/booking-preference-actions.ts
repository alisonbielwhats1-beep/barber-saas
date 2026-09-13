"use server";
import { revalidatePath } from "next/cache";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import {
  bookingPreferencesSchema,
  getBookingPreferences,
  type BookingPreferences,
} from "@/lib/booking-preferences";
import { writeAuditLog } from "@/lib/audit";

export async function loadBookingPreferences() {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  return withTenant(ctx, async (tx) => ({
    preferences: await getBookingPreferences(tx, ctx.salonId),
    services: await tx.service.findMany({
      where: { salonId: ctx.salonId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  }));
}
export async function saveBookingPreferences(raw: BookingPreferences) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = bookingPreferencesSchema.parse(raw);
  if (
    Object.keys(data.addons).length > 500 ||
    Object.keys(data.serviceReturnDays).length > 500
  )
    throw new Error("Configuração muito extensa.");
  await withTenant(ctx, async (tx) => {
    const ids = [
      ...new Set([
        ...Object.keys(data.addons),
        ...Object.values(data.addons).flat(),
        ...Object.keys(data.serviceReturnDays),
      ]),
    ];
    const count = await tx.service.count({
      where: { salonId: ctx.salonId, id: { in: ids } },
    });
    if (count !== ids.length)
      throw new Error("Serviço não encontrado neste estabelecimento.");
    if (Object.entries(data.addons).some(([id, addons]) => addons.includes(id)))
      throw new Error("Um serviço não pode ser seu próprio complemento.");
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`booking-preferences:${ctx.salonId}`}, 0))`;
    await writeAuditLog(tx, {
      salonId: ctx.salonId,
      userId: ctx.userId,
      actorName: "Gestão",
      action: "BOOKING_PREFERENCES_UPDATED",
      entityType: "Salon",
      entityId: ctx.salonId,
      metadata: data,
    });
  });
  revalidatePath("/configuracoes");
  revalidatePath("/clientes");
  revalidatePath("/book", "layout");
  return { success: true };
}
