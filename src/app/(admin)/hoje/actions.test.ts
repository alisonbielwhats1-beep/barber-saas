import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: "RECEPTIONIST", checkIn: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: async () => ({ salonId: "salon-a", userId: "user-a", role: mocks.role }), assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("Forbidden"); } }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: async (_ctx: unknown, callback: (tx: object) => unknown) => callback({}) }));
vi.mock("@/lib/appointment-checkin", () => ({ checkInAppointment: mocks.checkIn }));
import { registerArrival } from "./actions";
beforeEach(() => { vi.resetAllMocks(); mocks.role = "RECEPTIONIST"; });
describe("registro de chegada", () => {
  it("recepcionista opera com tenant e usuário da sessão", async () => {
    expect(await registerArrival({ appointmentId: "appt", expectedVersion: 2 })).toHaveProperty("success");
    expect(mocks.checkIn).toHaveBeenCalledWith({}, { appointmentId: "appt", expectedVersion: 2, salonId: "salon-a", userId: "user-a" });
  });
  it("profissional não pode registrar chegada pela rota da recepção", async () => {
    mocks.role = "PROFESSIONAL";
    await expect(registerArrival({ appointmentId: "appt", expectedVersion: 2 })).rejects.toThrow("Forbidden");
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });
});
