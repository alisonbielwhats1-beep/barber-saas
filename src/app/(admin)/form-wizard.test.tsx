// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormWizard } from "./form-wizard";

afterEach(cleanup);
it("keeps values across steps and submits the complete payload only at the end", () => {
  const saved = vi.fn();
  render(<FormWizard labels={["Essencial", "Complementar"]} pending={false} error={null} submitLabel="Salvar" onSubmit={event => saved(Object.fromEntries(new FormData(event.currentTarget)))}>
    <div><label>Nome<input name="name" required /></label></div>
    <div><label>Observações<input name="notes" /></label></div>
  </FormWizard>);
  fireEvent.change(screen.getByLabelText("Nome"), {target: {value: "Ana"}});
  fireEvent.click(screen.getByRole("button", {name: "Continuar"}));
  expect(saved).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Observações"), {target: {value: "Preferência da cliente"}});
  fireEvent.click(screen.getByRole("button", {name: "Voltar"}));
  expect(screen.getByLabelText("Nome")).toHaveValue("Ana");
  fireEvent.click(screen.getByRole("button", {name: "Continuar"}));
  expect(screen.getByLabelText("Observações")).toHaveValue("Preferência da cliente");
  fireEvent.click(screen.getByRole("button", {name: "Salvar"}));
  expect(saved).toHaveBeenCalledExactlyOnceWith({name: "Ana", notes: "Preferência da cliente"});
});

it("does not skip an invalid required field or write on Enter in an intermediate step", () => {
  const saved = vi.fn();
  render(<FormWizard labels={["Básico", "Venda"]} pending={false} error={null} submitLabel="Salvar" onSubmit={saved}>
    <div><label>Nome<input name="name" required /></label></div>
    <div><label>Preço<input name="price" type="number" min="0" required /></label></div>
  </FormWizard>);
  fireEvent.click(screen.getByRole("button", {name: "Continuar"}));
  expect(screen.getByLabelText("Nome")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Nome"), {target: {value: "Produto"}});
  fireEvent.submit(screen.getByLabelText("Nome").closest("form")!);
  expect(screen.getByLabelText("Preço")).toBeVisible();
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Salvar"}));
  expect(saved).not.toHaveBeenCalled();
});
