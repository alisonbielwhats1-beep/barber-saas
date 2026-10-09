import "server-only";
import { BillingError } from "../catalog";
import { billingEnabled, billingOrigin } from "../config";

/** Owner decision 09/10/2026: Stripe is an additional way to pay inside the app's billing, never billing on its own.
 * MERCADOPAGO_BILLING_ENABLED keeps switching the whole billing (access rules, portal, reconciliation) on and off. */
export const stripeEnabled = () => billingEnabled() && process.env.STRIPE_BILLING_ENABLED === "true";
/** Stops new Stripe checkouts only; renewals, webhooks and cancellations keep working. */
export const stripeCheckoutPaused = () => process.env.STRIPE_CHECKOUT_PAUSED === "true";

const SECRET_KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;

export function stripeConfig() {
  if (!stripeEnabled()) throw new BillingError("STRIPE_DISABLED", 503);
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const accountId = process.env.STRIPE_ACCOUNT_ID;
  const mode = process.env.STRIPE_MODE;
  const baseUrl = process.env.NEXTAUTH_URL;
  const key = SECRET_KEY.exec(secretKey ?? "");
  if (!key || !webhookSecret?.startsWith("whsec_") || !/^acct_[A-Za-z0-9]{6,}$/.test(accountId ?? "") || !baseUrl || !["test", "live"].includes(mode ?? "")) {
    throw new BillingError("STRIPE_NOT_CONFIGURED", 503);
  }
  // A key from the other environment never charges: its prefix must agree with the configured mode.
  if (key[2] !== mode) throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
  return { secretKey: secretKey!, webhookSecret, accountId: accountId!, mode: mode as "test" | "live", baseUrl: billingOrigin(mode as "test" | "live", baseUrl) };
}
