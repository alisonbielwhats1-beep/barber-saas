/** C2 validation gate for the few-shot example bank. Dev/test only: never imported by runtime code.
 * (a) every entry renders into the ACTIVE live wire (legacy and components) and passes the exact
 *     compiled tool schema (z.fromJSONSchema of the published wire), decodeConversationTurn (which
 *     runs validateSelectionV2 / validateAddSelection / validateExistingPlanPatches) and needs no
 *     literal repair; (b) every literal is a tolerant UNIQUE span of the message; (c) safety lint (no article kept in a
 *     person's name); (d) anti-contamination against the dev batteries and the Golden 30: plain token Jaccard < 0.6
 *     and, C7, the structure-level Jaccard (names, digits and weekday words masked) < 0.6; no person of the
 *     evaluation fixtures/batteries named. The sealed holdouts are outside the repository and are never read.
 * Reports codes, ids and scores only: never the text of an evaluation battery.
 * CLI: npx tsx packages/salon-secretary/src/examples/validate.ts */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createServicesAgent, withConversationRouting, decodeConversationTurn, operationSkill, type Model, type SecretaryWireSchema, type ConversationRoutingContext } from "../index";
import { invalidSourceLiterals } from "../source-literal-repair";
import { foldedLiteral, literalSpans } from "../literal-match";
import { bankExample, exampleFeatures, exampleRequirements, impliedRequirements, EXAMPLE_CLOCK_DATE, type BankExample } from "./bank";
import { derivedScopes, exampleLine, exampleOptionId, operationLiterals, optionCard, renderExampleTurn, servedFeatures, wireFeatures, type ExampleWire } from "./render";
import { EXAMPLE_FEATURE_FLAGS, EXAMPLES_V2_FLAG, EXAMPLES_V2_GATED } from "./select";
import { exampleFillNames, exampleFills, examplePlaceholders, fillExample, placeholderIssues, CANONICAL_FILL_SEED, type ExampleDirectory } from "./fill";
import { BASE_FIXTURE, renderTemplate } from "../../evaluation/agenda-practice-lib";
import { devBatteryScenarios, foldWords, jaccard, maskedTokens, nameTokens as personNameTokens, scenarioNames, STATS } from "../../evaluation/agenda-practice-stats";

export type ExampleIssue = { id: string; code: string; wire?: ExampleWire; detail?: string };
export type EvaluationMessage = { source: string; text: string };
const PLAN_REF = "30000000-0000-4000-8000-000000000001";
const mutations = new Set(["appointment.create", "appointment.change", "appointment.cancel", "schedule.block", "stock.movement", "service.create", "service.change",
  "customer.create", "customer.change", "customer.message"]);

/** The routing context the example's state describes (published keys, open questions, candidates). */
export function exampleRoutingContext(example: BankExample): ConversationRoutingContext | undefined {
  const state = example.state;
  if (state.kind === "NEW") return undefined;
  const action = (item_key: string, operation: string, status: string, clarification: Record<string, unknown>) =>
    ({ item_key, operation, status, depends_on: [], fields: {}, clarification: { missing_fields: [], requested_field: null, previous_response: "", ...clarification } });
  // An option card is published with positional option ids (B4), exactly like the live clarification context.
  const card = optionCard(example);
  const candidates = "candidates" in state && state.candidates ? { candidates: card.length ? card.map((label, index) => ({ option_id: exampleOptionId(index), label })) : state.candidates.map(label => ({ label })) } : {};
  if (state.kind === "PLAN") return { active_plan: { plan_ref: PLAN_REF, actions: state.actions.map(a => action(a.item_key, a.operation, "READY_FOR_CONFIRMATION", { previous_response: a.summary, ...candidates })) } };
  const questions = "questions" in state ? state.questions : [{ item_key: "a", operation: state.operation, requested_field: state.requested_field, question: state.question }];
  return { active_plan: { plan_ref: PLAN_REF, actions: questions.map(q => action(q.item_key, q.operation, "NEEDS_INPUT",
    { missing_fields: [q.requested_field], requested_field: q.requested_field, previous_response: q.question, ...candidates })) } };
}
function withEnv<T>(values: Record<string, string>, task: () => T): T {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return task(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
/** Runs synchronously inside the routing context (no await in `task`). */
function inContext<T>(context: ConversationRoutingContext | undefined, task: () => T): T {
  if (!context) return task();
  let out: { value: T } | { error: unknown } | undefined;
  void withConversationRouting(async () => { try { out = { value: task() }; } catch (error) { out = { error }; } }, context);
  if (!out) throw Error("EXAMPLE_CONTEXT_ASYNC");
  if ("error" in out) throw out.error;
  return out.value;
}
const idleModel = { async getResponse() { throw Error("EXAMPLE_VALIDATION_OFFLINE"); }, async *getStreamedResponse() { throw Error("EXAMPLE_VALIDATION_OFFLINE"); } } as unknown as Model;
/** The published discovery wire for this state and temporal transport (`env`: extra flags, P3c candidate wire). */
export function publishedWire(context: ConversationRoutingContext | undefined, wire: ExampleWire, env: Record<string, string> = {}): SecretaryWireSchema {
  return withEnv({ ...env, SALON_SECRETARY_TEMPORAL_COMPONENTS: wire === "components" ? "true" : "false" }, () => inContext(context, () => {
    const tool = createServicesAgent(idleModel, () => {}, "discovery", true).tools[0];
    if (tool.type !== "function") throw Error("EXAMPLE_TOOL");
    return structuredClone(tool.parameters) as SecretaryWireSchema;
  }));
}
type Schema = SecretaryWireSchema;
const resolve = (schema: Schema, root: Schema): Schema => { let current = schema; while (typeof current.$ref === "string") current = root.$defs![current.$ref.slice("#/$defs/".length)]; return current; };
const enumOf = (schema: Schema | undefined, root: Schema): unknown[] => !schema ? [] : (() => { const s = resolve(schema, root); return s.enum ?? s.anyOf?.flatMap(branch => enumOf(branch, root)) ?? []; })();
/** Strict wire object from a sparse rendering: every published key present, absent = null. Unknown
 * keys are kept, so the compiled schema rejects them (unsupported field/operation/unit). */
export function completeForWire(value: unknown, schema: Schema, root: Schema): unknown {
  const s = resolve(schema, root);
  if (s.anyOf) {
    if (value === null || value === undefined) return null;
    const branches = s.anyOf.map(branch => resolve(branch, root)).filter(branch => branch.type !== "null");
    const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    // A PATCH item binds by its key: an item with an open card has its own branch (B4 choice).
    // P3c: an untagged object (a day or a clock component of an exclusion) binds the branch that publishes all of its keys.
    const covers = (branch: Schema) => !object || Object.keys(object).every(key => key in (branch.properties ?? {}));
    const pick = object ? [...branches.filter(covers), ...branches.filter(branch => !covers(branch))].find(branch => branch.type === "object" && (object.mode !== undefined ? enumOf(branch.properties?.mode, root).includes(object.mode) :
      object.operation != null ? enumOf(branch.properties?.operation, root).includes(object.operation) :
      object.item_key !== undefined && branch.properties?.item_key ? enumOf(branch.properties.item_key, root).includes(object.item_key) : true)) : branches.find(branch => branch.type !== "object") ?? branches[0];
    return pick ? completeForWire(value, pick, root) : value;
  }
  if (s.type === "object" && s.properties && value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(s.properties)) out[key] = key in object ? completeForWire(object[key], property, root) : null;
    for (const key of Object.keys(object)) if (!(key in s.properties)) out[key] = object[key];
    return out;
  }
  if (s.type === "array" && s.items && Array.isArray(value)) return value.map(item => completeForWire(item, s.items!, root));
  return value;
}
/** The rendered turn completed against the published wire, PATCH fields bound to their plan action's branch. */
export function wireTurn(example: BankExample, wire: ExampleWire, schema: Schema, features?: ReadonlySet<string>) {
  const turn = renderExampleTurn(example, wire, features), context = exampleRoutingContext(example);
  const byKey = new Map((context?.active_plan?.actions ?? []).map(action => [(action as { item_key: string }).item_key, (action as { operation: string }).operation]));
  const operations = Array.isArray(turn.operations) ? turn.operations as Record<string, unknown>[] : undefined;
  const hinted = turn.mode === "PATCH" && operations ? { ...turn, operations: operations.map(op => ({ ...op, fields: { operation: byKey.get(op.item_key as string), ...(op.fields as object) } })) } : turn;
  const full = completeForWire({ turn: hinted }, schema, schema) as { turn: { operations?: { fields?: Record<string, unknown> }[] } };
  // The rendered PATCH omits operation (derived by the backend): restore null after binding the branch.
  if (turn.mode === "PATCH") for (const op of full.turn.operations ?? []) if (op.fields) op.fields.operation = null;
  return full;
}

const words = (text: string) => foldedLiteral(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const clockWord = /^(?:\d+(?:h\d*|hs|hrs?|min)?|uma?|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|meio|meia)$/;
const negator = new Set(["nao", "n", "nunca", "jamais", "nem"]);
const idLike = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, /\b[c][a-z0-9]{20,}\b/, /\d{8,}/];
/** Lint (c): no auto-pick of homonyms/typos, no invented clock, reasons copied, negations not affirmed, no IDs. */
function safetyIssues(example: BankExample): ExampleIssue[] {
  const issues: ExampleIssue[] = [], id = example.id, message = example.message;
  const state = example.state, candidates = "candidates" in state ? state.candidates ?? [] : [];
  for (const op of example.expected.operations) {
    for (const name of ["customer_name", "service_name", "professional_name", "target_name", "target_professional_name"] as const)
      if (op[name] && foldedLiteral(op[name]!.value) !== foldedLiteral(op[name]!.literal)) issues.push({ id, code: "NAME_NOT_AS_SAID", detail: name });
    // P3c: every service of a list or delta is the owner's words; one restated with no new proof (literal null) is one the state holds.
    for (const item of [...op.service_names ?? [], ...op.service_changes ?? []]) if (item.literal !== null && foldedLiteral(item.value) !== foldedLiteral(item.literal))
      issues.push({ id, code: "NAME_NOT_AS_SAID", detail: "service_names" });
    const stateText = foldedLiteral(JSON.stringify(state));
    for (const item of op.service_names ?? []) if (item.literal === null && !stateText.includes(foldedLiteral(item.value))) issues.push({ id, code: "CARRIED_SERVICE_UNSTATED" });
    // C7: a leading article is never part of a person's name ("a carla" is Carla); an honorific said is kept ("dona cida").
    for (const name of ["customer_name", "professional_name", "target_name", "target_professional_name"] as const)
      if (op[name] && /^(?:a|o|as|os)\s+\S/.test(foldedLiteral(op[name]!.value).trim())) issues.push({ id, code: "NAME_WITH_ARTICLE", detail: name });
    if (op.reason && op.reason.value !== op.reason.literal) issues.push({ id, code: "REASON_NOT_LITERAL" });
    if (op.selection && !candidates.includes(op.selection.value)) issues.push({ id, code: "SELECTION_NOT_PUBLISHED" });
    // A clock needs a said number; only an answer picking a published daypart candidate may quote the period alone.
    for (const role of ["time", "source_time", "end_time"] as const)
      if (op[role] && !words(op[role]!.literal).some(word => clockWord.test(word)) && !(op[role]!.legacy !== null && candidates.includes(op[role]!.legacy!)))
        issues.push({ id, code: "TIME_WITHOUT_CLOCK", detail: role });
    if (op.operation === "appointment.cancel" && op.reason && !literalSpans(message, op.reason.literal).length) issues.push({ id, code: "CANCEL_REASON_NOT_SAID" });
    try { operationSkill(op.operation); } catch { issues.push({ id, code: "OPERATION_UNPUBLISHED" }); }
  }
  // A negator outside quoted reasons governs the request: only examples that model polarity may emit a mutation.
  const reasons = example.expected.operations.flatMap(op => [op.reason?.literal, ...(op.excluded ?? []).map(item => item.literal)]).filter((text): text is string => !!text)
    .flatMap(text => literalSpans(message, text));
  const masked = [...message].map((char, index) => reasons.some(([start, end]) => index >= start && index < end) ? " " : char).join("");
  const mutating = ["NEW", "ADD", "PATCH"].includes(example.expected.mode) && example.expected.operations.some(op => mutations.has(op.operation));
  if (mutating && words(masked).some(word => negator.has(word)) && !exampleRequirements(example).includes("polarity"))
    issues.push({ id, code: "NEGATION_AFFIRMED" });
  const strings: string[] = [];
  const collect = (value: unknown, key = "") => {
    if (/_ref$|_id$|^id$/.test(key) && key !== "") strings.push("ref:" + key);
    if (typeof value === "string") strings.push(value); else if (Array.isArray(value)) value.forEach(item => collect(item));
    else if (value && typeof value === "object") for (const [k, item] of Object.entries(value)) collect(item, k);
  };
  collect(example.expected.operations);
  if (strings.some(text => text.startsWith("ref:") || idLike.some(pattern => pattern.test(text)))) issues.push({ id, code: "ID_LIKE_VALUE" });
  if (example.expected.mode === "UNSUPPORTED" && !example.expected.unavailable_capability) issues.push({ id, code: "UNSUPPORTED_CAPABILITY_MISSING" });
  if (example.expected.mode === "CONVERSATION" && !example.expected.response) issues.push({ id, code: "CONVERSATION_RESPONSE_MISSING" });
  if (["CONVERSATION", "UNSUPPORTED", "AMBIGUOUS"].includes(example.expected.mode) === example.expected.operations.length > 0) issues.push({ id, code: "MODE_OPERATIONS_MISMATCH" });
  return issues;
}
/** (b) Tolerant unique spans for every literal; derived clauses are unique exact substrings. */
function literalIssues(example: BankExample): ExampleIssue[] {
  const issues: ExampleIssue[] = [], id = example.id;
  for (const op of example.expected.operations) for (const literal of operationLiterals(op)) {
    const spans = literalSpans(example.message, literal);
    if (spans.length !== 1) issues.push({ id, code: spans.length ? "LITERAL_REPEATED" : "LITERAL_ABSENT", detail: op.item_key });
  }
  if (!["NEW", "ADD", "PATCH"].includes(example.expected.mode)) return issues;
  const scopes = derivedScopes(example);
  if (!scopes) issues.push({ id, code: "SCOPE_UNDERIVABLE" });
  else if (example.expected.operations.length > 1) for (const [index, scope] of scopes.entries()) {
    if (scope === null) continue;
    const at = example.message.indexOf(scope);
    if (at < 0 || example.message.indexOf(scope, at + 1) >= 0) issues.push({ id, code: "SCOPE_NOT_UNIQUE", detail: example.expected.operations[index].item_key });
    // A same_as literal may sit outside its own clause (P3a D4: a value said once for coordinated actions is quoted where it was said).
    else if (operationLiterals({ ...example.expected.operations[index], same_as: undefined }).some(literal => !literalSpans(example.message, literal).every(([s, e]) => s >= at && e <= at + scope.length)))
      issues.push({ id, code: "SCOPE_MISSES_LITERAL", detail: example.expected.operations[index].item_key });
  }
  return issues;
}
/** (a) Render, complete, compile-validate, decode and literal-check on one wire. */
function wireIssues(example: BankExample, wire: ExampleWire, schemas: Map<string, { schema: Schema; parse: z.ZodType }>): ExampleIssue[] {
  const id = example.id, context = exampleRoutingContext(example), key = wire + ":" + JSON.stringify(context ?? null);
  try {
    if (!schemas.has(key)) {
      const schema = publishedWire(context, wire);
      schemas.set(key, { schema, parse: z.fromJSONSchema(structuredClone(schema) as Parameters<typeof z.fromJSONSchema>[0]) });
    }
    const { schema, parse } = schemas.get(key)!;
    const full = wireTurn(example, wire, schema);
    const issues: ExampleIssue[] = [];
    const parsed = parse.safeParse(full);
    if (!parsed.success) return [{ id, code: "WIRE_SCHEMA", wire, detail: parsed.error.issues.slice(0, 3).map(issue => issue.path.join(".") + ":" + issue.code).join(";") }];
    try { withEnv({ SALON_SECRETARY_TEMPORAL_COMPONENTS: wire === "components" ? "true" : "false" }, () => inContext(context, () => decodeConversationTurn(structuredClone(full), undefined, example.message, { strict: true }))); }
    catch (error) { issues.push({ id, code: "DECODE", wire, detail: error instanceof Error ? error.message.slice(0, 80) : "ERROR" }); }
    if (invalidSourceLiterals(full, example.message).length) issues.push({ id, code: "LITERAL_REPAIR_NEEDED", wire });
    exampleLine(example, wire);
    return issues;
  } catch (error) { return [{ id, code: "RENDER", wire, detail: error instanceof Error ? error.message.slice(0, 80) : "ERROR" }]; }
}

/** (d) Normalized token Jaccard (folded words). */
export function tokenJaccard(a: string, b: string) {
  const x = new Set(words(a)), y = new Set(words(b));
  if (!x.size && !y.size) return 1;
  let common = 0; for (const token of x) if (y.has(token)) common++;
  return common / (x.size + y.size - common);
}
export const CONTAMINATION_THRESHOLD = 0.6;
/** C7 structure-level overlap: the same token Jaccard with person names, digits, spoken numbers and weekday words masked
 * (the evaluation methodology's maskedTokens), so renaming a person or moving the hour never hides a copied sentence.
 * Below the methodology's frame size (5 masked tokens) a short reply ("às 10", "com a <nome>") shares structure with
 * almost anything and is compared by the plain Jaccard only. */
export const CONTAMINATION_FRAME_TOKENS = STATS.frameMinTokens;
export function structureJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size >= CONTAMINATION_FRAME_TOKENS && b.size >= CONTAMINATION_FRAME_TOKENS ? jaccard(a, b) : 0;
}
/** Person-name words the structure check masks: the dev fixtures' and batteries' declared people, every person name
 * the validated entries carry (customer, professional, target, an excluded person) and, G1, every name the fill list may
 * put in an entry. Selections and services stay words. */
export function contaminationNames(examples: readonly BankExample[], root = process.cwd()) {
  return personNameTokens([...evaluationPeopleNames(root), ...examples.flatMap(personNames), ...exampleFillNames().people], BASE_FIXTURE.services.map(s => s.name));
}
const personNames = (example: BankExample) => example.expected.operations.flatMap(op => [
  ...[op.customer_name, op.professional_name, op.target_name, op.target_professional_name].flatMap(item => item ? [item.value, item.literal] : []),
  ...(op.excluded ?? []).flatMap(item => /customer|professional|target/.test(item.field) ? [item.value] : [])]);
const evaluationPeopleNames = (root: string) => [...BASE_FIXTURE.customers.map(c => c.name), ...BASE_FIXTURE.professionals.map(p => p.name), ...devBatteryScenarios(root).flatMap(scenarioNames)];
/** Person-name words of the dev fixtures and batteries (surnames included; service names excluded). */
export const evaluationPeople = (root = process.cwd()) => personNameTokens(evaluationPeopleNames(root), BASE_FIXTURE.services.map(s => s.name));
/** C7 train/eval separation: an entry never names a person of the evaluation fixtures or batteries, in its message, its
 * state (question, summaries, options) or its values. Reports the count only, never the names. */
function evaluationNameIssues(example: BankExample, reserved: ReadonlySet<string>): ExampleIssue[] {
  const state = example.state, texts = [example.message, ...personNames(example), ...("question" in state ? [state.question] : []), ...("questions" in state ? state.questions.map(q => q.question) : []),
    ...("actions" in state ? state.actions.map(a => a.summary) : []), ...("candidates" in state ? state.candidates ?? [] : [])];
  const hits = new Set(texts.flatMap(foldWords).filter(word => reserved.has(word)));
  return hits.size ? [{ id: example.id, code: "EVALUATION_NAME", detail: String(hits.size) }] : [];
}
/** Messages of the dev batteries (agenda-practice-*.json: steps[].say and every scripted answer, with
 * date templates rendered for the example clock) and the quoted turns of the Golden 30. Returned for
 * the gate only; callers must never print the text. The sealed holdout is outside the repository. */
export function evaluationCorpus(root = process.cwd()): EvaluationMessage[] {
  const out: EvaluationMessage[] = [], dir = join(root, "packages/salon-secretary/evaluation");
  const render = (text: string) => { try { return renderTemplate(text, EXAMPLE_CLOCK_DATE); } catch { return text.replace(/\{\{[^}]*\}\}/g, " "); } };
  const strings = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
  for (const file of readdirSync(dir).filter(name => /^agenda-practice-.*\.json$/.test(name)).sort()) {
    const scenarios = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    if (!Array.isArray(scenarios)) continue;
    scenarios.forEach((scenario: { id?: unknown; steps?: { say?: unknown }[]; answers?: unknown }, index) => {
      const source = `${file}#${typeof scenario?.id === "string" ? scenario.id : index}`;
      for (const step of scenario?.steps ?? []) if (typeof step?.say === "string") out.push({ source, text: render(step.say) });
      for (const text of strings(scenario?.answers)) out.push({ source, text: render(text) });
    });
  }
  const golden = readFileSync(join(root, "docs/SECRETARY_GOLDEN_FREE_USE_30.md"), "utf8");
  for (const [index, match] of [...golden.matchAll(/“([^”]{1,600})”|"([^"\n]{1,600})"/g)].entries()) out.push({ source: `SECRETARY_GOLDEN_FREE_USE_30.md#q${index}`, text: match[1] ?? match[2] });
  return out;
}
type MaskedMessage = EvaluationMessage & { masked: ReadonlySet<string> };
/** The larger of the plain and the structure-level (masked) Jaccard against every evaluation message. */
function contaminationIssues(example: BankExample, corpus: readonly MaskedMessage[], names: ReadonlySet<string>): ExampleIssue[] {
  const masked = maskedTokens(example.message, names);
  let worst: { source: string; score: number } | undefined;
  for (const item of corpus) {
    const score = Math.max(tokenJaccard(example.message, item.text), structureJaccard(masked, item.masked));
    if (score >= CONTAMINATION_THRESHOLD && (!worst || score > worst.score)) worst = { source: item.source, score };
  }
  return worst ? [{ id: example.id, code: "CONTAMINATION", detail: `${worst.source} jaccard=${worst.score.toFixed(2)}` }] : [];
}

export type ValidationReport = { entries: number; valid: number; rendered: Record<ExampleWire, number>; skipped: Record<ExampleWire, number>; issues: ExampleIssue[] };
/** G1: the fills every entry is validated with. Seeds (the canonical one first) × salons: none (generic services) and a
 * synthetic salon whose team shares first names with the fill list (the fill must avoid them) and whose services are
 * longer, multi-word names. */
export const GATE_FILL_SEEDS = [CANONICAL_FILL_SEED, "gate-1", "gate-2"] as const;
export const GATE_DIRECTORY: ExampleDirectory = { professionals: ["Noemi Castro", "Tiago Melo", "Gabriela Soares", "Juliana Vieira", "Otávio Klein"],
  services: ["Corte Degradê", "Escova Modeladora", "Hidratação Profunda", "Manicure Tradicional", "Barba Completa", "Design de Sobrancelha"] };
export type FillVariant = { seed: string; directory?: ExampleDirectory };
export const gateVariants = (seeds: readonly string[] = GATE_FILL_SEEDS, directories: readonly (ExampleDirectory | undefined)[] = [undefined, GATE_DIRECTORY]): FillVariant[] =>
  directories.flatMap(directory => seeds.map(seed => ({ seed, ...(directory ? { directory } : {}) })));
/** Runs every filter. `corpus` defaults to the repository batteries; pass [] to skip (d). G1: an entry with placeholders is
 * checked for placeholder consistency and then validated FILLED, once per fill variant (`variants`, default: 3 seeds ×
 * no salon / a synthetic salon); an entry without placeholders is validated as it is. Issues are reported once per
 * (entry, code, wire), with the seed that raised them. */
export function validateExampleBank(raw: readonly unknown[], options: { corpus?: readonly EvaluationMessage[]; wires?: readonly ExampleWire[]; variants?: readonly FillVariant[] } = {}): ValidationReport {
  const issues: ExampleIssue[] = [], examples: BankExample[] = [], wires = options.wires ?? ["legacy", "components"] as const;
  const schemas = new Map<string, { schema: Schema; parse: z.ZodType }>(), seen = new Set<string>();
  const rendered = { legacy: 0, components: 0 }, skipped = { legacy: 0, components: 0 };
  const loaded = raw.map(entry => bankExample.safeParse(entry)), names = contaminationNames(loaded.flatMap(parsed => parsed.success ? [parsed.data] : [])), reserved = evaluationPeople();
  const corpus = (options.corpus ?? evaluationCorpus()).map(item => ({ ...item, masked: maskedTokens(item.text, names) }));
  const variants = options.variants ?? gateVariants();
  for (const [index, entry] of raw.entries()) {
    const parsed = loaded[index];
    if (!parsed.success) { issues.push({ id: (entry as { id?: string })?.id ?? `#${index}`, code: "FORMAT", detail: parsed.error.issues.slice(0, 3).map(issue => issue.path.join(".") + ":" + issue.code).join(";") }); continue; }
    const example = parsed.data;
    if (seen.has(example.id)) issues.push({ id: example.id, code: "DUPLICATE_ID" }); seen.add(example.id);
    examples.push(example);
    const declared = new Set(example.requires ?? []);
    for (const feature of impliedRequirements(example)) if (!declared.has(feature)) issues.push({ id: example.id, code: "REQUIRES_UNDECLARED", detail: feature });
    const placeholders = placeholderIssues(example);
    issues.push(...placeholders.map(code => ({ id: example.id, code: "PLACEHOLDER", detail: code })));
    if (placeholders.length) continue;
    // One pass per fill (a single pass, unfilled, for an entry without placeholders).
    const filled: { example: BankExample; seed?: string }[] = [];
    if (examplePlaceholders(example).length) for (const variant of variants) {
      const fills = exampleFills(example, variant.seed, variant.directory), label = variant.seed + (variant.directory ? "+salon" : "");
      if (!fills) { issues.push({ id: example.id, code: "FILL_UNAVAILABLE", detail: label }); continue; }
      const again = bankExample.safeParse(fillExample(example, fills));
      if (!again.success || examplePlaceholders(again.data).length) { issues.push({ id: example.id, code: "FILL_INVALID", detail: label }); continue; }
      filled.push({ example: again.data, seed: label });
    } else filled.push({ example });
    const reported = new Set<string>(), found: ExampleIssue[] = [];
    const add = (list: readonly ExampleIssue[], seed?: string) => { for (const issue of list) {
      if (!seed) { found.push(issue); continue; }
      const key = `${issue.code}|${issue.wire ?? ""}|${issue.detail ?? ""}`; if (reported.has(key)) continue; reported.add(key);
      found.push({ ...issue, detail: issue.detail ? `${issue.detail} [${seed}]` : `[${seed}]` }); } };
    const wireOk: Record<ExampleWire, boolean> = { legacy: true, components: true };
    for (const { example: variant, seed } of filled) {
      add([...literalIssues(variant), ...safetyIssues(variant), ...contaminationIssues(variant, corpus, names), ...evaluationNameIssues(variant, reserved)], seed);
      for (const wire of wires) {
        if (exampleRequirements(variant).some(feature => !wireFeatures(wire).has(feature))) continue;
        const wireFound = wireIssues(variant, wire, schemas);
        if (wireFound.length) wireOk[wire] = false;
        add(wireFound, seed);
      }
    }
    issues.push(...found);
    for (const wire of wires) {
      if (exampleRequirements(example).some(feature => !wireFeatures(wire).has(feature))) { skipped[wire]++; continue; }
      if (filled.length && wireOk[wire]) rendered[wire]++;
    }
  }
  const bad = new Set(issues.map(issue => issue.id));
  return { entries: raw.length, valid: examples.filter(example => !bad.has(example.id)).length, rendered, skipped, issues };
}
/** P3c BANK-CONTRACT: the flags that publish a set of features (the candidate wire is the components wire). */
export function featureEnv(features: Iterable<string>): Record<string, string> {
  const env: Record<string, string> = { SALON_SECRETARY_TEMPORAL_COMPONENTS: "true" };
  for (const feature of features) { const flag = EXAMPLE_FEATURE_FLAGS[feature as keyof typeof EXAMPLE_FEATURE_FLAGS]; if (flag) env[flag] = "true";
    // Review B: the historical same_as/polarity entries are served only with SALON_SECRETARY_EXAMPLES_V2 as well.
    if (EXAMPLES_V2_GATED.has(feature as never)) env[EXAMPLES_V2_FLAG] = "true"; }
  return env;
}
/** Every candidate flag of Candidate 4 on (the served combination the request-budget tests measure; the examples mode itself
 * never changes the tool schema or the decoder). */
export const CANDIDATE_ENV: Readonly<Record<string, string>> = { ...featureEnv(exampleFeatures), ...Object.fromEntries(["STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "NAME_ALIASES",
  "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE", "SCHEDULING_OVERLAP_ENABLED", "CONFIRMATION_GROUPING", "DATE_RULES_V2", "DAYPART_RULES_V2", "JIT_INSTRUCTIONS", "COPY_V2"]
  .map(name => [`SALON_SECRETARY_${name}`, "true"])) };
export type CandidateReport = { entries: number; checked: Record<"requires" | "every", number>; excluded: number; issues: ExampleIssue[] };
/** P3c BANK-CONTRACT: every entry, filled (canonical seed), rendered to the candidate wire with its requires flags on — and again
 * with every candidate flag on (skipped where its `excludes` apply) — completes against the compiled published schema and
 * passes decodeConversationTurn strictly (validateSelectionV2 / validateAddSelection / validateExistingPlanPatches, no partial
 * acceptance, no degradation) with no literal repair. Codes only. */
export function validateCandidateWire(raw: readonly unknown[], variants: readonly FillVariant[] = [{ seed: CANONICAL_FILL_SEED }]): CandidateReport {
  const issues: ExampleIssue[] = [], checked = { requires: 0, every: 0 }, schemas = new Map<string, { schema: Schema; parse: z.ZodType }>();
  let excluded = 0;
  for (const [index, entry] of raw.entries()) {
    const parsed = bankExample.safeParse(entry);
    if (!parsed.success) { issues.push({ id: (entry as { id?: string })?.id ?? `#${index}`, code: "FORMAT" }); continue; }
    const example = parsed.data, requirements = exampleRequirements(example);
    const envs: ["requires" | "every", Record<string, string>][] = [["requires", featureEnv(requirements)]];
    if ((example.excludes ?? []).length) excluded++; else envs.push(["every", { ...CANDIDATE_ENV }]);
    for (const variant of variants) {
      const fills = examplePlaceholders(example).length ? exampleFills(example, variant.seed, variant.directory) : { people: {}, services: {} };
      if (!fills) { issues.push({ id: example.id, code: "FILL_UNAVAILABLE", detail: variant.seed }); continue; }
      const filled = fillExample(example, fills), context = exampleRoutingContext(filled), features = servedFeatures("components", requirements);
      for (const [name, env] of envs) {
        const key = name + ":" + JSON.stringify(env) + ":" + JSON.stringify(context ?? null);
        try {
          if (!schemas.has(key)) { const schema = publishedWire(context, "components", env); schemas.set(key, { schema, parse: z.fromJSONSchema(structuredClone(schema) as Parameters<typeof z.fromJSONSchema>[0]) }); }
          const { schema, parse } = schemas.get(key)!, full = wireTurn(filled, "components", schema, features), result = parse.safeParse(full);
          if (!result.success) { issues.push({ id: example.id, code: "CANDIDATE_WIRE_SCHEMA", wire: "components", detail: `${name}:${result.error.issues.slice(0, 2).map(issue => issue.path.join(".") + ":" + issue.code).join(";")}` }); continue; }
          try { withEnv(env, () => inContext(context, () => decodeConversationTurn(structuredClone(full), undefined, filled.message, { strict: true }))); }
          catch (error) { issues.push({ id: example.id, code: "CANDIDATE_DECODE", wire: "components", detail: `${name}:${error instanceof Error ? error.message.slice(0, 80) : "ERROR"}` }); continue; }
          if (invalidSourceLiterals(full, filled.message).length) { issues.push({ id: example.id, code: "CANDIDATE_LITERAL_REPAIR", wire: "components", detail: name }); continue; }
          checked[name]++;
        } catch (error) { issues.push({ id: example.id, code: "CANDIDATE_RENDER", wire: "components", detail: `${name}:${error instanceof Error ? error.message.slice(0, 80) : "ERROR"}` }); }
      }
    }
  }
  return { entries: raw.length, checked, excluded, issues };
}
const PARTS = ["bank-single.json", "bank-multi.json", "bank-answers.json"] as const;
const bankDir = (root: string) => join(root, "packages/salon-secretary/src/examples");
/** bank.json is exactly the concatenation of the three parts (S, M, R), as documented. */
export function concatenatedBank(root = process.cwd()) {
  const inner = (text: string) => { const body = text.replace(/\r\n/g, "\n"); return body.slice(body.indexOf("[") + 1, body.lastIndexOf("]")).replace(/^\n+|\n+$/g, ""); };
  return "[\n" + PARTS.map(part => inner(readFileSync(join(bankDir(root), part), "utf8"))).join(",\n") + "\n]\n";
}
export function bankFilesConsistent(root = process.cwd()) {
  const bank = readFileSync(join(bankDir(root), "bank.json"), "utf8").replace(/\r\n/g, "\n");
  const prefixes = PARTS.map(part => (JSON.parse(readFileSync(join(bankDir(root), part), "utf8")) as { id: string }[]).every(entry => entry.id.startsWith(part === "bank-single.json" ? "S" : part === "bank-multi.json" ? "M" : "R")));
  return bank === concatenatedBank(root) && prefixes.every(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = JSON.parse(readFileSync(join(bankDir(process.cwd()), "bank.json"), "utf8")) as unknown[];
  const report = validateExampleBank(raw);
  const byCode: Record<string, number> = {};for (const issue of report.issues) byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
  console.log(JSON.stringify({ entries: report.entries, valid: report.valid, rendered: report.rendered, skipped: report.skipped, filesConsistent: bankFilesConsistent(), byCode, issues: report.issues }, null, 1));
  process.exitCode = report.issues.length || !bankFilesConsistent() ? 1 : 0;
}
