import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import { isOverlapViolation } from "@/lib/db-errors";
import { getClientSession } from "@/lib/client-auth";
import {
  publicAppointmentSchema,
  resolveBookingIdentity,
} from "@/lib/public-appointment";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";
import {
  appointmentErrorStatus,
} from "@/lib/appointment-service";
import { isAppointmentError } from "@/lib/appointment-domain";
import {
  AppointmentProductReservationError,
  createAppointmentWithProductReservation,
} from "@/lib/appointment-product-service";

/**
 * POST /api/appointments — cria um agendamento público de forma idempotente.
 *
 * O navegador envia apenas data/hora de parede. O servidor resolve o instante
 * usando o timezone IANA do estabelecimento, recalcula serviços/preços e
 * serializa a disputa pelo profissional dentro da transação.
 */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "public-appointments",
    identifier: clientIp(req.headers),
    limit: 12,
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const parsed = publicAppointmentSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const booking = parsed.data;
  const session = await getClientSession();
  const identity = resolveBookingIdentity(session, booking.salonId);
  if (identity.kind === "guest" && (!booking.clientName || !booking.clientPhone)) {
    return NextResponse.json({ error: "GUEST_DATA_REQUIRED" }, { status: 400 });
  }

  const quantities = new Map<string, number>();
  for (const item of booking.cartItems) {
    const total = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (total > 20) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }
    quantities.set(item.productId, total);
  }
  const normalizedCart = [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));

  try {
    const result = await withApprovedSalon(booking.salonId, async (tx) => {
      return createAppointmentWithProductReservation(tx, {
        appointment: {
          salonId: booking.salonId,
          professionalId: booking.professionalId,
          serviceIds: booking.serviceIds,
          startLocal: booking.startLocal,
          notes: booking.notes,
          origin: "PUBLIC",
          actor:
            identity.kind === "authenticated"
              ? {
                  type: "CLIENT",
                  id: identity.clientId,
                  name: session?.name ?? "Cliente",
                }
              : { type: "GUEST", name: booking.clientName! },
          idempotencyKey: booking.idempotencyKey,
          enforceBookingWindow: true,
          enforcePlanLimits: true,
          ...(identity.kind === "authenticated"
            ? { clientId: identity.clientId }
            : {
                guest: {
                  name: booking.clientName!,
                  phone: booking.clientPhone!,
                },
              }),
        },
        productReservation: {
          actorName: identity.kind === "authenticated"
            ? session?.name ?? "Cliente"
            : booking.clientName!,
          items: normalizedCart,
        },
      });
    });

    if (!result) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    revalidatePath("/agenda");
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
    revalidatePath("/book", "layout");

    return NextResponse.json(
      {
        appointment: {
          id: result.appointment.id,
          startAt: result.appointment.startAt,
          endAt: result.appointment.endAt,
          version: result.appointment.version,
          professionalId: result.appointment.professionalId,
        },
        duplicate: result.duplicate,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof AppointmentProductReservationError) {
      const status = error.code === "INSUFFICIENT_STOCK" ? 409 : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
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
