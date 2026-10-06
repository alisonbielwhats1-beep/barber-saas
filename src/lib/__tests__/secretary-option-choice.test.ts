import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** B4 option choice by identifier through the real plan path (decoder, ActionPlan, scheduling adapter,
 * journal drafts/proposals). Only tenant lookups are fixtures; no DB, no network, nothing confirmed. */
type Row = { appointment_ref: string; customer_name: string; start_local: string; professional_name: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[],
  customers: [] as { id: string; name: string; phone: string }[], appointments: {} as Record<string, Row[]>, busy: [] as string[], moves: 0 }));
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
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string; source_time?: string; time?: string }, operation: string) =>
      (db.appointments[f.customer_ref ?? ""] ?? []).filter(row => { const clock = operation === "appointment.change" ? f.source_time : f.time; return !clock || row.start_local.slice(11, 16) === clock; }),
    inspectSchedulingMove: async (_tx: unknown, _actor: unknown, _ref: string, date: string, time: string) => { db.moves++;
      return db.busy.includes(time) ? { result: { violation: "SLOT_TAKEN" }, alternatives: ["15:00", "17:00"].map(clock => ({ startLocal: `${date}T${clock}`, endLocal: `${date}T${plusHour(clock)}`, professional_ref: "pro-tatiana" })) }
        : { result: {}, alternatives: [] }; },
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const { customer, row } = find(f.appointment_ref)!;
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: customer, customer_name: row.customer_name,
        professional_ref: "pro-tatiana", professional_name: row.professional_name, before_start: row.start_local, before_end: `${row.start_local.slice(0, 11)}${plusHour(row.start_local.slice(11, 16))}`,
        before_timezone: "America/Sao_Paulo", startLocal: operation === "appointment.change" ? `${f.date}T${f.time}` : row.start_local,
        endLocal: operation === "appointment.change" ? `${f.date}T${plusHour(f.time)}` : `${row.start_local.slice(0, 11)}${plusHour(row.start_local.slice(11, 16))}`, priceCents: 8000 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { InMemoryNameAliasStore, candidateSetHash, useNameAliasStore } from "../secretary-name-aliases";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const souza = { id: "c-souza", name: "Amanda Souza", phone: "(11) *****-0001" }, lima = { id: "c-lima", name: "Amanda Lima", phone: "(11) *****-0002" };
const early: Row = { appointment_ref: "appt-early", customer_name: "Amanda Souza", start_local: "2026-10-01T10:00", professional_name: "Tatiana Rocha" };
const late: Row = { appointment_ref: "appt-late", customer_name: "Amanda Souza", start_local: "2026-10-01T14:00", professional_name: "Tatiana Rocha" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z")); // Monday; "sexta" = 02/10
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = []; db.customers = [souza]; db.appointments = { "c-souza": [early, late], "c-lima": [{ appointment_ref: "appt-lima", customer_name: "Amanda Lima", start_local: "2026-10-01T11:00", professional_name: "Tatiana Rocha" }] };
  db.busy = []; db.moves = 0;
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
const action = (view: SecretaryView) => view.action_plan!.actions[0];
const failed = () => (db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").at(-1)?.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? [];
const confirmed = () => db.rows.some(row => row.action === "CONFIRMED");
const reschedule = newTurn({ operation: "appointment.change", customer_name: "Amanda", weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") });
const firstMessage = "Remarca a Amanda para sexta às 16h";

describe("appointment option chosen by id (GF13 'O das 14h.' without echoing the day)", () => {
  it("publishes positional option ids (never refs) and selects the chosen appointment: a proposal, never a confirmation", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }));
    const card = await run.say(firstMessage);
    expect(child(card).scheduling!.candidates!.items.map(item => item.id)).toEqual(["appt-early", "appt-late"]);
    expect(action(card)).toMatchObject({ status: "NEEDS_INPUT" });
    const chosen = await run.say("O das 14h.");
    // The answer's request carried the card as option ids and labels only.
    const request = JSON.stringify(run.model.requests[1].input);
    expect(request).toContain('\\"option_id\\":\\"opt_2\\"'); expect(request).not.toContain("appt-late");
    expect(child(chosen).scheduling!.fields).toMatchObject({ appointment_ref: "appt-late", date: "2026-10-02", time: "16:00" });
    expect(action(chosen).status).toBe("READY_FOR_CONFIRMATION");
    expect(child(chosen).scheduling!.proposal).toBeDefined();
    expect(confirmed()).toBe(false); expect(run.model.requests).toHaveLength(2);
    expect(failed().filter(code => code.startsWith("OPTION_"))).toEqual([]);
  });
  it("an agreeing echo of the option's clock is dropped; the rest of the answer (a new time) applies after the choice", async () => {
    const run = await conversation(reschedule, patch({ source_time: pair("14:00", "das 14h"), time: pair("17:00", "17h") }, { option_id: "opt_2", literal: "O das 14h" }));
    await run.say(firstMessage);
    const chosen = await run.say("O das 14h, e passa pra 17h.");
    expect(child(chosen).scheduling!.fields).toMatchObject({ appointment_ref: "appt-late", date: "2026-10-02", time: "17:00" });
    expect(child(chosen).scheduling!.fields.source_time).toBeUndefined();
    expect(action(chosen).status).toBe("READY_FOR_CONFIRMATION"); expect(confirmed()).toBe(false);
  });
  it("an echo that disagrees with the option asks again: nothing is picked, the card stays", async () => {
    const run = await conversation(reschedule, patch({ source_time: pair("10:00", "das 14h") }, { option_id: "opt_2", literal: "das 14h" }));
    await run.say(firstMessage);
    const asked = await run.say("O das 14h.");
    expect(child(asked).scheduling!.fields.appointment_ref).toBeUndefined();
    expect(child(asked).scheduling!.candidates!.items.map(item => item.id)).toEqual(["appt-early", "appt-late"]);
    expect(asked.message).toMatch(/^Não consegui aplicar essa escolha com segurança; nada foi alterado nesse item\.\n\n/);
    expect(asked.message).toContain("Qual agendamento");
    expect(action(asked).status).toBe("NEEDS_INPUT"); expect(failed()).toContain("OPTION_ECHO_MISMATCH");
  });
  it.each([
    ["an id the card never published", { option_id: "opt_3", literal: "o terceiro" }, "O terceiro.", "OPTION_STALE"],
    ["a literal that is not in the message", { option_id: "opt_2", literal: "o segundo" }, "O das 14h.", "OPTION_LITERAL_ABSENT"],
  ] as const)("%s asks again softly (no throw, no pick)", async (_label, choice, message, code) => {
    const run = await conversation(reschedule, patch({}, choice));
    await run.say(firstMessage);
    const asked = await run.say(message);
    expect(child(asked).scheduling!.fields.appointment_ref).toBeUndefined();
    expect(child(asked).scheduling!.candidates!.items).toHaveLength(2);
    expect(asked.message).toContain("Não consegui aplicar essa escolha com segurança");
    expect(failed()).toContain(code); expect(confirmed()).toBe(false);
  });
  it("an option whose appointment left the tenant's current list is refused by the fresh re-query and asked again", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "das 14h" }));
    await run.say(firstMessage);
    db.appointments["c-souza"] = [early, { ...late, appointment_ref: "appt-other" }]; // cancelled meanwhile; the card is stale
    const asked = await run.say("O das 14h.");
    expect(child(asked).scheduling!.fields.appointment_ref).toBeUndefined();
    expect(failed()).toContain("OPTION_SELECTION_INVALID"); expect(asked.message).toContain("Não consegui aplicar essa escolha");
  });
  it("the recorded echo-only answer (no choice) keeps working through the historical path", async () => {
    const run = await conversation(reschedule, patch({ source_time: pair("14:00", "das 14h") }));
    await run.say(firstMessage);
    const chosen = await run.say("O das 14h.");
    expect(child(chosen).scheduling!.fields).toMatchObject({ appointment_ref: "appt-late" });
    expect(action(chosen).status).toBe("READY_FOR_CONFIRMATION");
  });
});

describe("customer homonym chosen by id, then re-echoed (the loop the entity map found)", () => {
  const cancel = newTurn({ operation: "appointment.cancel", customer_name: "Amanda", reason: "ela viajou" });
  it("selects Amanda Lima by id; later echoes of the query or of the chosen name keep her (no second identical question)", async () => {
    db.customers = [souza, lima];
    const run = await conversation(cancel,
      patch({ customer_name: "Amanda Lima" }, { option_id: "opt_2", literal: "Lima" }),
      patch({ customer_name: "amanda", reason: "ela adoeceu" }),
      patch({ customer_name: "Amanda Lima", reason: "ela mudou de cidade" }));
    const card = await run.say("Cancela a Amanda porque ela viajou");
    expect(child(card).scheduling!.candidates).toMatchObject({ kind: "customer_ref", items: [{ id: "c-souza", name: "Amanda Souza · (11) *****-0001" }, { id: "c-lima", name: "Amanda Lima · (11) *****-0002" }] });
    const chosen = await run.say("A Lima.");
    expect(child(chosen).scheduling!.fields).toMatchObject({ customer_ref: "c-lima", appointment_ref: "appt-lima", customer_name: "Amanda" });
    expect(action(chosen).status).toBe("READY_FOR_CONFIRMATION");
    const echoedQuery = await run.say("a amanda, porque ela adoeceu");
    expect(child(echoedQuery).scheduling!.fields).toMatchObject({ customer_ref: "c-lima", appointment_ref: "appt-lima", reason: "ela adoeceu" });
    expect(child(echoedQuery).scheduling!.candidates).toBeUndefined(); expect(action(echoedQuery).status).toBe("READY_FOR_CONFIRMATION");
    const echoedChoice = await run.say("a Amanda Lima, porque ela mudou de cidade");
    expect(child(echoedChoice).scheduling!.fields).toMatchObject({ customer_ref: "c-lima", appointment_ref: "appt-lima", reason: "ela mudou de cidade" });
    expect(action(echoedChoice).status).toBe("READY_FOR_CONFIRMATION"); expect(confirmed()).toBe(false);
  });
  it("a name that contradicts the chosen option asks again", async () => {
    db.customers = [souza, lima];
    const run = await conversation(cancel, patch({ customer_name: "Amanda Souza" }, { option_id: "opt_2", literal: "Lima" }));
    await run.say("Cancela a Amanda porque ela viajou");
    const asked = await run.say("A Lima.");
    expect(child(asked).scheduling!.fields.customer_ref).toBeUndefined(); expect(child(asked).scheduling!.candidates!.items).toHaveLength(2);
    expect(failed()).toContain("OPTION_ECHO_MISMATCH");
  });
});

describe("review 2b: the choice literal itself must single out the chosen option, on every card", () => {
  it("an appointment literal naming another clock never selects the option Luna picked (wrong id, correct words)", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_1", literal: "das 14h" }));
    await run.say(firstMessage);
    const asked = await run.say("O das 14h.");
    expect(child(asked).scheduling!.fields.appointment_ref).toBeUndefined();
    expect(child(asked).scheduling!.candidates!.items.map(item => item.id)).toEqual(["appt-early", "appt-late"]);
    expect(action(asked).status).toBe("NEEDS_INPUT"); expect(failed()).toContain("OPTION_ECHO_MISMATCH");
    expect(child(asked).scheduling!.proposal).toBeUndefined(); expect(confirmed()).toBe(false);
  });
  it("a half-day clock and a daypart read against the options' own coordinates ('o das 2h' = 14h, 'o da manhã' = 10h)", async () => {
    for (const [message, literal, option, ref] of [["O das 2h.", "das 2h", "opt_2", "appt-late"], ["O da manhã.", "O da manhã", "opt_1", "appt-early"]] as const) {
      db.rows = [];
      const run = await conversation(reschedule, patch({}, { option_id: option, literal }));
      await run.say(firstMessage);
      const chosen = await run.say(message);
      expect(child(chosen).scheduling!.fields.appointment_ref, message).toBe(ref); expect(action(chosen).status).toBe("READY_FOR_CONFIRMATION");
    }
    expect(confirmed()).toBe(false);
  });
  it("an ordinal picks by position on an appointment card; a contradicting ordinal asks again", async () => {
    const run = await conversation(reschedule, patch({}, { option_id: "opt_2", literal: "o segundo" }));
    await run.say(firstMessage);
    expect(child(await run.say("O segundo.")).scheduling!.fields.appointment_ref).toBe("appt-late");
    const again = await conversation(reschedule, patch({}, { option_id: "opt_1", literal: "o segundo" }));
    await again.say(firstMessage);
    const asked = await again.say("O segundo.");
    expect(child(asked).scheduling!.fields.appointment_ref).toBeUndefined(); expect(failed()).toContain("OPTION_ECHO_MISMATCH");
  });
  const cancel = newTurn({ operation: "appointment.cancel", customer_name: "Amanda", reason: "ela viajou" });
  it.each([
    ["a name token every option shares", { option_id: "opt_1", literal: "Amanda" }, "É a Amanda.", "OPTION_NAME_REQUIRED"],
    ["'sim' (nothing that names an option)", { option_id: "opt_2", literal: "sim" }, "sim", "OPTION_NAME_REQUIRED"],
    ["'essa' (nothing that names an option)", { option_id: "opt_1", literal: "essa" }, "essa", "OPTION_NAME_REQUIRED"],
    ["the other homonym's own name (wrong id)", { option_id: "opt_1", literal: "Lima" }, "a Lima", "OPTION_ECHO_MISMATCH"],
    ["a denied name ('a Lima não')", { option_id: "opt_2", literal: "a Lima" }, "a Lima não, a outra", "OPTION_LITERAL_NEGATED"],
  ] as const)("ordinary homonym card (no suggestion): %s never picks; nothing is prepared", async (_label, choice, message, code) => {
    db.customers = [souza, lima];
    const run = await conversation(cancel, patch({}, choice));
    const card = await run.say("Cancela a Amanda porque ela viajou");
    expect(child(card).scheduling!.candidates!.source).toBeUndefined();
    const next = await run.say(message);
    expect(child(next).scheduling!.fields.customer_ref).toBeUndefined(); expect(child(next).scheduling!.candidates!.items).toHaveLength(2);
    expect(action(next).status).toBe("NEEDS_INPUT"); expect(child(next).scheduling!.proposal).toBeUndefined();
    expect(failed()).toContain(code); expect(next.message).toContain("Não consegui aplicar essa escolha com segurança"); expect(confirmed()).toBe(false);
  });
  it.each([
    ["the option's own surname", { option_id: "opt_2", literal: "Lima" }, "a Lima", "c-lima"],
    ["an ordinal", { option_id: "opt_2", literal: "a segunda" }, "a segunda", "c-lima"],
    ["the phone ending", { option_id: "opt_2", literal: "final 0002" }, "a de final 0002", "c-lima"],
  ] as const)("ordinary homonym card: %s picks exactly that option (a proposal, never a confirmation)", async (_label, choice, message, ref) => {
    db.customers = [souza, lima];
    const run = await conversation(cancel, patch({}, choice));
    await run.say("Cancela a Amanda porque ela viajou");
    const chosen = await run.say(message);
    expect(child(chosen).scheduling!.fields.customer_ref).toBe(ref); expect(action(chosen).status).toBe("READY_FOR_CONFIRMATION");
    expect(failed().filter(code => code.startsWith("OPTION_"))).toEqual([]); expect(confirmed()).toBe(false);
  });
});

describe("D1 review (SALON_SECRETARY_NAME_ALIASES): an alias card is click-only", () => {
  // Two customers are named Amanda; the salon learned "amanda" → Amanda Lima from the owner's click on their homonym card.
  const cancel = newTurn({ operation: "appointment.cancel", customer_name: "Amanda", reason: "ela viajou" });
  it("Luna's choice of the proposal (the owner wrote only the shared name) never resolves it; the owner's click does", async () => {
    vi.stubEnv("SALON_SECRETARY_NAME_ALIASES", "true");
    const store = new InMemoryNameAliasStore(), restore = useNameAliasStore(store);
    try {
      db.customers = [souza, lima];
      (db.tx as unknown as Record<string, unknown>).clientProfile = { findFirst: async ({ where }: { where: { id: string } }) =>
        [souza, lima].find(row => row.id === where.id) ? { ...[souza, lima].find(row => row.id === where.id)!, phone: null } : null };
      await store.learn(actor, { kind: "customer", key: "amanda", targetId: "c-lima", candidateSet: candidateSetHash(["c-souza", "c-lima"]) });
      const run = await conversation(cancel, patch({}, { option_id: "opt_1", literal: "a Amanda" }));
      const card = await run.say("Cancela a Amanda porque ela viajou");
      expect(child(card).scheduling!.candidates).toMatchObject({ kind: "customer_ref", source: "alias", items: [{ id: "c-lima" }, { id: "alias-not-this" }] });
      const asked = await run.say("isso, a Amanda");
      expect(child(asked).scheduling!.fields.customer_ref).toBeUndefined(); expect(child(asked).scheduling!.candidates).toMatchObject({ source: "alias" });
      expect(action(asked).status).toBe("NEEDS_INPUT"); expect(child(asked).scheduling!.proposal).toBeUndefined();
      expect(failed()).toContain("OPTION_CLICK_REQUIRED"); expect(asked.message).toContain("Não consegui aplicar essa escolha com segurança");
      const clicked = await run.secretary.selectAutomatic(actor, run.sessionId, asked.operations![0].operation_ref, "c-lima");
      expect(child(clicked).scheduling!.fields).toMatchObject({ customer_ref: "c-lima", appointment_ref: "appt-lima" });
      expect(action(clicked).status).toBe("READY_FOR_CONFIRMATION"); expect(confirmed()).toBe(false);
    } finally { restore(); vi.unstubAllEnvs(); }
  });
});

describe("time-slot alternatives as options (click, no model call)", () => {
  it("the view exposes the backend's alternatives; a click applies that clock and prepares the proposal, never confirms", async () => {
    db.busy = ["16:00"];
    const run = await conversation(newTurn({ operation: "appointment.change", customer_name: "Amanda", source_time: pair("14:00", "das 14h"), weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") }));
    const unavailable = await run.say("Passa a Amanda das 14h para sexta às 16h");
    const view = child(unavailable), ref = unavailable.operations![0].operation_ref;
    expect(view.scheduling!.waiting_for).toBe("time");
    expect(view.options).toEqual([{ option_id: "opt_1", label: "sex, 02/10 às 15h" }, { option_id: "opt_2", label: "sex, 02/10 às 17h" }]);
    expect(JSON.stringify(view.options)).not.toContain("pro-");
    await expect(run.secretary.selectOption(actor, run.sessionId, { operation_ref: ref, option_id: "opt_2", revision: unavailable.action_plan!.revision - 1 })).rejects.toThrow("OPTION_UNAVAILABLE");
    await expect(run.secretary.selectOption(actor, run.sessionId, { operation_ref: ref, option_id: "opt_9", revision: unavailable.action_plan!.revision })).rejects.toThrow("OPTION_UNAVAILABLE");
    const picked = await run.secretary.selectOption(actor, run.sessionId, { operation_ref: ref, option_id: "opt_2", revision: unavailable.action_plan!.revision });
    expect(child(picked).scheduling!.fields).toMatchObject({ appointment_ref: "appt-late", date: "2026-10-02", time: "17:00" });
    expect(child(picked).scheduling!.interpretation_source).toBe("DETERMINISTIC_FAST_PATH");
    expect(action(picked).status).toBe("READY_FOR_CONFIRMATION"); expect(picked.action_plan!.revision).toBeGreaterThan(unavailable.action_plan!.revision);
    expect(child(picked).options).toBeUndefined();
    expect(run.model.requests).toHaveLength(1); expect(confirmed()).toBe(false);
    // The old screen's revision is stale now.
    await expect(run.secretary.selectOption(actor, run.sessionId, { operation_ref: ref, option_id: "opt_1", revision: unavailable.action_plan!.revision })).rejects.toThrow("OPTION_UNAVAILABLE");
  });
});

describe("C3 parity (SALON_SECRETARY_NAME_SUGGESTIONS): a card of a name the owner never wrote", () => {
  // Luna wrote "Amanda" although the message names no one: the rows are only a confirmation card.
  const unproven = newTurn({ operation: "appointment.cancel", customer_name: "Amanda", reason: "ela viajou" });
  it.each([
    ["'sim, essa' by id never resolves it (a click or the name is required)", { option_id: "opt_1", literal: "essa" }, "sim, essa", undefined, "OPTION_NAME_REQUIRED"],
    ["a name token shared by both options is not a choice", { option_id: "opt_1", literal: "Amanda" }, "a Amanda", undefined, "OPTION_NAME_REQUIRED"],
    ["the owner writing the option's own name resolves it", { option_id: "opt_2", literal: "Lima" }, "a Lima", "c-lima", undefined],
  ] as const)("%s", async (_label, choice, message, chosen, code) => {
    vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "true");
    try {
      db.customers = [souza, lima];
      const run = await conversation(unproven, patch({}, choice));
      const card = await run.say("Cancela a cliente de sempre porque ela viajou");
      expect(child(card).scheduling!.candidates).toMatchObject({ kind: "customer_ref", source: "confirm" });
      const next = await run.say(message);
      expect(child(next).scheduling!.fields.customer_ref).toBe(chosen);
      if (code) { expect(failed()).toContain(code); expect(child(next).scheduling!.candidates!.items).toHaveLength(2); }
      else expect(child(next).scheduling!.unproven_names).toBeUndefined();
      expect(confirmed()).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
});
