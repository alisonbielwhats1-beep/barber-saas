import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** B7 session lifetime and limits through the real plan path (recorded V01 frame; tenant lookups are fixtures copied from
 * secretary-repeated-question.test.ts; no DB, no network): activity slides the TTL (now + 20 min, capped at 2 h from the
 * start), cancelled conversations do not hold a SESSION_LIMIT slot, the server keeps the latest turn's codes for owner
 * feedback, and the view carries the salon's local date for the screen's year reference. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined,
  secretaryDirectory: async () => ({ professionals: ["Rodrigo Lima"], services: [], today: { date: "2026-09-28", weekday: "segunda-feira", timezone: "America/Sao_Paulo" } }),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /rodrigo/i.test(filter.query ?? "") ? [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] : [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: ref === "a-fabio" ? "2026-09-30T16:00" : "2026-10-01T11:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /f[aá]bio/i.test(name) ? [{ id: "c-fabio", name: "Fábio Santos" }] : /amanda/i.test(name) ? [{ id: "c-amanda", name: "Amanda Souza" }] : [] }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const plusHour = (time: string) => `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`;
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => f.customer_ref === "c-fabio" ? [{ appointment_ref: "a-fabio" }] : f.customer_ref === "c-amanda" ? [{ appointment_ref: "a-amanda" }] : [],
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse(operation === "schedule.block"
      ? { ...base, kind: operation, professional_ref: "pro-rodrigo", professional_name: "Rodrigo Lima", startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}` }
      : operation === "appointment.change"
        ? { ...base, kind: operation, appointment_ref: "a-fabio", revision: 1, customer_ref: "c-fabio", customer_name: "Fábio Santos", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
          before_start: "2026-09-30T16:00", before_end: "2026-09-30T17:00", before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${plusHour(f.time)}`, priceCents: 8000 }
        : { ...base, kind: operation, appointment_ref: "a-amanda", revision: 1, customer_ref: "c-amanda", customer_name: "Amanda Souza", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
          before_start: "2026-10-01T11:00", before_end: "2026-10-01T12:00", before_timezone: "America/Sao_Paulo", startLocal: "2026-10-01T11:00", endLocal: "2026-10-01T12:00", priceCents: 9000 }) };
});
import { DRAFT_EXPIRY_MARGIN_MS, SalonSecretary, slidingSessionExpiry } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const T0 = Date.parse("2026-09-28T15:00:00Z"), MIN = 60_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const recorded = JSON.parse(V01_LUNA).turn.operations as Record<string, unknown>[];
const shape = (operation: string, fields: Record<string, unknown>) => ({ ...recorded.find(item => item.operation === operation)!,
  date: null, day_offset: null, weekday: null, time: null, end_time: null, reason: null, ...fields });
const pair = (value: unknown, literal: string) => ({ value, literal });
const v01 = { turn: { mode: "NEW", operations: [
  shape("appointment.change", { day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10 horas") }), shape("appointment.cancel", {}),
  shape("schedule.block", { date: pair("2026-09-29", "dia 29"), time: pair("10:00", "das 10"), end_time: pair("11:00", "às 11") })] } };
const unreadable = call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "ghost", choice: null, fields: {} }] } });
type Internal = { sessions: Map<string, { expires: number; children?: string[]; cancelled: boolean }> };
function secretaryWith(model = new ScriptedServicesModel([call("select_capabilities", v01)])) {
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  return { model, secretary, sessions: () => (secretary as unknown as Internal).sessions };
}

describe("B7 sliding session TTL (in memory; a restart still fails closed)", () => {
  // Review migration (backup: .demo/agenda-core/contract-migration/secretary-b7-sessions.test.before-draft-cap.ts): journal
  // drafts keep a fixed 30-min expiry, so activity never extends a conversation to within 5 min of its earliest open draft's
  // expiry (an answer there would fail the plan's open actions with EXPIRED). Without open drafts the 2 h cap stands.
  it("each successful turn extends to now + 20 min, capped at 2 h from the start and before the earliest open draft expires, never shortened", () => {
    expect(slidingSessionExpiry(T0 + 15 * MIN, T0, T0 + 20 * MIN)).toBe(T0 + 35 * MIN);
    expect(slidingSessionExpiry(T0 + 110 * MIN, T0, T0 + 115 * MIN)).toBe(T0 + 120 * MIN);
    expect(slidingSessionExpiry(T0 + 1 * MIN, T0, T0 + 20 * MIN)).toBe(T0 + 21 * MIN);
    expect(slidingSessionExpiry(T0 + 130 * MIN, T0, T0 + 120 * MIN)).toBe(T0 + 120 * MIN);
    expect(slidingSessionExpiry(T0 + 34 * MIN, T0, T0 + 35 * MIN, T0 + 40 * MIN)).toBe(T0 + 40 * MIN);
    expect(slidingSessionExpiry(T0 + 39 * MIN, T0, T0 + 40 * MIN, T0 + 40 * MIN)).toBe(T0 + 40 * MIN);
    expect(slidingSessionExpiry(T0 + 50 * MIN, T0, T0 + 40 * MIN, T0 + 30 * MIN)).toBe(T0 + 40 * MIN);
    expect(DRAFT_EXPIRY_MARGIN_MS).toBe(5 * MIN);
  });
  it("without open drafts, activity keeps the conversation alive past 20 min, up to 2 h; then SESSION_NOT_FOUND", async () => {
    const chat = call("select_capabilities", { turn: { mode: "CONVERSATION", response: "Oi!" } });
    const { model, secretary, sessions } = secretaryWith(new ScriptedServicesModel([chat]));
    const { sessionId } = await secretary.start(actor, "auto");
    vi.setSystemTime(T0 + 15 * MIN);
    const first = await secretary.send(actor, { sessionId, message: "oi, tudo bem?" });
    expect(first.action_plan).toBeUndefined();
    expect(sessions().get(sessionId)!.expires).toBe(T0 + 35 * MIN);
    // Without the slide this message (at 34 min) would find no session.
    for (const at of [34, 53, 72, 91, 110]) {
      vi.setSystemTime(T0 + at * MIN); appendScriptedResponses(model, [chat]);
      await expect(secretary.send(actor, { sessionId, message: "ainda está aí?" })).resolves.toMatchObject({ sessionId });
    }
    expect(sessions().get(sessionId)!.expires).toBe(T0 + 120 * MIN);
    vi.setSystemTime(T0 + 120 * MIN + 1);
    await expect(secretary.send(actor, { sessionId, message: "ainda está aí?" })).rejects.toThrow("SESSION_NOT_FOUND");
    // Another process (a restart) never sees it.
    await expect(secretaryWith().secretary.send(actor, { sessionId, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
  });
  it("with open drafts (created at 15 min, expiring at 45): the conversation and its child sessions slide only to 40 min; past 30 min of a draft's life the plan is never failed by EXPIRED", async () => {
    const { model, secretary, sessions } = secretaryWith();
    const { sessionId } = await secretary.start(actor, "auto");
    vi.setSystemTime(T0 + 15 * MIN);
    const first = await secretary.send(actor, { sessionId, message: V01_MESSAGE });
    expect(first.today).toBe("2026-09-28");
    const parent = sessions().get(sessionId)!;
    expect(parent.expires).toBe(T0 + 35 * MIN);
    expect(parent.children!.length).toBeGreaterThan(0);
    for (const id of parent.children!) expect(sessions().get(id)!.expires).toBe(T0 + 35 * MIN);
    for (const at of [34, 39]) {
      vi.setSystemTime(T0 + at * MIN); appendScriptedResponses(model, [unreadable]);
      const view = await secretary.send(actor, { sessionId, message: "é por causa da viagem" });
      expect(view.action_plan!.actions.map(action => action.status)).not.toContain("FAILED_SAFE");
    }
    expect(sessions().get(sessionId)!.expires).toBe(T0 + 40 * MIN);
    for (const id of parent.children!) expect(sessions().get(id)!.expires).toBe(T0 + 40 * MIN);
    // 46 min: the drafts (30 min old) are expired; the conversation ended before, so nothing is prepared on them.
    vi.setSystemTime(T0 + 46 * MIN);
    await expect(secretary.send(actor, { sessionId, message: "é por causa da viagem" })).rejects.toThrow("SESSION_NOT_FOUND");
  });
  it("a cancelled conversation is not extended; a session of another salon or user is never reachable", async () => {
    const { secretary, sessions } = secretaryWith();
    const { sessionId } = await secretary.start(actor, "auto");
    vi.setSystemTime(T0 + 10 * MIN);
    await secretary.cancel(actor, sessionId);
    expect(sessions().get(sessionId)!.expires).toBe(T0 + 20 * MIN);
    await expect(secretary.send({ ...actor, userId: "other-user" }, { sessionId, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
    await expect(secretary.send({ ...actor, salonId: "other-salon" }, { sessionId, message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
  });
});

describe("B7 SESSION_LIMIT counts open conversations only", () => {
  it("ten open conversations are the limit; cancelled ones free their slot and the oldest cancelled ones are forgotten", async () => {
    const { secretary, sessions } = secretaryWith();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) { vi.setSystemTime(T0 + i); ids.push((await secretary.start(actor, "auto")).sessionId); }
    await expect(secretary.start(actor, "auto")).rejects.toThrow("SESSION_LIMIT");
    // "Nova conversa" cancels the previous one first: repeated many times it never locks the owner out.
    let current = ids.at(-1)!;
    for (const id of ids.slice(0, -1)) await secretary.cancel(actor, id);
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(T0 + 100 + i);
      await secretary.cancel(actor, current);
      current = (await secretary.start(actor, "auto")).sessionId;
    }
    const kept = [...sessions().values()].filter(s => s.cancelled);
    expect(kept.length).toBeLessThanOrEqual(10);
    expect(sessions().has(ids[0])).toBe(false);
    await expect(secretary.send(actor, { sessionId: ids[0], message: "oi" })).rejects.toThrow("SESSION_NOT_FOUND");
    // A recently cancelled one still answers as closed; the open one is the only open conversation.
    const recent = [...sessions().entries()].filter(([, s]) => s.cancelled).at(-1)![0];
    await expect(secretary.send(actor, { sessionId: recent, message: "oi" })).rejects.toThrow("SESSION_CLOSED");
    expect([...sessions().values()].filter(s => !s.cancelled).length).toBe(1);
  });
});

describe("B7 owner feedback context: codes only, per actor", () => {
  it("the latest message's outcome codes and contract version; nothing for another user or an unknown session", async () => {
    const { secretary } = secretaryWith();
    const { sessionId } = await secretary.start(actor, "auto");
    expect(secretary.feedbackContext(actor, sessionId)).toBeUndefined();
    await secretary.send(actor, { sessionId, message: V01_MESSAGE });
    const context = secretary.feedbackContext(actor, sessionId)!;
    expect(context.codes.length).toBeGreaterThan(0);
    for (const code of context.codes) expect(code).toMatch(/^[A-Z][A-Z0-9_]{1,79}$/);
    expect(context.contract_version).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(context)).not.toMatch(/Fábio|Amanda|Rodrigo|amanhã/i);
    expect(secretary.feedbackContext({ ...actor, userId: "other-user" }, sessionId)).toBeUndefined();
    expect(secretary.feedbackContext(actor, crypto.randomUUID())).toBeUndefined();
  });
});
