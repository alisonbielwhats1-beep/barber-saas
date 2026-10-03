import { describe, expect, it } from "vitest";
import { computeFreeSlots, loadBookableDays } from "../day-slots";
import type { Tx } from "../prisma-tenant";

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

describe("dias disponíveis do calendário do cliente", () => {
  const salon = { timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 60, bufferMinutes: 0 };
  // Ter–sáb das 09:00 às 18:00; segunda (30/09) e domingo sem jornada.
  const weekly = [2, 3, 4, 5, 6].map(weekday => ({ weekday, startMinutes: 9 * 60, endMinutes: 18 * 60 }));
  function fakeTx(overrides: Partial<Record<string, unknown[]>> = {}) {
    const rows = (model: string, fallback: unknown[] = []) => ({ findMany: async () => overrides[model] ?? fallback });
    return {
      service: rows("service", [{ id: "service-a", durationMin: 60, priceCents: 5_000, priceType: "FIXED", priceNote: null, physicalResourceId: null }]),
      professionalService: rows("professionalService", [{ serviceId: "service-a" }]),
      workingHours: rows("workingHours", weekly),
      professionalOpening: rows("professionalOpening"),
      salonClosure: rows("salonClosure"),
      timeOff: rows("timeOff"),
      appointment: rows("appointment"),
      resourceBooking: rows("resourceBooking"),
      waitlistOffer: rows("waitlistOffer"),
    } as unknown as Tx;
  }
  const query = { salonId: "salon-a", salon, professionalId: "pro-a", serviceIds: ["service-a"], fromDate: "2030-09-30", toDate: "2030-10-06" };

  it("separa dias livres, dias lotados só com fila e dias sem atendimento", async () => {
    const tx = fakeTx({
      // Terça lotada: 09:00–18:00 local.
      appointment: [{ id: "full", startAt: new Date("2030-10-01T12:00:00.000Z"), endAt: new Date("2030-10-01T21:00:00.000Z") }],
      // Quarta de folga e quinta com o salão fechado.
      timeOff: [{ startAt: new Date("2030-10-02T03:00:00.000Z"), endAt: new Date("2030-10-03T03:00:00.000Z") }],
      salonClosure: [{ startAt: new Date("2030-10-03T03:00:00.000Z"), endAt: new Date("2030-10-04T03:00:00.000Z") }],
      // Domingo com expediente extra.
      professionalOpening: [{ dateKey: "2030-10-06", startMinutes: 10 * 60, endMinutes: 12 * 60 }],
    });
    const days = await loadBookableDays(tx, { ...query, now: new Date("2030-09-30T12:00:00.000Z") });
    expect(days).toEqual({
      freeDays: ["2030-10-04", "2030-10-05", "2030-10-06"],
      waitlistDays: ["2030-10-01"],
    });
  });

  it("não oferece fila de atendimento que já começou", async () => {
    const tx = fakeTx({
      appointment: [{ id: "full", startAt: new Date("2030-10-01T12:00:00.000Z"), endAt: new Date("2030-10-01T21:00:00.000Z") }],
    });
    const days = await loadBookableDays(tx, { ...query, fromDate: "2030-10-01", toDate: "2030-10-01", now: new Date("2030-10-01T13:00:00.000Z") });
    expect(days).toEqual({ freeDays: [], waitlistDays: [] });
  });

  it("respeita a antecedência mínima do cliente no dia de hoje", async () => {
    const days = await loadBookableDays(fakeTx(), {
      ...query,
      salon: { ...salon, minBookingLeadMinutes: 24 * 60 },
      fromDate: "2030-10-01",
      toDate: "2030-10-02",
      now: new Date("2030-10-01T12:00:00.000Z"),
    });
    expect(days?.freeDays).toEqual(["2030-10-02"]);
  });

  it("recusa serviço que o profissional não realiza", async () => {
    const days = await loadBookableDays(fakeTx({ professionalService: [] }), { ...query, now: new Date("2030-09-30T12:00:00.000Z") });
    expect(days).toBeNull();
  });
});
