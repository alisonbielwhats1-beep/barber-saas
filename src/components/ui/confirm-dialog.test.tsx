// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";
import { DialogMobileSheetDefault } from "./dialog";

afterEach(cleanup);

function Confirm() {
  return <ConfirmDialog open onOpenChange={() => {}} title="Cancelar reserva?" description="Esta ação não pode ser desfeita." confirmLabel="Cancelar reserva" onConfirm={vi.fn()} />;
}
const classes = (element: HTMLElement) => element.className.split(/\s+/);

describe("ConfirmDialog", () => {
  it("fora do painel (ex.: Minhas reservas do cliente) mantém a janela e o visual de produção", () => {
    render(<Confirm />);
    const dialog = screen.getByRole("dialog", { name: "Cancelar reserva?" });
    expect(dialog).not.toHaveAttribute("data-mobile-sheet");
    expect(classes(screen.getByRole("heading", { name: "Cancelar reserva?" }))).not.toContain("max-md:text-lg");
    expect(classes(screen.getByRole("button", { name: "Cancelar" }))).not.toContain("max-md:min-h-12");
    expect(classes(screen.getByRole("button", { name: "Cancelar reserva" }))).not.toContain("max-md:min-h-12");
    expect(classes(screen.getByText("Esta ação não pode ser desfeita."))).not.toContain("max-md:text-sm");
  });

  it("dentro do painel vira folha de ação: botões grandes empilhados e texto centralizado no celular", () => {
    render(<DialogMobileSheetDefault><Confirm /></DialogMobileSheetDefault>);
    const dialog = screen.getByRole("dialog", { name: "Cancelar reserva?" });
    expect(dialog).toHaveAttribute("data-mobile-sheet", "true");
    expect(classes(screen.getByRole("heading", { name: "Cancelar reserva?" }))).toContain("max-md:text-lg");
    expect(classes(screen.getByRole("button", { name: "Cancelar" }))).toContain("max-md:min-h-12");
    expect(classes(screen.getByRole("button", { name: "Cancelar reserva" }))).toContain("max-md:min-h-12");
    expect(classes(screen.getByText("Esta ação não pode ser desfeita."))).toContain("max-md:text-sm");
  });
});
