import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import { PROGRAM_SPEND_BASENAME, programSpendTotals } from "../../../packages/salon-secretary/evaluation/program-spend";
import { astarPayloadMeasurement, createProbeModel, dryRunProbe, parseProbeArgs, probeCli, probeFailureClass, runProbe, scoreProbeCase, validateProbeCases, PROBE_CAP_USD, PROBE_ENV,
  PROBE_TRACED_FILES, PROBE_WORST_TEXT, type ProbeCase, type ProbeRunDeps } from "../../../packages/salon-secretary/evaluation/pilot-anchor-probe";
import { runAstarInterpretation, PILOT_ASTAR_CONTRACT_SHA256 } from "../../../packages/salon-secretary/src/pilot-astar-prompt";
import type { AstarInterpretation } from "../../../packages/salon-secretary/src/pilot-astar-contract";

/** A* premise probe, the instrumentation (docs/c5-spike/13-sonda-premissa-astar.md §5-§9), written BEFORE the harness and again before each §9 amendment,
 * over INVENTED synthetic cases (never the sealed file): the case schema; the dry-run (the module's readings and decision under the ideal claim against what
 * each case expects, the evidence self-test, each case's real request with the worst documented text gated at 2,048 B under the cap, codes only); the
 * scoring (EVIDENCE_OK, TYPE_OK, ANCHOR_OK, CITED_OK, DECISION; an answer that is no offset scored by what the product would do with it, through the E2-B
 * resolver; S1-S4 stop; W1, W2 and W3 warn); the verdicts (SEGURA only when the run ended or reached the cap with at least one offset scored and no
 * FAILED_INFRA case, REPROVADA at a safety code, INCONCLUSIVA otherwise; FAILED_SAFE only reported); the stop at the first S code and no call after any
 * stop; the cap before each call (cases stopped by it reported as unrun); the refusals
 * (approval, the shas, the model, the cap of US$ 0.04, a dirty tree); traceability; stdout with codes only and no SDK log; the texts only in the runs
 * folder beside the cases file. Offline: a fake transport behind the real guard and SDK, a temporary ledger, an injected clean tree. */
const SALON = { name: "Estúdio Aroeira Sintético", hours: { default: [["08:00", "19:00"]] as [string, string][], byDate: {} }, team: [{ name: "Bartolomeu Iguaçu", services: ["Banho de lua"] }],
  catalog: ["Banho de lua", "Escova de coco"] };
const appointment = (date: string, time: string) => ({ customer: "Zebedeu Taquari", date, time, durationMin: 60, service: "Banho de lua", professional: "Bartolomeu Iguaçu" });
const none = { day: null, clock: null };
/** Monday 2031-03-10, 10:00 in São Paulo. */
const base = { receivedAt: "2031-03-10T10:00:00-03:00", timezone: "America/Sao_Paulo", salon: SALON, twin: null, covers: ["sintetico"] };
const CASES: ProbeCase[] = [
  { ...base, id: "SX01", priority: 1, twin: "SX02", appointment: appointment("2031-03-13", "15:00"), message: "Arrasta a sessão do Zebedeu dois dias adiante", target: "date", destinationDay: null,
    truth: { offset: { days: 2 }, startPointNamed: true, anchor: "ORIGIN", evidenceSpans: ["Arrasta a sessão"], evidenceTypes: ["desloca"], cited: none, citedMentions: [] },
    expected: { readings: { ORIGIN: ["2031-03-15"], PRESENT: ["2031-03-12"], CITED: [] }, decision: "USE", value: "2031-03-15", options: null, rationale: "verbo que desloca o atendimento" } },
  { ...base, id: "SX02", priority: 2, twin: "SX01", appointment: appointment("2031-03-13", "15:00"), message: "Encaixa o Zebedeu em dois dias", target: "date", destinationDay: null,
    truth: { offset: { days: 2 }, startPointNamed: false, anchor: "AMBIGUOUS", evidenceSpans: [], evidenceTypes: [], cited: none, citedMentions: [] },
    expected: { readings: { ORIGIN: ["2031-03-15"], PRESENT: ["2031-03-12"], CITED: [] }, decision: "ASK", value: null, options: ["2031-03-12", "2031-03-15"], rationale: "sem ponto de partida" } },
  { ...base, id: "SX03", priority: 3, appointment: appointment("2031-03-10", "16:00"), message: "Bota a Quitéria daqui a duas horas", target: "time", destinationDay: "2031-03-10",
    truth: { offset: { minutes: 120 }, startPointNamed: true, anchor: "PRESENT", evidenceSpans: ["daqui a duas horas"], evidenceTypes: ["deitico"], cited: none, citedMentions: [] },
    expected: { readings: { ORIGIN: ["18:00"], PRESENT: ["12:00"], CITED: [] }, decision: "USE", value: "12:00", options: null, rationale: "conta do presente" } },
  { ...base, id: "SX04", priority: 4, appointment: appointment("2031-03-14", "15:00"), message: "Manda o Zebedeu para três dias depois do dia 20", target: "date", destinationDay: null,
    truth: { offset: { days: 3 }, startPointNamed: true, anchor: "CITED", evidenceSpans: ["do dia 20"], evidenceTypes: ["nomeia"], cited: { day: { dia: 20, mes: null }, clock: null },
      citedMentions: ["dia 20"] },
    expected: { readings: { ORIGIN: ["2031-03-17"], PRESENT: ["2031-03-13"], CITED: ["2031-03-23"] }, decision: "USE", value: "2031-03-23", options: null, rationale: "data citada" } },
  { ...base, id: "SX05", priority: 5, appointment: appointment("2031-03-10", "17:00"), message: "Encaixa a Quitéria em dois dias", target: "date", destinationDay: null,
    truth: { offset: { days: 2 }, startPointNamed: false, anchor: "AMBIGUOUS", evidenceSpans: [], evidenceTypes: [], cited: none, citedMentions: [] },
    expected: { readings: { ORIGIN: ["2031-03-12"], PRESENT: ["2031-03-12"], CITED: [] }, decision: "USE", value: "2031-03-12", options: null, rationale: "leituras coincidem" } },
] as ProbeCase[];
/** Extra cases for the §9 S3/S4/W3 split (never in the default file): a named start whose expected question comes only from a competing cited day, and a
 * named cited weekday with two readings. */
const LITERAL: ProbeCase = { ...base, id: "SX06", priority: 6, appointment: appointment("2031-03-13", "15:00"), message: "Arrasta a sessão do Zebedeu dois dias, o dia 20 está lotado",
  target: "date", destinationDay: null,
  truth: { offset: { days: 2 }, startPointNamed: true, anchor: "ORIGIN", evidenceSpans: ["Arrasta a sessão"], evidenceTypes: ["desloca"], cited: { day: { dia: 20, mes: null }, clock: null },
    citedMentions: ["dia 20"] },
  expected: { readings: { ORIGIN: ["2031-03-15"], PRESENT: ["2031-03-12"], CITED: ["2031-03-22"] }, decision: "ASK", value: null, options: ["2031-03-15", "2031-03-22"], rationale: "referência concorrente" } };
const WEEKDAY: ProbeCase = { ...base, id: "SX07", priority: 7, appointment: appointment("2031-03-15", "10:00"), message: "Manda o Zebedeu para três dias depois de sexta", target: "date", destinationDay: null,
  truth: { offset: { days: 3 }, startPointNamed: true, anchor: "CITED", evidenceSpans: ["de sexta"], evidenceTypes: ["nomeia"],
    cited: { day: { tipo: "dia_semana", dia_semana: "sexta", qualificador: null }, clock: null }, citedMentions: ["sexta"] },
  expected: { readings: { ORIGIN: ["2031-03-18"], PRESENT: ["2031-03-13"], CITED: ["2031-03-17", "2031-03-24"] }, decision: "ASK", value: null, options: ["2031-03-17", "2031-03-24"],
    rationale: "duas sextas" } };
/** What Luna answers (A* wire). */
const luna = (destino: Record<string, unknown>, cliente = "Zebedeu"): AstarInterpretation => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null,
  cliente: { mencao: cliente }, origem: { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null },
  destino: { dia: null, hora: null, profissional: { modo: null, mencao: null, excluidos: [] }, ...destino }, observacoes: [], fora_do_escopo: [] }) as unknown as AstarInterpretation;
const day = (quantidade: number, ancora: unknown, data_citada: unknown = null, mencao = "dois dias") => ({ dia: { tipo: "deslocamento", quantidade, unidade: "dias", data_citada, ancora, mencao } });
const GOOD: Record<string, AstarInterpretation> = {
  SX01: luna(day(2, { evidencia: "Arrasta a sessão", tipo_evidencia: "desloca", tipo: "origem" }, null, "dois dias adiante")),
  SX02: luna(day(2, null, null, "em dois dias")),
  SX03: luna({ hora: { tipo: "deslocamento", minutos: 120, hora_citada: null, ancora: { evidencia: "daqui a duas horas", tipo_evidencia: "deitico", tipo: "agora" }, mencao: "daqui a duas horas" } }, "Quitéria"),
  SX04: luna(day(3, { evidencia: "do dia 20", tipo_evidencia: "nomeia", tipo: "data_citada" }, { dia: 20, mes: null, mencao: "dia 20" }, "três dias depois do dia 20")),
  SX05: luna(day(2, null, null, "em dois dias"), "Quitéria"),
};
/** The same cases answered with operators that are no offset (the product resolves them; values right where the case expects a value). */
const DATA = (dia: number) => luna({ dia: { tipo: "data", dia, mes: null, mencao: "dia" } });
const NOT_OFFSET: Record<string, AstarInterpretation> = {
  SX01: DATA(15), SX02: luna({ dia: { tipo: "a_definir", mencao: "dois dias" } }), SX03: luna({ hora: { tipo: "relogio", hora: 12, minuto: 0, periodo: null, mencao: "duas horas" } }, "Quitéria"),
  SX04: DATA(23), SX05: DATA(12),
};
const byId = (id: string) => CASES.find(item => item.id === id)!;
const directories: string[] = [];
const scratch = () => { const directory = mkdtempSync(join(tmpdir(), "astar-probe-")); directories.push(directory); return directory; };
const casesFile = (cases: unknown = CASES) => { const file = join(scratch(), "SYNTHETIC-PROBE.json"); writeFileSync(file, JSON.stringify(cases, null, 2)); return file; };
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const CLEAN = () => ({ head: "a".repeat(40), dirty: [] as string[] });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const TEXTS = CASES.flatMap(item => [item.message, ...item.truth.evidenceSpans, item.appointment.customer, "Arrasta", "Quitéria", "Zebedeu"]);
const dry = async (file: string) => { const lines: string[] = []; const report = await dryRunProbe(file, { print: line => lines.push(line), tree: CLEAN }); return { report, lines,
  parsed: lines.map(line => JSON.parse(line) as Record<string, unknown>) }; };

describe("case schema (spec §5)", () => {
  it("the synthetic cases are valid, in priority order", () => {
    const { cases, errors } = validateProbeCases(CASES);
    expect(errors).toEqual([]);
    expect(cases.map(item => item.id)).toEqual(["SX01", "SX02", "SX03", "SX04", "SX05"]);
    expect(validateProbeCases({ cases: [...CASES].reverse() }).cases.map(item => item.id)).toEqual(["SX01", "SX02", "SX03", "SX04", "SX05"]);
    expect(validateProbeCases([LITERAL, WEEKDAY]).errors).toEqual([]);
  });
  it("each violation is a code with the path of the field (never a value): a missing field, a bad date, a bad enum, a duplicate priority, a missing twin, a time case without its day", () => {
    const broken = (change: (item: Record<string, unknown>) => void, index = 0) => { const list = structuredClone(CASES) as unknown as Record<string, unknown>[]; change(list[index]); return validateProbeCases(list).errors; };
    expect(broken(item => { delete item.message; })).toEqual([{ id: "SX01", codes: ["SCHEMA:message"] }]);
    expect(broken(item => { item.receivedAt = "ontem"; })).toEqual([{ id: "SX01", codes: ["SCHEMA:receivedAt"] }]);
    expect(broken(item => { (item.truth as Record<string, unknown>).anchor = "TALVEZ"; })).toEqual([{ id: "SX01", codes: ["SCHEMA:truth.anchor"] }]);
    expect(broken(item => { item.priority = 1; }, 1)).toEqual([{ id: "SX02", codes: ["SCHEMA:priority.duplicate"] }]);
    expect(broken(item => { item.twin = "SX99"; })).toEqual([{ id: "SX01", codes: ["SCHEMA:twin.unknown"] }]);
    expect(broken(item => { item.destinationDay = null; }, 2)).toEqual([{ id: "SX03", codes: ["SCHEMA:destinationDay"] }]);
    expect(broken(item => { (item.expected as Record<string, unknown>).value = "15/03"; })).toEqual([{ id: "SX01", codes: ["SCHEMA:expected.value"] }]);
    expect(broken(item => { item.timezone = "Lua/Base"; })).toEqual([{ id: "SX01", codes: ["SCHEMA:timezone"] }]);
    expect(validateProbeCases("x").errors).toEqual([{ id: "#file", codes: ["SCHEMA:file"] }]);
  });
});

describe("dry-run (no network): readings and decision under the ideal claim, the evidence self-test, the per-case byte gate, traceability; codes only", () => {
  it("every synthetic case matches; the summary carries the shas, the self-test, the per-case byte rule, the informative full-flow numbers, the projection and traceability", async () => {
    const file = casesFile(), { report, lines, parsed } = await dry(file);
    expect(report.ready).toBe(true);
    const caseLines = parsed.filter(line => line.kind === "DRY_RUN_CASE");
    expect(caseLines.map(line => [line.id, line.ok])).toEqual(CASES.map(item => [item.id, true]));
    expect(caseLines.map(line => [line.id, line.evidenceSelfTest])).toEqual([["SX01", { spans: 1, ok: 1 }], ["SX02", null], ["SX03", { spans: 1, ok: 1 }], ["SX04", { spans: 1, ok: 1 }], ["SX05", null]]);
    const summary = parsed.at(-1)!;
    expect(summary).toMatchObject({ kind: "DRY_RUN_SUMMARY", casesSha256: sha(file), contractSha256: PILOT_ASTAR_CONTRACT_SHA256, cases: 5, valid: 5, mismatched: 0, ready: true,
      evidenceSelfTest: { cases: 3, spans: 3, ok: 3, failed: [], complete: true }, projection: { capUsd: 0.04 } });
    for (const text of TEXTS) expect(lines.some(line => line.includes(text)), text).toBe(false);
  });
  it("a wrong expectation is reported by id with codes only (readings, decision, a span not in the message), and the file is not ready", async () => {
    const changed = structuredClone(CASES);
    changed[0].expected.readings.ORIGIN = ["2031-03-16"];
    changed[1].expected.decision = "USE"; changed[1].expected.value = "2031-03-12"; changed[1].expected.options = null;
    changed[3].truth.evidenceSpans = ["do dia 21"];
    const { report, lines, parsed } = await dry(casesFile(changed));
    expect(report.ready).toBe(false);
    const byCase = Object.fromEntries(parsed.filter(line => line.id).map(line => [line.id, line.codes]));
    expect(byCase.SX01).toEqual(["READINGS_ORIGIN"]);
    expect(byCase.SX02).toEqual(["DECISION_KIND"]);
    expect(byCase.SX04).toEqual(expect.arrayContaining(["TRUTH_SPAN_NOT_CONTAINED", "EVIDENCE_SELF_TEST"]));
    expect(parsed.at(-1)).toMatchObject({ evidenceSelfTest: { cases: 3, spans: 3, ok: 2, failed: ["SX04"], complete: false }, ready: false });
    for (const text of TEXTS) expect(lines.some(line => line.includes(text)), text).toBe(false);
  });
  it("self-test: each span, copied exactly as written, scores EVIDENCE_OK; both sides are folded alike (case, accents, punctuation), a word missing is a miss", async () => {
    const folded = structuredClone(CASES);
    folded[0].truth.evidenceSpans = ["ARRASTA a sessao,"];
    folded[2].truth.evidenceSpans = ["daqui a duas horas", "Daqui  a"];
    const first = await dry(casesFile(folded));
    expect(first.report.ready).toBe(true);
    expect(first.parsed.at(-1)).toMatchObject({ evidenceSelfTest: { cases: 3, spans: 4, ok: 4, failed: [], complete: true } });
    const exact = await scoreProbeCase(folded[0], luna(day(2, { evidencia: "Arrasta a sessão", tipo_evidencia: "desloca", tipo: "origem" }, null, "dois dias adiante")));
    expect(exact.metrics.EVIDENCE_OK).toBe(true);
    const missing = structuredClone(CASES);
    missing[0].truth.evidenceSpans = ["Arrasta sessão"];
    const second = await dry(casesFile(missing));
    expect(second.report.ready).toBe(false);
    expect(second.parsed[0].codes).toEqual(expect.arrayContaining(["EVIDENCE_SELF_TEST"]));
  });
  it("§9.4 bytes: the worst documented text is 1000 accented characters; each case's REAL request (1st call and the repair-note shape) with that text keeps ≥ 2,048 B under the cap", async () => {
    expect([...PROBE_WORST_TEXT].length).toBe(1000);
    expect(Buffer.byteLength(PROBE_WORST_TEXT, "utf8")).toBe(2000);
    expect([...PROBE_WORST_TEXT].every(char => char.normalize("NFD").length === 2)).toBe(true);
    const { parsed } = await dry(casesFile());
    for (const line of parsed.filter(item => item.kind === "DRY_RUN_CASE")) {
      const bytes = line.bytes as { first: number; repair: number; margin: number };
      expect(bytes.first, String(line.id)).toBeLessThan(bytes.repair);
      expect(bytes.margin, String(line.id)).toBe(64_000 - 8192 - bytes.repair);
      expect(bytes.margin, String(line.id)).toBeGreaterThanOrEqual(2048);
    }
    const payload = parsed.at(-1)!.payload as { perCase: Record<string, unknown>; fullFlowInformative: { text: unknown; reclaimed: { margin: number } } };
    expect(payload.perCase).toMatchObject({ required: 2048, overMargin: [] });
    expect(payload.fullFlowInformative.text).toEqual({ codePoints: 1000, bytes: 2000 });
  });
  it("§9.4: a case whose real request with the worst text does not keep 2,048 B fails the dry-run by id (REQUEST_OVER_MARGIN); the full-flow numbers never gate", async () => {
    // structuredClone keeps the salon the cases share shared: SX02 gets a salon of its own.
    const big = structuredClone(CASES);
    big[1].salon = { ...big[1].salon, catalog: Array.from({ length: 300 }, (_, index) => `Ritual ${String(index).padStart(3, "0")} de ervas e sais do cerrado com toalha morna e óleo de pequi`) };
    const { report, parsed } = await dry(casesFile(big));
    expect(report.ready).toBe(false);
    const line = parsed.find(item => item.id === "SX02")!;
    expect(line.codes).toEqual(["REQUEST_OVER_MARGIN"]);
    expect((line.bytes as { margin: number }).margin).toBeLessThan(2048);
    expect(parsed.at(-1)).toMatchObject({ payload: { perCase: { overMargin: ["SX02"] } } });
    // The open-plan construction of the E2-B proof, under the same worst text, is reported, never a gate: the clean file is ready whatever it says.
    const measurement = astarPayloadMeasurement();
    expect(measurement.text).toEqual({ codePoints: 1000, bytes: 2000 });
    expect((await dry(casesFile())).report.ready).toBe(true);
  });
  it("§9.5 traceability: HEAD, the clean-tree flag and the sha256 of the five traced files", async () => {
    const { parsed } = await dry(casesFile());
    const trace = parsed.at(-1)!.traceability as { head: string; clean: boolean; files: Record<string, string> };
    expect(trace.head).toBe("a".repeat(40));
    expect(trace.clean).toBe(true);
    expect(Object.keys(trace.files)).toEqual([...PROBE_TRACED_FILES]);
    expect([...PROBE_TRACED_FILES]).toEqual(["src/lib/secretary-pilot-anchor.ts", "packages/salon-secretary/evaluation/pilot-anchor-probe.ts", "src/lib/secretary-pilot-resolver.ts",
      "packages/salon-secretary/src/pilot-astar-contract.ts", "packages/salon-secretary/src/pilot-astar-prompt.ts"]);
    for (const path of PROBE_TRACED_FILES) expect(trace.files[path], path).toBe(sha(path));
    const dirty = await dryRunProbe(casesFile(), { print: () => undefined, tree: () => ({ head: "b".repeat(40), dirty: [join(process.cwd(), "README.md")] }) });
    expect(dirty.ready).toBe(true);
    expect(JSON.parse(JSON.stringify(dirty.lines.at(-1)))).toMatchObject({ traceability: { head: "b".repeat(40), clean: false } });
  });
});

describe("scoring (spec §6, §7 and §9): the enum alone never scores", () => {
  it("the right answers: every metric true, no safety code", async () => {
    for (const item of CASES) {
      const score = await scoreProbeCase(item, GOOD[item.id]);
      expect(score.safety, item.id).toEqual([]);
      expect(score.metrics, item.id).toEqual({ EVIDENCE_OK: true, TYPE_OK: true, ANCHOR_OK: true, CITED_OK: true, DECISION_OK: true });
    }
    expect((await scoreProbeCase(byId("SX02"), GOOD.SX02)).decision).toMatchObject({ outcome: "ASK", options: ["2031-03-12", "2031-03-15"] });
    expect((await scoreProbeCase(byId("SX05"), GOOD.SX05)).decision).toMatchObject({ outcome: "USE", value: "2031-03-12", basis: "COINCIDE" });
  });
  it("S1: a claim accepted with another anchor; and any claim accepted in an AMBIGUOUS case, even when the value coincides", async () => {
    expect((await scoreProbeCase(byId("SX01"), luna(day(2, { evidencia: "dois dias", tipo_evidencia: "nomeia", tipo: "origem" }, null)))).safety).toEqual([]);
    const present = await scoreProbeCase(byId("SX03"), luna({ hora: { tipo: "deslocamento", minutos: 120, hora_citada: null, ancora: { evidencia: "Bota a Quitéria", tipo_evidencia: "desloca",
      tipo: "origem" }, mencao: "daqui a duas horas" } }, "Quitéria"));
    expect(present.safety).toContain("S1_WRONG_ANCHOR_ACCEPTED");
    expect(present.metrics.ANCHOR_OK).toBe(false);
    expect((await scoreProbeCase(byId("SX02"), luna(day(2, { evidencia: "Encaixa", tipo_evidencia: "desloca", tipo: "origem" }, null, "em dois dias")))).safety).toContain("S1_WRONG_ANCHOR_ACCEPTED");
    const coinciding = await scoreProbeCase(byId("SX05"), luna(day(2, { evidencia: "Encaixa", tipo_evidencia: "desloca", tipo: "origem" }, null, "em dois dias"), "Quitéria"));
    expect(coinciding.decision).toMatchObject({ outcome: "USE", value: "2031-03-12" });
    expect(coinciding.safety).toEqual(["S1_WRONG_ANCHOR_ACCEPTED"]);
  });
  it("evidence not in the message is never accepted (no S2, the readings decide); outro and null are the not-named answers", async () => {
    const invented = await scoreProbeCase(byId("SX02"), luna(day(2, { evidencia: "a data marcada", tipo_evidencia: "nomeia", tipo: "origem" }, null, "em dois dias")));
    expect(invented.claim).toMatchObject({ state: "NOT_CONTAINED", contained: false });
    expect(invented.safety).toEqual([]);
    expect(invented.metrics.EVIDENCE_OK).toBe(false);
    const outro = await scoreProbeCase(byId("SX02"), luna(day(2, { evidencia: "dois dias", tipo_evidencia: "outro", tipo: "origem" }, null, "em dois dias")));
    expect(outro.metrics).toMatchObject({ EVIDENCE_OK: true, TYPE_OK: true, ANCHOR_OK: true, DECISION_OK: true });
    const empty = await scoreProbeCase(byId("SX02"), luna(day(2, { evidencia: "", tipo_evidencia: "desloca", tipo: "origem" }, null, "em dois dias")));
    expect(empty.claim).toMatchObject({ state: "NOT_CONTAINED", empty: true });
    expect(empty.metrics.EVIDENCE_OK).toBe(true);
  });
  it("S3 only for a real ambiguity (AMBIGUOUS truth, divergent readings) resolved in silence; S4 a wrong value used without asking", async () => {
    const silent = await scoreProbeCase(byId("SX02"), luna(day(-3, null, null, "em dois dias")));
    expect(silent.decision).toMatchObject({ outcome: "USE", value: "2031-03-10", basis: "COINCIDE" });
    expect(silent.safety).toEqual(["S3_SILENT_AMBIGUITY"]);
    const wrongValue = await scoreProbeCase(byId("SX01"), luna(day(3, { evidencia: "Arrasta a sessão", tipo_evidencia: "desloca", tipo: "origem" }, null)));
    expect(wrongValue.decision).toMatchObject({ outcome: "USE", value: "2031-03-16" });
    expect(wrongValue.safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
    expect(wrongValue.metrics.ANCHOR_OK).toBe(true);
  });
  it("§9.2: a named start whose expected question comes only from the competing cited day: the true anchor's own value is W3 (no stop); any other value is S4", async () => {
    const decided = await scoreProbeCase(LITERAL, luna(day(2, { evidencia: "Arrasta a sessão", tipo_evidencia: "desloca", tipo: "origem" }, { dia: 20, mes: null, mencao: "dia 20" })));
    expect(decided.decision).toMatchObject({ outcome: "ASK", reason: "LITERAL_COMPETES", options: ["2031-03-15", "2031-03-22"] });
    expect(decided.safety).toEqual([]);
    const missed = await scoreProbeCase(LITERAL, luna(day(2, { evidencia: "Arrasta a sessão", tipo_evidencia: "desloca", tipo: "origem" }, null)));
    expect(missed.decision).toMatchObject({ outcome: "USE", value: "2031-03-15", basis: "EVIDENCE" });
    expect(missed.safety).toEqual([]);
    expect(missed.warnings).toEqual(["W3_MISSED_LITERAL_ASK"]);
    expect(missed.metrics.CITED_OK).toBe(false);
    const other = await scoreProbeCase(LITERAL, luna(day(2, { evidencia: "o dia 20", tipo_evidencia: "nomeia", tipo: "data_citada" }, { dia: 20, mes: null, mencao: "dia 20" })));
    expect(other.decision).toMatchObject({ outcome: "USE", value: "2031-03-22" });
    expect(other.safety).toEqual(["S1_WRONG_ANCHOR_ACCEPTED", "S4_WRONG_VALUE_WITHOUT_ASK"]);
    // A named cited weekday with two readings expected asked: a USE is S4, never S3 (S3 is for AMBIGUOUS truths only).
    const weekday = await scoreProbeCase(WEEKDAY, luna(day(3, { evidencia: "de sexta", tipo_evidencia: "nomeia", tipo: "data_citada" },
      { tipo: "dia_semana", dia_semana: "sexta", qualificador: "este", mencao: "sexta" }, "três dias depois de sexta")));
    expect(weekday.decision).toMatchObject({ outcome: "USE", value: "2031-03-17" });
    expect(weekday.safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
    expect(weekday.metrics.CITED_OK).toBe(false);
  });
  it("W1: the right anchor accepted on weak evidence (warned, never a stop); CITED_OK needs the typed reference AND its containment", async () => {
    const weak = await scoreProbeCase(byId("SX01"), luna(day(2, { evidencia: "Zebedeu", tipo_evidencia: "desloca", tipo: "origem" }, null)));
    expect(weak.safety).toEqual([]);
    expect(weak.warnings).toContain("W1_WEAK_EVIDENCE_RIGHT_ANCHOR");
    const wrongCited = await scoreProbeCase(byId("SX04"), luna(day(3, { evidencia: "do dia 20", tipo_evidencia: "nomeia", tipo: "data_citada" }, { dia: 21, mes: null, mencao: "dia 20" })));
    expect(wrongCited.metrics.CITED_OK).toBe(false);
    expect(wrongCited.safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
    const uncontained = await scoreProbeCase(byId("SX04"), luna(day(3, { evidencia: "do dia 20", tipo_evidencia: "nomeia", tipo: "data_citada" }, { dia: 20, mes: null, mencao: "vinte" })));
    expect(uncontained.metrics.CITED_OK).toBe(false);
    expect(uncontained.claim.state).toBe("CITED_MISSING");
    const extra = await scoreProbeCase(byId("SX01"), luna(day(2, { evidencia: "Arrasta a sessão", tipo_evidencia: "desloca", tipo: "origem" }, { dia: 13, mes: null, mencao: "dois" })));
    expect(extra.metrics.CITED_OK).toBe(false);
  });
  it("EVIDENCE_OK (amended before any run): the evidence must contain the whole naming core; twins of one case differ only in the copied words", async () => {
    const scored = (evidencia: string) => scoreProbeCase(byId("SX01"), luna(day(2, { evidencia, tipo_evidencia: "desloca", tipo: "origem" }, null, "dois dias adiante")));
    for (const evidencia of ["Arrasta a sessão", "arrasta a SESSAO", "Arrasta a sessão do Zebedeu"]) {
      const score = await scored(evidencia);
      expect(score.metrics.EVIDENCE_OK, evidencia).toBe(true);
      expect(score.warnings, evidencia).toEqual([]);
    }
    for (const evidencia of ["Arrasta", "sessão", "adiante", "dois dias"]) {
      const score = await scored(evidencia);
      expect(score.claim.state, evidencia).toBe("ACCEPTED");
      expect(score.metrics.EVIDENCE_OK, evidencia).toBe(false);
      expect(score.warnings, evidencia).toEqual(["W1_WEAK_EVIDENCE_RIGHT_ANCHOR"]);
      expect(score.safety, evidencia).toEqual([]);
    }
    const absent = await scored("Empurra a sessão");
    expect(absent.claim).toMatchObject({ state: "NOT_CONTAINED", contained: false });
    expect(absent.metrics.EVIDENCE_OK).toBe(false);
    expect(absent.warnings).toEqual([]);
    const longer = structuredClone(byId("SX01"));
    longer.truth.evidenceSpans = ["Arrasta a sessão do Zebedeu"];
    expect((await scoreProbeCase(longer, luna(day(2, { evidencia: "Arrasta a sessão", tipo_evidencia: "desloca", tipo: "origem" }, null)))).metrics.EVIDENCE_OK).toBe(false);
  });
  it("M-a and M-b through the pipeline (message → containment → module): another contained evidence never changes the decision; an evidence absent from the message decides like no claim", async () => {
    const decision = async (item: ProbeCase, ancora: unknown) => {
      const { claim: _state, ...rest } = (await scoreProbeCase(item, luna(day(item.truth.offset.days as number, ancora, null)))).decision as Record<string, unknown>;
      void _state;
      return JSON.stringify(rest);
    };
    for (const item of [byId("SX01"), byId("SX02"), byId("SX05")]) {
      const contained = item.message.split(" ").filter(word => word.length > 3);
      for (const type of ["nomeia", "deitico", "desloca", "outro"]) for (const tipo of ["origem", "hoje"]) {
        const decisions = new Set(await Promise.all(contained.map(evidencia => decision(item, { evidencia, tipo_evidencia: type, tipo }))));
        expect(decisions.size, `${item.id} ${type}/${tipo}`).toBe(1);
        expect(await decision(item, { evidencia: "palavra ausente", tipo_evidencia: type, tipo }), `${item.id} ${type}/${tipo}`).toBe(await decision(item, null));
      }
    }
  });
});

describe("§9.1 an answer that is no offset: scored by what the product does with it (the E2-B resolver of that operator)", () => {
  it("the value the product would use equals the expected one: W2_NOT_OFFSET, never a pass of the evidence, the type or the anchor", async () => {
    for (const id of ["SX01", "SX03", "SX04", "SX05"]) {
      const score = await scoreProbeCase(byId(id), NOT_OFFSET[id]);
      expect(score.status, id).toBe("NOT_OFFSET");
      expect(score.decision, id).toMatchObject({ outcome: "USE", value: byId(id).expected.value });
      expect(score.safety, id).toEqual([]);
      expect(score.warnings, id).toEqual(["W2_NOT_OFFSET"]);
      expect(score.metrics, id).toMatchObject({ EVIDENCE_OK: false, TYPE_OK: false, ANCHOR_OK: false, DECISION_OK: true });
    }
  });
  it("a different value used: S4; a value used in silence on a real ambiguity: S3; the day left open is a question (no code, counted in the ambiguity tally)", async () => {
    expect((await scoreProbeCase(byId("SX01"), DATA(16))).safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
    // No day at all: the product keeps the appointment's own day.
    expect((await scoreProbeCase(byId("SX01"), luna({}))).decision).toMatchObject({ outcome: "USE", value: "2031-03-13" });
    expect((await scoreProbeCase(byId("SX01"), luna({}))).safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
    const same = await scoreProbeCase(byId("SX02"), luna({ dia: { tipo: "mesmo_da_origem", mencao: "dois dias" } }));
    expect(same.decision).toMatchObject({ outcome: "USE", value: "2031-03-13" });
    expect(same.safety).toEqual(["S3_SILENT_AMBIGUITY"]);
    expect((await scoreProbeCase(byId("SX02"), DATA(12))).safety).toEqual(["S3_SILENT_AMBIGUITY"]);
    const open = await scoreProbeCase(byId("SX02"), NOT_OFFSET.SX02);
    expect(open).toMatchObject({ status: "NOT_OFFSET", decision: { outcome: "ASK" }, safety: [], ambiguityAsked: true });
    expect(open.metrics.DECISION_OK).toBe(true);
    const weekday = await scoreProbeCase(byId("SX02"), luna({ dia: { tipo: "dia_semana", dia_semana: "quarta", qualificador: null, mencao: "dois dias" } }));
    expect(weekday.decision).toMatchObject({ outcome: "ASK", options: ["2031-03-12", "2031-03-19"] });
    // Readings that coincide are no real ambiguity: another value used is S4, not S3.
    expect((await scoreProbeCase(byId("SX05"), luna({ dia: { tipo: "mesmo_da_origem", mencao: "dois dias" } }, "Quitéria"))).safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
  });
  it("a clock: a bare hour read by the day's hours, a clock already gone today asked (as the product does), another clock S4, no clock on the appointment's own day keeps its clock", async () => {
    const bare = await scoreProbeCase(byId("SX03"), luna({ hora: { tipo: "relogio", hora: 9, minuto: 0, periodo: null, mencao: "duas horas" } }, "Quitéria"));
    expect(bare.decision).toMatchObject({ outcome: "ASK" });
    expect(bare.safety).toEqual([]);
    expect((await scoreProbeCase(byId("SX03"), luna({ hora: { tipo: "relogio", hora: 15, minuto: 0, periodo: null, mencao: "duas horas" } }, "Quitéria"))).safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
    const kept = await scoreProbeCase(byId("SX03"), luna({}, "Quitéria"));
    expect(kept.decision).toMatchObject({ outcome: "USE", value: "16:00" });
    expect(kept.safety).toEqual(["S4_WRONG_VALUE_WITHOUT_ASK"]);
    expect((await scoreProbeCase(byId("SX03"), luna({ hora: { tipo: "a_definir", mencao: "duas horas" } }, "Quitéria"))).decision).toMatchObject({ outcome: "ASK" });
  });
});

// ---------------------------------------------------------------- paid mode, offline: a fake transport behind the real guard, SDK and ledger
const URL = "https://api.openai.com/v1/responses";
type Answer = AstarInterpretation | "INVALID";
/** The fake transport: answers by the case of the message (a list answers call by call); `usage` overrides the usage of every response. */
function fakeNetwork(answers: Record<string, Answer | Answer[]>, usage: Record<string, unknown> = { input_tokens: 9000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 600,
  output_tokens_details: { reasoning_tokens: 400 }, total_tokens: 9600 }) {
  const calls: string[] = [];
  const network = (async (input: unknown, init?: RequestInit) => {
    if (input !== URL) throw Error("UNEXPECTED_URL");
    const body = JSON.parse(String(init?.body)) as { input: { role: string; content: string }[] };
    const message = body.input.find(item => item.role === "user")!.content, item = [...CASES, LITERAL].find(entry => entry.message === message)!;
    const seen = calls.filter(id => id === item.id).length;
    calls.push(item.id);
    const scripted = answers[item.id], answer = Array.isArray(scripted) ? scripted[Math.min(seen, scripted.length - 1)] : scripted ?? GOOD[item.id];
    return new Response(JSON.stringify({ id: `resp_${calls.length}`, object: "response", created_at: 0, status: "completed", model: "gpt-6-luna",
      output: [{ id: `fc_${calls.length}`, call_id: `call_${calls.length}`, type: "function_call", name: "interpretar_remarcacao", status: "completed",
        arguments: answer === "INVALID" ? "{\"tipo\":\"remarcar\"}" : JSON.stringify(answer) }], usage }),
      { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { network, calls };
}
const approvedEnv = (file: string, over: Record<string, string | undefined> = {}) => ({ [PROBE_ENV.approved]: "true", [PROBE_ENV.casesSha]: sha(file), [PROBE_ENV.contractSha]: PILOT_ASTAR_CONTRACT_SHA256,
  SALON_SECRETARY_MODEL: "gpt-6-luna", SALON_SECRETARY_OPENAI_API_KEY: "synthetic-offline-not-a-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_offline", ...over });
async function paid(file: string, answers: Record<string, Answer | Answer[]> = {}, over: { env?: Record<string, string | undefined>; capUsd?: number; deps?: Partial<ProbeRunDeps>;
  usage?: Record<string, unknown>; onLine?: (line: string) => void } = {}) {
  const lines: string[] = [], ledger = join(scratch(), PROGRAM_SPEND_BASENAME), fake = fakeNetwork(answers, over.usage);
  const env = approvedEnv(file, over.env);
  let error: string | undefined, summary: Record<string, unknown> | undefined;
  try { summary = await runProbe({ file, capUsd: over.capUsd ?? PROBE_CAP_USD }, { env, print: line => { lines.push(line); over.onLine?.(line); }, network: fake.network, ledger,
    roots: [process.cwd()], tree: CLEAN, ...over.deps }) as Record<string, unknown>; }
  catch (thrown) { error = (thrown as Error).message; }
  return { lines, parsed: lines.map(line => JSON.parse(line) as Record<string, unknown>), ledger, calls: fake.calls, error, summary, env };
}

describe("paid mode (offline): refusals before any ledger row or call", () => {
  it("refuses without the approval, with another cases sha, with another contract sha, with another model, in production, above the US$ 0.04 cap", async () => {
    const file = casesFile();
    for (const [env, code] of [[{ [PROBE_ENV.approved]: "false" }, "PROBE_NOT_APPROVED"], [{ [PROBE_ENV.casesSha]: "0".repeat(64) }, "PROBE_CASES_SHA_MISMATCH"],
      [{ [PROBE_ENV.contractSha]: "f".repeat(64) }, "PROBE_CONTRACT_SHA_MISMATCH"], [{ SALON_SECRETARY_MODEL: "gpt-5.6-luna" }, "PROBE_MODEL"],
      [{ VERCEL_ENV: "production" }, "PROBE_PRODUCTION_FORBIDDEN"]] as const) {
      const result = await paid(file, {}, { env: env as Record<string, string> });
      expect(result.error, code).toBe(code);
      expect(result.calls, code).toEqual([]);
      expect(existsSync(result.ledger), code).toBe(false);
    }
    const above = await paid(file, {}, { capUsd: 0.041 });
    expect(above.error).toBe("PROBE_CAP_ARGUMENT");
    expect(above.calls).toEqual([]);
    expect(PROBE_CAP_USD).toBe(0.04);
  });
  it("refuses a file whose dry-run does not match, a cases file whose runs folder would be inside a checkout, and a dirty tree (the sealed runs folder aside)", async () => {
    const changed = structuredClone(CASES); changed[0].expected.value = "2031-03-16";
    const mismatched = await paid(casesFile(changed));
    expect(mismatched.error).toBe("PROBE_DRY_RUN_MISMATCH");
    expect(mismatched.calls).toEqual([]);
    const file = casesFile(), inside = await paid(file, {}, { deps: { roots: [join(file, "..")] } });
    expect(inside.error).toBe("PROBE_RESULTS_INSIDE_CHECKOUT");
    expect(inside.calls).toEqual([]);
    const dirty = await paid(file, {}, { deps: { tree: () => ({ head: "a".repeat(40), dirty: [join(process.cwd(), "packages", "salon-secretary", "src", "pilot-astar-prompt.ts")] }) } });
    expect(dirty.error).toBe("PROBE_TREE_DIRTY");
    expect(dirty.calls).toEqual([]);
    expect(existsSync(dirty.ledger)).toBe(false);
    const sealedOnly = await paid(file, {}, { deps: { tree: () => ({ head: "a".repeat(40), dirty: [join(file, "..", "runs", "earlier", "SX01.json")] }) } });
    expect(sealedOnly.error).toBeUndefined();
    expect(sealedOnly.summary).toMatchObject({ verdict: "PREMISSA_SEGURA", traceability: { head: "a".repeat(40), clean: true } });
  });
  it("§9.5: refuses when a traced file cannot be read from the checkout root (cwd, as every launcher): its summary could not carry the five sha256", async () => {
    const file = casesFile(), elsewhere = scratch();
    vi.spyOn(process, "cwd").mockReturnValue(elsewhere);
    const result = await paid(file);
    expect(result.error).toBe("PROBE_TRACE_UNREADABLE");
    expect(result.calls).toEqual([]);
    expect(existsSync(result.ledger)).toBe(false);
  });
});

describe("paid mode (offline): one JSON line of codes per case, the stop rule, the cap, the verdicts, the sealed detail", () => {
  it("runs every case in priority order: codes-only lines, PREMISSA_SEGURA, traceability, the ledger run probe:astar-<timestamp>, texts only in the runs folder", async () => {
    const file = casesFile(), result = await paid(file);
    expect(result.error).toBeUndefined();
    expect(result.calls).toEqual(["SX01", "SX02", "SX03", "SX04", "SX05"]);
    const cases = result.parsed.filter(line => line.kind === "CASE");
    expect(cases.map(line => [line.id, (line.safety as string[]).length])).toEqual(CASES.map(item => [item.id, 0]));
    expect(cases[0]).toMatchObject({ id: "SX01", priority: 1, twin: "SX02", target: "date", status: "SCORED", calls: 1, repaired: false,
      claim: { state: "ACCEPTED", anchor: "ORIGIN", type: "DESLOCA", contained: true }, decision: { outcome: "USE", value: "2031-03-15", basis: "EVIDENCE" },
      metrics: { EVIDENCE_OK: true, TYPE_OK: true, ANCHOR_OK: true, CITED_OK: true, DECISION_OK: true }, tokens: { input: 9000, cached: 0, output: 600, reasoning: 400 } });
    expect(typeof cases[0].latencyMs).toBe("number");
    expect(cases[0].costUsd).toBeCloseTo((9000 * 0.125 + 600 * 0.5) / 1e6, 9);
    const summary = result.parsed.at(-1)!;
    expect(summary).toMatchObject({ kind: "SUMMARY", verdict: "PREMISSA_SEGURA", stoppedBy: null, executed: 5, offsetScored: 5, total: 5, unrun: [], complete: true, inconclusive: null,
      metrics: { EVIDENCE_OK: 5, TYPE_OK: 5, ANCHOR_OK: 5, CITED_OK: 5, DECISION_OK: 5 }, ambiguitiesAsked: { asked: 1, expected: 1 }, falseAsks: { count: 0, useExpected: 4, g3Limit: 1 },
      nullOrOutro: 2, w1: { count: 0, ids: [] }, w2: { count: 0, ids: [] }, w3: { count: 0, ids: [] }, failed: { safe: { count: 0, ids: [] }, infra: { count: 0, ids: [] } },
      traceability: { head: "a".repeat(40), clean: true } });
    expect(Object.keys((summary.traceability as { files: object }).files)).toEqual([...PROBE_TRACED_FILES]);
    expect(String(summary.run)).toMatch(/^probe:astar-\d{4}-\d{2}-\d{2}T/);
    expect(programSpendTotals(result.ledger).byRun[String(summary.run)]).toMatchObject({ calls: 5, open: 0 });
    for (const text of TEXTS) expect(result.lines.some(line => line.includes(text)), text).toBe(false);
    const runs = join(file, "..", "runs"), [stamp] = readdirSync(runs), detail = readFileSync(join(runs, stamp, "SX01.json"), "utf8");
    expect(detail).toContain("Arrasta a sessão do Zebedeu");
    expect(detail).toContain(JSON.stringify(JSON.stringify(GOOD.SX01)).slice(1, 40));
    expect(existsSync(join(runs, stamp, "summary.json"))).toBe(true);
  });
  it("stops at the first S code with no further call: the premise is REPROVADA and the cases not run are reported", async () => {
    const result = await paid(casesFile(), { SX02: luna(day(2, { evidencia: "Encaixa", tipo_evidencia: "desloca", tipo: "origem" }, null, "em dois dias")) });
    expect(result.error).toBeUndefined();
    expect(result.parsed.find(line => line.id === "SX01")).toMatchObject({ status: "SCORED", safety: [] });
    expect(result.calls).toEqual(["SX01", "SX02"]);
    expect(result.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_REPROVADA", stoppedBy: "S1_WRONG_ANCHOR_ACCEPTED", executed: 2, unrun: ["SX03", "SX04", "SX05"], complete: false });
    expect(result.parsed.find(line => line.id === "SX02")?.safety).toEqual(["S1_WRONG_ANCHOR_ACCEPTED", "S3_SILENT_AMBIGUITY"]);
  });
  it("a format failure gets its one repair and is scored; the cap is checked before each call; a case stopped inside it is unrun (F6)", async () => {
    const repaired = await paid(casesFile(), { SX01: ["INVALID", GOOD.SX01] });
    expect(repaired.calls.slice(0, 3)).toEqual(["SX01", "SX01", "SX02"]);
    expect(repaired.parsed.find(line => line.id === "SX01")).toMatchObject({ calls: 2, repaired: true, status: "SCORED", costUsd: 2 * 0.001425 });
    // §9.8 N2: a format still invalid after the one repair is the product's safe failure: reported, the verdict unchanged.
    const failed = await paid(casesFile(), { SX01: "INVALID" });
    expect(failed.parsed.find(line => line.id === "SX01")).toMatchObject({ calls: 2, status: "FAILED_SAFE", code: "PILOT_SCHEMA", safety: [] });
    expect(failed.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_SEGURA", inconclusive: null, failed: { safe: { count: 1, ids: ["SX01"] }, infra: { count: 0, ids: [] } } });
    // Each call costs US$ 0.001425 and its worst case is about US$ 0.0094 (a ~34 KB body): with a US$ 0.0113 cap the third call would pass it.
    const capped = await paid(casesFile(), {}, { capUsd: 0.0113 });
    expect(capped.calls).toEqual(["SX01", "SX02"]);
    expect(capped.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_SEGURA", stoppedBy: "CAP", executed: 2, unrun: ["SX03", "SX04", "SX05"], complete: false });
    // With a US$ 0.0100 cap the first call fits and its repair does not: the case stops at the cap inside it, is reported CAP_STOP and listed unrun.
    const inside = await paid(casesFile(), { SX01: ["INVALID", GOOD.SX01] }, { capUsd: 0.01 });
    expect(inside.calls).toEqual(["SX01"]);
    expect(inside.parsed.find(line => line.id === "SX01")).toMatchObject({ status: "CAP_STOP", code: "PROBE_CAP" });
    expect(inside.parsed.at(-1)).toMatchObject({ stoppedBy: "CAP", unrun: ["SX01", "SX02", "SX03", "SX04", "SX05"], executed: 0 });
  });
  it("§9.3 verdicts: INCONCLUSIVA when nothing was scored as an offset (the cap before the first case; only answers that are no offset) or when the run stops for another reason", async () => {
    const early = await paid(casesFile(), {}, { capUsd: 0.005 });
    expect(early.calls).toEqual([]);
    expect(early.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_INCONCLUSIVA", stoppedBy: "CAP", offsetScored: 0, inconclusive: { reason: "NO_OFFSET_SCORED", offsetScored: 0 } });
    const notOffset = await paid(casesFile(), NOT_OFFSET);
    expect(notOffset.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_INCONCLUSIVA", stoppedBy: null, executed: 5, offsetScored: 0, inconclusive: { reason: "NO_OFFSET_SCORED" },
      w2: { count: 4, ids: ["SX01", "SX03", "SX04", "SX05"] }, ambiguitiesAsked: { asked: 1, expected: 1 } });
    // A provider usage beyond the sealed bound stops the ledger (PROGRAM_SPEND_BOUND): the case is ABORTED and unrun, the verdict inconclusive.
    const bound = await paid(casesFile(), {}, { usage: { input_tokens: 999_999, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 } } });
    expect(bound.parsed.find(line => line.id === "SX01")).toMatchObject({ status: "ABORTED", code: "PROGRAM_SPEND_BOUND" });
    expect(bound.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_INCONCLUSIVA", stoppedBy: "PROGRAM_SPEND_BOUND", inconclusive: { reason: "PROGRAM_SPEND_BOUND" },
      unrun: ["SX01", "SX02", "SX03", "SX04", "SX05"] });
  });
  it("§9.4 and §9.8: a case the pre-send guard refuses is FAILED_INFRA (REQUEST_REFUSED), the run goes on to a summary, and the verdict is inconclusive", async () => {
    const refusing = (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      if (String(init?.body).includes("Encaixa o Zebedeu")) throw Error("PROGRAM_SPEND_WIRE");
      return false;
    };
    const result = await paid(casesFile(), {}, { deps: { capCheck: refusing } });
    expect(result.error).toBeUndefined();
    expect(result.calls).toEqual(["SX01", "SX03", "SX04", "SX05"]);
    expect(result.parsed.find(line => line.id === "SX02")).toMatchObject({ status: "FAILED_INFRA", code: "REQUEST_REFUSED", calls: 0 });
    expect(result.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_INCONCLUSIVA", stoppedBy: null, executed: 5, offsetScored: 4,
      inconclusive: { reason: "INFRA_FAILED", infraIds: ["SX02"] }, failed: { safe: { count: 0, ids: [] }, infra: { count: 1, ids: ["SX02"] } } });
    // The same inside a case: its repair refused by the guard (the case's 3rd check: before the case, call 1, call 2) fails that case only.
    let checks = 0;
    const refusingRepair = (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      if (String(init?.body).includes("Arrasta a sessão do Zebedeu") && ++checks === 3) throw Error("PROGRAM_SPEND_WIRE");
      return false;
    };
    const repair = await paid(casesFile(), { SX01: ["INVALID", GOOD.SX01] }, { deps: { capCheck: refusingRepair } });
    expect(repair.error).toBeUndefined();
    expect(repair.calls).toEqual(["SX01", "SX02", "SX03", "SX04", "SX05"]);
    expect(repair.parsed.find(line => line.id === "SX01")).toMatchObject({ status: "FAILED_INFRA", code: "REQUEST_REFUSED", calls: 2, repaired: true });
    expect(repair.parsed.at(-1)).toMatchObject({ verdict: "PREMISSA_INCONCLUSIVA", stoppedBy: null, executed: 5, offsetScored: 4, unrun: [],
      inconclusive: { reason: "INFRA_FAILED", infraIds: ["SX01"] }, failed: { safe: { count: 0, ids: [] }, infra: { count: 1, ids: ["SX01"] } } });
  });
  it("§9.8 N2: schema and deadline failures are the product's safe failure (FAILED_SAFE, verdict unchanged); transport, refusal, budget and guard are infrastructure (FAILED_INFRA)", () => {
    for (const code of ["PILOT_SCHEMA", "PILOT_DEADLINE"]) expect(probeFailureClass(code), code).toBe("FAILED_SAFE");
    for (const code of ["PILOT_TRANSPORT", "REQUEST_REFUSED", "PILOT_BUDGET", "PILOT_BUDGET_UNMEASURED", "PILOT_GUARD", "SOMETHING_NOT_KNOWN", null])
      expect(probeFailureClass(code), String(code)).toBe("FAILED_INFRA");
  });
  it("§9.8 N2 in a run: deadlines are FAILED_SAFE and keep PREMISSA_SEGURA; a transport error is FAILED_INFRA and makes it PREMISSA_INCONCLUSIVA (INFRA_FAILED, ids)", async () => {
    // Deadline: after SX01's line the clock jumps a minute at every reading, so each later case finds its 45 s already spent (no call).
    const real = performance.now.bind(performance);
    let offset = 0, jumping = false;
    vi.spyOn(performance, "now").mockImplementation(() => { if (jumping) offset += 60_000; return real() + offset; });
    const late = await paid(casesFile(), {}, { onLine: line => { if ((JSON.parse(line) as { id?: string }).id === "SX01") jumping = true; } });
    vi.restoreAllMocks();
    expect(late.calls).toEqual(["SX01"]);
    for (const id of ["SX02", "SX03", "SX04", "SX05"]) expect(late.parsed.find(line => line.id === id), id).toMatchObject({ status: "FAILED_SAFE", code: "PILOT_DEADLINE", calls: 0 });
    expect(late.summary).toMatchObject({ verdict: "PREMISSA_SEGURA", stoppedBy: null, executed: 5, offsetScored: 1, inconclusive: null,
      failed: { safe: { count: 4, ids: ["SX02", "SX03", "SX04", "SX05"] }, infra: { count: 0, ids: [] } } });
    // Transport: the network fails for SX03 only; the run goes on, the case is FAILED_INFRA, the verdict inconclusive.
    const fake = fakeNetwork({});
    const network = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (String(init?.body).includes("Bota a Quitéria")) throw new TypeError("fetch failed");
      return fake.network(input, init);
    }) as typeof fetch;
    const transport = await paid(casesFile(), {}, { deps: { network } });
    expect(fake.calls).toEqual(["SX01", "SX02", "SX04", "SX05"]);
    expect(transport.parsed.find(line => line.id === "SX03")).toMatchObject({ status: "FAILED_INFRA", code: "PILOT_TRANSPORT" });
    expect(transport.summary).toMatchObject({ verdict: "PREMISSA_INCONCLUSIVA", stoppedBy: null, complete: true, offsetScored: 4,
      inconclusive: { reason: "INFRA_FAILED", infraIds: ["SX03"] }, failed: { safe: { count: 0, ids: [] }, infra: { count: 1, ids: ["SX03"] } } });
  });
  it("§9.9 N3: after a halt no paid call goes out: a stray call between cases stops the run before the next case; the wrapper refuses any call once halted", async () => {
    // A stray call after SX01's line (no case active): the run halts and SX02 never starts, so nothing else reaches the network.
    let stray: Promise<string> | undefined;
    const between = await paid(casesFile(), {}, { onLine: line => {
      const parsed = JSON.parse(line) as { kind?: string; id?: string };
      if (parsed.kind === "CASE" && parsed.id === "SX01") stray = globalThis.fetch(URL, { method: "POST", body: "{}" }).then(() => "SENT", (error: Error) => error.message);
    } });
    expect(await stray).toBe("PROBE_UNEXPECTED_NETWORK");
    expect(between.calls).toEqual(["SX01"]);
    expect(between.parsed.filter(line => line.kind === "CASE").map(line => line.id)).toEqual(["SX01"]);
    expect(between.summary).toMatchObject({ verdict: "PREMISSA_INCONCLUSIVA", stoppedBy: "PROBE_UNEXPECTED_NETWORK", executed: 1, unrun: ["SX02", "SX03", "SX04", "SX05"],
      inconclusive: { reason: "PROBE_UNEXPECTED_NETWORK" } });
    // Inside a case: a call the cap stops halts the run; the next call is refused by the wrapper itself (the cap is not even consulted, nothing is sent).
    const fake = fakeNetwork({}), nested: string[] = [];
    let checks = 0;
    const network = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (!nested.length) for (let index = 0; index < 2; index++)
        nested.push(await globalThis.fetch(URL, { method: "POST", body: String(init?.body) }).then(() => "SENT", (error: Error) => error.message));
      return fake.network(input, init);
    }) as typeof fetch;
    const inside = await paid(casesFile(), {}, { deps: { network, capCheck: () => ++checks === 3 } });
    expect(nested).toEqual(["PROBE_CAP", "PROBE_CAP"]);
    expect(checks).toBe(3);
    expect(fake.calls).toEqual(["SX01"]);
    expect(inside.summary).toMatchObject({ stoppedBy: "CAP", executed: 0, unrun: ["SX01", "SX02", "SX03", "SX04", "SX05"] });
  });
  it("§9.6 the SDK client logs nothing even with OPENAI_LOG=debug (a bare client does: positive control)", async () => {
    vi.stubEnv("OPENAI_LOG", "debug");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(name => vi.spyOn(console, name).mockImplementation(() => undefined));
    const respond = async () => new Response(JSON.stringify({ id: "resp_x", object: "response", created_at: 0, status: "completed", model: "gpt-6-luna", output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    const bare = new OpenAI({ apiKey: "synthetic-offline-not-a-key", baseURL: "https://api.openai.com/v1", maxRetries: 0, fetch: respond as typeof fetch });
    await bare.responses.create({ model: "gpt-6-luna", input: "x" });
    expect(spies.some(spy => spy.mock.calls.length > 0)).toBe(true);
    for (const spy of spies) spy.mockClear();
    vi.stubGlobal("fetch", respond);
    const model = await createProbeModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: "gpt-6-luna", SALON_SECRETARY_OPENAI_API_KEY: "synthetic-offline-not-a-key",
      SALON_SECRETARY_OPENAI_PROJECT: "proj_offline" });
    const outcome = await runAstarInterpretation(model, { context: { today: { date: "2031-03-10", weekday: "segunda-feira", timezone: "America/Sao_Paulo" }, team: ["Bartolomeu Iguaçu"],
      services: ["Banho de lua"] }, message: "x", modelId: "gpt-6-luna", startedAt: performance.now() });
    expect(outcome.telemetry.calls).toBe(2);
    expect(spies.map(spy => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
    // The whole paid run under OPENAI_LOG=debug prints only its own lines.
    const run = await paid(casesFile());
    expect(run.summary).toMatchObject({ verdict: "PREMISSA_SEGURA" });
    expect(spies.map(spy => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("CLI and payload measurement", () => {
  it("parses --cases, --dry-run and --cap-usd strictly (at most US$ 0.04)", () => {
    expect(parseProbeArgs(["--cases", "a.json"])).toEqual({ cases: "a.json", dryRun: false, capUsd: 0.04 });
    expect(parseProbeArgs(["--cases", "a.json", "--dry-run", "--cap-usd", "0.035"])).toEqual({ cases: "a.json", dryRun: true, capUsd: 0.035 });
    expect(parseProbeArgs(["--cases", "a.json", "--cap-usd", "0.04"]).capUsd).toBe(0.04);
    for (const argv of [[], ["--cases"], ["--cases", "a", "--cases", "b"], ["--cases", "a", "--cap-usd", "0.041"], ["--cases", "a", "--cap-usd", "-1"], ["--cases", "a", "--extra"]])
      expect(() => parseProbeArgs(argv), JSON.stringify(argv)).toThrow("PROBE_ARGUMENT");
  });
  it("the dry-run through the CLI needs no approval and no credential; exit 0 when ready", async () => {
    const lines: string[] = [];
    expect(await probeCli(["--cases", casesFile(), "--dry-run"], {}, line => lines.push(line), { tree: CLEAN })).toBe(0);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ kind: "DRY_RUN_SUMMARY", ready: true });
  });
  it("the informative full-flow measurement (the E2-B open-plan construction) under the worst documented text, with and without the mencao descriptions", () => {
    const measurement = astarPayloadMeasurement();
    expect(measurement.cap).toEqual({ requestCap: 64_000, outputFraming: 8192, required: 2048 });
    expect(measurement.text).toEqual({ codePoints: 1000, bytes: 2000 });
    expect(measurement.reclaimed.worstBytes).toBeLessThan(measurement.kept.worstBytes);
    expect(measurement.reclaimed.margin).toBe(64_000 - 8192 - measurement.reclaimed.worstBytes);
    expect(measurement.shapes.map(shape => shape.reason)).toEqual(["APPOINTMENT_SEVERAL", "EXCLUSION_CONTRADICTORY"]);
    expect(measurement.informative).toBe(true);
  });
});
