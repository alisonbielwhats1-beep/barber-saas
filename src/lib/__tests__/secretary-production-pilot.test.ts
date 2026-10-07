import { describe, expect, it, vi } from "vitest";

/** Owner decision 05/10/2026: the Secretária in Production only for the presentation salon's owner, with a US$ 1 daily cap. */
const db = vi.hoisted(() => ({ rows: [] as unknown[], queried: 0 }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn({
  salon: { findUniqueOrThrow: async () => ({ timezone: "America/Sao_Paulo" }) },
  auditLog: { findMany: async () => { db.queried++; return db.rows; }, count: async () => 0 },
}) }));
import { assertPilotActor, assertSecretaryBudget, pilotActors, productionPilotActive } from "../secretary-production-pilot";
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
  it("owner 07/10: with SALON_SECRETARY_OPEN_TO_OWNERS every salon's owner is admitted, nobody else, without any list", () => {
    const open = { ...pilot, SALON_SECRETARY_OPEN_TO_OWNERS: "true", SALON_SECRETARY_ALLOWED_ACTORS: undefined };
    expect(() => assertSecretaryRolloutAccess({ salonId: "novo-salao", userId: "dona-nova", role: "OWNER" }, open)).not.toThrow();
    for (const role of ["MANAGER", "RECEPTIONIST", "PROFESSIONAL", undefined])
      expect(() => assertSecretaryRolloutAccess({ salonId: "novo-salao", userId: "outra", role }, open)).toThrow("SECRETARY_NOT_AVAILABLE");
    // Without the flag an owner outside the list stays out, and the listed pairs keep working with it on.
    expect(() => assertSecretaryRolloutAccess({ salonId: "novo-salao", userId: "dona-nova", role: "OWNER" }, pilot)).toThrow("SECRETARY_NOT_AVAILABLE");
    expect(() => assertSecretaryRolloutAccess(owner, { ...open, SALON_SECRETARY_ALLOWED_ACTORS: JSON.stringify([owner]) })).not.toThrow();
  });
  it("a blocked salon stays out, its owner or a listed pair included", () => {
    const open = { ...pilot, SALON_SECRETARY_OPEN_TO_OWNERS: "true", SALON_SECRETARY_BLOCKED_SALONS: " outro, salao-apresentacao " };
    expect(() => assertSecretaryRolloutAccess({ ...owner, role: "OWNER" }, open)).toThrow("SECRETARY_NOT_AVAILABLE");
    expect(() => assertSecretaryRolloutAccess({ salonId: "livre", userId: "dona", role: "OWNER" }, open)).not.toThrow();
  });
  it("open to owners never opens Production without the pilot flag", () => {
    expect(() => assertSecretaryRolloutAccess({ ...owner, role: "OWNER" }, { ...pilot, SALON_SECRETARY_PRODUCTION_PILOT: undefined, SALON_SECRETARY_OPEN_TO_OWNERS: "true" }))
      .toThrow("SECRETARY_NOT_AVAILABLE");
  });
  it("keeps Production closed without the pilot flag (the historical gate)", () => {
    expect(() => assertSecretaryRolloutAccess(owner, { ...pilot, SALON_SECRETARY_PRODUCTION_PILOT: undefined })).toThrow("SECRETARY_NOT_AVAILABLE");
  });
});

describe("daily and monthly spend caps (owner 05/10 and 06/10)", () => {
  const now = new Date("2026-10-20T15:00:00Z"), today = new Date("2026-10-20T13:00:00Z"), earlier = new Date("2026-10-03T13:00:00Z");
  const call = (input: number, output: number, createdAt = today) => ({ entityId: "c", entityType: "SALON_SECRETARY_USAGE", action: "MODEL_CALL_FINISHED", createdAt,
    metadata: { model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: input, cached_input_tokens: 0, cache_write_tokens: 0, output_tokens: output } });
  const voice = (worst: number, createdAt = today) => ({ entityId: "r", entityType: "SECRETARY_TRANSCRIBE", action: "RESERVE", createdAt, metadata: { worst_case_micro_usd: worst } });
  it("lets a turn through under the cap and refuses it once the day's calls and voice reach US$ 1", async () => {
    db.rows = [call(1_000_000, 0), voice(20_000)];
    await expect(assertSecretaryBudget(owner, pilot, now)).resolves.toBeUndefined();
    db.rows = [call(1_000_000, 0), call(0, 200_000), voice(20_000)]; // 0.45 + 0.48 + 0.02 voice = 0.95
    await expect(assertSecretaryBudget(owner, pilot, now)).resolves.toBeUndefined();
    db.rows = [...db.rows, voice(60_000)]; // 1.01
    await expect(assertSecretaryBudget(owner, pilot, now)).rejects.toThrow("SECRETARY_DAILY_BUDGET");
    await expect(assertSecretaryBudget(owner, { ...pilot, SALON_SECRETARY_DAILY_BUDGET_USD: "3" }, now)).resolves.toBeUndefined();
  });
  it("refuses once the month reaches the wallet, even on a quiet day", async () => {
    db.rows = [call(0, 2_000_000, earlier)]; // US$ 4.80 earlier this month
    await expect(assertSecretaryBudget(owner, pilot, now)).resolves.toBeUndefined();
    db.rows = [call(0, 2_000_000, earlier), voice(250_000, earlier)]; // US$ 5.05
    await expect(assertSecretaryBudget(owner, pilot, now)).rejects.toThrow("SECRETARY_MONTHLY_BUDGET");
    await expect(assertSecretaryBudget(owner, { ...pilot, SALON_SECRETARY_MONTHLY_BUDGET_USD: "10" }, now)).resolves.toBeUndefined();
  });
  it("with prepaid requests on, the caps protect every salon, pilot or not (owner 06/10)", async () => {
    db.rows = [call(0, 2_000_000, earlier), voice(250_000, earlier)]; // US$ 5.05 this month
    await expect(assertSecretaryBudget(owner, { SALON_SECRETARY_CREDITS_ENABLED: "true" }, now)).rejects.toThrow("SECRETARY_MONTHLY_BUDGET");
  });
  it("never queries outside the Production pilot", async () => {
    db.queried = 0;
    await assertSecretaryBudget(owner, { ...pilot, VERCEL_ENV: "preview" });
    expect(db.queried).toBe(0);
  });
});
