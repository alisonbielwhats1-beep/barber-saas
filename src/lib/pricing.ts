import type {
  PricingAdjustmentType,
  PricingRuleTargetType,
} from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import { MAX_PUBLIC_BOOKING_LEAD_DAYS } from "./scheduling";
import { isDateKey, weekdayOfDateKey } from "./time";

export const MAX_PRICING_PERCENTAGE = 100;
export const MAX_PRICING_FIXED_CENTS = 100_000;

export type PricingRuleShape = {
  targetType: PricingRuleTargetType;
  targetKey: string;
  weekday: number | null;
  date: Date | null;
  label: string;
  adjustmentType: PricingAdjustmentType;
  adjustmentValue: number;
};

export type PriceableService = {
  priceCents: number;
};

export function effectivePublicBookingLeadDays(maxBookingLeadDays: number): number {
  return Math.min(MAX_PUBLIC_BOOKING_LEAD_DAYS, Math.max(1, maxBookingLeadDays));
}

export function pricingRuleKey(input: {
  targetType: PricingRuleTargetType;
  weekday?: number | null;
  date?: string | null;
}): string {
  if (input.targetType === "WEEKDAY") {
    if (!Number.isInteger(input.weekday) || input.weekday! < 0 || input.weekday! > 6) {
      throw new Error("Dia da semana inválido");
    }
    return `weekday:${input.weekday}`;
  }
  if (!input.date || !isDateKey(input.date)) throw new Error("Data inválida");
  return `date:${input.date}`;
}

function dateValue(dateKey: string): Date {
  // `ServicePricingRule.date` é uma coluna DATE; UTC evita que o driver mude
  // o dia ao serializar uma data local brasileira.
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export async function findPricingRule(
  tx: Tx,
  salonId: string,
  dateKey: string,
): Promise<PricingRuleShape | null> {
  if (!isDateKey(dateKey)) return null;
  const exact = await tx.servicePricingRule.findFirst({
    where: {
      salonId,
      active: true,
      targetType: "DATE",
      date: dateValue(dateKey),
    },
    select: {
      targetType: true,
      targetKey: true,
      weekday: true,
      date: true,
      label: true,
      adjustmentType: true,
      adjustmentValue: true,
    },
  });
  if (exact) return exact;

  const weekday = weekdayOfDateKey(dateKey);
  return tx.servicePricingRule.findFirst({
    where: {
      salonId,
      active: true,
      targetType: "WEEKDAY",
      weekday,
    },
    select: {
      targetType: true,
      targetKey: true,
      weekday: true,
      date: true,
      label: true,
      adjustmentType: true,
      adjustmentValue: true,
    },
  });
}

export function adjustedPriceCents(
  basePriceCents: number,
  rule: Pick<PricingRuleShape, "adjustmentType" | "adjustmentValue"> | null,
): number {
  if (!rule) return basePriceCents;
  if (rule.adjustmentType === "PERCENTAGE") {
    return Math.max(
      0,
      Math.round((basePriceCents * (100 + rule.adjustmentValue)) / 100),
    );
  }
  return Math.max(0, basePriceCents + rule.adjustmentValue);
}

export function applyPricing<T extends PriceableService>(
  services: T[],
  rule: Pick<PricingRuleShape, "adjustmentType" | "adjustmentValue"> | null,
): T[] {
  return services.map((service) => ({
    ...service,
    priceCents: adjustedPriceCents(service.priceCents, rule),
  }));
}

export async function priceServicesForDate<T extends PriceableService>(
  tx: Tx,
  input: { salonId: string; dateKey: string; services: T[] },
): Promise<{ services: T[]; rule: PricingRuleShape | null }> {
  const rule = await findPricingRule(tx, input.salonId, input.dateKey);
  return { services: applyPricing(input.services, rule), rule };
}

export function pricingRuleDescription(rule: PricingRuleShape): string {
  return rule.adjustmentType === "PERCENTAGE"
    ? `+${rule.adjustmentValue}%`
    : `+R$ ${(rule.adjustmentValue / 100).toFixed(2).replace(".", ",")}`;
}
