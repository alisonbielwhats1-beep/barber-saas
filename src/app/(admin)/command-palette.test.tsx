// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, OpenCommandPaletteButton } from "./command-palette";
import { MobileNav } from "./mobile-nav";

const navigation = vi.hoisted(() => ({
  pathname: "/dashboard",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

beforeEach(() => {
  navigation.pathname = "/dashboard";
  navigation.push.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    media: "(min-width: 768px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommandPalette", () => {
  function expectOnlyPaletteDialog() {
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName("Navegação rápida");
    expect(screen.queryByText("Todos os módulos")).toBeNull();
    expect(document.querySelectorAll('[data-state="open"]:not([role])')).toHaveLength(1);
  }

  it("abre pelo botão, recebe foco, prende Tab e devolve foco ao fechar com Escape", async () => {
    const user = userEvent.setup();
    render(
      <>
        <OpenCommandPaletteButton />
        <CommandPalette role="OWNER" />
      </>,
    );

    const trigger = screen.getByRole("button", { name: /buscar/i });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Navegação rápida" });
    const combobox = within(dialog).getByRole("combobox", { name: "Buscar tela ou ação" });
    expect(combobox).toHaveFocus();

    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Fechar janela" })).toHaveFocus();
    await user.tab();
    expect(combobox).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("abre pelo atalho e navega com setas e Enter sem quebrar Ctrl+K", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Origem</button>
        <CommandPalette role="OWNER" />
      </>,
    );
    const origin = screen.getByRole("button", { name: "Origem" });
    origin.focus();

    await user.keyboard("{Control>}k{/Control}");
    const combobox = screen.getByRole("combobox", { name: "Buscar tela ou ação" });
    expect(combobox).toHaveFocus();
    expect(combobox).toHaveAttribute("aria-activedescendant", expect.stringContaining("option-0"));

    await user.keyboard("{ArrowDown}{Enter}");
    expect(navigation.push).toHaveBeenCalledWith("/agenda");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("fecha a palette e o overlay Mais ao navegar, mesmo para a rota atual", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MobileNav role="OWNER" />
        <CommandPalette role="OWNER" />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir todos os módulos" }));
    expect(screen.getByText("Todos os módulos")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /buscar/i }));

    const dialog = screen.getByRole("dialog", { name: "Navegação rápida" });
    await user.click(within(dialog).getByRole("option", { name: /Dashboard/ }));

    expect(navigation.push).toHaveBeenCalledWith("/dashboard");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText("Todos os módulos")).toBeNull();
    });
  });

  it("fecha Mais antes de abrir Busca e devolve foco ao gatilho estável no Escape", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MobileNav role="OWNER" />
        <CommandPalette role="OWNER" />
      </>,
    );

    const moreTrigger = screen.getByRole("button", { name: "Abrir todos os módulos" });
    await user.click(moreTrigger);
    const mobileDialog = screen.getByRole("dialog", { name: "Todos os módulos" });
    await user.click(within(mobileDialog).getByRole("button", { name: /buscar/i }));

    await waitFor(expectOnlyPaletteDialog);
    expect(screen.getByRole("combobox", { name: "Buscar tela ou ação" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(moreTrigger.isConnected).toBe(true);
    expect(moreTrigger).toHaveFocus();
  });

  it("coordena Ctrl+K com Mais aberto sem manter dois modais ou focus traps", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MobileNav role="OWNER" />
        <CommandPalette role="OWNER" />
      </>,
    );

    const moreTrigger = screen.getByRole("button", { name: "Abrir todos os módulos" });
    await user.click(moreTrigger);
    expect(screen.getByRole("dialog", { name: "Todos os módulos" })).toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    await waitFor(expectOnlyPaletteDialog);
    expect(screen.getByRole("combobox", { name: "Buscar tela ou ação" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(moreTrigger.isConnected).toBe(true);
    expect(moreTrigger).toHaveFocus();
  });

  it("trata Mais como modal, prende o foco, fecha com Escape e devolve o foco ao gatilho", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Antes do menu</button>
        <MobileNav role="OWNER" />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Abrir todos os módulos" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Todos os módulos" });
    const search = within(dialog).getByRole("button", { name: /buscar/i });
    const close = within(dialog).getByRole("button", { name: "Fechar janela" });
    expect(search).toHaveFocus();

    close.focus();
    await user.tab();
    expect(search).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
