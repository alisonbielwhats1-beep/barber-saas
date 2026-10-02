import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withTenant, type Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";

/** D1 (rec 17): the Secretary's conversation state outliving one process, behind SALON_SECRETARY_PERSISTED_STATE (default
 * off). Without it SalonSecretary keeps today's in-memory Map as its only store (a restart or another worker fails closed).
 * With it, every top-level call leases the conversation row (a version bump, never a DB transaction held across a model
 * call), works on the aggregate in memory and saves it back with compare-and-swap on the version; the lease ends with the
 * save. Events are codes only. Tables: prisma/sql/manual/027_secretary_state.sql (raw SQL, FORCE RLS by salon and user). */
export const persistedStateEnabled = (env: Record<string, string | undefined> = process.env) => env.SALON_SECRETARY_PERSISTED_STATE === "true";

export const CONVERSATION_STATE_SCHEMA = 1;
/** A turn holds the conversation this long at most; a crashed worker's lease simply expires. */
export const CONVERSATION_LEASE_SECONDS = 120;
/** A conversation row lives at most this long from its creation, on the database clock (027's CHECK allows 3 h). */
export const CONVERSATION_MAX_SECONDS = 2 * 60 * 60;
/** The exact JSON text of one aggregate (customer names and the owner's words included): bounded. */
export const CONVERSATION_STATE_MAX_BYTES = 2_000_000;
export type ConversationStatus = "OPEN" | "CANCELLED";
export const CONVERSATION_EVENT_KINDS = ["TURN_STARTED", "TURN_OUTCOME", "SELECTION", "CONFIRMATION", "DISCARD", "RESUME", "CANCEL"] as const;
export type ConversationEventKind = (typeof CONVERSATION_EVENT_KINDS)[number];
/** Codes only: whether the call succeeded, its stable error code, the turn's outcome codes, the plan revision/size. */
export type ConversationEventPayload = { ok?: boolean; code?: string; outcome?: string[]; revision?: number; actions?: number };
/** `clientTurnId` (pilot of the reschedule, flag SALON_SECRETARY_PILOT_RESCHEDULE; 027's column): the client's id of the owner message a
 * TURN_STARTED event opens. Recorded once per conversation (UNIQUE(conversationId, clientTurnId)): a repeated message's event keeps it null. */
export type ConversationEvent = { kind: ConversationEventKind; payload?: ConversationEventPayload; clientTurnId?: string };
export type ConversationRecord = { state: string; status: ConversationStatus; expiresAt: number };
export type LoadedConversation = ConversationRecord & { id: string; version: number; stateSchema: number };
export type OpenConversation = { id: string; updatedAt: number };
export type StoredEvent = { conversationId: string; salonId: string; userId: string; seq: number; kind: ConversationEventKind; clientTurnId: string | null; payload: ConversationEventPayload };

/** The persistence contract (both implementations). Every call is scoped to the authenticated actor: a row of another
 * salon or user is indistinguishable from an absent one (SESSION_NOT_FOUND). `expiresAt` is always on the CALLER's clock
 * (the store's `now`); a store with its own clock converts it as the time left, never as an absolute instant.
 *  - create: a new conversation at version 1 (the actor's expired rows are purged first);
 *  - load: the unexpired row; with `lease` (default) it also takes the turn lease (version + 1, SESSION_BUSY while another
 *    turn holds it) and appends `event`;
 *  - save: compare-and-swap on `expectedVersion` (the leased version), releases the lease, appends `event`;
 *    another writer in between → CONCURRENT_UPDATE, nothing written;
 *  - remove: deletes the row (its events cascade);
 *  - listOpen: the actor's OPEN, unexpired conversations, most recently updated first. */
export interface SecretarySessionStore {
  create(actor: ServiceActor, id: string, record: ConversationRecord): Promise<void>;
  load(actor: ServiceActor, id: string, options?: { lease?: boolean; event?: ConversationEvent }): Promise<LoadedConversation>;
  save(actor: ServiceActor, id: string, record: ConversationRecord, expectedVersion: number, event?: ConversationEvent): Promise<number>;
  remove(actor: ServiceActor, id: string): Promise<void>;
  listOpen(actor: ServiceActor): Promise<OpenConversation[]>;
}

const uuid = z.string().uuid();
const codeShape = /^[A-Z][A-Z0-9_]{1,79}$/;
/** Whitelisted, bounded payload: anything that is not a code, a boolean or a small integer is dropped. */
export function eventPayload(payload: ConversationEventPayload = {}): ConversationEventPayload {
  const out: ConversationEventPayload = {};
  if (typeof payload.ok === "boolean") out.ok = payload.ok;
  if (typeof payload.code === "string" && codeShape.test(payload.code)) out.code = payload.code;
  const outcome = (payload.outcome ?? []).filter(item => typeof item === "string" && codeShape.test(item)).slice(0, 16);
  if (outcome.length) out.outcome = [...new Set(outcome)];
  for (const key of ["revision", "actions"] as const) { const value = payload[key]; if (Number.isSafeInteger(value) && value! >= 0 && value! < 1_000_000) out[key] = value; }
  return out;
}
const record = z.object({ state: z.string().min(2).max(CONVERSATION_STATE_MAX_BYTES), status: z.enum(["OPEN", "CANCELLED"]), expiresAt: z.number().finite() }).strict();
function checkedRecord(value: ConversationRecord) {
  if (Buffer.byteLength(value.state, "utf8") > CONVERSATION_STATE_MAX_BYTES) throw Error("SESSION_STATE_TOO_LARGE");
  return record.parse(value);
}

// ---------------------------------------------------------------- exact state codec
/** JSONB reorders object keys and drops undefined; the orchestrator compares JSON.stringify outputs of its own state, so
 * the aggregate is kept as its exact JSON text. Tagged values keep what JSON cannot: Date, Set, Map, undefined and
 * non-finite numbers. Anything else that is not plain data (a class instance, a function, a cycle) is refused, never
 * silently changed. */
const TAG = "$secretary";
export function encodeConversationState(value: unknown): string {
  const stack = new Set<object>();
  const encode = (item: unknown, depth: number): unknown => {
    if (depth > 64) throw Error("SESSION_STATE_UNSERIALIZABLE");
    if (item === undefined) return { [TAG]: "undefined" };
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : { [TAG]: "Number", v: String(item) };
    if (typeof item !== "object") throw Error("SESSION_STATE_UNSERIALIZABLE");
    if (stack.has(item)) throw Error("SESSION_STATE_UNSERIALIZABLE");
    stack.add(item);
    try {
      if (item instanceof Date) { if (!Number.isFinite(item.getTime())) throw Error("SESSION_STATE_UNSERIALIZABLE"); return { [TAG]: "Date", v: item.toISOString() }; }
      if (item instanceof Set) return { [TAG]: "Set", v: [...item].map(entry => encode(entry, depth + 1)) };
      if (item instanceof Map) return { [TAG]: "Map", v: [...item].map(([key, entry]) => [encode(key, depth + 1), encode(entry, depth + 1)]) };
      if (Array.isArray(item)) return Array.from(item, entry => encode(entry, depth + 1));
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw Error("SESSION_STATE_UNSERIALIZABLE");
      if (Object.hasOwn(item, TAG) || Object.getOwnPropertySymbols(item).length) throw Error("SESSION_STATE_UNSERIALIZABLE");
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(item)) out[key] = encode(entry, depth + 1);
      return out;
    } finally { stack.delete(item); }
  };
  return JSON.stringify(encode(value, 0));
}
export function decodeConversationState(text: string): unknown {
  const decode = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") return item;
    if (Array.isArray(item)) return item.map(decode);
    const tagged = item as Record<string, unknown>;
    if (Object.hasOwn(tagged, TAG)) {
      const kind = tagged[TAG], v = tagged.v;
      if (kind === "undefined" && Object.keys(tagged).length === 1) return undefined;
      if (Object.keys(tagged).length !== 2) throw Error("SESSION_STATE_INVALID");
      if (kind === "Number" && (v === "NaN" || v === "Infinity" || v === "-Infinity")) return Number(v);
      if (kind === "Date" && typeof v === "string" && Number.isFinite(Date.parse(v))) return new Date(v);
      if (kind === "Set" && Array.isArray(v)) return new Set(v.map(decode));
      if (kind === "Map" && Array.isArray(v) && v.every(pair => Array.isArray(pair) && pair.length === 2)) return new Map(v.map(([key, entry]) => [decode(key), decode(entry)]));
      throw Error("SESSION_STATE_INVALID");
    }
    // Assignment keeps a key whose value decodes to undefined (a reviver would delete it).
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(tagged)) out[key] = decode(entry);
    return out;
  };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw Error("SESSION_STATE_INVALID"); }
  return decode(parsed);
}

// ---------------------------------------------------------------- in-memory implementation (process-local)
type Row = { id: string; salonId: string; userId: string; version: number; stateSchema: number; state: string; status: ConversationStatus;
  expiresAt: number; leaseUntil?: number; createdAt: number; updatedAt: number };
/** The same contract in process memory: the reference implementation and the double the orchestrator tests use (two
 * SalonSecretary instances sharing one store behave like two workers sharing the database). Rows are visible only to their
 * own salon and user, as with RLS. */
export class InMemorySessionStore implements SecretarySessionStore {
  readonly rows = new Map<string, Row>();
  readonly events: StoredEvent[] = [];
  private last = 0;
  constructor(private readonly now: () => number = () => Date.now()) {}
  private own(actor: ServiceActor, id: string) {
    const row = this.rows.get(uuid.parse(id));
    return row && row.salonId === actor.salonId && row.userId === actor.userId ? row : undefined;
  }
  /** Strictly increasing, so "most recently updated" is well defined even within one millisecond. */
  private stamp() { return this.last = Math.max(this.now(), this.last + 1); }
  private append(actor: ServiceActor, row: Row, event?: ConversationEvent) {
    if (!event) return;
    if (this.events.some(item => item.conversationId === row.id && item.seq === row.version)) throw Error("EVENT_SEQUENCE_CONFLICT");
    const turn = event.clientTurnId === undefined ? null : uuid.parse(event.clientTurnId);
    const clientTurnId = turn && !this.events.some(item => item.conversationId === row.id && item.clientTurnId === turn) ? turn : null;
    this.events.push({ conversationId: row.id, salonId: actor.salonId, userId: actor.userId, seq: row.version, kind: z.enum(CONVERSATION_EVENT_KINDS).parse(event.kind), clientTurnId, payload: eventPayload(event.payload) });
  }
  async create(actor: ServiceActor, id: string, value: ConversationRecord) {
    const checked = checkedRecord(value), now = this.now();
    for (const [key, row] of this.rows) if (row.salonId === actor.salonId && row.userId === actor.userId && row.expiresAt <= now) {
      this.rows.delete(key); this.events.splice(0, this.events.length, ...this.events.filter(item => item.conversationId !== key));
    }
    if (this.rows.has(uuid.parse(id))) throw Error("SESSION_EXISTS");
    const at = this.stamp();
    this.rows.set(id, { id, salonId: actor.salonId, userId: actor.userId, version: 1, stateSchema: CONVERSATION_STATE_SCHEMA, ...checked, createdAt: at, updatedAt: at });
  }
  async load(actor: ServiceActor, id: string, options: { lease?: boolean; event?: ConversationEvent } = {}) {
    const row = this.own(actor, id), now = this.now();
    if (!row || row.expiresAt <= now) throw Error("SESSION_NOT_FOUND");
    if (options.lease !== false) {
      if (row.leaseUntil !== undefined && row.leaseUntil > now) throw Error("SESSION_BUSY");
      row.version++; row.leaseUntil = now + CONVERSATION_LEASE_SECONDS * 1000; row.updatedAt = this.stamp();
      this.append(actor, row, options.event);
    }
    return { id: row.id, version: row.version, stateSchema: row.stateSchema, state: row.state, status: row.status, expiresAt: row.expiresAt };
  }
  async save(actor: ServiceActor, id: string, value: ConversationRecord, expectedVersion: number, event?: ConversationEvent) {
    const checked = checkedRecord(value), row = this.own(actor, id);
    if (!row || row.version !== expectedVersion) throw Error("CONCURRENT_UPDATE");
    Object.assign(row, checked, { version: row.version + 1, leaseUntil: undefined, updatedAt: this.stamp() });
    this.append(actor, row, event);
    return row.version;
  }
  async remove(actor: ServiceActor, id: string) {
    const row = this.own(actor, id);
    if (!row) return;
    this.rows.delete(row.id); this.events.splice(0, this.events.length, ...this.events.filter(item => item.conversationId !== row.id));
  }
  async listOpen(actor: ServiceActor) {
    const now = this.now();
    return [...this.rows.values()].filter(row => row.salonId === actor.salonId && row.userId === actor.userId && row.status === "OPEN" && row.expiresAt > now)
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)).slice(0, 50).map(row => ({ id: row.id, updatedAt: row.updatedAt }));
  }
}

// ---------------------------------------------------------------- PostgreSQL implementation
/** Tagged $queryRaw inside withTenant only (RLS: the row must be the authenticated user's, of the active salon); the explicit
 * salon/user predicates repeat it. Each call is its own short transaction; a lease is a row value, never a held lock.
 * One clock: "expiresAt", "createdAt", the lease and every expiry test are the database's now(). The caller's `expiresAt`
 * (its own clock, which a battery may fix far from the database's) only says how long is left, clamped to 0..2 h and never
 * past "createdAt" + 2 h; `load` answers on the caller's clock again. */
export class PostgresSessionStore implements SecretarySessionStore {
  constructor(private readonly now: () => number = () => Date.now()) {}
  /** Seconds the caller's expiry leaves from its own now (0..CONVERSATION_MAX_SECONDS). */
  private secondsLeft(expiresAt: number) { return Math.min(CONVERSATION_MAX_SECONDS, Math.max(0, (expiresAt - this.now()) / 1000)); }
  private async appendEvent(tx: Tx, actor: ServiceActor, id: string, seq: number, event?: ConversationEvent) {
    if (!event) return;
    const kind = z.enum(CONVERSATION_EVENT_KINDS).parse(event.kind);
    if (event.clientTurnId === undefined) {
      await tx.$queryRaw`INSERT INTO "SecretaryConversationEvent" ("id","conversationId","salonId","userId","seq","kind","payload")
        VALUES (${randomUUID()}::uuid, ${id}::uuid, ${actor.salonId}, ${actor.userId}, ${seq}::int, ${kind}, ${JSON.stringify(eventPayload(event.payload))}::jsonb) RETURNING "seq"`;
      return;
    }
    // A repeated message keeps the client's turn id where it was first recorded (UNIQUE(conversationId, clientTurnId)); its event has none.
    const turn = uuid.parse(event.clientTurnId);
    await tx.$queryRaw`INSERT INTO "SecretaryConversationEvent" ("id","conversationId","salonId","userId","seq","kind","clientTurnId","payload")
      VALUES (${randomUUID()}::uuid, ${id}::uuid, ${actor.salonId}, ${actor.userId}, ${seq}::int, ${kind},
        CASE WHEN EXISTS (SELECT 1 FROM "SecretaryConversationEvent" e WHERE e."conversationId" = ${id}::uuid AND e."clientTurnId" = ${turn}::uuid) THEN NULL ELSE ${turn}::uuid END,
        ${JSON.stringify(eventPayload(event.payload))}::jsonb) RETURNING "seq"`;
  }
  async create(actor: ServiceActor, id: string, value: ConversationRecord) {
    const checked = checkedRecord(value), conversation = uuid.parse(id);
    await withTenant(actor, async tx => {
      // Retention: the actor's own expired conversations leave when a new one starts (events cascade).
      await tx.$queryRaw`DELETE FROM "SecretaryConversation" WHERE "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} AND "expiresAt" <= now() RETURNING "id"`;
      await tx.$queryRaw`INSERT INTO "SecretaryConversation" ("id","salonId","userId","status","version","stateSchema","state","expiresAt")
        VALUES (${conversation}::uuid, ${actor.salonId}, ${actor.userId}, ${checked.status}, 1, ${CONVERSATION_STATE_SCHEMA}::int,
          ${JSON.stringify({ json: checked.state })}::jsonb, now() + make_interval(secs => ${this.secondsLeft(checked.expiresAt)}::float8)) RETURNING "id"`;
    });
  }
  async load(actor: ServiceActor, id: string, options: { lease?: boolean; event?: ConversationEvent } = {}): Promise<LoadedConversation> {
    const conversation = uuid.parse(id);
    // The time left on the database's clock (the caller's expiry is its own now + that).
    type Found = { version: number; stateSchema: number; state: string; status: ConversationStatus; remainingMs: number };
    return withTenant(actor, async tx => {
      const rows = options.lease === false
        ? await tx.$queryRaw<Found[]>`SELECT "version","stateSchema","state"->>'json' AS "state","status",
            GREATEST(EXTRACT(EPOCH FROM ("expiresAt" - now())) * 1000, 0)::float8 AS "remainingMs" FROM "SecretaryConversation"
            WHERE "id" = ${conversation}::uuid AND "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} AND "expiresAt" > now()`
        : await tx.$queryRaw<Found[]>`UPDATE "SecretaryConversation" SET "version" = "version" + 1,
            "leaseUntil" = now() + make_interval(secs => ${CONVERSATION_LEASE_SECONDS}::int), "updatedAt" = now()
            WHERE "id" = ${conversation}::uuid AND "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} AND "expiresAt" > now()
              AND ("leaseUntil" IS NULL OR "leaseUntil" <= now())
            RETURNING "version","stateSchema","state"->>'json' AS "state","status",GREATEST(EXTRACT(EPOCH FROM ("expiresAt" - now())) * 1000, 0)::float8 AS "remainingMs"`;
      const row = rows[0];
      if (!row) {
        if (options.lease === false) throw Error("SESSION_NOT_FOUND");
        const [held] = await tx.$queryRaw<{ leased: boolean }[]>`SELECT ("leaseUntil" IS NOT NULL AND "leaseUntil" > now()) AS "leased" FROM "SecretaryConversation"
          WHERE "id" = ${conversation}::uuid AND "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} AND "expiresAt" > now()`;
        throw Error(held?.leased ? "SESSION_BUSY" : "SESSION_NOT_FOUND");
      }
      if (options.lease !== false) await this.appendEvent(tx, actor, conversation, row.version, options.event);
      return { id: conversation, version: row.version, stateSchema: row.stateSchema, state: row.state, status: row.status, expiresAt: this.now() + Math.max(0, Number(row.remainingMs) || 0) };
    });
  }
  async save(actor: ServiceActor, id: string, value: ConversationRecord, expectedVersion: number, event?: ConversationEvent) {
    const checked = checkedRecord(value), conversation = uuid.parse(id), expected = z.number().int().positive().parse(expectedVersion);
    return withTenant(actor, async tx => {
      const [row] = await tx.$queryRaw<{ version: number }[]>`UPDATE "SecretaryConversation" SET "state" = ${JSON.stringify({ json: checked.state })}::jsonb,
          "status" = ${checked.status}, "expiresAt" = LEAST(now() + make_interval(secs => ${this.secondsLeft(checked.expiresAt)}::float8),
            "createdAt" + make_interval(secs => ${CONVERSATION_MAX_SECONDS}::int)), "version" = "version" + 1, "leaseUntil" = NULL, "updatedAt" = now()
        WHERE "id" = ${conversation}::uuid AND "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} AND "version" = ${expected}::int
        RETURNING "version"`;
      if (!row) throw Error("CONCURRENT_UPDATE");
      await this.appendEvent(tx, actor, conversation, row.version, event);
      return row.version;
    });
  }
  async remove(actor: ServiceActor, id: string) {
    const conversation = uuid.parse(id);
    await withTenant(actor, tx => tx.$queryRaw`DELETE FROM "SecretaryConversation" WHERE "id" = ${conversation}::uuid AND "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} RETURNING "id"`);
  }
  async listOpen(actor: ServiceActor) {
    const rows = await withTenant(actor, tx => tx.$queryRaw<{ id: string; updatedAt: Date }[]>`SELECT "id"::text AS "id","updatedAt" FROM "SecretaryConversation"
      WHERE "salonId" = ${actor.salonId} AND "userId" = ${actor.userId} AND "status" = 'OPEN' AND "expiresAt" > now()
      ORDER BY "updatedAt" DESC, "id" LIMIT 50`);
    return rows.map(row => ({ id: row.id, updatedAt: new Date(row.updatedAt).getTime() }));
  }
}

let postgres: PostgresSessionStore | undefined;
/** The runtime's store provider: the PostgreSQL store while SALON_SECRETARY_PERSISTED_STATE is on, else none (the
 * in-memory Map stays the only store). Read on every call. */
export const persistedSessionStore = (): SecretarySessionStore | undefined => persistedStateEnabled() ? postgres ??= new PostgresSessionStore() : undefined;
