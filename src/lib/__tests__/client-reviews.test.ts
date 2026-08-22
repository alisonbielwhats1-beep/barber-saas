import { describe, expect, it } from "vitest";
import {
  buildReviewSummary,
  clientReviewInputSchema,
  formatReviewClientName,
} from "../reviews";

describe("avaliações de clientes", () => {
  it("calcula média, contagem e distribuição sem inventar nota quando não há avaliações", () => {
    expect(buildReviewSummary([])).toEqual({
      average: 0,
      count: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    expect(buildReviewSummary([5, 4, 4, 1])).toEqual({
      average: 3.5,
      count: 4,
      distribution: { 1: 1, 2: 0, 3: 0, 4: 2, 5: 1 },
    });
  });

  it("normaliza o nome público para não expor telefone ou e-mail", () => {
    expect(formatReviewClientName("Alison Barbosa da Silva")).toBe("Alison S.");
    expect(formatReviewClientName("  Simone  ")).toBe("Simone");
    expect(formatReviewClientName(" ")).toBe("Cliente");
  });

  it("aceita nota inteira de 1 a 5 e limita comentários", () => {
    expect(clientReviewInputSchema.parse({
      appointmentId: "appt-1",
      rating: "5",
      comment: "Excelente atendimento",
    })).toEqual({ appointmentId: "appt-1", rating: 5, comment: "Excelente atendimento" });
    expect(clientReviewInputSchema.safeParse({ appointmentId: "appt-1", rating: 0 }).success).toBe(false);
    expect(clientReviewInputSchema.safeParse({ appointmentId: "appt-1", rating: 6 }).success).toBe(false);
    expect(clientReviewInputSchema.safeParse({ appointmentId: "appt-1", rating: 5, comment: "x".repeat(501) }).success).toBe(false);
  });
});
