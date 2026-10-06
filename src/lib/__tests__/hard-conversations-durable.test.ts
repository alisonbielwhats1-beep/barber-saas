import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@prisma/client";
import { DurableJournal, checkpoint, readDurable, resumeCursor, RESUME_IDS, RESUME_SCOPE,
  FINAL_CONTINUATION_IDS, FINAL_CONTINUATION_SCOPE, sanitizeDurable } from
  "../../../packages/salon-secretary/evaluation/hard-conversations-durable";
import { assertFinalHistoricalState, verifyFinalPlan } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-final";
import { makeFixture } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
import { assertResumeState, resumeHealth, verifyResumePlan, type ResumeBaseline } from
  "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-resume";
import { executePhaseA } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-execution";
import { PhaseAWireWitness } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-witness";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual), fsyncSync: vi.fn(actual.fsyncSync) };
});
const dirs: string[] = [];
function file() { const dir = fs.mkdtempSync(join(tmpdir(), "phase-a-durable-test-")); dirs.push(dir); return join(dir, "events.jsonl"); }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function turn(j: DurableJournal, id: string, n = 1) {
  j.append("TURN_STARTED", id, n, { conversation_ref: "synthetic-conversation" });
  j.append("BEFORE_NETWORK", id, n, { model: "gpt-6-luna", store: false, hosted_tools: 0, containers: 0 });
  j.append("AFTER_NETWORK", id, n, { http_status: 200, request_id: "req_synthetic" });
  j.append("MODEL_COMPLETED", id, n, { usage: { input: 10, output: 2 } });
  j.append("OBSERVATION_COMPLETED", id, n, { safety: { INVENTED_FIELD: "UNKNOWN" } });
  j.append("TURN_COMPLETED", id, n, { functional_result: "UNKNOWN" });
}
describe("durable Phase A crash/restart, no network", () => {
  it.each(["STARTED", "BEFORE_NETWORK", "MODEL_COMPLETED", "OBSERVATION_COMPLETED"])(
    "hard exit at %s preserves evidence, marks inconclusive and forbids attempt three", stage => {
      const p = file(), modulePath = resolve("packages/salon-secretary/evaluation/hard-conversations-durable.ts");
      const child = spawnSync(process.execPath, ["-e", `
        const os=require("node:os");try{os.userInfo()}catch{os.userInfo=()=>({username:"offline-evaluation"})};require("tsx/cjs");
        const {DurableJournal}=require(${JSON.stringify(modulePath)});
        const j=new DurableJournal(${JSON.stringify(p)},'frozen');
        j.append('STARTED','i12',null,{turns:1});
        if (${JSON.stringify(stage)}!=='STARTED') {
          j.append('TURN_STARTED','i12',1,{});j.append('BEFORE_NETWORK','i12',1,{store:false});
          if (${JSON.stringify(stage)}!=='BEFORE_NETWORK') j.append('MODEL_COMPLETED','i12',1,{request_id:'req_test'});
          if (${JSON.stringify(stage)}==='OBSERVATION_COMPLETED') j.append('OBSERVATION_COMPLETED','i12',1,{safety:'UNKNOWN'});
        }
        process.exit(99);`], { encoding: "utf8", timeout: 15000 });
      expect(child.status, child.stderr).toBe(99);
      const before = fs.readFileSync(p, "utf8");
      const j = new DurableJournal(p, "frozen");
      expect(fs.readFileSync(p, "utf8").startsWith(before)).toBe(true);
      expect(checkpoint(j.rows, "i12")).toBe("INCONCLUSIVE");
      expect(j.rows.every(row => row.attempt === 2)).toBe(true);
      expect(() => resumeCursor(j.rows)).toThrow("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
      expect(() => j.append("STARTED", "i12", null)).toThrow("REPLAY_FORBIDDEN");
      j.close();
    });

  it("only CASE_COMPLETED advances, preserves unknown verdicts, completed cases cannot repeat", () => {
    const p = file(), j = new DurableJournal(p, "frozen");
    j.append("STARTED", "i12", null, { turns: 1 }); turn(j, "i12");
    expect(() => resumeCursor(j.rows)).toThrow();
    j.append("CASE_COMPLETED", "i12", 1, { baseline: "synthetic" }); j.close();
    const next = new DurableJournal(p, "frozen");
    expect(resumeCursor(next.rows)).toEqual(RESUME_IDS.slice(1));
    expect(next.rows.find(r => r.kind === "TURN_COMPLETED")?.data).toEqual({ functional_result: "UNKNOWN" });
    expect(() => next.append("STARTED", "i12", null)).toThrow("CASE_IMMUTABLE");
    expect(() => next.append("STARTED", "i01", null)).toThrow("CASE_FORBIDDEN");
    expect(() => next.append("STARTED", "i02", null)).toThrow("CASE_FORBIDDEN");
    next.close();
  });

  it("does not advance after DB failure between cases; no next inference", () => {
    const j = new DurableJournal(file(), "frozen");
    j.append("STARTED", "i12", null); turn(j, "i12"); j.append("CASE_COMPLETED", "i12", 1, {});
    j.append("STOPPED", null, null, { reason: "DB_HEALTH" });
    expect(checkpoint(j.rows, "i14")).toBe("NOT_STARTED");
    expect(() => resumeCursor(j.rows)).toThrow("STOP_REQUIRES_REVIEW"); j.close();
  });

  it("does not reconstruct a multi-turn draft after restart or complete t07 after only one turn", () => {
    const p = file(), j = new DurableJournal(p, "frozen");
    for (const id of RESUME_IDS.slice(0, 7)) {
      j.append("STARTED", id, null); turn(j, id); j.append("CASE_COMPLETED", id, 1, {});
    }
    j.append("STARTED", "t07", null, { turns: 2 }); turn(j, "t07");
    expect(() => j.append("CASE_COMPLETED", "t07", 1)).toThrow("TURNS_INCOMPLETE"); j.close();
    const next = new DurableJournal(p, "frozen");
    expect(checkpoint(next.rows, "t07")).toBe("INCONCLUSIVE");
    expect(checkpoint(next.rows, "t08")).toBe("NOT_STARTED");
    expect(() => resumeCursor(next.rows)).toThrow("INCONCLUSIVE_REQUIRES_AUTHORIZATION"); next.close();
  });

  it("DB technical persistence failure cannot erase the already persisted model evidence", () => {
    const p = file(), j = new DurableJournal(p, "frozen");
    j.append("STARTED", "i12", null); j.append("TURN_STARTED", "i12", 1);
    j.append("BEFORE_NETWORK", "i12", 1, { store: false });
    j.append("MODEL_COMPLETED", "i12", 1, { response_id: "resp_synthetic", usage: { input: 12 } });
    j.append("INCONCLUSIVE", "i12", 1, { reason: "DB_TECHNICAL_PERSISTENCE_FAILED" }); j.close();
    const rows = readDurable(p, "frozen");
    expect(rows.find(r => r.kind === "MODEL_COMPLETED")?.data).toEqual({ response_id: "resp_synthetic", usage: { input: 12 } });
    expect(() => resumeCursor(rows)).toThrow();
  });

  it("disk fsync failure forbids sending and subsequent writes", () => {
    const j = new DurableJournal(file(), "frozen"), network = vi.fn();
    j.append("STARTED", "i12", null); j.append("TURN_STARTED", "i12", 1);
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => { throw Error("disk full"); });
    expect(() => { j.append("BEFORE_NETWORK", "i12", 1); network(); }).toThrow("disk full");
    expect(network).not.toHaveBeenCalled();
    expect(() => j.append("AFTER_NETWORK", "i12", 1)).toThrow("WRITE_FAILED"); j.close();
  });

  it("partial/corrupt journal is never repaired; active lock excludes parallel runner", () => {
    const p = file(), j = new DurableJournal(p, "frozen");
    expect(() => new DurableJournal(p, "frozen")).toThrow("LOCK_ACTIVE");
    j.append("STARTED", "i12", null); j.close();
    expect(() => readDurable(p, "different-manifest")).toThrow("HASH_MISMATCH");
    fs.appendFileSync(p, '{"partial":');
    expect(() => readDurable(p, "frozen")).toThrow("TRUNCATED_JOURNAL");
  });

  it("redacts by rejection, never records raw headers, bodies or secrets", () => {
    for (const value of [{ Authorization: "private" }, { api_key: "private" }, { request_body: "private" },
      { raw_provider_response: {} }, { x: "postgresql://private" }, { x: "Bearer private" }, { x: "sk-proj-abcdefghijklmnop" }])
      expect(() => sanitizeDurable(value)).toThrow();
    expect(() => sanitizeDurable({ x: "dedicated-private-key" }, ["dedicated-private-key"])).toThrow();
  });

  it("freezes 15 cases / 17 turns without changing any original expected; keeps historical unknowns", () => {
    const frozen = verifyResumePlan();
    expect(frozen.plan.cases.map(c => c.case_id)).toEqual(RESUME_IDS);
    expect(frozen.plan.cases.reduce((n, c) => n + c.turns.length, 0)).toBe(17);
    expect(frozen.baseline.total_audit_logs).toBe(69);
    expect(frozen.plan.excluded.i02_i11).toContain("UNKNOWN");
    expect(frozen.plan.i12.historical).toBe("INCONCLUSIVE_ATTEMPT_1");
    expect(frozen.plan.max_usd).toBe(.1462);
    const original = JSON.parse(fs.readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8"));
    expect(frozen.plan.cases).toEqual(original.cases.slice(11));
    assertResumeState(frozen.baseline, frozen.baseline);
    for (const mutate of [(b: ResumeBaseline) => b.audit_row_sha256.push("unknown"),
      (b: ResumeBaseline) => b.audit_row_sha256[0] = "changed",
      (b: ResumeBaseline) => b.operational[0].counts.outbox++,
      (b: ResumeBaseline) => b.operational[0].confirmations++,
      (b: ResumeBaseline) => b.operational[0].hashes.services = "changed"]) {
      const changed = structuredClone(frozen.baseline); mutate(changed);
      expect(() => assertResumeState(changed, frozen.baseline)).toThrow("BASELINE_MISMATCH");
    }
  });

  it("requires fresh explicit resume AND i12 authorization before any DB/model activity", async () => {
    vi.stubEnv("PHASE_A_RESUME_FROM_I12_APPROVED", "false");
    await expect(executePhaseA({} as PrismaClient, {} as PrismaClient, RESUME_SCOPE)).rejects.toThrow("RESUME_NOT_APPROVED");
    vi.stubEnv("PHASE_A_RESUME_FROM_I12_APPROVED", "true"); vi.stubEnv("PHASE_A_REVALIDATE_I12_APPROVED", "false");
    await expect(executePhaseA({} as PrismaClient, {} as PrismaClient, RESUME_SCOPE)).rejects.toThrow("RESUME_NOT_APPROVED");
    const witness = new PhaseAWireWitness(RESUME_SCOPE);
    expect(() => witness.expectTurn("i12", 2, "select_capabilities", [])).toThrow("WIRE_RESUME_SCOPE_FORBIDDEN");
    expect(() => witness.expectTurn("i01", 1, "select_capabilities", [])).toThrow("WIRE_RESUME_SCOPE_FORBIDDEN");
    for (let i = 0; i < 17; i++) witness.budget.reserve(0, 1);
    expect(() => witness.budget.reserve(0, 1)).toThrow();
  });

  it("checks flags and runtime identity; DB unavailable or timeout fails before another case", async () => {
    vi.stubEnv("SALON_SECRETARY_MODEL", "gpt-6-luna"); vi.stubEnv("SALON_SECRETARY_JEV_ROUTER_ENABLED", "false");
    vi.stubEnv("SALON_SECRETARY_ALLOW_PAID_CALLS", "false");
    const query = vi.fn().mockResolvedValue([{ db: "everflair_service_mvp", role: "mvp_service_runtime", port: 55441, super: false, bypass: false }]);
    const runtime = { $queryRaw: query } as unknown as PrismaClient;
    await expect(resumeHealth(runtime, false)).resolves.toBeUndefined();
    query.mockRejectedValueOnce(Error("DB connection string must not escape"));
    await expect(resumeHealth(runtime, false)).rejects.toThrow("DB_HEALTH");
    query.mockResolvedValueOnce([{ db: "wrong" }]);
    await expect(resumeHealth(runtime, false)).rejects.toThrow("DB_HEALTH");
    await expect(resumeHealth(runtime, true)).rejects.toThrow("FLAGS");
  });

  it("freezes exactly the fourteen untouched cases and forbids i01–i12 even on CLI misuse", () => {
    const frozen = verifyFinalPlan();
    const source = JSON.parse(fs.readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8"));
    expect(frozen.plan.cases).toEqual(source.cases.slice(12));
    expect(frozen.plan.cases.map(c => c.case_id)).toEqual(FINAL_CONTINUATION_IDS);
    expect(frozen.plan.case_count).toBe(14); expect(frozen.plan.turn_count).toBe(16);
    expect(frozen.plan.max_inferences).toBe(16); expect(frozen.baseline.total_audit_logs).toBe(72);
    const j = new DurableJournal(file(), frozen.binding, [],
      { ids: FINAL_CONTINUATION_IDS, maxRequests: 16, allowNetworkInconclusive: true });
    for (const id of ["i01", "i02", "i11", "i12"])
      expect(() => j.append("STARTED", id, null)).toThrow("CASE_FORBIDDEN");
    j.close();
    const witness = new PhaseAWireWitness(FINAL_CONTINUATION_SCOPE);
    expect(() => witness.expectTurn("i12", 1, "select_capabilities", [])).toThrow("WIRE_FINAL_SCOPE_FORBIDDEN");
    for (let i = 0; i < 16; i++) witness.budget.reserve(0, 1);
    expect(() => witness.budget.reserve(0, 1)).toThrow();
  });

  it("only known NETWORK inconclusive advances to the next independent case without replay", () => {
    const p = file(), config = { ids: FINAL_CONTINUATION_IDS, maxRequests: 16, allowNetworkInconclusive: true };
    const j = new DurableJournal(p, "final-test", [], config);
    j.append("STARTED", "i14", null); j.append("TURN_STARTED", "i14", 1);
    j.append("BEFORE_NETWORK", "i14", 1, { store: false });
    j.append("AFTER_NETWORK", "i14", 1, { transport_failed: true });
    j.append("MODEL_FAILED", "i14", 1, { diagnostic: { category: "NETWORK" } });
    j.append("OBSERVATION_COMPLETED", "i14", 1, { safety: "UNKNOWN" });
    j.append("TURN_COMPLETED", "i14", 1, { functional_result: "UNKNOWN" });
    j.append("INCONCLUSIVE", "i14", 1, { reason: "NETWORK", baseline: { synthetic: true } });
    expect(resumeCursor(j.rows, FINAL_CONTINUATION_IDS, true)).toEqual(FINAL_CONTINUATION_IDS.slice(1));
    expect(() => j.append("STARTED", "i14", null)).toThrow("REPLAY_FORBIDDEN");
    j.close();
    const restarted = new DurableJournal(p, "final-test", [], config);
    expect(resumeCursor(restarted.rows, FINAL_CONTINUATION_IDS, true)[0]).toBe("i15");
    restarted.append("STARTED", "i15", null); restarted.close();
  });

  it("unknown inconclusive, safety stop and any missing baseline remain fail-closed", () => {
    for (const reason of ["DB_HEALTH", "UNSAFE_PROPOSAL", "UNKNOWN_CONTRACT_DRIFT"]) {
      const j = new DurableJournal(file(), "final-test", [],
        { ids: FINAL_CONTINUATION_IDS, maxRequests: 16, allowNetworkInconclusive: true });
      j.append("STARTED", "i14", null); j.append("INCONCLUSIVE", "i14", null, { reason });
      expect(() => resumeCursor(j.rows, FINAL_CONTINUATION_IDS, true)).toThrow("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
      expect(() => j.append("STARTED", "i15", null)).toThrow("CURSOR_ORDER"); j.close();
    }
  });

  it("checks the exact three i12 technical rows even when later approved cases have appended logs", async () => {
    const frozen = verifyFinalPlan(), i12 = makeFixture("i12", "free");
    const tail = ["MODEL_CALL_STARTED", "MODEL_CALL_FINISHED", "DIRECT_LUNA"].map(action =>
      ({ action, salonId: i12.tenant, userId: i12.actor, metadata: { status: "FAILED" } }));
    const rows = [...Array.from({ length: 69 }, () => ({})), ...tail, { action: "LATER_TECHNICAL_LOG" }];
    const admin = { auditLog: { findMany: async () => rows } } as unknown as PrismaClient;
    await expect(assertFinalHistoricalState(admin, frozen.baseline)).resolves.toBeUndefined();
    rows[70] = { ...tail[1], action: "ALTERED" };
    await expect(assertFinalHistoricalState(admin, frozen.baseline)).rejects.toThrow("I12_TECHNICAL_AUDIT");
  });
});
