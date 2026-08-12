import { describe, expect, it } from "vitest";
import {
  calculateLoyaltyBalance,
  calculateRetentionMetrics,
  deriveCashState,
  parseClientCsv,
  summarizeCampaignDeliveries,
  validateStockAdjustment,
} from "../operational-flows";

describe("fluxos operacionais gratuitos", () => {
  it("mantem o caixa aberto ate existir um fechamento posterior", () => {
    const state = deriveCashState([
      { action: "CASH_OPENED", createdAt: new Date("2026-08-12T10:00:00Z"), metadata: { openingFloatCents: 15000 } },
      { action: "CASH_CLOSED", createdAt: new Date("2026-08-12T20:00:00Z"), metadata: { countedCashCents: 42000 } },
      { action: "CASH_OPENED", createdAt: new Date("2026-08-13T10:00:00Z"), metadata: { openingFloatCents: 20000 } },
    ]);

    expect(state).toEqual({
      isOpen: true,
      openedAt: new Date("2026-08-13T10:00:00Z"),
      openingFloatCents: 20000,
      lastClosedAt: new Date("2026-08-12T20:00:00Z"),
    });
  });

  it("nao permite resgatar mais pontos do que o cliente possui", () => {
    expect(calculateLoyaltyBalance({ completedVisits: 8, redeemedPoints: 3, rewardCost: 5 })).toEqual({
      earnedPoints: 8,
      redeemedPoints: 3,
      availablePoints: 5,
      canRedeem: true,
    });
    expect(calculateLoyaltyBalance({ completedVisits: 3, redeemedPoints: 1, rewardCost: 5 }).canRedeem).toBe(false);
  });

  it("impede ajuste que deixaria o estoque negativo", () => {
    expect(validateStockAdjustment({ currentStock: 4, delta: -3 })).toBe(1);
    expect(() => validateStockAdjustment({ currentStock: 2, delta: -3 })).toThrow("Estoque insuficiente");
    expect(() => validateStockAdjustment({ currentStock: 2, delta: 0 })).toThrow("quantidade");
  });

  it("resume destinatarios registrados por campanha", () => {
    expect(summarizeCampaignDeliveries([
      { campaignKey: "birthday", clientId: "c1", status: "OPENED" },
      { campaignKey: "birthday", clientId: "c1", status: "OPENED" },
      { campaignKey: "birthday", clientId: "c2", status: "COPIED" },
      { campaignKey: "review", clientId: "c3", status: "OPENED" },
    ])).toEqual({
      totalInteractions: 3,
      openedWhatsApp: 2,
      copied: 1,
      uniqueClients: 3,
      byCampaign: { birthday: 2, review: 1 },
    });
  });

  it("calcula retorno, intervalo medio e clientes inativos", () => {
    const metrics = calculateRetentionMetrics([
      { visits: [new Date("2026-08-10"), new Date("2026-07-10")] },
      { visits: [new Date("2026-08-01")] },
      { visits: [new Date("2026-04-01"), new Date("2026-03-01")] },
    ], new Date("2026-08-12"), 60);

    expect(metrics.returningClientRatePct).toBe(67);
    expect(metrics.averageDaysBetweenVisits).toBe(31);
    expect(metrics.lapsedClients).toBe(1);
  });

  it("importa CSV simples, normaliza contato e rejeita linhas sem nome", () => {
    const parsed = parseClientCsv("nome,telefone,email,aniversario\nAna,(11) 99999-0000,ana@email.com,1990-08-20\n,11988887777,,");
    expect(parsed.rows).toEqual([
      { name: "Ana", phone: "11999990000", email: "ana@email.com", birthday: "1990-08-20" },
    ]);
    expect(parsed.errors).toEqual([{ line: 3, message: "Nome obrigatorio" }]);
  });
});
