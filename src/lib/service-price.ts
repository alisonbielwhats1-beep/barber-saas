import { formatMoney } from "./utils";

export const DEFAULT_PRICE_NOTE = "O valor pode ser maior conforme o comprimento e o volume do cabelo.";
export const PRICE_AGREEMENT_NOTE = "O preço final será combinado com você antes de iniciar o serviço.";
export type PriceDetails = { priceType?: string; priceNote?: string | null };

/** Legacy reservations remain fixed; never infer their terms from today's catalog. */
export function priceSnapshot(value: PriceDetails) {
  return value.priceType === "FROM"
    ? { priceType: "FROM" as const, priceNote: value.priceNote?.trim() || DEFAULT_PRICE_NOTE }
    : { priceType: "FIXED" as const, priceNote: null };
}

export function servicePriceLabel(value: PriceDetails & { priceCents: number }, currency = "BRL") {
  return `${value.priceType === "FROM" ? "A partir de " : ""}${formatMoney(value.priceCents, currency)}`;
}

export function hasVariablePrice(services: PriceDetails[]) {
  return services.some(service => service.priceType === "FROM");
}
