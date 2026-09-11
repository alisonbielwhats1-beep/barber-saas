// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const simulate = vi.hoisted(() => vi.fn());
vi.mock("@/app/hq/agents/actions", () => ({ simulateAgent: simulate }));
import { AgentLab } from "./agent-lab";
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("mantém controles bloqueados durante resposta assíncrona e permite tentar após falha", async () => {
  let finish!: (value: { ok: false; error: string }) => void;
  simulate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<AgentLab />);
  const button = screen.getByRole("button", { name: "Executar cenário", exact: true });
  fireEvent.click(button);
  expect(screen.getByRole("button", { name: "Executando…" })).toBeDisabled();
  expect(screen.getByLabelText("Cenário de validação")).toBeDisabled();
  fireEvent.click(button);
  expect(simulate).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: false, error: "Falha demonstrativa" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Falha demonstrativa");
  expect(screen.getByRole("button", { name: "Executar cenário", exact: true })).toBeEnabled();
});

it("explica a simulação e não oferece entrada livre nem envio de mídia", () => {
  render(<AgentLab />);
  expect(screen.getByText("Simulação local · sem consumo de IA")).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText(/Ao recarregar ou sair/)).toBeVisible();
});
