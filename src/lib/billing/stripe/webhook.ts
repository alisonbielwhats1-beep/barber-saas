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

/** A charge (refund, dispute) is read back from Stripe. Its contract is the one whose invoice it paid (invoice payment →
 * invoice → contract reference), never simply the salon's current one; its customer must be the one stored for the salon. */
async function chargeTarget(chargeId: string): Promise<Target | null> {
  const charge = await stripeRequest(client => client.charges.retrieve(chargeId));
  const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!customerId || !intent) return null;
  const payments = await stripeRequest(client => client.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, limit: 10, expand: ["data.invoice"] }));
  const ref = payments.data.map(payment => typeof payment.invoice === "object" && payment.invoice && !("deleted" in payment.invoice && payment.invoice.deleted)
    ? ours((payment.invoice as Stripe.Invoice).parent?.subscription_details?.metadata?.ef_reference) : null).find(Boolean);
  if (!ref) return null;
  const config = stripeConfig({ forExisting: true });
  return withSalon(ref.salonId, async tx => {
    const known = await tx.billingCustomer.findUnique({ where: { salonId_provider_mode_accountId: { salonId: ref.salonId, provider: "stripe", mode: config.mode, accountId: config.accountId } } });
    return known?.customerId === customerId ? { ...ref, resourceId: charge.id } : null;
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
  const config = stripeConfig({ forExisting: true });
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
