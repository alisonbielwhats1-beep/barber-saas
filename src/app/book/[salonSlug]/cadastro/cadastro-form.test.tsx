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
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(screen.getByText(/WhatsApp inválido/)).toBeInTheDocument();
    expect(mocks.registerClient).not.toHaveBeenCalled();
  });

  it("mantém a máscara do telefone e envia os dados preenchidos", async () => {
    mocks.registerClient.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <CadastroForm
        salonSlug="studio-a"
        returnTo="/book/studio-a/agendar?services=service-a"
      />,
    );

    await fillRequiredFields(user);
    fireEvent.change(screen.getByPlaceholderText("(11) 91234-5678"), {
      target: { value: "11912345678" },
    });
    await user.type(screen.getByPlaceholderText("Mínimo 6 caracteres"), "123456");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    await waitFor(() => expect(mocks.registerClient).toHaveBeenCalledOnce());
    expect(mocks.registerClient).toHaveBeenCalledWith(
      "studio-a",
      {
        name: "Ana Silva",
        phone: "(11) 91234-5678",
        email: "ana@example.com",
        password: "123456",
      },
      "/book/studio-a/agendar?services=service-a",
    );
  });
});
