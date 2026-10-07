import "server-only";
import { assertSecretaryEnvironment } from "./salon-secretary-runtime";
import { assertSecretaryRolloutAccess } from "./secretary-rollout";

/** Whether this salon+user may use the Secretária (environment and rollout gates, the same as the chat). Owner 06/10/2026:
 * its prepaid requests are shown and sold only to whoever can use it, never to a salon outside the rollout. */
export function secretaryAvailableTo(actor: { salonId: string; userId: string; role?: string }) {
  try { assertSecretaryEnvironment(); assertSecretaryRolloutAccess(actor); return true; } catch { return false; }
}
