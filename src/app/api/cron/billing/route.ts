import { isCronAuthorized } from "@/lib/cron-auth";
import { runBillingWorker } from "@/lib/billing/worker";
import { billingJson, billingFailure } from "@/lib/billing/http";
import { billingEnabled } from "@/lib/billing/config";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return billingJson({ error: "UNAUTHORIZED" }, 401);
  if (!billingEnabled()) return billingJson({ disabled: true });
  try { return billingJson(await runBillingWorker(1)); } catch (e) { return billingFailure(e); }
}
