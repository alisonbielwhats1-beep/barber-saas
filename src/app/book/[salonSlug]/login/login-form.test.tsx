// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const mocks = vi.hoisted(() => ({
  loginClient: vi.fn(),
}));

vi.mock("../auth-actions", () => ({
  loginClient: mocks.loginClient,
}));

describe("LoginForm", () => {
  beforeEach(() => {
    mocks.loginClient.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("exibe o erro devolvido pela action sem perder os campos", async () => {
    mocks.loginClient.mockResolvedValue({ error: "Credenciais inválidas" });
    const user = userEvent.setup();
    render(<LoginForm salonSlug="studio-a" returnTo="/book/studio-a/agendar" />);

    const email = screen.getByPlaceholderText("seu@email.com");
    const password = screen.getByPlaceholderText("••••••••");
    await user.type(email, "cliente@example.com");
    await user.type(password, "senha-segura");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByText("Credenciais inválidas")).toBeInTheDocument());
    expect(email).toHaveValue("cliente@example.com");
    expect(password).toHaveValue("senha-segura");
    expect(mocks.loginClient).toHaveBeenCalledWith(
      "studio-a",
      "cliente@example.com",
      "senha-segura",
      "/book/studio-a/agendar",
    );
  });

  it("desabilita o submit enquanto a autenticação está pendente", async () => {
    let resolve!: (value: { error?: string }) => void;
    mocks.loginClient.mockReturnValue(new Promise<{ error?: string }>((done) => {
      resolve = done;
    }));
    const user = userEvent.setup();
    render(<LoginForm salonSlug="studio-a" />);

    await user.type(screen.getByPlaceholderText("seu@email.com"), "cliente@example.com");
    await user.type(screen.getByPlaceholderText("••••••••"), "senha-segura");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    const submit = screen.getByRole("button", { name: "Entrando…" });
    expect(submit).toBeDisabled();
    expect(mocks.loginClient).toHaveBeenCalledOnce();

    resolve({});
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled());
  });
});
