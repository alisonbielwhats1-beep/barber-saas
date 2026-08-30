import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { isOverlapViolation } from "@/lib/db-errors";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import {
  appointmentErrorStatus,
  rescheduleAppointment,
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
  // Compatibilidade com clientes antigos; o servidor preserva os serviços
  // atuais do agendamento e não aceita troca silenciosa numa remarcação.
  serviceIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  professionalId: z.string().min(1),
  startLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
});

/** Remarca atomicamente a mesma reserva pertencente à sessão do cliente. */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "client-reschedule",
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const session = await getClientSession();
  if (!session) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const result = await withSalonBySlug(
      parsed.data.salonSlug,
      async (tx, salonId) => {
        if (session.salonId !== salonId) return null;
        const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
        if (!effectiveSession) return null;
        return rescheduleAppointment(tx, {
          salonId,
          appointmentId: parsed.data.appointmentId,
          professionalId: parsed.data.professionalId,
          startLocal: parsed.data.startLocal,
          actor: { type: "CLIENT", id: effectiveSession.clientId, name: effectiveSession.name },
          idempotencyKey: parsed.data.idempotencyKey,
          expectedVersion: parsed.data.expectedVersion,
          expectedClientId: effectiveSession.clientId,
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
    if (isOverlapViolation(error)) {
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
    throw error;
  }
}
