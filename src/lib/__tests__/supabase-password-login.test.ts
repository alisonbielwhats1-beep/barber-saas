import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), identity: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { authIdentity: { findUnique: mocks.identity } } }));
import { authenticatePassword } from "@/lib/supabase-auth";

describe("password login provider failures", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_AUTH_PUBLISHABLE_KEY", "local-test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["invalid_credentials", "email_not_confirmed", "user_banned"])("preserves generic denial for %s", async (code) => {
    mocks.signIn.mockResolvedValue({ data: {}, error: { code, status: 400, message: "private details" } });
    await expect(authenticatePassword("owner@example.com", "Password123")).resolves.toBeNull();
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it.each([{ status: 429 }, { code: "over_request_rate_limit", status: 400 }])("reports rate limit %j", async (error) => {
    mocks.signIn.mockResolvedValue({ data: {}, error });
    await expect(authenticatePassword("owner@example.com", "Password123")).rejects.toThrow("LOGIN_RATE_LIMITED");
  });
  it.each([{ status: 503 }, { status: 0 }, { status: 400, code: "unexpected_failure" }, { status: 401 }])("reports temporary failure, never bad password: %j", async (error) => {
    mocks.signIn.mockResolvedValue({ data: {}, error: { ...error, message: "private details" } });
    await expect(authenticatePassword("owner@example.com", "Password123")).rejects.toThrow("LOGIN_TEMPORARILY_UNAVAILABLE");
  });
  it("does not treat an incomplete successful response as a wrong password", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: null });
    await expect(authenticatePassword("owner@example.com", "Password123")).rejects.toThrow("LOGIN_TEMPORARILY_UNAVAILABLE");
  });
  it("still requires email confirmation and a bound identity", async () => {
    const user = { id: "identity-a", email_confirmed_at: null as string | null };
    const session = { user, access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
    mocks.signIn.mockResolvedValue({ data: { user, session }, error: null });
    await expect(authenticatePassword("owner@example.com", "Password123")).resolves.toBeNull();
    user.email_confirmed_at = "2026-01-01T00:00:00Z";
    mocks.identity.mockResolvedValue(null);
    await expect(authenticatePassword("owner@example.com", "Password123")).rejects.toThrow("AUTH_IDENTITY_NOT_MIGRATED");
    mocks.identity.mockResolvedValue({ id: "identity-a", sessionVersion: 1 });
    await expect(authenticatePassword("owner@example.com", "Password123")).resolves.toMatchObject({ user, session: { identityId: "identity-a", version: 1 } });
  });
});
