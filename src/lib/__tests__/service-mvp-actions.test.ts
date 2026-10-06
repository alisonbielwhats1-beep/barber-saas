import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), transaction: vi.fn(), upsert: vi.fn(), confirm: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../tenant", () => ({
  getTenantContext: mocks.context,
  assertRole: (ctx: { role: string }, allowed: string[]) => {
    if (!allowed.includes(ctx.role)) throw new Error("FORBIDDEN");
  },
}));
vi.mock("../prisma-tenant", () => ({ withTenant: mocks.transaction }));
vi.mock("../service-create-mvp", () => ({ upsertActionDraft: mocks.upsert, confirmServiceCreate: mocks.confirm, proposeServiceCreate: vi.fn() }));
import { confirmServiceCreateProposal, submitServiceCreateMessage } from "../../app/(admin)/servicos/mvp-actions";

describe("service MVP server boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SERVICE_CREATE_MVP_ENABLED", "true");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://test@127.0.0.1:55441/everflair_service_mvp");
    vi.stubEnv("DIRECT_URL", "postgresql://test@127.0.0.1:55441/everflair_service_mvp");
    mocks.context.mockResolvedValue({ salonId: "session-salon", userId: "session-user", role: "OWNER" });
    mocks.transaction.mockImplementation((_ctx, callback) => callback({}));
  });
  it("uses only session actor/tenant and passes the bounded parsed patch", async () => {
    await submitServiceCreateMessage({ message: "Cadastre uma massagem por R$50" });
    expect(mocks.upsert).toHaveBeenCalledWith({}, { salonId: "session-salon", userId: "session-user", role: "OWNER" }, {
      draft_ref: undefined, expected_revision: undefined, patch: { name: "Massagem", priceCents: 5000 },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("rejects client-supplied tenant and actor", async () => {
    await expect(submitServiceCreateMessage({ message: "60 minutos", salonId: "other" })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("fails closed when disabled, in APP_ENV production or in Vercel production", async () => {
    vi.stubEnv("SERVICE_CREATE_MVP_ENABLED", "false");
    await expect(confirmServiceCreateProposal({})).rejects.toThrow("MVP_DISABLED");
    vi.stubEnv("SERVICE_CREATE_MVP_ENABLED", "true"); vi.stubEnv("APP_ENV", "production");
    await expect(confirmServiceCreateProposal({})).rejects.toThrow("MVP_DISABLED");
    vi.stubEnv("APP_ENV", "test"); vi.stubEnv("VERCEL_ENV", "production");
    await expect(confirmServiceCreateProposal({})).rejects.toThrow("MVP_DISABLED");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not execute without a session or an authorized role", async () => {
    mocks.context.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    await expect(confirmServiceCreateProposal({})).rejects.toThrow("UNAUTHENTICATED");
    mocks.context.mockResolvedValue({ salonId: "session-salon", userId: "session-user", role: "RECEPTIONIST" });
    await expect(confirmServiceCreateProposal({})).rejects.toThrow("FORBIDDEN");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("blocks a remote database even if APP_ENV is mislabeled test", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test@db.example.test/remote");
    await expect(confirmServiceCreateProposal({})).rejects.toThrow("database-safety");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
