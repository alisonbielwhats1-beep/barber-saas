import { describe, expect, it } from "vitest";
import { loadVisitCalendar } from "../visit-scheduling";
import type { Tx } from "../prisma-tenant";

// Segunda, 30/09/2030, 09:00 em São Paulo. Janela de 7 dias: 30/09 a 07/10.
const now = new Date("2030-09-30T12:00:00.000Z");
const services = [
  { id: "hair", name: "Corte", durationMin: 30, priceCents: 5000, priceType: "FIXED", priceNote: null, physicalResourceId: null, professionals: [{ professional: { id: "anderson", user: { name: "Anderson" } } }] },
  { id: "nails", name: "Unhas", durationMin: 60, priceCents: 6000, priceType: "FIXED", priceNote: null, physicalResourceId: null, professionals: [{ professional: { id: "tati", user: { name: "Tati" } } }, { professional: { id: "bia", user: { name: "Bia" } } }] },
];
// Anderson: ter–sáb; Tati: qua–sáb; Bia: só segunda. 09:00–18:00.
const weekly = [
  ...[2, 3, 4, 5, 6].map((weekday) => ({ professionalId: "anderson", weekday, startMinutes: 540, endMinutes: 1080 })),
  ...[3, 4, 5, 6].map((weekday) => ({ professionalId: "tati", weekday, startMinutes: 540, endMinutes: 1080 })),
  { professionalId: "bia", weekday: 1, startMinutes: 540, endMinutes: 1080 },
];
// Quarta (02/10): Tati ocupada o dia todo.
const tatiFullWednesday = { professionalId: "tati", startAt: new Date("2030-10-02T12:00:00.000Z"), endAt: new Date("2030-10-02T21:00:00.000Z") };

function fakeTx(overrides: Partial<Record<string, unknown[]>> = {}) {
  const rows = (model: string, fallback: unknown[] = []) => ({ findMany: async () => overrides[model] ?? fallback });
  return {
    salon: { findUnique: async () => ({ timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 7, bufferMinutes: 0 }) },
    service: rows("service", services),
    workingHours: rows("workingHours", weekly),
    professionalOpening: rows("professionalOpening"),
    salonClosure: rows("salonClosure"),
    timeOff: rows("timeOff"),
    appointment: rows("appointment", [tatiFullWednesday]),
    resourceBooking: rows("resourceBooking"),
    waitlistOffer: rows("waitlistOffer"),
    auditLog: { findFirst: async () => null },
  } as unknown as Tx;
}
const choices = [{ serviceId: "hair" }, { serviceId: "nails" }];

describe("calendário da visita com vários serviços", () => {
  it("abre só dias em que cada serviço tem quem atenda e acha o primeiro dia em que a visita cabe", async () => {
    const result = await loadVisitCalendar(fakeTx(), "salon-a", choices, now);
    expect(result.fromDate).toBe("2030-09-30");
    expect(result.toDate).toBe("2030-10-07");
    // Segunda: Anderson folga. Terça: ninguém faz unhas. Domingo: ninguém.
    expect(result.openDays).toEqual(["2030-10-02", "2030-10-03", "2030-10-04", "2030-10-05"]);
    // Quarta tem expediente, mas a visita não cabe.
    expect(result.firstFreeDay).toBe("2030-10-03");
  });

  it("respeita o profissional escolhido para cada serviço", async () => {
    const result = await loadVisitCalendar(fakeTx(), "salon-a", [{ serviceId: "hair" }, { serviceId: "nails", professionalId: "bia" }], now);
    expect(result.openDays).toEqual([]);
    expect(result.firstFreeDay).toBeNull();
  });

  it("fechamento do salão e folga tiram o dia do calendário", async () => {
    const result = await loadVisitCalendar(fakeTx({
      salonClosure: [{ startAt: new Date("2030-10-03T03:00:00.000Z"), endAt: new Date("2030-10-04T03:00:00.000Z") }],
      timeOff: [{ professionalId: "tati", startAt: new Date("2030-10-04T03:00:00.000Z"), endAt: new Date("2030-10-05T03:00:00.000Z") }],
    }), "salon-a", choices, now);
    expect(result.openDays).toEqual(["2030-10-02", "2030-10-05"]);
    expect(result.firstFreeDay).toBe("2030-10-05");
  });

  it("dia de hoje com o expediente já encerrado não fica aberto", async () => {
    const lateTuesday = new Date("2030-10-01T22:00:00.000Z"); // terça, 19:00
    const result = await loadVisitCalendar(fakeTx({
      workingHours: weekly.map((h) => h.professionalId === "tati" ? { ...h, weekday: h.weekday === 3 ? 2 : h.weekday } : h),
      appointment: [],
    }), "salon-a", choices, lateTuesday);
    expect(result.fromDate).toBe("2030-10-01");
    expect(result.openDays[0]).not.toBe("2030-10-01");
  });

  it("limita a busca e devolve null quando nada cabe dentro do limite", async () => {
    const result = await loadVisitCalendar(fakeTx(), "salon-a", choices, now, { maxSearchDays: 1 });
    expect(result.openDays).toHaveLength(4);
    expect(result.firstFreeDay).toBeNull();
  });
});
