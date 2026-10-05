import { NextRequest, NextResponse } from "next/server";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { loadBookableDays } from "@/lib/day-slots";
import { effectivePublicBookingLeadDays } from "@/lib/pricing";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import {
  InvalidTimeZoneError,
  InvalidWallClockError,
  addCalendarDays,
  dateKeyInTimeZone,
} from "@/lib/time";

/**
 * Dias do calendário público com horário livre e dias lotados que ainda
 * aceitam fila de espera, de hoje até o fim da janela de antecedência do
 * salão. Não expõe reservas; a criação sempre repete a validação no servidor.
 */
export async function GET(req: NextRequest) {
  const requestNow = new Date();
  const limited = await checkRateLimit({
    namespace: "availability-days",
    identifier: clientIp(req.headers),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_REQUESTS" },
      { status: 429, headers: rateLimitHeaders(limited) },
    );
  }

  const url = new URL(req.url);
  const salonId = url.searchParams.get("salonId");
  const professionalId = url.searchParams.get("professionalId");
  const serviceIds = url.searchParams.getAll("serviceId").flatMap(value => value.split(",")).filter(Boolean);
  const rescheduleId = url.searchParams.get("rescheduleId");
  if (!salonId || !professionalId || serviceIds.length === 0 || serviceIds.length > 10) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    const session = rescheduleId ? await getClientSession() : null;
    const result = await withApprovedSalon(salonId, async (tx) => {
      if (rescheduleId) {
        const client = await resolveClientSessionInTenant(tx, session, salonId);
        if (!client) return null;
        const ownReservation = await tx.appointment.findFirst({
          where: { id: rescheduleId, salonId, clientId: client.clientId, status: { in: ["PENDING", "CONFIRMED"] } },
          select: { id: true },
        });
        if (!ownReservation) return null;
      }
      const salon = await tx.salon.findUnique({
        where: { id: salonId },
        select: {
          timezone: true,
          minBookingLeadMinutes: true,
          maxBookingLeadDays: true,
          bufferMinutes: true,
        },
      });
      if (!salon) return null;

      const fromDate = dateKeyInTimeZone(requestNow, salon.timezone);
      const toDate = addCalendarDays(fromDate, effectivePublicBookingLeadDays(salon.maxBookingLeadDays));
      const days = await loadBookableDays(tx, {
        salonId,
        salon,
        professionalId,
        serviceIds,
        fromDate,
        toDate,
        now: requestNow,
        excludeAppointmentId: rescheduleId,
      });
      return days ? { ...days, fromDate, toDate } : null;
    });

    if (!result) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    if (
      error instanceof InvalidTimeZoneError ||
      error instanceof InvalidWallClockError
    ) {
      return NextResponse.json({ error: "INVALID_TIME_CONFIGURATION" }, { status: 500 });
    }
    throw error;
  }
}
