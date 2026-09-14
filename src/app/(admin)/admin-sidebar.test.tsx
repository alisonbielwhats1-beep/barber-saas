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
vi.mock("./sidebar-footer", () => ({ SidebarFooter: () => <div>Perfil</div> }));
vi.mock("./sidebar-nav", () => ({
  SidebarNav: ({ collapsed }: { collapsed: boolean }) => <div data-testid="main-navigation">{String(collapsed)}</div>,
  DesktopContextNav: () => <div data-testid="context-navigation" />,
}));

import { AdminSidebar } from "./admin-sidebar";

afterEach(cleanup);

describe("AdminSidebar", () => {
  it("entra recolhida e permite expansão explícita", () => {
    render(<AdminSidebar current={{ id: "salon-1", name: "Studio", role: "OWNER" }} memberships={[]} role="OWNER" plan="Pro" unreadNotifications={0} isPlatformAdmin={false} />);

    expect(screen.getByLabelText("Menu do estabelecimento")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("main-navigation")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "Expandir menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expandir menu" }));
    expect(screen.getByLabelText("Menu do estabelecimento")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByRole("button", { name: "Recolher menu" })).toBeInTheDocument();
  });
});
