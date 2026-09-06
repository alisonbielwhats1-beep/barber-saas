import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../appointment-service", () => ({ createAppointment: mocks.create, lockAppointmentOperationalScope: vi.fn() }));
import { createAppointmentWithProductReservation } from "../appointment-product-service";

describe("booking price confirmation", () => {
  it("rejects a stale quoted total so the surrounding transaction rolls back", async () => {
    mocks.create.mockResolvedValue({ appointment: { id: "appointment-a" }, duplicate: false });
    const tx = { appointment: { findFirst: vi.fn().mockResolvedValue({ priceCents: 12500, products: [] }) } } as unknown as Tx;
    await expect(createAppointmentWithProductReservation(tx, {
      expectedTotalCents: 10000,
      appointment: { salonId: "salon-a", professionalId: "pro-a", serviceIds: ["service-a"], startLocal: "2026-09-08T10:00", origin: "PUBLIC", actor: { type: "CLIENT", id: "client-a", name: "Cliente" }, clientId: "client-a", idempotencyKey: "11111111-1111-4111-8111-111111111111", enforceBookingWindow: true },
      productReservation: { actorName: "Cliente", items: [] },
    })).rejects.toMatchObject({ code: "PRICE_CHANGED" });
  });
  it("preserves the original result when retrying a successful reservation", async () => {
    const created = { appointment: { id: "appointment-a" }, duplicate: true };
    mocks.create.mockResolvedValue(created);
    const tx = { appointment: { findFirst: vi.fn() } };
    expect(await createAppointmentWithProductReservation(tx as unknown as Tx, {
      expectedTotalCents: 10000,
      appointment: { salonId: "salon-a", professionalId: "pro-a", serviceIds: ["service-a"], startLocal: "2026-09-08T10:00", origin: "PUBLIC", actor: { type: "CLIENT", id: "client-a", name: "Cliente" }, clientId: "client-a", idempotencyKey: "11111111-1111-4111-8111-111111111111", enforceBookingWindow: true },
      productReservation: { actorName: "Cliente", items: [] },
    })).toBe(created);
    expect(tx.appointment.findFirst).not.toHaveBeenCalled();
  });
});
