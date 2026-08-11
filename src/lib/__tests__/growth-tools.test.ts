import { describe, expect, it } from "vitest";
import {
  buildManualPixMessage,
  buildReferralMessage,
  loyaltyProgress,
} from "../growth-tools";

describe("ferramentas de crescimento sem integracao paga", () => {
  it.each([
    [0, "Novo", "Bronze", 1],
    [1, "Bronze", "Prata", 2],
    [3, "Prata", "Ouro", 5],
    [8, "Ouro", "Diamante", 8],
    [16, "Diamante", null, 0],
  ] as const)(
    "calcula progresso de fidelidade para %i visitas",
    (visits, currentTier, nextTier, remaining) => {
      expect(loyaltyProgress(visits)).toMatchObject({
        points: visits,
        currentTier,
        nextTier,
        remaining,
      });
    },
  );

  it("gera pedido de sinal Pix deixando claro que a conferencia e manual", () => {
    const message = buildManualPixMessage({
      salonName: "Studio Martinelli",
      pixKey: "pix@studio.com",
      amountCents: 3000,
      bookingUrl: "https://example.com/book/studio",
    });

    expect(message).toContain("R$ 30,00");
    expect(message).toContain("pix@studio.com");
    expect(message).toContain("confirmacao manual");
    expect(message).toContain("https://example.com/book/studio");
  });

  it("gera mensagem de indicacao com nome e link do estabelecimento", () => {
    expect(
      buildReferralMessage({
        salonName: "Studio Martinelli",
        bookingUrl: "https://example.com/book/studio",
      }),
    ).toContain("Studio Martinelli");
  });
});
