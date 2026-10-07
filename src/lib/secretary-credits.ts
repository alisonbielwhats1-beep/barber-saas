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
/** How many calls one sweep transaction charges (each is one insert; the batch stays far under the 5 s transaction limit). */
export const CHARGE_BATCH = 50;
/** How many batches one sweep runs at most; whatever is left is charged by the next sweep (before and after every request). */
export const CHARGE_MAX_ROUNDS = 20;
/** The most finished calls one sweep reads from the 48 h window (the daily cap allows a few hundred a day). */
export const CHARGE_WINDOW_ROWS = 5_000;
/** Charges every model call of the salon not charged yet: a message's own calls, those of a follow-up answered in a child
 * conversation, a repair, a call whose message then failed, or one left behind by a crash. Each call is charged once, by its
 * own record (call:<id>), under the salon's credit lock: the month's free allowance first, then the paid credit. Validation
 * review 07/10/2026: only the calls still uncharged fill a batch (the oldest first), in batches of CHARGE_BATCH per
 * transaction, so a busy salon never leaves its newest calls behind already-charged ones, and a backlog never fails the
 * request with a transaction timeout. Returns how many calls were charged. */
export async function chargePendingCalls(actor: Actor, env: Env = process.env, now = new Date()) {
  if (!creditsEnabled(env)) return 0;
  const fx = creditUsdBrl(env);
  let charged = 0;
  for (let round = 0; round < CHARGE_MAX_ROUNDS; round++) {
    const batch = await chargeBatch(actor, fx, now);
    charged += batch.charged;
    if (!batch.more) break;
  }
  return charged;
}
async function chargeBatch(actor: Actor, fx: number, now: Date) {
  return withTenant(actor, async tx => {
    await creditLock(tx, actor.salonId);
    const calls = await tx.auditLog.findMany({ where: { salonId: actor.salonId, entityType: SECRETARY_USAGE_ENTITY, action: "MODEL_CALL_FINISHED",
      createdAt: { gte: new Date(Math.max(now.getTime() - CHARGE_LOOKBACK_MS, CHARGING_STARTS_AT.getTime())) } },
      select: { entityId: true, metadata: true }, orderBy: { createdAt: "asc" }, take: CHARGE_WINDOW_ROWS });
    const priced = calls.map(call => {
      const metadata = (call.metadata ?? {}) as Record<string, unknown>;
      const micro = callMicroUsd(metadata) || (metadata.status === "SUCCEEDED" ? UNREPORTED_CALL_MICRO_USD : 0);
      return { key: `call:${call.entityId}`, cost: costUnits(micro, fx) };
    }).filter(call => call.cost > 0);
    if (!priced.length) return { charged: 0, more: false };
    const done = new Set<string>();
    for (let at = 0; at < priced.length; at += 1_000) {
      const rows = await tx.secretaryCreditLedger.findMany({ where: { salonId: actor.salonId, requestKey: { in: priced.slice(at, at + 1_000).map(call => call.key) } },
        select: { requestKey: true } });
      for (const row of rows) done.add(row.requestKey);
    }
    // One row per key even if a call record were ever written twice (the unique key would fail the whole sweep).
    const pending = [...new Map(priced.filter(call => !done.has(call.key)).map(call => [call.key, call])).values()];
    const batch = pending.slice(0, CHARGE_BATCH);
    if (!batch.length) return { charged: 0, more: false };
    // Under the lock nothing else writes this salon's ledger: the running point is kept in memory, one insert per call.
    let freeUsed = await freeUsedThisMonth(tx, actor.salonId, now), point = await latestPoint(tx, actor.salonId);
    for (const call of batch) {
      const { free, paid } = splitCost(call.cost, freeUsed), units = paid === 0 ? 0 : -paid;
      point = nextPoint(point, "USAGE", units);
      await tx.secretaryCreditLedger.create({ data: { salonId: actor.salonId, kind: "USAGE", units, freeUnits: free, requestKey: call.key,
        actorUserId: actor.userId, ...point } });
      freeUsed += free;
    }
    return { charged: batch.length, more: pending.length > batch.length };
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
