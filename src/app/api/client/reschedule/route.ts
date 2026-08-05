import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { isOverlapViolation } from "@/lib/db-errors";
import { getClientSession } from "@/lib/client-auth";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";
import { checkBookingWindow, bufferedWindow } from "@/lib/scheduling";
import { addMinutes } from "date-fns";

const body = z.object({
  salonSlug: z.string(),
  appointmentId: z.string(),
  serviceId: z.string(),
  professionalId: z.string(),
  startAt: z.string().datetime(),
});

/**
 * POST /api/client/reschedule — cliente troca data/hora (e opcionalmente
 * serviço/profissional) da própria reserva.
 *
 * Atualiza a MESMA linha de Appointment em vez de cancelar + criar uma nova —
 * é o que faz essa ação não aparecer como um cancelamento nas métricas do
 * dashboard, e não deixa uma janela em que o cliente fica sem reserva ativa
 * caso a criação da nova falhe. Mesmas guardas de `api/client/cancel`
 * (sessão, posse, `cancelPolicyHours`) aplicadas ao horário ORIGINAL — trocar
 * de horário em cima da hora libera o profissional do mesmo jeito que cancelar.
 */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "client-reschedule",
    identifier: clientIp(req.headers),
    limit: 15,
    windowSeconds: 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error:
          limited.source === "unavailable"
            ? "SECURITY_SERVICE_UNAVAILABLE"
            : "TOO_MANY_REQUESTS",
      },
      {
        status: rateLimitStatus(limited),
        headers: rateLimitHeaders(limited),
      },
    );
  }

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const { salonSlug, appointmentId, serviceId, professionalId, startAt: startAtRaw } =
    parsed.data;

  const session = await getClientSession();
  if (!session) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const startAt = new Date(startAtRaw);

  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    if (session.salonId !== salonId) return { kind: "not_found" as const };

    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
        cancelPolicyHours: true,
        minBookingLeadMinutes: true,
        maxBookingLeadDays: true,
        bufferMinutes: true,
      },
    });
    if (!salon) return { kind: "not_found" as const };

    const original = await tx.appointment.findFirst({
      where: { id: appointmentId, salonId, clientId: session.clientId },
      select: { id: true, status: true, startAt: true },
    });
    if (!original) return { kind: "forbidden" as const };
    if (original.status === "COMPLETED" || original.status === "CANCELLED") {
      return { kind: "already_closed" as const };
    }

    const hoursUntil = (original.startAt.getTime() - Date.now()) / 3_600_000;
    if (hoursUntil >= 0 && hoursUntil < salon.cancelPolicyHours) {
      return { kind: "too_late" as const };
    }

    if (checkBookingWindow(startAt, salon) !== null) return { kind: "slot_taken" as const };

    const service = await tx.service.findFirst({
      where: { id: serviceId, salonId, active: true },
      select: { durationMin: true, priceCents: true },
    });
    if (!service) return { kind: "service_invalid" as const };
    const prosLink = await tx.professionalService.findFirst({
      where: { serviceId, professional: { id: professionalId, salonId, active: true } },
    });
    if (!prosLink) return { kind: "pro_mismatch" as const };

    const endAt = addMinutes(startAt, service.durationMin);
    const buffered = bufferedWindow(startAt, endAt, salon.bufferMinutes);
    const conflict = await tx.appointment.findFirst({
      where: {
        id: { not: appointmentId },
        professionalId,
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
        startAt: { lt: buffered.to },
        endAt: { gt: buffered.from },
      },
      select: { id: true },
    });
    if (conflict) return { kind: "slot_taken" as const };

    try {
      const updated = await tx.appointment.updateMany({
        where: { id: appointmentId, salonId, clientId: session.clientId },
        data: {
          serviceId,
          professionalId,
          startAt,
          endAt,
          priceCents: service.priceCents,
          status: "CONFIRMED",
          reminderSentAt: null,
        },
      });
      if (updated.count !== 1) return { kind: "forbidden" as const };
    } catch (e) {
      if (isOverlapViolation(e)) return { kind: "slot_taken" as const };
      throw e;
    }

    return { kind: "ok" as const };
  });

  switch (result?.kind) {
    case undefined:
    case "not_found":
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    case "forbidden":
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    case "already_closed":
      return NextResponse.json({ error: "ALREADY_CLOSED" }, { status: 409 });
    case "too_late":
      return NextResponse.json({ error: "TOO_LATE_TO_RESCHEDULE" }, { status: 409 });
    case "service_invalid":
      return NextResponse.json({ error: "SERVICE_INVALID" }, { status: 400 });
    case "pro_mismatch":
      return NextResponse.json({ error: "PRO_SERVICE_MISMATCH" }, { status: 400 });
    case "slot_taken":
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    case "ok":
      return NextResponse.json({ ok: true });
  }
}
