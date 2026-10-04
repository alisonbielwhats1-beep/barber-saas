import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  resolve: vi.fn(),
  create: vi.fn(),
  rate: vi.fn(),
  tenant: vi.fn(),
  tx: {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma-tenant", () => ({ withApprovedSalon: m.tenant }));
vi.mock("@/lib/client-auth", () => ({ getClientSession: m.session }));
vi.mock("@/lib/public-appointment", () => ({
  resolveClientSessionInTenant: m.resolve,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "synthetic",
  checkRateLimit: m.rate,
  rateLimitHeaders: () => ({ "Retry-After": "60" }),
}));
vi.mock("@/lib/visit-scheduling", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visit-scheduling")>()),
  createVisit: m.create,
}));
import { AppointmentError } from "@/lib/appointment-domain";
import { PlanLimitError } from "@/lib/plan-entitlements";
import { POST } from "./route";
const body = {
  salonId: "salon",
  date: "2030-09-16",
  startLocal: "2030-09-16T15:00",
  choices: [
    { serviceId: "hair", professionalId: "anderson" },
    { serviceId: "nails", professionalId: "tati" },
  ],
  quote: "a".repeat(64),
  idempotencyKey: crypto.randomUUID(),
};
const request = (value: unknown = body) =>
  POST(
    new NextRequest("http://localhost/api/visits", {
      method: "POST",
      body: JSON.stringify(value),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.rate.mockResolvedValue({ allowed: true });
  m.session.mockResolvedValue({
    clientId: "client",
    salonId: "salon",
    name: "Cliente",
  });
  m.resolve.mockResolvedValue({ clientId: "client", name: "Cliente" });
  m.tenant.mockImplementation(
    async (_id: string, callback: (tx: unknown) => unknown) => callback(m.tx),
  );
  m.create.mockResolvedValue({
    duplicate: false,
    appointmentIds: ["one", "two"],
  });
});
describe("confirmação pública de visita", () => {
  it("exige sessão do mesmo salão e revalida sessão revogada antes de escrever", async () => {
    m.session.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);
    m.session.mockResolvedValueOnce({ clientId: "other", salonId: "other" });
    expect((await request()).status).toBe(401);
    m.resolve.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rejeita cliente informado, exceções da equipe e divergência de dia", async () => {
    for (const extra of [
      { clientId: "other" },
      { manual: true },
      { scheduleOverrideReason: "Folga" },
      { date: "2030-09-17" },
    ])
      expect((await request({ ...body, ...extra })).status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("confirma uma única transação com identidade obtida da sessão", async () => {
    expect((await request()).status).toBe(201);
    expect(m.create).toHaveBeenCalledExactlyOnceWith(
      m.tx,
      expect.objectContaining({
        clientId: "client",
        actor: { type: "CLIENT", id: "client", name: "Cliente" },
        choices: body.choices,
      }),
    );
    m.create.mockResolvedValueOnce({
      duplicate: true,
      appointmentIds: ["one", "two"],
    });
    expect((await request()).status).toBe(200);
  });
  it("falha fechada no limite e em salão indisponível", async () => {
    m.rate.mockResolvedValueOnce({ allowed: false });
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    m.tenant.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("conflito de domínio não apresenta confirmação parcial", async () => {
    m.create.mockRejectedValueOnce(new AppointmentError("SLOT_TAKEN"));
    const result = await request();
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({
      code: "SLOT_TAKEN",
      error: expect.stringContaining("Nenhum atendimento"),
    });
  });
  it("limite do plano continua sendo conflito, não falha de servidor", async () => {
    m.create.mockRejectedValueOnce(new PlanLimitError("limite do plano"));
    const result = await request();
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({
      code: "VISIT_UNAVAILABLE",
      error: expect.stringContaining("Nenhum atendimento"),
    });
  });
  it("falha inesperada vira 500 genérico, é registrada e não vaza detalhes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    m.create.mockRejectedValueOnce(new Error("private database detail"));
    const result = await request();
    expect(result.status).toBe(500);
    const payload = await result.json();
    expect(payload).toEqual({
      code: "VISIT_FAILED",
      error: expect.stringContaining("Tente novamente"),
    });
    expect(JSON.stringify(payload)).not.toContain("private database detail");
    expect(payload.error).not.toContain("Nenhum atendimento");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe("[visits] unexpected failure");
    log.mockRestore();
  });
  it("falha do Prisma registra só nome e código, sem a mensagem com valores da consulta", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const prisma = Object.assign(new Error("Unique constraint failed on email=ana@example.test"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    m.create.mockRejectedValueOnce(prisma);
    expect((await request()).status).toBe(500);
    expect(log.mock.calls[0]![1]).toEqual({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      message: undefined,
    });
    log.mockRestore();
  });
});
