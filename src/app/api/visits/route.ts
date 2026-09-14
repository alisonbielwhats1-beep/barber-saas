import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { createVisit, visitBookingSchema } from "@/lib/visit-scheduling";
import { isAppointmentError } from "@/lib/appointment-domain";

export async function POST(req: NextRequest) {
  const limit = await checkRateLimit({
    namespace: "public-visits",
    identifier: clientIp(req.headers),
    limit: 12,
    windowSeconds: 60,
    failClosed: true,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Aguarde um minuto antes de tentar novamente." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  const parsed = visitBookingSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (
    !parsed.success ||
    parsed.data.date !== parsed.data.startLocal.slice(0, 10)
  )
    return NextResponse.json(
      { error: "Revise os serviços e horários." },
      { status: 400 },
    );
  const session = await getClientSession();
  if (!session || session.salonId !== parsed.data.salonId)
    return NextResponse.json(
      { error: "Entre para confirmar sua visita." },
      { status: 401 },
    );
  try {
    const result = await withApprovedSalon(parsed.data.salonId, async (tx) => {
      const client = await resolveClientSessionInTenant(
        tx,
        session,
        parsed.data.salonId,
      );
      if (!client) return null;
      return createVisit(tx, {
        ...parsed.data,
        clientId: client.clientId,
        actor: { type: "CLIENT", id: client.clientId, name: client.name },
      });
    });
    if (!result)
      return NextResponse.json(
        { error: "Entre novamente para confirmar." },
        { status: 401 },
      );
    for (const path of ["/agenda", "/hoje", "/dashboard", "/clientes"])
      revalidatePath(path);
    revalidatePath("/book", "layout");
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          isAppointmentError(error) && error.code === "PRICE_CHANGED"
            ? "O valor ou a duração mudou. Consulte os horários e revise a visita novamente."
            : "Não foi possível confirmar todos os serviços. Nenhum atendimento desta tentativa foi reservado. Consulte os horários novamente.",
        code: isAppointmentError(error) ? error.code : "VISIT_UNAVAILABLE",
      },
      { status: 409 },
    );
  }
}
