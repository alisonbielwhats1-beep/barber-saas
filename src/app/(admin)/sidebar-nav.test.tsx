// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimatedSidebar, AnimatedSidebarProvider } from "@/components/ui/animated-sidebar";

let pathname = "/profissionais";
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => params,
}));

import { DESKTOP_AREAS, SidebarNav } from "./sidebar-nav";

afterEach(() => {
  cleanup();
  pathname = "/profissionais";
  params = new URLSearchParams();
});

function renderNav({ open = true } = {}) {
  return render(
    <AnimatedSidebarProvider mobile={false} defaultOpen={open}>
      <AnimatedSidebar ariaLabel="Menu do estabelecimento">
        <SidebarNav role="OWNER" unreadNotifications={3} />
      </AnimatedSidebar>
    </AnimatedSidebarProvider>,
  );
}

describe("navegação por áreas", () => {
  it("mantém as áreas principais e identifica Equipe como área ativa", () => {
    renderNav({ open: false });
    expect(DESKTOP_AREAS).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Equipe" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Agenda" })).toHaveAttribute("href", "/agenda");
    // Recolhida, o submenu não existe: nada de aria-expanded/aria-controls órfão.
    expect(screen.getByRole("button", { name: "Equipe" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Equipe" })).not.toHaveAttribute("aria-controls");
    expect(screen.getByLabelText("3 notificações não lidas")).toBeInTheDocument();
  });

  it("abre o submenu da área atual com colaboradores e jornadas", () => {
    renderNav();
    const submenu = screen.getByRole("list", { name: "Navegação de Equipe" });
    expect(within(submenu).getByRole("link", { name: "Colaboradores" })).toHaveAttribute("aria-current", "page");
    expect(within(submenu).getByRole("link", { name: "Jornadas e horários" })).toHaveAttribute("href", "/configuracoes#horarios");
    expect(screen.getByRole("button", { name: "Equipe" })).toHaveAttribute("aria-expanded", "true");
  });

  it("expõe os segmentos de clientes como links diretos", () => {
    pathname = "/clientes";
    params = new URLSearchParams("segment=vip");
    renderNav();
    expect(screen.getByRole("link", { name: "Clientes VIP" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Clientes inativos" })).toHaveAttribute("href", "/clientes?segment=lapsed");
  });

  it("alterna submenus de outras áreas sem navegar", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: "Catálogo" }));
    expect(screen.getByRole("list", { name: "Navegação de Catálogo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pacotes e planos" })).toHaveAttribute("href", "/pacotes");
    await user.click(screen.getByRole("button", { name: "Catálogo" }));
    expect(screen.queryByRole("list", { name: "Navegação de Catálogo" })).toBeNull();
  });

  it("expande a barra recolhida ao escolher uma área com submenu", async () => {
    const user = userEvent.setup();
    renderNav({ open: false });
    expect(screen.queryByRole("list", { name: "Navegação de Equipe" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clientes" }));
    expect(screen.getByRole("complementary", { name: "Menu do estabelecimento" })).toHaveAttribute("data-state", "expanded");
    expect(screen.getByRole("list", { name: "Navegação de Clientes" })).toBeInTheDocument();
  });
});
