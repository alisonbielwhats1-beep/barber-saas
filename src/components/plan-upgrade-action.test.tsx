// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanUpgradeAction } from "./plan-upgrade-action";

const billing = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/billing/config", () => ({ billingEnabled: () => billing.enabled }));

beforeEach(() => {
  billing.enabled = true;
});
afterEach(cleanup);

describe("próximo passo nas telas bloqueadas do plano Grátis", () => {
  it("leva o proprietário para a assinatura", () => {
    render(<PlanUpgradeAction role="OWNER" />);
    expect(screen.getByRole("link", { name: "Ver planos pagos" })).toHaveAttribute("href", "/assinatura");
  });

  it("não envia o proprietário a um beco sem saída quando a contratação online está indisponível", () => {
    billing.enabled = false;
    const { container } = render(<PlanUpgradeAction role="OWNER" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["MANAGER", "RECEPTIONIST"])("orienta %s a falar com o proprietário, sem link para a assinatura", (role) => {
    render(<PlanUpgradeAction role={role} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Peça ao proprietário/)).toBeInTheDocument();
  });
});
