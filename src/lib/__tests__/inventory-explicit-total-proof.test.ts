import { describe, expect, it } from "vitest";
import { decodeInventoryQuantityPayload } from "../../../packages/salon-secretary/src/inventory-skill";
import fixture from "../../test/fixtures/secretary-real-wire-holdout-v2-v223-inventory.json";
import { groundInventoryQuantity } from "../inventory-quantity";

const now = new Date("2028-06-12T12:00:00Z");
const context = { draft_ref: "existing", draft_revision: 1, product_ref: "spray", product_revision: "a".repeat(64), unit: "un" as const,
  expires_at: "2028-06-12T12:30:00Z", requested_field: "quantity" as const, published_question: "O estoque é contado em unidades. Quantas unidades ao todo?" };
const check = (source: string, quantity = 12) => groundInventoryQuantity({ source, literal: source, source_scope: source, quantity,
  product_names: ["Spray Brisa"], catalog: [{ id: "spray", name: "Spray Brisa" }, { id: "other", name: "Óleo Solar" }], context, now,
  reference: { kind: "CURRENT_FIELD", literal: null } });

describe("an explicit total belongs to its own literal measure, before or after it", () => {
  it("replays V223's unchanged final provider output against the existing pending quantity", () => {
    const original = JSON.parse(fixture.provider_observations[1].output[0].arguments);
    const repaired = JSON.parse(fixture.provider_observations[2].output[0].arguments);
    expect(repaired.turn.operations[0].fields.inventory).toEqual(original.turn.operations[0].fields.inventory);
    const fields = (decodeInventoryQuantityPayload(repaired, true) as { turn: { operations: Array<{ fields: { source_scope: string; inventory: { quantity: number; quantity_evidence: string } } }> } }).turn.operations[0].fields;
    expect(groundInventoryQuantity({ source: fixture.turns[1].source, source_scope: fields.source_scope, literal: fields.inventory.quantity_evidence,
      quantity: fields.inventory.quantity, product_names: ["Spray Brisa"], catalog: [{ id: "spray", name: "Spray Brisa" }], context, now,
      reference: { kind: "CURRENT_FIELD", literal: null } })).toMatchObject({ status: "ACCEPTED", quantity: 12 });
  });
  it.each([
    "Cada pacote tem quatro, são doze unidades ao todo.",
    "Cada pacote contém quatro, são doze unidades no total.",
    "Vieram três pacotes com quatro unidades, doze unidades ao todo.",
    "Cada pacote contém quatro, no total são doze unidades.",
    "Total de doze unidades, cada pacote contém quatro.",
    "Cada pacote tem quatro, são doze unidades de Spray Brisa ao todo.",
    "São doze unidades ao todo, cada embalagem possui três.",
    "São doze unidades ao todo, cada recipiente contém três.",
    "São doze unidades ao todo, cada agrupamento tem três.",
  ])("accepts a supplied total without deriving it from packaging: %s", source => {
    expect(check(source)).toMatchObject({ status: "ACCEPTED", quantity: 12 });
  });
  it.each([
    ["Cada pacote tem quatro, são doze unidades ao todo.", 4],
    ["Cada pacote tem quatro, são doze unidades.", 12],
    ["Não são doze unidades ao todo.", 12],
    ["São cerca de doze unidades ao todo.", 12],
    ["São doze unidades por caixa no total.", 12],
    ["São doze caixas ao todo.", 12],
    ["São doze unidades de Óleo Solar ao todo.", 12],
    ["São doze unidades, vinte unidades ao todo.", 12],
    ["São doze unidades ao todo de Spray Brisa Premium.", 12],
  ] as const)("cannot promote a factor, qualifier, other entity or another atom's total: %s", (source, quantity) => {
    expect(check(source, quantity).status).toBe("NEEDS_INPUT");
  });
});
