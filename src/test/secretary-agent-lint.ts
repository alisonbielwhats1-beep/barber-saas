import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** C5 agent anti-contamination lint (docs/c5-spike/11-especificacao-agente.md §9.6), shared by the contamination test and any
 * later check. Normalized as in R9 (agenda-practice-stats maskedTokens): case, accents and punctuation folded; person names,
 * numbers (digits and spoken) and weekdays become markers. Here the ORDER is kept, function words are dropped and a run of the
 * same marker is one marker. A collision is a 3-gram of consecutive tokens, inside one sentence segment, with at least two
 * content words (a marker is not a content word, so "verb + name + day" alone never collides but a sentence frame copied with
 * other names does). Names: the declared names of the sets plus every capitalized word that does not open its segment. */
export const LINT_MARK = { name: "<name>", number: "<num>", weekday: "<weekday>" } as const;
const MARKS = new Set<string>(Object.values(LINT_MARK));
const WEEKDAYS = new Set(["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "feira"]);
const NUMBERS = new Set(["dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "catorze", "quinze",
  "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "trinta", "quarenta", "cinquenta", "primeiro"]);
const NUMBER_TAIL = new Set(["um", "uma", "meia"]);
/** Folded pt-BR function words (articles, prepositions and contractions, pronouns, conjunctions, auxiliaries, fillers). */
export const LINT_FUNCTION_WORDS = new Set(("a o as os um uma uns umas de da do das dos em na no nas nos num numa nuns numas por pela pelo pelas pelos para pra pro pras pros " +
  "com sem sob sobre ate apos entre ao aos e ou mas nem que se como quando onde porque pois entao ja tambem so mais menos muito muita muitos muitas bem nao sim " +
  "ele ela eles elas eu voce voces me te lhe lhes mim ti meu minha meus minhas seu sua seus suas nosso nossa nossos nossas dele dela deles delas " +
  "este esta estes estas esse essa esses essas isso isto aquele aquela aquilo la aqui ai ali sao foi era ser estar estao estava tem tinha ter ha " +
  "vai vou pode quer qual quais cada todo toda todos todas outro outra outros outras mesmo mesma mesmos mesmas ainda ne tipo dai ta to vc q " +
  "neste nesta nestes nestas nesse nessa nesses nessas nisso nisto naquele naquela naquilo deste desta destes destas desse dessa desses dessas disso disto daquele daquela daquilo " +
  // English (test titles; the official citations quoted in docs/c5-spike are English): never content.
  "the an and or of to in on at by for from with without into onto over under is are was were be been being it its this that these those there their they them " +
  "we our you your he she his her not nor but if then than when which who whom what how only also just such very can could should would will may might must does did done has have had").split(" "));
export const lintFold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Sentence segments of a text (quotes, brackets and sentence punctuation end a segment). */
const segments = (text: string) => text.split(/[.!?;:\n\r()[\]{}"“”«»]+/u);
/** Normalized token lists, one per segment. */
export function lintTokens(text: string, names: ReadonlySet<string>): string[][] {
  return segments(text).map(segment => {
    // A snake_case identifier is one token: code, not language.
    const words = [...segment.matchAll(/[\p{L}\p{M}\p{N}_]+/gu)].map(match => match[0]);
    const folded = words.map(lintFold);
    const masked = folded.map((word, index) => /\d/.test(word) || NUMBERS.has(word) ? LINT_MARK.number : WEEKDAYS.has(word) ? LINT_MARK.weekday
      : names.has(word) || index > 0 && /^\p{Lu}/u.test(words[index]) ? LINT_MARK.name : word);
    for (let i = 1; i + 1 < masked.length; i++) // "vinte e oito", "dez e meia": one number
      if (masked[i] === "e" && masked[i - 1] === LINT_MARK.number && (masked[i + 1] === LINT_MARK.number || NUMBER_TAIL.has(folded[i + 1]))) { masked[i] = LINT_MARK.number; masked[i + 1] = LINT_MARK.number; }
    const out: string[] = [];
    for (const token of masked) if (!LINT_FUNCTION_WORDS.has(token) && !(MARKS.has(token) && out.at(-1) === token)) out.push(token);
    return out;
  }).filter(tokens => tokens.length);
}
/** Content 3-grams of a text. */
export function lintGrams(text: string, names: ReadonlySet<string>): Set<string> {
  const grams = new Set<string>();
  for (const tokens of lintTokens(text, names)) for (let i = 0; i + 3 <= tokens.length; i++) {
    const gram = tokens.slice(i, i + 3);
    if (gram.filter(token => !MARKS.has(token)).length >= 2) grams.add(gram.join(" "));
  }
  return grams;
}
/** Quoted excerpts ("…", “…”, «…») of a markdown text, line by line. */
export const quotedExcerpts = (text: string) => text.split(/\r?\n/).flatMap(line => [...line.matchAll(/"([^"]{3,})"|“([^”]{3,})”|«([^»]{3,})»/gu)].map(match => match[1] ?? match[2] ?? match[3]));
/** String literals of a TypeScript source (template substitutions removed). Heuristic: good enough for test texts. */
export const stringLiterals = (source: string) => [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gu)]
  .map(match => (match[1] ?? match[2] ?? match[3] ?? "").replace(/\$\{[^}]*\}/g, " "));
const stringLeaves = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(stringLeaves)
  : value && typeof value === "object" ? Object.values(value).flatMap(stringLeaves) : [];
const json = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as unknown;
export type LintSource = { file: string; texts: string[] };
/** Scenario files of the repo Training drawer (C4 DEV, rules, V, N). Only what the owner says: step `say` and scripted `answers`. */
export const LINT_SCENARIO_FILES = ["packages/salon-secretary/evaluation/agenda-practice-c4dev.json", "packages/salon-secretary/evaluation/agenda-practice-c4rules.json",
  "packages/salon-secretary/evaluation/agenda-practice-variations.json", "packages/salon-secretary/evaluation/agenda-practice-natural.json"] as const;
export const LINT_GOLDEN_FILE = "packages/salon-secretary/evaluation/free-use-golden-30.json";
export const LINT_EXCERPTS_FILE = ".demo/agenda-core/c4-failure-excerpts.md";
export const LINT_QUOTED_DOCS = ["docs/SECRETARY_C4_PROOF_RESULT.md"] as const;
export const LINT_SPIKE_DIR = "docs/c5-spike";
/** Names every set declares (professionals, customers, appointment customers, the Golden fixture) and the names new tests never use. */
export const LINT_BANNED_NAMES = ["Amanda", "Fábio", "João", "Tatiana", "Rosa", "Carla", "Ricardo", "Rodrigo"] as const;
type Scenario = { steps?: { say?: unknown }[]; answers?: unknown; professionals?: { name?: unknown }[]; customers?: { name?: unknown }[]; appointments?: { customer?: unknown }[] };
export function lintSources(root = process.cwd()): { sources: LintSource[]; names: Set<string> } {
  const names = new Set<string>(), sources: LintSource[] = [];
  const addNames = (...values: unknown[]) => { for (const value of values) if (typeof value === "string") for (const word of lintFold(value).split(/[^\p{L}\p{N}]+/u)) if (word.length > 1) names.add(word); };
  addNames(...LINT_BANNED_NAMES);
  for (const file of LINT_SCENARIO_FILES) {
    const scenarios = json(root, file) as Scenario[];
    for (const s of scenarios) addNames(...(s.professionals ?? []).map(p => p.name), ...(s.customers ?? []).map(c => c.name), ...(s.appointments ?? []).map(a => a.customer));
    sources.push({ file, texts: scenarios.flatMap(s => [...(s.steps ?? []).flatMap(step => typeof step.say === "string" ? [step.say] : []), ...stringLeaves(s.answers)]) });
  }
  const golden = json(root, LINT_GOLDEN_FILE) as { fixture: { customers: { name: string }[]; professionals: { name: string }[] }; cases: { turns: { message: string }[] }[] };
  addNames(...golden.fixture.customers.map(c => c.name), ...golden.fixture.professionals.map(p => p.name));
  sources.push({ file: LINT_GOLDEN_FILE, texts: golden.cases.flatMap(c => c.turns.map(turn => turn.message)) });
  sources.push({ file: LINT_EXCERPTS_FILE, texts: [readFileSync(join(root, LINT_EXCERPTS_FILE), "utf8")] });
  const spike = readdirSync(join(root, LINT_SPIKE_DIR)).filter(name => name.endsWith(".md")).sort().map(name => `${LINT_SPIKE_DIR}/${name}`);
  for (const file of [...spike, ...LINT_QUOTED_DOCS]) sources.push({ file, texts: quotedExcerpts(readFileSync(join(root, file), "utf8")) });
  return { sources, names };
}
/** Collisions of target texts with the sources: gram → source files. */
export function lintCollisions(targets: readonly string[], sources: readonly LintSource[], names: ReadonlySet<string>, allowed: ReadonlySet<string> = new Set()) {
  const index = new Map<string, Set<string>>();
  for (const source of sources) for (const text of source.texts) for (const gram of lintGrams(text, names)) (index.get(gram) ?? index.set(gram, new Set()).get(gram)!).add(source.file);
  const out = new Map<string, string[]>();
  for (const text of targets) for (const gram of lintGrams(text, names)) if (!allowed.has(gram) && index.has(gram)) out.set(gram, [...index.get(gram)!]);
  return out;
}
/** The owner's rules 1-23 of docs/DECISOES_PRODUTO.md (the Secretária sections), by number, with their continuation lines. */
export function ownerRules(root = process.cwd()): Map<number, string> {
  const lines = readFileSync(join(root, "docs/DECISOES_PRODUTO.md"), "utf8").split(/\r?\n/), rules = new Map<number, string>();
  const start = lines.findIndex(line => line.startsWith("## Secretária de Agenda"));
  let current: number | null = null;
  for (const line of start < 0 ? [] : lines.slice(start)) {
    const item = /^(\d+)\.\s+(.*)$/.exec(line);
    if (item) { current = Number(item[1]); rules.set(current, item[2]); }
    else if (line.startsWith("#")) current = null;
    else if (current !== null && line.trim()) rules.set(current, `${rules.get(current)}\n${line}`);
  }
  return rules;
}
