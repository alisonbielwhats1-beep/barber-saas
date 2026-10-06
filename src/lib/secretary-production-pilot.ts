import { z } from "zod";
import { secretaryModelProfile } from "@everflair/salon-secretary";
import { withTenant } from "./prisma-tenant";
import { SECRETARY_USAGE_ENTITY } from "./salon-secretary-usage";
import { TRANSCRIBE_AUDIT_ENTITY } from "./secretary-transcribe";
import { dateKeyInTimeZone, startOfDateInTimeZone } from "./time";

type Env = Record<string, string | undefined>;
type Actor = { salonId: string; userId: string };

/** Owner decision 05/10/2026: the Secretária goes to Production ONLY for the presentation salon's owner (a pilot). Off unless
 * every condition holds: Production, SALON_SECRETARY_ENABLED and SALON_SECRETARY_PRODUCTION_PILOT. Then the exact salon+user
 * pairs of SALON_SECRETARY_ALLOWED_ACTORS (1 to 5) are the only ones admitted (any other salon, user or a malformed list is
 * refused), and a daily spend cap per salon (SALON_SECRETARY_DAILY_BUDGET_USD, default US$ 1) stops new turns and recordings
 * once the day's model calls and voice reservations reach it. Never a replacement for membership, role or domain checks. */
export const productionPilotActive = (env: Env = process.env) =>
  env.VERCEL_ENV === "production" && env.SALON_SECRETARY_ENABLED === "true" && env.SALON_SECRETARY_PRODUCTION_PILOT === "true";

const identifier = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const pairs = z.array(z.object({ salonId: identifier, userId: identifier }).strict()).min(1).max(5);
/** The admitted pairs of the pilot, or undefined when the list is missing or malformed (then nobody is admitted). */
export function pilotActors(env: Env = process.env) {
  try { const parsed = pairs.safeParse(JSON.parse(env.SALON_SECRETARY_ALLOWED_ACTORS ?? "")); return parsed.success ? parsed.data : undefined; }
  catch { return undefined; }
}
export function assertPilotActor(actor: Actor, env: Env = process.env) {
  if (!pilotActors(env)?.some(pair => pair.salonId === actor.salonId && pair.userId === actor.userId)) throw new Error("SECRETARY_NOT_AVAILABLE");
}

export const DEFAULT_DAILY_BUDGET_USD = 1;
export function dailyBudgetMicroUsd(env: Env = process.env) {
  const value = Number(env.SALON_SECRETARY_DAILY_BUDGET_USD ?? DEFAULT_DAILY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 && value <= 20 ? Math.round(value * 1e6) : DEFAULT_DAILY_BUDGET_USD * 1e6;
}
const counter = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
/** Upper-bound price of one finished model call from its recorded tokens and the registry's prices (an unpriced model counts at
 * the dearest registered rates). */
export function callMicroUsd(metadata: unknown) {
  const m = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  let pricing: { inputUsdPerMillion: number; cachedUsdPerMillion: number; cacheWriteUsdPerMillion: number | null; outputUsdPerMillion: number } | null = null;
  try { pricing = secretaryModelProfile(String(m.model_id_requested ?? "")).pricing; } catch { pricing = null; }
  const p = pricing ?? { inputUsdPerMillion: 0.45, cachedUsdPerMillion: 0.45, cacheWriteUsdPerMillion: 0.45, outputUsdPerMillion: 2.40 };
  const cached = counter(m.cached_input_tokens), input = Math.max(0, counter(m.input_tokens) - cached);
  return input * p.inputUsdPerMillion + cached * p.cachedUsdPerMillion + counter(m.cache_write_tokens) * (p.cacheWriteUsdPerMillion ?? p.inputUsdPerMillion)
    + counter(m.output_tokens) * p.outputUsdPerMillion;
}
/** Today's spend of the salon (its own time zone), in micro-USD: finished model calls plus voice reservations (worst case). */
export async function salonSpendToday(actor: Actor, now = new Date()) {
  return withTenant(actor, async tx => {
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: actor.salonId }, select: { timezone: true } });
    const since = startOfDateInTimeZone(dateKeyInTimeZone(now, salon.timezone), salon.timezone);
    const calls = await tx.auditLog.findMany({ where: { salonId: actor.salonId, entityType: SECRETARY_USAGE_ENTITY, action: "MODEL_CALL_FINISHED", createdAt: { gte: since } },
      select: { metadata: true }, take: 20000 });
    const voice = await tx.auditLog.findMany({ where: { salonId: actor.salonId, entityType: TRANSCRIBE_AUDIT_ENTITY, action: "RESERVE", createdAt: { gte: since } },
      select: { metadata: true }, take: 5000 });
    const reserved = voice.reduce((sum, row) => sum + counter((row.metadata as Record<string, unknown> | null)?.worst_case_micro_usd), 0);
    return Math.ceil(calls.reduce((sum, row) => sum + callMicroUsd(row.metadata), 0) + reserved);
  });
}
/** Refuses a new turn or recording once the day's spend reached the cap (only in the Production pilot). */
export async function assertSecretaryDailyBudget(actor: Actor, env: Env = process.env, now = new Date()) {
  if (!productionPilotActive(env)) return;
  if (await salonSpendToday(actor, now) >= dailyBudgetMicroUsd(env)) throw new Error("SECRETARY_DAILY_BUDGET");
}
