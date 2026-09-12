import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ create: vi.fn(), cancel: vi.fn(), abort: vi.fn(), client: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  beta = { agents: { sessions: { create: f.create, events: { create: f.cancel } } } };
  constructor(options: unknown) { f.client(options); }
} }));
import { runOrchestrator, orchestratorAgentIds, type OrchestratorAgent, type OrchestratorConversation } from "@everflare/agents/orchestrator";
const input = () => ({ message: "Minha agenda está travando", apiKey: "synthetic", signal: new AbortController().signal });
const decision = (target = "CUSTOMER_SUCCESS", approval = false, priority = "MEDIUM") => JSON.stringify({
  target_agent: target, event_type: "SUPPORT_REQUEST", priority, requires_human_approval: approval, summary: "Contexto completo da triagem",
});
const outputFor = (target: string, approval = false, review = false) => target === "SALES" || target === "CUSTOMER_SUCCESS" ? "Qual erro aparece?"
  : JSON.stringify({ target_agent: review ? "CHIEF" : target, requires_human_approval: approval, next_action: review ? "ESCALATE_TO_CHIEF" : "DRAFT_CONTENT", internal_summary: "Análise interna", proximo_passo: "Verificar", problema: "Relato não confirmado" });
const conversation = (): OrchestratorConversation => ({ mode: "customer", triage: JSON.parse(decision()), triageOutput: decision(), pendingApproval: false,
  history: [{ message: "Não salva", agent: "CUSTOMER_SUCCESS", output: "Qual erro aparece?" }] });
function stream(text: string, ending = "agent.session.turn.completed") {
  return { controller: { abort: f.abort }, async *[Symbol.asyncIterator]() {
    yield { type: "agent.session.created", session: { id: "sess_test" } };
    yield { type: "agent.session.turn.item.done", item: { type: "message", phase: "commentary", status: "completed", content: [{ text: "PRIVATE_REASONING" }] } };
    yield { type: "agent.session.turn.item.done", item: { type: "message", phase: "final_answer", status: "completed", content: [{ text }] } };
    if (ending) yield { type: ending, turn: { subagent_id: null } };
  } };
}
beforeEach(() => { vi.resetAllMocks(); f.cancel.mockResolvedValue(undefined); });
it.each(["SALES", "CUSTOMER_SUCCESS", "PRODUCT", "OPERATIONS", "MARKETING"] as const)("runs only Triage and %s without unnecessary Chief", async target => {
  f.create.mockResolvedValueOnce(stream(decision(target))).mockResolvedValueOnce(stream(outputFor(target)));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(true);
  expect(result.steps).toHaveLength(7);
  expect(result.steps.filter(step => step.invoked).map(step => step.agent)).toEqual(["TRIAGE", target]);
  expect(f.create.mock.calls.map(([body]) => body.agent_id)).toEqual([orchestratorAgentIds.TRIAGE, orchestratorAgentIds[target]]);
  expect(result.steps.find(s => s.agent === "CHIEF")?.status).toBe("skipped");
  if (target === "SALES" || target === "CUSTOMER_SUCCESS") {
    expect(result.answer).toBe(outputFor(target)); expect(result.internalReport).toBeUndefined();
  } else {
    expect(result.answer).toBeUndefined(); expect(result.internalReport).toBe(outputFor(target));
  }
  expect(JSON.parse(f.create.mock.calls[1][0].input)).toMatchObject({ message: input().message, triage_output: decision(target) });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_REASONING");
  for (const [body, options] of f.create.mock.calls) {
    expect(body).toMatchObject({ stream: true, environment: { type: "none" }, vault_ids: [], agent: { tools: null, multi_agent: { enabled: false } } });
    expect(body.agent).not.toHaveProperty("instructions"); expect(body.agent).not.toHaveProperty("model"); expect(body.agent).not.toHaveProperty("text");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  }
  expect(f.client).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 45000 }));
  expect(f.cancel).not.toHaveBeenCalled();
});
it.each(["SALES", "CUSTOMER_SUCCESS", "PRODUCT", "OPERATIONS", "MARKETING"] as const)("sends full %s and triage outputs to Chief when approval is required", async target => {
  const raw = decision(target, true);
  f.create.mockResolvedValueOnce(stream(raw)).mockResolvedValueOnce(stream(outputFor(target))).mockResolvedValueOnce(stream("Decisão para o fundador"));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(true); expect(result.pendingApproval).toBe(true); expect(result.answer).toBeUndefined();
  expect(result.chiefReport).toBe("Decisão para o fundador");
  expect(result.conversation?.pendingApproval).toBe(true);
  expect(f.create).toHaveBeenCalledTimes(3);
  expect(JSON.parse(f.create.mock.calls[2][0].input)).toMatchObject({ message: input().message, triage_output: raw, specialist: { agent: target, output: outputFor(target) }, requires_human_approval: true });
});
it.each(["PRODUCT", "OPERATIONS", "MARKETING"] as const)("validates the saved %s escalation fields", async target => {
  f.create.mockResolvedValueOnce(stream(decision(target))).mockResolvedValueOnce(stream(outputFor(target, false, true))).mockResolvedValueOnce(stream("Recomendação interna"));
  const result = await runOrchestrator(input());
  expect(result.chiefReport).toBe("Recomendação interna"); expect(result.pendingApproval).toBe(false); expect(result.answer).toBeUndefined();
});
it.each(["PRODUCT", "OPERATIONS", "MARKETING"] as const)("retains %s approval even if Triage did not require it", async target => {
  f.create.mockResolvedValueOnce(stream(decision(target))).mockResolvedValueOnce(stream(outputFor(target, true))).mockResolvedValueOnce(stream("Aguarda autorização"));
  const result = await runOrchestrator(input());
  expect(result.pendingApproval).toBe(true); expect(result.conversation?.pendingApproval).toBe(true);
});
it("treats critical triage as pending and invokes Chief", async () => {
  f.create.mockResolvedValueOnce(stream(decision("CUSTOMER_SUCCESS", false, "CRITICAL"))).mockResolvedValueOnce(stream("Orientação"))
    .mockResolvedValueOnce(stream("Risco crítico"));
  const result = await runOrchestrator(input());
  expect(result.pendingApproval).toBe(true); expect(result.answer).toBeUndefined(); expect(result.chiefReport).toBe("Risco crítico");
});
it("Chief direct is an internal response to the founder, never customer text", async () => {
  f.create.mockResolvedValueOnce(stream(decision("CHIEF"))).mockResolvedValueOnce(stream("Decisão estratégica"));
  const result = await runOrchestrator(input());
  expect(result.ok).toBe(true); expect(result.answer).toBeUndefined(); expect(result.chiefReport).toBe("Decisão estratégica");
  expect(JSON.parse(f.create.mock.calls[1][0].input).specialist).toBeNull(); expect(f.create).toHaveBeenCalledTimes(2);
});
it("continues with one specialist and complete trusted history", async () => {
  const state = conversation();
  f.create.mockResolvedValueOnce(stream("Você consegue escolher outro horário?"));
  const result = await runOrchestrator({ ...input(), message: "Horário indisponível", conversation: state, knowledge: { plans: ["public"] } });
  expect(result.continued).toBe(true); expect(result.steps[0].status).toBe("skipped"); expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.create.mock.calls[0][0].agent_id).toBe(orchestratorAgentIds.CUSTOMER_SUCCESS);
  expect(JSON.parse(f.create.mock.calls[0][0].input)).toMatchObject({ history: state.history, triage_output: state.triageOutput, public_knowledge: { plans: ["public"] } });
  expect(result.conversation?.history).toHaveLength(2); expect(state.history).toHaveLength(1);
});
it("reclassifies a changed topic while keeping the conversation history", async () => {
  f.create.mockResolvedValueOnce(stream(decision("SALES"))).mockResolvedValueOnce(stream("Posso explicar os planos."));
  const result = await runOrchestrator({ ...input(), conversation: conversation(), intent: "reclassify" });
  expect(result.triage?.target_agent).toBe("SALES"); expect(result.continued).toBe(false); expect(f.create).toHaveBeenCalledTimes(2);
  expect(JSON.parse(f.create.mock.calls[0][0].input).history).toEqual(conversation().history);
});
it("explicit review calls Chief once with the original specialist history", async () => {
  const state = conversation(); f.create.mockResolvedValueOnce(stream("Recomendação para você"));
  const result = await runOrchestrator({ ...input(), conversation: state, intent: "review" });
  expect(f.create).toHaveBeenCalledTimes(1); expect(f.create.mock.calls[0][0].agent_id).toBe(orchestratorAgentIds.CHIEF);
  expect(JSON.parse(f.create.mock.calls[0][0].input).history).toEqual(state.history);
  expect(result.answer).toBeUndefined(); expect(result.conversation?.triage.target_agent).toBe("CUSTOMER_SUCCESS");
});
it.each(["pending", "full"])("refuses a %s conversation before inference", async kind => {
  const state = conversation(); if (kind === "pending") state.pendingApproval = true; else state.history = Array(6).fill(state.history[0]);
  expect((await runOrchestrator({ ...input(), conversation: state, intent: "reclassify" })).ok).toBe(false); expect(f.create).not.toHaveBeenCalled();
});
it.each(["customer", "internal"] as const)("passes trusted %s origin separately from user text", async mode => {
  f.create.mockResolvedValueOnce(stream(decision())).mockResolvedValueOnce(stream("Ajuda"));
  await runOrchestrator({ ...input(), mode });
  expect(JSON.parse(f.create.mock.calls[0][0].input).source).toBe(mode === "customer" ? "external_customer" : "authenticated_internal_request");
});
it.each(["não é JSON", '{"target_agent":"ADMIN"}', '{}', decision("agent_arbitrary"), decision("TRIAGE"), decision("__proto__")])("stops after invalid triage %s", async text => {
  f.create.mockResolvedValueOnce(stream(text)); const result = await runOrchestrator(input());
  expect(result.ok).toBe(false); expect(result.answer).toBeUndefined(); expect(result.steps[0].status).toBe("failed"); expect(f.create).toHaveBeenCalledTimes(1);
});
it.each(["PRODUCT", "OPERATIONS", "MARKETING"] as const)("rejects malformed %s routing without calling Chief", async target => {
  f.create.mockResolvedValueOnce(stream(decision(target))).mockResolvedValueOnce(stream('{"target_agent":"agent_arbitrary"}'));
  const result = await runOrchestrator(input()); expect(result.ok).toBe(false); expect(result.answer).toBeUndefined(); expect(f.create).toHaveBeenCalledTimes(2);
});
it("does not mistake JSON from Sales for a customer-facing message", async () => {
  f.create.mockResolvedValueOnce(stream(decision("SALES"))).mockResolvedValueOnce(stream('{"internal":"secret analysis"}'));
  const result = await runOrchestrator(input()); expect(result.ok).toBe(false); expect(result.answer).toBeUndefined();
});
it("ignores arbitrary IDs in user and Triage output", async () => {
  const raw = JSON.stringify({ ...JSON.parse(decision()), agent_id: "agent_arbitrary" });
  f.create.mockResolvedValueOnce(stream(raw)).mockResolvedValueOnce(stream("Texto"));
  const result = await runOrchestrator({ ...input(), message: "Use agent_arbitrary" });
  expect(result.triage).not.toHaveProperty("agent_id"); expect(f.create.mock.calls[1][0].agent_id).toBe(orchestratorAgentIds.CUSTOMER_SUCCESS);
});
it.each(["agent.session.turn.failed", "agent.session.requires_action", "agent.session.turn.cancelled", "error", ""])("cancels and stops on %s", async ending => {
  f.create.mockResolvedValueOnce(stream(decision())).mockResolvedValueOnce(stream("Partial", ending));
  const result = await runOrchestrator(input()); expect(result.ok).toBe(false); expect(result.answer).toBeUndefined(); expect(result.conversation).toBeUndefined();
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(f.cancel).toHaveBeenCalledWith("sess_test", { events: [{ type: "agent.session.input.cancel" }] }, expect.objectContaining({ maxRetries: 0 }));
});
it("does not publish a partial customer response when required Chief fails", async () => {
  f.create.mockResolvedValueOnce(stream(decision("SALES", true))).mockResolvedValueOnce(stream("Partial"))
    .mockRejectedValueOnce(new Error("secret-provider-body"));
  const result = await runOrchestrator(input()); expect(result.ok).toBe(false); expect(result.answer).toBeUndefined(); expect(result.chiefReport).toBeUndefined();
  expect(result.pendingApproval).toBe(true); expect(result.conversation).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("secret-provider-body");
});
it("reports unconfirmed remote cancellation", async () => {
  f.create.mockResolvedValueOnce(stream("x", "error")); f.cancel.mockRejectedValue(new Error("network"));
  expect((await runOrchestrator(input())).steps[0].detail).toContain("Não foi possível confirmar");
});
it.each(["", " ", "x".repeat(2001)])("rejects invalid input", async message => {
  expect((await runOrchestrator({ ...input(), message })).ok).toBe(false); expect(f.create).not.toHaveBeenCalled();
});
it.each(["", "x".repeat(12001)])("rejects empty or oversized output", async text => {
  f.create.mockResolvedValueOnce(stream(text)); expect((await runOrchestrator(input())).ok).toBe(false); expect(f.create).toHaveBeenCalledTimes(1);
});
it("does not start after the deadline", async () => {
  const controller = new AbortController(); controller.abort();
  expect((await runOrchestrator({ ...input(), signal: controller.signal })).ok).toBe(false); expect(f.create).not.toHaveBeenCalled();
});
it("retains the cancellation handle when creation races the deadline", async () => {
  const controller = new AbortController();
  f.create.mockResolvedValueOnce({ controller: { abort: f.abort }, async *[Symbol.asyncIterator]() {
    controller.abort(); yield { type: "agent.session.created", session: { id: "sess_race" } };
  } });
  expect((await runOrchestrator({ ...input(), signal: controller.signal })).ok).toBe(false);
  expect(f.cancel).toHaveBeenCalledWith("sess_race", expect.any(Object), expect.any(Object));
});
it("does not accept a subagent completion as root completion", async () => {
  f.create.mockResolvedValueOnce({ controller: { abort: f.abort }, async *[Symbol.asyncIterator]() {
    yield { type: "agent.session.created", session: { id: "sess_test" } };
    yield { type: "agent.session.turn.completed", turn: { subagent_id: "subagent_other" } };
  } });
  expect((await runOrchestrator(input())).ok).toBe(false); expect(f.cancel).toHaveBeenCalledTimes(1);
});
it.each([401, 403])("sanitizes access failure %s", async status => {
  f.create.mockRejectedValue(Object.assign(new Error("secret-provider-body api.agents.sessions.write"), { status, requestID: "req_support" }));
  const result = await runOrchestrator(input()); expect(result.steps[0].detail).toContain("api.agents.sessions.write");
  expect(result.steps[0].detail).toContain("req_support"); expect(JSON.stringify(result)).not.toContain("secret-provider-body");
});
it("validates every server-owned agent ID before inference", async () => {
  const ids = { ...orchestratorAgentIds, SALES: "asst_invalid" };
  expect((await runOrchestrator({ ...input(), agentIds: ids })).ok).toBe(false); expect(f.create).not.toHaveBeenCalled();
});
it("supports server registry overrides", async () => {
  const ids = Object.fromEntries(Object.keys(orchestratorAgentIds).map(name => [name, `agent_custom_${name}`])) as Record<OrchestratorAgent, string>;
  f.create.mockResolvedValueOnce(stream(decision("MARKETING"))).mockResolvedValueOnce(stream(outputFor("MARKETING")));
  expect((await runOrchestrator({ ...input(), agentIds: ids })).ok).toBe(true);
  expect(f.create.mock.calls.map(([body]) => body.agent_id)).toEqual([ids.TRIAGE, ids.MARKETING]);
});

const featureDecision = () => JSON.stringify({ ...JSON.parse(decision()), event_type: "FEATURE_REQUEST" });
const assessment = (missing: string[] = [], overrides = {}) => JSON.stringify({
  target_agent: "PRODUCT", requires_human_approval: false, problema: "Agente virtual na agenda",
  dados_necessarios: missing, ...overrides,
});
const featureConversation = (rounds: number): OrchestratorConversation => ({
  ...conversation(), triage: JSON.parse(featureDecision()), triageOutput: featureDecision(),
  featureIntake: { clarificationRounds: rounds, status: "collecting" },
  history: Array.from({ length: rounds }, (_, n) => ({ message: `Contexto ${n}`, agent: "CUSTOMER_SUCCESS", output: `Pergunta ${n}` })),
});
it("prepares a clear feature after the first clarification without another customer question", async () => {
  f.create.mockResolvedValueOnce(stream(assessment()))
    .mockResolvedValueOnce(stream("Recomendação para avaliar, sem promessa de implementação."));
  const result = await runOrchestrator({ ...input(), conversation: featureConversation(1) });
  expect(result.ok).toBe(true); expect(result.featureIntake).toEqual({ status: "prepared", clarificationRounds: 1 });
  expect(f.create.mock.calls.map(([body]) => body.agent_id)).toEqual([orchestratorAgentIds.PRODUCT, orchestratorAgentIds.CHIEF]);
  expect(result.answer).toBeUndefined(); expect(result.internalReport).toBe(assessment());
  expect(result.chiefReport).toContain("Recomendação");
  expect(JSON.parse(f.create.mock.calls[1][0].input)).toMatchObject({ triage_output: featureDecision(), specialist: { agent: "PRODUCT", output: assessment() } });
});
it("starts intake with only Triage and Customer Success within the shared deadline", async () => {
  f.create.mockResolvedValueOnce(stream(featureDecision()))
    .mockResolvedValueOnce(stream("Qual tarefa você gostaria de automatizar?"));
  const result = await runOrchestrator(input());
  expect(result.featureIntake).toEqual({ status: "collecting", clarificationRounds: 1 });
  expect(result.answer).toContain("automatizar"); expect(result.chiefReport).toBeUndefined();
  expect(f.create.mock.calls.map(([body]) => body.agent_id)).toEqual([orchestratorAgentIds.TRIAGE, orchestratorAgentIds.CUSTOMER_SUCCESS]);
});
it.each([1, 2])("escalates as soon as Product has no missing data after %s clarification rounds", async rounds => {
  f.create.mockResolvedValueOnce(stream(assessment())).mockResolvedValueOnce(stream("Avalie a melhoria"));
  const result = await runOrchestrator({ ...input(), conversation: featureConversation(rounds) });
  expect(result.featureIntake).toEqual({ status: "prepared", clarificationRounds: rounds });
  expect(f.create).toHaveBeenCalledTimes(2);
});
it("allows the second clarification but never a third, even if data remain missing", async () => {
  const missing = assessment(["Canal", "Regras de aprovação"]);
  f.create.mockResolvedValueOnce(stream(missing)).mockResolvedValueOnce(stream("Em qual canal?"));
  const second = await runOrchestrator({ ...input(), conversation: featureConversation(1) });
  expect(second.featureIntake).toEqual({ status: "collecting", clarificationRounds: 2 });
  expect(JSON.parse(f.create.mock.calls[1][0].input).product_assessment.output).toBe(missing);
  expect(second.conversation?.history.at(-1)?.productAssessment).toBe(missing);
  f.create.mockResolvedValueOnce(stream("Recomendo avaliar, com dúvidas pendentes."));
  const final = await runOrchestrator({ ...input(), message: "Dentro do Everflair", conversation: second.conversation });
  expect(final.featureIntake).toEqual({ status: "prepared", clarificationRounds: 2 });
  expect(f.create.mock.calls.slice(2).map(([body]) => body.agent_id)).toEqual([orchestratorAgentIds.CHIEF]);
  expect(JSON.parse(f.create.mock.calls[2][0].input)).toMatchObject({
    history: second.conversation!.history, message: "Dentro do Everflair", specialist: { output: missing }, product_assessment_source: "previous_turn",
  });
  expect(final.steps.find(s => s.agent === "PRODUCT")).toMatchObject({ status: "skipped", invoked: false, output: missing });
  expect(final.answer).toBeUndefined(); expect(final.reviewReason).toContain("duas rodadas");
});
it("does not reuse an old Product assessment after an explicit reclassification", async () => {
  const state = featureConversation(2); state.history[1].productAssessment = assessment(["Old question"]);
  f.create.mockResolvedValueOnce(stream(featureDecision())).mockResolvedValueOnce(stream(assessment(["New context"])))
    .mockResolvedValueOnce(stream("Recomendação atualizada"));
  const result = await runOrchestrator({ ...input(), conversation: state, intent: "reclassify" });
  expect(result.ok).toBe(true); expect(f.create).toHaveBeenCalledTimes(3);
  expect(JSON.parse(f.create.mock.calls[2][0].input)).toMatchObject({ specialist: { output: assessment(["New context"]) }, product_assessment_source: "current_message" });
});
it("applies the cap to existing feature conversations created before this change", async () => {
  const old = featureConversation(4); delete old.featureIntake;
  f.create.mockResolvedValueOnce(stream(assessment(["Falta detalhe"]))).mockResolvedValueOnce(stream("Recomendação"));
  const result = await runOrchestrator({ ...input(), conversation: old });
  expect(result.featureIntake).toEqual({ status: "prepared", clarificationRounds: 2 });
  expect(f.create).toHaveBeenCalledTimes(2);
});
it.each(["review", "continue", "reclassify"] as const)("does not repeat a prepared feature via %s", async intent => {
  const state = featureConversation(2); state.featureIntake!.status = "prepared";
  expect((await runOrchestrator({ ...input(), conversation: state, intent })).ok).toBe(false);
  expect(f.create).not.toHaveBeenCalled();
});
it.each([{}, { dados_necessarios: "unknown" }, { dados_necessarios: [""] }, { target_agent: "agent_arbitrary" }])("fails closed on invalid feature assessment %j", async invalid => {
  f.create.mockResolvedValueOnce(stream(JSON.stringify(invalid)));
  const result = await runOrchestrator({ ...input(), conversation: featureConversation(1) }); expect(result.ok).toBe(false); expect(result.conversation).toBeUndefined();
  expect(f.create).toHaveBeenCalledTimes(1); expect(result.steps.find(s => s.agent === "PRODUCT")?.status).toBe("failed");
});
it("prioritizes Product approval over more questions, even with missing information", async () => {
  f.create.mockResolvedValueOnce(stream(assessment(["Canal"], { requires_human_approval: true })))
    .mockResolvedValueOnce(stream("Aguarda sua aprovação"));
  const result = await runOrchestrator({ ...input(), conversation: featureConversation(1) }); expect(result.pendingApproval).toBe(true); expect(result.answer).toBeUndefined();
  expect(result.featureIntake?.status).toBe("prepared"); expect(f.create).toHaveBeenCalledTimes(2);
});
it("does not publish a prepared recommendation or advance intake when Chief fails", async () => {
  f.create.mockResolvedValueOnce(stream(assessment())).mockRejectedValueOnce(new Error("private-provider-error"));
  const result = await runOrchestrator({ ...input(), conversation: featureConversation(2) });
  expect(result.ok).toBe(false); expect(result.featureIntake).toBeUndefined(); expect(result.chiefReport).toBeUndefined(); expect(result.conversation).toBeUndefined();
  expect(result.steps.find(s => s.agent === "PRODUCT")?.output).toBe(assessment());
});
it("reclassification to Sales ends feature intake and keeps the full history", async () => {
  f.create.mockResolvedValueOnce(stream(decision("SALES"))).mockResolvedValueOnce(stream("Preços públicos"));
  const result = await runOrchestrator({ ...input(), conversation: featureConversation(1), intent: "reclassify" });
  expect(result.featureIntake).toBeUndefined(); expect(result.responder).toBe("SALES"); expect(f.create).toHaveBeenCalledTimes(2);
});
it("reclassifying the same feature cannot reset the clarification budget", async () => {
  f.create.mockResolvedValueOnce(stream(featureDecision())).mockResolvedValueOnce(stream(assessment(["Detalhe"])))
    .mockResolvedValueOnce(stream("Recomendação com incertezas"));
  const result = await runOrchestrator({ ...input(), conversation: featureConversation(2), intent: "reclassify" });
  expect(result.featureIntake).toEqual({ status: "prepared", clarificationRounds: 2 });
  expect(f.create).toHaveBeenCalledTimes(3);
});
it("does not activate external feature intake on internal Product requests", async () => {
  f.create.mockResolvedValueOnce(stream(JSON.stringify({ ...JSON.parse(featureDecision()), target_agent: "PRODUCT" })))
    .mockResolvedValueOnce(stream(outputFor("PRODUCT")));
  const result = await runOrchestrator({ ...input(), mode: "internal" });
  expect(result.featureIntake).toBeUndefined(); expect(f.create).toHaveBeenCalledTimes(2);
});
