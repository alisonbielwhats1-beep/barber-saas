import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import { addCalendarDays, dateKeyInTimeZone } from "./time";

export type ReminderPhase = "tomorrow" | "today";

export function reminderTemplate(phase: ReminderPhase) {
  return phase === "today" ? "appointment.reminder.today" : "appointment.reminder";
}

export function reminderIdempotencyKey(phase: ReminderPhase, date: string) {
  // Keep the historical key for the day-before reminder during rollout.
  return phase === "today" ? `reminder:today:${date}` : `reminder:${date}`;
}

export function reminderCopy(input: {
  phase: ReminderPhase;
  salonName: string;
  startAt: Date;
  timezone: string;
}) {
  const time = formatInTimeZone(input.startAt, input.timezone, "HH:mm", { locale: ptBR });
  return {
    title: input.phase === "today" ? "Seu horário é hoje ✨" : "Amanhã é seu momento ✨",
    body: `${input.salonName}: seu atendimento está marcado para ${time}. Confira os detalhes no app.`,
  };
}

export function reminderIsCurrent(input: {
  status: string;
  appointmentStartAt: Date;
  payloadStartAt: unknown;
  now: Date;
  phase?: ReminderPhase;
  timezone?: string;
}) {
  const onScheduledDay = input.phase && input.timezone
    ? dateKeyInTimeZone(input.appointmentStartAt, input.timezone) ===
      (input.phase === "today"
        ? dateKeyInTimeZone(input.now, input.timezone)
        : addCalendarDays(dateKeyInTimeZone(input.now, input.timezone), 1))
    : true;
  return onScheduledDay && ["PENDING", "CONFIRMED"].includes(input.status)
    && input.appointmentStartAt.getTime() > input.now.getTime()
    && input.payloadStartAt === input.appointmentStartAt.toISOString();
}

export async function queueClientReminderChannels(
  tx: Tx,
  input: {
    salonId: string;
    clientId: string;
    appointmentId: string;
    eventId: string;
    template: string;
    payload: Record<string, string | string[]>;
    pushEnabled: boolean;
    emailEnabled: boolean;
  },
) {
  const subscriptions = input.pushEnabled
    ? await tx.clientPushSubscription.findMany({
        where: { salonId: input.salonId, clientId: input.clientId, revokedAt: null },
        select: { id: true },
      })
    : [];
  const rows: Prisma.NotificationOutboxCreateManyInput[] = subscriptions.map((subscription) => ({
    salonId: input.salonId,
    eventId: input.eventId,
    appointmentId: input.appointmentId,
    recipientType: "CLIENT",
    recipientId: input.clientId,
    recipientKey: `CLIENT:${input.clientId}:PUSH:${subscription.id}`,
    channel: "PUSH" as const,
    template: input.template,
    payload: { ...input.payload, pushSubscriptionId: subscription.id },
    status: "PENDING" as const,
  }));
  if (subscriptions.length === 0 && input.emailEnabled) {
    const client = await tx.clientProfile.findFirst({
      where: { id: input.clientId, salonId: input.salonId, mergedIntoId: null },
      select: { email: true, authIdentityId: true, passwordHash: true },
    });
    // The client app requires an account. Manually entered contact details are
    // not enough to authorize an automatic email to a guest profile.
    if (client?.email && (client.authIdentityId || client.passwordHash)) {
      rows.push({
        salonId: input.salonId,
        eventId: input.eventId,
        appointmentId: input.appointmentId,
        recipientType: "CLIENT",
        recipientId: input.clientId,
        recipientKey: `CLIENT:${input.clientId}:EMAIL`,
        channel: "EMAIL",
        template: input.template,
        payload: input.payload,
        status: "PENDING",
      });
    }
  }
  if (rows.length) await tx.notificationOutbox.createMany({ data: rows, skipDuplicates: true });
}
