import { isCronAuthorized } from "@/lib/cron-auth";
import { runBillingWorker } from "@/lib/billing/worker";
import { billingJson, billingFailure } from "@/lib/billing/http";
import { billingEnabled } from "@/lib/billing/config";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.BILLING_CRON_SECRET || process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) return billingJson({ error: "UNAUTHORIZED" }, 401);
  if (!billingEnabled()) return billingJson({ disabled: true });
  try { return billingJson(await runBillingWorker(1)); } catch (e) { return billingFailure(e); }
}
