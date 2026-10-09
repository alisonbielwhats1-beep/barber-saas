import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), matches: vi.fn(), create: vi.fn(), provider: vi.fn(),
  authenticate: vi.fn(), compare: vi.fn(), session: vi.fn(), limit: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(), compare: m.compare } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("@/lib/client-auth", () => ({ setClientSession: m.session, clearClientSession: vi.fn() }));
vi.mock("@/lib/supabase-auth", () => ({ registerProviderAccount: m.provider, authenticatePassword: m.authenticate }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "synthetic", checkRateLimit: m.limit }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/prisma-tenant", () => ({ isApprovedSalonSlug: async () => true,
  withSalonBySlug: async (_slug: string, fn: (tx: unknown, id: string) => unknown) => fn({
    clientProfile: { findFirst: m.find, findMany: m.matches, create: m.create },
  }, "salon-a") }));
import { registerClient } from "@/app/book/[salonSlug]/auth-actions";

describe("cadastro repetido com Supabase ativo", () => {
  const input = { name: "Cliente", email: "client@example.test", phone: "11912345678",
    password: "Original123", confirmPassword: "Original123" };
  const legacy = { id: "client-a", name: "Cliente original", email: input.email,
    passwordHash: "legacy-hash", authIdentityId: null, sessionVersion: 0 };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:3100");
    m.limit.mockResolvedValue({ allowed: true, source: "local" });
    m.find.mockResolvedValue(legacy); m.matches.mockResolvedValue([legacy]);
    m.provider.mockRejectedValue(new Error("provider unavailable"));
    m.compare.mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("retoma a conta legada sem criar outra identidade nem enviar outro e-mail", async () => {
    await expect(registerClient("studio-a", input)).rejects.toThrow("NEXT_REDIRECT");
    expect(m.provider).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.session).toHaveBeenCalledWith(expect.objectContaining({ clientId: legacy.id }));
  });
  it("retoma conta Supabase com a senha existente sem repetir signup", async () => {
    m.find.mockResolvedValue({ ...legacy, passwordHash: null, authIdentityId: "identity-a" });
    m.authenticate.mockResolvedValue({ user: { id: "identity-a", email: input.email }, session: {} });
    await expect(registerClient("studio-a", input)).rejects.toThrow("NEXT_REDIRECT");
    expect(m.provider).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("não sobrescreve a senha de conta existente nem envia e-mail após senha incorreta", async () => {
    m.compare.mockResolvedValue(false);
    expect(await registerClient("studio-a", input)).toMatchObject({ code: "ACCOUNT_ACCESS" });
    expect(m.provider).not.toHaveBeenCalled();
    expect(m.session).not.toHaveBeenCalled();
  });
});
