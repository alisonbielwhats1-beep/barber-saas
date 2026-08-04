import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
const findMembership = vi.fn();
const upload = vi.fn();
const from = vi.fn(() => ({
  upload,
  getPublicUrl: vi.fn((path: string) => ({
    data: { publicUrl: `https://assets.example/${path}` },
  })),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// A rota passa por withUser (prisma-tenant.ts) para achar a membership — o
// mock precisa de $transaction executando o callback com o client mockado
// (mesmo ajuste de finance-access-security.test.ts) e de $executeRaw, que é
// o set_config da GUC.
vi.mock("@/lib/prisma", () => {
  const tx = { membership: { findFirst: findMembership } };
  return {
    prisma: {
      ...tx,
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ ...tx, $executeRaw: vi.fn().mockResolvedValue(undefined) }),
    },
  };
});
vi.mock("@/lib/supabase", () => ({
  STORAGE_BUCKET: "salon-assets",
  getSupabaseAdmin: () => ({ storage: { from } }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    limit: 20,
    remaining: 19,
    retryAfterSeconds: 3_600,
    source: "distributed",
  })),
  clientIp: () => "198.51.100.10",
  rateLimitHeaders: () => ({}),
  rateLimitStatus: () => 429,
}));

const { POST } = await import("@/app/api/upload/route");

function request(input: {
  folder: string;
  bytes?: number[];
  type?: string;
  activeSalonId?: string;
}) {
  const data = new FormData();
  data.set(
    "file",
    new File(
      [Uint8Array.from(input.bytes ?? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "asset.png",
      { type: input.type ?? "image/png" },
    ),
  );
  data.set("folder", input.folder);
  return {
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        name === "active_salon" && input.activeSalonId
          ? { value: input.activeSalonId }
          : undefined,
    },
    formData: async () => data,
  };
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ user: { id: "user-a" } });
    findMembership.mockResolvedValue({
      salonId: "salon-a",
      role: "OWNER",
    });
    upload.mockResolvedValue({ error: null });
  });

  it("nega usuário autenticado sem membership", async () => {
    findMembership.mockResolvedValue(null);

    const response = await POST(
      request({ folder: "portfolio" }) as never,
    );

    expect(response.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });

  it("impõe salão ativo, finalidade permitida e prefixo tenant", async () => {
    const response = await POST(
      request({
        folder: "services",
        activeSalonId: "salon-a",
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(findMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-a", salonId: "salon-a" },
      }),
    );
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^salon-a\/services\/[0-9a-f-]+\.png$/),
      expect.any(File),
      { contentType: "image/png", upsert: false },
    );
  });

  it("rejeita MIME declarado que não corresponde ao conteúdo", async () => {
    const response = await POST(
      request({
        folder: "portfolio",
        bytes: [0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74],
        type: "image/png",
      }) as never,
    );

    expect(response.status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
  });

  it("impede profissional de gravar imagens de produtos", async () => {
    findMembership.mockResolvedValue({
      salonId: "salon-a",
      role: "PROFESSIONAL",
    });

    const response = await POST(
      request({ folder: "products" }) as never,
    );

    expect(response.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });
});
