import { z } from "zod";
import { assertPilotActor, productionPilotActive } from "./secretary-production-pilot";

type Actor = { salonId: string; userId: string; role?: string };
type Environment = Record<string, string | undefined>;
const identifier = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const allowlist = z.array(z.object({ salonId: identifier, userId: identifier }).strict());

/** Additional admission gate, never a replacement for environment, membership or domain authorization.
 * Staging requires exact actor pairs. Local historical fixtures keep their existing environment gate
 * unless an explicit allowlist is supplied. No credentials or client-provided identity are accepted.
 */
export function assertSecretaryRolloutAccess(actor: Actor, env: Environment = process.env): void {
  const deny = () => { throw new Error("SECRETARY_NOT_AVAILABLE"); };
  // Owner 05/10 and 07/10: in Production the allowlisted pairs and, with SALON_SECRETARY_OPEN_TO_OWNERS, every salon's owner.
  if (productionPilotActive(env)) { assertPilotActor(actor, env); return; }
  if (env.SALON_SECRETARY_ENABLED !== "true" || env.VERCEL_ENV === "production" ||
      !["development", "test", "staging"].includes(env.APP_ENV ?? "")) deny();
  const raw = env.SALON_SECRETARY_ALLOWED_ACTORS;
  if (raw === undefined && env.APP_ENV !== "staging") return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw ?? ""); } catch { deny(); }
  const result = allowlist.safeParse(parsed);
  if (!result.success || !result.data.some(pair => pair.salonId === actor.salonId && pair.userId === actor.userId)) deny();
}
