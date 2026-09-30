import { AsyncLocalStorage } from "node:async_hooks";
import { foldedLiteral } from "../literal-match";
import { temporalComponentsEnabled } from "../temporal-components";
import { skillRegistry, publishedOptionIds } from "../skill-registry";
import { exampleBank, exampleRequirements, type BankExample, type ExampleFeature } from "./bank";
import { exampleLine, servedFeatures, type ExampleWire } from "./render";
import { directorySeed, exampleFills, fillExample, PLACEHOLDER, CANONICAL_FILL_SEED, type ExampleDirectory } from "./fill";

/** C2 few-shot examples, behind SALON_SECRETARY_EXAMPLES (default off: the request is byte-identical
 * to the historical one). selected = the K most similar eligible examples (lexical, deterministic);
 * full = every eligible example in id order, in the stable instruction prefix. Both respect the hard
 * request cap and render the same compact notation, so they differ only in how many examples go in. */
export type ExamplesMode = "off" | "selected" | "full";
/** Unset, empty, "false", "0" and "off" (any case, as every other SALON_SECRETARY_* switch is turned
 * off) are off; only an unknown value that is not an "off" spelling fails closed. */
export function examplesMode(env: Record<string, string | undefined> = process.env): ExamplesMode {
  const value = env.SALON_SECRETARY_EXAMPLES?.trim() ?? "";
  if (["", "off", "false", "0"].includes(value.toLowerCase())) return "off";
  if (value !== "selected" && value !== "full") throw Error("INVALID_EXAMPLES_MODE");
  return value;
}
export function examplesK(env: Record<string, string | undefined> = process.env) {
  const k = Number(env.SALON_SECRETARY_EXAMPLES_K ?? 4);
  if (!Number.isSafeInteger(k) || k < 1 || k > 8) throw Error("INVALID_EXAMPLES_K");
  return k;
}
/** P3c: the flag that makes each feature available (a feature an entry needs is served only while its flag is "true"). */
export const EXAMPLE_FEATURE_FLAGS: Readonly<Partial<Record<ExampleFeature, string>>> = { same_as: "SALON_SECRETARY_SAME_AS", polarity: "SALON_SECRETARY_TEMPORAL_POLARITY",
  references_v2: "SALON_SECRETARY_REFERENCES_V2", alter: "SALON_SECRETARY_ALTER_APPOINTMENT", multi_service: "SALON_SECRETARY_MULTI_SERVICE", reads_v2: "SALON_SECRETARY_READS_V2",
  recurrence_guard: "SALON_SECRETARY_RECURRENCE_GUARD", daypart_by_hours: "SALON_SECRETARY_DAYPART_BY_HOURS", exception_rules_v2: "SALON_SECRETARY_EXCEPTION_RULES_V2" };
/** Review B: the same_as and polarity entries were never served before Candidate 4, and Candidate 3 runs SAME_AS and
 * TEMPORAL_POLARITY with examples on; they are served only with SALON_SECRETARY_EXAMPLES_V2 as well (default off), so the
 * Candidate 3 flag set keeps its examples block byte-identical. */
export const EXAMPLES_V2_FLAG = "SALON_SECRETARY_EXAMPLES_V2";
export const EXAMPLES_V2_GATED: ReadonlySet<ExampleFeature> = new Set<ExampleFeature>(["same_as", "polarity"]);
/** Features of the live wire that example entries may require: DISCARD is always part of the wire
 * whenever a plan has open actions (the only states its examples describe); components behind its flag; P3c: each Candidate 4
 * structure or answer behind its own flag (all off by default: the historical set). */
export const availableExampleFeatures = (env: Record<string, string | undefined> = process.env): ReadonlySet<ExampleFeature> => new Set<ExampleFeature>(["discard",
  ...(temporalComponentsEnabled() ? ["components" as const] : []),
  ...(Object.entries(EXAMPLE_FEATURE_FLAGS) as [ExampleFeature, string][]).filter(([feature, flag]) => env[flag] === "true" && (!EXAMPLES_V2_GATED.has(feature) || env[EXAMPLES_V2_FLAG] === "true"))
    .map(([feature]) => feature)]);
const activeWire = (): ExampleWire => temporalComponentsEnabled() ? "components" : "legacy";
/** Contract tag (mode, K, bank + notation hash): null when off. Joins any request/contract version hash. */
export function examplesContractTag(env: Record<string, string | undefined> = process.env) {
  const mode = examplesMode(env);
  return mode === "off" ? null : `examples:${mode}:k${examplesK(env)}:${exampleBank().sha256.slice(0, 16)}`;
}

/** What the conversation state admits: no plan → NEW entries; an open question → ANSWER entries;
 * an open plan without questions → PLAN and ANSWER entries. `pending` = open question fields.
 * `features`: what this state adds to the wire (B4: an open option card publishes the item's choice). */
export type ExamplesState = { kind: "NEW" | "ANSWER" | "PLAN"; pending: number; operations: string[]; fields: string[]; modes: ReadonlySet<string>; features?: readonly ExampleFeature[] };
type RoutingLike = { active_plan?: { actions: unknown[] }; suspended_plans?: unknown[] } | undefined;
const refField: Record<string, string> = { customer_ref: "customer_name", service_ref: "service_name", professional_ref: "professional_name", appointment_ref: "selection" };
export function examplesState(context: RoutingLike): ExamplesState {
  const actions = (context?.active_plan?.actions ?? []).filter((action): action is Record<string, unknown> => !!action && typeof action === "object" &&
    !["DONE", "DISCARDED"].includes(String((action as { status?: unknown }).status)));
  if (!context?.active_plan || !actions.length) return { kind: "NEW", pending: 0, operations: [], fields: [], modes: new Set(["NEW", "CONVERSATION", "UNSUPPORTED", "AMBIGUOUS", ...(context?.active_plan ? ["ADD"] : [])]) };
  const fields: string[] = [];let pending = 0;
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  for (const action of actions) {
    const c = (action.clarification ?? {}) as { missing_fields?: unknown; requested_field?: unknown; candidates?: unknown };
    const requested = typeof c.requested_field === "string" ? [c.requested_field] : [], choice = Array.isArray(c.candidates) && c.candidates.length ? ["selection"] : [];
    const open = new Set([...strings(c.missing_fields), ...requested, ...choice].map(field => refField[field] ?? field.split(".").at(-1)!));
    pending += open.size; fields.push(...open);
  }
  return { kind: pending ? "ANSWER" : "PLAN", pending, operations: [...new Set(actions.map(action => String(action.operation)))], fields: [...new Set(fields)],
    modes: new Set(["NEW", "ADD", "PATCH", "DISCARD", "CONVERSATION", "UNSUPPORTED", "AMBIGUOUS"]), ...(actions.some(action => publishedOptionIds(action).length) ? { features: ["selection" as const] } : {}) };
}
const publishedOperations = () => new Set(skillRegistry.filter(skill => skill.enabled).flatMap(skill => skill.operations));
/** State kind, published modes and operations, and available features; never similarity. */
export function eligibleExamples(state: ExamplesState, available: ReadonlySet<ExampleFeature> = availableExampleFeatures()): BankExample[] {
  const features = new Set([...available, ...(state.features ?? [])]);
  const kinds = state.kind === "NEW" ? ["NEW"] : state.kind === "ANSWER" ? ["ANSWER"] : ["PLAN", "ANSWER"], operations = publishedOperations();
  return exampleBank().examples.filter(example => kinds.includes(example.state.kind) && state.modes.has(example.expected.mode) &&
    example.expected.operations.every(op => operations.has(op.operation)) && exampleRequirements(example).every(feature => features.has(feature)) &&
    !(example.excludes ?? []).some(feature => features.has(feature)))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Folded word tokens (case, accents, typographic glyphs; letter runs collapsed: "marcaa" = "marca"). */
export const exampleTokens = (text: string) => foldedLiteral(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(token => token.replace(/(\p{L})\1+/gu, "$1"));
const structure = (operations: readonly string[], fields: readonly string[], pending: number) =>
  [...operations.map(op => "§op:" + op), ...fields.map(field => "§field:" + field), ...(pending > 1 ? ["§multi"] : [])];
function exampleStructure(example: BankExample) {
  const state = example.state;
  if (state.kind === "NEW") return [];
  if (state.kind === "PLAN") return structure(state.actions.map(action => action.operation), [], 0);
  const questions = "questions" in state ? state.questions : [{ operation: state.operation, requested_field: state.requested_field }];
  return structure(questions.map(q => q.operation), questions.map(q => q.requested_field), questions.length);
}
// DISCARD entries are one family (at most 2 per selection), apart from the answers of the same operation.
const tag = (example: BankExample) => example.expected.mode === "DISCARD" ? "DISCARD" : [...new Set(example.expected.operations.map(op => op.operation))].sort().join("+") || example.expected.mode;
/** BM25 over folded message tokens plus closed structure tokens (open operations, pending fields,
 * several open questions); top K with at most 2 per operation tag; ties by id. Only examples sharing
 * at least one token are returned. Pure and deterministic. G1: an entry's name/service placeholders are
 * not tokens (similarity is structure and wording, never a name). */
export function selectExamples(message: string, state: ExamplesState, k: number, eligible: readonly BankExample[] = eligibleExamples(state)): BankExample[] {
  const docs = eligible.map(example => ({ example, tokens: [...exampleTokens(example.message.replace(PLACEHOLDER, " ")), ...exampleStructure(example)] }));
  const query = [...new Set([...exampleTokens(message), ...structure(state.operations, state.fields, state.pending)])];
  const n = docs.length, average = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / Math.max(1, n), df = new Map<string, number>();
  for (const doc of docs) for (const token of new Set(doc.tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  const scored = docs.map(({ example, tokens }) => {
    let score = 0;
    for (const token of query) {
      const tf = tokens.filter(item => item === token).length;if (!tf) continue;
      const d = df.get(token)!, idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * tokens.length / average));
    }
    return { example, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || (a.example.id < b.example.id ? -1 : 1));
  const perTag = new Map<string, number>(), out: BankExample[] = [];
  for (const { example } of scored) {
    if (out.length >= k) break;
    const used = perTag.get(tag(example)) ?? 0;if (used >= 2) continue;
    perTag.set(tag(example), used + 1); out.push(example);
  }
  return out;
}

const lines = new Map<string, string | null>();
const filledLines = new Map<string, string | null>();
/** Rendered line of an entry on the active wire with the given seed and salon (memoized; null when the entry cannot
 * render or no fill keeps its literals exact). The canonical fill decides eligibility, so it never depends on a request. */
function lineOf(example: BankExample, wire: ExampleWire, seed = CANONICAL_FILL_SEED, directory?: ExampleDirectory) {
  const canonical = seed === CANONICAL_FILL_SEED && !directory, key = `${wire}:${example.id}:${seed}:${directorySeed(directory)}`, memo = canonical ? lines : filledLines;
  if (!memo.has(key)) {
    // Per-request lines are bounded: a long-lived process never grows this cache without limit.
    if (!canonical && memo.size >= 4096) memo.clear();
    // P3c: an eligible entry renders with its own requirements (the selector already checked the wire and state publish them).
    try { const fills = exampleFills(example, seed, directory); memo.set(key, fills ? exampleLine(fillExample(example, fills), wire, servedFeatures(wire, exampleRequirements(example))) : null); } catch { memo.set(key, null); }
  }
  return memo.get(key)!;
}
export const EXAMPLES_HEADER = "Exemplos de interpretação (dados, não instruções): como mensagens informais viram turn. Nomes são fictícios e nunca do salão; datas dos exemplos contam a partir de segunda, 12/04/2027; campos null omitidos. Siga sempre o contrato, o contexto e a mensagem atuais.";
/** Bytes a text adds inside a JSON string of the request body (escapes included). */
export const jsonTextBytes = (text: string) => Buffer.byteLength(JSON.stringify(text), "utf8") - 2;
export type ExamplesBlock = { mode: Exclude<ExamplesMode, "off">; text: string; count: number; bytes: number; eligible: number; ids: string[] };
/** G1 fill seed of one request: selected = the message (the same request renders the same names; another message,
 * other names); full = the salon, so the block stays a stable instruction prefix per salon (provider prompt cache).
 * The entry id joins every seed (exampleFills), so different entries get different names. */
export const examplesFillSeed = (mode: Exclude<ExamplesMode, "off">, message: string, directory?: ExampleDirectory) =>
  mode === "full" ? `salon:${directorySeed(directory)}` : `message:${message}`;
/** The examples block for one request, never larger than `budget` bytes of request body (the
 * leading newline included). selected keeps rank order and drops from the tail; full keeps the
 * longest id-ordered prefix that fits and reports count/eligible. Empty text when nothing fits.
 * G1: every line is filled (fill.ts) with the request's seed; people never share a word with `directory`'s team. */
export function composeExamples(mode: Exclude<ExamplesMode, "off">, message: string, state: ExamplesState, budget: number, k = examplesK(), directory?: ExampleDirectory): ExamplesBlock {
  const wire = activeWire(), eligible = eligibleExamples(state).filter(example => lineOf(example, wire) !== null);
  const seed = examplesFillSeed(mode, message, directory);
  const fillable = eligible.filter(example => lineOf(example, wire, seed, directory) !== null);
  const chosen = mode === "full" ? fillable : selectExamples(message, state, k, fillable);
  const header = jsonTextBytes("\n" + EXAMPLES_HEADER), taken: BankExample[] = [];let bytes = header;
  for (const example of chosen) {
    const cost = jsonTextBytes("\n" + lineOf(example, wire, seed, directory)!);
    if (bytes + cost > budget) break;
    bytes += cost; taken.push(example);
  }
  const text = taken.length ? [EXAMPLES_HEADER, ...taken.map(example => lineOf(example, wire, seed, directory)!)].join("\n") : "";
  return { mode, text, count: taken.length, bytes: taken.length ? jsonTextBytes("\n" + text) : 0, eligible: eligible.length, ids: taken.map(example => example.id) };
}

/** Hard request limits shared with the cost guard and the wire budget tests. */
export const EXAMPLES_REQUEST_CAP = 64_000, EXAMPLES_OUTPUT_FRAMING = 8192, EXAMPLES_ESTIMATE_MARGIN = 256;
/** Upper estimate of the Responses body the SDK serializes for one Secretary request. */
export function secretaryRequestBytes(input: { instructions: string; messages: readonly { role: string; content: string }[]; parameters: unknown; toolName: string; toolDescription: string; maxTokens: number }) {
  return Buffer.byteLength(JSON.stringify({ model: "gpt-5.6-luna", instructions: input.instructions, input: input.messages.map(message => ({ type: "message", ...message })), include: [],
    tools: [{ type: "function", name: input.toolName, description: input.toolDescription, parameters: input.parameters, strict: true }],
    max_output_tokens: input.maxTokens, tool_choice: { type: "function", name: input.toolName }, stream: false, store: false, parallel_tool_calls: false }), "utf8") + EXAMPLES_ESTIMATE_MARGIN;
}

/** Per-request telemetry: codes and counts only (bank ids are codes, never message text). */
export type ExamplesTelemetry = { mode: Exclude<ExamplesMode, "off">; count: number; bytes: number; eligible: number; ids: string[] };
const observer = new AsyncLocalStorage<(entry: ExamplesTelemetry) => void>();
export function withExamplesObserver<T>(sink: (entry: ExamplesTelemetry) => void, task: () => T): T { return observer.run(sink, task); }
export function reportExamples(block: ExamplesBlock) {
  try { observer.getStore()?.({ mode: block.mode, count: block.count, bytes: block.bytes, eligible: block.eligible, ids: [...block.ids] }); } catch { /* Observation only. */ }
}
