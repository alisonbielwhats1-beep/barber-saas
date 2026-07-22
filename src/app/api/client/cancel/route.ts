import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";

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

  // Política de cancelamento: não permite cancelar com menos de N horas de antecedência
  const hoursUntil = (appt.startAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntil >= 0 && hoursUntil < salon.cancelPolicyHours) {
    return NextResponse.json({ error: "TOO_LATE_TO_CANCEL" }, { status: 409 });
  }

  // $executeRaw evita erro de tipo quando a migration 003 ainda não foi aplicada
  await prisma.$executeRaw`
    UPDATE "Appointment"
    SET   status = 'CANCELLED'::"AppointmentStatus",
          "cancelledAt" = NOW(),
          "updatedAt"   = NOW()
    WHERE id = ${appt.id}
  `;
  return NextResponse.json({ ok: true });
}
