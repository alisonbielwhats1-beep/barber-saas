import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePilotInterpretation, PILOT_RESCHEDULE_DESCRIPTION, PILOT_RESCHEDULE_PARAMETERS } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { validateScenarios } from "../../../packages/salon-secretary/evaluation/agenda-practice-lib";
import { PILOT_PROMPT, PILOT_PROMPT_EXAMPLE_NAMES } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { lintCollisions, lintFold, lintGrams, lintSources, lintTokens } from "../../test/secretary-agent-lint";

/** Reschedule pilot E2-B, what Luna is told and the DEV battery (docs/c5-spike/12-piloto-remarcacao.md §11; Adendo 11), written BEFORE the
 * implementation. Structure, never wording: concepts by folded stems of OUR OWN texts (prompt and schema), examples by their decoded shape.
 *  - The rules teach the anchored offset (operation + anchor(s) + literal), that BOTH anchors are listed when either reading is plausible (the
 *    system asks), that Luna never computes a date, and the delegated modes "qualquer" and "outro".
 *  - REGRESSION-2 for E2-B: the synthetic DEV battery of the paid probe (pilot-e2b-dev.json) never mirrors the prompt examples (names, catalog
 *    names, content 3-grams, sentence frames), never collides with the evaluation sources, and exercises every new mechanism with twins.
 * Only verdicts and counts are reported (never a sentence of a set). No network, database or model. */
const descriptions = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(descriptions) : value && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => key === "description" && typeof child === "string" ? [child] : descriptions(child)) : [];
const fold = (text: string) => ` ${lintFold(text).replace(/[^\p{L}\p{N}_]+/gu, " ").trim()} `;
const has = (text: string, stems: readonly string[]) => stems.some(stem => fold(text).includes(stem));
/** The prompt's rules as blocks (a line and its indented continuation lines), the examples (JSON lines and their quoted messages) aside. */
const ruleBlocks = (() => {
  const out: string[] = [];
  for (const line of PILOT_PROMPT.split(/\r?\n/)) if (/^\s/.test(line) && out.length) out[out.length - 1] += `\n${line}`; else out.push(line);
  return out.filter(block => !block.trim().startsWith("{") && !/^[^:"“«]{0,24}:\s*["“«]/u.test(block.trim()));
})();
const rules = [...ruleBlocks, ...descriptions(PILOT_RESCHEDULE_PARAMETERS), PILOT_RESCHEDULE_DESCRIPTION];
function examples(): { message: string; value: Record<string, unknown> }[] {
  const lines = PILOT_PROMPT.split(/\r?\n/), out: { message: string; value: Record<string, unknown> }[] = [];
  lines.forEach((line, index) => {
    if (!line.trim().startsWith("{")) return;
    const before = lines.slice(0, index).reverse().find(item => item.trim()) ?? "";
    out.push({ message: /["“«](.*)["”»]/u.exec(before)?.[1] ?? "", value: decodePilotInterpretation(JSON.parse(line)) as unknown as Record<string, unknown> });
  });
  return out;
}
const words = (text: string) => lintFold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

describe("E2-B: what Luna is told about anchors and delegation", () => {
  it("the rules name the anchored offset and its parts: deslocamento, ancoras and each anchor value", () => {
    const text = rules.join("\n");
    for (const stem of ["deslocamento", "ancoras", "origem", "hoje", "data_citada", "agora"]) expect(has(text, [stem]), stem).toBe(true);
  });
  it("where the anchors are taught, both are listed when either reading is plausible (the system asks), and Luna never computes the date", () => {
    const anchorRules = rules.filter(block => has(block, ["ancora"])).join("\n");
    expect(anchorRules.length).toBeGreaterThan(0);
    expect(has(anchorRules, ["duas", "ambas", "as 2", "mais de uma"]), "both anchors listed").toBe(true);
    expect(has(rules.join("\n"), ["nunca calcula", "nao calcula"]), "never computes").toBe(true);
  });
  it("the delegated modes are both in the rules: \"qualquer\" (whoever is free, the current one included) and \"outro\" (someone other than the current one)", () => {
    const text = rules.join("\n");
    expect(text).toMatch(/["“]outro["”]/u);
    expect(text).toMatch(/["“]qualquer["”]/u);
  });
  it("every prompt example still decodes under the E2-B contract (and none uses a removed operator)", () => {
    const list = examples();
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const { value } of list) for (const name of ["relativo_hoje", "origem_mais_dias", "origem_mais_minutos"]) expect(JSON.stringify(value).includes(name), name).toBe(false);
  });
});

type DevScenario = { id: string; capability: string[]; steps: { say?: string }[]; answers?: unknown; salon?: { services?: { name: string }[] };
  professionals?: { name: string }[]; customers?: { name: string }[]; final?: { mustAsk?: string[] } };
const DEV_FILE = "packages/salon-secretary/evaluation/pilot-e2b-dev.json";
const dev = JSON.parse(readFileSync(DEV_FILE, "utf8")) as DevScenario[];
const leaves = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(leaves) : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];
const says = dev.flatMap(scenario => [...scenario.steps.flatMap(step => typeof step.say === "string" ? [step.say] : []), ...leaves(scenario.answers)]);

describe("E2-B DEV battery (synthetic, for the paid development probe): valid, every new mechanism with twins", () => {
  it("is a valid scenario set, ids PB01.. in order", () => {
    expect(dev.length).toBeGreaterThanOrEqual(14);
    expect(() => validateScenarios(dev)).not.toThrow();
    expect(dev.map(scenario => scenario.id)).toEqual(dev.map((_, index) => `PB${String(index + 1).padStart(2, "0")}`));
  });
  it("exercises each mechanism (anchors origem / hoje / data_citada / two, clock offsets, delegation any / other / same slot / nobody free / named) and has R2 cases", () => {
    const count = (tag: string) => dev.filter(scenario => scenario.capability.includes(tag)).length;
    const minimum: Record<string, number> = { "anchor-origin": 2, "anchor-today": 2, "anchor-cited-date": 1, "anchor-two": 1, "relative-time": 2, "delegated-any": 2,
      "delegated-other": 1, "same-slot": 2, "nobody-free": 1, "named-professional": 1 };
    for (const [tag, least] of Object.entries(minimum)) expect(count(tag), tag).toBeGreaterThanOrEqual(least);
    expect(dev.filter(scenario => scenario.final?.mustAsk?.length).length).toBeGreaterThanOrEqual(3);
  });
  it("names: absent from every evaluation name pool and disjoint from the prompt's example names (counts only)", () => {
    const pools: string[] = [];
    const walkDir = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== "results" && name !== "node_modules") walkDir(path); } else if (/^(names.*|generated-.*)\.json$/.test(name)) pools.push(path); } };
    walkDir("packages/salon-secretary/evaluation");
    expect(pools.length).toBeGreaterThanOrEqual(3);
    const pooled = new Set<string>();
    const walk = (value: unknown): void => { if (typeof value === "string") words(value).forEach(word => pooled.add(word));
      else if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { walk(key); walk(item); } };
    for (const file of pools) walk(JSON.parse(readFileSync(file, "utf8")));
    const { names } = lintSources(), declared = new Set(PILOT_PROMPT_EXAMPLE_NAMES.flatMap(words));
    const devNames = dev.flatMap(scenario => [...(scenario.professionals ?? []), ...(scenario.customers ?? [])].map(item => item.name));
    expect(devNames.length).toBeGreaterThan(30);
    const inPools = devNames.filter(name => words(name).some(word => pooled.has(word) || names.has(word)));
    const inPrompt = devNames.filter(name => words(name).some(word => declared.has(word)));
    expect({ inPools: inPools.length, inPrompt: inPrompt.length }).toEqual({ inPools: 0, inPrompt: 0 });
  }, 60_000);
  it("catalog names: none appears in the prompt", () => {
    const prompt = fold(PILOT_PROMPT);
    expect(dev.flatMap(scenario => (scenario.salon?.services ?? []).map(service => service.name)).filter(name => prompt.includes(fold(name))).length).toBe(0);
  });
  it("sentences: no content 3-gram shared with the prompt, no 2-gram frame shared with a prompt example message, no collision with the evaluation sources", () => {
    const { sources, names } = lintSources(), declared = new Set([...names, ...PILOT_PROMPT_EXAMPLE_NAMES.flatMap(words)]);
    const promptGrams = lintGrams(PILOT_PROMPT, declared);
    expect(says.flatMap(text => [...lintGrams(text, declared)].filter(gram => promptGrams.has(gram))).length).toBe(0);
    // E2-B review REGRESSION-4: markers (names, numbers, weekdays) are dropped BEFORE pairing, so a frame "verb + <name> + unit" still collides.
    const pairs = (text: string) => { const out = new Set<string>(); for (const tokens of lintTokens(text, declared)) {
      const content = tokens.filter(token => !token.startsWith("<"));
      for (let i = 0; i + 2 <= content.length; i++) out.add(`${content[i]} ${content[i + 1]}`); } return out; };
    const examplePairs = new Set(examples().flatMap(({ message }) => [...pairs(message)]));
    expect(says.flatMap(text => [...pairs(text)].filter(pair => examplePairs.has(pair))).length).toBe(0);
    expect(lintCollisions(says, sources, names).size).toBe(0);
  }, 60_000);
});
