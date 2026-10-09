import "server-only";
import Stripe from "stripe";
import { BillingError } from "../catalog";
import { stripeConfig } from "./config";

/** Pinned with the SDK (stripe@22.6.2): webhooks and objects keep this shape until both are upgraded together. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

let cached: { key: string; client: Stripe } | null = null;

/** At most two six-second attempts (Mercado Pago makes one), so a reconciliation step stays inside the function's time.
 * The SDK repeats a POST with the same idempotency key, so the retry never charges twice. */
export function stripeClient() {
  const { secretKey } = stripeConfig();
  if (cached?.key !== secretKey) {
    cached = { key: secretKey, client: new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 1, telemetry: false, appInfo: { name: "EverFlair" } }) };
  }
  return cached.client;
}

/** Stripe failures become BillingErrors, as Mercado Pago's do (provider.ts): a rejected key is told apart from an outage,
 * and no provider message reaches a response or a log. Codes of their own, so the owner never reads "Mercado Pago". */
export async function stripeRequest<T>(call: (client: Stripe) => Promise<T>): Promise<T> {
  const client = stripeClient();
  try { return await call(client); }
  catch (error) {
    const type = (error as { type?: unknown } | null)?.type;
    if (type === "StripeAuthenticationError" || type === "StripePermissionError") throw new BillingError("STRIPE_KEY_REJECTED", 503);
    if (type === "StripeConnectionError" || type === "StripeAPIError" || type === "StripeRateLimitError") throw new BillingError("STRIPE_UNAVAILABLE", 503);
    throw new BillingError("STRIPE_REJECTED", 503);
  }
}

/** Before the first charge: the key must belong to the configured Brazilian account that settles in reais. */
export async function verifyStripeAccount() {
  const config = stripeConfig();
  const account = await stripeRequest(client => client.accounts.retrieveCurrent());
  if (account.id !== config.accountId || account.country !== "BR" || account.default_currency !== "brl") {
    throw new BillingError("STRIPE_ACCOUNT_MISMATCH", 503);
  }
  return account;
}
