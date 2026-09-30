import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ role: "OWNER", auditLog: { create: vi.fn() }, $queryRaw: vi.fn(),
  upsert: vi.fn(), propose: vi.fn(), confirm: vi.fn(), drafts: new Map<string, Record<string, unknown>>(), gate: undefined as Promise<void> | undefined }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(),
  upsertActionDraft: db.upsert, proposeServiceCreate: db.propose, confirmServiceCreate: db.confirm }));
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { CONVERSATION_LEASE_SECONDS, InMemorySessionStore, decodeConversationState, encodeConversationState, eventPayload, persistedSessionStore,
  persistedStateEnabled, type SecretarySessionStore } from "../secretary-session-store";
import { parseStoredAggregate } from "../secretary-session-state";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import type { ActionPlan } from "@everflair/salon-secretary";

/** D1 (rec 17): persisted conversation state through the real orchestrator, with the in-memory implementation of the
 * store contract standing for PostgreSQL (two SalonSecretary instances sharing it = two workers). All I/O mocked, no
 * network, no database. Without a store (the default, flag off) nothing changes: a new process still fails closed. */
const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const T0 = Date.parse("2026-09-28T15:00:00Z");
const services = (n: number) => Array.from({ length: n }, (_, i) => intent("service.create", { item_key: `a${i}`,
  name: `Serviço ${i}`, durationMin: 30, priceCents: 5000, depends_on: [] }));
const approvalOf = (p: ActionPlan, key: string) => { const group = p.confirmation_groups.find(item => item.action_keys.includes(key))!;
  return { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }; };
const ready = (p: ActionPlan) => p.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }));
const status = (view: SecretaryView) => view.action_plan!.actions.map(action => action.status);
const sessions = (s: SalonSecretary) => (s as unknown as { sessions: Map<string, unknown> }).sessions;
const script = (n = 3) => new ScriptedServicesModel([call("select_capabilities", plan(services(n)))]);
const worker = (model: ScriptedServicesModel, store?: SecretarySessionStore) =>
  new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, { enabled: () => false }, { enabled: () => true }, () => store);
beforeEach(() => {
  vi.clearAllMocks(); db.drafts.clear(); db.role = "OWNER"; db.gate = undefined;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: db.role }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  db.upsert.mockImplementation(async (_tx, _actor, input) => {
    await db.gate;
    const draft_ref = input.draft_ref ?? crypto.randomUUID();
    const fields = { ...db.drafts.get(draft_ref), ...input.patch }; db.drafts.set(draft_ref, fields);
    const missing_fields = ["name", "priceCents", "durationMin"].filter(key => fields[key] === undefined);
    return { draft_ref, draft_revision: (input.expected_revision ?? 0) + 1, fields, status: missing_fields.length ? "NEEDS_INPUT" : "READY", missing_fields,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString() };
  });
  db.propose.mockImplementation(async (_tx, _actor, input) => ({ ...input, proposal_ref: crypto.randomUUID(), payload_hash: "backend-hash",
    preview: JSON.stringify(db.drafts.get(input.draft_ref)), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }));
  db.confirm.mockImplementation(async (_tx, _actor, input) => ({ receipt_ref: crypto.randomUUID(), proposal_ref: input.proposal_ref, service: { name: "Serviço", id: "domain-id" } }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("exact state codec", () => {
  it("keeps key order, explicit undefined, Dates, Sets, Maps and non-finite numbers; the text is plain JSON", () => {
    const value = { b: 1, a: { z: undefined, y: [1, undefined, "x"] }, when: new Date("2026-09-28T15:00:00.000Z"), receipts: new Set(["r1", "r2"]),
      recorded: new Map([["k", { executed: ["g1"] }]]), nan: Number.NaN, inf: -Infinity, nil: null };
    const text = encodeConversationState(value), back = decodeConversationState(text) as typeof value;
    expect(JSON.parse(text)).toBeTruthy();
    expect(Object.keys(back)).toEqual(Object.keys(value)); expect(Object.keys(back.a)).toEqual(["z", "y"]);
    expect("z" in back.a).toBe(true); expect(back.a.z).toBeUndefined(); expect(back.a.y).toEqual([1, undefined, "x"]);
    expect(back.when).toBeInstanceOf(Date); expect(back.when.toISOString()).toBe("2026-09-28T15:00:00.000Z");
    expect(back.receipts).toEqual(new Set(["r1", "r2"])); expect(back.recorded.get("k")).toEqual({ executed: ["g1"] });
    expect(back.nan).toBeNaN(); expect(back.inf).toBe(-Infinity); expect(back.nil).toBeNull();
    expect(JSON.stringify(back.a.y)).toBe(JSON.stringify(value.a.y));
  });
  it("refuses what is not plain data (class instances, functions, cycles, the reserved tag) instead of changing it silently", () => {
    class Money { constructor(readonly cents: number) {} }
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const bad of [{ price: new Money(1) }, { fn: () => 1 }, cyclic, { $secretary: "Date", v: "2026-09-28" }, { n: 1n }])
      expect(() => encodeConversationState(bad)).toThrow("SESSION_STATE_UNSERIALIZABLE");
    expect(() => decodeConversationState("{not json")).toThrow("SESSION_STATE_INVALID");
    expect(() => decodeConversationState(JSON.stringify({ $secretary: "Function", v: "x" }))).toThrow("SESSION_STATE_INVALID");
  });
});

describe("store contract (in-memory implementation; PostgreSQL has the same behaviour)", () => {
  const record = (text = "{}") => ({ state: text, status: "OPEN" as const, expiresAt: T0 + 20 * 60_000 });
  const id = "11111111-1111-4111-8111-111111111111";
  it("lease + compare-and-swap: a second lease is SESSION_BUSY, a stale save is CONCURRENT_UPDATE, the lease expires on its own", async () => {
    const store = new InMemorySessionStore();
    await store.create(actor, id, record());
    const first = await store.load(actor, id, { event: { kind: "TURN_STARTED" } });
    expect(first.version).toBe(2);
    await expect(store.load(actor, id)).rejects.toThrow("SESSION_BUSY");
    expect(await store.save(actor, id, record('{"a":1}'), first.version, { kind: "TURN_OUTCOME", payload: { ok: true } })).toBe(3);
    await expect(store.save(actor, id, record('{"a":2}'), first.version)).rejects.toThrow("CONCURRENT_UPDATE");
    // A worker that crashed while holding the lease: after it expires another worker proceeds; the late save loses.
    const crashed = await store.load(actor, id);
    vi.setSystemTime(T0 + (CONVERSATION_LEASE_SECONDS + 1) * 1000);
    const next = await store.load(actor, id);
    await store.save(actor, id, record('{"b":1}'), next.version);
    await expect(store.save(actor, id, record('{"late":1}'), crashed.version)).rejects.toThrow("CONCURRENT_UPDATE");
    expect((await store.load(actor, id, { lease: false })).state).toBe('{"b":1}');
    expect(store.events.map(event => [event.seq, event.kind])).toEqual([[2, "TURN_STARTED"], [3, "TURN_OUTCOME"]]);
  });
  it("rows are visible only to their salon and user; expired rows are gone and purged when the user starts again", async () => {
    const store = new InMemorySessionStore();
    await store.create(actor, id, record());
    for (const other of [{ ...actor, userId: "other-user" }, { ...actor, salonId: "other-salon" }]) {
      await expect(store.load(other, id)).rejects.toThrow("SESSION_NOT_FOUND");
      await expect(store.save(other, id, record(), 1)).rejects.toThrow("CONCURRENT_UPDATE");
      expect(await store.listOpen(other)).toEqual([]);
      await store.remove(other, id);
    }
    expect(store.rows.has(id)).toBe(true);
    vi.setSystemTime(T0 + 21 * 60_000);
    await expect(store.load(actor, id)).rejects.toThrow("SESSION_NOT_FOUND");
    expect(await store.listOpen(actor)).toEqual([]);
    await store.create(actor, "22222222-2222-4222-8222-222222222222", { ...record(), expiresAt: T0 + 40 * 60_000 });
    expect(store.rows.has(id)).toBe(false);
  });
  it("listOpen: OPEN and unexpired only, most recently updated first; events carry whitelisted codes only", async () => {
    const store = new InMemorySessionStore(), ids = ["a", "b", "c"].map((_, i) => `3333333${i}-3333-4333-8333-333333333333`);
    for (const each of ids) await store.create(actor, each, record());
    const loaded = await store.load(actor, ids[0]);
    await store.save(actor, ids[0], { ...record(), status: "CANCELLED" }, loaded.version);
    const touched = await store.load(actor, ids[1]);
    await store.save(actor, ids[1], record(), touched.version, { kind: "SELECTION", payload: { ok: false, code: "Fábio Santos", outcome: ["QUESTION", "amanhã"], revision: 3, actions: 2 } as never });
    expect((await store.listOpen(actor)).map(row => row.id)).toEqual([ids[1], ids[2]]);
    expect(store.events.at(-1)!.payload).toEqual({ ok: false, outcome: ["QUESTION"], revision: 3, actions: 2 });
    expect(eventPayload({ ok: true, code: "SESSION_BUSY", revision: -1, actions: 1.5 })).toEqual({ ok: true, code: "SESSION_BUSY" });
  });
});

describe("orchestrator without a store (default, flag off): unchanged, a new process fails closed", () => {
  it("another worker never finds the conversation and nothing executes", async () => {
    const model = script(), a = worker(model), b = worker(model);
    const { sessionId } = await a.start(actor, "auto");
    const view = await a.send(actor, { sessionId, message: "Cadastre os serviços pedidos." });
    await expect(b.send(actor, { sessionId, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
    await expect(b.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "a0"))).rejects.toThrow("SESSION_NOT_FOUND");
    expect(db.confirm).not.toHaveBeenCalled();
    expect(await b.current(actor)).toBeNull();
    expect(sessions(a).has(sessionId)).toBe(true);
    expect(persistedStateEnabled()).toBe(false); expect(persistedSessionStore()).toBeUndefined();
  });
});

describe("orchestrator with a store (flag on): conversations survive the process", () => {
  it("started on one worker, continued and confirmed on another; the process keeps no copy; a replay never executes twice", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store), b = worker(model, store);
    const { sessionId } = await a.start(actor, "auto");
    expect(sessions(a).size).toBe(0); expect(store.rows.get(sessionId)?.version).toBe(1);
    const view = await b.send(actor, { sessionId, message: "Cadastre os serviços pedidos." });
    expect(status(view)).toEqual(["READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
    expect(sessions(b).size).toBe(0);
    const approval = approvalOf(view.action_plan!, "a0");
    const done = await a.confirmActionPlanGroup(actor, sessionId, approval);
    expect(status(done)).toEqual(["DONE", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
    expect(db.confirm).toHaveBeenCalledTimes(1);
    // The exact approval replayed on the other worker: the persisted group receipt answers, nothing runs again.
    const replay = await b.confirmActionPlanGroup(actor, sessionId, approval);
    expect(status(replay)).toEqual(status(done)); expect(db.confirm).toHaveBeenCalledTimes(1);
    // "Confirm everything ready" and its exact replay (recorded outcome persisted too).
    const approvals = ready(done.action_plan!);
    const all = await b.confirmReadyGroups(actor, sessionId, approvals);
    expect(all.confirmation_batch).toEqual({ executed: ["group_2", "group_3"], replayed: [], not_executed: [] });
    const again = await a.confirmReadyGroups(actor, sessionId, approvals);
    expect(again.confirmation_batch).toEqual(all.confirmation_batch); expect(db.confirm).toHaveBeenCalledTimes(3);
    expect(sessions(a).size + sessions(b).size).toBe(0);
  });
  it("another salon, another user or an absent id is SESSION_NOT_FOUND on every worker; nothing loads or executes", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store), b = worker(model, store);
    const { sessionId } = await a.start(actor, "auto");
    const view = await a.send(actor, { sessionId, message: "Cadastre os serviços pedidos." });
    const events = store.events.length;
    for (const other of [{ ...actor, userId: "other-user" }, { ...actor, salonId: "other-salon" }]) {
      await expect(b.send(other, { sessionId, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
      await expect(b.confirmActionPlanGroup(other, sessionId, approvalOf(view.action_plan!, "a0"))).rejects.toThrow("SESSION_NOT_FOUND");
      expect(await b.current(other)).toBeNull();
    }
    await expect(b.confirm(actor, crypto.randomUUID(), { proposal_ref: crypto.randomUUID(), draft_revision: 1 })).rejects.toThrow("SESSION_NOT_FOUND");
    expect(db.confirm).not.toHaveBeenCalled(); expect(store.events).toHaveLength(events); expect(sessions(b).size).toBe(0);
  });
  it("a turn in progress holds the lease: the other worker gets SESSION_BUSY and the first turn completes and saves", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store), b = worker(model, store);
    const { sessionId } = await a.start(actor, "auto");
    let open!: () => void; db.gate = new Promise(resolve => { open = resolve; });
    const slow = a.send(actor, { sessionId, message: "Cadastre os serviços pedidos." });
    await vi.waitFor(() => expect(db.upsert).toHaveBeenCalled());
    await expect(b.send(actor, { sessionId, message: "outra coisa" })).rejects.toThrow("SESSION_BUSY");
    await expect(b.cancel(actor, sessionId)).rejects.toThrow("SESSION_BUSY");
    open();
    expect(status(await slow)).toHaveLength(3);
    expect(store.rows.get(sessionId)!.leaseUntil).toBeUndefined();
    expect((await b.current(actor))!.action_plan!.actions).toHaveLength(3);
  });
  it("events are codes only: TURN_STARTED/TURN_OUTCOME per message, then CONFIRMATION and CANCEL; never names or text", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store);
    const { sessionId } = await a.start(actor, "auto");
    const view = await a.send(actor, { sessionId, message: "Cadastre os serviços pedidos." });
    await a.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "a0"));
    // An approval whose fingerprint is not the group's is refused before anything runs.
    await expect(a.confirmActionPlanGroup(actor, sessionId, { ...approvalOf(view.action_plan!, "a1"), fingerprint: "0".repeat(64) })).rejects.toThrow("CONFIRMATION_STALE");
    await a.cancel(actor, sessionId);
    expect(store.events.map(event => event.kind)).toEqual(["TURN_STARTED", "TURN_OUTCOME", "CONFIRMATION", "CONFIRMATION", "CANCEL"]);
    expect(store.events[1].payload).toMatchObject({ ok: true, revision: expect.any(Number), actions: 3 });
    expect(store.events[1].payload.outcome).toContain("PROPOSAL_READY");
    expect(store.events[3].payload).toMatchObject({ ok: false, code: "CONFIRMATION_STALE" });
    expect(new Set(store.events.map(event => event.seq)).size).toBe(store.events.length);
    expect(JSON.stringify(store.events)).not.toMatch(/Serviço|Cadastre|backend-hash/);
    expect(store.rows.get(sessionId)!.status).toBe("CANCELLED");
    await expect(a.send(actor, { sessionId, message: "oi" })).rejects.toThrow("SESSION_CLOSED");
  });
  it("a call that throws still saves its state changes, exactly as the in-memory store keeps them", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store);
    const { sessionId } = await a.start(actor, "auto");
    await a.send(actor, { sessionId, message: "Cadastre os serviços pedidos." });
    const before = store.rows.get(sessionId)!.version;
    // No scripted answer left: the model call fails; the attempted turn and revision bump are kept.
    await expect(a.send(actor, { sessionId, message: "Muda o primeiro para 40 minutos." })).rejects.toThrow();
    expect(store.rows.get(sessionId)!.version).toBe(before + 2);
    expect(store.events.at(-1)).toMatchObject({ kind: "TURN_OUTCOME", payload: { ok: false } });
    expect(store.rows.get(sessionId)!.leaseUntil).toBeUndefined();
  });
  it("strict load: an unknown key or a foreign owner inside the state is never rehydrated (the corrupt row is removed); another schema is refused but kept", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store);
    const first = (await a.start(actor, "auto")).sessionId, second = (await a.start(actor, "auto")).sessionId;
    const row = store.rows.get(first)!, state = decodeConversationState(row.state) as { sessions: Record<string, unknown>[] };
    expect(() => parseStoredAggregate(state)).not.toThrow();
    state.sessions[0].injected = "x"; row.state = encodeConversationState(state);
    await expect(a.send(actor, { sessionId: first, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
    expect(store.rows.has(first)).toBe(false);
    store.rows.get(second)!.stateSchema = 99;
    await expect(a.send(actor, { sessionId: second, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
    expect(store.rows.get(second)!.leaseUntil).toBeUndefined(); expect(store.rows.has(second)).toBe(true);
    expect(sessions(a).size).toBe(0);
  });
  it("current(): the latest open conversation of the actor comes back on another worker; none after it is cancelled", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store), b = worker(model, store);
    const older = (await a.start(actor, "auto")).sessionId;
    vi.setSystemTime(T0 + 1000);
    const newer = (await a.start(actor, "auto")).sessionId;
    await a.send(actor, { sessionId: newer, message: "Cadastre os serviços pedidos." });
    const back = await b.current(actor);
    expect(back).toMatchObject({ sessionId: newer, skill: "auto" }); expect(back!.action_plan!.actions).toHaveLength(3);
    await b.cancel(actor, newer);
    expect((await a.current(actor))!.sessionId).toBe(older);
    expect(await worker(model).current(actor)).toBeNull();
    expect(db.confirm).not.toHaveBeenCalled();
  });
  it("SESSION_LIMIT counts the user's open conversations in the store, across workers; a cancelled one frees its slot", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store), b = worker(model, store);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await (i % 2 ? a : b).start(actor, "auto")).sessionId);
    await expect(a.start(actor, "auto")).rejects.toThrow("SESSION_LIMIT");
    await b.cancel(actor, ids[0]);
    await expect(a.start(actor, "auto")).resolves.toMatchObject({ skill: "auto" });
    await expect(b.start({ ...actor, userId: "another-owner" }, "auto")).resolves.toMatchObject({ skill: "auto" });
  });
  it("owner feedback: the codes saved with the conversation are read without a lease on any worker", async () => {
    const store = new InMemorySessionStore(), model = script(), a = worker(model, store), b = worker(model, store);
    const { sessionId } = await a.start(actor, "auto");
    await a.send(actor, { sessionId, message: "Cadastre os serviços pedidos." });
    expect(b.feedbackContext(actor, sessionId)).toBeUndefined();
    const saved = await b.storedFeedbackContext(actor, sessionId);
    expect(saved!.codes).toContain("PROPOSAL_READY"); expect(saved!.contract_version).toMatch(/^[0-9a-f]{64}$/);
    expect(await b.storedFeedbackContext({ ...actor, userId: "other-user" }, sessionId)).toBeUndefined();
    expect(store.rows.get(sessionId)!.leaseUntil).toBeUndefined();
    expect(await worker(model).storedFeedbackContext(actor, sessionId)).toBeUndefined();
  });
});
