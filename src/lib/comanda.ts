export type ProductLineInput = { productId: string; quantity: number };
export type PricedProductLine = { quantity: number; priceCentsUnit: number };

export function normalizeProductLines(lines: ProductLineInput[]): ProductLineInput[] {
  const quantities = new Map<string, number>();

  for (const line of lines) {
    const productId = line.productId.trim();
    if (!productId) throw new Error("Produto invalido");
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new Error("Quantidade de produto invalida");
    }
    if (line.quantity === 0) continue;
    quantities.set(productId, (quantities.get(productId) ?? 0) + line.quantity);
  }

  return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export function calculateComandaTotals(input: {
  serviceCents: number;
  productLines: PricedProductLine[];
  discountCents: number;
}) {
  const serviceCents = Math.max(0, Math.round(input.serviceCents));
  const productsCents = input.productLines.reduce(
    (sum, line) => sum + Math.max(0, Math.round(line.quantity)) * Math.max(0, Math.round(line.priceCentsUnit)),
    0,
  );
  const subtotalCents = serviceCents + productsCents;
  const discountCents = Math.min(subtotalCents, Math.max(0, Math.round(input.discountCents)));
  return {
    serviceCents,
    productsCents,
    subtotalCents,
    discountCents,
    totalCents: Math.max(0, subtotalCents - discountCents),
  };
}
