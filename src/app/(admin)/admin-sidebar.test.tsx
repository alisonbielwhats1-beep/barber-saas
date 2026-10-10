// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/brand", () => ({
  BrandLogo: () => <span>Everflare</span>,
  BrandMark: () => <span>EF</span>,
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "Marina Souza" } } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/agenda" }));
vi.mock("./salon-switcher", () => ({ SalonSwitcher: () => <div>Salão</div> }));
vi.mock("./command-palette", () => ({ requestCommandPaletteOpen: vi.fn() }));
vi.mock("./sidebar-footer", () => ({ SidebarFooter: ({ compact }: { compact: boolean }) => <div data-testid="footer">{String(compact)}</div> }));
vi.mock("./sidebar-nav", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sidebar-nav")>()),
  SidebarNav: () => <nav aria-label="Navegação principal" />,
}));

import { AdminFrame, DesktopTopBar } from "./admin-sidebar";

afterEach(cleanup);

function renderFrame(defaultOpen?: boolean) {
  render(
    <AdminFrame defaultOpen={defaultOpen} current={{ id: "salon-1", name: "Studio", role: "OWNER" }} memberships={[]} role="OWNER" plan="Pro" unreadNotifications={2} isPlatformAdmin={false}>
      <DesktopTopBar unreadNotifications={2} plan={{ plan: "Essencial", status: null, tone: "neutral", href: "/assinatura" }} />
    </AdminFrame>,
  );
  return screen.getByRole("complementary", { name: "Menu do estabelecimento" });
}

describe("AdminFrame", () => {
  it("entra aberta, como no protótipo, e recolhe pelo botão do topo guardando a escolha", () => {
    const sidebar = renderFrame();
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(sidebar).toHaveAttribute("data-variant", "sidebar");
    expect(screen.getByTestId("footer")).toHaveTextContent("false");

    fireEvent.click(screen.getByRole("button", { name: "Recolher menu" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("footer")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "Expandir menu" })).toHaveAttribute("aria-expanded", "false");
    expect(document.cookie).toContain("admin-sidebar=collapsed");
  });

  it("respeita a preferência recolhida vinda do servidor", () => {
    const sidebar = renderFrame(false);
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
  });

  it("alterna com Ctrl+B, exceto enquanto se digita", () => {
    const sidebar = renderFrame();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar).toHaveAttribute("data-collapsed", "true");

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    input.remove();
  });

  it("topo mostra título da tela, plano, busca, notificações e a pessoa", () => {
    renderFrame();
    const bar = screen.getByRole("banner", { name: "Barra do painel" });
    expect(bar).toHaveTextContent("Agenda");
    expect(screen.getByRole("link", { name: "Plano atual: Essencial. Alterar plano" })).toHaveAttribute("href", "/assinatura");
    expect(screen.getByRole("button", { name: /^Buscar/ })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("link", { name: "Notificações, 2 não lidas" })).toHaveAttribute("href", "/notificacoes");
    expect(screen.getByRole("img", { name: "Marina Souza" })).toHaveTextContent("MS");
  });
});
