import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/client/appointments?salon=SLUG&phone=X
 *
 * Retorna os agendamentos do cliente (identificado pelo phone dentro do salão).
 * Sem auth pesada — o phone salvo no localStorage é a "identidade".
 *
 * Considerações de segurança:
 *  - Só retorna dados do cliente cujo phone bate — não vaza lista de clientes
 *  - Não expõe outros campos além do agendamento
 *  - Em produção, para operações destrutivas (cancelar), deve-se exigir OTP
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const salonSlug = url.searchParams.get("salon");
  const phone = url.searchParams.get("phone");
  if (!salonSlug || !phone) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { id: true, currency: true },
  });
  if (!salon) return NextResponse.json({ appointments: [] });

  const client = await prisma.clientProfile.findFirst({
    where: { salonId: salon.id, phone },
    select: { id: true, name: true },
  });
  if (!client) return NextResponse.json({ appointments: [] });

  const appts = await prisma.appointment.findMany({
    where: { clientId: client.id, salonId: salon.id },
    orderBy: { startAt: "desc" },
    take: 50,
    select: {
      id: true,
      startAt: true,
      endAt: true,
      priceCents: true,
      status: true,
      service: { select: { name: true, colorHex: true } },
      professional: { select: { user: { select: { name: true } } } },
      products: {
        select: {
          quantity: true,
          priceCentsUnit: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    client: { name: client.name },
    currency: salon.currency,
    appointments: appts,
  });
}
