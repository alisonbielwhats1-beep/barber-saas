import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { BillingPlanChange, BillingSubscription, Prisma } from "@prisma/client";
import { withSalon } from "../prisma-tenant";
import { BillingError } from "./catalog";
import { billingTermsSchema } from "./change-rules";
import { changesEnabled, pendingChangeStates, remoteMatchesTerms } from "./change-terms";
import { prepareUpgradeCheckout, upgradePayments } from "./change-provider";
import { applyUpgradePayment } from "./change-payments";
import { occupiedCapacity } from "./changes";
import { enqueue, ensureCreated, subscriptionLock, validateRemote } from "./service";
import * as mp from "./provider";
import { z } from "zod";

async function update(change: BillingPlanChange, data: Prisma.BillingPlanChangeUpdateManyMutationInput, states = [change.state]) {
  return withSalon(change.salonId, async tx => {
    await subscriptionLock(tx, change.salonId);
    return tx.billingPlanChange.updateMany({ where: { id: change.id, state: { in: states } }, data });
  });
}
async function review(change: BillingPlanChange, reason: string) {
  await update(change, { state: "REVIEW", lastError: reason });
  await withSalon(change.salonId, async tx => { await subscriptionLock(tx, change.salonId); await tx.billingSubscription.update({ where: { id: change.subscriptionId }, data: { reviewRequired: true } }); });
}
async function changeAmount(sub: BillingSubscription, change: BillingPlanChange, remote: mp.RemoteSubscription, restoring = false) {
  const source = billingTermsSchema.parse(change.fromTerms), target = billingTermsSchema.parse(change.toTerms);
  const wanted = restoring ? source : target;
  if (restoring && new Date() >= change.periodEnd && !sub.cancelRequestedAt) { await review(change, "CHANGE_RENEWAL_IN_PROGRESS"); return; }
  if (["cancelled", "canceled"].includes(remote.status)) {
    if (restoring) { await update(change, { state: "CANCELLED", cancelledAt: new Date() }); return; }
    await review(change, "CHANGE_SUBSCRIPTION_CANCELLED"); return;
  }
  if (!remoteMatchesTerms(remote, source) && !remoteMatchesTerms(remote, target)) { await review(change, "PROVIDER_CONTRACT_MISMATCH"); return; }
  if (!restoring && !change.providerStartedAt) {
    if (new Date() >= change.periodEnd) { await review(change, "CHANGE_RENEWAL_IN_PROGRESS"); return; }
    if ((remote.next_payment_date && new Date(remote.next_payment_date) < change.periodEnd) || (remote.summarized?.pending_charge_quantity ?? 0) > 0) {
      throw new BillingError("CHANGE_RENEWAL_IN_PROGRESS", 503);
    }
    const reserved = await update(change, { providerStartedAt: new Date() });
    if (!reserved.count) return;
  }
  if (!remoteMatchesTerms(remote, wanted)) {
    await mp.mpRequest(`/preapproval/${encodeURIComponent(sub.providerId!)}`, "PUT", { auto_recurring: { transaction_amount: wanted.amountCents / 100, currency_id: "BRL" } });
    const checked = await mp.getSubscription(sub.providerId!);
    validateRemote(sub, checked, false);
    if (!remoteMatchesTerms(checked, wanted)) throw new BillingError("CHANGE_NOT_CONFIRMED", 503);
  }
  if (restoring) await update(change, { state: "CANCELLED", cancelledAt: new Date(), lastError: null });
  else {
    await update(change, { state: change.kind === "UPGRADE" ? "APPLIED" : "SCHEDULED", providerSyncedAt: new Date(), lastError: null });
    // A renewal webhook can arrive while the PUT response is still uncertain.
    // Reconcile an already recorded payment instead of waiting another full cycle.
    if (change.kind === "SCHEDULED" && new Date() >= change.periodEnd) await withSalon(sub.salonId, async tx => {
      await subscriptionLock(tx, sub.salonId);
      const paid = await tx.billingCharge.findFirst({ where: { subscriptionId: sub.id, status: "approved", amountCents: target.amountCents, periodStart: { gte: change.periodEnd, lte: new Date() }, periodEnd: { gt: new Date() }, NOT: { providerInvoiceId: { startsWith: "upgrade:" } } } });
      if (paid) await tx.billingPlanChange.updateMany({ where: { id: change.id, state: "SCHEDULED" }, data: { state: "APPLIED", activatedAt: new Date(), paidAt: paid.paidAt } });
    });
  }
}
async function replacement(sub: BillingSubscription, change: BillingPlanChange) {
  const target = billingTermsSchema.parse(change.toTerms);
  const next = await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const fresh = await tx.billingPlanChange.findUniqueOrThrow({ where: { id: change.id } });
    if (fresh.replacementSubscriptionId) return tx.billingSubscription.findUniqueOrThrow({ where: { id: fresh.replacementSubscriptionId } });
    if (fresh.state !== "PREPARING" || fresh.expiresAt <= new Date()) return null;
    const created = await tx.billingSubscription.create({ data: { id: randomUUID(), salonId: sub.salonId, requestKey: `change:${change.id}`, fingerprint: createHash("sha256").update(JSON.stringify(target)).digest("hex"), current: false,
      catalogVersion: target.catalogVersion, planCode: target.plan, cycle: target.cycle, amountCents: target.amountCents, agendaLimit: target.agendaLimit, intervalMonths: target.intervalMonths,
      currency: sub.currency, mode: sub.mode, collectorId: sub.collectorId, payerEmail: sub.payerEmail, legacyPlan: sub.legacyPlan } });
    await tx.billingPlanChange.update({ where: { id: change.id }, data: { replacementSubscriptionId: created.id, creationStartedAt: new Date() } });
    await enqueue(tx, created);
    return created;
  });
  if (next) await ensureCreated(next);
  return next;
}
async function syncCycle(sub: BillingSubscription, change: BillingPlanChange) {
  const initial = await replacement(sub, change);
  if (!initial) { await update(change, { state: change.state === "CANCEL_REQUESTED" ? "CANCELLED" : "EXPIRED", cancelledAt: change.state === "CANCEL_REQUESTED" ? new Date() : null }); return; }
  const next = await withSalon(sub.salonId, tx => tx.billingSubscription.findUniqueOrThrow({ where: { id: initial.id } }));
  if (next.cancelledAt && !next.providerId) { await update(change, { state: "CANCELLED", cancelledAt: new Date() }); return; }
  if (!next.providerId) return;
  const remote = await mp.getSubscription(next.providerId);
  validateRemote(next, remote);
  if (!remote.auto_recurring.start_date || new Date(remote.auto_recurring.start_date).getTime() !== Math.ceil(change.periodEnd.getTime() / 1000) * 1000) {
    await review(change, "REPLACEMENT_START_MISMATCH");
    return;
  }
  if (change.state === "CANCEL_REQUESTED" || ["cancelled", "canceled"].includes(remote.status) || (remote.status !== "authorized" && change.expiresAt <= new Date())) {
    if (!["cancelled", "canceled"].includes(remote.status)) {
      await mp.mpRequest(`/preapproval/${encodeURIComponent(next.providerId)}`, "PUT", { status: "cancelled" });
      if (!["cancelled", "canceled"].includes((await mp.getSubscription(next.providerId)).status)) throw new BillingError("CANCELLATION_NOT_CONFIRMED", 503);
    }
    // The old recurrence cannot be resurrected after the cycle change cancelled it.
    await update(change, { state: "CANCELLED", cancelledAt: new Date(), lastError: sub.cancelRequestedAt ? "PREVIOUS_RENEWAL_ALREADY_CANCELLED" : null });
    return;
  }
  if (!sub.cancelledAt) {
    // Never expose the new authorization while the old recurring charge is still enabled.
    await withSalon(sub.salonId, async tx => {
      await subscriptionLock(tx, sub.salonId);
      const fresh = await tx.billingPlanChange.findUniqueOrThrow({ where: { id: change.id } });
      if (fresh.state === "CANCEL_REQUESTED") return;
      await tx.billingSubscription.update({ where: { id: sub.id }, data: { cancelRequestedAt: sub.cancelRequestedAt ?? new Date() } });
    });
    return;
  }
  if (remote.status !== "authorized") {
    await update(change, { state: "AWAITING_PAYMENT", checkoutUrl: next.checkoutUrl });
    return;
  }
  await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const fresh = await tx.billingPlanChange.findUniqueOrThrow({ where: { id: change.id } });
    if (fresh.state === "CANCEL_REQUESTED") return;
    await tx.billingPlanChange.update({ where: { id: change.id }, data: { state: "SCHEDULED", checkoutUrl: null, providerSyncedAt: new Date() } });
  });
  if (new Date() < change.periodEnd || !sub.cancelledAt || !next.paidThrough || next.paidThrough <= new Date()) return;
  await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const fresh = await tx.billingPlanChange.findUniqueOrThrow({ where: { id: change.id } });
    if (fresh.state !== "SCHEDULED") return;
    if (await occupiedCapacity(tx, sub.salonId) > billingTermsSchema.parse(change.toTerms).agendaLimit) throw new BillingError("PLAN_CAPACITY_TOO_SMALL");
    const confirmed = await tx.billingCharge.findFirst({ where: { subscriptionId: next.id, status: "approved", periodStart: { gte: change.periodEnd, lte: new Date() }, periodEnd: { gt: new Date() } } });
    if (!confirmed) return;
    await tx.billingSubscription.update({ where: { id: sub.id }, data: { current: false } });
    await tx.billingSubscription.update({ where: { id: next.id }, data: { current: true } });
    await tx.salon.update({ where: { id: sub.salonId }, data: { plan: "PRO" } });
    await tx.billingPlanChange.update({ where: { id: change.id }, data: { state: "APPLIED", activatedAt: new Date(), paidAt: confirmed.paidAt } });
    await enqueue(tx, next);
  });
}

async function syncSupplementalPayments(sub: BillingSubscription, change: BillingPlanChange, remote: mp.RemoteSubscription) {
  const payments = await upgradePayments(change);
  const known = await withSalon(sub.salonId, tx => tx.billingCharge.findMany({ where: { subscriptionId: sub.id, providerPaymentId: { in: payments.map(p => p.id) } }, select: { providerPaymentId: true, providerUpdatedAt: true, status: true } }));
  const payment = payments.find(p => { const prior = known.find(c => c.providerPaymentId === p.id); return !prior || prior.providerUpdatedAt < new Date(p.date_last_updated) || (p.status === "approved" && ["pending", "in_process", "rejected", "cancelled"].includes(prior.status)); });
  if (payment) await applyUpgradePayment(sub, change, remote, payment);
  await update(change, { updatedAt: new Date() });
}

/** Runs under the existing per-subscription dispatch lease; network stays outside transactions. */
export async function syncPlanChanges(sub: BillingSubscription): Promise<void> {
  if (!changesEnabled() || !sub.providerId) return;
  const change = await withSalon(sub.salonId, async tx => await tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId: sub.salonId, state: { in: pendingChangeStates.filter(state => state !== "REVIEW") }, confirmedAt: { not: null } }, orderBy: { quotedAt: "asc" } })
    ?? await tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId: sub.salonId, kind: "UPGRADE", creationStartedAt: { not: null }, confirmedAt: { not: null } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }] }));
  if (!change) return;
  if (sub.reviewRequired && ["PREPARING", "AWAITING_PAYMENT", "APPLYING", "SCHEDULED"].includes(change.state)) { await review(change, "SUBSCRIPTION_REVIEW_REQUIRED"); return; }
  const remote = await mp.getSubscription(sub.providerId);
  validateRemote(sub, remote, false);
  if (change.state === "SCHEDULED") {
    // A scheduled annual change can wait months. Continue recovery of historical
    // supplemental payments instead of starving it until the next renewal.
    const historical = await withSalon(sub.salonId, tx => tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId: sub.salonId, id: { not: change.id }, kind: "UPGRADE", creationStartedAt: { not: null }, confirmedAt: { not: null } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }] }));
    if (historical) {
      await syncSupplementalPayments(sub, historical, remote);
      const reviewed = await withSalon(sub.salonId, tx => tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id }, select: { reviewRequired: true } }));
      if (reviewed.reviewRequired) { await review(change, "SUBSCRIPTION_REVIEW_REQUIRED"); return; }
    }
  }
  if (change.kind === "CYCLE") { if (change.state !== "REVIEW") await syncCycle(sub, change); return; }
  if (change.kind === "UPGRADE" && change.creationStartedAt) {
    // Rotate historical supplemental charges for missed refund/duplicate webhooks.
    await syncSupplementalPayments(sub, change, remote);
  }
  const fresh = await withSalon(sub.salonId, tx => tx.billingPlanChange.findUniqueOrThrow({ where: { id: change.id } }));
  if (["REVIEW", "CANCELLED", "EXPIRED"].includes(fresh.state)) return;
  if (fresh.state === "CANCEL_REQUESTED") {
    if (fresh.paidAt) { await review(fresh, "CHANGE_CANNOT_CANCEL"); return; }
    if (fresh.preferenceId) {
      await mp.mpRequest(`/checkout/preferences/${encodeURIComponent(fresh.preferenceId)}`, "PUT", { expires: true, expiration_date_to: new Date().toISOString() });
      const expired = mp.parseProvider(z.object({ expires: z.boolean(), expiration_date_to: z.string().datetime({ offset: true }) }), await mp.mpRequest(`/checkout/preferences/${encodeURIComponent(fresh.preferenceId)}`));
      if (!expired.expires || new Date(expired.expiration_date_to) > new Date()) throw new BillingError("CANCELLATION_NOT_CONFIRMED", 503);
    }
    if (fresh.providerStartedAt) await changeAmount(sub, fresh, remote, true);
    else await update(fresh, { state: "CANCELLED", cancelledAt: new Date() });
    return;
  }
  if (fresh.kind === "UPGRADE" && !fresh.paidAt) {
    if (fresh.expiresAt <= new Date()) { await update(fresh, { state: "EXPIRED" }); return; }
    if (!remoteMatchesTerms(remote, billingTermsSchema.parse(fresh.fromTerms))) { await review(fresh, "PROVIDER_CONTRACT_MISMATCH"); return; }
    if (fresh.state === "PREPARING") await prepareUpgradeCheckout(sub, fresh);
    return;
  }
  if (!fresh.providerSyncedAt) await changeAmount(sub, fresh, remote);
}
