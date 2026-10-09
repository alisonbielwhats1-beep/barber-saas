import "server-only";
import type Stripe from "stripe";
import type { BillingSubscription } from "@prisma/client";
import { withSalon } from "../../prisma-tenant";
import { assertProvider, BillingError } from "../catalog";
import { RENEWAL_EARLY_TOLERANCE_MS } from "../change-terms";
import { recordEvent, referenceFor, subscriptionLock } from "../service";
import { stripeConfig } from "./config";
import { stripeRequest } from "./client";
import { checkoutSessionsFor, ensureStripeCheckout, knownStripeCustomer, paidSubscriptionIds } from "./checkout";

const seconds = (value: number) => new Date(value * 1000);
/** Webhook topics whose resource is a charge: refunds and disputes put the contract in review (023 doctrine). */
export const STRIPE_CHARGE_TOPICS = new Set(["charge.refunded", "charge.dispute.created", "charge.dispute.closed", "charge.dispute.funds_withdrawn"]);
const ENDED = new Set(["canceled", "incomplete_expired"]);
/** No paid period running: a cancellation ends the subscription now instead of at the period end. */
const STOP_NOW = new Set(["incomplete", "past_due", "unpaid"]);

const load = (salonId: string, id: string) => withSalon(salonId, tx => tx.billingSubscription.findUniqueOrThrow({ where: { id } }));
async function markReview(sub: BillingSubscription, reason: string) {
  await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    await tx.billingSubscription.update({ where: { id: sub.id }, data: { reviewRequired: true, lastSyncedAt: new Date() } });
    await recordEvent(tx, sub, `review:${reason}`, "REVIEW_REQUIRED", reason);
  });
}

/** The contract as Stripe bills it: one item at the stored total, in reais, every month or every twelve months. */
export function stripeTermsMatch(remote: Stripe.Subscription, sub: Pick<BillingSubscription, "amountCents" | "intervalMonths">) {
  const [item, ...others] = remote.items.data;
  const price = item?.price;
  return Boolean(item && !others.length && (item.quantity ?? 1) === 1 && remote.currency === "brl" && price?.currency === "brl" && price.unit_amount === sub.amountCents
    && price.recurring?.interval === (sub.intervalMonths === 12 ? "year" : "month") && price.recurring.interval_count === 1);
}

/** Stripe invoice → the charge vocabulary Mercado Pago already uses (approved, pending, rejected, cancelled). */
export function stripeInvoiceStatus(invoice: Pick<Stripe.Invoice, "status" | "attempt_count">) {
  if (invoice.status === "paid") return "approved";
  if (invoice.status === "void") return "cancelled";
  if (invoice.status === "uncollectible") return "rejected";
  return invoice.attempt_count > 0 ? "rejected" : "pending";
}

/** No subscription yet: either the owner is still at the checkout, or the link expired (nothing charged), or they cancelled.
 * Without a customer nothing reached Stripe (a session needs one), so a cancellation simply closes the attempt. */
async function withoutSubscription(sub: BillingSubscription, customerId: string | null) {
  const sessions = customerId ? await checkoutSessionsFor(customerId, referenceFor(sub)) : [];
  const paid = paidSubscriptionIds(sessions);
  if (paid.length > 1) { await markReview(sub, "DUPLICATE_SUBSCRIPTIONS"); return null; }
  if (paid.length === 1) return paid[0];
  const open = sessions.filter(session => session.status === "open");
  if (sub.cancelRequestedAt) for (const session of open) await stripeRequest(client => client.checkout.sessions.expire(session.id));
  const ended = sub.cancelRequestedAt || (sessions.length > 0 && !open.length);
  await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    if (current.providerId || current.cancelledAt) return;
    await tx.billingSubscription.update({ where: { id: sub.id }, data: ended
      ? { cancelledAt: new Date(), providerStatus: current.cancelRequestedAt ? "cancelled" : "expired", lastSyncedAt: new Date() } : { lastSyncedAt: new Date() } });
    if (ended) await recordEvent(tx, sub, "cancelled", "CANCELLED", current.cancelRequestedAt ? "owner" : "checkout-expired");
  });
  return null;
}

/** A refund or dispute, read back from Stripe (never from the webhook body), on the invoice it paid. */
async function applyCharge(sub: BillingSubscription, customerId: string, chargeId: string) {
  const charge = await stripeRequest(client => client.charges.retrieve(chargeId));
  const owner = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (owner !== customerId || !intent || charge.currency !== "brl") { await markReview(sub, "CHARGE_MISMATCH"); return; }
  if (!charge.refunded && charge.amount_refunded === 0 && !charge.disputed) return;
  const payments = await stripeRequest(client => client.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, limit: 10 }));
  const invoiceIds = payments.data.map(payment => typeof payment.invoice === "string" ? payment.invoice : payment.invoice.id);
  await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const rows = await tx.billingCharge.findMany({ where: { subscriptionId: sub.id, salonId: sub.salonId, providerInvoiceId: { in: invoiceIds } } });
    for (const row of rows) {
      const status = charge.disputed ? "charged_back" : "refunded";
      const refundedCents = Math.min(charge.amount_refunded, row.amountCents);
      if (row.status === status && row.refundedCents === refundedCents && row.providerPaymentId === charge.id) continue;
      await tx.billingCharge.update({ where: { id: row.id }, data: { status, refundedCents, providerPaymentId: charge.id, providerUpdatedAt: new Date() } });
      await recordEvent(tx, sub, `charge:${charge.id}:${status}:${refundedCents}`, "PAYMENT_UPDATED", `${row.providerInvoiceId}:payment:${charge.id}:${status}:refunded_cents:${refundedCents}`);
    }
    // Refunds and chargebacks are reviewed by a person; access and history stay as they are.
    await tx.billingSubscription.update({ where: { id: sub.id }, data: { reviewRequired: true } });
    await recordEvent(tx, sub, `review:charge:${charge.id}`, "REVIEW_REQUIRED", charge.disputed ? "CHARGE_DISPUTED" : "CHARGE_REFUNDED");
  });
}

/**
 * Stripe reconciliation, under the same queue lease as Mercado Pago's (worker.processJob). Nothing in a webhook or a
 * return URL grants access: the subscription and its invoices are read back from Stripe and checked against the stored
 * contract. Returns true when another step is waiting (an unprocessed webhook notice).
 */
export async function syncStripeSubscription(salonId: string, id: string): Promise<boolean> {
  let sub = await load(salonId, id);
  assertProvider(sub, "stripe");
  const config = stripeConfig({ forExisting: true });
  if (sub.mode !== config.mode || sub.collectorId !== config.accountId) throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
  if (!sub.providerId && !sub.checkoutUrl) {
    if (!sub.cancelledAt && !sub.cancelRequestedAt) await ensureStripeCheckout(sub);
    sub = await load(salonId, id);
    // Never sent to Stripe and not cancelled: nothing to reconcile yet. A started creation without a stored link
    // (lost answer, mismatch, expired or paid session) goes on to be found, closed or activated below.
    if (!sub.checkoutUrl && !sub.creationStartedAt && !sub.cancelRequestedAt) return false;
  }
  if (sub.cancelledAt && !sub.providerId) return false;
  const customerId = await knownStripeCustomer(sub);
  if (!customerId && sub.providerId) { await markReview(sub, "CUSTOMER_MISSING"); return false; }
  let providerId = sub.providerId;
  if (!providerId) {
    providerId = await withoutSubscription(sub, customerId);
    if (!providerId) return false;
    const found = providerId;
    await withSalon(salonId, async tx => {
      await subscriptionLock(tx, salonId);
      const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id } });
      if (!current.providerId) await tx.billingSubscription.update({ where: { id }, data: { providerId: found } });
    });
    sub = await load(salonId, id);
    if (sub.providerId !== found) throw new BillingError("PROVIDER_IDENTITY_MISMATCH", 409);
  }
  if (!customerId) throw new BillingError("PROVIDER_IDENTITY_MISMATCH", 409);
  let remote = await stripeRequest(client => client.subscriptions.retrieve(providerId!));
  const owner = typeof remote.customer === "string" ? remote.customer : remote.customer.id;
  if (remote.metadata?.ef_reference !== referenceFor(sub) || owner !== customerId || remote.livemode !== (sub.mode === "live")) throw new BillingError("PROVIDER_IDENTITY_MISMATCH", 409);
  // Stopping charges comes first. With a paid period running, renewal stops at its end (access kept). Without one (first
  // payment pending, or a renewal past due) it stops at once: an immediate cancellation also stops Stripe's automatic
  // collection of the subscription's open invoices, so no retry charges an owner who cancelled (Stripe docs, 2026).
  if (sub.cancelRequestedAt && !ENDED.has(remote.status) && (!remote.cancel_at_period_end || STOP_NOW.has(remote.status))) {
    remote = STOP_NOW.has(remote.status) ? await stripeRequest(client => client.subscriptions.cancel(providerId!))
      : await stripeRequest(client => client.subscriptions.update(providerId!, { cancel_at_period_end: true }, { idempotencyKey: `ef-cancel:${sub.id}` }));
    if (!ENDED.has(remote.status) && !remote.cancel_at_period_end) throw new BillingError("CANCELLATION_NOT_CONFIRMED", 503);
  }
  const invoices = (await stripeRequest(client => client.invoices.list({ subscription: providerId!, limit: 24 }))).data;
  const now = new Date();
  const renewalStopped = ENDED.has(remote.status) || remote.cancel_at_period_end;
  await withSalon(salonId, async tx => {
    await subscriptionLock(tx, salonId);
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id } });
    let paidThrough = current.paidThrough;
    let delinquentSince = current.delinquentSince;
    // Terms changed outside the app, or a renewal restarted after the app recorded its end: a person decides.
    let review = !stripeTermsMatch(remote, current) || Boolean(current.cancelledAt && !renewalStopped);
    for (const invoice of [...invoices].reverse()) {
      if (invoice.status === "draft") continue;
      const line = invoice.lines.data[0];
      if (!["subscription_create", "subscription_cycle"].includes(invoice.billing_reason ?? "") || invoice.currency !== "brl" || invoice.amount_due !== current.amountCents
        || !line || line.period.end <= line.period.start) { review = true; continue; }
      const start = seconds(line.period.start), end = seconds(line.period.end);
      const status = stripeInvoiceStatus(invoice);
      const moments = invoice.status_transitions;
      const paidAt = moments.paid_at ? seconds(moments.paid_at) : null;
      const updatedAt = seconds(moments.paid_at ?? moments.voided_at ?? moments.marked_uncollectible_at ?? moments.finalized_at ?? invoice.created);
      const prior = await tx.billingCharge.findUnique({ where: { providerInvoiceId: invoice.id } });
      if (prior && prior.subscriptionId !== id) { review = true; continue; }
      // A refund or chargeback recorded from its charge is never undone by the invoice that stays "paid".
      const settled = prior && ["refunded", "charged_back"].includes(prior.status);
      if (!settled && (!prior || prior.status !== status || prior.providerUpdatedAt.getTime() !== updatedAt.getTime() || (prior.paidAt?.getTime() ?? null) !== (paidAt?.getTime() ?? null))) {
        await tx.billingCharge.upsert({ where: { providerInvoiceId: invoice.id },
          create: { salonId, subscriptionId: id, providerInvoiceId: invoice.id, amountCents: current.amountCents, periodStart: start, periodEnd: end, status, paidAt, providerUpdatedAt: updatedAt },
          update: { status, paidAt, providerUpdatedAt: updatedAt } });
        await recordEvent(tx, current, `invoice:${invoice.id}:${updatedAt.toISOString()}:${status}`, "PAYMENT_UPDATED", `${invoice.id}:${status}`);
      }
      if (status === "approved" && !settled) {
        if (!paidAt || start > new Date(now.getTime() + 86_400_000)) { review = true; continue; }
        if (!paidThrough || end > paidThrough) paidThrough = end;
      } else if (status === "rejected" && paidThrough && start <= now && start.getTime() >= paidThrough.getTime() - RENEWAL_EARLY_TOLERANCE_MS) {
        // A failed renewal starts the five-day grace (catalog.accessState), as with Mercado Pago.
        if (!delinquentSince || start < delinquentSince) delinquentSince = start;
      }
    }
    if (paidThrough && delinquentSince && paidThrough > delinquentSince) delinquentSince = null;
    const item = remote.items.data[0];
    await tx.billingSubscription.update({ where: { id }, data: {
      providerStatus: remote.status, providerUpdatedAt: now, paidThrough, delinquentSince, lastSyncedAt: now,
      nextPaymentAt: renewalStopped || !item ? null : seconds(item.current_period_end),
      ...(renewalStopped && !current.cancelledAt ? { cancelledAt: remote.canceled_at ? seconds(remote.canceled_at) : now } : {}),
      ...(review ? { reviewRequired: true } : {}),
    } });
    if (current.providerStatus !== remote.status || (renewalStopped && !current.cancelledAt)) {
      await recordEvent(tx, current, `subscription:${remote.status}:${renewalStopped}`, "SUBSCRIPTION_UPDATED", `${remote.status}${remote.cancel_at_period_end ? ":cancel_at_period_end" : ""}`);
    }
    // Legacy feature flags stay compatible; capacity and paid access come from this contract (same as Mercado Pago).
    if (current.current && paidThrough && (!current.paidThrough || paidThrough > current.paidThrough)) await tx.salon.update({ where: { id: salonId }, data: { plan: "PRO" } });
  });
  const inbox = await withSalon(salonId, tx => tx.billingInbox.findMany({ where: { subscriptionId: id, salonId, processedAt: null }, orderBy: { receivedAt: "asc" }, take: 6 }));
  for (const item of inbox.slice(0, 5)) {
    if (STRIPE_CHARGE_TOPICS.has(item.topic)) await applyCharge(sub, customerId!, item.resourceId);
    await withSalon(salonId, async tx => { await subscriptionLock(tx, salonId); await tx.billingInbox.update({ where: { id: item.id }, data: { processedAt: new Date() } }); });
  }
  return inbox.length > 5;
}
