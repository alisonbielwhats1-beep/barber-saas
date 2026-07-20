import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfDay, endOfDay, addMinutes, isBefore } from "date-fns";

/**
 * GET /api/availability?salonId=…&professionalId=…&serviceId=…&date=YYYY-MM-DD
 *
 * Retorna a lista de slots (HH:MM) livres para o profissional no dia,
 * respeitando: working hours, time-offs, agendamentos existentes e duração
 * do serviço.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const salonId = url.searchParams.get("salonId");
  const professionalId = url.searchParams.get("professionalId");
  const serviceId = url.searchParams.get("serviceId");
  const dateStr = url.searchParams.get("date");

  if (!salonId || !professionalId || !serviceId || !dateStr) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  const date = new Date(dateStr);
  const weekday = date.getDay();

  const [service, workingHours, timeOffs, appointments] = await Promise.all([
    prisma.service.findFirst({
      where: { id: serviceId, salonId },
      select: { durationMin: true },
    }),
    prisma.workingHours.findMany({
      where: { salonId, professionalId, weekday },
      select: { startMinutes: true, endMinutes: true },
    }),
    prisma.timeOff.findMany({
      where: {
        professionalId,
        startAt: { lte: endOfDay(date) },
        endAt: { gte: startOfDay(date) },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        professionalId,
        startAt: { gte: startOfDay(date), lte: endOfDay(date) },
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  if (!service) return NextResponse.json({ error: "service not found" }, { status: 404 });
  if (workingHours.length === 0) return NextResponse.json({ slots: [] });

  const step = 15; // grade de 15min
  const slots: string[] = [];

  for (const wh of workingHours) {
    const dayStart = new Date(date);
    dayStart.setHours(0, wh.startMinutes, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(0, wh.endMinutes, 0, 0);

    for (let cursor = dayStart; isBefore(addMinutes(cursor, service.durationMin), dayEnd) || +addMinutes(cursor, service.durationMin) === +dayEnd; cursor = addMinutes(cursor, step)) {
      const slotEnd = addMinutes(cursor, service.durationMin);

      const overlapsAppt = appointments.some(
        (a) => cursor < a.endAt && slotEnd > a.startAt,
      );
      const overlapsOff = timeOffs.some(
        (t) => cursor < t.endAt && slotEnd > t.startAt,
      );
      if (overlapsAppt || overlapsOff) continue;

      // não oferecer horário no passado do dia corrente
      if (isBefore(cursor, new Date())) continue;

      slots.push(
        `${cursor.getHours().toString().padStart(2, "0")}:${cursor
          .getMinutes()
          .toString()
          .padStart(2, "0")}`,
      );
    }
  }

  return NextResponse.json({ slots });
}
