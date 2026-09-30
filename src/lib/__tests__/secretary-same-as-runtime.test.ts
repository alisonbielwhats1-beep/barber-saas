import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 (flag SALON_SECRETARY_SAME_AS) through the real plan path: decoder, ActionPlan, per-action adapters, journal drafts and
 * proposals, the group executor. Luna frames are recorded (no network); only tenant lookups and the domain confirm are
 * fixtures. Today is Monday 28/09/2026 (São Paulo): "quinta" = 01/10, "sexta" = 02/10, "amanhã" = 29/09. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], moves: [] as { ref: string; date: string; time: string; released?: string }[],
  confirmed: [] as string[], failing: new Set<string>(), messages: [] as Record<string, unknown>[], amandas: 1, brokenServices: false }));
const APPOINTMENTS: Record<string, Record<string, string>> = {
  "a-amanda": { appointment_ref: "a-amanda", customer_ref: "c-amanda", customer_name: "Amanda Souza", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha", start_local: "2026-09-29T15:00", end_local: "2026-09-29T16:00", status: "CONFIRMED" },
  "a-amanda-2": { appointment_ref: "a-amanda-2", customer_ref: "c-amanda", customer_name: "Amanda Souza", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha", start_local: "2026-10-02T09:00", end_local: "2026-10-02T10:00", status: "CONFIRMED" },
  "a-fabio": { appointment_ref: "a-fabio", customer_ref: "c-fabio", customer_name: "Fábio Santos", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha", start_local: "2026-09-30T10:00", end_local: "2026-09-30T11:00", status: "CONFIRMED" },
};
const CUSTOMERS: Record<string, { id: string; name: string }> = { carla: { id: "c-carla", name: "Carla Mendes" }, rosa: { id: "c-rosa", name: "Rosa Lima" },
  amanda: { id: "c-amanda", name: "Amanda Souza" }, fabio: { id: "c-fabio", name: "Fábio Santos" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => {
    if (db.brokenServices && /especial/i.test(name)) throw Error("CATALOG_UNAVAILABLE");
    return /escova/i.test(fold(name)) ? [{ id: "s-escova", name: "Escova" }] : /colora/i.test(fold(name)) ? [{ id: "s-coloracao", name: "Coloração" }] : [];
  },
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string; service_ref?: string }) => {
    const all = [{ id: "pro-tatiana", name: "Tatiana Rocha" }, { id: "pro-rodrigo", name: "Rodrigo Lima" }];
    return filter.query ? all.filter(row => fold(row.name).startsWith(fold(filter.query!).split(" ")[0])) : filter.service_ref ? [all[0]] : all;
  },
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const row = APPOINTMENTS[ref]; if (!row) throw Error("APPOINTMENT_NOT_FOUND"); return row; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../communication-actions", async importOriginal => ({ ...await importOriginal<object>(), assertCommunicationAccess: async () => undefined,
  getCustomerMessageContext: async (_tx: unknown, _actor: unknown, ref: string) => ({ customer_ref: ref, name: "x", masked_recipient: "***", channel: "WHATSAPP", provider: "LOCAL_FAKE", channel_eligible: true, missing_requirements: [], contact_revision: "r", allowed_template_refs: [] }),
  upsertMessageDraft: async (_tx: unknown, _actor: unknown, input: Record<string, unknown>) => { db.messages.push(input); return { draft_ref: crypto.randomUUID(), draft_revision: 1, status: "NEEDS_INPUT", missing_fields: ["channel", "content"],
    operation: "customer.message", recipient: { customer_ref: input.customer_ref, name: "x", masked_recipient: "***", contact_revision: "r" }, fields: {}, expires_at: new Date(Date.now() + 600_000).toISOString() }; } }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, string>) => ({ customer_ref: f.customer_ref, customer_name: f.customer_name, service_ref: f.service_ref, service_revision: "1",
    service_name: f.service_name, professional_ref: f.professional_ref, professional_name: "Tatiana Rocha", date: f.date, startLocal: `${f.date}T${f.time}`,
    endLocal: `${f.date}T${String(Number(f.time.slice(0, 2)) + 1).padStart(2, "0")}${f.time.slice(2)}`,
    timezone: "America/Sao_Paulo", priceCents: 8000, priceType: "FIXED", durationMin: 60, quote: "q" }),
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) => ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref,
    draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }),
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    if (db.failing.has(input.proposal_ref)) throw Error("SLOT_CONFLICT");
    db.confirmed.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "RESCHEDULED", appointment_ref: "synthetic-appointment" };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  // Amanda's 29/09 15h slot is taken by her appointment, unless the move is checked with that appointment released.
  const taken = (date: string, time: string, released?: string) => `${date}T${time}` === APPOINTMENTS["a-amanda"].start_local && released !== "a-amanda";
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => f.customer_ref === "c-fabio" ? [APPOINTMENTS["a-fabio"]]
      : f.customer_ref === "c-amanda" ? [APPOINTMENTS["a-amanda"], APPOINTMENTS["a-amanda-2"]].slice(0, db.amandas) : [],
    inspectSchedulingMove: async (_tx: unknown, _actor: unknown, ref: string, date: string, time: string, _excluded?: unknown, released?: string) => {
      db.moves.push({ ref, date, time, ...(released ? { released } : {}) });
      return taken(date, time, released) ? { result: { violation: "SLOT_TAKEN" }, alternatives: [] } : { result: {}, alternatives: [] };
    },
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>, released?: string) => {
      const row = APPOINTMENTS[f.appointment_ref];
      if (operation === "appointment.change" && taken(f.date, f.time, released)) throw Error("SLOT_CONFLICT");
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: row.customer_ref, customer_name: row.customer_name,
        professional_ref: row.professional_ref, professional_name: row.professional_name, before_start: row.start_local, before_end: row.end_local, before_timezone: "America/Sao_Paulo",
        startLocal: operation === "appointment.change" ? `${f.date}T${f.time}` : row.start_local, endLocal: operation === "appointment.change" ? `${f.date}T${f.time}` : row.end_local, priceCents: 8000 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_SAME_AS", "true");
  db.rows = []; db.moves = []; db.confirmed = []; db.failing = new Set(); db.messages = []; db.amandas = 1;
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const pair = (value: unknown, literal: string) => ({ value, literal });
const op = (item_key: string, operation: string, fields: Record<string, unknown> = {}) => ({ operation, item_key, depends_on: null, released_slot_of: null, same_as: null, source_scope: null,
  customer_name: null, service_name: null, professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null,
  source_weekday: null, source_time: null, end_time: null, end_date: null, reason: null, destination_mode: null, override_requested: null, override_reason: null, ...fields });
const ref = (field: string, item_key: string, literal: string) => ({ field, item_key, literal });
const turn = (mode: string, operations: unknown[]) => ({ turn: { mode, operations } });

async function conversation(first: unknown) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const say = (message: string, next?: [string, unknown]) => { if (next) appendScriptedResponses(model, [call(next[0], next[1])]); return secretary.send(actor, { sessionId: session.sessionId, message }); };
  return { model, secretary, sessionId: session.sessionId, say };
}
const read = (view: SecretaryView) => ({
  action: (key: string) => view.action_plan!.actions.find(item => item.key === key)!,
  child: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state,
  group: (key: string) => view.action_plan!.confirmation_groups.find(group => group.action_keys.includes(key))!,
});
const codes = () => (db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").at(-1)?.metadata as { outcome?: { divergence: { failed_codes: string[] } } } | undefined)?.outcome?.divergence.failed_codes ?? [];
const proposals = (field: string, value: string) => db.rows.filter(row => row.action === "PROPOSAL" && (row.metadata as { fields: Record<string, string> }).fields[field] === value);
const approvals = (view: SecretaryView) => view.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: view.action_plan!.plan_ref, revision: view.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint }));

// C06: "Marca a Carla para Escova quinta às 14h e a Rosa para Coloração no mesmo dia às 15h."
const C06 = "Marca a Carla para Escova quinta às 14h e a Rosa para Coloração no mesmo dia às 15h.";
const carla = (fields: Record<string, unknown> = {}) => op("carla", "appointment.create", { customer_name: "Carla", service_name: "Escova", source_scope: "Marca a Carla para Escova quinta às 14h",
  weekday: pair(4, "quinta"), time: pair("14:00", "às 14h"), ...fields });
const rosa = (fields: Record<string, unknown> = {}) => op("rosa", "appointment.create", { customer_name: "Rosa", service_name: "Coloração", source_scope: "a Rosa para Coloração no mesmo dia às 15h",
  same_as: [ref("date", "carla", "no mesmo dia")], time: pair("15:00", "às 15h"), ...fields });

describe("C06 'no mesmo dia': the dependent copies the referenced action's ACCEPTED day", () => {
  it("Rosa is prepared on Carla's grounded Thursday; both confirmable in ONE group; the link is a data edge only", async () => {
    const { say } = await conversation(turn("NEW", [carla(), rosa()]));
    const view = await say(C06), r = read(view);
    expect(r.action("carla").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.action("rosa").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.child("rosa").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "15:00", customer_ref: "c-rosa" });
    expect(r.child("rosa").scheduling!.references).toMatchObject({ seeded: { date: "2026-10-01" } });
    expect(r.group("rosa").action_keys.sort()).toEqual(["carla", "rosa"]);
    expect(r.group("rosa").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.action("rosa")).toMatchObject({ depends_on: [], same_as: [ref("date", "carla", "no mesmo dia")] });
    expect(view.action_plan!.execution_order).toEqual(["carla", "rosa"]);
    expect(codes()).toContain("SAME_AS_SEEDED");
  });
  it("Luna's raw day is never copied: an unproven day of Carla leaves Rosa WAITING (a note, never a question or a guess)", async () => {
    const { say } = await conversation(turn("NEW", [carla({ weekday: null, date: pair("2026-10-01", "no dia combinado") }), rosa()]));
    const view = await say(C06.replace("quinta ", "")), r = read(view);
    expect(r.child("carla").scheduling!.fields.date).toBeUndefined();
    expect(r.action("rosa")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["date"] });
    expect(r.child("rosa").scheduling!.fields.date).toBeUndefined();
    expect(r.child("rosa").scheduling!.proposal).toBeUndefined();
    expect(r.child("rosa").scheduling!.references).toMatchObject({ waiting: ["date"], blocked: true });
    expect(view.message).toContain("Para qual dia é o agendamento de Carla?");
    expect(view.message).toContain("Agendar — Rosa: aguardando o dia do agendamento de Carla.");
    expect(view.message).not.toMatch(/Para qual dia é o agendamento de Rosa/);
    expect(proposals("customer_ref", "c-rosa")).toEqual([]);
    expect(codes()).toContain("SAME_AS_WAITING");
  });
  it("the waiting Rosa follows Carla's day as soon as it is answered (no model value copied, one interpretation)", async () => {
    const { say, model } = await conversation(turn("NEW", [carla({ weekday: null, date: pair("2026-10-01", "no dia combinado") }), rosa()]));
    await say(C06.replace("quinta ", ""));
    const view = await say("Quinta.", ["select_capabilities", turn("PATCH", [{ item_key: "carla", choice: null, fields: { weekday: pair(4, "Quinta") } }])]), r = read(view);
    expect(model.requests).toHaveLength(2);
    expect(r.child("carla").scheduling!.fields.date).toBe("2026-10-01");
    expect(r.action("rosa").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.child("rosa").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "15:00" });
    expect(r.child("rosa").scheduling!.references!.waiting ?? []).toEqual([]);
    expect(r.group("rosa").status).toBe("READY_FOR_CONFIRMATION");
    expect(codes()).toContain("SAME_AS_REDERIVED");
  });
  it("a later correction of Carla's day re-derives Rosa: her old proposal is withdrawn, the approval goes stale", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [carla(), rosa()]));
    const before = await say(C06), old = read(before).child("rosa").scheduling!.proposal!.proposal_ref, stale = approvals(before);
    const view = await say("A Carla é na sexta.", ["select_capabilities", turn("PATCH", [{ item_key: "carla", choice: null, fields: { weekday: pair(5, "sexta") } }])]), r = read(view);
    expect(r.child("carla").scheduling!.fields.date).toBe("2026-10-02");
    expect(r.child("rosa").scheduling!.fields.date).toBe("2026-10-02");
    expect(r.child("rosa").scheduling!.proposal!.proposal_ref).not.toBe(old);
    expect(r.action("rosa").status).toBe("READY_FOR_CONFIRMATION");
    await expect(secretary.confirmReadyGroups(actor, sessionId, stale)).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.confirmed).toEqual([]);
  });
  it("Luna ALSO stating a different day: none is chosen, Rosa's day is asked with the cause", async () => {
    const message = "Marca a Carla para Escova quinta às 14h e a Rosa para Coloração no mesmo dia, sexta, às 15h.";
    const { say } = await conversation(turn("NEW", [carla(), rosa({ source_scope: "a Rosa para Coloração no mesmo dia, sexta, às 15h", weekday: pair(5, "sexta") })]));
    const view = await say(message), r = read(view);
    // The contradicted day is reconciled first (entity lookup waits for it, as for any rejected day).
    expect(r.action("rosa").status).toBe("NEEDS_INPUT");
    expect(r.action("rosa").missing_fields).toContain("date");
    expect(r.child("rosa").scheduling!.fields.date).toBeUndefined();
    expect(r.child("rosa").scheduling!.proposal).toBeUndefined();
    expect(view.message).toContain("Recebi indicações diferentes para o dia e não escolhi nenhuma.");
    expect(view.message).toContain("Para qual dia é o agendamento de Rosa?");
    expect(r.action("rosa").same_as).toBeUndefined();
    expect(codes()).toContain("SAME_AS_CONFLICT");
    expect(proposals("date", "2026-10-02")).toEqual([]);
  });
  it("Luna ALSO stating the same day agrees: seeded, no question", async () => {
    const message = "Marca a Carla para Escova quinta às 14h e a Rosa para Coloração no mesmo dia, quinta, às 15h.";
    const { say } = await conversation(turn("NEW", [carla(), rosa({ source_scope: "a Rosa para Coloração no mesmo dia, quinta, às 15h", weekday: pair(4, "quinta") })]));
    const r = read(await say(message));
    expect(r.action("rosa").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.child("rosa").scheduling!.fields.date).toBe("2026-10-01");
    expect(codes()).toContain("SAME_AS_AGREED");
  });
  it.each([
    ["absent from the message", "no mesmo dia", "Marca a Carla para Escova quinta às 14h e a Rosa para Coloração às 15h.", "a Rosa para Coloração às 15h"],
    ["a value of its own, not a reference", "quinta", "Marca a Carla para Escova às 14h e a Rosa para Coloração quinta às 15h.", "a Rosa para Coloração quinta às 15h"],
    ["negated", "no mesmo dia", "Marca a Carla para Escova quinta às 14h e a Rosa para Coloração, não no mesmo dia, às 15h.", "a Rosa para Coloração, não no mesmo dia, às 15h"],
  ])("an unproven reference literal (%s) is not honored: Rosa's day is asked, never copied", async (_label, literal, message, scope) => {
    const { say } = await conversation(turn("NEW", [carla({ source_scope: message.slice(0, message.indexOf(" e a Rosa")) }), rosa({ source_scope: scope, same_as: [ref("date", "carla", literal)] })]));
    const view = await say(message), r = read(view);
    expect(r.action("rosa").status).toBe("NEEDS_INPUT");
    expect(r.action("rosa").missing_fields).toContain("date");
    expect(r.child("rosa").scheduling!.fields.date).toBeUndefined();
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
  });
  it("a referenced action that could not be prepared releases the link: the dependent's day is asked (never guessed)", async () => {
    const { say } = await conversation(turn("NEW", [carla({ service_name: "Escova Especial" }), rosa()]));
    db.brokenServices = true;
    try {
      const view = await say(C06.replace("Escova", "Escova Especial")), r = read(view);
      expect(r.action("carla").status).toBe("FAILED_SAFE");
      expect(r.action("rosa").status).toBe("NEEDS_INPUT");
      expect(r.action("rosa").missing_fields).toContain("date");
      expect(r.action("rosa").same_as).toBeUndefined();
      expect(r.child("rosa").scheduling!.references).toMatchObject({ asked: ["date"] });
      expect(codes()).toContain("SAME_AS_GONE");
    } finally { db.brokenServices = false; }
  });
  it("discarding the referenced action releases a waiting link: the dependent's day becomes a normal question", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [carla({ weekday: null, date: pair("2026-10-01", "no dia combinado") }), rosa()]));
    const waiting = await say(C06.replace("quinta ", ""));
    const view = await secretary.discardAction(actor, sessionId, { plan_ref: waiting.action_plan!.plan_ref, action_key: "carla" }), r = read(view);
    expect(r.action("carla").status).toBe("DISCARDED");
    expect(r.action("rosa")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["date"] });
    expect(r.action("rosa").same_as).toBeUndefined();
    expect(r.child("rosa").scheduling!.references).toMatchObject({ asked: ["date"] });
    // B7: once resolved, the question names the customer as registered (backup: contract-migration/secretary-same-as-runtime.test.before-b7.ts).
    expect(view.message).toContain("Para qual dia é o agendamento de Rosa Lima?");
  });
  it("ADD: a later 'e a Rosa no mesmo dia' references the active plan's Carla (same group, her accepted day)", async () => {
    const { say } = await conversation(turn("NEW", [carla()]));
    await say("Marca a Carla para Escova quinta às 14h.");
    const view = await say("E a Rosa para Coloração no mesmo dia às 15h.", ["upsert_action_draft", turn("ADD", [rosa({ source_scope: "a Rosa para Coloração no mesmo dia às 15h" })])]), r = read(view);
    expect(r.action("rosa").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.child("rosa").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "15:00" });
    expect(r.group("rosa").action_keys.sort()).toEqual(["carla", "rosa"]);
  });
  it("'no mesmo dia e horário com ela': the second booking with the same professional at the same time is asked (never a double booking); answering its time ends only that link", async () => {
    const message = "Marca a Carla para Escova quinta às 14h com a Tatiana e a Rosa para Coloração no mesmo dia e horário com ela.";
    const { say } = await conversation(turn("NEW", [carla({ professional_name: "Tatiana", source_scope: "Marca a Carla para Escova quinta às 14h com a Tatiana" }),
      rosa({ time: null, source_scope: "a Rosa para Coloração no mesmo dia e horário com ela",
        same_as: [ref("date", "carla", "no mesmo dia e horário"), ref("time", "carla", "no mesmo dia e horário"), ref("professional", "carla", "com ela")] })]));
    const view = await say(message), r = read(view);
    expect(r.action("carla").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.child("rosa").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "14:00", professional_ref: "pro-tatiana" });
    expect(r.action("rosa")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["time"] });
    expect(r.child("rosa").scheduling!.message).toContain("Tatiana Rocha já estará com Carla das 14h às 15h neste mesmo pedido.");
    const answered = await say("A Rosa às 16h.", ["upsert_action_draft", turn("PATCH", [{ item_key: "rosa", choice: null, fields: { time: pair("16:00", "às 16h") } }])]), a = read(answered);
    expect(a.child("rosa").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "16:00", professional_ref: "pro-tatiana" });
    expect(a.action("rosa").status).toBe("READY_FOR_CONFIRMATION");
    expect(a.action("rosa").same_as!.map(item => item.field)).toEqual(["date", "professional"]);
    expect(codes()).toContain("SAME_AS_OVERRIDDEN");
  });
  it("flag off: the same envelope's reference is refused (the operation is left out and said), nothing is copied", async () => {
    vi.stubEnv("SALON_SECRETARY_SAME_AS", "false");
    const { say } = await conversation(turn("NEW", [carla(), rosa()]));
    const view = await say(C06);
    expect(view.action_plan!.actions.map(action => action.key)).toEqual(["carla"]);
    expect(view.message).toContain("Não entendi com segurança esta parte do pedido");
    expect(codes()).toContain("CAPABILITY_FIELD_MISMATCH");
  });
});

// V27: "Cancela a Amanda e passa o Fábio para o horário dela."
const V27 = "Cancela a Amanda e passa o Fábio para o horário dela.";
const cancel = op("cancelar_amanda", "appointment.cancel", { customer_name: "Amanda", source_scope: "Cancela a Amanda" });
const move = (fields: Record<string, unknown> = {}) => op("passar_fabio", "appointment.change", { customer_name: "Fábio", source_scope: "passa o Fábio para o horário dela",
  same_as: ["date", "time", "professional"].map(field => ref(field, "cancelar_amanda", "para o horário dela")), ...fields });
const reason = ["upsert_action_draft", turn("PATCH", [{ item_key: "cancelar_amanda", choice: null, fields: { reason: "Ela desistiu" } }])] as [string, unknown];

describe("V27 'passa o Fábio para o horário dela': a move into the slot a cancellation of the same request releases", () => {
  it("the move is prepared on Amanda's located slot as released, runs after the cancellation, in the same group; only the reason is asked", async () => {
    const { say } = await conversation(turn("NEW", [cancel, move()]));
    const view = await say(V27), r = read(view);
    expect(r.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
    expect(r.action("passar_fabio").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.child("passar_fabio").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "15:00", appointment_ref: "a-fabio" });
    expect(db.moves.filter(item => item.ref === "a-fabio")).toEqual([{ ref: "a-fabio", date: "2026-09-29", time: "15:00", released: "a-amanda" }]);
    // The execution edge is derived from the reference: the cancellation always runs first, in the same group.
    expect(r.action("passar_fabio").depends_on).toEqual(["cancelar_amanda"]);
    expect(view.action_plan!.execution_order).toEqual(["cancelar_amanda", "passar_fabio"]);
    expect(view.action_plan!.confirmation_groups).toHaveLength(1);
    expect(view.action_plan!.confirmation_groups[0].status).toBe("NEEDS_REVIEW");
    expect(view.message).toBe("Qual o motivo do cancelamento?");
    // A change keeps its professional: that reference is a no-op, the date/time links stay.
    expect(r.action("passar_fabio").same_as!.map(item => item.field)).toEqual(["date", "time"]);
    expect(codes()).toEqual(expect.arrayContaining(["SAME_AS_SEEDED", "SAME_AS_RELEASED_SLOT", "SAME_AS_PROFESSIONAL_KEPT"]));
  });
  it("after the reason, one confirmation runs the cancellation, then the move (the executor re-checks the real agenda)", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [cancel, move()]));
    await say(V27);
    const ready = await say("Ela desistiu.", reason), r = read(ready);
    expect(ready.action_plan!.actions.map(action => action.status)).toEqual(["READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
    expect(ready.message).toContain("Remarcar agendamento — Fábio Santos só poderá ocorrer após cancelar agendamento — Amanda Souza."); // B7: resolved names (backup: contract-migration/secretary-same-as-runtime.test.before-b7.ts)
    expect(ready.message).toContain("Confira os detalhes antes de confirmar.");
    const order = [r.child("cancelar_amanda").scheduling!.proposal!.proposal_ref, r.child("passar_fabio").scheduling!.proposal!.proposal_ref];
    const done = await secretary.confirmReadyGroups(actor, sessionId, approvals(ready));
    expect(db.confirmed).toEqual(order);
    expect(done.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["cancelar_amanda", "DONE"], ["passar_fabio", "DONE"]]);
  });
  it("fail safe: if the slot was taken meanwhile the move fails alone; the cancellation (the owner's own intent) stays done", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [cancel, move()]));
    await say(V27);
    const ready = await say("Ela desistiu.", reason);
    db.failing.add(read(ready).child("passar_fabio").scheduling!.proposal!.proposal_ref);
    const done = await secretary.confirmReadyGroups(actor, sessionId, approvals(ready));
    expect(done.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["cancelar_amanda", "DONE"], ["passar_fabio", "FAILED_SAFE"]]);
  });
  it("fail safe: if the cancellation fails the move never runs (blocked by its execution edge)", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [cancel, move()]));
    await say(V27);
    const ready = await say("Ela desistiu.", reason);
    db.failing.add(read(ready).child("cancelar_amanda").scheduling!.proposal!.proposal_ref);
    const done = await secretary.confirmReadyGroups(actor, sessionId, approvals(ready));
    expect(db.confirmed).toEqual([]);
    expect(done.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["cancelar_amanda", "FAILED_SAFE"], ["passar_fabio", "BLOCKED_BY_DEPENDENCY"]]);
  });
  it("two Amandas: the move WAITS for the chosen appointment (never Fábio's own day, never a guess), then follows it", async () => {
    db.amandas = 2;
    const { say, secretary, sessionId } = await conversation(turn("NEW", [cancel, move({ same_as: [ref("date", "cancelar_amanda", "para o horário dela")], time: pair("11:00", "às 11h"),
      source_scope: "passa o Fábio para o horário dela às 11h" })]));
    const view = await say("Cancela a Amanda e passa o Fábio para o horário dela às 11h."), r = read(view);
    expect(r.action("passar_fabio")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["date"] });
    expect(r.child("passar_fabio").scheduling!.proposal).toBeUndefined();
    // GF14: a waiting day is never inherited from Fábio's own appointment (30/09).
    expect(proposals("date", "2026-09-30")).toEqual([]);
    expect(r.child("passar_fabio").scheduling!.fields.date).toBeUndefined();
    expect(view.message).toContain("Qual agendamento você deseja?\n• Amanda Souza — ter, 29/09 às 15h — Tatiana Rocha\n• Amanda Souza — sex, 02/10 às 9h — Tatiana Rocha");
    expect(view.message).toContain("Remarcar agendamento — Fábio: aguardando o dia do cancelamento de Amanda.");
    const picked = await secretary.selectAutomatic(actor, sessionId, view.operations!.find(item => item.action_keys?.includes("cancelar_amanda"))!.operation_ref, "a-amanda-2"), p = read(picked);
    expect(p.child("passar_fabio").scheduling!.fields).toMatchObject({ date: "2026-10-02", time: "11:00" });
    expect(p.action("passar_fabio").status).toBe("READY_FOR_CONFIRMATION");
    // A day-only reference does not release a slot: no execution edge is derived.
    expect(p.action("passar_fabio").depends_on).toEqual([]);
  });
});

describe("'avisa ela': the message recipient follows the booking's customer", () => {
  it("the message is prepared for Carla's resolved customer, never a new name search", async () => {
    const message = "Marca a Carla para Escova quinta às 14h e avisa ela.";
    const notify = { operation: "customer.message", item_key: "avisar", depends_on: null, released_slot_of: null, source_scope: "avisa ela",
      same_as: [ref("customer", "carla", "ela")], communication: { recipient_name: null, channel: null, message_mode: null, content: null } };
    const { say } = await conversation(turn("NEW", [carla({ source_scope: "Marca a Carla para Escova quinta às 14h" }), notify]));
    const view = await say(message), r = read(view);
    expect(r.child("avisar").communication!.target).toBe("c-carla");
    expect(db.messages.at(-1)).toMatchObject({ customer_ref: "c-carla" });
    expect(r.group("avisar").action_keys.sort()).toEqual(["avisar", "carla"]);
    expect(codes()).toContain("SAME_AS_SEEDED");
  });
});

describe("review: a repeated reference literal without a verified clause proves nothing", () => {
  it("'o Fábio não no mesmo dia': Carla's day is never seeded into the dependent the owner excluded from it (asked)", async () => {
    const message = "Marca a Carla para Escova quinta às 14h, a Rosa para Coloração no mesmo dia às 15h e o Fábio para Escova não no mesmo dia, às 16h.";
    const fabio = op("fabio", "appointment.create", { customer_name: "Fábio", service_name: "Escova", source_scope: null, same_as: [ref("date", "carla", "no mesmo dia")], time: pair("16:00", "às 16h") });
    const { say } = await conversation(turn("NEW", [carla(), rosa({ source_scope: null }), fabio]));
    const view = await say(message), r = read(view);
    expect(r.action("fabio").status).toBe("NEEDS_INPUT"); expect(r.action("fabio").missing_fields).toContain("date");
    expect(r.child("fabio").scheduling!.fields.date).toBeUndefined();
    expect(proposals("customer_ref", "c-fabio")).toEqual([]);
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
  });
});

describe("review: 'avisa ela' then a customer correction", () => {
  it("the recipient follows Rosa, but the text drafted for Carla never follows her: content and mode are dropped and asked again", async () => {
    const message = "Marca a Carla para Escova quinta às 14h e avisa ela educadamente que está confirmado.";
    const notify = { operation: "customer.message", item_key: "avisar", depends_on: null, released_slot_of: null, source_scope: "avisa ela educadamente que está confirmado",
      same_as: [ref("customer", "carla", "ela")], communication: { recipient_name: null, channel: "WHATSAPP", message_mode: "GENERATED", content: "Olá, Carla! Seu horário de quinta às 14h está confirmado." } };
    const { say } = await conversation(turn("NEW", [carla({ source_scope: "Marca a Carla para Escova quinta às 14h" }), notify]));
    const first = read(await say(message));
    expect(first.child("avisar").communication!.target).toBe("c-carla");
    expect(first.child("avisar").communication!.fields).toMatchObject({ message_mode: "GENERATED", content: "Olá, Carla! Seu horário de quinta às 14h está confirmado." });
    const view = await say("Na verdade é a Rosa.", ["upsert_action_draft", turn("PATCH", [{ item_key: "carla", choice: null, fields: { customer_name: "Rosa" } }])]), r = read(view);
    expect(r.child("carla").scheduling!.fields.customer_ref).toBe("c-rosa");
    const moved = r.child("avisar").communication!;
    expect(moved.target).toBe("c-rosa");
    expect(moved.fields.content).toBeUndefined(); expect(moved.fields.message_mode).toBeUndefined();
    expect(moved.proposal).toBeUndefined();
    const last = db.messages.at(-1) as { customer_ref: string; patch: Record<string, unknown> };
    expect(last.customer_ref).toBe("c-rosa"); expect(last.patch).not.toHaveProperty("content");
    expect(JSON.stringify(db.messages.filter(item => item.customer_ref === "c-rosa"))).not.toContain("Carla");
  });
});
