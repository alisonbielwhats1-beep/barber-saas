import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { cancelWaitlistEntry, isWaitlistError } from "@/lib/waitlist";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  salonSlug: z.string().min(1),
  waitlistId: z.string().min(1),
}).strict();

/** Cancela somente a entrada de fila pertencente ao cliente autenticado. */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimit({
    namespace: "client-waitlist-cancel",
    identifier: clientIp(req.headers),
    limit: 15,
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

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const session = await getClientSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  try {
    const result = await withSalonBySlug(parsed.data.salonSlug, async (tx, salonId) => {
      if (session.salonId !== salonId) return null;
      return cancelWaitlistEntry(tx, {
        salonId,
        entryId: parsed.data.waitlistId,
        actorType: "CLIENT",
        actorId: session.clientId,
        expectedClientId: session.clientId,
        reason: "Cancelado pelo cliente",
      });
    });
    if (!result) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    revalidatePath("/agenda");
    revalidatePath("/dashboard");
    revalidatePath("/book", "layout");
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    if (!isWaitlistError(error)) throw error;
    const status = error.code === "FORBIDDEN"
      ? 403
      : error.code === "NOT_FOUND"
        ? 404
        : 409;
    return NextResponse.json({ error: error.code }, { status });
  }
}
