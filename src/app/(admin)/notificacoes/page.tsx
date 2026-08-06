import { NotificationList, type NotificationRow } from "@/components/notification-list";
import { PageHeader } from "@/components/page-header";
import { withTenant } from "@/lib/prisma-tenant";
import { getTenantContext } from "@/lib/tenant";

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default async function NotificationsPage() {
  const ctx = await getTenantContext();
  const result = await withTenant(ctx, async (tx) => {
    const [salon, notifications] = await Promise.all([
      tx.salon.findUniqueOrThrow({
        where: { id: ctx.salonId },
        select: { timezone: true },
      }),
      tx.notificationOutbox.findMany({
        where: {
          salonId: ctx.salonId,
          recipientKey: `USER:${ctx.userId}`,
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
    return { salon, notifications };
  });

  const notifications: NotificationRow[] = result.notifications.map((notification) => ({
    id: notification.id,
    template: notification.template,
    payload: payloadRecord(notification.payload),
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    professionalName: notification.appointment.professional.user.name,
  }));

  return (
    <section className="space-y-6">
      <PageHeader
        kicker="Central de avisos"
        title="Notificações"
      />
      <p className="text-sm text-muted-foreground">
        Atualizações internas sobre agendamentos, cancelamentos e lembretes.
      </p>
      <NotificationList
        notifications={notifications}
        timezone={result.salon.timezone}
        scope="staff"
      />
    </section>
  );
}
