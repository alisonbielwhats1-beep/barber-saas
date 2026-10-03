import type { BillingPlanChange, BillingSubscription, Prisma } from "@prisma/client";
import type { Tx } from "../prisma-tenant";
import { billingTermsSchema, originalTerms, type BillingTerms } from "./change-rules";
import type { RemoteSubscription } from "./provider";

export const changesEnabled = () => process.env.MERCADOPAGO_PLAN_CHANGES_ENABLED === "true";
export const pendingChangeStates = ["PREPARING", "AWAITING_PAYMENT", "APPLYING", "SCHEDULED", "CANCEL_REQUESTED", "REVIEW"];
export function remoteMatchesTerms(remote: RemoteSubscription, terms: BillingTerms) {
  return remote.auto_recurring.currency_id === "BRL" && Math.round(remote.auto_recurring.transaction_amount * 100) === terms.amountCents && remote.auto_recurring.frequency === terms.intervalMonths && remote.auto_recurring.frequency_type === "months";
}
export async function currentTerms(tx: Tx, sub: BillingSubscription): Promise<BillingTerms> {
  if (!changesEnabled()) return originalTerms(sub);
  const latest = await tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId: sub.salonId, kind: { not: "CYCLE" }, activatedAt: { not: null } }, orderBy: [{ activatedAt: "desc" }, { quotedAt: "desc" }, { id: "desc" }] });
  return latest ? billingTermsSchema.parse(latest.toTerms) : originalTerms(sub);
}
/** Mercado Pago may debit a renewal shortly before the paid period ends (batch time, time zone). */
export const RENEWAL_EARLY_TOLERANCE_MS = 3 * 86_400_000;
/**
 * Terms of one recurring invoice and the revision that defined them. A revision
 * applies from its period end; a debit up to three days earlier uses it only when
 * the invoice already has its price, so an early renewal is neither rejected nor
 * confused with the previous price.
 */
export async function invoiceRevision(tx: Tx, sub: BillingSubscription, debitDate: Date, amountCents?: number): Promise<{ terms: BillingTerms; revisionId: string | null }> {
  if (!changesEnabled()) return { terms: originalTerms(sub), revisionId: null };
  const where = { subscriptionId: sub.id, salonId: sub.salonId, kind: { not: "CYCLE" }, providerStartedAt: { not: null }, cancelledAt: null } satisfies Prisma.BillingPlanChangeWhereInput;
  if (amountCents !== undefined) {
    // Only the renewal sits this close to a period end; prefer the revision even when
    // both prices are equal, so a same-price reduction is not postponed a whole period.
    const early = await tx.billingPlanChange.findFirst({ where: { ...where, periodEnd: { gt: debitDate, lte: new Date(debitDate.getTime() + RENEWAL_EARLY_TOLERANCE_MS) } }, orderBy: [{ periodEnd: "asc" }, { quotedAt: "desc" }, { id: "desc" }] });
    const next = early ? billingTermsSchema.parse(early.toTerms) : null;
    if (early && next?.amountCents === amountCents) return { terms: next, revisionId: early.id };
  }
  const settled = await tx.billingPlanChange.findFirst({ where: { ...where, periodEnd: { lte: debitDate } }, orderBy: [{ periodEnd: "desc" }, { quotedAt: "desc" }, { id: "desc" }] });
  return { terms: settled ? billingTermsSchema.parse(settled.toTerms) : originalTerms(sub), revisionId: settled?.id ?? null };
}
export async function invoiceTerms(tx: Tx, sub: BillingSubscription, debitDate: Date, amountCents?: number): Promise<BillingTerms> {
  return (await invoiceRevision(tx, sub, debitDate, amountCents)).terms;
}
export async function allowedRemoteTerms(sub: BillingSubscription, remote: RemoteSubscription) {
  if (!changesEnabled()) return remoteMatchesTerms(remote, originalTerms(sub));
  const { withSalon } = await import("../prisma-tenant");
  return withSalon(sub.salonId, async tx => {
    if (["cancelled", "canceled"].includes(remote.status)) {
      if (remoteMatchesTerms(remote, originalTerms(sub))) return true;
      // Cancelling the recurrence leaves its last configured price at Mercado Pago.
      // A cancelled scheduled change must not make that known price look foreign.
      // Individual invoices still validate their own period and immutable terms.
      const history = await tx.billingPlanChange.findMany({ where: { subscriptionId: sub.id, salonId: sub.salonId, kind: { not: "CYCLE" }, providerStartedAt: { not: null } } });
      return history.some(change => remoteMatchesTerms(remote, billingTermsSchema.parse(change.toTerms)) || remoteMatchesTerms(remote, billingTermsSchema.parse(change.fromTerms)));
    }
    const revision = await tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId: sub.salonId, kind: { not: "CYCLE" }, providerStartedAt: { not: null }, cancelledAt: null }, orderBy: [{ quotedAt: "desc" }, { id: "desc" }] });
    if (!revision) return remoteMatchesTerms(remote, originalTerms(sub));
    const target = billingTermsSchema.parse(revision.toTerms);
    // During an uncertain PUT both the persisted source and requested target are expected.
    return remoteMatchesTerms(remote, target) || (!revision.providerSyncedAt && remoteMatchesTerms(remote, billingTermsSchema.parse(revision.fromTerms)));
  });
}
export function changeView(change: BillingPlanChange) {
  return { id: change.id, kind: change.kind, state: change.state, from: billingTermsSchema.parse(change.fromTerms), to: billingTermsSchema.parse(change.toTerms),
    amountDueCents: change.amountDueCents, effectiveAt: change.effectiveAt.toISOString(), periodEnd: change.periodEnd.toISOString(), expiresAt: change.expiresAt.toISOString(),
    paidAt: change.paidAt?.toISOString() ?? null, activatedAt: change.activatedAt?.toISOString() ?? null,
    checkoutUrl: ["AWAITING_PAYMENT", "PREPARING"].includes(change.state) && !change.paidAt && change.expiresAt > new Date() ? change.checkoutUrl : null,
    lastError: change.lastError };
}
