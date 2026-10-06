/** Owner decisions of 06/10/2026 for the Secretária's prepaid credit, as pure rules (no database, client-safe):
 * - the customer buys CREDIT, not a fixed number of requests: each request (pedido) takes its own real cost (the model calls of
 *   that message, and the transcription of each recording) times the margin multiplier, so the margin holds on every request;
 *   "about 185 requests" in a pack is an estimate at the average cost, never a promise;
 * - the customer sees only a bar and a percentage (no count, no days);
 * - a purchase or a grant ADDS to what is left and the bar restarts at 100%; the credit never expires;
 * - every salon gets a free monthly allowance (use it or lose it, in the salon's month), spent before the paid credit;
 * - a bigger pack yields more credit per real;
 * - a request already started always finishes (the paid balance can end below zero, the next credit covers it);
 * - a refund or a chargeback takes back the credit it paid for (proportional, rounded up; a chargeback takes all of it).
 * Credit is counted in integer units of R$ 0,0001: no float ever decides a balance. */
export const CREDIT_UNIT_BRL = 0.0001;
/** Price = cost x 10: a 90% gross margin before the payment fee (cost is priced at the providers' highest rates). */
export const MARGIN_MULTIPLIER = 10;
/** Average units of one request, MEASURED in the Production pilot on 06/10/2026 (37 messages, 35 DeepSeek calls of ~11 440 input
 * tokens with 58% cached, 38 recordings of ~3,6 s): US$ 0,00334 per request at the charged rates = R$ 0,187 with the x10. Only
 * used to show "about N requests" (never a promise); re-measure with the HQ report (/api/hq/secretary-spend) after any change
 * to the prompt or the providers. */
export const AVERAGE_REQUEST_UNITS = 1_870;
/** Free allowance per salon and month: about 20 requests at the measured average (37 400 units, ~R$ 0,37 of real cost). */
export const FREE_MONTHLY_UNITS = 20 * AVERAGE_REQUEST_UNITS;
export const LOW_BALANCE_PERCENT = 20;
export const CREDIT_KINDS = ["PURCHASE", "GRANT", "USAGE", "REVERSAL"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

const integer = (value: number) => { if (!Number.isSafeInteger(value)) throw Error("CREDIT_UNITS_INVALID"); return value; };
/** The exchange rate in centavos per dollar (5.60 -> 560), so the charge is integer arithmetic. */
export const fxCentavos = (usdBrl: number) => {
  const value = Math.round(usdBrl * 100);
  if (!Number.isSafeInteger(value) || value < 100 || value > 2000) throw Error("CREDIT_FX_INVALID");
  return value;
};
/** The credit a cost takes: micro-USD x (centavos per dollar) x 10, in units of R$ 0,0001, rounded up. */
export function costUnits(microUsd: number, usdBrl: number) {
  if (!Number.isFinite(microUsd) || microUsd <= 0) return 0;
  const numerator = Math.ceil(microUsd) * fxCentavos(usdBrl) * MARGIN_MULTIPLIER, denominator = 10_000;
  return integer(Math.ceil(numerator / denominator));
}
/** "About N requests" for a credit amount, rounded to 5 (never a promise). */
export const estimatedRequests = (units: number) => Math.max(0, Math.round(units / AVERAGE_REQUEST_UNITS / 5) * 5);

export type LedgerPoint = { balanceAfter: number; baseAfter: number };
/** The next ledger point after a row of `units` (positive for PURCHASE/GRANT, negative for REVERSAL, zero or negative for
 * USAGE: a request covered by the free allowance takes no paid credit). A credit makes the new balance the bar's 100%. */
export function nextPoint(previous: LedgerPoint | null, kind: CreditKind, units: number): LedgerPoint {
  integer(units);
  const credit = kind === "PURCHASE" || kind === "GRANT";
  if (credit ? units <= 0 : kind === "REVERSAL" ? units >= 0 : units > 0) throw Error("CREDIT_UNITS_INVALID");
  const balance = integer((previous?.balanceAfter ?? 0) + units);
  const base = credit ? Math.max(balance, 0) : Math.max(previous?.baseAfter ?? 0, balance, 0);
  return { balanceAfter: balance, baseAfter: base };
}
/** How a request's cost splits: the month's free allowance first, then the paid credit. */
export function splitCost(cost: number, freeUsedThisMonth: number) {
  integer(cost); integer(freeUsedThisMonth);
  const free = Math.min(Math.max(cost, 0), Math.max(0, FREE_MONTHLY_UNITS - freeUsedThisMonth));
  return { free, paid: Math.max(cost, 0) - free };
}
export const freeLeft = (freeUsedThisMonth: number) => Math.max(0, FREE_MONTHLY_UNITS - freeUsedThisMonth);

export type CreditStatus = "OK" | "LOW" | "EMPTY";
/** Exactly what the customer sees: a percentage and a status. */
export type CreditView = { percent: number; status: CreditStatus };
/** The bar. A salon that bought (or got) credit sees its paid credit: the balance over the balance right after its latest
 * credit, with the month's free allowance left added to both sides (so spending the allowance never lowers the bar, and a
 * purchase always reads 100%). A salon that never bought sees its free allowance of the month. Rounded down, but anything left
 * never reads 0%. Below 20% it warns; with nothing left it stops. */
export function creditView(point: LedgerPoint | null, freeUsedThisMonth: number): CreditView {
  const free = freeLeft(freeUsedThisMonth), balance = point?.balanceAfter ?? 0, base = Math.max(point?.baseAfter ?? 0, 0);
  if (balance + free <= 0) return { percent: 0, status: "EMPTY" };
  const [left, whole] = base > 0 ? [Math.max(balance, 0) + free, base + free] : [free, FREE_MONTHLY_UNITS];
  const percent = Math.max(1, Math.min(100, Math.floor(left * 100 / whole)));
  return { percent, status: left * 100 < LOW_BALANCE_PERCENT * whole ? "LOW" : "OK" };
}
/** A request may start while any credit or allowance is left. */
export const canStartRequest = (point: LedgerPoint | null, freeUsedThisMonth: number) => (point?.balanceAfter ?? 0) + freeLeft(freeUsedThisMonth) > 0;

/** The credit a payment's reversal takes back in total: all of it on a chargeback or on a "refunded" status without an amount,
 * otherwise the refunded share, rounded up. */
export function reversedUnits(pack: { amountCents: number; units: number }, refund: { status: string; refundedCents: number }) {
  if (refund.status === "charged_back" || (refund.status === "refunded" && refund.refundedCents <= 0)) return pack.units;
  if (refund.refundedCents <= 0) return 0;
  if (!Number.isSafeInteger(refund.refundedCents) || refund.refundedCents > pack.amountCents) throw Error("PAYMENT_MISMATCH");
  return Math.ceil(refund.refundedCents * pack.units / pack.amountCents);
}

export const PURCHASE_STATES = ["CREATED", "AWAITING_PAYMENT", "PAID", "EXPIRED", "REFUNDED", "REVIEW"] as const;
export type PurchaseState = (typeof PURCHASE_STATES)[number];
export type CreditPaymentInput = {
  purchase: { amountCents: number; units: number; state: PurchaseState; providerPaymentId: string | null };
  payment: { id: string; status: string; refundedCents: number; paidAt: Date | null };
  /** Units this payment already credited and already reversed (from the ledger). */
  credited: number; reversed: number;
};
export type CreditPaymentDecision = { credit: number; reverse: number; state: PurchaseState; error: string | null; providerPaymentId: string | null };
/** What one payment update does to a purchase. Idempotent: replaying the same update credits and reverses nothing new.
 * The payment's credit that should remain is the pack minus its refunded share; the ledger is moved toward that, only ever
 * by a first credit and then by reversals (a refund is never undone by a later notice). Money received is never kept without
 * its credit: an approved payment credits even after the purchase expired, and a payment first seen already partly refunded
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
  const remaining = wasPaid ? purchase.units - reversedUnits(purchase, payment) : 0, current = credited - reversed;
  const credit = credited === 0 && remaining > 0 ? remaining : 0;
  const reverse = credited > 0 ? Math.max(0, current - remaining) : 0;
  // A purchase in review stays in review until someone resolves it by hand (its own payment still credits or reverses).
  const state: PurchaseState = purchase.state === "REVIEW" ? "REVIEW" : remaining <= 0 || purchase.state === "REFUNDED" ? "REFUNDED" : "PAID";
  return { credit, reverse, state, error: null, providerPaymentId: payment.id };
}
