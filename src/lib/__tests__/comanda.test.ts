import { describe, expect, it } from "vitest";
import {
  calculateComandaTotals,
  normalizeProductLines,
  reconcileReservedProduct,
} from "../comanda";

describe("comanda interna", () => {
  it("agrupa produtos repetidos e remove linhas zeradas", () => {
    expect(
      normalizeProductLines([
        { productId: "pomada", quantity: 1 },
        { productId: "pomada", quantity: 2 },
        { productId: "shampoo", quantity: 0 },
      ]),
    ).toEqual([{ productId: "pomada", quantity: 3 }]);
  });

  it("rejeita quantidade fracionada ou negativa", () => {
    expect(() => normalizeProductLines([{ productId: "p1", quantity: -1 }])).toThrow();
    expect(() => normalizeProductLines([{ productId: "p1", quantity: 1.5 }])).toThrow();
  });

  it("calcula servicos, produtos, desconto e total sem permitir valor negativo", () => {
    expect(
      calculateComandaTotals({
        serviceCents: 9000,
        productLines: [
          { quantity: 2, priceCentsUnit: 2500 },
          { quantity: 1, priceCentsUnit: 1500 },
        ],
        discountCents: 2000,
      }),
    ).toEqual({ serviceCents: 9000, productsCents: 6500, subtotalCents: 15500, discountCents: 2000, totalCents: 13500 });

    expect(
      calculateComandaTotals({
        serviceCents: 1000,
        productLines: [],
        discountCents: 5000,
      }).totalCents,
    ).toBe(0);
  });

  it("preserva snapshots reservados e usa preço atual apenas no acréscimo", () => {
    expect(reconcileReservedProduct({
      reserved: [
        { quantity: 1, priceCentsUnit: 700 },
        { quantity: 1, priceCentsUnit: 800 },
      ],
      desiredQuantity: 3,
      currentPriceCents: 1_500,
    })).toEqual({
      reservedQuantity: 2,
      additionalQuantity: 1,
      stockDelta: -1,
      pricedLines: [
        { quantity: 1, priceCentsUnit: 700 },
        { quantity: 1, priceCentsUnit: 800 },
        { quantity: 1, priceCentsUnit: 1_500 },
      ],
      totalCents: 3_000,
    });
  });

  it("devolve somente a parte removida e mantém o snapshot retido", () => {
    expect(reconcileReservedProduct({
      reserved: [{ quantity: 2, priceCentsUnit: 900 }],
      desiredQuantity: 1,
      currentPriceCents: 9_999,
    })).toEqual({
      reservedQuantity: 2,
      additionalQuantity: 0,
      stockDelta: 1,
      pricedLines: [{ quantity: 1, priceCentsUnit: 900 }],
      totalCents: 900,
    });
  });
});
