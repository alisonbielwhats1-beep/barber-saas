import { isCronAuthorized } from "@/lib/cron-auth";
import { runBillingWorker } from "@/lib/billing/worker";
import { billingJson, billingFailure } from "@/lib/billing/http";
import { billingEnabled } from "@/lib/billing/config";
import { reconcilePendingCreditPurchases } from "@/lib/billing/credits-provider";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.BILLING_CRON_SECRET || process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) return billingJson({ error: "UNAUTHORIZED" }, 401);
  if (!billingEnabled()) return billingJson({ disabled: true });
  try {
    const result = await runBillingWorker(1);
    // Secretária packs waiting for payment: the webhook's safety net (a failure here never fails the subscriptions' run).
    let credits: unknown = null;
    try { credits = await reconcilePendingCreditPurchases(20); } catch { console.error("SECRETARY_CREDIT_RECONCILE_FAILED"); }
    return billingJson({ ...result, credits });
  } catch (e) { return billingFailure(e); }
}
