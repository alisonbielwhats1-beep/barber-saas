import { describe, expect, it } from "vitest";
import { SECRETARY_CREDIT_PACKS } from "../billing/catalog";
import { canStartRequest, creditView, decideCreditPayment, nextPoint, reversedRequests, type CreditKind, type LedgerPoint } from "../secretary-credits-rules";

/** Owner decisions 06/10/2026: prepaid requests, summed on every top-up, never expiring, warning below 20%. */
const run = (rows: [CreditKind, number][], start: LedgerPoint | null = null) => rows.reduce<LedgerPoint | null>((point, [kind, n]) => nextPoint(point, kind, n), start);
const P15 = SECRETARY_CREDIT_PACKS.P15;
const use = (n: number): [CreditKind, number][] => Array.from({ length: n }, () => ["USAGE", -1]);

describe("packs", () => {
  it("R$ 15, 25 and 40 buy 185, 310 and 500 requests, never under R$ 0,08 per request (the price for a 90% margin)", () => {
    expect(Object.values(SECRETARY_CREDIT_PACKS).map(p => [p.amountCents, p.requests])).toEqual([[1500, 185], [2500, 310], [4000, 500]]);
    for (const pack of Object.values(SECRETARY_CREDIT_PACKS)) expect(pack.amountCents / pack.requests).toBeGreaterThanOrEqual(8);
    // A bigger pack never costs more per request.
    const perRequest = Object.values(SECRETARY_CREDIT_PACKS).map(p => p.amountCents / p.requests);
    expect([...perRequest].sort((a, b) => b - a)).toEqual(perRequest);
  });
});

describe("balance and the bar", () => {
  it("a first purchase starts the bar at 100%", () => {
    expect(creditView(run([["PURCHASE", 185]]))).toMatchObject({ balance: 185, base: 185, percent: 100, status: "OK" });
  });
  it("each finished request takes one; the bar keeps the purchase as its 100%", () => {
    const point = run([["PURCHASE", 185], ...use(51)]);
    expect(creditView(point)).toMatchObject({ balance: 134, base: 185, percent: 72, status: "OK" });
  });
  it("owner's example: with 20% left, buying R$ 15 more SUMS both and the bar restarts at 100%", () => {
    const at20 = run([["PURCHASE", 185], ...use(148)]);
    expect(creditView(at20)).toMatchObject({ balance: 37, percent: 20, status: "OK" });
    const topped = nextPoint(at20, "PURCHASE", P15.requests);
    expect(creditView(topped)).toMatchObject({ balance: 222, base: 222, percent: 100, status: "OK" });
    // The new 100% is the summed balance: using 111 is exactly half.
    expect(creditView(run(use(111), topped))).toMatchObject({ balance: 111, percent: 50 });
  });
  it("two different packs also sum (R$ 25 + R$ 40 = 810)", () => {
    expect(creditView(run([["PURCHASE", 310], ["PURCHASE", 500]]))).toMatchObject({ balance: 810, base: 810, percent: 100 });
  });
  it("warns strictly below 20%: 37 of 185 is 20% (no warning), 36 is 19% (warning)", () => {
    expect(creditView(run([["PURCHASE", 185], ...use(148)])).status).toBe("OK");
    expect(creditView(run([["PURCHASE", 185], ...use(149)]))).toMatchObject({ balance: 36, percent: 19, status: "LOW" });
  });
  it("the percentage rounds down but a positive balance never shows 0%", () => {
    expect(creditView(run([["PURCHASE", 500], ...use(499)]))).toMatchObject({ balance: 1, percent: 1, status: "LOW" });
  });
  it("at zero it stops; a new request needs at least one left", () => {
    const empty = run([["PURCHASE", 185], ...use(185)]);
    expect(creditView(empty)).toMatchObject({ balance: 0, percent: 0, status: "EMPTY" });
    expect(canStartRequest(empty)).toBe(false);
    expect(canStartRequest(run([["PURCHASE", 185], ...use(184)]))).toBe(true);
    expect(canStartRequest(null)).toBe(false);
  });
  it("two requests started together on the last one can end at -1; the next purchase covers it", () => {
    const below = run([["PURCHASE", 185], ...use(186)]);
    expect(creditView(below)).toMatchObject({ balance: -1, percent: 0, status: "EMPTY" });
    expect(creditView(nextPoint(below, "PURCHASE", 185))).toMatchObject({ balance: 184, base: 184, percent: 100 });
  });
  it("a courtesy grant sums like a purchase", () => {
    expect(creditView(run([["PURCHASE", 185], ...use(100), ["GRANT", 50]]))).toMatchObject({ balance: 135, base: 135, percent: 100 });
  });
  it("requests never expire: the view has no date in it, only the ledger's balance", () => {
    expect(Object.keys(creditView(run([["PURCHASE", 185]])))).toEqual(["balance", "base", "percent", "status", "daysLeft"]);
  });
  it("refuses a wrong sign or a fractional amount", () => {
    expect(() => nextPoint(null, "PURCHASE", -5)).toThrow("CREDIT_REQUESTS_INVALID");
    expect(() => nextPoint(null, "USAGE", 1)).toThrow("CREDIT_REQUESTS_INVALID");
    expect(() => nextPoint(null, "GRANT", 1.5)).toThrow("CREDIT_REQUESTS_INVALID");
    expect(() => nextPoint(null, "GRANT", 0)).toThrow("CREDIT_REQUESTS_INVALID");
  });
});

describe("how long it lasts", () => {
  const now = new Date("2026-10-20T12:00:00Z"), daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const point = run([["PURCHASE", 185], ...use(51)]);
  it("balance over the average of the last 7 days: 134 left at 10 a day lasts 13 days", () => {
    expect(creditView(point, { usedInWindow: 70, firstUsageAt: daysAgo(30), now }).daysLeft).toBe(13);
  });
  it("with 3 to 7 days of history, the average is over the days actually used", () => {
    expect(creditView(point, { usedInWindow: 40, firstUsageAt: daysAgo(4), now }).daysLeft).toBe(13); // 10 a day
  });
  it("hidden before 3 days of history, without use in the window, or at zero", () => {
    expect(creditView(point, { usedInWindow: 20, firstUsageAt: daysAgo(2), now }).daysLeft).toBeNull();
    expect(creditView(point, { usedInWindow: 0, firstUsageAt: daysAgo(30), now }).daysLeft).toBeNull();
    expect(creditView(point, { usedInWindow: 20, firstUsageAt: null, now }).daysLeft).toBeNull();
    expect(creditView(run([["PURCHASE", 1], ["USAGE", -1]]), { usedInWindow: 20, firstUsageAt: daysAgo(30), now }).daysLeft).toBeNull();
  });
});

describe("payments: credit, duplicates and refunds", () => {
  const purchase = { amountCents: P15.amountCents, requests: P15.requests, state: "AWAITING_PAYMENT" as const, providerPaymentId: null };
  const paidAt = new Date("2026-10-20T12:00:00Z");
  const approved = { id: "pay-1", status: "approved", refundedCents: 0, paidAt };
  it("an approved payment credits the pack once; the same notice again credits nothing", () => {
    expect(decideCreditPayment({ purchase, payment: approved, credited: 0, reversed: 0 })).toEqual({ credit: 185, reverse: 0, state: "PAID", error: null, providerPaymentId: "pay-1" });
    expect(decideCreditPayment({ purchase: { ...purchase, state: "PAID", providerPaymentId: "pay-1" }, payment: approved, credited: 185, reversed: 0 }).credit).toBe(0);
  });
  it("money is never kept without its requests: an approved payment credits even after the purchase expired", () => {
    expect(decideCreditPayment({ purchase: { ...purchase, state: "EXPIRED" }, payment: approved, credited: 0, reversed: 0 })).toMatchObject({ credit: 185, state: "PAID" });
  });
  it("a second approved payment for the same purchase is not credited and goes to review", () => {
    expect(decideCreditPayment({ purchase: { ...purchase, state: "PAID", providerPaymentId: "pay-1" }, payment: { ...approved, id: "pay-2" }, credited: 0, reversed: 0 }))
      .toMatchObject({ credit: 0, state: "REVIEW", error: "DUPLICATE_PAYMENT", providerPaymentId: "pay-1" });
  });
  it("approved without a payment date goes to review", () => {
    expect(decideCreditPayment({ purchase, payment: { ...approved, paidAt: null }, credited: 0, reversed: 0 })).toMatchObject({ credit: 0, state: "REVIEW" });
  });
  it("pending, in process, rejected and cancelled move nothing", () => {
    for (const status of ["pending", "in_process", "rejected", "cancelled"])
      expect(decideCreditPayment({ purchase, payment: { ...approved, status, paidAt: null }, credited: 0, reversed: 0 })).toMatchObject({ credit: 0, reverse: 0, state: "AWAITING_PAYMENT" });
  });
  it("a full refund takes back the whole pack, even if requests were already used (balance below zero)", () => {
    const paid = { ...purchase, state: "PAID" as const, providerPaymentId: "pay-1" };
    const decision = decideCreditPayment({ purchase: paid, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 185, reversed: 0 });
    expect(decision).toMatchObject({ reverse: 185, state: "REFUNDED" });
    const after = nextPoint(run([["PURCHASE", 185], ...use(50)]), "REVERSAL", -decision.reverse);
    expect(creditView(after)).toMatchObject({ balance: -50, status: "EMPTY" });
    // The next pack pays off what was used with the refunded money.
    expect(creditView(nextPoint(after, "PURCHASE", 185))).toMatchObject({ balance: 135, percent: 100 });
  });
  it("a partial refund takes back its share, rounded up; a later bigger refund takes only the difference", () => {
    const paid = { ...purchase, state: "PAID" as const, providerPaymentId: "pay-1" };
    expect(reversedRequests(P15, { status: "refunded", refundedCents: 500 })).toBe(62); // 185/3 = 61.67 -> 62
    const first = decideCreditPayment({ purchase: paid, payment: { ...approved, status: "refunded", refundedCents: 500 }, credited: 185, reversed: 0 });
    expect(first).toMatchObject({ reverse: 62, state: "PAID" });
    const second = decideCreditPayment({ purchase: paid, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 185, reversed: 62 });
    expect(second).toMatchObject({ reverse: 123, state: "REFUNDED" });
    // Replaying the same refund takes nothing more.
    expect(decideCreditPayment({ purchase: { ...paid, state: "REFUNDED" }, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 185, reversed: 185 }).reverse).toBe(0);
  });
  it("a payment first seen already partly refunded credits only what is left; the later full refund takes the rest", () => {
    const first = decideCreditPayment({ purchase, payment: { ...approved, status: "refunded", refundedCents: 500 }, credited: 0, reversed: 0 });
    expect(first).toMatchObject({ credit: 123, reverse: 0, state: "PAID" });
    // Replaying the same partial refund moves nothing.
    expect(decideCreditPayment({ purchase: { ...purchase, state: "PAID", providerPaymentId: "pay-1" }, payment: { ...approved, status: "refunded", refundedCents: 500 }, credited: 123, reversed: 0 }))
      .toMatchObject({ credit: 0, reverse: 0 });
    expect(decideCreditPayment({ purchase: { ...purchase, state: "PAID", providerPaymentId: "pay-1" }, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 123, reversed: 0 }))
      .toMatchObject({ credit: 0, reverse: 123, state: "REFUNDED" });
  });
  it("a chargeback takes back the whole pack", () => {
    const paid = { ...purchase, state: "PAID" as const, providerPaymentId: "pay-1" };
    expect(decideCreditPayment({ purchase: paid, payment: { ...approved, status: "charged_back" }, credited: 185, reversed: 0 })).toMatchObject({ reverse: 185, state: "REFUNDED" });
  });
  it("a refund of a payment never credited takes nothing; a later approved notice does not undo the refund", () => {
    expect(decideCreditPayment({ purchase, payment: { ...approved, status: "refunded", refundedCents: 1500 }, credited: 0, reversed: 0 })).toMatchObject({ reverse: 0, state: "REFUNDED" });
    expect(decideCreditPayment({ purchase: { ...purchase, state: "REFUNDED", providerPaymentId: "pay-1" }, payment: approved, credited: 185, reversed: 185 })).toMatchObject({ credit: 0, state: "REFUNDED" });
  });
  it("a refund above the price is refused", () => {
    expect(() => reversedRequests(P15, { status: "refunded", refundedCents: 1501 })).toThrow("PAYMENT_MISMATCH");
  });
});
