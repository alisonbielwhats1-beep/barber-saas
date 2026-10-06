import { describe, expect, it } from "vitest";
import { SECRETARY_CREDIT_PACKS } from "../billing/catalog";
import { AVERAGE_REQUEST_UNITS, CREDIT_UNIT_BRL, FREE_MONTHLY_UNITS, MARGIN_MULTIPLIER, canStartRequest, costUnits, creditView, decideCreditPayment, estimatedRequests,
  nextPoint, reversedUnits, splitCost, type CreditKind, type LedgerPoint } from "../secretary-credits-rules";

/** Owner decisions 06/10/2026: prepaid CREDIT charged at each request's real cost x 10, bar and percentage only, top-ups sum,
 * bigger packs yield more, a free monthly allowance, nothing expires. Expected numbers are written out by hand. */
const run = (rows: [CreditKind, number][], start: LedgerPoint | null = null) => rows.reduce<LedgerPoint | null>((point, [kind, n]) => nextPoint(point, kind, n), start);
const ALL_FREE_USED = FREE_MONTHLY_UNITS;
const P15 = SECRETARY_CREDIT_PACKS.P15;

describe("the charge: each request at its own real cost x 10", () => {
  it("a typed request (~US$ 0,0007) takes 392 units = R$ 0,0392; a spoken one (~US$ 0,0022) takes 1232 = R$ 0,1232 (dollar at R$ 5,60)", () => {
    expect(costUnits(700, 5.6)).toBe(392);
    expect(costUnits(2_200, 5.6)).toBe(1_232);
    expect(392 * CREDIT_UNIT_BRL).toBeCloseTo(0.0392);
  });
  it("the margin is 90% on every request: the charge is never under ten times the cost", () => {
    for (const microUsd of [1, 7, 450, 700, 2_200, 13_334, 213_334]) {
      const costBrl = microUsd / 1e6 * 5.6, chargedBrl = costUnits(microUsd, 5.6) * CREDIT_UNIT_BRL;
      expect(chargedBrl).toBeGreaterThanOrEqual(costBrl * MARGIN_MULTIPLIER - 1e-12);
      expect(1 - costBrl / chargedBrl).toBeGreaterThanOrEqual(0.9 - 1e-9);
    }
  });
  it("a request that cost nothing takes nothing; a tiny cost still rounds up to one unit; the exchange rate is bounded", () => {
    expect(costUnits(0, 5.6)).toBe(0);
    expect(costUnits(1, 5.6)).toBe(1);
    expect(() => costUnits(700, 0.5)).toThrow("CREDIT_FX_INVALID");
  });
});

describe("packs: a bigger pack yields more, about N requests is only an estimate", () => {
  it("at the cost measured in the pilot (R$ 0,187 per request), R$ 15, 25, 40 and 80 give about 80, 145, 260 and 565 requests", () => {
    expect(Object.values(SECRETARY_CREDIT_PACKS).map(p => [p.amountCents, estimatedRequests(p.units)])).toEqual([[1500, 80], [2500, 145], [4000, 260], [8000, 565]]);
    // The measured average: 105 775 micro-USD of model calls over 37 messages plus 17 948 of voice = 3 344 micro-USD per request.
    expect(costUnits(Math.round((105_775 + 17_948) / 37), 5.6)).toBe(1_873);
  });
  it("each bigger pack gives more credit per real, and the average margin stays at 86% or more before the payment fee", () => {
    const perReal = Object.values(SECRETARY_CREDIT_PACKS).map(p => p.units / p.amountCents);
    expect([...perReal].sort((a, b) => a - b)).toEqual(perReal);
    for (const pack of Object.values(SECRETARY_CREDIT_PACKS)) {
      const ourCostBrl = pack.units * CREDIT_UNIT_BRL / MARGIN_MULTIPLIER;
      expect(1 - ourCostBrl / (pack.amountCents / 100)).toBeGreaterThanOrEqual(0.86);
    }
    expect(AVERAGE_REQUEST_UNITS).toBe(1_870);
  });
});

describe("the bar (percentage only)", () => {
  it("a purchase always reads 100%", () => {
    expect(creditView(run([["PURCHASE", P15.units]]), ALL_FREE_USED)).toEqual({ percent: 100, status: "OK" });
  });
  it("owner's example: with 20% left, buying R$ 15 more SUMS both and the bar restarts at 100%", () => {
    const at20 = run([["PURCHASE", 150_000], ["USAGE", -120_000]]);
    expect(creditView(at20, ALL_FREE_USED)).toEqual({ percent: 20, status: "OK" });
    const topped = nextPoint(at20, "PURCHASE", P15.units);
    expect(topped).toEqual({ balanceAfter: 180_000, baseAfter: 180_000 });
    expect(creditView(topped, ALL_FREE_USED)).toEqual({ percent: 100, status: "OK" });
    expect(creditView(nextPoint(topped, "USAGE", -90_000), ALL_FREE_USED)).toEqual({ percent: 50, status: "OK" });
  });
  it("warns strictly below 20%; anything left never reads 0%", () => {
    expect(creditView(run([["PURCHASE", 150_000], ["USAGE", -120_001]]), ALL_FREE_USED)).toEqual({ percent: 19, status: "LOW" });
    expect(creditView(run([["PURCHASE", 150_000], ["USAGE", -149_999]]), ALL_FREE_USED)).toEqual({ percent: 1, status: "LOW" });
  });
  it("spending the free allowance never lowers the bar of a salon that bought", () => {
    const bought = run([["PURCHASE", 150_000]]);
    expect(creditView(bought, 0)).toEqual({ percent: 100, status: "OK" });
    expect(creditView(bought, 10_000)).toEqual({ percent: 100, status: "OK" });
  });
  it("a salon that never bought sees its free allowance of the month", () => {
    expect(creditView(null, 0)).toEqual({ percent: 100, status: "OK" });
    expect(creditView(null, FREE_MONTHLY_UNITS / 2)).toEqual({ percent: 50, status: "OK" });
    expect(creditView(null, FREE_MONTHLY_UNITS - 1000)).toMatchObject({ status: "LOW" });
    expect(creditView(null, FREE_MONTHLY_UNITS)).toEqual({ percent: 0, status: "EMPTY" });
  });
  it("with nothing left it stops; a request needs credit or allowance left", () => {
    const empty = run([["PURCHASE", 150_000], ["USAGE", -150_000]]);
    expect(creditView(empty, ALL_FREE_USED)).toEqual({ percent: 0, status: "EMPTY" });
    expect(canStartRequest(empty, ALL_FREE_USED)).toBe(false);
    expect(canStartRequest(empty, 0)).toBe(true); // a new month's allowance
    expect(canStartRequest(null, ALL_FREE_USED)).toBe(false);
  });
  it("a request already started can leave the paid credit below zero; the next purchase covers it", () => {
    const below = run([["PURCHASE", 150_000], ["USAGE", -151_000]]);
    expect(creditView(below, ALL_FREE_USED).status).toBe("EMPTY");
    expect(nextPoint(below, "PURCHASE", 150_000)).toEqual({ balanceAfter: 149_000, baseAfter: 149_000 });
  });
  it("only a percentage and a status leave the rules: no amount, no count, no days", () => {
    expect(Object.keys(creditView(run([["PURCHASE", 150_000]]), 0))).toEqual(["percent", "status"]);
  });
  it("refuses a wrong sign or a fractional amount", () => {
    expect(() => nextPoint(null, "PURCHASE", -5)).toThrow("CREDIT_UNITS_INVALID");
    expect(() => nextPoint(null, "USAGE", 1)).toThrow("CREDIT_UNITS_INVALID");
    expect(() => nextPoint(null, "REVERSAL", 0)).toThrow("CREDIT_UNITS_INVALID");
    expect(() => nextPoint(null, "GRANT", 1.5)).toThrow("CREDIT_UNITS_INVALID");
  });
});

describe("the free monthly allowance (about 20 requests)", () => {
  it("is spent first, then the paid credit", () => {
    expect(splitCost(1_232, 0)).toEqual({ free: 1_232, paid: 0 });
    expect(splitCost(1_232, FREE_MONTHLY_UNITS - 200)).toEqual({ free: 200, paid: 1_032 });
    expect(splitCost(1_232, FREE_MONTHLY_UNITS)).toEqual({ free: 0, paid: 1_232 });
  });
  it("is 37 400 units: about 20 requests at the measured average, about R$ 0,37 of real cost per salon and month", () => {
    expect(FREE_MONTHLY_UNITS).toBe(37_400);
    expect(FREE_MONTHLY_UNITS * CREDIT_UNIT_BRL / MARGIN_MULTIPLIER).toBeCloseTo(0.374);
  });
});

describe("payments: credit, duplicates and refunds", () => {
  const purchase = { amountCents: P15.amountCents, units: P15.units, state: "AWAITING_PAYMENT" as const, providerPaymentId: null };
  const paidAt = new Date("2026-10-20T12:00:00Z");
  const approved = { id: "pay-1", status: "approved", refundedCents: 0, paidAt };
  const paid = { ...purchase, state: "PAID" as const, providerPaymentId: "pay-1" };
  it("an approved payment credits the pack once; the same notice again credits nothing", () => {
    expect(decideCreditPayment({ purchase, payment: approved, credited: 0, reversed: 0 })).toEqual({ credit: 150_000, reverse: 0, state: "PAID", error: null, providerPaymentId: "pay-1" });
    expect(decideCreditPayment({ purchase: paid, payment: approved, credited: 150_000, reversed: 0 }).credit).toBe(0);
  });
  it("money is never kept without its credit: an approved payment credits even after the purchase expired", () => {
    expect(decideCreditPayment({ purchase: { ...purchase, state: "EXPIRED" }, payment: approved, credited: 0, reversed: 0 })).toMatchObject({ credit: 150_000, state: "PAID" });
  });
  it("a second approved payment for the same purchase is not credited and goes to review; approved without a date too", () => {
    expect(decideCreditPayment({ purchase: paid, payment: { ...approved, id: "pay-2" }, credited: 0, reversed: 0 })).toMatchObject({ credit: 0, state: "REVIEW", error: "DUPLICATE_PAYMENT" });
    expect(decideCreditPayment({ purchase, payment: { ...approved, paidAt: null }, credited: 0, reversed: 0 })).toMatchObject({ credit: 0, state: "REVIEW" });
  });
  it("pending, in process, rejected and cancelled move nothing", () => {
    for (const status of ["pending", "in_process", "rejected", "cancelled"])
      expect(decideCreditPayment({ purchase, payment: { ...approved, status, paidAt: null }, credited: 0, reversed: 0 })).toMatchObject({ credit: 0, reverse: 0, state: "AWAITING_PAYMENT" });
  });
  it("a full refund takes the whole credit back, even below zero; the next pack covers what was used", () => {
    const decision = decideCreditPayment({ purchase: paid, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 150_000, reversed: 0 });
    expect(decision).toMatchObject({ reverse: 150_000, state: "REFUNDED" });
    const after = nextPoint(run([["PURCHASE", 150_000], ["USAGE", -40_000]]), "REVERSAL", -decision.reverse);
    expect(after.balanceAfter).toBe(-40_000);
    expect(nextPoint(after, "PURCHASE", 150_000)).toEqual({ balanceAfter: 110_000, baseAfter: 110_000 });
  });
  it("a partial refund (R$ 5 of 15) takes back a third, rounded up; a later full refund takes the rest; replays take nothing", () => {
    expect(reversedUnits(P15, { status: "refunded", refundedCents: 500 })).toBe(50_000);
    expect(decideCreditPayment({ purchase: paid, payment: { ...approved, status: "refunded", refundedCents: 500 }, credited: 150_000, reversed: 0 })).toMatchObject({ reverse: 50_000, state: "PAID" });
    expect(decideCreditPayment({ purchase: paid, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 150_000, reversed: 50_000 })).toMatchObject({ reverse: 100_000, state: "REFUNDED" });
    expect(decideCreditPayment({ purchase: { ...paid, state: "REFUNDED" }, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 150_000, reversed: 150_000 }).reverse).toBe(0);
  });
  it("a payment first seen already partly refunded credits only what is left", () => {
    expect(decideCreditPayment({ purchase, payment: { ...approved, status: "refunded", refundedCents: 500 }, credited: 0, reversed: 0 })).toMatchObject({ credit: 100_000, reverse: 0, state: "PAID" });
  });
  it("a refunded status without an amount takes everything back", () => {
    expect(decideCreditPayment({ purchase: paid, payment: { ...approved, status: "refunded", refundedCents: 0 }, credited: 150_000, reversed: 0 })).toMatchObject({ reverse: 150_000, state: "REFUNDED" });
  });
  it("a purchase in review stays in review: its own payment's later notices still credit or reverse, but never reopen it", () => {
    const review = { ...paid, state: "REVIEW" as const };
    expect(decideCreditPayment({ purchase: review, payment: approved, credited: 150_000, reversed: 0 })).toMatchObject({ credit: 0, state: "REVIEW" });
    expect(decideCreditPayment({ purchase: review, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 150_000, reversed: 0 })).toMatchObject({ reverse: 150_000, state: "REVIEW" });
  });
  it("a chargeback takes everything back; a refund of a payment never credited takes nothing; a refund above the price is refused", () => {
    expect(decideCreditPayment({ purchase: paid, payment: { ...approved, status: "charged_back" }, credited: 150_000, reversed: 0 })).toMatchObject({ reverse: 150_000, state: "REFUNDED" });
    expect(decideCreditPayment({ purchase, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 0, reversed: 0 })).toMatchObject({ credit: 0, reverse: 0, state: "REFUNDED" });
    expect(() => reversedUnits(P15, { status: "refunded", refundedCents: 1501 })).toThrow("PAYMENT_MISMATCH");
  });
});
