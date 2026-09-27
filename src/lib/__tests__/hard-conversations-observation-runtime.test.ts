import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), auditLog: { create: vi.fn() }, upsert: vi.fn(), propose: vi.fn() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(), upsertActionDraft: db.upsert,
  proposeServiceCreate: db.propose }));

import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import { makeFixture, syntheticRef } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
import { hardConversations } from "../../../packages/salon-secretary/evaluation/hard-conversations";
import { RuntimeObservationBridge, type RouterEvidence } from "../../../packages/salon-secretary/evaluation/hard-conversations-observation-bridge";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("actual SalonSecretary public boundary with mocked model/backend", () => {
  it("observes the same draft through two frozen turns without confirm or JEV", async () => {
    const fixture = makeFixture("t07", "free"), c = hardConversations.find(x => x.case_id === "t07")!;
    const actor = { salonId: fixture.tenant, userId: fixture.actor };
    const draftRef = syntheticRef("t07", "draft"), proposalRef = syntheticRef("t07", "proposal");
    db.upsert.mockResolvedValueOnce({ draft_ref: draftRef, draft_revision: 1,
      fields: { name: "Massagem Relaxante", priceCents: 5000 }, status: "NEEDS_INPUT", missing_fields: ["durationMin"] })
      .mockResolvedValueOnce({ draft_ref: draftRef, draft_revision: 2,
        fields: { name: "Massagem Relaxante", priceCents: 5000, durationMin: 45 }, status: "READY", missing_fields: [] });
    db.propose.mockResolvedValue({ proposal_ref: proposalRef, draft_ref: draftRef, draft_revision: 2,
      preview: "Massagem Relaxante, 45 min, R$50" });
    const model = new ScriptedServicesModel([call("select_capabilities", plan([intent("service.create", {
      name: "Massagem Relaxante", priceCents: 5000 })])),
      call("upsert_action_draft", { name: null, priceCents: null, durationMin: 45 })],
      { input_tokens: 100, output_tokens: 20, total_tokens: 120 });
    const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined,
      { enabled: () => false, paidCallsAllowed: () => false });
    const confirm = vi.spyOn(secretary, "confirm");
    let traceCursor = 0;
    const bridge = new RuntimeObservationBridge({ secretary, actor, fixture, allowedTurns: c.turns,
      routerEvidence: () => {
        const traces = db.auditLog.create.mock.calls.map(call => call[0].data)
          .filter(row => row.entityType === "SECRETARY_ROUTER");
        const next = traces[traceCursor++];
        return next?.metadata as RouterEvidence | null;
      },
      // Local test spy, not a claim about a serialized network request.
      wireEvidence: () => ({ model: "gpt-6-luna", store: false, hosted_tools: 0, containers: 0, retries: 0,
        function_tools: ["select_capabilities"] }),
      effectEvidence: () => ({ confirmations: 0, business_writes: 0, outbox_writes: 0, external_messages: 0 }),
    });
    const conversation_ref = await bridge.open();
    const a = await bridge.send({ conversation_ref, turn_index: 1, message: c.turns[0].message, draft_refs: {} });
    expect(a.view?.operations?.[0].state.draft?.draft_ref).toBe(draftRef);
    expect(a.capture.router_path).toBe("DIRECT_LUNA");
    expect(a.capture.operations[0]).toMatchObject({ operation: "service.create", draft_ref: draftRef,
      missing_fields: ["durationMin"] });
    const b = await bridge.send({ conversation_ref, turn_index: 2, message: c.turns[1].message, draft_refs: a.capture.draft_refs });
    expect(b.view?.operations?.[0].state.proposal?.proposal_ref).toBe(proposalRef);
    // Frozen "45 minutos." includes a period; the current fast-path accepts only "45 minutos".
    expect(b.capture.router_path).toBe("DIRECT_LUNA");
    expect(b.capture.operations[0].draft_ref).toBe(draftRef);
    expect(b.capture.events.map(x => x.type)).toContain("PROPOSAL_CREATED");
    expect(model.requests).toHaveLength(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(db.upsert).toHaveBeenCalledTimes(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
