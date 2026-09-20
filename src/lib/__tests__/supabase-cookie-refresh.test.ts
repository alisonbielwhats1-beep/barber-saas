import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), decode: vi.fn(), getToken: vi.fn(), encode: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { refreshSession: mocks.refresh } }) }));
vi.mock("next-auth/jwt", () => ({ decode: mocks.decode, getToken: mocks.getToken, encode: mocks.encode }));
import { refreshClientCookie } from "../supabase-client-cookie-refresh";

describe("provider token refresh at the writable cookie boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH_PROVIDER", "supabase"); vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321"); vi.stubEnv("SUPABASE_AUTH_PUBLISHABLE_KEY", "test-only");
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:3100"); vi.stubEnv("NEXTAUTH_SECRET", "test-only");
    mocks.decode.mockResolvedValue({ providerSession: { expires_at: 0, identityId: "same-identity", version: 7, refresh_token: "old" } });
    mocks.getToken.mockImplementation(() => mocks.decode());
    mocks.refresh.mockResolvedValue({ data: { session: { access_token: "new-access", refresh_token: "new-refresh", expires_at: 9999999999 } }, error: null });
    mocks.encode.mockResolvedValue("new-encrypted-envelope");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("passes rotated credentials to this request and the browser without changing authorization version", async () => {
    const request = new NextRequest("http://127.0.0.1:3100/book/studio", { headers: { cookie: "client_token=old-envelope" } });
    const next = vi.fn(async (refreshed: NextRequest) => {
      expect(refreshed.cookies.get("client_token")?.value).toBe("new-encrypted-envelope");
      return NextResponse.next({ request: { headers: refreshed.headers } });
    });
    const response = await refreshClientCookie(request, false, next);
    expect(response.headers.get("Set-Cookie")).toContain("client_token=new-encrypted-envelope");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).not.toContain("Max-Age=0");
    expect(response.headers.get("x-middleware-request-cookie")).toContain("client_token=new-encrypted-envelope");
    expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({ token: expect.objectContaining({ providerSession: expect.objectContaining({ identityId: "same-identity", version: 7, refresh_token: "new-refresh" }) }) }));
  });
  it("clears stale NextAuth chunks while preserving redirects", async () => {
    const request = new NextRequest("http://127.0.0.1:3100/dashboard", { headers: { cookie: "next-auth.session-token.0=old; next-auth.session-token.1=tail" } });
    const response = await refreshClientCookie(request, true, async () => NextResponse.redirect(new URL("/login", request.url)));
    expect(response.status).toBe(307);
    expect(request.cookies.has("next-auth.session-token.1")).toBe(false);
    expect(response.headers.get("Set-Cookie")).toContain("next-auth.session-token.1=;");
    expect(response.headers.get("Set-Cookie")).toContain("next-auth.session-token=new-encrypted-envelope");
  });
  it("does not renew already valid access tokens", async () => {
    mocks.decode.mockResolvedValue({ providerSession: { expires_at: Date.now() / 1000 + 3600 } });
    const response = await refreshClientCookie(new NextRequest("http://127.0.0.1:3100/book/studio"));
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(response.headers.has("Set-Cookie")).toBe(false);
  });
  it("cannot turn a provider refusal into a new application session", async () => {
    mocks.refresh.mockResolvedValue({ data: { session: null }, error: { code: "refresh_token_not_found" } });
    const response = await refreshClientCookie(new NextRequest("http://127.0.0.1:3100/book/studio"));
    expect(mocks.encode).not.toHaveBeenCalled(); expect(response.headers.has("Set-Cookie")).toBe(false);
  });
});
