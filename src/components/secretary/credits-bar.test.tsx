// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { CreditsMeter, CreditsNotice } from "./credits-bar";
import { creditView, nextPoint } from "@/lib/secretary-credits-rules";

/** Owner decisions 06/10/2026: requests (never money) for everyone, a warning below 20%, recharge only by the owner. */
afterEach(cleanup);
const after = (used: number, bought = 185) => creditView(Array.from({ length: used }).reduce((p: ReturnType<typeof nextPoint>) => nextPoint(p, "USAGE", -1), nextPoint(null, "PURCHASE", bought)));

describe("the bar at the top of the chat", () => {
  it("shows the requests left and the percentage, never money", () => {
    render(createElement(CreditsMeter, { view: after(51) }));
    expect(screen.getByText("134 pedidos")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("72");
    expect(document.body.textContent).not.toContain("R$");
  });
  it("singular and never a negative number", () => {
    render(createElement(CreditsMeter, { view: after(184) }));
    expect(screen.getByText("1 pedido")).toBeTruthy();
    cleanup();
    render(createElement(CreditsMeter, { view: after(186) }));
    expect(screen.getByText("0 pedidos")).toBeTruthy();
  });
});

describe("the notice", () => {
  it("nothing at 20% or more", () => {
    const { container } = render(createElement(CreditsNotice, { view: after(148), canRecharge: true }));
    expect(container.textContent).toBe("");
  });
  it("below 20%: a warning; the owner gets Recarregar, the team is told to ask the owner", () => {
    render(createElement(CreditsNotice, { view: after(149), canRecharge: true }));
    expect(screen.getByRole("status").textContent).toContain("Restam 36 pedidos");
    expect(screen.getByRole("link", { name: "Recarregar" }).getAttribute("href")).toBe("/assinatura#secretaria");
    cleanup();
    render(createElement(CreditsNotice, { view: after(149), canRecharge: false }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Peça ao dono para recarregar.");
  });
  it("at zero: an alert that the agenda keeps working", () => {
    render(createElement(CreditsNotice, { view: after(185), canRecharge: true }));
    expect(screen.getByRole("alert").textContent).toContain("acabaram. A agenda segue normal.");
  });
});
