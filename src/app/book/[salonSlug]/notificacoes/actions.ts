"use server";

import { revalidatePath } from "next/cache";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";

export async function markClientNotificationRead(salonSlug: string, id: string) {
  const session = await getClientSession();
  if (!session) throw new Error("Sessão expirada");
  await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
    if (!effectiveSession) return;
    await tx.notificationOutbox.updateMany({
      where: {
        id,
        salonId,
        recipientKey: `CLIENT:${effectiveSession.clientId}`,
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
    const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
    if (!effectiveSession) return;
    await tx.notificationOutbox.updateMany({
      where: {
        salonId,
        recipientKey: `CLIENT:${effectiveSession.clientId}`,
        channel: "INTERNAL",
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  });
  revalidatePath(`/book/${salonSlug}/notificacoes`);
}
