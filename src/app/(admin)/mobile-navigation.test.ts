import { describe, expect, it } from "vitest";
import { mobileScreenFor, mobileTabsFor, moreGroupsFor } from "./mobile-navigation";

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
    // Clientes já é uma aba: seus filtros ficam na própria tela.
    expect(groups.map((group) => group.title)).not.toContain("Clientes");
    expect(groups.at(-1)).toEqual(expect.objectContaining({ title: "Ajustes" }));
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
