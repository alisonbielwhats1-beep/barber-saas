import "server-only";
import { z } from "zod";
import type { SecretaryCreditPurchase } from "@prisma/client";
import { withSalon, withTenant, type Tx } from "../prisma-tenant";
import { appendCredit, creditLock, creditsEnabled } from "../secretary-credits";
import { decideCreditPayment, type PurchaseState } from "../secretary-credits-rules";
import { assertProvider, BillingError, SECRETARY_CREDIT_PACKS, secretaryCreditPack } from "./catalog";
import { billingConfig, checkoutPaused } from "./config";
import { assertOwner } from "./service";
import { alertCreditReview } from "./credit-review-alert";
import * as mp from "./provider";

/** Owner decision 06/10/2026: Secretária packs bought once through Checkout Pro (Pix or card; no boleto, one installment),
 * following the plan-upgrade checkout (change-provider.ts): the preference is created once (a crash in between is resolved by
 * searching its reference), checked field by field before its link is shown, and every payment is re-read from Mercado Pago
 * and checked against the purchase before any request is credited. */
export const CREDIT_PURCHASE_TTL_MS = 24 * 3600_000;
/** An unpaid purchase is closed this long after its checkout expired (a late approval still credits: money is never kept). */
export const CREDIT_EXPIRY_GRACE_MS = 3600_000;
export const creditReference = (purchase: { salonId: string; id: string }) => `efc:${purchase.salonId}:${purchase.id}`;
export function parseCreditReference(value: string) {
  const match = /^efc:([a-zA-Z0-9_-]{1,100}):([a-f0-9-]{36})$/.exec(value);
  if (!match) throw new BillingError("UNKNOWN_CREDIT_PURCHASE", 404);
  return { salonId: match[1], id: match[2] };
}
export function assertCreditsSellable() {
  billingConfig();
  if (!creditsEnabled()) throw new BillingError("CREDITS_DISABLED", 503);
  if (checkoutPaused()) throw new BillingError("CHECKOUT_PAUSED", 503);
}

/** One purchase per click (idempotency key): a repeated click returns the same purchase and the same checkout. */
export async function createCreditPurchase(ctx: { salonId: string; userId: string }, input: unknown, requestKey: string, now = new Date()) {
  assertCreditsSellable();
  const pack = secretaryCreditPack.parse(z.object({ pack: z.unknown() }).strict().parse(input).pack), quote = SECRETARY_CREDIT_PACKS[pack];
  const purchase = await withTenant(ctx, async tx => {
    await assertOwner(tx, ctx);
    await creditLock(tx, ctx.salonId);
    const prior = await tx.secretaryCreditPurchase.findUnique({ where: { salonId_requestKey: { salonId: ctx.salonId, requestKey } } });
    if (prior) { if (prior.packCode !== pack) throw new BillingError("IDEMPOTENCY_CONFLICT"); return prior; }
    return tx.secretaryCreditPurchase.create({ data: { salonId: ctx.salonId, requestKey, actorUserId: ctx.userId, packCode: pack, amountCents: quote.amountCents,
      units: quote.units, createdAt: now, expiresAt: new Date(now.getTime() + CREDIT_PURCHASE_TTL_MS) } });
  });
  await prepareCreditCheckout(purchase);
  return withSalon(ctx.salonId, tx => tx.secretaryCreditPurchase.findUniqueOrThrow({ where: { id: purchase.id } }));
}

const preferenceSchema = z.object({ id: z.string(), collector_id: z.union([z.string(), z.number()]).transform(String), external_reference: z.string(), init_point: z.string().url(),
  items: z.array(z.object({ quantity: z.number(), unit_price: z.number(), currency_id: z.string() })), expires: z.boolean(), expiration_date_to: z.string() });
export async function prepareCreditCheckout(purchase: SecretaryCreditPurchase) {
  assertProvider(purchase, "mercadopago");
  const config = billingConfig();
  if (purchase.preferenceId) return;
  if (purchase.expiresAt <= new Date()) throw new BillingError("CREDIT_PURCHASE_EXPIRED");
  await mp.verifySellerAccount();
  const first = await withSalon(purchase.salonId, async tx => {
    await creditLock(tx, purchase.salonId);
    const fresh = await tx.secretaryCreditPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    if (fresh.state !== "CREATED" || fresh.preferenceId) return null;
    if (fresh.creationStartedAt) return false;
    await tx.secretaryCreditPurchase.update({ where: { id: purchase.id }, data: { creationStartedAt: new Date() } });
    return true;
  });
  if (first === null) return;
  const reference = creditReference(purchase), back = `${config.baseUrl}/api/billing/return?origem=creditos`;
  let raw: unknown;
  if (first) {
    raw = await mp.mpRequest("/checkout/preferences", "POST", {
      items: [{ id: purchase.id, title: "Everflair — Crédito da Secretária", quantity: 1, currency_id: "BRL", unit_price: purchase.amountCents / 100 }],
      external_reference: reference, binary_mode: true, payment_methods: { installments: 1, excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
      expires: true, expiration_date_from: purchase.createdAt.toISOString(), expiration_date_to: purchase.expiresAt.toISOString(),
      back_urls: { success: back, failure: back, pending: back }, ...(config.baseUrl.startsWith("https:") ? { auto_return: "approved" } : {}),
    });
  } else {
    const results = mp.parseProvider(z.object({ elements: z.array(z.object({ id: z.string(), external_reference: z.string() })), total: z.number().int() }),
      await mp.mpRequest(`/checkout/preferences/search?external_reference=${encodeURIComponent(reference)}`));
    if (results.total !== 1 || results.elements.length !== 1 || results.elements[0].external_reference !== reference) throw new BillingError("CREATION_REQUIRES_RECONCILIATION", 503);
    raw = await mp.mpRequest(`/checkout/preferences/${encodeURIComponent(results.elements[0].id)}`);
  }
  const preference = mp.parseProvider(preferenceSchema, raw);
  if (preference.collector_id !== config.collectorId || preference.external_reference !== reference || preference.items.length !== 1 || preference.items[0].quantity !== 1
    || preference.items[0].currency_id !== "BRL" || Math.round(preference.items[0].unit_price * 100) !== purchase.amountCents || !preference.expires
    || new Date(preference.expiration_date_to).getTime() !== purchase.expiresAt.getTime()) throw new BillingError("CREDIT_CHECKOUT_MISMATCH", 503);
  await withSalon(purchase.salonId, async tx => {
    await creditLock(tx, purchase.salonId);
    await tx.secretaryCreditPurchase.updateMany({ where: { id: purchase.id, state: "CREATED" },
      data: { preferenceId: preference.id, checkoutUrl: mp.checkoutUrl(preference.init_point), state: "AWAITING_PAYMENT" } });
  });
}

/** The payment belongs to this purchase, to our account, in reais, for the exact price, and (in live mode) is a live payment. */
export function validateCreditPayment(purchase: Pick<SecretaryCreditPurchase, "salonId" | "id" | "amountCents">, payment: mp.RemotePayment, config: { collectorId: string; mode: "test" | "live" }) {
  if (payment.external_reference !== creditReference(purchase) || payment.collector_id !== config.collectorId || payment.currency_id !== "BRL"
    || Math.round(payment.transaction_amount * 100) !== purchase.amountCents || (config.mode === "live" && !payment.live_mode)) throw new BillingError("PAYMENT_MISMATCH");
  const refundedCents = Math.round((payment.transaction_amount_refunded ?? 0) * 100);
  if (!Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > purchase.amountCents) throw new BillingError("PAYMENT_MISMATCH");
  return { refundedCents, status: refundedCents > 0 && payment.status !== "charged_back" ? "refunded" : payment.status,
    paidAt: payment.date_approved ? new Date(payment.date_approved) : null };
}
const paymentTotals = async (tx: Tx, salonId: string, paymentId: string) => {
  const rows = await tx.secretaryCreditLedger.findMany({ where: { salonId, providerPaymentId: paymentId, kind: { in: ["PURCHASE", "REVERSAL"] } }, select: { kind: true, units: true } });
  return { credited: rows.filter(r => r.kind === "PURCHASE").reduce((s, r) => s + r.units, 0), reversed: -rows.filter(r => r.kind === "REVERSAL").reduce((s, r) => s + r.units, 0) };
};
/** Applies one payment update to its purchase (credit, reversal, state), idempotently, under the salon's credit lock. */
export async function applyCreditPayment(purchase: SecretaryCreditPurchase, payment: mp.RemotePayment) {
  assertProvider(purchase, "mercadopago");
  const config = billingConfig();
  const checked = validateCreditPayment(purchase, payment, config);
  if (config.mode === "test" && payment.live_mode) await mp.verifySellerAccount();
  let review: string | null = null;
  const decision = await withSalon(purchase.salonId, async tx => {
    await creditLock(tx, purchase.salonId);
    const fresh = await tx.secretaryCreditPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    const totals = await paymentTotals(tx, purchase.salonId, payment.id);
    const decision = decideCreditPayment({ purchase: { amountCents: fresh.amountCents, units: fresh.units, state: fresh.state as PurchaseState, providerPaymentId: fresh.providerPaymentId },
      payment: { id: payment.id, status: checked.status, refundedCents: checked.refundedCents, paidAt: checked.paidAt }, ...totals });
    if (decision.credit) await appendCredit(tx, { salonId: fresh.salonId, kind: "PURCHASE", units: decision.credit, requestKey: `pay:${payment.id}`,
      purchaseId: fresh.id, providerPaymentId: payment.id, actorUserId: fresh.actorUserId });
    if (decision.reverse) await appendCredit(tx, { salonId: fresh.salonId, kind: "REVERSAL", units: -decision.reverse, requestKey: `rev:${payment.id}:${totals.reversed + decision.reverse}`,
      purchaseId: fresh.id, providerPaymentId: payment.id, reason: checked.status });
    const sameState = decision.state === fresh.state && decision.providerPaymentId === fresh.providerPaymentId && (decision.error ?? fresh.lastError) === fresh.lastError;
    const ownPayment = decision.providerPaymentId === payment.id;
    if (!sameState || (ownPayment && (fresh.refundedCents !== checked.refundedCents || (!fresh.paidAt && checked.paidAt))))
      await tx.secretaryCreditPurchase.update({ where: { id: fresh.id }, data: { state: decision.state, providerPaymentId: decision.providerPaymentId, lastError: decision.error ?? fresh.lastError,
        ...(ownPayment ? { refundedCents: checked.refundedCents, ...(checked.paidAt && !fresh.paidAt ? { paidAt: checked.paidAt } : {}) } : {}) } });
    if (decision.state === "REVIEW" && fresh.state !== "REVIEW") review = decision.error ?? "REVIEW";
    return decision;
  });
  // After the commit: the alert never holds the salon's credit lock nor fails the payment.
  if (review) await alertCreditReview({ salonId: purchase.salonId, purchaseId: purchase.id, reason: review });
  return decision;
}
/** Applies a payment; one that does not match its purchase (amount, currency, account, mode) credits nothing and puts the
 * purchase in review, so the notice is acknowledged instead of retried forever. */
async function applyOrReview(purchase: SecretaryCreditPurchase, payment: mp.RemotePayment) {
  try { return await applyCreditPayment(purchase, payment); }
  catch (error) {
    if (!(error instanceof BillingError) || error.code !== "PAYMENT_MISMATCH") throw error;
    console.error("SECRETARY_CREDIT_PAYMENT_MISMATCH");
    // A purchase already paid or refunded keeps its state (its credit or reversal stands): only the error is recorded. Validation
    // review 07/10/2026: a late mismatched payment never turns PAID into REVIEW.
    const firstNotice = await withSalon(purchase.salonId, async tx => { await creditLock(tx, purchase.salonId);
      const fresh = await tx.secretaryCreditPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      const settled = ["PAID", "REFUNDED"].includes(fresh.state);
      if (fresh.lastError === "PAYMENT_MISMATCH" && (settled || fresh.state === "REVIEW")) return false;
      await tx.secretaryCreditPurchase.update({ where: { id: purchase.id }, data: settled
        ? { lastError: "PAYMENT_MISMATCH" } : { state: "REVIEW", lastError: "PAYMENT_MISMATCH" } });
      return true; });
    // Mercado Pago notifies one payment more than once: the admin is alerted once, on the first notice.
    if (firstNotice) await alertCreditReview({ salonId: purchase.salonId, purchaseId: purchase.id, reason: "PAYMENT_MISMATCH" });
    return null;
  }
}
/** Webhook: a payment whose reference is efc:… Payments are always confirmed, even with selling turned off
 * (SALON_SECRETARY_CREDITS_ENABLED only stops new purchases and the use of the credit): money is never kept without its credit. */
export async function receiveCreditPayment(payment: mp.RemotePayment) {
  if (!payment.external_reference) return null;
  const ref = parseCreditReference(payment.external_reference);
  const purchase = await withSalon(ref.salonId, tx => tx.secretaryCreditPurchase.findFirst({ where: { id: ref.id, salonId: ref.salonId } }));
  if (!purchase) throw new BillingError("UNKNOWN_CREDIT_PURCHASE", 404);
  return applyOrReview(purchase, payment);
}
export async function creditPayments(purchase: SecretaryCreditPurchase) {
  const reference = creditReference(purchase);
  const page = mp.parseProvider(z.object({ results: z.array(mp.paymentSchema), paging: z.object({ total: z.number().int() }) }),
    await mp.mpRequest(`/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=asc&limit=100`));
  if (page.paging.total > page.results.length) throw new BillingError("CREDIT_PAYMENTS_REQUIRE_REVIEW", 503);
  return page.results.filter(payment => payment.external_reference === reference);
}
/** Reconciliation (return from the checkout, scheduled job): applies every payment of the purchase; an unpaid purchase
 * past its expiry (plus a grace hour) is closed as EXPIRED. */
export async function reconcileCreditPurchase(salonId: string, id: string, now = new Date()) {
  const purchase = await withSalon(salonId, tx => tx.secretaryCreditPurchase.findFirst({ where: { id, salonId } }));
  if (!purchase || !purchase.preferenceId) return;
  assertProvider(purchase, "mercadopago");
  const payments = await creditPayments(purchase);
  // Approved first, so a refund always finds its credit (its own idempotency keeps the order safe either way).
  for (const payment of [...payments].sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved"))) {
    try { await applyOrReview(purchase, payment); } catch (error) { if (!(error instanceof BillingError)) throw error; console.error("SECRETARY_CREDIT_PAYMENT_REJECTED", error.code); }
  }
  if (now.getTime() > purchase.expiresAt.getTime() + CREDIT_EXPIRY_GRACE_MS && !payments.some(p => ["approved", "pending", "in_process", "authorized"].includes(p.status)))
    await withSalon(salonId, async tx => { await creditLock(tx, salonId); await tx.secretaryCreditPurchase.updateMany({ where: { id, state: { in: ["CREATED", "AWAITING_PAYMENT"] } }, data: { state: "EXPIRED" } }); });
}
/** Scheduled job: purchases still waiting for payment, across salons (the dispatch scope reads only those; 029). Runs with
 * selling turned off too, so a purchase started before is still confirmed or closed. */
export async function reconcilePendingCreditPurchases(limit = 20) {
  const pending = await withSalon("__billing_dispatch__", async tx => {
    await tx.$executeRaw`SELECT set_config('app.billing_dispatch', 'enabled', true)`;
    return tx.secretaryCreditPurchase.findMany({ where: { state: "AWAITING_PAYMENT", provider: "mercadopago" }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true, salonId: true } });
  });
  for (const purchase of pending) {
    try { await reconcileCreditPurchase(purchase.salonId, purchase.id); } catch { console.error("SECRETARY_CREDIT_RECONCILE_FAILED"); }
  }
  return { checked: pending.length };
}
