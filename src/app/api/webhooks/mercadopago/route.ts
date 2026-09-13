import { after } from "next/server";
import { z } from "zod";
import { billingConfig } from "@/lib/billing/config";
import { verifyWebhook } from "@/lib/billing/provider";
import { receiveWebhook, runBillingWorker } from "@/lib/billing/worker";
import { readBillingBody, billingJson, billingFailure } from "@/lib/billing/http";
import { BillingError } from "@/lib/billing/catalog";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const config = billingConfig();
    const resourceId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(new URL(request.url).searchParams.get("data.id"));
    verifyWebhook(request.headers, resourceId, config.webhookSecret);
    const body = z.object({ id: z.union([z.number().int().safe(), z.string().max(200)]), type: z.enum(["payment", "subscription_preapproval", "subscription_authorized_payment"]),
      data: z.object({ id: z.union([z.string(), z.number().int().safe()]) }) }).parse(await readBillingBody(request));
    if (String(body.data.id).toLowerCase() !== resourceId.toLowerCase()) throw new BillingError("RESOURCE_MISMATCH", 400);
    await receiveWebhook(body.type, resourceId, String(body.id));
    after(async () => { try { await runBillingWorker(1); } catch { /* durable queue retries */ } });
    return billingJson({ received: true });
  } catch (e) { return billingFailure(e); }
}
