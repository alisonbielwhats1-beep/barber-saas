"use server";

import { revalidatePath } from "next/cache";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";

export async function markClientNotificationRead(salonSlug: string, id: string) {
  const session = await getClientSession();
  if (!session) throw new Error("Sessão expirada");
  await withSalonBySlug(salonSlug, async (tx, salonId) => {
    if (session.salonId !== salonId) return;
    await tx.notificationOutbox.updateMany({
      where: {
        id,
        salonId,
        recipientKey: `CLIENT:${session.clientId}`,
        channel: "INTERNAL",
      },
      data: { readAt: new Date() },
    });
  });
  revalidatePath(`/book/${salonSlug}/notificacoes`);
}

export async function markAllClientNotificationsRead(salonSlug: string) {
  const session = await getClientSession();
  if (!session) throw new Error("Sessão expirada");
  await withSalonBySlug(salonSlug, async (tx, salonId) => {
    if (session.salonId !== salonId) return;
    await tx.notificationOutbox.updateMany({
      where: {
        salonId,
        recipientKey: `CLIENT:${session.clientId}`,
        channel: "INTERNAL",
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  });
  revalidatePath(`/book/${salonSlug}/notificacoes`);
}
