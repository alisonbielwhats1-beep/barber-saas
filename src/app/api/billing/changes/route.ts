import { after } from "next/server";
import { z } from "zod";
import { ownerContext, readBillingBody, billingJson, billingFailure } from "@/lib/billing/http";
import { createChangeQuote, confirmPlanChange, cancelPlanChange } from "@/lib/billing/changes";
import { changeView } from "@/lib/billing/change-terms";
import { runBillingWorker } from "@/lib/billing/worker";
import { contractInput } from "@/lib/billing/catalog";

export const runtime = "nodejs";
export const maxDuration = 60;
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), selection: contractInput, requestKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("confirm"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }).strict(),
]);
export async function POST(request: Request) {
  try {
    const ctx = await ownerContext(request, true);
    const body = inputSchema.parse(await readBillingBody(request));
    const result = body.action === "quote" ? await createChangeQuote(ctx, body.selection, body.requestKey)
      : body.action === "confirm" ? await confirmPlanChange(ctx, body.id) : await cancelPlanChange(ctx, body.id);
    if (body.action !== "quote") after(async () => { try { await runBillingWorker(1); } catch { /* Durable dispatch retries. */ } });
    return billingJson({ change: changeView(result) }, body.action === "quote" ? 200 : 202);
  } catch (error) { return billingFailure(error); }
}
