import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ctx: { salonId: "salon-a", userId: "owner-a", role: "OWNER" },
  tx: { salon: { update: vi.fn(), findUnique: vi.fn() } },
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: async () => mocks.ctx,
  assertRole: (ctx: { role: string }, roles: string[]) => {
    if (!roles.includes(ctx.role)) throw new Error("Forbidden");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withTenant: async (_ctx: unknown, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
}));
import { updateSalonBranding } from "./actions";

const ownCover = "https://proj.supabase.co/storage/v1/object/public/salon-assets/salon-a/branding/capa.jpg";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
  mocks.ctx.role = "OWNER";
  mocks.tx.salon.findUnique.mockResolvedValue({ slug: "studio-a" });
});

function savedData() {
  return mocks.tx.salon.update.mock.calls[0][0].data;
}

describe("nome sobre a capa", () => {
  it("permite ocultar o nome quando a capa própria já o traz", async () => {
    await updateSalonBranding({ coverUrl: ownCover, coverShowName: false });
    expect(savedData()).toMatchObject({ coverUrl: ownCover, coverShowName: false });
    expect(mocks.revalidate).toHaveBeenCalledWith("/book/studio-a");
  });

  it("mantém o nome visível por padrão", async () => {
    await updateSalonBranding({ coverUrl: ownCover });
    expect(savedData()).toMatchObject({ coverShowName: true });
  });

  it("sempre mostra o nome sobre a imagem padrão do segmento", async () => {
    await updateSalonBranding({ coverUrl: "", coverShowName: false });
    expect(savedData()).toMatchObject({ coverUrl: null, coverShowName: true });
  });

  it("recusa capa de outro estabelecimento antes de gravar", async () => {
    const foreign = ownCover.replace("/salon-a/", "/salon-b/");
    await expect(updateSalonBranding({ coverUrl: foreign, coverShowName: false })).rejects.toThrow(
      "outro estabelecimento",
    );
    expect(mocks.tx.salon.update).not.toHaveBeenCalled();
  });

  it("não permite que profissional altere a vitrine", async () => {
    mocks.ctx.role = "PROFESSIONAL";
    await expect(updateSalonBranding({ coverUrl: ownCover, coverShowName: false })).rejects.toThrow("Forbidden");
    expect(mocks.tx.salon.update).not.toHaveBeenCalled();
  });
});
