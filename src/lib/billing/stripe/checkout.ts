import "server-only";
import type Stripe from "stripe";
import type { BillingSubscription } from "@prisma/client";
import { withSalon } from "../../prisma-tenant";
import { assertProvider, BILLING_PLANS, BillingError } from "../catalog";
import { billingCapacityLabel } from "../presentation";
import { recordEvent, referenceFor, subscriptionLock } from "../service";
import { stripeCheckoutPaused, stripeConfig } from "./config";
import { stripeRequest, verifyStripeAccount } from "./client";

/** Only Stripe's hosted Checkout, over HTTPS, may be stored and shown to the owner (the browser checks it again). */
export function stripeCheckoutUrl(value: string | null) {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port) throw new BillingError("INVALID_CHECKOUT", 503);
  return url.href;
}

/** One Stripe customer per salon, account and mode (032), created once: a repeated creation within a day returns the same one. */
export async function stripeCustomerFor(salonId: string, email: string) {
  const config = stripeConfig();
  const where = { salonId_provider_mode_accountId: { salonId, provider: "stripe", mode: config.mode, accountId: config.accountId } };
  const known = await withSalon(salonId, tx => tx.billingCustomer.findUnique({ where }));
  if (known) return known.customerId;
  const customer = await stripeRequest(client => client.customers.create({ email, metadata: { ef_salon: salonId } },
    { idempotencyKey: `ef-customer:${salonId}:${config.mode}:${config.accountId}` }));
  return withSalon(salonId, async tx => {
    await subscriptionLock(tx, salonId);
    const again = await tx.billingCustomer.findUnique({ where });
    if (again) return again.customerId;
    await tx.billingCustomer.create({ data: { salonId, provider: "stripe", mode: config.mode, accountId: config.accountId, customerId: customer.id } });
    return customer.id;
  });
}

/** The salon's customer, read back for reconciliation; a contract without one was never sent to Stripe. */
export async function knownStripeCustomer(sub: BillingSubscription) {
  const row = await withSalon(sub.salonId, tx => tx.billingCustomer.findUnique({
    where: { salonId_provider_mode_accountId: { salonId: sub.salonId, provider: "stripe", mode: sub.mode, accountId: sub.collectorId } } }));
  return row?.customerId ?? null;
}

/** The salon's Checkout Sessions for this contract (a customer has few). More than one paid means a duplicate to review. */
export async function checkoutSessionsFor(customerId: string, reference: string) {
  const page = await stripeRequest(client => client.checkout.sessions.list({ customer: customerId, limit: 100 }));
  return page.data.filter(session => session.client_reference_id === reference);
}

const subscriptionIdOf = (session: Stripe.Checkout.Session) => typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
export const paidSubscriptionIds = (sessions: Stripe.Checkout.Session[]) =>
  [...new Set(sessions.filter(session => session.status === "complete").map(subscriptionIdOf).filter((id): id is string => Boolean(id)))];

/** Every field the owner pays is checked against the stored contract before the link is shown. */
function validateSession(session: Stripe.Checkout.Session, sub: BillingSubscription, customerId: string) {
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (session.mode !== "subscription" || session.client_reference_id !== referenceFor(sub) || customer !== customerId ||
      session.currency !== "brl" || session.amount_total !== sub.amountCents || session.livemode !== (sub.mode === "live")) {
    throw new BillingError("CHECKOUT_MISMATCH", 503);
  }
  return stripeCheckoutUrl(session.url);
}

/**
 * Same doctrine as Mercado Pago (service.ensureCreated): the intent is stored first, ONE creation is reserved, and a creation
 * whose answer was lost is found again by reference before anything new is sent. The Checkout Session itself charges
 * nothing; only its payment, confirmed by reading Stripe back, grants a period.
 */
export async function ensureStripeCheckout(sub: BillingSubscription) {
  assertProvider(sub, "stripe");
  if (sub.checkoutUrl || sub.providerId || sub.cancelledAt) return;
  const config = stripeConfig();
  if (sub.mode !== config.mode || sub.collectorId !== config.accountId) throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
  // A failed read-only preflight must not make a creation that never happened look uncertain.
  if (!sub.creationStartedAt && !sub.cancelRequestedAt) {
    if (stripeCheckoutPaused()) throw new BillingError("CHECKOUT_PAUSED", 503);
    await verifyStripeAccount();
  }
  const reserved = await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    if (current.checkoutUrl || current.providerId || current.cancelledAt) return "done";
    if (current.cancelRequestedAt && !current.creationStartedAt) {
      await tx.billingSubscription.update({ where: { id: sub.id }, data: { cancelledAt: new Date(), providerStatus: "cancelled" } });
      await recordEvent(tx, sub, "cancelled", "CANCELLED");
      return "done";
    }
    // Cancelling a started creation is the reconciliation's job: it expires whatever session exists.
    if (current.cancelRequestedAt) return "done";
    if (current.creationStartedAt) return "recover";
    if (stripeCheckoutPaused()) throw new BillingError("CHECKOUT_PAUSED", 503);
    await tx.billingSubscription.update({ where: { id: sub.id }, data: { creationStartedAt: new Date() } });
    return "create";
  });
  if (reserved === "done") return;
  const customerId = await stripeCustomerFor(sub.salonId, sub.payerEmail);
  const reference = referenceFor(sub);
  let session = reserved === "recover" ? (await checkoutSessionsFor(customerId, reference)).find(s => s.status === "open") : undefined;
  if (reserved === "recover" && !session) {
    // Paid or expired sessions are the reconciliation's; a new link is never made over them.
    if ((await checkoutSessionsFor(customerId, reference)).length) return;
  }
  const plan = BILLING_PLANS[sub.planCode as keyof typeof BILLING_PLANS];
  if (!plan) throw new BillingError("CHECKOUT_MISMATCH", 503);
  session ??= await stripeRequest(client => client.checkout.sessions.create({
    mode: "subscription", customer: customerId, client_reference_id: reference, locale: "pt-BR",
    // Cards only: Apple Pay and Google Pay come as card wallets. Pix stays with Mercado Pago (owner, 09/10/2026).
    payment_method_types: ["card"],
    // One line with the contract's total, like Mercado Pago: the stored contract is the only source of the amount.
    line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: sub.amountCents,
      recurring: { interval: sub.intervalMonths === 12 ? "year" : "month", interval_count: 1 },
      product_data: { name: `Everflair ${billingCapacityLabel(sub.planCode as keyof typeof BILLING_PLANS, sub.agendaLimit)} — ${sub.cycle === "ANNUAL" ? "anual" : "mensal"}` } } }],
    metadata: { ef_reference: reference }, subscription_data: { metadata: { ef_reference: reference } },
    success_url: `${config.baseUrl}/api/billing/return?provider=stripe`, cancel_url: `${config.baseUrl}/assinatura`,
  }, { idempotencyKey: `ef-checkout:${sub.id}` }));
  const checkoutUrl = validateSession(session, sub, customerId);
  await withSalon(sub.salonId, async tx => {
    await subscriptionLock(tx, sub.salonId);
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    if (current.checkoutUrl || current.cancelledAt) return;
    await tx.billingSubscription.update({ where: { id: sub.id }, data: { checkoutUrl, providerStatus: "pending" } });
    await recordEvent(tx, sub, "checkout", "CHECKOUT_CREATED", "stripe");
  });
}
