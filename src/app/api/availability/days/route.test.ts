import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), resolve: vi.fn(), salonIds: [] as string[], tx: {
  waitlistOffer: { findMany: vi.fn() }, salon: { findUnique: vi.fn() }, service: { findMany: vi.fn() }, professionalService: { findMany: vi.fn() },
  workingHours: { findMany: vi.fn() }, professionalOpening: { findMany: vi.fn() },
  salonClosure: { findMany: vi.fn() }, timeOff: { findMany: vi.fn() }, appointment: { findMany: vi.fn(), findFirst: vi.fn() }, resourceBooking: { findMany: vi.fn() },
} }));
vi.mock("@/lib/prisma-tenant", () => ({
  withApprovedSalon: async (id: string, callback: (tx: typeof mocks.tx) => unknown) => {
    mocks.salonIds.push(id);
    return callback(mocks.tx);
  },
}));
vi.mock("@/lib/client-auth", () => ({ getClientSession: mocks.session }));
vi.mock("@/lib/public-appointment", () => ({ resolveClientSessionInTenant: mocks.resolve }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "test", checkRateLimit: async () => ({ allowed: true }), rateLimitHeaders: () => ({}) }));
import { GET } from "./route";

const base = "http://localhost/api/availability/days?salonId=salon-a&professionalId=pro-a&serviceId=service-a";
beforeEach(() => {
  vi.resetAllMocks(); mocks.salonIds.length = 0;
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-09-30T12:00:00Z")); // segunda, 09:00 no salão
  mocks.tx.salon.findUnique.mockResolvedValue({ timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 120, bufferMinutes: 0 });
  mocks.tx.service.findMany.mockResolvedValue([{ id: "service-a", durationMin: 30, priceCents: 5000, physicalResourceId: null }]);
  mocks.tx.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
  mocks.tx.workingHours.findMany.mockResolvedValue([2, 3, 4, 5, 6].map(weekday => ({ weekday, startMinutes: 540, endMinutes: 1080 })));
  for (const model of [mocks.tx.professionalOpening, mocks.tx.salonClosure, mocks.tx.timeOff, mocks.tx.appointment, mocks.tx.resourceBooking, mocks.tx.waitlistOffer]) model.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("dias do calendário publicados ao cliente", () => {
  it("vai de hoje até no máximo 60 dias, sem segundas e domingos sem jornada", async () => {
    const response = await GET(new NextRequest(base));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.salonIds).toEqual(["salon-a"]);
    expect(data.fromDate).toBe("2030-09-30");
    expect(data.toDate).toBe("2030-11-29");
    expect(data.freeDays[0]).toBe("2030-10-01");
    expect(data.freeDays).not.toContain("2030-09-30");
    expect(data.freeDays).not.toContain("2030-10-06");
    expect(data.waitlistDays).toEqual([]);
    expect(mocks.tx.professionalOpening.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ salonId: "salon-a", professionalId: "pro-a", dateKey: { gte: "2030-09-30", lte: "2030-11-29" } }),
    }));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("exclui somente a própria reserva durante a remarcação autenticada", async () => {
    mocks.session.mockResolvedValue({ clientId: "client-a", salonId: "salon-a" });
    mocks.resolve.mockResolvedValue({ clientId: "client-a" });
    mocks.tx.appointment.findFirst.mockResolvedValue({ id: "own" });
    expect((await GET(new NextRequest(`${base}&rescheduleId=own`))).status).toBe(200);
    expect(mocks.tx.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "own", salonId: "salon-a", clientId: "client-a" }) }));
    expect(mocks.tx.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: "own" } }) }));
  });

  it("não permite usar a exclusão sem sessão ou com reserva de outra pessoa", async () => {
    const url = `${base}&rescheduleId=other`;
    mocks.resolve.mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(404);
    mocks.resolve.mockResolvedValue({ clientId: "client-a" });
    mocks.tx.appointment.findFirst.mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(404);
    expect(mocks.tx.appointment.findMany).not.toHaveBeenCalled();
  });

  it("recusa pedido incompleto e serviço que o profissional não faz", async () => {
    expect((await GET(new NextRequest("http://localhost/api/availability/days?salonId=salon-a&serviceId=service-a"))).status).toBe(400);
    mocks.tx.professionalService.findMany.mockResolvedValue([]);
    expect((await GET(new NextRequest(base))).status).toBe(404);
  });
});
