import "server-only";
import { BillingError } from "./catalog";

export const billingEnabled = () => process.env.MERCADOPAGO_BILLING_ENABLED === "true";
/** Operational pauses: existing checkouts, renewals and cancellations keep working. */
export const checkoutPaused = () => process.env.MERCADOPAGO_CHECKOUT_PAUSED === "true";
export const planChangesPaused = () => checkoutPaused() || process.env.MERCADOPAGO_PLAN_CHANGES_PAUSED === "true";

/** Shared by every payment provider: live charges only in production, test charges never there, HTTPS return URLs. */
export function billingOrigin(mode: "test" | "live", baseUrl: string) {
  if ((mode === "live") !== (process.env.APP_ENV === "production") ||
      (mode === "test" && process.env.VERCEL_ENV === "production")) {
    throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !(mode === "test" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new BillingError("BILLING_UNSAFE_URL", 503);
  }
  return url.origin;
}

export function billingConfig() {
  if (!billingEnabled()) throw new BillingError("BILLING_DISABLED", 503);
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const collectorId = process.env.MERCADOPAGO_COLLECTOR_ID;
  const mode = process.env.MERCADOPAGO_MODE;
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!token || !webhookSecret || !collectorId || !/^\d+$/.test(collectorId) || !baseUrl || !["test", "live"].includes(mode ?? "")) {
    throw new BillingError("BILLING_NOT_CONFIGURED", 503);
  }
  return { token, webhookSecret, collectorId, mode: mode as "test" | "live", baseUrl: billingOrigin(mode as "test" | "live", baseUrl) };
}
