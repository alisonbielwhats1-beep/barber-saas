// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  deletePortfolioItem: vi.fn(async () => undefined),
}));

vi.mock("./actions", () => actionMocks);

import { DeleteButton } from "./delete-button";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DeleteButton", () => {
  it("pede confirmação acessível antes de remover uma foto", async () => {
    render(<DeleteButton id="portfolio-1" />);

    const trigger = screen.getByRole("button", { name: "Remover foto do portfólio" });
    expect(trigger).toHaveAttribute("title", "Remover foto do portfólio");
    expect(trigger).toHaveClass("min-h-11", "h-11", "w-11");

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Essa foto deixará de aparecer no portfólio público/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover foto" }));
    await waitFor(() => expect(actionMocks.deletePortfolioItem).toHaveBeenCalledWith("portfolio-1"));
  });
});
