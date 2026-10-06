import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ context: vi.fn(), start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), ready: vi.fn(), automatic: vi.fn(), cancel: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../tenant", () => ({ getTenantContext: mocks.context, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("FORBIDDEN"); } }));
vi.mock("../salon-secretary", () => ({ SalonSecretary: class {
  start = mocks.start; send = mocks.send; confirm = mocks.confirm; cancel = mocks.cancel; confirmActionPlanGroup = mocks.group; confirmReadyGroups = mocks.ready; confirmAutomatic = mocks.automatic;
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { confirmSecretary, confirmSecretaryGroup, confirmSecretaryOperation, confirmSecretaryReadyGroups, sendSecretary, startSecretary } from "../../app/(admin)/servicos/secretaria/actions";
import { legacyRefusalMessage, secretaryErrorMessage, secretaryErrorMessages, unknownExecutionMessage, unknownRefusalMessage } from "../secretary-error-copy";
import { requestTooLargeMessage } from "@everflair/salon-secretary";

/** ERR-COPY: the code→pt-BR table moved out of the server actions (secretary-error-copy.ts) byte for byte; the unknown fallback
 * and the "turn reply" marker change only with SALON_SECRETARY_COPY_V2. Codes in, pt-BR out: no exception text ever. */
describe("the shared code→pt-BR table (snapshot of the table the server actions held)", () => {
  it("keeps every historical code with its exact text", () => {
    expect(Object.keys(secretaryErrorMessages)).toHaveLength(70);
    // Pinned: any change of wording or of the code set is a deliberate, reviewed change of this digest.
    expect(createHash("sha256").update(JSON.stringify(secretaryErrorMessages)).digest("hex")).toBe(EXPECTED_TABLE_SHA256);
    for (const [code, text] of Object.entries(secretaryErrorMessages)) expect(secretaryErrorMessage(code)).toEqual({ code, text });
    expect(secretaryErrorMessages.INVALID_DEPENDENCY_GRAPH).toBe("Não consegui ordenar essas ações com segurança. Nada foi alterado. Pode pedir uma de cada vez?");
    expect(secretaryErrorMessages.SECRETARY_REQUEST_TOO_LARGE).toBe(requestTooLargeMessage);
    expect(secretaryErrorMessage("Estoque insuficiente para esta saida").text).toBe("Estoque insuficiente para esta saída. Nenhuma movimentação foi aplicada.");
  });
  it("flag off: an unknown code, a non-code message or an inherited key gets the historical refusal (BACKEND_FAILURE)", () => {
    for (const code of ["NEVER_SEEN_CODE", "", "__proto__", "constructor", "select * from \"ClientProfile\" where token='sk-live'"])
      expect(secretaryErrorMessage(code, { env: {} })).toEqual({ code: "BACKEND_FAILURE", text: legacyRefusalMessage });
  });
  it("flag on: the unknown refusal is honest and never technical; a confirmation's never claims nothing changed", () => {
    const env = { SALON_SECRETARY_COPY_V2: "true" };
    expect(secretaryErrorMessage("ZOD_ERROR", { env })).toEqual({ code: "BACKEND_FAILURE", text: unknownRefusalMessage });
    expect(unknownRefusalMessage).toBe("Não consegui concluir esse pedido com segurança. Nada foi alterado. Pode repetir de outro jeito, uma ação por vez?");
    expect(unknownRefusalMessage).not.toMatch(/Posso ajudar|Verifique acesso|[A-Z]{3,}_/);
    expect(secretaryErrorMessage("DB_TIMEOUT", { env, executing: true }).text).toBe(unknownExecutionMessage);
    expect(unknownExecutionMessage).toContain("Não presuma sucesso"); expect(unknownExecutionMessage).not.toContain("Nada foi alterado");
    // Known codes keep their own text with the flag on too.
    expect(secretaryErrorMessage("SLOT_CONFLICT", { env, executing: true }).text).toBe(secretaryErrorMessages.SLOT_CONFLICT);
  });
});
describe("server actions use the shared table (flag off: byte-identical replies; on: the copy marker)", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("SALON_SECRETARY_ENABLED", "true"); vi.stubEnv("APP_ENV", "test"); vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp");
    vi.stubEnv("DIRECT_URL", "postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp");
    mocks.context.mockResolvedValue({ salonId: "salon-spa", userId: "owner-spa", role: "OWNER" });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("flag off: exactly the historical shapes (no marker), known and unknown", async () => {
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "false");
    mocks.send.mockRejectedValueOnce(new Error("INVALID_DEPENDENCY_GRAPH"));
    expect(await sendSecretary({ sessionId: "s", message: "x" })).toEqual({ ok: false, code: "INVALID_DEPENDENCY_GRAPH", error: secretaryErrorMessages.INVALID_DEPENDENCY_GRAPH });
    mocks.send.mockRejectedValueOnce(new Error("password=hunter2 at pg"));
    expect(await sendSecretary({ sessionId: "s", message: "x" })).toEqual({ ok: false, code: "BACKEND_FAILURE", error: legacyRefusalMessage });
    mocks.group.mockRejectedValueOnce(new Error("UNEXPECTED_DB_FAILURE"));
    expect(await confirmSecretaryGroup("s", {})).toEqual({ ok: false, code: "BACKEND_FAILURE", error: legacyRefusalMessage });
    mocks.start.mockResolvedValueOnce({ sessionId: "s", cancelled: false, message: "oi" });
    expect(await startSecretary()).toEqual({ ok: true, state: { sessionId: "s", cancelled: false, message: "oi" } });
  });
  it("flag on: an unknown refusal while understanding is the honest refusal; the reply carries the copy marker", async () => {
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "true");
    mocks.send.mockRejectedValueOnce(new Error("secret-provider-detail"));
    const reply = await sendSecretary({ sessionId: "s", message: "x" });
    expect(reply).toEqual({ ok: false, code: "BACKEND_FAILURE", error: unknownRefusalMessage, copyV2: true });
    expect(JSON.stringify(reply)).not.toContain("secret-provider-detail");
    mocks.start.mockResolvedValueOnce({ sessionId: "s", cancelled: false, message: "oi" });
    expect(await startSecretary()).toEqual({ ok: true, state: { sessionId: "s", cancelled: false, message: "oi" }, copyV2: true });
  });
  it.each([
    ["confirmSecretary", () => { mocks.confirm.mockRejectedValueOnce(new Error("LOCK_LOST")); return confirmSecretary("s", {}); }],
    ["confirmSecretaryOperation", () => { mocks.automatic.mockRejectedValueOnce(new Error("LOCK_LOST")); return confirmSecretaryOperation("s", "op", {}); }],
    ["confirmSecretaryGroup", () => { mocks.group.mockRejectedValueOnce(new Error("LOCK_LOST")); return confirmSecretaryGroup("s", {}); }],
    ["confirmSecretaryReadyGroups", () => { mocks.ready.mockRejectedValueOnce(new Error("LOCK_LOST")); return confirmSecretaryReadyGroups("s", []); }],
  ] as const)("flag on, %s: an unknown failure keeps the uncertain state (BACKEND_FAILURE, 'Não presuma sucesso')", async (_name, run) => {
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "true");
    expect(await run()).toEqual({ ok: false, code: "BACKEND_FAILURE", error: unknownExecutionMessage, copyV2: true });
  });
});
const EXPECTED_TABLE_SHA256 = "aef9b1b7d4ecf84c3894364224630cd31c69a984608d54077ad50310e2a9532a";
