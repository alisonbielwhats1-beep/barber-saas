import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  subscription: null as null | Record<string, unknown>,
  updates: [] as Array<{ model: string; args: Record<string, unknown> }>,
  send: vi.fn(),
  findManyWhere: null as null | Record<string, unknown>,
}));

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../client-push", () => ({
  clientPushEnabled: () => true,
  sendClientPush: state.send,
}));
vi.mock("../prisma-tenant", () => {
  const tx = {
    notificationOutbox: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        state.findManyWhere = args.where;
        return state.row ? [{ id: state.row.id }] : [];
      }),
      findFirst: vi.fn(async () => state.row),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        state.updates.push({ model: "outbox", args });
        return { count: 1 };
      }),
    },
    clientPushSubscription: {
      findFirst: vi.fn(async () => state.subscription),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        state.updates.push({ model: "subscription", args });
        return { count: 1 };
      }),
    },
  };
  return {
    withApprovedSalon: async (_salonId: string, fn: (t: typeof tx) => unknown) => fn(tx),
    withSalon: async (_salonId: string, fn: (t: typeof tx) => unknown) => fn(tx),
  };
});

const payload = {
  title: "Seu horário foi cancelado",
  body: "Studio cancelou seu horário de sábado, 10/10, às 14:30. Toque para ver suas reservas.",
  url: "/book/studio/minhas",
  pushSubscriptionId: "device-a",
};

beforeEach(() => {
  vi.useFakeTimers();
  state.updates = [];
  state.send.mockReset();
  state.row = { id: "row-1", eventId: "event-1", recipientId: "client-a", payload, attempts: 0 };
  state.subscription = { id: "device-a", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" };
});

async function run() {
  const { deliverPendingClientChangeNotices } = await import("../client-change-notice");
  const promise = deliverPendingClientChangeNotices(["salon-a"], new Date("2026-10-10T12:00:00Z"));
  await vi.runAllTimersAsync();
  await promise;
}

const finalStatus = () => {
  const last = [...state.updates].reverse().find((u) => u.model === "outbox" && (u.args.data as { status?: string }).status);
  return last?.args.data as { status: string; lastError?: string | null; nextAttemptAt?: Date | null };
};

describe("entrega do aviso de cancelamento e remarcação", () => {
  it("só busca avisos dos dois templates, das últimas 24 horas", async () => {
    await run();
    expect(state.findManyWhere).toMatchObject({
      channel: "PUSH",
      status: "PENDING",
      template: { in: ["appointment.cancelled", "appointment.rescheduled"] },
      createdAt: { gte: new Date("2026-10-09T12:00:00Z") },
    });
  });

  it("envia o texto pronto, com tag própria do evento, e marca como enviado", async () => {
    state.send.mockResolvedValue(undefined);
    await run();
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "https://fcm.googleapis.com/x",
      title: payload.title,
      body: payload.body,
      url: "/book/studio/minhas",
      tag: "appointment-change:event-1",
      ttlSeconds: 24 * 60 * 60,
    }));
    expect(finalStatus()).toMatchObject({ status: "SENT", lastError: null });
  });

  it("aparelho que não existe mais (410) falha de vez e revoga a inscrição", async () => {
    state.send.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    await run();
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(finalStatus()).toMatchObject({ status: "FAILED", lastError: "PUSH_HTTP_410", nextAttemptAt: null });
    expect(state.updates.some((u) => u.model === "subscription")).toBe(true);
  });

  it("falha temporária do provedor tenta de novo na hora e deixa pendente para o cron", async () => {
    state.send.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 503 }));
    await run();
    expect(state.send).toHaveBeenCalledTimes(2);
    const result = finalStatus();
    expect(result.status).toBe("PENDING");
    expect(result.lastError).toBe("PUSH_HTTP_503");
    expect(result.nextAttemptAt).toBeInstanceOf(Date);
    expect(state.updates.some((u) => u.model === "subscription")).toBe(false);
  });

  it("depois da terceira tentativa desiste", async () => {
    state.row = { ...state.row!, attempts: 2 };
    state.send.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 503 }));
    await run();
    expect(finalStatus()).toMatchObject({ status: "FAILED", nextAttemptAt: null });
  });

  it("inscrição revogada no meio do caminho não envia nada", async () => {
    state.subscription = null;
    await run();
    expect(state.send).not.toHaveBeenCalled();
    expect(finalStatus()).toMatchObject({ status: "FAILED", lastError: "PUSH_SUBSCRIPTION_REVOKED" });
  });
});
