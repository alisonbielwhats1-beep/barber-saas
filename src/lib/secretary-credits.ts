import "server-only";
import type { Prisma } from "@prisma/client";
import { withSalon, withTenant, type Tx } from "./prisma-tenant";
import { canStartRequest, creditView, ESTIMATE_WINDOW_DAYS, nextPoint, type CreditKind, type CreditView, type LedgerPoint } from "./secretary-credits-rules";

/** Owner decision 06/10/2026: the Secretária's prepaid requests (rules in secretary-credits-rules.ts). Off unless
 * SALON_SECRETARY_CREDITS_ENABLED=true: then a message (or a recording) needs at least one request left, and each message
 * that finished takes one. Every ledger row is written under a per-salon lock that also opens the RLS write flag (029). */
type Env = Record<string, string | undefined>;
type Actor = { salonId: string; userId: string };
export const creditsEnabled = (env: Env = process.env) => env.SALON_SECRETARY_CREDITS_ENABLED === "true";

export async function creditLock(tx: Tx, salonId: string) {
  await tx.$executeRaw`SELECT set_config('app.credit_write', 'enabled', true)`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`credits:${salonId}`}, 0))`;
}
export async function latestPoint(tx: Tx, salonId: string): Promise<LedgerPoint | null> {
  return tx.secretaryCreditLedger.findFirst({ where: { salonId }, orderBy: { seq: "desc" }, select: { balanceAfter: true, baseAfter: true } });
}
export type CreditRow = { salonId: string; kind: CreditKind; requests: number; requestKey: string; purchaseId?: string; providerPaymentId?: string;
  actorUserId?: string; reason?: string };
/** Appends one row after the latest (call under creditLock). Idempotent by requestKey: a replay returns the row already written. */
export async function appendCredit(tx: Tx, row: CreditRow) {
  const prior = await tx.secretaryCreditLedger.findUnique({ where: { salonId_requestKey: { salonId: row.salonId, requestKey: row.requestKey } } });
  if (prior) return prior;
  const point = nextPoint(await latestPoint(tx, row.salonId), row.kind, row.requests);
  const data: Prisma.SecretaryCreditLedgerUncheckedCreateInput = { ...row, ...point };
  return tx.secretaryCreditLedger.create({ data });
}

/** Before a message or a recording: at least one request left (only with the flag on). */
export async function assertCanStartRequest(actor: Actor, env: Env = process.env) {
  if (!creditsEnabled(env)) return;
  const point = await withTenant(actor, tx => latestPoint(tx, actor.salonId));
  if (!canStartRequest(point)) throw new Error("SECRETARY_CREDITS_EMPTY");
}
/** After a message finished: one request, once per message (`messageKey`). A request already started always finishes, so
 * the balance may end below zero when two ran together. */
export async function debitRequest(actor: Actor, messageKey: string, env: Env = process.env) {
  if (!creditsEnabled(env)) return null;
  return withTenant(actor, async tx => {
    await creditLock(tx, actor.salonId);
    return appendCredit(tx, { salonId: actor.salonId, kind: "USAGE", requests: -1, requestKey: `use:${messageKey}`, actorUserId: actor.userId });
  });
}
/** What the bar shows: balance, the bar's 100%, percent, status and how long it lasts at the salon's pace. */
export async function secretaryCreditView(actor: Actor, now = new Date()): Promise<CreditView> {
  return withTenant(actor, async tx => {
    const since = new Date(now.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000);
    const [point, usedInWindow, first] = await Promise.all([latestPoint(tx, actor.salonId),
      tx.secretaryCreditLedger.count({ where: { salonId: actor.salonId, kind: "USAGE", createdAt: { gte: since } } }),
      tx.secretaryCreditLedger.findFirst({ where: { salonId: actor.salonId, kind: "USAGE" }, orderBy: { seq: "asc" }, select: { createdAt: true } })]);
    return creditView(point, { usedInWindow, firstUsageAt: first?.createdAt ?? null, now });
  });
}
/** HQ only (caller checks): courtesy requests for a salon (presentation salon, partners). */
export async function grantCredits(input: { salonId: string; requests: number; actorUserId: string; reason: string; grantKey: string }) {
  return withSalon(input.salonId, async tx => {
    await creditLock(tx, input.salonId);
    return appendCredit(tx, { salonId: input.salonId, kind: "GRANT", requests: input.requests, requestKey: `grant:${input.grantKey}`,
      actorUserId: input.actorUserId, reason: input.reason });
  });
}
