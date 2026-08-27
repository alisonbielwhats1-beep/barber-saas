"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Clock3, Loader2 } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import {
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
} from "@/app/(admin)/notificacoes/actions";
import {
  markAllClientNotificationsRead,
  markClientNotificationRead,
} from "@/app/book/[salonSlug]/notificacoes/actions";

export type NotificationRow = {
  id: string;
  template: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  professionalName: string;
};

const TITLES: Record<string, string> = {
  "appointment.created": "Novo agendamento",
  "appointment.rescheduled": "Agendamento remarcado",
  "appointment.reschedule_requested": "Alteração de horário — aceite necessário",
  "appointment.reschedule_accepted": "Cliente aceitou a alteração",
  "appointment.reschedule_rejected": "Cliente recusou a alteração",
  "appointment.cancelled": "Agendamento cancelado",
  "appointment.status_changed": "Status atualizado",
  "appointment.waitlist_fulfilled": "Vaga confirmada pela lista de espera",
  "appointment.reminder": "Lembrete de agendamento",
};

function serviceLabel(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.services)) return null;
  const names = payload.services
    .map((service) =>
      typeof service === "string"
        ? service
        : service && typeof service === "object" && "name" in service
          ? String(service.name)
          : null,
    )
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(" + ") : null;
}

export function NotificationList({
  notifications,
  timezone,
  scope,
  salonSlug,
}: {
  notifications: NotificationRow[];
  timezone: string;
  scope: "staff" | "client";
  salonSlug?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = notifications.filter((notification) => !notification.readAt).length;

  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [router]);

  function markRead(id: string) {
    startTransition(async () => {
      if (scope === "staff") await markStaffNotificationRead(id);
      else await markClientNotificationRead(salonSlug!, id);
      router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      if (scope === "staff") await markAllStaffNotificationsRead();
      else await markAllClientNotificationsRead(salonSlug!);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {unread === 0 ? "Tudo lido" : `${unread} ${unread === 1 ? "não lida" : "não lidas"}`}
        </p>
        <button
          type="button"
          onClick={markAll}
          disabled={pending || unread === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
          Marcar todas como lidas
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Bell className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Nenhuma notificação ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Criações, remarcações, cancelamentos e lembretes aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const startAt = typeof notification.payload.startAt === "string"
              ? new Date(notification.payload.startAt)
              : null;
            const previousStartAt = typeof notification.payload.previousStartAt === "string"
              ? new Date(notification.payload.previousStartAt)
              : null;
            const actor = notification.payload.actor &&
              typeof notification.payload.actor === "object" &&
              !Array.isArray(notification.payload.actor)
              ? (notification.payload.actor as Record<string, unknown>)
              : null;
            const actorLabel = actor && typeof actor.name === "string" ? actor.name : null;
            const reason = typeof notification.payload.reason === "string"
              ? notification.payload.reason
              : null;
            const href = scope === "staff"
              ? startAt
                ? `/agenda?date=${formatInTimeZone(startAt, timezone, "yyyy-MM-dd")}`
                : "/agenda"
              : `/book/${salonSlug}/minhas`;
            return (
              <article
                key={notification.id}
                className={`rounded-2xl border p-4 ${
                  notification.readAt ? "border-border bg-card" : "border-primary/40 bg-primary/5"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Bell className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="font-medium hover:text-primary">
                      {TITLES[notification.template] ?? "Atualização do agendamento"}
                    </Link>
                    {notification.template === "appointment.reschedule_requested" && scope === "client" && (
                      <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-300">
                        Abra suas reservas para responder.
                      </p>
                    )}
                    {previousStartAt && startAt ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatInTimeZone(previousStartAt, timezone, "dd/MM HH:mm")} →{" "}
                        {formatInTimeZone(startAt, timezone, "dd/MM HH:mm")}
                      </p>
                    ) : startAt ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatInTimeZone(startAt, timezone, "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Profissional: {notification.professionalName}
                    </p>
                    {serviceLabel(notification.payload) && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {serviceLabel(notification.payload)}
                      </p>
                    )}
                    {actorLabel && (
                      <p className="mt-1 text-xs text-muted-foreground">Alterado por {actorLabel}</p>
                    )}
                    {reason && (
                      <p className="mt-1 text-xs text-muted-foreground">Motivo: {reason}</p>
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {formatInTimeZone(new Date(notification.createdAt), timezone, "dd/MM/yyyy HH:mm")}
                    </p>
                  </div>
                  {!notification.readAt && (
                    <button
                      type="button"
                      onClick={() => markRead(notification.id)}
                      disabled={pending}
                      className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-medium text-primary disabled:opacity-40"
                    >
                      Marcar lida
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
