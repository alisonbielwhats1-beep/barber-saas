import { describe, it, expect, vi } from "vitest";
import { isSalonClosedAt } from "../closures";
import type { Tx } from "../prisma-tenant";

function fakeTx(closure: unknown): Tx {
  return {
    salonClosure: { findFirst: vi.fn().mockResolvedValue(closure) },
  } as unknown as Tx;
}

describe("isSalonClosedAt", () => {
  it("retorna true quando existe bloqueio sobrepondo o intervalo", async () => {
    const tx = fakeTx({ id: "closure-1" });
    const result = await isSalonClosedAt(
      tx,
      "salon-a",
      new Date("2026-08-10T10:00:00.000Z"),
      new Date("2026-08-10T11:00:00.000Z"),
    );
    expect(result).toBe(true);
  });

  it("retorna false quando não há bloqueio", async () => {
    const tx = fakeTx(null);
    const result = await isSalonClosedAt(
      tx,
      "salon-a",
      new Date("2026-08-10T10:00:00.000Z"),
      new Date("2026-08-10T11:00:00.000Z"),
    );
    expect(result).toBe(false);
  });

  it("filtra por salonId e pela sobreposição de intervalo na query", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = { salonClosure: { findFirst } } as unknown as Tx;
    const startAt = new Date("2026-08-10T10:00:00.000Z");
    const endAt = new Date("2026-08-10T11:00:00.000Z");

    await isSalonClosedAt(tx, "salon-a", startAt, endAt);

    expect(findFirst).toHaveBeenCalledWith({
      where: { salonId: "salon-a", startAt: { lt: endAt }, endAt: { gt: startAt } },
      select: { id: true },
    });
  });
});
