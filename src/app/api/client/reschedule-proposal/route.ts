import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { isAppointmentError } from "@/lib/appointment-domain";
import { appointmentErrorStatus } from "@/lib/appointment-service";
import { respondToRescheduleProposal } from "@/lib/reschedule-proposals";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  salonSlug: z.string().min(1),
  proposalId: z.string().min(1),
  decision: z.enum(["ACCEPT", "REJECT"]),
  reason: z.string().trim().max(500).optional(),
}).strict();

/** Aceita ou recusa uma alteração solicitada pela equipe. */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "client-reschedule-proposal",
    identifier: clientIp(req.headers),
    limit: 20,
    windowSeconds: 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: limited.source === "unavailable"
          ? "SECURITY_SERVICE_UNAVAILABLE"
          : "TOO_MANY_REQUESTS",
      },
      { status: rateLimitStatus(limited), headers: rateLimitHeaders(limited) },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const session = await getClientSession();
  if (!session) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  try {
    const result = await withSalonBySlug(parsed.data.salonSlug, async (tx, salonId) => {
      if (session.salonId !== salonId) return null;
      const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
      if (!effectiveSession) return null;
      return respondToRescheduleProposal(tx, {
        salonId,
        proposalId: parsed.data.proposalId,
        clientId: effectiveSession.clientId,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
      });
    });
    if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    revalidatePath("/agenda");
    revalidatePath("/dashboard");
    revalidatePath("/book", "layout");
    return NextResponse.json({
      ok: true,
      status: result.status,
      duplicate: result.duplicate,
      appointment: result.appointment,
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
