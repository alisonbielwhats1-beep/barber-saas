// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: mocks.signIn }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }), useSearchParams: () => new URLSearchParams("callbackUrl=/agenda") }));
import { LoginForm } from "./login-form";

function submit() {
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Password123" } });
  fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!);
}

describe("panel login feedback", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it.each([
    ["LOGIN_RATE_LIMITED", "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente."],
    ["LOGIN_TEMPORARILY_UNAVAILABLE", "Não foi possível entrar agora por uma falha temporária. Aguarde um pouco e tente novamente."],
    ["CredentialsSignin", "E-mail ou senha incorretos. Confira os dados e tente novamente."],
    ["private provider error", "Não foi possível entrar agora por uma falha temporária. Aguarde um pouco e tente novamente."],
  ])("shows a safe, specific message for %s without navigating", async (error, message) => {
    mocks.signIn.mockResolvedValue({ ok: false, error, status: 401, url: null });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.com");
    expect(screen.getByLabelText("Senha")).toHaveValue("Password123");
    expect(screen.getByLabelText("Senha")).toHaveAttribute("aria-invalid", String(error === "CredentialsSignin"));
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", String(error === "CredentialsSignin"));
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledWith("credentials", { email: "owner@example.com", password: "Password123", redirect: false });
  });

  it.each([undefined, { ok: false, error: null, status: 503 }])("does not navigate on an absent/failed response: %j", async (response) => {
    mocks.signIn.mockResolvedValue(response);
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("falha temporária");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("allows retry after a network failure without blaming the password", async () => {
    mocks.signIn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Verifique sua conexão");
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.signIn.mockResolvedValue({ ok: true, error: null, status: 200, url: "/agenda" });
    fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/agenda"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
