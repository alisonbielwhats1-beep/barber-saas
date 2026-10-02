import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodePilotInterpretation, pilotContractRules, PilotContractError, PILOT_RESCHEDULE_DESCRIPTION, PILOT_RESCHEDULE_PARAMETERS,
  type PilotInterpretation, type PilotTempoDia } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { PILOT_PROMPT, PILOT_REPAIR_RULES, pilotRepairText } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { resolveTargetDate } from "../secretary-pilot-resolver";
import { clockAt } from "../../test/secretary-pilot-reader";
import { stringLiterals } from "../../test/secretary-agent-lint";
import { E2B_DAY_ANCHORS, E2B_LIMITS, E2B_PROFESSIONAL_MODES, E2B_REMOVED_OPERATORS, E2B_TIME_ANCHORS, E2B_UNITS, e2bCited, e2bClock, e2bDays, e2bLuna, e2bMinutes,
  e2bOrigin, e2bSameClock, e2bTo, e2bWeekday, e2bWeeks, e2aStoredOriginDays, e2aStoredOriginMinutes, e2aStoredToday, wire, type E2bInterpretation } from "../../test/secretary-pilot-e2b";

/** Reschedule pilot E2-B, the contract (docs/c5-spike/12-piloto-remarcacao.md §11; Adendo 11), written BEFORE the implementation.
 *  - The day operator `deslocamento` separates the operation (quantidade + unidade dias|semanas), the anchor(s) (1..2 distinct of origem | hoje |
 *    data_citada) and the literal value (data_citada, present exactly when an anchor is data_citada); the clock operator `deslocamento` carries
 *    minutos and 1..2 distinct anchors of origem | agora. relativo_hoje, origem_mais_dias and origem_mais_minutos are rejected everywhere.
 *  - Nothing in the wire holds a computed date or clock (Luna never computes it).
 *  - `destino.profissional.modo` gains "outro".
 *  - Bounds stay: ±366 days, ±1440 minutes; strict at every level.
 *  - What the schema cannot say (data_citada iff its anchor, distinct anchors) is a format failure with a fixed developer repair sentence.
 * No network, database or model. */
type Node = Record<string, unknown>;
const props = (node: unknown) => ((node as Node | undefined)?.properties ?? {}) as Record<string, Node>;
/** Every object node of a JSON Schema (anyOf branches included). */
const objects = (schema: unknown): Node[] => !schema || typeof schema !== "object" ? [] : Array.isArray(schema) ? schema.flatMap(objects)
  : [...((schema as Node).type === "object" || (Array.isArray((schema as Node).type) && ((schema as Node).type as unknown[]).includes("object")) ? [schema as Node] : []),
    ...Object.values(schema as Node).flatMap(objects)];
const branches = (node: Node | undefined): Node[] => !node ? [] : Array.isArray(node.anyOf) ? (node.anyOf as Node[]).filter(item => item.type !== "null") : [node];
const tipoOf = (branch: Node) => (props(branch).tipo?.enum as unknown[] | undefined)?.[0];
const sideBranches = (side: "origem" | "destino", slot: "dia" | "hora") => branches(props(props(PILOT_RESCHEDULE_PARAMETERS)[side])[slot]);
const shiftBranch = (side: "origem" | "destino", slot: "dia" | "hora") => sideBranches(side, slot).find(branch => tipoOf(branch) === "deslocamento");
const enumOf = (node: Node | undefined): unknown[] => (node?.enum as unknown[] | undefined) ?? [];
/** The enum of an array's items (an `items` with enum, or anyOf/type unions of it). */
const itemEnum = (node: Node | undefined) => enumOf(node?.items as Node | undefined);
const verdict = (decode: () => unknown) => {
  try { decode(); return "ACCEPTED"; } catch (error) { return error instanceof PilotContractError && error.reasons.length > 0 ? "REJECTED" : `OTHER:${(error as Error).message}`; }
};
const decode = (raw: unknown) => verdict(() => decodePilotInterpretation(raw));
const reasonsOf = (raw: unknown): readonly string[] => { try { decodePilotInterpretation(raw); return []; } catch (error) { return error instanceof PilotContractError ? error.reasons : ["OTHER"]; } };
const clone = <T>(value: T): T => structuredClone(value);
/** A remarcar payload with the given destination day and clock (and an origin day, when given). */
const move = (dia: unknown, hora: unknown = e2bSameClock("no mesmo horário"), origemDia: unknown = null): E2bInterpretation =>
  e2bLuna({ cliente: { mencao: "Ivonete" }, origem: e2bOrigin({ dia: origemDia as never }), destino: e2bTo(dia as never, hora as never) });

describe("E2-B wire: the anchored offset, what Luna is told", () => {
  it("day operators (origin and destination): data, mes_relativo, dia_semana, mesmo_da_origem, deslocamento, a_definir (§11.4); relativo_hoje and origem_mais_dias are gone", () => {
    // §11.4 (contract migration): the day may be left open, like the clock.
    for (const side of ["origem", "destino"] as const)
      expect(sideBranches(side, "dia").map(tipoOf).sort(), side).toEqual(["a_definir", "data", "deslocamento", "dia_semana", "mes_relativo", "mesmo_da_origem"]);
  });
  it("clock operators (origin and destination): relogio, mesmo_da_origem, deslocamento, a_definir; origem_mais_minutos is gone", () => {
    for (const side of ["origem", "destino"] as const)
      expect(sideBranches(side, "hora").map(tipoOf).sort(), side).toEqual(["a_definir", "deslocamento", "mesmo_da_origem", "relogio"]);
  });
  it("no removed operator name is left anywhere Luna reads (schema, tool description or prompt)", () => {
    const told = JSON.stringify(PILOT_RESCHEDULE_PARAMETERS) + PILOT_RESCHEDULE_DESCRIPTION + PILOT_PROMPT;
    for (const name of E2B_REMOVED_OPERATORS) expect(told.includes(name), name).toBe(false);
  });
  it("day deslocamento: exactly { tipo, quantidade, unidade, ancoras, data_citada, mencao } — the operation, the anchor(s) and the literal, never a computed date", () => {
    for (const side of ["origem", "destino"] as const) {
      const branch = shiftBranch(side, "dia");
      expect(branch, side).toBeDefined();
      const p = props(branch);
      expect(Object.keys(p).sort(), side).toEqual(["ancoras", "data_citada", "mencao", "quantidade", "tipo", "unidade"]);
      expect(p.quantidade.type, side).toBe("integer");
      expect([...enumOf(p.unidade)].sort(), side).toEqual([...E2B_UNITS].sort());
      expect(p.ancoras.type, side).toBe("array");
      expect([...itemEnum(p.ancoras)].sort(), side).toEqual([...E2B_DAY_ANCHORS].sort());
      // §11.4 (contract migration): no anchor at all is a typed fact the contract carries (the code asks, ANCHOR_MISSING).
      expect(p.ancoras.minItems, side).toBe(0);
      expect(p.ancoras.maxItems, side).toBe(2);
      expect(JSON.stringify(p.data_citada.type ?? p.data_citada.anyOf), side).toContain("null");
      const [cited] = branches(p.data_citada);
      expect(Object.keys(props(cited)).sort(), side).toEqual(["dia", "mencao", "mes"]);
      expect(props(cited).dia, side).toMatchObject({ minimum: 1, maximum: 31 });
      expect(JSON.stringify(props(cited).mes), side).toContain("null");
      expect(props(cited).mes, side).toMatchObject({ minimum: 1, maximum: 12 });
    }
  });
  it("clock deslocamento: exactly { tipo, minutos, ancoras, mencao }; anchors origem | agora, 0 to 2 (§11.4)", () => {
    for (const side of ["origem", "destino"] as const) {
      const branch = shiftBranch(side, "hora");
      expect(branch, side).toBeDefined();
      const p = props(branch);
      expect(Object.keys(p).sort(), side).toEqual(["ancoras", "mencao", "minutos", "tipo"]);
      expect(p.minutos, side).toMatchObject({ type: "integer", minimum: -E2B_LIMITS.minutes, maximum: E2B_LIMITS.minutes });
      expect([...itemEnum(p.ancoras)].sort(), side).toEqual([...E2B_TIME_ANCHORS].sort());
      expect(p.ancoras, side).toMatchObject({ type: "array", minItems: 0, maxItems: 2 });
    }
  });
  it("profissional.modo: manter | nomeado | qualquer | outro, or null", () => {
    const modo = props(props(props(PILOT_RESCHEDULE_PARAMETERS).destino).profissional).modo;
    expect(enumOf(modo).filter(value => value !== null).sort()).toEqual([...E2B_PROFESSIONAL_MODES].sort());
    expect(enumOf(modo)).toContain(null);
  });
  it("strict at every level, the new nodes included (every property required, nothing else admitted)", () => {
    const nodes = objects(PILOT_RESCHEDULE_PARAMETERS);
    expect(nodes.length).toBeGreaterThanOrEqual(20);
    for (const node of nodes) {
      expect(node.additionalProperties, JSON.stringify(Object.keys(props(node)))).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(props(node)).sort());
    }
  });
});

describe("E2-B decoder: the typed shape and the published wire accept exactly the same payloads", () => {
  it("each anchor alone, two anchors, weeks, negative offsets and data_citada with and without month decode to themselves (never transformed)", () => {
    const days = [
      e2bDays(1, ["origem"], "um dia depois do horário dela"), e2bDays(1, ["hoje"], "amanhã"), e2bDays(-2, ["origem"], "dois dias antes do marcado"),
      e2bWeeks(1, ["origem"], "uma semana adiante"), e2bWeeks(2, ["hoje"], "quinze dias contando de hoje"), e2bDays(0, ["hoje"], "hoje mesmo"),
      e2bDays(2, ["data_citada"], "dois dias depois do dia 20", e2bCited(20, null, "dia 20")), e2bDays(3, ["data_citada"], "três dias após 30/3", e2bCited(30, 3, "30/3")),
      e2bDays(1, ["origem", "hoje"], "um dia depois"), e2bDays(1, ["hoje", "origem"], "um dia depois"),
      e2bDays(1, ["data_citada", "origem"], "um dia depois do 12", e2bCited(12, null, "12")),
      e2bDays(E2B_LIMITS.days, ["hoje"], "daqui a um ano"), e2bDays(-E2B_LIMITS.days, ["origem"], "um ano antes"), e2bWeeks(52, ["hoje"], "daqui a 52 semanas"),
    ];
    for (const dia of days) for (const payload of [move(dia), move(null, e2bSameClock("mesmo horário"), dia)]) {
      expect(decode(payload), JSON.stringify(dia)).toBe("ACCEPTED");
      expect(decodePilotInterpretation(clone(payload)), JSON.stringify(dia)).toEqual(payload);
    }
    const clocks = [e2bMinutes(90, ["origem"], "uma hora e meia mais tarde"), e2bMinutes(-30, ["agora"], "meia hora atrás"), e2bMinutes(120, ["origem", "agora"], "duas horas depois"),
      e2bMinutes(E2B_LIMITS.minutes, ["origem"], "um dia inteiro depois"), e2bMinutes(-E2B_LIMITS.minutes, ["agora"], "um dia inteiro antes")];
    for (const hora of clocks) {
      expect(decode(move(null, hora)), JSON.stringify(hora)).toBe("ACCEPTED");
      expect(decodePilotInterpretation(clone(move(null, hora))).destino.hora).toEqual(hora);
    }
  });
  it("the removed E2-A operators are rejected in origem.dia, destino.dia and destino.hora (control: the same payload with an anchored offset decodes)", () => {
    expect(decode(move(e2bDays(1, ["hoje"], "amanhã"))), "control").toBe("ACCEPTED");
    expect(decode(move(e2bDays(7, ["origem"], "uma semana adiante")))).toBe("ACCEPTED");
    expect(decode(move(null, e2bMinutes(150, ["origem"], "cento e cinquenta minutos adiante")))).toBe("ACCEPTED");
    const bad: [string, unknown][] = [
      ["destino relativo_hoje", move(e2aStoredToday(1, "amanhã"))], ["destino origem_mais_dias", move(e2aStoredOriginDays(7, "uma semana adiante"))],
      ["origem relativo_hoje", move(null, e2bSameClock("mesmo horário"), e2aStoredToday(1, "a de amanhã"))],
      ["origem origem_mais_dias", move(null, e2bSameClock("mesmo horário"), e2aStoredOriginDays(1, "um dia depois"))],
      ["destino origem_mais_minutos", move(null, e2aStoredOriginMinutes(150, "cento e cinquenta minutos adiante"))],
    ];
    for (const [label, payload] of bad) expect(decode(payload), label).toBe("REJECTED");
  });
  it("anchors: three, repeated, or of the other side (agora for a day; hoje or data_citada for a clock) are rejected; §11.4: none is accepted (asked by the code)", () => {
    const cited = e2bCited(20, null, "dia 20");
    // §11.4 (contract migration): an operation with no anchor the owner said decodes to itself (the resolver asks, ANCHOR_MISSING); with a cited
    // reference and no anchor it is still a rule failure.
    expect(decode(move(e2bDays(1, [], "um dia depois"))), "no anchor (day)").toBe("ACCEPTED");
    expect(decode(move(null, e2bMinutes(60, [], "uma hora depois"))), "no anchor (clock)").toBe("ACCEPTED");
    expect(decode(move(e2bDays(1, [], "um dia depois", cited))), "a cited reference with no anchor").toBe("REJECTED");
    const bad: [string, unknown][] = [
      ["three anchors", move(e2bDays(1, ["origem", "hoje", "data_citada"], "um dia depois", cited))],
      ["repeated origem", move(e2bDays(1, ["origem", "origem"], "um dia depois"))],
      ["repeated hoje", move(e2bDays(1, ["hoje", "hoje"], "amanhã"))],
      ["agora for a day", move(wire(e2bDays(1, wire(["agora"]), "amanhã")))],
      ["hoje for a clock", move(null, e2bMinutes(60, wire(["hoje"]), "uma hora"))],
      ["data_citada for a clock", move(null, e2bMinutes(60, wire(["data_citada"]), "uma hora"))],
      ["repeated agora", move(null, e2bMinutes(60, ["agora", "agora"], "daqui a uma hora"))],
      ["unknown anchor", move(e2bDays(1, wire(["atendimento"]), "um dia depois"))],
      ["anchors a string", move({ ...e2bDays(1, ["hoje"], "amanhã"), ancoras: "hoje" })],
    ];
    for (const [label, payload] of bad) expect(decode(payload), label).toBe("REJECTED");
  });
  it("data_citada is present exactly when an anchor is data_citada: both mismatches are format failures (single repair), never a value the code picks", () => {
    const cited = e2bCited(20, null, "dia 20");
    expect(decode(move(e2bDays(2, ["data_citada"], "dois dias depois do dia 20", cited))), "control").toBe("ACCEPTED");
    expect(decode(move(e2bDays(2, ["hoje"], "dois dias contando de hoje"))), "control").toBe("ACCEPTED");
    const bad: [string, unknown][] = [
      ["anchor data_citada without the literal", move(e2bDays(2, ["data_citada"], "dois dias depois do dia 20"))],
      ["anchor data_citada beside origem, without the literal", move(e2bDays(2, ["origem", "data_citada"], "dois dias depois"))],
      ["a literal without the anchor", move(e2bDays(2, ["hoje"], "dois dias contando de hoje", cited))],
      ["a literal beside origem only", move(e2bDays(2, ["origem"], "dois dias depois", cited))],
    ];
    for (const [label, payload] of bad) {
      expect(decode(payload), label).toBe("REJECTED");
      const reasons = reasonsOf(payload);
      // Codes and schema paths only, never the model's words.
      for (const reason of reasons) expect(/dois dias|dia 20/.test(reason), `${label}: ${reason}`).toBe(false);
      // A rule the schema cannot say has its fixed developer sentence (E2-A review REPAIR-1).
      for (const code of reasons.filter(reason => reason.startsWith("RULE:"))) expect(typeof (PILOT_REPAIR_RULES as Record<string, unknown>)[code], code).toBe("string");
    }
    // At least the mismatches that pass the strict schema are named by a rule (the schema alone cannot tie the literal to its anchor).
    const ruled = bad.map(([, payload]) => pilotContractRules(wire<PilotInterpretation>(payload))).filter(codes => codes.length > 0);
    expect(ruled.length).toBe(bad.length);
    for (const codes of ruled) for (const code of codes) expect(pilotRepairText([code])).toContain((PILOT_REPAIR_RULES as Record<string, string>)[code]);
  });
  it("repeated anchors that pass the schema are a named rule with its own repair sentence", () => {
    const codes = pilotContractRules(wire<PilotInterpretation>(move(e2bDays(1, ["hoje", "hoje"], "amanhã"))));
    const clock = pilotContractRules(wire<PilotInterpretation>(move(null, e2bMinutes(60, ["origem", "origem"], "uma hora depois"))));
    // Either the schema forbids repetition (then the decoder rejects it before the rules) or a rule names it; never accepted.
    expect(decode(move(e2bDays(1, ["hoje", "hoje"], "amanhã")))).toBe("REJECTED");
    for (const code of [...codes, ...clock]) expect(typeof (PILOT_REPAIR_RULES as Record<string, unknown>)[code], code).toBe("string");
  });
  it("bounds: ±366 days and ±1440 minutes; past them, malformed literals or units are rejected", () => {
    const bad: [string, unknown][] = [
      ["367 days", move(e2bDays(E2B_LIMITS.days + 1, ["hoje"], "daqui a muito"))], ["-367 days", move(e2bDays(-E2B_LIMITS.days - 1, ["origem"], "muito antes"))],
      ["1441 minutes", move(null, e2bMinutes(E2B_LIMITS.minutes + 1, ["origem"], "mais de um dia depois"))],
      ["-1441 minutes", move(null, e2bMinutes(-E2B_LIMITS.minutes - 1, ["agora"], "mais de um dia antes"))],
      ["fraction of a day", move({ ...e2bDays(1, ["hoje"], "amanhã"), quantidade: 1.5 })],
      ["fraction of a minute", move(null, { ...e2bMinutes(60, ["origem"], "uma hora depois"), minutos: 60.5 })],
      ["unit months", move({ ...e2bDays(1, ["hoje"], "mês que vem"), unidade: "meses" })],
      ["unit hours on a day", move({ ...e2bDays(1, ["hoje"], "amanhã"), unidade: "horas" })],
      ["cited day 0", move(e2bDays(1, ["data_citada"], "depois do dia 0", e2bCited(0, null, "dia 0")))],
      ["cited day 32", move(e2bDays(1, ["data_citada"], "depois do dia 32", e2bCited(32, null, "dia 32")))],
      ["cited month 13", move(e2bDays(1, ["data_citada"], "depois do 5/13", e2bCited(5, 13, "5/13")))],
      ["cited without its mention", move(e2bDays(1, ["data_citada"], "depois do dia 5", wire({ dia: 5, mes: null })))],
      ["mention too long", move(e2bDays(1, ["hoje"], "a".repeat(E2B_LIMITS.mention + 1)))],
      ["empty mention", move(e2bDays(1, ["hoje"], ""))],
    ];
    for (const [label, payload] of bad) expect(decode(payload), label).toBe("REJECTED");
  });
  it("weeks past 366 days never become a date: rejected by the decoder, or (if the decoder takes the bare count) never resolved to one", () => {
    const tooFar = e2bWeeks(53, ["hoje"], "daqui a 53 semanas");
    const accepted = decode(move(tooFar));
    if (accepted === "ACCEPTED") expect(resolveTargetDate(wire<PilotTempoDia>(tooFar), { date: "2031-03-13" }, clockAt()).state).not.toBe("one");
    else expect(accepted).toBe("REJECTED");
  });
  it("an extra key in a new node, or a missing required one (data_citada must be present as null), is rejected", () => {
    const base = e2bDays(1, ["hoje"], "amanhã");
    const { data_citada: _gone, ...noCited } = base; void _gone;
    const { ancoras: _anchors, ...noAnchors } = base; void _anchors;
    const clock = e2bMinutes(30, ["origem"], "meia hora depois");
    const { ancoras: _clockAnchors, ...clockNoAnchors } = clock; void _clockAnchors;
    const bad: [string, unknown][] = [
      ["day extra key", move({ ...base, data_final: "2031-03-11" })], ["day without data_citada", move(noCited)], ["day without anchors", move(noAnchors)],
      ["cited extra key", move(e2bDays(1, ["data_citada"], "depois do dia 5", wire({ ...e2bCited(5, null, "dia 5"), ano: 2031 })))],
      ["clock extra key", move(null, { ...clock, hora_final: "15:30" })], ["clock without anchors", move(null, clockNoAnchors)],
      ["clock with the day's fields", move(null, { ...clock, quantidade: 30, unidade: "dias" })],
    ];
    for (const [label, payload] of bad) expect(decode(payload), label).toBe("REJECTED");
  });
  it("profissional.modo 'outro' decodes with or without words; an unknown mode is rejected", () => {
    for (const mencao of [null, "outra pessoa"])
      expect(decode(e2bLuna({ cliente: { mencao: "Ivonete" }, destino: e2bTo(null, null, { modo: "outro", mencao }) })), String(mencao)).toBe("ACCEPTED");
    for (const modo of E2B_PROFESSIONAL_MODES.filter(mode => mode !== "nomeado"))
      expect(decode(e2bLuna({ cliente: { mencao: "Ivonete" }, destino: e2bTo(e2bWeekday("sexta", "sexta"), e2bClock(15, "15h"), { modo, mencao: null }) })), modo).toBe("ACCEPTED");
    expect(decode(e2bLuna({ cliente: { mencao: "Ivonete" }, destino: e2bTo(null, null, wire({ modo: "livre", mencao: null })) }))).toBe("REJECTED");
  });
});

describe("E2-B: no second reading of the old operators after Luna", () => {
  it("the resolver and the orchestrator no longer name the removed operators (only the loader may, to convert a stored E2-A state)", () => {
    for (const file of ["src/lib/secretary-pilot-resolver.ts", "src/lib/secretary-pilot.ts", "src/lib/secretary-pilot-plan.ts", "packages/salon-secretary/src/pilot-reschedule-contract.ts",
      "packages/salon-secretary/src/pilot-reschedule-prompt.ts"]) {
      const source = readFileSync(file, "utf8");
      for (const name of E2B_REMOVED_OPERATORS) expect(source.includes(name), `${file}: ${name}`).toBe(false);
    }
  });
  it("the resolver's own string literals hold no Portuguese time or availability word to match against (typed values only)", () => {
    // Folded stems a re-reading of the owner's words would need; typed enum values (hoje, agora, origem, semanas, proximo, qualquer, outro…) are allowed.
    const stems = ["amanha", "depois", "antes", "ontem", "daqui", "atras", "adiant", "livre", "disponiv", "tanto faz", "quem estiver", "seguinte", "proxima semana"];
    const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const literals = stringLiterals(readFileSync("src/lib/secretary-pilot-resolver.ts", "utf8")).map(fold);
    for (const stem of stems) expect(literals.filter(literal => literal.includes(stem)), stem).toEqual([]);
  });
});
