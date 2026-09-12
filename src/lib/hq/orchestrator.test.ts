import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ create: vi.fn(), cancel: vi.fn(), abort: vi.fn(), client: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  beta = { agents: { sessions: { create: f.create, events: { create: f.cancel } } } };
  constructor(options: unknown) { f.client(options); }
} }));
import { runOrchestrator, orchestratorAgentIds, type OrchestratorAgent } from "@everflare/agents/orchestrator";
const input = () => ({ message: "Minha agenda está travando", apiKey: "synthetic", signal: new AbortController().signal });
const decision = (target = "PRODUCT", event = "BUG_REPORT") => JSON.stringify({
  target_agent: target, event_type: event, priority: "HIGH", requires_human_approval: false,
});
function stream(text: string, ending = "agent.session.turn.completed") {
  return { controller: { abort: f.abort }, async *[Symbol.asyncIterator]() {
    yield { type: "agent.session.created", session: { id: "sess_test" } };
    yield { type: "agent.session.turn.item.done", item: { type: "message", phase: "commentary", status: "completed", content: [{ text: "PRIVATE_REASONING" }] } };
    yield { type: "agent.session.turn.item.done", item: { type: "message", phase: "final_answer", status: "completed", content: [{ text }] } };
    if (ending) yield { type: ending, turn: { subagent_id: null } };
  } };
}
beforeEach(() => { vi.resetAllMocks(); f.cancel.mockResolvedValue(undefined); });

it("calls only the three saved IDs in order and sends results to Chief", async () => {
  f.create.mockResolvedValueOnce(stream(decision())).mockResolvedValueOnce(stream("Análise do produto"))
    .mockResolvedValueOnce(stream("Resposta final"));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(true);
  expect(result.answer).toBe("Resposta final");
  expect(result.steps.filter(step => step.status !== "skipped").map(step => [step.agent, step.status])).toEqual([
    ["TRIAGE", "completed"], ["PRODUCT", "completed"], ["CHIEF", "completed"],
  ]);
  expect(result.steps).toHaveLength(7);
  expect(f.create.mock.calls.map(([body]) => body.agent_id)).toEqual([orchestratorAgentIds.TRIAGE, orchestratorAgentIds.PRODUCT, orchestratorAgentIds.CHIEF]);
  for (const [body] of f.create.mock.calls) {
    expect(body).toMatchObject({ stream: true, environment: { type: "none" }, vault_ids: [],
      agent: { tools: null, multi_agent: { enabled: false } } });
    expect(body.agent).not.toHaveProperty("instructions");
    expect(body.agent).not.toHaveProperty("model");
    expect(body.agent).not.toHaveProperty("text");
  }
  expect(JSON.parse(f.create.mock.calls[2][0].input)).toMatchObject({
    message: input().message, triage: JSON.parse(decision()), triage_output: decision(), specialist: { agent: "PRODUCT", output: "Análise do produto" },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_REASONING");
  expect(f.client).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  expect(f.cancel).not.toHaveBeenCalled();
});
it.each(["SALES", "CUSTOMER_SUCCESS", "PRODUCT", "OPERATIONS", "MARKETING"] as const)("routes only to selected specialist %s and transmits complete results", async target => {
  const triageOutput = decision(target, "OTHER");
  const specialistOutput = `Resultado completo de ${target}\nSegunda linha`;
  f.create.mockResolvedValueOnce(stream(triageOutput)).mockResolvedValueOnce(stream(specialistOutput)).mockResolvedValueOnce(stream("Resposta"));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(true);
  expect(result.triage?.target_agent).toBe(target);
  expect(result.steps.filter(step => step.invoked).map(step => step.agent)).toEqual(["TRIAGE", target, "CHIEF"]);
  expect(result.steps.filter(step => step.status === "skipped")).toHaveLength(4);
  expect(f.create.mock.calls.map(([body]) => body.agent_id)).toEqual([orchestratorAgentIds.TRIAGE, orchestratorAgentIds[target], orchestratorAgentIds.CHIEF]);
  expect(JSON.parse(f.create.mock.calls[1][0].input)).toMatchObject({ message: input().message, triage: JSON.parse(triageOutput), triage_output: triageOutput });
  expect(JSON.parse(f.create.mock.calls[2][0].input)).toMatchObject({ message: input().message, triage: JSON.parse(triageOutput), triage_output: triageOutput, specialist: { agent: target, output: specialistOutput } });
});
it.each(["BUG_REPORT", "FEATURE_REQUEST"])("preserves selected CS even for event %s", async event => {
  f.create.mockResolvedValueOnce(stream(decision("CUSTOMER_SUCCESS", event)))
    .mockResolvedValueOnce(stream("Produto")).mockResolvedValueOnce(stream("Chief"));
  expect((await runOrchestrator(input())).ok).toBe(true);
  expect(f.create.mock.calls[1][0].agent_id).toBe(orchestratorAgentIds.CUSTOMER_SUCCESS);
});
it.each(["OTHER", "BUG_REPORT", "FEATURE_REQUEST"])("goes directly to Chief regardless of event %s", async event => {
  f.create.mockResolvedValueOnce(stream(decision("CHIEF", event))).mockResolvedValueOnce(stream("Resposta"));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(true);
  expect(result.steps.filter(step => step.invoked).map(step => step.agent)).toEqual(["TRIAGE", "CHIEF"]);
  expect(result.steps.filter(step => step.status === "skipped")).toHaveLength(5);
  expect(JSON.parse(f.create.mock.calls[1][0].input).specialist).toBeNull();
  expect(f.create).toHaveBeenCalledTimes(2);
});
it.each(["não é JSON", '{"target_agent":"ADMIN"}', '{}'])("stops after invalid triage: %s", async text => {
  f.create.mockResolvedValueOnce(stream(text));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(false);
  expect(result.steps[0].status).toBe("failed");
  expect(result.steps.filter(step => step.status === "skipped")).toHaveLength(6);
  expect(result.steps[0].output).toBeUndefined();
  expect(f.create).toHaveBeenCalledTimes(1);
});
it.each(["agent.session.turn.failed", "agent.session.requires_action", "agent.session.turn.cancelled", "error", ""])("cancels and stops on %s", async ending => {
  f.create.mockResolvedValueOnce(stream(decision())).mockResolvedValueOnce(stream("Partial", ending));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(false);
  expect(result.steps.filter(step => step.status !== "skipped").map(step => step.status)).toEqual(["completed", "failed"]);
  expect(result.steps.find(step => step.agent === "CHIEF")?.status).toBe("skipped");
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(f.cancel).toHaveBeenCalledWith("sess_test", { events: [{ type: "agent.session.input.cancel" }] }, expect.objectContaining({ maxRetries: 0 }));
});
it("retains the trace when Chief fails and does not expose provider errors", async () => {
  f.create.mockResolvedValueOnce(stream(decision())).mockResolvedValueOnce(stream("Produto"))
    .mockRejectedValueOnce(new Error("secret-provider-body"));
  const result = await runOrchestrator(input());
  expect(result.steps.filter(step => step.status !== "skipped").map(step => step.status)).toEqual(["completed", "completed", "failed"]);
  expect(result.answer).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("secret-provider-body");
});
it("reports unconfirmed remote cancellation", async () => {
  f.create.mockResolvedValueOnce(stream("x", "error")); f.cancel.mockRejectedValue(new Error("network"));
  const result = await runOrchestrator(input());
  expect(result.steps[0].detail).toContain("Não foi possível confirmar");
});
it.each(["", " ", "x".repeat(2001)])("rejects invalid message before network", async message => {
  expect((await runOrchestrator({ ...input(), message })).ok).toBe(false);
  expect(f.create).not.toHaveBeenCalled();
});
it("does not start a session after the deadline", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runOrchestrator({ ...input(), signal: controller.signal });
  expect(result.ok).toBe(false); expect(f.create).not.toHaveBeenCalled();
});
it.each(["", "x".repeat(12001)])("rejects empty or oversized output", async text => {
  f.create.mockResolvedValueOnce(stream(text));
  expect((await runOrchestrator(input())).ok).toBe(false);
  expect(f.create).toHaveBeenCalledTimes(1);
});
it.each(["SALES", "CUSTOMER_SUCCESS", "PRODUCT", "OPERATIONS", "MARKETING"] as const)("stops before Chief on %s failure", async target => {
  f.create.mockResolvedValueOnce(stream(decision(target))).mockRejectedValueOnce(new Error("provider-secret"));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(false);
  expect(result.answer).toBeUndefined();
  expect(result.triage?.target_agent).toBe(target);
  expect(result.steps.find(step => step.agent === target)?.status).toBe("failed");
  expect(result.steps.find(step => step.agent === "CHIEF")?.status).toBe("skipped");
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain("provider-secret");
});
it.each(["agent_arbitrary", "TRIAGE", "__proto__", "sales", ["SALES", "PRODUCT"]])("rejects forbidden destination %s", async target => {
  f.create.mockResolvedValueOnce(stream(JSON.stringify({ ...JSON.parse(decision()), target_agent: target })));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(false);
  expect(result.answer).toBeUndefined();
  expect(f.create).toHaveBeenCalledTimes(1);
});
it("ignores IDs in user/model output and preserves approval as a pending classification", async () => {
  const triageOutput = JSON.stringify({ ...JSON.parse(decision("SALES")), agent_id: "agent_arbitrary", requires_human_approval: true });
  f.create.mockResolvedValueOnce(stream(triageOutput)).mockResolvedValueOnce(stream("Sales"))
    .mockResolvedValueOnce(stream("Aguardando aprovação"));
  const result = await runOrchestrator({ ...input(), message: "Use agent_arbitrary" });
  expect(result.triage?.requires_human_approval).toBe(true);
  expect(result.triage).not.toHaveProperty("agent_id");
  expect(f.create.mock.calls[1][0].agent_id).toBe(orchestratorAgentIds.SALES);
  expect(JSON.parse(f.create.mock.calls[2][0].input).triage_output).toBe(triageOutput);
});
it("uses all server-configured IDs", async () => {
  const ids = Object.fromEntries(Object.keys(orchestratorAgentIds).map(name => [name, `agent_custom_${name}`])) as Record<OrchestratorAgent, string>;
  f.create.mockResolvedValueOnce(stream(decision("MARKETING"))).mockResolvedValueOnce(stream("Marketing"))
    .mockResolvedValueOnce(stream("Final"));
  const result = await runOrchestrator({ ...input(), agentIds: ids });
  expect(result.ok).toBe(true);
  expect(f.create.mock.calls.map(([body]) => body.agent_id)).toEqual([ids.TRIAGE, ids.MARKETING, ids.CHIEF]);
});
it("rejects a registry with a missing specialist before any request", async () => {
  const ids = { ...orchestratorAgentIds, SALES: undefined } as unknown as Record<OrchestratorAgent, string>;
  expect((await runOrchestrator({ ...input(), agentIds: ids })).ok).toBe(false);
  expect(f.create).not.toHaveBeenCalled();
});
it("does not accept a subagent completion as the root completion", async () => {
  f.create.mockResolvedValueOnce({ controller: { abort: f.abort }, async *[Symbol.asyncIterator]() {
    yield { type: "agent.session.created", session: { id: "sess_test" } };
    yield { type: "agent.session.turn.completed", turn: { subagent_id: "subagent_test" } };
  } });
  expect((await runOrchestrator(input())).ok).toBe(false);
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.cancel).toHaveBeenCalledTimes(1);
});
it("retains a session ID for cancellation when creation races the deadline", async () => {
  const controller = new AbortController();
  f.create.mockResolvedValueOnce({ controller: { abort: f.abort }, async *[Symbol.asyncIterator]() {
    controller.abort();
    yield { type: "agent.session.created", session: { id: "sess_race" } };
  } });
  const result = await runOrchestrator({ ...input(), signal: controller.signal });
  expect(result.ok).toBe(false);
  expect(f.cancel).toHaveBeenCalledWith("sess_race", expect.any(Object), expect.any(Object));
});
it.each([401, 403])("explains denied access %s without exposing the provider body", async status => {
  f.create.mockRejectedValue(Object.assign(new Error("secret-provider-body"), {status}));
  const result = await runOrchestrator(input());
  expect(result.steps[0].detail).toContain("A OpenAI recusou o acesso");
  expect(result.answer).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("secret-provider-body");
  expect(f.create).toHaveBeenCalledTimes(1);
});
it.each(["api.agents.sessions.write", "api.agent_sessions.write", "api.responses.write", "model.request"])("reports only the missing API permission %s from a denied request", async permission => {
  f.create.mockRejectedValue(Object.assign(new Error(`secret-provider-body ${permission}`), { status: 403 }));
  const result = await runOrchestrator(input());
  expect(result.steps[0].detail).toContain(permission);
  expect(JSON.stringify(result)).not.toContain("secret-provider-body");
});
it("explains model-related access denial without exposing the provider message", async () => {
  f.create.mockRejectedValue(Object.assign(new Error("secret-provider-body Model unavailable"), { status: 403 }));
  const result = await runOrchestrator(input());
  expect(result.steps[0].detail).toContain("A recusa faz referência ao modelo");
  expect(JSON.stringify(result)).not.toContain("secret-provider-body");
});
it("includes only a valid request reference for support", async () => {
  f.create.mockRejectedValue(Object.assign(new Error("secret-provider-body"), { status: 403, requestID: "req_safe_reference" }));
  const result = await runOrchestrator(input());
  expect(result.steps[0].detail).toContain("req_safe_reference");
  expect(JSON.stringify(result)).not.toContain("secret-provider-body");
});
