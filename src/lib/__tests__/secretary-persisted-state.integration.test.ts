import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { PostgresSessionStore, encodeConversationState } from "../secretary-session-store";
import { postgresNameAliasStore } from "../secretary-name-aliases";
import { serviceScript } from "../../test/scripted-services-model";
import { withFreeUseClock } from "../../../packages/salon-secretary/evaluation/free-use-clock";

/** D1 against PostgreSQL (runtime role mvp_service_runtime, FORCE RLS; network forbidden). Needs the coordinator:
 * 027_secretary_state applied locally (preflight → migration → verify), scripts/setup-secretary-state-mvp-access.ts run
 * with explicit approval, then RUN_SERVICE_MVP_INTEGRATION=1 on the disposable database only. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
type Actor = { salonId: string; userId: string };

async function salon(label: string) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: `Dona ${label}`, email: `d1-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    const receptionist = await tx.user.create({ data: { name: `Recepção ${label}`, email: `d1-reception-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Synthetic D1 ${label}`, slug: `d1-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: "America/Sao_Paulo" } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    await tx.membership.create({ data: { salonId, userId: receptionist.id, role: "RECEPTIONIST" } });
    const customer = await tx.clientProfile.create({ data: { salonId, name: "Fábio Santos", phone: "11999990003" } });
    return { owner: { salonId, userId: owner.id }, receptionist: { salonId, userId: receptionist.id }, customer: customer.id };
  });
}
const record = (text = "{}", minutes = 20) => ({ state: text, status: "OPEN" as const, expiresAt: Date.now() + minutes * 60_000 });
/** Admin writes under the row owner's GUCs (FORCE RLS applies to the table owner too). */
const asOwner = <T>(actor: Actor, fn: (tx: Parameters<Parameters<typeof admin.$transaction>[0]>[0]) => Promise<T>) => admin.$transaction(async tx => {
  await tx.$executeRaw`SELECT set_config('app.current_salon',${actor.salonId},true)`; await tx.$executeRaw`SELECT set_config('app.current_user_id',${actor.userId},true)`;
  return fn(tx);
});

suite("D1 persisted Secretary state against PostgreSQL (runtime role, FORCE RLS)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    console.log("D1_STATE_PREFLIGHT", await assertMvpTestDatabase(admin));
    const [role] = await prisma.$queryRaw<{ name: string; super: boolean; bypass: boolean }[]>`SELECT current_user AS name, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({ name: "mvp_service_runtime", super: false, bypass: false });
    const flags = await admin.$queryRaw<{ relname: string; enabled: boolean; forced: boolean }[]>`SELECT relname::text AS relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('SecretaryConversation','SecretaryConversationEvent','SecretaryNameAlias')`;
    expect(flags).toHaveLength(3); expect(flags.every(row => row.enabled && row.forced)).toBe(true);
    vi.stubGlobal("fetch", network);
  });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); });

  it("store: lease + compare-and-swap on real rows; another user of the salon, another salon or an absent id never sees a row", async () => {
    const a = await salon("A"), b = await salon("B"), store = new PostgresSessionStore(), id = randomUUID();
    await store.create(a.owner, id, record('{"b":1,"a":2}'));
    const leased = await store.load(a.owner, id, { event: { kind: "TURN_STARTED" } });
    expect(leased).toMatchObject({ version: 2, state: '{"b":1,"a":2}', status: "OPEN" }); // exact text: key order kept
    await expect(store.load(a.owner, id)).rejects.toThrow("SESSION_BUSY");
    expect(await store.save(a.owner, id, record('{"c":3}'), leased.version, { kind: "TURN_OUTCOME", payload: { ok: true } })).toBe(3);
    await expect(store.save(a.owner, id, record('{"late":1}'), leased.version)).rejects.toThrow("CONCURRENT_UPDATE");
    for (const other of [a.receptionist, b.owner]) {
      await expect(store.load(other, id)).rejects.toThrow("SESSION_NOT_FOUND");
      await expect(store.save(other, id, record(), 3)).rejects.toThrow("CONCURRENT_UPDATE");
      expect(await store.listOpen(other)).toEqual([]);
      await store.remove(other, id);
    }
    await expect(store.load(a.owner, randomUUID())).rejects.toThrow("SESSION_NOT_FOUND");
    expect((await store.listOpen(a.owner)).map(row => row.id)).toEqual([id]);
    const events = await withTenant(a.owner, tx => tx.$queryRaw<{ seq: number; kind: string; payload: unknown }[]>`SELECT "seq","kind","payload" FROM "SecretaryConversationEvent" WHERE "conversationId"=${id}::uuid ORDER BY "seq"`);
    expect(events).toEqual([{ seq: 2, kind: "TURN_STARTED", payload: {} }, { seq: 3, kind: "TURN_OUTCOME", payload: { ok: true } }]);
  });
  it("events are append-only; another user cannot append to a conversation that is not theirs; removal cascades the events", async () => {
    const a = await salon("C"), store = new PostgresSessionStore(), id = randomUUID();
    await store.create(a.owner, id, record());
    const leased = await store.load(a.owner, id, { event: { kind: "TURN_STARTED" } });
    await store.save(a.owner, id, record(), leased.version, { kind: "CANCEL" });
    await expect(withTenant(a.owner, tx => tx.$executeRaw`UPDATE "SecretaryConversationEvent" SET "kind"='CANCEL' WHERE "conversationId"=${id}::uuid`)).rejects.toThrow();
    await expect(withTenant(a.owner, tx => tx.$executeRaw`DELETE FROM "SecretaryConversationEvent" WHERE "conversationId"=${id}::uuid`)).rejects.toThrow();
    await expect(asOwner(a.owner, tx => tx.$executeRaw`UPDATE "SecretaryConversationEvent" SET "kind"='CANCEL' WHERE "conversationId"=${id}::uuid`)).rejects.toThrow(/append-only/);
    await expect(withTenant(a.receptionist, tx => tx.$executeRaw`INSERT INTO "SecretaryConversationEvent" ("id","conversationId","salonId","userId","seq","kind")
      VALUES (${randomUUID()}::uuid, ${id}::uuid, ${a.receptionist.salonId}, ${a.receptionist.userId}, 99, 'CANCEL')`)).rejects.toThrow();
    await store.remove(a.owner, id);
    expect(await asOwner(a.owner, tx => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SecretaryConversationEvent" WHERE "conversationId"=${id}::uuid`)).toEqual([{ n: 0 }]);
  });
  it("create purges the actor's expired conversations only", async () => {
    const a = await salon("D"), store = new PostgresSessionStore(), old = randomUUID(), foreign = randomUUID();
    await store.create(a.owner, old, record()); await store.create(a.receptionist, foreign, record());
    await asOwner(a.owner, tx => tx.$executeRaw`UPDATE "SecretaryConversation" SET "expiresAt" = now() - interval '1 minute' WHERE "id"=${old}::uuid`);
    await asOwner(a.receptionist, tx => tx.$executeRaw`UPDATE "SecretaryConversation" SET "expiresAt" = now() - interval '1 minute' WHERE "id"=${foreign}::uuid`);
    await store.create(a.owner, randomUUID(), record());
    expect(await asOwner(a.owner, tx => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SecretaryConversation" WHERE "id"=${old}::uuid`)).toEqual([{ n: 0 }]);
    expect(await asOwner(a.receptionist, tx => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SecretaryConversation" WHERE "id"=${foreign}::uuid`)).toEqual([{ n: 1 }]);
  });
  it("review: one clock. A worker whose clock is far from the database's (the Golden's fixed 2027 clock, or one in the past) starts, reattaches and saves; expiry is on the database clock", async () => {
    const a = await salon("I"), store = new PostgresSessionStore();
    const worker = () => new SalonSecretary(async () => serviceScript(), () => "fake-services", undefined, {}, {}, () => store);
    const expiry = (id: string) => asOwner(a.owner, tx => tx.$queryRaw<{ left: number; lifetime: number }[]>`SELECT EXTRACT(EPOCH FROM ("expiresAt" - now()))::float8 AS "left",
      EXTRACT(EPOCH FROM ("expiresAt" - "createdAt"))::float8 AS "lifetime" FROM "SecretaryConversation" WHERE "id"=${id}::uuid`).then(rows => rows[0]);
    for (const clock of ["2027-04-12T12:00:00Z", "2020-01-06T12:00:00Z"]) {
      const started = await withFreeUseClock(clock, async () => {
        const session = await worker().start(a.owner, "auto"); // 027's CHECK held: no absolute app instant was written.
        expect((await worker().current(a.owner))?.sessionId).toBe(session.sessionId); // lease + load + save on the database clock
        return session.sessionId;
      });
      const row = await expiry(started);
      expect(row.left).toBeGreaterThan(19 * 60); expect(row.left).toBeLessThanOrEqual(20 * 60 + 5); expect(row.lifetime).toBeLessThanOrEqual(2 * 3600);
      await store.remove(a.owner, started);
    }
  });
  it("orchestrator: a conversation started on one worker is confirmed once on another; replays and other users never execute again", async () => {
    const a = await salon("E"), store = new PostgresSessionStore(), model = serviceScript();
    const worker = (persisted = true) => new SalonSecretary(async () => model, () => "fake-services", undefined, {}, {}, () => persisted ? store : undefined);
    const session = await worker().start(a.owner);
    await worker().send(a.owner, { sessionId: session.sessionId, message: "Cadastre uma massagem por R$50" });
    const ready = await worker().send(a.owner, { sessionId: session.sessionId, message: "Uma hora" });
    const approval = { proposal_ref: ready.proposal!.proposal_ref, draft_revision: ready.proposal!.draft_revision };
    // Without the store (flag off) a worker still fails closed.
    await expect(worker(false).confirm(a.owner, session.sessionId, approval)).rejects.toThrow("SESSION_NOT_FOUND");
    for (const other of [a.receptionist, { ...a.owner, salonId: (await salon("F")).owner.salonId }])
      await expect(worker().confirm(other, session.sessionId, approval)).rejects.toThrow("SESSION_NOT_FOUND");
    const done = await worker().confirm(a.owner, session.sessionId, approval);
    expect(done.receipt).toBeTruthy();
    const services = () => withTenant(a.owner, tx => tx.service.count({ where: { salonId: a.owner.salonId } }));
    expect(await services()).toBe(1);
    // The exact approval replayed on yet another worker: the journal's receipt answers (duplicate), nothing runs again.
    expect((await worker().confirm(a.owner, session.sessionId, approval)).receipt!.duplicate).toBe(true);
    expect(await services()).toBe(1);
    const kinds = await withTenant(a.owner, tx => tx.$queryRaw<{ kind: string }[]>`SELECT "kind" FROM "SecretaryConversationEvent" WHERE "conversationId"=${session.sessionId}::uuid ORDER BY "seq"`);
    expect(kinds.map(row => row.kind)).toEqual(["TURN_STARTED", "TURN_OUTCOME", "TURN_STARTED", "TURN_OUTCOME", "CONFIRMATION", "CONFIRMATION"]);
    // The state stays readable only by its owner; a tampered state is refused on load.
    const [saved] = await withTenant(a.owner, tx => tx.$queryRaw<{ state: string }[]>`SELECT "state"->>'json' AS "state" FROM "SecretaryConversation" WHERE "id"=${session.sessionId}::uuid`);
    expect(saved.state).toContain("Massagem");
    await asOwner(a.owner, tx => tx.$executeRaw`UPDATE "SecretaryConversation" SET "state" = ${JSON.stringify({ json: encodeConversationState({ schema: 1, root: session.sessionId, sessions: [{ injected: true }] }) })}::jsonb WHERE "id"=${session.sessionId}::uuid`);
    await expect(worker().send(a.owner, { sessionId: session.sessionId, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
  });
  it("aliases: salon-wide reads, the learner is the authenticated user, only OWNER/MANAGER delete, another salon never sees them", async () => {
    const a = await salon("G"), b = await salon("H");
    await postgresNameAliasStore.learn(a.receptionist, { kind: "customer", key: "fabinho", targetId: a.customer, candidateSet: null });
    expect(await postgresNameAliasStore.find(a.owner, "customer", "fabinho")).toEqual({ targetId: a.customer, candidateSet: null });
    expect(await postgresNameAliasStore.find(b.owner, "customer", "fabinho")).toBeUndefined();
    await postgresNameAliasStore.learn(a.owner, { kind: "customer", key: "fabinho", targetId: a.customer, candidateSet: null });
    const [row] = await asOwner(a.owner, tx => tx.$queryRaw<{ useCount: number; createdBy: string }[]>`SELECT "useCount","createdBy" FROM "SecretaryNameAlias" WHERE "salonId"=${a.owner.salonId}`);
    expect(row).toEqual({ useCount: 2, createdBy: a.receptionist.userId });
    await expect(withTenant(a.owner, tx => tx.$executeRaw`INSERT INTO "SecretaryNameAlias" ("id","salonId","kind","aliasFolded","targetId","createdBy")
      VALUES (${randomUUID()}::uuid, ${a.owner.salonId}, 'customer', 'outro', ${a.customer}, ${a.receptionist.userId})`)).rejects.toThrow();
    expect(await postgresNameAliasStore.forget(a.receptionist, "customer", "fabinho", a.customer)).toBe(false);
    expect(await postgresNameAliasStore.forget(b.owner, "customer", "fabinho", a.customer)).toBe(false);
    expect(await postgresNameAliasStore.forget(a.owner, "customer", "fabinho", a.customer)).toBe(true);
    expect(await postgresNameAliasStore.find(a.owner, "customer", "fabinho")).toBeUndefined();
  });
});
