import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const body = z.object({
  salonSlug: z.string(),
  phone: z.string(),
  appointmentId: z.string(),
});

/**
 * POST /api/client/cancel — cliente cancela sua própria reserva.
 * Exige que o phone bata com o do ClientProfile do agendamento.
 */
export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { salonSlug, phone, appointmentId } = parsed.data;

  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { id: true },
  });
  if (!salon) return NextResponse.json({ error: "not found" }, { status: 404 });

  const appt = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId: salon.id,
      client: { phone },
    },
    select: { id: true, status: true, startAt: true },
  });
  if (!appt) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (appt.status === "COMPLETED" || appt.status === "CANCELLED") {
    return NextResponse.json({ error: "already closed" }, { status: 409 });
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ ok: true });
}
