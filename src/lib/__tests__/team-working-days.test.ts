import { expect, it, vi } from "vitest";
import { getTeamPerformance } from "../team";
import type { Tx } from "../prisma-tenant";

it("conta dias distintos da equipe, sem contar manhã e tarde como dois dias", async () => {
  const tx = {
    professional: { findMany: vi.fn().mockResolvedValue([{ id: "pro-a", active: true, user: { name: "Alex Teste", email: "alex@example.test", avatarUrl: null }, services: [], commissionPct: 0, monthlyGoalCents: 0,
      workingHours: [2, 3, 4, 5, 6].flatMap(weekday => [{ weekday, startMinutes: 360, endMinutes: 750 }, { weekday, startMinutes: 900, endMinutes: 1260 }]),
    }]) },
    appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
  };
  const result = await getTeamPerformance(tx as unknown as Tx, "salon-a", "America/Sao_Paulo");
  expect(result.pros[0].workingDays).toBe(5);
  expect(result.pros[0].workingHours).toHaveLength(10);
});
