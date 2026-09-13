import type { BillingSubscription } from "@prisma/client";
import type { Tx } from "../prisma-tenant";
import { changesEnabled } from "./change-terms";

/** Include future replacements, even reviewed ones or a promotion racing a stale page. */
export async function cancellationSubscriptions(tx: Tx, root: BillingSubscription) {
  const subscriptions = [root];
  if (!changesEnabled()) return subscriptions;
  const seen = new Set([root.id]);
  let frontier = [root.id];
  while (frontier.length) {
    const changes = await tx.billingPlanChange.findMany({ where: { salonId: root.salonId, subscriptionId: { in: frontier }, replacementSubscriptionId: { not: null } }, include: { replacement: true } });
    frontier = [];
    for (const change of changes) {
      const next = change.replacement;
      if (!next || next.salonId !== root.salonId || seen.has(next.id)) continue;
      seen.add(next.id); subscriptions.push(next); frontier.push(next.id);
    }
  }
  return subscriptions;
}

export function renewalCancellationStatus(subscriptions: Pick<BillingSubscription, "cancelledAt" | "cancelRequestedAt">[], preparingCycle = false): "AVAILABLE" | "PENDING" | "CANCELLED" {
  const renewable = subscriptions.filter(sub => !sub.cancelledAt);
  if (!renewable.length) return preparingCycle ? "AVAILABLE" : "CANCELLED";
  return renewable.some(sub => !sub.cancelRequestedAt) ? "AVAILABLE" : "PENDING";
}
