"use server";

import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";

export async function markStaffNotificationRead(id: string) {
  const ctx = await getTenantContext();
  await withTenant(ctx, (tx) =>
    tx.notificationOutbox.updateMany({
      where: {
        id,
        salonId: ctx.salonId,
        recipientKey: `USER:${ctx.userId}`,
        channel: "INTERNAL",
      },
      data: { readAt: new Date() },
    }),
  );
  revalidatePath("/notificacoes");
}

export async function markAllStaffNotificationsRead() {
  const ctx = await getTenantContext();
  await withTenant(ctx, (tx) =>
    tx.notificationOutbox.updateMany({
      where: {
        salonId: ctx.salonId,
        recipientKey: `USER:${ctx.userId}`,
        channel: "INTERNAL",
        readAt: null,
      },
      data: { readAt: new Date() },
    }),
  );
  revalidatePath("/notificacoes");
}
