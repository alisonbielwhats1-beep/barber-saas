import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { assertSafeDatabaseOperation } from "../../database-safety";
import { accessState } from "../catalog";
vi.mock("server-only", () => ({}));
const pg = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

/** In-memory Stripe: only the calls the app makes, with the shapes of API 2026-08-26.dahlia. Webhook signing is the real SDK's. */
type Obj = Record<string, unknown> & { id: string };
/** The few nested shapes the fake reads back: Checkout line items and a subscription's single item. */
type LineItems = { line_items: Array<{ price_data: { unit_amount: number; recurring: { interval: string; interval_count: number } } }>; subscription_data: { metadata: Record<string, string> }; metadata: Record<string, string> };
type Items = { data: Array<{ price: { unit_amount: number }; current_period_start: number; current_period_end: number }> };
const fake = vi.hoisted(() => ({
  customers: new Map<string, Obj>(), sessions: new Map<string, Obj>(), subscriptions: new Map<string, Obj>(), invoices: new Map<string, Obj>(),
  charges: new Map<string, Obj>(), invoicePayments: [] as Obj[], idempotent: new Map<string, Obj>(), calls: [] as string[], seq: 0,
  /** Unique per run: provider ids are unique in the database, which keeps earlier runs. */
  run: Math.random().toString(36).slice(2, 8),
  /** The next Checkout Session reports another total, so the app refuses to store its link. */
  mismatchNext: false,
  realWebhooks: null as unknown,
}));
vi.mock("stripe", async () => {
  const actual = (await vi.importActual<typeof import("stripe")>("stripe")).default;
  fake.realWebhooks = new actual(["sk", "test", "SyntheticOnly0000"].join("_")).webhooks;
  const id = (prefix: string) => `${prefix}_${fake.run}${++fake.seq}`;
  const once = (key: string | undefined, make: () => Obj) => {
    if (key && fake.idempotent.has(key)) return fake.idempotent.get(key)!;
    const made = make(); if (key) fake.idempotent.set(key, made); return made;
  };
  const missing = () => Object.assign(new Error("No such resource"), { type: "StripeInvalidRequestError" });
  return { default: class {
    webhooks = fake.realWebhooks;
    accounts = { retrieveCurrent: async () => { fake.calls.push("account"); return { id: "acct_1TestOnly", country: "BR", default_currency: "brl" }; } };
    customers = { create: async (params: Obj, options?: { idempotencyKey?: string }) => { fake.calls.push("customer.create");
      return once(options?.idempotencyKey, () => { const c = { ...params, id: id("cus") }; fake.customers.set(c.id, c); return c; }); } };
    checkout = { sessions: {
      create: async (params: Obj & LineItems, options?: { idempotencyKey?: string }) => { fake.calls.push("session.create");
        return once(options?.idempotencyKey, () => { const s: Obj = { id: id("cs_test"), object: "checkout.session", mode: params.mode, customer: params.customer, client_reference_id: params.client_reference_id,
          currency: "brl", amount_total: params.line_items[0].price_data.unit_amount + (fake.mismatchNext ? 1 : 0), livemode: false, status: "open", subscription: null, url: `https://checkout.stripe.com/c/pay/${fake.seq}`, metadata: params.metadata, params };
          fake.mismatchNext = false; fake.sessions.set(s.id, s); return s; }); },
      list: async (params: { customer: string }) => ({ data: [...fake.sessions.values()].filter(s => s.customer === params.customer).reverse() }),
      expire: async (sessionId: string) => { fake.calls.push("session.expire"); const s = fake.sessions.get(sessionId); if (!s) throw missing(); s.status = "expired"; return s; },
    } };
    subscriptions = {
      retrieve: async (subId: string) => { const s = fake.subscriptions.get(subId); if (!s) throw missing(); return structuredClone(s); },
      update: async (subId: string, params: Obj) => { fake.calls.push("subscription.update"); const s = fake.subscriptions.get(subId); if (!s) throw missing(); Object.assign(s, params); return structuredClone(s); },
      cancel: async (subId: string) => { fake.calls.push("subscription.cancel"); const s = fake.subscriptions.get(subId); if (!s) throw missing(); s.status = "canceled"; s.canceled_at = Math.floor(Date.now() / 1000); return structuredClone(s); },
    };
    invoices = { list: async (params: { subscription: string }) => ({ data: [...fake.invoices.values()].filter(i => i.subscription === params.subscription).reverse() }) };
    charges = { retrieve: async (chargeId: string) => { const c = fake.charges.get(chargeId); if (!c) throw missing(); return structuredClone({ ...c, customer: c.expandCustomer ? fake.customers.get(c.customer as string) : c.customer }); } };
    invoicePayments = { list: async (params: { payment: { payment_intent: string }; expand?: string[] }) => ({ data: fake.invoicePayments.filter(p => p.intent === params.payment.payment_intent)
      .map(p => params.expand?.includes("data.invoice") ? { ...p, invoice: fake.invoices.get(p.invoice as string) } : p) }) };
  } };
});

const DAY = 86_400_000;
const at = (date: Date) => Math.floor(date.getTime() / 1000);
const addMonths = (date: Date, months: number) => { const d = new Date(date); d.setUTCMonth(d.getUTCMonth() + months); return d; };

pg("Stripe billing with PostgreSQL and runtime FORCE RLS", () => {
  const admin = new PrismaClient();
  let runtime: PrismaClient;
  let service: typeof import("../service");
  let worker: typeof import("../worker");
  let webhook: typeof import("./webhook");
  let scope: typeof import("../../prisma-tenant");
  let ownerId: string, salonId: string, otherSalon: string, allowedSalons: string;
  const context = () => ({ salonId, userId: ownerId });
  const load = (id: string) => admin.billingSubscription.findUniqueOrThrow({ where: { id } });

  /** The owner pays at the Checkout: Stripe creates the subscription and its first, paid invoice. */
  function pay(sessionId: string, start: Date, cycle: "month" | "year" = "month", amount?: number) {
    const session = fake.sessions.get(sessionId)!;
    const params = session.params as LineItems;
    const subId = `sub_${fake.run}${++fake.seq}`;
    const end = addMonths(start, cycle === "year" ? 12 : 1);
    fake.subscriptions.set(subId, { id: subId, object: "subscription", customer: session.customer, status: "active", cancel_at_period_end: false, canceled_at: null, currency: "brl", livemode: false,
      metadata: params.subscription_data.metadata, items: { data: [{ id: `si_${fake.run}${fake.seq}`, quantity: 1, current_period_start: at(start), current_period_end: at(end),
        price: { currency: "brl", unit_amount: amount ?? params.line_items[0].price_data.unit_amount, recurring: { interval: cycle, interval_count: 1 } } }] } });
    session.status = "complete"; session.subscription = subId;
    invoice(subId, start, end, "paid", "subscription_create");
    return subId;
  }
  function invoice(subId: string, start: Date, end: Date, status: "paid" | "open", reason = "subscription_cycle", attempts = 1) {
    const sub = fake.subscriptions.get(subId)!;
    const amount = (sub.items as Items).data[0].price.unit_amount;
    const inv = { id: `in_${fake.run}${++fake.seq}`, object: "invoice", subscription: subId, customer: sub.customer, status, billing_reason: reason, currency: "brl", amount_due: amount, attempt_count: status === "paid" ? 1 : attempts,
      created: at(start), lines: { data: [{ period: { start: at(start), end: at(end) } }] }, parent: { subscription_details: { subscription: subId, metadata: sub.metadata } },
      status_transitions: { paid_at: status === "paid" ? at(start) + 60 : null, finalized_at: at(start), voided_at: null, marked_uncollectible_at: null } };
    fake.invoices.set(inv.id, inv);
    Object.assign((sub.items as Items).data[0], { current_period_start: at(start), current_period_end: at(end) });
    return inv;
  }
  const signed = (event: object, secret = process.env.STRIPE_WEBHOOK_SECRET!) => {
    const payload = JSON.stringify(event);
    return { payload, signature: (fake.realWebhooks as { generateTestHeaderString: (o: { payload: string; secret: string }) => string }).generateTestHeaderString({ payload, secret }) };
  };

  beforeAll(async () => {
    assertSafeDatabaseOperation(process.env, { operation: "billing-stripe-postgres-integration" });
    for (const [key, value] of Object.entries({ MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_MODE: "test", MERCADOPAGO_COLLECTOR_ID: "123", MERCADOPAGO_ACCESS_TOKEN: "synthetic",
      MERCADOPAGO_WEBHOOK_SECRET: "synthetic", STRIPE_BILLING_ENABLED: "true", STRIPE_MODE: "test", STRIPE_SECRET_KEY: ["sk", "test", "SyntheticOnly0000"].join("_"),
      STRIPE_WEBHOOK_SECRET: "whsec_SyntheticOnly", STRIPE_ACCOUNT_ID: "acct_1TestOnly", APP_ENV: "test", VERCEL_ENV: "", NEXTAUTH_URL: "http://localhost:3000" })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No network: Mercado Pago must never be called for a Stripe contract"); }));
    await admin.$executeRawUnsafe("DO $$ BEGIN CREATE ROLE stripe_test_runtime LOGIN PASSWORD 'stripe-only-test' NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await admin.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO stripe_test_runtime");
    await admin.$executeRawUnsafe('GRANT SELECT ON "User", "Membership", "Professional", "UserInvite" TO stripe_test_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT,UPDATE ON "Salon" TO stripe_test_runtime');
    await admin.$executeRawUnsafe("GRANT EXECUTE ON FUNCTION hq_is_admin() TO stripe_test_runtime");
    for (const name of ["BillingSubscription", "BillingCharge", "BillingInbox", "BillingQueue"]) await admin.$executeRawUnsafe(`GRANT SELECT,INSERT,UPDATE ON "${name}" TO stripe_test_runtime`);
    for (const name of ["BillingEvent", "BillingCustomer"]) await admin.$executeRawUnsafe(`GRANT SELECT,INSERT ON "${name}" TO stripe_test_runtime`);
    if ((await admin.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public."BillingPlanChange"') IS NOT NULL AS present`)[0].present) await admin.$executeRawUnsafe('GRANT SELECT ON "BillingPlanChange" TO stripe_test_runtime');
    await admin.$executeRawUnsafe('ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE "Salon" FORCE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('DROP POLICY IF EXISTS stripe_ci_salon_read ON "Salon"');
    await admin.$executeRawUnsafe('CREATE POLICY stripe_ci_salon_read ON "Salon" FOR SELECT TO stripe_test_runtime USING(true)');
    await admin.$executeRawUnsafe('DROP POLICY IF EXISTS stripe_ci_salon_write ON "Salon"');
    await admin.$executeRawUnsafe('CREATE POLICY stripe_ci_salon_write ON "Salon" FOR UPDATE TO stripe_test_runtime USING(id=current_setting(\'app.current_salon\',true)) WITH CHECK(id=current_setting(\'app.current_salon\',true))');
    const owner = await admin.user.create({ data: { name: "owner", email: `${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
    ownerId = owner.id;
    const salons = await Promise.all(["a", "b"].map(name => admin.salon.create({ data: { name, slug: randomUUID(), accessStatus: "APPROVED" } })));
    [salonId, otherSalon] = salons.map(s => s.id);
    allowedSalons = `everflair-apresentacao, ${salons[0].slug}`;
    vi.stubEnv("STRIPE_ALLOWED_SALONS", allowedSalons);
    await admin.membership.create({ data: { userId: ownerId, salonId, role: "OWNER" } });
    const url = new URL(process.env.DATABASE_URL!); url.username = "stripe_test_runtime"; url.password = "stripe-only-test";
    runtime = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    vi.resetModules();
    vi.doMock("../../prisma", () => ({ prisma: runtime }));
    service = await import("../service"); worker = await import("../worker"); webhook = await import("./webhook"); scope = await import("../../prisma-tenant");
  }, 30000);
  afterAll(async () => { await runtime?.$disconnect(); await admin.$disconnect(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  let first: string;
  it("creates one customer and one Checkout for a contract, however often the owner clicks", async () => {
    const key = randomUUID();
    const contract = await service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, key);
    const again = await service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, key);
    first = contract.id;
    expect(again.id).toBe(contract.id);
    expect(contract).toMatchObject({ provider: "stripe", mode: "test", collectorId: "acct_1TestOnly", amountCents: 7990, providerId: null, paidThrough: null });
    expect(contract.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\//);
    expect(fake.calls.filter(c => c === "session.create")).toHaveLength(1);
    expect(fake.calls.filter(c => c === "customer.create")).toHaveLength(1);
    const session = [...fake.sessions.values()][0];
    expect(session.params).toMatchObject({ mode: "subscription", locale: "pt-BR", payment_method_types: ["card"], client_reference_id: service.referenceFor(contract),
      line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: 7990, recurring: { interval: "month", interval_count: 1 } } }] });
    // The same key with another gateway is another request, never a silent switch.
    await expect(service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 }, key)).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect(await admin.billingCustomer.count({ where: { salonId } })).toBe(1);
  });

  it("keeps the customer invisible to another salon under FORCE RLS", async () => {
    const seen = await scope.withSalon(otherSalon, tx => tx.billingCustomer.findMany());
    expect(seen).toHaveLength(0);
    expect(await scope.withSalon(salonId, tx => tx.billingCustomer.count())).toBe(1);
  });

  it("grants nothing before Stripe confirms the payment, and grants the period once it does", async () => {
    expect(await worker.syncSubscription(salonId, first)).toBe(false);
    expect(accessState(await load(first))).toBe("UNPAID");
    const start = new Date(Date.now() - 40 * DAY);
    const subId = pay([...fake.sessions.keys()][0], start);
    await worker.syncSubscription(salonId, first);
    const paid = await load(first);
    expect(paid).toMatchObject({ providerId: subId, providerStatus: "active", reviewRequired: false });
    expect(paid.paidThrough?.getTime()).toBe(at(addMonths(start, 1)) * 1000);
    expect((await admin.salon.findUniqueOrThrow({ where: { id: salonId } })).plan).toBe("PRO");
    const charges = await admin.billingCharge.findMany({ where: { subscriptionId: first } });
    expect(charges).toMatchObject([{ status: "approved", amountCents: 7990 }]);
    // Replaying the same state changes nothing.
    await worker.syncSubscription(salonId, first);
    expect(await admin.billingCharge.count({ where: { subscriptionId: first } })).toBe(1);
  });

  it("starts the grace period on a failed renewal and clears it when the retry is paid", async () => {
    const sub = await load(first);
    const renewal = invoice(sub.providerId!, sub.paidThrough!, addMonths(sub.paidThrough!, 1), "open");
    await worker.syncSubscription(salonId, first);
    const late = await load(first);
    expect(late.delinquentSince?.getTime()).toBe(sub.paidThrough!.getTime());
    expect(accessState(late)).toBe("RESTRICTED");
    Object.assign(renewal, { status: "paid", status_transitions: { ...renewal.status_transitions, paid_at: at(new Date()) } });
    await worker.syncSubscription(salonId, first);
    const regular = await load(first);
    expect(regular.delinquentSince).toBeNull();
    expect(regular.paidThrough?.getTime()).toBe(at(addMonths(sub.paidThrough!, 1)) * 1000);
    expect(accessState(regular)).toBe("ACTIVE");
  });

  it("stops renewal at the end of the paid period when the owner cancels, keeping access", async () => {
    await service.requestCancellation(context(), first);
    await worker.syncSubscription(salonId, first);
    const sub = await load(first);
    expect(fake.subscriptions.get(sub.providerId!)).toMatchObject({ cancel_at_period_end: true, status: "active" });
    expect(sub.cancelledAt).not.toBeNull();
    expect(sub.nextPaymentAt).toBeNull();
    expect(accessState(sub)).toBe("ACTIVE");
  });

  it("accepts only signed notices and records a refund as a financial review, read back from Stripe", async () => {
    const sub = await load(first);
    const paidInvoice = [...fake.invoices.values()].find(i => i.subscription === sub.providerId && i.status === "paid")!;
    fake.charges.set(`ch_${fake.run}`, { id: `ch_${fake.run}`, customer: (fake.subscriptions.get(sub.providerId!) as Obj).customer, expandCustomer: true, payment_intent: `pi_${fake.run}`, currency: "brl", refunded: true, amount_refunded: 7990, disputed: false });
    fake.invoicePayments.push({ id: "inpay_1", intent: `pi_${fake.run}`, invoice: paidInvoice.id });
    (fake.customers.get((fake.subscriptions.get(sub.providerId!) as Obj).customer as string) as Obj).metadata = { ef_salon: salonId };
    const event = { id: `evt_${fake.run}`, object: "event", type: "charge.refunded", livemode: false, created: at(new Date()), data: { object: { id: `ch_${fake.run}`, object: "charge" } } };
    const forged = signed(event, "whsec_wrong");
    await expect(webhook.receiveStripeEvent(forged.payload, forged.signature)).rejects.toThrow("INVALID_SIGNATURE");
    await expect(webhook.receiveStripeEvent(JSON.stringify(event), null)).rejects.toThrow("INVALID_SIGNATURE");
    const live = signed({ ...event, id: `evt_live_${fake.run}`, livemode: true });
    expect(await webhook.receiveStripeEvent(live.payload, live.signature)).toBeNull();
    const good = signed(event);
    expect(await webhook.receiveStripeEvent(good.payload, good.signature)).toEqual({ salonId, subscriptionId: first });
    expect(await webhook.receiveStripeEvent(good.payload, good.signature)).toEqual({ salonId, subscriptionId: first });
    expect(await admin.billingInbox.count({ where: { subscriptionId: first } })).toBe(1);
    await worker.syncSubscription(salonId, first);
    const charge = await admin.billingCharge.findUniqueOrThrow({ where: { providerInvoiceId: paidInvoice.id } });
    expect(charge).toMatchObject({ status: "refunded", refundedCents: 7990, providerPaymentId: `ch_${fake.run}` });
    expect((await load(first)).reviewRequired).toBe(true);
    // Paid access and history are kept for the person reviewing it.
    expect(accessState(await load(first))).toBe("ACTIVE");
  });

  it("ignores notices for other systems' objects without failing Stripe's delivery", async () => {
    const foreign = signed({ id: "evt_other", object: "event", type: "customer.subscription.updated", livemode: false, created: at(new Date()), data: { object: { id: "sub_other", object: "subscription", metadata: { ef_reference: "not-ours" } } } });
    expect(await webhook.receiveStripeEvent(foreign.payload, foreign.signature)).toBeNull();
  });

  it("closes an unpaid attempt without charging when its Checkout expires or the owner gives up", async () => {
    await admin.billingSubscription.update({ where: { id: first }, data: { current: false } });
    const expiring = await service.contract(context(), { plan: "INDIVIDUAL", cycle: "ANNUAL", extraAgendas: 0, provider: "stripe" }, randomUUID());
    const session = [...fake.sessions.values()].find(s => s.client_reference_id === service.referenceFor(expiring))!;
    expect((session.params as LineItems).line_items[0].price_data.recurring).toEqual({ interval: "year", interval_count: 1 });
    session.status = "expired";
    await worker.syncSubscription(salonId, expiring.id);
    expect(await load(expiring.id)).toMatchObject({ providerStatus: "expired", providerId: null, paidThrough: null });
    expect((await load(expiring.id)).cancelledAt).not.toBeNull();
    const abandoned = await service.contract(context(), { plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, randomUUID());
    await service.requestCancellation(context(), abandoned.id);
    await worker.syncSubscription(salonId, abandoned.id);
    expect(fake.sessions.get([...fake.sessions.values()].find(s => s.client_reference_id === service.referenceFor(abandoned))!.id)?.status).toBe("expired");
    expect(await load(abandoned.id)).toMatchObject({ providerStatus: "cancelled", paidThrough: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("puts a contract in review when Stripe bills other terms than the stored ones", async () => {
    const changed = await service.contract(context(), { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, randomUUID());
    const session = [...fake.sessions.values()].find(s => s.client_reference_id === service.referenceFor(changed))!;
    pay(session.id, new Date(), "month", 100);
    await worker.syncSubscription(salonId, changed.id);
    expect((await load(changed.id)).reviewRequired).toBe(true);
    // The lower amount never grants a period: the paid invoice does not match the contract.
    expect((await load(changed.id)).paidThrough).toBeNull();
  });

  /** A new contract needs no current one in the way (the earlier tests leave one in review). */
  const startFresh = () => admin.billingSubscription.updateMany({ where: { salonId }, data: { current: false } });
  const sessionOf = (contractId: string) => [...fake.sessions.values()].find(s => s.client_reference_id === `ef:${salonId}:${contractId}`)!;

  it("closes or activates an attempt whose link was never stored (lost answer or mismatch)", async () => {
    await startFresh();
    fake.mismatchNext = true;
    const key = randomUUID();
    await expect(service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, key)).rejects.toThrow("CHECKOUT_MISMATCH");
    const stuck = await admin.billingSubscription.findFirstOrThrow({ where: { salonId, requestKey: key } });
    expect(stuck).toMatchObject({ checkoutUrl: null, providerId: null });
    expect(stuck.creationStartedAt).not.toBeNull();
    // The owner gives up: the open session is expired and the attempt closed, without a charge.
    await service.requestCancellation(context(), stuck.id);
    await worker.syncSubscription(salonId, stuck.id);
    expect(sessionOf(stuck.id).status).toBe("expired");
    expect(await load(stuck.id)).toMatchObject({ providerStatus: "cancelled", paidThrough: null });
    // Same situation, but the session was paid before its link was stored: the payment is found and honoured.
    await startFresh();
    fake.mismatchNext = true;
    const paidKey = randomUUID();
    await expect(service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, paidKey)).rejects.toThrow("CHECKOUT_MISMATCH");
    const paidStuck = await admin.billingSubscription.findFirstOrThrow({ where: { salonId, requestKey: paidKey } });
    pay(sessionOf(paidStuck.id).id, new Date());
    await worker.syncSubscription(salonId, paidStuck.id);
    expect(accessState(await load(paidStuck.id))).toBe("ACTIVE");
  });

  it("cancels a past-due subscription at once, so no retry charges an owner who cancelled", async () => {
    await startFresh();
    const late = await service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, randomUUID());
    const start = new Date(Date.now() - 40 * DAY);
    const subId = pay(sessionOf(late.id).id, start);
    invoice(subId, addMonths(start, 1), addMonths(start, 2), "open");
    fake.subscriptions.get(subId)!.status = "past_due";
    await worker.syncSubscription(salonId, late.id);
    expect(accessState(await load(late.id))).toBe("RESTRICTED");
    const before = fake.calls.length;
    await service.requestCancellation(context(), late.id);
    await worker.syncSubscription(salonId, late.id);
    expect(fake.calls.slice(before)).toContain("subscription.cancel");
    expect(fake.calls.slice(before)).not.toContain("subscription.update");
    expect(fake.subscriptions.get(subId)).toMatchObject({ status: "canceled" });
    const ended = await load(late.id);
    expect(ended.cancelledAt).not.toBeNull();
    expect(accessState(ended)).toBe("EXPIRED");
  });

  it("records a refund on the contract whose invoice it paid, not on the salon's current one", async () => {
    await startFresh();
    const older = await service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, randomUUID());
    const olderSub = pay(sessionOf(older.id).id, new Date(Date.now() - 20 * DAY));
    await worker.syncSubscription(salonId, older.id);
    await admin.billingSubscription.update({ where: { id: older.id }, data: { current: false, cancelledAt: new Date() } });
    const newer = await service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, randomUUID());
    pay(sessionOf(newer.id).id, new Date());
    await worker.syncSubscription(salonId, newer.id);
    const olderInvoice = [...fake.invoices.values()].find(i => i.subscription === olderSub && i.status === "paid")!;
    const chargeId = `ch_old_${fake.run}`;
    fake.charges.set(chargeId, { id: chargeId, customer: (fake.subscriptions.get(olderSub) as Obj).customer, payment_intent: `pi_old_${fake.run}`, currency: "brl", refunded: true, amount_refunded: 7990, disputed: false });
    fake.invoicePayments.push({ id: `inpay_old_${fake.run}`, intent: `pi_old_${fake.run}`, invoice: olderInvoice.id });
    const notice = signed({ id: `evt_old_${fake.run}`, object: "event", type: "charge.refunded", livemode: false, created: at(new Date()), data: { object: { id: chargeId, object: "charge" } } });
    expect(await webhook.receiveStripeEvent(notice.payload, notice.signature)).toEqual({ salonId, subscriptionId: older.id });
    await worker.syncSubscription(salonId, older.id);
    expect(await admin.billingCharge.findUniqueOrThrow({ where: { providerInvoiceId: olderInvoice.id } })).toMatchObject({ status: "refunded", refundedCents: 7990 });
    expect((await load(older.id)).reviewRequired).toBe(true);
    expect((await load(newer.id)).reviewRequired).toBe(false);
  });

  it("routes signed checkout and invoice notices to their contract", async () => {
    const current = await admin.billingSubscription.findFirstOrThrow({ where: { salonId, current: true } });
    const session = sessionOf(current.id);
    const paidInvoice = [...fake.invoices.values()].find(i => i.subscription === current.providerId)!;
    for (const [type, object] of [["checkout.session.completed", session], ["invoice.paid", paidInvoice]] as const) {
      const notice = signed({ id: `evt_${type}_${fake.run}`, object: "event", type, livemode: false, created: at(new Date()), data: { object } });
      expect(await webhook.receiveStripeEvent(notice.payload, notice.signature)).toEqual({ salonId, subscriptionId: current.id });
    }
  });

  it("keeps honouring an owner's cancellation after the Stripe offer is turned off", async () => {
    const current = await admin.billingSubscription.findFirstOrThrow({ where: { salonId, current: true } });
    vi.stubEnv("STRIPE_BILLING_ENABLED", "false");
    try {
      await service.requestCancellation(context(), current.id);
      await worker.syncSubscription(salonId, current.id);
      expect(fake.subscriptions.get(current.providerId!)).toMatchObject({ cancel_at_period_end: true });
      expect((await load(current.id)).cancelledAt).not.toBeNull();
      // New contracts, on the other hand, are refused while the offer is off.
      await startFresh();
      await expect(service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, randomUUID())).rejects.toThrow("STRIPE_DISABLED");
    } finally { vi.stubEnv("STRIPE_BILLING_ENABLED", "true"); }
  });

  it("starts Stripe contracts only for the allowed salons, checked again on the server", async () => {
    await startFresh();
    const before = await admin.billingSubscription.count({ where: { salonId } });
    try {
      for (const list of ["everflair-apresentacao", ""]) {
        vi.stubEnv("STRIPE_ALLOWED_SALONS", list);
        await expect(service.contract(context(), { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, randomUUID())).rejects.toThrow("STRIPE_DISABLED");
      }
      expect(await admin.billingSubscription.count({ where: { salonId } })).toBe(before);
    } finally { vi.stubEnv("STRIPE_ALLOWED_SALONS", allowedSalons); }
  });
});
