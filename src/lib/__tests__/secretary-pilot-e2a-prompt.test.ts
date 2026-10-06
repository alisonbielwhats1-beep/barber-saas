import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePilotInterpretation, PILOT_CONTRACT_LIMITS, PILOT_RESCHEDULE_DESCRIPTION, PILOT_RESCHEDULE_PARAMETERS } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { validateScenarios } from "../../../packages/salon-secretary/evaluation/agenda-practice-lib";
import { PILOT_PROMPT, PILOT_PROMPT_EXAMPLE_NAMES } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { lintFold, lintGrams, lintSources, lintTokens as lintTokensOf } from "../../test/secretary-agent-lint";
import { e2aCopiedFrom, e2aFold, type E2aInterpretation } from "../../test/secretary-pilot-e2a";

/** Reschedule pilot E2-A, the semantics of `fora_do_escopo` (docs/c5-spike/12-piloto-remarcacao.md §10.1, Adendo 10), written BEFORE the
 * implementation. The fix is in the contract's meaning, never in lists: the schema description and the prompt define an out-of-scope item as a
 * SEPARATE request with its own effect, list what stays inside the reschedule (reason, context, courtesy, corrections, references to the
 * appointment, conditions, information about the customer, an availability check serving this reschedule) and send context to `observacoes`;
 * the examples are invented and adversarial both ways. Structure, not wording: each concept is checked by a few folded stems (any of them), and
 * the examples by their decoded shape. No network, database or model. */
type Node = Record<string, unknown>;
const props = (node: unknown) => ((node as Node).properties ?? {}) as Record<string, Node>;
const describeOf = (node: Node | undefined) => typeof node?.description === "string" ? node.description : "";
const descriptions = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(descriptions) : value && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => key === "description" && typeof child === "string" ? [child] : descriptions(child)) : [];
const root = props(PILOT_RESCHEDULE_PARAMETERS);
/** Everything Luna reads about the contract. */
const told = [PILOT_PROMPT, PILOT_RESCHEDULE_DESCRIPTION, ...descriptions(PILOT_RESCHEDULE_PARAMETERS)].join("\n");
/** Concept groups: a text names a concept when it holds one of its folded stems. */
const has = (text: string, stems: readonly string[]) => stems.some(stem => e2aFold(text).includes(stem));
const SEPARATE = ["separad", "a parte", "independent", "alem d"], EFFECT = ["efeito"];
const INSIDE: Record<string, readonly string[]> = {
  reason: ["motivo", "razao"], context: ["contexto"], courtesy: ["cortesia", "gentileza", "educacao", "agradec", "saudac"], correction: ["correc", "corrig"],
  reference: ["referenc"], condition: ["condic"], customerInfo: ["informac"], availability: ["disponibilidade", "vaga"],
};
/** The prompt's rules as blocks (a line and its indented continuation lines), the examples (JSON lines and their quoted messages) aside. */
const ruleBlocks = (() => {
  const out: string[] = [];
  for (const line of PILOT_PROMPT.split(/\r?\n/)) if (/^\s/.test(line) && out.length) out[out.length - 1] += `\n${line}`; else out.push(line);
  return out.filter(block => !block.trim().startsWith("{") && !/^[^:"“«]{0,24}:\s*["“«]/u.test(block.trim()));
})();
/** What the prompt says where it speaks of fora_do_escopo or observacoes, with the two schema descriptions. */
const scopeRules = ruleBlocks.filter(block => has(block, ["fora do escopo", "observacoes"]));
const scopeText = [describeOf(root.fora_do_escopo), describeOf(root.observacoes), ...scopeRules].join("\n");

/** The examples of the prompt: every line that is a JSON object, with the quoted owner message on the line before it. */
function examples(): { message: string; value: E2aInterpretation }[] {
  const lines = PILOT_PROMPT.split(/\r?\n/), out: { message: string; value: E2aInterpretation }[] = [];
  lines.forEach((line, index) => {
    if (!line.trim().startsWith("{")) return;
    const before = lines.slice(0, index).reverse().find(item => item.trim()) ?? "";
    const quoted = /["“«](.*)["”»]/u.exec(before);
    out.push({ message: quoted?.[1] ?? "", value: decodePilotInterpretation(JSON.parse(line)) as unknown as E2aInterpretation });
  });
  return out;
}
/** Every text an example copies from its message. */
const copies = (value: E2aInterpretation) => [value.cliente.mencao, value.origem.dia?.mencao, value.origem.hora?.mencao, value.origem.profissional_mencao,
  value.origem.servico?.mencao, value.origem.posicao?.mencao, value.destino.dia?.mencao, value.destino.hora?.mencao, value.destino.profissional.mencao,
  ...(value.observacoes ?? []), ...value.fora_do_escopo.map(item => item.pedido)].filter((item): item is string => typeof item === "string");
const nameMentions = (value: E2aInterpretation) => [value.cliente.mencao, value.origem.profissional_mencao, value.destino.profissional.mencao].filter((item): item is string => !!item);
const words = (text: string) => lintFold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

describe("E2-A: fora_do_escopo is a separate request with its own effect", () => {
  it("the schema description of fora_do_escopo says so and points context to observacoes", () => {
    const text = describeOf(root.fora_do_escopo);
    expect(has(text, SEPARATE), "separate").toBe(true);
    expect(has(text, EFFECT), "effect").toBe(true);
    expect(has(text, ["observacoes"]), "observacoes").toBe(true);
  });
  it("the prompt says so too, in its rules (not only in an example), and sends reason and context to observacoes", () => {
    const rules = scopeRules.join("\n");
    expect(has(rules, SEPARATE), "separate").toBe(true);
    expect(has(rules, EFFECT), "effect").toBe(true);
    expect(scopeRules.some(block => has(block, ["observacoes"])), "observacoes").toBe(true);
  });
  it("what stays inside the reschedule is named where the scope is defined: reason, context, courtesy, corrections, references, conditions, customer information, availability", () => {
    for (const [concept, stems] of Object.entries(INSIDE)) expect(has(scopeText, stems), concept).toBe(true);
  });
  it("observacoes is described as words copied from the message", () => {
    expect(has(describeOf(root.observacoes), ["copi", "palavras"])).toBe(true);
  });
  it("the E1 rule that sent everything but day, clock and professional to fora_do_escopo is gone", () => {
    expect(e2aFold(PILOT_PROMPT)).not.toContain(e2aFold("O que não é mudar dia, hora ou profissional desse atendimento vai em fora_do_escopo"));
  });
  it("weekdays are no longer numbered anywhere Luna reads; the service hint names exact catalog names", () => {
    for (const numbered of ["1 domingo", "2 segunda", "7 sábado"]) expect(e2aFold(told), numbered).not.toContain(e2aFold(numbered));
    expect(has(told, ["catalogo"]), "catalogo").toBe(true);
    expect(has(told, ["exat"]), "exact names").toBe(true);
  });
});

describe("E2-A prompt examples: invented, decodable, adversarial both ways", () => {
  it("every example decodes under the E2-A contract and copies each mention, observation and request from its own message", () => {
    const list = examples();
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const { message, value } of list) {
      expect(message.length, JSON.stringify(value).slice(0, 60)).toBeGreaterThan(0);
      expect(Array.isArray(value.observacoes), "observacoes").toBe(true);
      for (const item of value.fora_do_escopo) expect(Object.keys(item).sort(), "fora_do_escopo item").toEqual(["pedido", "tipo"]);
      for (const copy of copies(value)) expect(e2aCopiedFrom(message, copy), copy).toBe(true);
    }
  });
  it("a context-heavy reschedule keeps everything inside: remarcar, observacoes filled, fora_do_escopo empty", () => {
    const inside = examples().filter(({ value }) => value.tipo === "remarcar" && value.fora_do_escopo.length === 0 && value.observacoes.length > 0);
    expect(inside.length).toBeGreaterThanOrEqual(1);
  });
  it("a real separate request is still an out-of-scope item (with its own words in pedido)", () => {
    const real = examples().filter(({ value }) => value.fora_do_escopo.length > 0);
    expect(real.length).toBeGreaterThanOrEqual(1);
    for (const { value } of real) {
      expect(["misto", "fora_do_escopo"]).toContain(value.tipo);
      for (const item of value.fora_do_escopo) expect(typeof item.pedido, item.tipo).toBe("string");
    }
  });
  it("the examples' names are the declared example names, absent from every evaluation name pool (only verdicts are reported)", () => {
    const declared = new Set(PILOT_PROMPT_EXAMPLE_NAMES.flatMap(words));
    for (const { message, value } of examples()) {
      for (const mention of nameMentions(value)) expect(words(mention).filter(word => !declared.has(word)), mention).toEqual([]);
      // A capitalized word inside a sentence (Xxxx) is a name: it must be a declared example name or a word of a catalog name the example gives.
      const catalog = new Set((value.origem.servico?.catalogo ?? []).flatMap(words));
      const tokens = message.split(/\s+/).filter(Boolean);
      tokens.forEach((token, index) => {
        const bare = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
        const initial = index === 0 || /[.!?:;]["”]?$/u.test(tokens[index - 1]);
        if (!initial && /^\p{Lu}\p{Ll}+$/u.test(bare)) expect(words(bare).every(word => declared.has(word) || catalog.has(word)), bare).toBe(true);
      });
    }
    const pools: string[] = [];
    const walkDir = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== "results" && name !== "node_modules") walkDir(path); } else if (/^(names.*|generated-.*)\.json$/.test(name)) pools.push(path); } };
    walkDir("packages/salon-secretary/evaluation");
    expect(pools.length).toBeGreaterThanOrEqual(3);
    const pooled = new Set<string>();
    const walk = (value: unknown): void => { if (typeof value === "string") words(value).forEach(word => pooled.add(word));
      else if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { walk(key); walk(item); } };
    for (const file of pools) walk(JSON.parse(readFileSync(file, "utf8")));
    const { names } = lintSources();
    for (const name of PILOT_PROMPT_EXAMPLE_NAMES) expect(words(name).filter(word => pooled.has(word) || names.has(word)), name).toEqual([]);
  });
});

/** Adversarial review of E2-A (before the battery). Concepts by folded stems of OUR OWN texts (prompt and schema), examples by their decoded shape:
 * never a list of the owner's words in product code. */
const kinds = () => new Set(examples().flatMap(({ value }) => value.fora_do_escopo.map(item => item.tipo)));
describe("E2-A review SEMANTICS-1/2/3: the scope boundary, both ways, in the rules and in invented examples", () => {
  it("SEMANTICS-1: the rules and the schema say the system already notifies the customer of every reschedule (telling this customer about this change is inside it)", () => {
    expect(has(scopeText, ["ja avisa"]), "prompt rule").toBe(true);
    expect(has(scopeText, ["toda remarcacao"]), "every reschedule").toBe(true);
    expect(has(describeOf(root.fora_do_escopo), ["avis"]), "schema description").toBe(true);
    // One example keeps the notice inside (an observation) beside a message with its own content (a separate request).
    expect(examples().some(({ value }) => value.observacoes.length > 0 && value.fora_do_escopo.some(item => item.tipo === "mensagem"))).toBe(true);
  });
  it("SEMANTICS-2: the rules say taking this customer's appointment out of one slot to put it in another is this reschedule (decision 4); cancelar only when no new slot or another appointment", () => {
    expect(has(scopeText, ["desmarc"]), "said as unbook and book again").toBe(true);
    expect(has(scopeText, ["novo horario"]), "cancel = no new slot").toBe(true);
    expect(has(scopeText, ["outro atendimento"]), "or another appointment").toBe(true);
    expect(has(describeOf(root.fora_do_escopo), ["desmarc", "tirar este atendimento", "tirar o atendimento"]), "schema description").toBe(true);
    // One example: a cancel-worded move of the customer (origin day + destination, inside) and the cancel of another appointment of hers (outside).
    const example = examples().find(({ message, value }) => has(message, ["desmarc"]) && value.origem.dia && value.destino.dia && value.fora_do_escopo.some(item => item.tipo === "cancelar"));
    expect(example, "cancel-worded move beside a real cancel").toBeDefined();
    expect(example!.value.fora_do_escopo.map(item => item.tipo)).toEqual(["cancelar"]);
  });
  it("SEMANTICS-3: a relayed wish of the customer for anything besides day, time or professional is a separate request; a preference that asks nothing stays inside", () => {
    expect(has(scopeText, ["repass"]), "relayed").toBe(true);
    expect(has(scopeText, ["desejo"]), "as a wish").toBe(true);
    expect(has(scopeText, ["preferenc"]), "a preference stays inside").toBe(true);
    // Balance: the examples show real separate requests of these kinds (each invented), and one example mixes relayed wishes with information kept inside.
    for (const kind of ["outra_acao", "agendar", "consultar", "cancelar", "mensagem", "trocar_servico", "recorrencia"]) expect(kinds().has(kind as never), kind).toBe(true);
    expect(examples().some(({ value }) => value.observacoes.length > 0 && value.fora_do_escopo.some(item => item.tipo === "trocar_servico")
      && value.fora_do_escopo.some(item => item.tipo === "recorrencia"))).toBe(true);
    // No blanket default toward fora_do_escopo (the gate's main cause was false out-of-scope items).
    expect(has(scopeText, ["na duvida", "em caso de duvida"])).toBe(false);
  });
});

describe("E2-A review CONTRACT-1: the prompt states the bounds the decoder enforces", () => {
  it("observacoes: at most the decoder's count, nothing has to be copied in full; catalogo: at most 10 names, [] when more would fit", () => {
    const observationRules = ruleBlocks.filter(block => has(block, ["observacoes"])).join("\n");
    expect(observationRules).toContain(String(PILOT_CONTRACT_LIMITS.observations));
    const catalogRules = ruleBlocks.filter(block => has(block, ["catalogo"])).join("\n");
    expect(catalogRules).toContain(`${PILOT_CONTRACT_LIMITS.catalogNames} nomes`);
    expect(e2aFold(catalogRules)).toContain(e2aFold(`mais de ${PILOT_CONTRACT_LIMITS.catalogNames}`));
    for (const { value } of examples()) {
      expect(value.observacoes.length).toBeLessThanOrEqual(PILOT_CONTRACT_LIMITS.observations);
      expect(value.origem.servico?.catalogo.length ?? 0).toBeLessThanOrEqual(PILOT_CONTRACT_LIMITS.catalogNames);
    }
  });
});

describe("E2-A review REGRESSION-2: the DEV battery never mirrors the prompt examples (only verdicts and counts are reported)", () => {
  type DevScenario = { id: string; steps: { say?: string }[]; answers?: unknown; salon?: { services?: { name: string }[] }; professionals?: { name: string }[]; customers?: { name: string }[] };
  const dev = JSON.parse(readFileSync("packages/salon-secretary/evaluation/pilot-e2a-dev.json", "utf8")) as DevScenario[];
  const leaves = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(leaves) : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];
  const says = dev.flatMap(scenario => [...scenario.steps.flatMap(step => typeof step.say === "string" ? [step.say] : []), ...leaves(scenario.answers)]);
  it("the DEV battery is a valid scenario set", () => {
    expect(dev.length).toBeGreaterThanOrEqual(18);
    expect(() => validateScenarios(dev)).not.toThrow();
  });
  it("DEV customer and professional names: absent from every evaluation name pool and disjoint from the prompt's example names", () => {
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
  it("DEV catalog names: none appears in the prompt", () => {
    const prompt = e2aFold(PILOT_PROMPT);
    const shared = dev.flatMap(scenario => (scenario.salon?.services ?? []).map(service => service.name)).filter(name => prompt.includes(e2aFold(name)));
    expect(shared.length).toBe(0);
  });
  it("DEV sentences: no content 3-gram shared with the prompt, nor a 2-gram shared with any prompt example message", () => {
    const { names } = lintSources(), declared = new Set([...names, ...PILOT_PROMPT_EXAMPLE_NAMES.flatMap(words)]);
    const promptGrams = lintGrams(PILOT_PROMPT, declared);
    const shared = says.flatMap(text => [...lintGrams(text, declared)].filter(gram => promptGrams.has(gram)));
    expect(shared.length).toBe(0);
    // Sentence frames (finding REGRESSION-2: the agendar and consultar examples were mirrored): consecutive content-word pairs, names and
    // numbers aside, of each example message against each DEV sentence.
    const pairs = (text: string) => { const out = new Set<string>(); for (const tokens of lintTokensOf(text, declared)) for (let i = 0; i + 2 <= tokens.length; i++)
      if (!tokens[i].startsWith("<") && !tokens[i + 1].startsWith("<")) out.add(`${tokens[i]} ${tokens[i + 1]}`); return out; };
    const examplePairs = new Set(examples().flatMap(({ message }) => [...pairs(message)]));
    expect(says.flatMap(text => [...pairs(text)].filter(pair => examplePairs.has(pair))).length).toBe(0);
  }, 60_000);
});
