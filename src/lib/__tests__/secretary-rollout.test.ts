import { describe, expect, it } from "vitest";
import { assertSecretaryRolloutAccess } from "../secretary-rollout";

const actor = { salonId: "fixture-a", userId: "owner-a" };
const second = { salonId: "fixture-b", userId: "owner-b" };
const configured = { APP_ENV: "staging", VERCEL_ENV: "preview", SALON_SECRETARY_ENABLED: "true",
  SALON_SECRETARY_ALLOWED_ACTORS: JSON.stringify([actor, second]) };

describe("Secretary rollout admission (offline; environment guard remains separate)", () => {
  it("admits only configured pairs, not the cross product of users and tenants", () => {
    expect(() => assertSecretaryRolloutAccess(actor, configured)).not.toThrow();
    expect(() => assertSecretaryRolloutAccess(second, configured)).not.toThrow();
    for (const candidate of [{ ...actor, userId: second.userId }, { ...second, userId: actor.userId }, { ...actor, salonId: "unknown" }])
      expect(() => assertSecretaryRolloutAccess(candidate, configured)).toThrow("SECRETARY_NOT_AVAILABLE");
  });
  it.each([undefined, "", "[]", "*", "invalid-json", '[{"salonId":"*","userId":"owner-a"}]',
    '[{"salonId":"fixture-a","userId":"owner-a","role":"OWNER"}]'])
  ("fails closed for absent, empty or malformed allowlist %s", raw => {
    expect(() => assertSecretaryRolloutAccess(actor, { ...configured, SALON_SECRETARY_ALLOWED_ACTORS: raw })).toThrow("SECRETARY_NOT_AVAILABLE");
  });
  it("rechecks removal and the kill switch on the next request, without caching grants", () => {
    const env = { ...configured };
    assertSecretaryRolloutAccess(actor, env);
    env.SALON_SECRETARY_ALLOWED_ACTORS = "[]";
    expect(() => assertSecretaryRolloutAccess(actor, env)).toThrow();
    env.SALON_SECRETARY_ALLOWED_ACTORS = configured.SALON_SECRETARY_ALLOWED_ACTORS;
    env.SALON_SECRETARY_ENABLED = "false";
    expect(() => assertSecretaryRolloutAccess(actor, env)).toThrow();
  });
  it.each([{ APP_ENV: "production" }, { VERCEL_ENV: "production" }, { APP_ENV: "" }])
  ("cannot admit production or an unknown environment: %j", overrides => {
    expect(() => assertSecretaryRolloutAccess(actor, { ...configured, ...overrides })).toThrow();
  });
  it("preserves historical local fixtures and enforces an explicitly configured local restriction", () => {
    const local = { APP_ENV: "test", SALON_SECRETARY_ENABLED: "true" };
    expect(() => assertSecretaryRolloutAccess(actor, local)).not.toThrow();
    expect(() => assertSecretaryRolloutAccess(actor, { ...local, SALON_SECRETARY_ALLOWED_ACTORS: "[]" })).toThrow();
  });
});
