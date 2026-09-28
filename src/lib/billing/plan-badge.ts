import "server-only";
import type { Tx } from "../prisma-tenant";
import { accessState } from "./catalog";
import { cancellationSubscriptions, renewalCancellationStatus } from "./cancellation";
import { changesEnabled, currentTerms, pendingChangeStates } from "./change-terms";
import { planBadgeFor, reactivationState, type PlanBadge } from "./presentation";
import { billingTermsSchema } from "./change-rules";

/**
 * Situation of the current contract for the owner's header shortcut, read in
 * the caller's tenant transaction with the same rules as the subscription API.
 */
export async function loadPlanBadge(tx: Tx, salonId: string, legacyLabel: string | null): Promise<PlanBadge> {
  const sub = await tx.billingSubscription.findFirst({ where: { salonId, current: true } });
  if (!sub) return planBadgeFor(legacyLabel, null);
  const [terms, chain, change] = await Promise.all([
    currentTerms(tx, sub),
    cancellationSubscriptions(tx, sub),
    changesEnabled() ? tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId, confirmedAt: { not: null } }, orderBy: [{ quotedAt: "desc" }, { id: "desc" }] }) : null,
  ]);
  return planBadgeFor(legacyLabel, {
    plan: terms.plan, agendaLimit: terms.agendaLimit, state: accessState(sub), reviewRequired: sub.reviewRequired,
    renewal: renewalCancellationStatus(chain, change?.kind === "CYCLE" && change.state === "PREPARING"),
    changePending: change ? pendingChangeStates.includes(change.state) : false,
    reactivation: change ? reactivationState({ kind: change.kind, state: change.state, from: billingTermsSchema.parse(change.fromTerms), to: billingTermsSchema.parse(change.toTerms) }, pendingChangeStates.includes(change.state)) : null,
  });
}
