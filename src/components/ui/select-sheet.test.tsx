// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectSheet } from "./select-sheet";
import { SegmentedControl } from "./segmented-control";

const options = [{ value: "FEMALE", label: "Feminino" }, { value: "MALE", label: "Masculino" }];
const original = window.matchMedia;
function phone(matches: boolean) {
  window.matchMedia = ((query: string) => ({ matches, media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}
afterEach(() => { cleanup(); window.matchMedia = original; });

describe("SelectSheet", () => {
  it("no computador continua um select nativo com nome e rótulo", () => {
    phone(false);
    render(<form><label htmlFor="g">Gênero</label><SelectSheet id="g" name="gender" title="Gênero" placeholder="Não informado" options={options} defaultValue="MALE" /></form>);
    const select = screen.getByRole("combobox", { name: "Gênero" });
    expect(select).toHaveValue("MALE");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Não informado", "Feminino", "Masculino"]);
  });

  it("no celular abre um painel; a escolha vai para o formulário e dispara change", async () => {
    phone(true);
    const user = userEvent.setup();
    const onFormChange = vi.fn();
    render(<form onChange={onFormChange}><label htmlFor="g">Gênero</label><SelectSheet id="g" name="gender" title="Gênero" placeholder="Não informado" options={options} /></form>);
    const trigger = screen.getByRole("button", { name: "Gênero" });
    expect(trigger).toHaveTextContent("Não informado");
    await user.click(trigger);
    const sheet = screen.getByRole("dialog", { name: "Gênero" });
    await user.click(within(sheet).getByRole("radio", { name: "Feminino" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveTextContent("Feminino");
    expect(new FormData(trigger.closest("form")!).get("gender")).toBe("FEMALE");
    expect(onFormChange).toHaveBeenCalled();
  });
});

describe("SegmentedControl", () => {
  it("marca a opção escolhida com aria-pressed e avisa a troca", () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Filtrar" value="a" onChange={onChange} options={[{ value: "a", label: "Em aberto 2" }, { value: "b", label: "Todos 3" }]} />);
    const group = screen.getByRole("group", { name: "Filtrar" });
    expect(within(group).getByRole("button", { name: "Em aberto 2" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Todos 3" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
