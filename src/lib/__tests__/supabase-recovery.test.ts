import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ verifyOtp: vi.fn(), updateUser: vi.fn(), setSession: vi.fn(), signOut: vi.fn(), reset: vi.fn(),
  providerSession: vi.fn(), validate: vi.fn(), find: vi.fn(), user: vi.fn(), profile: vi.fn(), version: vi.fn(),
  read: vi.fn(), save: vi.fn(), remove: vi.fn(), decode: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: m.read, set: m.save, delete: m.remove }) }));
vi.mock("next-auth/jwt", () => ({ encode: async () => "encrypted-provider-session", decode: m.decode }));
vi.mock("@/lib/supabase-auth", () => ({ createAuthClient: () => ({ auth: { verifyOtp: m.verifyOtp, updateUser: m.updateUser,
  setSession: m.setSession, signOut: m.signOut, resetPasswordForEmail: m.reset } }), providerSession: m.providerSession, validateProviderSession: m.validate }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: m.user },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn(), authIdentity: { findUnique: m.find, update: m.version } }) } }));
vi.mock("@/lib/prisma-tenant", () => ({ withSalonBySlug: async (slug: string, fn: (tx: unknown, id: string) => unknown) =>
  fn({ clientProfile: { findFirst: m.profile } }, `id-${slug}`) }));
import { updateSupabasePassword, requestSupabaseRecovery, INVALID_RECOVERY, recoveryRateKey } from "../supabase-recovery";
const session = { access_token: "provider-access", refresh_token: "provider-refresh", identityId: "identity", version: 0 };
const token = "a".repeat(56);
describe("Supabase recovery authority and isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("NEXTAUTH_SECRET", "test-only"); vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:3100");
    m.decode.mockResolvedValue(null); m.find.mockResolvedValue({ id: "identity", sessionVersion: 0 });
    m.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null }); m.providerSession.mockResolvedValue(session);
    m.validate.mockResolvedValue({ session, user: { id: "identity" } }); m.user.mockResolvedValue({ id: "owner" });
    m.profile.mockResolvedValue({ id: "profile" }); m.setSession.mockResolvedValue({ error: null });
    m.updateUser.mockResolvedValue({ error: null }); m.signOut.mockResolvedValue({ error: null }); m.reset.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([undefined, "studio-a"])("updates via provider, revokes identity sessions and returns no tokens (%s)", async salonSlug => {
    expect(await updateSupabasePassword({ token, password: "NovaSenha123", salonSlug })).toEqual({ ok: true });
    expect(m.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: token });
    expect(m.updateUser).toHaveBeenCalledWith({ password: "NovaSenha123" });
    expect(m.version).toHaveBeenCalledWith({ where: { id: "identity" }, data: { sessionVersion: { increment: 1 } } });
    expect(m.signOut).toHaveBeenCalledWith({ scope: "global" }); expect(m.remove).toHaveBeenCalled();
    if (salonSlug) expect(m.profile).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "id-studio-a", authIdentityId: "identity", mergedIntoId: null } }));
  });
  it("never updates a profile from a different salon or creates permission by email", async () => {
    m.profile.mockResolvedValue(null);
    expect(await updateSupabasePassword({ token, password: "NovaSenha123", salonSlug: "studio-b" })).toEqual({ ok: false, error: INVALID_RECOVERY });
    expect(m.updateUser).not.toHaveBeenCalled();
  });
  it.each(["expired", "used", "invalid"])("handles %s links without updating credentials", async () => {
    m.verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: "otp_expired" } });
    expect(await updateSupabasePassword({ token, password: "NovaSenha123" })).toEqual({ ok: false, error: INVALID_RECOVERY });
    expect(m.updateUser).not.toHaveBeenCalled();
  });
  it("rejects direct access without token or recovery session", async () => {
    expect(await updateSupabasePassword({ token: "", password: "NovaSenha123" })).toEqual({ ok: false, error: INVALID_RECOVERY });
    expect(m.verifyOtp).not.toHaveBeenCalled();
  });
  it("resumes after refresh and transient password update failure", async () => {
    m.decode.mockResolvedValue({ ...session, context: "/redefinir-senha", tokenDigest: recoveryRateKey(token) });
    expect(await updateSupabasePassword({ token: "", password: "NovaSenha123" })).toEqual({ ok: true });
    expect(m.verifyOtp).not.toHaveBeenCalled();
  });
  it("a new link cannot accidentally update the account of an earlier recovery", async () => {
    m.decode.mockResolvedValue({ ...session, context: "/redefinir-senha", tokenDigest: recoveryRateKey("b".repeat(64)) });
    await updateSupabasePassword({ token, password: "NovaSenha123" });
    expect(m.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: token });
  });
  it("rejects replayed recovery sessions even while provider access JWT is live", async () => {
    m.find.mockResolvedValue({ id: "identity", sessionVersion: 1 });
    expect(await updateSupabasePassword({ token, password: "NovaSenha123" })).toEqual({ ok: false, error: INVALID_RECOVERY });
    expect(m.updateUser).not.toHaveBeenCalled();
  });
  it("hides account-specific SMTP and rate limit errors from recovery requests", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.reset.mockResolvedValue({ error: { code: "over_email_send_rate_limit", message: "internal SMTP detail" } });
    await expect(requestSupabaseRecovery("unknown@example.test", "studio-a")).resolves.toBeUndefined();
    expect(m.reset).toHaveBeenCalledWith("unknown@example.test", { redirectTo: "http://127.0.0.1:3100/book/studio-a/redefinir-senha" });
    expect(warning).toHaveBeenCalledWith("auth_recovery_request_failed", { category: "provider" }); warning.mockRestore();
  });
  it("revokes application sessions durably before invoking the external password change", async () => {
    m.updateUser.mockImplementation(async () => {
      expect(m.version).toHaveBeenCalledOnce();
      throw new Error("transport outcome unknown");
    });
    await expect(updateSupabasePassword({ token, password: "NovaSenha123" })).rejects.toThrow("transport outcome unknown");
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it.each([429, 422])("uses actionable generic feedback after a definite provider refusal (%s)", async status => {
    m.updateUser.mockResolvedValue({ error: { status, code: "weak_password", message: "internal-provider-detail" } });
    const result = await updateSupabasePassword({ token, password: "NovaSenha123" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("internal-provider-detail");
    expect(m.remove).not.toHaveBeenCalled();
  });
});
