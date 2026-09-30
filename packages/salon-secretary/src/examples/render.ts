import { foldedLiteral, literalSpans } from "../literal-match";
import { impliedRequirements, type BankExample, type ExampleOperation } from "./bank";

/** Which temporal transport the live wire publishes (SALON_SECRETARY_TEMPORAL_COMPONENTS). */
export type ExampleWire = "legacy" | "components";
const dayRoles = ["date", "source_date", "end_date"] as const, clockRoles = ["time", "source_time", "end_time"] as const;
const legacyDaySelector: Record<(typeof dayRoles)[number], Partial<Record<"day_offset" | "weekday" | "date", string>>> = {
  date: { day_offset: "day_offset", weekday: "weekday", date: "date" },
  source_date: { day_offset: "source_day_offset", weekday: "source_weekday", date: "source_date" },
  end_date: { date: "end_date" },
};
/** Live wire property order of a scheduling/inventory/services operation (operation first). */
const fieldOrder = ["same_as", "destination_mode", "override_requested", "customer_name", "service_names", "service_name", "professional_name", "components", "date", "day_offset", "weekday", "time", "period", "source_date",
  "source_day_offset", "source_weekday", "source_time", "end_time", "end_date", "excluded", "reason", "target_professional_name", "service_changes", "target_name", "priceCents", "inventory"];
const ordered = (value: Record<string, unknown>, order: readonly string[]) =>
  Object.fromEntries([...order.filter(key => key in value), ...Object.keys(value).filter(key => !order.includes(key))].map(key => [key, value[key]]));
const dayKeys = ["kind", "offset", "weekday", "week", "day", "month", "year", "days"];

const intervalGlue = /^\s*(?:as|a|ao|ate|-)\s*$/, intervalLead = /(?:^|\s)(?:das|dos|de|do|da)\s+$/;
/** Components contract: an interval ("das 2 às 4 da tarde") gives time and end_time the same whole
 * literal, so a daypart said once qualifies both ends. The span runs from the interval's leading
 * preposition to the end of the end_time quote when only interval glue separates the two quotes. */
export function sharedIntervalLiteral(message: string, start: string, end: string): string | undefined {
  const [a, b] = [literalSpans(message, start), literalSpans(message, end)];
  if (a.length !== 1 || b.length !== 1 || a[0][1] > b[0][0] || !intervalGlue.test(foldedLiteral(message.slice(a[0][1], b[0][0])) || " ")) return undefined;
  const lead = intervalLead.exec(foldedLiteral(message.slice(0, a[0][0])) + " ");
  let from = a[0][0];
  if (lead) { const word = lead[0].trim(); const at = message.slice(0, from).trimEnd().length - word.length; if (at >= 0 && foldedLiteral(message.slice(at, at + word.length)) === word) from = at; }
  return message.slice(from, b[0][1]);
}
/** The op's fields in the live wire: plain values for names/reason/period, {value,literal} selectors
 * (legacy) or the typed `components` container, never both. Features the wire lacks throw. P3c: `features` publishes the
 * flag-gated structures (same_as, excluded, service lists, alterations); never a selection here (PATCH renders it as a choice). */
function renderFields(op: ExampleOperation, wire: ExampleWire, candidates: readonly string[], message: string, features: ReadonlySet<string>): Record<string, unknown> {
  if (op.same_as && !features.has("same_as") || op.excluded && !features.has("polarity") || op.selection || (op.service_names && !features.has("multi_service")) ||
    ((op.target_professional_name || op.service_changes) && !features.has("alter"))) throw Error("EXAMPLE_FEATURE_UNAVAILABLE");
  const out: Record<string, unknown> = {}, components: Record<string, unknown> = {};
  if (op.same_as) out.same_as = op.same_as.map(ref => ({ field: ref.field, item_key: ref.item_key, literal: ref.literal }));
  if (op.destination_mode) out.destination_mode = op.destination_mode;
  if (op.override_requested !== undefined) out.override_requested = op.override_requested;
  if (op.service_names) out.service_names = op.service_names.map(item => item.value);
  if (op.target_professional_name) out.target_professional_name = op.target_professional_name.value;
  if (op.service_changes) out.service_changes = op.service_changes.map(change => ({ mode: change.mode, service_name: change.value }));
  // An exclusion has the shape of its role's value on the active wire (a component in components mode).
  if (op.excluded) out.excluded = op.excluded.map(item => {
    if (wire === "components" && !item.components) throw Error("EXAMPLE_LEGACY_UNREPRESENTABLE");
    return { field: item.field, value: wire === "components" ? "kind" in item.components! ? ordered(item.components!, dayKeys) : item.components : item.value, literal: item.literal };
  });
  // An answer that picks a published daypart/date candidate uses the legacy selector on every wire
  // ({value: candidate, literal: current answer}); the components contract says the same.
  const typed = (legacy: unknown) => wire === "components" && !(typeof legacy === "string" && candidates.includes(legacy) ||
    legacy && typeof legacy === "object" && "date" in legacy && candidates.includes(String((legacy as { date: unknown }).date)));
  for (const name of ["customer_name", "service_name", "professional_name", "target_name", "priceCents", "period", "reason"] as const) if (op[name]) out[name] = op[name]!.value;
  for (const role of dayRoles) {
    const said = op[role];if (!said) continue;
    if (typed(said.legacy)) { components[role] = { value: ordered(said.components, dayKeys), literal: said.literal }; continue; }
    const [selector, value] = said.legacy ? Object.entries(said.legacy)[0] as [keyof (typeof legacyDaySelector)["date"], unknown] : [];
    const field = selector && legacyDaySelector[role][selector];
    if (!field) throw Error("EXAMPLE_LEGACY_UNREPRESENTABLE");
    out[field] = { value, literal: said.literal };
  }
  const interval = op.time && op.end_time && typed(op.time.legacy) && typed(op.end_time.legacy) ? sharedIntervalLiteral(message, op.time.literal, op.end_time.literal) : undefined;
  for (const role of clockRoles) {
    const said = op[role];if (!said) continue;
    if (typed(said.legacy)) components[role] = { value: said.components, literal: role !== "source_time" && interval || said.literal };
    else if (said.legacy === null) throw Error("EXAMPLE_LEGACY_UNREPRESENTABLE");
    else out[role] = { value: said.legacy, literal: said.literal };
  }
  if (Object.keys(components).length) out.components = ordered(components, [...dayRoles, ...clockRoles]);
  if (op.inventory) out.inventory = ordered({ ...op.inventory }, ["product_name", "low_stock", "mode", "quantity", "reason", "reference"]);
  return ordered(out, fieldOrder);
}

/** Every literal an operation quotes (values of any feature, available or not). */
export function operationLiterals(op: ExampleOperation): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (key === "literal" && typeof item === "string") out.push(item); else visit(item); }
  };
  const { source_scope, ...fields } = op; void source_scope; visit(fields);
  return out;
}
const connector = /[,;.!?]|(?<![\p{L}\p{N}])(?:e|mas|depois|tambem|também|tb|ai|aí)(?![\p{L}\p{N}])/iu;
/** Clauses of a compound request: each op spans from the end of the previous clause (after the
 * first connector of the gap) to its last own literal; the first starts at the message start and
 * the last ends at the message end. Undefined when an op has no unique literal or ops interleave
 * (the bank then states `source_scope` explicitly, or null for none). */
export function derivedScopes(example: BankExample): (string | null)[] | undefined {
  const ops = example.expected.operations, message = example.message;
  if (ops.length < 2) return ops.map(op => op.source_scope ?? null);
  const ranges = ops.map(op => {
    const spans = operationLiterals(op).map(literal => literalSpans(message, literal));
    if (!spans.length || spans.some(found => found.length !== 1)) return undefined;
    return [Math.min(...spans.map(found => found[0][0])), Math.max(...spans.map(found => found[0][1]))] as [number, number];
  });
  const explicit = ops.map(op => op.source_scope !== undefined);
  if (explicit.every(Boolean)) return ops.map(op => op.source_scope!);
  if (ranges.some(range => !range)) return undefined;
  const order = ranges.map((range, index) => ({ range: range!, index })).sort((a, b) => a.range[0] - b.range[0]);
  const scopes: (string | null)[] = ops.map(() => null);
  let start = message.length - message.trimStart().length;
  for (const [position, { range, index }] of order.entries()) {
    const next = order[position + 1];
    let end = next ? range[1] : message.trimEnd().replace(/[.!?]+$/, "").length, following = end;
    if (next) {
      if (range[1] > next.range[0]) return undefined;
      const gap = message.slice(range[1], next.range[0]), cut = connector.exec(gap);
      end = range[1]; following = range[1] + (cut ? cut.index + cut[0].length : 0);
    }
    scopes[index] = explicit[index] ? ops[index].source_scope! : message.slice(start, end).trim() || null;
    start = following;
    while (start < message.length && /[\s,;]/.test(message[start])) start++;
  }
  return scopes;
}

/** Features a wire publishes: DISCARD on both (whenever a plan has open actions), the option choice on
 * both (B4: an item whose card is open), components on its own. */
export const wireFeatures = (wire: ExampleWire): ReadonlySet<string> => new Set(["discard", "selection", ...(wire === "components" ? ["components"] : [])]);
/** Positional option id, exactly as the live clarification context publishes it (opt_1 = first label). */
export const exampleOptionId = (index: number) => `opt_${index + 1}`;
const temporalQuestion = /^(?:date|time|source_date|source_time|end_date|end_time)$/;
/** The state's candidates when they are an option card (published with option ids). Candidates of a
 * temporal question (a daypart/date to pick) are selector values, not options. */
export function optionCard(example: BankExample): readonly string[] {
  const state = example.state;
  if (!("candidates" in state) || !state.candidates?.length) return [];
  return state.kind === "ANSWER" && temporalQuestion.test(state.requested_field) ? [] : state.candidates;
}
/** The expected plan in the ACTIVE live wire, sparse (null/absent fields omitted). NEW/ADD
 * operations carry their graph keys; PATCH carries {item_key, fields}; DISCARD the given-up keys.
 * Throws when the entry cannot be expressed on this wire (callers render only eligible entries). */
export function renderExampleTurn(example: BankExample, wire: ExampleWire, features: ReadonlySet<string> = wireFeatures(wire)): Record<string, unknown> {
  const needs = impliedRequirements(example).filter(feature => !features.has(feature));
  if (needs.length) throw Error("EXAMPLE_FEATURE_UNAVAILABLE");
  const { mode, operations } = example.expected, candidates = "candidates" in example.state ? example.state.candidates ?? [] : [];
  const scopes = derivedScopes(example) ?? operations.map(op => op.source_scope ?? null);
  switch (mode) {
    case "NEW": case "ADD":
      return { mode, operations: operations.map((op, index) => ({ operation: op.operation, item_key: op.item_key, ...(op.depends_on ? { depends_on: op.depends_on } : {}),
        ...(op.released_slot_of ? { released_slot_of: op.released_slot_of } : {}), ...(scopes[index] ? { source_scope: scopes[index] } : {}), ...renderFields(op, wire, candidates, example.message, features) })) };
    case "PATCH":
      // B4: a pick among the card's options is the item's choice {option_id, literal}; the rest stays a field delta.
      return { mode, operations: operations.map((op, index) => { const { selection, ...said } = op, card = optionCard(example);
        if (selection && !card.includes(selection.value)) throw Error("EXAMPLE_SELECTION_UNPUBLISHED");
        return { item_key: op.item_key, ...(selection ? { choice: { option_id: exampleOptionId(card.indexOf(selection.value)), literal: selection.literal } } : {}),
          fields: { ...(scopes[index] ? { source_scope: scopes[index] } : {}), ...renderFields(said, wire, candidates, example.message, features) } }; }) };
    case "DISCARD":
      if (!operations.length || operations.some(op => Object.keys(op).some(key => !["item_key", "operation"].includes(key)))) throw Error("EXAMPLE_DISCARD_FIELDS");
      return { mode, item_keys: operations.map(op => op.item_key) };
    case "CONVERSATION":
      if (!example.expected.response) throw Error("EXAMPLE_RESPONSE_REQUIRED");
      return { mode, response: example.expected.response };
    case "UNSUPPORTED": return { mode, unavailable_capability: example.expected.unavailable_capability };
    case "AMBIGUOUS": return { mode };
    default: throw Error("EXAMPLE_FEATURE_UNAVAILABLE");
  }
}

/** Compact, unambiguous notation shared by every mode: JS-like object literal, keys bare, strings
 * single-quoted (backslash-escaped), null/undefined and empty arrays omitted. */
export function compactNotation(value: unknown): string {
  if (typeof value === "string") return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "[" + value.filter(item => item != null).map(compactNotation).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, item]) => item != null && !(Array.isArray(item) && !item.length))
    .map(([key, item]) => key + ":" + compactNotation(item)).join(",") + "}";
  return "null";
}
/** The pending conversation an ANSWER/PLAN example continues (empty for NEW). */
export function exampleContext(example: BankExample): string {
  const state = example.state;
  if (state.kind === "NEW") return "";
  // An option card shows each option with its id, as the live context publishes it.
  const card = optionCard(example), options = "candidates" in state && state.candidates ?
    ` opções: ${(card.length ? card.map((label, index) => `${exampleOptionId(index)} ${label}`) : state.candidates).join(" | ")}` : "";
  if (state.kind === "PLAN") return `PLANO: ${state.actions.map(action => `${action.item_key} ${action.operation} (${action.summary})`).join("; ")}${options}`;
  const questions = "questions" in state ? state.questions : [{ item_key: "a", operation: state.operation, requested_field: state.requested_field, question: state.question }];
  return `PENDENTE: ${questions.map(q => `${q.item_key} ${q.operation} falta ${q.requested_field} (${q.question})`).join("; ")}${options}`;
}
/** One example line: [context |] MENSAGEM: <message> → <turn>. */
export function exampleLine(example: BankExample, wire: ExampleWire, features?: ReadonlySet<string>): string {
  const context = exampleContext(example);
  return `- ${context ? context + " | " : ""}MENSAGEM: ${example.message} → ${compactNotation(renderExampleTurn(example, wire, features))}`;
}
/** P3c: what an entry the selector found eligible publishes (its own requirements met by the live wire and state). */
export const servedFeatures = (wire: ExampleWire, requirements: readonly string[]): ReadonlySet<string> => new Set([...wireFeatures(wire), ...requirements]);
