import { after } from "next/server";
import { receiveStripeEvent } from "@/lib/billing/stripe/webhook";
import { drainTriggeredSubscription, runBillingWorker } from "@/lib/billing/worker";
import { readBillingText, billingJson, billingFailure } from "@/lib/billing/http";
export const runtime = "nodejs";
export const maxDuration = 60;
/** Stripe notices: signature checked over the exact bytes; a notice only queues its contract (stripe/webhook.ts). */
export async function POST(request: Request) {
  try {
    const target = await receiveStripeEvent(await readBillingText(request, 256 * 1024), request.headers.get("stripe-signature"));
    after(async () => {
      // Confirm this notice now; the scheduled reconciliation remains the safety net.
      if (target) { try { await drainTriggeredSubscription(target.salonId, target.subscriptionId); } catch { /* durable queue retries */ } }
      try { await runBillingWorker(1); } catch { /* durable queue retries */ }
    });
    return billingJson({ received: true });
  } catch (e) { return billingFailure(e); }
}
