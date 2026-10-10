// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogMobileSheetDefault, DialogThemeProvider, DialogTitle } from "./dialog";

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

describe("painel inferior no celular (padrão só dentro do painel do estabelecimento)", () => {
  function Sheetable({ mobileSheet }: { mobileSheet?: boolean }) {
    return <Dialog open><DialogContent mobileSheet={mobileSheet}><DialogTitle>Janela</DialogTitle>
      <DialogDescription>Conteúdo.</DialogDescription></DialogContent></Dialog>;
  }
  const isSheet = (dialog: HTMLElement) => dialog.getAttribute("data-mobile-sheet") === "true";
  const hasGrabber = (dialog: HTMLElement) => dialog.querySelector("[data-sheet-grabber]") !== null;

  it("fora do painel (telas públicas, plataforma, HQ) a janela continua centralizada, como em produção", () => {
    render(<Sheetable />);
    const dialog = screen.getByRole("dialog");
    expect(isSheet(dialog)).toBe(false);
    expect(dialog).not.toHaveAttribute("data-mobile-sheet");
    expect(hasGrabber(dialog)).toBe(false);
  });

  it("dentro do provider do painel a janela vira folha inferior, com alça, mesmo aberta em portal", () => {
    const view = render(<DialogMobileSheetDefault><Sheetable /></DialogMobileSheetDefault>);
    const dialog = screen.getByRole("dialog");
    expect(view.container.contains(dialog)).toBe(false);
    expect(isSheet(dialog)).toBe(true);
    expect(hasGrabber(dialog)).toBe(true);
  });

  it("a prop da própria janela vence o padrão, nos dois sentidos", () => {
    const inside = render(<DialogMobileSheetDefault><Sheetable mobileSheet={false} /></DialogMobileSheetDefault>);
    expect(isSheet(screen.getByRole("dialog"))).toBe(false);
    expect(hasGrabber(screen.getByRole("dialog"))).toBe(false);
    inside.unmount();
    cleanup();

    render(<Sheetable mobileSheet />);
    expect(isSheet(screen.getByRole("dialog"))).toBe(true);
    expect(hasGrabber(screen.getByRole("dialog"))).toBe(true);
  });

  it("um provider interno com value={false} desliga o padrão para o trecho dele", () => {
    render(<DialogMobileSheetDefault><DialogMobileSheetDefault value={false}><Sheetable /></DialogMobileSheetDefault></DialogMobileSheetDefault>);
    expect(isSheet(screen.getByRole("dialog"))).toBe(false);
  });
});
