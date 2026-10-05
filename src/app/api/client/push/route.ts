import { NextRequest, NextResponse } from "next/server";
import { getClientSession } from "@/lib/client-auth";
import { clientPushEnabled, parseClientPushSubscription } from "@/lib/client-push";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { checkRateLimit, clientIp, rateLimitHeaders, rateLimitStatus } from "@/lib/rate-limit";

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin;
}

async function context(req: NextRequest) {
  const session = await getClientSession();
  if (!session) return null;
  const slug = req.nextUrl.searchParams.get("salon");
  if (!slug || slug.length > 120) return null;
  return { session, slug };
}

export async function GET(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!clientPushEnabled()) return NextResponse.json({ enabled: false });
  const allowed = await withSalonBySlug(ctx.slug, async (tx, salonId) =>
    !!(await resolveClientSessionInTenant(tx, ctx.session, salonId)),
  );
  if (!allowed) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY });
}

async function change(req: NextRequest, action: "subscribe" | "revoke" | "status") {
  if (!sameOrigin(req)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const ctx = await context(req);
  if (!ctx) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!clientPushEnabled()) return NextResponse.json({ error: "PUSH_DISABLED" }, { status: 503 });
  const limited = await checkRateLimit({
    namespace: "client-push-subscription",
    identifier: `${ctx.session.clientId}:${clientIp(req.headers)}`,
    limit: 10,
    windowSeconds: 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: limited.source === "unavailable" ? "SECURITY_SERVICE_UNAVAILABLE" : "TOO_MANY_REQUESTS" },
      { status: rateLimitStatus(limited), headers: rateLimitHeaders(limited) });
  }
  if (Number(req.headers.get("content-length") || 0) > 4096) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  let subscription;
  try { subscription = parseClientPushSubscription(await req.json()); }
  catch { return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 }); }

  const saved = await withSalonBySlug(ctx.slug, async (tx, salonId) => {
    const effective = await resolveClientSessionInTenant(tx, ctx.session, salonId);
    if (!effective) return false;
    if (action === "status") {
      const linked = await tx.clientPushSubscription.findFirst({
        where: { salonId, clientId: effective.clientId, endpoint: subscription.endpoint, revokedAt: null },
        select: { id: true },
      });
      return { active: !!linked };
    }
    if (action === "revoke") {
      await tx.clientPushSubscription.updateMany({
        where: { salonId, clientId: effective.clientId, endpoint: subscription.endpoint },
        data: { revokedAt: new Date() },
      });
    } else {
      await tx.clientPushSubscription.upsert({
        where: { salonId_endpoint: { salonId, endpoint: subscription.endpoint } },
        update: { clientId: effective.clientId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, revokedAt: null },
        create: { salonId, clientId: effective.clientId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      });
    }
    return { active: action === "subscribe" };
  });
  return saved ? NextResponse.json({ ok: true, ...saved }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

export async function POST(req: NextRequest) { return change(req, "subscribe"); }
export async function DELETE(req: NextRequest) { return change(req, "revoke"); }
export async function PUT(req: NextRequest) { return change(req, "status"); }
