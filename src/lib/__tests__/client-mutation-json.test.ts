import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientSession: vi.fn(),
  withSalonBySlug: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: () => Promise.resolve({ allowed: true, source: "local" }),
  rateLimitHeaders: () => ({}),
  rateLimitStatus: () => 429,
}));

import { POST as cancelAppointment } from "@/app/api/client/cancel/route";
import { POST as rescheduleAppointment } from "@/app/api/client/reschedule/route";
import { POST as cancelWaitlist } from "@/app/api/client/waitlist/cancel/route";

const malformedRequest = () => new NextRequest("http://localhost/api/client/action", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{",
});

describe("mutações do cliente com JSON malformado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["cancelamento", cancelAppointment],
    ["remarcação", rescheduleAppointment],
    ["saída da fila", cancelWaitlist],
  ])("%s responde BAD_REQUEST sem consultar sessão ou tenant", async (_name, handler) => {
    const response = await handler(malformedRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "BAD_REQUEST" });
    expect(mocks.getClientSession).not.toHaveBeenCalled();
    expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
  });
});
