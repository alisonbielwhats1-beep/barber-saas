import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { assertSafeDatabaseOperation } from "../database-safety";
import { dateKeyInTimeZone } from '../time';
import { effectiveEntitlement } from "./entitlements";
import { accessState, periodEnd, quoteContract } from "./catalog";
import { canPromoteBillingWaitlist } from "./entitlements";
vi.mock("server-only", () => ({}));
const pg = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

pg("automatic billing with PostgreSQL and runtime FORCE RLS", () => {
  const admin = new PrismaClient();
  let runtime: PrismaClient;
  let service: typeof import("./service");
  let worker: typeof import("./worker");
  let scope: typeof import("../prisma-tenant");
  let project: typeof import("./hq-sync").syncBillingToHq;
  let ownerId: string, otherId: string;
  let salonId: string, otherSalon: string;
  const now = new Date();
  const remotes = new Map<string, Record<string, unknown>>();
  const invoices = new Map<string, Record<string, unknown>>();
  const payments = new Map<string, Record<string, unknown>>();
  const preferences = new Map<string, Record<string, unknown>>();
  let preferencePosts = 0;
  let losePreferenceResponse = false;
  let loseUpdateResponse = false;
  const invoiceId = randomUUID(), paymentId = randomUUID();
  let postCount = 0;
  let loseCreateResponse = false;
  let refuseCancellation = false;
  const context = () => ({ salonId, userId: ownerId });
  const post = (key = randomUUID(), input: unknown = { plan: "TEAM_PLUS", cycle: "MONTHLY" }) => service.contract(context(), input, key);
  const remoteFor = (id: string) => remotes.get(id)!;

  beforeAll(async () => {
    assertSafeDatabaseOperation(process.env, { operation: "billing-postgres-integration" });
    for (const [key, value] of Object.entries({ MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_MODE: "test", MERCADOPAGO_COLLECTOR_ID: "123", MERCADOPAGO_ACCESS_TOKEN: "synthetic", MERCADOPAGO_WEBHOOK_SECRET: "synthetic", NEXTAUTH_URL: "http://localhost:3000" })) vi.stubEnv(key, value);
    await admin.$executeRawUnsafe("DO $$ BEGIN CREATE ROLE billing_test_runtime LOGIN PASSWORD 'billing-only-test' NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO billing_test_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT ON "User", "Membership", "Professional", "UserInvite" TO billing_test_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT,UPDATE ON "Salon" TO billing_test_runtime');
    await admin.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION hq_is_admin() TO billing_test_runtime');
    for (const name of ["BillingSubscription", "BillingCharge", "BillingInbox", "BillingQueue"]) await admin.$executeRawUnsafe(`GRANT SELECT,INSERT,UPDATE ON "${name}" TO billing_test_runtime`);
    if ((await admin.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public."BillingPlanChange"') IS NOT NULL AS present`)[0].present) await admin.$executeRawUnsafe('GRANT SELECT,INSERT,UPDATE ON "BillingPlanChange" TO billing_test_runtime');
    await admin.$executeRawUnsafe('GRANT SELECT,INSERT ON "BillingEvent" TO billing_test_runtime');
    for (const table of ["hq_accounts", "hq_customers", "hq_subscriptions", "hq_payments"]) await admin.$executeRawUnsafe(`GRANT SELECT,INSERT,UPDATE ON ${table} TO billing_test_runtime`);
    await admin.$executeRawUnsafe("GRANT SELECT,INSERT ON hq_activities TO billing_test_runtime");
    await admin.$executeRawUnsafe('ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE "Salon" FORCE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('DROP POLICY IF EXISTS billing_ci_salon_read ON "Salon"');
    await admin.$executeRawUnsafe('CREATE POLICY billing_ci_salon_read ON "Salon" FOR SELECT TO billing_test_runtime USING(true)');
    await admin.$executeRawUnsafe('DROP POLICY IF EXISTS billing_ci_salon_write ON "Salon"');
    await admin.$executeRawUnsafe('CREATE POLICY billing_ci_salon_write ON "Salon" FOR UPDATE TO billing_test_runtime USING(id=current_setting(\'app.current_salon\',true)) WITH CHECK(id=current_setting(\'app.current_salon\',true))');
    const users = await Promise.all(["owner", "other"].map(name => admin.user.create({ data: { name, email: `${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } })));
    [ownerId, otherId] = users.map(u => u.id);
    const salons = await Promise.all(["a", "b"].map(name => admin.salon.create({ data: { name, slug: randomUUID(), accessStatus: "APPROVED" } })));
    [salonId, otherSalon] = salons.map(s => s.id);
    await admin.membership.create({ data: { userId: ownerId, salonId, role: "OWNER" } });
    await admin.membership.create({ data: { userId: otherId, salonId, role: "MANAGER" } });
    const url = new URL(process.env.DATABASE_URL!); url.username = "billing_test_runtime"; url.password = "billing-only-test";
    runtime = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    vi.resetModules();
    vi.doMock("../prisma", () => ({ prisma: runtime }));
    service = await import("./service"); worker = await import("./worker"); scope = await import("../prisma-tenant");
    project = (await import("./hq-sync")).syncBillingToHq;
    vi.stubEnv("MERCADOPAGO_HQ_SYNC_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input); const path = url.pathname;
      let body: unknown;
      if (path === "/users/me") body = { id: 123, site_id: "MLB", tags: ["test_user"] };
      else if (path === "/checkout/preferences" && init?.method === "POST") {
        preferencePosts++;
        const data = JSON.parse(String(init.body)); const id = randomUUID();
        body = { ...data, id, collector_id: 123, init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=${id}` };
        preferences.set(id, body as Record<string, unknown>);
        if (losePreferenceResponse) throw new Error("Lost checkout response");
      } else if (path === "/checkout/preferences/search") {
        const elements = [...preferences.values()].filter(p => p.external_reference === url.searchParams.get("external_reference")); body = { elements, total: elements.length };
      } else if (path.startsWith("/checkout/preferences/")) {
        body = preferences.get(path.split("/").at(-1)!);
        if (init?.method === "PUT") Object.assign(body as object, JSON.parse(String(init.body)));
      } else if (path === "/v1/payments/search") {
        const results = [...payments.values()].filter(p => p.external_reference === url.searchParams.get("external_reference")); body = { results, paging: { total: results.length } };
      }
      else if (path === "/preapproval" && init?.method === "POST") {
        postCount++;
        const data = JSON.parse(String(init.body));
        const id = randomUUID();
        // Controlled-date scenarios must not inherit a newer wall-clock snapshot.
        const createdAt = vi.getMockedSystemTime() ?? now;
        body = { ...data, id, collector_id: 123, payer_id: 456, last_modified: createdAt.toISOString(), init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${id}` };
        remotes.set(id, body as Record<string, unknown>);
        if (loseCreateResponse) throw new Error("Simulated lost POST response");
      } else if (path === "/preapproval/search") body = { results: [...remotes.values()].filter(s => s.external_reference === url.searchParams.get("external_reference")) };
      else if (path.startsWith("/preapproval/")) {
        body = remotes.get(path.split("/").at(-1)!);
        if (init?.method === "PUT") {
          if (refuseCancellation) return new Response("{}", { status: 503 });
          const update = JSON.parse(String(init.body));
          if (update.auto_recurring) update.auto_recurring = { ...(body as Record<string, unknown>).auto_recurring as object, ...update.auto_recurring };
          Object.assign(body as object, update, { last_modified: new Date().toISOString() });
          if (loseUpdateResponse) throw new Error("Lost update response");
        }
      } else if (path === "/authorized_payments/search") body = { results: [...invoices.values()].filter(i => i.preapproval_id === url.searchParams.get("preapproval_id")).slice(Number(url.searchParams.get("offset") ?? 0)), paging: { total: [...invoices.values()].filter(i => i.preapproval_id === url.searchParams.get("preapproval_id")).length } };
      else if (path.startsWith("/authorized_payments/")) body = invoices.get(path.split("/").at(-1)!);
      else if (path.startsWith("/v1/payments/")) body = payments.get(path.split("/").at(-1)!);
      if (!body) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }));
  }, 30000);
  afterAll(async () => { await runtime?.$disconnect(); await admin.$disconnect(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock("../prisma"); });

  let subscriptionId: string, providerId: string;
  const idempotencyKey = randomUUID();
  it("requires OWNER and preserves legacy access before payment", async () => {
    await expect(service.contract({ salonId, userId: otherId }, { plan: "TEAM", cycle: "MONTHLY" }, randomUUID())).rejects.toThrow("OWNER_REQUIRED");
    const sub = await post(idempotencyKey); subscriptionId = sub.id; providerId = sub.providerId!;
    expect(postCount).toBe(1); expect(sub.paidThrough).toBeNull();
    const entitlement = await scope.withSalon(salonId, tx => effectiveEntitlement(tx, salonId, "FREE"));
    expect(entitlement.monthlyAppointments).toBe(30);
    expect((await admin.salon.findUniqueOrThrow({ where: { id: salonId } })).plan).toBe("FREE");
  });
  it("serializes concurrent clicks, reuses identical intents and rejects changed prices/plans", async () => {
    const result = await Promise.all([post(idempotencyKey), post(idempotencyKey)]);
    expect(result.map(s => s.id)).toEqual([subscriptionId, subscriptionId]); expect(postCount).toBe(1);
    await expect(post(idempotencyKey, { plan: "TEAM", cycle: "MONTHLY" })).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await expect(post()).rejects.toThrow("SUBSCRIPTION_EXISTS");
  });
  it("denies cross-tenant reads, writes and ordinary tenant billing mutation under real RLS", async () => {
    const [role] = await runtime.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(await scope.withSalon(otherSalon, tx => tx.billingSubscription.findMany())).toHaveLength(0);
    expect(await scope.withSalon(salonId, tx => tx.billingSubscription.updateMany({ where: { id: subscriptionId }, data: { amountCents: 1 } }))).toEqual({ count: 0 });
    await expect(service.requestCancellation({ salonId: otherSalon, userId: ownerId }, subscriptionId)).rejects.toThrow("OWNER_REQUIRED");
    await expect(scope.withSalon(otherSalon, async tx => { await service.subscriptionLock(tx, otherSalon); return tx.billingCharge.create({ data: { subscriptionId, salonId: otherSalon, providerInvoiceId: "foreign", amountCents: 9990, periodStart: now, periodEnd: periodEnd(now, 1), status: "approved", providerUpdatedAt: now } }); })).rejects.toThrow();
  });
  it("authorization alone does not grant access", async () => {
    Object.assign(remoteFor(providerId), { status: "authorized", last_modified: new Date(now.getTime() + 100).toISOString() });
    await worker.syncSubscription(salonId, subscriptionId);
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionId } })).paidThrough).toBeNull();
    expect(await project(salonId, subscriptionId)).toBe(false);
    expect(await admin.hqAccounts.count({ where: { billingSalonId: salonId } })).toBe(0);
  });
  it("approved payment grants five agendas once, despite concurrent/replayed webhooks", async () => {
    invoices.set(invoiceId, { id: invoiceId, preapproval_id: providerId, debit_date: now.toISOString(), currency_id: "BRL", transaction_amount: 99.9, last_modified: now.toISOString(), payment: { id: paymentId, status: "approved" } });
    payments.set(paymentId, { id: paymentId, collector_id: "123", currency_id: "BRL", transaction_amount: 99.9, status: "approved", date_last_updated: now.toISOString(), date_approved: now.toISOString(), live_mode: false, payer: { id: "456" }, external_reference: `ef:${salonId}:${subscriptionId}` });
    await Promise.all([worker.receiveWebhook("subscription_authorized_payment", invoiceId, "first"), worker.receiveWebhook("subscription_authorized_payment", invoiceId, "first")]);
    await Promise.all([worker.syncSubscription(salonId, subscriptionId), worker.syncSubscription(salonId, subscriptionId)]);
    const sub = await admin.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(sub.paidThrough).toEqual(periodEnd(now, 1));
    expect(await admin.billingCharge.count({ where: { subscriptionId } })).toBe(1);
    expect(await admin.billingEvent.count({ where: { subscriptionId, type: "PAYMENT_UPDATED" } })).toBe(1);
    expect(await scope.withSalon(salonId, tx => effectiveEntitlement(tx, salonId, "PRO"))).toMatchObject({ maxProfessionals: 5, monthlyAppointments: null });
  });
  it("rejects wrong amount, currency, seller or payer without granting a period", async () => {
    const sub = await admin.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const mp = await import("./provider");
    const remote = mp.subscriptionSchema.parse(remoteFor(providerId));
    const invoice = mp.invoiceSchema.parse(invoices.get(invoiceId));
    const payment = mp.paymentSchema.parse(payments.get(paymentId));
    for (const change of [{ transaction_amount: 1 }, { currency_id: "USD" }, { collector_id: "999" }, { payer: { id: "other" } }]) {
      await expect(service.applyInvoice(sub, remote, invoice, { ...payment, ...change })).rejects.toThrow("PAYMENT_MISMATCH");
    }
  });
  it("projects a paid customer, subscription and receipt once across concurrent replays", async () => {
    await Promise.all([project(salonId, subscriptionId), project(salonId, subscriptionId)]);
    const account = await admin.hqAccounts.findUniqueOrThrow({ where: { billingSalonId: salonId } });
    expect(account.business).toBe("a");
    const hqSub = await admin.hqSubscriptions.findUniqueOrThrow({ where: { billingSubscriptionId: subscriptionId } });
    expect(hqSub).toMatchObject({ plan: "Equipe · 5 agendas", amountCents: 9990, interval: "Mensal", billingAgendaLimit: 5, billingPaidThrough: periodEnd(now, 1) });
    expect(await admin.hqPayments.findMany({ where: { subscriptionId: hqSub.id } })).toMatchObject([{ status: "Pago", amountCents: 9990 }]);
    const events = await admin.hqActivities.count({ where: { accountId: account.id } });
    await admin.hqAccounts.update({ where: { id: account.id }, data: { notes: "Contato comercial preservado" } });
    await project(salonId, subscriptionId);
    expect(await admin.hqActivities.count({ where: { accountId: account.id } })).toBe(events);
    expect((await admin.hqAccounts.findUniqueOrThrow({ where: { id: account.id } })).notes).toBe("Contato comercial preservado");
  });
  it("keeps HQ invisible to ordinary tenants and rejects foreign source links under RLS", async () => {
    expect(await scope.withSalon(salonId, tx => tx.hqAccounts.findMany())).toHaveLength(0);
    await expect(scope.withSalon(otherSalon, async tx => {
      await tx.$executeRaw`SELECT set_config('app.billing_hq_sync','enabled',true)`;
      return tx.hqAccounts.create({ data: { billingSalonId: salonId, name: "foreign", business: "foreign" } });
    })).rejects.toThrow();
    expect(await scope.withSalon(otherSalon, async tx => {
      await tx.$executeRaw`SELECT set_config('app.billing_hq_sync','enabled',true)`;
      return tx.hqPayments.findMany();
    })).toHaveLength(0);
  });
  it("refuses manual confirmation of a Mercado Pago receipt in HQ", async () => {
    const payment = await admin.hqPayments.findFirstOrThrow({ where: { billingCharge: { subscriptionId } } });
    const { execute } = await import("../hq/services");
    // HQ validates the business date in São Paulo. UTC may already be tomorrow.
    await expect(admin.$transaction(tx => execute(tx, ownerId, { type: "pay", id: payment.id, paidDate: dateKeyInTimeZone(now, 'America/Sao_Paulo'), method: "manual" }))).rejects.toThrow("Mercado Pago");
  });
  it("allows customer follow-up edits with omitted financial fields and ignores forged financial values", async () => {
    const account = await admin.hqAccounts.findUniqueOrThrow({ where: { billingSalonId: salonId } });
    const customer = await admin.hqCustomers.findUniqueOrThrow({ where: { accountId: account.id } });
    const { execute } = await import("../hq/services");
    for (const financial of [{}, { status: "Cancelado", startedAt: "2099-01-01", paymentMethod: "manual" }]) {
      await admin.$transaction(tx => execute(tx, ownerId, { type: "save", entity: "customers", id: customer.id, values: { accountId: account.id, satisfaction: "Satisfeito", ...financial } }));
      expect(await admin.hqCustomers.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({ satisfaction: "Satisfeito", status: customer.status, startedAt: customer.startedAt, paymentMethod: "Mercado Pago" });
    }
  });
  it("accepts live_mode test payments only after verifying a test seller, and rejects sandbox payments in live mode", async () => {
    const sub = await admin.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const mp = await import("./provider");
    const remote = mp.subscriptionSchema.parse(remoteFor(providerId));
    const invoice = mp.invoiceSchema.parse(invoices.get(invoiceId));
    const payment = mp.paymentSchema.parse(payments.get(paymentId));
    await expect(service.applyInvoice(sub, remote, invoice, { ...payment, live_mode: true })).resolves.toBeUndefined();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 123, site_id: "MLB", tags: [] }))));
    await expect(service.applyInvoice(sub, remote, invoice, { ...payment, live_mode: true })).rejects.toThrow("SELLER_ACCOUNT_MISMATCH");
    vi.stubGlobal("fetch", originalFetch);
    vi.stubEnv("APP_ENV", "production"); vi.stubEnv("MERCADOPAGO_MODE", "live"); vi.stubEnv("NEXTAUTH_URL", "https://billing.example.test");
    try { await expect(service.applyInvoice({ ...sub, mode: "live" }, remote, invoice, payment)).rejects.toThrow("PAYMENT_MISMATCH"); }
    finally { vi.stubEnv("APP_ENV", "test"); vi.stubEnv("MERCADOPAGO_MODE", "test"); vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000"); }
  });
  it("records refunds for review without deleting history or reactivating suspended salons", async () => {
    await admin.salon.update({ where: { id: salonId }, data: { accessStatus: "SUSPENDED" } });
    Object.assign(payments.get(paymentId)!, { status: "approved", transaction_amount_refunded: 20, date_last_updated: new Date(now.getTime() + 400).toISOString() });
    await worker.syncSubscription(salonId, subscriptionId);
    await project(salonId, subscriptionId);
    const partial = await admin.hqPayments.findFirstOrThrow({ where: { billingCharge: { subscriptionId } } });
    expect(partial).toMatchObject({ status: "Pago", amountCents: 9990, billingRefundedCents: 2000 });
    expect(partial.amountCents - partial.billingRefundedCents!).toBe(7990);
    Object.assign(payments.get(paymentId)!, { status: "refunded", transaction_amount_refunded: 99.9, date_last_updated: new Date(now.getTime() + 500).toISOString() });
    await worker.syncSubscription(salonId, subscriptionId);
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionId } })).reviewRequired).toBe(true);
    expect((await admin.salon.findUniqueOrThrow({ where: { id: salonId } })).accessStatus).toBe("SUSPENDED");
    expect(await admin.billingEvent.count({ where: { subscriptionId, type: "PAYMENT_UPDATED" } })).toBe(3);
    await project(salonId, subscriptionId);
    expect(await admin.hqPayments.findUniqueOrThrow({ where: { id: partial.id } })).toMatchObject({ status: "Cancelado", amountCents: 9990, billingRefundedCents: 9990 });
  });
  it("persists cancellation intent when the provider fails and confirms it on retry", async () => {
    refuseCancellation = true;
    expect(await service.requestCancellation(context(), subscriptionId)).toMatchObject({ status: "CANCELLATION_PENDING" });
    await expect(worker.syncSubscription(salonId, subscriptionId)).rejects.toThrow("PROVIDER_UNAVAILABLE");
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionId } })).cancelledAt).toBeNull();
    refuseCancellation = false;
    await worker.syncSubscription(salonId, subscriptionId);
    const sub = await admin.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(sub.cancelledAt).not.toBeNull(); expect(sub.paidThrough).toEqual(periodEnd(now, 1));
    await project(salonId, subscriptionId);
    expect(await admin.hqSubscriptions.findUniqueOrThrow({ where: { billingSubscriptionId: sub.id } })).toMatchObject({ status: "Cancelado", billingPaidThrough: sub.paidThrough });
    expect(await scope.withSalon(salonId, tx => effectiveEntitlement(tx, salonId, "PRO", now))).toMatchObject({ maxProfessionals: 5 });
    await expect(scope.withSalon(salonId, tx => effectiveEntitlement(tx, salonId, "PRO", periodEnd(now, 1)))).rejects.toThrow("Regularize");
  });
  it("recovers a lost creation response without another POST", async () => {
    const salon = await admin.salon.create({ data: { name: "uncertain", slug: randomUUID(), accessStatus: "APPROVED" } });
    await admin.membership.create({ data: { salonId: salon.id, userId: ownerId, role: "OWNER" } });
    const key = randomUUID(); loseCreateResponse = true;
    await expect(service.contract({ salonId: salon.id, userId: ownerId }, { plan: "INDIVIDUAL", cycle: "ANNUAL" }, key)).rejects.toThrow("PROVIDER_UNAVAILABLE");
    loseCreateResponse = false;
    const before = postCount;
    const sub = await service.contract({ salonId: salon.id, userId: ownerId }, { plan: "INDIVIDUAL", cycle: "ANNUAL" }, key);
    expect(sub.providerId).not.toBeNull(); expect(postCount).toBe(before); expect(sub.amountCents).toBe(59900);
    expect(quoteContract({ plan: "INDIVIDUAL", cycle: "ANNUAL" }).intervalMonths).toBe(12);
  });
  it("claims dispatch leases under FORCE RLS and retries safely", async () => {
    // Target this run's synthetic fixture even when the local database is reused.
    await admin.billingQueue.updateMany({ data: { nextAttemptAt: new Date(Date.now() + 3600000) } });
    await admin.billingQueue.update({ where: { subscriptionId }, data: { nextAttemptAt: new Date(0), leaseUntil: null } });
    const result = await worker.runBillingWorker(1);
    expect(result.failed).toBe(0); expect(result.processed).toBe(1);
    await expect(runtime.billingEvent.updateMany({ data: { detail: "tampered" } })).rejects.toThrow();
  });
  it("renews a monthly period once and restores access after a verified failed renewal", async () => {
    const salon = await admin.salon.create({ data: { name: "renewal", slug: randomUUID(), accessStatus: "APPROVED" } });
    await admin.membership.create({ data: { salonId: salon.id, userId: ownerId, role: "OWNER" } });
    const sub = await service.contract({ salonId: salon.id, userId: ownerId }, { plan: "TEAM", cycle: "MONTHLY" }, randomUUID());
    const mp = await import("./provider");
    const remote = mp.subscriptionSchema.parse(remoteFor(sub.providerId!));
    const due = new Date(now.getTime() - 7 * 86400000);
    const start = periodEnd(due, -1);
    const firstEnd = periodEnd(start, 1);
    const invoice = { id: randomUUID(), preapproval_id: remote.id, debit_date: start.toISOString(), currency_id: "BRL", transaction_amount: 79.9, last_modified: start.toISOString(), payment: { id: randomUUID() } };
    const payment = { id: invoice.payment.id, collector_id: "123", currency_id: "BRL", transaction_amount: 79.9, status: "approved", date_last_updated: start.toISOString(), date_approved: start.toISOString(), live_mode: false, payer: { id: "456" } };
    await service.applyInvoice(sub, remote, invoice, payment);
    const load = () => admin.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect((await load()).paidThrough).toEqual(firstEnd);
    expect(accessState(await load(), now)).toBe("VERIFYING");
    const renewal = { ...invoice, id: randomUUID(), debit_date: firstEnd.toISOString(), last_modified: firstEnd.toISOString(), payment: { id: randomUUID() } };
    const rejected = { ...payment, id: renewal.payment.id, status: "rejected", date_approved: null, date_last_updated: firstEnd.toISOString() };
    await service.applyInvoice(sub, remote, renewal, rejected);
    expect(accessState(await load(), new Date(firstEnd.getTime() + 86400000))).toBe("GRACE");
    expect(accessState(await load(), now)).toBe("RESTRICTED");
    await project(salon.id, sub.id);
    expect((await admin.hqSubscriptions.findUniqueOrThrow({ where: { billingSubscriptionId: sub.id } })).status).toBe("Inadimplente");
    await expect(scope.withSalon(salon.id, tx => effectiveEntitlement(tx, salon.id, "PRO", now))).rejects.toThrow("Regularize");
    expect(await scope.withSalon(salon.id, tx => canPromoteBillingWaitlist(tx, salon.id))).toBe(false);
    // A later provider attempt for the same invoice is approved.
    const approved = { ...payment, id: randomUUID(), date_last_updated: now.toISOString(), date_approved: now.toISOString() };
    const paidRenewal = { ...renewal, payment: { id: approved.id } };
    await Promise.all([service.applyInvoice(sub, remote, paidRenewal, approved), service.applyInvoice(sub, remote, paidRenewal, approved)]);
    expect((await load()).paidThrough).toEqual(periodEnd(firstEnd, 1));
    expect((await load()).delinquentSince).toBeNull();
    expect(accessState(await load(), now)).toBe("ACTIVE");
    expect(await admin.billingCharge.count({ where: { subscriptionId: sub.id } })).toBe(2);
    await project(salon.id, sub.id);
    const hqSub = await admin.hqSubscriptions.findUniqueOrThrow({ where: { billingSubscriptionId: sub.id } });
    expect(hqSub.status).toBe("Ativo");
    expect(await admin.hqPayments.count({ where: { subscriptionId: hqSub.id, status: "Pago" } })).toBe(2);
    // Late rejection cannot undo the paid renewal.
    await service.applyInvoice(sub, remote, renewal, rejected);
    expect(accessState(await load(), now)).toBe("ACTIVE");
  });
  it("grants twelve calendar months for an annual payment and preserves administrative suspension", async () => {
    const salon = await admin.salon.create({ data: { name: "annual", slug: randomUUID(), accessStatus: "APPROVED" } });
    await admin.membership.create({ data: { salonId: salon.id, userId: ownerId, role: "OWNER" } });
    const sub = await service.contract({ salonId: salon.id, userId: ownerId }, { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 }, randomUUID());
    const mp = await import("./provider");
    const remote = mp.subscriptionSchema.parse(remoteFor(sub.providerId!));
    const invoice = { id: randomUUID(), preapproval_id: remote.id, debit_date: now.toISOString(), currency_id: "BRL", transaction_amount: sub.amountCents / 100, last_modified: now.toISOString(), payment: { id: randomUUID() } };
    const payment = { id: invoice.payment.id, collector_id: "123", currency_id: "BRL", transaction_amount: sub.amountCents / 100, status: "approved", date_last_updated: now.toISOString(), date_approved: now.toISOString(), live_mode: false, payer: { id: "456" } };
    await admin.salon.update({ where: { id: salon.id }, data: { accessStatus: "SUSPENDED" } });
    await service.applyInvoice(sub, remote, invoice, payment);
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).paidThrough).toEqual(periodEnd(now, 12));
    expect(await scope.withSalon(salon.id, tx => effectiveEntitlement(tx, salon.id, "PRO"))).toMatchObject({ maxProfessionals: 12 });
    expect((await admin.salon.findUniqueOrThrow({ where: { id: salon.id } })).accessStatus).toBe("SUSPENDED");
    await project(salon.id, sub.id);
    const hqSub = await admin.hqSubscriptions.findUniqueOrThrow({ where: { billingSubscriptionId: sub.id } });
    expect(hqSub).toMatchObject({ interval: "Anual", amountCents: sub.amountCents, billingAgendaLimit: 12, billingPaidThrough: periodEnd(now, 12) });
    const [metric] = await admin.$queryRaw<{ mrr: number }[]>`SELECT ("amountCents"/12.0)::float8 AS mrr FROM hq_subscriptions WHERE id=${hqSub.id}::uuid`;
    expect(metric.mrr).toBeCloseTo(sub.amountCents / 12, 6);
  });
  it("retries seller verification without trapping a contract whose POST was never attempted", async () => {
    const salon = await admin.salon.create({ data: { name: "seller-unavailable", slug: randomUUID(), accessStatus: "APPROVED" } });
    await admin.membership.create({ data: { salonId: salon.id, userId: ownerId, role: "OWNER" } });
    const ctx = { salonId: salon.id, userId: ownerId }, key = randomUUID();
    const originalFetch = globalThis.fetch, before = postCount;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    try { await expect(service.contract(ctx, { plan: "TEAM", cycle: "MONTHLY" }, key)).rejects.toThrow("PROVIDER_UNAVAILABLE"); }
    finally { vi.stubGlobal("fetch", originalFetch); }
    expect(postCount).toBe(before);
    expect((await admin.billingSubscription.findFirstOrThrow({ where: { salonId: salon.id } })).creationStartedAt).toBeNull();
    expect((await service.contract(ctx, { plan: "TEAM", cycle: "MONTHLY" }, key)).providerId).not.toBeNull();
    expect(postCount).toBe(before + 1);
  });

  async function paidFixture(plan: "INDIVIDUAL" | "TEAM" | "TEAM_PLUS" | "TEAM_MAX" = "INDIVIDUAL", cycle: "MONTHLY" | "ANNUAL" = "MONTHLY", paidStart?: Date, extraAgendas = 0) {
    vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", "true");
    const salon = await admin.salon.create({ data: { name: "change fixture", slug: randomUUID(), accessStatus: "APPROVED" } });
    await admin.membership.create({ data: { salonId: salon.id, userId: ownerId, role: "OWNER" } });
    const ctx = { salonId: salon.id, userId: ownerId };
    const sub = await service.contract(ctx, { plan, cycle, extraAgendas }, randomUUID());
    const remote = (await import("./provider")).subscriptionSchema.parse(remoteFor(sub.providerId!));
    const at = new Date(); const start = paidStart ?? new Date(at.getTime() - 10 * 86400000);
    Object.assign(remote, { status: "authorized", last_modified: at.toISOString(), next_payment_date: periodEnd(start, sub.intervalMonths).toISOString() });
    remotes.set(sub.providerId!, remote);
    await service.applyRemoteSubscription(sub, remote);
    const invoice = { id: randomUUID(), preapproval_id: remote.id, debit_date: start.toISOString(), currency_id: "BRL", transaction_amount: sub.amountCents / 100, last_modified: at.toISOString(), payment: { id: randomUUID() } };
    const payment = { id: invoice.payment.id, collector_id: "123", payer: { id: "456" }, currency_id: "BRL", transaction_amount: sub.amountCents / 100, status: "approved", date_approved: at.toISOString(), date_last_updated: at.toISOString(), live_mode: false, external_reference: service.referenceFor(sub) };
    invoices.set(invoice.id, invoice); payments.set(payment.id, payment);
    await service.applyInvoice(sub, remote, invoice, payment);
    return { ctx, sub: await admin.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } }), remote, invoice, payment };
  }
  async function upgradeFixture() {
    const fixture = await paidFixture();
    const changes = await import("./changes");
    const change = await changes.createChangeQuote(fixture.ctx, { plan: "TEAM_MAX", cycle: "MONTHLY" }, randomUUID());
    await changes.confirmPlanChange(fixture.ctx, change.id);
    return { ...fixture, change, changes };
  }
  it.each((["INDIVIDUAL", "TEAM", "TEAM_PLUS", "TEAM_MAX"] as const).flatMap(plan => (["MONTHLY", "ANNUAL"] as const).map(cycle => ({ plan, cycle }))))("cancels $plan $cycle on day 20, retaining every paid entitlement until its original day 13", async ({ plan, cycle }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = new Date("2026-09-13T23:00:00Z"); vi.setSystemTime(start);
      const f = await paidFixture(plan, cycle, start, plan === "TEAM_MAX" ? 2 : 0);
      const end = new Date(cycle === "MONTHLY" ? "2026-10-13T23:00:00Z" : "2027-09-13T23:00:00Z");
      expect(f.sub.paidThrough).toEqual(end);
      vi.setSystemTime(new Date("2026-09-20T23:00:00Z"));
      await Promise.all([service.requestCancellation(f.ctx, f.sub.id), service.requestCancellation(f.ctx, f.sub.id)]);
      await worker.syncSubscription(f.ctx.salonId, f.sub.id);
      expect(remoteFor(f.sub.providerId!).status).toBe("cancelled");
      const cancelled = await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } });
      expect(cancelled.cancelledAt).not.toBeNull(); expect(cancelled.paidThrough).toEqual(end);
      expect(await admin.billingEvent.count({ where: { subscriptionId: f.sub.id, type: "CANCEL_REQUESTED" } })).toBe(1);
      expect(await admin.billingCharge.count({ where: { subscriptionId: f.sub.id, status: "approved" } })).toBe(1);
      for (const at of [new Date(), new Date(end.getTime() - 1)]) {
        expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO", at))).toMatchObject({ maxProfessionals: f.sub.agendaLimit, priceCents: f.sub.amountCents, features: { MARKETING: true, INVENTORY: true, PACKAGES: true } });
      }
      expect(accessState(cancelled, end)).toBe("EXPIRED");
      await expect(scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO", end))).rejects.toThrow("Regularize");
    } finally { vi.useRealTimers(); }
  });
  it("allows cancellation while suspended and checkout is paused, but requires ownership and tenant", async () => {
    const f = await paidFixture();
    await admin.salon.update({ where: { id: f.ctx.salonId }, data: { accessStatus: "SUSPENDED" } });
    vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "true"); vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_PAUSED", "true");
    try {
      await expect(service.requestCancellation({ ...f.ctx, userId: otherId }, f.sub.id)).rejects.toThrow("OWNER_REQUIRED");
      await expect(service.requestCancellation(context(), f.sub.id)).rejects.toThrow("NOT_FOUND");
      await service.requestCancellation(f.ctx, f.sub.id); await worker.syncSubscription(f.ctx.salonId, f.sub.id);
      expect(remoteFor(f.sub.providerId!).status).toBe("cancelled");
      expect((await admin.salon.findUniqueOrThrow({ where: { id: f.ctx.salonId } })).accessStatus).toBe("SUSPENDED");
    } finally { vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "false"); vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_PAUSED", "false"); }
  });
  it.each(["UPGRADE", "SCHEDULED"])("cancels renewal together with an unpaid %s without removing current capacity", async kind => {
    const f = await paidFixture(kind === "UPGRADE" ? "INDIVIDUAL" : "TEAM_MAX"), changes = await import("./changes");
    const quote = await changes.createChangeQuote(f.ctx, { plan: kind === "UPGRADE" ? "TEAM_PLUS" : "INDIVIDUAL", cycle: "MONTHLY" }, randomUUID());
    await changes.confirmPlanChange(f.ctx, quote.id); await worker.syncSubscription(f.ctx.salonId, f.sub.id);
    await service.requestCancellation(f.ctx, f.sub.id);
    await worker.syncSubscription(f.ctx.salonId, f.sub.id); await worker.syncSubscription(f.ctx.salonId, f.sub.id);
    expect(remoteFor(f.sub.providerId!).status).toBe("cancelled");
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).state).toBe("CANCELLED");
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: f.sub.agendaLimit });
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).reviewRequired).toBe(false);
  });
  it("confirms a lost cancellation PUT response by GET without granting another period", async () => {
    const f = await paidFixture(); await service.requestCancellation(f.ctx, f.sub.id);
    loseUpdateResponse = true;
    try { await expect(worker.syncSubscription(f.ctx.salonId, f.sub.id)).rejects.toThrow("PROVIDER_UNAVAILABLE"); }
    finally { loseUpdateResponse = false; }
    expect(remoteFor(f.sub.providerId!).status).toBe("cancelled");
    await worker.syncSubscription(f.ctx.salonId, f.sub.id);
    const sub = await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } });
    expect(sub.cancelledAt).not.toBeNull(); expect(sub.paidThrough).toEqual(f.sub.paidThrough);
  });
  it.each(["SCHEDULED", "REVIEW"])("cancels a future authorized recurrence in %s even though the old recurrence is already cancelled", async state => {
    const f = await paidFixture(), changes = await import("./changes"), cancellation = await import("./cancellation");
    const quote = await changes.createChangeQuote(f.ctx, { plan: "TEAM_MAX", cycle: "ANNUAL" }, randomUUID());
    await changes.confirmPlanChange(f.ctx, quote.id); await worker.syncSubscription(f.ctx.salonId, f.sub.id);
    const change = await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } });
    const next = await admin.billingSubscription.findUniqueOrThrow({ where: { id: change.replacementSubscriptionId! } });
    Object.assign(remoteFor(next.providerId!), { status: "authorized", last_modified: new Date().toISOString() });
    await worker.syncSubscription(f.ctx.salonId, next.id); await worker.syncSubscription(f.ctx.salonId, f.sub.id);
    await admin.billingPlanChange.update({ where: { id: change.id }, data: { state } });
    if (state === "REVIEW") await admin.billingSubscription.update({ where: { id: next.id }, data: { reviewRequired: true } });
    const status = () => scope.withSalon(f.ctx.salonId, async tx => cancellation.renewalCancellationStatus(await cancellation.cancellationSubscriptions(tx, await tx.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } }))));
    expect(await status()).toBe("AVAILABLE");
    expect(await service.requestCancellation(f.ctx, f.sub.id)).toMatchObject({ status: "CANCELLATION_PENDING" });
    expect(await status()).toBe("PENDING");
    refuseCancellation = true;
    try { await expect(worker.syncSubscription(f.ctx.salonId, next.id)).rejects.toThrow("PROVIDER_UNAVAILABLE"); }
    finally { refuseCancellation = false; }
    expect(await status()).toBe("PENDING");
    await worker.syncSubscription(f.ctx.salonId, next.id);
    expect(remoteFor(next.providerId!).status).toBe("cancelled");
    expect(await status()).toBe("CANCELLED");
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).paidThrough).toEqual(f.sub.paidThrough);
    expect(await admin.billingCharge.count({ where: { subscriptionId: next.id } })).toBe(0);
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: 1 });
  });
  it("acknowledges cancellation at equal provider timestamps without replaying authorization", async () => {
    const f = await paidFixture();
    await service.requestCancellation(f.ctx, f.sub.id);
    await service.applyRemoteSubscription(f.sub, { ...f.remote, status: "cancelled" });
    await service.applyRemoteSubscription(f.sub, f.remote);
    expect(await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).toMatchObject({ providerStatus: "cancelled", paidThrough: f.sub.paidThrough });
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).cancelledAt).not.toBeNull();
  });
  function upgradePayment(change: { id: string; salonId: string; amountDueCents: number }) {
    const at = new Date().toISOString();
    return { id: randomUUID(), collector_id: "123", payer: { id: "456" }, currency_id: "BRL", transaction_amount: change.amountDueCents / 100, status: "approved", date_approved: at, date_last_updated: at, live_mode: false, external_reference: `efu:${change.salonId}:${change.id}` };
  }
  for (const cycle of ["MONTHLY", "ANNUAL"] as const) for (const [source, target] of [["INDIVIDUAL", "TEAM"], ["INDIVIDUAL", "TEAM_PLUS"], ["INDIVIDUAL", "TEAM_MAX"], ["TEAM", "TEAM_PLUS"], ["TEAM", "TEAM_MAX"], ["TEAM_PLUS", "TEAM_MAX"]] as const) {
    it(`settles ${source} → ${target} ${cycle} against a real tenant transaction`, async () => {
      const f = await paidFixture(source, cycle), changes = await import("./changes"), { applyUpgradePayment } = await import("./change-payments"), { syncPlanChanges } = await import("./change-worker");
      const quote = await changes.createChangeQuote(f.ctx, { plan: target, cycle }, randomUUID());
      await changes.confirmPlanChange(f.ctx, quote.id);
      await applyUpgradePayment(f.sub, quote, f.remote, upgradePayment(quote));
      await syncPlanChanges(f.sub);
      const expected = quoteContract({ plan: target, cycle });
      expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ label: target, priceCents: expected.amountCents, maxProfessionals: expected.agendaLimit });
      expect(f.remote.auto_recurring.transaction_amount).toBe(expected.amountCents / 100);
      expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).paidThrough).toEqual(f.sub.paidThrough);
    });
  }
  it("quotes all upgrades without granting capacity, isolates tenants, and confirms once", async () => {
    const f = await paidFixture(); const changes = await import("./changes");
    await expect(changes.createChangeQuote({ ...f.ctx, userId: otherId }, { plan: "TEAM_MAX", cycle: "MONTHLY" }, randomUUID())).rejects.toThrow("OWNER_REQUIRED");
    const quote = await changes.createChangeQuote(f.ctx, { plan: "TEAM_MAX", cycle: "MONTHLY" }, randomUUID());
    expect(quote.amountDueCents).toBeGreaterThan(0);
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: 1 });
    expect(await scope.withSalon(otherSalon, tx => tx.billingPlanChange.findMany({ where: { id: quote.id } }))).toHaveLength(0);
    await expect(admin.billingPlanChange.update({ where: { id: quote.id }, data: { amountDueCents: 1 } })).rejects.toThrow("immutable");
    const results = await Promise.all([changes.confirmPlanChange(f.ctx, quote.id), changes.confirmPlanChange(f.ctx, quote.id)]);
    expect(results.map(r => r.id)).toEqual([quote.id, quote.id]);
    expect(await admin.billingEvent.count({ where: { subscriptionId: f.sub.id, type: "PLAN_CHANGE_REQUESTED" } })).toBe(1);
  });
  it("recovers a lost supplemental checkout POST without creating a second checkout", async () => {
    const f = await upgradeFixture(); const { syncPlanChanges } = await import("./change-worker");
    const before = preferencePosts; losePreferenceResponse = true;
    try { await expect(syncPlanChanges(f.sub)).rejects.toThrow("PROVIDER_UNAVAILABLE"); } finally { losePreferenceResponse = false; }
    await syncPlanChanges(f.sub);
    expect(preferencePosts).toBe(before + 1);
    expect(await admin.billingPlanChange.findUniqueOrThrow({ where: { id: f.change.id } })).toMatchObject({ state: "AWAITING_PAYMENT", paidAt: null });
  });
  it("grants paid upgrade once, recovers PUT uncertainty, keeps the due date and reconciles old invoices", async () => {
    const f = await upgradeFixture(); const { syncPlanChanges } = await import("./change-worker"); const { applyUpgradePayment } = await import("./change-payments");
    const payment = upgradePayment(f.change);
    await Promise.all([applyUpgradePayment(f.sub, f.change, f.remote, payment), applyUpgradePayment(f.sub, f.change, f.remote, payment)]);
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: 10, priceCents: 14990 });
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).paidThrough).toEqual(f.sub.paidThrough);
    loseUpdateResponse = true;
    try { await expect(syncPlanChanges(f.sub)).rejects.toThrow("PROVIDER_UNAVAILABLE"); } finally { loseUpdateResponse = false; }
    await syncPlanChanges(f.sub);
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: f.change.id } })).state).toBe("APPLIED");
    await service.applyInvoice(f.sub, f.remote, f.invoice, { ...f.payment, date_last_updated: new Date().toISOString() });
    expect((await admin.billingCharge.findUniqueOrThrow({ where: { providerInvoiceId: f.invoice.id } })).amountCents).toBe(5990);
    expect(await admin.billingCharge.count({ where: { subscriptionId: f.sub.id } })).toBe(2);
    await project(f.ctx.salonId, f.sub.id);
    expect(await admin.hqSubscriptions.findUniqueOrThrow({ where: { billingSubscriptionId: f.sub.id } })).toMatchObject({ amountCents: 14990, billingAgendaLimit: 10 });
    expect((await admin.hqPayments.aggregate({ where: { subscriptionIdRelation: { billingSubscriptionId: f.sub.id }, status: "Pago" }, _sum: { amountCents: true } }))._sum.amountCents).toBe(5990 + f.change.amountDueCents);
  });
  it("rejects incorrect supplemental payment identities and values without granting capacity", async () => {
    const f = await upgradeFixture(); const { applyUpgradePayment } = await import("./change-payments"); const paid = upgradePayment(f.change);
    for (const patch of [{ transaction_amount: 0.01 }, { currency_id: "USD" }, { collector_id: "999" }, { payer: { id: "999" } }, { external_reference: `efu:${otherSalon}:${f.change.id}` }]) await expect(applyUpgradePayment(f.sub, f.change, f.remote, { ...paid, ...patch })).rejects.toThrow("PAYMENT_MISMATCH");
    for (const status of ["rejected", "pending", "in_process"]) await applyUpgradePayment(f.sub, f.change, f.remote, { ...paid, id: randomUUID(), status, date_approved: null });
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: f.change.id } })).activatedAt).toBeNull();
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: 1 });
  });
  it("records duplicate and reversed real payment IDs for review without duplicating entitlement", async () => {
    const f = await upgradeFixture(); const { applyUpgradePayment } = await import("./change-payments"); const paid = upgradePayment(f.change);
    await applyUpgradePayment(f.sub, f.change, f.remote, paid);
    await applyUpgradePayment(f.sub, f.change, f.remote, { ...paid, id: randomUUID() });
    expect(await admin.billingPlanChange.findUniqueOrThrow({ where: { id: f.change.id } })).toMatchObject({ state: "REVIEW", lastError: "UPGRADE_DUPLICATE_PAYMENT" });
    await applyUpgradePayment(f.sub, f.change, f.remote, { ...paid, date_last_updated: new Date(Date.now() + 1000).toISOString(), transaction_amount_refunded: paid.transaction_amount });
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).paidThrough).toEqual(f.sub.paidThrough);
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).reviewRequired).toBe(true);
  });
  it("preserves a historical reversal while a new upgrade is pending, and freezes the new request", async () => {
    const f = await paidFixture(), changes = await import("./changes"), { syncPlanChanges } = await import("./change-worker"), { applyUpgradePayment } = await import("./change-payments");
    const first = await changes.createChangeQuote(f.ctx, { plan: "TEAM_PLUS", cycle: "MONTHLY" }, randomUUID());
    await changes.confirmPlanChange(f.ctx, first.id); const paid = upgradePayment(first);
    await applyUpgradePayment(f.sub, first, f.remote, paid); await syncPlanChanges(f.sub);
    const second = await changes.createChangeQuote(f.ctx, { plan: "TEAM_MAX", cycle: "MONTHLY" }, randomUUID()); await changes.confirmPlanChange(f.ctx, second.id);
    await applyUpgradePayment(f.sub, first, f.remote, { ...paid, status: "refunded", transaction_amount_refunded: paid.transaction_amount, date_last_updated: new Date(Date.now() + 1000).toISOString() });
    expect((await admin.billingCharge.findUniqueOrThrow({ where: { providerPaymentId: paid.id } })).status).toBe("refunded");
    await syncPlanChanges(await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } }));
    expect(await admin.billingPlanChange.count({ where: { subscriptionId: f.sub.id, state: "REVIEW" } })).toBe(2);
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: second.id } })).activatedAt).toBeNull();
    await expect(changes.createChangeQuote(f.ctx, { plan: "TEAM_MAX", cycle: "ANNUAL" }, randomUUID())).rejects.toThrow("CHANGE_REQUIRES_ACTIVE_SUBSCRIPTION");
  });
  it.each([false, true])("reconciles in-time payment after quote expiry, superseded=%s", async superseded => {
    const f = await upgradeFixture(), { applyUpgradePayment } = await import("./change-payments");
    const paid = upgradePayment(f.change);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(f.change.expiresAt.getTime() + 60000);
      await admin.billingPlanChange.update({ where: { id: f.change.id }, data: { state: "EXPIRED" } });
      if (superseded) { const next = await f.changes.createChangeQuote(f.ctx, { plan: "TEAM", cycle: "MONTHLY" }, randomUUID()); await f.changes.confirmPlanChange(f.ctx, next.id); }
      await applyUpgradePayment(f.sub, f.change, f.remote, paid);
      expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: f.change.id } })).state).toBe(superseded ? "REVIEW" : "APPLYING");
      expect((await admin.billingCharge.findUniqueOrThrow({ where: { providerPaymentId: paid.id } })).status).toBe("approved");
    } finally { vi.useRealTimers(); }
  });
  it("recovers an old supplemental refund without a webhook while waiting for a scheduled renewal", async () => {
    const f = await upgradeFixture(), { applyUpgradePayment } = await import("./change-payments"), { syncPlanChanges } = await import("./change-worker");
    await syncPlanChanges(f.sub);
    const paid = upgradePayment(f.change); await applyUpgradePayment(f.sub, f.change, f.remote, paid); await syncPlanChanges(f.sub);
    const later = await f.changes.createChangeQuote(f.ctx, { plan: "TEAM_PLUS", cycle: "MONTHLY" }, randomUUID());
    await f.changes.confirmPlanChange(f.ctx, later.id); await syncPlanChanges(f.sub);
    payments.set(paid.id, { ...paid, status: "refunded", transaction_amount_refunded: paid.transaction_amount, date_last_updated: new Date(Date.now() + 1000).toISOString() });
    await syncPlanChanges(f.sub);
    expect((await admin.billingCharge.findUniqueOrThrow({ where: { providerPaymentId: paid.id } })).status).toBe("refunded");
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: later.id } })).state).toBe("REVIEW");
  });
  it("accepts the provider's second precision for a payment in the quote's opening second", async () => {
    const f = await upgradeFixture(), { applyUpgradePayment } = await import("./change-payments");
    await applyUpgradePayment(f.sub, f.change, f.remote, { ...upgradePayment(f.change), date_approved: new Date(Math.floor(f.change.quotedAt.getTime() / 1000) * 1000).toISOString() });
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: f.change.id } })).state).toBe("APPLYING");
  });
  it("schedules a downgrade, preserves original invoice terms and cancels the scheduled price", async () => {
    const f = await paidFixture("TEAM_MAX"), changes = await import("./changes"), { syncPlanChanges } = await import("./change-worker");
    const quote = await changes.createChangeQuote(f.ctx, { plan: "TEAM_PLUS", cycle: "MONTHLY" }, randomUUID());
    expect(quote.amountDueCents).toBe(0); await changes.confirmPlanChange(f.ctx, quote.id); await syncPlanChanges(f.sub);
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).state).toBe("SCHEDULED");
    expect((await import("./change-terms")).remoteMatchesTerms(f.remote, (await import("./change-rules")).billingTermsSchema.parse(quote.toTerms))).toBe(true);
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ label: "TEAM_MAX", maxProfessionals: 5 });
    await service.applyInvoice(f.sub, f.remote, f.invoice, f.payment);
    await changes.cancelPlanChange(f.ctx, quote.id); await syncPlanChanges(f.sub);
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).state).toBe("CANCELLED");
    expect(f.remote.auto_recurring.transaction_amount).toBe(149.9);
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: 10 });
  });
  it("charges successive upgrades from the last paid tier, retaining the original period", async () => {
    const f = await paidFixture(), changes = await import("./changes"), { syncPlanChanges } = await import("./change-worker"), { applyUpgradePayment } = await import("./change-payments");
    for (const plan of ["TEAM", "TEAM_PLUS", "TEAM_MAX"] as const) {
      const quote = await changes.createChangeQuote(f.ctx, { plan, cycle: "MONTHLY" }, randomUUID());
      await changes.confirmPlanChange(f.ctx, quote.id);
      await applyUpgradePayment(f.sub, quote, f.remote, upgradePayment(quote));
      await syncPlanChanges(f.sub);
      expect(quote.periodEnd).toEqual(f.sub.paidThrough);
      expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ label: plan });
    }
    const revisions = await admin.billingPlanChange.findMany({ where: { subscriptionId: f.sub.id }, orderBy: { quotedAt: "asc" } });
    expect(revisions.map(c => (c.fromTerms as { plan: string }).plan)).toEqual(["INDIVIDUAL", "TEAM", "TEAM_PLUS"]);
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).paidThrough).toEqual(f.sub.paidThrough);
  });
  it.each([false, true])("activates a paid downgrade at renewal even with lost PUT response=%s", async lost => {
    const f = await paidFixture("TEAM_MAX"), changes = await import("./changes"), { syncPlanChanges } = await import("./change-worker");
    const quote = await changes.createChangeQuote(f.ctx, { plan: "TEAM_PLUS", cycle: "MONTHLY" }, randomUUID());
    await changes.confirmPlanChange(f.ctx, quote.id);
    loseUpdateResponse = lost;
    try { if (lost) await expect(syncPlanChanges(f.sub)).rejects.toThrow("PROVIDER_UNAVAILABLE"); else await syncPlanChanges(f.sub); } finally { loseUpdateResponse = false; }
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(f.sub.paidThrough!.getTime() + 1000);
      const invoice = { ...f.invoice, id: randomUUID(), debit_date: f.sub.paidThrough!.toISOString(), transaction_amount: 99.9, last_modified: new Date().toISOString(), payment: { id: randomUUID() } };
      const payment = { ...f.payment, id: invoice.payment.id, transaction_amount: 99.9, date_approved: new Date().toISOString(), date_last_updated: new Date().toISOString() };
      await service.applyInvoice(f.sub, f.remote, invoice, { ...payment, status: "pending", date_approved: null });
      expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).activatedAt).toBeNull();
      await service.applyInvoice(f.sub, f.remote, invoice, payment);
      await syncPlanChanges(await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } }));
      expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).state).toBe("APPLIED");
      expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ label: "TEAM_PLUS", priceCents: 9990, maxProfessionals: 5 });
    } finally { vi.useRealTimers(); }
  });
  it("rechecks pending invitations on confirmation and rejects expired quotes", async () => {
    const f = await paidFixture("TEAM_MAX"), changes = await import("./changes");
    const quote = await changes.createChangeQuote(f.ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY" }, randomUUID());
    for (let i = 0; i < 2; i++) await admin.userInvite.create({ data: { salonId: f.ctx.salonId, email: `${randomUUID()}@example.test`, name: "synthetic capacity", createdById: ownerId, role: "PROFESSIONAL", tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), expiresAt: new Date(Date.now() + 86400000) } });
    await expect(changes.confirmPlanChange(f.ctx, quote.id)).rejects.toThrow("PLAN_CAPACITY_TOO_SMALL");
    await admin.userInvite.updateMany({ where: { salonId: f.ctx.salonId }, data: { revokedAt: new Date() } });
    vi.useFakeTimers({ toFake: ["Date"] });
    try { vi.setSystemTime(quote.expiresAt.getTime() + 1); await expect(changes.confirmPlanChange(f.ctx, quote.id)).rejects.toThrow("CHANGE_QUOTE_EXPIRED"); } finally { vi.useRealTimers(); }
    expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).confirmedAt).toBeNull();
  });
  it("cancels a cycle change before creating any replacement and freezes a reviewed cycle", async () => {
    const f = await paidFixture(), changes = await import("./changes"), { syncPlanChanges } = await import("./change-worker");
    const quote = await changes.createChangeQuote(f.ctx, { plan: "TEAM", cycle: "ANNUAL" }, randomUUID());
    await changes.confirmPlanChange(f.ctx, quote.id); await changes.cancelPlanChange(f.ctx, quote.id); await syncPlanChanges(f.sub);
    expect(await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({ state: "CANCELLED", replacementSubscriptionId: null });
    const reviewed = await changes.createChangeQuote(f.ctx, { plan: "TEAM_MAX", cycle: "ANNUAL" }, randomUUID());
    await changes.confirmPlanChange(f.ctx, reviewed.id);
    await admin.billingPlanChange.update({ where: { id: reviewed.id }, data: { state: "REVIEW" } });
    const before = postCount; await syncPlanChanges(f.sub); expect(postCount).toBe(before);
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).cancelRequestedAt).toBeNull();
  });
  it("authorizes a future annual replacement and cancels the old recurrence without granting early access", async () => {
    const f = await paidFixture(), changes = await import("./changes"), { syncPlanChanges } = await import("./change-worker");
    const quote = await changes.createChangeQuote(f.ctx, { plan: "TEAM_MAX", cycle: "ANNUAL" }, randomUUID());
    await changes.confirmPlanChange(f.ctx, quote.id); await syncPlanChanges(f.sub);
    const change = await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } });
    const next = await admin.billingSubscription.findUniqueOrThrow({ where: { id: change.replacementSubscriptionId! } });
    const remote = remoteFor(next.providerId!);
    expect(remote.auto_recurring).toMatchObject({ frequency: 12, start_date: new Date(Math.ceil(f.sub.paidThrough!.getTime() / 1000) * 1000).toISOString() });
    expect(change.checkoutUrl).toBeNull();
    expect(next.current).toBe(false);
    Object.assign(remote, { status: "authorized", last_modified: new Date().toISOString() });
    await syncPlanChanges(f.sub);
    await worker.syncSubscription(f.ctx.salonId, f.sub.id);
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).cancelledAt).not.toBeNull();
    expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: next.id } })).current).toBe(false);
    expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(f.sub.paidThrough!.getTime() + 1000);
      const provider = await import("./provider"); const approved = provider.subscriptionSchema.parse(remote);
      const invoice = { id: randomUUID(), preapproval_id: next.providerId!, debit_date: f.sub.paidThrough!.toISOString(), currency_id: "BRL", transaction_amount: next.amountCents / 100, last_modified: new Date().toISOString(), payment: { id: randomUUID() } };
      const payment = { ...f.payment, id: invoice.payment.id, transaction_amount: next.amountCents / 100, date_approved: new Date().toISOString(), date_last_updated: new Date().toISOString() };
      await service.applyInvoice(next, approved, invoice, payment);
      const old = await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } });
      await syncPlanChanges(old);
      expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: next.id } })).current).toBe(true);
      expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: f.sub.id } })).current).toBe(false);
      expect((await admin.billingPlanChange.findUniqueOrThrow({ where: { id: quote.id } })).state).toBe("APPLIED");
      expect(await scope.withSalon(f.ctx.salonId, tx => effectiveEntitlement(tx, f.ctx.salonId, "PRO"))).toMatchObject({ maxProfessionals: 10, priceCents: 143900 });
      const paidEnd = (await admin.billingSubscription.findUniqueOrThrow({ where: { id: next.id } })).paidThrough;
      await service.requestCancellation(f.ctx, f.sub.id); // A page opened before promotion still refers to the old ID.
      await worker.syncSubscription(f.ctx.salonId, next.id);
      expect(remoteFor(next.providerId!).status).toBe("cancelled");
      expect((await admin.billingSubscription.findUniqueOrThrow({ where: { id: next.id } })).paidThrough).toEqual(paidEnd);
    } finally { vi.useRealTimers(); }
  });
});
