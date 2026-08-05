import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withSalon } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { resolveBookingIdentity } from "@/lib/public-appointment";
import { isValidPhoneBR } from "@/lib/phone";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";

const body = z
  .object({
    salonId: z.string().min(1),
    appointmentId: z.string().min(1),
    clientName: z.string().trim().min(2).max(120).optional(),
    clientPhone: z
      .string()
      .max(32)
      .transform((value) => value.replace(/\D/g, ""))
      .refine((value) => (value.length === 10 || value.length === 11) && isValidPhoneBR(value))
      .optional(),
  })
  .strict();

/**
 * POST /api/waitlist/join — cliente entra na fila de um agendamento
 * específico que já está ocupado.
 *
 * Não cria conta nem exige uma — visitante entra com nome+telefone, igual ao
 * agendamento normal. Se o horário abrir (cancelamento), a fila é preenchida
 * automaticamente por `fulfillWaitlistOnCancel` — ver src/lib/waitlist.ts.
 */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "waitlist-join",
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
      { status: rateLimitStatus(limited), headers: rateLimitHeaders(limited) },
    );
  }

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const b = parsed.data;
  const session = await getClientSession();
  const identity = resolveBookingIdentity(session, b.salonId);

  const result = await withSalon(b.salonId, async (tx) => {
    const appt = await tx.appointment.findFirst({
      where: {
        id: b.appointmentId,
        salonId: b.salonId,
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
      select: { id: true },
    });
    if (!appt) return { kind: "not_found" as const };

    let clientId: string | null = null;
    if (identity.kind === "authenticated") {
      const client = await tx.clientProfile.findFirst({
        where: { id: identity.clientId, salonId: b.salonId },
        select: { id: true },
      });
      if (!client) return { kind: "auth_required" as const };
      clientId = client.id;

      const already = await tx.waitlistEntry.findFirst({
        where: { appointmentId: appt.id, clientId, fulfilledAt: null },
        select: { id: true },
      });
      if (already) return { kind: "already_waiting" as const };
    } else {
      if (!b.clientName || !b.clientPhone) {
        return { kind: "guest_data_required" as const };
      }
    }

    await tx.waitlistEntry.create({
      data: {
        salonId: b.salonId,
        appointmentId: appt.id,
        clientId,
        guestName: clientId ? null : b.clientName,
        guestPhone: clientId ? null : b.clientPhone,
      },
    });
    return { kind: "ok" as const };
  });

  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    case "auth_required":
      return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    case "already_waiting":
      return NextResponse.json({ error: "ALREADY_WAITING" }, { status: 409 });
    case "guest_data_required":
      return NextResponse.json({ error: "GUEST_DATA_REQUIRED" }, { status: 400 });
    case "ok":
      return NextResponse.json({ ok: true }, { status: 201 });
  }
}
