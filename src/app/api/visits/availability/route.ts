import { NextRequest, NextResponse } from "next/server";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import {
  loadVisitDay,
  findVisitPlan,
  visitQuerySchema,
  visitQuote,
} from "@/lib/visit-scheduling";
import { isAppointmentError } from "@/lib/appointment-domain";

export async function POST(req: NextRequest) {
  const limit = await checkRateLimit({
    namespace: "visit-availability",
    identifier: clientIp(req.headers),
    limit: 30,
    windowSeconds: 60,
    failClosed: true,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Muitas consultas. Aguarde um minuto." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  const parsed = visitQuerySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Seleção inválida." }, { status: 400 });
  try {
    const result = await withApprovedSalon(parsed.data.salonId, async (tx) => {
      const { salonId, date, choices } = parsed.data;
      const day = await loadVisitDay(tx, salonId, date, choices);
      const plans = [];
      const budget = { remaining: 20000 };
      for (let minute = 0; minute < 1440; minute += 15) {
        const plan = findVisitPlan(day, choices, minute, { budget });
        if (plan) plans.push({ ...plan, quote: visitQuote(plan) });
      }
      return { plans };
    });
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
          : "Não foi possível consultar os horários. Escolha os profissionais e tente novamente.",
      },
      { status: 400 },
    );
  }
}
