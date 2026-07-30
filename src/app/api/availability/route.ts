import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import {
  availableSlots,
  salonDayRange,
  safeTimeZone,
  weekdayForDateKey,
} from "@/lib/booking-availability";
import { formatInTimeZone } from "date-fns-tz";

/**
 * GET /api/availability?salonId=…&professionalId=…&serviceId=…&date=YYYY-MM-DD
 *
 * Retorna a lista de slots (HH:MM) livres para o profissional no dia,
 * respeitando: working hours, time-offs, agendamentos existentes e duração
 * do serviço. Também devolve `popularSlot` — o horário historicamente mais
 * agendado do profissional (se estiver livre no dia), para o front sinalizar
 * "concorrido" com dado real, não teatro.
 */
export async function GET(req: NextRequest) {
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
  const serviceId = url.searchParams.get("serviceId");
  const dateStr = url.searchParams.get("date");

  if (!salonId || !professionalId || !serviceId || !dateStr) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  let weekday: number;
  try {
    weekday = weekdayForDateKey(dateStr);
  } catch {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  const [salon, service, professionalLink, workingHours, history] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        timezone: true,
        openMinutes: true,
        closeMinutes: true,
      },
    }),
    prisma.service.findFirst({
      where: { id: serviceId, salonId, active: true },
      select: { durationMin: true },
    }),
    prisma.professionalService.findFirst({
      where: {
        serviceId,
        professional: { id: professionalId, salonId, active: true },
      },
      select: { serviceId: true },
    }),
    prisma.workingHours.findMany({
      where: { salonId, professionalId, weekday },
      select: { startMinutes: true, endMinutes: true },
    }),
    // Histórico de horários do profissional (qualquer dia) para achar o mais pedido
    prisma.appointment.findMany({
      where: {
        salonId,
        professionalId,
        status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
      },
      select: { startAt: true },
      take: 500,
      orderBy: { startAt: "desc" },
    }),
  ]);

  if (!salon || !service || !professionalLink) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (workingHours.length === 0) return NextResponse.json({ slots: [] });

  const timeZone = safeTimeZone(salon.timezone);
  const dayRange = salonDayRange(dateStr, timeZone);
  const [timeOffs, appointments] = await Promise.all([
    prisma.timeOff.findMany({
      where: {
        professionalId,
        startAt: { lt: dayRange.endAt },
        endAt: { gt: dayRange.startAt },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        salonId,
        professionalId,
        startAt: { lt: dayRange.endAt },
        endAt: { gt: dayRange.startAt },
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const slots = availableSlots({
    dateKey: dateStr,
    durationMinutes: service.durationMin,
    now: new Date(),
    timeZone,
    salonOpenMinutes: salon.openMinutes,
    salonCloseMinutes: salon.closeMinutes,
    workingHours,
    timeOffs,
    appointments,
  });

  // Horário (HH:MM) mais frequente no histórico que esteja livre hoje
  const freq = new Map<string, number>();
  for (const a of history) {
    const key = formatInTimeZone(a.startAt, timeZone, "HH:mm");
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  let popularSlot: string | null = null;
  let best = 1; // exige pelo menos 2 ocorrências pra valer o selo
  for (const [key, count] of freq) {
    if (count > best && slots.includes(key)) {
      best = count;
      popularSlot = key;
    }
  }

  return NextResponse.json({ slots, popularSlot });
}
