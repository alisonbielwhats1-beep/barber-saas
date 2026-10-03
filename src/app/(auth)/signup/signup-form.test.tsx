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
function completeForm(confirmEmail = "teste@example.com") {
  for (const [name, value] of [["Nome do estabelecimento", "Espaço de teste"], ["Seu nome", "Pessoa Teste"], ["Email", "teste@example.com"], ["Confirmar e-mail", confirmEmail], ["Senha", "senha-de-teste"], ["Confirmar senha", "senha-de-teste"]]) fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
  fireEvent.submit(screen.getByRole("button", { name: "Criar meu espaço" }).closest("form")!);
}
it("bloqueia o cadastro quando os e-mails digitados são diferentes", async () => {
  render(<SignupForm />);
  completeForm("outro@example.com");
  expect(await screen.findByRole("alert")).toHaveTextContent("Os e-mails não coincidem.");
  expect(mocks.signup).not.toHaveBeenCalled();
});
it("mostra Essencial e preserva PRO como interesse, sem conceder o plano", async () => {
  render(<SignupForm initialSegment="barbearia" planIntent="pro" />);
  expect(screen.getByText("Seu interesse: Essencial")).toBeVisible();
  completeForm();
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/configuracao?next=%2Fdashboard%3Fwelcome%3D1%26plan%3Dpro"));
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
it("preserva a contratação escolhida antes de oferecer o guia", async () => {
  render(<SignupForm billingIntent={{ plan: "INDIVIDUAL", cycle: "ANNUAL", extraAgendas: 0 }} />);
  completeForm();
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/assinatura?billingPlan=INDIVIDUAL&cycle=ANNUAL&extraAgendas=0"));
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
