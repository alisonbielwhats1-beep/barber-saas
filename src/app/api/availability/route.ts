import { NextRequest, NextResponse } from "next/server";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { computeFreeSlots, loadDaySlotInputs } from "@/lib/day-slots";
import { bestFitSlots } from "@/lib/slot-fit";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import {
  InvalidTimeZoneError,
  InvalidWallClockError,
  addCalendarDays,
  dateKeyInTimeZone,
  hhmmInTimeZone,
  isDateKey,
  startOfDateInTimeZone,
} from "@/lib/time";

/** Retorna slots livres; a criação sempre repete a validação no servidor. */
export async function GET(req: NextRequest) {
  const requestNow = new Date();
  const limited = await checkRateLimit({
    namespace: "availability",
    identifier: clientIp(req.headers),
    limit: 60,
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
  const date = url.searchParams.get("date");
  const rescheduleId = url.searchParams.get("rescheduleId");
  if (
    !salonId ||
    !professionalId ||
    !date ||
    !isDateKey(date) ||
    serviceIds.length === 0 ||
    serviceIds.length > 10
  ) {
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

      const historyFrom = startOfDateInTimeZone(
        addCalendarDays(dateKeyInTimeZone(requestNow, salon.timezone), -90),
        salon.timezone,
      );

      const inputs = await loadDaySlotInputs(tx, {
        salonId,
        salon,
        professionalId,
        serviceIds,
        date,
        now: requestNow,
        excludeAppointmentId: rescheduleId,
      });
      if (!inputs) return null;
      const history = await tx.appointment.findMany({
        where: {
          salonId,
          professionalId,
          status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
          startAt: { gte: historyFrom, lt: requestNow },
        },
        select: { startAt: true },
        take: 500,
        orderBy: { startAt: "desc" },
      });

      return {
        ...inputs,
        pricing: inputs.pricingRule
          ? {
              label: inputs.pricingRule.label,
              targetType: inputs.pricingRule.targetType,
              adjustmentType: inputs.pricingRule.adjustmentType,
              adjustmentValue: inputs.pricingRule.adjustmentValue,
            }
          : null,
        history,
      };
    });

    if (!result) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const availableSlots = computeFreeSlots(result, {
      date,
      now: requestNow,
      enforceBookingWindow: true,
    });
    const slots = new Set(availableSlots);
    const frequency = new Map<string, number>();
    for (const appointment of result.history) {
      const key = hhmmInTimeZone(appointment.startAt, result.salon.timezone);
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
    let popularSlot: string | null = null;
    let best = 1;
    for (const [key, count] of frequency) {
      if (count > best && slots.has(key)) {
        popularSlot = key;
        best = count;
      }
    }

    // A fila só aceita atendimentos que ainda não começaram (ver joinWaitlist).
    const occupied = result.appointments
      .filter(
        (appointment) =>
          appointment.startAt > requestNow &&
          dateKeyInTimeZone(appointment.startAt, result.salon.timezone) === date,
      )
      .map((appointment) => ({
        appointmentId: appointment.id,
        time: hhmmInTimeZone(appointment.startAt, result.salon.timezone),
      }));

    return NextResponse.json(
      {
        slots: availableSlots,
        popularSlot,
        bestFitSlots: bestFitSlots(availableSlots),
        occupied,
        timezone: result.salon.timezone,
        servicePrices: result.services.map((service) => ({
          id: service.id,
          priceCents: service.priceCents, priceType: service.priceType, priceNote: service.priceNote,
        })),
        pricing: result.pricing,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
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
