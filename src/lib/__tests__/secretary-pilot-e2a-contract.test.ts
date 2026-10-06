import { describe, expect, it } from "vitest";
import { decodePilotInterpretation, decodePilotInterpretationArguments, pilotContractRules, PilotContractError, PILOT_CONTRACT_LIMITS, PILOT_RESCHEDULE_PARAMETERS,
  type PilotInterpretation } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { pilotContractParts, pilotRepairText, PILOT_REPAIR_RULES } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { storedSession } from "../secretary-session-state";
import { E2A_OBSERVATION_LIMITS, E2A_OUT_OF_SCOPE_KINDS, E2A_WEEKDAYS, e2aClock, e2aDay, e2aLuna, e2aOrigin, e2aService, e2aTo, type E2aInterpretation } from "../../test/secretary-pilot-e2a";

/** Reschedule pilot E2-A, the contract (docs/c5-spike/12-piloto-remarcacao.md §10, Adendo 10), written BEFORE the implementation:
 *  - `dia_semana` is the text enum segunda|terca|quarta|quinta|sexta|sabado|domingo in origin and destination; a number is rejected;
 *  - `origem.servico` = { mencao, catalogo: string[] } | null replaces `origem.servico_mencao`;
 *  - `observacoes: string[]` is required (adversarial review OBS-1: ≤ 20 items of at most the message's own 1000 code points, so a faithful copy of
 *    the owner's words never fails the turn over a field the code never reads);
 *  - a `fora_do_escopo` item carries `pedido` in place of `mencao`;
 *  - strict at every level (every property required, nothing else admitted) in the published wire and in the decoder; the E1 shapes are rejected.
 * No network, database or model. */
type Node = Record<string, unknown>;
const props = (node: unknown) => ((node as Node).properties ?? {}) as Record<string, Node>;
/** Every object node of a JSON Schema (anyOf branches included). */
const objects = (schema: unknown): Node[] => !schema || typeof schema !== "object" ? [] : Array.isArray(schema) ? schema.flatMap(objects)
  : [...((schema as Node).type === "object" || (Array.isArray((schema as Node).type) && ((schema as Node).type as unknown[]).includes("object")) ? [schema as Node] : []),
    ...Object.values(schema as Node).flatMap(objects)];
/** The object branches of a property that is an object or a union of objects (null aside). */
const branches = (node: Node | undefined): Node[] => !node ? [] : Array.isArray(node.anyOf) ? (node.anyOf as Node[]).filter(item => item.type !== "null")
  : [node];
const dayBranch = (side: "origem" | "destino", tipo: string) => branches(props(props(PILOT_RESCHEDULE_PARAMETERS)[side]).dia)
  .find(branch => (props(branch).tipo?.enum as unknown[] | undefined)?.[0] === tipo);
const verdict = (decode: () => unknown) => {
  try { decode(); return "ACCEPTED"; } catch (error) { return error instanceof PilotContractError && error.reasons.length > 0 ? "REJECTED" : `OTHER:${(error as Error).message}`; }
};
/** The decoder accepts a payload only when the typed shape AND the published wire (what Luna is told) both accept it. */
const decode = (raw: unknown) => verdict(() => decodePilotInterpretation(raw));
const clone = <T>(value: T): T => structuredClone(value);
const text = (length: number, unit = "a") => unit.repeat(length);

/** A full E2-A payload exercising every new slot. */
const full = (over: Partial<E2aInterpretation> = {}): E2aInterpretation => e2aLuna({
  cliente: { mencao: "Eudóxia" },
  origem: e2aOrigin({ dia: e2aDay("terca", "a de terça"), hora: e2aClock(10, "das 10"), profissional_mencao: "Lisandra",
    servico: e2aService("a escova", ["Escova modelada"]), posicao: { valor: "primeiro", mencao: "a primeira" } }),
  destino: e2aTo(e2aDay("sexta", "pra sexta", "este"), e2aClock(15, "às 15h"), { modo: "nomeado", mencao: "Thales" }),
  observacoes: ["ela pegou um plantão no hospital", "se tiver vaga"],
  fora_do_escopo: [{ tipo: "mensagem", pedido: "manda pra ela a lista de cuidados depois do procedimento" }], tipo: "misto", ...over });

describe("E2-A wire: what Luna is told", () => {
  it("the root carries observacoes beside the E1 keys; strict at every level (every property required, nothing else admitted)", () => {
    expect(Object.keys(props(PILOT_RESCHEDULE_PARAMETERS)).sort()).toEqual(
      ["aceita_parcial", "cliente", "desistir", "destino", "fora_do_escopo", "observacoes", "origem", "resposta_a", "tipo"]);
    const nodes = objects(PILOT_RESCHEDULE_PARAMETERS);
    expect(nodes.length).toBeGreaterThanOrEqual(17);
    for (const node of nodes) {
      expect(node.additionalProperties, JSON.stringify(Object.keys(props(node)))).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(props(node)).sort());
    }
  });
  it("dia_semana is the seven-value text enum in origin and destination, never an integer", () => {
    for (const side of ["origem", "destino"] as const) {
      const branch = dayBranch(side, "dia_semana");
      expect(branch, side).toBeDefined();
      const value = props(branch)?.dia_semana;
      expect(value?.type, side).toBe("string");
      expect([...(value?.enum as string[] ?? [])].sort(), side).toEqual([...E2A_WEEKDAYS].sort());
      expect(JSON.stringify(value), side).not.toContain("integer");
    }
  });
  it("origem.servico is a nullable { mencao, catalogo: string[] }; origem.servico_mencao is gone", () => {
    const origem = props(props(PILOT_RESCHEDULE_PARAMETERS).origem);
    expect(Object.keys(origem).sort()).toEqual(["dia", "hora", "posicao", "profissional_mencao", "servico"]);
    const servico = origem.servico;
    expect(JSON.stringify(servico.type ?? servico.anyOf)).toContain("null");
    const [shape] = branches(servico);
    expect(Object.keys(props(shape)).sort()).toEqual(["catalogo", "mencao"]);
    expect(props(shape).mencao).toMatchObject({ type: "string", minLength: 1, maxLength: 120 });
    expect(props(shape).catalogo).toMatchObject({ type: "array", items: { type: "string" } });
  });
  it("observacoes is an array of at most 20 strings of at most 1000 characters (the message's own bound); a fora_do_escopo item is { tipo, pedido }", () => {
    const root = props(PILOT_RESCHEDULE_PARAMETERS);
    expect(root.observacoes).toMatchObject({ type: "array", maxItems: E2A_OBSERVATION_LIMITS.items, items: { type: "string", maxLength: E2A_OBSERVATION_LIMITS.length } });
    const item = root.fora_do_escopo.items as Node;
    expect(Object.keys(props(item)).sort()).toEqual(["pedido", "tipo"]);
    expect([...(props(item).tipo.enum as string[])].sort()).toEqual([...E2A_OUT_OF_SCOPE_KINDS].sort());
    expect(props(item).pedido).toMatchObject({ type: "string" });
  });
});

describe("E2-A decoder: the typed shape and the published wire accept exactly the same payloads", () => {
  it("a full payload decodes to itself, as an object and as the call's arguments", () => {
    const payload = full();
    expect(decodePilotInterpretation(clone(payload))).toEqual(payload);
    expect(decodePilotInterpretationArguments(JSON.stringify(payload))).toEqual(payload);
  });
  it("every weekday of the enum, with every qualifier, is accepted in origin and in destination", () => {
    for (const day of E2A_WEEKDAYS) for (const qualificador of [null, "este", "proximo"] as const) {
      const said = e2aDay(day, `palavras de ${day}`, qualificador);
      expect(decode(full({ destino: { ...full().destino, dia: said } })), `destino ${day} ${qualificador}`).toBe("ACCEPTED");
      expect(decode(full({ origem: { ...full().origem, dia: said } })), `origem ${day} ${qualificador}`).toBe("ACCEPTED");
    }
  });
  it("a numbered weekday (the E1 shape, 0-8) and any other spelling are rejected, in origin and in destination", () => {
    expect(decode(full()), "control: the same payload, well formed").toBe("ACCEPTED");
    const spellings: unknown[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, "1", "Sexta", "SEXTA", "sexta-feira", "sex", "terça", "sábado", "sabádo", "hoje", "", null];
    for (const value of spellings) for (const side of ["origem", "destino"] as const) {
      const payload = clone(full()) as unknown as Record<string, Record<string, unknown>>;
      payload[side].dia = { tipo: "dia_semana", dia_semana: value, qualificador: null, mencao: "um dia" };
      expect(decode(payload), `${side} ${JSON.stringify(value)}`).toBe("REJECTED");
    }
  });
  it("origem.servico: null, an empty catalogo, one or several names are accepted (the code checks the names, not the decoder)", () => {
    for (const servico of [null, e2aService("a escova", []), e2aService("a escova", ["Escova modelada"]), e2aService("o tratamento", ["Hidratação capilar", "Escova modelada", "Nome que não existe"])])
      expect(decode(full({ origem: { ...full().origem, servico } })), JSON.stringify(servico)).toBe("ACCEPTED");
  });
  it("origem.servico malformed, or the E1 servico_mencao, is rejected", () => {
    expect(decode(full()), "control: the same payload, well formed").toBe("ACCEPTED");
    const origin = (over: Record<string, unknown>, drop?: string) => {
      const payload = clone(full()) as unknown as { origem: Record<string, unknown> };
      Object.assign(payload.origem, over);
      if (drop) delete payload.origem[drop];
      return payload;
    };
    const bad: [string, unknown][] = [
      ["E1 key only", origin({ servico_mencao: "a escova" }, "servico")],
      ["E1 key beside the new one", origin({ servico_mencao: "a escova" })],
      ["servico missing", origin({}, "servico")],
      ["a bare string", origin({ servico: "a escova" })],
      ["no catalogo", origin({ servico: { mencao: "a escova" } })],
      ["no mencao", origin({ servico: { catalogo: ["Escova modelada"] } })],
      ["empty mencao", origin({ servico: { mencao: "", catalogo: [] } })],
      ["catalogo a string", origin({ servico: { mencao: "a escova", catalogo: "Escova modelada" } })],
      ["catalogo with a number", origin({ servico: { mencao: "a escova", catalogo: [3] } })],
      ["catalogo null", origin({ servico: { mencao: "a escova", catalogo: null } })],
      ["extra key", origin({ servico: { mencao: "a escova", catalogo: [], id: "srv-1" } })],
    ];
    for (const [label, payload] of bad) expect(decode(payload), label).toBe("REJECTED");
  });
  it("observacoes: [] and 20 items of 1000 characters (accented letters count once) are accepted", () => {
    expect(decode(full({ observacoes: [] }))).toBe("ACCEPTED");
    const six = Array.from({ length: E2A_OBSERVATION_LIMITS.items }, (_, index) => `${index}`.padEnd(E2A_OBSERVATION_LIMITS.length, "ã"));
    expect(six.every(item => [...item].length === E2A_OBSERVATION_LIMITS.length)).toBe(true);
    expect(decode(full({ observacoes: six }))).toBe("ACCEPTED");
  });
  it("observacoes missing, not an array, with 21 items, an item of 1001 code points or a non-string item is rejected", () => {
    expect(decode(full()), "control: the same payload, well formed").toBe("ACCEPTED");
    const { observacoes: _gone, ...missing } = full(); void _gone;
    const bad: [string, unknown][] = [
      ["missing", missing], ["null", { ...full(), observacoes: null }], ["a string", { ...full(), observacoes: "ela pediu" }],
      ["21 items", full({ observacoes: Array.from({ length: E2A_OBSERVATION_LIMITS.items + 1 }, (_, index) => `nota ${index}`) })],
      ["1001 code points", full({ observacoes: [text(E2A_OBSERVATION_LIMITS.length + 1)] })],
      ["1001 with accents", full({ observacoes: [text(E2A_OBSERVATION_LIMITS.length + 1, "é")] })],
      ["an empty item", full({ observacoes: [""] })],
      ["a number", { ...full(), observacoes: [12] }], ["an object", { ...full(), observacoes: [{ nota: "x" }] }],
    ];
    for (const [label, payload] of bad) expect(decode(payload), label).toBe("REJECTED");
  });
  it("a fora_do_escopo item needs `pedido`: the E1 `mencao`, both keys, none, an empty pedido or an unknown kind are rejected", () => {
    for (const tipo of E2A_OUT_OF_SCOPE_KINDS) expect(decode(full({ fora_do_escopo: [{ tipo, pedido: "um pedido à parte" }] })), tipo).toBe("ACCEPTED");
    const item = (value: Record<string, unknown>) => ({ ...full(), fora_do_escopo: [value] });
    const bad: [string, unknown][] = [
      ["E1 mencao", item({ tipo: "cancelar", mencao: "desmarca o Filomeno" })],
      ["both", item({ tipo: "cancelar", mencao: "desmarca o Filomeno", pedido: "desmarca o Filomeno" })],
      ["none", item({ tipo: "cancelar" })], ["empty", item({ tipo: "cancelar", pedido: "" })],
      ["unknown kind", item({ tipo: "excluir", pedido: "apaga" })], ["extra key", item({ tipo: "cancelar", pedido: "desmarca", motivo: "x" })],
    ];
    for (const [label, payload] of bad) expect(decode(payload), label).toBe("REJECTED");
    expect(decode(full({ fora_do_escopo: [{ tipo: "outra_acao", pedido: "x".repeat(100) }] }))).toBe("ACCEPTED");
  });
  it("an extra key at any level, the new ones included, is rejected", () => {
    expect(decode(full()), "control: the same payload, well formed").toBe("ACCEPTED");
    const base = full() as unknown as Node;
    const extra = (path: string[]) => { const copy = clone(base); let node = copy; for (const key of path) node = node[key] as Node; node.contexto = "palavras de fora"; return copy; };
    for (const path of [[], ["cliente"], ["origem"], ["origem", "dia"], ["origem", "hora"], ["origem", "servico"], ["origem", "posicao"], ["destino"], ["destino", "dia"],
      ["destino", "hora"], ["destino", "profissional"], ["fora_do_escopo", "0"]]) expect(decode(extra(path)), path.join(".") || "(root)").toBe("REJECTED");
  });
  it("OBS-1: what used to fail the whole turn now decodes: a faithful reason clause past 120 characters, seven or more short courtesies", () => {
    const clause = "ela me explicou que o filho mais novo vai ser operado de manhã cedo e que só depois da alta consegue sair de casa com calma pra vir";
    expect([...clause].length).toBeGreaterThan(120);
    expect(decode(full({ observacoes: [clause] }))).toBe("ACCEPTED");
    expect(decode(full({ observacoes: ["oi", "tudo bem?", "desculpa", "é rapidinho", "valeu", "obrigada", "beijo"] }))).toBe("ACCEPTED");
    // The E1 bound still holds for a mention (a field the code does read).
    expect(decode(full({ destino: { ...full().destino, dia: e2aDay("sexta", text(PILOT_CONTRACT_LIMITS.mention + 1)) } }))).toBe("REJECTED");
  });
  it("CONTRACT-1: origem.servico.catalogo takes up to 10 names; 11 is a format failure (the prompt says to give [] then)", () => {
    const names = (count: number) => Array.from({ length: count }, (_, index) => `Serviço ${index}`);
    expect(PILOT_CONTRACT_LIMITS.catalogNames).toBe(10);
    expect(decode(full({ origem: { ...full().origem, servico: e2aService("o tratamento", names(10)) } }))).toBe("ACCEPTED");
    expect(decode(full({ origem: { ...full().origem, servico: e2aService("o tratamento", names(11)) } }))).toBe("REJECTED");
  });
  it("context never makes a 'misto': a misto with observacoes and no fora_do_escopo item is a format failure; a remarcar with only context decodes", () => {
    expect(decode(full({ tipo: "misto", fora_do_escopo: [], observacoes: ["ela pediu desculpas pelo atraso"] }))).toBe("REJECTED");
    expect(decode(full({ tipo: "remarcar", fora_do_escopo: [], observacoes: ["ela pediu desculpas pelo atraso", "se tiver vaga"] }))).toBe("ACCEPTED");
  });
});

describe("E2-A persisted pilot state: the pending operators keep the new shapes, never the E1 ones", () => {
  const session = (pending: unknown) => ({ id: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a01", skill: "auto", expires: 1, turns: 0, cancelled: false, pilot: { replies: [], pending } });
  it("an origin with servico { mencao, catalogo } and enum weekdays loads; numbered weekdays or servico_mencao do not", () => {
    const origem = e2aOrigin({ dia: e2aDay("quarta", "a de quarta"), servico: e2aService("a hidratação", ["Hidratação capilar"]) });
    const destino = e2aTo(e2aDay("sabado", "pro sábado", "proximo"), e2aClock(9, "às 9"));
    expect(storedSession.safeParse(session({ origem, destino })).success).toBe(true);
    expect(storedSession.safeParse(session({ origem: { ...origem, dia: { tipo: "dia_semana", dia_semana: 4, qualificador: null, mencao: "a de quarta" } }, destino })).success).toBe(false);
    const { servico: _servico, ...withoutService } = origem; void _servico;
    expect(storedSession.safeParse(session({ origem: { ...withoutService, servico_mencao: "a hidratação" }, destino })).success).toBe(false);
    expect(storedSession.safeParse(session({ origem, destino: { ...destino, dia: { tipo: "dia_semana", dia_semana: 7, qualificador: null, mencao: "sábado" } } })).success).toBe(false);
  });
});

describe("E2-A review REPAIR-1: a rule violation's repair note says how to get out of it, in fixed developer sentences", () => {
  const misto = full({ tipo: "misto", fora_do_escopo: [], observacoes: ["ela pediu desculpas", "se tiver vaga"] }) as unknown as PilotInterpretation;
  const nomeado = full({ destino: { ...full().destino, profissional: { modo: "nomeado", mencao: null } } }) as unknown as PilotInterpretation;
  it("every rule code the decoder can give has its own fixed sentence", () => {
    const codes = [...pilotContractRules(misto), ...pilotContractRules(nomeado)];
    expect(codes.sort()).toEqual(["RULE:misto_sem_fora_do_escopo", "RULE:nomeado_sem_mencao"]);
    for (const code of codes) expect(typeof PILOT_REPAIR_RULES[code as keyof typeof PILOT_REPAIR_RULES], code).toBe("string");
  });
  it("the misto rule's note names BOTH ways out (a real separate request in fora_do_escopo, or tipo remarcar with context in observacoes)", () => {
    const note = pilotRepairText(["RULE:misto_sem_fora_do_escopo"]);
    expect(note).toContain("RULE:misto_sem_fora_do_escopo");
    expect(note).toContain(PILOT_REPAIR_RULES["RULE:misto_sem_fora_do_escopo"]);
    for (const part of ["fora_do_escopo", "remarcar", "observacoes"]) expect(PILOT_REPAIR_RULES["RULE:misto_sem_fora_do_escopo"], part).toContain(part);
    expect(pilotRepairText(["RULE:nomeado_sem_mencao"])).toContain(PILOT_REPAIR_RULES["RULE:nomeado_sem_mencao"]);
  });
  it("codes without a sentence keep the bare note; the note never carries text the model wrote; the sentences are part of the contract version", () => {
    expect(pilotRepairText(["SCHEMA:invalid_type@tipo"])).not.toContain(PILOT_REPAIR_RULES["RULE:misto_sem_fora_do_escopo"]);
    const note = pilotRepairText(pilotContractRules(misto));
    for (const words of ["ela pediu desculpas", "se tiver vaga"]) expect(note).not.toContain(words);
    expect(pilotContractParts().repairRules).toEqual(PILOT_REPAIR_RULES);
  });
});
