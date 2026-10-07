import { z } from "zod";
import { withTenant } from "@/lib/prisma-tenant";
import { assertOwner } from "@/lib/billing/service";
import { BillingError, SECRETARY_CREDIT_PACKS } from "@/lib/billing/catalog";
import { billingEnabled, checkoutPaused } from "@/lib/billing/config";
import { ownerContext, readBillingBody, billingJson, billingFailure } from "@/lib/billing/http";
import { createCreditPurchase, syncPendingCreditPurchases } from "@/lib/billing/credits-provider";
import { creditsEnabled, secretaryCreditView } from "@/lib/secretary-credits";
import { estimatedRequests } from "@/lib/secretary-credits-rules";
import { secretaryAvailableTo } from "@/lib/secretary-availability";

export const runtime = "nodejs";
export const maxDuration = 60;
const RECENT_PURCHASES = 12;

/** Owner only: the Secretária's balance, the packs and the latest purchases, after re-reading from Mercado Pago this salon's
 * purchases still waiting for payment, as the webhook would. */
export async function GET(request: Request) {
  try {
    // Billing is the owner's (assertOwner below, in the transaction); the role only selects the open-to-owners rule.
    const ctx = await ownerContext(request);
    if (!creditsEnabled()) throw new BillingError("CREDITS_DISABLED", 503);
    if (!secretaryAvailableTo({ ...ctx, role: "OWNER" })) throw new BillingError("SECRETARY_NOT_AVAILABLE", 403);
    await withTenant(ctx, tx => assertOwner(tx, ctx));
    // Owner 06/10: every view first re-reads this salon's purchases still waiting for payment, so a paid one shows as credit right
    // away, whether or not the person came back through the checkout's button (Pix is usually paid in the bank's app).
    if (billingEnabled()) { try { await syncPendingCreditPurchases(ctx.salonId); } catch { /* the webhook and the scheduled job retry */ } }
    const [view, purchases] = await Promise.all([secretaryCreditView(ctx),
      withTenant(ctx, tx => tx.secretaryCreditPurchase.findMany({ where: { salonId: ctx.salonId }, orderBy: { createdAt: "desc" }, take: RECENT_PURCHASES,
        select: { id: true, packCode: true, amountCents: true, units: true, state: true, createdAt: true, paidAt: true, refundedCents: true, checkoutUrl: true, expiresAt: true } }))]);
    const now = Date.now();
    return billingJson({ view, buyable: billingEnabled() && !checkoutPaused(),
      // Owner 06/10: the number of requests is only an estimate ("cerca de"); amounts of credit never leave the server.
      packs: Object.entries(SECRETARY_CREDIT_PACKS).map(([code, pack]) => ({ code, amountCents: pack.amountCents, estimatedRequests: estimatedRequests(pack.units) })),
      purchases: purchases.map(({ units, ...p }) => ({ ...p, estimatedRequests: estimatedRequests(units), checkoutUrl: p.state === "AWAITING_PAYMENT" && p.expiresAt.getTime() > now ? p.checkoutUrl : null })) });
  } catch (e) { return billingFailure(e); }
}
/** Owner only: one pack. The idempotency key makes a repeated click return the same purchase and checkout. */
export async function POST(request: Request) {
  try {
    const ctx = await ownerContext(request, true);
    // Never sold to a salon that cannot use the Secretária (owner, 06/10/2026).
    if (!secretaryAvailableTo({ ...ctx, role: "OWNER" })) throw new BillingError("SECRETARY_NOT_AVAILABLE", 403);
    const key = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const purchase = await createCreditPurchase(ctx, await readBillingBody(request), key);
    // A repeated key of a purchase already paid or past its link's expiry never reopens that checkout.
    if (purchase.state !== "AWAITING_PAYMENT" || purchase.expiresAt.getTime() <= Date.now()) throw new BillingError("CREDIT_PURCHASE_EXPIRED");
    if (!purchase.checkoutUrl) throw new BillingError("CREDIT_CHECKOUT_UNAVAILABLE", 503);
    return billingJson({ id: purchase.id, checkoutUrl: purchase.checkoutUrl, state: purchase.state }, 201);
  } catch (e) { return billingFailure(e); }
}
