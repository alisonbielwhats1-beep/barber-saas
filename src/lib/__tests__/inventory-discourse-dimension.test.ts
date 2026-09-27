import { describe, expect, it } from "vitest";
import { groundInventoryQuantity } from "../inventory-quantity";

const product = "Pomada Boreal";
const action = `some sete unidades de ${product}`;
const catalog = [{ id: "pomada", name: product }];
function check(preamble: string, extra: Partial<Parameters<typeof groundInventoryQuantity>[0]> = {}) {
  return groundInventoryQuantity({ source: `${preamble}: ${action}.`, source_scope: action,
    quantity: 7, literal: "sete unidades", product_names: [product], catalog, ...extra });
}

describe("explicit discourse counts are a factual dimension, not stock units", () => {
  it.each([
    "Há uma ação", "São duas ações", "Tenho três alterações", "Há quatro ajustes", "São cinco mudanças",
    "Tenho seis tarefas", "Há sete observações", "São oito anotações", "Tenho nove comentários",
    "Há dez instruções", "São onze recados", "Tenho doze ajustes para revisar",
    "Duas ações e três observações", "Um comentário, quatro alterações e nove anotações",
  ])("keeps the independent stock measure after %s", preamble => {
    expect(check(preamble)).toMatchObject({ status: "ACCEPTED", quantity: 7, basis: "EXPLICIT_UNIT" });
  });

  it.each([
    "Duas embalagens", "Três recipientes", "Quatro bombonas", "Cinco caixas", "Seis itens", "Sete coisas", "Oito unidades",
    "Duas ações e três embalagens", "Duas ações com três unidades", "Duas ações e 2.00 observações",
    "Duas ações com sete", "Duas ações por caixa", "Duas ações para cada embalagem", "Duas ações vezes três",
    "Duas vezes três ações", "O dobro de duas ações", "Metade de duas observações", "Duas ações/unidade",
    "No máximo duas ações", "Mais de duas ações", "Aproximadamente duas observações", "Entre duas e quatro ações",
    "Não são duas ações", "Nunca duas ações", "Nem duas observações", "Duas ações de unidades",
    "R$2 ações", "BRL 2 observações", "R$ 3 mudanças",
    "Duas ações pela caixa", "Duas ações pelo recipiente", "Duas observações pelos frascos", "Duas observações pelas embalagens",
  ])("cannot exempt a malformed, qualified, mixed or unknown dimension: %s", preamble => {
    expect(check(preamble).status).toBe("NEEDS_INPUT");
  });

  it("does not turn an abstract unit that is a catalog identity into metadata", () => {
    for (const name of ["Ações", "Observações", "Mudanças Premium"]) {
      const preamble = `Duas ${name}`;
      expect(check(preamble, { catalog: [...catalog, { id: "other", name }] }).status).toBe("NEEDS_INPUT");
    }
  });

  it("cannot mask a discourse count inside an operation or quantity witness", () => {
    const source = `Duas observações: ${action}.`;
    expect(check("Duas observações", { source_scope: source }).status).toBe("NEEDS_INPUT");
    expect(check("Duas observações", { quantity: 2, literal: "Duas observações" }).status).toBe("NEEDS_INPUT");
    expect(check("Duas observações", { operation_scopes: [{ key: "sibling", operation: "customer.create", literal: "Duas observações" }] }).status).toBe("NEEDS_INPUT");
  });

  it("cannot remove an intervening measure between the preamble and its action", () => {
    const source = `Duas observações: três embalagens, ${action}.`;
    expect(check("Duas observações", { source }).status).toBe("NEEDS_INPUT");
  });

  it("does not assert the stated number of observations equals graph cardinality", () => {
    expect(check("Tenho dez observações")).toMatchObject({ status: "ACCEPTED", quantity: 7 });
  });
});
