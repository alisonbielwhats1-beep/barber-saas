import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { withUser } from "@/lib/prisma-tenant";
import { billingEnabled } from "@/lib/billing/config";
import { billingIntentHref, resolveBillingIntent } from "@/lib/billing/presentation";
import { BILLING_INTENT_COOKIE } from "@/lib/billing/intent-cookie";

/** The remembered plan is used once; from here on it travels in the URL. */
function go(destination: URL) {
  const response = NextResponse.redirect(destination);
  response.cookies.set(BILLING_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!billingEnabled()) return go(new URL("/#planos", url));
  const intent = resolveBillingIntent(Object.fromEntries(url.searchParams));
  const href = intent ? billingIntentHref(intent, "/assinatura") : "/assinatura";
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const destination = new URL(intent ? billingIntentHref(intent, "/signup") : "/signup", url);
    const segment = url.searchParams.get("segment");
    if (segment && /^[a-z-]{1,40}$/.test(segment)) destination.searchParams.set("segment", segment);
    return go(destination);
  }
  const count = await withUser(session.user.id, tx => tx.membership.count({ where: { userId: session.user.id } }));
  return go(new URL(count ? href : intent ? billingIntentHref(intent, "/onboarding/create-salon") : "/onboarding/create-salon", url));
}
