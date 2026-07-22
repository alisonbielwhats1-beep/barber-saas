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
 * Autenticação pelo cookie `client_token` (sessão), nunca por telefone:
 * número de telefone é informação pública e não prova identidade.
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
    select: { id: true },
  });
  if (!salon || session.salonId !== salon.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Só cancela se o agendamento pertencer ao cliente da sessão, neste salão
  const appt = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId: salon.id,
      clientId: session.clientId,
    },
    select: { id: true, status: true },
  });
  if (!appt) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (appt.status === "COMPLETED" || appt.status === "CANCELLED") {
    return NextResponse.json({ error: "ALREADY_CLOSED" }, { status: 409 });
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ ok: true });
}
