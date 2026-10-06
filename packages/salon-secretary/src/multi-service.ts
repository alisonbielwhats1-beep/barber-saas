import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { foldedLiteral } from "./literal-match";

/** P2b (flag SALON_SECRETARY_MULTI_SERVICE, default off): ONE appointment with several services the owner said ("corte e
 * barba", "pé e mão") and ONE professional, on appointment.create and availability.get (matrix C02 + C30). `service_names`
 * holds the services as the owner wrote them; service_name keeps meaning a single service. Published only with the flag and
 * only in the wire families of those two operations; a value on any other operation (or with the flag off) is
 * CAPABILITY_FIELD_MISMATCH. The backend proves each literal, resolves each name (homonyms and a catalog combo are asked,
 * never picked), requires one professional who performs every service, checks availability for the summed duration the
 * domain computes, and only an authenticated confirmation writes (one appointment, the domain's own createVisit). Services
 * with different professionals in one visit are out of scope: asked, never split silently. */
export const multiServiceEnabled = () => process.env.SALON_SECRETARY_MULTI_SERVICE === "true";
export const multiServiceOperations = ["appointment.create", "availability.get"] as const;
export const multiServiceFields = {
  service_names: z.array(z.string().trim().min(2).max(200)).min(1).max(10)
    .describe("2+ serviços do MESMO atendimento, um profissional, como escritos; service_name null."),
};
export const multiServiceKeys = ["service_names"] as const;
export type MultiServiceKey = (typeof multiServiceKeys)[number];
/** Capability guard (validateSelection): a service list only on appointment.create/availability.get and only with the flag. */
export function assertMultiServiceScope(op: { operation: string; released_slot_of?: string | null } & Partial<Record<MultiServiceKey, unknown>>) {
  if (multiServiceKeys.every(key => op[key] == null)) return;
  if (!multiServiceEnabled() || !(multiServiceOperations as readonly string[]).includes(op.operation)) throw Error("CAPABILITY_FIELD_MISMATCH");
  // The T21 create in a released slot books the one service of that slot: a list there is out of scope, never dropped.
  if (op.released_slot_of != null) throw Error("CAPABILITY_FIELD_MISMATCH");
}
const normalizations = new AsyncLocalStorage<(code: string) => void>();
/** Codes-only observer of the service-list normalizations of one message (the router trace); C4 R-A: also the satisfied edges. */
export function withServiceListObserver<T>(sink: (code: string) => void, task: () => T): T { return normalizations.run(sink, task); }
/** One normalization code for this message's observer (no-op outside a message). */
export const reportNormalization = (code: string) => { normalizations.getStore()?.(code); };
/** C4 R-B (flag on): a list on an operation that takes none (any operation but a create outside a released slot or an
 * availability read) holding exactly ONE entry equal (folded) to that operation's own service_name restates it: the list is
 * dropped (SERVICE_NAMES_REDUNDANT), nothing is lost and the operation is kept. Any other list there (another service, two
 * entries, no service_name) stays CAPABILITY_FIELD_MISMATCH (assertMultiServiceScope). Flag off: unchanged (always refused). */
export function withoutRedundantServiceList<T extends { operation: string; released_slot_of?: string | null; service_name?: string | null; service_names?: readonly string[] | null }>(op: T): T {
  if (!multiServiceEnabled() || op.service_names == null || (multiServiceOperations as readonly string[]).includes(op.operation) && op.released_slot_of == null) return op;
  const [only, ...rest] = op.service_names;
  if (rest.length || typeof only !== "string" || typeof op.service_name !== "string" || !foldedLiteral(only) || foldedLiteral(only) !== foldedLiteral(op.service_name)) return op;
  normalizations.getStore()?.("SERVICE_NAMES_REDUNDANT");
  return { ...op, service_names: null } as T;
}
