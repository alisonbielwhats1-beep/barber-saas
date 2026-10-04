import { describe, expect, it } from "vitest";
import { singularProductQuery } from "../product-name-singular";

describe("product name in the singular (one more catalog search)", () => {
  it.each([
    ["Óleos Aurora", "Óleo Aurora"], ["cremes hidratantes", "creme hidratante"], ["Shampoos", "Shampoo"], ["luzes", "luz"],
    ["esmaltes cores", "esmalte cor"], ["loções", "loção"], ["géis fixadores", "gel fixador"], ["sais minerais", "sal mineral"],
    ["Óleo Aurora", "Óleo Aurora"], ["kit 2 em 1", "kit 2 em 1"], ["  Máscaras   Capilares ", "Máscara Capilar"],
  ])("%s → %s", (said, singular) => expect(singularProductQuery(said)).toBe(singular));
});
