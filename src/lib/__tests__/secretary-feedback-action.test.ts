import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** B7 owner feedback server action: gated by SALON_SECRETARY_FEEDBACK (default off) and by the same authentication,
 * role, environment and rollout gates as the Secretary; the actor comes from authentication, codes from the server's
 * own session record; the conversation text is stored only with the explicit checkbox. The store is a fixture tx. */
const mocks = vi.hoisted(() => ({ context: vi.fn(), feedbackContext: vi.fn(), queryRaw: vi.fn(), tenants: [] as unknown[], rollout: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../tenant", () => ({ getTenantContext: mocks.context, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("FORBIDDEN"); } }));
vi.mock("../secretary-rollout", () => ({ assertSecretaryRolloutAccess: mocks.rollout }));
vi.mock("../salon-secretary-runtime", () => ({ assertSecretaryEnvironment: () => undefined, salonSecretary: { feedbackContext: mocks.feedbackContext } }));
vi.mock("../prisma-tenant", () => ({ withTenant: async (actor: unknown, fn: (tx: object) => unknown) => { mocks.tenants.push(actor); return fn({ $queryRaw: mocks.queryRaw }); } }));
import { sendSecretaryFeedback } from "../../app/(admin)/servicos/secretaria/actions";
import { feedbackInput, feedbackRow, FEEDBACK_RATE_LIMIT, FEEDBACK_RATE_WINDOW_MINUTES, FEEDBACK_SESSION_LIMIT } from "../secretary-feedback";

const sessionId = "0b5f0f3e-6a4b-4c43-9a55-3f1b6d2f7a10", version = "a".repeat(64);
/** The INSERT's bound values in column order (tagged template: strings, then values). */
const stored = () => { const [, ...values] = mocks.queryRaw.mock.calls[0]; const [id, salonId, userId, session, turnIndex, codes, contractVersion, comment, consent, transcript] = values;
  return { id, salonId, userId, session, turnIndex, codes: JSON.parse(codes as string), contractVersion, comment, consent, transcript: transcript === null ? null : JSON.parse(transcript as string) }; };
beforeEach(() => {
  vi.clearAllMocks(); mocks.tenants.length = 0; vi.stubEnv("SALON_SECRETARY_FEEDBACK", "true");
  mocks.context.mockResolvedValue({ salonId: "authenticated-salon", userId: "authenticated-user", role: "OWNER" });
  mocks.feedbackContext.mockReturnValue({ codes: ["QUESTION", "TEMPORAL_SELECTOR_CONFLICT"], contract_version: version });
  mocks.queryRaw.mockResolvedValue([{ id: "row-1" }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("sendSecretaryFeedback", () => {
  it("flag off (default): refused before authentication, nothing stored", async () => {
    vi.stubEnv("SALON_SECRETARY_FEEDBACK", "");
    expect(await sendSecretaryFeedback({ sessionId, turn: 2, include_transcript: false })).toMatchObject({ ok: false, code: "FEEDBACK_DISABLED" });
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
  it("stores codes, the actor from authentication and the trimmed comment; no conversation text without the checkbox", async () => {
    expect(await sendSecretaryFeedback({ sessionId, turn: 2, comment: "  Eu pedi quinta, não sexta.  ", include_transcript: false })).toEqual({ ok: true });
    expect(mocks.feedbackContext).toHaveBeenCalledWith({ salonId: "authenticated-salon", userId: "authenticated-user" }, sessionId);
    expect(mocks.tenants).toEqual([{ salonId: "authenticated-salon", userId: "authenticated-user" }]);
    expect(stored()).toMatchObject({ salonId: "authenticated-salon", userId: "authenticated-user", session: sessionId, turnIndex: 2, codes: ["QUESTION", "TEMPORAL_SELECTOR_CONFLICT"],
      contractVersion: version, comment: "Eu pedi quinta, não sexta.", consent: false, transcript: null });
    expect(String(mocks.queryRaw.mock.calls[0][0].join("?"))).toContain('INSERT INTO "SecretaryFeedback"');
  });
  it("a transcript without the checkbox is refused and never stored", async () => {
    const reply = await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: false, transcript: [{ role: "owner", text: "Cancela a Amanda" }] });
    expect(reply).toMatchObject({ ok: false, code: "FEEDBACK_INVALID" }); expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: true })).toMatchObject({ ok: false, code: "FEEDBACK_INVALID" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
  it("with the checkbox, the conversation text shown on the screen is stored with the consent", async () => {
    const transcript = [{ role: "owner", text: "Cancela a Amanda amanhã" }, { role: "secretary", text: "Qual o motivo do cancelamento?" }];
    expect(await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: true, transcript })).toEqual({ ok: true });
    expect(stored()).toMatchObject({ consent: true, transcript, comment: null });
  });
  it("identity, codes and limits never come from the payload", async () => {
    for (const payload of [{ sessionId, turn: 1, include_transcript: false, salonId: "other-salon" }, { sessionId, turn: 1, include_transcript: false, codes: ["FORGED"] },
      { sessionId: "not-a-uuid", turn: 1, include_transcript: false }, { sessionId, turn: 501, include_transcript: false }, { sessionId, turn: 1, include_transcript: false, comment: "x".repeat(1001) },
      { sessionId, turn: 1, include_transcript: true, transcript: Array.from({ length: 81 }, () => ({ role: "owner", text: "a" })) }])
      expect(await sendSecretaryFeedback(payload)).toMatchObject({ ok: false, code: "FEEDBACK_INVALID" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
  it("authentication, role and rollout gates apply; an unknown session stores no codes", async () => {
    mocks.context.mockRejectedValueOnce(Error("UNAUTHENTICATED"));
    expect((await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: false })).ok).toBe(false);
    mocks.context.mockResolvedValueOnce({ salonId: "s", userId: "u", role: "PROFESSIONAL" });
    expect((await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: false })).ok).toBe(false);
    mocks.rollout.mockImplementationOnce(() => { throw Error("SECRETARY_NOT_AVAILABLE"); });
    expect(await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: false })).toMatchObject({ ok: false, code: "SECRETARY_NOT_AVAILABLE" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    mocks.feedbackContext.mockReturnValueOnce(undefined);
    expect(await sendSecretaryFeedback({ sessionId, turn: 0, include_transcript: false })).toEqual({ ok: true });
    expect(stored()).toMatchObject({ codes: [], contractVersion: null });
  });
  it("review: nothing inserted (a per-user or per-conversation limit reached) is FEEDBACK_RATE_LIMITED; the limits are bound in the same INSERT", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    const reply = await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: false });
    expect(reply).toMatchObject({ ok: false, code: "FEEDBACK_RATE_LIMITED" });
    const [strings, ...values] = mocks.queryRaw.mock.calls[0];
    expect((strings as string[]).join("?")).toMatch(/INSERT INTO "SecretaryFeedback"[\s\S]*SELECT[\s\S]*WHERE \(SELECT count\(\*\)/);
    expect(values.slice(10)).toEqual(["authenticated-user", FEEDBACK_RATE_WINDOW_MINUTES, FEEDBACK_RATE_LIMIT, sessionId, FEEDBACK_SESSION_LIMIT]);
  });
  it("a storage failure is reported without detail and changes nothing else", async () => {
    mocks.queryRaw.mockRejectedValueOnce(Error("relation \"SecretaryFeedback\" does not exist password=secret"));
    const reply = await sendSecretaryFeedback({ sessionId, turn: 1, include_transcript: false });
    expect(reply).toMatchObject({ ok: false, code: "FEEDBACK_FAILED" }); expect(JSON.stringify(reply)).not.toContain("secret");
  });
});

describe("feedbackRow (pure)", () => {
  it("keeps whitelisted codes and a valid contract only; the transcript only with consent", () => {
    const actor = { salonId: "s", userId: "u" };
    const input = feedbackInput.parse({ sessionId, turn: 3, include_transcript: false });
    expect(feedbackRow(actor, input, { codes: ["OK_CODE", "not a code", "Fábio"], contract_version: "short" })).toMatchObject({ outcomeCodes: ["OK_CODE"], contractVersion: null, transcript: null, comment: null });
    expect(() => feedbackInput.parse({ sessionId, turn: 3, include_transcript: false, transcript: [{ role: "owner", text: "x" }] })).toThrow();
  });
});
