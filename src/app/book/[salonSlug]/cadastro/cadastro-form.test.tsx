// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CadastroForm } from "./cadastro-form";

const mocks = vi.hoisted(() => ({
  registerClient: vi.fn(),
}));

vi.mock("../auth-actions", () => ({
  registerClient: mocks.registerClient,
}));

describe("CadastroForm", () => {
  it("bloqueia envio repetido e preserva os dados após resposta perdida", async () => {
    let reject!: (error: Error) => void;
    mocks.registerClient.mockReturnValue(new Promise((_resolve, r) => { reject = r; }));
    render(<CadastroForm salonSlug="studio-a" />);
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Cliente sintético" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "test@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha", { exact: true }), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "123456" } });
    const form = screen.getByRole("button", { name: "Criar conta" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.registerClient).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("E-mail")).toBeDisabled();
    reject(new Error("network"));
    await screen.findByText(/Não recebemos a confirmação/);
    expect(screen.getByLabelText("Senha", { exact: true })).toHaveValue("123456");
    mocks.registerClient.mockResolvedValueOnce({ error: "Acesso pendente", code: "ACCOUNT_ACCESS" });
    fireEvent.submit(form);
    await screen.findByRole("link", { name: "Entrar" });
    expect(screen.getByRole("link", { name: "Recuperar acesso" })).toHaveAttribute("href", "/book/studio-a/recuperar-senha");
  });
  beforeEach(() => {
    mocks.registerClient.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText("Seu nome"), "Ana Silva");
    await user.type(screen.getByPlaceholderText("seu@email.com"), "ana@example.com");
  }

  it("rejeita senha curta antes de chamar a action", async () => {
    const user = userEvent.setup();
    render(<CadastroForm salonSlug="studio-a" />);

    await fillRequiredFields(user);
    await user.type(screen.getByPlaceholderText("Mínimo 6 caracteres"), "12345");
    await user.type(screen.getByLabelText("Confirmar senha"), "12345");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(screen.getByText("A senha deve ter pelo menos 6 caracteres")).toBeInTheDocument();
    expect(mocks.registerClient).not.toHaveBeenCalled();
  });

  it("rejeita telefone inválido sem persistir cadastro", async () => {
    const user = userEvent.setup();
    render(<CadastroForm salonSlug="studio-a" />);

    await fillRequiredFields(user);
    fireEvent.change(screen.getByPlaceholderText("(11) 91234-5678"), {
      target: { value: "(11) 9333-4444" },
    });
    await user.type(screen.getByPlaceholderText("Mínimo 6 caracteres"), "123456");
    await user.type(screen.getByLabelText("Confirmar senha"), "123456");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(screen.getByText(/WhatsApp inválido/)).toBeInTheDocument();
    expect(mocks.registerClient).not.toHaveBeenCalled();
  });

  it("mantém a máscara do telefone e envia os dados preenchidos", async () => {
    mocks.registerClient.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CadastroForm salonSlug="studio-a" />);

    await fillRequiredFields(user);
    fireEvent.change(screen.getByPlaceholderText("(11) 91234-5678"), {
      target: { value: "11912345678" },
    });
    await user.type(screen.getByPlaceholderText("Mínimo 6 caracteres"), "123456");
    await user.type(screen.getByLabelText("Confirmar senha"), "123456");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    await waitFor(() => expect(mocks.registerClient).toHaveBeenCalledOnce());
    expect(mocks.registerClient).toHaveBeenCalledWith(
      "studio-a",
      {
        name: "Ana Silva",
        phone: "(11) 91234-5678",
        email: "ana@example.com",
        password: "123456",
        confirmPassword: "123456",
      },
      undefined,
    );
  });
});
