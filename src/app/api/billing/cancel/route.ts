import { after } from "next/server";
import { z } from "zod";
import { requestCancellation } from "@/lib/billing/service";
import { ownerContext, readBillingBody, billingJson, billingFailure } from "@/lib/billing/http";
import { drainBillingSubscription } from "@/lib/billing/worker";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const ctx = await ownerContext(request, true);
    const { subscriptionId } = z.object({ subscriptionId: z.string().uuid() }).strict().parse(await readBillingBody(request));
    const { subscriptionIds, ...result } = await requestCancellation(ctx, subscriptionId);
    after(async () => {
      // Stop every linked recurrence now instead of waiting for the schedule.
      const deadline = Date.now() + 35_000;
      for (const id of subscriptionIds) { try { await drainBillingSubscription(ctx.salonId, id, { deadline }); } catch { /* durable queue retries */ } }
    });
    return billingJson(result, result.status === "CANCELLED" ? 200 : 202);
  } catch (e) { return billingFailure(e); }
}
