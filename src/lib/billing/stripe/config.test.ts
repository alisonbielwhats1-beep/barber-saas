import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const retrieveCurrent = vi.fn();
const constructed: Array<{ key: string; config: Record<string, unknown> }> = [];
vi.mock("stripe", () => ({
  default: class {
    accounts = { retrieveCurrent };
    constructor(key: string, config: Record<string, unknown>) { constructed.push({ key, config }); }
  },
}));
import { stripeCheckoutPaused, stripeConfig, stripeEnabled } from "./config";
import { STRIPE_API_VERSION, stripeClient, stripeRequest, verifyStripeAccount } from "./client";

/** Synthetic keys are assembled here, so no key-shaped literal ever sits in the source for secret scanners to confuse. */
const syntheticKey = (prefix: string) => `${prefix}_SyntheticOnly0000`;
const TEST_KEY = syntheticKey("rk_test");
const configured = () => {
  for (const [key, value] of Object.entries({ MERCADOPAGO_BILLING_ENABLED: "true", STRIPE_BILLING_ENABLED: "true", STRIPE_MODE: "test", STRIPE_SECRET_KEY: TEST_KEY,
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic", STRIPE_ACCOUNT_ID: "acct_1Synthetic", APP_ENV: "test", VERCEL_ENV: "", NEXTAUTH_URL: "http://localhost:3000" })) vi.stubEnv(key, value);
};
describe("Stripe configuration trust boundaries", () => {
  beforeEach(() => { configured(); retrieveCurrent.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("is an extra way to pay inside the app's billing, never billing on its own", () => {
    expect(stripeEnabled()).toBe(true);
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    expect(stripeEnabled()).toBe(false);
    expect(() => stripeConfig()).toThrow("STRIPE_DISABLED");
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true"); vi.stubEnv("STRIPE_BILLING_ENABLED", "false");
    expect(() => stripeConfig()).toThrow("STRIPE_DISABLED");
  });

  it("requires every credential in its expected format", () => {
    expect(stripeConfig()).toMatchObject({ mode: "test", accountId: "acct_1Synthetic", baseUrl: "http://localhost:3000" });
    for (const [key, value] of [["STRIPE_SECRET_KEY", ""], ["STRIPE_SECRET_KEY", syntheticKey("pk_test")], ["STRIPE_SECRET_KEY", "sk_test_short"], ["STRIPE_WEBHOOK_SECRET", "synthetic"],
      ["STRIPE_ACCOUNT_ID", "1Synthetic"], ["STRIPE_MODE", "sandbox"], ["NEXTAUTH_URL", ""]]) {
      vi.stubEnv(key, value);
      expect(() => stripeConfig(), `${key}=${value}`).toThrow("STRIPE_NOT_CONFIGURED");
      configured();
    }
  });

  it("never lets a key, mode or deployment from the other environment charge", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", syntheticKey("sk_live"));
    expect(() => stripeConfig()).toThrow("BILLING_ENVIRONMENT_MISMATCH");
    vi.stubEnv("STRIPE_MODE", "live");
    expect(() => stripeConfig()).toThrow("BILLING_ENVIRONMENT_MISMATCH");
    vi.stubEnv("APP_ENV", "production"); vi.stubEnv("NEXTAUTH_URL", "https://everflair.com.br");
    expect(stripeConfig().mode).toBe("live");
    vi.stubEnv("STRIPE_SECRET_KEY", TEST_KEY); vi.stubEnv("STRIPE_MODE", "test");
    expect(() => stripeConfig()).toThrow("BILLING_ENVIRONMENT_MISMATCH");
    vi.stubEnv("APP_ENV", "test"); vi.stubEnv("VERCEL_ENV", "production");
    expect(() => stripeConfig()).toThrow("BILLING_ENVIRONMENT_MISMATCH");
  });

  it("returns only to HTTPS outside local tests", () => {
    vi.stubEnv("NEXTAUTH_URL", "http://everflair.com.br");
    expect(() => stripeConfig()).toThrow("BILLING_UNSAFE_URL");
  });

  it("pauses new checkouts without disabling Stripe", () => {
    expect(stripeCheckoutPaused()).toBe(false);
    vi.stubEnv("STRIPE_CHECKOUT_PAUSED", "true");
    expect(stripeCheckoutPaused()).toBe(true);
    expect(stripeEnabled()).toBe(true);
  });

  it("pins the API version and a bounded network budget", () => {
    stripeClient();
    expect(constructed.at(-1)).toMatchObject({ key: TEST_KEY, config: { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 1, telemetry: false } });
  });

  it("charges only through the configured Brazilian account that settles in reais", async () => {
    retrieveCurrent.mockResolvedValue({ id: "acct_1Synthetic", country: "BR", default_currency: "brl" });
    await expect(verifyStripeAccount()).resolves.toMatchObject({ id: "acct_1Synthetic" });
    for (const account of [{ id: "acct_1Other", country: "BR", default_currency: "brl" }, { id: "acct_1Synthetic", country: "US", default_currency: "brl" },
      { id: "acct_1Synthetic", country: "BR", default_currency: "usd" }]) {
      retrieveCurrent.mockResolvedValue(account);
      await expect(verifyStripeAccount()).rejects.toThrow("STRIPE_ACCOUNT_MISMATCH");
    }
  });

  it("turns Stripe failures into billing errors without the provider's message", async () => {
    for (const [type, code] of [["StripeAuthenticationError", "STRIPE_KEY_REJECTED"], ["StripePermissionError", "STRIPE_KEY_REJECTED"], ["StripeConnectionError", "PROVIDER_UNAVAILABLE"],
      ["StripeAPIError", "PROVIDER_UNAVAILABLE"], ["StripeRateLimitError", "PROVIDER_UNAVAILABLE"], ["StripeInvalidRequestError", "PROVIDER_REJECTED"], [undefined, "PROVIDER_REJECTED"]]) {
      retrieveCurrent.mockRejectedValue(Object.assign(new Error("Invalid API Key provided: rk_test_***leaked"), { type }));
      const failure = await verifyStripeAccount().then(() => null, (e: unknown) => e as Error);
      expect(failure).toMatchObject({ name: "BillingError", code, status: 503 });
      expect(failure?.message).not.toContain("leaked");
    }
    await expect(stripeRequest(async () => "ok")).resolves.toBe("ok");
  });
});

