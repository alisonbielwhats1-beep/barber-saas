import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { fulfillWaitlistEntryElsewhere } from "../waitlist";

function txWith(entry: Record<string, unknown> | null, updatedCount = 1) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    waitlistEntry: {
      findFirst: vi.fn()
        .mockResolvedValueOnce(entry ? { appointmentId: "appointment-source" } : null)
        .mockResolvedValueOnce(entry),
      updateMany: vi.fn().mockResolvedValue({ count: updatedCount }),
    },
    auditLog: { create: vi.fn() },
  };
  return tx;
}

const input = {
  salonId: "salon-a",
  entryId: "entry-a",
  appointmentId: "appointment-new",
  clientId: "client-a",
  actor: { id: "user-a", name: "Dona" },
};

const active = {
  appointmentId: "appointment-source",
  clientId: "client-a",
  startAt: new Date("2030-10-02T11:30:00.000Z"),
  fulfilledAt: null,
  fulfilledAppointmentId: null,
  cancelledAt: null,
};

describe("fila atendida em outro horário", () => {
  it("marca a entrada como atendida pela nova reserva e audita", async () => {
    const tx = txWith(active);
    expect(await fulfillWaitlistEntryElsewhere(tx as unknown as Tx, input))
      .toEqual({ sourceAppointmentId: "appointment-source", duplicate: false });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.waitlistEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "entry-a", salonId: "salon-a" } }));
    expect(tx.waitlistEntry.updateMany).toHaveBeenCalledWith({
      where: { id: "entry-a", salonId: "salon-a", fulfilledAt: null, cancelledAt: null },
      data: { fulfilledAt: expect.any(Date), fulfilledAppointmentId: "appointment-new" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      salonId: "salon-a",
      action: "WAITLIST_SCHEDULED_ELSEWHERE",
      entityId: "entry-a",
      metadata: expect.objectContaining({ sourceAppointmentId: "appointment-source", appointmentId: "appointment-new" }),
    }) });
  });

  it("entrada de outro tenant ou inexistente não é encontrada", async () => {
    const tx = txWith(null);
    await expect(fulfillWaitlistEntryElsewhere(tx as unknown as Tx, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.waitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("entrada removida da fila desfaz a criação", async () => {
    const tx = txWith({ ...active, cancelledAt: new Date() });
    await expect(fulfillWaitlistEntryElsewhere(tx as unknown as Tx, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.waitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("não aceita reserva para outro cliente", async () => {
    const tx = txWith({ ...active, clientId: "client-other" });
    await expect(fulfillWaitlistEntryElsewhere(tx as unknown as Tx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("convidado sem conta pode ser atendido pelo perfil criado na reserva", async () => {
    const tx = txWith({ ...active, clientId: null });
    await expect(fulfillWaitlistEntryElsewhere(tx as unknown as Tx, input)).resolves.toMatchObject({ duplicate: false });
  });

  it("retry da mesma reserva é idempotente; outra reserva é recusada", async () => {
    const done = { ...active, fulfilledAt: new Date(), fulfilledAppointmentId: "appointment-new" };
    const retry = txWith(done);
    expect(await fulfillWaitlistEntryElsewhere(retry as unknown as Tx, input)).toEqual({ sourceAppointmentId: "appointment-source", duplicate: true });
    expect(retry.waitlistEntry.updateMany).not.toHaveBeenCalled();
    const other = txWith({ ...done, fulfilledAppointmentId: "appointment-other" });
    await expect(fulfillWaitlistEntryElsewhere(other as unknown as Tx, input)).rejects.toMatchObject({ code: "ALREADY_FULFILLED" });
  });

  it("corrida perdida no update aborta", async () => {
    const tx = txWith(active, 0);
    await expect(fulfillWaitlistEntryElsewhere(tx as unknown as Tx, input)).rejects.toMatchObject({ code: "ALREADY_FULFILLED" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
