import "server-only";
import type { Prisma } from "@prisma/client";
import { withSalon, withTenant, type Tx } from "./prisma-tenant";
import { SECRETARY_USAGE_ENTITY } from "./salon-secretary-usage";
import { callMicroUsd, envNumber, salonPeriodStarts } from "./secretary-spend";
import { canStartRequest, costUnits, creditView, nextPoint, splitCost, type CreditKind, type CreditView, type LedgerPoint } from "./secretary-credits-rules";

/** Owner decisions of 06/10/2026: the Secretária's prepaid credit (rules in secretary-credits-rules.ts). Off unless
 * SALON_SECRETARY_CREDITS_ENABLED=true: then a message or a recording needs credit or free allowance left, each message that
 * finished takes the real cost of its model calls, and each recording the real cost of its transcription (x 10, the free
 * allowance first). Every ledger row is written under a per-salon lock that also opens the RLS write flag (029). */
type Env = Record<string, string | undefined>;
type Actor = { salonId: string; userId: string };
export const creditsEnabled = (env: Env = process.env) => env.SALON_SECRETARY_CREDITS_ENABLED === "true";
/** The fixed exchange rate the charge uses (SALON_SECRETARY_USD_BRL, default 5.60, reviewed monthly). */
export const creditUsdBrl = (env: Env = process.env) => envNumber(env.SALON_SECRETARY_USD_BRL, 5.6, 20);

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

/** Before a message or a recording: some credit or free allowance left (only with the flag on). */
export async function assertCanStartRequest(actor: Actor, env: Env = process.env, now = new Date()) {
  if (!creditsEnabled(env)) return;
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
/** Clock tolerance between this server and the database when looking for a message's model calls. */
export const CHARGE_CLOCK_SKEW_MS = 5_000;
/** After a message finished: the real cost of each model call of that conversation made since the message started. Each call
 * is charged once, by its own record (call:<id>), so a nearby message or a clock difference never charges a call twice. */
export async function chargeMessage(actor: Actor, input: { sessionId: string; startedAt: Date }, env: Env = process.env) {
  if (!creditsEnabled(env)) return 0;
  const calls = await withTenant(actor, tx => tx.auditLog.findMany({ where: { salonId: actor.salonId, entityType: SECRETARY_USAGE_ENTITY, action: "MODEL_CALL_FINISHED",
    createdAt: { gte: new Date(input.startedAt.getTime() - CHARGE_CLOCK_SKEW_MS) }, metadata: { path: ["session_id"], equals: input.sessionId } },
    select: { entityId: true, metadata: true }, take: 50 }));
  let charged = 0;
  for (const call of calls) if (await debitUnits(actor, `call:${call.entityId}`, costUnits(callMicroUsd(call.metadata), creditUsdBrl(env)))) charged++;
  return charged;
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
