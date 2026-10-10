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

describe("SelectSheet: obrigatório e desligado", () => {
  const mirrorOf = (form: HTMLElement) => form.querySelector<HTMLSelectElement>('select[name="gender"]')!;

  it("no computador repassa required e disabled ao select nativo", () => {
    phone(false);
    render(<form><SelectSheet name="gender" title="Gênero" aria-label="Gênero" placeholder="Selecione" options={options} required disabled /></form>);
    const select = screen.getByRole("combobox", { name: "Gênero" });
    expect(select).toBeRequired();
    expect(select).toBeDisabled();
  });

  it("no celular o select espelho recebe required: o formulário só valida depois da escolha", async () => {
    phone(true);
    const user = userEvent.setup();
    render(<form aria-label="Cadastro"><SelectSheet name="gender" title="Gênero" aria-label="Gênero" placeholder="Selecione" options={options} required /></form>);
    const form = screen.getByRole("form", { name: "Cadastro" }) as HTMLFormElement;
    const mirror = mirrorOf(form);
    expect(mirror).toBeRequired();
    expect(mirror).not.toBeDisabled();
    expect(form.checkValidity()).toBe(false);
    // Obrigatório e vazio não pode ficar com `hidden`: o navegador não consegue focar um campo inválido oculto e travaria o envio sem aviso.
    expect(mirror).not.toHaveAttribute("hidden");
    expect(mirror).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("button", { name: "Gênero" }));
    await user.click(within(screen.getByRole("dialog", { name: "Gênero" })).getByRole("radio", { name: "Masculino" }));
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get("gender")).toBe("MALE");
  });

  it("no celular, sem required, o espelho continua oculto como antes", () => {
    phone(true);
    render(<form aria-label="Cadastro"><SelectSheet name="gender" title="Gênero" aria-label="Gênero" placeholder="Selecione" options={options} /></form>);
    const mirror = mirrorOf(screen.getByRole("form", { name: "Cadastro" }));
    expect(mirror).not.toBeRequired();
    expect(mirror).toHaveAttribute("hidden");
  });

  it("no celular, desligado: o espelho não vai no envio e o gatilho não abre o painel", async () => {
    phone(true);
    const user = userEvent.setup();
    render(<form aria-label="Cadastro"><SelectSheet name="gender" title="Gênero" aria-label="Gênero" options={options} defaultValue="MALE" disabled /></form>);
    const form = screen.getByRole("form", { name: "Cadastro" }) as HTMLFormElement;
    expect(mirrorOf(form)).toBeDisabled();
    expect(new FormData(form).has("gender")).toBe(false);
    const trigger = screen.getByRole("button", { name: "Gênero" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no celular, se o campo é desligado com o painel aberto, o painel fecha e não reabre ao religar", async () => {
    phone(true);
    const user = userEvent.setup();
    const field = (disabled: boolean) => <form aria-label="Cadastro"><SelectSheet name="gender" title="Gênero" aria-label="Gênero" options={options} disabled={disabled} /></form>;
    const view = render(field(false));
    await user.click(screen.getByRole("button", { name: "Gênero" }));
    expect(screen.getByRole("dialog", { name: "Gênero" })).toBeInTheDocument();
    view.rerender(field(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(field(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("o painel do seletor é sempre folha inferior, mesmo fora do padrão do painel do estabelecimento", async () => {
    phone(true);
    const user = userEvent.setup();
    render(<form><SelectSheet name="gender" title="Gênero" aria-label="Gênero" options={options} /></form>);
    await user.click(screen.getByRole("button", { name: "Gênero" }));
    expect(screen.getByRole("dialog", { name: "Gênero" })).toHaveAttribute("data-mobile-sheet", "true");
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
