import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { NotificationList, type NotificationRow } from "@/components/notification-list";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { BottomNav } from "../bottom-nav";

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default async function ClientNotificationsPage({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const session = await getClientSession();
  if (!session) redirect(`/book/${salonSlug}/login`);

  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    if (session.salonId !== salonId) return null;
    const [salon, notifications] = await Promise.all([
      tx.salon.findUnique({
        where: { id: salonId },
        select: { name: true, timezone: true },
      }),
      tx.notificationOutbox.findMany({
        where: {
          salonId,
          recipientKey: `CLIENT:${session.clientId}`,
          channel: "INTERNAL",
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          template: true,
          payload: true,
          readAt: true,
          createdAt: true,
          appointment: {
            select: { professional: { select: { user: { select: { name: true } } } } },
          },
        },
      }),
    ]);
    return salon ? { salon, notifications } : null;
  });
  if (!result) redirect(`/book/${salonSlug}/login`);

  const notifications: NotificationRow[] = result.notifications.map((notification) => ({
    id: notification.id,
    template: notification.template,
    payload: payloadRecord(notification.payload),
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    professionalName: notification.appointment.professional.user.name,
  }));

  return (
    <main className="animate-fade-in space-y-6 px-5 pb-28 pt-6">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
          <Bell className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{result.salon.name}</p>
          <h1 className="text-2xl font-semibold">Notificações</h1>
        </div>
      </header>

      <NotificationList
        notifications={notifications}
        timezone={result.salon.timezone}
        scope="client"
        salonSlug={salonSlug}
      />
      <BottomNav salonSlug={salonSlug} />
    </main>
  );
}
