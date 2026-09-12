import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
import { reserveLocalOrchestratorAttempt as reserve } from "./orchestrator-local-quota";
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "hq-quota-test-")); });
afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });
it("retains the project cap across actors and calls, and expires after 24h", async () => {
  vi.useFakeTimers();
  expect(await reserve("project", "one", 2, directory)).toBe("reserved");
  expect(await reserve("project", "one", 2, directory)).toBe("minute");
  expect(await reserve("project", "two", 2, directory)).toBe("reserved");
  expect(await reserve("project", "three", 2, directory)).toBe("daily");
  vi.advanceTimersByTime(86400001); expect(await reserve("project", "one", 2, directory)).toBe("reserved");
});
it("does not exceed the cap with simultaneous local callers", async () => {
  const results = await Promise.all([reserve("project", "one", 1, directory), reserve("project", "two", 1, directory)]);
  expect(results.filter(result => result === "reserved")).toHaveLength(1);
});
it("stores only hashed identifiers and fails closed on corrupted state", async () => {
  await reserve("project", "private_admin", 10, directory);
  const file = path.join(directory, (await readdir(directory)).find(name => name.endsWith(".json"))!);
  expect(await readFile(file, "utf8")).not.toContain("private_admin");
  await writeFile(file, "broken"); expect(await reserve("project", "two", 10, directory)).toBe("unavailable");
});
