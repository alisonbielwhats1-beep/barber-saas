import "server-only";
import { randomUUID } from "node:crypto";
import type { BillingSubscription } from "@prisma/client";
import { withSalon } from "../prisma-tenant";
import { CATALOG_VERSION } from "./catalog";
import { billingConfig, planChangesPaused } from "./config";
import { billingTermsSchema } from "./change-rules";
import { changesEnabled, currentTerms, pendingChangeStates, PRICE_REDUCTION_ACTOR } from "./change-terms";
import { tablePriceCents } from "./presentation";
import { enqueue, subscriptionLock } from "./service";

/** Never start so close to the renewal that the new price could miss it. */
const MIN_LEAD_MS = 2 * 86_400_000;
/** Annual contracts are reduced in their last month, so plan changes stay free for the rest of the year. */
const MAX_LEAD_MS = 35 * 86_400_000;

/**
 * A lower table price reaches every subscriber at the next renewal (decision of
 * 03/10/2026). It is a scheduled change like an owner's reduction: the recurring
 * amount is updated and confirmed at Mercado Pago now, the paid period keeps its
 * price, and the renewal at the new price activates it. Price increases never
 * reach existing contracts. One attempt per paid period: an owner who stops it
 * to change plans keeps the current price until the next period.
 */
export async function schedulePriceReduction(sub: Pick<BillingSubscription, "id" | "salonId">, now = new Date()): Promise<boolean> {
  if (!changesEnabled() || planChangesPaused()) return false;
  const config = billingConfig();
  return withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const fresh = await tx.billingSubscription.findUnique({ where: { id: sub.id } });
    if (!fresh?.current || !fresh.providerId || fresh.providerStatus !== "authorized" || fresh.cancelRequestedAt || fresh.cancelledAt || fresh.reviewRequired || fresh.delinquentSince || !fresh.paidThrough) return false;
    if (fresh.mode !== config.mode || fresh.collectorId !== config.collectorId) return false;
    const left = fresh.paidThrough.getTime() - now.getTime();
    if (left < MIN_LEAD_MS || left > MAX_LEAD_MS) return false;
    const terms = await currentTerms(tx, fresh);
    const table = tablePriceCents(terms);
    if (table === null || table >= terms.amountCents) return false;
    if (await tx.billingPlanChange.findFirst({ where: { salonId: fresh.salonId, state: { in: pendingChangeStates } } })) return false;
    if (await tx.billingPlanChange.findFirst({ where: { salonId: fresh.salonId, subscriptionId: fresh.id, actorUserId: PRICE_REDUCTION_ACTOR, periodEnd: fresh.paidThrough } })) return false;
    const period = await tx.billingCharge.findFirst({ where: { subscriptionId: fresh.id, salonId: fresh.salonId, status: "approved", periodEnd: fresh.paidThrough, NOT: { providerInvoiceId: { startsWith: "upgrade:" } } }, orderBy: { periodStart: "desc" } });
    if (!period) return false;
    const to = billingTermsSchema.parse({ ...terms, amountCents: table, catalogVersion: CATALOG_VERSION });
    const id = randomUUID();
    await tx.billingPlanChange.create({ data: { id, salonId: fresh.salonId, subscriptionId: fresh.id, requestKey: `price-reduction:${fresh.id}:${fresh.paidThrough.getTime()}`,
      actorUserId: PRICE_REDUCTION_ACTOR, kind: "SCHEDULED", state: "PREPARING", confirmedAt: now, fromTerms: terms, toTerms: to, amountDueCents: 0,
      quotedAt: now, expiresAt: fresh.paidThrough, periodStart: period.periodStart, periodEnd: fresh.paidThrough, effectiveAt: fresh.paidThrough } });
    await tx.billingEvent.create({ data: { subscriptionId: fresh.id, salonId: fresh.salonId, key: `change:${id}:confirmed`, type: "PLAN_CHANGE_REQUESTED", detail: `PRICE_REDUCTION:${id}:${terms.amountCents}->${table}` } });
    await enqueue(tx, fresh);
    return true;
  });
}
