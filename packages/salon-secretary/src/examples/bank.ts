import { createHash } from "node:crypto";
import { z } from "zod";
import bankData from "./bank.json";
import namesData from "./names.json";
import { dayComponentKinds, weekScopes, clockDayparts } from "../temporal-components";

/** Few-shot example bank (C2). Neutral semantic format, documented in docs/SECRETARY_EXAMPLE_SOURCES.md:
 * every value carries the literal that proves it; temporal values carry both the components meaning
 * and the legacy selector. The bank is data: it never reaches the model except through the renderer
 * (render.ts), which converts an entry into the ACTIVE live wire, and only behind SALON_SECRETARY_EXAMPLES. */
const text = z.string().min(1).max(600).regex(/\S/);
const said = <T extends z.ZodType>(value: T) => z.object({ value, literal: text }).strict();
const count = z.number().int();
const dayMeaning = z.object({ kind: z.enum(dayComponentKinds), offset: count.nullable().optional(), weekday: count.min(0).max(6).nullable().optional(),
  week: z.enum(weekScopes).nullable().optional(), day: count.min(1).max(31).nullable().optional(), month: count.min(1).max(12).nullable().optional(),
  year: count.nullable().optional(), days: count.min(0).nullable().optional() }).strict();
const clockMeaning = z.object({ hour: count.min(0).max(23), minute: count.min(0).max(59), daypart: z.enum(clockDayparts) }).strict();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/), clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
/** `legacy: null` = the day or clock is ambiguous for the current wire (the Secretary asks). */
const dayExample = z.object({ components: dayMeaning, legacy: z.union([z.object({ day_offset: count.min(0) }).strict(), z.object({ weekday: count.min(0).max(6) }).strict(),
  z.object({ date: isoDate }).strict(), z.null()]), literal: text }).strict();
const clockExample = z.object({ components: clockMeaning, legacy: clock.nullable(), literal: text }).strict();
const key = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const operationName = z.string().regex(/^[a-z]+\.[a-z_]+$/);
export const exampleOperation = z.object({
  item_key: key, operation: operationName,
  depends_on: z.array(key).optional(), released_slot_of: key.optional(),
  /** Clause of a compound request; derived by the renderer when absent, `null` = none. */
  source_scope: text.nullable().optional(),
  customer_name: said(text).optional(), service_name: said(text).optional(), professional_name: said(text).optional(),
  date: dayExample.optional(), source_date: dayExample.optional(), end_date: dayExample.optional(),
  time: clockExample.optional(), source_time: clockExample.optional(), end_time: clockExample.optional(),
  period: said(z.enum(["morning", "afternoon", "evening"])).optional(), reason: said(text).optional(),
  target_name: said(text).optional(), priceCents: said(count.min(0)).optional(),
  inventory: z.object({ product_name: text.optional(), mode: z.enum(["IN", "OUT"]).optional(), quantity: said(count.min(1).max(100000)).optional(),
    reason: text.optional(), low_stock: z.boolean().optional(),
    reference: z.union([z.object({ kind: z.literal("NAMED"), literal: text }).strict(), z.object({ kind: z.literal("CURRENT_FIELD"), literal: z.null() }).strict()]).optional() }).strict().optional(),
  // Features the live wire publishes only behind a flag (see `requires`): never rendered while unavailable.
  same_as: z.array(z.object({ field: z.string().min(1), item_key: key, literal: text }).strict()).min(1).optional(),
  /** `value`: the excluded value on the legacy wire (YYYY-MM-DD / HH:mm); `components`: the same value on the components wire. */
  excluded: z.array(z.object({ field: z.string().min(1), value: z.string().min(1), components: z.union([dayMeaning, clockMeaning]).optional(), literal: text }).strict()).min(1).optional(),
  selection: said(text).optional(),
  /** P2b (multi_service): the services of ONE appointment as the owner wrote them; `literal: null` = a service the action already
   * holds (its earlier words, restated with no new proof). */
  service_names: z.array(z.object({ value: text, literal: text.nullable() }).strict()).min(2).max(10).optional(),
  /** P2a (alter): the NEW professional of an appointment.change and its service delta (SET = the complete new list). */
  target_professional_name: said(text).optional(),
  service_changes: z.array(z.object({ mode: z.enum(["SET", "INCLUDE", "REMOVE"]), value: text, literal: text }).strict()).min(1).max(10).optional(),
  /** The owner's decision about a conflict review (appointment.create), as the wire states it. */
  override_requested: z.boolean().optional(), destination_mode: z.enum(["SAME_RELEASED_SLOT", "ALTERNATIVE_SLOT"]).optional(),
}).strict();
export type ExampleOperation = z.infer<typeof exampleOperation>;
const question = z.object({ item_key: key, operation: operationName, requested_field: z.string().min(1), question: text }).strict();
export const exampleState = z.union([
  z.object({ kind: z.literal("NEW") }).strict(),
  /** One pending question (item_key "a"), or several open at once (`questions`, keys a, b, ...). */
  z.object({ kind: z.literal("ANSWER"), requested_field: z.string().min(1), question: text, operation: operationName, candidates: z.array(text).min(1).optional() }).strict(),
  z.object({ kind: z.literal("ANSWER"), questions: z.array(question).min(2) }).strict(),
  z.object({ kind: z.literal("PLAN"), actions: z.array(z.object({ item_key: key, operation: operationName, summary: text }).strict()).min(1), candidates: z.array(text).min(1).optional() }).strict(),
]);
export type ExampleState = z.infer<typeof exampleState>;
export const exampleModes = ["NEW", "ADD", "PATCH", "CONVERSATION", "UNSUPPORTED", "AMBIGUOUS", "DISCARD"] as const;
/** Features an entry may need. The first five are the historical ones; the rest are the Candidate 4 flags (P3c): an entry that
 * teaches a structure a flag publishes or a backend answer a flag gives is served only while that flag is on. */
export const exampleFeatures = ["components", "same_as", "polarity", "discard", "selection", "references_v2", "alter", "multi_service", "reads_v2", "recurrence_guard",
  "daypart_by_hours", "exception_rules_v2"] as const;
export type ExampleFeature = typeof exampleFeatures[number];
/** G1: each person placeholder of the entry ({cliente}, {profissional2}...) with the grammatical gender its articles and
 * pronouns need and its form (fill.ts). Services ({servico}) need no declaration. */
const exampleSlot = z.object({ gender: z.enum(["f", "m", "u"]), form: z.enum(["first", "full", "nickname"]).optional() }).strict();
export const bankExample = z.object({
  id: z.string().regex(/^[SMR]\d{3}$/), message: text, clock: z.literal("2027-04-12T09:00"),
  slots: z.record(z.string().regex(/^(?:cliente|profissional)[2-9]?$/), exampleSlot).optional(), state: exampleState,
  expected: z.object({ mode: z.enum(exampleModes), operations: z.array(exampleOperation), secretary_should: text,
    unavailable_capability: z.enum(["professional_management", "product_management", "financial_mutation", "salon_hours", "external_communication", "other"]).optional(),
    /** CONVERSATION only: the short natural reply shown on the wire (`response`). */
    response: text.optional() }).strict(),
  requires: z.array(z.enum(exampleFeatures)).optional(),
  /** Never served while any of these features is available (the entry a flag's own example replaces, e.g. R041 under multi_service). */
  excludes: z.array(z.enum(exampleFeatures)).min(1).optional(),
  tags: z.array(z.string().min(1)), source: z.string().regex(/^(?:own|pattern:[a-z]+)$/),
}).strict();
export type BankExample = z.infer<typeof bankExample>;

/** The fixed example clock (Monday). Legacy absolute dates in the bank are computed for it. */
export const EXAMPLE_CLOCK_DATE = "2027-04-12";
/** Version of the rendered notation; part of the contract tag, so a notation change is a new contract. */
export const EXAMPLES_RENDER_VERSION = "examples-render-v6"; // v3: DISCARD entries render ({mode:'DISCARD',item_keys}). v4: option cards show ids; a pick renders choice {option_id,literal}. v5 (G1): name/service placeholders filled per request (fill.ts). v6 (P3c): same_as, excluded, service lists, alterations and conflict decisions render where their flags publish them (flag-off lines unchanged).
const temporalRoles = ["date", "source_date", "end_date", "time", "source_time", "end_time"] as const;
const readOperations = new Set(["appointment.list", "appointment.read", "availability.get"]);
/** Features an entry needs because of what it contains (independent of what it declares). A reference only the V2 matrix accepts
 * (a service, a change's own key, a read as the source) needs references_v2 besides same_as. */
export function impliedRequirements(example: BankExample): ExampleFeature[] {
  const out = new Set<ExampleFeature>(), ops = example.expected.operations;
  const state = example.state, operationOf = new Map([...ops.map(op => [op.item_key, op.operation] as const),
    ...("actions" in state ? state.actions.map(action => [action.item_key, action.operation] as const) : "questions" in state ? state.questions.map(q => [q.item_key, q.operation] as const)
      : state.kind === "ANSWER" ? [["a", state.operation] as const] : [])]);
  if (example.expected.mode === "DISCARD") out.add("discard");
  for (const op of ops) {
    if (op.excluded) out.add("polarity"); if (op.same_as) out.add("same_as"); if (op.selection) out.add("selection");
    if (op.same_as?.some(ref => ref.field === "service" || ref.item_key === op.item_key || readOperations.has(operationOf.get(ref.item_key) ?? ""))) out.add("references_v2");
    if (op.service_names) out.add("multi_service"); if (op.target_professional_name || op.service_changes) out.add("alter");
    if (op.released_slot_of && operationOf.get(op.released_slot_of) === "appointment.change") out.add("references_v2");
    for (const role of temporalRoles) {
      const value = op[role];
      // A legacy-null value, or an end day given relatively, cannot be expressed by the legacy selectors.
      if (value && (value.legacy === null || role === "end_date" && !("date" in (value.legacy as object)))) out.add("components");
    }
  }
  return exampleFeatures.filter(feature => out.has(feature));
}
/** A day the legacy wire would show as an absolute date computed for the fictional clock (a model could copy
 * its month/year for "dia N"). A pick among the published candidates of the example is not one: the backend
 * accepts only a live candidate. */
function absoluteLegacyDay(example: BankExample) {
  const candidates: readonly string[] = "candidates" in example.state ? example.state.candidates ?? [] : [];
  return example.expected.operations.some(op => (["date", "source_date", "end_date"] as const).some(role => {
    const legacy = op[role]?.legacy;
    return !!legacy && typeof legacy === "object" && "date" in legacy && !candidates.includes(String((legacy as { date: unknown }).date));
  }));
}
/** Served requirements: declared, implied, and "components" for an absolute legacy day (shown only where the backend computes the day). */
export const exampleRequirements = (example: BankExample) => [...new Set([...(example.requires ?? []), ...impliedRequirements(example),
  ...(absoluteLegacyDay(example) ? ["components" as const] : [])])];

type Loaded = { examples: readonly BankExample[]; invalid: readonly { id: string; issues: string[] }[]; sha256: string };
let loaded: Loaded | undefined;
/** Parses the bank once. Malformed entries are never served (the validation gate reports them). */
export function exampleBank(): Loaded {
  if (loaded) return loaded;
  const examples: BankExample[] = [], invalid: { id: string; issues: string[] }[] = [];
  for (const [index, raw] of (bankData as unknown[]).entries()) {
    const parsed = bankExample.safeParse(raw);
    if (parsed.success) examples.push(parsed.data);
    else invalid.push({ id: typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : `#${index}`, issues: parsed.error.issues.map(issue => issue.path.join(".") + ":" + issue.code) });
  }
  // G1: what reaches the model also depends on the fill list, so it is part of the bank identity.
  const sha256 = createHash("sha256").update(EXAMPLES_RENDER_VERSION + JSON.stringify(bankData) + JSON.stringify(namesData)).digest("hex");
  return loaded = Object.freeze({ examples: Object.freeze(examples), invalid: Object.freeze(invalid), sha256 });
}
