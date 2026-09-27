import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), propose: vi.fn() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn({}) }));
vi.mock("../service-catalog", () => ({ assertServiceWriter: async () => ({ currency: "BRL" }) }));
vi.mock("../salon-secretary-usage", () => ({ usageRecorder: () => async () => {} }));
vi.mock("../service-create-mvp", async importOriginal => ({ ...await importOriginal<object>(), upsertActionDraft: mocks.upsert, proposeServiceCreate: mocks.propose }));
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("normalizes before U03 and preserves the omitted name in the next patch, without extra inference", async () => {
  const network = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); });
  vi.stubGlobal("fetch", network);
  const model = new ScriptedServicesModel([
    call("upsert_action_draft", { name: "massagem", priceCents: 5000, durationMin: null }),
    call("upsert_action_draft", { name: null, priceCents: null, durationMin: 60 }),
  ]);
  const draftRef = crypto.randomUUID();
  mocks.upsert.mockResolvedValueOnce({ draft_ref: draftRef, draft_revision: 1, fields: { name: "Massagem", priceCents: 5000 }, status: "NEEDS_INPUT", missing_fields: ["durationMin"] })
    .mockResolvedValueOnce({ draft_ref: draftRef, draft_revision: 2, fields: { name: "Massagem", priceCents: 5000, durationMin: 60 }, status: "READY", missing_fields: [] });
  mocks.propose.mockResolvedValue({ preview: "Massagem\nR$50\n60 minutos" });
  const actor = { salonId: "synthetic", userId: "synthetic" };
  const secretary = new SalonSecretary(async () => model, () => "fake-services");
  const session = await secretary.start(actor);
  const first = await secretary.send(actor, { sessionId: session.sessionId, message: "Cadastre uma massagem por R$50." });
  expect(first.message).toBe("Qual será a duração?");
  expect(mocks.upsert.mock.calls[0][2].patch).toEqual({ name: "Massagem", priceCents: 5000 });
  expect(model.requests).toHaveLength(1);
  const second = await secretary.send(actor, { sessionId: session.sessionId, message: "Uma hora." });
  expect(mocks.upsert.mock.calls[1][2]).toEqual({ draft_ref: draftRef, expected_revision: 1, patch: { durationMin: 60 } });
  expect(second.message).toContain("Massagem");
  expect(mocks.propose).toHaveBeenCalledOnce();
  expect(model.requests).toHaveLength(2);
  expect(network).not.toHaveBeenCalled();
});
