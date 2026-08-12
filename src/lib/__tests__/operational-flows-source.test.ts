import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("superficies dos novos fluxos operacionais", () => {
  it("habilita pagamentos na navegacao e oferece abertura e fechamento de caixa", () => {
    const sidebar = source("src/app/(admin)/sidebar-nav.tsx");
    const payments = source("src/app/(admin)/pagamentos/page.tsx");
    expect(sidebar).toContain('{ href: "/pagamentos", label: "Pagamentos", icon: CreditCard, roles: FINANCIAL_ROLES }');
    expect(payments).toContain("Abertura e fechamento");
    expect(payments).toContain("Recebimentos recentes");
  });

  it("mostra historico de campanhas e registra interacao manual", () => {
    const page = source("src/app/(admin)/marketing/page.tsx");
    const actions = source("src/app/(admin)/marketing/actions.ts");
    expect(page).toContain("Histórico de campanhas");
    expect(actions).toContain("recordCampaignInteraction");
  });

  it("rastreia movimentacoes de estoque com motivo", () => {
    const actions = source("src/app/(admin)/produtos/actions.ts");
    const catalog = source("src/app/(admin)/produtos/products-catalog.tsx");
    expect(actions).toContain("STOCK_ADJUSTED");
    expect(catalog).toContain("Movimentar estoque");
    expect(catalog).toContain("Motivo");
  });

  it("permite resgatar recompensa e importar clientes", () => {
    const clients = source("src/app/(admin)/clientes/clients-crm.tsx");
    const actions = source("src/app/(admin)/clientes/actions.ts");
    expect(clients).toContain("Resgatar recompensa");
    expect(actions).toContain("importClientsCsv");
    expect(actions).toContain("redeemLoyaltyReward");
  });
});
