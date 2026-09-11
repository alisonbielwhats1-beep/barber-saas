import { afterEach, describe, expect, it, vi } from "vitest";
import { runLabScenario, scenarios } from "@everflare/agents";
import { authorizeTool, executeDemoTool, type ExecutionContext } from "@everflare/agents/policy";

afterEach(() => vi.unstubAllGlobals());
describe("HQ Agents SDK local validation", () => {
  it.each(scenarios)("SDK executa $id com o resultado definido", async scenario => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden in laboratory"); });
    vi.stubGlobal("fetch", fetch);
    const result = await runLabScenario(scenario.id);
    expect(result.status).toBe(scenario.expectedStatus);
    expect(result.passed).toBe(true);
    expect(result.turns).toBeLessThanOrEqual(4);
    expect(result.costUsd).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    if (scenario.id === "hours") {
      expect(result.trace.map(t => t.tool)).toEqual(["lookup_account", "search_knowledge"]);
      expect(result.output).toContain("KB-DEMO-001");
    }
    if (scenario.id === "cross_account") {
      expect(result.trace.every(t => t.status === "blocked")).toBe(true);
      expect(JSON.stringify(result)).not.toContain("dados de outro cliente");
    }
    if (scenario.id === "payment") expect(result.trace).toContainEqual(expect.objectContaining({ tool: "confirm_payment", status: "blocked" }));
    if (scenario.id === "unknown") expect(result.output).toContain("Nenhum ticket foi gravado");
  });
  it("rejeita cenário livre ou objeto antes de executar", async () => {
    await expect(runLabScenario("run-production")).rejects.toThrow();
    await expect(runLabScenario({ id: "overview", accountId: "real" })).rejects.toThrow();
  });
  it("respeita cancelamento e isola execuções concorrentes", async () => {
    const controller = new AbortController(); controller.abort();
    const cancelled = await runLabScenario("overview", { signal: controller.signal });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.turns).toBe(0);
    const [chief, support] = await Promise.all([runLabScenario("overview"), runLabScenario("hours")]);
    expect(chief.trace.map(t => t.tool)).toEqual(["executive_summary"]);
    expect(support.trace.map(t => t.tool)).not.toContain("executive_summary");
    expect(chief.id).not.toBe(support.id);
  });
  it("ferramentas validam autorização independentemente do modelo", async () => {
    const context: ExecutionContext = { agent: "support", accountId: "demo-aurora", trace: [], needsHuman: false, draftCreated: false, failLookup: false };
    expect(() => authorizeTool(context, "executive_summary")).toThrow("não autorizada");
    expect(() => authorizeTool(context, "confirm_payment")).toThrow("não autorizada");
    await expect(executeDemoTool(context, "lookup_account", { accountId: "other" })).rejects.toThrow("não autorizada");
    await expect(executeDemoTool(context, "lookup_account", {})).rejects.toThrow("obrigatória");
    const first = await executeDemoTool(context, "prepare_ticket", { accountId: context.accountId });
    expect(await executeDemoTool(context, "prepare_ticket", { accountId: context.accountId })).toBe(first);
    expect(context.needsHuman).toBe(true);
  });
});
