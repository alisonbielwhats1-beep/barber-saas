import type { CapabilitySelection, SelectedOperation, ServicePatch } from "@everflair/salon-secretary";
import { sameName, withoutArticle } from "./name-search";
import { withTenant } from "./prisma-tenant";
import { findCatalogServices, type ServiceActor } from "./service-catalog";
import { serviceFields } from "./service-contract";

/** Owner decision (04/10/2026, "nome repetido vira alteração"): the Secretary never creates a second service with the name
 * of one the salon already has. A service.create whose name is an existing service's (the same name up to case, accents
 * and a leading article: sameName) becomes the service.change of that service: the name stays, the price and the duration
 * said become the change, shown and confirmed like any other change. A name that only contains an existing one ("Escova Lisa
 * Longa" next to "Escova Lisa") is a new service. Found when GPT-6 Luna read "Coloca a Escova Lisa por sessenta e cinco
 * reais." as a create and offered a duplicate (Golden GF07, 04/10/2026); no unique constraint on Service.name stops it.
 * Where it applies: a new plan's actions (withExistingServiceTargets) and every services session (existingServiceInterpretation).
 * A correction routed to a plan of several actions that calls the changed action a create is left out and asked again: the
 * routing never reclassifies an action (conversation-routing.ts). Known limit: a create already under way that is renamed to
 * an existing name stays a create. */

/** The catalog name of the salon's service called `name`, if there is one (the first by id when several share it). */
export async function existingServiceName(actor: ServiceActor, name: string): Promise<string | undefined> {
  const term = serviceFields.name.safeParse(withoutArticle(name));
  if (!term.success) return undefined; // An invalid name stays the create flow's own error.
  const rows = await withTenant(actor, tx => findCatalogServices(tx, actor, term.data));
  return rows.find(row => sameName(row.name, name))?.name;
}

/** The change of the existing service a model's create named. */
export const existingServiceChange = (op: SelectedOperation, existing: string): SelectedOperation =>
  ({ ...op, operation: "service.change", target_name: existing, name: null });

/** A new plan's selection with every service.create of an existing service as its service.change, before any plan action
 * exists (so the action, its label and its preview all say "alterar"). */
export async function withExistingServiceTargets(actor: ServiceActor, selection: CapabilitySelection): Promise<CapabilitySelection> {
  if (!selection.operations.some(op => op.operation === "service.create" && op.name)) return selection;
  const operations: SelectedOperation[] = [];
  for (const op of selection.operations) {
    const existing = op.operation === "service.create" && op.name ? await existingServiceName(actor, op.name) : undefined;
    operations.push(existing ? existingServiceChange(op, existing) : op);
  }
  return { ...selection, operations };
}

/** A services session's interpretation (the C4 path without a plan, a plan action's own session, the fast path): a create
 * of an existing service in a fresh session is that service's change; in a session already changing `target`, a create of
 * the same service or of none is that same change. Anything else is returned as it came. */
export async function existingServiceInterpretation(actor: ServiceActor, interpretation: ServicePatch,
  session: { operation?: "service.create" | "service.change"; target?: string }): Promise<ServicePatch> {
  if ((interpretation.operation ?? session.operation ?? "service.create") !== "service.create") return interpretation;
  const { name, ...rest } = interpretation;
  if (session.operation === "service.change")
    return !name || (session.target && sameName(name, session.target)) ? { ...rest, operation: "service.change", target_name: undefined } : interpretation;
  if (session.operation || !name) return interpretation;
  const existing = await existingServiceName(actor, name);
  return existing ? { ...rest, operation: "service.change", target_name: existing } : interpretation;
}
