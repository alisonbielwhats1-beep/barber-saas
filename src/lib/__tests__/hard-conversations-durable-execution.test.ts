/** Real evaluation orchestration; Secretary/model/DB boundaries mocked, never network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { readDurable, checkpoint, RESUME_SCOPE, FINAL_CONTINUATION_SCOPE } from "../../../packages/salon-secretary/evaluation/hard-conversations-durable";

const state = vi.hoisted(() => ({ file: "", dbFailsAfterModel: false, snapshotFails: false,
  betweenCases: false, snapshot: { hashes: { services: "unchanged" }, counts: { outbox: 0 },
    technical_audits: 1, technical_audit_hash: "approved", confirmations: 0 },
  cases: [] as { case_id: string; fixture: string; turns: { turn: number; message: string }[];
    expected: { actions: { operation: string }[]; minimum_clarification_fields: string[] } }[] }));
vi.mock("../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-resume", async () => {
  const fs = await import("node:fs");
  const baseline = () => ({ total_audit_logs: state.cases[0]?.case_id === "i12" ? 69 : 72,
    audit_row_sha256: ["approved"],
    operational: state.cases.map(c => ({ case_id: c.case_id, ...state.snapshot })) });
  return {
    get RESUME_JOURNAL() { return state.file; },
    verifyResumePlan: () => ({ binding: "synthetic-frozen", plan: { cases: state.cases } }),
    resumePreflight: async () => ({ identity: "synthetic-local", plan: { cases: state.cases }, baseline: baseline() }),
    captureResumeState: async () => baseline(),
    resumeHealth: async () => {
      if (state.betweenCases && fs.existsSync(state.file) && fs.readFileSync(state.file, "utf8").includes('"kind":"CASE_COMPLETED"'))
        throw Error("PHASE_A_DURABLE_DB_HEALTH");
    },
  };
});
vi.mock("../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-final", () => {
  const baseline = () => ({ total_audit_logs: 72, audit_row_sha256: ["approved"],
    operational: state.cases.map(c => ({ case_id: c.case_id, ...state.snapshot })) });
  return { get FINAL_JOURNAL() { return state.file; },
    verifyFinalPlan: () => ({ binding: "synthetic-final", plan: { cases: state.cases } }),
    finalPreflight: async () => ({ identity: "synthetic-local", plan: { cases: state.cases },
      baseline: baseline(), current: baseline() }),
    assertFinalCaseState: async () => undefined };
});
vi.mock("../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-db", async original => {
  const real = await original<typeof import("../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-db")>();
  return { ...real, precheckPhaseACase: vi.fn(), installPhaseAWriteWitness: vi.fn(),
    snapshotPhaseACase: async () => { if (state.snapshotFails) throw Error("synthetic DB unavailable"); return state.snapshot; } };
});
const model = vi.hoisted(() => ({ getResponse: vi.fn() }));
vi.mock("../../../packages/salon-secretary/src", async original => {
  const real = await original<typeof import("../../../packages/salon-secretary/src")>();
  return { ...real, createPaidModel: async () => model };
});
vi.mock("../salon-secretary", () => ({ SalonSecretary: class {
  constructor(private factory: () => Promise<typeof model>) {}
  async start() { return { sessionId: "synthetic-conversation", skill: "auto", cancelled: false, message: "ready" }; }
  async send() {
    try { await (await this.factory()).getResponse({}); }
    catch { throw Error("MODEL_REQUEST_FAILED"); }
    if (state.dbFailsAfterModel) state.snapshotFails = true;
    return { sessionId: "synthetic-conversation", skill: "auto", cancelled: false, message: "synthetic clarification" };
  }
} }));
import { executePhaseA } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-execution";

let dir: string;
const admin = { auditLog: { findMany: async () => [{ id: "synthetic-router", metadata: {
  router_path: "DIRECT_LUNA", luna_calls: 1, jev_http_calls: 0, usage_luna: [], estimated_cost_usd: { total: null } } }] } } as unknown as PrismaClient;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "phase-a-orchestration-test-")); state.file = join(dir, "events.jsonl");
  state.snapshotFails = false; state.dbFailsAfterModel = false; state.betweenCases = false;
  const source = JSON.parse(readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8"));
  state.cases = source.cases.slice(11, 12);
  for (const [key, value] of Object.entries({ PHASE_A_RESUME_FROM_I12_APPROVED: "true", PHASE_A_REVALIDATE_I12_APPROVED: "true",
    PHASE_A_FINAL_CONTINUATION_APPROVED: "true", SALON_SECRETARY_MODEL: "gpt-6-luna",
    SALON_SECRETARY_ALLOW_PAID_CALLS: "false", SALON_SECRETARY_JEV_ROUTER_ENABLED: "false" })) vi.stubEnv(key, value);
  model.getResponse.mockImplementation(async () => {
    await fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({
      model: "gpt-6-luna", instructions: "synthetic", input: [{ role: "user", content: "synthetic" }],
      tools: [{ type: "function", name: "select_capabilities", parameters: {} }],
      tool_choice: { type: "function", name: "select_capabilities" }, parallel_tool_calls: false,
      max_output_tokens: 1200, store: false, stream: false, include: [] }) });
    return { output: [], responseId: "resp_synthetic", requestId: "req_synthetic",
      rawUsage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); rmSync(dir, { recursive: true, force: true }); });

describe("durable sink integrated with the execution harness", () => {
  it("fsyncs witness before fetch and persists model, observation, turn and case independently", async () => {
    const network = vi.fn(async () => {
      const rows = readDurable(state.file, "synthetic-frozen");
      expect(rows.at(-1)?.kind).toBe("BEFORE_NETWORK");
      return new Response("{}", { status: 200, headers: { "x-request-id": "req_synthetic" } });
    });
    vi.stubGlobal("fetch", network);
    const result = await executePhaseA(admin, {} as PrismaClient, RESUME_SCOPE);
    expect(result.status).toBe("COMPLETED"); expect(network).toHaveBeenCalledTimes(1);
    const rows = readDurable(state.file, "synthetic-frozen");
    expect(rows.map(r => r.kind)).toEqual(expect.arrayContaining(["BEFORE_NETWORK", "AFTER_NETWORK", "MODEL_COMPLETED", "OBSERVATION_COMPLETED", "TURN_COMPLETED", "CASE_COMPLETED"]));
    expect(checkpoint(rows, "i12")).toBe("CASE_COMPLETED");
    expect(result.records[0].capture.safety.INVENTED_FIELD).toBe("UNKNOWN");
    expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");
    expect(globalThis.fetch).toBe(network);
  });

  it("DB failure after model completion retains IDs/usage and stops; never fabricates a PASS", async () => {
    state.dbFailsAfterModel = true;
    const network = vi.fn(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", network);
    const result = await executePhaseA(admin, {} as PrismaClient, RESUME_SCOPE);
    expect(result.status).toBe("STOPPED"); expect(network).toHaveBeenCalledTimes(1);
    const rows = readDurable(state.file, "synthetic-frozen");
    expect(rows.find(r => r.kind === "MODEL_COMPLETED")?.data).toMatchObject({ usage: { response_id: "resp_synthetic", input_tokens: 10 } });
    expect(checkpoint(rows, "i12")).toBe("INCONCLUSIVE");
    expect(rows.some(r => r.kind === "CASE_COMPLETED")).toBe(false);
    expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");
  });

  it("DB failure between cases stops without starting the next case or making its inference", async () => {
    const source = JSON.parse(readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8"));
    state.cases = source.cases.slice(11, 13); state.betweenCases = true;
    const network = vi.fn(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", network);
    const result = await executePhaseA(admin, {} as PrismaClient, RESUME_SCOPE);
    expect(result.stopped).toBe("PHASE_A_DURABLE_DB_HEALTH"); expect(network).toHaveBeenCalledTimes(1);
    const rows = readDurable(state.file, "synthetic-frozen");
    expect(checkpoint(rows, "i12")).toBe("CASE_COMPLETED"); expect(checkpoint(rows, "i14")).toBe("NOT_STARTED");
  });

  it("known transport failure is durably INCONCLUSIVE and advances only to untouched i15", async () => {
    const source = JSON.parse(readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8"));
    state.cases = source.cases.slice(12, 14);
    const network = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "x-request-id": "req_synthetic" } }));
    vi.stubGlobal("fetch", network);
    const result = await executePhaseA(admin, {} as PrismaClient, FINAL_CONTINUATION_SCOPE);
    expect(result.status, JSON.stringify({ stopped: result.stopped,
      kinds: readDurable(state.file, "synthetic-final").map(r => r.kind),
      diagnostic: result.provider_diagnostics.at(-1), recordStop: result.records.at(-1)?.stop_reason,
      capture: result.records.at(-1)?.capture, inconclusive: readDurable(state.file, "synthetic-final").find(r => r.kind === "INCONCLUSIVE")?.data })).toBe("COMPLETED");
    expect(network).toHaveBeenCalledTimes(2);
    const rows = readDurable(state.file, "synthetic-final");
    expect(checkpoint(rows, "i14")).toBe("INCONCLUSIVE");
    expect(rows.find(r => r.kind === "INCONCLUSIVE" && r.case_id === "i14")?.data).toMatchObject({ reason: "NETWORK" });
    expect(checkpoint(rows, "i15")).toBe("CASE_COMPLETED");
    expect(rows.filter(r => r.kind === "BEFORE_NETWORK")).toHaveLength(2);
    expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");
  });

  it("DB failure after transport does not advance to another case", async () => {
    const source = JSON.parse(readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8"));
    state.cases = source.cases.slice(12, 14); state.snapshotFails = false;
    const network = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")); vi.stubGlobal("fetch", network);
    // Failing the technical snapshot is a safety stop, never an isolated NETWORK continuation.
    const original = state.snapshotFails;
    model.getResponse.mockImplementationOnce(async () => {
      try { await fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({
        model: "gpt-6-luna", instructions: "synthetic", input: [{ role: "user", content: "synthetic" }],
        tools: [{ type: "function", name: "select_capabilities", parameters: {} }],
        tool_choice: { type: "function", name: "select_capabilities" }, parallel_tool_calls: false,
        max_output_tokens: 1200, store: false, stream: false, include: [] }) }); }
      finally { state.snapshotFails = true; }
      throw Error("unreachable");
    });
    const result = await executePhaseA(admin, {} as PrismaClient, FINAL_CONTINUATION_SCOPE);
    expect(result.status).toBe("STOPPED"); expect(network).toHaveBeenCalledTimes(1);
    const rows = readDurable(state.file, "synthetic-final");
    expect(checkpoint(rows, "i15")).toBe("NOT_STARTED");
    state.snapshotFails = original;
  });
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
