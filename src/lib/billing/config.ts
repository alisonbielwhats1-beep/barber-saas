import "server-only";
import { BillingError } from "./catalog";

export const billingEnabled = () => process.env.MERCADOPAGO_BILLING_ENABLED === "true";
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
  if ((mode === "live") !== (process.env.APP_ENV === "production") ||
      (mode === "test" && process.env.VERCEL_ENV === "production")) {
    throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !(mode === "test" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new BillingError("BILLING_UNSAFE_URL", 503);
  }
  return { token, webhookSecret, collectorId, mode: mode as "test" | "live", baseUrl: url.origin };
}
