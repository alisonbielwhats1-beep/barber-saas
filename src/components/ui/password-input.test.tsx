// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PasswordInput } from "./password-input";

afterEach(cleanup);

describe("PasswordInput", () => {
  it("oculta a senha inicialmente e permite mostrar e ocultar novamente", () => {
    render(
      <PasswordInput
        id="password"
        name="password"
        label="Senha"
        autoComplete="current-password"
      />,
    );

    const input = screen.getByLabelText("Senha");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar senha" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("mantém a visibilidade independente entre senha e confirmação", () => {
    render(
      <>
        <PasswordInput id="password" name="password" label="Senha" />
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          label="Confirmar senha"
        />
      </>,
    );

    const [showPassword] = screen.getAllByRole("button", { name: "Mostrar senha" });
    fireEvent.click(showPassword);

    expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirmar senha")).toHaveAttribute(
      "type",
      "password",
    );
  });
});
