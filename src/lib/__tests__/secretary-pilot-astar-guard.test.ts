import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRequest } from "@everflair/salon-secretary";
import { agentRequestBody } from "../../../packages/salon-secretary/src/agent-loop";
import { assertSecretaryPilotAnchorProbeModelRequest, assertSecretaryPilotModelRequest, assertSecretaryResponsesPayload, secretaryGuardedFetch,
  PILOT_ANCHOR_PROBE_TOOLS_SHA256 } from "../../../packages/salon-secretary/src/openai-cost-guard";
import { pilotRequest, type PilotRequestContext } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { astarParameters, astarTool, PILOT_ASTAR_TOOLS_SHA256 } from "../../../packages/salon-secretary/src/pilot-astar-contract";
import { astarRequest } from "../../../packages/salon-secretary/src/pilot-astar-prompt";
import { assertProgramHeadroom, guardPaidFetch, PROGRAM_SPEND_BASENAME, programSpendTotals, responsesEstimator, runSpendCapReached } from "../../../packages/salon-secretary/evaluation/program-spend";

/** A* premise probe, the cost guard and the program ledger (docs/c5-spike/13-sonda-premissa-astar.md §1: "só a ferramenta A* da sonda, atrás de uma opção
 * explícita; o comportamento padrão não muda"), written BEFORE the change. The probe's wire (the E2-B format with the variant tool, pinned by digest) is
 * admitted only under an explicit {pilotAnchorProbe:true}, and under it nothing else is; every existing option keeps its exact behaviour (the A* body is
 * refused by all of them; the C4, agent and E2-B bodies are judged as before). Offline: SDK bodies built on a client that cannot reach the network,
 * temporary ledgers, fake transports. */
const MODEL = "gpt-6-luna", URL = "https://api.openai.com/v1/responses";
const context: PilotRequestContext = { today: { date: "2031-03-10", weekday: "segunda-feira", timezone: "America/Sao_Paulo" }, team: ["Bartolomeu Iguaçu"], services: ["Banho de lua"] };
const wire = (request: ModelRequest) => JSON.parse(JSON.stringify(agentRequestBody(request, MODEL))) as Record<string, unknown>;
const astarBody = () => wire(astarRequest(context, "Zebedeu passa a sessão para o dia vinte"));
const e2bBody = () => wire(pilotRequest(context, "Zebedeu passa a sessão para o dia vinte"));
/** A C4 body (the frozen wire's single function tool), as the existing guard test builds it. */
const c4Body = () => ({ model: MODEL, instructions: "sintético", input: [{ role: "user", content: "sintético" }],
  tools: [{ type: "function", name: "select_capabilities", description: "local", parameters: { type: "object" }, strict: true }], tool_choice: { type: "function", name: "select_capabilities" },
  parallel_tool_calls: false, max_output_tokens: 1200, store: false, stream: false, include: [] });
const verdict = (body: unknown, options?: Parameters<typeof assertSecretaryResponsesPayload>[2]) => { try { assertSecretaryResponsesPayload(body, MODEL, options); return "ADMITTED"; } catch { return "REFUSED"; } };
const directories: string[] = [];
const ledgerIn = () => { const directory = mkdtempSync(join(tmpdir(), "astar-ledger-")); directories.push(directory); return join(directory, PROGRAM_SPEND_BASENAME); };
afterEach(() => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("§9.6 the real flow never loads the A* contract: the guard pins the probe tool by a literal digest", () => {
  it("the literal equals the digest computed from the variant tool, and the guard source imports nothing of the A* files", () => {
    expect(PILOT_ANCHOR_PROBE_TOOLS_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(PILOT_ANCHOR_PROBE_TOOLS_SHA256).toBe(PILOT_ASTAR_TOOLS_SHA256);
    const source = readFileSync("packages/salon-secretary/src/openai-cost-guard.ts", "utf8");
    expect(source.match(/from\s+["'][^"']*pilot-astar[^"']*["']/g) ?? []).toEqual([]);
    expect(source).toContain(`"${PILOT_ASTAR_TOOLS_SHA256}"`);
  });
});

describe("HTTP boundary: {pilotAnchorProbe:true} admits only the probe's wire, and only it admits that wire", () => {
  it("the A* body: admitted with {pilotAnchorProbe:true}; refused with no option, {pilot:true}, {agent:true} or both", () => {
    expect(verdict(astarBody(), { pilotAnchorProbe: true })).toBe("ADMITTED");
    for (const options of [undefined, {}, { pilot: true }, { agent: true }, { agent: true, pilot: true }]) expect(verdict(astarBody(), options), JSON.stringify(options)).toBe("REFUSED");
  });
  it("default behaviour unchanged: the C4 body is admitted with no option and the E2-B body only with {pilot:true}; under {pilotAnchorProbe:true} both are refused", () => {
    expect(verdict(c4Body())).toBe("ADMITTED");
    expect(verdict(c4Body(), { agent: false })).toBe("ADMITTED");
    expect(verdict(e2bBody(), { pilot: true })).toBe("ADMITTED");
    expect(verdict(e2bBody())).toBe("REFUSED");
    for (const body of [c4Body(), e2bBody()]) {
      expect(verdict(body, { pilotAnchorProbe: true })).toBe("REFUSED");
      expect(verdict(body, { pilot: true, pilotAnchorProbe: true })).toBe("REFUSED");
    }
  });
  it("under the option, anything else in the A* body is refused: effort, store, include, an extra key, tool_choice, the output cap, stream, another tool, the variant that keeps the descriptions", () => {
    const body = astarBody(), tool = (body.tools as Record<string, unknown>[])[0];
    const changed = [{ ...body, reasoning: { effort: "high" } }, { ...body, store: true }, { ...body, include: ["reasoning.encrypted_content"] }, { ...body, extra: 1 },
      { ...body, tool_choice: "required" }, { ...body, max_output_tokens: 99 }, { ...body, stream: true }, { ...body, tools: [tool, tool] },
      { ...body, tools: [{ ...tool, description: "outra" }] }, { ...body, tools: [{ ...tool, parameters: astarParameters(true) }] },
      { ...body, input: [{ type: "function_call_output", call_id: "c1", output: "{}" }] }, { ...body, model: "gpt-5.6-luna" }];
    for (const [index, payload] of changed.entries()) expect(verdict(payload, { pilotAnchorProbe: true }), String(index)).toBe("REFUSED");
  });
});

describe("SDK boundary of one probe call", () => {
  it("admits the probe request and its repair; refuses the E2-B request, and the E2-B check refuses the probe request", () => {
    expect(() => assertSecretaryPilotAnchorProbeModelRequest(astarRequest(context, "x"))).not.toThrow();
    expect(() => assertSecretaryPilotAnchorProbeModelRequest(astarRequest(context, "x", { repair: ["SCHEMA:invalid_type@tipo"] }))).not.toThrow();
    expect(() => assertSecretaryPilotAnchorProbeModelRequest(pilotRequest(context, "x"))).toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(() => assertSecretaryPilotModelRequest(astarRequest(context, "x"))).toThrow("SECRETARY_OPENAI_COST_GUARD");
  });
  it("refuses another effort, store, parallel calls, an extra tool, a previous response, a changed tool description", () => {
    const base = astarRequest(context, "x");
    const changed: ModelRequest[] = [{ ...base, modelSettings: { ...base.modelSettings, reasoning: { effort: "high" } } }, { ...base, modelSettings: { ...base.modelSettings, store: true } },
      { ...base, modelSettings: { ...base.modelSettings, parallelToolCalls: true } }, { ...base, tools: [...base.tools, ...base.tools] }, { ...base, previousResponseId: "resp_x" },
      { ...base, tools: [{ ...(base.tools[0] as object), description: "outra" } as ModelRequest["tools"][number]] }];
    for (const [index, request] of changed.entries()) expect(() => assertSecretaryPilotAnchorProbeModelRequest(request), String(index)).toThrow("SECRETARY_OPENAI_COST_GUARD");
  });
});

describe("guarded fetch: the probe's client sends only its own wire; the default client never sends it", () => {
  it("{pilotAnchorProbe:true}: the A* body reaches the transport, the E2-B body is refused before it; the default guard refuses the A* body before it", async () => {
    const network = vi.fn(async () => new Response(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200 }));
    vi.stubGlobal("fetch", network);
    const send = (guard: typeof fetch, body: unknown) => guard(URL, { method: "POST", body: JSON.stringify(body) });
    await expect(send(secretaryGuardedFetch(MODEL, { pilotAnchorProbe: true }), astarBody())).resolves.toBeInstanceOf(Response);
    expect(network).toHaveBeenCalledTimes(1);
    await expect(send(secretaryGuardedFetch(MODEL, { pilotAnchorProbe: true }), e2bBody())).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    await expect(send(secretaryGuardedFetch(MODEL), astarBody())).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    await expect(send(secretaryGuardedFetch(MODEL, { pilot: true }), astarBody())).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(network).toHaveBeenCalledTimes(1);
    expect(astarTool().name).toBe("interpretar_remarcacao");
  });
});

describe("program ledger: the probe's wire is estimated, reserved and settled only under {pilotAnchorProbe:true}", () => {
  const init = () => ({ method: "POST", body: JSON.stringify(astarBody()) });
  it("the estimator: the A* wire only with the option (an estimate at the pilot's output cap); refused with no option, {pilot:true} or {agent:true}; the E2-B wire refused under it", () => {
    expect(responsesEstimator.worstCase(URL, init(), { pilotAnchorProbe: true })).toMatchObject({ estimator: "responses", model: MODEL, maxOutputTokens: 8192 });
    for (const options of [undefined, {}, { pilot: true }, { agent: true }]) expect(() => responsesEstimator.worstCase(URL, init(), options), JSON.stringify(options)).toThrow("PROGRAM_SPEND_WIRE");
    expect(() => responsesEstimator.worstCase(URL, { method: "POST", body: JSON.stringify(e2bBody()) }, { pilotAnchorProbe: true })).toThrow("PROGRAM_SPEND_WIRE");
    expect(responsesEstimator.worstCase(URL, { method: "POST", body: JSON.stringify(e2bBody()) }, { pilot: true })).toMatchObject({ estimator: "responses" });
  });
  it("guardPaidFetch reserves before transport and settles the actual usage under the option; without it nothing is reserved and nothing is sent", async () => {
    const ledger = ledgerIn(), transport = vi.fn(async () => new Response(JSON.stringify({ id: "resp_x", output: [], usage: { input_tokens: 9000, input_tokens_details: { cached_tokens: 0 },
      output_tokens: 600, output_tokens_details: { reasoning_tokens: 400 } } }), { status: 200 }));
    await expect(guardPaidFetch("practice", transport, { ledger, run: "probe:astar-test", item: "SX01:c1" })(URL, init())).rejects.toThrow("PROGRAM_SPEND_WIRE");
    expect(existsSync(ledger)).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    const response = await guardPaidFetch("practice", transport, { ledger, run: "probe:astar-test", item: "SX01:c1", pilotAnchorProbe: true })(URL, init());
    expect(response.status).toBe(200);
    const rows = readFileSync(ledger, "utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(rows.map(row => row.kind)).toEqual(["RESERVE", "SETTLE"]);
    expect(rows[0]).toMatchObject({ source: "practice", run: "probe:astar-test", item: "SX01:c1" });
    expect(rows[1]).toMatchObject({ outcome: "USAGE" });
    const totals = programSpendTotals(ledger);
    expect(totals.byRun["probe:astar-test"].spentMicroUsd).toBe(Math.ceil(9000 * 0.125 + 600 * 0.5));
  });
  it("the run cap and the program headroom read the probe's wire under the option only", async () => {
    const ledger = ledgerIn();
    expect(runSpendCapReached(URL, init(), { ledger, run: "probe:astar-test", capMicroUsd: 30_000, pilotAnchorProbe: true })).toBe(false);
    expect(runSpendCapReached(URL, init(), { ledger, run: "probe:astar-test", capMicroUsd: 5_000, pilotAnchorProbe: true })).toBe(true);
    expect(() => runSpendCapReached(URL, init(), { ledger, run: "probe:astar-test", capMicroUsd: 30_000 })).toThrow("PROGRAM_SPEND_WIRE");
    await expect(assertProgramHeadroom(URL, init(), { ledger, pilotAnchorProbe: true })).resolves.toMatchObject({ spentMicroUsd: 0 });
    await expect(assertProgramHeadroom(URL, init(), { ledger })).rejects.toThrow("PROGRAM_SPEND_WIRE");
  });
});
