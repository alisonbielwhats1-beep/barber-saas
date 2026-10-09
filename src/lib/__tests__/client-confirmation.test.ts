import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ limit: vi.fn(), profile: vi.fn(), scope: vi.fn(), resend: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "synthetic", checkRateLimit: m.limit }));
vi.mock("@/lib/supabase-auth", () => ({ createAuthClient: () => ({ auth: { resend: m.resend } }) }));
vi.mock("@/lib/prisma-tenant", () => ({ withSalonBySlug: m.scope }));
import { resendClientConfirmation } from "@/app/book/[salonSlug]/confirmation-actions";

describe("reenvio de confirmação do cliente", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH_PROVIDER", "supabase"); vi.stubEnv("AUTH_EMAIL_ENABLED", "true");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321"); vi.stubEnv("SUPABASE_AUTH_PUBLISHABLE_KEY", "synthetic");
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:3100");
    m.limit.mockResolvedValue({ allowed: true, source: "local" });
    m.profile.mockResolvedValue({ id: "client-a" }); m.resend.mockResolvedValue({ error: null });
    m.scope.mockImplementation(async (slug: string, fn: (tx: unknown, id: string) => unknown) =>
      fn({ clientProfile: { findFirst: m.profile } }, `id-${slug}`));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("normaliza só e-mail, consulta o tenant aprovado e usa o reenvio oficial sem senha", async () => {
    const result = await resendClientConfirmation("studio-a", " CLIENT@EXAMPLE.TEST ");
    expect(result.message).toContain("Se houver");
    expect(m.profile).toHaveBeenCalledWith({ where: { salonId: "id-studio-a", email: { equals: "client@example.test", mode: "insensitive" },
      authIdentityId: { not: null }, mergedIntoId: null }, select: { id: true } });
    expect(m.resend).toHaveBeenCalledWith({ type: "signup", email: "client@example.test",
      options: { emailRedirectTo: "http://127.0.0.1:3100/book/studio-a/login" } });
  });
  it("não revela conta ausente, confirmada, cooldown ou erro de SMTP", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const normal = await resendClientConfirmation("studio-a", "client@example.test");
    m.profile.mockResolvedValue(null);
    expect(await resendClientConfirmation("studio-a", "client@example.test")).toEqual(normal);
    expect(m.resend).toHaveBeenCalledTimes(1);
    m.profile.mockResolvedValue({ id: "client-a" });
    m.resend.mockResolvedValue({ error: { code: "over_email_send_rate_limit" } });
    expect(await resendClientConfirmation("studio-a", "client@example.test")).toEqual(normal);
    m.resend.mockRejectedValue(new Error("SMTP internal secret"));
    expect(await resendClientConfirmation("studio-a", "client@example.test")).toEqual(normal);
    m.limit.mockImplementation(async ({ namespace }: { namespace: string }) => ({ allowed: namespace !== "client-confirm-account", source: "local" }));
    const calls = m.resend.mock.calls.length;
    expect(await resendClientConfirmation("studio-b", "client@example.test")).toEqual(normal);
    expect(m.resend).toHaveBeenCalledTimes(calls);
  });
  it("não envia para outro tenant ou estabelecimento indisponível", async () => {
    m.scope.mockResolvedValue(null);
    await resendClientConfirmation("studio-b", "client@example.test");
    expect(m.resend).not.toHaveBeenCalled();
  });
  it("bloqueia quando o limiter falha ou o IP esgota a cota", async () => {
    m.limit.mockResolvedValue({ allowed: false, source: "unavailable" });
    expect(await resendClientConfirmation("studio-a", "client@example.test")).toHaveProperty("error");
    m.limit.mockResolvedValue({ allowed: false, source: "local" });
    expect(await resendClientConfirmation("studio-a", "client@example.test")).toHaveProperty("error");
    expect(m.scope).not.toHaveBeenCalled(); expect(m.resend).not.toHaveBeenCalled();
  });
  it("rejeita payload inválido ou funcionalidade desativada antes de banco/provedor", async () => {
    expect(await resendClientConfirmation("../other", "client@example.test")).toHaveProperty("error");
    expect(await resendClientConfirmation("studio-a", "invalid")).toHaveProperty("error");
    vi.stubEnv("AUTH_EMAIL_ENABLED", "false");
    expect(await resendClientConfirmation("studio-a", "client@example.test")).toHaveProperty("error");
    expect(m.limit).not.toHaveBeenCalled(); expect(m.scope).not.toHaveBeenCalled();
  });
});
