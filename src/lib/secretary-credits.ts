import "server-only";
import type { Prisma } from "@prisma/client";
import { withSalon, withTenant, type Tx } from "./prisma-tenant";
import { SECRETARY_USAGE_ENTITY } from "./salon-secretary-usage";
import { callMicroUsd, salonPeriodStarts } from "./secretary-spend";
import { canStartRequest, costUnits, creditView, nextPoint, splitCost, type CreditKind, type CreditView, type LedgerPoint } from "./secretary-credits-rules";

/** Owner decisions of 06/10/2026: the Secretária's prepaid credit (rules in secretary-credits-rules.ts). Off unless
 * SALON_SECRETARY_CREDITS_ENABLED=true: then a message or a recording needs credit or free allowance left, each message that
 * finished takes the real cost of its model calls, and each recording the real cost of its transcription (x 10, the free
 * allowance first). Every ledger row is written under a per-salon lock that also opens the RLS write flag (029). */
type Env = Record<string, string | undefined>;
type Actor = { salonId: string; userId: string };
export const creditsEnabled = (env: Env = process.env) => env.SALON_SECRETARY_CREDITS_ENABLED === "true";
/** The fixed exchange rate the charge uses (SALON_SECRETARY_USD_BRL, default 5.60, reviewed monthly). A value outside 1 to 20
 * fails closed (every request is refused) instead of silently charging nothing. */
export function creditUsdBrl(env: Env = process.env) {
  const value = Number(env.SALON_SECRETARY_USD_BRL || 5.6);
  if (!Number.isFinite(value) || value < 1 || value > 20) throw new Error("CREDIT_FX_INVALID");
  return value;
}

export async function creditLock(tx: Tx, salonId: string) {
  await tx.$executeRaw`SELECT set_config('app.credit_write', 'enabled', true)`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`credits:${salonId}`}, 0))`;
}
export async function latestPoint(tx: Tx, salonId: string): Promise<LedgerPoint | null> {
  return tx.secretaryCreditLedger.findFirst({ where: { salonId }, orderBy: { seq: "desc" }, select: { balanceAfter: true, baseAfter: true } });
}
/** The free allowance used in the salon's current month (its own time zone). */
export async function freeUsedThisMonth(tx: Tx, salonId: string, now = new Date()) {
  const salon = await tx.salon.findUniqueOrThrow({ where: { id: salonId }, select: { timezone: true } });
  const { monthStart } = salonPeriodStarts(now, salon.timezone);
  const used = await tx.secretaryCreditLedger.aggregate({ where: { salonId, kind: "USAGE", freeUnits: { gt: 0 }, createdAt: { gte: monthStart } }, _sum: { freeUnits: true } });
  return used._sum.freeUnits ?? 0;
}
export type CreditRow = { salonId: string; kind: CreditKind; units: number; freeUnits?: number; requestKey: string; purchaseId?: string;
  providerPaymentId?: string; actorUserId?: string; reason?: string };
/** Appends one row after the latest (call under creditLock). Idempotent by requestKey: a replay returns the row already written. */
export async function appendCredit(tx: Tx, row: CreditRow) {
  const prior = await tx.secretaryCreditLedger.findUnique({ where: { salonId_requestKey: { salonId: row.salonId, requestKey: row.requestKey } } });
  if (prior) return prior;
  const point = nextPoint(await latestPoint(tx, row.salonId), row.kind, row.units);
  const data: Prisma.SecretaryCreditLedgerUncheckedCreateInput = { ...row, ...point };
  return tx.secretaryCreditLedger.create({ data });
}

/** Before a message or a recording (only with the flag on): first every model call of the salon not charged yet is charged
 * (fails closed: an unreachable ledger refuses the request), then some credit or free allowance must be left. */
export async function assertCanStartRequest(actor: Actor, env: Env = process.env, now = new Date()) {
  if (!creditsEnabled(env)) return;
  await chargePendingCalls(actor, env, now);
  const ok = await withTenant(actor, async tx => canStartRequest(await latestPoint(tx, actor.salonId), await freeUsedThisMonth(tx, actor.salonId, now)));
  if (!ok) throw new Error("SECRETARY_CREDITS_EMPTY");
}
/** Takes `cost` units once (`requestKey`): the month's free allowance first, then the paid credit. A request already started
 * always finishes, so the paid balance may end below zero. Nothing is written for a cost of zero. */
export async function debitUnits(actor: Actor, requestKey: string, cost: number, now = new Date()) {
  if (cost <= 0) return null;
  return withTenant(actor, async tx => {
    await creditLock(tx, actor.salonId);
    const { free, paid } = splitCost(cost, await freeUsedThisMonth(tx, actor.salonId, now));
    return appendCredit(tx, { salonId: actor.salonId, kind: "USAGE", units: paid === 0 ? 0 : -paid, freeUnits: free, requestKey, actorUserId: actor.userId });
  });
}
/** How far back the sweep looks for model calls not charged yet. */
export const CHARGE_LOOKBACK_MS = 48 * 3600_000;
/** Calls before the credit went live (owner, 06/10/2026: the pilot's test night) are never charged. */
export const CHARGING_STARTS_AT = new Date("2026-10-06T15:00:00Z");
/** A call that succeeded without reported usage is charged as an average model call (never free). */
export const UNREPORTED_CALL_MICRO_USD = 3_000;
/** Charges every model call of the salon not charged yet: a message's own calls, those of a follow-up answered in a child
 * conversation, a repair, a call whose message then failed, or one left behind by a crash. Each call is charged once, by its
 * own record (call:<id>), in one transaction under the salon's credit lock: the month's free allowance first, then the paid
 * credit. Returns how many calls were charged. */
export async function chargePendingCalls(actor: Actor, env: Env = process.env, now = new Date()) {
  if (!creditsEnabled(env)) return 0;
  const fx = creditUsdBrl(env);
  return withTenant(actor, async tx => {
    await creditLock(tx, actor.salonId);
    const calls = await tx.auditLog.findMany({ where: { salonId: actor.salonId, entityType: SECRETARY_USAGE_ENTITY, action: "MODEL_CALL_FINISHED",
      createdAt: { gte: new Date(Math.max(now.getTime() - CHARGE_LOOKBACK_MS, CHARGING_STARTS_AT.getTime())) } }, select: { entityId: true, metadata: true }, orderBy: { createdAt: "asc" }, take: 500 });
    if (!calls.length) return 0;
    const keys = calls.map(call => `call:${call.entityId}`);
    const done = new Set((await tx.secretaryCreditLedger.findMany({ where: { salonId: actor.salonId, requestKey: { in: keys } }, select: { requestKey: true } })).map(row => row.requestKey));
    let freeUsed = await freeUsedThisMonth(tx, actor.salonId, now), charged = 0;
    for (const call of calls) {
      const key = `call:${call.entityId}`, metadata = (call.metadata ?? {}) as Record<string, unknown>;
      if (done.has(key)) continue;
      const micro = callMicroUsd(metadata) || (metadata.status === "SUCCEEDED" ? UNREPORTED_CALL_MICRO_USD : 0), cost = costUnits(micro, fx);
      if (cost <= 0) continue;
      const { free, paid } = splitCost(cost, freeUsed);
      await appendCredit(tx, { salonId: actor.salonId, kind: "USAGE", units: paid === 0 ? 0 : -paid, freeUnits: free, requestKey: key, actorUserId: actor.userId });
      freeUsed += free; charged++;
    }
    return charged;
  });
}
/** After a recording was transcribed (sent or not): its reported cost (the reservation's worst case when none came back). */
export async function chargeRecording(actor: Actor, input: { recordingKey: string; microUsd: number }, env: Env = process.env) {
  if (!creditsEnabled(env)) return null;
  return debitUnits(actor, `voice:${input.recordingKey}`, costUnits(input.microUsd, creditUsdBrl(env)));
}
/** Exactly what the customer sees: a percentage and a status (no amounts, no counts, no days). */
export async function secretaryCreditView(actor: Actor, now = new Date()): Promise<CreditView> {
  return withTenant(actor, async tx => creditView(await latestPoint(tx, actor.salonId), await freeUsedThisMonth(tx, actor.salonId, now)));
}
/** HQ only (caller checks): courtesy credit for a salon (presentation salon, partners), in units of R$ 0,0001. */
export async function grantCredits(input: { salonId: string; units: number; actorUserId: string; reason: string; grantKey: string }) {
  return withSalon(input.salonId, async tx => {
    await creditLock(tx, input.salonId);
    return appendCredit(tx, { salonId: input.salonId, kind: "GRANT", units: input.units, requestKey: `grant:${input.grantKey}`,
      actorUserId: input.actorUserId, reason: input.reason });
  });
}
