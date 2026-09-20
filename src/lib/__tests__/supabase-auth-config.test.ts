import { describe, expect, it } from "vitest";
import { authConfig, recoveryRedirect } from "../supabase-auth-config";
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
});
