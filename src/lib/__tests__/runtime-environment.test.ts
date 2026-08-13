import { describe, expect, it } from "vitest";
import {
  isSafeMarketingPreviewPath,
  isSafePreviewSessionProbe,
  isUnconfiguredVercelPreview,
} from "../runtime-environment";

describe("isUnconfiguredVercelPreview", () => {
  it.each([undefined, "", "development", "test", "production"])(
    "bloqueia Preview sem APP_ENV=staging: %s",
    (appEnvironment) => {
      expect(
        isUnconfiguredVercelPreview({
          APP_ENV: appEnvironment,
          VERCEL_ENV: "preview",
        }),
      ).toBe(true);
    },
  );

  it("libera Preview configurado deliberadamente como staging", () => {
    expect(
      isUnconfiguredVercelPreview({
        APP_ENV: "staging",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
  });

  it.each([undefined, "development", "production"])(
    "não interfere fora de Vercel Preview: %s",
    (vercelEnvironment) => {
      expect(
        isUnconfiguredVercelPreview({
          APP_ENV: "production",
          VERCEL_ENV: vercelEnvironment,
        }),
      ).toBe(false);
    },
  );
});

describe("isSafeMarketingPreviewPath", () => {
  it.each([
    "/",
    "/images/salon-hero-barber-v2.webp",
    "/images/salon-hero-manicure-v1.webp",
  ])("libera a landing e seu asset estático %s", (pathname) => {
    expect(isSafeMarketingPreviewPath(pathname)).toBe(true);
  });

  it.each([
    "/login",
    "/signup",
    "/book/north-barber",
    "/api/auth/session",
    "/dashboard",
    "/plataforma",
    "/images",
  ])("mantém bloqueada a rota %s", (pathname) => {
    expect(isSafeMarketingPreviewPath(pathname)).toBe(false);
  });
});

describe("isSafePreviewSessionProbe", () => {
  it("permite somente o probe anônimo exato usado pela landing", () => {
    expect(isSafePreviewSessionProbe("/api/auth/session")).toBe(true);
  });

  it.each([
    "/api/auth/session/",
    "/api/auth/providers",
    "/api/auth/csrf",
    "/api/appointments",
  ])("não abre outras superfícies do Preview: %s", (pathname) => {
    expect(isSafePreviewSessionProbe(pathname)).toBe(false);
  });
});
