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
