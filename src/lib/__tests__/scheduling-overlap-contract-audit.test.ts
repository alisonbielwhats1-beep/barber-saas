import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { createAppointment, inspectAppointmentAvailability } from "../appointment-service";
import { patchBatch, validateBatchPlan } from "../scheduling-batch";

// Characterization of existing guards, not an oracle for the proposed integration.
function fixture() {
  const raw = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    salon: { findUnique: vi.fn().mockResolvedValue({ timezone: "America/Sao_Paulo", bufferMinutes: 0, minBookingLeadMinutes: 0, maxBookingLeadDays: 365, cancelPolicyHours: 2 }) },
    service: { findMany: vi.fn().mockResolvedValue([{ id: "cut", name: "Corte Completo", durationMin: 45, priceCents: 5000 }]) },
    servicePricingRule: { findFirst: vi.fn().mockResolvedValue(null) },
    professional: { findFirst: vi.fn().mockResolvedValue({ id: "pro" }) },
    professionalService: { findMany: vi.fn().mockResolvedValue([{ serviceId: "cut" }]) },
    workingHours: { findMany: vi.fn().mockResolvedValue([{ startMinutes: 540, endMinutes: 1080 }]) },
    professionalOpening: { findMany: vi.fn().mockResolvedValue([]) },
    salonClosure: { findFirst: vi.fn().mockResolvedValue(null) },
    timeOff: { findFirst: vi.fn().mockResolvedValue(null) },
    appointment: { findFirst: vi.fn().mockResolvedValue({ id: "next" }), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    waitlistOffer: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { raw, tx: raw as unknown as Tx };
}
const input = {
  salonId: "salon", professionalId: "pro", clientId: "fabio", serviceIds: ["cut"],
  startLocal: "2030-09-11T10:00", origin: "ADMIN" as const,
  actor: { type: "STAFF" as const, id: "owner", name: "Dono" },
  idempotencyKey: "offline-overlap-audit", enforceBookingWindow: false,
};

describe("overlap gate: existing contract boundaries, offline only", () => {
  it("manual consent alone does not replace the mandatory overbooking reason", async () => {
    const { tx, raw } = fixture();
    await expect(createAppointment(tx, { ...input, canOverride: true, overrideConfirmed: true }))
      .rejects.toMatchObject({ code: "SLOT_TAKEN" });
    await expect(createAppointment(tx, { ...input, canOverride: true, overrideConfirmed: true, overrideReason: "ab" }))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(raw.appointment.create).not.toHaveBeenCalled();
  });

  it("uses the whole catalog interval and excludes only the designated appointment", async () => {
    const { tx, raw } = fixture();
    const result = await inspectAppointmentAvailability(tx, { ...input, excludeAppointmentId: "amanda" });
    expect(result).toMatchObject({ violation: "SLOT_TAKEN", startAt: new Date("2030-09-11T13:00Z"), endAt: new Date("2030-09-11T13:45Z") });
    expect(raw.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: { not: "amanda" }, startAt: { lt: new Date("2030-09-11T13:45Z") }, endAt: { gt: new Date("2030-09-11T13:00Z") },
    }) }));
  });

  it("a released-slot batch rejects another explicit time without mutating the original plan", () => {
    const plan = validateBatchPlan({ execution_policy: "all_or_nothing", items: [
      { key: "cancel", operation: "appointment.cancel", depends_on: [], fields: { customer_name: "Amanda", time: "10:00", reason: "Cliente desistiu" } },
      { key: "create", operation: "appointment.create", depends_on: ["cancel"], released_slot_of: "cancel", fields: { customer_name: "Fábio", service_name: "Corte Completo" } },
    ] });
    const before = structuredClone(plan);
    expect(() => patchBatch(plan, "create", { time: "11:00" })).toThrow("DEPENDENCY_ERROR");
    expect(plan).toEqual(before);
  });
});
