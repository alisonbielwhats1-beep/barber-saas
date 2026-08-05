import { NextRequest, NextResponse } from "next/server";
import { withSalon } from "@/lib/prisma-tenant";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { checkBookingWindow, bufferedWindow } from "@/lib/scheduling";
import { addMinutes, isBefore } from "date-fns";
import {
  weekdayOfDateStr,
  brazilInstant,
  brazilHHMM,
  endOfBrazilDay,
} from "@/lib/br-time";
import { isSalonClosedAt } from "@/lib/closures";

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

  // Salão é sempre horário de Brasília — nunca o fuso do processo. Em
  // produção a função Vercel roda com TZ=UTC por padrão, então .getHours()/
  // startOfDay() nativos dariam o dia/hora errados perto da virada; ver
  // src/lib/br-time.ts.
  const weekday = weekdayOfDateStr(dateStr);
  const dayStartInstant = brazilInstant(dateStr, 0);
  const dayEndInstant = endOfBrazilDay(dayStartInstant);

  // Sequencial de propósito: pooler com connection_limit=1 em serverless —
  // 6 queries em Promise.all estouravam o timeout do pool (P2024). Esta rota
  // é a mais sensível do produto: é ela que o cliente final chama ao escolher
  // o dia, e falhar aqui bloqueia o agendamento.
  const { salon, service, professionalLink, workingHours, timeOffs, appointments, history, closed } =
    await withSalon(salonId, async (tx) => {
      const salon = await tx.salon.findUnique({
        where: { id: salonId },
        select: { minBookingLeadMinutes: true, maxBookingLeadDays: true, bufferMinutes: true },
      });
      const closed = await isSalonClosedAt(tx, salonId, dayStartInstant, dayEndInstant);
      // Validações primeiro — sem serviço ou vínculo válido, nem busca o resto.
      const service = await tx.service.findFirst({
        where: { id: serviceId, salonId },
        select: { durationMin: true },
      });
      const professionalLink = await tx.professionalService.findFirst({
        where: {
          serviceId,
          professional: { id: professionalId, salonId, active: true },
        },
        select: { serviceId: true },
      });
      const workingHours = await tx.workingHours.findMany({
        where: { salonId, professionalId, weekday },
        select: { startMinutes: true, endMinutes: true },
      });
      const timeOffs = await tx.timeOff.findMany({
        where: {
          professionalId,
          startAt: { lte: dayEndInstant },
          endAt: { gte: dayStartInstant },
        },
        select: { startAt: true, endAt: true },
      });
      const appointments = await tx.appointment.findMany({
        where: {
          professionalId,
          startAt: { gte: dayStartInstant, lte: dayEndInstant },
          status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
        },
        select: { id: true, startAt: true, endAt: true },
      });
      // Histórico de horários do profissional (qualquer dia) para achar o mais pedido
      const history = await tx.appointment.findMany({
        where: {
          professionalId,
          status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
        },
        select: { startAt: true },
        take: 500,
        orderBy: { startAt: "desc" },
      });
      return { salon, service, professionalLink, workingHours, timeOffs, appointments, history, closed };
    });

  if (!salon || !service || !professionalLink) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (closed) return NextResponse.json({ slots: [], closed: true });
  if (workingHours.length === 0) return NextResponse.json({ slots: [] });

  const step = 15; // grade de 15min
  const slots: string[] = [];

  for (const wh of workingHours) {
    const dayStart = brazilInstant(dateStr, wh.startMinutes);
    const dayEnd = brazilInstant(dateStr, wh.endMinutes);

    for (let cursor = dayStart; isBefore(addMinutes(cursor, service.durationMin), dayEnd) || +addMinutes(cursor, service.durationMin) === +dayEnd; cursor = addMinutes(cursor, step)) {
      const slotEnd = addMinutes(cursor, service.durationMin);

      const overlapsAppt = appointments.some((a) => {
        const buffered = bufferedWindow(a.startAt, a.endAt, salon.bufferMinutes);
        return cursor < buffered.to && slotEnd > buffered.from;
      });
      const overlapsOff = timeOffs.some(
        (t) => cursor < t.endAt && slotEnd > t.startAt,
      );
      if (overlapsAppt || overlapsOff) continue;

      // respeita antecedência mínima/máxima do salão (0 min / sem teto = como antes)
      if (checkBookingWindow(cursor, salon) !== null) continue;

      slots.push(brazilHHMM(cursor));
    }
  }

  // Horário (HH:MM) mais frequente no histórico que esteja livre hoje
  const freq = new Map<string, number>();
  for (const a of history) {
    const key = brazilHHMM(a.startAt);
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

  // Agendamentos deste profissional que ocupam ESTE dia — pro front oferecer
  // "entrar na fila de espera" em cima do horário exato, em vez de só
  // esconder o que não está livre (só faz sentido pro caso de conflito de
  // agenda; não lista nada aqui se o dia inteiro estiver fora da janela de
  // antecedência ou o profissional não trabalhar nesse dia).
  const occupied = appointments.map((a) => ({
    appointmentId: a.id,
    time: brazilHHMM(a.startAt),
  }));

  return NextResponse.json({ slots, popularSlot, occupied });
}
