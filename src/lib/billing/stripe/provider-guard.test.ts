import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingSubscription, SecretaryCreditPurchase } from "@prisma/client";
vi.mock("server-only", () => ({}));
const stored = vi.hoisted(() => ({ subscription: null as unknown }));
/** Just enough of a tenant transaction to reach the provider check: owner, locks, approved salon, the stored contract. */
const fakeTx = () => ({
  $executeRaw: async () => 0, $queryRaw: async () => [],
  membership: { findFirst: async () => ({ role: "OWNER" }) },
  salon: { findUniqueOrThrow: async () => ({ accessStatus: "APPROVED" }) },
  billingPlanChange: { findUnique: async () => null, findFirst: async () => null },
  billingSubscription: { findUniqueOrThrow: async () => stored.subscription, findFirst: async () => stored.subscription },
});
vi.mock("../../prisma-tenant", () => ({
  withSalon: async (_salonId: string, fn: (tx: unknown) => unknown) => fn(fakeTx()),
  withTenant: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(fakeTx()),
}));
import { assertProvider } from "../catalog";
import { ensureCreated } from "../service";
import { syncSubscription } from "../worker";
import { applyCreditPayment, prepareCreditCheckout } from "../credits-provider";
import { prepareUpgradeCheckout } from "../change-provider";
import { syncPlanChanges } from "../change-worker";
import { createChangeQuote, reactivateRenewal } from "../changes";

const owner = { salonId: "salon-a", userId: "owner-a" };
const stripeSubscription = { id: "6d1f8a4e-0000-4000-8000-000000000001", salonId: "salon-a", provider: "stripe", providerId: "sub_1Synthetic", providerStatus: "authorized",
  mode: "test", collectorId: "acct_1Synthetic", paidThrough: new Date(Date.now() + 10 * 86400_000), reviewRequired: false, delinquentSince: null,
  cancelledAt: null, creationStartedAt: null, cancelRequestedAt: null } as unknown as BillingSubscription;
const stripePurchase = { id: "6d1f8a4e-0000-4000-8000-000000000002", salonId: "salon-a", provider: "stripe", preferenceId: null, expiresAt: new Date(Date.now() + 3600_000) } as unknown as SecretaryCreditPurchase;

describe("Mercado Pago code never touches a Stripe contract or purchase", () => {
  const fetch = vi.fn();
  beforeEach(() => {
    for (const [key, value] of Object.entries({ MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_PLAN_CHANGES_ENABLED: "true", MERCADOPAGO_MODE: "test", MERCADOPAGO_COLLECTOR_ID: "123",
      MERCADOPAGO_ACCESS_TOKEN: "synthetic", MERCADOPAGO_WEBHOOK_SECRET: "synthetic", APP_ENV: "test", NEXTAUTH_URL: "http://localhost:3000" })) vi.stubEnv(key, value);
    fetch.mockReset(); vi.stubGlobal("fetch", fetch);
    stored.subscription = stripeSubscription;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock("../service"); vi.resetModules(); });

  it("treats rows from before 032 as Mercado Pago and refuses the other provider", () => {
    expect(() => assertProvider({}, "mercadopago")).not.toThrow();
    expect(() => assertProvider({ provider: null }, "mercadopago")).not.toThrow();
    expect(() => assertProvider({ provider: "mercadopago" }, "stripe")).toThrow("PROVIDER_MISMATCH");
    expect(() => assertProvider({ provider: "stripe" }, "mercadopago")).toThrow("PROVIDER_MISMATCH");
  });

  it("does not create, reconcile or change a Stripe subscription in Mercado Pago", async () => {
    await expect(ensureCreated(stripeSubscription)).rejects.toThrow("PROVIDER_MISMATCH");
    await expect(syncSubscription("salon-a", stripeSubscription.id)).rejects.toThrow("PROVIDER_MISMATCH");
    await expect(prepareUpgradeCheckout(stripeSubscription, {} as never)).rejects.toThrow("PROVIDER_MISMATCH");
    await expect(syncPlanChanges(stripeSubscription)).rejects.toThrow("PROVIDER_MISMATCH");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("dispatches in the worker itself, before any Mercado Pago step", async () => {
    vi.resetModules();
    const ensure = vi.fn();
    vi.doMock("../service", async original => ({ ...(await original<typeof import("../service")>()), ensureCreated: ensure }));
    const worker = await import("../worker");
    await expect(worker.syncSubscription("salon-a", stripeSubscription.id)).rejects.toThrow("PROVIDER_MISMATCH");
    expect(ensure).not.toHaveBeenCalled();
  });

  it("refuses a Stripe contract at the owner's plan change and reactivation, with its own error", async () => {
    await expect(createChangeQuote(owner, { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 }, "6d1f8a4e-0000-4000-8000-000000000003")).rejects.toThrow("PROVIDER_MISMATCH");
    await expect(reactivateRenewal(owner, stripeSubscription.id, "6d1f8a4e-0000-4000-8000-000000000004")).rejects.toThrow("PROVIDER_MISMATCH");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not open a checkout for, nor credit a payment to, a Stripe Secretária purchase", async () => {
    await expect(prepareCreditCheckout(stripePurchase)).rejects.toThrow("PROVIDER_MISMATCH");
    await expect(applyCreditPayment(stripePurchase, {} as never)).rejects.toThrow("PROVIDER_MISMATCH");
    expect(fetch).not.toHaveBeenCalled();
  });
});
