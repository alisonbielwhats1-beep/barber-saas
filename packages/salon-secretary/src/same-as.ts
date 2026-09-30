import { z } from "zod";
import { dependencyGraph } from "./dependency-graph";

/** C5 cross-action references (rec 14), flag SALON_SECRETARY_SAME_AS (default off). "Marca o João quinta às 10h
 * e o Fábio no mesmo dia às 11h", "cancela a Amanda e passa o Fábio pro horário dela", "avisa ela": an operation of
 * a NEW/ADD envelope may say that one of its fields is the value of ANOTHER action of the same request (or of the
 * active plan): same_as = [{field, item_key, literal}]. It is a data link, never an execution dependency: the backend
 * prepares the referenced action first and copies ITS accepted value (never Luna's raw value); an unknown value
 * waits, an unproven or contradicted one is asked. Linked actions share one confirmation group. With the flag off
 * the wire, the prompt and every recorded output are the historical ones, and a reference is refused. */
export const sameAsEnabled = () => process.env.SALON_SECRETARY_SAME_AS === "true";
/** P3a (flag SALON_SECRETARY_REFERENCES_V2, default off; its same_as parts also need SALON_SECRETARY_SAME_AS): a value said once
 * for coordinated actions (distributive), a change's own origin ("pra sexta no mesmo horário"), "o mesmo serviço", a read as a
 * source (its day/professional; one of its rows by a closed-class ordinal), "meu horário" and the slot a reschedule frees. Off:
 * the historical fields, matrix, wire and prompt, byte for byte. */
export const referencesV2Enabled = () => process.env.SALON_SECRETARY_REFERENCES_V2 === "true";
/** The historical (published with the V2 flag off) reference fields; V2 adds `service` (D3). */
export const sameAsFields = ["date", "time", "professional", "customer"] as const;
export const sameAsFieldsV2 = [...sameAsFields, "service"] as const;
export type SameAsField = typeof sameAsFieldsV2[number];
const itemKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const literal = z.string().min(1).max(600).regex(/\S/);
// A service reference decodes only with the V2 flag: off, it fails exactly where it failed before (the enum).
const referenceField = z.enum(sameAsFieldsV2).refine(field => field !== "service" || referencesV2Enabled());
export const sameAsReference = z.object({ field: referenceField, item_key: itemKey, literal }).strict();
export type SameAsReference = z.infer<typeof sameAsReference>;
/** Decoder view: at most one reference per field (checked per operation). */
export const sameAsTransport = z.array(sameAsReference).max(4).nullable();

/** The rule, stated once inside the field it governs (rec 15): the wire description. */
export const sameAsInstructions = 'Valor igual ao de outra ação do pedido ou do plano ativo ("no mesmo dia"; "no horário dela" = date e time; "com ela"): item_key dessa ação; o backend copia o valor aceito dela, então não preencha o campo aqui. Criar no horário liberado por um cancelamento segue released_slot_of; passar/remarcar para ele alguém que já tem horário é appointment.change com same_as date e time no cancelamento. literal: só a expressão de referência. Sem referência: null.';

/** V2: the same rule plus the new link kinds, stated once. The released slot itself is the catalog's rule (released_slot_of).
 * C4 R-B: the Candidate 3 rule for moving someone who ALREADY has an appointment into a cancellation's slot (appointment.change
 * with same_as date/time, never a create in the released slot) is stated again; its bytes are paid by wording only (the field is
 * nullable, so "Sem referência: null." restated the schema). */
export const sameAsInstructionsV2 = "Valor de outra ação do pedido ou plano ativo ('no mesmo dia'; 'no horário dela' = date e time; 'com ela'; 'pro mesmo serviço' = service): item_key dela; o backend copia o valor aceito, campo null. Dito uma vez para várias ações ('marca X e Y amanhã'): nas outras, o mesmo literal. Remarcação no próprio dia/horário ('pra sexta no mesmo horário'): item_key dela mesma. Consulta da agenda é fonte de date/professional e, com uma linha ou 'o primeiro/o último', de customer. Passar quem já tem horário pro de um cancelamento: appointment.change, same_as date e time nele. literal: só a expressão de referência.";

type Schema = Record<string, unknown>;
/** Hand-written compact schema; `literalSchema` is the exact published literal schema (shared by $defs compaction).
 * P3a step 0: one enum and one description for every operation family, so the compaction emits it as ONE $def. */
export function sameAsWire(literalSchema: Schema): Schema {
  const v2 = referencesV2Enabled();
  // The item_key string schema is the one depends_on items publish (one shared $def).
  const item = { type: "object", properties: { field: { type: "string", enum: [...v2 ? sameAsFieldsV2 : sameAsFields] }, item_key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,31}$" },
    literal: literalSchema }, required: ["field", "item_key", "literal"], additionalProperties: false };
  return { anyOf: [{ type: "array", items: item }, { type: "null" }], description: v2 ? sameAsInstructionsV2 : sameAsInstructions };
}

const writes = ["appointment.create", "appointment.change", "schedule.block"] as const;
const reads = ["appointment.list", "appointment.read", "availability.get"] as const;
type HistoricalField = typeof sameAsFields[number];
/** Operations whose field may FOLLOW a reference. A change never changes its professional: that reference is accepted
 * and kept as a no-op (the preview shows the professional). A customer reference of a change/cancel locates it. */
export const sameAsTargets: Readonly<Record<HistoricalField, readonly string[]>> = {
  date: writes, time: writes, professional: writes,
  customer: ["appointment.create", "appointment.change", "appointment.cancel", "customer.message"],
};
/** Operations whose accepted value a reference may COPY (a cancellation: the slot and people of its appointment). */
export const sameAsSources: Readonly<Record<HistoricalField, readonly string[]>> = {
  date: [...writes, "appointment.cancel"], time: [...writes, "appointment.cancel"], professional: [...writes, "appointment.cancel"],
  customer: ["appointment.create", "appointment.change", "appointment.cancel"],
};
/** V2: a create may follow a service (D3: of a create, or of the appointment a change/cancel located); a read is a source of
 * its accepted filters (date, professional) and of ONE of its rows (customer: a single row or a closed-class ordinal, D2). */
export const sameAsTargetsV2: Readonly<Record<SameAsField, readonly string[]>> = { ...sameAsTargets, service: ["appointment.create"] };
export const sameAsSourcesV2: Readonly<Record<SameAsField, readonly string[]>> = {
  date: [...sameAsSources.date, ...reads], time: sameAsSources.time, professional: [...sameAsSources.professional, ...reads],
  customer: [...sameAsSources.customer, "appointment.list", "appointment.read"], service: ["appointment.create", "appointment.change", "appointment.cancel"],
};
export const referenceTargetsOf = (field: SameAsField) => (referencesV2Enabled() ? sameAsTargetsV2 : sameAsTargets as Partial<Record<SameAsField, readonly string[]>>)[field] ?? [];
export const referenceSourcesOf = (field: SameAsField) => (referencesV2Enabled() ? sameAsSourcesV2 : sameAsSources as Partial<Record<SameAsField, readonly string[]>>)[field] ?? [];
/** D-SELF-ORIGIN (V2): the one reference to the operation's own key: a change keeping its origin's day or clock. */
export const selfReference = (operation: string, field: SameAsField) => referencesV2Enabled() && operation === "appointment.change" && (field === "date" || field === "time");
/** D1 (V2): the operations whose slot a created appointment may take (a cancel's appointment; a change's ORIGIN). */
export const releasedSlotSources = () => referencesV2Enabled() ? ["appointment.cancel", "appointment.change"] : ["appointment.cancel"];
export type ReferenceTarget = { operation: string; status?: string };
/** Per-operation reference checks (an invalid operation is left out under partial acceptance). `targets`: every key the
 * envelope (and, for ADD, the active plan) defines. A key of the operation itself, an unknown or discarded one, a field
 * the two operations do not share or two references for one field are refused. Beside released_slot_of the released
 * slot owns the values: its links are redundant (the caller drops them, see withoutReleasedReferences).
 * V2: a change may name its own key for date/time (its origin); beside released_slot_of a service reference is kept and
 * checked here (D3 review: never skipped), and it may only name the releaser (the slot whose services it copies). */
export function checkReferences(op: { item_key?: string | null; operation: string; released_slot_of?: string | null; same_as?: readonly SameAsReference[] | null },
  targets: ReadonlyMap<string, ReferenceTarget>) {
  const all = op.same_as ?? [];
  if (!all.length) return;
  if (!sameAsEnabled()) throw Error("CAPABILITY_FIELD_MISMATCH");
  const released = op.released_slot_of != null, refs = released ? referencesV2Enabled() ? all.filter(ref => ref.field === "service") : [] : all;
  if (!refs.length) return;
  if (new Set(refs.map(ref => ref.field)).size !== refs.length) throw Error("SAME_AS_INVALID");
  for (const ref of refs) {
    if (ref.item_key === op.item_key) { if (selfReference(op.operation, ref.field)) continue; throw Error("SAME_AS_INVALID"); }
    const target = targets.get(ref.item_key);
    if (!target || target.status === "DISCARDED" || !referenceTargetsOf(ref.field).includes(op.operation) ||
      !referenceSourcesOf(ref.field).includes(target.operation) || released && ref.item_key !== op.released_slot_of) throw Error("SAME_AS_INVALID");
  }
}
/** A created appointment in a released slot takes that slot's day, time and professional: its links are dropped (the
 * T21 pair is never refused for a redundant reference). V2 (D3): its service reference is kept ("pro mesmo serviço"). */
export function withoutReleasedReferences<T extends { released_slot_of?: string | null; same_as?: unknown }>(op: T): T {
  if (op.released_slot_of == null || !("same_as" in op)) return op;
  const kept = referencesV2Enabled() && Array.isArray(op.same_as) ? (op.same_as as SameAsReference[]).filter(ref => ref.field === "service") : [];
  if (kept.length) return { ...op, same_as: kept };
  const { same_as: _dropped, ...rest } = op; void _dropped; return rest as T;
}
/** Preparation graph: execution edges plus the references to keys of the same graph (an external or self key is not an
 * edge here; a self key is refused per operation). Referenced actions come first; a cycle is INVALID_DEPENDENCY_GRAPH. */
export function preparationGraph(actions: readonly { key: string; depends_on: readonly string[]; same_as?: readonly SameAsReference[] | null }[]) {
  const keys = new Set(actions.map(action => action.key));
  return dependencyGraph(actions.map(action => ({ key: action.key,
    depends_on: [...new Set([...action.depends_on, ...(action.same_as ?? []).map(ref => ref.item_key).filter(key => key !== action.key && keys.has(key))])] })));
}
export const hasReferences = (actions: readonly { same_as?: readonly unknown[] | null }[]) => actions.some(action => (action.same_as?.length ?? 0) > 0);
