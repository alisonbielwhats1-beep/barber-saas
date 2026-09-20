// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormSection } from "./form-section";
afterEach(cleanup);
it("mantém campos complementares no payload ao recolher", () => {
  const submit=vi.fn();
  render(<form onSubmit={e=>{e.preventDefault();submit(new FormData(e.currentTarget).get("notes"));}}><FormSection title="Complementar"><label>Notas<input name="notes" defaultValue="preferência" /></label></FormSection><button>Salvar</button></form>);
  fireEvent.click(screen.getByText("Complementar"));
  fireEvent.change(screen.getByLabelText("Notas"),{target:{value:"atendimento silencioso"}});
  fireEvent.click(screen.getByText("Complementar"));
  fireEvent.click(screen.getByRole("button",{name:"Salvar"}));
  expect(submit).toHaveBeenCalledWith("atendimento silencioso");
});
it("abre o grupo quando um campo interno é inválido", () => {
  render(<FormSection title="Complementar"><label>Nome<input required /></label></FormSection>);
  fireEvent.invalid(screen.getByLabelText("Nome"));
  expect(screen.getByText("Complementar").closest("details")).toHaveAttribute("open");
});
