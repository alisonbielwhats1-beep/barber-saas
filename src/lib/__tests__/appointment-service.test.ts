import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import {
  createAppointment,
  inspectAppointmentAvailability,
  rescheduleAppointment,
} from "../appointment-service";

function schedulingTx() {
  const appointmentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "appointment-a",
    startAt: data.startAt as Date,
    endAt: data.endAt as Date,
    version: 1,
    clientId: data.clientId as string,
    professionalId: data.professionalId as string,
  }));
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    salon: {
      findUnique: vi.fn().mockResolvedValue({
        timezone: "America/Sao_Paulo",
        minBookingLeadMinutes: 0,
        maxBookingLeadDays: 365,
        bufferMinutes: 15,
        cancelPolicyHours: 2,
      }),
    },
    service: {
      // Fora de ordem de propósito: o servidor deve respeitar a ordem pedida.
      findMany: vi.fn().mockResolvedValue([
        { id: "service-b", name: "Barba", durationMin: 45, priceCents: 4_000 },
        { id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 },
      ]),
    },
    servicePricingRule: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    professionalService: {
      findMany: vi.fn().mockResolvedValue([
        { serviceId: "service-a" },
        { serviceId: "service-b" },
      ]),
    },
    workingHours: {
      findMany: vi.fn().mockResolvedValue([{ startMinutes: 9 * 60, endMinutes: 18 * 60 }]),
    },
    professionalOpening: { findMany: vi.fn().mockResolvedValue([]) },
    salonClosure: { findFirst: vi.fn().mockResolvedValue(null) },
    timeOff: { findFirst: vi.fn().mockResolvedValue(null) },
    appointment: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: appointmentCreate,
    },
    appointmentService: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    clientProfile: { findFirst: vi.fn().mockResolvedValue({ id: "client-a" }) },
    membership: { findMany: vi.fn().mockResolvedValue([{ userId: "owner-a" }]) },
    professional: { findFirst: vi.fn().mockResolvedValue({ userId: "pro-user-a" }) },
    appointmentEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "event-a" }),
    },
    notificationOutbox: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-a" }) },
  };
  return { tx: tx as unknown as Tx, raw: tx, appointmentCreate };
}

describe("motor central de agendamentos", () => {
  const afterHoursInput = {
    salonId: "salon-a", professionalId: "professional-a", clientId: "client-a",
    serviceIds: ["service-a", "service-b"], startLocal: "2030-09-11T17:30",
    origin: "ADMIN" as const, actor: { type: "STAFF" as const, id: "owner-a", name: "Dono" },
    idempotencyKey: "after-hours", enforceBookingWindow: false,
  };

  it("exige confirmação própria para terminar depois do último turno e audita sem mudar a jornada", async () => {
    const { tx, raw, appointmentCreate } = schedulingTx();
    await expect(createAppointment(tx, afterHoursInput)).rejects.toMatchObject({ code: "AFTER_WORKING_HOURS" });
    await expect(createAppointment(tx, { ...afterHoursInput, canOverride: true, overrideReason: "Encaixe" })).rejects.toMatchObject({ code: "AFTER_WORKING_HOURS" });
    await createAppointment(tx, { ...afterHoursInput, canFinishAfterHours: true, afterHoursReason: "Cliente após fechamento" });
    expect(appointmentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ startAt: new Date("2030-09-11T20:30:00Z"), endAt: new Date("2030-09-11T21:45:00Z"), isOverbooked: false }) }));
    expect(raw.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "APPOINTMENT_AFTER_HOURS_CREATE", reason: "Cliente após fechamento" }) }));
  });

  it.each(["2030-09-11T08:30", "2030-09-11T18:00", "2030-09-11T23:30"])("não libera início inválido %s com exceção de término", async startLocal => {
    const { tx, appointmentCreate } = schedulingTx();
    await expect(createAppointment(tx, { ...afterHoursInput, startLocal, canFinishAfterHours: true, afterHoursReason: "Exceção" })).rejects.toMatchObject({ code: "OUTSIDE_WORKING_HOURS" });
    expect(appointmentCreate).not.toHaveBeenCalled();
  });

  it("não libera exceção para público, folga, fechamento, pausa ou conflito", async () => {
    const { tx, raw } = schedulingTx();
    const input = { ...afterHoursInput, canFinishAfterHours: true, afterHoursReason: "Exceção" };
    await expect(createAppointment(tx, { ...input, origin: "PUBLIC", actor: { type: "CLIENT", id: "client-a", name: "Cliente" } })).rejects.toMatchObject({ code: "AFTER_WORKING_HOURS" });
    raw.salonClosure.findFirst.mockResolvedValue({ id: "closed" });
    await expect(createAppointment(tx, input)).rejects.toMatchObject({ code: "SALON_CLOSED" });
    raw.salonClosure.findFirst.mockResolvedValue(null);
    raw.timeOff.findFirst.mockResolvedValue({ id: "off" });
    await expect(createAppointment(tx, input)).rejects.toMatchObject({ code: "PROFESSIONAL_UNAVAILABLE" });
    raw.timeOff.findFirst.mockResolvedValue(null);
    raw.appointment.findFirst.mockResolvedValue({ id: "busy" });
    await expect(createAppointment(tx, input)).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    raw.appointment.findFirst.mockResolvedValue(null);
    raw.workingHours.findMany.mockResolvedValue([]);
    await expect(createAppointment(tx, input)).rejects.toMatchObject({ code: "OUTSIDE_WORKING_HOURS" });
    raw.workingHours.findMany.mockResolvedValue([{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 900, endMinutes: 1080 }]);
    await expect(createAppointment(tx, { ...input, startLocal: "2030-09-11T12:00" })).rejects.toMatchObject({ code: "WORKING_HOURS_BREAK" });
  });
  it("confirma bloqueio e sobreposição separadamente, mantendo o bloqueio público", async () => {
    const { tx, raw, appointmentCreate } = schedulingTx();
    raw.timeOff.findFirst.mockResolvedValue({ id: "block-a" });
    raw.appointment.findFirst.mockResolvedValue({ id: "busy-a" });
    const input = {
      salonId: "salon-a", professionalId: "professional-a", clientId: "client-a",
      serviceIds: ["service-a", "service-b"], startLocal: "2030-09-11T10:15",
      origin: "ADMIN" as const, actor: { type: "STAFF" as const, id: "owner-a", name: "Dono" },
      idempotencyKey: crypto.randomUUID(), enforceBookingWindow: false, canOverride: true, canOverrideTimeOff: true,
    };
    await expect(createAppointment(tx, input)).rejects.toMatchObject({ code: "PROFESSIONAL_UNAVAILABLE" });
    await expect(createAppointment(tx, { ...input, timeOffOverrideReason: "Encaixe no bloqueio" })).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    expect(appointmentCreate).not.toHaveBeenCalled();
    await createAppointment(tx, { ...input, timeOffOverrideReason: "Encaixe no bloqueio", overrideReason: "Atender em paralelo" });
    expect(appointmentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isOverbooked: true }) }));
    expect(raw.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "APPOINTMENT_BLOCK_OVERRIDE_CREATE" }) }));
    expect(raw.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "APPOINTMENT_OVERRIDE_CREATE" }) }));
    await expect(createAppointment(tx, { ...input, origin: "PUBLIC", actor: { type: "CLIENT", id: "client-a", name: "Cliente" }, timeOffOverrideReason: "Não autorizado" })).rejects.toMatchObject({ code: "PROFESSIONAL_UNAVAILABLE" });
  });

  it("a exceção de bloqueio não ignora fechamento do salão", async () => {
    const { tx, raw, appointmentCreate } = schedulingTx();
    raw.salonClosure.findFirst.mockResolvedValue({ id: "closure-a" });
    await expect(createAppointment(tx, {
      salonId: "salon-a", professionalId: "professional-a", clientId: "client-a", serviceIds: ["service-a", "service-b"], startLocal: "2030-09-11T10:15",
      origin: "ADMIN", actor: { type: "STAFF", id: "owner-a", name: "Dono" }, idempotencyKey: crypto.randomUUID(), enforceBookingWindow: false,
      canOverride: true, canOverrideTimeOff: true, timeOffOverrideReason: "Encaixe solicitado",
    })).rejects.toMatchObject({ code: "SALON_CLOSED" });
    expect(appointmentCreate).not.toHaveBeenCalled();
  });
  it("impede profissional de transferir atendimento para outro profissional", async () => {
    await expect(
      rescheduleAppointment({} as Tx, {
        salonId: "salon-a",
        appointmentId: "appointment-a",
        professionalId: "professional-other",
        startLocal: "2026-08-06T10:00",
        actor: { type: "STAFF", id: "user-a", name: "Profissional" },
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        permittedProfessionalId: "professional-own",
        enforceClientPolicy: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("soma duração/preço no servidor e converte o horário pelo fuso do salão", async () => {
    const { tx, raw } = schedulingTx();

    const result = await inspectAppointmentAvailability(tx, {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a", "service-b"],
      startLocal: "2026-08-06T10:00",
      enforceBookingWindow: false,
    });

    expect(result.violation).toBeNull();
    expect(result.startAt.toISOString()).toBe("2026-08-06T13:00:00.000Z");
    expect(result.endAt.toISOString()).toBe("2026-08-06T14:15:00.000Z");
    expect(result.services.map((service) => service.id)).toEqual([
      "service-a",
      "service-b",
    ]);
    expect(raw.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startAt: { lt: new Date("2026-08-06T14:30:00.000Z") },
          endAt: { gt: new Date("2026-08-06T12:45:00.000Z") },
        }),
      }),
    );
  });

  it("persiste snapshots, preço, evento e notificações uma única vez por chave", async () => {
    const { tx, raw, appointmentCreate } = schedulingTx();
    const input = {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a", "service-b"],
      startLocal: "2026-08-06T10:00",
      origin: "PUBLIC" as const,
      actor: { type: "CLIENT" as const, id: "client-a", name: "Cliente" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      enforceBookingWindow: false,
      clientId: "client-a",
    };

    const first = await createAppointment(tx, input);
    const persisted = appointmentCreate.mock.calls[0]![0].data as Record<string, unknown>;
    raw.appointment.findUnique.mockResolvedValue({
      id: first.appointment.id,
      startAt: first.appointment.startAt,
      endAt: first.appointment.endAt,
      version: 1,
      clientId: "client-a",
      professionalId: "professional-a",
      idempotencyFingerprint: persisted.idempotencyFingerprint,
    });
    const retry = await createAppointment(tx, input);

    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(appointmentCreate).toHaveBeenCalledOnce();
    expect(persisted).toEqual(
      expect.objectContaining({
        priceCents: 9_000,
        timezone: "America/Sao_Paulo",
        idempotencyKey: input.idempotencyKey,
        startAt: new Date("2026-08-06T13:00:00.000Z"),
        endAt: new Date("2026-08-06T14:15:00.000Z"),
      }),
    );
    expect(raw.appointmentService.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          appointmentId: first.appointment.id,
          salonId: "salon-a",
          serviceId: "service-a",
          position: 0,
          priceCents: 5_000,
        }),
        expect.objectContaining({
          appointmentId: first.appointment.id,
          salonId: "salon-a",
          serviceId: "service-b",
          position: 1,
          priceCents: 4_000,
        }),
      ],
    });
    expect(raw.appointmentEvent.create).toHaveBeenCalledOnce();
    expect(raw.notificationOutbox.createMany).toHaveBeenCalledOnce();
  });
});

describe("working hours at midnight", () => {
  it.each([[1080, "OUTSIDE_WORKING_HOURS"], [1440, null]])("end of working day %s: rejects overruns and accepts midnight only when configured", async (endMinutes, violation) => {
    const { tx, raw } = schedulingTx();
    raw.workingHours.findMany.mockResolvedValue([{ startMinutes: 540, endMinutes }]);
    const result = await inspectAppointmentAvailability(tx, { salonId: "salon-a", professionalId: "professional-a", serviceIds: ["service-a", "service-b"], startLocal: "2026-08-06T22:45", enforceBookingWindow: false });
    expect(result.violation).toBe(violation);
  });
});

describe("jornada com pausa diária e atendimento longo", () => {
  it.each([
    ["16:15", 210, null, "19:45"], ["16:30", 210, null, "20:00"],
    ["18:00", 30, null, "18:30"], ["20:30", 30, null, "21:00"],
    ["20:45", 30, "AFTER_WORKING_HOURS", "21:15"],
    ["12:00", 30, null, "12:30"], ["12:15", 30, "WORKING_HOURS_BREAK", "12:45"],
    ["14:30", 30, "WORKING_HOURS_BREAK", "15:00"], ["15:00", 30, null, "15:30"],
    ["06:00", 30, null, "06:30"], ["05:45", 30, "OUTSIDE_WORKING_HOURS", "06:15"],
  ])("%s com %s minutos → %s", async (time, durationMin, violation, endTime) => {
    const { tx, raw } = schedulingTx();
    raw.service.findMany.mockResolvedValue([{ id: "service-a", name: "Serviço de teste", durationMin: Number(durationMin), priceCents: 10000 }]);
    raw.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
    raw.workingHours.findMany.mockResolvedValue([{ startMinutes: 360, endMinutes: 750 }, { startMinutes: 900, endMinutes: 1260 }]);
    const result = await inspectAppointmentAvailability(tx, { salonId: "salon-a", professionalId: "professional-a", serviceIds: ["service-a"], startLocal: `2030-09-11T${time}`, enforceBookingWindow: false });
    expect(result.violation).toBe(violation);
    const { hhmmInTimeZone } = await import("../time");
    expect(hhmmInTimeZone(result.endAt, "America/Sao_Paulo")).toBe(endTime);
  });
  it("reproduz a causa: jornada encerrando às 18h bloqueia serviço de 3h30 às 16h15", async () => {
    const { tx, raw } = schedulingTx();
    raw.service.findMany.mockResolvedValue([{ id: "service-a", name: "Serviço de teste", durationMin: 210, priceCents: 10000 }]);
    raw.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
    const result = await inspectAppointmentAvailability(tx, { salonId: "salon-a", professionalId: "professional-a", serviceIds: ["service-a"], startLocal: "2030-09-11T16:15", enforceBookingWindow: false });
    expect(result.violation).toBe("AFTER_WORKING_HOURS");
  });

  it("distingue a pausa dos limites externos da jornada", async () => {
    const { tx, raw } = schedulingTx();
    raw.service.findMany.mockResolvedValue([
      { id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 },
    ]);
    raw.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
    raw.workingHours.findMany.mockResolvedValue([
      { startMinutes: 9 * 60, endMinutes: 12 * 60 + 30 },
      { startMinutes: 15 * 60, endMinutes: 21 * 60 },
    ]);

    const duringBreak = await inspectAppointmentAvailability(tx, {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      startLocal: "2030-09-11T13:30",
      enforceBookingWindow: false,
    });
    const beforeOpening = await inspectAppointmentAvailability(tx, {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      startLocal: "2030-09-11T08:30",
      enforceBookingWindow: false,
    });

    expect(duringBreak.violation).toBe("WORKING_HOURS_BREAK");
    expect(beforeOpening.violation).toBe("OUTSIDE_WORKING_HOURS");
  });

  it("permite exceção auditada na pausa com motivo opcional", async () => {
    const { tx, raw, appointmentCreate } = schedulingTx();
    raw.service.findMany.mockResolvedValue([
      { id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 },
    ]);
    raw.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
    raw.workingHours.findMany.mockResolvedValue([
      { startMinutes: 9 * 60, endMinutes: 12 * 60 + 30 },
      { startMinutes: 15 * 60, endMinutes: 21 * 60 },
    ]);
    const baseInput = {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      startLocal: "2030-09-11T13:30",
      origin: "ADMIN" as const,
      actor: { type: "STAFF" as const, id: "owner-a", name: "Dono" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      enforceBookingWindow: false,
      clientId: "client-a",
    };

    await expect(createAppointment(tx, baseInput)).rejects.toMatchObject({
      code: "WORKING_HOURS_BREAK",
    });
    expect(appointmentCreate).not.toHaveBeenCalled();

    const result = await createAppointment(tx, {
      ...baseInput,
      canOverrideWorkingHoursBreak: true,
      overrideConfirmed: true,
    });

    expect(result.duplicate).toBe(false);
    expect(appointmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isOverbooked: false }),
      select: expect.any(Object),
    });
    expect(raw.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "APPOINTMENT_BREAK_OVERRIDE_CREATE",
        reason: null,
        salonId: "salon-a",
      }),
    });
    expect(raw.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: null }),
      }),
    );
  });

  it("devolve a pausa detectada antes de pedir o motivo da exceção", async () => {
    const { tx, raw, appointmentCreate } = schedulingTx();
    raw.service.findMany.mockResolvedValue([
      { id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 },
    ]);
    raw.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
    raw.workingHours.findMany.mockResolvedValue([
      { startMinutes: 9 * 60, endMinutes: 12 * 60 + 30 },
      { startMinutes: 15 * 60, endMinutes: 21 * 60 },
    ]);

    await expect(createAppointment(tx, {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      startLocal: "2030-09-11T13:30",
      origin: "ADMIN",
      actor: { type: "STAFF", id: "owner-a", name: "Dono" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      enforceBookingWindow: false,
      clientId: "client-a",
      canOverrideWorkingHoursBreak: true,
    })).rejects.toMatchObject({ code: "WORKING_HOURS_BREAK" });
    expect(appointmentCreate).not.toHaveBeenCalled();
  });

  it("não deixa a autorização de pausa abrir horário antes do expediente", async () => {
    const { tx, raw } = schedulingTx();
    raw.service.findMany.mockResolvedValue([
      { id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 },
    ]);
    raw.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
    raw.workingHours.findMany.mockResolvedValue([
      { startMinutes: 9 * 60, endMinutes: 12 * 60 + 30 },
      { startMinutes: 15 * 60, endMinutes: 21 * 60 },
    ]);

    await expect(createAppointment(tx, {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      startLocal: "2030-09-11T08:30",
      origin: "ADMIN",
      actor: { type: "STAFF", id: "owner-a", name: "Dono" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      enforceBookingWindow: false,
      clientId: "client-a",
      overrideReason: "Abertura excepcional",
      canOverrideWorkingHoursBreak: true,
    })).rejects.toMatchObject({ code: "OUTSIDE_WORKING_HOURS" });
  });

  it("não deixa a pausa mascarar folga ou bloqueio do profissional", async () => {
    const { tx, raw } = schedulingTx();
    raw.service.findMany.mockResolvedValue([
      { id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 },
    ]);
    raw.professionalService.findMany.mockResolvedValue([{ serviceId: "service-a" }]);
    raw.workingHours.findMany.mockResolvedValue([
      { startMinutes: 9 * 60, endMinutes: 12 * 60 + 30 },
      { startMinutes: 15 * 60, endMinutes: 21 * 60 },
    ]);
    raw.timeOff.findFirst.mockResolvedValue({ id: "time-off-a" });

    await expect(createAppointment(tx, {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      startLocal: "2030-09-11T13:30",
      origin: "ADMIN",
      actor: { type: "STAFF", id: "owner-a", name: "Dono" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      enforceBookingWindow: false,
      clientId: "client-a",
      overrideReason: "Cliente só pode vir no almoço",
      canOverrideWorkingHoursBreak: true,
    })).rejects.toMatchObject({ code: "PROFESSIONAL_UNAVAILABLE" });
  });
});
