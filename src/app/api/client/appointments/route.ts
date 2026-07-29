import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
} from "@/lib/rate-limit";

/**
 * GET /api/client/appointments?salon=SLUG
 *
 * O telefone não é uma credencial. A identidade vem exclusivamente do cookie
 * client_token assinado e a consulta sempre cruza cliente + salão da sessão.
 */
export async function GET(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "client-history",
    identifier: clientIp(req.headers),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_REQUESTS" },
      { status: 429, headers: rateLimitHeaders(limited) },
    );
  }

  const session = await getClientSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const salonSlug = new URL(req.url).searchParams.get("salon");
  if (!salonSlug) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { id: true, currency: true },
  });
  if (!salon || salon.id !== session.salonId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const client = await prisma.clientProfile.findFirst({
    where: { id: session.clientId, salonId: session.salonId },
    select: { id: true, name: true },
  });
  if (!client) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      clientId: client.id,
      salonId: session.salonId,
    },
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
    appointments,
  });
}
