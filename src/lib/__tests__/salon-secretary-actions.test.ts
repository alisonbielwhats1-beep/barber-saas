import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), cancel: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../tenant", () => ({ getTenantContext: mocks.context, assertRole: (ctx: { role: string }, roles: string[]) => {
  if (!roles.includes(ctx.role)) throw new Error("FORBIDDEN");
} }));
vi.mock("../salon-secretary", () => ({ SalonSecretary: class {
  start = mocks.start; send = mocks.send; confirm = mocks.confirm; cancel = mocks.cancel;
  confirmActionPlanGroup = mocks.group;
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { startSecretary, sendSecretary, startAndSendSecretary, confirmSecretary, confirmSecretaryGroup } from "../../app/(admin)/servicos/secretaria/actions";
import { revalidatePath } from 'next/cache';
import { requestTooLargeMessage } from "@everflair/salon-secretary";
describe("Secretary authenticated server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("SALON_SECRETARY_ENABLED", "true");
    vi.stubEnv("APP_ENV", "test"); vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp");
    vi.stubEnv("DIRECT_URL", "postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp");
    mocks.context.mockResolvedValue({ salonId: "authenticated-salon", userId: "authenticated-user", role: "OWNER" });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("binds session identity from authentication, never from request", async () => {
    await sendSecretary({ sessionId: "id", message: "Uma hora" });
    expect(mocks.send).toHaveBeenCalledWith({ salonId: "authenticated-salon", userId: "authenticated-user" }, { sessionId: "id", message: "Uma hora" });
    await confirmSecretary("session", { proposal_ref: "proposal", draft_revision: 2 });
    expect(mocks.confirm).toHaveBeenCalledWith({ salonId: "authenticated-salon", userId: "authenticated-user" }, "session", { proposal_ref: "proposal", draft_revision: 2 });
  });
  it("rejects missing authentication and disallowed roles before service calls", async () => {
    mocks.context.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    expect((await startSecretary()).ok).toBe(false);
    mocks.context.mockResolvedValue({ role: "PROFESSIONAL" });
    expect((await confirmSecretary("id", {})).ok).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each([
    ["SALON_SECRETARY_ENABLED", "false"], ["APP_ENV", "production"], ["VERCEL_ENV", "production"],
    ["DATABASE_URL", "postgresql://runtime@db.example.test/prod"],
    ["DATABASE_URL", "postgresql://runtime@127.0.0.1:5432/salon"],
    ["DIRECT_URL", "postgresql://runtime@127.0.0.1:55441/another_database"],
  ])("blocks unsafe/disabled environment %s", async (key, value) => {
    vi.stubEnv(key, value); expect((await startSecretary()).ok).toBe(false);
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("does not expose raw provider error or key and never returns success for failure", async () => {
    mocks.send.mockRejectedValueOnce(new Error("secret-provider-detail"));
    const reply = await sendSecretary({}); expect(reply.ok).toBe(false);
    expect(JSON.stringify(reply)).not.toContain("secret-provider-detail");
  });
  it("a request refused for its size asks, in pt-BR, to split it (the runtime's own text)", async () => {
    mocks.send.mockRejectedValueOnce(new Error("SECRETARY_REQUEST_TOO_LARGE"));
    expect(await sendSecretary({ sessionId: "id", message: "pedido longo" })).toEqual({ ok: false, code: "SECRETARY_REQUEST_TOO_LARGE", error: requestTooLargeMessage });
  });
  it("enforces rollout on a previously opened conversation before confirmation or inference", async () => {
    vi.stubEnv("SALON_SECRETARY_ALLOWED_ACTORS", '[{"salonId":"authenticated-salon","userId":"authenticated-user"}]');
    await startSecretary();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    vi.stubEnv("SALON_SECRETARY_ALLOWED_ACTORS", "[]");
    expect(await confirmSecretaryGroup("existing-session", {})).toMatchObject({ ok: false, code: "SECRETARY_NOT_AVAILABLE" });
    expect(await sendSecretary({ sessionId: "existing-session", message: "continuar" })).toMatchObject({ ok: false, code: "SECRETARY_NOT_AVAILABLE" });
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not take allowlisted identity from the client payload", async () => {
    vi.stubEnv("SALON_SECRETARY_ALLOWED_ACTORS", '[{"salonId":"other-salon","userId":"other-user"}]');
    expect(await sendSecretary({ salonId: "other-salon", userId: "other-user", message: "alterar" })).toMatchObject({ ok: false, code: "SECRETARY_NOT_AVAILABLE" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('binds group confirmation to authenticated actor and refreshes real product routes', async () => {
    const state = { sessionId: 's', operations: [{ state: { receipt: { receipt_ref: 'committed' } } }] };
    mocks.group.mockResolvedValueOnce(state);
    const approval = { plan_ref: 'plan', revision: 3, group_key: 'group', fingerprint: 'fingerprint' };
    expect(await confirmSecretaryGroup('s', approval)).toEqual({ ok: true, state });
    expect(mocks.group).toHaveBeenCalledWith({ salonId: 'authenticated-salon', userId: 'authenticated-user' }, 's', approval);
    for (const route of ['/servicos', '/agenda', '/produtos', '/clientes']) expect(revalidatePath).toHaveBeenCalledWith(route);
  });
  it('does not turn a committed receipt into failure if cache invalidation fails', async () => {
    const state = { sessionId: 's', receipt: { receipt_ref: 'committed' } };
    mocks.group.mockResolvedValueOnce(state);
    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw Error('CACHE_UNAVAILABLE'); });
    const reply = await confirmSecretaryGroup('s', {});
    expect(reply).toEqual({ ok: true, state: { ...state, execution_warnings: ['VIEW_REFRESH_UNAVAILABLE'] } });
    expect(mocks.group).toHaveBeenCalledTimes(1);
  });
  it('returns stale failure without refreshing or claiming a receipt', async () => {
    mocks.group.mockRejectedValueOnce(Error('CONFIRMATION_STALE'));
    expect(await confirmSecretaryGroup('s', {})).toMatchObject({ ok: false, code: 'CONFIRMATION_STALE' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("the first message opens the conversation and is read in the same request, under the authenticated identity", async () => {
    const actor = { salonId: "authenticated-salon", userId: "authenticated-user" };
    mocks.start.mockResolvedValue({ sessionId: "opened" }); mocks.send.mockResolvedValue({ sessionId: "opened", message: "Olá! Em que posso ajudar?" });
    expect(await startAndSendSecretary({ message: "oi", sessionId: "someone-else" })).toMatchObject({ ok: true, state: { sessionId: "opened" } });
    expect(mocks.context).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith(actor, "auto");
    expect(mocks.send).toHaveBeenCalledWith(actor, { message: "oi", sessionId: "opened" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("a first message that fails closes the conversation it opened and says so; nothing opens without authentication", async () => {
    const actor = { salonId: "authenticated-salon", userId: "authenticated-user" };
    mocks.start.mockResolvedValue({ sessionId: "opened" }); mocks.send.mockRejectedValueOnce(Error("OPENAI_TIMEOUT"));
    expect(await startAndSendSecretary({ message: "remarca a Lúcia" })).toMatchObject({ ok: false });
    expect(mocks.cancel).toHaveBeenCalledWith(actor, "opened");
    mocks.send.mockRejectedValueOnce(Error("OPENAI_TIMEOUT")); mocks.cancel.mockRejectedValueOnce(Error("SESSION_NOT_FOUND"));
    expect(await startAndSendSecretary({ message: "remarca a Lúcia" })).toMatchObject({ ok: false });
    vi.clearAllMocks(); mocks.context.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    expect((await startAndSendSecretary({ message: "oi" })).ok).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
});
