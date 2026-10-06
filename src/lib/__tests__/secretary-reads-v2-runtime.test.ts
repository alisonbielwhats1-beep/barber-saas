import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** P3b (flag SALON_SECRETARY_READS_V2) through the real plan path: decoder, ActionPlan, the read adapter, journal drafts and the
 * plan's presentation. Luna frames are recorded (no network, no model); only tenant lookups are fixtures. Today is Tuesday
 * 29/09/2026 (São Paulo), "amanhã" = 30/09. A barbershop with diverse synthetic names; no gender is inferred from any name. */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; end_at: string; status: string; timezone: string; revision: number; priceCents: number };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], day: [] as Row[], upcoming: [] as Row[], slots: {} as Record<string, string[]> }));
const at = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const PROS = [{ id: "pro-caio", name: "Caio Brito" }, { id: "pro-jonas", name: "Jonas Ferraz" }, { id: "pro-nara", name: "Nara Quintela" }];
const row = (ref: string, customer: [string, string], pro: { id: string; name: string }, start: string, status = "CONFIRMED"): Row => ({ appointment_ref: ref, customer_ref: customer[0],
  customer_name: customer[1], professional_ref: pro.id, professional_name: pro.name, service_ref: "s-corte", services: [{ serviceName: "Corte masculino" }], start_local: start, end_local: start,
  start_at: at(start), end_at: at(start), status, timezone: "America/Sao_Paulo", revision: 1, priceCents: 5000 });
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => fold(name).startsWith("corte") ? [{ id: "s-corte", name: "Corte masculino" }] : [],
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => filter.query ? PROS.filter(pro => fold(pro.name).startsWith(fold(filter.query!))) : PROS,
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { professional_ref: string; date: string }, _now?: unknown, _projection?: unknown, _excluded?: unknown, limit = 5) => ({
    plan: null, timezone: "America/Sao_Paulo",
    alternatives: (db.slots[input.professional_ref] ?? []).slice(0, limit).map(time => ({ startLocal: `${input.date}T${time}`, endLocal: `${input.date}T${time}`, professional_ref: input.professional_ref })) }),
  listSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string; professional_ref?: string }) =>
    db.day.filter(r => r.start_local.startsWith(input.date) && (!input.professional_ref || r.professional_ref === input.professional_ref)).slice(0, 51),
  summarizeSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string }) => {
    const rows = db.day.filter(r => r.start_local.startsWith(input.date));
    return { total: rows.length, cancelled: 0, more: false, periods: { morning: rows.length, afternoon: 0, evening: 0 },
      professionals: PROS.map(pro => { const own = rows.filter(r => r.professional_ref === pro.id); return { professional_ref: pro.id, professional_name: pro.name, count: own.length, first_local: own[0].start_local, last_local: own.at(-1)!.start_local }; }) };
  },
  listUpcomingCustomerAppointments: async (_tx: unknown, _actor: unknown, customer: string, options: { take?: number }) => db.upcoming.filter(r => r.customer_ref === customer).slice(0, options.take ?? 3),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const found = [...db.day, ...db.upcoming].find(r => r.appointment_ref === ref); if (!found) throw Error("APPOINTMENT_NOT_FOUND"); return found; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => [{ id: "c-hiroshi", name: "Hiroshi Tanaka" }, { id: "c-duda", name: "Duda Ramos" }].filter(c => fold(c.name).startsWith(fold(name))) }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER" }));
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";

const actor = { salonId: "synthetic-barbershop", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_READS_V2", "true");
  Object.assign(db, { rows: [], day: [], upcoming: [], slots: {} });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(r => Object.entries(where).every(([key, value]) => r[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const r = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(r); return r; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null) } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const pair = (value: unknown, literal: string) => ({ value, literal });
const turn = (mode: string, operations: unknown[]) => ({ turn: { mode, operations } });
async function conversation(first: unknown) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const say = (message: string, next?: [string, unknown]) => { if (next) appendScriptedResponses(model, [call(next[0], next[1])]); return secretary.send(actor, { sessionId: session.sessionId, message }); };
  return { say };
}
const action = (view: SecretaryView, key = "a") => view.action_plan!.actions.find(item => item.key === key)!;
const child = (view: SecretaryView, key = "a") => view.operations!.find(item => item.action_keys?.includes(key))!.state;
const noWrite = () => expect(db.rows.filter(r => ["PROPOSAL", "CONFIRMED"].includes(String(r.action)))).toEqual([]);

describe("C32 in a plan: 'quando é o próximo horário do Hiroshi?'", () => {
  it("answered as the next appointments (no day asked), the read is done", async () => {
    db.upcoming = [row("u1", ["c-hiroshi", "Hiroshi Tanaka"], PROS[0], "2026-10-01T10:00"), row("u2", ["c-hiroshi", "Hiroshi Tanaka"], PROS[2], "2026-10-08T16:30", "PENDING")];
    const { say } = await conversation(turn("NEW", [{ item_key: "a", operation: "appointment.list", customer_name: "Hiroshi" }]));
    const view = await say("quando é o próximo horário do Hiroshi?");
    expect(action(view).status).toBe("DONE");
    expect(view.message).toContain("Próximos agendamentos de Hiroshi Tanaka:\nqui, 01/10 às 10h — Corte masculino com Caio Brito\nqui, 08/10 às 16h30 — Corte masculino com Nara Quintela · pendente");
    expect(view.message).not.toMatch(/Para qual dia|Informe/);
    noWrite();
  });
  it("flag off: the day is asked (historical)", async () => {
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    const { say } = await conversation(turn("NEW", [{ item_key: "a", operation: "appointment.list", customer_name: "Hiroshi" }]));
    const view = await say("quando é o próximo horário do Hiroshi?");
    expect(action(view).status).toBe("NEEDS_INPUT");
    expect(action(view).missing_fields).toContain("date");
  });
});

describe("C30/C31 in a plan: 'tem horário amanhã à tarde pra corte?' with three barbers", () => {
  const ask = () => turn("NEW", [{ item_key: "a", operation: "availability.get", service_name: "corte", day_offset: pair(1, "amanhã"), period: "afternoon" }]);
  it("each barber's free times, no 'Qual profissional?', nothing reserved", async () => {
    db.slots = { "pro-caio": ["13:00", "13:30"], "pro-jonas": ["12:00", "12:15", "12:30", "12:45", "13:00", "13:15"], "pro-nara": [] };
    const { say } = await conversation(ask());
    const view = await say("tem horário amanhã à tarde pra corte?");
    expect(action(view).status).toBe("DONE");
    expect(view.message).toContain(["Horários livres para corte em qua, 30/09 à tarde:", "Jonas Ferraz: 12h, 12h15, 12h30, 12h45, 13h e há mais", "Caio Brito: 13h, 13h30",
      "Sem horário livre nesse período: Nara Quintela.", "A consulta não reserva o horário."].join("\n"));
    expect(view.message).not.toContain("Qual profissional");
    expect(child(view).scheduling!.fields.professional_ref).toBeUndefined();
    noWrite();
  });
  it("flag off: the historical question with the barbers as options", async () => {
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    const { say } = await conversation(ask());
    const view = await say("tem horário amanhã à tarde pra corte?");
    expect(action(view).status).toBe("NEEDS_INPUT");
    expect(child(view).scheduling!.candidates?.kind).toBe("professional_ref");
  });
});

describe("C29 in a plan: 'como está a agenda amanhã?' on a full day", () => {
  it("summarized per barber with a question; the owner's pick lists that barber's day", async () => {
    db.day = Array.from({ length: 60 }, (_, i) => row(`b${i}`, [`c-${i}`, `Cliente Sintético ${i}`], PROS[i % 3], `2026-09-30T${String(8 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}`));
    const { say } = await conversation(turn("NEW", [{ item_key: "a", operation: "appointment.list", day_offset: pair(1, "amanhã") }]));
    const first = await say("como está a agenda amanhã?");
    expect(action(first).status).toBe("NEEDS_INPUT");
    expect(first.message).toContain("Agenda em qua, 30/09: 60 agendamentos, mais do que listo de uma vez.\nCaio Brito: 20 agendamentos, das 8h às 17h30");
    expect(first.message).toContain("De qual profissional ou período você quer a lista?");
    expect(first.message).not.toMatch(/Restrinja/i);
    expect(child(first).scheduling!.candidates?.items.map(item => item.name)).toEqual(["Caio Brito · 20", "Jonas Ferraz · 20", "Nara Quintela · 20"]);
    const second = await say("a da Nara", ["upsert_action_draft", turn("PATCH", [{ item_key: "a", choice: { option_id: "opt_3", literal: "Nara" }, fields: {} }])]);
    expect(action(second).status).toBe("DONE");
    expect(second.message).toContain("Agenda de Nara Quintela em qua, 30/09:\n8h20 — Cliente Sintético 2 (Corte masculino) com Nara Quintela");
    noWrite();
  });
});
