import type { Tx } from "../prisma-tenant";
import { getPlanEntitlement, PlanLimitError, type PlanEntitlement } from "../plan-entitlements";
import { accessState } from "./catalog";
import { changesEnabled, currentTerms, pendingChangeStates } from "./change-terms";
import { billingTermsSchema } from "./change-rules";

/** Read inside the caller's tenant transaction. Flag off never queries unapplied tables. */
export async function effectiveEntitlement(tx: Tx, salonId: string, legacyPlan: string, now = new Date()): Promise<PlanEntitlement> {
  if (process.env.MERCADOPAGO_BILLING_ENABLED !== "true") return getPlanEntitlement(legacyPlan);
  const sub = await tx.billingSubscription.findFirst({ where: { salonId, current: true } });
  if (!sub) return getPlanEntitlement(legacyPlan);
  if (!sub.paidThrough) {
    const previouslyPaid = await tx.billingSubscription.findFirst({ where: { salonId, paidThrough: { not: null } }, select: { id: true } });
    if (!previouslyPaid) return getPlanEntitlement(sub.legacyPlan);
    throw new PlanLimitError("Regularize a assinatura para criar reservas ou adicionar agendas.");
  }
  const state = accessState(sub, now);
  if (["RESTRICTED", "EXPIRED"].includes(state)) throw new PlanLimitError("Regularize a assinatura para criar reservas ou adicionar agendas.");
  const terms = await currentTerms(tx, sub);
  const pending = changesEnabled() ? await tx.billingPlanChange.findFirst({ where: { salonId, subscriptionId: sub.id, state: { in: pendingChangeStates }, kind: { in: ["SCHEDULED", "CYCLE"] } } }) : null;
  // Reserve an accepted lower capacity so later invitations cannot invalidate the scheduled change.
  const capacity = pending ? Math.min(terms.agendaLimit, billingTermsSchema.parse(pending.toTerms).agendaLimit) : terms.agendaLimit;
  return { label: terms.plan, priceCents: terms.amountCents, maxProfessionals: capacity, monthlyAppointments: null,
    features: { MARKETING: true, INVENTORY: true, PACKAGES: true } };
}

export async function assertBillingReservation(tx: Tx, salonId: string, now = new Date()) {
  if (process.env.MERCADOPAGO_BILLING_ENABLED !== "true") return;
  await effectiveEntitlement(tx, salonId, "FREE", now);
}

export async function canPromoteBillingWaitlist(tx: Tx, salonId: string) {
  try { await assertBillingReservation(tx, salonId); return true; }
  catch (e) { if (e instanceof PlanLimitError) return false; throw e; }
}
