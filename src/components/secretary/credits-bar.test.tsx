// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { CreditsMeter, CreditsNotice } from "./credits-bar";
import { creditView, FREE_MONTHLY_UNITS, nextPoint } from "@/lib/secretary-credits-rules";

/** Owner decisions 06/10/2026: only a bar and a percentage for everyone (no amount, no number of requests, no days); a warning
 * below 20%; recharge only by the owner. */
afterEach(cleanup);
const left = (units: number) => creditView(nextPoint(nextPoint(null, "PURCHASE", 150_000), "USAGE", units - 150_000 || -1), FREE_MONTHLY_UNITS);

describe("the bar at the top of the chat", () => {
  it("shows only the percentage: never money, a count of requests or days", () => {
    render(createElement(CreditsMeter, { view: left(108_000) }));
    expect(screen.getByText("72%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("72");
    expect(document.body.textContent).not.toMatch(/R\$|pedido|dia/);
  });
});

describe("the notice", () => {
  it("nothing at 20% or more", () => {
    const { container } = render(createElement(CreditsNotice, { view: left(30_000), canRecharge: true }));
    expect(container.textContent).toBe("");
  });
  it("below 20%: a warning without amounts; the owner gets Recarregar, the team is told to ask the owner", () => {
    render(createElement(CreditsNotice, { view: left(29_000), canRecharge: true }));
    expect(screen.getByRole("status").textContent).toContain("O crédito da Secretária está acabando.");
    expect(screen.getByRole("link", { name: "Recarregar" }).getAttribute("href")).toBe("/assinatura#secretaria");
    cleanup();
    render(createElement(CreditsNotice, { view: left(29_000), canRecharge: false }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Peça ao dono para recarregar.");
    expect(document.body.textContent).not.toMatch(/\d/);
  });
  it("with nothing left: an alert that the agenda keeps working", () => {
    render(createElement(CreditsNotice, { view: creditView(null, FREE_MONTHLY_UNITS), canRecharge: true }));
    expect(screen.getByRole("alert").textContent).toContain("acabou. A agenda segue normal.");
  });
});
