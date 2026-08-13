import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const nextAuthMocks = vi.hoisted(() => ({
  middleware: vi.fn(),
}));

vi.mock("next-auth/middleware", () => ({
  withAuth: () => nextAuthMocks.middleware,
}));

import middleware from "../../middleware";

function previewRequest(pathname: string, method = "GET") {
  return new NextRequest(`https://preview.example${pathname}`, { method });
}

async function invokePreviewMiddleware(pathname: string, method = "GET") {
  const response = await middleware(
    previewRequest(pathname, method),
    {} as Parameters<typeof middleware>[1],
  );

  if (!(response instanceof Response)) {
    throw new Error("O middleware deveria retornar uma Response no Preview");
  }

  return response;
}

describe("middleware environment guard", () => {
  beforeEach(() => {
    nextAuthMocks.middleware.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("responde ao probe de sessão com objeto vazio sem encaminhar ao NextAuth", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("APP_ENV", "production");

    const response = await invokePreviewMiddleware("/api/auth/session");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-environment-guard")).toBe(
      "anonymous-session",
    );
    expect(nextAuthMocks.middleware).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "bloqueia %s no endpoint de sessão",
    async (method) => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("APP_ENV", "production");

      const response = await invokePreviewMiddleware(
        "/api/auth/session",
        method,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("x-environment-guard")).toBe("blocked");
      expect(nextAuthMocks.middleware).not.toHaveBeenCalled();
    },
  );

  it.each(["/api/auth/providers", "/api/auth/csrf", "/api/appointments"])(
    "mantém bloqueada a superfície %s",
    async (pathname) => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("APP_ENV", "production");

      const response = await invokePreviewMiddleware(pathname);

      expect(response.status).toBe(503);
      expect(response.headers.get("x-environment-guard")).toBe("blocked");
    },
  );

  it.each([
    ["production", "production"],
    ["preview", "staging"],
  ])(
    "não interfere no probe em VERCEL_ENV=%s APP_ENV=%s",
    async (vercelEnv, appEnv) => {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("APP_ENV", appEnv);

      const response = await invokePreviewMiddleware("/api/auth/session");

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-environment-guard")).toBeNull();
      expect(nextAuthMocks.middleware).not.toHaveBeenCalled();
    },
  );
});
