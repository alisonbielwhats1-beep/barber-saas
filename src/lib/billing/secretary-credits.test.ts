/**
 * Secretária prepaid requests (owner decisions 06/10/2026), end to end without a database or the real Mercado Pago: an in-memory
 * ledger with the same idempotency keys as 029, and a simulated provider. Expected numbers are written out by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));
type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ ledger: [] as Row[], purchases: [] as Row[], seq: 0n, owner: true, locks: 0 }));
const pick = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
  if (k === "salonId_requestKey") return row.salonId === (v as Row).salonId && row.requestKey === (v as Row).requestKey;
  if (v && typeof v === "object" && "in" in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k]);
  if (v && typeof v === "object" && "gte" in (v as object)) return (row[k] as Date) >= (v as { gte: Date }).gte;
  return row[k] === v;
});
const table = (rows: () => Row[], unique: string[]) => ({
  findUnique: async ({ where }: { where: Record<string, unknown> }) => rows().find(r => pick(r, where)) ?? null,
  findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => { const r = rows().find(x => pick(x, where)); if (!r) throw Error("NOT_FOUND"); return { ...r }; },
  findFirst: async ({ where = {}, orderBy }: { where?: Record<string, unknown>; orderBy?: { seq?: "asc" | "desc" } }) => {
    const found = rows().filter(r => pick(r, where));
    if (orderBy?.seq) found.sort((a, b) => Number((a.seq as bigint) - (b.seq as bigint)) * (orderBy.seq === "desc" ? -1 : 1));
    return found[0] ? { ...found[0] } : null;
  },
  findMany: async ({ where = {} }: { where?: Record<string, unknown> }) => rows().filter(r => pick(r, where)).map(r => ({ ...r })),
  count: async ({ where = {} }: { where?: Record<string, unknown> }) => rows().filter(r => pick(r, where)).length,
  create: async ({ data }: { data: Row }) => {
    for (const key of unique) if (data[key] != null && rows().some(r => r[key] === data[key] && (key !== "requestKey" || r.salonId === data.salonId))) throw Error(`UNIQUE_${key}`);
    // The database defaults of 029.
    const defaults = rows === purchases ? { state: "CREATED", refundedCents: 0, preferenceId: null, providerPaymentId: null, creationStartedAt: null, checkoutUrl: null, paidAt: null, lastError: null } : {};
    const row = { createdAt: new Date(), ...defaults, ...data, id: data.id ?? randomUUID() } as Row;
    if (rows === ledger) { db.seq += 1n; row.seq = db.seq; }
    rows().push(row); return { ...row };
  },
  update: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => { const r = rows().find(x => pick(x, where))!; Object.assign(r, data); return { ...r }; },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => { const found = rows().filter(x => pick(x, where)); found.forEach(r => Object.assign(r, data)); return { count: found.length }; },
});
const ledger = () => db.ledger, purchases = () => db.purchases;
const tx = {
  $executeRaw: async () => 0, $queryRaw: async () => { db.locks++; return [{ locked: 1 }]; },
  secretaryCreditLedger: table(ledger, ["requestKey"]), secretaryCreditPurchase: table(purchases, ["requestKey", "providerPaymentId", "preferenceId"]),
  membership: { findFirst: async () => db.owner ? { role: "OWNER" } : null },
};
vi.mock("../prisma-tenant", () => ({ withSalon: async (_s: string, fn: (t: unknown) => unknown) => fn(tx), withTenant: async (_c: unknown, fn: (t: unknown) => unknown) => fn(tx) }));
vi.mock("./provider", async original => {
  const real = await original<typeof import("./provider")>();
  return { ...real, mpRequest: vi.fn(), verifySellerAccount: vi.fn(async () => undefined) };
});

import * as mp from "./provider";
import { applyCreditPayment, createCreditPurchase, creditReference, receiveCreditPayment, reconcileCreditPurchase, validateCreditPayment } from "./credits-provider";
import { assertCanStartRequest, debitRequest, grantCredits, secretaryCreditView } from "../secretary-credits";

const actor = { salonId: "salao-1", userId: "dono-1" };
const env = { MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_ACCESS_TOKEN: "synthetic", MERCADOPAGO_WEBHOOK_SECRET: "synthetic", MERCADOPAGO_COLLECTOR_ID: "123",
  MERCADOPAGO_MODE: "test", NEXTAUTH_URL: "http://localhost:3000", SALON_SECRETARY_CREDITS_ENABLED: "true", APP_ENV: "development" };
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const k of ["VERCEL_ENV", "MERCADOPAGO_CHECKOUT_PAUSED"]) { saved[k] = process.env[k]; delete process.env[k]; }
  db.ledger = []; db.purchases = []; db.seq = 0n; db.owner = true;
  vi.mocked(mp.mpRequest).mockReset();
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

/** Mercado Pago answers the preference creation with exactly what was asked (its own id and link). */
function providerEchoesPreference() {
  vi.mocked(mp.mpRequest).mockImplementation(async (_path: string, method?: string, body?: unknown) => {
    if (method !== "POST") throw Error("UNEXPECTED_CALL");
    const b = body as { items: { quantity: number; unit_price: number; currency_id: string }[]; external_reference: string; expiration_date_to: string };
    return { id: `pref-${db.purchases.length}`, collector_id: 123, external_reference: b.external_reference, init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=x",
      items: b.items, expires: true, expiration_date_to: b.expiration_date_to };
  });
}
const payment = (purchase: Row, over: Partial<mp.RemotePayment> = {}): mp.RemotePayment => ({ id: "pay-1", collector_id: "123", currency_id: "BRL",
  transaction_amount: (purchase.amountCents as number) / 100, status: "approved", date_last_updated: "2026-10-20T12:00:00.000Z", date_approved: "2026-10-20T12:00:00.000Z",
  live_mode: false, external_reference: creditReference(purchase as { salonId: string; id: string }), transaction_amount_refunded: 0, ...over });
async function buy(pack: "P15" | "P25" | "P40") {
  providerEchoesPreference();
  return await createCreditPurchase(actor, { pack }, randomUUID()) as unknown as Row;
}
const balance = async () => (await secretaryCreditView(actor)).balance;

describe("buying a pack through Mercado Pago", () => {
  it("creates one Checkout Pro preference: the pack's exact price in reais, one installment, Pix and card (no boleto), 24 h", async () => {
    const purchase = await buy("P15");
    const [path, method, body] = vi.mocked(mp.mpRequest).mock.calls[0] as [string, string, Record<string, unknown>];
    expect([path, method]).toEqual(["/checkout/preferences", "POST"]);
    expect(body).toMatchObject({ items: [{ quantity: 1, currency_id: "BRL", unit_price: 15 }], binary_mode: true, expires: true,
      payment_methods: { installments: 1, excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] }, external_reference: `efc:salao-1:${purchase.id}`,
      back_urls: { success: "http://localhost:3000/api/billing/return?origem=creditos" } });
    expect(purchase).toMatchObject({ state: "AWAITING_PAYMENT", amountCents: 1500, requests: 185, checkoutUrl: expect.stringContaining("mercadopago.com.br") });
    expect((purchase.expiresAt as Date).getTime() - (purchase.createdAt as Date).getTime()).toBe(24 * 3600_000);
  });
  it("a repeated click (same key) returns the same purchase and never a second preference", async () => {
    providerEchoesPreference();
    const key = randomUUID();
    const first = await createCreditPurchase(actor, { pack: "P25" }, key), again = await createCreditPurchase(actor, { pack: "P25" }, key);
    expect(again.id).toBe(first.id);
    expect(vi.mocked(mp.mpRequest)).toHaveBeenCalledTimes(1);
    await expect(createCreditPurchase(actor, { pack: "P40" }, key)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("only the owner buys; an unknown pack is refused; nothing is sold with the flag off or the checkout paused", async () => {
    db.owner = false;
    await expect(buy("P15")).rejects.toThrow("OWNER_REQUIRED");
    db.owner = true;
    await expect(createCreditPurchase(actor, { pack: "P99" }, randomUUID())).rejects.toThrow();
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "false";
    await expect(buy("P15")).rejects.toThrow("CREDITS_DISABLED");
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "true"; process.env.MERCADOPAGO_CHECKOUT_PAUSED = "true";
    await expect(buy("P15")).rejects.toThrow("CHECKOUT_PAUSED");
  });
  it("a preference that comes back with another price is never shown", async () => {
    vi.mocked(mp.mpRequest).mockImplementation(async (_p, _m, body) => {
      const b = body as { external_reference: string; expiration_date_to: string };
      return { id: "pref-x", collector_id: 123, external_reference: b.external_reference, init_point: "https://www.mercadopago.com.br/x", items: [{ quantity: 1, unit_price: 1.5, currency_id: "BRL" }], expires: true, expiration_date_to: b.expiration_date_to };
    });
    await expect(createCreditPurchase(actor, { pack: "P15" }, randomUUID())).rejects.toThrow("CREDIT_CHECKOUT_MISMATCH");
    expect(db.purchases[0]).toMatchObject({ state: "CREATED", checkoutUrl: null });
  });
});

describe("payments credit the pack, sum with what is left, and never twice", () => {
  it("owner's example: 20% left (37 of 185) + a new R$ 15 pack = 222 requests, bar back at 100%", async () => {
    const first = await buy("P15");
    await applyCreditPayment(first as never, payment(first));
    for (let i = 0; i < 148; i++) await debitRequest(actor, `msg-${i}`);
    expect(await secretaryCreditView(actor)).toMatchObject({ balance: 37, percent: 20, status: "OK" });
    const second = await buy("P15");
    await applyCreditPayment(second as never, payment(second, { id: "pay-2" }));
    expect(await secretaryCreditView(actor)).toMatchObject({ balance: 222, base: 222, percent: 100, status: "OK" });
  });
  it("the same webhook twice (or the webhook and the return page) credits once", async () => {
    const purchase = await buy("P40");
    await applyCreditPayment(purchase as never, payment(purchase));
    await applyCreditPayment(purchase as never, payment(purchase));
    expect(await balance()).toBe(500);
    expect(db.ledger.filter(r => r.kind === "PURCHASE")).toHaveLength(1);
    expect(db.purchases[0]).toMatchObject({ state: "PAID", providerPaymentId: "pay-1" });
  });
  it("pending Pix credits nothing; the approval later credits", async () => {
    const purchase = await buy("P15");
    await applyCreditPayment(purchase as never, payment(purchase, { status: "pending", date_approved: null }));
    expect(await balance()).toBe(0);
    await applyCreditPayment(purchase as never, payment(purchase));
    expect(await balance()).toBe(185);
  });
  it("refuses a payment of another amount, currency, account, purchase, or a test payment in live mode", () => {
    const purchase = { salonId: "salao-1", id: "11111111-1111-4111-8111-111111111111", amountCents: 1500 } as Row;
    const config = { collectorId: "123", mode: "live" as const };
    const ok = payment(purchase, { live_mode: true });
    expect(() => validateCreditPayment(purchase as never, ok, config)).not.toThrow();
    for (const bad of [{ transaction_amount: 14.99 }, { currency_id: "USD" }, { collector_id: "999" }, { external_reference: "efc:salao-2:11111111-1111-4111-8111-111111111111" }, { live_mode: false }, { transaction_amount_refunded: 15.01 }])
      expect(() => validateCreditPayment(purchase as never, { ...ok, ...bad }, config)).toThrow("PAYMENT_MISMATCH");
  });
  it("a full refund takes the pack back, even below zero; the next pack covers what was used", async () => {
    const purchase = await buy("P15");
    await applyCreditPayment(purchase as never, payment(purchase));
    for (let i = 0; i < 50; i++) await debitRequest(actor, `msg-${i}`);
    await applyCreditPayment(purchase as never, payment(purchase, { status: "refunded", transaction_amount_refunded: 15 }));
    expect(await secretaryCreditView(actor)).toMatchObject({ balance: -50, status: "EMPTY" });
    await expect(assertCanStartRequest(actor)).rejects.toThrow("SECRETARY_CREDITS_EMPTY");
    expect(db.purchases[0]).toMatchObject({ state: "REFUNDED", refundedCents: 1500 });
    const next = await buy("P15");
    await applyCreditPayment(next as never, payment(next, { id: "pay-2" }));
    expect(await balance()).toBe(135);
  });
  it("a partial refund (R$ 5 of 15) takes back 62 of 185 requests, once", async () => {
    const purchase = await buy("P15");
    await applyCreditPayment(purchase as never, payment(purchase));
    await applyCreditPayment(purchase as never, payment(purchase, { transaction_amount_refunded: 5 }));
    await applyCreditPayment(purchase as never, payment(purchase, { transaction_amount_refunded: 5 }));
    expect(await balance()).toBe(123);
  });
  it("a chargeback takes the whole pack back", async () => {
    const purchase = await buy("P25");
    await applyCreditPayment(purchase as never, payment(purchase));
    await applyCreditPayment(purchase as never, payment(purchase, { status: "charged_back" }));
    expect(await balance()).toBe(0);
  });
  it("a second payment for the same purchase is not credited and goes to review", async () => {
    const purchase = await buy("P15");
    await applyCreditPayment(purchase as never, payment(purchase));
    await applyCreditPayment(purchase as never, payment(purchase, { id: "pay-2" }));
    expect(await balance()).toBe(185);
    expect(db.purchases[0]).toMatchObject({ state: "REVIEW", lastError: "DUPLICATE_PAYMENT", providerPaymentId: "pay-1" });
  });
});

describe("using the requests", () => {
  it("one request per finished message, once per message key; without requests a new message is refused", async () => {
    await expect(assertCanStartRequest(actor)).rejects.toThrow("SECRETARY_CREDITS_EMPTY");
    await grantCredits({ salonId: actor.salonId, requests: 2, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    await assertCanStartRequest(actor);
    await debitRequest(actor, "same-message"); await debitRequest(actor, "same-message");
    expect(await balance()).toBe(1);
    await debitRequest(actor, "another");
    expect(await secretaryCreditView(actor)).toMatchObject({ balance: 0, status: "EMPTY" });
    await expect(assertCanStartRequest(actor)).rejects.toThrow("SECRETARY_CREDITS_EMPTY");
  });
  it("with the flag off nothing is checked or debited", async () => {
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "false";
    await expect(assertCanStartRequest(actor)).resolves.toBeUndefined();
    expect(await debitRequest(actor, "x")).toBeNull();
    expect(db.ledger).toHaveLength(0);
  });
  it("every ledger write happens under the salon's credit lock", async () => {
    db.locks = 0;
    await grantCredits({ salonId: actor.salonId, requests: 5, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    await debitRequest(actor, "m1");
    expect(db.locks).toBe(2);
  });
});

describe("reconciliation", () => {
  it("back from the checkout, the payments found by reference are applied; an unpaid purchase expires after the grace hour", async () => {
    const purchase = await buy("P15");
    vi.mocked(mp.mpRequest).mockImplementation(async () => ({ results: [payment(purchase)], paging: { total: 1 } }));
    await reconcileCreditPurchase(actor.salonId, purchase.id);
    expect(await balance()).toBe(185);
    const unpaid = await buy("P25");
    vi.mocked(mp.mpRequest).mockImplementation(async () => ({ results: [], paging: { total: 0 } }));
    await reconcileCreditPurchase(actor.salonId, unpaid.id, new Date((unpaid.expiresAt as Date).getTime() + 30 * 60_000));
    expect(db.purchases.find(p => p.id === unpaid.id)?.state).toBe("AWAITING_PAYMENT");
    await reconcileCreditPurchase(actor.salonId, unpaid.id, new Date((unpaid.expiresAt as Date).getTime() + 2 * 3600_000));
    expect(db.purchases.find(p => p.id === unpaid.id)?.state).toBe("EXPIRED");
  });
  it("selling turned off still confirms a purchase already paid; a payment of another amount goes to review, acknowledged", async () => {
    const purchase = await buy("P15");
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "false";
    await receiveCreditPayment(payment(purchase));
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "true";
    expect(await balance()).toBe(185);
    const other = await buy("P25");
    expect(await receiveCreditPayment(payment(other, { id: "pay-x", transaction_amount: 1 }))).toBeNull();
    expect(db.purchases.find(p => p.id === other.id)).toMatchObject({ state: "REVIEW", lastError: "PAYMENT_MISMATCH" });
    expect(await balance()).toBe(185);
  });
  it("an approval that arrives after the purchase expired still credits (money is never kept without its requests)", async () => {
    const purchase = await buy("P15");
    db.purchases[0].state = "EXPIRED";
    await applyCreditPayment(purchase as never, payment(purchase));
    expect(await balance()).toBe(185);
    expect(db.purchases[0].state).toBe("PAID");
  });
});
