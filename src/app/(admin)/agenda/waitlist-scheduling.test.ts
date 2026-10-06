import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const context = { salonId: "salon-a", userId: "user-a", role: "OWNER" };
  const tx = {
    user: { findUnique: vi.fn(async () => ({ name: "Dona" })) },
    professional: { findFirst: vi.fn() },
    salon: { findUnique: vi.fn() },
    waitlistEntry: { findFirst: vi.fn() },
  };
  return {
    context,
    tx,
    createAppointment: vi.fn(),
    updateStatus: vi.fn(),
    fulfillElsewhere: vi.fn(),
    promote: vi.fn(),
    loadInputs: vi.fn(),
    computeSlots: vi.fn(),
    withTenant: vi.fn(async (_context: typeof context, callback: (value: typeof tx) => unknown) => callback(tx)),
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
  updateAppointmentStatusReliably: mocks.updateStatus,
}));
vi.mock("@/lib/reschedule-proposals", () => ({ requestStaffReschedule: vi.fn() }));
vi.mock("@/lib/day-slots", () => ({ loadDaySlotInputs: mocks.loadInputs, computeFreeSlots: mocks.computeSlots }));
vi.mock("@/lib/waitlist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/waitlist")>()),
  fulfillWaitlistEntryElsewhere: mocks.fulfillElsewhere,
  promoteWaitlistEntry: mocks.promote,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { WaitlistError } from "@/lib/waitlist";
import { cancelAndPromoteWaitlist, createAppointmentManually, getStaffFreeSlots } from "./actions";

const createInput = {
  professionalId: "professional-a",
  serviceIds: ["service-a"],
  clientId: "client-a",
  startLocal: "2030-10-02T16:00",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  waitlistEntryId: "entry-a",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.role = "OWNER";
  mocks.createAppointment.mockResolvedValue({ appointment: { id: "appointment-new", clientId: "client-a" }, duplicate: false });
  mocks.updateStatus.mockResolvedValue({ appointment: { id: "appointment-a" }, duplicate: false });
});

describe("pessoa da fila agendada em outro horário", () => {
  it("cria a reserva e consome a entrada na mesma transação", async () => {
    expect(await createAppointmentManually(createInput)).toEqual({ success: true });
    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.fulfillElsewhere).toHaveBeenCalledWith(mocks.tx, {
      salonId: "salon-a",
      entryId: "entry-a",
      appointmentId: "appointment-new",
      clientId: "client-a",
      actor: { id: "user-a", name: "Dona" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/book", "layout");
  });

  it("somente dono ou gerente podem atender a fila em outro horário", async () => {
    mocks.context.role = "RECEPTIONIST";
    await expect(createAppointmentManually(createInput)).rejects.toThrow("FORBIDDEN_ROLE");
    expect(mocks.createAppointment).not.toHaveBeenCalled();
  });

  it("explica quando a pessoa já saiu da fila", async () => {
    mocks.fulfillElsewhere.mockRejectedValueOnce(new WaitlistError("NOT_FOUND"));
    expect(await createAppointmentManually(createInput)).toEqual({
      error: "Essa pessoa não está mais na fila ativa. Atualize a agenda.",
    });
  });

  it("agendamento manual comum não mexe na fila", async () => {
    const plain = { ...createInput, waitlistEntryId: undefined };
    mocks.context.role = "RECEPTIONIST";
    expect(await createAppointmentManually(plain)).toEqual({ success: true });
    expect(mocks.fulfillElsewhere).not.toHaveBeenCalled();
  });
});

describe("cancelar e passar o horário para a fila", () => {
  const input = {
    appointmentId: "appointment-a",
    entryId: "entry-a",
    reason: "Cliente desmarcou",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    expectedVersion: 3,
  };

  it("cancela e promove a primeira pessoa numa única transação", async () => {
    expect(await cancelAndPromoteWaitlist(input)).toEqual({ success: true });
    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.updateStatus).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      appointmentId: "appointment-a",
      status: "CANCELLED",
      reason: "Cliente desmarcou",
      expectedVersion: 3,
    }));
    expect(mocks.promote).toHaveBeenCalledWith(mocks.tx, { salonId: "salon-a", appointmentId: "appointment-a", entryId: "entry-a" });
  });

  it("vaga que não serve à fila não cancela nada", async () => {
    mocks.promote.mockRejectedValueOnce(new WaitlistError("SLOT_UNAVAILABLE"));
    expect(await cancelAndPromoteWaitlist(input)).toEqual({
      error: "O horário não serve para a primeira pessoa da fila. Nada foi cancelado.",
    });
  });

  it("repetição após sucesso não promove de novo", async () => {
    mocks.updateStatus.mockResolvedValueOnce({ appointment: { id: "appointment-a" }, duplicate: true });
    mocks.tx.waitlistEntry.findFirst.mockResolvedValueOnce({ fulfilledAt: new Date() });
    expect(await cancelAndPromoteWaitlist(input)).toEqual({ success: true });
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it("recepção não pode cancelar", async () => {
    mocks.context.role = "RECEPTIONIST";
    await expect(cancelAndPromoteWaitlist(input)).rejects.toThrow("FORBIDDEN_ROLE");
  });
});

describe("horários livres sugeridos à equipe", () => {
  const salon = { timezone: "America/Sao_Paulo", minBookingLeadMinutes: 120, maxBookingLeadDays: 30, bufferMinutes: 0 };

  it("calcula sem a janela pública e devolve os melhores encaixes", async () => {
    mocks.tx.salon.findUnique.mockResolvedValue(salon);
    mocks.loadInputs.mockResolvedValue({ services: [] });
    mocks.computeSlots.mockReturnValue(["14:00", "14:15", "16:00"]);
    const result = await getStaffFreeSlots({ professionalId: "professional-a", serviceIds: ["service-a"], date: "2030-10-02" });
    expect(result).toEqual({ slots: ["14:00", "14:15", "16:00"], bestFit: expect.arrayContaining(["16:00"]) });
    expect(mocks.loadInputs).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ salonId: "salon-a", salon, professionalId: "professional-a", date: "2030-10-02" }));
    expect(mocks.computeSlots).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enforceBookingWindow: false }));
  });

  it("profissional consulta somente a própria agenda", async () => {
    mocks.context.role = "PROFESSIONAL";
    mocks.tx.professional.findFirst.mockResolvedValue({ id: "professional-own" });
    expect(await getStaffFreeSlots({ professionalId: "professional-a", serviceIds: ["service-a"], date: "2030-10-02" }))
      .toEqual({ error: "Você só pode consultar a própria agenda." });
    expect(mocks.loadInputs).not.toHaveBeenCalled();
  });

  it("rejeita data inválida sem consultar o banco", async () => {
    expect(await getStaffFreeSlots({ professionalId: "professional-a", serviceIds: ["service-a"], date: "02/10/2030" }))
      .toEqual({ error: "Escolha data, profissional e serviços." });
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
});
