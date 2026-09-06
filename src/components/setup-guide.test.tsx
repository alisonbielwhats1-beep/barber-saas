// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PlanInterestNotice, SetupGuide } from "./setup-guide";
afterEach(cleanup);
const steps = [
  { label: "Criar serviços", href: "/servicos", done: true },
  { label: "Cadastrar profissionais", href: "/profissionais", done: false },
  { label: "Definir horários", href: "/profissionais", done: false },
  { label: "Receber reserva", href: "/compartilhar", done: false },
];
it("destaca a próxima tarefa sem bloquear acesso às outras", () => {
  render(<SetupGuide steps={steps} />);
  expect(screen.getByRole("link", { name: /Continuar configuração/ })).toHaveAttribute("href", "/profissionais");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  expect(screen.getByRole("link", { name: /Criar serviços/ })).toHaveAttribute("href", "/servicos");
});
it("retira o guia quando todas as tarefas foram concluídas", () => {
  const { container } = render(<SetupGuide steps={steps.map(step => ({ ...step, done: true }))} />);
  expect(container).toBeEmptyDOMElement();
});
it("distingue interesse em Pro do plano realmente ativo", () => {
  const { rerender } = render(<PlanInterestNotice currentPlan="FREE" intent="pro" />);
  expect(screen.getByText(/Seu plano ativo é o Grátis/)).toBeVisible();
  rerender(<PlanInterestNotice currentPlan="PRO" intent="equipe" />);
  expect(screen.queryByLabelText("Plano de interesse")).not.toBeInTheDocument();
});
