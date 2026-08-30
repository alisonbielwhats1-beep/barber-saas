import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withSalonBySlug: vi.fn(),
}));

vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));

import { GET } from "./route";

describe("manifesto instalável do salão", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gera um manifesto do salão com a entrada do cliente", async () => {
    mocks.withSalonBySlug.mockImplementation(
      async (_slug: string, callback: (tx: unknown, salonId: string) => unknown) =>
        callback(
          { salon: { findUnique: vi.fn().mockResolvedValue({ name: "Studio Atual" }) } },
          "salon-a",
        ),
    );

    const response = await GET(
      new Request("https://salon.example/book/studio-a/manifest.webmanifest"),
      { params: Promise.resolve({ salonSlug: "studio-a" }) },
    );
    const manifest = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    expect(manifest.name).toBe("Studio Atual — agendamento online");
    expect(manifest.start_url).toBe("/book/studio-a/welcome");
    expect(manifest.scope).toBe("/book/studio-a/");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
    ]));
  });

  it("não expõe manifesto para salão inexistente ou não aprovado", async () => {
    mocks.withSalonBySlug.mockResolvedValue(null);

    const response = await GET(
      new Request("https://salon.example/book/unknown/manifest.webmanifest"),
      { params: Promise.resolve({ salonSlug: "unknown" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });
});
