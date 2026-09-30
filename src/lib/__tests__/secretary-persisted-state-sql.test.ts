import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** D1 without a database: the SQL the PostgreSQL store and the alias store send (captured from a fake tenant transaction),
 * and the Golden write-guard's documented allowlist that judges those statements. The real statements run only in the
 * PostgreSQL integration suite (coordinator). */
const io = vi.hoisted(() => ({ calls: [] as { actor: unknown; args: unknown[] }[], answers: [] as unknown[][] }));
vi.mock("../prisma-tenant", () => ({ withTenant: async (actor: unknown, fn: (tx: object) => unknown) => fn({
  $queryRaw: async (...args: unknown[]) => { io.calls.push({ actor, args }); return io.answers.shift() ?? []; } }) }));
import { PostgresSessionStore } from "../secretary-session-store";
import { postgresNameAliasStore } from "../secretary-name-aliases";
import { PERSISTED_STATE_TABLES, flaggedRlsTables, rawSqlText, rawWriteTargets, rawWriteVerdict, technicalWriteTables } from "../../../packages/salon-secretary/evaluation/free-use-technical-writes";

const actor = { salonId: "salon-a", userId: "user-a" }, id = "11111111-1111-4111-8111-111111111111";
const sql = (index: number) => (io.calls[index].args[0] as string[]).join("$");
const values = (index: number) => io.calls[index].args.slice(1);
beforeEach(() => { io.calls.length = 0; io.answers.length = 0; });
afterEach(() => vi.unstubAllEnvs());

describe("PostgresSessionStore SQL", () => {
  it("create purges the actor's expired rows, then inserts version 1 with the exact state text inside a JSON object", async () => {
    await new PostgresSessionStore().create(actor, id, { state: '{"b":1,"a":2}', status: "OPEN", expiresAt: Date.parse("2026-09-28T15:20:00Z") });
    expect(sql(0)).toMatch(/^DELETE FROM "SecretaryConversation" WHERE "salonId" = \$ AND "userId" = \$ AND "expiresAt" <= now\(\)/);
    expect(values(0)).toEqual(["salon-a", "user-a"]);
    expect(sql(1)).toContain('INSERT INTO "SecretaryConversation"'); expect(values(1)).toContain(JSON.stringify({ json: '{"b":1,"a":2}' }));
    expect(io.calls.every(call => call.actor === actor)).toBe(true);
  });
  it("load takes the lease with a version bump only when free; busy and absent are told apart; the event gets seq = new version", async () => {
    const store = new PostgresSessionStore(() => Date.parse("2026-09-28T15:00:00Z"));
    io.answers.push([{ version: 4, stateSchema: 1, state: "{}", status: "OPEN", remainingMs: 20 * 60_000 }]);
    expect(await store.load(actor, id, { event: { kind: "TURN_STARTED" } })).toMatchObject({ version: 4, state: "{}", expiresAt: Date.parse("2026-09-28T15:20:00Z") });
    expect(sql(0)).toMatch(/UPDATE "SecretaryConversation" SET "version" = "version" \+ 1,\s+"leaseUntil" = now\(\) \+ make_interval/);
    expect(sql(0)).toContain('AND ("leaseUntil" IS NULL OR "leaseUntil" <= now())'); expect(sql(0)).toContain('"salonId" = $ AND "userId" = $');
    expect(sql(1)).toContain('INSERT INTO "SecretaryConversationEvent"'); expect(values(1)).toEqual(expect.arrayContaining([id, "salon-a", "user-a", 4, "TURN_STARTED", "{}"]));
    io.calls.length = 0; io.answers.push([], [{ leased: true }]);
    await expect(store.load(actor, id)).rejects.toThrow("SESSION_BUSY");
    io.answers.push([], []);
    await expect(store.load(actor, id)).rejects.toThrow("SESSION_NOT_FOUND");
    io.calls.length = 0; io.answers.push([]);
    await expect(store.load(actor, id, { lease: false })).rejects.toThrow("SESSION_NOT_FOUND");
    expect(sql(0)).toMatch(/^SELECT "version"/);
  });
  it("save is a compare-and-swap on the leased version that releases the lease; a lost swap writes nothing else", async () => {
    const store = new PostgresSessionStore(), record = { state: "{}", status: "CANCELLED" as const, expiresAt: Date.now() + 60_000 };
    io.answers.push([{ version: 6 }]);
    expect(await store.save(actor, id, record, 5, { kind: "CANCEL", payload: { ok: true, code: "Amanda Souza" } as never })).toBe(6);
    expect(sql(0)).toContain('"version" = "version" + 1, "leaseUntil" = NULL'); expect(sql(0)).toContain('AND "version" = $::int');
    expect(values(0)).toContain(5); expect(values(1)).toContain(JSON.stringify({ ok: true }));
    io.calls.length = 0; io.answers.push([]);
    await expect(store.save(actor, id, record, 5, { kind: "CANCEL" })).rejects.toThrow("CONCURRENT_UPDATE");
    expect(io.calls).toHaveLength(1);
    await expect(store.save(actor, "not-a-uuid", record, 5)).rejects.toThrow();
    await expect(store.save(actor, id, { ...record, state: "x".repeat(2_000_001) }, 5)).rejects.toThrow("SESSION_STATE_TOO_LARGE");
  });
  it("review: one clock. A caller clock months away from the database's (the Golden's fixed 2027 clock) only says how long is left", async () => {
    const golden = Date.parse("2027-04-12T12:00:00Z"), store = new PostgresSessionStore(() => golden);
    const record = (minutes: number) => ({ state: "{}", status: "OPEN" as const, expiresAt: golden + minutes * 60_000 });
    await store.create(actor, id, record(20));
    // No absolute app instant reaches SQL: "expiresAt" = now() + the 20 min left (027's CHECK against "createdAt" holds).
    expect(sql(1)).toContain("now() + make_interval(secs => $::float8)"); expect(values(1)).toContain(1200);
    expect(values(1).some(value => value instanceof Date)).toBe(false);
    // Clamped to the row's lifetime (0..2 h) and, on save, never past "createdAt" + 2 h (database clock).
    await store.create(actor, id, record(60 * 24 * 365)); expect(values(3)).toContain(7200);
    await store.create(actor, id, record(-60)); expect(values(5)).toContain(0);
    io.calls.length = 0; io.answers.push([{ version: 3 }]);
    await store.save(actor, id, record(20), 2);
    expect(sql(0)).toMatch(/"expiresAt" = LEAST\(now\(\) \+ make_interval\(secs => \$::float8\),\s+"createdAt" \+ make_interval\(secs => \$::int\)\)/);
    expect(values(0)).toEqual(expect.arrayContaining([1200, 7200])); expect(values(0).some(value => value instanceof Date)).toBe(false);
    // load answers on the caller's clock: its now + what the database says is left (never the database's instant).
    io.calls.length = 0; io.answers.push([{ version: 4, stateSchema: 1, state: "{}", status: "OPEN", remainingMs: 5 * 60_000 }]);
    expect((await store.load(actor, id)).expiresAt).toBe(golden + 5 * 60_000);
    expect(sql(0)).toContain(`GREATEST(EXTRACT(EPOCH FROM ("expiresAt" - now())) * 1000, 0)::float8 AS "remainingMs"`);
    io.calls.length = 0; io.answers.push([{ version: 4, stateSchema: 1, state: "{}", status: "OPEN", remainingMs: 60_000 }]);
    expect((await store.load(actor, id, { lease: false })).expiresAt).toBe(golden + 60_000);
  });
  it("listOpen and remove are the actor's own rows only", async () => {
    const store = new PostgresSessionStore();
    io.answers.push([{ id, updatedAt: new Date("2026-09-28T15:00:00Z") }]);
    expect(await store.listOpen(actor)).toEqual([{ id, updatedAt: Date.parse("2026-09-28T15:00:00Z") }]);
    expect(sql(0)).toContain(`"status" = 'OPEN' AND "expiresAt" > now()`); expect(sql(0)).toContain('ORDER BY "updatedAt" DESC');
    await store.remove(actor, id);
    expect(sql(1)).toMatch(/^DELETE FROM "SecretaryConversation" WHERE "id" = \$::uuid AND "salonId" = \$ AND "userId" = \$/);
  });
});

describe("Golden write-guard allowlist (documented): only the conversation-state tables, only with the flag on", () => {
  const statements = async () => {
    const store = new PostgresSessionStore(), record = { state: "{}", status: "OPEN" as const, expiresAt: Date.now() + 60_000 };
    await store.create(actor, id, record);
    io.answers.push([{ version: 2, stateSchema: 1, state: "{}", status: "OPEN", expiresAt: new Date() }]); await store.load(actor, id, { event: { kind: "TURN_STARTED" } });
    io.answers.push([{ version: 3 }]); await store.save(actor, id, record, 2, { kind: "TURN_OUTCOME" });
    await store.listOpen(actor); await store.remove(actor, id);
    return io.calls.map(call => call.args);
  };
  it("every statement of the conversation store is TECHNICAL or READ; the alias store's writes are not allowlisted", async () => {
    const verdicts = (await statements()).map(args => rawWriteVerdict(args, PERSISTED_STATE_TABLES));
    // create (purge + insert), lease (update + event), save (update + event), listOpen (read), remove (delete).
    expect(verdicts).toEqual(["TECHNICAL", "TECHNICAL", "TECHNICAL", "TECHNICAL", "TECHNICAL", "TECHNICAL", "READ", "TECHNICAL"]);
    io.calls.length = 0;
    await postgresNameAliasStore.find(actor, "customer", "fabio");
    await postgresNameAliasStore.learn(actor, { kind: "customer", key: "fabio", targetId: "c1", candidateSet: null });
    await postgresNameAliasStore.used(actor, "customer", "fabio", "c1");
    await postgresNameAliasStore.forget(actor, "customer", "fabio", "c1");
    expect(io.calls.map(call => rawWriteVerdict(call.args, PERSISTED_STATE_TABLES))).toEqual(["READ", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"]);
    expect(rawWriteTargets(sql(1))).toEqual(["SecretaryNameAlias"]);
  });
  it("reads, locks and upserts are recognised; business tables, DDL, procedures and unreadable SQL are refused", () => {
    const allowed = PERSISTED_STATE_TABLES;
    expect(rawWriteVerdict([["SELECT id FROM \"Appointment\" WHERE id=", " FOR UPDATE"], "x"], allowed)).toBe("READ");
    expect(rawWriteVerdict([["SELECT set_config(", ", ", ", true)"], "app.current_salon", "s"], allowed)).toBe("READ");
    expect(rawWriteVerdict(["SELECT pg_advisory_xact_lock(hashtextextended('x',0))"], allowed)).toBe("READ");
    expect(rawWriteVerdict([["INSERT INTO \"ClientProfile\" (id) VALUES (", ")"], "x"], allowed)).toBe("FORBIDDEN");
    expect(rawWriteVerdict([["UPDATE \"Appointment\" SET status='CANCELLED' WHERE id=", ""], "x"], allowed)).toBe("FORBIDDEN");
    expect(rawWriteVerdict([["WITH moved AS (UPDATE \"Appointment\" SET x=1 RETURNING id) INSERT INTO \"SecretaryConversationEvent\" SELECT 1"]], allowed)).toBe("FORBIDDEN");
    expect(rawWriteVerdict([["INSERT INTO \"SecretaryConversationEvent\" (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id"]], allowed)).toBe("TECHNICAL");
    for (const bad of ["DELETE FROM \"AuditLog\"", "TRUNCATE \"SecretaryConversation\"", "DROP TABLE \"SecretaryConversation\"", "DO $$ BEGIN END $$",
      "CALL something()", "GRANT SELECT ON x TO y", "MERGE INTO \"SecretaryConversation\" USING x ON true WHEN MATCHED THEN DELETE", "delete from x"])
      expect(rawWriteVerdict([bad], allowed)).toBe("FORBIDDEN");
    expect(rawWriteVerdict([{ unknown: true }], allowed)).toBe("FORBIDDEN");
    expect(rawSqlText([{ strings: ["SELECT ", ""], values: [1] }])).toBe("SELECT  $ ");
    expect(rawSqlText([{ sql: "SELECT 1" }])).toBe("SELECT 1");
  });
  it("flags decide the allowlist and the extra FORCE RLS tables; with both off nothing is added", () => {
    expect(technicalWriteTables({})).toEqual([]); expect(flaggedRlsTables({})).toEqual([]);
    expect(technicalWriteTables({ SALON_SECRETARY_PERSISTED_STATE: "true" })).toEqual(["SecretaryConversation", "SecretaryConversationEvent"]);
    expect(flaggedRlsTables({ SALON_SECRETARY_PERSISTED_STATE: "true", SALON_SECRETARY_NAME_ALIASES: "true" })).toEqual(["SecretaryConversation", "SecretaryConversationEvent", "SecretaryNameAlias"]);
    expect(technicalWriteTables({ SALON_SECRETARY_NAME_ALIASES: "true" })).toEqual([]);
  });
  it("the runners are wired: the Golden guard inspects raw SQL only through the allowlist, both runners pass the flag-driven store, the DB gate adds the flagged tables", () => {
    const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const runner = source("packages/salon-secretary/evaluation/free-use-runner.ts");
    expect(runner).toContain("if(technicalTables.length&&(params.action==='queryRaw'||params.action==='executeRaw')){");
    expect(runner).toContain("if(verdict==='FORBIDDEN'){attemptedWrites++;throw Error('FREE_USE_OPERATIONAL_WRITE_FORBIDDEN');}");
    expect(runner).toContain("{enabled:()=>true},persistedSessionStore);"); expect(runner).toContain("technicalStateWrites");
    expect(source("packages/salon-secretary/evaluation/agenda-practice.ts")).toContain("{ enabled: () => true }, persistedSessionStore);");
    expect(source("packages/salon-secretary/evaluation/free-use-database.ts")).toContain("...flaggedRlsTables()]");
    // Aliases are written only on the owner's click (selectAutomatic), never on a model's option choice.
    const orchestrator = source("src/lib/salon-secretary.ts");
    expect(orchestrator).toContain("await this.selectChild(actor,child,ref,{ clicked: true });");
    expect(orchestrator).toContain("try { await this.selectChild(actor, child, published.ref); }");
  });
});
