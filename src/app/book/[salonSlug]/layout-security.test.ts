import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withSalonBySlug: vi.fn(),
}));

vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));
vi.mock("@/lib/client-auth", () => ({
  getClientSession: vi.fn(),
}));
vi.mock("@/lib/public-appointment", () => ({
  resolveClientSessionInTenant: vi.fn(),
}));

import { generateMetadata } from "./layout";

describe("metadados da vitrine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("usa o gate de salão aprovado para obter o nome", async () => {
    mocks.withSalonBySlug.mockResolvedValue({ name: "Studio A" });

    await expect(generateMetadata({
      params: Promise.resolve({ salonSlug: "studio-a" }),
    })).resolves.toEqual(expect.objectContaining({
      title: "Studio A — agendamento online",
    }));
    expect(mocks.withSalonBySlug).toHaveBeenCalledWith("studio-a", expect.any(Function));
  });

  it("não expõe nome de salão indisponível", async () => {
    mocks.withSalonBySlug.mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ salonSlug: "suspenso" }),
    });

    expect(metadata.title).toBe("SalonSaaS");
    expect(metadata.appleWebApp).toEqual(expect.objectContaining({ title: "SalonSaaS" }));
  });
});
