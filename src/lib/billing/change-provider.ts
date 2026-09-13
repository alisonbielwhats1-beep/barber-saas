import "server-only";
import { z } from "zod";
import type { BillingPlanChange, BillingSubscription } from "@prisma/client";
import { withSalon } from "../prisma-tenant";
import { BillingError, BILLING_PLANS } from "./catalog";
import { billingConfig } from "./config";
import { billingTermsSchema } from "./change-rules";
import { subscriptionLock } from "./service";
import * as mp from "./provider";

export const upgradeReference = (change: { salonId: string; id: string }) => `efu:${change.salonId}:${change.id}`;
export function parseUpgradeReference(value: string) {
  const match = /^efu:([a-zA-Z0-9_-]{1,100}):([a-f0-9-]{36})$/.exec(value);
  if (!match) throw new BillingError("UNKNOWN_CHANGE", 404);
  return { salonId: match[1], id: match[2] };
}
const preferenceSchema = z.object({ id: z.string(), collector_id: z.union([z.string(), z.number()]).transform(String), external_reference: z.string(), init_point: z.string().url(),
  items: z.array(z.object({ quantity: z.number(), unit_price: z.number(), currency_id: z.string() })), expires: z.boolean(), expiration_date_to: z.string() });
export async function prepareUpgradeCheckout(sub: BillingSubscription, change: BillingPlanChange) {
  const config = billingConfig();
  if (change.preferenceId) return;
  if (change.expiresAt <= new Date()) throw new BillingError("CHANGE_QUOTE_EXPIRED");
  await mp.verifySellerAccount();
  const first = await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const fresh = await tx.billingPlanChange.findUniqueOrThrow({ where: { id: change.id } });
    if (fresh.state !== "PREPARING") return null;
    if (fresh.creationStartedAt) return false;
    await tx.billingPlanChange.update({ where: { id: change.id }, data: { creationStartedAt: new Date() } });
    return true;
  });
  if (first === null) return;
  let raw: unknown;
  if (first) {
    const to = billingTermsSchema.parse(change.toTerms);
    raw = await mp.mpRequest("/checkout/preferences", "POST", {
      items: [{ id: change.id, title: `Everflair — upgrade para ${BILLING_PLANS[to.plan].label}`, quantity: 1, currency_id: "BRL", unit_price: change.amountDueCents / 100 }],
      payer: { email: sub.payerEmail }, external_reference: upgradeReference(change),
      binary_mode: true, payment_methods: { installments: 1, excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
      expires: true, expiration_date_from: change.quotedAt.toISOString(), expiration_date_to: change.expiresAt.toISOString(),
      back_urls: { success: `${config.baseUrl}/api/billing/return`, failure: `${config.baseUrl}/api/billing/return`, pending: `${config.baseUrl}/api/billing/return` },
      ...(config.baseUrl.startsWith("https:") ? { auto_return: "approved" } : {}),
    });
  } else {
    const results = mp.parseProvider(z.object({ elements: z.array(z.object({ id: z.string(), external_reference: z.string() })), total: z.number().int() }), await mp.mpRequest(`/checkout/preferences/search?external_reference=${encodeURIComponent(upgradeReference(change))}`));
    if (results.total !== 1 || results.elements.length !== 1 || results.elements[0].external_reference !== upgradeReference(change)) throw new BillingError("CREATION_REQUIRES_RECONCILIATION", 503);
    raw = await mp.mpRequest(`/checkout/preferences/${encodeURIComponent(results.elements[0].id)}`);
  }
  const preference = mp.parseProvider(preferenceSchema, raw);
  if (preference.collector_id !== sub.collectorId || preference.external_reference !== upgradeReference(change) || preference.items.length !== 1 || preference.items[0].quantity !== 1 || preference.items[0].currency_id !== "BRL" || Math.round(preference.items[0].unit_price * 100) !== change.amountDueCents || !preference.expires || new Date(preference.expiration_date_to).getTime() !== change.expiresAt.getTime()) throw new BillingError("UPGRADE_CHECKOUT_MISMATCH", 503);
  await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    await tx.billingPlanChange.update({ where: { id: change.id }, data: { preferenceId: preference.id, checkoutUrl: mp.checkoutUrl(preference.init_point) } });
    await tx.billingPlanChange.updateMany({ where: { id: change.id, state: "PREPARING" }, data: { state: "AWAITING_PAYMENT" } });
  });
}
export async function upgradePayments(change: BillingPlanChange) {
  const page = mp.parseProvider(z.object({ results: z.array(mp.paymentSchema), paging: z.object({ total: z.number().int() }) }), await mp.mpRequest(`/v1/payments/search?external_reference=${encodeURIComponent(upgradeReference(change))}&sort=date_created&criteria=desc&limit=100`));
  if (page.paging.total > page.results.length) throw new BillingError("UPGRADE_PAYMENTS_REQUIRE_REVIEW", 503);
  return page.results.filter(payment => payment.external_reference === upgradeReference(change));
}
