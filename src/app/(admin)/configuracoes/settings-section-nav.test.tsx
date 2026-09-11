// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsSectionNav } from "./settings-section-nav";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/configuracoes"); });
function setup() {
  return render(<SettingsSectionNav><section id="perfil"><input aria-label="Nome pessoal" defaultValue="Ana" /></section><section id="horarios"><p>Formulário de horários</p></section></SettingsSectionNav>);
}
describe("Configurações por tópico", () => {
  it("busca sem acento, abre um tópico e preserva alterações e busca ao voltar", () => {
    setup();
    expect(screen.getByLabelText("Nome pessoal")).not.toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "perfil" } });
    const link = screen.getByRole("link", { name: /Meu perfil/ });
    fireEvent.click(link);
    expect(screen.getByRole("heading", { name: "Meu perfil" })).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Nome pessoal"), { target: { value: "Ana Maria" } });
    fireEvent.click(screen.getByRole("button", { name: "Todas as configurações" }));
    expect(link).toHaveFocus();
    expect(screen.getByRole("searchbox")).toHaveValue("perfil");
    fireEvent.click(link);
    expect(screen.getByLabelText("Nome pessoal")).toHaveValue("Ana Maria");
    fireEvent.click(screen.getByRole("button", { name: "Todas as configurações" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "horario" } });
    expect(screen.getByRole("link", { name: /Horários de funcionamento/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Meu perfil/ })).not.toBeInTheDocument();
  });
  it("oferece recuperação da busca vazia", () => {
    setup(); fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyzxyz" } });
    expect(screen.getByRole("status")).toHaveTextContent("Nenhuma configuração encontrada");
    fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("link", { name: /Segurança e acessos/ })).toBeVisible();
  });
  it("respeita links antigos e navegação do navegador", () => {
    window.history.replaceState(null, "", "/configuracoes#jornadas"); setup();
    expect(screen.getByText("Formulário de horários")).toBeVisible();
    act(() => { window.history.replaceState(null, "", "/configuracoes"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByText("Formulário de horários")).not.toBeVisible();
    expect(screen.getByRole("searchbox")).toBeVisible();
  });
});
