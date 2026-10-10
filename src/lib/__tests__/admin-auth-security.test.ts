import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NextAuth from "next-auth";
import type { NextApiRequest, NextApiResponse } from "next";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  checkRateLimit: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock("@/lib/supabase-auth", () => ({ authenticatePassword: mocks.authenticate, validateProviderSession: vi.fn() }));

vi.mock("bcryptjs", () => ({
  default: { compare: mocks.compare },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

import { authOptions } from "@/lib/auth";
import { LoginError } from "@/lib/login-error";

type Authorize = (
  credentials: Record<string, string> | undefined,
  request: { headers: Record<string, string> },
) => Promise<unknown>;

const authorize = (
  authOptions.providers[0] as unknown as { options: { authorize: Authorize } }
).options.authorize;

describe("login da equipe", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, source: "local" });
    mocks.findUnique.mockResolvedValue(null);
    mocks.compare.mockResolvedValue(false);
  });

  it.each(["x".repeat(73), "é".repeat(37)])(
    "rejeita senha acima de 72 bytes antes do limiter e do banco",
    async (password) => {
      await expect(authorize(
        { email: "owner@example.com", password },
        { headers: {} },
      )).resolves.toBeNull();

      expect(mocks.checkRateLimit).not.toHaveBeenCalled();
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.compare).not.toHaveBeenCalled();
    },
  );

  it("executa comparação dummy quando o usuário não existe", async () => {
    await expect(authorize(
      { email: "missing@example.com", password: "senha-segura" },
      { headers: {} },
    )).resolves.toBeNull();

    expect(mocks.compare).toHaveBeenCalledOnce();
    expect(mocks.compare.mock.calls[0]?.[1]).toMatch(/^\$2a\$10\$/);
  });

  it.each(["admin-login-ip", "admin-login-account"])("informa limite de %s antes de consultar credenciais", async (namespace) => {
    mocks.checkRateLimit.mockImplementation(async (input) => ({ allowed: input.namespace !== namespace, source: "distributed" }));
    await expect(authorize({ email: "owner@example.com", password: "senha-segura" }, { headers: {} }))
      .rejects.toThrow("LOGIN_RATE_LIMITED");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ namespace: "admin-login-account", limit: 8, windowSeconds: 900, failClosed: true }));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ namespace: "admin-login-ip", limit: 30, windowSeconds: 900, failClosed: true }));
  });

  it("distingue segurança indisponível de limite excedido", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false, source: "distributed" })
      .mockResolvedValueOnce({ allowed: false, source: "unavailable" });
    await expect(authorize({ email: "owner@example.com", password: "senha-segura" }, { headers: {} }))
      .rejects.toThrow("LOGIN_TEMPORARILY_UNAVAILABLE");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it.each(["limiter", "database", "bcrypt", "backfill"])("sanitiza falha de %s sem indicar senha incorreta", async (stage) => {
    const internal = new Error("private connection details must never reach the browser");
    mocks.findUnique.mockResolvedValue({ id: "user-a", passwordHash: "hash", passwordSetAt: null });
    mocks.compare.mockResolvedValue(true);
    if (stage === "limiter") mocks.checkRateLimit.mockRejectedValue(internal);
    if (stage === "database") mocks.findUnique.mockRejectedValue(internal);
    if (stage === "bcrypt") mocks.compare.mockRejectedValue(internal);
    if (stage === "backfill") mocks.update.mockRejectedValue(internal);
    await expect(authorize({ email: "owner@example.com", password: "senha-segura" }, { headers: {} }))
      .rejects.toEqual(new LoginError("LOGIN_TEMPORARILY_UNAVAILABLE"));
  });

  it.each(["LOGIN_RATE_LIMITED", "LOGIN_TEMPORARILY_UNAVAILABLE"] as const)("preserva erro sanitizado %s do provedor sem fallback", async (code) => {
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    mocks.findUnique.mockResolvedValue({ id: "user-a", authIdentityId: "identity-a", passwordHash: "old-hash" });
    mocks.authenticate.mockRejectedValue(new LoginError(code));
    await expect(authorize({ email: "owner@example.com", password: "senha-segura" }, { headers: {} }))
      .rejects.toThrow(code);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("sanitiza timeout do provedor e continua recusando o acesso", async () => {
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    mocks.findUnique.mockResolvedValue({ id: "user-a", authIdentityId: "identity-a" });
    mocks.authenticate.mockRejectedValue(new Error("provider timeout with private context"));
    await expect(authorize({ email: "owner@example.com", password: "senha-segura" }, { headers: {} }))
      .rejects.toEqual(new LoginError("LOGIN_TEMPORARILY_UNAVAILABLE"));
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it.each(["CredentialsSignin", "LOGIN_RATE_LIMITED", "LOGIN_TEMPORARILY_UNAVAILABLE"])("transporta %s pelo NextAuth real, com CSRF válido e sem criar sessão", async (code) => {
    async function request(nextauth: string[], body?: Record<string, string>, cookies = {}) {
      const response = {
        statusCode: 200,
        body: {} as { csrfToken?: string; url?: string },
        headers: new Map<string, string | string[]>(),
        status(value: number) { this.statusCode = value; return this; },
        setHeader(key: string, value: string | string[]) { this.headers.set(key.toLowerCase(), value); return this; },
        getHeader(key: string) { return this.headers.get(key.toLowerCase()); },
        json(value: typeof this.body) { this.body = value; },
        send(value: typeof this.body) { this.body = value; },
        end() {},
      };
      await NextAuth({ query: { nextauth }, method: body ? "POST" : "GET", body, cookies,
        headers: { host: "localhost:3000" } } as unknown as NextApiRequest,
      response as unknown as NextApiResponse, { ...authOptions, secret: "disposable-test-auth-secret" });
      return response;
    }
    const csrf = await request(["csrf"]);
    expect(csrf.body.csrfToken).toBeTruthy();
    const setCookies = csrf.headers.get("set-cookie") ?? [];
    const cookies = Object.fromEntries((Array.isArray(setCookies) ? setCookies : [setCookies]).map((cookie) => {
      const pair = cookie.split(";")[0];
      const separator = pair.indexOf("=");
      return [pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1))];
    }));
    if (code === "LOGIN_RATE_LIMITED") mocks.checkRateLimit.mockResolvedValue({ allowed: false, source: "distributed" });
    if (code === "LOGIN_TEMPORARILY_UNAVAILABLE") mocks.findUnique.mockRejectedValue(new Error("private database details"));
    const result = await request(["callback", "credentials"], {
      csrfToken: csrf.body.csrfToken!, email: "owner@example.com", password: "senha-segura", json: "true",
    }, cookies);
    expect(result.statusCode).toBe(401);
    expect(new URL(result.body.url!).searchParams.get("error")).toBe(code);
    expect(JSON.stringify(result.body)).not.toContain("private");
    expect(JSON.stringify(result.headers.get("set-cookie"))).not.toContain("session-token");
  });

  it("preserva login Supabase e recusa identidade divergente", async () => {
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    mocks.findUnique.mockResolvedValue({ id: "user-a", authIdentityId: "identity-a" });
    mocks.authenticate.mockResolvedValue({ user: { id: "identity-a" }, session: { identityId: "identity-a" } });
    await expect(authorize({ email: "owner@example.com", password: "senha-segura" }, { headers: {} }))
      .resolves.toMatchObject({ id: "user-a", providerSession: { identityId: "identity-a" } });
    mocks.authenticate.mockResolvedValue({ user: { id: "identity-b" }, session: {} });
    await expect(authorize({ email: "owner@example.com", password: "senha-segura" }, { headers: {} })).resolves.toBeNull();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("aceita os metadados de transporte enviados pelo NextAuth", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-a",
      email: "owner@example.com",
      name: "Owner",
      passwordHash: "hash",
      passwordSetAt: new Date(),
      sessionVersion: 0,
      avatarUrl: null,
    });
    mocks.compare.mockResolvedValue(true);

    await expect(authorize(
      {
        email: "owner@example.com",
        password: "senha-segura",
        csrfToken: "csrf-interno",
        callbackUrl: "http://localhost:3100/login",
        json: "true",
      },
      { headers: {} },
    )).resolves.toEqual(expect.objectContaining({
      id: "user-a",
      email: "owner@example.com",
      sessionVersion: 0,
    }));
  });

  it("revoga JWT anterior quando a versão da sessão muda", async () => {
    mocks.findUnique.mockResolvedValue({ sessionVersion: 2 });
    const jwt = authOptions.callbacks?.jwt as unknown as (input: {
      token: { uid?: string; sessionVersion?: number };
      user?: undefined;
    }) => Promise<{ uid?: string; sessionVersion?: number }>;

    const token = await jwt({
      token: { uid: "user-a", sessionVersion: 1 },
      user: undefined,
    });

    expect(token.uid).toBeUndefined();
  });
  it("preserves the current password before voluntary recovery even when Supabase is enabled", async () => {
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    mocks.findUnique.mockResolvedValue({ id: "legacy-user", email: "owner@example.com", name: "Owner", passwordHash: "existing-hash", passwordSetAt: new Date(), sessionVersion: 0, authIdentityId: null });
    mocks.compare.mockResolvedValue(true);
    expect(await authorize({ email: "owner@example.com", password: "senha-atual" }, { headers: {} })).toMatchObject({ id: "legacy-user" });
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.compare).toHaveBeenCalledWith("senha-atual", "existing-hash");
  });
  it("never falls back to the previous password after the identity is migrated", async () => {
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    mocks.findUnique.mockResolvedValue({ id: "migrated-user", email: "owner@example.com", authIdentityId: "provider-id", passwordHash: "unused-old-hash" });
    mocks.authenticate.mockResolvedValue(null);
    expect(await authorize({ email: "owner@example.com", password: "senha-antiga" }, { headers: {} })).toBeNull();
    expect(mocks.compare).not.toHaveBeenCalled();
  });
});
