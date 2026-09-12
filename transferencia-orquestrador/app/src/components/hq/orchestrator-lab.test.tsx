// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const run = vi.hoisted(() => vi.fn());
vi.mock("@/app/hq/agents/orchestrator/actions", () => ({ testOrchestrator: run }));
import { OrchestratorLab } from "./orchestrator-lab";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
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
