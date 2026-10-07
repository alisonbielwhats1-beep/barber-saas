// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/brand", () => ({
  BrandLogo: () => <span>Everflare</span>,
  BrandMark: () => <span>EF</span>,
}));
vi.mock("./theme-toggle", () => ({ ThemeToggle: () => <button type="button">Tema</button> }));
vi.mock("./salon-switcher", () => ({ SalonSwitcher: () => <div>Salão</div> }));
vi.mock("./command-palette", () => ({ OpenCommandPaletteButton: () => <button type="button">Buscar</button> }));
vi.mock("./sidebar-footer", () => ({ SidebarFooter: ({ compact }: { compact: boolean }) => <div data-testid="footer">{String(compact)}</div> }));
vi.mock("./sidebar-nav", () => ({
  SidebarNav: () => <nav aria-label="Navegação principal" />,
}));

import { AdminSidebar } from "./admin-sidebar";

afterEach(cleanup);

function renderSidebar() {
  render(<AdminSidebar current={{ id: "salon-1", name: "Studio", role: "OWNER" }} memberships={[]} role="OWNER" plan="Pro" unreadNotifications={0} isPlatformAdmin={false} />);
  return screen.getByRole("complementary", { name: "Menu do estabelecimento" });
}

describe("AdminSidebar", () => {
  it("entra recolhida e permite expansão explícita", () => {
    const sidebar = renderSidebar();
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(sidebar).toHaveAttribute("data-variant", "floating");
    expect(screen.getByTestId("footer")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("button", { name: "Expandir menu" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("footer")).toHaveTextContent("false");
    expect(screen.getByRole("button", { name: "Recolher menu" })).toHaveAttribute("aria-expanded", "true");
  });

  it("alterna com Ctrl+B, exceto enquanto se digita", () => {
    const sidebar = renderSidebar();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar).toHaveAttribute("data-collapsed", "false");

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    input.remove();
  });
});
