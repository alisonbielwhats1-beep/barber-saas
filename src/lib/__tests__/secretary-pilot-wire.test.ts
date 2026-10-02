import { describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "@everflair/salon-secretary";
import { agentRequestBody } from "../../../packages/salon-secretary/src/agent-loop";
import { assertSecretaryPilotModelRequest, assertSecretaryResponsesPayload } from "../../../packages/salon-secretary/src/openai-cost-guard";
import { PILOT_RESCHEDULE_PARAMETERS, PILOT_RESCHEDULE_TOOL, PILOT_REQUEST_LIMITS } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { instrumentPilotModel, pilotCatalogNames, pilotRequest, runPilotInterpretation, PILOT_PROMPT, PILOT_REPAIR_RULES, PILOT_REQUEST_CAP, PILOT_SERVICE_NAMES_BYTES,
  type PilotRequestContext } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { secretaryFlagSnapshot } from "../../../packages/salon-secretary/evaluation/agenda-practice-lib";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

/** Pilot of the reschedule (docs/c5-spike/12-piloto-remarcacao.md §2, §5): the one request of an owner message as the SDK and the HTTP body carry
 * it, the cost guard admitting it ONLY with {pilot:true}, the request size cap, the bounded call loop (one format repair, no third call) and the
 * usage events of its two attempts. Offline: the body is built by the SDK's own builder on a client that cannot reach the network; the model is
 * scripted. Invented salon data only. */
const MODEL = "gpt-6-luna";
/** The HTTP body as sent (JSON: the SDK builder's undefined keys are not on the wire). */
const wire = (request: ModelRequest) => JSON.parse(JSON.stringify(agentRequestBody(request, MODEL))) as Record<string, unknown>;
const context = (over: Partial<PilotRequestContext> = {}): PilotRequestContext => ({ today: { date: "2031-03-10", weekday: "segunda-feira", timezone: "America/Sao_Paulo" },
  team: ["Teodósio Arruda", "Iolanda Braga"], services: ["Massagem relaxante", "Esfoliação corporal"], ...over });
const valid = { tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null, cliente: { mencao: "Zaqueu" },
  origem: { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null },
  destino: { dia: { tipo: "deslocamento", quantidade: 2, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: "depois de amanhã" }, hora: { tipo: "relogio", hora: 17, minuto: 0, periodo: null, mencao: "17h" }, profissional: { modo: null, mencao: null } },
  observacoes: [], fora_do_escopo: [] };

describe("pilot request: SDK boundary, HTTP boundary and size", () => {
  it("the request passes the SDK guard; its HTTP body passes the payload guard only with {pilot:true}", () => {
    const request = pilotRequest(context(), "Zaqueu migra a sessão para o dia vinte, 17h");
    expect(() => assertSecretaryPilotModelRequest(request)).not.toThrow();
    const tool = request.tools[0] as { name?: string; strict?: boolean; parameters?: unknown };
    expect(tool).toMatchObject({ name: PILOT_RESCHEDULE_TOOL, strict: true });
    expect(tool.parameters).toEqual(PILOT_RESCHEDULE_PARAMETERS);
    expect(request.modelSettings).toMatchObject({ toolChoice: PILOT_RESCHEDULE_TOOL, parallelToolCalls: false, store: false, reasoning: { effort: PILOT_REQUEST_LIMITS.effort } });
    const body = wire(request);
    expect(() => assertSecretaryResponsesPayload(body, MODEL, { pilot: true })).not.toThrow();
    expect(() => assertSecretaryResponsesPayload(body, MODEL)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(() => assertSecretaryResponsesPayload(body, MODEL, { agent: true })).toThrow("SECRETARY_OPENAI_COST_GUARD");
    // The repair request is the same format.
    expect(() => assertSecretaryResponsesPayload(wire(pilotRequest(context(), "x", { repair: ["SCHEMA:invalid_type@tipo"] })), MODEL, { pilot: true })).not.toThrow();
  });
  it("anything else in the request is refused at both boundaries (another effort, store, an extra tool or key, stateful fields)", () => {
    const base = pilotRequest(context(), "Zaqueu migra a sessão para o dia vinte, 17h");
    const changed: ModelRequest[] = [
      { ...base, modelSettings: { ...base.modelSettings, reasoning: { effort: "high" } } },
      { ...base, modelSettings: { ...base.modelSettings, store: true } },
      { ...base, modelSettings: { ...base.modelSettings, parallelToolCalls: true } },
      { ...base, tools: [...base.tools, ...base.tools] },
      { ...base, previousResponseId: "resp_x" },
      { ...base, tools: [{ ...(base.tools[0] as object), description: "outra" } as ModelRequest["tools"][number]] },
    ];
    for (const [index, request] of changed.entries()) expect(() => assertSecretaryPilotModelRequest(request), String(index)).toThrow("SECRETARY_OPENAI_COST_GUARD");
    const body = wire(base);
    for (const [index, payload] of [{ ...body, reasoning: { effort: "high" } }, { ...body, store: true }, { ...body, include: ["reasoning.encrypted_content"] }, { ...body, extra: 1 },
      { ...body, tool_choice: "required" }, { ...body, max_output_tokens: 99 }].entries())
      expect(() => assertSecretaryResponsesPayload(payload, MODEL, { pilot: true }), String(index)).toThrow("SECRETARY_OPENAI_COST_GUARD");
  });
  it("fits the cap (request bytes + output framing ≤ 64000) with a full directory and an open plan; customers are never part of it", () => {
    const team = Array.from({ length: 40 }, (_, index) => `Profissional Sintética Número ${index} de Sobrenome Comprido`);
    const services = Array.from({ length: 80 }, (_, index) => `Serviço sintético de nome bem comprido número ${index}`);
    const open = { lines: ["cliente: “Zaqueu” (cadastro definido)", "novo dia: qua, 12/03"], question: { questionId: "q7", field: "novo horário", reason: "TIME_TWO_READINGS", options: ["8h (08:00)", "20h (20:00)"] } };
    const request = pilotRequest(context({ team, services, open }), "x".repeat(1000));
    const bytes = Buffer.byteLength(JSON.stringify(agentRequestBody(request, MODEL)), "utf8");
    expect(bytes + PILOT_REQUEST_CAP.outputFraming).toBeLessThanOrEqual(PILOT_REQUEST_CAP.requestCap);
    expect(JSON.stringify(request.input)).toContain("q7");
    expect(PILOT_PROMPT).not.toMatch(/\b(?:Amanda|Fábio|João|Tatiana|Rosa|Carla|Ricardo|Rodrigo)\b/);
  });
  it("E2-A review CATALOG-1: every catalog name the reader returns (up to its 400) is sent, cut only past the byte budget; the worst case still fits the cap", () => {
    const realistic = Array.from({ length: 400 }, (_, index) => `Ritual sintético ${String(index).padStart(3, "0")}`);
    expect(pilotCatalogNames(realistic)).toEqual({ names: realistic, total: 400 });
    expect(pilotCatalogNames(["Corte", "Corte", "", "Escova"])).toEqual({ names: ["Corte", "Escova"], total: 2 });
    // Worst case: 400 names of 200 characters (the contract's longest catalog name), a full team, an open plan, a 1000-character message and a
    // repair note naming every rule code: the names are cut at the budget (and counted), and the request fits the cap.
    const long = Array.from({ length: 400 }, (_, index) => `${String(index).padStart(3, "0")} ${"ção".repeat(65)}`);
    const cut = pilotCatalogNames(long);
    expect(cut.total).toBe(400);
    expect(cut.names.length).toBeLessThan(400);
    expect(Buffer.byteLength(JSON.stringify(cut.names), "utf8")).toBeLessThanOrEqual(PILOT_SERVICE_NAMES_BYTES);
    const team = Array.from({ length: 40 }, (_, index) => `Profissional Sintética Número ${index} de Sobrenome Comprido`);
    const open = { lines: ["cliente: “Zaqueu” (cadastro definido)", "novo dia: qua, 12/03"], question: { questionId: "q7", field: "novo horário", reason: "TIME_TWO_READINGS", options: ["8h (08:00)", "20h (20:00)"] } };
    const request = pilotRequest(context({ team, services: cut.names, open }), "ção".repeat(333), { repair: [...Object.keys(PILOT_REPAIR_RULES), "SCHEMA:invalid_type@tipo"] });
    const bytes = Buffer.byteLength(JSON.stringify(agentRequestBody(request, MODEL)), "utf8");
    expect(bytes + PILOT_REQUEST_CAP.outputFraming).toBeLessThanOrEqual(PILOT_REQUEST_CAP.requestCap);
  });
  it("E2-B review REGRESSION-3: the largest open question also fits (8 options shown at the label bound, every line at its bound, every repair rule)", () => {
    // The catalog cut at the budget, a full team, a 1000-character message and the repair note naming every rule, as above; the open plan at its
    // largest shape: every line at its bound and the pending question with the SHOWN_OPTIONS (8) appointment labels, each at the label bound
    // (pilotAppointmentLabel: the local day and clock, a service of PILOT_TEXT_BOUNDS.service and a name of PILOT_TEXT_BOUNDS.name).
    const cut = pilotCatalogNames(Array.from({ length: 400 }, (_, index) => `${String(index).padStart(3, "0")} ${"ção".repeat(65)}`));
    const team = Array.from({ length: 40 }, (_, index) => `Profissional Sintética Número ${index} de Sobrenome Comprido`);
    const label = (index: number) => `qua, 12/03/2031 às 23h59 — ${"ã".repeat(159)}… com ${"é".repeat(119)}… ${index}`;
    const open = { lines: [`cliente: “${"ô".repeat(120)}” (cadastro ainda não definido)`, `atendimento atual: ${label(0)}`, "novo dia: não definido", "novo horário: não definido",
      `profissional: ${"é".repeat(119)}… (mantido)`, "proposta pronta, aguardando Confirmar"],
      question: { questionId: "q999", field: "atendimento atual (origem)", reason: "APPOINTMENT_SEVERAL", options: Array.from({ length: 8 }, (_, index) => label(index + 1)) } };
    const request = pilotRequest(context({ team, services: cut.names, open }), "ção".repeat(333), { repair: [...Object.keys(PILOT_REPAIR_RULES), "SCHEMA:invalid_type@tipo"] });
    const bytes = Buffer.byteLength(JSON.stringify(agentRequestBody(request, MODEL)), "utf8");
    expect(bytes + PILOT_REQUEST_CAP.outputFraming).toBeLessThanOrEqual(PILOT_REQUEST_CAP.requestCap);
  });
  it("the evaluation flag snapshot records the pilot switch (it names no credential)", () => {
    expect(secretaryFlagSnapshot({ SALON_SECRETARY_PILOT_RESCHEDULE: "true", SALON_SECRETARY_OPENAI_API_KEY: "sk-synthetic" })).toEqual({ SALON_SECRETARY_PILOT_RESCHEDULE: "true" });
  });
});

describe("pilot call loop: one interpretation, at most one format repair", () => {
  const run = (frames: unknown[][]) => {
    const model = new ScriptedServicesModel(frames as never);
    return { model, outcome: runPilotInterpretation(model as never, { context: context(), message: "Zaqueu migra a sessão para o dia vinte, 17h", modelId: MODEL, startedAt: performance.now() }) };
  };
  it("a valid first answer is decoded with one call", async () => {
    const { model, outcome } = run([call(PILOT_RESCHEDULE_TOOL, valid)]);
    expect(await outcome).toMatchObject({ ok: true, interpretation: valid, telemetry: { calls: 1, repaired: false } });
    expect(model.requests).toHaveLength(1);
  });
  it("an invalid first answer gets one repair (with codes only); a valid repair is used", async () => {
    const { model, outcome } = run([call(PILOT_RESCHEDULE_TOOL, { tipo: "remarcar" }), call(PILOT_RESCHEDULE_TOOL, valid)]);
    expect(await outcome).toMatchObject({ ok: true, telemetry: { calls: 2, repaired: true } });
    const repair = JSON.stringify(model.requests[1].input);
    expect(repair).toContain("SCHEMA:");
  });
  it("two invalid answers end the message with PILOT_SCHEMA and no third call; another tool or a transport failure ends it too", async () => {
    const twice = run([call(PILOT_RESCHEDULE_TOOL, { tipo: "remarcar" }), call(PILOT_RESCHEDULE_TOOL, { ...valid, extra: true }), call(PILOT_RESCHEDULE_TOOL, valid)]);
    expect(await twice.outcome).toMatchObject({ ok: false, code: "PILOT_SCHEMA", telemetry: { calls: 2 } });
    expect(twice.model.requests).toHaveLength(2);
    const other = run([call("select_capabilities", {}), call("select_capabilities", {})]);
    expect(await other.outcome).toMatchObject({ ok: false, code: "PILOT_SCHEMA" });
    const failing = { requests: [] as ModelRequest[], async getResponse(request: ModelRequest) { this.requests.push(request); throw Error("NETWORK_DOWN"); }, async *getStreamedResponse() { throw Error("NO"); } };
    expect(await runPilotInterpretation(failing as never, { context: context(), message: "x", modelId: MODEL, startedAt: performance.now() })).toMatchObject({ ok: false, code: "PILOT_TRANSPORT" });
    expect(failing.requests).toHaveLength(1);
  });
  it("past the message deadline nothing is sent", async () => {
    const model = new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, valid)]);
    expect(await runPilotInterpretation(model as never, { context: context(), message: "x", modelId: MODEL, startedAt: performance.now() - 46_000 })).toMatchObject({ ok: false, code: "PILOT_DEADLINE" });
    expect(model.requests).toHaveLength(0);
  });
});

describe("pilot usage: attempts 1 PILOT_INTERPRETATION and 2 PILOT_REPAIR, recorded by the app's recorder", () => {
  it("records STARTED/SUCCEEDED per attempt in order and refuses a request the pilot did not build", async () => {
    const events: { attempt: number; purpose: string; status: string }[] = [];
    const model = instrumentPilotModel(new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, { tipo: "x" }), call(PILOT_RESCHEDULE_TOOL, valid)]) as never, MODEL,
      async event => { events.push({ attempt: event.attempt, purpose: event.purpose, status: event.status }); });
    const outcome = await runPilotInterpretation(model, { context: context(), message: "Zaqueu migra a sessão para o dia vinte, 17h", modelId: MODEL, startedAt: performance.now() });
    expect(outcome.ok).toBe(true);
    expect(events).toEqual([{ attempt: 1, purpose: "PILOT_INTERPRETATION", status: "STARTED" }, { attempt: 1, purpose: "PILOT_INTERPRETATION", status: "SUCCEEDED" },
      { attempt: 2, purpose: "PILOT_REPAIR", status: "STARTED" }, { attempt: 2, purpose: "PILOT_REPAIR", status: "SUCCEEDED" }]);
    const foreign = instrumentPilotModel(new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, valid)]) as never, MODEL, async () => undefined);
    await expect(foreign.getResponse({ ...pilotRequest(context(), "x") })).rejects.toThrow("MODEL_CALL_LIMIT");
  });
  it("the recorder admits the pilot pairs, in order, as their own family", async () => {
    const create = vi.fn(async () => ({}));
    vi.doMock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn({ auditLog: { create } }) }));
    vi.resetModules();
    const { usageRecorder: recorder } = await import("../salon-secretary-usage");
    const record = recorder({ salonId: "synthetic-salon", userId: "synthetic-user" }, crypto.randomUUID(), crypto.randomUUID(), MODEL);
    const event = (attempt: 1 | 2, purpose: string, status: string) => ({ attempt, purpose, status, timestamp: new Date().toISOString(), usage_status: "UNKNOWN", model_id_requested: MODEL,
      model_id_returned: null, request_id: null, response_id: null, requests: null, input_tokens: null, cached_input_tokens: null, cache_write_tokens: null, output_tokens: null,
      reasoning_tokens: null, total_tokens: null }) as never;
    await expect(record(event(2, "PILOT_REPAIR", "STARTED"))).rejects.toThrow("USAGE_ATTEMPT_INVALID");
    await record(event(1, "PILOT_INTERPRETATION", "STARTED")); await record(event(1, "PILOT_INTERPRETATION", "SUCCEEDED"));
    await expect(record(event(2, "SOURCE_LITERAL_REPAIR", "STARTED"))).rejects.toThrow("USAGE_ATTEMPT_INVALID");
    await record(event(2, "PILOT_REPAIR", "STARTED")); await record(event(2, "PILOT_REPAIR", "SUCCEEDED"));
    expect(create).toHaveBeenCalledTimes(4);
    vi.doUnmock("../prisma-tenant");
  });
});

describe("evaluation harness of the pilot arm (H1-H8; offline, temp files only)", () => {
  const responsesUrl = "https://api.openai.com/v1/responses";
  const body = () => JSON.stringify(wire(pilotRequest(context(), "Zaqueu migra a sessão para o dia vinte, 17h")));
  it("H1: the program-spend estimator admits the pilot's wire only with {pilot:true}", async () => {
    const { responsesEstimator } = await import("../../../packages/salon-secretary/evaluation/program-spend");
    const init = { method: "POST", body: body() };
    expect(() => responsesEstimator.worstCase(responsesUrl, init)).toThrow("PROGRAM_SPEND_WIRE");
    expect(() => responsesEstimator.worstCase(responsesUrl, init, { agent: true })).toThrow("PROGRAM_SPEND_WIRE");
    expect(responsesEstimator.worstCase(responsesUrl, init, { pilot: true })).toMatchObject({ estimator: "responses", model: MODEL, maxOutputTokens: PILOT_REQUEST_LIMITS.maxOutputTokens });
  });
  it("H2: the stage reservation admits the pilot's wire only with {pilot:true}; the arm is the product flag", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
    const lib = await import("../../../packages/salon-secretary/evaluation/agenda-practice-lib");
    const dir = mkdtempSync(join(tmpdir(), "pilot-wire-")), file = lib.stageJournalPath(dir, "c4-dev-20260929");
    try {
      expect(() => lib.reserve(file, "run-pilot", "P01#k1", 1, body(), "c4-dev-20260929")).toThrow();
      expect(lib.reserve(file, "run-pilot", "P01#k1", 1, body(), "c4-dev-20260929", { pilot: true })).toMatchObject({ stage: "c4-dev-20260929", previousHash: "GENESIS" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    expect(lib.pilotArm({ SALON_SECRETARY_PILOT_RESCHEDULE: "true" })).toBe(true);
    expect(lib.pilotArm({ SALON_SECRETARY_PILOT_RESCHEDULE: "1" })).toBe(false);
    expect(lib.pilotArm({})).toBe(false);
  });
  it("H5/H7: the pilot's call is its own kind and a pilot message is estimated at 2 calls (say or scripted answer)", async () => {
    const lib = await import("../../../packages/salon-secretary/evaluation/agenda-practice-lib");
    const payload = JSON.parse(body()) as Record<string, unknown>;
    const json = { status: "completed", output: [{ type: "function_call", call_id: "c1", name: PILOT_RESCHEDULE_TOOL, arguments: JSON.stringify(valid) }] };
    expect(lib.agentCallRecord(1, "", "v", payload, json)).toMatchObject({ kind: "PILOT", arguments: JSON.stringify(valid) });
    expect(lib.agentCallRecord(1, "", "v", { tools: [{ name: "registrar_pedido" }] }, json).kind).toBe("C4");
    const scenario = { id: "P01", title: "t", steps: [{ say: "a" }, { say: "b" }], answers: { time: "às 17h" } } as never;
    expect(lib.expectedCalls(scenario, { pilot: true }).calls).toBe(2 * 3);
    expect(lib.expectedCalls(scenario).calls).toBe(2 * 2 + 1);
  });
  it("H6: the pilot's telemetry row is kept as codes and numbers only", async () => {
    const { pilotTurnTelemetry } = await import("../../../packages/salon-secretary/evaluation/agenda-practice-lib");
    const row = pilotTurnTelemetry("ASKED_CUSTOMER_AMBIGUOUS", { plan_id: crypto.randomUUID(), turn_id: crypto.randomUUID(), status: "pending", revision: 2,
      question: { id: "q1", field: "customer", reason: "CUSTOMER_AMBIGUOUS" }, proposal_ref: null, provenance: { customer: "unresolved", date: "explicit", "nome livre": "x" },
      model_calls: 2, repaired: true, latency_ms: 812, request_bytes: [9000], invalidation: "PROPOSAL_EXPIRED", texto: "Zaqueu" });
    expect(row).toEqual({ code: "ASKED_CUSTOMER_AMBIGUOUS", status: "pending", question: { field: "customer", reason: "CUSTOMER_AMBIGUOUS" },
      provenance: { customer: "unresolved", date: "explicit" }, model_calls: 2, repaired: true, latency_ms: 812, invalidation: "PROPOSAL_EXPIRED" });
    expect(pilotTurnTelemetry("free words", null)).toEqual({ code: null, status: null, question: null, provenance: null, model_calls: null, repaired: null, latency_ms: null, invalidation: null });
  });
  it("H8 (owner decision 29): target_professional_ref and professional_ref are one field for the answers and the mustAsk oracle", async () => {
    const { AnswerBook, sameAskField } = await import("../../../packages/salon-secretary/evaluation/agenda-practice-lib");
    for (const delivery of ["field", "item"] as const) {
      const book = new AnswerBook({ professional_ref: "com o Teodósio" }, "seed", "2031-03-10", delivery);
      expect(book.next(["target_professional_ref"])).toMatchObject({ field: "professional_ref", text: "com o Teodósio", use: 1, for: { field: "target_professional_ref" } });
      expect(book.next(["target_professional_ref"])).toBeUndefined();
    }
    // A field with an answer of its own keeps it; the alias never takes an answer another pending question asks for itself.
    const own = new AnswerBook({ professional_ref: "com o Teodósio", target_professional_ref: "com a Iolanda" }, "seed", "2031-03-10");
    expect(own.next(["target_professional_ref"])).toMatchObject({ field: "target_professional_ref", text: "com a Iolanda" });
    expect(new AnswerBook({ professional_ref: "com o Teodósio" }, "seed", "2031-03-10").next(["professional_ref", "target_professional_ref"])).toMatchObject({ field: "professional_ref" });
    expect(sameAskField("target_professional_ref", "professional_ref")).toBe(true);
    expect(sameAskField("professional_ref", "target_professional_ref")).toBe(true);
    expect(sameAskField("service_ref", "professional_ref")).toBe(false);
  });
});
