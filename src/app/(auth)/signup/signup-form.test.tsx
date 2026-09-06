// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";
const mocks = vi.hoisted(() => ({ signup: vi.fn(), signIn: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("./actions", () => ({ signup: mocks.signup }));
vi.mock("next-auth/react", () => ({ signIn: mocks.signIn }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.signup.mockResolvedValue({ ok: true, slug: "teste" }); mocks.signIn.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
function completeForm() {
  for (const [name, value] of [["Nome do estabelecimento", "Espaço de teste"], ["Seu nome", "Pessoa Teste"], ["Email", "teste@example.com"], ["Senha", "senha-de-teste"], ["Confirmar senha", "senha-de-teste"]]) fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
  fireEvent.submit(screen.getByRole("button", { name: "Criar meu espaço" }).closest("form")!);
}
it("preserva Pro como interesse sem enviá-lo como plano concedido", async () => {
  render(<SignupForm initialSegment="barbearia" planIntent="pro" />);
  expect(screen.getByText("Seu interesse: Pro")).toBeVisible();
  completeForm();
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard?welcome=1&plan=pro"));
  const payload = mocks.signup.mock.calls[0][0];
  expect(payload.serviceNames).toEqual([]);
  expect(payload.segmentId).toBe("barbearia");
  expect(payload).not.toHaveProperty("plan");
});
it("inclui serviços sugeridos somente quando a pessoa escolhe incluí-los", async () => {
  render(<SignupForm initialSegment="barbearia" />);
  fireEvent.click(screen.getByText("Serviços sugeridos"));
  fireEvent.click(screen.getByLabelText("Incluir sugestões de serviços no meu espaço"));
  completeForm();
  await waitFor(() => expect(mocks.signup).toHaveBeenCalled());
  expect(mocks.signup.mock.calls[0][0].serviceNames.length).toBeGreaterThan(0);
});
it("mantém os dados e o contexto do plano após falha de cadastro", async () => {
  mocks.signup.mockResolvedValue({ ok: false, error: "Tente novamente." });
  render(<SignupForm planIntent="equipe" />);
  completeForm();
  expect(await screen.findByRole("alert")).toHaveTextContent("Tente novamente.");
  expect(screen.getByLabelText("Nome do estabelecimento")).toHaveValue("Espaço de teste");
  expect(screen.getByText("Seu interesse: Equipe")).toBeVisible();
  expect(mocks.signIn).not.toHaveBeenCalled();
});
