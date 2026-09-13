import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { withUser } from "@/lib/prisma-tenant";
import { billingEnabled } from "@/lib/billing/config";
import { billingIntentHref, resolveBillingIntent } from "@/lib/billing/presentation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!billingEnabled()) return NextResponse.redirect(new URL("/#planos", url));
  const intent = resolveBillingIntent(Object.fromEntries(url.searchParams));
  const href = intent ? billingIntentHref(intent, "/assinatura") : "/assinatura";
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const destination = new URL(intent ? billingIntentHref(intent, "/signup") : "/signup", url);
    const segment = url.searchParams.get("segment");
    if (segment && /^[a-z-]{1,40}$/.test(segment)) destination.searchParams.set("segment", segment);
    return NextResponse.redirect(destination);
  }
  const count = await withUser(session.user.id, tx => tx.membership.count({ where: { userId: session.user.id } }));
  return NextResponse.redirect(new URL(count ? href : intent ? billingIntentHref(intent, "/onboarding/create-salon") : "/onboarding/create-salon", url));
}
