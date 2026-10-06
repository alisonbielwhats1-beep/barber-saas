// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogThemeProvider, DialogTitle } from "./dialog";

afterEach(cleanup);

function OpenDialog() {
  return <Dialog open><DialogContent><DialogTitle>Revisar reserva</DialogTitle>
    <DialogDescription>Confira seu atendimento.</DialogDescription>
  </DialogContent></Dialog>;
}

describe("margem lateral da janela", () => {
  const classes = (element: HTMLElement) => element.className.split(' ');

  it("usa a largura toda no celular e reserva 64px ao botão X só de sm para cima", () => {
    render(<Dialog open><DialogContent><DialogHeader><DialogTitle>Bloquear horário</DialogTitle></DialogHeader></DialogContent></Dialog>);
    const dialog = screen.getByRole("dialog");
    expect(classes(dialog)).toEqual(expect.arrayContaining(["p-6", "pr-6", "sm:pr-16"]));
    expect(classes(dialog)).not.toContain("pr-16");
  });

  it("afasta só o cabeçalho do botão X no celular", () => {
    render(<Dialog open><DialogContent><DialogHeader><DialogTitle>Bloquear horário</DialogTitle></DialogHeader></DialogContent></Dialog>);
    const header = screen.getByText("Bloquear horário").parentElement!;
    expect(classes(header)).toEqual(expect.arrayContaining(["pr-10", "sm:pr-0"]));
    expect(screen.getByRole("button", { name: "Fechar janela" })).toBeInTheDocument();
  });

  it("respeita quem define o próprio preenchimento", () => {
    render(<Dialog open><DialogContent className="p-0"><DialogHeader className="pr-8"><DialogTitle>Detalhe</DialogTitle></DialogHeader></DialogContent></Dialog>);
    const dialog = screen.getByRole("dialog");
    expect(classes(dialog)).toContain("p-0");
    expect(classes(dialog)).not.toContain("pr-6");
    expect(classes(dialog)).not.toContain("sm:pr-16");
    const header = screen.getByText("Detalhe").parentElement!;
    expect(classes(header)).toContain("pr-8");
    expect(classes(header)).not.toContain("sm:pr-0");
  });

  it("mantém uma janela com pr-0 sem o recuo padrão", () => {
    render(<Dialog open><DialogContent className="p-0 pr-0"><DialogTitle>Busca</DialogTitle></DialogContent></Dialog>);
    expect(classes(screen.getByRole("dialog"))).not.toContain("sm:pr-16");
  });
});

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
