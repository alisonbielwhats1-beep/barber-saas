import { describe, expect, it, vi } from "vitest";
import { authConfig, recoveryRedirect, confirmationLoginDestination } from "../supabase-auth-config";
import { passwordRecoveryEmailEnabled } from "../password-recovery-feature";
import { newAuthPasswordSchema } from "../recovery-validation";

const local = { AUTH_PROVIDER: "supabase", APP_ENV: "test", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_AUTH_PUBLISHABLE_KEY: "public-test-key" };
describe("Supabase recovery configuration", () => {
  it("requires deliberate activation and does not depend on Resend secrets in Vercel", () => {
    expect(passwordRecoveryEmailEnabled({ ...local, AUTH_EMAIL_ENABLED: "true" })).toBe(true);
    expect(passwordRecoveryEmailEnabled(local)).toBe(false);
    expect(() => authConfig({ ...local, AUTH_PROVIDER: "legacy" })).toThrow();
  });
  it("blocks production Auth from tests and unclassified Preview", () => {
    expect(() => authConfig({ ...local, SUPABASE_URL: "https://real.supabase.co" })).toThrow("REMOTE_TEST");
    expect(() => authConfig({ ...local, APP_ENV: "production", VERCEL_ENV: "preview" })).toThrow("STAGING");
    expect(() => authConfig({ ...local, APP_ENV: "staging", SUPABASE_PROJECT_REF: "real", PRODUCTION_SUPABASE_PROJECT_REF: "real" })).toThrow();
  });
  it("preserves each configured origin and the exact salon path", () => {
    const env = { APP_ENV: "production", OWNER_APP_URL: "https://owner.example.test", CLIENT_APP_URL: "https://client.example.test" };
    expect(recoveryRedirect(undefined, env)).toBe("https://owner.example.test/redefinir-senha");
    expect(recoveryRedirect("studio-a", env)).toBe("https://client.example.test/book/studio-a/redefinir-senha");
    expect(() => recoveryRedirect("../login", env)).toThrow();
    expect(() => recoveryRedirect(undefined, { ...env, OWNER_APP_URL: "https://attacker.test/path" })).toThrow();
  });
  it.each(["short1", "abcdefghijk", "12345678901", "a1".repeat(37)])("rejects unsafe password %s", password => {
    expect(newAuthPasswordSchema.safeParse(password).success).toBe(false);
  });
  it("aceita oito caracteres com letras e números sem alterar a senha digitada", () => {
    expect(newAuthPasswordSchema.parse("Abcdef12")).toBe("Abcdef12");
    expect(newAuthPasswordSchema.safeParse("Abcde12").success).toBe(false);
    expect(newAuthPasswordSchema.safeParse("abcdefgh").success).toBe(false);
    expect(newAuthPasswordSchema.safeParse("12345678").success).toBe(false);
    expect(newAuthPasswordSchema.parse(" Abcde12 ")).toBe(" Abcde12 ");
    expect(newAuthPasswordSchema.safeParse("é".repeat(36) + "a1").success).toBe(false);
  });
  it("mantém o login do salão na confirmação e recusa destinos externos", () => {
    vi.stubEnv("APP_ENV", "test"); vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:3100");
    try {
      const client = "http://127.0.0.1:3100/book/studio-a/login";
      expect(confirmationLoginDestination(client)).toBe(client);
      for (const next of ["https://attacker.test/book/studio-a/login", client + "?next=evil", "/book/studio-a/login", "not-a-url"]) {
        expect(confirmationLoginDestination(next)).toBe("http://127.0.0.1:3100/login");
      }
    } finally { vi.unstubAllEnvs(); }
  });
});
