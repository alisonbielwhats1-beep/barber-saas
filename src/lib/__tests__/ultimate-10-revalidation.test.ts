import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { DurableJournal, readDurable } from "../../../packages/salon-secretary/evaluation/hard-conversations-durable";
import { revalidateUltimate10U01 } from "../../../packages/salon-secretary/evaluation/ultimate-10-execution";
import { assertUltimate10RevalidationJournalEmpty, assertUltimate10RevalidationRequest,
  assertUltimate10U01History, ultimate10RevalidationScope, ultimate10Scope,
  ULTIMATE10_U01_HISTORY_REQUEST_ID, ULTIMATE10_U01_HISTORY_SHA256 } from
  "../../../packages/salon-secretary/evaluation/ultimate-10-harness";
import { ULTIMATE10_SHA256 } from "../../../packages/salon-secretary/evaluation/ultimate-10";
import { ultimate10CliExitCode } from "../../../packages/salon-secretary/evaluation/ultimate-10-post-http";

const directories: string[] = [];
function files() {
  const dir = mkdtempSync(join(tmpdir(), "ultimate-u01-revalidation-"));
  directories.push(dir);
  return { history: join(dir, "history.jsonl"), revalidation: join(dir, "revalidation.jsonl") };
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function approvedShape(file: string) {
  const journal = new DurableJournal(file, ULTIMATE10_SHA256, [], ultimate10Scope());
  journal.append("STARTED", "u01", null, { turns: 1, capability: "DESIGN_TARGET" });
  journal.append("TURN_STARTED", "u01", 1);
  journal.append("BEFORE_NETWORK", "u01", 1, { model: "gpt-6-luna", store: false });
  journal.append("AFTER_NETWORK", "u01", 1, { http_status: 200,
    request_id: ULTIMATE10_U01_HISTORY_REQUEST_ID });
  journal.append("MODEL_FAILED", "u01", 1, { category: "UNKNOWN_PROVIDER_ERROR" });
  journal.append("OBSERVATION_EVENT", "u01", 1, { safe_failure: true });
  journal.append("OBSERVATION_COMPLETED", "u01", 1, { safety: "UNKNOWN" });
  journal.append("TURN_COMPLETED", "u01", 1, { functional_result: "UNKNOWN" });
  journal.append("INCONCLUSIVE", "u01", 1, { reason: "PROVIDER_ERROR_OR_TIMEOUT" });
  journal.append("STOPPED", null, null, { reason: "PROVIDER_ERROR_OR_TIMEOUT" });
  journal.close();
  const bytes = readFileSync(file);
  return { bytes, hash: createHash("sha256").update(bytes).digest("hex"),
    rows: readDurable(file, ULTIMATE10_SHA256) };
}

describe("Ultimate 10 exclusive u01 revalidation, offline", () => {
  it("accepts only the exact historical shape; production pins its byte hash", () => {
    const { history } = files(), approved = approvedShape(history);
    expect(() => assertUltimate10U01History(approved.rows, approved.hash, approved.hash)).not.toThrow();
    expect(ULTIMATE10_U01_HISTORY_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => assertUltimate10U01History(approved.rows, approved.hash)).toThrow("U01_HISTORY_HASH");
    expect(() => assertUltimate10U01History([], approved.hash, approved.hash)).toThrow("U01_HISTORY_SHAPE");
  });

  it("rejects changed history, a foreign case and a completed u01", () => {
    const { history } = files(), approved = approvedShape(history);
    expect(() => assertUltimate10U01History(approved.rows, "0".repeat(64), approved.hash)).toThrow("U01_HISTORY_HASH");
    const otherCase = structuredClone(approved.rows);
    otherCase[2].case_id = "u02";
    expect(() => assertUltimate10U01History(otherCase, approved.hash, approved.hash)).toThrow("U01_HISTORY_SHAPE");
    const completed = structuredClone(approved.rows);
    completed[8].kind = "CASE_COMPLETED";
    expect(() => assertUltimate10U01History(completed, approved.hash, approved.hash)).toThrow("U01_HISTORY_SHAPE");
    const wrongRequest = structuredClone(approved.rows);
    (wrongRequest[3].data as { request_id: string }).request_id = "req_other";
    expect(() => assertUltimate10U01History(wrongRequest, approved.hash, approved.hash)).toThrow("U01_HISTORY_SHAPE");
  });

  it("never accepts empty history by treating it as an initial run", () => {
    const { history, revalidation } = files();
    expect(readDurable(history, ULTIMATE10_SHA256)).toEqual([]);
    expect(() => assertUltimate10U01History([], "0".repeat(64), "0".repeat(64))).toThrow("U01_HISTORY_SHAPE");
    expect(() => assertUltimate10RevalidationJournalEmpty(revalidation)).not.toThrow();
  });

  it("allows one new journal only; preserves the historical bytes and rejects a second attempt", () => {
    const { history, revalidation } = files(), approved = approvedShape(history);
    const scope = ultimate10RevalidationScope();
    expect(scope).toMatchObject({ ids: ["u01"], maxRequests: 1, turnCounts: { u01: 1 } });
    const journal = new DurableJournal(revalidation, ULTIMATE10_SHA256, [], scope);
    journal.append("STARTED", "u01", null, { attempt: "REVALIDATION_U01" });
    expect(() => journal.append("STARTED", "u02", null)).toThrow("CASE_FORBIDDEN");
    expect(() => journal.append("TURN_STARTED", "u01", 2)).toThrow("TURN_FORBIDDEN");
    journal.append("TURN_STARTED", "u01", 1);
    journal.append("BEFORE_NETWORK", "u01", 1, { store: false });
    expect(() => journal.append("BEFORE_NETWORK", "u01", 1)).toThrow("RETRY_FORBIDDEN");
    journal.append("OBSERVATION_EVENT", "u01", 1, { stage: "HTTP_RESPONSE_RECEIVED" });
    journal.append("INCONCLUSIVE", "u01", 1, { reason: "UNKNOWN_POST_HTTP_ERROR" });
    journal.append("STOPPED", null, null, { reason: "UNKNOWN_POST_HTTP_ERROR" });
    journal.close();
    expect(readFileSync(history)).toEqual(approved.bytes);
    expect(readDurable(revalidation, ULTIMATE10_SHA256).map(row => row.kind)).toContain("OBSERVATION_EVENT");
    expect(() => assertUltimate10RevalidationJournalEmpty(revalidation))
      .toThrow("U01_REVALIDATION_ALREADY_ATTEMPTED");
  });

  it("blocks u02–u10 and a second request before any network", () => {
    expect(() => assertUltimate10RevalidationRequest("u01", 1, 0, 0)).not.toThrow();
    for (let n = 2; n <= 10; n++)
      expect(() => assertUltimate10RevalidationRequest(`u${String(n).padStart(2, "0")}`, 1, 0, 0))
        .toThrow("U01_REVALIDATION_SCOPE");
    expect(() => assertUltimate10RevalidationRequest("u01", 2, 0, 0)).toThrow("U01_REVALIDATION_SCOPE");
    expect(() => assertUltimate10RevalidationRequest("u01", 1, 1, 0)).toThrow("U01_REVALIDATION_REQUEST_LIMIT");
    expect(() => assertUltimate10RevalidationRequest("u01", 1, 0, 1)).toThrow("U01_REVALIDATION_REQUEST_LIMIT");
  });

  it("requires a distinct fresh approval and keeps STOPPED/preflight failures nonzero", async () => {
    vi.stubEnv("ULTIMATE10_REAL_EXECUTION_APPROVED", "true");
    vi.stubEnv("ULTIMATE10_REVALIDATE_U01_APPROVED", "false");
    await expect(revalidateUltimate10U01({} as PrismaClient, {} as PrismaClient)).rejects.toThrow("NOT_AUTHORIZED");
    expect(ultimate10CliExitCode("COMPLETED")).toBe(0);
    expect(ultimate10CliExitCode("STOPPED")).not.toBe(0);
  });
});
