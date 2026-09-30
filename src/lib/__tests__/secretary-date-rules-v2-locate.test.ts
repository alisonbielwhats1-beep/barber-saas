import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, track R1 through the real scheduling adapter (flag SALON_SECRETARY_DATE_RULES_V2): the dropped past day is
 * said before Confirmar, LOCATE settles a cancel/move's own day or clock by the tenant's real appointments (unique customer
 * only), a negated origin predicate only restricts the locator, and a DATE_CHOICE is never asked again silently.
 * Fake tenant transaction: the real locator's status/future filters and the real draft journal run; no network, no DB. */
type Appt = { id: string; salonId: string; customer_ref: string; professional_ref: string; service_ref: string; start_local: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown, rows: [] as Record<string, unknown>[], appointments: [] as Appt[],
  customers: [] as { id: string; name: string; salonId: string }[] }));
const names: Record<string, string> = { "p-jade": "Jade Moura", "p-nando": "Nando Alves", "s-pe": "Pé e mão", "s-cilios": "Extensão de cílios" };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000).toISOString();
const dto = (a: Appt) => ({ appointment_ref: a.id, customer_ref: a.customer_ref, customer_name: db.customers.find(row => row.id === a.customer_ref)?.name ?? "?",
  professional_ref: a.professional_ref, professional_name: names[a.professional_ref], service_ref: a.service_ref, services: [{ serviceName: names[a.service_ref] }],
  start_at: utc(a.start_local), end_at: utc(a.start_local), start_local: a.start_local, end_local: a.start_local, timezone: "America/Sao_Paulo", status: a.status, revision: 1, priceCents: 5000 });
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, query: string) => ["s-pe", "s-cilios"].filter(id => fold(names[id]).includes(fold(query))).map(id => ({ id, name: names[id], durationMin: 30, priceCents: 5000, priceType: "FIXED" })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, input: { query?: string }) => ["p-jade", "p-nando"].filter(id => !input.query || fold(names[id]).includes(fold(input.query))).map(id => ({ id, name: names[id] })),
  listSchedulingAppointments: async (_tx: unknown, actor: { salonId: string }, input: { date: string; customer_ref?: string; professional_ref?: string; service_ref?: string }) =>
    db.appointments.filter(a => a.salonId === actor.salonId && a.start_local.startsWith(input.date) && (!input.customer_ref || a.customer_ref === input.customer_ref) &&
      (!input.professional_ref || a.professional_ref === input.professional_ref) && (!input.service_ref || a.service_ref === input.service_ref)).map(dto),
  getSchedulingAppointment: async (_tx: unknown, actor: { salonId: string }, ref: string) => { const a = db.appointments.find(row => row.id === ref && row.salonId === actor.salonId); if (!a) throw Error("NOT_FOUND"); return dto(a); },
}));
vi.mock("../scheduling-mutations", async original => {
  const real = await original<typeof import("../scheduling-mutations")>();
  return { ...real, authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: vi.fn(real.locateSchedulingAppointments),
    schedulingActionSnapshot: async () => undefined, inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }) };
});
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(),
  proposeSchedulingAction: vi.fn(async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) => ({ ...input, proposal_ref: "pppppppp-pppp-4ppp-8ppp-pppppppppppp", payload_hash: "h", preview: "PROPOSTA" })) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, actor: { salonId: string }, query: string) => db.customers.filter(row => row.salonId === actor.salonId && fold(row.name).includes(fold(query.trim()))).map(({ id, name }) => ({ id, name, phone: null })) }));
vi.mock("../scheduling-entity-mentions", async original => ({ ...await original<object>(), validateSchedulingEntityMentions: async () => undefined }));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { locateSchedulingAppointments } from "../scheduling-mutations";
import { calendarConflictQuestion, dateChoiceRetry } from "../scheduling-calendar-conflict";

const actor = { salonId: "esmalteria-lua", userId: "dona-lua" }, other = "barbearia-norte";
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const dom = (d: number, month: number | null = null) => day({ kind: "DAY_OF_MONTH", day: d, month });
const clock = (hour: number, minute = 0): ClockComponent => ({ hour, minute, daypart: "UNSPECIFIED" });
const c = (field: string, text: string, component: DayComponent | ClockComponent) => ({ field, text, component });
const appt = (id: string, customer_ref: string, start_local: string, status = "CONFIRMED", salonId = actor.salonId, professional_ref = "p-jade"): Appt =>
  ({ id, salonId, customer_ref, professional_ref, service_ref: "s-pe", start_local, status });
const locator = () => vi.mocked(locateSchedulingAppointments);
const rules = (on: boolean) => vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", on ? "true" : "false");
async function turn(state: SchedulingState, operation: string, fields: Record<string, unknown>, message: string) {
  return applySchedulingInterpretation(actor, state, { operation, ...fields } as never, message);
}
const fresh = (operation: string): SchedulingState => ({ ...schedulingState(), operation: operation as SchedulingState["operation"] });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true"); rules(true); locator().mockClear();
  db.rows = []; db.appointments = [];
  db.customers = [{ id: "c-otavio", name: "Otávio Reis", salonId: actor.salonId }, { id: "c-otavio-n", name: "Otávio Reis", salonId: other },
    { id: "c-yasmin", name: "Yasmin Kato", salonId: actor.salonId }, { id: "c-yasmin-n", name: "Yasmin Kato", salonId: other }, { id: "c-teo", name: "Téo Lins", salonId: actor.salonId },
    { id: "c-bia1", name: "Bia Nunes", salonId: actor.salonId }, { id: "c-bia2", name: "Bia Torres", salonId: actor.salonId }, { id: "c-lurdes", name: "Lurdes Maia", salonId: actor.salonId },
    { id: "c-iolanda", name: "Iolanda Prado", salonId: actor.salonId }];
  const find = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), membership: { findFirstOrThrow: async () => ({ role: "OWNER" }) },
    appointment: { findMany: async ({ where }: { where: { salonId: string; clientId?: string; professionalId?: string; serviceId?: string; status: { in: string[] }; startAt: { gt: Date } } }) =>
      db.appointments.filter(a => a.salonId === where.salonId && (!where.clientId || a.customer_ref === where.clientId) && (!where.professionalId || a.professional_ref === where.professionalId) &&
        (!where.serviceId || a.service_ref === where.serviceId) && where.status.in.includes(a.status) && new Date(utc(a.start_local)) > where.startAt.gt).map(a => ({ id: a.id })) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.rows.push(structuredClone(data)); return data; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)[0] ?? null) } } as unknown as Tx;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); for (const call of locator().mock.calls) expect(call[1]).toEqual(actor); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("B1: the dropped past day is said before Confirmar", () => {
  const cancelOtavio = (state: SchedulingState) => turn(state, "appointment.cancel", { customer_name: "Otávio", reason: "ele viajou",
    temporal_evidence: [c("date", "dia 1", dom(1)), c("time", "das 17h30", clock(17, 30))] }, "Desmarque o horário do Otávio do dia 1 das 17h30 porque ele viajou.");
  it("'do dia 1' on 29/09 proposes 01/10 and says 01/09 já passou; another salon's same-named client is never located", async () => {
    db.appointments = [appt("a-otavio", "c-otavio", "2026-10-01T17:30"), appt("a-otavio-n", "c-otavio-n", "2026-10-01T17:30", "CONFIRMED", other)];
    const state = fresh("appointment.cancel"), codes = await cancelOtavio(state);
    expect(state.fields.appointment_ref).toBe("a-otavio");expect(state.proposal).toBeDefined();expect(state.receipt).toBeUndefined();
    expect(state.message).toBe("PROPOSTA\n“dia 1” é qui, 01/10 (ter, 01/09 já passou).\nUse Confirmar para executar.");
    expect(codes).toContain("PAST_READING_DROPPED");
    expect(locator().mock.calls.every(call => (call[2] as { date?: string }).date === "2026-10-01")).toBe(true);
  });
  it("flag off: today's past-vs-next question, nothing located", async () => {
    rules(false);
    db.appointments = [appt("a-otavio", "c-otavio", "2026-10-01T17:30")];
    const state = fresh("appointment.cancel");await cancelOtavio(state);
    expect(state.message).toBe(calendarConflictQuestion({ field: "date", kind: "DATE_CHOICE", expression: "dia 1", candidates: ["2026-09-01", "2026-10-01"] }));
    expect(state.proposal).toBeUndefined();expect(locator()).not.toHaveBeenCalled();expect(state).not.toHaveProperty("past_readings");
  });
  it("not found on 01/10: the notice names the day it looked at and why", async () => {
    db.appointments = [appt("a-otavio", "c-otavio", "2026-10-08T17:30")];
    const state = fresh("appointment.cancel");await cancelOtavio(state);
    expect(state.proposal).toBeUndefined();expect(state.message).toMatch(/^Não encontrei agendamento futuro pendente ou confirmado/);
    expect(state.message).toContain("“dia 1” é qui, 01/10 (ter, 01/09 já passou).");
  });
  // Fixer (migrated): her real appointment on the dropped 25/09 may be the one meant, so 25/10 is a card (one click), never selected alone.
  it("a monthly client's 'dia 25' said on the 29th: the passed 25/09 is said beside the card of 25/10; the click proposes it with the dropped-day line", async () => {
    db.appointments = [appt("a-iolanda-set", "c-iolanda", "2026-09-25T10:00", "COMPLETED"), appt("a-iolanda-out", "c-iolanda", "2026-10-25T10:00")];
    const state = fresh("appointment.cancel");
    await turn(state, "appointment.cancel", { customer_name: "Iolanda", reason: "mudou de cidade", temporal_evidence: [c("date", "dia 25", dom(25))] }, "cancela a Iolanda do dia 25, ela mudou de cidade");
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.candidates?.items.map(item => item.id)).toEqual(["a-iolanda-out"]);
    expect(state.message).toBe("Não encontrei agendamento de Iolanda Prado que a Secretária possa alterar em sex, 25/09, que já passou; “dia 25” também é dom, 25/10. Selecione uma opção real.");
    await selectScheduling(actor, state, "a-iolanda-out", { clicked: true });
    expect(state.fields.appointment_ref).toBe("a-iolanda-out");expect(state.proposal).toBeDefined();expect(state.message).toContain("“dia 25” é dom, 25/10 (sex, 25/09 já passou).");
  });
  it("adversarial: a weekly client's 'dessa segunda' said on Wednesday never becomes next Monday's appointment", async () => {
    vi.setSystemTime(new Date("2026-09-30T15:00:00Z"));
    db.appointments = [appt("a-iol-28", "c-iolanda", "2026-09-28T10:00", "COMPLETED"), appt("a-iol-05", "c-iolanda", "2026-10-05T10:00")];
    const state = fresh("appointment.cancel");
    await turn(state, "appointment.cancel", { customer_name: "Iolanda", reason: "vai viajar", temporal_evidence: [c("date", "dessa segunda", day({ kind: "WEEKDAY", weekday: 1, week: "THIS_WEEK" }))] },
      "cancela a Iolanda dessa segunda porque vai viajar");
    expect(state.proposal).toBeUndefined();expect(state.fields.appointment_ref).toBeUndefined();expect(state.message).toMatch(/^Não encontrei agendamento futuro/);
  });
  it("adversarial: an explicit '25/09' is never moved to October (next year's 25/09 is looked up and not found)", async () => {
    db.appointments = [appt("a-iolanda-out", "c-iolanda", "2026-10-25T10:00")];
    const state = fresh("appointment.cancel");
    await turn(state, "appointment.cancel", { customer_name: "Iolanda", reason: "mudou de cidade", temporal_evidence: [c("date", "dia 25/09", dom(25, 9))] }, "cancela a Iolanda do dia 25/09, mudou de cidade");
    expect(state.proposal).toBeUndefined();expect(state.fields.date).toBe("2027-09-25");expect(state.message).toContain("“dia 25/09” é sáb, 25/09/2027 (sex, 25/09 já passou).");
  });
});

describe("LOCATE: a cancel's day choice settled by the client's real appointments", () => {
  const cancelYasmin = (state: SchedulingState, name = "Yasmin", message = "Cancela a Yasmin de sexta que vem porque ela vai viajar") =>
    turn(state, "appointment.cancel", { customer_name: name, reason: "ela vai viajar", temporal_evidence: [c("date", "sexta que vem", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" }))] }, message);
  it("only 09/10 has her appointment (a cancelled 02/10 and another salon's 02/10 do not count): proposal, no calendar question", async () => {
    db.appointments = [appt("a-yas-09", "c-yasmin", "2026-10-09T15:00"), appt("a-yas-02x", "c-yasmin", "2026-10-02T09:00", "CANCELLED"),
      appt("a-yas-n", "c-yasmin-n", "2026-10-02T09:00", "CONFIRMED", other)];
    const state = fresh("appointment.cancel"), codes = await cancelYasmin(state);
    expect(codes).toContain("DATE_CHOICE_RESOLVED_BY_AGENDA");expect(state.fields).toMatchObject({ date: "2026-10-09", appointment_ref: "a-yas-09" });
    expect(state.pending_calendar_conflicts).toEqual([]);expect(state.proposal).toBeDefined();
    // LOCATE reads each published day once (at most twice), then the ordinary locator runs on the settled day.
    expect(locator().mock.calls.map(call => (call[2] as { date?: string }).date)).toEqual(["2026-10-02", "2026-10-09", "2026-10-09"]);
  });
  it("both days have one: the card of those two real appointments; a click proposes the chosen one", async () => {
    db.appointments = [appt("a-yas-02", "c-yasmin", "2026-10-02T09:00"), appt("a-yas-09", "c-yasmin", "2026-10-09T15:00", "PENDING", actor.salonId, "p-nando")];
    const state = fresh("appointment.cancel"), codes = await cancelYasmin(state);
    expect(codes).toContain("DATE_CHOICE_RESOLVED_BY_AGENDA_BOTH");expect(state.proposal).toBeUndefined();expect(state.message).toBe("Qual agendamento? Selecione uma opção real.");
    expect(state.candidates?.items.map(item => item.id)).toEqual(["a-yas-02", "a-yas-09"]);expect(state.pending_calendar_conflicts).toEqual([]);
    await selectScheduling(actor, state, "a-yas-09", { clicked: true });
    expect(state.fields.appointment_ref).toBe("a-yas-09");expect(state.proposal).toBeDefined();
  });
  it("day and clock both open and both days match: one card, and the click proposes without a half-day question", async () => {
    db.appointments = [appt("a-yas-02", "c-yasmin", "2026-10-02T14:00"), appt("a-yas-09", "c-yasmin", "2026-10-09T14:00")];
    const state = fresh("appointment.cancel");
    await turn(state, "appointment.cancel", { customer_name: "Yasmin", reason: "ela vai viajar", temporal_evidence: [c("date", "sexta que vem", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" })),
      c("time", "às 2", clock(2))] }, "Cancela a Yasmin de sexta que vem às 2 porque ela vai viajar");
    expect(state.candidates?.items.map(item => item.id)).toEqual(["a-yas-02", "a-yas-09"]);expect(state.pending_temporal_ambiguities).toEqual([]);expect(state.pending_calendar_conflicts).toEqual([]);
    await selectScheduling(actor, state, "a-yas-02", { clicked: true });
    expect(state.fields.appointment_ref).toBe("a-yas-02");expect(state.proposal).toBeDefined();expect(state.message).not.toContain("02h ou 14h");
  });
  it("neither day has one: said with both days, and the day is asked", async () => {
    db.appointments = [appt("a-yas-16", "c-yasmin", "2026-10-16T15:00")];
    const state = fresh("appointment.cancel"), codes = await cancelYasmin(state);
    expect(codes).toContain("DATE_CHOICE_RESOLVED_BY_AGENDA_NONE");expect(state.proposal).toBeUndefined();expect(state.waiting_for).toBe("date");
    expect(state.message).toBe("Não encontrei agendamento futuro de Yasmin Kato em sex, 02/10 nem em sex, 09/10. Preciso confirmar data do atendimento. Pode informar?");
  });
  it("adversarial: homonym clients keep today's order and nothing is read; an unproven name is never used", async () => {
    db.appointments = [appt("a-bia-09", "c-bia1", "2026-10-09T15:00")];
    const bia = fresh("appointment.cancel");await cancelYasmin(bia, "Bia", "Cancela a Bia de sexta que vem porque ela vai viajar");
    expect(locator()).not.toHaveBeenCalled();expect(bia.waiting_for).toBe("date");expect(bia.message).toContain("“sexta que vem” é sex, 02/10 ou sex, 09/10?");
    db.appointments = [appt("a-yas-09", "c-yasmin", "2026-10-09T15:00")];
    const unproven = { ...fresh("appointment.cancel"), unproven_names: ["customer_name" as const] };await cancelYasmin(unproven);
    expect(locator()).not.toHaveBeenCalled();expect(unproven.fields.date).toBeUndefined();
  });
  it("adversarial: a day the owner excluded is never where LOCATE settles", async () => {
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", "true");
    db.appointments = [appt("a-yas-02", "c-yasmin", "2026-10-02T09:00")];
    const state = fresh("appointment.cancel");
    await turn(state, "appointment.cancel", { customer_name: "Yasmin", reason: "ela vai viajar", temporal_evidence: [c("date", "sexta que vem", day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" })),
      { field: "date", text: "não a do dia 2", excluded: dom(2) }] }, "Cancela a Yasmin de sexta que vem, não a do dia 2, porque ela vai viajar");
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.fields.date).not.toBe("2026-10-02");expect(state.proposal).toBeUndefined();
    expect(locator().mock.calls.some(call => (call[2] as { date?: string }).date === "2026-10-02")).toBe(false);
  });
});

describe("LOCATE: a cancel's clock ('das 2') settled by the client's real appointment", () => {
  const cancelTeo = (state: SchedulingState, withReason = true) => turn(state, "appointment.cancel", { customer_name: "Téo", ...(withReason ? { reason: "ele adoeceu" } : {}),
    temporal_evidence: [c("time", "das 2", clock(2))] }, withReason ? "cancela o Téo das 2 porque ele adoeceu" : "cancela o Téo das 2");
  it("his only future appointment is at 14h (an earlier one today at 02h already started): 14h, then the reason is asked", async () => {
    db.appointments = [appt("a-teo-hoje", "c-teo", "2026-09-29T02:00"), appt("a-teo-14", "c-teo", "2026-10-01T14:00")];
    const state = fresh("appointment.cancel"), codes = await cancelTeo(state, false);
    expect(codes).toContain("DAYPART_RESOLVED_BY_APPOINTMENT");expect(state.fields).toMatchObject({ time: "14:00", appointment_ref: "a-teo-14" });
    expect(state.pending_temporal_ambiguities).toEqual([]);expect(state.proposal).toBeUndefined();expect(state.message).toContain("motivo do cancelamento");
    const done = fresh("appointment.cancel");await cancelTeo(done);
    expect(done.proposal).toBeDefined();expect(done.fields.appointment_ref).toBe("a-teo-14");
  });
  it("appointments at both 02h and 14h (a 24h studio): today's half-day question", async () => {
    db.appointments = [appt("a-teo-02", "c-teo", "2026-10-01T02:00"), appt("a-teo-14", "c-teo", "2026-10-02T14:00")];
    const state = fresh("appointment.cancel"), codes = await cancelTeo(state);
    expect(codes).toContain("DAYPART_RESOLVED_BY_APPOINTMENT_BOTH");expect(state.fields.time).toBeUndefined();expect(state.waiting_for).toBe("time");expect(state.message).toContain("02h ou 14h");
  });
  it("adversarial: a weekday/date contradiction the owner wrote about that day is asked first; nothing is read", async () => {
    db.appointments = [appt("a-teo-14", "c-teo", "2026-10-14T14:00")];
    const state = fresh("appointment.cancel");
    await turn(state, "appointment.cancel", { customer_name: "Téo", reason: "ele adoeceu", temporal_evidence: [c("date", "terça, dia 14", dom(14)), c("time", "às 2", clock(2))] },
      "cancela o Téo de terça, dia 14 às 2 porque ele adoeceu");
    expect(locator()).not.toHaveBeenCalled();expect(state.fields.time).toBeUndefined();expect(state.message).toContain("Você informou terça-feira, mas 14/10/2026 cai em quarta-feira");
  });
  it("none at either reading (a completed one does not count): said, and the clock is asked", async () => {
    db.appointments = [appt("a-teo-done", "c-teo", "2026-10-01T14:00", "COMPLETED"), appt("a-teo-10", "c-teo", "2026-10-01T10:00")];
    const state = fresh("appointment.cancel");await cancelTeo(state);
    expect(state.message).toBe("Não encontrei agendamento futuro de Téo Lins às 2h nem às 14h. Preciso confirmar horário do atendimento. Pode informar?");
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.waiting_for).toBe("time");
  });
});

describe("B6: 'não pode no dia X' on a move only restricts which appointment may be located", () => {
  const moveLurdes = (state: SchedulingState) => turn(state, "appointment.change", { customer_name: "Lurdes",
    temporal_evidence: [c("source_date", "no dia 06/10", dom(6, 10)), c("date", "dia 02/10", dom(2, 10)), c("time", "às 20:00", clock(20))] },
  "Tchê, a Lurdes não pode no dia 06/10. Remarque ela pro dia 02/10 às 20:00.");
  it("one appointment on 06/10: located and proposed (before → after is the proposal's own)", async () => {
    db.appointments = [appt("a-lurdes-06", "c-lurdes", "2026-10-06T10:00")];
    const state = fresh("appointment.change"), codes = await moveLurdes(state);
    expect(codes).toContain("SOURCE_NEGATED_PREDICATE");expect(state.fields).toMatchObject({ appointment_ref: "a-lurdes-06", date: "2026-10-02", time: "20:00" });
    expect(state.proposal).toBeDefined();expect(state).not.toHaveProperty("locator_hint");
  });
  it("her only appointment is on another day: a card, never moved silently", async () => {
    db.appointments = [appt("a-lurdes-07", "c-lurdes", "2026-10-07T10:00")];
    const state = fresh("appointment.change");await moveLurdes(state);
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.candidates?.items.map(item => item.id)).toEqual(["a-lurdes-07"]);
    expect(state.message).toBe("Não encontrei agendamento futuro de Lurdes Maia em ter, 06/10. Selecione uma opção real.");
  });
  // Migrated by C4 R-A (backup .demo/agenda-core/contract-migration/secretary-date-rules-v2-locate.test.before-c4-ra-temporal-scope.ts):
  // the negated day LOCATES the one appointment on it; another appointment of hers on another day no longer turns it into a card.
  it("two future appointments (one on 06/10): the one on the negated day is located, the other is never picked", async () => {
    db.appointments = [appt("a-lurdes-06", "c-lurdes", "2026-10-06T10:00"), appt("a-lurdes-13", "c-lurdes", "2026-10-13T10:00")];
    const state = fresh("appointment.change");await moveLurdes(state);
    expect(state.fields).toMatchObject({ appointment_ref: "a-lurdes-06", date: "2026-10-02", time: "20:00" });expect(state.proposal).toBeDefined();
  });
  it("adversarial: two appointments ON the negated day: a card of those two, none picked (the other day is not offered)", async () => {
    db.appointments = [appt("a-lurdes-06a", "c-lurdes", "2026-10-06T10:00"), appt("a-lurdes-06b", "c-lurdes", "2026-10-06T16:00"), appt("a-lurdes-13", "c-lurdes", "2026-10-13T10:00")];
    const state = fresh("appointment.change");await moveLurdes(state);
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();
    expect(state.candidates?.items.map(item => item.id)).toEqual(["a-lurdes-06a", "a-lurdes-06b"]);expect(state.message).toBe("Qual agendamento? Selecione uma opção real.");
  });
  it("adversarial: two appointments, none on the negated day: the card of both, never another day picked", async () => {
    db.appointments = [appt("a-lurdes-07", "c-lurdes", "2026-10-07T10:00"), appt("a-lurdes-13", "c-lurdes", "2026-10-13T10:00")];
    const state = fresh("appointment.change");await moveLurdes(state);
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.candidates?.items).toHaveLength(2);
    expect(state.message).toBe("Não encontrei agendamento futuro de Lurdes Maia em ter, 06/10. Selecione uma opção real.");
  });
  it("flag off: the historical question about the original day, nothing located", async () => {
    rules(false);
    db.appointments = [appt("a-lurdes-06", "c-lurdes", "2026-10-06T10:00")];
    const state = fresh("appointment.change");await moveLurdes(state);
    expect(state.proposal).toBeUndefined();expect(state.message).toContain("Preciso confirmar data original");expect(locator()).not.toHaveBeenCalled();
  });
});

describe("a DATE_CHOICE is never asked again silently", () => {
  const ask = (state: SchedulingState, message: string, component: DayComponent) =>
    turn(state, "appointment.list", { professional_name: "Jade", temporal_evidence: [c("date", message.replace(/^o que a jade tem /, "").replace(/\?$/, ""), component)] }, message);
  it("a repeated 'dia 25' says what was not understood; 'o de outubro' then settles it", async () => {
    db.appointments = [appt("a-out", "c-iolanda", "2026-10-25T10:00")];
    const state = fresh("appointment.list");await ask(state, "o que a jade tem dia 25?", dom(25));
    const question = calendarConflictQuestion({ field: "date", kind: "DATE_CHOICE", expression: "dia 25", candidates: ["2026-09-25", "2026-10-25"] });
    expect(state.message).toBe(question);expect(state.waiting_for).toBe("date");
    const codes = await turn(state, "appointment.list", { temporal_evidence: [c("date", "dia 25", dom(25))] }, "dia 25");
    expect(codes).toContain("DATE_CHOICE_ANSWER_UNRESOLVED");expect(state.message).toBe(`${dateChoiceRetry}\n${question}`);expect(state.message).not.toBe(question);
    await turn(state, "appointment.list", { temporal_evidence: [c("date", "dia 25", dom(25))] }, "dia 25");
    expect(state.message).toBe(`${dateChoiceRetry}\n${question}`); // never accumulates
    await turn(state, "appointment.list", { temporal_evidence: [c("date", "o de outubro", dom(25, 10))] }, "o de outubro");
    expect(state.fields.date).toBe("2026-10-25");expect(state.message).toContain("Agenda de Jade");
  });
  it("flag off: the historical notice", async () => {
    rules(false);
    const state = fresh("appointment.list");await ask(state, "o que a jade tem dia 25?", dom(25));
    await turn(state, "appointment.list", { temporal_evidence: [c("date", "o de outubro", dom(25, 10))] }, "o de outubro");
    expect(state.message).toMatch(/^Não consegui associar essa resposta com segurança/);
  });
});

describe("C4 R-A: 'não pode no dia 1' (its reading this month already past) LOCATES the appointment on 01/10", () => {
  const odete = () => { db.customers.push({ id: "c-odete", name: "Odete Brandão", salonId: actor.salonId }, { id: "c-odete-n", name: "Odete Brandão", salonId: other }); };
  const moveOdete = (state: SchedulingState) => turn(state, "appointment.change", { customer_name: "Odete",
    temporal_evidence: [c("source_date", "dia 1", dom(1)), c("date", "dia 3", dom(3)), c("time", "as 10", clock(10))] }, "a odete nao pode no dia 1, passa ela pro dia 3 as 10");
  it("her other appointment (05/10) never changes the result: 01/10 is located and proposed, the dropped day said before Confirmar", async () => {
    odete();
    // Another salon's same-named client with a past appointment on 01/09 never counts (tenant-scoped check).
    db.appointments = [appt("a-odete-01", "c-odete", "2026-10-01T14:00"), appt("a-odete-05", "c-odete", "2026-10-05T14:00"), appt("a-odete-n", "c-odete-n", "2026-09-01T14:00", "COMPLETED", other)];
    const state = fresh("appointment.change"), codes = await moveOdete(state);
    expect(codes).toContain("SOURCE_NEGATED_PREDICATE");expect(state.fields.source_date).toBeUndefined();
    expect(state.fields).toMatchObject({ appointment_ref: "a-odete-01", date: "2026-10-03", time: "10:00" });expect(state.proposal).toBeDefined();
    expect(state.message).toBe("PROPOSTA\n“dia 1” é qui, 01/10 (ter, 01/09 já passou).\nUse Confirmar para executar.");
    expect(db.rows.filter(row => row.action === "CONFIRMED")).toEqual([]);
  });
  it.each([["CANCELLED"], ["COMPLETED"], ["NO_SHOW"], ["CONFIRMED"]])("adversarial: her own appointment on 01/09 (%s): 01/10 is only a card beside it; the click goes on", async status => {
    odete();
    db.appointments = [appt("a-odete-set", "c-odete", "2026-09-01T14:00", status), appt("a-odete-01", "c-odete", "2026-10-01T14:00"), appt("a-odete-05", "c-odete", "2026-10-05T14:00")];
    const state = fresh("appointment.change");await moveOdete(state);
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.candidates?.items.map(item => item.id)).toEqual(["a-odete-01"]);
    expect(state.message).toBe("Não encontrei agendamento de Odete Brandão que a Secretária possa alterar em ter, 01/09, que já passou; “dia 1” também é qui, 01/10. Selecione uma opção real.");
    await selectScheduling(actor, state, "a-odete-01", { clicked: true });
    expect(state.fields).toMatchObject({ appointment_ref: "a-odete-01", date: "2026-10-03", time: "10:00" });expect(state.proposal).toBeDefined();
  });
  it("adversarial: nothing on 01/10 (only 05/10): a card, the other day is never picked, the dropped day is said", async () => {
    odete();
    db.appointments = [appt("a-odete-05", "c-odete", "2026-10-05T14:00")];
    const state = fresh("appointment.change");await moveOdete(state);
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.candidates?.items.map(item => item.id)).toEqual(["a-odete-05"]);
    expect(state.message).toBe("Não encontrei agendamento futuro de Odete Brandão em qui, 01/10. “dia 1” é qui, 01/10 (ter, 01/09 já passou). Selecione uma opção real.");
  });
  it("flag off: the historical question about the original day, nothing located", async () => {
    rules(false);odete();
    db.appointments = [appt("a-odete-01", "c-odete", "2026-10-01T14:00")];
    const state = fresh("appointment.change");await moveOdete(state);
    expect(state.proposal).toBeUndefined();expect(state.message).toContain("Preciso confirmar data original");expect(locator()).not.toHaveBeenCalled();
  });
});
