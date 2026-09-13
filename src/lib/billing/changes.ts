import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BillingSubscription } from "@prisma/client";
import { withTenant, type Tx } from "../prisma-tenant";
import { BillingError } from "./catalog";
import { billingConfig } from "./config";
import { assertOwner, enqueue, subscriptionLock } from "./service";
import { billingTermsSchema, quotePlanChange, sameTerms } from "./change-rules";
import { changesEnabled, currentTerms, pendingChangeStates } from "./change-terms";

export function assertChangesAvailable() {
  billingConfig();
  if (!changesEnabled()) throw new BillingError("PLAN_CHANGES_DISABLED", 503);
  if (process.env.MERCADOPAGO_CHECKOUT_PAUSED === "true" || process.env.MERCADOPAGO_PLAN_CHANGES_PAUSED === "true") throw new BillingError("CHECKOUT_PAUSED", 503);
}
export async function occupiedCapacity(tx: Tx, salonId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`professional-capacity:${salonId}`}, 0))`;
  const active = await tx.professional.count({ where: { salonId, active: true } });
  const invites = await tx.userInvite.count({ where: { salonId, role: "PROFESSIONAL", usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  return active + invites;
}
async function eligibleSubscription(tx: Tx, ctx: { salonId: string; userId: string }): Promise<BillingSubscription> {
  await assertOwner(tx, ctx);
  await subscriptionLock(tx, ctx.salonId);
  const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { accessStatus: true } });
  if (salon.accessStatus !== "APPROVED") throw new BillingError("SALON_NOT_APPROVED", 403);
  const sub = await tx.billingSubscription.findFirst({ where: { salonId: ctx.salonId, current: true } });
  if (!sub || !sub.providerId || sub.reviewRequired || sub.delinquentSince || !sub.paidThrough || sub.paidThrough <= new Date()) throw new BillingError("CHANGE_REQUIRES_ACTIVE_SUBSCRIPTION");
  if (sub.providerStatus !== "authorized" || sub.cancelRequestedAt || sub.cancelledAt) {
    const interruptedCycle = sub.cancelledAt && await tx.billingPlanChange.findFirst({ where: { subscriptionId: sub.id, salonId: ctx.salonId, kind: "CYCLE", state: { in: ["CANCELLED", "EXPIRED"] } } });
    if (!interruptedCycle) throw new BillingError("CHANGE_REQUIRES_ACTIVE_SUBSCRIPTION");
  }
  const config = billingConfig();
  if (sub.mode !== config.mode || sub.collectorId !== config.collectorId) throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
  return sub;
}
export async function createChangeQuote(ctx: { salonId: string; userId: string }, selection: unknown, requestKey: string) {
  assertChangesAvailable();
  z.string().uuid().parse(requestKey);
  return withTenant(ctx, async tx => {
    const sub = await eligibleSubscription(tx, ctx);
    const pending = await tx.billingPlanChange.findFirst({ where: { salonId: ctx.salonId, state: { in: pendingChangeStates } } });
    if (pending) throw new BillingError("PLAN_CHANGE_PENDING");
    const source = await currentTerms(tx, sub);
    const period = await tx.billingCharge.findFirst({ where: { subscriptionId: sub.id, salonId: ctx.salonId, status: "approved", periodEnd: sub.paidThrough!, NOT: { providerInvoiceId: { startsWith: "upgrade:" } } }, orderBy: { periodStart: "desc" } });
    if (!period) throw new BillingError("INVALID_CHANGE_PERIOD");
    const quote = quotePlanChange(source, selection, { start: period.periodStart, end: period.periodEnd }, await occupiedCapacity(tx, ctx.salonId));
    if ((sub.cancelRequestedAt || sub.cancelledAt) && quote.kind !== "CYCLE") throw new BillingError("CHANGE_REQUIRES_ACTIVE_SUBSCRIPTION");
    const prior = await tx.billingPlanChange.findUnique({ where: { salonId_requestKey: { salonId: ctx.salonId, requestKey } } });
    if (prior) {
      if (prior.subscriptionId !== sub.id || !sameTerms(billingTermsSchema.parse(prior.toTerms), quote.to)) throw new BillingError("IDEMPOTENCY_MISMATCH");
      return prior;
    }
    return tx.billingPlanChange.create({ data: { id: randomUUID(), salonId: ctx.salonId, subscriptionId: sub.id, requestKey, actorUserId: ctx.userId,
      fromTerms: quote.from, toTerms: quote.to, kind: quote.kind, amountDueCents: quote.amountDueCents,
      quotedAt: quote.quotedAt, expiresAt: quote.expiresAt, periodStart: quote.periodStart, periodEnd: quote.periodEnd, effectiveAt: quote.effectiveAt } });
  });
}
export async function confirmPlanChange(ctx: { salonId: string; userId: string }, id: string) {
  assertChangesAvailable();
  z.string().uuid().parse(id);
  return withTenant(ctx, async tx => {
    await assertOwner(tx, ctx);
    await subscriptionLock(tx, ctx.salonId);
    const change = await tx.billingPlanChange.findFirst({ where: { id, salonId: ctx.salonId } });
    if (!change) throw new BillingError("NOT_FOUND", 404);
    if (change.confirmedAt) return change;
    const sub = await eligibleSubscription(tx, ctx);
    if (change.subscriptionId !== sub.id) throw new BillingError("CHANGE_QUOTE_STALE");
    if (change.state !== "QUOTED" || change.expiresAt <= new Date()) throw new BillingError("CHANGE_QUOTE_EXPIRED");
    if (sub.paidThrough?.getTime() !== change.periodEnd.getTime() || !sameTerms(await currentTerms(tx, sub), billingTermsSchema.parse(change.fromTerms))) throw new BillingError("CHANGE_QUOTE_STALE");
    if (await tx.billingPlanChange.findFirst({ where: { salonId: ctx.salonId, state: { in: pendingChangeStates } } })) throw new BillingError("PLAN_CHANGE_PENDING");
    if (await occupiedCapacity(tx, ctx.salonId) > billingTermsSchema.parse(change.toTerms).agendaLimit) throw new BillingError("PLAN_CAPACITY_TOO_SMALL");
    const confirmed = await tx.billingPlanChange.update({ where: { id }, data: { state: "PREPARING", confirmedAt: new Date() } });
    await tx.billingEvent.create({ data: { subscriptionId: sub.id, salonId: ctx.salonId, key: `change:${id}:confirmed`, type: "PLAN_CHANGE_REQUESTED", detail: `${change.kind}:${id}:owner:${ctx.userId}` } });
    await enqueue(tx, sub);
    return confirmed;
  });
}
export async function cancelPlanChange(ctx: { salonId: string; userId: string }, id: string) {
  billingConfig();
  if (!changesEnabled()) throw new BillingError("PLAN_CHANGES_DISABLED", 503);
  return withTenant(ctx, async tx => {
    await assertOwner(tx, ctx);
    await subscriptionLock(tx, ctx.salonId);
    const change = await tx.billingPlanChange.findFirst({ where: { id, salonId: ctx.salonId } });
    if (!change) throw new BillingError("NOT_FOUND", 404);
    if (["CANCELLED", "EXPIRED"].includes(change.state)) return change;
    if (change.activatedAt || change.paidAt || change.state === "REVIEW" || change.periodEnd <= new Date()) throw new BillingError("CHANGE_CANNOT_CANCEL");
    const updated = await tx.billingPlanChange.update({ where: { id }, data: { state: change.confirmedAt ? "CANCEL_REQUESTED" : "CANCELLED", ...(!change.confirmedAt ? { cancelledAt: new Date() } : {}) } });
    await tx.billingEvent.upsert({ where: { subscriptionId_key: { subscriptionId: change.subscriptionId, key: `change:${id}:cancel-request` } }, update: {}, create: { salonId: ctx.salonId, subscriptionId: change.subscriptionId, key: `change:${id}:cancel-request`, type: "PLAN_CHANGE_CANCEL_REQUESTED", detail: `owner:${ctx.userId}` } });
    await enqueue(tx, { id: change.subscriptionId, salonId: ctx.salonId });
    return updated;
  });
}
