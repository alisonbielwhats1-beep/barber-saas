import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenantContext: vi.fn(),
  revalidatePath: vi.fn(),
  withTenant: vi.fn(),
  findProfessional: vi.fn(),
  createPortfolioItem: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: mocks.getTenantContext,
  assertRole: (ctx: { role: string }, roles: readonly string[]) => {
    if (!roles.includes(ctx.role)) throw new Error("Forbidden");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: mocks.withTenant }));

import { createPortfolioItem } from "@/app/(admin)/portfolio/actions";

const professionalContext = {
  userId: "user-professional",
  salonId: "salon-a",
  role: "PROFESSIONAL",
};

const ownImage =
  "https://project-a.supabase.co/storage/v1/object/public/salon-assets/salon-a/portfolio/work.jpg";

describe("isolamento do portfólio profissional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_URL", "https://project-a.supabase.co");
    mocks.getTenantContext.mockResolvedValue(professionalContext);
    mocks.withTenant.mockImplementation(
      (_ctx: unknown, callback: (tx: unknown) => unknown) =>
        callback({
          professional: { findFirst: mocks.findProfessional },
          portfolioItem: { create: mocks.createPortfolioItem },
        }),
    );
    mocks.findProfessional.mockResolvedValue({ id: "professional-own" });
    mocks.createPortfolioItem.mockResolvedValue({ id: "portfolio-1" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("força a publicação no perfil ligado ao usuário", async () => {
    await createPortfolioItem({
      imageUrl: ownImage,
      caption: "Trabalho",
      professionalId: null,
    });

    expect(mocks.findProfessional).toHaveBeenCalledWith({
      where: {
        salonId: "salon-a",
        userId: "user-professional",
        active: true,
      },
      select: { id: true },
    });
    expect(mocks.createPortfolioItem).toHaveBeenCalledWith({
      data: expect.objectContaining({
        salonId: "salon-a",
        professionalId: "professional-own",
      }),
    });
  });

  it("rejeita tentativa de publicar no perfil de outro profissional", async () => {
    await expect(
      createPortfolioItem({
        imageUrl: ownImage,
        caption: null,
        professionalId: "professional-other",
      }),
    ).rejects.toThrow("seu próprio portfólio");

    expect(mocks.createPortfolioItem).not.toHaveBeenCalled();
  });
});
