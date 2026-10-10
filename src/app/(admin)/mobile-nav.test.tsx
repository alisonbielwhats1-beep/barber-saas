// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "./mobile-nav";

const navigation = vi.hoisted(() => ({ pathname: "/clientes" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  navigation.pathname = "/clientes";
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    media: "(min-width: 1024px)",
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

async function openMore(role: string) {
  const user = userEvent.setup();
  render(<MobileNav role={role} />);
  await user.click(screen.getByRole("button", { name: "Abrir todos os módulos" }));
  return screen.getByRole("dialog", { name: "Todos os módulos" });
}

describe("Mais (painel no celular)", () => {
  it("é sempre uma folha inferior, mesmo sem o padrão do painel", async () => {
    const dialog = await openMore("OWNER");
    expect(dialog).toHaveAttribute("data-mobile-sheet", "true");
  });

  it("o dono encontra os grupos de Clientes e 'Cadastros excluídos' no Mais", async () => {
    const dialog = await openMore("OWNER");
    const clientes = within(dialog).getByRole("region", { name: "Clientes" });
    expect(within(clientes).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/clientes?segment=vip",
      "/clientes?segment=birthday",
      "/clientes?segment=lapsed",
      "/clientes?segment=recurring",
      "/clientes?status=excluded",
    ]);
    expect(within(clientes).getByRole("link", { name: "Cadastros excluídos" })).toHaveAttribute("href", "/clientes?status=excluded");
  });

  it("gerente e recepção veem os grupos, mas não 'Cadastros excluídos'", async () => {
    for (const role of ["MANAGER", "RECEPTIONIST"]) {
      const dialog = await openMore(role);
      const clientes = within(dialog).getByRole("region", { name: "Clientes" });
      expect(within(clientes).getByRole("link", { name: "Clientes VIP" })).toBeInTheDocument();
      expect(within(clientes).queryByRole("link", { name: "Cadastros excluídos" })).toBeNull();
      cleanup();
    }
  });

  it("estando em /clientes, atalhos com filtro não aparecem como a página atual", async () => {
    const dialog = await openMore("OWNER");
    const clientes = within(dialog).getByRole("region", { name: "Clientes" });
    for (const link of within(clientes).getAllByRole("link")) expect(link).not.toHaveAttribute("aria-current");
  });
});

describe("Barra de abas", () => {
  it("sem Secretária: Hoje, Agenda, Clientes, Avisos e Mais", () => {
    render(<MobileNav role="OWNER" />);
    const bar = screen.getByRole("navigation", { name: "Navegação do aplicativo" });
    expect(within(bar).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/hoje", "/agenda", "/clientes", "/notificacoes"]);
    expect(within(bar).queryByRole("button", { name: "Abrir Secretária" })).toBeNull();
  });

  it("com Secretária: ela fica no meio, abre o painel pelo evento e os avisos vão para o sino do topo", async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    window.addEventListener("everflair:secretary-open", opened);
    render(<MobileNav role="OWNER" secretary unreadNotifications={4} />);
    const bar = screen.getByRole("navigation", { name: "Navegação do aplicativo" });
    const items = Array.from(bar.querySelectorAll("a, button")).map((item) => item.getAttribute("href") ?? item.getAttribute("aria-label"));
    expect(items).toEqual(["/hoje", "/agenda", "Abrir Secretária", "/clientes", "Abrir todos os módulos"]);
    await user.click(within(bar).getByRole("button", { name: "Abrir Secretária" }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener("everflair:secretary-open", opened);
  });
});

