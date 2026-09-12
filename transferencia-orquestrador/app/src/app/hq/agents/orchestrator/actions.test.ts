import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ access: vi.fn(), limit: vi.fn(), run: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hq/access", () => ({ withHq: f.access }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: f.limit }));
vi.mock("@everflare/agents/orchestrator", async importOriginal => ({
  ...await importOriginal<object>(), runOrchestrator: f.run,
}));
import { testOrchestrator } from "./actions";
import { orchestratorConfig } from "@/lib/hq/orchestrator-config";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("HQ_ORCHESTRATOR_ENABLED", "true"); vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("OPENAI_API_KEY", "synthetic-secret");
  f.access.mockImplementation(async callback => callback({}, "admin_test"));
  f.limit.mockResolvedValue({ allowed: true, source: "local" });
  f.run.mockResolvedValue({ ok: true, steps: [], answer: "Final" });
});
afterEach(() => vi.unstubAllEnvs());
it("preserves authorization denial before config, limits or API", async () => {
  f.access.mockRejectedValue(new Error("redirect-login"));
  await expect(testOrchestrator("test")).rejects.toThrow("redirect-login");
  expect(f.limit).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
});
it("runs outside the authorization transaction with server-owned IDs", async () => {
  let inTransaction = false;
  f.access.mockImplementation(async callback => {
    inTransaction = true; const result = await callback({}, "admin_test"); inTransaction = false; return result;
  });
  f.run.mockImplementation(async () => { expect(inTransaction).toBe(false); return { ok: true, steps: [] }; });
  expect((await testOrchestrator(" teste ")).ok).toBe(true);
  expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ message: "teste", apiKey: "synthetic-secret" }));
  expect(f.limit).toHaveBeenCalledWith(expect.objectContaining({ identifier: "admin_test", limit: 1 }));
});
it.each([null, {}, " ", "x".repeat(2001)])("rejects invalid server action input", async message => {
  expect((await testOrchestrator(message)).ok).toBe(false); expect(f.run).not.toHaveBeenCalled();
});
it.each([["HQ_ORCHESTRATOR_ENABLED", "false"], ["OPENAI_API_KEY", ""], ["APP_ENV", "production"],
  ["VERCEL_ENV", "production"], ["HQ_PRODUCT_AGENT_ID", "asst_wrong"]])("blocks invalid configuration %s", async (key, value) => {
  vi.stubEnv(key, value);
  expect((await testOrchestrator("teste")).ok).toBe(false); expect(f.run).not.toHaveBeenCalled();
});
it("blocks consumption if the limiter is unavailable or exhausted", async () => {
  f.limit.mockResolvedValue({ allowed: false, source: "unavailable", retryAfterSeconds: 30 });
  expect((await testOrchestrator("teste")).error).toContain("indisponível");
  expect(f.run).not.toHaveBeenCalled();
});
it("requires distributed limits in hosted Preview", async () => {
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("APP_ENV", "staging");
  expect((await testOrchestrator("teste")).ok).toBe(false); expect(f.run).not.toHaveBeenCalled();
});
it("rejects duplicate saved IDs", () => {
  const config = orchestratorConfig({ HQ_ORCHESTRATOR_ENABLED: "true", APP_ENV: "test", OPENAI_API_KEY: "test",
    HQ_TRIAGE_AGENT_ID: "agent_same", HQ_PRODUCT_AGENT_ID: "agent_same" });
  expect(config.ready).toBe(false);
});
it("does not leak thrown errors or credentials", async () => {
  f.run.mockRejectedValue(new Error("synthetic-secret"));
  const result = await testOrchestrator("teste");
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("synthetic-secret");
});
