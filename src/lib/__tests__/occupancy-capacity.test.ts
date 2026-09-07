import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { getOccupancyRate } from "../kpis";

describe("occupancy capacity", () => {
  const from = new Date("2026-09-07T03:00:00Z");
  const to = new Date("2026-09-08T03:00:00Z");
  const at = (hour: number) => new Date(`2026-09-07T${String(hour + 3).padStart(2, "0")}:00:00Z`);
  function database(closures: { startAt: Date; endAt: Date }[] = []) {
    return {
      appointment: { findMany: vi.fn().mockResolvedValue([{ professionalId: "a", startAt: at(9), endAt: at(10) }]) },
      professional: { count: vi.fn().mockResolvedValue(2) },
      professionalOpening: { findMany: vi.fn().mockResolvedValue([]) },
      workingHours: { findMany: vi.fn().mockResolvedValue([
        { professionalId: "a", weekday: 1, startMinutes: 540, endMinutes: 1020 },
        { professionalId: "b", weekday: 1, startMinutes: 540, endMinutes: 1020 },
      ]) },
      timeOff: { findMany: vi.fn().mockResolvedValue([
        { professionalId: "a", startAt: at(8), endAt: at(10) },
        { professionalId: "a", startAt: at(9), endAt: at(11) },
      ]) },
      salonClosure: { findMany: vi.fn().mockResolvedValue(closures) },
    } as unknown as Tx;
  }
  it("subtracts only the union of the affected professional's absence during working hours", async () => {
    const result = await getOccupancyRate(database(), "salon", from, to, "America/Sao_Paulo");
    expect(result.availableMinutes).toBe(14 * 60);
    expect(result.bookedMinutes).toBe(60);
  });
  it("deducts a salon closure from both professionals without double counting absence", async () => {
    const result = await getOccupancyRate(database([{ startAt: at(9), endAt: at(12) }]), "salon", from, to, "America/Sao_Paulo");
    expect(result.availableMinutes).toBe(10 * 60);
  });
  it("conta expediente extra e profissional sem jornada semanal sem duplicar sobreposições", async () => {
    const tx = database();
    vi.mocked(tx.professionalOpening.findMany).mockResolvedValue([
      { professionalId: "a", dateKey: "2026-09-07", startMinutes: 960, endMinutes: 1080 },
      { professionalId: "c", dateKey: "2026-09-07", startMinutes: 540, endMinutes: 600 },
    ] as never);
    expect((await getOccupancyRate(tx, "salon", from, to, "America/Sao_Paulo")).availableMinutes).toBe(16 * 60);
  });
});
