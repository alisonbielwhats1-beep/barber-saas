import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), ready: vi.fn(), group: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../tenant", () => ({ getTenantContext: mocks.context, assertRole: (ctx: { role: string }, roles: string[]) => {
  if (!roles.includes(ctx.role)) throw new Error("FORBIDDEN");
} }));
vi.mock("../salon-secretary", () => ({ SalonSecretary: class { confirmReadyGroups = mocks.ready; confirmActionPlanGroup = mocks.group; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { confirmSecretaryReadyGroups } from "../../app/(admin)/servicos/secretaria/actions";
import { revalidatePath } from "next/cache";

/** B2 transport: the "confirm everything that is ready" server action has the same gates as confirmSecretaryGroup. */
const approvals = [{ plan_ref: "plan", revision: 3, group_key: "group_1", fingerprint: "a".repeat(64) },
  { plan_ref: "plan", revision: 3, group_key: "group_2", fingerprint: "b".repeat(64) }];
describe("confirmSecretaryReadyGroups server action", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("SALON_SECRETARY_ENABLED", "true");
    vi.stubEnv("APP_ENV", "test"); vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp");
    vi.stubEnv("DIRECT_URL", "postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp");
    mocks.context.mockResolvedValue({ salonId: "authenticated-salon", userId: "authenticated-user", role: "OWNER" });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("binds the authenticated actor, passes every approval unchanged and refreshes routes after a real receipt", async () => {
    const state = { sessionId: "s", operations: [{ state: { receipt: { receipt_ref: "committed" } } }], confirmation_batch: { executed: ["group_1", "group_2"], replayed: [], not_executed: [] } };
    mocks.ready.mockResolvedValueOnce(state);
    expect(await confirmSecretaryReadyGroups("s", approvals)).toEqual({ ok: true, state });
    expect(mocks.ready).toHaveBeenCalledExactlyOnceWith({ salonId: "authenticated-salon", userId: "authenticated-user" }, "s", approvals);
    expect(mocks.group).not.toHaveBeenCalled();
    for (const route of ["/servicos", "/agenda", "/produtos", "/clientes"]) expect(revalidatePath).toHaveBeenCalledWith(route);
  });
  it("never refreshes without a receipt and maps stale / invalid batches to stable codes", async () => {
    mocks.ready.mockResolvedValueOnce({ sessionId: "s", operations: [] });
    expect(await confirmSecretaryReadyGroups("s", approvals)).toMatchObject({ ok: true });
    expect(revalidatePath).not.toHaveBeenCalled();
    mocks.ready.mockRejectedValueOnce(Error("CONFIRMATION_STALE"));
    expect(await confirmSecretaryReadyGroups("s", approvals)).toMatchObject({ ok: false, code: "CONFIRMATION_STALE" });
    mocks.ready.mockRejectedValueOnce(Error("CONFIRMATION_BATCH_INVALID"));
    expect(await confirmSecretaryReadyGroups("s", [])).toMatchObject({ ok: false, code: "CONFIRMATION_BATCH_INVALID", error: expect.stringContaining("Nada foi executado") });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("rejects a disallowed role before calling the coordinator", async () => {
    mocks.context.mockResolvedValue({ salonId: "authenticated-salon", userId: "authenticated-user", role: "PROFESSIONAL" });
    expect(await confirmSecretaryReadyGroups("s", approvals)).toMatchObject({ ok: false });
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("enforces rollout on an already open conversation", async () => {
    vi.stubEnv("SALON_SECRETARY_ALLOWED_ACTORS", "[]");
    expect(await confirmSecretaryReadyGroups("s", approvals)).toMatchObject({ ok: false, code: "SECRETARY_NOT_AVAILABLE" });
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("is disabled in production before authentication is even read", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await confirmSecretaryReadyGroups("s", approvals)).toMatchObject({ ok: false });
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.ready).not.toHaveBeenCalled();
  });
});
