/** Runtime turn-outcome telemetry (rec 3): codes/counts only, inside the single SECRETARY_ROUTER row.
 * All I/O is mocked (same doubles as secretary-action-plan-runtime.test.ts); no network, no real Luna. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Duplicate-service guard (owner, 04/10/2026; its own tests: secretary-existing-service.test.ts): these scenarios have no service
// catalog, so the guard passes the interpretation through and the flow is exactly the one this file covered before.
vi.mock("../secretary-existing-service", async original => ({ ...await original<object>(), withExistingServiceTargets: async (_actor: unknown, selection: unknown) => selection,
  existingServiceInterpretation: async (_actor: unknown, interpretation: unknown) => interpretation }));
const db = vi.hoisted(() => ({ role: "OWNER", auditLog: { create: vi.fn() }, $queryRaw: vi.fn(),
  upsert: vi.fn(), propose: vi.fn(), confirm: vi.fn(), drafts: new Map<string, Record<string, unknown>>() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(),
  upsertActionDraft: db.upsert, proposeServiceCreate: db.propose, confirmServiceCreate: db.confirm }));
import { SalonSecretary } from "../salon-secretary";
import { RouterTrace, outcomeCode, outcomeField, type TurnOutcome } from "../secretary-router";
import { droppedFields } from "../secretary-turn-outcome";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import type { Model } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-outcome-salon", userId: "synthetic-outcome-owner" };
// Distinctive fixture words: none of them may ever reach the outcome.
const names = ["Hidratação Marroquina Priscila", "Escova Progressiva Valdirene", "Cauterização Gertrudes"];
const words = ["Cadastre", "hidratação", "marroquina", "Priscila", "Valdirene", "Gertrudes", "decidindo", "Quanto", "faturei"];
const services = (n: number) => Array.from({ length: n }, (_, i) => intent("service.create", { item_key: `a${i}`,
  name: names[i], durationMin: 30, priceCents: 5000, depends_on: [] }));
const rows = () => db.auditLog.create.mock.calls.map(c => c[0].data).filter(d => d.entityType === "SECRETARY_ROUTER");
const outcome = (i: number) => rows()[i].metadata.outcome as TurnOutcome;
function secretary(outputs: ReturnType<typeof call>[], factory?: () => Promise<Model>) {
  const model = new ScriptedServicesModel(outputs), jev = vi.fn<typeof fetch>(() => { throw Error("JEV_FORBIDDEN"); });
  const s = new SalonSecretary(factory ?? (async () => model), () => "gpt-6-luna", undefined,
    { enabled: () => true, paidCallsAllowed: () => false, transport: jev }, { enabled: () => true });
  return { s, model, jev };
}
function assertCodesOnly(value: unknown) {
  const json = JSON.stringify(value);
  for (const word of [...words, ...names, ...names.flatMap(name => name.split(" "))]) expect(json.toLowerCase()).not.toContain(word.toLowerCase());
  expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); // no refs/session ids
  expect(json).not.toMatch(/"a[0-9]"/); // no item keys
}
beforeEach(() => {
  vi.clearAllMocks(); db.drafts.clear(); db.role = "OWNER";
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: db.role }];
    if (sql.includes("WITH ranges")) return [{ label: "current", revenue: 12000n, count: 2n, products: 0n, product_invalid: 0n,
      received: 0n, payment_count: 0n, payment_invalid: 0n, receivable: 0n, unpaid_count: 0n, unpaid_invalid: 0n, snapshot_invalid: 0n, groups: [] }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  db.upsert.mockImplementation(async (_tx, _actor, input) => {
    const draft_ref = input.draft_ref ?? crypto.randomUUID();
    const fields = { ...db.drafts.get(draft_ref), ...input.patch }; db.drafts.set(draft_ref, fields);
    const missing_fields = ["name", "priceCents", "durationMin"].filter(key => fields[key] === undefined);
    return { draft_ref, draft_revision: (input.expected_revision ?? 0) + 1, fields,
      status: missing_fields.length ? "NEEDS_INPUT" : "READY", missing_fields };
  });
  db.propose.mockImplementation(async (_tx, _actor, input) => ({ ...input, proposal_ref: crypto.randomUUID(), payload_hash: "backend-hash",
    preview: JSON.stringify(db.drafts.get(input.draft_ref)), expires_at: new Date(Date.now() + 60_000).toISOString() }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("turn outcome inside the existing router row", () => {
  it("PROPOSAL_READY: counts groups and Luna×plan operations, one row, schema_version 2", async () => {
    const { s, jev } = secretary([call("select_capabilities", plan(services(2)))]), session = await s.start(actor, "auto");
    const view = await s.send(actor, { sessionId: session.sessionId, message: `Cadastre ${names[0]} e ${names[1]}.` });
    expect(view.action_plan!.status).toBe("READY_FOR_CONFIRMATION");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].metadata).toMatchObject({ schema_version: 2, router_path: "DIRECT_LUNA", luna_calls: 1 });
    // B2: one confirmation group per independent action (runtime default), so two ready groups.
    expect(outcome(0)).toEqual({ kind: "PROPOSAL_READY", groups_ready: 2, groups_total: 2, open_question_fields: [], question_fingerprints: [],
      repeated_question_count: 0, divergence: { luna_operations: 2, plan_actions: 2, dropped_fields: [], failed_codes: [] }, repairs: 0, error_code: null,
      // C6 (rec 19): the model contract of this message is stamped on the outcome (sha256 hex only).
      contract_version: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(jev).not.toHaveBeenCalled(); assertCodesOnly(rows()[0].metadata);
  });

  it("QUESTION: the same unanswered question is counted as a repeat on the next turn, then cleared", async () => {
    const ops = services(3); ops[1].durationMin = null;
    const { s, model } = secretary([call("select_capabilities", plan(ops)),
      call("upsert_action_draft", { name: null, priceCents: null, durationMin: null })]);
    const session = await s.start(actor, "auto");
    const first = await s.send(actor, { sessionId: session.sessionId, message: `Cadastre ${names.join(", ")}.` });
    expect(first.action_plan!.actions[1].missing_fields).toEqual(["durationMin"]);
    // B2: the two complete services are their own ready groups while the third asks.
    expect(outcome(0)).toMatchObject({ kind: "QUESTION", groups_ready: 2, groups_total: 3, open_question_fields: ["duration"], repeated_question_count: 0,
      divergence: { luna_operations: 3, plan_actions: 3 } });
    expect(outcome(0).question_fingerprints).toHaveLength(1);
    expect(outcome(0).question_fingerprints[0]).toMatch(/^[0-9a-f]{64}$/);
    // Adapter's own Luna turn returns nothing usable: the backend asks the very same question again.
    await s.send(actor, { sessionId: session.sessionId, message: "Ainda estou decidindo." });
    expect(model.requests).toHaveLength(2); expect(rows()).toHaveLength(2); // nested child send: still one row per message
    expect(outcome(1)).toMatchObject({ kind: "QUESTION", open_question_fields: ["duration"], repeated_question_count: 1,
      question_fingerprints: outcome(0).question_fingerprints, divergence: { luna_operations: 1, plan_actions: 0, dropped_fields: [], failed_codes: [] } });
    const done = await s.send(actor, { sessionId: session.sessionId, message: "45 minutos" }); // fast path, zero AI
    expect(done.action_plan!.status).toBe("READY_FOR_CONFIRMATION");
    expect(outcome(2)).toMatchObject({ kind: "PROPOSAL_READY", groups_ready: 3, question_fingerprints: [], repeated_question_count: 0,
      divergence: { luna_operations: 1, plan_actions: 1 } });
    expect(rows()[2].metadata.router_path).toBe("FAST_PATH");
    for (const row of rows()) assertCodesOnly(row.metadata);
  });

  it("multi-action: answering one action's question does not count the siblings' still-open questions as a loop", async () => {
    const ops = services(3); ops[0].durationMin = null; ops[2].durationMin = null;
    const answered = intent("service.create", { item_key: "a0", name: names[0], durationMin: 40, priceCents: 5000, depends_on: [] });
    const { s, model } = secretary([call("select_capabilities", plan(ops)), call("select_capabilities", plan([answered]))]);
    const session = await s.start(actor, "auto");
    await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os três." });
    expect(outcome(0)).toMatchObject({ kind: "QUESTION", repeated_question_count: 0 });
    expect(outcome(0).question_fingerprints).toHaveLength(2);
    const view = await s.send(actor, { sessionId: session.sessionId, message: "A primeira com 40 minutos." });
    expect(model.requests).toHaveLength(2);
    expect(view.action_plan!.actions.map(a => a.missing_fields)).toEqual([[], [], ["durationMin"]]);
    const second = outcome(1);
    expect(second).toMatchObject({ kind: "QUESTION", open_question_fields: ["duration"] });
    // The sibling's question is shown again verbatim (same fingerprint), but this turn moved an action: no loop.
    expect(second.question_fingerprints.filter(f => outcome(0).question_fingerprints.includes(f))).toHaveLength(1);
    expect(second.divergence.plan_actions).toBeGreaterThan(0);
    expect(second.repeated_question_count).toBe(0);
    assertCodesOnly(rows()[1].metadata);
  });

  it("fingerprints are per-session keyed: the same question in another session does not match", async () => {
    const ops = services(2); ops[0].durationMin = null;
    const a = secretary([call("select_capabilities", plan(ops))]), b = secretary([call("select_capabilities", plan(ops))]);
    const sa = await a.s.start(actor, "auto"), sb = await b.s.start(actor, "auto");
    await a.s.send(actor, { sessionId: sa.sessionId, message: "Cadastre os dois." });
    await b.s.send(actor, { sessionId: sb.sessionId, message: "Cadastre os dois." });
    expect(outcome(0).open_question_fields).toEqual(outcome(1).open_question_fields);
    expect(outcome(0).question_fingerprints[0]).not.toBe(outcome(1).question_fingerprints[0]);
  });

  // B5 contract migration (partial acceptance): this interpretation is unreadable (schema), so the existing
  // plan is kept and the turn is NOT_UNDERSTOOD (was LOST_TURN, thrown, every open unit FAILED_SAFE).
  it("LOST_TURN → NOT_UNDERSTOOD: an unreadable interpretation on an existing plan is classified, keeps the plan and the last question", async () => {
    const ops = services(3); ops[0].durationMin = null; ops[2].durationMin = null;
    // Second turn: Luna answers the combined continuation with an envelope the backend rejects.
    const { s, model } = secretary([call("select_capabilities", plan(ops)),
      call("select_capabilities", { skills: ["services"], independent: true, operations: [{ operation: "service.create", item_key: "a0", durationMin: `quarenta minutos ${names[2]}` }] })]);
    const session = await s.start(actor, "auto");
    const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os três." });
    expect(outcome(0)).toMatchObject({ kind: "QUESTION", open_question_fields: ["duration"] });
    expect(outcome(0).question_fingerprints).toHaveLength(2);
    const kept = await s.send(actor, { sessionId: session.sessionId, message: `${names[2]} com 40 minutos.` });
    expect(kept.message).toBe("Não entendi essa parte; o pedido foi preservado. Pode repetir de outro jeito?");
    expect(kept.action_plan!.actions.map(a => a.status)).toEqual(first.action_plan!.actions.map(a => a.status));
    expect(model.requests).toHaveLength(2); expect(rows()).toHaveLength(2);
    const lost = outcome(1);
    expect(lost).toMatchObject({ kind: "NOT_UNDERSTOOD", open_question_fields: [], question_fingerprints: [], repeated_question_count: 0 });
    // The schema rejection is reported by its error class, never by its (value-bearing) message.
    expect(lost.error_code).toBeNull(); expect(rows()[1].metadata.luna_calls).toBe(1);
    // Nothing was applied or failed: only the unread code; no action changed.
    expect(lost.divergence).toEqual({ luna_operations: 0, plan_actions: 0, dropped_fields: [], failed_codes: ["ZOD_ERROR"] });
    // No new question was shown, so the last question actually shown stays the repeat baseline.
    expect((s as any).sessions.get(session.sessionId).questionFingerprints).toEqual(outcome(0).question_fingerprints);
    assertCodesOnly(rows()[1].metadata);
  });

  it("ERROR: rejected before any interpretation (paid gate) carries the whitelisted code, no Luna call", async () => {
    const { s } = secretary([], async () => { throw Error("PAID_CALLS_DISABLED"); }), session = await s.start(actor, "auto");
    await expect(s.send(actor, { sessionId: session.sessionId, message: "Cadastre a hidratação." })).rejects.toThrow("PAID_CALLS_DISABLED");
    expect(outcome(0)).toMatchObject({ kind: "ERROR", error_code: "PAID_CALLS_DISABLED", divergence: { luna_operations: 0, plan_actions: 0 } });
    expect(rows()[0].metadata.luna_calls).toBe(0);
  });

  it("error text that is not a stable code is never persisted", async () => {
    const { s } = secretary([], async () => { throw Error(`provider rejected ${names[0]} for Priscila`); }), session = await s.start(actor, "auto");
    await expect(s.send(actor, { sessionId: session.sessionId, message: "Cadastre a hidratação." })).rejects.toThrow();
    expect(outcome(0)).toMatchObject({ kind: "ERROR", error_code: "UNCLASSIFIED_ERROR" });
    assertCodesOnly(rows()[0].metadata);
  });

  it("divergence: a field Luna supplied that the backend left missing is reported by name only", async () => {
    const { s } = secretary([call("select_capabilities", plan(services(1)))]), session = await s.start(actor, "auto");
    db.upsert.mockImplementationOnce(async (_tx, _actor, input) => {
      // The domain rejects the price literal: the draft keeps name/duration and asks for the price.
      const draft_ref = crypto.randomUUID(), { priceCents: _rejected, ...fields } = input.patch; void _rejected;
      db.drafts.set(draft_ref, fields);
      return { draft_ref, draft_revision: 1, fields, status: "NEEDS_INPUT", missing_fields: ["priceCents"] };
    });
    const view = await s.send(actor, { sessionId: session.sessionId, message: `Cadastre ${names[0]} por R$50.` });
    expect(view.action_plan!.actions[0].fields.priceCents).toBeNull();
    expect(outcome(0)).toMatchObject({ kind: "QUESTION", open_question_fields: ["price"],
      divergence: { luna_operations: 1, plan_actions: 1, dropped_fields: ["priceCents"], failed_codes: [] } });
    assertCodesOnly(rows()[0].metadata);
  });

  it.each([
    ["UNSUPPORTED", { skills: [], independent: true, operations: [], disposition: "UNSUPPORTED", unavailable_capability: "professional_management" }],
    ["CONVERSATION", { skills: [], independent: true, operations: [], disposition: "CONVERSATION", conversation_response: "Olá Priscila, posso ajudar." }],
    ["READ_RESULT", plan([intent("financial.report", { item_key: "fin", financial: { metrics: ["service_revenue"], period: "yesterday" } })])],
  ])("%s", async (kind, selection) => {
    const { s } = secretary([call("select_capabilities", selection)]), session = await s.start(actor, "auto");
    await s.send(actor, { sessionId: session.sessionId, message: "Quanto faturei ontem, Valdirene?" });
    expect(outcome(0).kind).toBe(kind);
    expect(outcome(0).divergence.luna_operations).toBe(kind === "READ_RESULT" ? 1 : 0);
    assertCodesOnly(rows()[0].metadata);
  });
});

describe("outcome boundary", () => {
  it("snapshot drops unknown field names, non-code strings and malformed fingerprints", () => {
    const trace = new RouterTrace();
    trace.outcome = { kind: "QUESTION", groups_ready: 1, groups_total: -3, open_question_fields: ["time", "cancel_priscila"],
      question_fingerprints: ["a".repeat(64), "Priscila"], repeated_question_count: 1.5,
      divergence: { luna_operations: 2, plan_actions: 1, dropped_fields: ["reason", "Valdirene"], failed_codes: ["SLOT_CONFLICT", "falhou com Priscila"] },
      repairs: 0, error_code: "boom Gertrudes" };
    expect(trace.snapshot().outcome).toEqual({ kind: "QUESTION", groups_ready: 1, groups_total: 0, open_question_fields: ["time", "other"],
      question_fingerprints: ["a".repeat(64)], repeated_question_count: 0,
      divergence: { luna_operations: 2, plan_actions: 1, dropped_fields: ["reason", "other"], failed_codes: ["SLOT_CONFLICT"] },
      repairs: 0, error_code: "UNCLASSIFIED_ERROR" });
    trace.outcome = { kind: "INVENTED" } as unknown as TurnOutcome;
    expect(trace.snapshot().outcome).toBeNull();
    expect(new RouterTrace().snapshot()).toMatchObject({ schema_version: 2, outcome: null });
  });
  it("closed field vocabulary and relative-date resolution", () => {
    expect(["reason", "time", "durationMin", "financial.period", "communication.content", "selection"].map(outcomeField))
      .toEqual(["reason", "time", "durationMin", "financial.period", "communication.content", "selection"]);
    expect(outcomeField("cancel_amanda")).toBe("other");
    expect([Error("SLOT_CONFLICT"), Error("falhou para Priscila"), new TypeError("x"), Object.assign(Error("y"), { name: "Priscila Error" }), "SLOT_CONFLICT"].map(outcomeCode))
      .toEqual(["SLOT_CONFLICT", "UNCLASSIFIED_ERROR", "TYPE_ERROR", "UNCLASSIFIED_ERROR", "UNCLASSIFIED_ERROR"]);
    expect(droppedFields({ item_key: "x", operation: "appointment.change", day_offset: 1, time: "10:00", reason: "cliente pediu", temporal_evidence: [{}],
      financial: { period: "yesterday", metrics: [] } }, { date: "2026-09-28", time: null, reason: "cliente pediu", financial: { period: null } }))
      .toEqual(["time", "financial.period"]);
  });
});
