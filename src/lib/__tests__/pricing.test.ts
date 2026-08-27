import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import {
  MAX_PRICING_FIXED_CENTS,
  MAX_PRICING_PERCENTAGE,
  adjustedPriceCents,
  applyPricing,
  effectivePublicBookingLeadDays,
  findPricingRule,
  pricingRuleKey,
} from "../pricing";
import { MAX_PUBLIC_BOOKING_LEAD_DAYS } from "../scheduling";

describe("preço especial por data", () => {
  it("usa chaves estáveis e identifica domingo pelo fuso do calendário", () => {
    expect(pricingRuleKey({ targetType: "WEEKDAY", weekday: 0 })).toBe("weekday:0");
    expect(pricingRuleKey({ targetType: "DATE", date: "2026-08-30" })).toBe(
      "date:2026-08-30",
    );
    expect(() => pricingRuleKey({ targetType: "WEEKDAY", weekday: 7 })).toThrow();
    expect(() => pricingRuleKey({ targetType: "DATE", date: "2026-02-30" })).toThrow();
  });

  it("aplica acréscimo percentual ou fixo sem alterar o serviço original", () => {
    const services = [{ id: "cut", priceCents: 5_000 }];
    expect(adjustedPriceCents(5_000, {
      adjustmentType: "PERCENTAGE",
      adjustmentValue: 20,
    })).toBe(6_000);
    expect(adjustedPriceCents(5_000, {
      adjustmentType: "FIXED_CENTS",
      adjustmentValue: 750,
    })).toBe(5_750);
    expect(applyPricing(services, {
      adjustmentType: "PERCENTAGE",
      adjustmentValue: 10,
    })).toEqual([{ id: "cut", priceCents: 5_500 }]);
    expect(services).toEqual([{ id: "cut", priceCents: 5_000 }]);
  });

  it("prioriza a regra de data sobre a regra semanal", async () => {
    const exact = {
      targetType: "DATE" as const,
      targetKey: "date:2026-08-30",
      weekday: null,
      date: new Date("2026-08-30T00:00:00.000Z"),
      label: "Feriado",
      adjustmentType: "FIXED_CENTS" as const,
      adjustmentValue: 1_000,
    };
    const findFirst = vi.fn().mockResolvedValue(exact);
    const result = await findPricingRule(
      { servicePricingRule: { findFirst } } as unknown as Tx,
      "salon-a",
      "2026-08-30",
    );

    expect(result).toEqual(exact);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { targetType: "DATE", date: new Date("2026-08-30T00:00:00.000Z") },
    });
  });

  it("mantém a janela pública no máximo em 60 dias, mesmo com configuração antiga", () => {
    expect(MAX_PUBLIC_BOOKING_LEAD_DAYS).toBe(60);
    expect(effectivePublicBookingLeadDays(365)).toBe(60);
    expect(effectivePublicBookingLeadDays(60)).toBe(60);
    expect(effectivePublicBookingLeadDays(0)).toBe(1);
    expect(MAX_PRICING_PERCENTAGE).toBe(100);
    expect(MAX_PRICING_FIXED_CENTS).toBe(100_000);
  });
});
