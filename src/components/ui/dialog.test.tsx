// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogThemeProvider, DialogTitle } from "./dialog";

afterEach(cleanup);

function OpenDialog() {
  return <Dialog open><DialogContent><DialogTitle>Revisar reserva</DialogTitle>
    <DialogDescription>Confira seu atendimento.</DialogDescription>
  </DialogContent></Dialog>;
}

describe("dialog theme across portals", () => {
  it("keeps the client theme after rendering outside the client shell", () => {
    const view = render(<DialogThemeProvider value="salon-dark"><OpenDialog /></DialogThemeProvider>);
    const dialog = screen.getByRole("dialog", { name: "Revisar reserva" });
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog).toHaveAttribute("data-theme", "salon-dark");
  });
  it("leaves other dialogs inheriting the document theme", () => {
    render(<OpenDialog />);
    expect(screen.getByRole("dialog")).not.toHaveAttribute("data-theme");
  });
});
