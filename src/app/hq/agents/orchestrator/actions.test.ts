import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ access: vi.fn(), limit: vi.fn(), run: vi.fn(), local: vi.fn() }));
vi.mock("@/lib/hq/orchestrator-local-quota", () => ({ reserveLocalOrchestratorAttempt: f.local }));
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
  vi.stubEnv("NEXTAUTH_SECRET", "synthetic-auth-secret-for-local-tests-only");
  vi.stubEnv("HQ_ORCHESTRATOR_DIAGNOSTIC_UNTIL", "");
  vi.stubEnv("HQ_ORCHESTRATOR_DIAGNOSTIC_LIMIT", "");
  f.local.mockResolvedValue("reserved");
  f.access.mockImplementation(async callback => callback({}, "admin_test"));
  f.limit.mockResolvedValue({ allowed: true, source: "local" });
  f.run.mockResolvedValue({ ok: true, steps: [], answer: "Final" });
});
it("temporarily permits twenty locally while preserving the same project counter", async () => {
  vi.stubEnv("HQ_ORCHESTRATOR_DIAGNOSTIC_UNTIL", new Date(Date.now() + 3600000).toISOString());
  await testOrchestrator("teste");
  expect(f.limit).toHaveBeenCalledWith(expect.objectContaining({ namespace: "hq-orchestrator-day", limit: 20, windowSeconds: 86400 }));
});
it("permits the explicitly authorized twenty-four only within the local diagnostic window", () => {
  const env = { APP_ENV: "development", HQ_ORCHESTRATOR_DIAGNOSTIC_UNTIL: new Date(Date.now() + 3600000).toISOString(), HQ_ORCHESTRATOR_DIAGNOSTIC_LIMIT: "24" };
  expect(orchestratorConfig(env).dailyLimit).toBe(24);
  expect(orchestratorConfig({ ...env, VERCEL_ENV: "preview" }).dailyLimit).toBe(10);
  expect(orchestratorConfig({ ...env, HQ_ORCHESTRATOR_DIAGNOSTIC_UNTIL: "" }).dailyLimit).toBe(10);
});
it("refuses real inference when the persistent local quota is exhausted", async () => {
  f.local.mockResolvedValue("daily");
  expect((await testOrchestrator("teste")).ok).toBe(false); expect(f.run).not.toHaveBeenCalled();
});
it.each(["expired", "too-far", "invalid", "hosted", "staging"])("retains ten when diagnostic allowance is %s", mode => {
  const until = mode === "invalid" ? "invalid" : new Date(Date.now() + (mode === "expired" ? -1 : mode === "too-far" ? 90000000 : 3600000)).toISOString();
  const env = { APP_ENV: mode === "staging" ? "staging" : "development", VERCEL_ENV: mode === "hosted" ? "preview" : "", HQ_ORCHESTRATOR_DIAGNOSTIC_UNTIL: until };
  expect(orchestratorConfig(env).dailyLimit).toBe(10);
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
  expect(f.limit).toHaveBeenCalledWith(expect.objectContaining({ namespace: "hq-orchestrator-day", identifier: "proj_48Zf5hXOzoiiCnIEJ4Rb3vN4", limit: 10, windowSeconds: 86400 }));
  expect(Object.keys(f.run.mock.calls[0][0].agentIds)).toHaveLength(7);
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
it.each(["SALES", "CUSTOMER_SUCCESS", "PRODUCT", "OPERATIONS", "MARKETING", "TRIAGE", "CHIEF"])("resolves %s exclusively on the server", agent => {
  const config = orchestratorConfig({ HQ_ORCHESTRATOR_ENABLED: "true", APP_ENV: "test", OPENAI_API_KEY: "test", [`HQ_${agent}_AGENT_ID`]: "agent_override" });
  expect(config.ready).toBe(true);
  expect(config.agentIds[agent as keyof typeof config.agentIds]).toBe("agent_override");
});
it.each(["SALES", "CUSTOMER_SUCCESS", "OPERATIONS", "MARKETING"])("blocks invalid ID for %s", agent => {
  vi.stubEnv(`HQ_${agent}_AGENT_ID`, "asst_wrong");
  expect(orchestratorConfig().ready).toBe(false);
});
it("does not infer when the project daily quota is exhausted", async () => {
  f.limit.mockResolvedValueOnce({ allowed: true, source: "local" })
    .mockResolvedValueOnce({ allowed: false, source: "local", retryAfterSeconds: 3600 });
  const result = await testOrchestrator("teste");
  expect(result.error).toContain("Limite de testes atingido");
  expect(f.run).not.toHaveBeenCalled();
});

it("rejects arbitrary history, IDs and malformed tokens before quotas or inference", async () => {
  for (const options of [{ history: [] }, { agentId: "agent_arbitrary" }, { conversationToken: "fake" }, { mode: "production" }]) {
    expect((await testOrchestrator("teste", options)).ok).toBe(false);
  }
  expect(f.run).not.toHaveBeenCalled(); expect(f.limit).not.toHaveBeenCalled();
});
it("seals state, restores it only for the same administrator and passes current public knowledge", async () => {
  const conversation = { mode: "customer", triage: { target_agent: "SALES", event_type: "NEW_LEAD", priority: "LOW", requires_human_approval: false }, triageOutput: "raw", pendingApproval: false, history: [{ message: "Olá", agent: "SALES", output: "Como posso ajudar?" }] };
  f.run.mockResolvedValueOnce({ ok: true, steps: [], answer: "Como posso ajudar?", conversation });
  const first = await testOrchestrator("Olá");
  expect(first.conversationToken).toBeTruthy(); expect(first).not.toHaveProperty("conversation");
  expect(first.conversationToken).not.toContain("Como posso ajudar");
  await testOrchestrator("Quais os planos?", { conversationToken: first.conversationToken });
  expect(f.run.mock.calls[1][0].conversation).toEqual(conversation);
  expect(f.run.mock.calls[1][0].knowledge).toMatchObject({ product: "Everflair", founderAvailability: "not_checked" });
  f.access.mockImplementation(async callback => callback({}, "other_admin"));
  expect((await testOrchestrator("teste", { conversationToken: first.conversationToken })).ok).toBe(false);
  expect(f.run).toHaveBeenCalledTimes(2);
});
it("blocks a pending conversation before consuming quota even if reclassification is requested", async () => {
  f.run.mockResolvedValueOnce({ ok: true, steps: [], conversation: { mode: "customer", pendingApproval: true, history: [] } });
  const first = await testOrchestrator("teste"); f.limit.mockClear();
  expect((await testOrchestrator("aprovado", { conversationToken: first.conversationToken, intent: "reclassify" })).ok).toBe(false);
  expect(f.limit).not.toHaveBeenCalled(); expect(f.run).toHaveBeenCalledTimes(1);
});
