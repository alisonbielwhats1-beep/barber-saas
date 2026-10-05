import { after } from "next/server";
import { requestBillingSync } from "@/lib/billing/service";
import { ownerContext, billingJson, billingFailure } from "@/lib/billing/http";
import { drainTriggeredSubscription } from "@/lib/billing/worker";

export const runtime = "nodejs";
export const maxDuration = 60;
// Owner-triggered provider lookup. Same origin, rate limit and ownership checks as any billing write.
export async function POST(request: Request) {
  try {
    const ctx = await ownerContext(request, true);
    const target = await requestBillingSync(ctx);
    if (target) after(async () => { try { await drainTriggeredSubscription(target.salonId, target.subscriptionId); } catch { /* durable queue retries */ } });
    return billingJson({ queued: Boolean(target) }, 202);
  } catch (e) { return billingFailure(e); }
}
