// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminMobileHeader } from "./admin-mobile-header";

vi.mock("./command-palette", () => ({ requestCommandPaletteOpen: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/hoje" }));
afterEach(cleanup);
const legacy = { plan: "Essencial", status: null, tone: "neutral" as const };
it("mostra Essencial e acesso à assinatura no topo do proprietário", () => {
  render(
    <AdminMobileHeader role="OWNER" plan={legacy} planHref="/assinatura" unreadNotifications={3} />,
  );
  const header = screen.getByRole("region", { name: "Marca, busca e notificações" });
  expect(header).toContainElement(
    screen.getByRole("link", { name: "Plano atual: Essencial. Alterar plano" }),
  );
  expect(screen.getByRole("link", { name: "Plano atual: Essencial. Alterar plano" })).toHaveAttribute("href", "/assinatura");
  expect(screen.getByText("Essencial")).toBeVisible();
  expect(screen.getByText("Alterar plano")).toBeVisible();
  expect(screen.getByRole("img", { name: "Everflair" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Buscar" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Notificações, 3 não lidas" })).toHaveAttribute("href", "/notificacoes");
});
it("mostra a situação real da contratação em vez de um plano ativo", () => {
  render(
    <AdminMobileHeader
      role="OWNER"
      plan={{ plan: "Equipe · 5 agendas", status: "Aguardando pagamento", tone: "warn" }}
      planHref="/assinatura"
    />,
  );
  const link = screen.getByRole("link", {
    name: "Plano: Equipe · 5 agendas. Situação: Aguardando pagamento. Abrir plano e assinatura",
  });
  expect(link).toHaveAttribute("href", "/assinatura");
  expect(link).toHaveTextContent("Aguardando pagamento");
  expect(screen.queryByText("Alterar plano")).toBeNull();
});
it("mantém Ativar plano e o destino seguro quando contratação está desligada", () => {
  render(
    <AdminMobileHeader
      role="OWNER"
      plan={{ plan: null, status: null, tone: "neutral" }}
      planHref="/configuracoes#plano"
    />,
  );
  expect(screen.getByRole("link", { name: "Ativar plano" })).toHaveAttribute(
    "href",
    "/configuracoes#plano",
  );
});
it.each(["MANAGER", "RECEPTIONIST", "PROFESSIONAL"])(
  "não oferece gestão de cobrança para %s",
  (role) => {
    render(
      <AdminMobileHeader role={role} plan={legacy} planHref="/assinatura" />,
    );
    expect(screen.queryByRole("link", { name: /plano/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notificações" })).toHaveAttribute("href", "/notificacoes");
    expect(screen.getByRole("button", { name: "Buscar" })).toBeVisible();
  },
);
