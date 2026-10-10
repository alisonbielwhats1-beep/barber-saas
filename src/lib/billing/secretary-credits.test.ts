/**
 * Secretária prepaid credit (owner decisions 06/10/2026), end to end without a database or the real Mercado Pago: an in-memory
 * ledger with the same idempotency keys as 029/030, and a simulated provider. Expected numbers are written out by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));
type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ ledger: [] as Row[], purchases: [] as Row[], calls: [] as Row[], seq: 0n, owner: true, locks: 0 }));
const match = (value: unknown, cond: unknown): boolean => {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("gte" in c) return (value as Date) >= (c.gte as Date);
    if ("gt" in c) return (value as number) > (c.gt as number);
    if ("path" in c) return (value as Record<string, unknown>)?.[(c.path as string[])[0]] === c.equals;
  }
  return value === cond;
};
const pick = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) =>
  k === "salonId_requestKey" ? row.salonId === (v as Row).salonId && row.requestKey === (v as Row).requestKey : match(row[k], v));
const ledger = () => db.ledger, purchases = () => db.purchases;
const table = (rows: () => Row[], unique: string[]) => ({
  findUnique: async ({ where }: { where: Record<string, unknown> }) => rows().find(r => pick(r, where)) ?? null,
  findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => { const r = rows().find(x => pick(x, where)); if (!r) throw Error("NOT_FOUND"); return { ...r }; },
  findFirst: async ({ where = {}, orderBy }: { where?: Record<string, unknown>; orderBy?: { seq?: "asc" | "desc" } }) => {
    const found = rows().filter(r => pick(r, where));
    if (orderBy?.seq) found.sort((a, b) => Number((a.seq as bigint) - (b.seq as bigint)) * (orderBy.seq === "desc" ? -1 : 1));
    return found[0] ? { ...found[0] } : null;
  },
  findMany: async ({ where = {} }: { where?: Record<string, unknown> }) => rows().filter(r => pick(r, where)).map(r => ({ ...r })),
  aggregate: async ({ where = {} }: { where?: Record<string, unknown> }) => ({ _sum: { freeUnits: rows().filter(r => pick(r, where)).reduce((s, r) => s + (r.freeUnits as number), 0) || null } }),
  create: async ({ data }: { data: Row }) => {
    for (const key of unique) if (data[key] != null && rows().some(r => r[key] === data[key] && (key !== "requestKey" || r.salonId === data.salonId))) throw Error(`UNIQUE_${key}`);
    // The database defaults of 029/030.
    const defaults = rows === purchases ? { state: "CREATED", refundedCents: 0, preferenceId: null, providerPaymentId: null, creationStartedAt: null, checkoutUrl: null, paidAt: null, lastError: null } : { freeUnits: 0 };
    const row = { createdAt: new Date(), ...defaults, ...data, id: data.id ?? randomUUID() } as Row;
    if (rows === ledger) { db.seq += 1n; row.seq = db.seq; }
    rows().push(row); return { ...row };
  },
  update: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => { const r = rows().find(x => pick(x, where))!; Object.assign(r, data); return { ...r }; },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => { const found = rows().filter(x => pick(x, where)); found.forEach(r => Object.assign(r, data)); return { count: found.length }; },
});
const tx = {
  $executeRaw: async () => 0, $queryRaw: async () => { db.locks++; return [{ locked: 1 }]; },
  salon: { findUniqueOrThrow: async () => ({ timezone: "America/Sao_Paulo" }) },
  // Honors orderBy createdAt and take, like the database: the sweep's page bound is part of what is tested (review 07/10/2026).
  auditLog: { findMany: async ({ where, orderBy, take }: { where: Record<string, unknown>; orderBy?: { createdAt?: "asc" | "desc" }; take?: number }) => {
    const found = db.calls.filter(r => pick(r, where)).map(r => ({ ...r }));
    if (orderBy?.createdAt) found.sort((a, b) => ((a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()) * (orderBy.createdAt === "desc" ? -1 : 1));
    return take === undefined ? found : found.slice(0, take);
  } },
  secretaryCreditLedger: table(ledger, ["requestKey"]), secretaryCreditPurchase: table(purchases, ["requestKey", "providerPaymentId", "preferenceId"]),
  membership: { findFirst: async () => db.owner ? { role: "OWNER" } : null },
};
vi.mock("../prisma-tenant", () => ({ withSalon: async (_s: string, fn: (t: unknown) => unknown) => fn(tx), withTenant: async (_c: unknown, fn: (t: unknown) => unknown) => fn(tx) }));
const alerts = vi.hoisted(() => [] as { salonId: string; purchaseId: string; reason: string }[]);
vi.mock("./credit-review-alert", () => ({ alertCreditReview: async (input: { salonId: string; purchaseId: string; reason: string }) => { alerts.push(input); return "sent"; } }));
vi.mock("./provider", async original => {
  const real = await original<typeof import("./provider")>();
  return { ...real, mpRequest: vi.fn(), verifySellerAccount: vi.fn(async () => undefined) };
});

import * as mp from "./provider";
import { applyCreditPayment, createCreditPurchase, CREDIT_SYNC_INTERVAL_MS, creditReference, receiveCreditPayment, reconcileCreditPurchase, syncPendingCreditPurchases, validateCreditPayment } from "./credits-provider";
import { assertCanStartRequest, CHARGE_BATCH, CHARGE_MAX_ROUNDS, chargePendingCalls, chargeRecording, CHARGING_STARTS_AT, grantCredits, secretaryCreditView } from "../secretary-credits";
import { FREE_MONTHLY_UNITS } from "../secretary-credits-rules";

const actor = { salonId: "salao-1", userId: "dono-1" };
const env = { MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_ACCESS_TOKEN: "synthetic", MERCADOPAGO_WEBHOOK_SECRET: "synthetic", MERCADOPAGO_COLLECTOR_ID: "123",
  MERCADOPAGO_MODE: "test", NEXTAUTH_URL: "http://localhost:3000", SALON_SECRETARY_CREDITS_ENABLED: "true", APP_ENV: "development" };
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const k of ["VERCEL_ENV", "MERCADOPAGO_CHECKOUT_PAUSED", "SALON_SECRETARY_USD_BRL"]) { saved[k] = process.env[k]; delete process.env[k]; }
  db.ledger = []; db.purchases = []; db.calls = []; db.seq = 0n; db.owner = true; alerts.length = 0;
  vi.mocked(mp.mpRequest).mockReset();
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

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
async function buy(pack: "P15" | "P25" | "P40" | "P80") { providerEchoesPreference(); return await createCreditPurchase(actor, { pack }, randomUUID()) as unknown as Row; }
const paidBalance = () => (db.ledger.at(-1)?.balanceAfter as number | undefined) ?? 0;
/** Now, but never before the credit went live (same month as the allowance spent by the helpers below). */
const NOW = new Date(Math.max(Date.now(), CHARGING_STARTS_AT.getTime() + 3600_000));
/** One finished model call of a conversation, as the usage recorder writes it. */
function modelCall(sessionId: string, input: number | null, output: number | null, at = NOW, status = "SUCCEEDED") {
  db.calls.push({ id: randomUUID(), entityId: randomUUID(), salonId: actor.salonId, entityType: "SALON_SECRETARY_USAGE", action: "MODEL_CALL_FINISHED", createdAt: at,
    metadata: { session_id: sessionId, status, model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: input, cached_input_tokens: 0, cache_write_tokens: 0, output_tokens: output } });
}
const sweep = () => chargePendingCalls(actor, process.env, NOW);
/** The micro-USD whose charge is exactly `units` at R$ 5,60 (units = ceil(micro-USD x 0,56)). */
const microFor = (units: number) => Math.floor(units * 10_000 / 5600);
/** Uses up this month's free allowance, so the tests below look at the paid credit alone. */
const useFreeAllowance = () => chargeRecording(actor, { recordingKey: "allowance", microUsd: microFor(FREE_MONTHLY_UNITS) });

describe("buying credit through Mercado Pago", () => {
  it("creates one Checkout Pro preference: exact price in reais, one installment, Pix and card (no boleto), 24 h, own return", async () => {
    const purchase = await buy("P15");
    const [path, method, body] = vi.mocked(mp.mpRequest).mock.calls[0] as [string, string, Record<string, unknown>];
    expect([path, method]).toEqual(["/checkout/preferences", "POST"]);
    expect(body).toMatchObject({ items: [{ title: "Everflair — Crédito da Secretária", quantity: 1, currency_id: "BRL", unit_price: 15 }], binary_mode: true, expires: true,
      payment_methods: { installments: 1, excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] }, external_reference: `efc:salao-1:${purchase.id}`,
      back_urls: { success: "http://localhost:3000/api/billing/return?origem=creditos" } });
    expect(purchase).toMatchObject({ state: "AWAITING_PAYMENT", amountCents: 1500, units: 150_000, checkoutUrl: expect.stringContaining("mercadopago.com.br") });
    expect((purchase.expiresAt as Date).getTime() - (purchase.createdAt as Date).getTime()).toBe(24 * 3600_000);
  });
  it("a repeated click (same key) returns the same purchase and never a second preference", async () => {
    providerEchoesPreference();
    const key = randomUUID();
    const first = await createCreditPurchase(actor, { pack: "P80" }, key), again = await createCreditPurchase(actor, { pack: "P80" }, key);
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

describe("using the credit: each model call and each recording at its real cost x 10", () => {
  it("a call takes its real cost (1000 input + 100 output tokens = US$ 0,00069 -> 387 units), the free allowance first, then paid credit", async () => {
    modelCall("conv-1", 1000, 100);
    expect(await sweep()).toBe(1);
    expect(db.ledger[0]).toMatchObject({ kind: "USAGE", units: 0, freeUnits: 387 });
    await chargeRecording(actor, { recordingKey: "rest", microUsd: microFor(FREE_MONTHLY_UNITS - 387) });
    expect(db.ledger[1]).toMatchObject({ units: 0, freeUnits: FREE_MONTHLY_UNITS - 387 });
    await grantCredits({ salonId: actor.salonId, units: 150_000, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    modelCall("conv-1", 1000, 100);
    await sweep();
    expect(paidBalance()).toBe(150_000 - 387);
  });
  it("every call of the salon is charged once: a follow-up answered in a child conversation, a repair, a message that failed", async () => {
    await useFreeAllowance();
    await grantCredits({ salonId: actor.salonId, units: 100_000, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    modelCall("conv-1", 1000, 100); modelCall("child-of-conv-1", 1000, 100); modelCall("conv-2", 1000, 100, NOW, "FAILED");
    expect(await sweep()).toBe(3);
    expect(await sweep()).toBe(0);
    expect(paidBalance()).toBe(100_000 - 3 * 387);
  });
  it("a call that succeeded without reported usage is charged as an average call; a failed one without usage costs nothing", async () => {
    await useFreeAllowance();
    await grantCredits({ salonId: actor.salonId, units: 10_000, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    modelCall("conv-1", null, null); modelCall("conv-1", null, null, NOW, "TIMEOUT");
    expect(await sweep()).toBe(1);
    expect(paidBalance()).toBe(10_000 - 1_680); // 3000 micro-USD x 0,56
  });
  it("calls before the credit went live (the pilot's test night) and older than 48 h are never charged", async () => {
    modelCall("conv-1", 1000, 100, new Date(CHARGING_STARTS_AT.getTime() - 60_000));
    modelCall("conv-1", 1000, 100, new Date(NOW.getTime() - 49 * 3600_000));
    expect(await sweep()).toBe(0);
  });
  it("a request first charges what was left behind, then checks the balance (a crash after a call never makes it free)", async () => {
    await useFreeAllowance();
    await grantCredits({ salonId: actor.salonId, units: 300, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    modelCall("conv-1", 1000, 100);
    await expect(assertCanStartRequest(actor, process.env, NOW)).rejects.toThrow("SECRETARY_CREDITS_EMPTY");
    expect(paidBalance()).toBe(300 - 387);
  });
  it("a recording takes its reported transcription cost, sent or not (1500 micro-USD -> 840 units), once", async () => {
    await useFreeAllowance();
    await grantCredits({ salonId: actor.salonId, units: 10_000, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    await chargeRecording(actor, { recordingKey: "rec-1", microUsd: 1500 });
    await chargeRecording(actor, { recordingKey: "rec-1", microUsd: 1500 });
    expect(paidBalance()).toBe(10_000 - 840);
  });
  it("with no credit and the allowance used up, a new message is refused; a new month's allowance lets it through", async () => {
    await useFreeAllowance();
    await expect(assertCanStartRequest(actor)).rejects.toThrow("SECRETARY_CREDITS_EMPTY");
    await expect(assertCanStartRequest(actor, process.env, new Date(Date.now() + 40 * 86_400_000))).resolves.toBeUndefined();
  });
  it("an exchange rate outside 1 to 20 refuses every request instead of charging nothing", async () => {
    process.env.SALON_SECRETARY_USD_BRL = "0.5";
    await expect(assertCanStartRequest(actor)).rejects.toThrow("CREDIT_FX_INVALID");
  });
  it("a salon that never bought sees its allowance; after the allowance, only a percentage and a status ever reach the screen", async () => {
    expect(await secretaryCreditView(actor)).toEqual({ percent: 100, status: "OK" });
    await useFreeAllowance();
    expect(await secretaryCreditView(actor)).toEqual({ percent: 0, status: "EMPTY" });
  });
  it("with the flag off nothing is checked or charged", async () => {
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "false";
    modelCall("conv-1", 1000, 100);
    await expect(assertCanStartRequest(actor)).resolves.toBeUndefined();
    expect(await sweep()).toBe(0);
    expect(await chargeRecording(actor, { recordingKey: "r", microUsd: 1500 })).toBeNull();
    expect(db.ledger).toHaveLength(0);
  });
});

describe("payments credit the pack, sum with what is left, and never twice", () => {
  it("owner's example: 20% left + a new R$ 15 pack sums both and the bar is back at 100%", async () => {
    await useFreeAllowance();
    const first = await buy("P15");
    await applyCreditPayment(first as never, payment(first));
    await chargeRecording(actor, { recordingKey: "heavy", microUsd: microFor(120_000) });
    expect(await secretaryCreditView(actor)).toEqual({ percent: 20, status: "OK" });
    const second = await buy("P15");
    await applyCreditPayment(second as never, payment(second, { id: "pay-2" }));
    expect(paidBalance()).toBe(30_000 + 150_000);
    expect(await secretaryCreditView(actor)).toEqual({ percent: 100, status: "OK" });
  });
  it("the same webhook twice credits once; pending Pix credits nothing until approved", async () => {
    const purchase = await buy("P40");
    await applyCreditPayment(purchase as never, payment(purchase, { status: "pending", date_approved: null }));
    expect(paidBalance()).toBe(0);
    await applyCreditPayment(purchase as never, payment(purchase));
    await applyCreditPayment(purchase as never, payment(purchase));
    expect(paidBalance()).toBe(485_000);
    expect(db.purchases[0]).toMatchObject({ state: "PAID", providerPaymentId: "pay-1" });
  });
  it("refuses a payment of another amount, currency, account, purchase, or a test payment in live mode", () => {
    const purchase = { salonId: "salao-1", id: "11111111-1111-4111-8111-111111111111", amountCents: 1500 } as Row;
    const config = { collectorId: "123", mode: "live" as const };
    const ok = payment(purchase, { live_mode: true });
    expect(() => validateCreditPayment(purchase as never, ok, config)).not.toThrow();
    for (const bad of [{ transaction_amount: 14.99 }, { currency_id: "USD" }, { collector_id: "999" }, { external_reference: "efc:salao-2:11111111-1111-4111-8111-111111111111" }, { live_mode: false }, { transaction_amount_refunded: 15.01 }])
      expect(() => validateCreditPayment(purchase as never, { ...ok, ...bad }, config)).toThrow("PAYMENT_MISMATCH");
  });
  it("a full refund takes the credit back (below zero if used); a partial refund takes its share once; a chargeback takes all", async () => {
    const a = await buy("P15");
    await applyCreditPayment(a as never, payment(a));
    await chargeRecording(actor, { recordingKey: "used", microUsd: 100_000 }); // 56 000 units, part from the allowance
    await applyCreditPayment(a as never, payment(a, { status: "refunded", transaction_amount_refunded: 15 }));
    expect(paidBalance()).toBeLessThan(0);
    expect(db.purchases[0]).toMatchObject({ state: "REFUNDED", refundedCents: 1500 });
    const b = await buy("P25");
    await applyCreditPayment(b as never, payment(b, { id: "pay-2" }));
    const before = paidBalance();
    await applyCreditPayment(b as never, payment(b, { id: "pay-2", transaction_amount_refunded: 5 }));
    await applyCreditPayment(b as never, payment(b, { id: "pay-2", transaction_amount_refunded: 5 }));
    expect(paidBalance()).toBe(before - 55_000);
    const c = await buy("P40");
    await applyCreditPayment(c as never, payment(c, { id: "pay-3" }));
    await applyCreditPayment(c as never, payment(c, { id: "pay-3", status: "charged_back" }));
    expect(paidBalance()).toBe(before - 55_000);
  });
  it("a second payment for the same purchase is not credited and goes to review", async () => {
    const purchase = await buy("P15");
    await applyCreditPayment(purchase as never, payment(purchase));
    await applyCreditPayment(purchase as never, payment(purchase, { id: "pay-2" }));
    expect(paidBalance()).toBe(150_000);
    expect(db.purchases[0]).toMatchObject({ state: "REVIEW", lastError: "DUPLICATE_PAYMENT", providerPaymentId: "pay-1" });
    // Review 07/10: money held without credit always reaches the platform admin, once per entry into review.
    expect(alerts).toEqual([{ salonId: actor.salonId, purchaseId: purchase.id, reason: "DUPLICATE_PAYMENT" }]);
    await applyCreditPayment(purchase as never, payment(purchase, { id: "pay-2" }));
    expect(alerts).toHaveLength(1);
  });
  it("a late payment that does not match never turns a paid purchase into review: its credit stands, the admin is alerted", async () => {
    const purchase = await buy("P15");
    await receiveCreditPayment(payment(purchase));
    expect(await receiveCreditPayment(payment(purchase, { id: "pay-late", transaction_amount: 1 }))).toBeNull();
    expect(db.purchases[0]).toMatchObject({ state: "PAID", lastError: "PAYMENT_MISMATCH", providerPaymentId: "pay-1" });
    expect(paidBalance()).toBe(150_000);
    expect(alerts).toEqual([{ salonId: actor.salonId, purchaseId: purchase.id, reason: "PAYMENT_MISMATCH" }]);
    // The same payment notified again (Mercado Pago repeats notices): no second e-mail.
    await receiveCreditPayment(payment(purchase, { id: "pay-late", transaction_amount: 1 }));
    expect(alerts).toHaveLength(1);
  });
  it("selling turned off still confirms a purchase already paid; a payment of another amount goes to review, acknowledged", async () => {
    const purchase = await buy("P15");
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "false";
    await receiveCreditPayment(payment(purchase));
    process.env.SALON_SECRETARY_CREDITS_ENABLED = "true";
    expect(paidBalance()).toBe(150_000);
    const other = await buy("P25");
    expect(await receiveCreditPayment(payment(other, { id: "pay-x", transaction_amount: 1 }))).toBeNull();
    expect(db.purchases.find(p => p.id === other.id)).toMatchObject({ state: "REVIEW", lastError: "PAYMENT_MISMATCH" });
    expect(paidBalance()).toBe(150_000);
  });
});

describe("reconciliation", () => {
  it("in production every preference carries its own notification address (the credit never waits for the webhook panel)", async () => {
    process.env.NEXTAUTH_URL = "https://everflair.com.br";
    await buy("P15");
    const body = vi.mocked(mp.mpRequest).mock.calls[0][2] as Record<string, unknown>;
    expect(body).toMatchObject({ auto_return: "approved", notification_url: "https://everflair.com.br/api/webhooks/mercadopago?source_news=webhooks" });
  });
  it("a paid purchase is credited the moment the salon looks: re-read like the webhook, at most once every few seconds, never past its window", async () => {
    const purchase = await buy("P15"), now = new Date((purchase.createdAt as Date).getTime() + 60_000);
    vi.mocked(mp.mpRequest).mockReset().mockImplementation(async () => ({ results: [], paging: { total: 0 } }));
    expect(await syncPendingCreditPurchases(actor.salonId, now)).toEqual({ pending: 1, checked: 1 });
    expect(paidBalance()).toBe(0);
    // Asked again a moment later: Mercado Pago is not asked again yet.
    expect(await syncPendingCreditPurchases(actor.salonId, new Date(now.getTime() + 1_000))).toEqual({ pending: 1, checked: 0 });
    expect(vi.mocked(mp.mpRequest)).toHaveBeenCalledTimes(1);
    // Paid in the bank's app: the next look credits it, once, and the purchase is no longer pending.
    vi.mocked(mp.mpRequest).mockImplementation(async () => ({ results: [payment(purchase)], paging: { total: 1 } }));
    const later = new Date(now.getTime() + CREDIT_SYNC_INTERVAL_MS);
    expect(await syncPendingCreditPurchases(actor.salonId, later)).toEqual({ pending: 1, checked: 1 });
    expect(paidBalance()).toBe(150_000);
    expect(db.purchases.find(p => p.id === purchase.id)?.state).toBe("PAID");
    expect(await syncPendingCreditPurchases(actor.salonId, new Date(later.getTime() + CREDIT_SYNC_INTERVAL_MS))).toEqual({ pending: 0, checked: 0 });
    expect(db.ledger.filter(r => r.kind === "PURCHASE")).toHaveLength(1);
    // A purchase long past its checkout window is left to the scheduled job.
    const old = await buy("P25");
    vi.mocked(mp.mpRequest).mockReset();
    expect(await syncPendingCreditPurchases(actor.salonId, new Date((old.expiresAt as Date).getTime() + 2 * 3600_000))).toEqual({ pending: 1, checked: 0 });
    expect(vi.mocked(mp.mpRequest)).not.toHaveBeenCalled();
  });
  it("back from the checkout, the payments found by reference are applied; an unpaid purchase expires after the grace hour", async () => {
    const purchase = await buy("P15");
    vi.mocked(mp.mpRequest).mockImplementation(async () => ({ results: [payment(purchase)], paging: { total: 1 } }));
    await reconcileCreditPurchase(actor.salonId, purchase.id);
    expect(paidBalance()).toBe(150_000);
    const unpaid = await buy("P25");
    vi.mocked(mp.mpRequest).mockImplementation(async () => ({ results: [], paging: { total: 0 } }));
    await reconcileCreditPurchase(actor.salonId, unpaid.id, new Date((unpaid.expiresAt as Date).getTime() + 30 * 60_000));
    expect(db.purchases.find(p => p.id === unpaid.id)?.state).toBe("AWAITING_PAYMENT");
    await reconcileCreditPurchase(actor.salonId, unpaid.id, new Date((unpaid.expiresAt as Date).getTime() + 2 * 3600_000));
    expect(db.purchases.find(p => p.id === unpaid.id)?.state).toBe("EXPIRED");
  });
  it("an approval that arrives after the purchase expired still credits (money is never kept without its credit)", async () => {
    const purchase = await buy("P15");
    db.purchases[0].state = "EXPIRED";
    await applyCreditPayment(purchase as never, payment(purchase));
    expect(paidBalance()).toBe(150_000);
    expect(db.purchases[0].state).toBe("PAID");
  });
  it("every ledger write happens under the salon's credit lock", async () => {
    db.locks = 0;
    await grantCredits({ salonId: actor.salonId, units: 5_000, actorUserId: "hq", reason: "cortesia", grantKey: randomUUID() });
    await chargeRecording(actor, { recordingKey: "m1", microUsd: 1500 });
    expect(db.locks).toBe(2);
  });
});

describe("sweep of a busy salon (validation review 07/10/2026)", () => {
  /** `count` calls in the window, one second apart, the oldest first. */
  const calls = (count: number) => { for (let i = 0; i < count; i++) modelCall(`s${i}`, 1_000, 50, new Date(NOW.getTime() - (count - i) * 1_000)); };
  const charged = () => db.ledger.filter(r => String(r.requestKey).startsWith("call:")).length;
  it("charges the newest calls even when 500 older ones were already charged (the old page bound left them out)", async () => {
    calls(500);
    expect(await sweep()).toBe(500);
    calls(100);
    expect(await sweep()).toBe(100);
    expect(charged()).toBe(600);
    expect(new Set(db.ledger.map(r => r.requestKey)).size).toBe(db.ledger.length);
    expect(await sweep()).toBe(0);
  });
  it("splits a backlog in batches of CHARGE_BATCH and leaves the rest for the next sweep, each call once", async () => {
    const perSweep = CHARGE_BATCH * CHARGE_MAX_ROUNDS;
    calls(perSweep + 30);
    expect(await sweep()).toBe(perSweep);
    expect(await sweep()).toBe(30);
    expect(charged()).toBe(perSweep + 30);
    // The running balance is the sum of what each row took (no row computed from a stale point).
    const units = db.ledger.reduce((sum, r) => sum + (r.units as number), 0);
    expect(paidBalance()).toBe(units);
  });
  it("a call without cost (failed, no tokens) never takes a batch slot from one that has a cost", async () => {
    for (let i = 0; i < CHARGE_BATCH * 2; i++) modelCall(`fail${i}`, null, null, new Date(NOW.getTime() - 10_000_000 + i), "FAILED");
    modelCall("ok", 1_000, 50);
    expect(await sweep()).toBe(1);
  });
});
