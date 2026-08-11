import { describe, expect, it } from "vitest";
import { calculateComandaTotals, normalizeProductLines } from "../comanda";

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
});
