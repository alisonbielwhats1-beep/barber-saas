import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { workingHoursForDate } from "../working-hours";

describe("expediente por data", () => {
  it("une jornadas adjacentes sem preencher o intervalo de almoço", async () => {
    const tx = {
      workingHours: { findMany: vi.fn().mockResolvedValue([{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1080 }]) },
      professionalOpening: { findMany: vi.fn().mockResolvedValue([{ startMinutes: 1080, endMinutes: 1200 }]) },
    };
    expect(await workingHoursForDate(tx as unknown as Tx, "salon-a", "pro-a", "2032-08-05")).toEqual([{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1200 }]);
    expect(tx.professionalOpening.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "salon-a", professionalId: "pro-a", dateKey: "2032-08-05" } }));
  });
});
