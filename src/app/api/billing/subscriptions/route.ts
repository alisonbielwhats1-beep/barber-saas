import { after } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/prisma-tenant";
import { assertOwner, contract } from "@/lib/billing/service";
import { accessState } from "@/lib/billing/catalog";
import { ownerContext, readBillingBody, billingJson, billingFailure } from "@/lib/billing/http";
import { runBillingWorker } from "@/lib/billing/worker";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const ctx = await ownerContext(request, true);
    const key = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const sub = await contract(ctx, await readBillingBody(request), key);
    after(async () => { try { await runBillingWorker(1); } catch { /* durable queue retries */ } });
    return billingJson({ id: sub.id, checkoutUrl: sub.cancelRequestedAt || sub.cancelledAt ? null : sub.checkoutUrl, state: accessState(sub), providerStatus: sub.providerStatus }, 202);
  } catch (e) { return billingFailure(e); }
}
export async function GET(request: Request) {
  try {
    const ctx = await ownerContext(request);
    const result = await withTenant(ctx, async tx => {
      await assertOwner(tx, ctx);
      const sub = await tx.billingSubscription.findFirst({ where: { salonId: ctx.salonId, current: true }, include: { charges: { take: 24, orderBy: { periodStart: "desc" } } } });
      if (!sub) return null;
      return { id: sub.id, plan: sub.planCode, cycle: sub.cycle, amountCents: sub.amountCents, agendaLimit: sub.agendaLimit,
        state: accessState(sub), paidThrough: sub.paidThrough, cancelRequestedAt: sub.cancelRequestedAt, cancelledAt: sub.cancelledAt,
        nextPaymentAt: sub.nextPaymentAt, providerStatus: sub.providerStatus, lastSyncedAt: sub.lastSyncedAt,
        reviewRequired: sub.reviewRequired, checkoutUrl: sub.cancelRequestedAt || sub.cancelledAt ? null : sub.checkoutUrl,
        charges: sub.charges.map(c => ({ id: c.id, amountCents: c.amountCents, refundedCents: c.refundedCents, status: c.status, periodStart: c.periodStart, periodEnd: c.periodEnd, paidAt: c.paidAt })) };
    });
    return billingJson({ subscription: result });
  } catch (e) { return billingFailure(e); }
}
