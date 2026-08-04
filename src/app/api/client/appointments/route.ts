import { NextRequest, NextResponse } from "next/server";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
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

  const session = await getClientSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const salonSlug = new URL(req.url).searchParams.get("salon");
  if (!salonSlug) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    if (salonId !== session.salonId) return { kind: "not_found" as const };

    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { currency: true },
    });
    if (!salon) return { kind: "not_found" as const };

    const client = await tx.clientProfile.findFirst({
      where: { id: session.clientId, salonId },
      select: { id: true, name: true },
    });
    if (!client) return { kind: "unauthenticated" as const };

    const appointments = await tx.appointment.findMany({
      where: {
        clientId: client.id,
        salonId,
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

    return { kind: "ok" as const, client, currency: salon.currency, appointments };
  });

  if (!result || result.kind === "not_found") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "unauthenticated") {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  return NextResponse.json({
    client: { name: result.client.name },
    currency: result.currency,
    appointments: result.appointments,
  });
}
