// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientShell } from "./client-shell";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
vi.mock("next/navigation", () => ({ usePathname: () => "/book/demo/welcome" }));
afterEach(cleanup);
describe("tema do aplicativo do cliente", () => {
  it("parte do tema do servidor e mantém os diálogos sincronizados ao alternar", async () => {
    const user = userEvent.setup();
    const view = render(<ClientShell initialTheme="salon-light" salonSlug="demo" unreadNotifications={0}>
      <p>Cliente</p>
    </ClientShell>);
    expect(view.container.querySelector('.client-app')).toHaveAttribute("data-theme", "salon-light");
    await user.click(screen.getByRole("button", { name: "Usar tema escuro" }));
    expect(view.container.querySelector('.client-app')).toHaveAttribute("data-theme", "salon-dark");
    expect(document.cookie).toContain("everflair-client-theme=dark");
    view.rerender(<ClientShell initialTheme="salon-light" salonSlug="demo" unreadNotifications={0}>
      <Dialog open><DialogContent><DialogTitle>Revisão</DialogTitle><DialogDescription>Confira sua reserva.</DialogDescription></DialogContent></Dialog>
    </ClientShell>);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-theme", "salon-dark");
  });
});
