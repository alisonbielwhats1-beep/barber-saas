import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@everflair/salon-secretary";
import { agentRequestBody } from "../../../packages/salon-secretary/src/agent-loop";
import { assertSecretaryPilotAnchorProbeModelRequest, assertSecretaryPilotModelRequest, assertSecretaryResponsesPayload } from "../../../packages/salon-secretary/src/openai-cost-guard";
import { pilotToolsDigest, PILOT_REQUEST_LIMITS, PILOT_RESCHEDULE_DESCRIPTION, PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { pilotRepairText, pilotSystemText, PILOT_CALL_LIMITS, PILOT_DATA_LABEL, PILOT_PROMPT, PILOT_REPAIR_RULES, type PilotRequestContext } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { astarTool, decodeAstarInterpretation, PILOT_ASTAR_PARAMETERS, type AstarInterpretation } from "../../../packages/salon-secretary/src/pilot-astar-contract";
import { astarAttempt, astarContractParts, astarRepairText, astarRequest, runAstarInterpretation, PILOT_ASTAR_CONTRACT_SHA256, PILOT_ASTAR_MODEL, PILOT_ASTAR_PROMPT,
  PILOT_ASTAR_PROMPT_EXAMPLE_NAMES, PILOT_ASTAR_REPAIR_RULES } from "../../../packages/salon-secretary/src/pilot-astar-prompt";
import { pilotMentionIn } from "../secretary-pilot-resolver";
import { lintCollisions, lintFold, lintGrams, lintSources, lintTokens, stringLiterals } from "../../test/secretary-agent-lint";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

/** A* premise probe, what Luna is told (docs/c5-spike/13-sonda-premissa-astar.md §2; Adendo 12), written BEFORE the prompt module. Structure, never
 * wording: concepts by folded stems of OUR OWN texts, examples by their decoded shape. The variant changes only what the spec names: rule 2 teaches the
 * starting point by MEANING (evidence first, then its type, then the anchor; the cited reference always typed in its own field; null or "outro" when no
 * word names the starting point; Luna never decides what is ambiguous) and the examples that carry an offset; every other line is the E2-B prompt.
 * Invented examples with contrast twins, names outside every evaluation pool, no content 3-gram shared with any evaluation source, no frame shared with
 * the DEV batteries. The request is the E2-B wiring with the variant tool, admitted by the guard only under {pilotAnchorProbe:true}. No network. */
const MODEL = "gpt-6-luna";
const fold = (text: string) => ` ${lintFold(text).replace(/[^\p{L}\p{N}_]+/gu, " ").trim()} `;
const has = (text: string, stems: readonly string[]) => stems.some(stem => fold(text).includes(` ${stem}`));
const words = (text: string) => lintFold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const descriptions = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(descriptions) : value && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => key === "description" && typeof child === "string" ? [child] : descriptions(child)) : [];
/** The examples: every JSON line with the quoted owner message on the line before it. */
function examples(): { message: string; value: AstarInterpretation }[] {
  const lines = PILOT_ASTAR_PROMPT.split(/\r?\n/), out: { message: string; value: AstarInterpretation }[] = [];
  lines.forEach((line, index) => {
    if (!line.trim().startsWith("{")) return;
    out.push({ message: /["“«](.*)["”»]/u.exec(lines[index - 1] ?? "")?.[1] ?? "", value: decodeAstarInterpretation(JSON.parse(line)) });
  });
  return out;
}
/** The anchor rule: the rule-2 block that speaks of ancora (with its continuation lines). */
const ruleTwo = (() => { const lines = PILOT_ASTAR_PROMPT.split("\n"), start = lines.findIndex(line => line.startsWith("2. ")), end = lines.findIndex(line => line.startsWith("3. "));
  return lines.slice(start, end).join("\n"); })();
const anchorBullet = ruleTwo.split("\n").find(line => line.includes("ancora")) ?? "";
type Shift = { tipo: "deslocamento"; ancora: { evidencia: string; tipo_evidencia: string; tipo: string } | null; data_citada?: { mencao: string } | null; hora_citada?: { mencao: string } | null; mencao: string };
const shifts = (value: AstarInterpretation) => [value.destino.dia, value.destino.hora].filter((item): item is never => item?.tipo === "deslocamento") as unknown as Shift[];
const context = (over: Partial<PilotRequestContext> = {}): PilotRequestContext => ({ today: { date: "2031-03-10", weekday: "segunda-feira", timezone: "America/Sao_Paulo" },
  team: ["Bartolomeu Iguaçu", "Cremilda Pirapora"], services: ["Banho de lua", "Escova de coco"], ...over });

describe("A* rule 2: the starting point by meaning, evidence first, the cited reference always typed, Luna never decides ambiguity", () => {
  it("names ancora and its three parts in the order Luna writes them (evidencia, then tipo_evidencia, then tipo), and says so", () => {
    expect(anchorBullet.length).toBeGreaterThan(0);
    const at = (name: string) => anchorBullet.indexOf(name);
    expect(at("evidencia")).toBeGreaterThan(-1);
    expect(at("evidencia")).toBeLessThan(at("tipo_evidencia"));
    expect(at("tipo_evidencia")).toBeLessThan(anchorBullet.indexOf("tipo é"));
    expect(has(anchorBullet, ["nesta ordem"])).toBe(true);
  });
  it("teaches each evidence type and each anchor value, the outlets outro and null, and that a placement verb, a quantity, a reason or a name names nothing", () => {
    for (const value of ["nomeia", "deitico", "desloca", "outro", "origem", "hoje", "agora", "data_citada", "hora_citada"]) expect(anchorBullet.includes(`"${value}"`), value).toBe(true);
    expect(has(anchorBullet, ["ancora e null"]), "null outlet").toBe(true);
    expect(has(anchorBullet, ["nao dito", "nao dizem"]), "outro counts as not said").toBe(true);
    for (const stem of ["quantidade", "direcao", "motivo", "nome", "lugar"]) expect(has(anchorBullet, [stem]), stem).toBe(true);
  });
  it("the cited date or clock is typed in its own field whether or not it is the starting point; Luna never computes a date", () => {
    expect(has(ruleTwo, ["data_citada"]) && has(ruleTwo, ["hora_citada"])).toBe(true);
    expect(has(ruleTwo, ["seja ou nao"]), "whether or not it is the starting point").toBe(true);
    expect(has(ruleTwo, ["nunca calcula"]), "never computes").toBe(true);
  });
  it("Luna never decides whether something is ambiguous: no instruction to list two anchors, no ancoras list, the system computes and asks", () => {
    expect(has(anchorBullet, ["nunca decide se"]), "never decides").toBe(true);
    expect(has(anchorBullet, ["pergunta"]), "the system asks").toBe(true);
    expect(PILOT_ASTAR_PROMPT.includes("ancoras")).toBe(false);
    expect(has(PILOT_ASTAR_PROMPT, ["liste as duas", "liste ambas"])).toBe(false);
  });
  it("only rule 2 (its last two bullets), the examples header and the offset examples change: every other line is the E2-B prompt, rule 1 included (§4 redundancy)", () => {
    const ours = PILOT_ASTAR_PROMPT.split("\n"), theirs = new Set(PILOT_PROMPT.split("\n"));
    const changed = ours.filter(line => !theirs.has(line));
    const offsetLines = new Set(examples().filter(({ value }) => shifts(value).length || value.origem.dia?.tipo === "deslocamento").flatMap(({ message, value }) => [`Mensagem: "${message}"`, JSON.stringify(value)]));
    for (const line of changed) expect(line.startsWith("   - \"mesmo_da_origem\"") || line.startsWith("   - No destino, ancora") || line.includes("exemplos inventados") || offsetLines.has(line), line.slice(0, 40)).toBe(true);
    expect(ours.find(line => line.startsWith("1. "))).toBe(PILOT_PROMPT.split("\n").find(line => line.startsWith("1. ")));
    expect(changed.length).toBeLessThanOrEqual(3 + 2 * 8);
  });
});

describe("A* examples: invented, decodable, contained, with contrast twins", () => {
  it("every example decodes under the A* contract; every mention, evidence and cited mention is a copy contained in its message", () => {
    const list = examples();
    expect(list.length).toBe(14);
    for (const { message, value } of list) {
      for (const shift of shifts(value)) {
        expect(pilotMentionIn(message, shift.mencao), shift.mencao).toBe(true);
        if (shift.ancora) expect(pilotMentionIn(message, shift.ancora.evidencia), shift.ancora.evidencia).toBe(true);
        const cited = shift.data_citada ?? shift.hora_citada;
        if (cited) expect(pilotMentionIn(message, cited.mencao), cited.mencao).toBe(true);
      }
      if (value.origem.dia?.tipo === "deslocamento") expect(Object.keys(value.origem.dia)).not.toContain("ancora");
    }
  });
  it("covers every way to name the starting point and the null outlet: nomeia (the appointment, a cited date, a cited clock), deitico, desloca (a day and a clock), null", () => {
    const seen = new Set(examples().flatMap(({ value }) => [value.destino.dia, value.destino.hora].flatMap(item => item?.tipo === "deslocamento"
      ? [`${"quantidade" in item ? "dia" : "hora"}:${(item as unknown as Shift).ancora ? `${(item as unknown as Shift).ancora!.tipo_evidencia}/${(item as unknown as Shift).ancora!.tipo}` : "null"}`] : [])));
    for (const key of ["dia:nomeia/origem", "dia:nomeia/data_citada", "hora:nomeia/hora_citada", "dia:deitico/hoje", "dia:desloca/origem", "hora:desloca/origem", "dia:null"]) expect(seen.has(key), key).toBe(true);
  });
  it("contrast twins: a verb that moves the appointment (desloca) beside a verb that only places it with no starting point (null); a deictic that is the start beside one in a reason", () => {
    const list = examples().map(({ message, value }) => ({ message, shift: shifts(value)[0], observacoes: value.observacoes })).filter(item => item.shift);
    const desloca = list.find(item => item.shift.ancora?.tipo_evidencia === "desloca" && "quantidade" in item.shift), none = list.find(item => item.shift.ancora === null);
    expect(desloca && none).toBeTruthy();
    // The null example carries a deictic in its reason (kept in observacoes, never the evidence); another example has a deictic as its evidence.
    const deictic = list.find(item => item.shift.ancora?.tipo_evidencia === "deitico")!;
    expect(none!.observacoes.some(text => pilotMentionIn(text, deictic.shift.ancora!.evidencia))).toBe(true);
    // A cited clock as the start beside the appointment clock delayed by a verb.
    expect(list.some(item => item.shift.ancora?.tipo === "hora_citada" && !!item.shift.hora_citada)).toBe(true);
    expect(list.some(item => item.shift.ancora?.tipo_evidencia === "desloca" && "minutos" in item.shift && item.shift.hora_citada === null)).toBe(true);
  });
  it("the example names are the declared ones, absent from every evaluation name pool (only verdicts are reported)", () => {
    const declared = new Set(PILOT_ASTAR_PROMPT_EXAMPLE_NAMES.flatMap(words));
    for (const name of PILOT_ASTAR_PROMPT_EXAMPLE_NAMES) expect(PILOT_ASTAR_PROMPT.includes(name), name).toBe(true);
    for (const { value } of examples()) for (const mention of [value.cliente.mencao, value.origem.profissional_mencao, value.destino.profissional.mencao, ...value.destino.profissional.excluidos])
      if (mention) expect(words(mention).filter(word => !declared.has(word)), mention).toEqual([]);
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
    for (const name of PILOT_ASTAR_PROMPT_EXAMPLE_NAMES) expect(words(name).filter(word => pooled.has(word) || names.has(word)), name).toEqual([]);
  }, 60_000);
});

describe("A* contamination lint (extends the pilot lint to the new files)", () => {
  const { sources, names } = lintSources();
  const allowed = new Set([...["Encontrei X, mas você escreveu Y. É essa cliente ou outra pessoa?", "Não consegui entender com segurança; nada foi alterado.", "O cliente será avisado da remarcação."]
    .flatMap(text => [...lintGrams(text, names)]), "faz servico livre"]);
  const report = (hits: Map<string, string[]>) => [...hits].map(([gram, files]) => `${gram} <= ${files.join(", ")}`);
  it("the A* prompt, the data label, the tool description and every schema description share no content 3-gram with any evaluation source", () => {
    expect(report(lintCollisions([PILOT_ASTAR_PROMPT, PILOT_DATA_LABEL, PILOT_RESCHEDULE_DESCRIPTION, ...descriptions(PILOT_ASTAR_PARAMETERS)], sources, names, allowed))).toEqual([]);
  });
  it("the string literals of the new sources and scripts share none either", () => {
    const files = ["packages/salon-secretary/src/pilot-astar-contract.ts", "packages/salon-secretary/src/pilot-astar-prompt.ts", "src/lib/secretary-pilot-anchor.ts",
      "packages/salon-secretary/evaluation/pilot-anchor-probe.ts", "scripts/run-pilot-anchor-probe.cjs"];
    const hits = new Map<string, string[]>();
    for (const file of files) for (const [gram, from] of lintCollisions(stringLiterals(readFileSync(file, "utf8")), sources, names, allowed)) hits.set(`${file}: ${gram}`, from);
    expect(report(hits)).toEqual([]);
  });
  it("the DEV batteries never mirror the A* examples: no shared content 3-gram with the prompt, no content-word pair with an example message, no catalog name in the prompt", () => {
    const declared = new Set([...names, ...PILOT_ASTAR_PROMPT_EXAMPLE_NAMES.flatMap(words)]), promptGrams = lintGrams(PILOT_ASTAR_PROMPT, declared);
    const pairs = (text: string) => { const out = new Set<string>(); for (const tokens of lintTokens(text, declared)) {
      const content = tokens.filter(token => !token.startsWith("<"));
      for (let i = 0; i + 2 <= content.length; i++) out.add(`${content[i]} ${content[i + 1]}`); } return out; };
    const examplePairs = new Set(examples().flatMap(({ message }) => [...pairs(message)]));
    const leaves = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(leaves) : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];
    for (const file of ["packages/salon-secretary/evaluation/pilot-e2a-dev.json", "packages/salon-secretary/evaluation/pilot-e2b-dev.json"]) {
      const dev = JSON.parse(readFileSync(file, "utf8")) as { steps: { say?: string }[]; answers?: unknown; salon?: { services?: { name: string }[] } }[];
      const says = dev.flatMap(scenario => [...scenario.steps.flatMap(step => typeof step.say === "string" ? [step.say] : []), ...leaves(scenario.answers)]);
      expect(says.length, file).toBeGreaterThan(10);
      expect(says.flatMap(text => [...lintGrams(text, declared)].filter(gram => promptGrams.has(gram))).length, file).toBe(0);
      expect(says.flatMap(text => [...pairs(text)].filter(pair => examplePairs.has(pair))).length, file).toBe(0);
      expect(dev.flatMap(scenario => (scenario.salon?.services ?? []).map(service => service.name)).filter(name => fold(PILOT_ASTAR_PROMPT).includes(fold(name))).length, file).toBe(0);
    }
  }, 60_000);
});

describe("A* request: the E2-B wiring with the variant tool (gpt-6-luna, store:false, one strict tool forced, reasoning medium)", () => {
  const wire = (request: ModelRequest) => JSON.parse(JSON.stringify(agentRequestBody(request, MODEL))) as Record<string, unknown>;
  it("the request carries the variant prompt and tool, the data input and the message; the SDK guard admits it only through the probe's own check", () => {
    const request = astarRequest(context(), "Zebedeu passa a sessão para o dia vinte");
    expect(request.systemInstructions).toBe(PILOT_ASTAR_PROMPT);
    expect(request.input).toEqual([{ role: "system", content: pilotSystemText(context()) }, { role: "user", content: "Zebedeu passa a sessão para o dia vinte" }]);
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0]).toMatchObject({ type: "function", name: PILOT_RESCHEDULE_TOOL, strict: true, parameters: PILOT_ASTAR_PARAMETERS });
    expect(request.modelSettings).toEqual({ toolChoice: PILOT_RESCHEDULE_TOOL, parallelToolCalls: false, maxTokens: PILOT_REQUEST_LIMITS.maxOutputTokens, store: false,
      reasoning: { effort: PILOT_REQUEST_LIMITS.effort } });
    expect(astarAttempt(request)).toEqual({ attempt: 1, purpose: "PILOT_INTERPRETATION" });
    expect(() => assertSecretaryPilotAnchorProbeModelRequest(request)).not.toThrow();
    expect(() => assertSecretaryPilotModelRequest(request)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(PILOT_ASTAR_MODEL).toBe(MODEL);
  });
  it("the HTTP body passes the payload guard only with {pilotAnchorProbe:true} (never with no option, {pilot:true} or {agent:true})", () => {
    const body = wire(astarRequest(context(), "Zebedeu passa a sessão para o dia vinte"));
    expect(() => assertSecretaryResponsesPayload(body, MODEL, { pilotAnchorProbe: true })).not.toThrow();
    for (const options of [{}, { pilot: true }, { agent: true }, { agent: true, pilot: true }]) expect(() => assertSecretaryResponsesPayload(body, MODEL, options), JSON.stringify(options)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    const repair = wire(astarRequest(context(), "x", { repair: ["SCHEMA:invalid_type@tipo"] }));
    expect(() => assertSecretaryResponsesPayload(repair, MODEL, { pilotAnchorProbe: true })).not.toThrow();
  });
  it("the repair note: the A* rules are the E2-B ones minus the three anchor rules, with the same fixed sentences and the same note", () => {
    expect(Object.keys(PILOT_ASTAR_REPAIR_RULES)).toEqual(["RULE:misto_sem_fora_do_escopo", "RULE:nomeado_sem_mencao", "RULE:excluidos_sem_delegacao"]);
    for (const [code, sentence] of Object.entries(PILOT_ASTAR_REPAIR_RULES)) expect(sentence).toBe((PILOT_REPAIR_RULES as Record<string, string>)[code]);
    const reasons = [...Object.keys(PILOT_ASTAR_REPAIR_RULES), "SCHEMA:invalid_type@tipo", "WIRE"];
    expect(astarRepairText(reasons)).toBe(pilotRepairText(reasons));
    const repaired = astarRequest(context(), "x", { repair: reasons });
    expect(repaired.input).toHaveLength(3);
    expect(astarAttempt(repaired)).toEqual({ attempt: 2, purpose: "PILOT_REPAIR" });
  });
  it("the contract version sha pins the prompt, the tool, the repair rules, the data layout, the limits and the model", () => {
    const parts = astarContractParts();
    expect(parts).toMatchObject({ prompt: PILOT_ASTAR_PROMPT, model: MODEL, limits: PILOT_REQUEST_LIMITS, calls: PILOT_CALL_LIMITS, repairRules: PILOT_ASTAR_REPAIR_RULES });
    expect(parts.tool).toEqual(astarTool());
    expect(PILOT_ASTAR_CONTRACT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(PILOT_ASTAR_CONTRACT_SHA256).toBe(pilotToolsDigest([parts]));
    expect(pilotToolsDigest([{ ...parts, prompt: `${PILOT_ASTAR_PROMPT} ` }])).not.toBe(PILOT_ASTAR_CONTRACT_SHA256);
  });
});

describe("A* call loop: one interpretation, at most one format repair, 15 s per call and 45 s per message, the raw arguments kept for the sealed detail", () => {
  const valid = { tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null, cliente: { mencao: "Zebedeu" },
    origem: { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null },
    destino: { dia: { tipo: "deslocamento", quantidade: 2, unidade: "dias", data_citada: null, ancora: { evidencia: "passa a sessão", tipo_evidencia: "desloca", tipo: "origem" }, mencao: "dois dias" },
      hora: null, profissional: { modo: null, mencao: null, excluidos: [] } }, observacoes: [], fora_do_escopo: [] };
  const run = (frames: unknown[][], startedAt = performance.now()) => {
    const model = new ScriptedServicesModel(frames as never);
    return { model, outcome: runAstarInterpretation(model as never, { context: context(), message: "Zebedeu passa a sessão dois dias", modelId: MODEL, startedAt }) };
  };
  it("a valid first answer: one call, decoded, its raw arguments kept", async () => {
    const { model, outcome } = run([call(PILOT_RESCHEDULE_TOOL, valid)]);
    const result = await outcome;
    expect(result).toMatchObject({ ok: true, interpretation: valid, telemetry: { calls: 1, repaired: false } });
    expect(result.raw).toEqual([JSON.stringify(valid)]);
    expect(model.requests).toHaveLength(1);
  });
  it("an invalid first answer gets one repair with codes only; two invalid answers end with PILOT_SCHEMA and no third call", async () => {
    const repaired = run([call(PILOT_RESCHEDULE_TOOL, { tipo: "remarcar" }), call(PILOT_RESCHEDULE_TOOL, valid)]);
    expect(await repaired.outcome).toMatchObject({ ok: true, telemetry: { calls: 2, repaired: true } });
    expect(JSON.stringify(repaired.model.requests[1].input)).toContain("SCHEMA:");
    const twice = run([call(PILOT_RESCHEDULE_TOOL, { tipo: "remarcar" }), call(PILOT_RESCHEDULE_TOOL, { ...valid, extra: 1 }), call(PILOT_RESCHEDULE_TOOL, valid)]);
    const result = await twice.outcome;
    expect(result).toMatchObject({ ok: false, code: "PILOT_SCHEMA", telemetry: { calls: 2 } });
    expect(result.raw).toHaveLength(2);
    expect(twice.model.requests).toHaveLength(2);
  });
  it("an E2-B answer (ancoras) is a format failure of the variant; a transport failure and a spent deadline end the message without a further call", async () => {
    const e2b = { ...valid, destino: { ...valid.destino, dia: { tipo: "deslocamento", quantidade: 2, unidade: "dias", ancoras: ["origem"], data_citada: null, mencao: "dois dias" } } };
    expect(await run([call(PILOT_RESCHEDULE_TOOL, e2b), call(PILOT_RESCHEDULE_TOOL, e2b)]).outcome).toMatchObject({ ok: false, code: "PILOT_SCHEMA" });
    const failing = { requests: [] as ModelRequest[], async getResponse(request: ModelRequest) { this.requests.push(request); throw Error("NETWORK_DOWN"); }, async *getStreamedResponse() { throw Error("NO"); } };
    expect(await runAstarInterpretation(failing as never, { context: context(), message: "x", modelId: MODEL, startedAt: performance.now() })).toMatchObject({ ok: false, code: "PILOT_TRANSPORT" });
    expect(failing.requests).toHaveLength(1);
    const late = run([call(PILOT_RESCHEDULE_TOOL, valid)], performance.now() - PILOT_CALL_LIMITS.messageMs - 1);
    expect(await late.outcome).toMatchObject({ ok: false, code: "PILOT_DEADLINE" });
    expect(late.model.requests).toHaveLength(0);
  });
  it("a request past the cap is never sent (PILOT_BUDGET), whole context, never cut", async () => {
    const huge = context({ services: Array.from({ length: 400 }, (_, index) => `${String(index).padStart(3, "0")} ${"ção".repeat(65)}`) });
    const model = new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, valid)]);
    expect(await runAstarInterpretation(model as never, { context: huge, message: "ção".repeat(333), modelId: MODEL, startedAt: performance.now() })).toMatchObject({ ok: false, code: "PILOT_BUDGET" });
    expect(model.requests).toHaveLength(0);
  });
});
