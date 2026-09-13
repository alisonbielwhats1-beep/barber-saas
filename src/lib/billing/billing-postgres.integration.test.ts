import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { assertSafeDatabaseOperation } from "../database-safety";
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
    vi.doMock("../prisma", () => ({ prisma: runtime }));
    service = await import("./service"); worker = await import("./worker"); scope = await import("../prisma-tenant");
    project = (await import("./hq-sync")).syncBillingToHq;
    vi.stubEnv("MERCADOPAGO_HQ_SYNC_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input); const path = url.pathname;
      let body: unknown;
      if (path === "/users/me") body = { id: 123, site_id: "MLB", tags: ["test_user"] };
      else if (path === "/preapproval" && init?.method === "POST") {
        postCount++;
        const data = JSON.parse(String(init.body));
        const id = randomUUID();
        body = { ...data, id, collector_id: 123, payer_id: 456, last_modified: now.toISOString(), init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${id}` };
        remotes.set(id, body as Record<string, unknown>);
        if (loseCreateResponse) throw new Error("Simulated lost POST response");
      } else if (path === "/preapproval/search") body = { results: [...remotes.values()].filter(s => s.external_reference === url.searchParams.get("external_reference")) };
      else if (path.startsWith("/preapproval/")) {
        body = remotes.get(path.split("/").at(-1)!);
        if (init?.method === "PUT") {
          if (refuseCancellation) return new Response("{}", { status: 503 });
          Object.assign(body as object, { status: "cancelled", last_modified: new Date(now.getTime() + 1000).toISOString() });
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
    expect(hqSub).toMatchObject({ plan: "Equipe Plus", amountCents: 9990, interval: "Mensal", billingAgendaLimit: 5, billingPaidThrough: periodEnd(now, 1) });
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
    await expect(admin.$transaction(tx => execute(tx, ownerId, { type: "pay", id: payment.id, paidDate: now.toISOString().slice(0, 10), method: "manual" }))).rejects.toThrow("Mercado Pago");
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
    expect(sub.providerId).not.toBeNull(); expect(postCount).toBe(before); expect(sub.amountCents).toBe(59880);
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
    expect(metric.mrr).toBe(sub.amountCents / 12);
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
});
