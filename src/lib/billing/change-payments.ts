import "server-only";
import type { BillingPlanChange, BillingSubscription } from "@prisma/client";
import { withSalon } from "../prisma-tenant";
import { BillingError } from "./catalog";
import { billingTermsSchema, sameTerms } from "./change-rules";
import { currentTerms } from "./change-terms";
import { upgradeReference } from "./change-provider";
import { enqueue, subscriptionLock, validateRemote } from "./service";
import * as mp from "./provider";

/** A supplemental payment never extends the already paid calendar period. */
export async function applyUpgradePayment(sub: BillingSubscription, change: BillingPlanChange, remote: mp.RemoteSubscription, payment: mp.RemotePayment) {
  validateRemote(sub, remote, false);
  if (payment.external_reference !== upgradeReference(change) || payment.collector_id !== sub.collectorId || payment.currency_id !== "BRL" || Math.round(payment.transaction_amount * 100) !== change.amountDueCents || !remote.payer_id || payment.payer?.id !== remote.payer_id || (sub.mode === "live" && !payment.live_mode)) throw new BillingError("PAYMENT_MISMATCH");
  if (sub.mode === "test" && payment.live_mode) await mp.verifySellerAccount();
  const refundedCents = Math.round((payment.transaction_amount_refunded ?? 0) * 100);
  if (!Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > change.amountDueCents) throw new BillingError("PAYMENT_MISMATCH");
  const status = refundedCents > 0 ? "refunded" : payment.status;
  const updatedAt = new Date(payment.date_last_updated);
  const paidAt = payment.date_approved ? new Date(payment.date_approved) : null;
  if (status === "approved" && !paidAt) throw new BillingError("INVALID_PAID_PERIOD");
  return withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const fresh = await tx.billingPlanChange.findUniqueOrThrow({ where: { id: change.id } });
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    if (fresh.kind !== "UPGRADE" || !fresh.confirmedAt || fresh.subscriptionId !== sub.id || fresh.salonId !== sub.salonId) throw new BillingError("PAYMENT_MISMATCH");
    const prior = await tx.billingCharge.findUnique({ where: { providerPaymentId: payment.id } });
    if (prior && (prior.subscriptionId !== sub.id || prior.providerInvoiceId !== `upgrade:${change.id}:${payment.id}`)) throw new BillingError("PAYMENT_MISMATCH");
    if (prior && prior.providerUpdatedAt >= updatedAt && !(status === "approved" && ["pending", "in_process", "rejected", "cancelled"].includes(prior.status))) return;
    if (prior?.status === "approved" && !["approved", "refunded", "charged_back"].includes(status)) return;
    await tx.billingCharge.upsert({ where: { providerInvoiceId: `upgrade:${change.id}:${payment.id}` },
      create: { salonId: sub.salonId, subscriptionId: sub.id, providerInvoiceId: `upgrade:${change.id}:${payment.id}`, providerPaymentId: payment.id, amountCents: change.amountDueCents, refundedCents, status, paidAt, providerUpdatedAt: updatedAt, periodStart: change.quotedAt, periodEnd: change.periodEnd },
      update: { status, paidAt, refundedCents, providerUpdatedAt: updatedAt } });
    let error: string | null = null;
    if (["refunded", "charged_back"].includes(status)) error = "UPGRADE_PAYMENT_REVERSED";
    if (status === "approved" && paidAt) {
      if (fresh.providerPaymentId && fresh.providerPaymentId !== payment.id) error = "UPGRADE_DUPLICATE_PAYMENT";
      else if (!fresh.paidAt) {
        if (paidAt < fresh.quotedAt || paidAt > fresh.expiresAt || new Date() >= fresh.periodEnd || ["CANCELLED", "CANCEL_REQUESTED", "EXPIRED", "REVIEW"].includes(fresh.state)) error = "UPGRADE_PAYMENT_OUTSIDE_QUOTE";
        else if (!current.current || current.paidThrough?.getTime() !== fresh.periodEnd.getTime() || !sameTerms(await currentTerms(tx, current), billingTermsSchema.parse(fresh.fromTerms))) error = "CHANGE_QUOTE_STALE";
        else {
          await tx.billingPlanChange.update({ where: { id: change.id }, data: { providerPaymentId: payment.id, paidAt, activatedAt: new Date(), state: "APPLYING", lastError: null } });
          await tx.billingEvent.upsert({ where: { subscriptionId_key: { subscriptionId: sub.id, key: `change:${change.id}:activated` } }, update: {}, create: { salonId: sub.salonId, subscriptionId: sub.id, key: `change:${change.id}:activated`, type: "PLAN_UPGRADED", detail: `${change.id}:payment:${payment.id}` } });
        }
      }
    }
    if (error) {
      await tx.billingPlanChange.update({ where: { id: change.id }, data: { state: "REVIEW", lastError: error } });
      await tx.billingSubscription.update({ where: { id: sub.id }, data: { reviewRequired: true } });
    }
    await tx.billingEvent.upsert({ where: { subscriptionId_key: { subscriptionId: sub.id, key: `upgrade:${payment.id}:${updatedAt.toISOString()}:${status}` } }, update: {}, create: { salonId: sub.salonId, subscriptionId: sub.id, key: `upgrade:${payment.id}:${updatedAt.toISOString()}:${status}`, type: "PAYMENT_UPDATED", detail: `upgrade:${change.id}:payment:${payment.id}:${status}` } });
    await enqueue(tx, sub);
  });
}
