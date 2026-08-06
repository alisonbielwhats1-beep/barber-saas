import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { withSalon } from "@/lib/prisma-tenant";
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
  createAppointment,
} from "@/lib/appointment-service";
import { isAppointmentError } from "@/lib/appointment-domain";

class PublicBookingError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

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

  const parsed = publicAppointmentSchema.safeParse(await req.json());
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
    const result = await withSalon(booking.salonId, async (tx) => {
      const created = await createAppointment(tx, {
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
        idempotencyContext: normalizedCart,
        enforceBookingWindow: true,
        ...(identity.kind === "authenticated"
          ? { clientId: identity.clientId }
          : {
              guest: {
                name: booking.clientName!,
                phone: booking.clientPhone!,
              },
            }),
      });

      // O retry idempotente retorna antes de reler o catálogo. Um produto que
      // ficou inativo depois da primeira confirmação não pode transformar o
      // mesmo retry em erro. Na primeira execução, qualquer falha abaixo
      // reverte appointment, evento, notificação e cliente convidado juntos.
      if (!created.duplicate && normalizedCart.length > 0) {
        const products = await tx.product.findMany({
          where: {
            id: { in: normalizedCart.map((item) => item.productId) },
            salonId: booking.salonId,
            active: true,
          },
          select: { id: true, priceCents: true, name: true },
        });
        if (products.length !== normalizedCart.length) {
          throw new PublicBookingError("PRODUCT_INVALID", 400);
        }
        const productsById = new Map(
          products.map((product) => [product.id, product]),
        );
        const productSnapshots = normalizedCart.map((item) => ({
          ...item,
          priceCentsUnit: productsById.get(item.productId)!.priceCents,
          name: productsById.get(item.productId)!.name,
        }));
        for (const product of productSnapshots) {
          const reserved = await tx.product.updateMany({
            where: {
              id: product.productId,
              salonId: booking.salonId,
              active: true,
              stock: { gte: product.quantity },
            },
            data: { stock: { decrement: product.quantity } },
          });
          if (reserved.count !== 1) {
            throw new PublicBookingError(
              `Estoque insuficiente: ${product.name}`,
              409,
            );
          }
        }
        await tx.appointmentProduct.createMany({
          data: productSnapshots.map((product) => ({
            appointmentId: created.appointment.id,
            productId: product.productId,
            quantity: product.quantity,
            priceCentsUnit: product.priceCentsUnit,
          })),
        });
      }
      return created;
    });

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
    if (error instanceof PublicBookingError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
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
