import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import { isCronAuthorized } from "@/lib/cron-auth";
import { recordAppointmentEvent } from "@/lib/appointment-events";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  startOfDateInTimeZone,
} from "@/lib/time";
import { queueClientReminderChannels, reminderIdempotencyKey, reminderTemplate, type ReminderPhase } from "@/lib/client-reminders";
import { clientPushEnabled, reminderEmailEnabled } from "@/lib/client-push";
import { deliverPendingClientReminders } from "@/lib/client-reminder-delivery";

/**
 * Cria lembretes de véspera ou do dia em cada fuso IANA. O evento e cada
 * entrega externa têm chaves únicas; reexecuções não criam novos avisos.
 */
export async function runReminders(req: NextRequest, phase: ReminderPhase) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();

  const salons = await prisma.salon.findMany({
    where: { accessStatus: "APPROVED" },
    select: { id: true, timezone: true, name: true, slug: true },
    orderBy: { id: "asc" },
  });
  let generated = 0;
  let count = 0;

  for (const salon of salons) {
    const today = dateKeyInTimeZone(now, salon.timezone);
    const reminderDate = phase === "today" ? today : addCalendarDays(today, 1);
    const from = startOfDateInTimeZone(reminderDate, salon.timezone);
    const to = startOfDateInTimeZone(addCalendarDays(reminderDate, 1), salon.timezone);

    const result = await withApprovedSalon(salon.id, async (tx) => {
      const rows = await tx.appointment.findMany({
        where: {
          salonId: salon.id,
          status: { in: ["CONFIRMED", "PENDING"] },
          startAt: { gte: phase === "today" && now > from ? now : from, lt: to },
        },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          startAt: true,
          endAt: true,
          timezone: true,
          client: { select: { name: true } },
          professional: { select: { user: { select: { name: true } } } },
          service: { select: { name: true } },
          serviceItems: {
            orderBy: { position: "asc" },
            select: { serviceName: true },
          },
        },
        orderBy: { startAt: "asc" },
      });

      let created = 0;
      for (const appointment of rows) {
        const serviceNames = appointment.serviceItems.length > 0
          ? appointment.serviceItems.map((service) => service.serviceName)
          : [appointment.service.name];
        const payload = {
          appointmentId: appointment.id,
          eventType: "REMINDER_MARKED",
          reminderPhase: phase,
          startAt: appointment.startAt.toISOString(),
          endAt: appointment.endAt.toISOString(),
          timezone: appointment.timezone,
          salonName: salon.name,
          salonSlug: salon.slug,
          clientName: appointment.client.name,
          professionalName: appointment.professional.user.name,
          services: serviceNames,
        };
        const idempotencyKey = reminderIdempotencyKey(phase, reminderDate);
        const event = await recordAppointmentEvent(tx, {
          salonId: salon.id,
          appointmentId: appointment.id,
          eventType: "REMINDER_MARKED",
          actor: { type: "SYSTEM", name: "Lembrete automático" },
          correlationId: randomUUID(),
          idempotencyKey,
          requestFingerprint: idempotencyKey,
          newValue: payload,
          recipients: [{ type: "CLIENT", id: appointment.clientId }],
          template: reminderTemplate(phase),
          payload,
        });
        await queueClientReminderChannels(tx, {
          salonId: salon.id,
          clientId: appointment.clientId,
          appointmentId: appointment.id,
          eventId: event.id,
          template: reminderTemplate(phase),
          payload,
          pushEnabled: clientPushEnabled(),
          emailEnabled: reminderEmailEnabled(),
        });
        if (event.created) created++;
      }
      return { count: rows.length, created };
    });

    if (!result) continue;

    generated += result.created;
    count += result.count;
  }

  // Delivery happens after all booking transactions close. Provider failures
  // never roll back an appointment or its internal reminder.
  await deliverPendingClientReminders(salons.map(salon => salon.id), now);

  return NextResponse.json({ generated, count });
}

export async function GET(req: NextRequest) {
  return runReminders(req, "tomorrow");
}
