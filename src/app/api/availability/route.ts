import { NextRequest, NextResponse } from "next/server";
import { addMinutes } from "date-fns";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { checkBookingWindow, bufferedWindow } from "@/lib/scheduling";
import {
  InvalidTimeZoneError,
  InvalidWallClockError,
  addCalendarDays,
  dateKeyInTimeZone,
  endExclusiveOfDateInTimeZone,
  hhmmInTimeZone,
  isDateKey,
  startOfDateInTimeZone,
  weekdayOfDateKey,
  zonedDateTimeToUtc,
} from "@/lib/time";

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS"] as const;

function instantForMinutes(date: string, minutes: number, timezone: string) {
  if (minutes === 24 * 60) {
    return zonedDateTimeToUtc(addCalendarDays(date, 1), "00:00", timezone);
  }
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return zonedDateTimeToUtc(
    date,
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    timezone,
  );
}

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
  const serviceIds = [
    ...new Set(
      url.searchParams
        .getAll("serviceId")
        .flatMap((value) => value.split(","))
        .filter(Boolean),
    ),
  ];
  const date = url.searchParams.get("date");
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
    const result = await withApprovedSalon(salonId, async (tx) => {
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

      const from = startOfDateInTimeZone(date, salon.timezone);
      const to = endExclusiveOfDateInTimeZone(date, salon.timezone);
      const weekday = weekdayOfDateKey(date);
      const historyFrom = startOfDateInTimeZone(
        addCalendarDays(dateKeyInTimeZone(requestNow, salon.timezone), -90),
        salon.timezone,
      );

      const services = await tx.service.findMany({
        where: { id: { in: serviceIds }, salonId, active: true },
        select: { id: true, durationMin: true },
      });
      if (services.length !== serviceIds.length) return null;

      const professionalLinks = await tx.professionalService.findMany({
        where: {
          serviceId: { in: serviceIds },
          professional: { id: professionalId, salonId, active: true },
        },
        select: { serviceId: true },
      });
      if (professionalLinks.length !== serviceIds.length) return null;

      const workingHours = await tx.workingHours.findMany({
        where: { salonId, professionalId, weekday },
        select: { startMinutes: true, endMinutes: true },
        orderBy: { startMinutes: "asc" },
      });
      const closures = await tx.salonClosure.findMany({
        where: { salonId, startAt: { lt: to }, endAt: { gt: from } },
        select: { startAt: true, endAt: true },
      });
      const timeOffs = await tx.timeOff.findMany({
        where: {
          professionalId,
          startAt: { lt: to },
          endAt: { gt: from },
        },
        select: { startAt: true, endAt: true },
      });
      const appointments = await tx.appointment.findMany({
        where: {
          salonId,
          professionalId,
          startAt: { lt: to },
          endAt: { gt: from },
          status: { in: [...ACTIVE_STATUSES] },
        },
        select: { id: true, startAt: true, endAt: true },
        orderBy: { startAt: "asc" },
      });
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
        salon,
        services,
        workingHours,
        closures,
        timeOffs,
        appointments,
        history,
      };
    });

    if (!result) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const durationMin = result.services.reduce(
      (total, service) => total + service.durationMin,
      0,
    );
    const slots = new Set<string>();
    const stepMinutes = 15;

    for (const working of result.workingHours) {
      const workingStart = instantForMinutes(
        date,
        working.startMinutes,
        result.salon.timezone,
      );
      const workingEnd = instantForMinutes(
        date,
        working.endMinutes,
        result.salon.timezone,
      );

      for (
        let cursor = workingStart;
        addMinutes(cursor, durationMin) <= workingEnd;
        cursor = addMinutes(cursor, stepMinutes)
      ) {
        const slotEnd = addMinutes(cursor, durationMin);
        if (checkBookingWindow(cursor, result.salon, requestNow) !== null) continue;

        const blockedByClosure = result.closures.some(
          (closure) => cursor < closure.endAt && slotEnd > closure.startAt,
        );
        const blockedByTimeOff = result.timeOffs.some(
          (timeOff) => cursor < timeOff.endAt && slotEnd > timeOff.startAt,
        );
        const blockedByAppointment = result.appointments.some((appointment) => {
          const buffered = bufferedWindow(
            appointment.startAt,
            appointment.endAt,
            result.salon.bufferMinutes,
          );
          return cursor < buffered.to && slotEnd > buffered.from;
        });
        if (blockedByClosure || blockedByTimeOff || blockedByAppointment) continue;
        slots.add(hhmmInTimeZone(cursor, result.salon.timezone));
      }
    }

    const availableSlots = [...slots].sort();
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

    const occupied = result.appointments
      .filter(
        (appointment) =>
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
        occupied,
        timezone: result.salon.timezone,
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
