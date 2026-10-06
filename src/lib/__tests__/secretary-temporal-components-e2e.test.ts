import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C1 end to end: recorded Luna frames with temporal components through the real plan path
 * (decoder, ActionPlan, per-action adapters, applySchedulingInterpretation, journal drafts and
 * proposals). Only tenant lookups are fixtures; no DB, no network, nothing confirmed. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async () => [{ id: "s-escova", name: "Escova" }, { id: "s-escova-p", name: "Escova Progressiva" }],
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /rodrigo/i.test(filter.query ?? "") ? [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] : [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: "2026-09-30T16:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /f[aá]bio/i.test(name) ? [{ id: "c-fabio", name: "Fábio Santos" }]
    : /amanda/i.test(name) ? [{ id: "c-amanda", name: "Amanda Souza" }] : /c[eé]lia/i.test(name) ? [{ id: "c-celia", name: "Célia Prado" }] : /julia/i.test(name) ? [{ id: "c-julia", name: "Julia" }] : [] }));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => f.customer_ref ? [{ appointment_ref: "a-" + f.customer_ref.slice(2) }] : [],
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse(operation === "schedule.block"
      ? { ...base, kind: operation, professional_ref: "pro-rodrigo", professional_name: "Rodrigo Lima", startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}` }
      : { ...base, kind: operation, appointment_ref: "a-fabio", revision: 1, customer_ref: "c-fabio", customer_name: "Fábio Santos", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
        before_start: "2026-09-30T16:00", before_end: "2026-09-30T17:00", before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${f.time}`, priceCents: 8000 }) };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { applySchedulingInterpretation, schedulingState } from "../secretary-scheduling";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
  // Sunday 2026-09-27 12:00 in São Paulo: 'amanhã' and 'dia vinte e oito' are both Monday 28.
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-27T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const flag = (on: boolean) => vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", on ? "true" : "false");

const day = (value: Record<string, unknown>) => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const clock = (hour: number, minute = 0, daypart = "UNSPECIFIED") => ({ hour, minute, daypart });
const none = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
const legacyNulls = { date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null, source_weekday: null, source_time: null, end_time: null, end_date: null };
const op = (operation: string, item_key: string, source_scope: string, fields: Record<string, unknown>, components: Record<string, unknown> | null) => ({
  operation, item_key, depends_on: null, released_slot_of: null, source_scope, customer_name: null, service_name: null, professional_name: null, reason: null,
  ...legacyNulls, ...fields, components: components && { ...none, ...components } });
const OWNER = "altera o horario do fabio pra amanha as dez cancela o horario da amanda e fecha a agenda do rodrigo das dez as onze do dia vinte e oito";
const ownerFrame = JSON.stringify({ turn: { mode: "NEW", operations: [
  op("appointment.change", "alterar_fabio", "altera o horario do fabio pra amanha as dez", { customer_name: "fabio" },
    { date: { value: day({ kind: "RELATIVE_DAY", offset: 1 }), literal: "amanha" }, time: { value: clock(10), literal: "as dez" } }),
  op("appointment.cancel", "cancelar_amanda", "cancela o horario da amanda", { customer_name: "amanda" }, null),
  op("schedule.block", "bloquear_rodrigo", "fecha a agenda do rodrigo das dez as onze do dia vinte e oito", { professional_name: "rodrigo" },
    { date: { value: day({ kind: "DAY_OF_MONTH", day: 28 }), literal: "dia vinte e oito" }, time: { value: clock(10), literal: "das dez as onze" }, end_time: { value: clock(11), literal: "das dez as onze" } }),
] } });

async function prepare(raw: string, message: string) {
  const model = new ScriptedServicesModel([call("select_capabilities", JSON.parse(raw))]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const view = await secretary.send(actor, { sessionId: session.sessionId, message });
  expect(model.requests).toHaveLength(1);
  const action = (key: string) => view.action_plan!.actions.find(item => item.key === key)!;
  const child = (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state as SecretaryView;
  const router = db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").at(-1)?.metadata as { outcome?: { temporal_shadow?: unknown[]; divergence: { failed_codes: string[] } } } | undefined;
  return { view, action, child, outcome: router?.outcome };
}

describe("owner's 3-action request in voice style, components on", () => {
  it("change and block become confirmable cards from components; the cancel asks only its reason; nothing executes", async () => {
    flag(true);
    const run = await prepare(ownerFrame, OWNER);
    expect(run.action("alterar_fabio").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("alterar_fabio").scheduling!.fields).toMatchObject({ date: "2026-09-28", time: "10:00", appointment_ref: "a-fabio" });
    expect(run.action("bloquear_rodrigo").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("bloquear_rodrigo").scheduling!.fields).toMatchObject({ date: "2026-09-28", time: "10:00", end_time: "11:00", professional_ref: "pro-rodrigo" });
    expect(run.child("bloquear_rodrigo").scheduling!.fields.end_date).toBeUndefined();
    expect(run.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
    expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false);
    expect(run.outcome?.divergence.failed_codes).not.toContain("TEMPORAL_SCOPE_UNCLAIMED_DATE");
    // Shadow telemetry: closed role names and codes only.
    const shadow = run.outcome!.temporal_shadow!;
    expect(shadow).toEqual(expect.arrayContaining([{ field: "date", legacy: "REJECTED", components: "OK", equal: false }]));
    expect(shadow.every(entry => Object.keys(entry as object).join() === "field,legacy,components,equal")).toBe(true);
    expect(JSON.stringify(shadow)).not.toMatch(/fabio|rodrigo|amanda|dez|onze|2026|10:00/i);
  });
  it("with the flag off the same components prove nothing: no action is confirmable from them", async () => {
    flag(false);
    const run = await prepare(ownerFrame, OWNER);
    for (const key of ["alterar_fabio", "bloquear_rodrigo"]) {
      expect(run.action(key).status).not.toBe("READY_FOR_CONFIRMATION");
      expect(run.child(key).scheduling!.proposal).toBeUndefined();
      expect(run.child(key).scheduling!.fields.time).toBeUndefined();
    }
  });
  it.each([false, true])("the recorded V01 legacy frame keeps decoding and grounding the same (flag %s)", async on => {
    flag(on);
    const run = await prepare(V01_LUNA, V01_MESSAGE);
    expect(run.action("bloquear_rodrigo").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.action("alterar_fabio").missing_fields).toContain("date");
    expect(run.outcome?.temporal_shadow).toBeUndefined();
  });
});

describe("applySchedulingInterpretation with components (create, change, negation)", () => {
  const apply = (message: string, result: Record<string, unknown>) => {
    const state = schedulingState();
    return applySchedulingInterpretation(actor, state, result as Parameters<typeof applySchedulingInterpretation>[2], message).then(() => state);
  };
  it("create, owner 05/10 (flag SALON_SECRETARY_SERVICE_SWAP_V2): 'escova' is the service named exactly Escova, never asked against Escova Progressiva", async () => {
    flag(true); vi.stubEnv("SALON_SECRETARY_SERVICE_SWAP_V2", "true");
    const state = await apply("marca a julia amanha as 10 pra escova", { operation: "appointment.create", customer_name: "julia", service_name: "escova",
      temporal_evidence: [{ field: "date", text: "amanha", component: day({ kind: "RELATIVE_DAY", offset: 1 }) }, { field: "time", text: "as 10", component: clock(10) }] });
    expect(state.fields).toMatchObject({ service_ref: "s-escova" });
    expect(state.message).not.toBe("Qual serviço? Selecione uma opção real.");
    vi.unstubAllEnvs();
  });
  it("create: 'amanha as 10' grounded from components before entity questions", async () => {
    flag(true);
    const state = await apply("marca a julia amanha as 10 pra escova", { operation: "appointment.create", customer_name: "julia", service_name: "escova",
      temporal_evidence: [{ field: "date", text: "amanha", component: day({ kind: "RELATIVE_DAY", offset: 1 }) }, { field: "time", text: "as 10", component: clock(10) }] });
    expect(state.fields).toMatchObject({ date: "2026-09-28", time: "10:00", customer_ref: "c-julia" });
    expect(state.draft!.temporal_missing ?? []).toEqual([]);
    expect(state.message).toBe("Qual serviço? Selecione uma opção real.");
  });
  it("GF14 change: a new day without a time still asks the time", async () => {
    flag(true);
    const state = await apply("Quero mudar a reserva da Célia de quarta às 15h para sexta.", { operation: "appointment.change", customer_name: "Célia",
      temporal_evidence: [{ field: "date", text: "sexta", component: day({ kind: "WEEKDAY", weekday: 5 }) },
        { field: "source_date", text: "quarta", component: day({ kind: "WEEKDAY", weekday: 3 }) }, { field: "source_time", text: "às 15h", component: clock(15) }] });
    expect(state.fields).toMatchObject({ source_date: "2026-09-30", source_time: "15:00", date: "2026-10-02", appointment_ref: "a-celia" });
    expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();
    expect(state.waiting_for).toBe("time");expect(state.message).toBe("Informe horário exato.");
  });
  it("negation still rejects: 'nao marca a julia amanha as 10' never becomes a proposal", async () => {
    flag(true);
    const state = await apply("nao marca a julia amanha as 10", { operation: "appointment.create", customer_name: "julia",
      temporal_evidence: [{ field: "date", text: "amanha", component: day({ kind: "RELATIVE_DAY", offset: 1 }) }, { field: "time", text: "as 10", component: clock(10) }] });
    expect(state.fields.date).toBeUndefined();expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();
    expect(state.message).toContain("A interpretação de data ou horário divergiu");
  });
  it("'sexta que vem' asks which Friday and keeps both out of the draft", async () => {
    flag(true);
    // On Sunday the coming Friday is next week's Friday (no question); on Monday they differ.
    const sunday = await apply("marca a julia sexta que vem as 10 pra escova", { operation: "appointment.create", customer_name: "julia", service_name: "escova",
      temporal_evidence: [{ field: "date", text: "sexta que vem", component: day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }) }] });
    expect(sunday.fields.date).toBe("2026-10-02");
    vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
    const state = await apply("marca a julia sexta que vem as 10 pra escova", { operation: "appointment.create", customer_name: "julia", service_name: "escova",
      temporal_evidence: [{ field: "date", text: "sexta que vem", component: day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }) }, { field: "time", text: "as 10", component: clock(10) }] });
    expect(state.fields.date).toBeUndefined();expect(state.waiting_for).toBe("date");
    expect(state.message).toBe("Para a data desejada, “sexta que vem” é sex, 02/10 ou sex, 09/10?");
    expect(state.draft!.pending_calendar_conflicts).toEqual([{ field: "date", kind: "DATE_CHOICE", expression: "sexta que vem", candidates: ["2026-10-02", "2026-10-09"] }]);
  });
  it("a past date asks with the past-date notice", async () => {
    flag(true);
    // Phase 3a review: only an explicit past year is "já passou"; without a year this year's or next year's is asked.
    const state = await apply("marca a julia dia 5 de setembro de 2026 as 10", { operation: "appointment.create", customer_name: "julia",
      temporal_evidence: [{ field: "date", text: "dia 5 de setembro de 2026", component: day({ kind: "DAY_OF_MONTH", day: 5, month: 9, year: 2026 }) }, { field: "time", text: "as 10", component: clock(10) }] });
    expect(state.fields.date).toBeUndefined();expect(state.message).toBe("Essa data já passou. Preciso confirmar data do atendimento. Pode informar?");
    const noYear = await apply("marca a julia dia 5 de setembro as 10", { operation: "appointment.create", customer_name: "julia",
      temporal_evidence: [{ field: "date", text: "dia 5 de setembro", component: day({ kind: "DAY_OF_MONTH", day: 5, month: 9 }) }, { field: "time", text: "as 10", component: clock(10) }] });
    expect(noYear.fields.date).toBeUndefined();expect(noYear.message).not.toContain("já passou");
    expect(noYear.message).toBe("Para a data desejada, “dia 5 de setembro” é sáb, 05/09 ou dom, 05/09/2027?");
  });
});
