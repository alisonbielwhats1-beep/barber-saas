import { billingIntentQuery, resolveBillingIntent, type BillingIntent } from "./presentation";

/**
 * Keeps the plan chosen on the landing across e-mail confirmation in the same
 * browser. Only a selection is stored: prices are always recalculated.
 */
export const BILLING_INTENT_COOKIE = "ef_billing_intent";
const MAX_AGE_SECONDS = 2 * 24 * 60 * 60;

export function rememberBillingIntent(intent: BillingIntent) {
  try {
    document.cookie = `${BILLING_INTENT_COOKIE}=${encodeURIComponent(billingIntentQuery(intent))}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* Cookies may be blocked; the login link still carries the plan. */ }
}

export function rememberedBillingIntent(value: string | undefined): BillingIntent | undefined {
  if (!value) return undefined;
  try { return resolveBillingIntent(Object.fromEntries(new URLSearchParams(decodeURIComponent(value)))); }
  catch { return undefined; }
}
