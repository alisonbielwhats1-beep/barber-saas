import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ salonIds: [] as string[], calendar: vi.fn(), allowed: true }));
vi.mock("@/lib/prisma-tenant", () => ({
  withApprovedSalon: async (id: string, callback: (tx: object) => unknown) => {
    mocks.salonIds.push(id);
    return id === "suspended" ? null : callback({});
  },
}));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "test", checkRateLimit: async () => ({ allowed: mocks.allowed }), rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/visit-scheduling", async (original) => ({
  ...(await original<typeof import("@/lib/visit-scheduling")>()),
  loadVisitCalendar: mocks.calendar,
}));
import { POST } from "./route";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/visits/availability/days", { method: "POST", body: JSON.stringify(body) }));
const choices = [{ serviceId: "hair" }, { serviceId: "nails", professionalId: "tati" }];
beforeEach(() => {
  vi.resetAllMocks(); mocks.salonIds.length = 0; mocks.allowed = true;
  mocks.calendar.mockResolvedValue({ fromDate: "2030-09-30", toDate: "2030-11-29", openDays: ["2030-10-02"], firstFreeDay: "2030-10-02" });
});

describe("dias do calendário da visita", () => {
  it("consulta dentro do salão pedido e não guarda cache", async () => {
    const response = await post({ salonId: "salon-a", choices });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ openDays: ["2030-10-02"], firstFreeDay: "2030-10-02" }));
    expect(mocks.salonIds).toEqual(["salon-a"]);
    expect(mocks.calendar).toHaveBeenCalledWith({}, "salon-a", choices);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("recusa seleção inválida, campos extras e salão indisponível", async () => {
    expect((await post({ salonId: "salon-a", choices: [] })).status).toBe(400);
    expect((await post({ salonId: "salon-a", choices, date: "2030-10-02" })).status).toBe(400);
    expect((await post({ salonId: "suspended", choices })).status).toBe(404);
    expect(mocks.calendar).not.toHaveBeenCalled();
  });

  it("respeita o limite de consultas", async () => {
    mocks.allowed = false;
    expect((await post({ salonId: "salon-a", choices })).status).toBe(429);
    expect(mocks.salonIds).toEqual([]);
  });
});
