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

/**
 * Cria lembretes internos de amanhã. Cada salão usa seu próprio fuso IANA e
 * cada evento tem chave única; reexecuções do cron não duplicam notificações.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salons = await prisma.salon.findMany({
    where: { accessStatus: "APPROVED" },
    select: { id: true, timezone: true },
    orderBy: { id: "asc" },
  });
  let generated = 0;
  let count = 0;

  for (const salon of salons) {
    const today = dateKeyInTimeZone(new Date(), salon.timezone);
    const reminderDate = addCalendarDays(today, 1);
    const from = startOfDateInTimeZone(reminderDate, salon.timezone);
    const to = startOfDateInTimeZone(addCalendarDays(reminderDate, 1), salon.timezone);

    const result = await withApprovedSalon(salon.id, async (tx) => {
      const rows = await tx.appointment.findMany({
        where: {
          salonId: salon.id,
          startAt: { gte: from, lt: to },
          status: { in: ["CONFIRMED", "PENDING"] },
          reminderSentAt: null,
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
          startAt: appointment.startAt.toISOString(),
          endAt: appointment.endAt.toISOString(),
          timezone: appointment.timezone,
          clientName: appointment.client.name,
          professionalName: appointment.professional.user.name,
          services: serviceNames,
        };
        const idempotencyKey = `reminder:${reminderDate}`;
        const before = await tx.appointmentEvent.findUnique({
          where: {
            appointmentId_idempotencyKey: {
              appointmentId: appointment.id,
              idempotencyKey,
            },
          },
          select: { id: true },
        });
        await recordAppointmentEvent(tx, {
          salonId: salon.id,
          appointmentId: appointment.id,
          eventType: "REMINDER_MARKED",
          actor: { type: "SYSTEM", name: "Lembrete automático" },
          correlationId: randomUUID(),
          idempotencyKey,
          requestFingerprint: idempotencyKey,
          newValue: payload,
          recipients: [{ type: "CLIENT", id: appointment.clientId }],
          template: "appointment.reminder",
          payload,
        });
        if (!before) created++;
      }
      return { count: rows.length, created };
    });

    if (!result) continue;

    generated += result.created;
    count += result.count;
  }

  return NextResponse.json({ generated, count });
}
