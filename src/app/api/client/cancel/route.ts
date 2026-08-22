import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import {
  appointmentErrorStatus,
  cancelAppointmentReliably,
} from "@/lib/appointment-service";
import { isAppointmentError } from "@/lib/appointment-domain";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  salonSlug: z.string().min(1),
  appointmentId: z.string().min(1),
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});

/** Cancela somente a reserva pertencente à sessão do cliente. */
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
      { status: rateLimitStatus(limited), headers: rateLimitHeaders(limited) },
    );
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const session = await getClientSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  try {
    const result = await withSalonBySlug(
      parsed.data.salonSlug,
      async (tx, salonId) => {
        if (session.salonId !== salonId) return null;
        const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
        if (!effectiveSession) return null;
        return cancelAppointmentReliably(tx, {
          salonId,
          appointmentId: parsed.data.appointmentId,
          actor: { type: "CLIENT", id: effectiveSession.clientId, name: effectiveSession.name },
          idempotencyKey: parsed.data.idempotencyKey,
          expectedVersion: parsed.data.expectedVersion,
          expectedClientId: effectiveSession.clientId,
          reason: parsed.data.reason,
          enforceClientPolicy: true,
        });
      },
    );
    if (!result) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    revalidatePath("/agenda");
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
    revalidatePath("/book", "layout");
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      appointment: {
        id: result.appointment.id,
        startAt: result.appointment.startAt,
        endAt: result.appointment.endAt,
        version: result.appointment.version,
        professionalId: result.appointment.professionalId,
      },
    });
  } catch (error) {
    if (isAppointmentError(error)) {
      return NextResponse.json(
        { error: error.code },
        { status: appointmentErrorStatus(error.code) },
      );
    }
    throw error;
  }
}
