import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";

const body = z.object({
  salonSlug: z.string(),
  appointmentId: z.string(),
});

/**
 * POST /api/client/cancel — cliente cancela sua própria reserva.
 *
 * Autenticação pelo cookie `client_token` (sessão), nunca por telefone.
 * Respeita `cancelPolicyHours` do salão — rejeita cancelamentos feitos
 * com menos antecedência do que o configurado.
 */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "client-cancel",
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
  const { salonSlug, appointmentId } = parsed.data;

  const session = await getClientSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { id: true, cancelPolicyHours: true },
  });
  if (!salon || session.salonId !== salon.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const appt = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId: salon.id,
      clientId: session.clientId,
    },
    select: { id: true, status: true, startAt: true },
  });
  if (!appt) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (appt.status === "COMPLETED" || appt.status === "CANCELLED") {
    return NextResponse.json({ error: "ALREADY_CLOSED" }, { status: 409 });
  }
  if (!["PENDING", "CONFIRMED"].includes(appt.status)) {
    return NextResponse.json({ error: "ALREADY_STARTED" }, { status: 409 });
  }

  // Política de cancelamento: não permite cancelar com menos de N horas de antecedência
  const now = new Date();
  const hoursUntil = (appt.startAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursUntil < 0) {
    return NextResponse.json({ error: "ALREADY_STARTED" }, { status: 409 });
  }
  if (hoursUntil < salon.cancelPolicyHours) {
    return NextResponse.json({ error: "TOO_LATE_TO_CANCEL" }, { status: 409 });
  }

  const policyCutoff = new Date(
    now.getTime() + salon.cancelPolicyHours * 3_600_000,
  );
  const cancelled = await prisma.appointment.updateMany({
    where: {
      id: appt.id,
      salonId: salon.id,
      clientId: session.clientId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startAt: { gte: policyCutoff },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
    },
  });
  if (cancelled.count !== 1) {
    return NextResponse.json({ error: "STATE_CHANGED" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
