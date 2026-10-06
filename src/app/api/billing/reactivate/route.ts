import { after } from "next/server";
import { z } from "zod";
import { ownerContext, readBillingBody, billingJson, billingFailure } from "@/lib/billing/http";
import { reactivateRenewal } from "@/lib/billing/changes";
import { changeView } from "@/lib/billing/change-terms";
import { drainTriggeredSubscription } from "@/lib/billing/worker";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const ctx = await ownerContext(request, true);
    const { subscriptionId, requestKey } = z.object({ subscriptionId: z.string().uuid(), requestKey: z.string().uuid() }).strict().parse(await readBillingBody(request));
    const change = await reactivateRenewal(ctx, subscriptionId, requestKey);
    // Create the new authorization now so the owner goes straight to Mercado Pago.
    after(async () => { try { await drainTriggeredSubscription(ctx.salonId, change.subscriptionId); } catch { /* durable queue retries */ } });
    return billingJson({ change: changeView(change) }, 202);
  } catch (e) { return billingFailure(e); }
}
