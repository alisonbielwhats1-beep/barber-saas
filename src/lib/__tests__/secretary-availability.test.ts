import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { secretaryAvailableTo } from "../secretary-availability";

/** Owner 06/10/2026: the prepaid requests are shown and sold only to whoever can use the Secretária. */
const owner = { salonId: "salao-apresentacao", userId: "dono-apresentacao" };
afterEach(() => vi.unstubAllEnvs());
describe("who sees and buys Secretária requests", () => {
  it("in the Production pilot, only the allowlisted salon+user; every other salon owner sees nothing", () => {
    for (const [k, v] of Object.entries({ VERCEL_ENV: "production", APP_ENV: "production", SALON_SECRETARY_ENABLED: "true", SALON_SECRETARY_PRODUCTION_PILOT: "true",
      SALON_SECRETARY_ALLOWED_ACTORS: JSON.stringify([owner]) })) vi.stubEnv(k, v);
    expect(secretaryAvailableTo(owner)).toBe(true);
    expect(secretaryAvailableTo({ salonId: "cliente-real", userId: "dono-cliente" })).toBe(false);
    expect(secretaryAvailableTo({ ...owner, userId: "gerente" })).toBe(false);
  });
  it("Production without the Secretária: nobody", () => {
    vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("APP_ENV", "production"); vi.stubEnv("SALON_SECRETARY_ENABLED", "false");
    expect(secretaryAvailableTo(owner)).toBe(false);
  });
});
