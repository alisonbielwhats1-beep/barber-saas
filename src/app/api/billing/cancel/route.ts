import { after } from "next/server";
import { z } from "zod";
import { requestCancellation } from "@/lib/billing/service";
import { ownerContext, readBillingBody, billingJson, billingFailure } from "@/lib/billing/http";
import { runBillingWorker } from "@/lib/billing/worker";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const ctx = await ownerContext(request, true);
    const { subscriptionId } = z.object({ subscriptionId: z.string().uuid() }).strict().parse(await readBillingBody(request));
    const result = await requestCancellation(ctx, subscriptionId);
    after(async () => { try { await runBillingWorker(1); } catch { /* durable queue retries */ } });
    return billingJson(result, result.status === "CANCELLED" ? 200 : 202);
  } catch (e) { return billingFailure(e); }
}
