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
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import type { ActionPlan } from "@everflair/salon-secretary";

/** B2 runtime: "confirm everything that is ready" through the authenticated backend path. All I/O mocked, no network. */
const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const services = (n: number) => Array.from({ length: n }, (_, i) => intent("service.create", { item_key: `a${i}`,
  name: `Serviço ${i}`, durationMin: 30, priceCents: 5000, depends_on: [] }));
const approvalOf = (p: ActionPlan, key: string) => { const group = p.confirmation_groups.find(item => item.action_keys.includes(key))!;
  return { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }; };
const ready = (p: ActionPlan) => p.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }));
const status = (view: SecretaryView) => view.action_plan!.actions.map(action => action.status);
/** Test-only access to the child session behind one action (the adapter's in-memory proposal). */
const child = (s: SalonSecretary, view: SecretaryView, key: string) =>
  (s as unknown as { sessions: Map<string, { proposal?: { proposal_ref: string; expires_at?: string } }> }).sessions.get(view.operations!.find(op => op.action_keys?.includes(key))!.operation_ref)!;
beforeEach(() => {
  vi.clearAllMocks(); db.drafts.clear(); db.role = "OWNER";
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: db.role }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  db.upsert.mockImplementation(async (_tx, _actor, input) => {
    const draft_ref = input.draft_ref ?? crypto.randomUUID();
    const fields = { ...db.drafts.get(draft_ref), ...input.patch }; db.drafts.set(draft_ref, fields);
    const missing_fields = ["name", "priceCents", "durationMin"].filter(key => fields[key] === undefined);
    return { draft_ref, draft_revision: (input.expected_revision ?? 0) + 1, fields, status: missing_fields.length ? "NEEDS_INPUT" : "READY", missing_fields };
  });
  db.propose.mockImplementation(async (_tx, _actor, input) => ({ ...input, proposal_ref: crypto.randomUUID(), payload_hash: "backend-hash",
    preview: JSON.stringify(db.drafts.get(input.draft_ref)), expires_at: new Date(Date.now() + 60_000).toISOString() }));
  db.confirm.mockImplementation(async (_tx, _actor, input) => ({ receipt_ref: crypto.randomUUID(), proposal_ref: input.proposal_ref, service: { name: "Serviço", id: "domain-id" } }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function prepared(operations = services(3), enabled = () => true) {
  const model = new ScriptedServicesModel([call("select_capabilities", plan(operations))]);
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, { enabled: () => false }, { enabled });
  const session = await s.start(actor, "auto");
  const view = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os serviços pedidos." });
  expect(model.requests).toHaveLength(1);
  return { s, id: session.sessionId, view };
}
const confirmedRefs = () => db.confirm.mock.calls.map(call => (call[2] as { proposal_ref: string }).proposal_ref);

describe("confirmReadyGroups: every ready group in one authenticated call", () => {
  it("per-component runtime default: all valid approvals execute every group, in execution order", async () => {
    const { s, id, view } = await prepared();
    expect(view.action_plan!.policy.grouping).toBe("component");
    expect(view.action_plan!.confirmation_groups.map(group => [group.action_keys, group.status])).toEqual(
      [[["a0"], "READY_FOR_CONFIRMATION"], [["a1"], "READY_FOR_CONFIRMATION"], [["a2"], "READY_FOR_CONFIRMATION"]]);
    const refs = ["a0", "a1", "a2"].map(key => child(s, view, key).proposal!.proposal_ref);
    const done = await s.confirmReadyGroups(actor, id, [...ready(view.action_plan!)].reverse());
    expect(status(done)).toEqual(["DONE", "DONE", "DONE"]); expect(done.action_plan!.status).toBe("DONE");
    expect(confirmedRefs()).toEqual(refs); // execution order, whatever the order of the approvals
    expect(done.confirmation_batch).toEqual({ executed: ["group_1", "group_2", "group_3"], replayed: [], not_executed: [] });
    expect(done.operations!.every(op => op.state.receipt)).toBe(true);
  });

  it("one stale approval executes nothing; the untouched plan still confirms with current approvals", async () => {
    const { s, id, view } = await prepared(), p = view.action_plan!, valid = ready(p);
    const tampered = [
      [valid[0], { ...valid[1], fingerprint: "0".repeat(64) }, valid[2]],
      [valid[0], { ...valid[1], revision: p.revision + 1 }],
      [valid[0], { ...valid[1], group_key: "group_9" }],
      [valid[0], { ...valid[1], plan_ref: crypto.randomUUID() }],
    ];
    for (const approvals of tampered) await expect(s.confirmReadyGroups(actor, id, approvals)).rejects.toThrow("CONFIRMATION_STALE");
    for (const invalid of [[], [valid[0], valid[0]], [{ ...valid[0], extra: true }], "all", null])
      await expect(s.confirmReadyGroups(actor, id, invalid)).rejects.toThrow("CONFIRMATION_BATCH_INVALID");
    expect(db.confirm).not.toHaveBeenCalled();
    const done = await s.confirmReadyGroups(actor, id, valid);
    expect(status(done)).toEqual(["DONE", "DONE", "DONE"]); expect(db.confirm).toHaveBeenCalledTimes(3);
  });

  it("an approval for a group that is not ready rejects the whole request; partial confirmation needs explicit per-group approvals", async () => {
    db.upsert.mockRejectedValueOnce(Error("SLOT_CONFLICT"));
    const { s, id, view } = await prepared(services(4)), p = view.action_plan!;
    expect(status(view)).toEqual(["DOMAIN_CONFLICT", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
    expect(p.confirmation_groups.map(group => group.status)).toEqual(["NEEDS_REVIEW", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
    await expect(s.confirmActionPlanGroup(actor, id, approvalOf(p, "a0"))).rejects.toThrow("PLAN_NOT_READY");
    await expect(s.confirmReadyGroups(actor, id, [approvalOf(p, "a0"), ...ready(p)])).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.confirm).not.toHaveBeenCalled();
    const done = await s.confirmReadyGroups(actor, id, ready(p));
    expect(status(done)).toEqual(["DOMAIN_CONFLICT", "DONE", "DONE", "DONE"]); expect(db.confirm).toHaveBeenCalledTimes(3);
    expect(done.confirmation_batch!.executed).toEqual(["group_2", "group_3", "group_4"]);
  });

  it("a group whose proposal changed after an earlier group executed is not executed, is reported and must be approved again", async () => {
    const { s, id, view } = await prepared(services(2)), p = view.action_plan!;
    const replaced = crypto.randomUUID(), second = child(s, view, "a1");
    db.confirm.mockImplementationOnce(async (_tx, _actor, input) => {
      second.proposal = { ...second.proposal!, proposal_ref: replaced }; // the second group's live proposal changes meanwhile
      return { receipt_ref: crypto.randomUUID(), proposal_ref: input.proposal_ref, service: { name: "Serviço", id: "domain-id" } };
    });
    const partial = await s.confirmReadyGroups(actor, id, ready(p));
    expect(db.confirm).toHaveBeenCalledTimes(1);
    expect(status(partial)).toEqual(["DONE", "READY_FOR_CONFIRMATION"]);
    expect(partial.confirmation_batch).toEqual({ executed: ["group_1"], replayed: [], not_executed: [{ group_key: "group_2", code: "GROUP_CHANGED" }] });
    // Re-assessed from the live child: new token, new revision; the old approval can never execute the new proposal.
    expect(partial.action_plan!.revision).toBeGreaterThan(p.revision);
    expect(partial.action_plan!.actions[1].assessment.proposal_token).toContain(replaced);
    await expect(s.confirmActionPlanGroup(actor, id, approvalOf(p, "a1"))).rejects.toThrow("CONFIRMATION_STALE");
    // The exact request replays its recorded outcome instead of failing as stale.
    expect((await s.confirmReadyGroups(actor, id, ready(p))).confirmation_batch).toEqual(partial.confirmation_batch);
    expect(db.confirm).toHaveBeenCalledTimes(1);
    const done = await s.confirmReadyGroups(actor, id, ready(partial.action_plan!));
    expect(status(done)).toEqual(["DONE", "DONE"]); expect(confirmedRefs()[1]).toBe(replaced);
  });

  it("replay is idempotent: the same request, a receipted single group and a mixed request add no second effect", async () => {
    const { s, id, view } = await prepared(), p = view.action_plan!;
    const first = await s.confirmReadyGroups(actor, id, ready(p).slice(0, 2));
    expect(db.confirm).toHaveBeenCalledTimes(2);
    const again = await s.confirmReadyGroups(actor, id, ready(p).slice(0, 2));
    expect(again.confirmation_batch).toEqual(first.confirmation_batch); expect(db.confirm).toHaveBeenCalledTimes(2);
    await s.confirmActionPlanGroup(actor, id, approvalOf(p, "a0")); // receipted by the batch
    expect(db.confirm).toHaveBeenCalledTimes(2);
    const mixed = await s.confirmReadyGroups(actor, id, [approvalOf(p, "a2"), approvalOf(p, "a1")]);
    expect(mixed.confirmation_batch).toEqual({ executed: ["group_3"], replayed: ["group_2"], not_executed: [] });
    expect(db.confirm).toHaveBeenCalledTimes(3); expect(status(mixed)).toEqual(["DONE", "DONE", "DONE"]);
    const onlyReceipted = await s.confirmReadyGroups(actor, id, [approvalOf(p, "a0")]);
    expect(onlyReceipted.confirmation_batch).toEqual({ executed: [], replayed: ["group_1"], not_executed: [] });
    expect(db.confirm).toHaveBeenCalledTimes(3);
  });

  it("an expired proposal fails only its own group before any executor; the other group executes", async () => {
    const { s, id, view } = await prepared(services(2)), p = view.action_plan!, secondRef = child(s, view, "a1").proposal!.proposal_ref;
    child(s, view, "a0").proposal!.expires_at = new Date(Date.now() - 1_000).toISOString();
    const result = await s.confirmReadyGroups(actor, id, ready(p));
    expect(status(result)).toEqual(["FAILED_SAFE", "DONE"]);
    expect(result.action_plan!.actions[0].assessment.issue).toBe("PROPOSAL_EXPIRED");
    expect(result.confirmation_batch).toEqual({ executed: ["group_2"], replayed: [], not_executed: [{ group_key: "group_1", code: "PROPOSAL_EXPIRED" }] });
    expect(confirmedRefs()).toEqual([secondRef]);
    expect(result.operations![0].state.receipt).toBeUndefined();
  });

  it("dependent groups keep their order and a failed parent still blocks its child", async () => {
    const ops = services(3); Object.assign(ops[1], { depends_on: ["a0"] });
    const model = new ScriptedServicesModel([call("select_capabilities", { ...plan(ops), independent: false })]);
    const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, { enabled: () => false }, { enabled: () => true });
    const session = await s.start(actor, "auto"), view = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre em ordem." });
    expect(view.action_plan!.confirmation_groups.map(group => group.action_keys)).toEqual([["a0", "a1"], ["a2"]]);
    db.confirm.mockRejectedValueOnce(Error("SLOT_CONFLICT"));
    const done = await s.confirmReadyGroups(actor, session.sessionId, ready(view.action_plan!));
    expect(status(done)).toEqual(["FAILED_SAFE", "BLOCKED_BY_DEPENDENCY", "DONE"]); expect(db.confirm).toHaveBeenCalledTimes(2);
  });

  it("SALON_SECRETARY_CONFIRMATION_GROUPING=packed restores one packed group, still confirmable through the same call", async () => {
    vi.stubEnv("SALON_SECRETARY_CONFIRMATION_GROUPING", "packed");
    const { s, id, view } = await prepared();
    expect(view.action_plan!.policy.grouping).toBe("packed");
    expect(view.action_plan!.confirmation_groups.map(group => group.action_keys)).toEqual([["a0", "a1", "a2"]]);
    const done = await s.confirmReadyGroups(actor, id, ready(view.action_plan!));
    expect(status(done)).toEqual(["DONE", "DONE", "DONE"]); expect(db.confirm).toHaveBeenCalledTimes(3);
  });

  it("keeps every gate of the single-group path: tenant, role, rollback flag, closed conversation and non-operational turn", async () => {
    let enabled = true;
    const { s, id, view } = await prepared(services(2), () => enabled), approvals = ready(view.action_plan!);
    await expect(s.confirmReadyGroups({ ...actor, salonId: "foreign" }, id, approvals)).rejects.toThrow("SESSION_NOT_FOUND");
    await expect(s.confirmReadyGroups({ ...actor, userId: "other" }, id, approvals)).rejects.toThrow("SESSION_NOT_FOUND");
    db.role = "RECEPTIONIST";
    await expect(s.confirmReadyGroups(actor, id, approvals)).rejects.toThrow("FORBIDDEN");
    db.role = "OWNER"; enabled = false;
    await expect(s.confirmReadyGroups(actor, id, approvals)).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
    enabled = true;
    (s as unknown as { sessions: Map<string, { capability_status?: string }> }).sessions.get(id)!.capability_status = "AMBIGUOUS";
    await expect(s.confirmReadyGroups(actor, id, approvals)).rejects.toThrow("PLAN_NOT_READY");
    (s as unknown as { sessions: Map<string, { capability_status?: string }> }).sessions.get(id)!.capability_status = undefined;
    await s.cancel(actor, id);
    await expect(s.confirmReadyGroups(actor, id, approvals)).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
    expect(db.confirm).not.toHaveBeenCalled();
  });
});
