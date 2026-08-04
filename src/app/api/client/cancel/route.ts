import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withSalonBySlug } from "@/lib/prisma-tenant";
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

  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    if (session.salonId !== salonId) return { kind: "not_found" as const };

    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { cancelPolicyHours: true },
    });
    if (!salon) return { kind: "not_found" as const };

    const appt = await tx.appointment.findFirst({
      where: {
        id: appointmentId,
        salonId,
        clientId: session.clientId,
      },
      select: { id: true, status: true, startAt: true },
    });
    if (!appt) return { kind: "forbidden" as const };
    if (appt.status === "COMPLETED" || appt.status === "CANCELLED") {
      return { kind: "already_closed" as const };
    }

    // Política de cancelamento: não permite cancelar com menos de N horas de antecedência
    const hoursUntil = (appt.startAt.getTime() - Date.now()) / 3_600_000;
    if (hoursUntil >= 0 && hoursUntil < salon.cancelPolicyHours) {
      return { kind: "too_late" as const };
    }

    // $executeRaw evita erro de tipo quando a migration 003 ainda não foi aplicada
    await tx.$executeRaw`
      UPDATE "Appointment"
      SET   status = 'CANCELLED'::"AppointmentStatus",
            "cancelledAt" = NOW(),
            "updatedAt"   = NOW()
      WHERE id = ${appt.id}
    `;
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
      return NextResponse.json({ error: "TOO_LATE_TO_CANCEL" }, { status: 409 });
    case "ok":
      return NextResponse.json({ ok: true });
  }
}
