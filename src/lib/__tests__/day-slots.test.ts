import { describe, expect, it } from "vitest";
import { computeFreeSlots } from "../day-slots";

const date = "2030-10-02";
const inputs = {
  salon: { timezone: "America/Sao_Paulo", minBookingLeadMinutes: 24 * 60, maxBookingLeadDays: 60, bufferMinutes: 0 },
  services: [{ id: "service-a", durationMin: 60, priceCents: 5_000, priceType: "FIXED", priceNote: null, physicalResourceId: null }],
  pricingRule: null,
  workingHours: [{ startMinutes: 8 * 60, endMinutes: 18 * 60 }],
  closures: [],
  timeOffs: [],
  // Kaique 08:30–09:30 (11:30–12:30 UTC).
  appointments: [{ id: "kaique", startAt: new Date("2030-10-02T11:30:00.000Z"), endAt: new Date("2030-10-02T12:30:00.000Z") }],
  resourceBookings: [],
};

describe("horários livres do dia", () => {
  it("para a equipe ignora a antecedência pública, mas não oferece horário passado nem ocupado", () => {
    const now = new Date("2030-10-02T13:00:00.000Z"); // 10:00 no salão
    const slots = computeFreeSlots(inputs, { date, now, enforceBookingWindow: false });
    expect(slots[0]).toBe("10:15");
    expect(slots).toContain("16:00");
    expect(slots.at(-1)).toBe("17:00");
    for (const time of ["08:00", "08:30", "09:00", "10:00"]) expect(slots).not.toContain(time);
  });

  it("para o cliente continua respeitando a antecedência mínima", () => {
    const now = new Date("2030-10-01T13:00:00.000Z");
    expect(computeFreeSlots(inputs, { date, now, enforceBookingWindow: true })).toEqual(
      computeFreeSlots(inputs, { date, now, enforceBookingWindow: false }).filter(time => time >= "10:00"),
    );
  });
});
