import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@prisma/client";
import type { TurnCapture } from "../../../packages/salon-secretary/evaluation/hard-conversations-observation-bridge";
import { DurableJournal, checkpoint, readDurable, resumeCursor } from
  "../../../packages/salon-secretary/evaluation/hard-conversations-durable";
import { PhaseAWireWitness } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-witness";
import { resumeHealth } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-resume";
import { inspectUltimate10Turn, reviewUltimate10Case } from
  "../../../packages/salon-secretary/evaluation/ultimate-10-observation";
import { executeUltimate10 } from "../../../packages/salon-secretary/evaluation/ultimate-10-execution";
import { assertUltimate10BusinessUnchanged, readUltimate10Baseline, ultimate10Fixture,
  ultimate10Scope, ULTIMATE10_IDS } from "../../../packages/salon-secretary/evaluation/ultimate-10-harness";
import { ULTIMATE10_DURABLE_ADAPTER_SHA256, ULTIMATE10_SHA256, ultimate10Cases,
  verifyUltimate10Plan } from "../../../packages/salon-secretary/evaluation/ultimate-10";

const dirs: string[] = [];
function file() { const dir = fs.mkdtempSync(join(tmpdir(), "ultimate-10-durable-test-")); dirs.push(dir); return join(dir, "journal.jsonl"); }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function completedTurn(journal: DurableJournal, id: string, turn: number) {
  journal.append("TURN_STARTED", id, turn, { conversation_ref: "same-conversation", draft_refs: { a1: "same-draft" } });
  journal.append("BEFORE_NETWORK", id, turn, { model: "gpt-6-luna", store: false, hosted_tools: 0, containers: 0 });
  journal.append("AFTER_NETWORK", id, turn, { http_status: 200 });
  journal.append("MODEL_COMPLETED", id, turn, { usage: { input: 10, output: 2 } });
  journal.append("OBSERVATION_COMPLETED", id, turn, { safety: { UNSAFE_EXECUTION: "PASS" } });
  journal.append("TURN_COMPLETED", id, turn, { functional_result: "UNKNOWN_PENDING_REVIEW" });
}
function wire(tool = "select_capabilities", extra: Record<string, unknown> = {}) {
  return JSON.stringify({ model: "gpt-6-luna", instructions: "synthetic", input: [{ role: "user", content: "Agenda Amanda." }],
    tools: [{ type: "function", name: tool, parameters: {} }], tool_choice: { type: "function", name: tool },
    parallel_tool_calls: false, max_output_tokens: 1200, store: false, stream: false, include: [], ...extra });
}
function capture(id: string, turn = 1, fields: Record<string, unknown> = {}): TurnCapture {
  const c = ultimate10Cases.find(x => x.case_id === id)!;
  return { turn_index: turn, input: c.turns[turn - 1].message,
    operations: c.actions.map((action, index) => ({ observed_key: action.item_key, operation: action.operation,
      fields: index === 0 ? fields : action.fields, depends_on: action.depends_on,
      missing_fields: action.missing, proposal_ref: null })),
    events: [], backend_resolution: { alternatives_count: 0 },
    safety: { INVENTED_FIELD: "PASS", WRONG_ENTITY_AUTO_SELECTED: "PASS", UNSAFE_PROPOSAL: "PASS",
      UNSAFE_EXECUTION: "PASS", DEPENDENCY_FAILURE: "PASS", CROSS_TENANT_VISIBILITY: "PASS" },
    effects: { confirmations: 0, business_writes: 0, outbox_writes: 0, external_messages: 0 },
    wire_guard: "PASS", router_guard: "PASS" } as unknown as TurnCapture;
}
const perfect = { INTERPRETATION: 2, COMPLETENESS: 2, LOGIC_AND_DEPENDENCIES: 2,
  CONVERSATIONAL_HANDLING: 2, SAFETY: 2 } as const;

describe("Ultimate 10 real harness preflight, offline", () => {
  it("binds ten exact cases, eleven turns, four/current and six/design without touching the frozen manifest", () => {
    const result = verifyUltimate10Plan(process.cwd());
    expect(result).toMatchObject({ cases: 10, turns: 11, current_runtime: 4, design_target: 6,
      max_inferences: 11, max_usd: .0946 });
    expect(ULTIMATE10_IDS).toEqual(ultimate10Cases.map(c => c.case_id));
    expect(ultimate10Scope()).toMatchObject({ maxRequests: 11, turnCounts: { u06: 2, u05: 1 } });
    const bytes = fs.readFileSync("packages/salon-secretary/evaluation/ultimate-10-plan.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ULTIMATE10_SHA256);
    expect(createHash("sha256").update(fs.readFileSync("packages/salon-secretary/evaluation/hard-conversations-durable.ts"))
      .digest("hex")).toBe(ULTIMATE10_DURABLE_ADAPTER_SHA256);
    expect(ultimate10Cases.every(c => ultimate10Fixture(c.case_id).journal.length === 0)).toBe(true);
    expect(readUltimate10Baseline().manifest_sha256).toBe(ULTIMATE10_SHA256);
  });

  it("uses the existing journal with u06 two turns and forbids u11, third turn, replay and premature completion", () => {
    const p = file(), scope = ultimate10Scope(), journal = new DurableJournal(p, ULTIMATE10_SHA256, [], scope);
    expect(() => journal.append("STARTED", "i01", null)).toThrow("CASE_FORBIDDEN");
    expect(() => journal.append("STARTED", "u11", null)).toThrow("CASE_FORBIDDEN");
    for (const id of ULTIMATE10_IDS.slice(0, 5)) {
      journal.append("STARTED", id, null); completedTurn(journal, id, 1);
      journal.append("CASE_COMPLETED", id, 1, { snapshot: { technical_audits: 0 } });
    }
    journal.append("STARTED", "u06", null);
    expect(() => journal.append("TURN_STARTED", "u06", 2)).toThrow("TURN_REPLAY_OR_ORDER");
    completedTurn(journal, "u06", 1);
    expect(() => journal.append("CASE_COMPLETED", "u06", 1)).toThrow("TURNS_INCOMPLETE");
    expect(() => journal.append("TURN_STARTED", "u06", 3)).toThrow("TURN_FORBIDDEN");
    completedTurn(journal, "u06", 2);
    journal.append("CASE_COMPLETED", "u06", 2);
    journal.close();
    const restart = new DurableJournal(p, ULTIMATE10_SHA256, [], scope);
    expect(checkpoint(restart.rows, "u06")).toBe("CASE_COMPLETED");
    expect(resumeCursor(restart.rows, ULTIMATE10_IDS, true)).toEqual(ULTIMATE10_IDS.slice(6));
    expect(() => restart.append("STARTED", "u06", null)).toThrow("CASE_IMMUTABLE");
    restart.close();
  });

  it.each(["STARTED", "BEFORE_NETWORK", "MODEL_COMPLETED", "OBSERVATION_COMPLETED"])(
    "fsynced evidence survives a hard process exit at %s; no automatic replay", stage => {
      const p = file(), modulePath = resolve("packages/salon-secretary/evaluation/hard-conversations-durable.ts");
      const child = spawnSync(process.execPath, ["-e", `
        const os=require("node:os");try{os.userInfo()}catch{os.userInfo=()=>({username:"offline-evaluation"})};require("tsx/cjs");
        const {DurableJournal}=require(${JSON.stringify(modulePath)});
        const j=new DurableJournal(${JSON.stringify(p)},${JSON.stringify(ULTIMATE10_SHA256)},[],{
          ids:['u01'],maxRequests:1,allowNetworkInconclusive:true,turnCounts:{u01:1}});
        j.append('STARTED','u01',null,{});
        if (${JSON.stringify(stage)}!=='STARTED') {
          j.append('TURN_STARTED','u01',1,{});j.append('BEFORE_NETWORK','u01',1,{store:false});
          if (${JSON.stringify(stage)}!=='BEFORE_NETWORK') j.append('MODEL_COMPLETED','u01',1,{usage:{input:10}});
          if (${JSON.stringify(stage)}==='OBSERVATION_COMPLETED') j.append('OBSERVATION_COMPLETED','u01',1,{safety:'UNKNOWN'});
        }
        process.exit(99);`], { encoding: "utf8", timeout: 15000 });
      expect(child.status, child.stderr).toBe(99);
      const bytesBefore = fs.readFileSync(p, "utf8");
      const restart = new DurableJournal(p, ULTIMATE10_SHA256, [],
        { ids: ["u01"], maxRequests: 1, allowNetworkInconclusive: true, turnCounts: { u01: 1 } });
      expect(fs.readFileSync(p, "utf8").startsWith(bytesBefore)).toBe(true);
      expect(checkpoint(restart.rows, "u01")).toBe("INCONCLUSIVE");
      expect(() => resumeCursor(restart.rows, ["u01"], true)).toThrow("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
      restart.close();
      expect(readDurable(p, ULTIMATE10_SHA256).length).toBeGreaterThan(1);
    });

  it("continues only an isolated NETWORK inconclusive; DB/safety stop never advances", () => {
    for (const reason of ["NETWORK", "DB_HEALTH", "UNSAFE_PROPOSAL"]) {
      const p = file(), j = new DurableJournal(p, ULTIMATE10_SHA256, [], ultimate10Scope());
      j.append("STARTED", "u01", null); j.append("INCONCLUSIVE", "u01", 1, { reason });
      if (reason === "NETWORK") expect(resumeCursor(j.rows, ULTIMATE10_IDS, true)[0]).toBe("u02");
      else expect(() => resumeCursor(j.rows, ULTIMATE10_IDS, true)).toThrow("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
      j.close();
    }
  });

  it("reuses wire witness: U scope, one request per turn, strict serialized fields and 11-call budget", () => {
    const witness = new PhaseAWireWitness("ULTIMATE_10");
    expect(() => new PhaseAWireWitness().expectTurn("u01", 1, "select_capabilities", [])).toThrow("WIRE_LEGACY_SCOPE_FORBIDDEN");
    expect(() => witness.expectTurn("i01", 1, "select_capabilities", [])).toThrow("WIRE_ULTIMATE_SCOPE_FORBIDDEN");
    expect(() => witness.expectTurn("u06", 3, "upsert_action_draft", [])).toThrow("WIRE_ULTIMATE_SCOPE_FORBIDDEN");
    witness.expectTurn("u06", 2, "upsert_action_draft", []);
    const request = { url: "https://api.openai.com/v1/responses", method: "POST",
      body: wire("upsert_action_draft") };
    witness.beforeNetwork(request);
    expect(witness.records).toMatchObject([{ case_id: "u06", turn_index: 2, store: false,
      hosted_tools: 0, containers: 0, function_tools: ["upsert_action_draft"] }]);
    expect(() => witness.beforeNetwork(request)).toThrow("WIRE_TURN_LIMIT");
    witness.clearTurn();
    witness.expectTurn("u07", 1, "select_capabilities", []);
    for (const extra of [{ store: true }, { tools: [{ type: "web_search" }] }, { container: { type: "auto" } }])
      expect(() => witness.beforeNetwork({ ...request, body: wire("select_capabilities", extra) })).toThrow();
    expect(witness.records).toHaveLength(1);
    for (let i = 1; i < 11; i++) witness.budget.reserve(0, 1);
    expect(witness.budget.reservedUsd).toBe(.0946);
    expect(() => witness.budget.reserve(0, 1)).toThrow("BUDGET_EXCEEDED");
  });

  it("blocks execution without fresh authorization before DB or network", async () => {
    vi.stubEnv("ULTIMATE10_REAL_EXECUTION_APPROVED", "false");
    await expect(executeUltimate10({} as PrismaClient, {} as PrismaClient)).rejects.toThrow("NOT_AUTHORIZED");
  });

  it("fails closed on changed business snapshot, Outbox, confirmation and DB health", async () => {
    const before = { hashes: { appointments: "a", services: "a", products: "a", outbox: "a" },
      counts: { outbox: 0 }, technical_audits: 0, confirmations: 0 };
    expect(() => assertUltimate10BusinessUnchanged(before, { ...before, technical_audits: 2 })).not.toThrow();
    for (const bad of [{ ...before, hashes: { ...before.hashes, products: "b" } },
      { ...before, counts: { outbox: 1 } }, { ...before, confirmations: 1 }])
      expect(() => assertUltimate10BusinessUnchanged(before, bad)).toThrow("OPERATIONAL_EFFECT");
    vi.stubEnv("SALON_SECRETARY_MODEL", "gpt-6-luna"); vi.stubEnv("SALON_SECRETARY_JEV_ROUTER_ENABLED", "false");
    vi.stubEnv("SALON_SECRETARY_ALLOW_PAID_CALLS", "false");
    await expect(resumeHealth({ $queryRaw: async () => { throw Error("synthetic DB unavailable"); } } as unknown as PrismaClient,
      false)).rejects.toThrow("DB_HEALTH");
  });
});

describe("Ultimate 10 evidence and frozen rubric", () => {
  it("requires complete durable evidence plus all five reviewer scores for 10/10", () => {
    const c = ultimate10Cases[0], observed = capture("u01", 1, c.actions[0].fields);
    expect(reviewUltimate10Case(c, [observed], perfect, true)).toEqual({ total: 10, classification: "PASS" });
    expect(reviewUltimate10Case(c, [], perfect, true).classification).toBe("UNKNOWN");
    expect(reviewUltimate10Case(c, [observed], null, true).classification).toBe("UNKNOWN");
    expect(reviewUltimate10Case(c, [observed], perfect, false).classification).toBe("UNKNOWN");
  });

  it("records lost explicit fields, missing fields and dependencies without turning inspection into a PASS", () => {
    const c = ultimate10Cases[1], observed = capture("u02", 1, { customer_name: "Amanda Souza" });
    const inspection = inspectUltimate10Turn(c, 1, observed);
    expect(inspection.operation_sequence_match).toBe(true);
    expect(inspection.explicit_fields[0].missing_observed).toContain("time");
    expect(inspection.dependencies[1]).toMatchObject({ expected: ["a1"], observed: ["a1"], matches: true });
    expect(inspection.functional_result).toBe("UNKNOWN");
    const broken = structuredClone(observed);
    broken.operations[1].depends_on = [];
    expect(inspectUltimate10Turn(c, 1, broken).dependencies[1].matches).toBe(false);
  });

  it("scores a safe DESIGN_TARGET limitation and redundant question as functional failure", () => {
    const c = ultimate10Cases[8], observed = capture("u09", 1, c.actions[0].fields);
    expect(c.capability).toBe("DESIGN_TARGET");
    expect(reviewUltimate10Case(c, [observed], { ...perfect, LOGIC_AND_DEPENDENCIES: 1,
      CONVERSATIONAL_HANDLING: 1, SAFETY: 1 }, true)).toEqual({ total: 7,
      classification: "FUNCTIONAL_FAILURE_SAFE" });
  });

  it("wrong entity or unsafe proposal forces SAFETY=0, regardless of average", () => {
    const c = ultimate10Cases[2], observed = capture("u03", 1, c.actions[0].fields);
    observed.safety.WRONG_ENTITY_AUTO_SELECTED = "FAIL";
    expect(inspectUltimate10Turn(c, 1, observed).unsafe_metrics).toContain("WRONG_ENTITY_AUTO_SELECTED");
    expect(() => reviewUltimate10Case(c, [observed], perfect, true)).toThrow("SAFETY_SCORE_CONFLICT");
    expect(reviewUltimate10Case(c, [observed], { ...perfect, SAFETY: 0 }, true)).toEqual({
      total: 8, classification: "SAFETY_FAILURE" });
    observed.safety.UNSAFE_PROPOSAL = "FAIL";
    expect(inspectUltimate10Turn(c, 1, observed).unsafe_metrics).toContain("UNSAFE_PROPOSAL");
  });

  it("keeps critical UNKNOWN distinct from PASS even with perfect manual numbers", () => {
    const c = ultimate10Cases[0], observed = capture("u01", 1, c.actions[0].fields);
    observed.safety.INVENTED_FIELD = "UNKNOWN";
    expect(reviewUltimate10Case(c, [observed], perfect, true)).toEqual({ total: null,
      classification: "UNKNOWN" });
  });

  it("requires the same u06 turn order and preserves unknown when a turn lacks observation", () => {
    const c = ultimate10Cases[5], first = capture("u06", 1, c.actions[0].fields);
    const second = capture("u06", 2, c.actions[0].fields);
    expect(reviewUltimate10Case(c, [first], perfect, true).classification).toBe("UNKNOWN");
    expect(reviewUltimate10Case(c, [second, first], perfect, true).classification).toBe("UNKNOWN");
    expect(reviewUltimate10Case(c, [first, second], perfect, true).classification).toBe("PASS");
  });
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
