import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const context = {
    salonId: "salon-a",
    userId: "user-a",
    role: "OWNER",
  };
  const tx = {
    user: { findUnique: vi.fn() },
    professional: { findFirst: vi.fn() },
    clientProfile: { findFirst: vi.fn() },
    appointment: { findFirst: vi.fn() },
  };
  return {
    context,
    tx,
    createAppointment: vi.fn(),
    requestStaffReschedule: vi.fn(),
    withTenant: vi.fn(async (
      _context: typeof context,
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/tenant", () => ({
  getTenantContext: vi.fn(async () => mocks.context),
  assertRole: (context: { role: string }, allowed: readonly string[]) => {
    if (!allowed.includes(context.role)) throw new Error("FORBIDDEN_ROLE");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: mocks.withTenant }));
vi.mock("@/lib/appointment-service", () => ({
  createAppointment: mocks.createAppointment,
  updateAppointmentStatusReliably: vi.fn(),
}));
vi.mock("@/lib/reschedule-proposals", () => ({ requestStaffReschedule: mocks.requestStaffReschedule }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createAppointmentManually, getLastAppointmentServices, editAppointment } from "./actions";

const input = {
  professionalId: "professional-own",
  serviceIds: ["service-a"],
  clientId: "client-a",
  startLocal: "2030-09-11T13:30",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  overrideConfirmed: true as const,
};

describe("última reserva para preenchimento manual", () => {
  it("consulta apenas o tenant ativo, sem futuro, cancelados ou dependentes", async () => {
    mocks.tx.appointment.findFirst.mockResolvedValue({ serviceId: "old", serviceItems: [{ serviceId: "a" }, { serviceId: "b" }] });
    expect(await getLastAppointmentServices("client-a")).toEqual({ serviceIds: ["a", "b"] });
    expect(mocks.withTenant).toHaveBeenCalledWith(mocks.context, expect.any(Function));
    expect(mocks.tx.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { salonId: "salon-a", clientId: "client-a", dependentId: null,
        startAt: { lte: expect.any(Date) }, status: { in: ["COMPLETED", "CONFIRMED", "IN_PROGRESS"] } },
    }));
  });

  it("profissional consulta apenas os próprios atendimentos", async () => {
    mocks.context.role = "PROFESSIONAL";
    mocks.tx.appointment.findFirst.mockResolvedValue(null);
    expect(await getLastAppointmentServices("client-other")).toEqual({ serviceIds: [] });
    expect(mocks.tx.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ salonId: "salon-a", professionalId: "professional-own" }),
    }));
  });

  it("nega acesso a papel não autorizado", async () => {
    mocks.context.role = "CLIENT";
    await expect(getLastAppointmentServices("client-a")).rejects.toThrow("FORBIDDEN_ROLE");
    expect(mocks.tx.appointment.findFirst).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.role = "OWNER";
  mocks.context.salonId = "salon-a";
  mocks.context.userId = "user-a";
  mocks.tx.user.findUnique.mockResolvedValue({ name: "Operador A" });
  mocks.tx.professional.findFirst.mockResolvedValue({ id: "professional-own" });
  mocks.tx.clientProfile.findFirst.mockResolvedValue({ id: "client-a" });
  mocks.createAppointment.mockResolvedValue({
    appointment: { clientId: "client-a" },
    duplicate: false,
  });
});

describe("criação manual durante pausa", () => {
  it.each(["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"])("deriva a exceção de bloqueio no servidor para %s", async role => {
    mocks.context.role = role;
    await createAppointmentManually({ ...input, timeOffOverrideReason: "Encaixe solicitado" });
    expect(mocks.createAppointment).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ canOverrideTimeOff: ["OWNER", "MANAGER"].includes(role) }));
  });
  it("autoriza o dono a confirmar a exceção", async () => {
    await expect(createAppointmentManually(input)).resolves.toEqual({ success: true });
    expect(mocks.createAppointment).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        salonId: "salon-a",
        canOverride: true,
        canOverrideWorkingHoursBreak: true,
        overrideConfirmed: true,
      }),
    );
  });

  it("autoriza o profissional somente na própria agenda e com cliente vinculado", async () => {
    mocks.context.role = "PROFESSIONAL";

    await expect(createAppointmentManually(input)).resolves.toEqual({ success: true });

    expect(mocks.tx.professional.findFirst).toHaveBeenCalledWith({
      where: { salonId: "salon-a", userId: "user-a", active: true },
      select: { id: true },
    });
    expect(mocks.tx.clientProfile.findFirst).toHaveBeenCalledWith({
      where: {
        id: "client-a",
        salonId: "salon-a",
        appointments: { some: { professionalId: "professional-own" } },
      },
      select: { id: true },
    });
    expect(mocks.createAppointment).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        professionalId: "professional-own",
        canOverride: false,
        canOverrideWorkingHoursBreak: true,
      }),
    );
  });

  it("nega ao profissional a agenda de outro membro antes de criar", async () => {
    mocks.context.role = "PROFESSIONAL";

    await expect(createAppointmentManually({
      ...input,
      professionalId: "professional-other",
    })).resolves.toEqual({
      error: "Você não tem permissão para este agendamento",
      code: "FORBIDDEN",
    });

    expect(mocks.createAppointment).not.toHaveBeenCalled();
    expect(mocks.tx.clientProfile.findFirst).not.toHaveBeenCalled();
  });

  it("nega ao profissional um cliente existente sem vínculo com ele", async () => {
    mocks.context.role = "PROFESSIONAL";
    mocks.tx.clientProfile.findFirst.mockResolvedValue(null);

    await expect(createAppointmentManually(input)).resolves.toEqual({
      error: "Você não tem permissão para este agendamento",
      code: "FORBIDDEN",
    });

    expect(mocks.createAppointment).not.toHaveBeenCalled();
  });

  it.each([
    ["MANAGER", true],
    ["RECEPTIONIST", false],
  ])("não concede a exceção de pausa para %s", async (role, canOverbook) => {
    mocks.context.role = role;

    await createAppointmentManually(input);

    expect(mocks.createAppointment).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        canOverride: canOverbook,
        canOverrideWorkingHoursBreak: false,
      }),
    );
  });
});


describe("permissão de término após expediente", () => {
  it.each(["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"])("resolve permissão no servidor para %s", async role => {
    mocks.context.role = role;
    mocks.requestStaffReschedule.mockResolvedValue({ requiresAcceptance: true });
    await createAppointmentManually({ ...input, afterHoursReason: "Cliente combinado" });
    expect(mocks.createAppointment).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ canFinishAfterHours: ["OWNER", "MANAGER"].includes(role), afterHoursReason: "Cliente combinado" }));
    expect(await editAppointment({ id: "appointment-a", professionalId: "professional-own", serviceIds: ["service-b"], startLocal: input.startLocal, idempotencyKey: input.idempotencyKey, afterHoursReason: "Cliente combinado" })).toEqual({ success: true, requiresAcceptance: true });
    expect(mocks.requestStaffReschedule).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ salonId: "salon-a", serviceIds: ["service-b"], canFinishAfterHours: ["OWNER", "MANAGER"].includes(role) }));
  });
});
