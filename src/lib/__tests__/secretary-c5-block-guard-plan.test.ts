import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 (flag SALON_SECRETARY_BLOCK_OVERLAP_GUARD; owner rule 10 of 30/09) through the real plan path (decoder, ActionPlan, per-action adapters,
 * journal drafts and proposals), with the fixtures of secretary-c4-rb2-rules-runtime.test.ts: a block over an appointment inside a plan is
 * a card (never READY_FOR_CONFIRMATION), the plan asks with the adapter text, and the owner click on a free interval makes it ready.
 * Recorded frames (no network, no model). Today is Monday 28/09/2026 (São Paulo): "quinta" = 01/10. */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; status: string };
const db = vi.hoisted(() => ({ busy: [] as { id: string; name: string; start: string; end: string }[], tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], snapshots: [] as { released?: string; override?: unknown }[], day: [] as string[] }));
const at = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const plusHour = (local: string) => `${local.slice(0, 11)}${String(Number(local.slice(11, 13)) + 1).padStart(2, "0")}${local.slice(13)}`;
const appointment = (ref: string, customer: [string, string], start: string, service: [string, string]): Row => ({ appointment_ref: ref, customer_ref: customer[0], customer_name: customer[1],
  professional_ref: "pro-hortensia", professional_name: "Hortênsia Lobo", service_ref: service[0], services: [{ serviceName: service[1] }], start_local: start, end_local: plusHour(start), start_at: at(start), status: "CONFIRMED" });
const APPOINTMENTS: Record<string, Row> = {
  "a-yolanda": appointment("a-yolanda", ["c-yolanda", "Yolanda Prates"], "2026-10-01T14:00", ["s-drenagem", "Drenagem linfática"]),
  "a-yolanda-sab": appointment("a-yolanda-sab", ["c-yolanda", "Yolanda Prates"], "2026-10-03T10:00", ["s-escova", "Escova modeladora"]),
  "a-ingrid-sab": appointment("a-ingrid-sab", ["c-ingrid", "Ingrid Solano"], "2026-10-03T11:00", ["s-escova", "Escova modeladora"]),
};
const SERVICES: Record<string, string> = { "s-drenagem": "Drenagem linfática", "s-escova": "Escova modeladora" };
const CUSTOMERS: Record<string, { id: string; name: string }> = { yolanda: { id: "c-yolanda", name: "Yolanda Prates" }, ingrid: { id: "c-ingrid", name: "Ingrid Solano" },
  tuane: { id: "c-tuane", name: "Tuane Brito" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => {
    const all = [{ id: "pro-hortensia", name: "Hortênsia Lobo" }, { id: "pro-caio", name: "Caio Ferraz" }];
    return filter.query ? all.filter(row => fold(row.name).startsWith(fold(filter.query!).split(" ")[0])) : all;
  },
  schedulingSelfProfessional: async () => undefined,
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string; professional_ref?: string }) =>
    db.day.map(ref => APPOINTMENTS[ref]).filter(row => row.start_local.startsWith(input.date) && (!input.professional_ref || row.professional_ref === input.professional_ref)),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const row = APPOINTMENTS[ref]; if (!row) throw Error("APPOINTMENT_NOT_FOUND"); return row; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown>, _now?: Date, projection?: { releasedAppointmentId: string }) => {
    db.snapshots.push({ ...(projection ? { released: projection.releasedAppointmentId } : {}), ...(f.override_requested !== undefined ? { override: f.override_requested } : {}) });
    const time = f.time as string, date = f.date as string;
    return { customer_ref: f.customer_ref, customer_name: f.customer_name, service_ref: f.service_ref, service_revision: "1", service_name: SERVICES[f.service_ref as string] ?? f.service_name, professional_ref: f.professional_ref,
      professional_name: "Hortênsia Lobo", date, startLocal: `${date}T${time}`, endLocal: plusHour(`${date}T${time}`), timezone: "America/Sao_Paulo", priceCents: 8000, priceType: "FIXED", durationMin: 60, quote: "q" };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }) }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    // The located appointment's own day: a move's origin (source_date), a cancellation's day.
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string; date?: string; source_date?: string }, operation?: string) => {
      const day = operation === "appointment.change" ? f.source_date : f.date;
      return Object.values(APPOINTMENTS).filter(row => row.customer_ref === f.customer_ref && row.status === "CONFIRMED" && (!day || row.start_local.startsWith(day)));
    },
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const base = { timezone: "America/Sao_Paulo", resource_ids: [], waiting_hash: "", affected: [], priceCents: 8000 };
      if (operation === "schedule.block") { const startLocal = `${f.date}T${f.time}`, endLocal = `${f.end_date ?? f.date}T${f.end_time}`;
        return original.actionSnapshot.parse({ ...base, kind: operation, professional_ref: f.professional_ref, professional_name: "Hortênsia Lobo", startLocal, endLocal, services: [], requires_acceptance: false, waiting_count: 0,
          affected: f.professional_ref === "pro-hortensia" ? db.busy.filter(row => row.start < endLocal && row.end > startLocal).map(row => ({ id: row.id, version: 1, name: row.name, startLocal: row.start })) : [] }); }
      const row = APPOINTMENTS[f.appointment_ref], change = operation === "appointment.change";
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: row.customer_ref, customer_name: row.customer_name,
        professional_ref: row.professional_ref, professional_name: row.professional_name, before_start: row.start_local, before_end: row.end_local, before_timezone: "America/Sao_Paulo",
        startLocal: change ? `${f.date}T${f.time}` : row.start_local, endLocal: change ? plusHour(`${f.date}T${f.time}`) : row.end_local,
        services: row.services.map(s => ({ id: row.service_ref, name: s.serviceName, durationMin: 60, priceCents: 8000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 })),
        requires_acceptance: false, waiting_count: 0 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

const actor = { salonId: "synthetic-spa", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true"); vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "true");
  Object.assign(db, { rows: [], snapshots: [], day: [], busy: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), appointment: { findMany: async ({ where }: { where: { id?: { in: string[] } } }) => db.busy.filter(row => !where.id || where.id.in.includes(row.id))
    .map(row => ({ id: row.id, startAt: new Date(at(row.start)), endAt: new Date(at(row.end)) })) }, auditLog: {
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
const turn = (mode: string, operations: unknown[]) => ({ turn: { mode, operations } });
async function say(first: unknown, message: string) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  return { secretary, sessionId: session.sessionId, view: await secretary.send(actor, { sessionId: session.sessionId, message }) };
}
const read = (view: SecretaryView) => ({
  action: (key: string) => view.action_plan!.actions.find(item => item.key === key)!,
  child: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state,
});

describe("C5 block guard inside a plan (owner rule 10)", () => {
  const text = "fecha a agenda da Hortênsia quinta das 17h às 19h que ela tem médico";
  const block = () => op("bloq", "schedule.block", { professional_name: "Hortênsia", source_scope: text, weekday: pair(4, "quinta"), time: pair("17:00", "das 17h"), end_time: pair("19:00", "às 19h"),
    reason: "ela tem médico" });
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_BLOCK_OVERLAP_GUARD", "true"); db.busy = [{ id: "a-yolanda-qui", name: "Yolanda Prates", start: "2026-10-01T18:00", end: "2026-10-01T19:00" }]; });
  it("the block over the appointment is a card, never ready; the plan asks with who is inside; the free interval click makes it ready", async () => {
    const said = await say(turn("NEW", [block()]), text), r = read(said.view);
    expect(r.action("bloq").status).not.toBe("READY_FOR_CONFIRMATION");
    expect(r.child("bloq").scheduling!.candidates!.kind).toBe("block_overlap_ref");
    expect(JSON.stringify(said.view)).toContain("Hortênsia Lobo tem um agendamento: Yolanda Prates às 18h. Nada foi bloqueado.");
    const operation = said.view.operations!.find(item => item.action_keys?.includes("bloq"))!.operation_ref;
    const picked = read(await said.secretary.selectAutomatic(actor, said.sessionId, operation, "block-free:2026-10-01T17:00|2026-10-01T18:00"));
    expect(picked.action("bloq").status).toBe("READY_FOR_CONFIRMATION");
    expect(picked.child("bloq").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "17:00", end_time: "18:00", professional_ref: "pro-hortensia" });
  });
  it("control: nobody inside, the block is ready as before", async () => {
    db.busy = [];
    expect(read((await say(turn("NEW", [block()]), text)).view).action("bloq").status).toBe("READY_FOR_CONFIRMATION");
  });
  it("flag off: the historical proposal (ready, keeping the appointment)", async () => {
    vi.stubEnv("SALON_SECRETARY_BLOCK_OVERLAP_GUARD", "false");
    expect(read((await say(turn("NEW", [block()]), text)).view).action("bloq").status).toBe("READY_FOR_CONFIRMATION");
  });
});
