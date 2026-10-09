// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ resend: vi.fn() }));
vi.mock("@/app/book/[salonSlug]/confirmation-actions", () => ({ resendClientConfirmation: m.resend }));
import { ClientConfirmationHelp } from "./client-confirmation-help";
describe("ajuda de confirmação", () => {
  beforeEach(() => vi.resetAllMocks()); afterEach(cleanup);
  it("não envia automaticamente e impede cliques simultâneos", async () => {
    let resolve!: (value: { message: string }) => void;
    m.resend.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = render(<ClientConfirmationHelp salonSlug="studio-a" email="client@example.test" />);
    expect(m.resend).not.toHaveBeenCalled();
    const button = screen.getByRole("button");
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled(); expect(m.resend).toHaveBeenCalledOnce();
    expect(m.resend).toHaveBeenCalledWith("studio-a", "client@example.test");
    resolve({ message: "Se houver um cadastro pendente, confira seu e-mail." });
    expect(await screen.findByRole("status")).toHaveTextContent("Se houver");
    view.rerender(<ClientConfirmationHelp salonSlug="studio-a" email="other@example.test" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("informa falha real e permite tentar de novo", async () => {
    m.resend.mockRejectedValue(new Error("offline"));
    render(<ClientConfirmationHelp salonSlug="studio-a" email="client@example.test" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Verifique sua conexão");
    expect(screen.getByRole("button")).toBeEnabled();
  });
});
