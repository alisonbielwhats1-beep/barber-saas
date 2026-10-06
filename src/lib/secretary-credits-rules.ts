/** Owner decisions of 06/10/2026 for the Secretária's prepaid requests, as pure rules (no database, client-safe):
 * - the balance is counted in requests (pedidos), never in money; requests never expire;
 * - a purchase or a grant ADDS to whatever is left (20% left + a new pack = both summed), and the bar restarts at 100%;
 * - the bar is the balance over the balance right after the latest credit; below 20% it warns, at zero (or below) it stops;
 * - only a request that finished debits one; a request already started always finishes (the balance can end at -1 when two
 *   run together, and the next credit covers it);
 * - a refund or a chargeback takes back the requests it paid for (proportional to the refunded amount, rounded up; a
 *   chargeback takes the whole pack), even if that leaves the balance below zero.
 * Every figure here is an integer: no float ever decides a balance. */
export const LOW_BALANCE_PERCENT = 20;
/** Days of history needed before the "lasts about N days" estimate is shown (a guess on fewer days would mislead). */
export const ESTIMATE_MIN_DAYS = 3;
export const ESTIMATE_WINDOW_DAYS = 7;
export const CREDIT_KINDS = ["PURCHASE", "GRANT", "USAGE", "REVERSAL"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

export type LedgerPoint = { balanceAfter: number; baseAfter: number };
const integer = (value: number) => { if (!Number.isSafeInteger(value)) throw Error("CREDIT_REQUESTS_INVALID"); return value; };

/** The next ledger point after a row of `requests` (positive for PURCHASE/GRANT, negative for USAGE/REVERSAL). A credit makes
 * the new balance the bar's 100%; a debit keeps the previous 100%. */
export function nextPoint(previous: LedgerPoint | null, kind: CreditKind, requests: number): LedgerPoint {
  integer(requests);
  const credit = kind === "PURCHASE" || kind === "GRANT";
  if (credit ? requests <= 0 : requests >= 0) throw Error("CREDIT_REQUESTS_INVALID");
  const balance = integer((previous?.balanceAfter ?? 0) + requests);
  const base = credit ? Math.max(balance, 0) : Math.max(previous?.baseAfter ?? 0, balance, 0);
  return { balanceAfter: balance, baseAfter: base };
}

export type CreditStatus = "OK" | "LOW" | "EMPTY";
export type CreditView = { balance: number; base: number; percent: number; status: CreditStatus; daysLeft: number | null };
export type UsageWindow = { usedInWindow: number; firstUsageAt: Date | null; now: Date };
/** What the bar shows. `percent` is rounded down (never shows more than there is), but a positive balance never reads 0%. */
export function creditView(point: LedgerPoint | null, usage?: UsageWindow): CreditView {
  const balance = point?.balanceAfter ?? 0, base = point?.baseAfter ?? 0;
  const percent = balance <= 0 || base <= 0 ? 0 : Math.max(1, Math.min(100, Math.floor(balance * 100 / base)));
  const status: CreditStatus = balance <= 0 ? "EMPTY" : balance * 100 < LOW_BALANCE_PERCENT * base ? "LOW" : "OK";
  return { balance, base, percent, status, daysLeft: usage ? daysLeft(balance, usage) : null };
}
/** "Dura uns N dias no seu ritmo": the balance over the average daily use of the last 7 days (or of the days since the first
 * request, when fewer). Null before 3 days of history, without use in the window, or with nothing left. */
export function daysLeft(balance: number, usage: UsageWindow) {
  if (balance <= 0 || !usage.firstUsageAt || usage.usedInWindow <= 0) return null;
  const days = (usage.now.getTime() - usage.firstUsageAt.getTime()) / 86_400_000;
  if (days < ESTIMATE_MIN_DAYS) return null;
  const perDay = usage.usedInWindow / Math.min(ESTIMATE_WINDOW_DAYS, days);
  return Math.floor(balance / perDay);
}
/** A request may start only with at least one request left. */
export const canStartRequest = (point: LedgerPoint | null) => (point?.balanceAfter ?? 0) >= 1;

/** The requests a payment's reversal takes back in total: the whole pack on a chargeback, otherwise the refunded share of
 * the pack, rounded up (a partial refund never leaves paid-for requests behind). */
export function reversedRequests(pack: { amountCents: number; requests: number }, refund: { status: string; refundedCents: number }) {
  if (refund.status === "charged_back") return pack.requests;
  if (refund.refundedCents <= 0) return 0;
  if (!Number.isSafeInteger(refund.refundedCents) || refund.refundedCents > pack.amountCents) throw Error("PAYMENT_MISMATCH");
  return Math.ceil(refund.refundedCents * pack.requests / pack.amountCents);
}

export const PURCHASE_STATES = ["CREATED", "AWAITING_PAYMENT", "PAID", "EXPIRED", "REFUNDED", "REVIEW"] as const;
export type PurchaseState = (typeof PURCHASE_STATES)[number];
export type CreditPaymentInput = {
  purchase: { amountCents: number; requests: number; state: PurchaseState; providerPaymentId: string | null };
  payment: { id: string; status: string; refundedCents: number; paidAt: Date | null };
  /** Requests this payment already credited and already reversed (from the ledger). */
  credited: number; reversed: number;
};
export type CreditPaymentDecision = { credit: number; reverse: number; state: PurchaseState; error: string | null; providerPaymentId: string | null };
/** What one payment update does to a purchase. Idempotent: replaying the same update credits and reverses nothing new.
 * The payment's requests that should remain are the pack minus its refunded share; the ledger is moved toward that, only ever
 * by a first credit and then by reversals (a refund is never undone by a later notice). Money received is never kept without
 * its requests: an approved payment credits even after the purchase expired, and a payment first seen already partly refunded
 * credits what is left. A second approved payment for the same purchase is not credited and goes to review (refund by hand). */
export function decideCreditPayment(input: CreditPaymentInput): CreditPaymentDecision {
  const { purchase, payment, credited, reversed } = input;
  const keep = { credit: 0, reverse: 0, state: purchase.state, error: null, providerPaymentId: purchase.providerPaymentId };
  const reversal = payment.status === "refunded" || payment.status === "charged_back";
  if (payment.status !== "approved" && !reversal) return keep; // pending, in_process, rejected, cancelled: nothing moves.
  if (purchase.providerPaymentId !== null && purchase.providerPaymentId !== payment.id)
    return { ...keep, state: "REVIEW", error: reversal ? "DUPLICATE_PAYMENT_REVERSED" : "DUPLICATE_PAYMENT" };
  if (payment.status === "approved" && !payment.paidAt) return { ...keep, state: "REVIEW", error: "INVALID_PAID_PERIOD" };
  const wasPaid = payment.paidAt !== null || credited > 0;
  const remaining = wasPaid ? purchase.requests - reversedRequests(purchase, payment) : 0, current = credited - reversed;
  const credit = credited === 0 && remaining > 0 ? remaining : 0;
  const reverse = credited > 0 ? Math.max(0, current - remaining) : 0;
  const state: PurchaseState = remaining <= 0 || purchase.state === "REFUNDED" ? "REFUNDED" : "PAID";
  return { credit, reverse, state, error: null, providerPaymentId: payment.id };
}
