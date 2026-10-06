import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { SecretaryView } from "../salon-secretary";
import { hardConversations } from "../../../packages/salon-secretary/evaluation/hard-conversations";
import { makeFixture, syntheticRef } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
import { RuntimeObservationBridge, observationStopReason, type BridgeSources } from
  "../../../packages/salon-secretary/evaluation/hard-conversations-observation-bridge";
import { buildPhaseAPlan, verifyPhaseA } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a";

const view = (value: object) => value as SecretaryView;
function harness(id: string, states: SecretaryView[], overrides: Partial<BridgeSources> = {}) {
  const c = hardConversations.find(c => c.case_id === id)!;
  const fixture = makeFixture(id, c.fixture), actor = { salonId: fixture.tenant, userId: fixture.actor };
  const sessionId = syntheticRef(id, "conversation");
  const initial = view({ sessionId, skill: "auto", cancelled: false, message: "Ready" });
  const start = vi.fn(async (_actor: BridgeSources["actor"], _skill: "auto") => { void _actor; void _skill; return initial; });
  const send = vi.fn(async (_actor: BridgeSources["actor"], _input: unknown) => { void _actor; void _input; return states.shift()!; });
  const sources: BridgeSources = { secretary: { start, send }, actor, fixture, allowedTurns: c.turns,
    effectEvidence: () => ({ confirmations: 0, business_writes: 0, outbox_writes: 0, external_messages: 0 }),
    routerEvidence: () => ({ router_path: "DIRECT_LUNA", luna_calls: 1, jev_http_calls: 0,
      usage_luna: [{ input_tokens: 100, output_tokens: 20 }], estimated_cost_usd: { total: .00002, openai: .00002, jev: 0 },
      durations_ms: { luna_http: 8, jev: 0, backend_and_orchestration: 2 } }),
    wireEvidence: () => ({ model: "gpt-6-luna", store: false, hosted_tools: 0, containers: 0, retries: 0,
      function_tools: ["select_capabilities"] }), ...overrides };
  return { bridge: new RuntimeObservationBridge(sources), start, send, sessionId, fixture, c };
}
const input = (conversation_ref: string, turn_index: number, message: string, draft_refs: Record<string, string> = {}) =>
  ({ conversation_ref, turn_index, message, draft_refs });
const child = (sessionId: string, state: object) => view({ sessionId, skill: "services", cancelled: false, message: "Question or preview",
  ...state });
const parent = (sessionId: string, children: SecretaryView[]) => view({ sessionId, skill: "auto", cancelled: false,
  message: "Confira", operations: children.map((state, i) => ({ operation_ref: syntheticRef("t07", `child-${i}`), state })) });

describe("runtime observation bridge, synthetic boundary only", () => {
  it("forwards the exact returned view; continuation keeps conversation/draft and records correction/preview", async () => {
    const f = makeFixture("t07", "free"), session = syntheticRef("t07", "conversation"), draftRef = syntheticRef("t07", "draft");
    const first = parent(session, [child(syntheticRef("t07", "child-0"), { draft: { draft_ref: draftRef, draft_revision: 1,
      fields: { name: "Massagem Relaxante", priceCents: 5000 }, status: "NEEDS_INPUT", missing_fields: ["durationMin"] } })]);
    const second = parent(session, [child(syntheticRef("t07", "child-0"), { draft: { draft_ref: draftRef, draft_revision: 2,
      fields: { name: "Massagem Relaxante", priceCents: 5000, durationMin: 45 }, status: "READY", missing_fields: [] },
      proposal: { proposal_ref: syntheticRef("t07", "proposal"), draft_ref: draftRef, draft_revision: 2, preview: "Synthetic" } })]);
    const h = harness("t07", [first, second], { fixture: f });
    expect(await h.bridge.open()).toBe(session);
    const a = await h.bridge.send(input(session, 1, h.c.turns[0].message));
    expect(a.view).toBe(first); expect(a.capture.events.map(x => x.type)).toContain("FIELD_MISSING");
    expect(a.capture.draft_refs.observed_1).toBe(draftRef);
    const b = await h.bridge.send(input(session, 2, h.c.turns[1].message, a.capture.draft_refs));
    expect(b.view).toBe(second); expect(b.capture.draft_refs).toEqual(a.capture.draft_refs);
    expect(b.capture.events.map(x => x.type)).toEqual(expect.arrayContaining(["DRAFT_UPDATED",
      "PROPOSAL_CREATED", "CONFIRMATION_REQUIRED"]));
    expect(b.capture.events.map(x => x.type)).not.toContain("DRAFT_CORRECTED");
    expect(b.capture.safety.UNSAFE_EXECUTION).toBe("PASS");
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1][1]).toEqual({ sessionId: session, message: "45 minutos." });
  });

  it("keeps unobservable safety questions UNKNOWN, never PASS", async () => {
    const h = harness("i01", [view({ sessionId: syntheticRef("i01", "conversation"), skill: "auto", cancelled: false,
      message: "Qual serviço e horário?" })], { effectEvidence: undefined, routerEvidence: undefined, wireEvidence: undefined });
    const ref = await h.bridge.open(), result = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    expect(result.capture.safety.INVENTED_FIELD).toBe("UNKNOWN");
    expect(result.capture.safety.UNSAFE_EXECUTION).toBe("UNKNOWN");
    expect(result.capture.router_path).toBe("UNKNOWN");
  });

  it("observes ambiguity and selection only from structured candidates", async () => {
    const f = makeFixture("a02", "many_cuts"), session = syntheticRef("a02", "conversation");
    const s = view({ sessionId: syntheticRef("a02", "child"), skill: "scheduling", cancelled: false, message: "Escolha um serviço",
      scheduling: { operation: "appointment.create", fields: { customer_name: "Alisson", service_name: "corte" },
        candidates: { kind: "service_ref", items: f.services.filter(x => x.name.toLowerCase().includes("corte")) }, metrics: {} } });
    const h = harness("a02", [parent(session, [s])], { fixture: f });
    await h.bridge.open(); const r = await h.bridge.send(input(session, 1, h.c.turns[0].message));
    expect(r.capture.operations[0].candidates?.count).toBe(3);
    expect(r.capture.events.map(x => x.type)).toEqual(expect.arrayContaining(["AMBIGUITY_FOUND", "SELECTION_REQUESTED"]));
    expect(r.capture.safety.WRONG_ENTITY_AUTO_SELECTED).toBe("UNKNOWN");
  });

  it("does not invent approximation from a single unselected candidate", async () => {
    const h = harness("a02", []), ref = await h.bridge.open();
    h.send.mockResolvedValueOnce(view({ sessionId: ref, skill: "scheduling", cancelled: false, message: "Escolha",
      scheduling: { operation: "appointment.create", fields: { customer_name: "Alisson" },
        candidates: { kind: "professional_ref", items: [h.fixture.professionals[0]] }, metrics: {} } }));
    const r = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    expect(r.capture.events.map(x => x.type)).toContain("SELECTION_REQUESTED");
    expect(r.capture.events.map(x => x.type)).not.toContain("APPROXIMATE_CANDIDATE");
  });

  it("detects current unconfirmed approximate auto-selection without correcting it", async () => {
    const f = makeFixture("a01", "approximate"), session = syntheticRef("a01", "conversation");
    const s = view({ sessionId: syntheticRef("a01", "child"), skill: "scheduling", cancelled: false, message: "Qual horário?",
      scheduling: { operation: "appointment.create", fields: { service_name: "corte", service_ref: f.services[0].id }, metrics: {} } });
    const h = harness("a01", [parent(session, [s])], { fixture: f });
    await h.bridge.open(); const r = await h.bridge.send(input(session, 1, h.c.turns[0].message));
    expect(r.capture.events.map(x => x.type)).toContain("APPROXIMATE_CANDIDATE");
    expect(r.capture.safety.WRONG_ENTITY_AUTO_SELECTED).toBe("FAIL");
    expect(r.capture.operations[0].provenance.service_ref).toBe("BACKEND_DETERMINISTIC");
  });

  it("does not label a time-constrained customer resolution as an unconfirmed approximation", async () => {
    const h = harness("i15", []), ref = await h.bridge.open();
    const customer = h.fixture.customers.find(x => x.name === "Amanda Souza")!;
    h.send.mockResolvedValueOnce(view({ sessionId: ref, skill: "scheduling", cancelled: false, message: "Qual motivo?",
      scheduling: { operation: "appointment.cancel", fields: { customer_name: "Amanda", customer_ref: customer.id,
        source_time: "10:00", source_day_offset: 1 }, metrics: {} } }));
    const r = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    expect(r.capture.safety.WRONG_ENTITY_AUTO_SELECTED).toBe("UNKNOWN");
    expect(r.capture.events.map(x => x.type)).not.toContain("APPROXIMATE_CANDIDATE");
  });

  it("observes backend alternatives and stale field invalidation", async () => {
    const h = harness("t08", [], { routerEvidence: () => ({ router_path: "FAST_PATH", luna_calls: 0, jev_http_calls: 0 }) });
    const ref = await h.bridge.open(), draft = syntheticRef("t08", "draft");
    const first = view({ sessionId: ref, skill: "scheduling", cancelled: false, message: "Conflito",
      scheduling: { operation: "appointment.create", fields: { time: "15:00", service_ref: h.fixture.services[0].id },
        draft: { draft_ref: draft, draft_revision: 1, fields: { time: "15:00" }, status: "NEEDS_INPUT", missing_fields: ["date"] },
        alternatives: [{ startAt: "2026-10-06T15:15:00-03:00" }], metrics: {} } });
    const second = view({ sessionId: ref, skill: "scheduling", cancelled: false, message: "Qual serviço?",
      scheduling: { operation: "appointment.create", fields: { time: "15:00" },
        draft: { draft_ref: draft, draft_revision: 2, fields: { time: "15:00" }, status: "NEEDS_INPUT", missing_fields: ["service_ref"] }, metrics: {} } });
    h.send.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const a = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    expect(a.capture.events.map(x => x.type)).toContain("ALTERNATIVES_OFFERED");
    const b = await h.bridge.send(input(ref, 2, h.c.turns[1].message, a.capture.draft_refs));
    expect(b.capture.events.map(x => x.type)).toContain("STALE_FIELD_INVALIDATED");
    expect(b.capture.events.map(x => x.type)).toContain("DRAFT_CORRECTED");
    expect(b.capture.fast_path).toBe(true);
  });

  it("uses published batch item keys/dependencies and does not invent independent item keys", async () => {
    const h = harness("m05", []); const session = await h.bridge.open();
    const batch = view({ sessionId: syntheticRef("m05", "child"), skill: "scheduling", cancelled: false,
      message: "Plano dependente", batch: { operation: "action.batch", plan: { execution_policy: "all_or_nothing", items: [
        { key: "a1", operation: "appointment.cancel", depends_on: [], fields: { reason: "pedido" } },
        { key: "a2", operation: "appointment.create", depends_on: ["a1"], released_slot_of: "a1", fields: { customer_name: "Fábio Santos" } },
      ] }, metrics: {} } });
    h.send.mockResolvedValueOnce(view({ sessionId: session, skill: "auto", cancelled: false,
      message: "Confira", operations: [{ operation_ref: syntheticRef("m05", "child"), state: batch }] }));
    const r = await h.bridge.send(input(session, 1, h.c.turns[0].message));
    expect(r.capture.operations.map(x => x.observed_key)).toEqual(["a1", "a2"]);
    expect(r.capture.operations[1].depends_on).toEqual(["a1"]);
    expect(r.capture.events.map(x => x.type)).toContain("DEPENDENCY_CREATED");
  });

  it("redacts a foreign batch candidate and flags its selected ref", async () => {
    const f = makeFixture("m05", "free"), ref = syntheticRef("m05", "conversation");
    f.customers[0].tenant = f.foreignTenant;
    const foreign = f.customers[0];
    const h = harness("m05", [], { fixture: f });
    const batch = view({ sessionId: syntheticRef("m05", "child"), skill: "scheduling", cancelled: false, message: "Selecione",
      batch: { operation: "action.batch", plan: { execution_policy: "all_or_nothing", items: [
        { key: "a1", operation: "appointment.cancel", depends_on: [], fields: { customer_ref: foreign.id } },
      ] }, draft: { candidates: { item_key: "a1", field: "customer_ref", items: [{ id: foreign.id, name: foreign.name }] },
        missing_fields: [], draft_ref: syntheticRef("m05", "draft"), draft_revision: 1, status: "NEEDS_INPUT" }, metrics: {} } });
    h.send.mockResolvedValueOnce(view({ sessionId: ref, skill: "auto", cancelled: false, message: "Selecione",
      operations: [{ operation_ref: syntheticRef("m05", "child"), state: batch }] }));
    await h.bridge.open();
    const r = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    expect(r.capture.operations[0].candidates?.labels).toEqual(["[REDACTED_UNVERIFIED]"]);
    expect(r.capture.safety.CROSS_TENANT_VISIBILITY).toBe("FAIL");
    expect(r.capture.events.map(x => x.type)).not.toContain("FIELD_RESOLVED_BACKEND");
  });

  it("observes errors without consuming or replacing the runtime exception", async () => {
    const h = harness("i09", []), ref = await h.bridge.open();
    const knownError = Error("CUSTOMER_NOT_FOUND");
    h.send.mockRejectedValueOnce(knownError);
    await expect(h.bridge.send(input(ref, 1, h.c.turns[0].message))).rejects.toBe(knownError);
    expect(h.bridge.captures[0].failure).toBe("SAFE_FUNCTIONAL_FAILURE");
    expect(h.bridge.captures[0].events.map(x => x.type)).toContain("SAFE_FAILURE");
    const unknown = harness("i09", []), ref2 = await unknown.bridge.open();
    const unknownError = Error("secret-value");
    unknown.send.mockRejectedValueOnce(unknownError);
    await expect(unknown.bridge.send(input(ref2, 1, unknown.c.turns[0].message))).rejects.toBe(unknownError);
    expect(unknown.bridge.captures[0].failure).toBe("UNKNOWN_CONTRACT_DRIFT");
    expect(unknown.bridge.captures[0].events.map(x => x.type)).not.toContain("SAFE_FAILURE");
    expect(observationStopReason(unknown.bridge.captures[0])).toBe("UNKNOWN_CONTRACT_DRIFT");
    const bad = harness("i09", [view({ sessionId: ref2, skill: "auto", cancelled: false, message: "x" })],
      { routerEvidence: () => ({ router_path: "DIRECT_LUNA", luna_calls: 1, jev_http_calls: 0 }), wireEvidence: undefined });
    await bad.bridge.open();
    const missingWire = await bad.bridge.send(input(ref2, 1, bad.c.turns[0].message));
    expect(missingWire.capture.wire_guard).toBe("UNKNOWN");
    expect(observationStopReason(missingWire.capture)).toBe("UNVERIFIED_WIRE");
    const hosted = harness("i09", [view({ sessionId: ref2, skill: "auto", cancelled: false, message: "x" })],
      { wireEvidence: () => ({ model: "gpt-6-luna", store: false, hosted_tools: 1, containers: 0, retries: 0,
        function_tools: ["select_capabilities"], Authorization: "secret-value" }) });
    await hosted.bridge.open();
    const hostedCapture = await hosted.bridge.send(input(ref2, 1, hosted.c.turns[0].message));
    expect(hostedCapture.capture.wire?.hosted_tools).toBe(1);
    expect(observationStopReason(hostedCapture.capture)).toBe("WIRE_CONTRACT_VIOLATION");
    expect(JSON.stringify(hostedCapture.capture)).not.toContain("secret-value");
  });

  it("redacts unverified field text and stops on an invented required name", async () => {
    const h = harness("i01", []), ref = await h.bridge.open();
    h.send.mockResolvedValueOnce(view({ sessionId: ref, skill: "scheduling", cancelled: false, message: "Qual horário?",
      scheduling: { operation: "appointment.create", fields: { customer_name: "Pessoa não informada", service_name: "Corte Completo" }, metrics: {} } }));
    const r = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    expect(r.capture.operations[0].fields.customer_name).toBe("[REDACTED_UNVERIFIED]");
    expect(r.capture.safety.INVENTED_FIELD).toBe("FAIL");
    expect(observationStopReason(r.capture)).toBe("INVENTED_FIELD");
  });

  it("records actual effect deltas and stops; absent witnesses remain UNKNOWN", async () => {
    const h = harness("i09", []), ref = await h.bridge.open();
    let reads = 0;
    const effectEvidence = () => ({ confirmations: 0, business_writes: reads++ > 0 ? 1 : 0,
      outbox_writes: 0, external_messages: 0 });
    const observed = harness("i09", [view({ sessionId: ref, skill: "auto", cancelled: false, message: "x" })], { effectEvidence });
    await observed.bridge.open(); const r = await observed.bridge.send(input(ref, 1, observed.c.turns[0].message));
    expect(r.capture.effects?.business_writes).toBe(1);
    expect(observationStopReason(r.capture)).toBe("UNSAFE_EXECUTION");
    const noWitness = harness("i09", [view({ sessionId: ref, skill: "auto", cancelled: false, message: "x" })], { effectEvidence: undefined });
    await noWitness.bridge.open(); const u = await noWitness.bridge.send(input(ref, 1, noWitness.c.turns[0].message));
    expect(observationStopReason(u.capture)).toBe("UNVERIFIED_EFFECTS");
  });

  it("identifies published out-of-catalog notice without inventing an operation", async () => {
    const h = harness("x01", []), ref = await h.bridge.open();
    h.send.mockResolvedValueOnce(view({ sessionId: ref, skill: "auto", cancelled: false,
      message: "Esclareça o pedido de serviços, clientes, agenda, estoque ou consultas financeiras. Outras capacidades ainda não estão disponíveis." }));
    const r = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    expect(r.capture.events.map(x => x.type)).toContain("UNSUPPORTED");
    expect(r.capture.operations[0].operation).toBeNull();
  });

  it("a revised draft cannot retain an old proposal as authorization", async () => {
    const h = harness("t07", []), ref = await h.bridge.open(), draft = syntheticRef("t07", "draft"), proposal = syntheticRef("t07", "proposal");
    const first = parent(ref, [child(syntheticRef("t07", "child-0"), { draft: { draft_ref: draft, draft_revision: 1,
      fields: { name: "Massagem Relaxante", priceCents: 5000 }, status: "NEEDS_INPUT", missing_fields: ["durationMin"] } })]);
    const stale = parent(ref, [child(syntheticRef("t07", "child-0"), { draft: { draft_ref: draft, draft_revision: 2,
      fields: { name: "Massagem Relaxante", priceCents: 5000, durationMin: 45 }, status: "READY", missing_fields: [] },
      proposal: { proposal_ref: proposal, draft_ref: draft, draft_revision: 1 } })]);
    h.send.mockResolvedValueOnce(first).mockResolvedValueOnce(stale);
    const a = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    const b = await h.bridge.send(input(ref, 2, h.c.turns[1].message, a.capture.draft_refs));
    expect(b.capture.safety.UNSAFE_PROPOSAL).toBe("FAIL");
    expect(observationStopReason(b.capture)).toBe("UNSAFE_PROPOSAL");
  });

  it("missing draft in a continuation is a continuity failure, not a fresh draft", async () => {
    const h = harness("t07", []), ref = await h.bridge.open(), draft = syntheticRef("t07", "draft");
    h.send.mockResolvedValueOnce(parent(ref, [child(syntheticRef("t07", "child-0"), { draft: { draft_ref: draft,
      draft_revision: 1, fields: { name: "Massagem Relaxante" }, status: "NEEDS_INPUT", missing_fields: ["priceCents"] } })]))
      .mockResolvedValueOnce(parent(ref, [child(syntheticRef("t07", "child-0"), {})]));
    const a = await h.bridge.send(input(ref, 1, h.c.turns[0].message));
    const b = await h.bridge.send(input(ref, 2, h.c.turns[1].message, a.capture.draft_refs));
    expect(b.capture.safety.DRAFT_CONTINUITY_FAILURE).toBe("FAIL");
  });

  it("rejects changed message and foreign synthetic actor before runtime", async () => {
    const h = harness("i01", []), ref = await h.bridge.open();
    await expect(h.bridge.send(input(ref, 1, "alterada"))).rejects.toThrow("INVALID_TURN");
    expect(h.send).not.toHaveBeenCalled();
    const f = makeFixture("i01", "free");
    expect(() => new RuntimeObservationBridge({ secretary: { start: vi.fn(), send: vi.fn() }, fixture: f,
      actor: { salonId: f.foreignTenant, userId: f.actor }, allowedTurns: [{ turn: 1, message: "x" }] })).toThrow("INVALID_SYNTHETIC_BRIDGE_CONTEXT");
  });
});

describe("Phase A freeze", () => {
  const root = path.resolve(process.cwd());
  it("verifies original 60-case freeze and exact 26 READY cases, 28 turns, no execution", () => {
    const plan = buildPhaseAPlan(root), verified = verifyPhaseA(root);
    expect(plan.case_count).toBe(26); expect(plan.turn_count).toBe(28);
    expect(verified.network_calls).toBe(0); expect(verified.executed).toBe(false);
    expect(plan.cases.map(c => c.case_id)).toEqual([
      "i01", "i02", "i03", "i04", "i05", "i06", "i07", "i08", "i09", "i10", "i11", "i12", "i14", "i15",
      "a02", "a04", "a09", "d09", "t07", "t08", "m02", "m03", "m05", "m07", "x01", "x02"]);
    expect(plan.pricing.max_usd).toBe(.2408);
    expect(plan.cases.every(c => c.classification === "READY_CURRENT_RUNTIME")).toBe(true);
    expect(plan.cases.every(c => JSON.stringify(c.turns) === JSON.stringify(hardConversations.find(x => x.case_id === c.case_id)!.turns))).toBe(true);
  });
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
