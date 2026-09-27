import { describe, expect, it } from "vitest";
import { groundInventoryQuantity } from "../inventory-quantity";

const scope = "some sete unidades de Pomada Boreal";
const check = (source: string) => groundInventoryQuantity({ source, source_scope: scope, quantity: 7,
  literal: "sete unidades", product_names: ["Pomada Boreal"], catalog: [{ id: "pomada", name: "Pomada Boreal" }] });

describe("the original operator outside an action scope still governs its count", () => {
  it.each(["No máximo", "Mais de", "Aproximadamente", "Cerca de", "Pelo menos", "No mínimo", "Menos que", "Quase", "Até", "≤", "≥", "−"])("does not drop %s at an action boundary just because a verb separates it from the numeral", qualifier => {
    expect(check(`${qualifier}: ${scope}.`).status).toBe("NEEDS_INPUT");
  });
  it.each(["Entre três e quatro", "Aproximadamente seis", "Menos de dez"])("does not promote a qualified or competing numeric prelude: %s", qualifier => {
    expect(check(`${qualifier}: ${scope}.`).status).toBe("NEEDS_INPUT");
  });
  it.each(["Duas embalagens", "Três recipientes", "Quatro bombonas", "Cinco caixas"])("an unknown measure before a colon cannot disappear: %s", measure => {
    expect(check(`${measure}: ${scope}.`).status).toBe("NEEDS_INPUT");
  });
  it.each(["Tenho dez ajustes para revisar", "Tenho sete observações", "Antes atenda no máximo dois clientes; agora", "Estoque"])("keeps an independent exact quantity after %s", heading => {
    expect(check(`${heading}: ${scope}.`)).toMatchObject({ status: "ACCEPTED", quantity: 7 });
  });
});
