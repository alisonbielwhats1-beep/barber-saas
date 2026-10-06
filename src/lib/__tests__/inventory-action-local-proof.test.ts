import { describe, expect, it } from "vitest";
import { decodeInventoryQuantityPayload } from "../../../packages/salon-secretary/src/inventory-skill";
import fixture from "../../test/fixtures/secretary-real-wire-holdout-v2-v208-inventory.json";
import { groundInventoryQuantity } from "../inventory-quantity";
import { inventorySourceScopes } from "../inventory-source-scope";

const product = "Loção de Cedro";
const catalog = [{ id: "cedro", name: product }];
function check(source: string, scope: string, extra: Partial<Parameters<typeof groundInventoryQuantity>[0]> = {}) {
  return groundInventoryQuantity({ source, source_scope: scope, quantity: 3, literal: "três unidades", product_names: [product], catalog, ...extra });
}

describe("inventory proof is local to its action and retains original factual context", () => {
  it("replays the exact accepted V208 transport without changing its quantity or envelope", () => {
    const first = fixture.provider_observations[0];
    const repaired = fixture.provider_observations[1];
    const source = fixture.turns[0].source;
    const original = JSON.parse(first.output[0].arguments);
    const wire = JSON.parse(repaired.output[0].arguments);
    const before = original.turn.operations.find((op: { operation: string }) => op.operation === "stock.movement");
    const after = wire.turn.operations.find((op: { operation: string }) => op.operation === "stock.movement");
    expect(before.inventory).toEqual(after.inventory);
    expect(source.includes(before.source_scope)).toBe(false);
    expect(source.includes(after.source_scope)).toBe(true);
    const decoded = decodeInventoryQuantityPayload(wire, true) as { turn: { operations: Array<{ operation: string; item_key: string; source_scope: string; inventory?: { product_name: string; quantity: number; quantity_evidence: string; reason: string } }> } };
    const op = decoded.turn.operations.find(value => value.operation === "stock.movement")!;
    const inventory = op.inventory!;
    expect(groundInventoryQuantity({ source, source_scope: op.source_scope, quantity: inventory.quantity, literal: inventory.quantity_evidence,
      product_names: [inventory.product_name], reason: inventory.reason, catalog: [{ id: "observed", name: inventory.product_name }],
      operation_scopes: decoded.turn.operations.filter(value => value !== op).map(value => ({ key: value.item_key, operation: value.operation, literal: value.source_scope }))
    })).toMatchObject({ status: "ACCEPTED", quantity: 3, basis: "EXPLICIT_UNIT" });
  });

  it.each([1, 2, 5, 10])("keeps a proved measure with introductory cardinality and %i independent actions", count => {
    const own = `soma três unidades de ${product}`;
    const siblings = Array.from({ length: count - 1 }, (_, index) => ({ key: `service${index}`, operation: "service.change", literal: `Serviço ${String.fromCharCode(65 + index)} a R$${40 + index}` }));
    for (const actions of [[own, ...siblings.map(value => value.literal)], [...siblings.map(value => value.literal), own]]) {
      const source = `Tenho ${count} ajustes para revisar: ${actions.join("; ")}.`;
      expect(check(source, own, { operation_scopes: siblings })).toMatchObject({ status: "ACCEPTED", quantity: 3 });
    }
  });

  it.each(["pelo atendimento", "pela reposição", "pelos atendimentos", "pelas reposições", "por solicitação interna", "para uso interno", "porque a equipe pediu"])('accepts the causal grammatical class without interpreting its business text: %s', reason => {
    const source = `Entraram três unidades de ${product} ${reason}.`;
    expect(check(source, source, { reason })).toMatchObject({ status: "ACCEPTED", quantity: 3 });
  });

  it("an unrelated, unproved sibling boundary neither masks text nor vetoes an independent measure", () => {
    const own = `Entraram três unidades de ${product}`;
    const source = `Quero rever Serviço Solar a R$51; ${own}.`;
    const others = [{ key: "service", operation: "service.change", literal: "Serviço Solar a R$51" }];
    const scopes = inventorySourceScopes(source, { scope: own, others });
    expect(scopes.valid).toBe(true);
    if (scopes.valid) expect(scopes.siblings).toEqual([]);
    expect(check(source, own, { operation_scopes: others })).toMatchObject({ status: "ACCEPTED", quantity: 3 });
  });

  it.each([
    ["Não: entraram três unidades de Loção de Cedro.", "entraram três unidades de Loção de Cedro"],
    ["Até: três unidades de Loção de Cedro.", "três unidades de Loção de Cedro"],
    ["Chegaram duas caixas com três unidades de Loção de Cedro.", "três unidades de Loção de Cedro"],
    ["Duas caixas: três unidades de Loção de Cedro.", "três unidades de Loção de Cedro"],
    ["Duas vezes: três unidades de Loção de Cedro.", "três unidades de Loção de Cedro"],
    ["Duas x três unidades de Loção de Cedro.", "três unidades de Loção de Cedro"],
    ["Entraram três unidades de Loção de Cedro Premium.", "Entraram três unidades de Loção de Cedro"],
    ["Entraram três unidades de Loção de Cedro.", "Entraram três unidades"],
  ])("an action scope cannot clip original qualifiers, factors or identity: %s", (source, scope) => {
    expect(check(source, scope).status).toBe("NEEDS_INPUT");
  });

  it.each(["por caixa", "pela caixa", "pelas caixas", "pelo litro", "pelos serviços", "para cada caixa", "Premium"])('a reason role cannot consume a unit, factor or unproved variant: %s', reason => {
    const source = `Entraram três unidades de ${product} ${reason}.`;
    expect(check(source, source, { reason }).status).toBe("NEEDS_INPUT");
  });

  it("a complete catalog identity takes precedence over a causal-looking suffix", () => {
    const reason = "para Barba", source = `Entraram três unidades de ${product} ${reason}.`;
    expect(check(source, source, { reason, catalog: [...catalog, { id: "variant", name: `${product} ${reason}` }] })).toMatchObject({ status: "NEEDS_INPUT", identity_status: "CONFLICT" });
  });

  it("a sibling cannot consume the current measure or its attached identity", () => {
    const source = `Entraram três unidades de ${product} Premium.`;
    expect(check(source, `Entraram três unidades de ${product}`, { operation_scopes: [{ key: "fake", operation: "service.change", literal: "Premium." }] }).status).toBe("NEEDS_INPUT");
    expect(check(source, source, { operation_scopes: [{ key: "fake", operation: "service.change", literal: source }] }).status).toBe("NEEDS_INPUT");
  });
});
