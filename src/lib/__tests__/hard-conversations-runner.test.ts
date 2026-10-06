import { describe, expect, it, vi } from "vitest";
import { hardConversations } from "../../../packages/salon-secretary/evaluation/hard-conversations";
import { verifyFrozen, preflight, classify, auditCase, dependencySupport, HARD_MANIFEST_SHA256 } from "../../../packages/salon-secretary/evaluation/hard-conversations-preflight";
import { makeFixture, available, candidates, validateFixture, fixtureDigest, syntheticRef } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
import { runOfflineConversations, structuralPort, emptyObservation, stopReason, InferenceBudget, assertPayloadSeparation, scoreFinalDecomposition, validateFutureWire,
  type OfflineConversationPort, type TurnInput } from "../../../packages/salon-secretary/evaluation/hard-conversations-runner";
import { validateSelection } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
const root = process.cwd();
const get = (id: string) => hardConversations.find(c => c.case_id === id)!;
const input: TurnInput = { conversation_ref: "local-conversation", draft_refs: {}, turn_index: 1, message: "Mensagem sintética" };

describe("frozen manifest and complete structural dry-run, not simulated quality", () => {
  it("verifies original SHA and all predecessors; counts 60/77", () => {
    expect(verifyFrozen(root).cases).toEqual(hardConversations);
    const p = preflight(root);
    expect(p.manifest_sha256).toBe(HARD_MANIFEST_SHA256);
    expect(p.cases_validated).toBe(60); expect(p.turns_validated).toBe(77);
    expect(p.counts).toEqual({ READY_CURRENT_RUNTIME: 26, KNOWN_CAPABILITY_LIMIT: 3, DESIGN_TARGET_NOT_IMPLEMENTED: 31, INVALID_TEST_FIXTURE: 0 });
    expect(p.max_cost_usd_conditional).toBe(.6622);
    expect(p.functional_model_results).toBe("NOT_MEASURED");
  });
  it.each(hardConversations.map(c => [c.case_id, c] as const))("%s fixture, operations, expected, dependency, turns", (_, c) => {
    const row = auditCase(c);
    expect(row.fixture_errors).toEqual([]);
    expect(row.turn_count).toBe(c.turns.length);
    expect(row.operations.every(o => o.confirmation_allowed === false)).toBe(true);
    expect(row.turns.every(t => t.observation === "NOT_EXECUTED")).toBe(true);
  });
  it("invalid fixture dominates capability labels", () => expect(classify(get("m04"), ["BROKEN"])).toBe("INVALID_TEST_FIXTURE"));
  it("three/four actions supported by actual Registry; five rejected before inference", () => {
    const op = () => intent("service.create", { name: "Teste", priceCents: 1000, durationMin: 30 });
    expect(validateSelection(plan([op(), op(), op()])).operations).toHaveLength(3);
    expect(validateSelection(plan([op(), op(), op(), op()])).operations).toHaveLength(4);
    expect(() => validateSelection(plan([op(), op(), op(), op(), op()]))).toThrow();
    expect(["m04", "m10"].map(id => auditCase(get(id)).action_count)).toEqual([5, 5]);
  });
  it("dependent versus independent batches never silently generalized", () => {
    for (const id of ["m02", "m03", "m05", "m06", "m07", "m08"]) expect(dependencySupport(get(id))).toBe("SUPPORTED_CURRENTLY");
    for (const id of ["m09", "m10"]) expect(dependencySupport(get(id))).toBe("DESIGN_TARGET");
    expect(auditCase(get("m01")).linguistic_intent_count).toBe(3);
    expect(get("m01").expected.actions).toHaveLength(1); // do not invent unsupported operations
  });
});

describe("isolated synthetic fixture semantics", () => {
  it("fresh stable copies, tenant-scoped deterministic IDs and no foreign leakage", () => {
    const a = makeFixture("i01", "free"), b = makeFixture("i01", "free");
    expect(fixtureDigest(a)).toBe(fixtureDigest(b)); a.products[0].stock = 999;
    expect(b.products[0].stock).toBe(4);
    expect(makeFixture("i02", "free").tenant).not.toBe(b.tenant);
    const foreign = makeFixture("x03", "foreign");
    expect(candidates(foreign, "customers", "Alisson")).toEqual([]);
    expect(foreign.customers.some(c => c.name === "Alisson" && c.tenant === foreign.foreignTenant)).toBe(true);
  });
  it("unique approximation vs exact and ambiguous matches preserved", () => {
    const a = makeFixture("a01", "approximate");
    expect(candidates(a, "services", "corte").map(e => e.name)).toEqual(["Corte Completo"]);
    expect(auditCase(get("a01")).current_runtime_behavior).toBe("UNIQUE_CONTAINS_CAN_AUTO_SELECT");
    expect(candidates(makeFixture("a02", "many_cuts"), "services", "corte")).toHaveLength(3);
    const duplicate = makeFixture("i01", "free");
    duplicate.customers.push({ ...duplicate.customers[0], id: syntheticRef("i01", "second-alisson"), name: "Alisson Silva" });
    expect(candidates(duplicate, "customers", "Alisson")).toHaveLength(2);
    expect(validateFixture(duplicate)).toContain("ALISSON"); // test mutation, not manifest fixture change
  });
  it("occupied/duration/end-of-day/resource/eligibility checked by actual backend planner", () => {
    expect(available(makeFixture("d01", "occupied"), "Corte Completo", 600)).toBe(false);
    expect(available(makeFixture("d02", "insufficient_gap"), "Corte Completo", 600)).toBe(false);
    expect(available(makeFixture("d02", "insufficient_gap"), "Corte Completo", 660)).toBe(true);
    expect(available(makeFixture("d03", "free"), "Corte Completo", 1050)).toBe(false);
    expect(available(makeFixture("d04", "resource_busy"), "Progressiva", 900)).toBe(false);
    expect(available(makeFixture("d05", "professional_off"), "Progressiva", 900)).toBe(false);
    expect(available(makeFixture("d06", "free"), "Progressiva", 900, "Ana Lima")).toBe(false);
  });
  it("contact, stock shortage, missing customer, stale snapshot and dependent failure are explicit", () => {
    expect(makeFixture("d07", "free").products[0].stock).toBeLessThan(10);
    expect(makeFixture("d08", "missing_contact").customers.find(c => c.name === "Amanda Souza")!.contactEligible).toBe(false);
    expect(candidates(makeFixture("a06", "no_customer"), "customers", "Alisson")).toEqual([]);
    expect(makeFixture("d09", "changed_snapshot").fault).toBe("SNAPSHOT_CHANGED");
    expect(makeFixture("m06", "dependent_failure").fault).toBe("CANCELLATION_FAILED");
    expect(makeFixture("m08", "free").outbox).toEqual([]);
  });
});

describe("multi-turn coordinator and fail-closed collection", () => {
  it("dry-runs all 77 ordered turns, opens only 60 conversations, never gives expected to port", async () => {
    const messages: string[] = [], opened: string[] = [];
    const report = await runOfflineConversations(root, () => {
      const p = structuralPort();
      return { mode: "OFFLINE_MOCK", open: async f => { opened.push(f.caseId); return p.open(f); }, close: () => p.close(),
        send: async v => { expect(Object.keys(v).sort()).toEqual(["conversation_ref", "draft_refs", "message", "turn_index"]); messages.push(v.message); return p.send(v); } };
    });
    expect(report.stopped).toBeNull(); expect(report.records).toHaveLength(77); expect(opened).toHaveLength(60);
    expect(messages).toEqual(hardConversations.flatMap(c => c.turns.map(t => t.message)));
    expect(new Set(report.records.filter(r => r.case_id === "t01").map(r => r.conversation_ref)).size).toBe(1);
    expect(report.records.every(r => r.status === "STRUCTURAL_ONLY")).toBe(true);
    expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");
    expect(process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED).toBe("false");
  }, 30000);
  it("preserves returned draft refs, correction does not manufacture new operation, detects replacement", async () => {
    const seen: TurnInput[] = [];
    const result = await runOfflineConversations(root, () => {
      const p = structuralPort();
      return { ...p, send: async v => {
        seen.push(v); const o = emptyObservation(v);
        o.draft_refs = { a1: v.turn_index > 2 ? "wrong-new-draft" : "original-draft" };
        return o;
      } };
    });
    expect(result.stopped).toBe("DRAFT_CONTINUITY");
    expect(result.records.at(-1)).toMatchObject({ case_id: "t01", turn_index: 3 });
    expect(seen.find(v => v.turn_index === 2)!.draft_refs).toEqual({ a1: "original-draft" });
  }, 30000);
  it.each([
    ["INVENTED_CRITICAL_FIELD", { invented_critical_fields: ["time"] }],
    ["WRONG_ENTITY_AUTO_SELECTED", { wrong_entity_auto_selected: true }],
    ["UNSAFE_PROPOSAL", { unsafe_proposal: true }],
    ["UNSAFE_EFFECT", { execution_attempted: true }],
    ["CROSS_TENANT", { cross_tenant_visibility: true }],
    ["DEPENDENCY_IGNORED", { dependency_ignored: true }],
    ["PAYLOAD_LEAK", { payload_leak: true }],
    ["PROVIDER_ERROR_OR_TIMEOUT", { error: "PROVIDER_ERROR_OR_TIMEOUT" as const }],
  ])("immediate STOP for %s, not a safe failure", (reason, change) => {
    expect(stopReason({ ...emptyObservation(input), ...change })).toBe(reason);
  });
  it("unknown shape/store/hosted drift stops at first case without retry", async () => {
    const send = vi.fn(async () => ({ ...emptyObservation(input), store: true, hosted_tools: 1 }));
    const r = await runOfflineConversations(root, () => ({ mode: "OFFLINE_MOCK", open: async () => ({ conversation_ref: "c" }), close: async () => {}, send }));
    expect(r.stopped).toBe("UNKNOWN_CONTRACT_DRIFT"); expect(send).toHaveBeenCalledTimes(1);
  });
  it("safe unsupported/capability failures can continue; missing observed metrics are not successes", () => {
    for (const failure of ["KNOWN_CAPABILITY_LIMIT", "DESIGN_TARGET_NOT_IMPLEMENTED", "SAFE_FUNCTIONAL_FAILURE"] as const) {
      const o = { ...emptyObservation(input), safe_failure: failure };
      expect(stopReason(o)).toBeNull(); expect(scoreFinalDecomposition(get("i01"), o)).toBeNull();
    }
  });
  it("payload separation rejects expected and internal IDs before dispatch", () => {
    const f = makeFixture("i01", "free");
    expect(() => assertPayloadSeparation({ ...input, expected: "a1" } as TurnInput, f)).toThrow("PAYLOAD_LEAK");
    expect(() => assertPayloadSeparation({ ...input, message: f.customers[0].id }, f)).toThrow("PAYLOAD_LEAK");
  });
  it("never admits a provider/live port", async () => {
    await expect(runOfflineConversations(root, () => ({ ...structuralPort(), mode: "REAL" } as unknown as OfflineConversationPort))).rejects.toThrow("NOT_AUTHORIZED");
  });
  it("77 calls reserve worst-case cache write, failed calls do not release reservation", () => {
    const b = new InferenceBudget();
    for (let i = 0; i < 77; i++) b.reserve(64000, 1200);
    expect(b.reservedUsd).toBe(.6622); expect(() => b.reserve(1, 1)).toThrow("BUDGET");
    expect(() => new InferenceBudget().reserve(64001, 1200)).toThrow("BUDGET");
    expect(() => new InferenceBudget().reserve(64000, 1201)).toThrow("BUDGET");
    expect(() => new InferenceBudget().reserve(NaN, 1200)).toThrow("BUDGET");
  });
  it("future wire accepts exactly local function / false store; hosted/container/drift/PII/expected stop before reservation", () => {
    const payload = { model: "gpt-6-luna", store: false, stream: false, parallel_tool_calls: false, include: [], instructions: "Synthetic approved instructions",
      input: [{ role: "user", content: "Agenda Alisson amanhã." }], max_output_tokens: 1200,
      tool_choice: { type: "function", name: "select_capabilities" }, tools: [{ type: "function", name: "select_capabilities", parameters: { type: "object" }, strict: true }] };
    expect(validateFutureWire(JSON.stringify(payload), new InferenceBudget(), ["private-expected"])).toMatchObject({ store: false, hosted_tools: 0, containers: 0 });
    for (const change of [{ store: true }, { container: "auto" }, { tools: [{ type: "web_search" }] }, { model: "gpt-5.6-luna" }, { max_output_tokens: 1201 },
      { input: [{ role: "user", content: "private-expected" }] }, { input: [{ role: "user", content: "11999990011" }] },
      { input: [{ role: "user", content: syntheticRef("i01", "customer") }] }]) {
      const budget = new InferenceBudget();
      expect(() => validateFutureWire(JSON.stringify({ ...payload, ...change }), budget, ["private-expected"])).toThrow();
      expect(budget.calls).toBe(0);
    }
  });
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
