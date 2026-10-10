import { describe, expect, it } from "vitest";
import { mobileScreenFor, mobileTabsFor, moreGroupsFor } from "./mobile-navigation";
import { CONTEXT_AREAS } from "./sidebar-nav";

describe("navegação de aplicativo do painel", () => {
  it("mostra no máximo quatro abas além do Mais e esconde Hoje de quem não tem acesso", () => {
    expect(mobileTabsFor("OWNER").map((tab) => tab.label)).toEqual(["Hoje", "Agenda", "Clientes", "Avisos"]);
    expect(mobileTabsFor("PROFESSIONAL").map((tab) => tab.label)).toEqual(["Agenda", "Clientes", "Avisos"]);
  });

  it("lista cada módulo uma vez no Mais, na área dona do caminho", () => {
    const groups = moreGroupsFor("OWNER", false);
    const hrefs = groups.flatMap((group) => group.links.map((link) => link.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(groups.find((group) => group.title === "Equipe")?.links.map((link) => link.label)).not.toContain("Serviços da equipe");
    expect(groups.find((group) => group.title === "Catálogo")?.links.map((link) => link.label)).toContain("Serviços");
    expect(groups.at(-1)).toEqual(expect.objectContaining({ title: "Ajustes" }));
  });

  it("devolve os atalhos de Clientes ao Mais, sem repetir a aba, com os mesmos destinos da barra lateral", () => {
    const clientes = moreGroupsFor("OWNER", false).find((group) => group.title === "Clientes");
    expect(clientes?.links.map((link) => [link.label, link.href])).toEqual([
      ["Clientes VIP", "/clientes?segment=vip"],
      ["Aniversariantes", "/clientes?segment=birthday"],
      ["Clientes inativos", "/clientes?segment=lapsed"],
      ["Clientes recorrentes", "/clientes?segment=recurring"],
      ["Cadastros excluídos", "/clientes?status=excluded"],
    ]);
    // "Lista de clientes" é a própria aba Clientes.
    expect(clientes?.links.map((link) => link.href)).not.toContain("/clientes");
    // Cada atalho tem ícone próprio, não o genérico da área.
    expect(new Set(clientes?.links.map((link) => link.icon)).size).toBe(clientes?.links.length);
    // Os mesmos destinos existem na barra lateral do computador (uma só fonte).
    const sidebar = CONTEXT_AREAS.find((area) => area.title === "Clientes")!.links.map((link) => link.href);
    for (const link of clientes!.links) expect(sidebar).toContain(link.href);
  });

  it("'Cadastros excluídos' é só do dono, como na barra lateral; os demais papéis seguem vendo os grupos", () => {
    const labelsFor = (role: string) => moreGroupsFor(role, false).find((group) => group.title === "Clientes")?.links.map((link) => link.label) ?? [];
    expect(labelsFor("OWNER")).toContain("Cadastros excluídos");
    for (const role of ["MANAGER", "RECEPTIONIST", "PROFESSIONAL"]) {
      expect(labelsFor(role)).not.toContain("Cadastros excluídos");
      expect(labelsFor(role)).toEqual(["Clientes VIP", "Aniversariantes", "Clientes inativos", "Clientes recorrentes"]);
    }
    // Plataforma não muda o gate: ser administrador global não dá "Excluídos" a quem não é dono.
    expect(moreGroupsFor("MANAGER", true).find((group) => group.title === "Clientes")?.links.map((link) => link.label)).not.toContain("Cadastros excluídos");
  });

  it("respeita os papéis: profissional não vê resultados nem ajustes; administração só para a plataforma", () => {
    const professional = moreGroupsFor("PROFESSIONAL", false).map((group) => group.title);
    expect(professional).not.toContain("Resultados");
    expect(professional).not.toContain("Ajustes");
    expect(moreGroupsFor("OWNER", true).at(-1)?.links.map((link) => link.label)).toContain("Administração");
    expect(moreGroupsFor("OWNER", false).at(-1)?.links.map((link) => link.label)).not.toContain("Administração");
  });

  it("dá título à barra superior e diferencia abas de telas filhas", () => {
    expect(mobileScreenFor("/clientes")).toEqual({ title: "Clientes", isTabRoot: true });
    expect(mobileScreenFor("/notificacoes")).toEqual({ title: "Notificações", isTabRoot: true });
    expect(mobileScreenFor("/financeiro")).toEqual({ title: "Financeiro", isTabRoot: false });
    expect(mobileScreenFor("/dashboard")).toEqual({ title: "Resultados", isTabRoot: false });
    expect(mobileScreenFor("/configuracoes")).toEqual({ title: "Configurações", isTabRoot: false });
  });
});
