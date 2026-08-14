import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  compare: vi.fn(),
  redirect: vi.fn(),
  withSalonBySlug: vi.fn(),
  isApprovedSalonSlug: vi.fn(),
  setClientSession: vi.fn(),
  checkRateLimit: vi.fn(),
  clientFindFirst: vi.fn(),
  clientCreate: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: mocks.hash, compare: mocks.compare },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
  isApprovedSalonSlug: mocks.isApprovedSalonSlug,
}));
vi.mock("@/lib/client-auth", () => ({
  setClientSession: mocks.setClientSession,
  clearClientSession: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: mocks.checkRateLimit,
}));

import { loginClient, registerClient } from "@/app/book/[salonSlug]/auth-actions";
import { clientSessionForSalon } from "@/lib/public-appointment";

const tx = {
  clientProfile: {
    findFirst: mocks.clientFindFirst,
    create: mocks.clientCreate,
  },
};

describe("client auth regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, source: "local" });
    mocks.isApprovedSalonSlug.mockResolvedValue(true);
    mocks.hash.mockResolvedValue("password-hash");
    mocks.compare.mockResolvedValue(false);
    mocks.clientFindFirst.mockResolvedValue(null);
    mocks.clientCreate.mockResolvedValue({ id: "client-a" });
    mocks.withSalonBySlug.mockImplementation(
      async (_slug: string, callback: (value: typeof tx, salonId: string) => unknown) =>
        callback(tx, "salon-a"),
    );
  });

  it("keeps login recoverable when the tenant lookup fails", async () => {
    mocks.withSalonBySlug.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      loginClient("studio-a", "maria@example.com", "123456"),
    ).resolves.toMatchObject({ error: expect.stringContaining("Tente novamente") });
    expect(mocks.setClientSession).not.toHaveBeenCalled();
  });

  it("keeps registration recoverable when the tenant write fails", async () => {
    mocks.withSalonBySlug.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      registerClient("studio-a", {
        name: "Maria Silva",
        phone: "",
        email: "maria@example.com",
        password: "123456",
      }),
    ).resolves.toMatchObject({ error: expect.stringContaining("Tente novamente") });
    expect(mocks.setClientSession).not.toHaveBeenCalled();
  });

  it("does not treat a session from another salon as the current client", () => {
    const session = {
      clientId: "client-a",
      salonId: "salon-a",
      name: "Maria Silva",
      email: "maria@example.com",
    };

    expect(clientSessionForSalon(session, "salon-a")).toEqual(session);
    expect(clientSessionForSalon(session, "salon-b")).toBeNull();
    expect(clientSessionForSalon(null, "salon-a")).toBeNull();
  });
});
