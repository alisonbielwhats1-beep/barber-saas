// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/profissionais";
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => params,
}));

import { DESKTOP_AREAS, DesktopContextNav, SidebarNav } from "./sidebar-nav";

afterEach(() => {
  cleanup();
  pathname = "/profissionais";
  params = new URLSearchParams();
});

describe("navegação desktop por áreas", () => {
  it("reduz os atalhos principais e identifica Equipe como área ativa", () => {
    render(<SidebarNav role="OWNER" collapsed unreadNotifications={3} />);
    expect(DESKTOP_AREAS).toHaveLength(8);
    expect(screen.getByRole("link", { name: "Equipe" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Notificações" })).toHaveAccessibleName("Notificações");
  });

  it("mostra colaboradores e jornadas no contexto de Equipe", () => {
    render(<DesktopContextNav role="OWNER" />);
    expect(screen.getByRole("navigation", { name: "Navegação de Equipe" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Colaboradores" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Jornadas e horários" })).toHaveAttribute("href", "/configuracoes#horarios");
  });

  it("expõe os segmentos de clientes como links diretos", () => {
    pathname = "/clientes";
    params = new URLSearchParams("segment=vip");
    render(<DesktopContextNav role="OWNER" />);
    expect(screen.getByRole("link", { name: "Clientes VIP" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Clientes inativos" })).toHaveAttribute("href", "/clientes?segment=lapsed");
  });
});
