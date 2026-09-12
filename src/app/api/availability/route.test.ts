import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), resolve: vi.fn(), tx: {
  salon: { findUnique: vi.fn() }, service: { findMany: vi.fn() }, professionalService: { findMany: vi.fn() },
  servicePricingRule: { findFirst: vi.fn() }, workingHours: { findMany: vi.fn() }, professionalOpening: { findMany: vi.fn() },
  salonClosure: { findMany: vi.fn() }, timeOff: { findMany: vi.fn() }, appointment: { findMany: vi.fn(), findFirst: vi.fn() }, resourceBooking: { findMany: vi.fn() },
} }));
vi.mock("@/lib/prisma-tenant", () => ({ withApprovedSalon: async (_id: string, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) }));
vi.mock("@/lib/client-auth", () => ({ getClientSession: mocks.session }));
vi.mock("@/lib/public-appointment", () => ({ resolveClientSessionInTenant: mocks.resolve }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "test", checkRateLimit: async () => ({ allowed: true }), rateLimitHeaders: () => ({}) }));
import { GET } from "./route";

const request = () => GET(new NextRequest("http://localhost/api/availability?salonId=salon-a&professionalId=pro-a&serviceId=service-a&date=2030-09-11"));
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2030-09-01T12:00:00Z"));
  mocks.tx.salon.findUnique.mockResolvedValue({ timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 60, bufferMinutes: 0 });
  mocks.tx.service.findMany.mockResolvedValue([{ id: "service-a", durationMin: 30, priceCents: 5000, physicalResourceId: null }]);
  mocks.tx.servicePricingRule.findFirst.mockResolvedValue(null);
  mocks.tx.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
  mocks.tx.workingHours.findMany.mockResolvedValue([{ startMinutes: 360, endMinutes: 750 }, { startMinutes: 900, endMinutes: 1260 }]);
  for (const model of [mocks.tx.professionalOpening, mocks.tx.salonClosure, mocks.tx.timeOff, mocks.tx.appointment, mocks.tx.resourceBooking]) model.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("horários publicados ao cliente", () => {
  it("exclui somente a própria reserva e recurso durante remarcação autenticada", async () => {
    mocks.session.mockResolvedValue({ clientId: "client-a", salonId: "salon-a" });
    mocks.resolve.mockResolvedValue({ clientId: "client-a" });
    mocks.tx.appointment.findFirst.mockResolvedValue({ id: "own" });
    mocks.tx.service.findMany.mockResolvedValue([{ id: "service-a", durationMin: 30, priceCents: 5000, physicalResourceId: "room" }]);
    const response = await GET(new NextRequest("http://localhost/api/availability?salonId=salon-a&professionalId=pro-a&serviceId=service-a&date=2030-09-11&rescheduleId=own"));
    expect(response.status).toBe(200);
    expect(mocks.tx.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "own", salonId: "salon-a", clientId: "client-a" }) }));
    expect(mocks.tx.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: "own" } }) }));
    expect(mocks.tx.resourceBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ appointmentId: { not: "own" } }) }));
  });
  it("não permite usar exclusão sem sessão ou com reserva de outra pessoa", async () => {
    const url = "http://localhost/api/availability?salonId=salon-a&professionalId=pro-a&serviceId=service-a&date=2030-09-11&rescheduleId=other";
    mocks.resolve.mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(404);
    mocks.resolve.mockResolvedValue({ clientId: "client-a" });
    mocks.tx.appointment.findFirst.mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(404);
    expect(mocks.tx.appointment.findMany).not.toHaveBeenCalled();
  });
  it("oferece manhã/noite, impede atravessar a pausa e exige terminar até 21h", async () => {
    const response = await request();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.slots).toContain("06:00"); expect(data.slots).toContain("12:00");
    expect(data.slots).toContain("15:00"); expect(data.slots).toContain("18:00"); expect(data.slots.at(-1)).toBe("20:30");
    for (const time of ["12:15", "12:30", "14:30", "14:45", "20:45", "21:00"]) expect(data.slots).not.toContain(time);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("oferece 16h15/16h30 para 3h30 e não oferece 14h30 durante a pausa", async () => {
    mocks.tx.service.findMany.mockResolvedValue([{ id: "service-a", durationMin: 210, priceCents: 5000, physicalResourceId: null }]);
    const data = await (await request()).json();
    expect(data.slots).toContain("16:15"); expect(data.slots).toContain("16:30"); expect(data.slots.at(-1)).toBe("17:30");
    expect(data.slots).not.toContain("14:30"); expect(data.slots).not.toContain("17:45");
  });
  it("mantém folgas mesmo com salão aberto", async () => {
    mocks.tx.workingHours.findMany.mockResolvedValue([]);
    expect((await (await request()).json()).slots).toEqual([]);
    expect(mocks.tx.workingHours.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "salon-a", professionalId: "pro-a", weekday: 3 } }));
  });
  it("continua respeitando reservas, buffer, bloqueios, fechamentos e recursos", async () => {
    mocks.tx.salon.findUnique.mockResolvedValue({ timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 60, bufferMinutes: 15 });
    mocks.tx.service.findMany.mockResolvedValue([{ id: "service-a", durationMin: 30, priceCents: 5000, physicalResourceId: "room-a" }]);
    mocks.tx.appointment.findMany.mockResolvedValueOnce([{ id: "appointment-a", startAt: new Date("2030-09-11T19:00:00Z"), endAt: new Date("2030-09-11T19:30:00Z") }]).mockResolvedValueOnce([]);
    mocks.tx.timeOff.findMany.mockResolvedValue([{ startAt: new Date("2030-09-11T20:00:00Z"), endAt: new Date("2030-09-11T20:30:00Z") }]);
    mocks.tx.salonClosure.findMany.mockResolvedValue([{ startAt: new Date("2030-09-11T21:00:00Z"), endAt: new Date("2030-09-11T21:30:00Z") }]);
    mocks.tx.resourceBooking.findMany.mockResolvedValue([{ startAt: new Date("2030-09-11T22:00:00Z"), endAt: new Date("2030-09-11T22:30:00Z") }]);
    const data = await (await request()).json();
    for (const time of ["15:30", "16:00", "16:30", "17:00", "18:00", "19:00"]) expect(data.slots).not.toContain(time);
    expect(data.slots).toContain("15:15"); expect(data.slots).toContain("20:30");
  });
});
