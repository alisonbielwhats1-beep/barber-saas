// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const run = vi.hoisted(() => vi.fn());
vi.mock("@/app/hq/agents/orchestrator/actions", () => ({ testOrchestrator: run }));
import { OrchestratorLab } from "./orchestrator-lab";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
async function send(message = "Olá") {
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: message } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Testar fluxo" })));
}
const completed = (overrides = {}) => ({ ok: true, answer: "Qual erro aparece?", responder: "CUSTOMER_SUCCESS", conversationToken: "opaque", triage: { target_agent: "CUSTOMER_SUCCESS", event_type: "SUPPORT_REQUEST", priority: "MEDIUM", requires_human_approval: false }, steps: [
  { agent: "TRIAGE", agentId: "agent_t", sessionId: "sess_t", invoked: true, status: "completed", durationMs: 20, detail: "Recebido" },
  { agent: "CUSTOMER_SUCCESS", agentId: "agent_cs", sessionId: "sess_cs", invoked: true, status: "completed", durationMs: 20, detail: "Recebido" },
  { agent: "CHIEF", agentId: "agent_c", status: "skipped", durationMs: 0, detail: "Sem revisão necessária" },
], ...overrides });
it("discloses temporary quota and lists seven configured agents", () => {
  render(<OrchestratorLab ready reason="" dailyLimit={20} />);
  expect(screen.getByText(/até 20 por 24 horas/)).toHaveTextContent("ampliação temporária");
  expect(screen.getByRole("list", { name: "Sete agentes disponíveis para encaminhamento" }).querySelectorAll("li")).toHaveLength(7);
  expect(screen.getByText(/não comprova acesso à API/)).toBeVisible();
});
it("shows the authorized fifty without claiming it expires with diagnostic allowance", () => {
  render(<OrchestratorLab ready reason="" dailyLimit={50} />);
  expect(screen.getByText(/até 50 por 24 horas/)).toHaveTextContent("limite ampliado do laboratório");
  expect(screen.queryByText(/ampliação temporária/)).not.toBeInTheDocument();
});
it("prevents inference without configuration", () => {
  render(<OrchestratorLab ready={false} reason="Configure a chave" />);
  expect(screen.getByText("Configure a chave")).toBeVisible(); expect(screen.getByRole("button", { name: "Testar fluxo" })).toBeDisabled();
});
it("prevents duplicate submits and disables reset while busy", async () => {
  let finish!: (value: unknown) => void;
  run.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<OrchestratorLab ready reason="" />);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Olá" } });
  const button = screen.getByRole("button", { name: "Testar fluxo" }); fireEvent.click(button); fireEvent.click(button);
  expect(run).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "Nova conversa" })).toBeDisabled();
  await act(async () => finish(completed()));
  expect(screen.getByText("Chief · Não acionado")).toBeVisible(); expect(screen.getByRole("list", { name: "Histórico da conversa" })).toHaveTextContent("Qual erro aparece?");
});
it("continues using only an opaque token, and preserves chat history", async () => {
  run.mockResolvedValueOnce(completed()).mockResolvedValueOnce(completed({ answer: "Entendi o erro.", continued: true }));
  render(<OrchestratorLab ready reason="" />); await send("Não salva"); await send("Horário indisponível");
  expect(run.mock.calls[1]).toEqual(["Horário indisponível", { mode: "customer", intent: "continue", conversationToken: "opaque" }]);
  expect(screen.getByText("Responsável mantido:")).toBeVisible();
  const history = screen.getByRole("list", { name: "Histórico da conversa" }); expect(history).toHaveTextContent("Não salva"); expect(history).toHaveTextContent("Horário indisponível");
  expect(screen.getByLabelText("Origem da simulação")).toBeDisabled();
});
it.each(["reclassify", "review"])("offers explicit %s without arbitrary routing", async intent => {
  run.mockResolvedValue(completed()); render(<OrchestratorLab ready reason="" />); await send();
  fireEvent.change(screen.getByLabelText("Como tratar esta mensagem"), { target: { value: intent } }); await send("Outro assunto");
  expect(run.mock.calls[1][1]).toEqual({ mode: "customer", intent, conversationToken: "opaque" });
});
it("shows founder report and pending approval separately, without customer reply", async () => {
  run.mockResolvedValue(completed({ answer: undefined, chiefReport: "Avalie a compensação solicitada.", pendingApproval: true, reviewReason: "Requer sua decisão" }));
  render(<OrchestratorLab ready reason="" />); await send();
  expect(screen.getByText("Aprovação humana pendente.")).toBeVisible(); expect(screen.getByRole("heading", { name: "Chief · para você" })).toBeVisible();
  expect(screen.getByLabelText("Mensagem")).toBeDisabled(); expect(screen.getByRole("list", { name: "Histórico da conversa" })).not.toHaveTextContent("Atendimento Everflair");
});
it("renders internal JSON only in the analysis area", async () => {
  run.mockResolvedValue(completed({ answer: undefined, internalReport: '{"problema":"Análise interna"}', responder: "PRODUCT" }));
  render(<OrchestratorLab ready reason="" />); await send();
  expect(screen.getByRole("heading", { name: "Análise do especialista · uso interno" })).toBeVisible();
  expect(screen.getByText("Esta etapa produziu uma análise interna; não há mensagem para o cliente.")).toBeVisible();
});
it("preserves previous history but never publishes a failed partial answer", async () => {
  run.mockResolvedValueOnce(completed()).mockResolvedValueOnce({ ok: false, answer: "Parcial inválida", steps: [{ agent: "CUSTOMER_SUCCESS", invoked: true, status: "failed", durationMs: 10, detail: "Falhou" }], error: "Fluxo interrompido" });
  render(<OrchestratorLab ready reason="" />); await send(); await send("Outra informação");
  expect(screen.queryByText("Parcial inválida")).not.toBeInTheDocument(); expect(screen.getByRole("alert")).toHaveTextContent("Fluxo interrompido");
  expect(screen.getByRole("list", { name: "Histórico da conversa" })).toHaveTextContent("Qual erro aparece?"); expect(screen.getByLabelText("Mensagem")).toBeDisabled();
});
it("blocks automatic continuation after an uncertain network result", async () => {
  run.mockRejectedValue(new Error("network")); render(<OrchestratorLab ready reason="" />); await send();
  expect(screen.getByRole("alert")).toHaveTextContent("sessões na OpenAI"); expect(screen.getByLabelText("Mensagem")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Nova conversa" })); expect(screen.getByLabelText("Mensagem")).toBeEnabled();
});
it("starts a new conversation without carrying old history or token", async () => {
  run.mockResolvedValue(completed()); render(<OrchestratorLab ready reason="" />); await send();
  fireEvent.click(screen.getByRole("button", { name: "Nova conversa" })); expect(screen.queryByRole("list", { name: "Histórico da conversa" })).not.toBeInTheDocument();
  await send(); expect(run.mock.calls[1][1]).not.toHaveProperty("conversationToken");
});
it("stops at six turns", async () => {
  run.mockResolvedValue(completed()); render(<OrchestratorLab ready reason="" />);
  for (let n = 0; n < 6; n++) await send(`Mensagem ${n}`);
  expect(screen.getByLabelText("Mensagem")).toBeDisabled(); expect(run).toHaveBeenCalledTimes(6);
});
