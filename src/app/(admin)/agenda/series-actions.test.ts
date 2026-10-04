import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "OWNER",
  tx: { appointment: { findFirst: vi.fn() } },
  reschedule: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: async () => ({ salonId: "salon-a", userId: "owner", role: mocks.role }),
  assertRole: (ctx: { role: string }, roles: string[]) => {
    if (!roles.includes(ctx.role)) throw new Error("Forbidden");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withTenant: async (_ctx: unknown, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
}));
vi.mock("@/lib/appointment-service", () => ({ inspectAppointmentAvailabilityWithServiceSnapshots: vi.fn() }));
vi.mock("@/lib/reschedule-proposals", () => ({ requestStaffReschedule: mocks.reschedule }));
import { applySeriesEdit, previewSeriesEdit } from "./series-actions";

const requestId = "550e8400-e29b-41d4-a716-446655440000";
const item = { id: "appointment-1", version: 3, startLocal: "2032-08-05T10:00", requestId };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "OWNER";
  mocks.tx.appointment.findFirst.mockResolvedValue({
    id: "appointment-1",
    professionalId: "pro-a",
    serviceId: "service-a",
    serviceItems: [],
  });
  mocks.reschedule.mockResolvedValue({ requiresAcceptance: true, proposalId: "proposal-1", duplicate: false });
});

describe("edição de série: o motivo é opcional", () => {
  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["ausente", undefined],
  ])("aplica sem motivo (%s) e deixa o serviço usar o texto padrão", async (_label, reason) => {
    const result = await applySeriesEdit({ reason, items: [item] });

    expect(result).toEqual([expect.objectContaining({ id: "appointment-1", success: true })]);
    expect(mocks.reschedule).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        reason: null,
        actor: { type: "STAFF", id: "owner", name: "Equipe" },
      }),
    );
  });

  it("com motivo, repassa o texto sem espaços nas pontas", async () => {
    await applySeriesEdit({ reason: "  Reforma do salão ", items: [item] });
    expect(mocks.reschedule).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ reason: "Reforma do salão" }));
  });

  it("continua recusando motivo acima de 200 caracteres e papel sem permissão", async () => {
    await expect(applySeriesEdit({ reason: "x".repeat(201), items: [item] })).rejects.toThrow();
    mocks.role = "RECEPTIONIST";
    await expect(applySeriesEdit({ reason: "", items: [item] })).rejects.toThrow("Forbidden");
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("a revisão das ocorrências também aceita não informar motivo", async () => {
    mocks.tx.appointment.findFirst.mockResolvedValue({ seriesId: null, startAt: new Date() });
    // Chega até a checagem da série (e não é barrada pela validação do motivo).
    await expect(
      previewSeriesEdit({ appointmentId: "appointment-1", shiftDays: 0, time: "10:00", reason: "" }),
    ).rejects.toThrow("Este atendimento não pertence a uma série.");
    await expect(
      previewSeriesEdit({ appointmentId: "appointment-1", shiftDays: 0, time: "10:00" }),
    ).rejects.toThrow("Este atendimento não pertence a uma série.");
  });
});
