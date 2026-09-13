import type { BillingPlanChange, BillingSubscription } from "@prisma/client";
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
export async function invoiceTerms(tx: Tx, sub: BillingSubscription, debitDate: Date): Promise<BillingTerms> {
  if (!changesEnabled()) return originalTerms(sub);
  const revision = await tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId: sub.salonId, kind: { not: "CYCLE" }, providerStartedAt: { not: null }, cancelledAt: null, periodEnd: { lte: debitDate } }, orderBy: [{ periodEnd: "desc" }, { quotedAt: "desc" }, { id: "desc" }] });
  return revision ? billingTermsSchema.parse(revision.toTerms) : originalTerms(sub);
}
export async function allowedRemoteTerms(sub: BillingSubscription, remote: RemoteSubscription) {
  if (!changesEnabled()) return remoteMatchesTerms(remote, originalTerms(sub));
  const { withSalon } = await import("../prisma-tenant");
  return withSalon(sub.salonId, async tx => {
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
