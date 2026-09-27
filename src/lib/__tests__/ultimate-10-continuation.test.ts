import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { DurableJournal, checkpoint, readDurable, resumeCursor } from
  "../../../packages/salon-secretary/evaluation/hard-conversations-durable";
import { continueUltimate10U02U10 } from
  "../../../packages/salon-secretary/evaluation/ultimate-10-execution";
import { ULTIMATE10_CONTINUATION_IDS, ULTIMATE10_CONTINUATION_SHA256,
  ultimate10ContinuationScope, verifyUltimate10ContinuationPlan,
  readUltimate10U01RevalidationHistory } from
  "../../../packages/salon-secretary/evaluation/ultimate-10-harness";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function journal() {
  const dir = mkdtempSync(join(tmpdir(), "ultimate10-continuation-"));
  dirs.push(dir);
  return { file: join(dir, "journal.jsonl"), history: join(dir, "u01.jsonl") };
}

describe("Ultimate 10 u02–u10 continuation, offline", () => {
  it("binds all ten frozen turns to the original manifest and excludes u01", () => {
    const plan = verifyUltimate10ContinuationPlan();
    expect(plan.source_manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.cases.map(c => c.case_id)).toEqual(ULTIMATE10_CONTINUATION_IDS);
    expect(plan.cases.flatMap(c => c.turns)).toHaveLength(10);
    expect(plan.cases.some(c => c.case_id === "u01")).toBe(false);
    expect(ultimate10ContinuationScope()).toMatchObject({ maxRequests: 10, allowNetworkInconclusive: true });
  });

  it("requires both concluded u01 histories without rewriting either", () => {
    const historical = readFileSync("packages/salon-secretary/evaluation/results/ultimate-10.jsonl");
    const revalidation = readFileSync("packages/salon-secretary/evaluation/results/ultimate-10-revalidation-u01.jsonl");
    const snapshot = readUltimate10U01RevalidationHistory();
    expect(snapshot.technical_audits).toBe(6);
    expect(readFileSync("packages/salon-secretary/evaluation/results/ultimate-10.jsonl")).toEqual(historical);
    expect(readFileSync("packages/salon-secretary/evaluation/results/ultimate-10-revalidation-u01.jsonl"))
      .toEqual(revalidation);
  });

  it("blocks u01 and an eleventh request before network", () => {
    const { file } = journal();
    const durable = new DurableJournal(file, ULTIMATE10_CONTINUATION_SHA256, [], ultimate10ContinuationScope());
    expect(() => durable.append("STARTED", "u01", null)).toThrow("CASE_FORBIDDEN");
    for (const id of ULTIMATE10_CONTINUATION_IDS) {
      durable.append("STARTED", id, null);
      const count = id === "u06" ? 2 : 1;
      for (let turn = 1; turn <= count; turn++) {
        durable.append("TURN_STARTED", id, turn);
        durable.append("BEFORE_NETWORK", id, turn);
        durable.append("MODEL_COMPLETED", id, turn);
        durable.append("OBSERVATION_COMPLETED", id, turn);
        durable.append("TURN_COMPLETED", id, turn);
      }
      durable.append("CASE_COMPLETED", id, null);
    }
    expect(durable.rows.filter(row => row.kind === "BEFORE_NETWORK")).toHaveLength(10);
    expect(() => durable.append("BEFORE_NETWORK", "u10", 1)).toThrow();
    durable.close();
    const rows = readDurable(file, ULTIMATE10_CONTINUATION_SHA256);
    expect(resumeCursor(rows, ULTIMATE10_CONTINUATION_IDS, true)).toEqual([]);
    expect(checkpoint(rows, "u01")).toBe("NOT_STARTED");
  });

  it("can advance only an explicitly scoped known fail-closed inconclusive", () => {
    const { file } = journal();
    const scope = ultimate10ContinuationScope();
    const durable = new DurableJournal(file, ULTIMATE10_CONTINUATION_SHA256, [], scope);
    durable.append("STARTED", "u02", null);
    durable.append("TURN_STARTED", "u02", 1);
    durable.append("BEFORE_NETWORK", "u02", 1);
    durable.append("OBSERVATION_COMPLETED", "u02", 1);
    durable.append("TURN_COMPLETED", "u02", 1);
    durable.append("INCONCLUSIVE", "u02", 1, { reason: "KNOWN_FAIL_CLOSED_POST_HTTP" });
    expect(() => durable.append("STARTED", "u03", null)).not.toThrow();
    durable.close();
    const rows = readDurable(file, ULTIMATE10_CONTINUATION_SHA256);
    expect(() => resumeCursor(rows, ULTIMATE10_CONTINUATION_IDS, true)).toThrow();
    // u03 is intentionally incomplete; the special reason permits u02 only.
    expect(() => resumeCursor(rows, ULTIMATE10_CONTINUATION_IDS, true,
      scope.allowedInconclusiveReasons)).toThrow("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
  });

  it("needs distinct process-scoped approval before any database or network use", async () => {
    vi.stubEnv("ULTIMATE10_REAL_EXECUTION_APPROVED", "true");
    vi.stubEnv("ULTIMATE10_CONTINUATION_U02_U10_APPROVED", "false");
    await expect(continueUltimate10U02U10({} as PrismaClient, {} as PrismaClient))
      .rejects.toThrow("NOT_AUTHORIZED");
  });
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
