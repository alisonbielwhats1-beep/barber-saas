import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** A3-ORIGIN-FROM-REF (flag SALON_SECRETARY_EXCEPTION_RULES_V2): once the owner selects an appointment (click, verified choice by
 * clock or position), the origin roles are that appointment's own coordinates from the fresh tenant row, recorded as ref-derived,
 * and they never outlive the ref (a correction relocates or asks, never narrows on a value the owner did not say). Esmalteria
 * fixture; the real plan path (decoder, ActionPlan, adapter, journal) with scripted Luna answers. Nothing is confirmed. */
type Row = { appointment_ref: string; customer_name: string; start_local: string; professional_name: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[],
  customers: [] as { id: string; name: string; phone: string }[], appointments: {} as Record<string, Row[]> }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => {
    const row = Object.values(db.appointments).flat().find(item => item.appointment_ref === ref);
    if (!row) throw Error("APPOINTMENT_NOT_FOUND");
    return { ...row, status: "CONFIRMED", services: [] };
  } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => db.customers.filter(row => row.name.toLowerCase().includes(name.toLowerCase())) }));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  const plusHour = (time: string) => `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`;
  const find = (ref?: string) => Object.entries(db.appointments).flatMap(([customer, rows]) => rows.map(row => ({ customer, row }))).find(item => item.row.appointment_ref === ref);
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    // The tenant locator: the customer's future appointments narrowed by the origin day and clock the draft holds.
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: Record<string, string | undefined>, operation: string) => {
      const change = operation === "appointment.change", day = change ? f.source_date : f.date, clock = change ? f.source_time : f.time;
      return (db.appointments[f.customer_ref ?? ""] ?? []).filter(row => (!day || row.start_local.startsWith(day)) && (!clock || row.start_local.slice(11, 16) === clock));
    },
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const { customer, row } = find(f.appointment_ref)!;
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: customer, customer_name: row.customer_name,
        professional_ref: "pro-nara", professional_name: row.professional_name, before_start: row.start_local, before_end: `${row.start_local.slice(0, 11)}${plusHour(row.start_local.slice(11, 16))}`,
        before_timezone: "America/Sao_Paulo", startLocal: operation === "appointment.change" ? `${f.date}T${f.time}` : row.start_local,
        endLocal: operation === "appointment.change" ? `${f.date}T${plusHour(f.time)}` : `${row.start_local.slice(0, 11)}${plusHour(row.start_local.slice(11, 16))}`, priceCents: 6500 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

const actor = { salonId: "salon-esmalteria", userId: "owner-esmalteria" };
const heloisa = { id: "c-heloisa", name: "Heloísa Brandão", phone: "(31) *****-0101" };
const appt = (ref: string, start: string): Row => ({ appointment_ref: ref, customer_name: "Heloísa Brandão", start_local: start, professional_name: "Nara Quintela" });
// Thursday 01/10 at 10h and 14h; two 11h appointments on different days (Monday 05/10, Tuesday 06/10).
const [thu10, thu14, mon11, tue11] = [appt("appt-thu10", "2026-10-01T10:00"), appt("appt-thu14", "2026-10-01T14:00"), appt("appt-mon11", "2026-10-05T11:00"), appt("appt-tue11", "2026-10-06T11:00")];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z")); // Monday; "sexta" = 02/10
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2", "true");
  db.rows = []; db.customers = [heloisa]; db.appointments = { "c-heloisa": [thu10, thu14, mon11, tue11] };
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(confirmed()).toBe(false); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const pair = (value: unknown, literal: string) => ({ value, literal });
const newTurn = (operation: Record<string, unknown>) => ({ turn: { mode: "NEW", operations: [{ item_key: "a", ...operation }] } });
const patch = (fields: Record<string, unknown>, choice?: { option_id: string; literal: string }) => ({ tool: "upsert_action_draft", args: { turn: { mode: "PATCH", operations: [{ item_key: "a", ...(choice ? { choice } : {}), fields }] } } });
async function conversation(first: unknown, ...answers: { tool: string; args: unknown }[]) {
  const model = new ScriptedServicesModel([call("select_capabilities", first), ...answers.map(answer => call(answer.tool, answer.args))]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const say = (message: string) => secretary.send(actor, { sessionId: session.sessionId, message });
  return { secretary, sessionId: session.sessionId, model, say };
}
const child = (view: SecretaryView) => view.operations![0].state;
const scheduling = (view: SecretaryView) => child(view).scheduling!;
const action = (view: SecretaryView) => view.action_plan!.actions[0];
const failed = () => (db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").at(-1)?.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? [];
const confirmed = () => db.rows.some(row => row.action === "CONFIRMED");
/** The latest journaled draft of the scheduling adapter (what a later turn reloads). */
const journaled = () => (db.rows.filter(row => row.entityType === "SECRETARY_SCHEDULING" && row.action === "DRAFT").at(-1)?.metadata as { fields: Record<string, unknown> }).fields;
const reschedule = newTurn({ operation: "appointment.change", customer_name: "Heloísa", weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") });
const firstMessage = "Remarca a Heloísa para sexta às 16h";
const cardIds = ["appt-thu10", "appt-thu14", "appt-mon11", "appt-tue11"];

describe("A3: the chosen appointment is the origin (every selection path)", () => {
  it("a choice by its clock ('das 14h') fills source_date/source_time from the fresh row; the destination stays; nothing confirmed", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }));
    const card = await run.say(firstMessage);
    expect(scheduling(card).candidates!.items.map(item => item.id)).toEqual(cardIds);
    const chosen = await run.say("O das 14h.");
    expect(scheduling(chosen).fields).toMatchObject({ appointment_ref: "appt-thu14", source_date: "2026-10-01", source_time: "14:00", date: "2026-10-02", time: "16:00" });
    expect(scheduling(chosen).origin_from_ref).toEqual(["source_date", "source_time"]);
    expect(scheduling(chosen).proposal?.action_snapshot?.before_start).toBe("2026-10-01T14:00");
    expect(journaled()).toMatchObject({ source_date: "2026-10-01", source_time: "14:00", appointment_ref: "appt-thu14" });
    // Luna's next context carries the backend's origin (never a ref).
    expect(action(chosen).fields).toMatchObject({ source_date: "2026-10-01", source_time: "14:00" });
    expect(action(chosen).status).toBe("READY_FOR_CONFIRMATION"); expect(run.model.requests).toHaveLength(2);
  });
  it("flag off: today's behaviour (only the ref; the origin roles stay empty)", async () => {
    vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2", "false");
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }));
    await run.say(firstMessage);
    const chosen = await run.say("O das 14h.");
    expect(scheduling(chosen).fields).toMatchObject({ appointment_ref: "appt-thu14" });
    expect(scheduling(chosen).fields.source_time).toBeUndefined(); expect(scheduling(chosen).fields.source_date).toBeUndefined();
    expect(scheduling(chosen).origin_from_ref).toBeUndefined();
  });
  it("a positional choice ('o segundo', no clock said) is filled from the row too: the origin is the backend's", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "o segundo" }));
    await run.say(firstMessage);
    const chosen = await run.say("O segundo.");
    expect(scheduling(chosen).fields).toMatchObject({ appointment_ref: "appt-thu14", source_date: "2026-10-01", source_time: "14:00" });
  });
  it("the owner's click is filled the same way (parity with the literal choice)", async () => {
    const run = await conversation(reschedule);
    const card = await run.say(firstMessage);
    const clicked = await run.secretary.selectAutomatic(actor, run.sessionId, card.operations![0].operation_ref, "appt-mon11");
    expect(scheduling(clicked).fields).toMatchObject({ appointment_ref: "appt-mon11", source_date: "2026-10-05", source_time: "11:00", date: "2026-10-02", time: "16:00" });
    expect(action(clicked).status).toBe("READY_FOR_CONFIRMATION");
  });
  it("a cancellation card: date/time filled from the row, the literal reason is still asked, nothing proposed meanwhile", async () => {
    const run = await conversation(newTurn({ operation: "appointment.cancel", customer_name: "Heloísa" }), patch({}, { option_id: "opt_2", literal: "das 14h" }));
    const card = await run.say("Cancela o horário da Heloísa");
    expect(scheduling(card).candidates!.items.map(item => item.id)).toEqual(cardIds);
    const chosen = await run.say("O das 14h.");
    expect(scheduling(chosen).fields).toMatchObject({ appointment_ref: "appt-thu14", date: "2026-10-01", time: "14:00" });
    expect(scheduling(chosen).fields.reason).toBeUndefined(); expect(scheduling(chosen).proposal).toBeUndefined();
    expect(action(chosen).status).toBe("NEEDS_INPUT"); expect(action(chosen).missing_fields).toContain("reason");
  });
  it("a later turn that restates the chosen clock keeps the appointment (no 'Preciso confirmar horário original')", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }), patch({ source_time: pair("14:00", "das 14h"), time: pair("17:00", "17h") }));
    await run.say(firstMessage); await run.say("O das 14h.");
    const moved = await run.say("O das 14h passa pra 17h.");
    expect(scheduling(moved).fields).toMatchObject({ appointment_ref: "appt-thu14", source_date: "2026-10-01", source_time: "14:00", time: "17:00" });
    expect(moved.message).not.toContain("Preciso confirmar"); expect(action(moved).status).toBe("READY_FOR_CONFIRMATION");
  });
});
describe("review B (P2 fixer): Luna restating the ref-derived origin is an echo, never a lost appointment", () => {
  it("the plan's test: 'Passa pra 17h.' with Luna re-echoing 14:00 (no clock of the origin in the message) keeps the appointment", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }), patch({ source_time: pair("14:00", "14h"), time: pair("17:00", "17h") }));
    await run.say(firstMessage); await run.say("O das 14h.");
    const moved = await run.say("Passa pra 17h.");
    expect(scheduling(moved).fields).toMatchObject({ appointment_ref: "appt-thu14", source_date: "2026-10-01", source_time: "14:00", time: "17:00" });
    expect(moved.message).not.toContain("Pode informar"); expect(moved.message).not.toContain("Preciso confirmar");
    expect(action(moved).status).toBe("READY_FOR_CONFIRMATION"); expect(scheduling(moved).proposal?.action_snapshot?.before_start).toBe("2026-10-01T14:00");
  });
  it("both roles re-echoed (the row's day and clock) keep the appointment too", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }),
      patch({ source_date: pair("2026-10-01", "quinta"), source_time: pair("14:00", "14h"), time: pair("17:00", "17h") }));
    await run.say(firstMessage); await run.say("O das 14h.");
    const moved = await run.say("Passa pra 17h.");
    expect(scheduling(moved).fields).toMatchObject({ appointment_ref: "appt-thu14", source_date: "2026-10-01", source_time: "14:00", time: "17:00" });
    expect(action(moved).status).toBe("READY_FOR_CONFIRMATION");
  });
  it("adversarial: an unproven DIFFERENT origin is still not applied and the ref goes (never an auto-pick on the row's day)", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }), patch({ source_time: pair("11:00", "11h"), time: pair("17:00", "17h") }));
    await run.say(firstMessage); await run.say("O das 14h.");
    const moved = await run.say("Passa pra 17h.");
    expect(scheduling(moved).fields.appointment_ref).toBeUndefined(); expect(scheduling(moved).fields.source_date).toBeUndefined();
    expect(scheduling(moved).fields.source_time).toBeUndefined(); expect(scheduling(moved).proposal).toBeUndefined();
  });
  it("control, flag off: the same re-echo is refused as today (no ref-derived value to restate)", async () => {
    vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2", "false");
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }), patch({ source_time: pair("14:00", "14h"), time: pair("17:00", "17h") }));
    await run.say(firstMessage); await run.say("O das 14h.");
    const moved = await run.say("Passa pra 17h.");
    expect(scheduling(moved).fields.appointment_ref).toBeUndefined();
  });
});
describe("review B (P2 fixer): provenance clearing does not depend on the flag (a rollback mid-conversation)", () => {
  it("filled while on, flag off, then a clock correction: the row's day is forgotten (adapter and journal); a card, never an auto-pick", async () => {
    db.appointments["c-heloisa"] = [thu10, thu14, { ...mon11, appointment_ref: "appt-mon14", start_local: "2026-10-05T14:00" }];
    const run = await conversation(reschedule, patch({}, { option_id: "opt_1", literal: "das 10h" }), patch({ source_time: pair("14:00", "das 14h") }));
    await run.say(firstMessage); const chosen = await run.say("O das 10h.");
    expect(scheduling(chosen).fields).toMatchObject({ appointment_ref: "appt-thu10", source_date: "2026-10-01", source_time: "10:00" });
    vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2", "false");
    const corrected = await run.say("Na verdade é o das 14h.");
    expect(scheduling(corrected).fields.appointment_ref).toBeUndefined(); expect(scheduling(corrected).fields.source_date).toBeUndefined();
    expect(scheduling(corrected).candidates!.items.map(item => item.id)).toEqual(["appt-thu14", "appt-mon14"]);
    expect(journaled().source_date).toBeUndefined(); expect(scheduling(corrected).proposal).toBeUndefined();
  });
});
describe("A3: ref-derived origin values never outlive the ref (adversarial)", () => {
  it("a clock correction ('na verdade é o das 11h') drops the ref and the row's day: two 11h appointments on other days are a card, never auto-picked", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }), patch({ source_time: pair("11:00", "das 11h") }));
    await run.say(firstMessage); await run.say("O das 14h.");
    const corrected = await run.say("Na verdade é o das 11h.");
    expect(scheduling(corrected).fields.appointment_ref).toBeUndefined();
    expect(scheduling(corrected).fields.source_date).toBeUndefined(); expect(scheduling(corrected).fields.source_time).toBe("11:00");
    expect(scheduling(corrected).candidates!.items.map(item => item.id)).toEqual(["appt-mon11", "appt-tue11"]);
    expect(scheduling(corrected).origin_from_ref).toBeUndefined();
    // The journal never resurrects the old appointment's day beside the new question.
    expect(journaled().source_date).toBeUndefined(); expect(journaled().appointment_ref).toBeUndefined();
    expect(action(corrected).status).toBe("NEEDS_INPUT"); expect(scheduling(corrected).proposal).toBeUndefined();
  });
  it("a day-only correction ('o do dia 5') drops the row's clock: the owner's day alone locates the Monday appointment", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }), patch({ source_date: pair("2026-10-05", "dia 5") }));
    await run.say(firstMessage); await run.say("O das 14h.");
    const corrected = await run.say("Na verdade é o do dia 5.");
    expect(scheduling(corrected).fields).toMatchObject({ appointment_ref: "appt-mon11", source_date: "2026-10-05" });
    expect(scheduling(corrected).fields.source_time).toBeUndefined(); expect(journaled().source_time).toBeUndefined();
    expect(scheduling(corrected).proposal?.action_snapshot?.before_start).toBe("2026-10-05T11:00");
  });
  it("an appointment moved after the card: the choice is refused against fresh coordinates; nothing is filled", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }));
    await run.say(firstMessage);
    db.appointments["c-heloisa"] = [thu10, { ...thu14, start_local: "2026-10-01T15:00" }, mon11, tue11];
    const asked = await run.say("O das 14h.");
    expect(scheduling(asked).fields.appointment_ref).toBeUndefined(); expect(scheduling(asked).fields.source_time).toBeUndefined();
    expect(failed().some(code => code.startsWith("OPTION_"))).toBe(true);
  });
  it("an appointment cancelled after the card: OPTION_SELECTION_INVALID, nothing filled", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }));
    await run.say(firstMessage);
    db.appointments["c-heloisa"] = [thu10, { ...thu14, appointment_ref: "appt-other" }, mon11, tue11];
    const asked = await run.say("O das 14h.");
    expect(scheduling(asked).fields.appointment_ref).toBeUndefined(); expect(scheduling(asked).fields.source_date).toBeUndefined();
    expect(failed()).toContain("OPTION_SELECTION_INVALID");
  });
  it("a negated choice ('essa das 14h não') picks nothing and fills nothing", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }));
    await run.say(firstMessage);
    const asked = await run.say("Essa das 14h não.");
    expect(scheduling(asked).fields.appointment_ref).toBeUndefined(); expect(scheduling(asked).fields.source_time).toBeUndefined();
    expect(failed()).toContain("OPTION_LITERAL_NEGATED");
  });
  it("wire: a later turn's request grows only by the two origin values (flag on vs off, same script)", async () => {
    const size = async (flag: string) => {
      vi.stubEnv("SALON_SECRETARY_EXCEPTION_RULES_V2", flag); db.rows = [];
      const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }), patch({ time: pair("17:00", "17h") }));
      await run.say(firstMessage); await run.say("O das 14h."); await run.say("Passa pra 17h.");
      return Buffer.byteLength(JSON.stringify(run.model.requests[2].input), "utf8");
    };
    const off = await size("false"), on = await size("true");
    console.info(JSON.stringify({ originFromRefWireDelta: on - off, off, on }));
    expect(on - off).toBeGreaterThan(0); expect(on - off).toBeLessThanOrEqual(120);
  });
  it("a ref the card never offered (another tenant's, or forged) is refused before anything is filled", async () => {
    const run = await conversation(reschedule);
    const card = await run.say(firstMessage);
    await expect(run.secretary.selectAutomatic(actor, run.sessionId, card.operations![0].operation_ref, "appt-foreign")).rejects.toThrow("SELECTION_INVALID");
  });
});
