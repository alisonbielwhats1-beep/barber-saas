import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { BillingSubscription } from "@prisma/client";
import { withSalon, withTenant, type Tx } from "../prisma-tenant";
import { BILLING_PLANS, BillingError, periodEnd, quoteContract } from "./catalog";
import { billingConfig } from "./config";
import * as mp from "./provider";

export const referenceFor = (s: { salonId: string; id: string }) => `ef:${s.salonId}:${s.id}`;
export function parseReference(value: string) {
  const match = /^ef:([a-zA-Z0-9_-]{1,100}):([a-f0-9-]{36})$/.exec(value);
  if (!match) throw new BillingError("UNKNOWN_SUBSCRIPTION", 404);
  return { salonId: match[1], id: match[2] };
}
export async function subscriptionLock(tx: Tx, salonId: string) {
  await tx.$executeRaw`SELECT set_config('app.billing_write', 'enabled', true)`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`billing:${salonId}`}, 0))`;
}
async function event(tx: Tx, sub: { id: string; salonId: string }, key: string, type: string, detail = type) {
  await tx.billingEvent.upsert({ where: { subscriptionId_key: { subscriptionId: sub.id, key } }, update: {},
    create: { subscriptionId: sub.id, salonId: sub.salonId, key, type, detail } });
}
export async function enqueue(tx: Tx, sub: { id: string; salonId: string }) {
  await tx.$executeRaw`SELECT set_config('app.billing_write', 'enabled', true)`;
  await tx.billingQueue.upsert({ where: { subscriptionId: sub.id },
    create: { subscriptionId: sub.id, salonId: sub.salonId }, update: { nextAttemptAt: new Date() } });
}
export async function assertOwner(tx: Tx, ctx: { salonId: string; userId: string }) {
  const member = await tx.membership.findFirst({ where: { salonId: ctx.salonId, userId: ctx.userId, role: "OWNER" } });
  if (!member) throw new BillingError("OWNER_REQUIRED", 403);
}

export async function contract(ctx: { salonId: string; userId: string }, input: unknown, requestKey: string) {
  const config = billingConfig();
  if (process.env.MERCADOPAGO_CHECKOUT_PAUSED === "true") throw new BillingError("CHECKOUT_PAUSED", 503);
  const quote = quoteContract(input);
  const fingerprint = createHash("sha256").update(JSON.stringify(quote)).digest("hex");
  const sub = await withTenant(ctx, async tx => {
    await assertOwner(tx, ctx);
    await subscriptionLock(tx, ctx.salonId);
    const previous = await tx.billingSubscription.findUnique({ where: { salonId_requestKey: { salonId: ctx.salonId, requestKey } } });
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new BillingError("IDEMPOTENCY_MISMATCH");
      return previous;
    }
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { plan: true, accessStatus: true } });
    if (salon.accessStatus !== "APPROVED") throw new BillingError("SALON_NOT_APPROVED", 403);
    const active = await tx.billingSubscription.findFirst({ where: { salonId: ctx.salonId, current: true } });
    if (active && (!active.cancelledAt || (active.paidThrough && active.paidThrough > new Date()))) throw new BillingError("SUBSCRIPTION_EXISTS");
    // Same lock used by professional creation/reactivation; pending invitations reserve capacity.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`professional-capacity:${ctx.salonId}`}, 0))`;
    const count = await tx.professional.count({ where: { salonId: ctx.salonId, active: true } });
    const invited = await tx.userInvite.count({ where: { salonId: ctx.salonId, role: "PROFESSIONAL", usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (count + invited > quote.agendaLimit) throw new BillingError("PLAN_CAPACITY_TOO_SMALL");
    const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { email: true } });
    if (active) await tx.billingSubscription.update({ where: { id: active.id }, data: { current: false } });
    const created = await tx.billingSubscription.create({ data: {
      id: randomUUID(), salonId: ctx.salonId, requestKey, fingerprint,
      catalogVersion: quote.catalogVersion, planCode: quote.plan, cycle: quote.cycle, currency: quote.currency,
      amountCents: quote.amountCents, agendaLimit: quote.agendaLimit, intervalMonths: quote.intervalMonths,
      mode: config.mode, collectorId: config.collectorId, payerEmail: user.email, legacyPlan: salon.plan,
    } });
    await event(tx, created, "contract", "CONTRACT_REQUESTED", `owner:${ctx.userId}`);
    await enqueue(tx, created);
    return created;
  });
  // Durable intent first; network calls never hold a database transaction open.
  await ensureCreated(sub);
  return withSalon(sub.salonId, tx => tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } }));
}

export async function ensureCreated(sub: BillingSubscription) {
  if (sub.providerId || sub.cancelledAt) return;
  const config = billingConfig();
  if (sub.mode !== config.mode || sub.collectorId !== config.collectorId) throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
  // A failed read-only preflight must not make a POST that never happened look uncertain.
  if (!sub.creationStartedAt && !sub.cancelRequestedAt) {
    if (process.env.MERCADOPAGO_CHECKOUT_PAUSED === "true") throw new BillingError("CHECKOUT_PAUSED", 503);
    await mp.verifySellerAccount();
  }
  // Atomically reserve ONE attempt. Uncertain requests are recovered by reference, never blindly repeated.
  const reserved = await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    if (current.cancelRequestedAt && !current.creationStartedAt) {
      await tx.billingSubscription.update({ where: { id: sub.id }, data: { cancelledAt: new Date(), providerStatus: "cancelled" } });
      await event(tx, sub, "cancelled", "CANCELLED");
      return "cancelled";
    }
    if (current.creationStartedAt) return "recover";
    if (process.env.MERCADOPAGO_CHECKOUT_PAUSED === "true") throw new BillingError("CHECKOUT_PAUSED", 503);
    await tx.billingSubscription.update({ where: { id: sub.id }, data: { creationStartedAt: new Date() } });
    return "create";
  });
  if (reserved === "cancelled") return;
  let remote: mp.RemoteSubscription;
  if (reserved === "recover") {
    const matches = await mp.searchSubscriptions(referenceFor(sub));
    if (matches.length !== 1) throw new BillingError("CREATION_REQUIRES_RECONCILIATION", 503);
    remote = matches[0];
  } else {
    remote = mp.parseProvider(mp.subscriptionSchema, await mp.mpRequest("/preapproval", "POST", {
      reason: `Everflair ${BILLING_PLANS[sub.planCode as keyof typeof BILLING_PLANS].label} — ${sub.cycle === "ANNUAL" ? "anual" : "mensal"}`, external_reference: referenceFor(sub), payer_email: sub.payerEmail,
      auto_recurring: { frequency: sub.intervalMonths, frequency_type: "months", transaction_amount: sub.amountCents / 100, currency_id: "BRL" },
      back_url: `${config.baseUrl}/api/billing/return`, status: "pending",
    }));
  }
  await applyRemoteSubscription(sub, remote);
}

export function validateRemote(sub: BillingSubscription, remote: mp.RemoteSubscription, checkTerms = true) {
  const config = billingConfig();
  if (sub.mode !== config.mode || sub.collectorId !== config.collectorId || remote.collector_id !== sub.collectorId || remote.external_reference !== referenceFor(sub) || (sub.providerId && sub.providerId !== remote.id)) throw new BillingError("PROVIDER_IDENTITY_MISMATCH", 409);
  if (checkTerms && (remote.auto_recurring.currency_id !== sub.currency || Math.round(remote.auto_recurring.transaction_amount * 100) !== sub.amountCents || remote.auto_recurring.frequency !== sub.intervalMonths || remote.auto_recurring.frequency_type !== "months")) {
    throw new BillingError("PROVIDER_CONTRACT_MISMATCH", 409);
  }
}
export async function applyRemoteSubscription(sub: BillingSubscription, remote: mp.RemoteSubscription) {
  validateRemote(sub, remote, false);
  let termsChanged = false;
  try { validateRemote(sub, remote); } catch { termsChanged = true; }
  return withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    if (current.providerUpdatedAt && current.providerUpdatedAt >= new Date(remote.last_modified)) return current;
    const cancelled = ["cancelled", "canceled"].includes(remote.status);
    const updated = await tx.billingSubscription.update({ where: { id: sub.id }, data: {
      ...(termsChanged ? { reviewRequired: true } : {}),
      providerId: remote.id, providerStatus: remote.status, providerUpdatedAt: new Date(remote.last_modified),
      ...(remote.init_point ? { checkoutUrl: mp.checkoutUrl(remote.init_point) } : {}),
      ...(cancelled && !current.cancelledAt ? { cancelledAt: new Date(remote.last_modified) } : {}),
    } });
    await event(tx, sub, `subscription:${remote.last_modified}:${remote.status}`, "SUBSCRIPTION_UPDATED", remote.status);
    return updated;
  });
}

export async function requestCancellation(ctx: { salonId: string; userId: string }, id: string) {
  billingConfig();
  return withTenant(ctx, async tx => {
    await assertOwner(tx, ctx);
    await subscriptionLock(tx, ctx.salonId);
    const sub = await tx.billingSubscription.findFirst({ where: { id, salonId: ctx.salonId } });
    if (!sub) throw new BillingError("NOT_FOUND", 404);
    if (!sub.cancelRequestedAt) await tx.billingSubscription.update({ where: { id }, data: { cancelRequestedAt: new Date() } });
    await event(tx, sub, "cancel-request", "CANCEL_REQUESTED", `owner:${ctx.userId}`);
    await enqueue(tx, sub);
    return { status: sub.cancelledAt ? "CANCELLED" : "CANCELLATION_PENDING", paidThrough: sub.paidThrough };
  });
}

export async function applyInvoice(sub: BillingSubscription, remote: mp.RemoteSubscription, invoice: mp.RemoteInvoice, payment: mp.RemotePayment | null) {
  validateRemote(sub, remote);
  if (invoice.preapproval_id !== remote.id || invoice.currency_id !== sub.currency || Math.round(invoice.transaction_amount * 100) !== sub.amountCents) throw new BillingError("INVOICE_MISMATCH");
  if (payment && (payment.id !== invoice.payment?.id || payment.collector_id !== sub.collectorId || payment.currency_id !== sub.currency || Math.round(payment.transaction_amount * 100) !== sub.amountCents || (sub.mode === "live" && !payment.live_mode) ||
    (remote.payer_id && payment.payer?.id !== remote.payer_id))) throw new BillingError("PAYMENT_MISMATCH");
  // Test-user subscriptions created with their APP_USR credentials report live_mode=true.
  // Accept that combination only after the API confirms the configured seller is a test_user.
  if (payment?.live_mode && sub.mode === "test") await mp.verifySellerAccount();
  const status = payment ? ((payment.transaction_amount_refunded ?? 0) > 0 ? "refunded" : payment.status) : "pending";
  const updatedAt = new Date(payment?.date_last_updated ?? invoice.last_modified);
  const start = new Date(invoice.debit_date);
  const end = periodEnd(start, sub.intervalMonths);
  return withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    const prior = await tx.billingCharge.findUnique({ where: { providerInvoiceId: invoice.id } });
    if (prior && prior.providerUpdatedAt >= updatedAt && !(status === "approved" && ["pending", "in_process", "rejected", "cancelled"].includes(prior.status))) return;
    // Never turn an already approved invoice back into pending due to a stale invoice notification.
    if (prior?.status === "approved" && !["approved", "refunded", "charged_back"].includes(status)) return;
    const paidAt = payment?.date_approved ? new Date(payment.date_approved) : null;
    if (status === "approved" && (!paidAt || start > new Date(Date.now() + 86400000))) throw new BillingError("INVALID_PAID_PERIOD");
    await tx.billingCharge.upsert({ where: { providerInvoiceId: invoice.id },
      create: { salonId: sub.salonId, subscriptionId: sub.id, providerInvoiceId: invoice.id, providerPaymentId: payment?.id, amountCents: sub.amountCents,
        periodStart: start, periodEnd: end, status, paidAt, providerUpdatedAt: updatedAt },
      update: { providerPaymentId: payment?.id, status, paidAt, providerUpdatedAt: updatedAt },
    });
    await event(tx, sub, `invoice:${invoice.id}:${updatedAt.toISOString()}:${status}`, "PAYMENT_UPDATED", `${invoice.id}:payment:${payment?.id ?? "none"}:${status}`);
    if (["refunded", "charged_back"].includes(status)) {
      await tx.billingSubscription.update({ where: { id: sub.id }, data: { reviewRequired: true } });
    } else if (status === "approved") {
      const paidThrough = !current.paidThrough || end > current.paidThrough ? end : current.paidThrough;
      await tx.billingSubscription.update({ where: { id: sub.id }, data: { paidThrough,
        ...(current.delinquentSince && paidThrough > current.delinquentSince ? { delinquentSince: null } : {}),
      } });
      // Legacy feature flags stay compatible. Capacity and paid access come from this contract.
      // Does not change accessStatus: administrative suspension always wins.
      if (current.current) await tx.salon.update({ where: { id: sub.salonId }, data: { plan: "PRO" } });
    } else if (["rejected", "cancelled"].includes(status) && current.paidThrough && start >= current.paidThrough && start <= new Date()) {
      const failedSince = current.delinquentSince && current.delinquentSince < start ? current.delinquentSince : start;
      await tx.billingSubscription.update({ where: { id: sub.id }, data: { delinquentSince: failedSince } });
    }
  });
}
