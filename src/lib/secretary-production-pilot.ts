import { z } from "zod";
import { withTenant } from "./prisma-tenant";
import { budgetRefusal, salonSpend } from "./secretary-spend";
import { creditsEnabled } from "./secretary-credits";

type Env = Record<string, string | undefined>;
type Actor = { salonId: string; userId: string };

/** Owner decision 05/10/2026: the Secretária goes to Production ONLY for the presentation salon's owner (a pilot). Off unless
 * every condition holds: Production, SALON_SECRETARY_ENABLED and SALON_SECRETARY_PRODUCTION_PILOT. Then the exact salon+user
 * pairs of SALON_SECRETARY_ALLOWED_ACTORS (1 to 5) are the only ones admitted (any other salon, user or a malformed list is
 * refused), and the salon's daily and monthly spend caps (secretary-spend.ts) stop new turns and recordings once reached.
 * Never a replacement for membership, role or domain checks. */
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

/** Today's and this month's spend of the salon (its own time zone), in micro-USD: model calls and voice (secretary-spend.ts). */
export async function salonSpendNow(actor: Actor, now = new Date()) {
  return withTenant(actor, tx => salonSpend(tx, actor.salonId, now));
}
/** Owner decisions 05/10 and 06/10/2026: refuses a new turn or recording once the salon's day (safety cap) or month (the wallet)
 * reached its cap. In the Production pilot, and wherever prepaid requests are on (a recording that is never sent costs without
 * using a request: the caps bound it). */
export async function assertSecretaryBudget(actor: Actor, env: Env = process.env, now = new Date()) {
  if (!productionPilotActive(env) && !creditsEnabled(env)) return;
  const refusal = budgetRefusal(await salonSpendNow(actor, now), env);
  if (refusal) throw new Error(refusal);
}
