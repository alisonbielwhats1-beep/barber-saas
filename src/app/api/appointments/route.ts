import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  safeTimeZone,
  salonDateKey,
  slotUnavailableReason,
  weekdayForDateKey,
} from "@/lib/booking-availability";
import { lockProfessionalSchedule } from "@/lib/appointment-lock";
import { addMinutes } from "date-fns";

/**
 * POST /api/appointments — cria agendamento público + carrinho.
 *
 * Tenant enforcement: `salonId` do payload é usado como filtro em toda query
 * (service, produto, professional-service-link). Cross-tenant impossível.
 *
 * Preços: usamos o snapshot atual do server; ignoramos qualquer preço enviado
 * pelo cliente. Cliente é UI — server é fonte da verdade.
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
  const b = parsed.data;
  const session = await getClientSession();
  const identity = resolveBookingIdentity(session, b.salonId);

  const [salon, service, prosLink] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: b.salonId },
      select: {
        timezone: true,
        openMinutes: true,
        closeMinutes: true,
      },
    }),
    prisma.service.findFirst({
      where: { id: b.serviceId, salonId: b.salonId, active: true },
      select: { durationMin: true, priceCents: true },
    }),
    prisma.professionalService.findFirst({
      where: { serviceId: b.serviceId, professional: { id: b.professionalId, salonId: b.salonId, active: true } },
    }),
  ]);
  if (!salon || !service)
    return NextResponse.json({ error: "SERVICE_INVALID" }, { status: 400 });
  if (!prosLink)
    return NextResponse.json({ error: "PRO_SERVICE_MISMATCH" }, { status: 400 });

  const startAt = new Date(b.startAt);
  const endAt = addMinutes(startAt, service.durationMin);
  const timeZone = safeTimeZone(salon.timezone);
  const dateKey = salonDateKey(startAt, timeZone);
  const weekday = weekdayForDateKey(dateKey);
  const [workingHours, timeOffs, appointments] = await Promise.all([
    prisma.workingHours.findMany({
      where: {
        salonId: b.salonId,
        professionalId: b.professionalId,
        weekday,
      },
      select: { startMinutes: true, endMinutes: true },
    }),
    prisma.timeOff.findMany({
      where: {
        professionalId: b.professionalId,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        salonId: b.salonId,
        professionalId: b.professionalId,
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);
  const unavailable = slotUnavailableReason({
    startAt,
    endAt,
    now: new Date(),
    timeZone,
    salonOpenMinutes: salon.openMinutes,
    salonCloseMinutes: salon.closeMinutes,
    workingHours,
    timeOffs,
    appointments,
  });
  if (unavailable) {
    return NextResponse.json(
      { error: unavailable },
      { status: unavailable === "INVALID_SLOT" ? 400 : 409 },
    );
  }

  // Valida produtos: só os que pertencem ao salão e têm estoque suficiente
  let productSnapshots: { productId: string; quantity: number; priceCentsUnit: number }[] = [];
  if (b.cartItems.length > 0) {
    const products = await prisma.product.findMany({
      where: {
        id: { in: b.cartItems.map((i) => i.productId) },
        salonId: b.salonId,
        active: true,
      },
      select: { id: true, priceCents: true, stock: true, name: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const ci of b.cartItems) {
      const p = byId.get(ci.productId);
      if (!p) {
        return NextResponse.json(
          { error: `Produto inválido: ${ci.productId}` },
          { status: 400 },
        );
      }
      if (p.stock < ci.quantity) {
        return NextResponse.json(
          { error: `Estoque insuficiente: ${p.name}` },
          { status: 409 },
        );
      }
      productSnapshots.push({
        productId: p.id,
        quantity: ci.quantity,
        priceCentsUnit: p.priceCents,
      });
    }
  }

  let clientId: string | null = null;
  let guestContact: { name: string; phone: string } | null = null;
  if (identity.kind === "authenticated") {
    // O ID vem exclusivamente do cookie assinado, nunca do navegador.
    const client = await prisma.clientProfile.findFirst({
      where: { id: identity.clientId, salonId: b.salonId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    }
    clientId = client.id;
  } else {
    // Visitante não prova posse do telefone. Por isso, o telefone é apenas
    // contato e nunca é usado para localizar/reutilizar uma identidade
    // existente (especialmente uma conta autenticada).
    if (!b.clientName || !b.clientPhone) {
      return NextResponse.json({ error: "GUEST_DATA_REQUIRED" }, { status: 400 });
    }
    guestContact = { name: b.clientName, phone: b.clientPhone };
  }

  let appt;
  try {
    appt = await prisma.$transaction(async (tx) => {
      await lockProfessionalSchedule(tx, b.professionalId);
      const conflict = await tx.appointment.findFirst({
        where: {
          professionalId: b.professionalId,
          status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      });
      if (conflict) throw new Error("SLOT_TAKEN");

      const appointmentClientId =
        clientId ??
        (
          await tx.clientProfile.create({
            data: {
              salonId: b.salonId,
              name: guestContact!.name,
              phone: guestContact!.phone,
            },
            select: { id: true },
          })
        ).id;
      const created = await tx.appointment.create({
        data: {
          salonId: b.salonId,
          clientId: appointmentClientId,
          serviceId: b.serviceId,
          professionalId: b.professionalId,
          startAt,
          endAt,
          priceCents: service.priceCents,
          status: "CONFIRMED",
          notes: b.notes,
        },
        select: { id: true, startAt: true, endAt: true },
      });

      if (productSnapshots.length > 0) {
        await tx.appointmentProduct.createMany({
          data: productSnapshots.map((s) => ({
            appointmentId: created.id,
            ...s,
          })),
        });
        // Decrementa estoque
        for (const s of productSnapshots) {
          await tx.product.update({
            where: { id: s.productId },
            data: { stock: { decrement: s.quantity } },
          });
        }
      }
      return created;
    });
  } catch (e) {
    // O advisory lock fecha a corrida no código atual. A detecção de 23P01
    // permanece como defesa quando a constraint definitiva puder ser aplicada.
    if (
      isOverlapViolation(e) ||
      (e instanceof Error && e.message === "SLOT_TAKEN")
    ) {
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ appointment: appt }, { status: 201 });
}
