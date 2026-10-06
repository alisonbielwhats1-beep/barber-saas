import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C6 JIT (SALON_SECRETARY_JIT_INSTRUCTIONS) through the real plan path (decoder, ActionPlan, scheduling adapters, journal) with
 * recorded frames, fixture tenant lookups, no DB and no network (the fixture of secretary-repeated-question.test.ts). V01: Fábio
 * and Rodrigo are ready, Amanda's cancellation waits for its reason; once she answers, a further correction is a multi-action
 * continuation. With JIT its draft names the open keys (their context is already in the plan) and no requirement instruction. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /rodrigo/i.test(filter.query ?? "") ? [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] : [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: ref === "a-fabio" ? "2026-09-30T16:00" : "2026-10-01T11:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /f[aá]bio/i.test(name) ? [{ id: "c-fabio", name: "Fábio Santos" }] : /amanda/i.test(name) ? [{ id: "c-amanda", name: "Amanda Souza" }] : [] }));
const confirmed = vi.hoisted(() => ({ refs: [] as string[] }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    confirmed.refs.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: "synthetic-appointment" };
  } }));
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
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";
import { CONTINUATION_INSTRUCTION, JIT_APPENDIX_HEADER, jitRules } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = []; confirmed.refs = [];
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
afterEach(() => { vi.unstubAllEnvs(); });
type Sent = { input: { role: string; content: string }[] };
/** The system input and the draft of one request as sent to the model. */
const parts = (request: unknown) => { const [system, draft] = (request as Sent).input; return { system: system.content, draft: JSON.parse(draft.content.slice(draft.content.indexOf(': ') + 2)) as Record<string, unknown> }; };
async function continued() {
  const model = new ScriptedServicesModel([call("select_capabilities", v01)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const say = (message: string) => secretary.send(actor, { sessionId: session.sessionId, message });
  await say(V01_MESSAGE);
  // Amanda's reason: her card is the only pending question (adapter path).
  appendScriptedResponses(model, [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "cancelar_amanda", choice: null, fields: { reason: "ela viajou" } }] } })]);
  const answered = await say("ela viajou");
  expect(answered.action_plan!.actions.map(action => action.status)).toEqual(["READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
  // Three open, none pending: a correction is one interpretation over the whole plan (continueMultipleActions).
  appendScriptedResponses(model, [call("select_capabilities", { turn: { mode: "PATCH", operations: [{ item_key: "alterar_fabio", choice: null, fields: { time: pair("11:00", "às 11") } }] } })]);
  const corrected = await say("passa o Fábio para às 11");
  return { model, corrected };
}

describe("C6 JIT through the orchestrator", () => {
  it("flag off: the historical continuation (actions repeated in the draft, requirement instruction, no appendix)", async () => {
    const { model, corrected } = await continued();
    expect(model.requests).toHaveLength(3);
    const { system, draft } = parts(model.requests[2]);
    expect(draft.mode).toBe("CONTINUE_EXISTING_PLAN");
    expect((draft.actions as { item_key: string }[]).map(action => action.item_key)).toEqual(corrected.action_plan!.actions.map(action => action.key));
    expect((draft.actions as { clarification?: unknown }[]).every(action => action.clarification)).toBe(true);
    expect(draft).not.toHaveProperty("item_keys");
    expect(system).toContain(JSON.stringify(CONTINUATION_INSTRUCTION));
    for (const request of model.requests) expect(parts(request).system).not.toContain(JIT_APPENDIX_HEADER);
    expect(corrected.action_plan!.actions.find(action => action.key === "alterar_fabio")!.fields).toMatchObject({ time: "11:00" });
  });
  it("flag on: the draft names the open keys, no requirement instruction; the same result", async () => {
    vi.stubEnv("SALON_SECRETARY_JIT_INSTRUCTIONS", "true");
    const { model, corrected } = await continued();
    expect(model.requests).toHaveLength(3);
    // First turn: no plan, no state-bound rule.
    expect(parts(model.requests[0]).system).not.toContain(JIT_APPENDIX_HEADER);
    const { system, draft } = parts(model.requests[2]), open = corrected.action_plan!.actions.map(action => action.key);
    expect(draft).toEqual({ mode: "CONTINUE_EXISTING_PLAN", item_keys: open });
    expect(system).not.toContain(CONTINUATION_INSTRUCTION);
    expect(system).toContain("\nRequisitos atuais do backend: {}\n");
    // Every open key is still published in full in the plan context, and the multi-action rules are appended once.
    for (const key of open) expect(system).toContain(`"item_key":"${key}"`);
    for (const rule of [jitRules.patch, jitRules.ambiguousTarget, jitRules.discard, jitRules.clarification]) expect(system.split(rule)).toHaveLength(2);
    expect(corrected.action_plan!.actions.find(action => action.key === "alterar_fabio")!.fields).toMatchObject({ time: "11:00" });
    expect(corrected.action_plan!.actions.map(action => action.status)).toEqual(["READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
  });
});
