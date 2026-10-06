import { describe, expect, it, vi } from "vitest";

/** Owner decision 05/10/2026: the Secretária in Production only for the presentation salon's owner, with a US$ 1 daily cap. */
const db = vi.hoisted(() => ({ calls: [] as unknown[], voice: [] as unknown[], queried: 0 }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn({
  salon: { findUniqueOrThrow: async () => ({ timezone: "America/Sao_Paulo" }) },
  auditLog: { findMany: async ({ where }: { where: { entityType: string } }) => { db.queried++; return where.entityType === "SECRETARY_TRANSCRIBE" ? db.voice : db.calls; } },
}) }));
import { assertPilotActor, assertSecretaryDailyBudget, callMicroUsd, pilotActors, productionPilotActive } from "../secretary-production-pilot";
import { assertSecretaryRolloutAccess } from "../secretary-rollout";

const owner = { salonId: "salao-apresentacao", userId: "dono-apresentacao" };
const pilot = { VERCEL_ENV: "production", APP_ENV: "production", SALON_SECRETARY_ENABLED: "true", SALON_SECRETARY_PRODUCTION_PILOT: "true",
  SALON_SECRETARY_ALLOWED_ACTORS: JSON.stringify([owner]) };

describe("Production pilot gate", () => {
  it("is on only with Production, the Secretária and the pilot flag together", () => {
    expect(productionPilotActive(pilot)).toBe(true);
    expect(productionPilotActive({ ...pilot, SALON_SECRETARY_PRODUCTION_PILOT: undefined })).toBe(false);
    expect(productionPilotActive({ ...pilot, SALON_SECRETARY_ENABLED: "false" })).toBe(false);
    expect(productionPilotActive({ ...pilot, VERCEL_ENV: "preview" })).toBe(false);
  });
  it("admits the presentation salon's owner and nobody else", () => {
    expect(() => assertSecretaryRolloutAccess(owner, pilot)).not.toThrow();
    expect(() => assertSecretaryRolloutAccess({ ...owner, userId: "gerente" }, pilot)).toThrow("SECRETARY_NOT_AVAILABLE");
    expect(() => assertSecretaryRolloutAccess({ ...owner, salonId: "outro-salao" }, pilot)).toThrow("SECRETARY_NOT_AVAILABLE");
  });
  it("refuses everyone with a missing, empty, malformed or oversized list", () => {
    for (const list of [undefined, "", "[]", "{not json", JSON.stringify([{ salonId: owner.salonId }]), JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ salonId: `s${i}`, userId: `u${i}` })))]) {
      expect(pilotActors({ ...pilot, SALON_SECRETARY_ALLOWED_ACTORS: list })).toBeUndefined();
      expect(() => assertPilotActor(owner, { ...pilot, SALON_SECRETARY_ALLOWED_ACTORS: list })).toThrow("SECRETARY_NOT_AVAILABLE");
    }
  });
  it("keeps Production closed without the pilot flag (the historical gate)", () => {
    expect(() => assertSecretaryRolloutAccess(owner, { ...pilot, SALON_SECRETARY_PRODUCTION_PILOT: undefined })).toThrow("SECRETARY_NOT_AVAILABLE");
  });
});

describe("daily spend cap", () => {
  const deepseek = (input: number, output: number) => ({ metadata: { model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: input, cached_input_tokens: 0, cache_write_tokens: 0, output_tokens: output } });
  it("prices a call from its tokens and the registry", () => {
    expect(callMicroUsd(deepseek(1_000_000, 0).metadata)).toBeCloseTo(450_000);
    expect(callMicroUsd(deepseek(0, 1_000_000).metadata)).toBeCloseTo(2_400_000);
    expect(callMicroUsd({ model_id_requested: "unknown", input_tokens: 1_000_000 })).toBeCloseTo(450_000);
  });
  it("lets a turn through under the cap and refuses it once the day's calls and voice reach US$ 1", async () => {
    db.calls = [deepseek(1_000_000, 0)]; db.voice = [{ metadata: { worst_case_micro_usd: 20_000 } }];
    await expect(assertSecretaryDailyBudget(owner, pilot)).resolves.toBeUndefined();
    db.calls = [deepseek(1_000_000, 0), deepseek(0, 200_000)]; // 0.45 + 0.48 + 0.02 voice = 0.95
    await expect(assertSecretaryDailyBudget(owner, pilot)).resolves.toBeUndefined();
    db.voice = [...db.voice, { metadata: { worst_case_micro_usd: 60_000 } }]; // 1.01
    await expect(assertSecretaryDailyBudget(owner, pilot)).rejects.toThrow("SECRETARY_DAILY_BUDGET");
    await expect(assertSecretaryDailyBudget(owner, { ...pilot, SALON_SECRETARY_DAILY_BUDGET_USD: "3" })).resolves.toBeUndefined();
  });
  it("never queries outside the Production pilot", async () => {
    db.queried = 0;
    await assertSecretaryDailyBudget(owner, { ...pilot, VERCEL_ENV: "preview" });
    expect(db.queried).toBe(0);
  });
});
