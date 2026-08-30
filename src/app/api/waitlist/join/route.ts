import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApprovedSalon } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import {
  resolveBookingIdentity,
  resolveClientSessionInTenant,
} from "@/lib/public-appointment";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";
import { isWaitlistError, joinWaitlist } from "@/lib/waitlist";
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
    professionalId: z.string().min(1),
    serviceIds: z.array(z.string().min(1)).min(1).max(10),
    clientName: z.string().trim().min(2).max(120).optional(),
    clientPhone: z
      .string()
      .max(32)
      .refine(isValidPhoneBR)
      .transform(normalizePhone)
      .optional(),
  })
  .strict();

/** Entra idempotentemente na fila de um agendamento ocupado. */
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const parsed = body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const input = parsed.data;
  const session = await getClientSession();
  const rawIdentity = resolveBookingIdentity(session, input.salonId);
  if (rawIdentity.kind !== "authenticated") {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const result = await withApprovedSalon(input.salonId, async (tx) => {
      const authenticatedSession = rawIdentity.kind === "authenticated"
        ? await resolveClientSessionInTenant(tx, session, input.salonId)
        : null;
      if (rawIdentity.kind === "authenticated" && !authenticatedSession) {
        return { invalidSession: true as const };
      }
      if (!authenticatedSession) return { invalidSession: true as const };

      return joinWaitlist(tx, {
        salonId: input.salonId,
        appointmentId: input.appointmentId,
        professionalId: input.professionalId,
        serviceIds: input.serviceIds,
        clientId: authenticatedSession.clientId,
      });
    });
    if (result && "invalidSession" in result) {
      return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (!result) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(
      {
        ok: true,
        entryId: result.entryId,
        position: result.position,
        duplicate: result.duplicate,
        serviceNames: result.serviceNames,
        professionalId: result.professionalId,
        startAt: result.startAt,
        timezone: result.timezone,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (!isWaitlistError(error)) throw error;
    const status = error.code === "NOT_FOUND"
      ? 404
      : error.code === "AUTH_REQUIRED"
        ? 401
        : 400;
    return NextResponse.json({ error: error.code }, { status });
  }
}
