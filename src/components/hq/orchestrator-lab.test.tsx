// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const run = vi.hoisted(() => vi.fn());
vi.mock("@/app/hq/agents/orchestrator/actions", () => ({ testOrchestrator: run }));
import { OrchestratorLab } from "./orchestrator-lab";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("discloses the temporary server-provided diagnostic allowance", () => {
  render(<OrchestratorLab ready reason="" dailyLimit={20} />);
  expect(screen.getByText(/até 20 por 24 horas/)).toHaveTextContent("ampliação temporária para diagnóstico");
});
it("explains missing configuration and prevents invocation", () => {
  render(<OrchestratorLab ready={false} reason="Configure a chave" />);
  expect(screen.getByText("Configure a chave")).toBeVisible();
  expect(screen.getByRole("button", { name: "Testar fluxo" })).toBeDisabled();
});
it("prevents duplicate submits and renders final answer and skipped agent", async () => {
  let finish!: (value: unknown) => void;
  run.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<OrchestratorLab ready reason="" />);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Olá" } });
  const button = screen.getByRole("button", { name: "Testar fluxo" });
  fireEvent.click(button); fireEvent.click(button);
  expect(run).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Mensagem")).toBeDisabled();
  await act(async () => finish({ ok: true, answer: "Resposta consolidada", steps: [
    { agent: "TRIAGE", agentId: "agent_t", status: "completed", durationMs: 20, output: "Triagem", detail: "Recebido" },
    { agent: "PRODUCT", agentId: "agent_p", status: "skipped", durationMs: 0, detail: "Outro assunto" },
    { agent: "CHIEF", agentId: "agent_c", status: "completed", durationMs: 20, output: "Resposta consolidada", detail: "Recebido" },
  ] }));
  expect(screen.getByText("Product · Não acionado")).toBeVisible();
  expect(screen.getByText("Chief · Concluído")).toBeVisible();
  expect(screen.getAllByText("Resposta consolidada")[0]).toBeVisible();
  expect(button).toBeEnabled();
});
it("shows failures without a stale final answer and allows another test", async () => {
  run.mockRejectedValue(new Error("network"));
  render(<OrchestratorLab ready reason="" />);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Teste" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Testar fluxo" })));
  expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível receber");
  expect(screen.getByRole("button", { name: "Testar fluxo" })).toBeEnabled();
});
it("lists all seven agents before a run without claiming connection", () => {
  render(<OrchestratorLab ready reason="" />);
  const list = screen.getByRole("list", { name: "Sete agentes disponíveis para encaminhamento" });
  expect(list.querySelectorAll("li")).toHaveLength(7);
  for (const name of ["Triage", "Sales", "Customer Success", "Product", "Operations", "Marketing", "Chief"]) {
    expect(list).toHaveTextContent(name);
  }
  expect(screen.getByText(/não comprova acesso à API/)).toBeVisible();
});
it.each(["SALES", "CUSTOMER_SUCCESS", "PRODUCT", "OPERATIONS", "MARKETING", "CHIEF"])("shows selected %s, pending approval and actual invocations", async target => {
  run.mockResolvedValue({ ok: true, answer: "Aguardando revisão", triage: { target_agent: target, event_type: "OTHER", priority: "HIGH", requires_human_approval: true }, steps: [
    { agent: "TRIAGE", agentId: "agent_t", sessionId: "sess_t", invoked: true, status: "completed", durationMs: 250, output: "Triagem", detail: "Recebido" },
    ...(target === "CHIEF" ? [] : [{ agent: target, agentId: "agent_s", sessionId: "sess_s", invoked: true, status: "completed", durationMs: 500, output: "Análise", detail: "Recebido" }]),
    { agent: "CHIEF", agentId: "agent_c", sessionId: "sess_c", invoked: true, status: "completed", durationMs: 500, output: "Aguardando revisão", detail: "Recebido" },
  ] });
  render(<OrchestratorLab ready reason="" />);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Teste" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Testar fluxo" })));
  expect(screen.getByText("Destino selecionado por Triage:")).toBeVisible();
  expect(screen.getByText("Aprovação humana pendente.")).toBeVisible();
  expect(screen.getByText(/Sessão: sess_t/)).toBeInTheDocument();
  if (target === "CHIEF") expect(screen.getByText(/direto, sem especialista/)).toBeVisible();
});
it("clears a previous final answer when the following run fails", async () => {
  run.mockResolvedValueOnce({ ok: true, answer: "Resposta anterior", steps: [] })
    .mockResolvedValueOnce({ ok: false, answer: "Parcial inválida", steps: [], error: "Fluxo interrompido" });
  render(<OrchestratorLab ready reason="" />);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Teste" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Testar fluxo" })));
  expect(screen.getByText("Resposta anterior")).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Testar fluxo" })));
  expect(screen.queryByText("Resposta anterior")).not.toBeInTheDocument();
  expect(screen.queryByText("Parcial inválida")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Fluxo interrompido");
});
