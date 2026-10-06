import { describe, expect, it } from "vitest";
import { decodePilotInterpretation, pilotTool, pilotToolsDigest, PilotContractError, PILOT_RESCHEDULE_DESCRIPTION, PILOT_RESCHEDULE_PARAMETERS, PILOT_RESCHEDULE_TOOL,
  PILOT_TOOLS_SHA256 } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { astarContractRules, astarInterpretationShape, astarParameters, astarTool, compileAstarWire, decodeAstarInterpretation, decodeAstarInterpretationArguments,
  PILOT_ASTAR_CONTRACT_VERSION, PILOT_ASTAR_DAY_ANCHORS, PILOT_ASTAR_EVIDENCE_TYPES, PILOT_ASTAR_MENTION_DESCRIPTIONS, PILOT_ASTAR_PARAMETERS, PILOT_ASTAR_TIME_ANCHORS,
  PILOT_ASTAR_TOOLS_SHA256, type AstarInterpretation } from "../../../packages/salon-secretary/src/pilot-astar-contract";
import { e2bRandom } from "../../test/secretary-pilot-e2b";

/** A* premise probe, the variant contract (docs/c5-spike/13-sonda-premissa-astar.md §2 and §4), written BEFORE the contract. A copy of the E2-B
 * contract with only the destination offsets changed: a day offset is { tipo, quantidade, unidade, data_citada, ancora, mencao } and a clock offset
 * { tipo, minutos, hora_citada, ancora, mencao }, in this order (the order Luna writes them); ancora is { evidencia, tipo_evidencia, tipo } or null
 * (evidence first, then its type, then the anchor; "" counts as null), and the cited day or clock is a typed field of its own beside it. An offset
 * used as an origin hint has no ancora. The three anchor repair rules are gone. Everything else is the E2-B wire. §4: the repeated mencao
 * description is left out of THIS variant only, behind a module constant; both variants are built and compared here (structure and validation), as
 * evidence for the independent verifier, who decides. The E2-B contract is byte-identical. No network, database or model. */
type Node = Record<string, unknown>;
const props = (node: unknown) => ((node as Node | undefined)?.properties ?? {}) as Record<string, Node>;
const branches = (node: Node | undefined): Node[] => !node ? [] : Array.isArray(node.anyOf) ? (node.anyOf as Node[]).filter(item => item.type !== "null") : [node];
const tipoOf = (branch: Node) => (props(branch).tipo?.enum as unknown[] | undefined)?.[0];
const slot = (params: unknown, side: "origem" | "destino", field: "dia" | "hora") => props(props(params)[side])[field];
const shift = (params: unknown, side: "origem" | "destino", field: "dia" | "hora") => branches(slot(params, side, field)).find(branch => tipoOf(branch) === "deslocamento")!;
const enumOf = (node: Node | undefined) => (node?.enum as unknown[] | undefined) ?? [];
const objects = (schema: unknown): Node[] => !schema || typeof schema !== "object" ? [] : Array.isArray(schema) ? schema.flatMap(objects)
  : [...((schema as Node).type === "object" ? [schema as Node] : []), ...Object.values(schema as Node).flatMap(objects)];
/** The E2-B description of every operator mencao (the sentence rule 1 of the prompt states). */
const MENTION_DESCRIPTION = props(branches(slot(PILOT_RESCHEDULE_PARAMETERS, "destino", "dia")).find(branch => tipoOf(branch) === "data")).mencao.description as string;
/** A deep copy without the `description` keys equal to the mention sentence (or without every description). */
const strip = (value: unknown, all = false): unknown => Array.isArray(value) ? value.map(item => strip(item, all)) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([key, child]) => !(key === "description" && (all || child === MENTION_DESCRIPTION))).map(([key, child]) => [key, strip(child, all)])) : value;
const countMentionDescriptions = (value: unknown): number => Array.isArray(value) ? value.reduce((n: number, item) => n + countMentionDescriptions(item), 0) : value && typeof value === "object"
  ? Object.entries(value).reduce((n: number, [key, child]) => n + (key === "description" && child === MENTION_DESCRIPTION ? 1 : countMentionDescriptions(child)), 0) : 0;
const verdict = (raw: unknown) => { try { decodeAstarInterpretation(raw); return "ACCEPTED"; } catch (error) { return error instanceof PilotContractError ? "REJECTED" : `OTHER:${(error as Error).message}`; } };
const reasons = (raw: unknown): readonly string[] => { try { decodeAstarInterpretation(raw); return []; } catch (error) { return error instanceof PilotContractError ? error.reasons : ["OTHER"]; } };

/** An A* payload (every key present; null states absence) with a destination day and clock. */
const dayShift = (over: Node = {}) => ({ tipo: "deslocamento", quantidade: 2, unidade: "dias", data_citada: null, ancora: null, mencao: "dois dias", ...over });
const clockShift = (over: Node = {}) => ({ tipo: "deslocamento", minutos: 30, hora_citada: null, ancora: null, mencao: "meia hora", ...over });
const evidence = (evidencia: string, tipo_evidencia: string, tipo: string) => ({ evidencia, tipo_evidencia, tipo });
const payload = (destino: { dia?: unknown; hora?: unknown } = {}, over: Node = {}) => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null,
  cliente: { mencao: "Zebedeu" }, origem: { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null },
  destino: { dia: destino.dia ?? null, hora: destino.hora ?? null, profissional: { modo: null, mencao: null, excluidos: [] } }, observacoes: [], fora_do_escopo: [], ...over });

describe("A* wire: the destination offsets carry ancora and the cited reference as typed fields (§2)", () => {
  it("destination day offset: { tipo, quantidade, unidade, data_citada, ancora, mencao } in this order, every key required", () => {
    const node = shift(PILOT_ASTAR_PARAMETERS, "destino", "dia");
    expect(Object.keys(props(node))).toEqual(["tipo", "quantidade", "unidade", "data_citada", "ancora", "mencao"]);
    expect(node.required).toEqual(["tipo", "quantidade", "unidade", "data_citada", "ancora", "mencao"]);
    expect(props(node).quantidade).toMatchObject({ type: "integer", minimum: -366, maximum: 366 });
    // The cited day keeps the three CONTRACT-4 forms (or null), exactly as in E2-B.
    expect(strip(props(node).data_citada)).toEqual(strip(props(shift(PILOT_RESCHEDULE_PARAMETERS, "destino", "dia")).data_citada));
  });
  it("ancora: { evidencia, tipo_evidencia, tipo } in this order or null; evidencia 0..120 (an empty string is allowed), four evidence types, the day anchors", () => {
    for (const [field, anchors] of [["dia", PILOT_ASTAR_DAY_ANCHORS], ["hora", PILOT_ASTAR_TIME_ANCHORS]] as const) {
      const ancora = props(shift(PILOT_ASTAR_PARAMETERS, "destino", field)).ancora;
      expect(JSON.stringify(ancora.anyOf ?? ancora.type), field).toContain("null");
      const [object] = branches(ancora);
      expect(Object.keys(props(object)), field).toEqual(["evidencia", "tipo_evidencia", "tipo"]);
      expect(object.required, field).toEqual(["evidencia", "tipo_evidencia", "tipo"]);
      expect(props(object).evidencia, field).toMatchObject({ type: "string", maxLength: 120 });
      expect(props(object).evidencia.minLength ?? 0, field).toBe(0);
      expect(enumOf(props(object).tipo_evidencia), field).toEqual(["nomeia", "deitico", "desloca", "outro"]);
      expect(enumOf(props(object).tipo), field).toEqual([...anchors]);
    }
    expect([...PILOT_ASTAR_EVIDENCE_TYPES]).toEqual(["nomeia", "deitico", "desloca", "outro"]);
    expect([...PILOT_ASTAR_DAY_ANCHORS]).toEqual(["origem", "hoje", "data_citada"]);
    expect([...PILOT_ASTAR_TIME_ANCHORS]).toEqual(["origem", "agora", "hora_citada"]);
  });
  it("destination clock offset: { tipo, minutos, hora_citada, ancora, mencao }; hora_citada { hora, minuto, periodo, mencao } or null, periodo a typed field", () => {
    const node = shift(PILOT_ASTAR_PARAMETERS, "destino", "hora");
    expect(Object.keys(props(node))).toEqual(["tipo", "minutos", "hora_citada", "ancora", "mencao"]);
    expect(props(node).minutos).toMatchObject({ type: "integer", minimum: -1440, maximum: 1440 });
    const [cited] = branches(props(node).hora_citada);
    expect(Object.keys(props(cited))).toEqual(["hora", "minuto", "periodo", "mencao"]);
    expect(props(cited).hora).toMatchObject({ minimum: 0, maximum: 23 });
    expect(props(cited).minuto).toMatchObject({ minimum: 0, maximum: 59 });
    expect(enumOf(props(cited).periodo)).toEqual(["manha", "tarde", "noite", null]);
  });
  it("an offset used as an origin hint has no ancora (and the origin clock offset no hora_citada); the origin day keeps data_citada", () => {
    expect(Object.keys(props(shift(PILOT_ASTAR_PARAMETERS, "origem", "dia")))).toEqual(["tipo", "quantidade", "unidade", "data_citada", "mencao"]);
    expect(Object.keys(props(shift(PILOT_ASTAR_PARAMETERS, "origem", "hora")))).toEqual(["tipo", "minutos", "mencao"]);
    expect(JSON.stringify(PILOT_ASTAR_PARAMETERS).includes("ancoras")).toBe(false);
  });
  it("everything else is the E2-B wire: the root, the client, the origin hints, the professional and every non-offset operator (mencao descriptions aside)", () => {
    const astar = props(PILOT_ASTAR_PARAMETERS), e2b = props(PILOT_RESCHEDULE_PARAMETERS);
    expect(Object.keys(astar)).toEqual(Object.keys(e2b));
    for (const key of Object.keys(e2b).filter(key => key !== "origem" && key !== "destino")) expect(astar[key], key).toEqual(e2b[key]);
    for (const side of ["origem", "destino"] as const) {
      expect(Object.keys(props(astar[side])), side).toEqual(Object.keys(props(e2b[side])));
      expect(astar[side].description, side).toBe(e2b[side].description);
      for (const key of Object.keys(props(e2b[side])).filter(key => key !== "dia" && key !== "hora")) expect(strip(props(astar[side])[key]), `${side}.${key}`).toEqual(strip(props(e2b[side])[key]));
      for (const field of ["dia", "hora"] as const) {
        const ours = branches(slot(PILOT_ASTAR_PARAMETERS, side, field)), theirs = branches(slot(PILOT_RESCHEDULE_PARAMETERS, side, field));
        expect(ours.map(tipoOf), `${side}.${field}`).toEqual(theirs.map(tipoOf));
        for (const [index, branch] of theirs.entries()) if (tipoOf(branch) !== "deslocamento") expect(strip(ours[index]), `${side}.${field}.${String(tipoOf(branch))}`).toEqual(strip(branch));
      }
    }
  });
  it("strict at every level: every property required, nothing else admitted", () => {
    for (const node of objects(PILOT_ASTAR_PARAMETERS)) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(props(node)));
    }
  });
  it("the same tool name and description as E2-B; its own digest and version", () => {
    const tool = astarTool();
    expect(tool).toMatchObject({ type: "function", name: PILOT_RESCHEDULE_TOOL, description: PILOT_RESCHEDULE_DESCRIPTION, strict: true });
    expect(tool.parameters).toEqual(PILOT_ASTAR_PARAMETERS);
    expect(PILOT_ASTAR_TOOLS_SHA256).toBe(pilotToolsDigest([astarTool()]));
    expect(PILOT_ASTAR_TOOLS_SHA256).not.toBe(PILOT_TOOLS_SHA256);
    expect(PILOT_ASTAR_CONTRACT_VERSION).toMatch(/^pilot-astar-probe-\d+$/);
  });
});

describe("A* decoder: strict, typed shape and published wire together; the anchor repair rules are gone", () => {
  it("accepts an evidenced anchor, a null anchor, an empty evidence, the type outro, and a cited reference beside any anchor", () => {
    expect(verdict(payload({ dia: dayShift({ ancora: evidence("Desloca a sessão", "desloca", "origem") }) }))).toBe("ACCEPTED");
    expect(verdict(payload({ dia: dayShift() }))).toBe("ACCEPTED");
    expect(verdict(payload({ dia: dayShift({ ancora: evidence("", "outro", "origem") }) }))).toBe("ACCEPTED");
    expect(verdict(payload({ dia: dayShift({ ancora: evidence("dois dias", "outro", "hoje") }) }))).toBe("ACCEPTED");
    expect(verdict(payload({ dia: dayShift({ data_citada: { dia: 9, mes: null, mencao: "dia 9" }, ancora: evidence("Desloca", "desloca", "origem") }) }))).toBe("ACCEPTED");
    expect(verdict(payload({ dia: dayShift({ data_citada: { tipo: "dia_semana", dia_semana: "quarta", qualificador: null, mencao: "quarta" }, ancora: null }) }))).toBe("ACCEPTED");
    expect(verdict(payload({ hora: clockShift({ hora_citada: { hora: 9, minuto: 30, periodo: "noite", mencao: "nove e meia da noite" }, ancora: evidence("das nove e meia", "nomeia", "hora_citada") }) })))
      .toBe("ACCEPTED");
    expect(verdict(payload({ hora: clockShift({ ancora: evidence("agora", "deitico", "agora") }) }))).toBe("ACCEPTED");
    expect(verdict(payload({ dia: dayShift({ ancora: evidence("é".repeat(120), "nomeia", "origem") }) }))).toBe("ACCEPTED");
  });
  it("the three E2-B anchor rules are gone: an anchor data_citada without a cited day, or a cited day beside another anchor, decode (the module decides)", () => {
    const loose = [payload({ dia: dayShift({ ancora: evidence("do dia 9", "nomeia", "data_citada") }) }),
      payload({ dia: dayShift({ data_citada: { dia: 9, mes: 4, mencao: "9 de abril" }, ancora: evidence("Desloca", "desloca", "origem") }) }),
      payload({ hora: clockShift({ ancora: evidence("das nove", "nomeia", "hora_citada") }) })];
    for (const raw of loose) expect(reasons(raw)).toEqual([]);
    const rules = astarContractRules(loose[0] as unknown as AstarInterpretation);
    for (const code of ["RULE:ancora_repetida", "RULE:data_citada_sem_valor", "RULE:valor_sem_data_citada"]) expect(rules).not.toContain(code);
  });
  it("the remaining rules still hold: misto without a separate request, nomeado without a name, an exclusion list without a delegated mode", () => {
    expect(reasons(payload({}, { tipo: "misto" }))).toEqual(["RULE:misto_sem_fora_do_escopo"]);
    expect(reasons({ ...payload(), destino: { dia: null, hora: null, profissional: { modo: "nomeado", mencao: null, excluidos: [] } } })).toEqual(["RULE:nomeado_sem_mencao"]);
    expect(reasons({ ...payload(), destino: { dia: null, hora: null, profissional: { modo: "manter", mencao: null, excluidos: ["Quintiliana"] } } })).toEqual(["RULE:excluidos_sem_delegacao"]);
  });
  it("rejects: the E2-B ancoras list, a clock anchor in a day offset and the reverse, ancora in an origin hint, evidence over 120, an unknown type, extra or missing keys", () => {
    const rejected = [
      payload({ dia: { tipo: "deslocamento", quantidade: 2, unidade: "dias", ancoras: ["origem"], data_citada: null, mencao: "dois dias" } }),
      payload({ dia: dayShift({ ancora: evidence("agora", "deitico", "agora") }) }),
      payload({ dia: dayShift({ ancora: evidence("das nove", "nomeia", "hora_citada") }) }),
      payload({ hora: clockShift({ ancora: evidence("hoje", "deitico", "hoje") }) }),
      payload({ hora: clockShift({ ancora: evidence("dia 9", "nomeia", "data_citada") }) }),
      { ...payload(), origem: { dia: dayShift({ ancora: null }), hora: null, profissional_mencao: null, servico: null, posicao: null } },
      { ...payload(), origem: { dia: null, hora: clockShift(), profissional_mencao: null, servico: null, posicao: null } },
      payload({ dia: dayShift({ ancora: evidence("é".repeat(121), "nomeia", "origem") }) }),
      payload({ dia: dayShift({ ancora: evidence("Desloca", "verbo", "origem") }) }),
      payload({ dia: dayShift({ ancora: { ...evidence("Desloca", "desloca", "origem"), certeza: "alta" } }) }),
      payload({ dia: { tipo: "deslocamento", quantidade: 2, unidade: "dias", data_citada: null, mencao: "dois dias" } }),
      payload({ hora: clockShift({ hora_citada: { hora: 9, minuto: 0, mencao: "nove" } }) }),
      payload({ hora: clockShift({ hora_citada: { hora: 24, minuto: 0, periodo: null, mencao: "vinte e quatro" } }) }),
    ];
    for (const [index, raw] of rejected.entries()) expect(verdict(raw), String(index)).toBe("REJECTED");
    expect(() => decodeAstarInterpretationArguments("{")).toThrow(PilotContractError);
  });
  it("isolation: the E2-B decoder refuses an A* payload and the A* decoder refuses an E2-B offset", () => {
    const astar = payload({ dia: dayShift({ ancora: evidence("Desloca", "desloca", "origem") }) });
    expect(() => decodePilotInterpretation(astar)).toThrow(PilotContractError);
    expect(verdict(payload({ dia: { tipo: "deslocamento", quantidade: 1, unidade: "semanas", ancoras: ["origem"], data_citada: null, mencao: "uma semana" } }))).toBe("REJECTED");
  });
  it("the typed shape and the compiled published wire agree on random mutations of valid payloads (strings within the basic plane)", () => {
    const rnd = e2bRandom(31), wire = compileAstarWire(PILOT_ASTAR_PARAMETERS);
    const valid = [payload({ dia: dayShift({ ancora: evidence("Desloca", "desloca", "origem") }), hora: clockShift({ hora_citada: { hora: 9, minuto: 0, periodo: null, mencao: "nove" } }) }),
      payload({ dia: dayShift({ data_citada: { tipo: "mes_relativo", dia: 3, meses: 1, mencao: "dia 3" } }) })];
    let disagreements = 0, rejected = 0;
    for (let i = 0; i < 2500; i++) {
      const raw = mutate(structuredClone(valid[i % valid.length]), rnd);
      const typed = astarInterpretationShape.safeParse(raw).success, published = wire.safeParse(raw).success;
      if (typed !== published) disagreements++;
      if (!typed) rejected++;
    }
    expect(disagreements).toBe(0);
    expect(rejected).toBeGreaterThan(500);
  });
});

/** One random change somewhere in the payload: delete a key, add a key, a wrong type, an out-of-range number, a wrong enum, a long string or null. */
function mutate(value: Node, rnd: () => number): Node {
  const paths: (string | number)[][] = [];
  const walk = (node: unknown, path: (string | number)[]) => {
    paths.push(path);
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, [...path, index]));
    else if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
  };
  walk(value, []);
  const path = paths[1 + Math.floor(rnd() * (paths.length - 1))], parentPath = path.slice(0, -1), key = path[path.length - 1];
  const parent = parentPath.reduce<unknown>((node, step) => (node as Record<string | number, unknown>)[step], value) as Record<string | number, unknown>;
  const changes = [() => { if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key]; }, () => { if (!Array.isArray(parent)) parent.extra = 1; },
    () => { parent[key] = 7; }, () => { parent[key] = "x"; }, () => { parent[key] = null; }, () => { parent[key] = -99999; }, () => { parent[key] = "ç".repeat(1100); },
    () => { parent[key] = []; }, () => { parent[key] = {}; }, () => { parent[key] = true; }];
  changes[Math.floor(rnd() * changes.length)]();
  return value;
}

describe("§4 byte reclaim (this variant only, behind a constant): only the repeated mencao description differs (evidence for the verifier)", () => {
  const kept = astarParameters(true), reclaimed = astarParameters(false);
  it("the probe variant is the one the module constant selects", () => {
    expect(PILOT_ASTAR_PARAMETERS).toEqual(astarParameters(PILOT_ASTAR_MENTION_DESCRIPTIONS));
  });
  it("structural diff: without every description both variants are equal; the kept variant has the 21 copies of the E2-B mention sentence and the other none", () => {
    expect(strip(kept, true)).toEqual(strip(reclaimed, true));
    expect(strip(kept)).toEqual(reclaimed);
    expect(countMentionDescriptions(kept)).toBe(21);
    expect(countMentionDescriptions(reclaimed)).toBe(0);
    expect(countMentionDescriptions(PILOT_RESCHEDULE_PARAMETERS)).toBe(21);
    // Every other description is the same in both variants (only the mencao sentence leaves).
    const descriptions = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(descriptions) : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => key === "description" && typeof child === "string" ? [child] : descriptions(child)) : [];
    expect(descriptions(kept).filter(text => text !== MENTION_DESCRIPTION)).toEqual(descriptions(reclaimed));
    expect(Buffer.byteLength(JSON.stringify(kept)) - Buffer.byteLength(JSON.stringify(reclaimed))).toBeGreaterThan(1500);
  });
  it("property: both compiled wires accept and refuse exactly the same random payloads", () => {
    const rnd = e2bRandom(32), a = compileAstarWire(kept), b = compileAstarWire(reclaimed);
    const valid = payload({ dia: dayShift({ ancora: evidence("Desloca", "desloca", "origem") }), hora: clockShift() });
    let accepted = 0;
    for (let i = 0; i < 2500; i++) {
      const raw = i % 5 === 0 ? structuredClone(valid) : mutate(structuredClone(valid), rnd);
      expect(a.safeParse(raw).success, String(i)).toBe(b.safeParse(raw).success);
      if (a.safeParse(raw).success) accepted++;
    }
    expect(accepted).toBeGreaterThan(400);
  });
  it("the E2-B contract is untouched: its tool digest, its 21 descriptions and no A* key", () => {
    expect(pilotToolsDigest([pilotTool()])).toBe(PILOT_TOOLS_SHA256);
    const text = JSON.stringify(PILOT_RESCHEDULE_PARAMETERS);
    for (const key of ["ancora\"", "evidencia", "tipo_evidencia", "hora_citada"]) expect(text.includes(key), key).toBe(false);
  });
});
