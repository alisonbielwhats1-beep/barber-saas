// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminMobileHeader } from "./admin-mobile-header";

vi.mock("./theme-toggle", () => ({
  ThemeToggle: () => <button>Mudar tema</button>,
}));
afterEach(cleanup);
it("mostra Essencial e acesso à assinatura no topo do proprietário", () => {
  render(
    <AdminMobileHeader role="OWNER" plan="Essencial" planHref="/assinatura" />,
  );
  expect(
    screen.getByRole("region", { name: "Marca e aparência" }),
  ).toContainElement(
    screen.getByRole("link", { name: "Plano atual: Essencial. Alterar plano" }),
  );
  expect(screen.getByRole("link")).toHaveAttribute("href", "/assinatura");
  expect(screen.getByText("Essencial")).toBeVisible();
  expect(screen.getByText("Alterar plano")).toBeVisible();
  expect(screen.getByRole("img", { name: "Everflair" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Mudar tema" })).toBeVisible();
});
it("mantém Ativar plano e o destino seguro quando contratação está desligada", () => {
  render(
    <AdminMobileHeader
      role="OWNER"
      plan={null}
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
      <AdminMobileHeader role={role} plan="Essencial" planHref="/assinatura" />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mudar tema" })).toBeVisible();
  },
);
