import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/prisma-tenant";

const push = {
  CLIENT_PUSH_ENABLED: "true",
  VAPID_PUBLIC_KEY: "public",
  VAPID_PRIVATE_KEY: "private",
  VAPID_SUBJECT: "mailto:test@example.test",
};

const eventPayload = {
  startAt: "2026-10-12T17:30:00.000Z",
  previousStartAt: "2026-10-10T17:30:00.000Z",
  timezone: "America/Sao_Paulo",
};

function fakeTx(options: { devices?: string[] } = {}) {
  const devices = options.devices ?? ["device-a", "device-b"];
  const rows: Array<Record<string, unknown>> = [];
  const tx = {
    salon: {
      findFirst: vi.fn().mockResolvedValue({ name: "Studio Martinelli", slug: "studio-martinelli", timezone: "America/Sao_Paulo" }),
    },
    clientPushSubscription: { findMany: vi.fn().mockResolvedValue(devices.map((id) => ({ id }))) },
    clientProfile: { findFirst: vi.fn() },
    notificationOutbox: {
      count: vi.fn().mockImplementation(async () => rows.length),
      createMany: vi.fn().mockImplementation(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        rows.push(...data);
        return { count: data.length };
      }),
    },
  } as unknown as Tx;
  return { tx, rows };
}

const base = {
  salonId: "salon-a",
  clientId: "client-a",
  appointmentId: "appointment-a",
  eventId: "event-a",
  payload: eventPayload,
};

describe("aviso imediato ao cliente (cancelamento e remarcação pelo estabelecimento)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("não faz nada sem push configurado em Produção", async () => {
    const { queueClientChangeNotice } = await import("../client-change-notice");
    const { tx, rows } = fakeTx();
    expect(await queueClientChangeNotice(tx, { ...base, template: "appointment.cancelled" })).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("enfileira um push por aparelho com texto claro e link para as reservas", async () => {
    for (const [key, value] of Object.entries(push)) vi.stubEnv(key, value);
    const { queueClientChangeNotice } = await import("../client-change-notice");
    const { tx, rows } = fakeTx();
    const queued = await queueClientChangeNotice(tx, { ...base, template: "appointment.rescheduled" });
    expect(queued).toBe(2);
    expect(rows.map((row) => row.recipientKey)).toEqual([
      "CLIENT:client-a:PUSH:device-a",
      "CLIENT:client-a:PUSH:device-b",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ channel: "PUSH", status: "PENDING", template: "appointment.rescheduled" });
      expect(row.payload).toMatchObject({
        title: "Seu horário foi alterado",
        body: "Studio Martinelli mudou seu horário de sábado, 10/10, às 14:30 para segunda-feira, 12/10, às 14:30. Toque para conferir.",
        url: "/book/studio-martinelli/minhas",
      });
    }
  });

  it("cliente sem aparelho cadastrado não gera linha (e nunca e-mail)", async () => {
    for (const [key, value] of Object.entries(push)) vi.stubEnv(key, value);
    vi.stubEnv("CLIENT_REMINDER_EMAIL_ENABLED", "true");
    const { queueClientChangeNotice } = await import("../client-change-notice");
    const { tx, rows } = fakeTx({ devices: [] });
    expect(await queueClientChangeNotice(tx, { ...base, template: "appointment.cancelled" })).toBe(0);
    expect(rows).toHaveLength(0);
    expect((tx as unknown as { clientProfile: { findFirst: ReturnType<typeof vi.fn> } }).clientProfile.findFirst).not.toHaveBeenCalled();
  });

  it("ignora templates que não são cancelamento ou remarcação", async () => {
    for (const [key, value] of Object.entries(push)) vi.stubEnv(key, value);
    const { queueClientChangeNotice } = await import("../client-change-notice");
    const { tx, rows } = fakeTx();
    for (const template of ["appointment.created", "appointment.reminder", "appointment.reschedule_requested"]) {
      expect(await queueClientChangeNotice(tx, { ...base, template })).toBe(0);
    }
    expect(rows).toHaveLength(0);
  });
});

describe("recordAppointmentEvent dispara o aviso só quando o estabelecimento age", () => {
  beforeEach(() => vi.resetModules());

  async function record(actorType: "STAFF" | "CLIENT" | "GUEST" | "SYSTEM", template: string, recipients: Array<{ type: "CLIENT" | "USER"; id: string }>) {
    const queue = vi.fn().mockResolvedValue(1);
    const schedule = vi.fn();
    vi.doMock("../client-change-notice", () => ({ queueClientChangeNotice: queue, scheduleClientChangeDelivery: schedule }));
    const { recordAppointmentEvent } = await import("../appointment-events");
    const tx = {
      appointmentEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }), findUnique: vi.fn() },
      notificationOutbox: { createMany: vi.fn().mockResolvedValue({ count: recipients.length }) },
      $queryRaw: vi.fn(),
    } as unknown as Tx;
    await recordAppointmentEvent(tx, {
      salonId: "salon-a",
      appointmentId: "appointment-a",
      eventType: "CANCELLED",
      actor: { type: actorType, name: "Quem fez" },
      correlationId: "c-1",
      recipients,
      template,
      payload: eventPayload,
    });
    vi.doUnmock("../client-change-notice");
    return { queue, schedule };
  }

  const both = [{ type: "CLIENT" as const, id: "client-a" }, { type: "USER" as const, id: "user-a" }];

  it("equipe cancela: avisa o cliente e agenda a entrega", async () => {
    const { queue, schedule } = await record("STAFF", "appointment.cancelled", both);
    expect(queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: "client-a", eventId: "event-1", template: "appointment.cancelled",
    }));
    expect(schedule).toHaveBeenCalledWith("salon-a");
  });

  it("equipe remarca: avisa o cliente", async () => {
    const { queue } = await record("STAFF", "appointment.rescheduled", both);
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it("o cliente cancelando ou remarcando não recebe aviso dele mesmo", async () => {
    for (const actor of ["CLIENT", "GUEST"] as const) {
      const { queue, schedule } = await record(actor, "appointment.cancelled", both);
      expect(queue).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    }
  });

  it("sem cliente entre os destinatários ou com outro tipo de evento, nada é enviado", async () => {
    expect((await record("STAFF", "appointment.cancelled", [{ type: "USER", id: "user-a" }])).queue).not.toHaveBeenCalled();
    expect((await record("STAFF", "appointment.created", both)).queue).not.toHaveBeenCalled();
    expect((await record("STAFF", "appointment.reschedule_requested", both)).queue).not.toHaveBeenCalled();
  });

  it("sem aparelho (0 linhas) não agenda entrega", async () => {
    const queue = vi.fn().mockResolvedValue(0);
    const schedule = vi.fn();
    vi.doMock("../client-change-notice", () => ({ queueClientChangeNotice: queue, scheduleClientChangeDelivery: schedule }));
    const { recordAppointmentEvent } = await import("../appointment-events");
    const tx = {
      appointmentEvent: { create: vi.fn().mockResolvedValue({ id: "event-2" }), findUnique: vi.fn() },
      notificationOutbox: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: vi.fn(),
    } as unknown as Tx;
    await recordAppointmentEvent(tx, {
      salonId: "salon-a", appointmentId: "appointment-a", eventType: "CANCELLED",
      actor: { type: "STAFF", name: "Equipe" }, correlationId: "c-2",
      recipients: both, template: "appointment.cancelled", payload: eventPayload,
    });
    vi.doUnmock("../client-change-notice");
    expect(queue).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });
});
