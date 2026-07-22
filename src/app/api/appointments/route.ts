import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isOverlapViolation } from "@/lib/db-errors";
import { addMinutes } from "date-fns";

const cartItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1).max(20),
});

const bodySchema = z.object({
  salonId: z.string(),
  serviceId: z.string(),
  professionalId: z.string(),
  startAt: z.string().datetime(),
  // Either authenticated (clientId) or guest (clientName + clientPhone)
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  clientPhone: z.string().min(6).optional(),
  clientEmail: z.string().email().optional(),
  notes: z.string().optional(),
  cartItems: z.array(cartItemSchema).optional().default([]),
});

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
  const json = await req.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  const [service, prosLink] = await Promise.all([
    prisma.service.findFirst({
      where: { id: b.serviceId, salonId: b.salonId, active: true },
      select: { durationMin: true, priceCents: true },
    }),
    prisma.professionalService.findFirst({
      where: { serviceId: b.serviceId, professional: { id: b.professionalId, salonId: b.salonId, active: true } },
    }),
  ]);
  if (!service) return NextResponse.json({ error: "SERVICE_INVALID" }, { status: 400 });
  if (!prosLink)
    return NextResponse.json({ error: "PRO_SERVICE_MISMATCH" }, { status: 400 });

  const startAt = new Date(b.startAt);
  const endAt = addMinutes(startAt, service.durationMin);

  const conflict = await prisma.appointment.findFirst({
    where: {
      professionalId: b.professionalId,
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (conflict) return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });

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

  let client = null;
  if (b.clientId) {
    // Authenticated client — verify they belong to this salon
    client = await prisma.clientProfile.findFirst({
      where: { id: b.clientId, salonId: b.salonId },
    });
    if (!client) return NextResponse.json({ error: "CLIENT_INVALID" }, { status: 400 });
  } else {
    // Guest flow — find or create by phone
    if (!b.clientName || !b.clientPhone) {
      return NextResponse.json({ error: "GUEST_DATA_REQUIRED" }, { status: 400 });
    }
    client = await prisma.clientProfile.findFirst({
      where: { salonId: b.salonId, phone: b.clientPhone },
    });
    client ??= await prisma.clientProfile.create({
      data: {
        salonId: b.salonId,
        name: b.clientName,
        phone: b.clientPhone,
        email: b.clientEmail ?? null,
      },
    });
  }

  let appt;
  try {
    appt = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        salonId: b.salonId,
        clientId: client!.id,
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
    // Exclusion constraint (appointment_no_overlap): outra reserva venceu a
    // corrida entre a checagem de conflito e o INSERT. Mesma resposta de slot
    // ocupado — o client recarrega a grade.
    if (isOverlapViolation(e)) {
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ appointment: appt }, { status: 201 });
}
