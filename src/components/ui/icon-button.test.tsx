// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconButton } from "./icon-button";

describe("IconButton", () => {
  it("expõe nome acessível, tooltip e alvo mínimo de toque", () => {
    render(
      <IconButton label="Remover cliente">
        <span aria-hidden="true">×</span>
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "Remover cliente" });
    expect(button).toHaveAttribute("title", "Remover cliente");
    expect(button).toHaveClass("min-h-11", "min-w-11");
    expect(button).toHaveAttribute("type", "button");
  });
});
