import { NextRequest, NextResponse } from "next/server";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { loadVisitCalendar, visitChoicesSchema } from "@/lib/visit-scheduling";
import { isAppointmentError } from "@/lib/appointment-domain";
import { z } from "zod";

const querySchema = z
  .object({ salonId: z.string().min(1).max(100), choices: visitChoicesSchema })
  .strict();

/**
 * Dias do calendário da visita com vários serviços: dias com expediente e o
 * primeiro dia em que a visita inteira cabe. Não expõe reservas; a criação
 * repete toda a validação no servidor.
 */
export async function POST(req: NextRequest) {
  const limit = await checkRateLimit({
    namespace: "visit-availability-days",
    identifier: clientIp(req.headers),
    limit: 15,
    windowSeconds: 60,
    failClosed: true,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Muitas consultas. Aguarde um minuto." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  const parsed = querySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Seleção inválida." }, { status: 400 });
  try {
    const result = await withApprovedSalon(parsed.data.salonId, (tx) =>
      loadVisitCalendar(tx, parsed.data.salonId, parsed.data.choices),
    );
    if (!result)
      return NextResponse.json(
        { error: "Estabelecimento indisponível." },
        { status: 404 },
      );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: isAppointmentError(error)
          ? "Serviço ou profissional indisponível. Revise sua seleção."
          : "Não foi possível consultar os dias disponíveis.",
      },
      { status: 400 },
    );
  }
}
