import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { withSalon } from "../../prisma-tenant";
import { BillingError } from "../catalog";
import { enqueue, parseReference, subscriptionLock } from "../service";
import { stripeConfig } from "./config";
import { stripeClient, stripeRequest } from "./client";
import { STRIPE_CHARGE_TOPICS } from "./sync";

type Target = { salonId: string; id: string; resourceId: string };
const ours = (reference: string | null | undefined) => {
  try { return reference ? parseReference(reference) : null; } catch { return null; }
};

/** A charge (refund, dispute) names only its customer: the salon comes from that customer, read back from Stripe and matched
 * against the customer stored for the salon; the notice goes to the salon's current Stripe contract. */
async function chargeTarget(chargeId: string): Promise<Target | null> {
  const charge = await stripeRequest(client => client.charges.retrieve(chargeId, { expand: ["customer"] }));
  const customer = typeof charge.customer === "object" && charge.customer && !("deleted" in charge.customer && charge.customer.deleted) ? charge.customer as Stripe.Customer : null;
  const salonId = customer?.metadata?.ef_salon;
  if (!customer || !salonId || !/^[a-zA-Z0-9_-]{1,100}$/.test(salonId)) return null;
  const config = stripeConfig();
  return withSalon(salonId, async tx => {
    const known = await tx.billingCustomer.findUnique({ where: { salonId_provider_mode_accountId: { salonId, provider: "stripe", mode: config.mode, accountId: config.accountId } } });
    if (known?.customerId !== customer.id) return null;
    const sub = await tx.billingSubscription.findFirst({ where: { salonId, provider: "stripe", providerId: { not: null } }, orderBy: [{ current: "desc" }, { createdAt: "desc" }] });
    return sub ? { salonId, id: sub.id, resourceId: charge.id } : null;
  });
}

async function targetOf(event: Stripe.Event): Promise<Target | null> {
  const object = event.data.object as { id: string };
  if (event.type.startsWith("checkout.session.")) {
    const ref = ours((object as Stripe.Checkout.Session).client_reference_id);
    return ref && { ...ref, resourceId: object.id };
  }
  if (event.type.startsWith("customer.subscription.")) {
    const ref = ours((object as Stripe.Subscription).metadata?.ef_reference);
    return ref && { ...ref, resourceId: object.id };
  }
  if (event.type.startsWith("invoice.")) {
    const ref = ours((object as Stripe.Invoice).parent?.subscription_details?.metadata?.ef_reference);
    return ref && { ...ref, resourceId: object.id };
  }
  if (STRIPE_CHARGE_TOPICS.has(event.type)) {
    const chargeId = event.type.startsWith("charge.dispute.") ? (object as Stripe.Dispute).charge : object.id;
    return chargeTarget(typeof chargeId === "string" ? chargeId : chargeId.id);
  }
  return null;
}

/**
 * Only a correctly signed event is accepted; it is never trusted for state. It only queues the contract it names, and the
 * worker reads the subscription, invoices and charges back from Stripe. Events of the other mode, other systems or
 * unknown contracts are acknowledged and ignored, so Stripe does not retry them for days.
 */
export async function receiveStripeEvent(raw: string, signature: string | null) {
  const config = stripeConfig();
  if (!signature) throw new BillingError("INVALID_SIGNATURE", 401);
  let event: Stripe.Event;
  try { event = stripeClient().webhooks.constructEvent(raw, signature, config.webhookSecret); }
  catch { throw new BillingError("INVALID_SIGNATURE", 401); }
  if (event.livemode !== (config.mode === "live")) return null;
  const target = await targetOf(event);
  if (!target) return null;
  const key = createHash("sha256").update(`stripe:${event.id}`).digest("hex");
  return withSalon(target.salonId, async tx => {
    await subscriptionLock(tx, target.salonId);
    const sub = await tx.billingSubscription.findFirst({ where: { id: target.id, salonId: target.salonId, provider: "stripe" } });
    if (!sub) return null;
    await tx.billingInbox.upsert({ where: { id: key }, update: {}, create: { id: key, salonId: sub.salonId, subscriptionId: sub.id, topic: event.type, resourceId: target.resourceId } });
    await enqueue(tx, sub);
    return { salonId: sub.salonId, subscriptionId: sub.id };
  });
}
