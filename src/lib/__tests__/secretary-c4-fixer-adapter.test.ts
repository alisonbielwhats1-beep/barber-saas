import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, fixer of the R1/R2 review, through the real scheduling adapter (flags SALON_SECRETARY_DATE_RULES_V2,
 * SALON_SECRETARY_DAYPART_BY_HOURS, SALON_SECRETARY_DAYPART_RULES_V2): a negated sentence about a past day never moves next month's
 * appointment; a dropped past day on which the customer really had an appointment is a card, never a pick; a daypart written
 * elsewhere in the action or an exclusion from an earlier turn is never overridden by the salon's hours; the service filters the
 * professionals whose hours decide; a fixed clock is part of the "não encontrei" and becomes the question; the DATE_CHOICE retry
 * asks for what can settle it. Fake tenant transaction: the real draft journal, locator filters and facts loader run; an
 * esmalteria, a barbershop and a 24h spa. No DB, no network, no model. Nothing is ever confirmed. */
type Pro = { id: string; name: string; salonId: string; services: string[] };
type Appt = { id: string; salonId: string; customer_ref: string; professional_ref: string; service_ref: string; start_local: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown, rows: [] as Record<string, unknown>[], pros: [] as Pro[], appointments: [] as Appt[], listed: [] as string[],
  hours: [] as { salonId: string; professionalId: string; weekday: number; startMinutes: number; endMinutes: number }[],
  customers: [] as { id: string; name: string; salonId: string }[], services: [] as { id: string; name: string; salonId: string; durationMin: number }[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000);
const minute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const hhmm = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const dto = (a: Appt) => ({ appointment_ref: a.id, customer_ref: a.customer_ref, customer_name: db.customers.find(row => row.id === a.customer_ref)?.name ?? "?",
  professional_ref: a.professional_ref, professional_name: db.pros.find(row => row.id === a.professional_ref)?.name ?? "?", service_ref: a.service_ref, services: [],
  start_at: utc(a.start_local).toISOString(), end_at: new Date(utc(a.start_local).getTime() + 30 * 60_000).toISOString(), start_local: a.start_local,
  end_local: `${a.start_local.slice(0, 11)}${hhmm(minute(a.start_local.slice(11)) + 30)}`, timezone: "America/Sao_Paulo", status: a.status, revision: 1, priceCents: 5000 });
function free(salonId: string, pro: string, service: string, date: string, start: number) {
  const duration = db.services.find(row => row.id === service)?.durationMin ?? 30, weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return db.hours.some(row => row.salonId === salonId && row.professionalId === pro && row.weekday === weekday && row.startMinutes <= start && start + duration <= row.endMinutes) &&
    !db.appointments.some(row => row.professional_ref === pro && row.status === "CONFIRMED" && row.start_local.startsWith(date) && Math.abs(minute(row.start_local.slice(11)) - start) < 30);
}
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined,
  listSchedulingServices: async (_tx: unknown, actor: { salonId: string }, query: string) => db.services.filter(row => row.salonId === actor.salonId && fold(row.name).includes(fold(query)))
    .map(({ id, name, durationMin }) => ({ id, name, durationMin, priceCents: 5000, priceType: "FIXED" })),
  listSchedulingProfessionals: async (_tx: unknown, actor: { salonId: string }, input: { service_ref?: string; query?: string }) => db.pros.filter(row => row.salonId === actor.salonId &&
    (!input.service_ref || row.services.includes(input.service_ref)) && (!input.query || fold(row.name).includes(fold(input.query)))).map(({ id, name }) => ({ id, name })),
  getSchedulingAvailability: async (_tx: unknown, actor: { salonId: string }, input: { service_ref: string; professional_ref: string; date: string; time?: string }, _now: Date, _p: unknown, excluded?: ReadonlySet<string>) => {
    const requested = input.time === undefined ? undefined : minute(input.time), alternatives: { startLocal: string; endLocal: string; professional_ref: string }[] = [];
    for (let start = 0; start < 1440 && alternatives.length < 5; start += 30) if ((requested === undefined || start > requested) && !excluded?.has(hhmm(start)) && free(actor.salonId, input.professional_ref, input.service_ref, input.date, start))
      alternatives.push({ startLocal: `${input.date}T${hhmm(start)}`, endLocal: `${input.date}T${hhmm(start + 30)}`, professional_ref: input.professional_ref });
    const plan = requested !== undefined && free(actor.salonId, input.professional_ref, input.service_ref, input.date, requested) ? { startLocal: `${input.date}T${input.time}` } : null;
    return { timezone: "America/Sao_Paulo", plan, quote: null, alternatives, as_of: new Date().toISOString() };
  },
  listSchedulingAppointments: async (_tx: unknown, actor: { salonId: string }, input: { date: string; customer_ref?: string; professional_ref?: string }) => {
    db.listed.push(`${actor.salonId}|${input.date}|${input.customer_ref ?? ""}`);
    return db.appointments.filter(a => a.salonId === actor.salonId && a.start_local.startsWith(input.date) && (!input.customer_ref || a.customer_ref === input.customer_ref) &&
      (!input.professional_ref || a.professional_ref === input.professional_ref)).map(dto);
  },
  getSchedulingAppointment: async (_tx: unknown, actor: { salonId: string }, ref: string) => { const a = db.appointments.find(row => row.id === ref && row.salonId === actor.salonId); if (!a) throw Error("NOT_FOUND"); return dto(a); },
}));
vi.mock("../scheduling-mutations", async original => {
  const real = await original<typeof import("../scheduling-mutations")>();
  return { ...real, authorizeSchedulingOperation: async () => "OWNER", schedulingActionSnapshot: async () => undefined, inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }) };
});
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(), schedulingSnapshot: async () => undefined,
  proposeAppointmentCreate: vi.fn(async (_tx: unknown, _actor: unknown, input: object) => ({ ...input, proposal_ref: "pppppppp-pppp-4ppp-8ppp-pppppppppppp", payload_hash: "h", preview: "PROPOSTA" })),
  proposeSchedulingAction: vi.fn(async (_tx: unknown, _actor: unknown, input: object) => ({ ...input, proposal_ref: "pppppppp-pppp-4ppp-8ppp-pppppppppppp", payload_hash: "h", preview: "PROPOSTA" })) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, actor: { salonId: string }, query: string) => db.customers.filter(row => row.salonId === actor.salonId && fold(row.name).includes(fold(query.trim()))).map(({ id, name }) => ({ id, name, phone: null })) }));
vi.mock("../scheduling-entity-mentions", async original => ({ ...await original<object>(), validateSchedulingEntityMentions: async () => undefined }));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { calendarConflictQuestion, dateChoiceRetryFor } from "../scheduling-calendar-conflict";
import { daypartChoiceRetry } from "../scheduling-temporal-ambiguity";

const lua = { salonId: "esmalteria-lua", userId: "dona-lua" }, sol = { salonId: "barbearia-sol", userId: "dono-sol" }, spa = { salonId: "spa-mar", userId: "dona-mar" };
type Actor = typeof lua;
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const dom = (d: number, month: number | null = null) => day({ kind: "DAY_OF_MONTH", day: d, month });
const TOMORROW = day({ kind: "RELATIVE_DAY", offset: 1 }), TODAY = day({ kind: "RELATIVE_DAY", offset: 0 }), FRIDAY = day({ kind: "WEEKDAY", weekday: 5, week: "AMBIGUOUS_NEXT" });
const clock = (hour: number, minute_ = 0, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute: minute_, daypart });
const c = (field: string, text: string, component: DayComponent | ClockComponent) => ({ field, text, component });
const fresh = (operation: string): SchedulingState => ({ ...schedulingState(), operation: operation as SchedulingState["operation"] });
const flags = (dates: boolean, hours: boolean, v2: boolean) => { vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", dates ? "true" : "false");
  vi.stubEnv("SALON_SECRETARY_DAYPART_BY_HOURS", hours ? "true" : "false"); vi.stubEnv("SALON_SECRETARY_DAYPART_RULES_V2", v2 ? "true" : "false"); };
const turn = (actor: Actor, state: SchedulingState, operation: string, fields: Record<string, unknown>, message: string) =>
  applySchedulingInterpretation(actor, state, { operation, ...fields } as never, message);
const hours = (salonId: string, professionalId: string, weekday: number, from: string, to: string) => ({ salonId, professionalId, weekday, startMinutes: minute(from), endMinutes: to === "24:00" ? 1440 : minute(to) });
const appt = (id: string, salonId: string, customer_ref: string, start_local: string, status = "CONFIRMED", professional_ref = "p-bianca"): Appt =>
  ({ id, salonId, customer_ref, professional_ref, service_ref: "s-pe", start_local, status });
const QUESTION = (expression: string) => `No horário de destino, “${expression}” significa 02h ou 14h?`;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true"); flags(true, true, true);
  db.rows = []; db.appointments = []; db.listed = [];
  db.pros = [{ id: "p-bianca", name: "Bianca Rocha", salonId: lua.salonId, services: ["s-pe"] },
    { id: "p-caio", name: "Caio Brito", salonId: sol.salonId, services: ["s-corte", "s-barba"] }, { id: "p-lia", name: "Lia Moraes", salonId: sol.salonId, services: ["s-corte", "s-sobrancelha"] },
    { id: "p-ana1", name: "Ana Paula Reis", salonId: sol.salonId, services: ["s-corte"] }, { id: "p-ana2", name: "Ana Luiza Prado", salonId: sol.salonId, services: ["s-barba"] },
    { id: "p-jade", name: "Jade Moura", salonId: spa.salonId, services: ["s-massagem"] }];
  db.hours = [2, 3, 4, 5].flatMap(weekday => [hours(lua.salonId, "p-bianca", weekday, "09:00", "18:00"), hours(sol.salonId, "p-caio", weekday, "08:00", "20:00"),
    hours(sol.salonId, "p-lia", weekday, "08:00", "12:00"), hours(sol.salonId, "p-ana1", weekday, "14:00", "20:00"), hours(sol.salonId, "p-ana2", weekday, "08:00", "12:00"),
    hours(spa.salonId, "p-jade", weekday, "00:00", "24:00")]);
  db.customers = [{ id: "c-vitoria", name: "Vitória Lemos", salonId: lua.salonId }, { id: "c-vitoria-n", name: "Vitória Lemos", salonId: sol.salonId },
    { id: "c-gabi", name: "Gabriela Nunes", salonId: lua.salonId }, { id: "c-rafa", name: "Rafael Costa", salonId: lua.salonId },
    { id: "c-hiro", name: "Hiroshi Tanaka", salonId: sol.salonId }, { id: "c-kevin", name: "Kevin Sato", salonId: sol.salonId }, { id: "c-luz", name: "Luz Andrade", salonId: spa.salonId }];
  db.services = [{ id: "s-pe", name: "Pé e mão", salonId: lua.salonId, durationMin: 60 }, { id: "s-corte", name: "Corte masculino", salonId: sol.salonId, durationMin: 30 },
    { id: "s-barba", name: "Barba", salonId: sol.salonId, durationMin: 30 }, { id: "s-sobrancelha", name: "Sobrancelha", salonId: sol.salonId, durationMin: 30 },
    { id: "s-massagem", name: "Massagem relaxante", salonId: spa.salonId, durationMin: 60 }];
  const find = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  const overlapping = (row: { startAt: Date; endAt: Date }, where: { startAt: { lt: Date }; endAt: { gt: Date } }) => row.startAt < where.startAt.lt && row.endAt > where.endAt.gt;
  db.tx = { $executeRaw: vi.fn(async () => 0), membership: { findFirstOrThrow: async () => ({ role: "OWNER" }) },
    workingHours: { findFirst: async ({ where }: { where: { salonId: string } }) => db.hours.find(row => row.salonId === where.salonId) ?? null,
      findMany: async ({ where }: { where: { salonId: string; professionalId: { in: string[] }; weekday: number } }) => db.hours.filter(row => row.salonId === where.salonId && where.professionalId.in.includes(row.professionalId) && row.weekday === where.weekday) },
    professionalOpening: { findMany: async () => [] },
    salonClosure: { findMany: async ({ where }: { where: { startAt: { lt: Date }; endAt: { gt: Date } } }) => ([] as { startAt: Date; endAt: Date }[]).filter(row => overlapping(row, where)) },
    timeOff: { findMany: async () => [] },
    service: { findFirst: async ({ where }: { where: { id: string; salonId: string } }) => db.services.find(row => row.id === where.id && row.salonId === where.salonId) ?? null },
    appointment: { findMany: async ({ where }: { where: { salonId: string; clientId?: string; status: { in: string[] }; startAt: { gt: Date } } }) =>
      db.appointments.filter(a => a.salonId === where.salonId && (!where.clientId || a.customer_ref === where.clientId) && where.status.in.includes(a.status) && utc(a.start_local) > where.startAt.gt).map(a => ({ id: a.id })) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.rows.push(structuredClone(data)); return data; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)[0] ?? null) } } as unknown as Tx;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.filter(row => row.action === "CONFIRMED")).toEqual([]); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("a past day the owner names (no-show, 'não veio') never moves or cancels next month's appointment by itself", () => {
  // Monthly client of the esmalteria: 25/09 was a no-show; 25/10 is her next appointment. Today is Tue 29/09.
  const monthly = () => { db.appointments = [appt("a-vit-set", lua.salonId, "c-vitoria", "2026-09-25T10:00", "NO_SHOW"), appt("a-vit-out", lua.salonId, "c-vitoria", "2026-10-25T10:00")]; };
  const move = (state: SchedulingState, message: string, source: string) => turn(lua, state, "appointment.change", { customer_name: "Vitória",
    temporal_evidence: [c("source_date", source, dom(25)), c("date", "dia 30", dom(30)), c("time", "às 10h", clock(10))] }, message);
  // Migrated by C4 R-A (backup .demo/agenda-core/contract-migration/secretary-c4-fixer-adapter.test.before-c4-ra-temporal-scope.ts):
  // the negated day is now a locator hint carrying its dropped past day, and the past appointment of any status on 25/09 keeps
  // 25/10 from being selected by itself (the B1 card) instead of the original-day question. The safety is unchanged: nothing is
  // located, nothing is proposed.
  it.each([["A Vitória não veio dia 25. Remarca ela pro dia 30 às 10h", "dia 25"], ["A Vitória não apareceu no dia 25. Passa ela pro dia 30 às 10h", "no dia 25"]])(
    "negated predicate '%s': the past 25/09 is held, 25/10 is only a card, nothing located", async (message, source) => {
      monthly();
      const state = fresh("appointment.change"), codes = await move(state, message, source);
      expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();
      expect(state.message).toBe(`Não encontrei agendamento de Vitória Lemos que a Secretária possa alterar em sex, 25/09, que já passou; “${source}” também é dom, 25/10. Selecione uma opção real.`);
      expect(state.candidates?.items.map(item => item.id)).toEqual(["a-vit-out"]);expect(codes).toContain("SOURCE_NEGATED_PREDICATE");
    });
  it("'faltou dia 25, remarca…': a card of 25/10 beside the past 25/09 it cannot change; the click proposes 25/10 with the dropped-day line", async () => {
    monthly();
    const state = fresh("appointment.change");
    await move(state, "A Vitória faltou dia 25, remarca ela pro dia 30 às 10h", "dia 25");
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.candidates?.items.map(item => item.id)).toEqual(["a-vit-out"]);
    expect(state.message).toBe("Não encontrei agendamento de Vitória Lemos que a Secretária possa alterar em sex, 25/09, que já passou; “dia 25” também é dom, 25/10. Selecione uma opção real.");
    await selectScheduling(lua, state, "a-vit-out", { clicked: true });
    expect(state.fields.appointment_ref).toBe("a-vit-out");expect(state.proposal).toBeDefined();expect(state.message).toContain("“dia 25” é dom, 25/10 (sex, 25/09 já passou).");
  });
  it("the cancel shape: a card too, whatever the past appointment's status (a cancelled one still names that day)", async () => {
    db.appointments = [appt("a-vit-set", lua.salonId, "c-vitoria", "2026-09-25T10:00", "CANCELLED"), appt("a-vit-out", lua.salonId, "c-vitoria", "2026-10-25T10:00")];
    const state = fresh("appointment.cancel");
    await turn(lua, state, "appointment.cancel", { customer_name: "Vitória", reason: "faltou", temporal_evidence: [c("date", "dia 25", dom(25))] }, "A Vitória faltou dia 25, cancela o horário dela porque faltou");
    expect(state.proposal).toBeUndefined();expect(state.candidates?.items.map(item => item.id)).toEqual(["a-vit-out"]);expect(state.message).toMatch(/^Não encontrei agendamento de Vitória Lemos que a Secretária possa alterar em sex, 25\/09, que já passou/);
  });
  it("adversarial: another salon's same-named client or another client of this salon on 25/09 never counts; no past appointment keeps B1's proposal", async () => {
    db.appointments = [appt("a-vit-out", lua.salonId, "c-vitoria", "2026-10-25T10:00"), appt("a-other-set", sol.salonId, "c-vitoria-n", "2026-09-25T10:00", "COMPLETED", "p-caio"),
      appt("a-gabi-set", lua.salonId, "c-gabi", "2026-09-25T10:00", "COMPLETED")];
    const state = fresh("appointment.cancel");
    await turn(lua, state, "appointment.cancel", { customer_name: "Vitória", reason: "mudou de cidade", temporal_evidence: [c("date", "dia 25", dom(25))] }, "cancela a Vitória do dia 25, ela mudou de cidade");
    expect(state.fields.appointment_ref).toBe("a-vit-out");expect(state.proposal).toBeDefined();expect(state.message).toContain("“dia 25” é dom, 25/10 (sex, 25/09 já passou).");
    expect(db.listed).toEqual([`${lua.salonId}|2026-10-25|c-vitoria`, `${lua.salonId}|2026-09-25|c-vitoria`]);
  });
  it("flag off: today's past-vs-next question; nothing is read about 25/09", async () => {
    flags(false, false, false); monthly();
    const state = fresh("appointment.change");
    await move(state, "A Vitória faltou dia 25, remarca ela pro dia 30 às 10h", "dia 25");
    expect(state.message).toBe(calendarConflictQuestion({ field: "source_date", kind: "DATE_CHOICE", expression: "dia 25", candidates: ["2026-09-25", "2026-10-25"] }));
    expect(db.listed).toEqual([]);
  });
});

describe("the salon's hours never settle a half-day against the owner's own words", () => {
  const book = (state: SchedulingState, message: string, extra: Record<string, unknown> = {}) => turn(sol, state, "appointment.create", { customer_name: "Hiroshi", service_name: "Barba",
    professional_name: "Caio", temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "pras 2", clock(2))], ...extra }, message);
  it.each([["Amanhã de manhã, marca o Hiroshi com o Caio pra barba pras 2"], ["Amanhã à noite marca o Hiroshi com o Caio pra barba, pras 2"], ["marca o Hiroshi amanhã pras 2 com o Caio pra barba, de tarde"]])(
    "a daypart written elsewhere ('%s'): today's question, no 14h", async message => {
      for (const period of [undefined, "morning"]) {
        const state = fresh("appointment.create"), codes = await book(state, message, period ? { period } : {});
        expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.message).toBe(QUESTION("pras 2"));
        expect(codes).toContain("DAYPART_HOURS_SKIPPED_WRITTEN");expect(codes).not.toContain("DAYPART_RESOLVED_BY_HOURS");
      }
    });
  it("the mark lasts while the question is open ('às 2' again) and ends with the owner's own answer ('às 14h')", async () => {
    const state = fresh("appointment.create");
    await book(state, "Amanhã de manhã, marca o Hiroshi com o Caio pra barba pras 2");
    await turn(sol, state, "appointment.create", { temporal_evidence: [c("time", "às 2", clock(2))] }, "às 2");
    expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.message).toBe(`${daypartChoiceRetry}\n${QUESTION("às 2")}`);
    await turn(sol, state, "appointment.create", { temporal_evidence: [c("time", "às 14h", clock(14))] }, "às 14h");
    expect(state.fields.time).toBe("14:00");expect(state.proposal).toBeDefined();expect(state).not.toHaveProperty("daypart_written");
  });
  it("control: no daypart written, or only a greeting (flag V2), still settles 14h by the barber's 08-20 hours", async () => {
    for (const message of ["marca o Hiroshi amanhã pras 2 com o Caio pra barba", "Boa tarde! Marca o Hiroshi amanhã pras 2 com o Caio pra barba"]) {
      const state = fresh("appointment.create"); await book(state, message);
      expect(state.fields.time).toBe("14:00");expect(state.message).toContain("Considerei 14h: às 2h Caio Brito não atende.");
    }
    flags(true, true, false); // without the greeting guard the greeting counts: the question stays (fail-safe)
    const plain = fresh("appointment.create"); await book(plain, "Boa tarde! Marca o Hiroshi amanhã pras 2 com o Caio pra barba");
    expect(plain.fields.time).toBeUndefined();expect(plain.message).toBe(QUESTION("pras 2"));
  });
  it("flag off: today's question, no mark", async () => {
    flags(false, false, false);
    const state = fresh("appointment.create"), codes = await book(state, "Amanhã de manhã, marca o Hiroshi com o Caio pra barba pras 2");
    expect(state.message).toBe(QUESTION("pras 2"));expect(state).not.toHaveProperty("daypart_written");expect(codes).not.toContain("DAYPART_HOURS_SKIPPED_WRITTEN");
  });
});

describe("an exclusion from an earlier turn reaches the salon's hours", () => {
  const ask = async (actor: Actor, state: SchedulingState, fields: Record<string, unknown>, message: string) => {
    await turn(actor, state, "appointment.create", { ...fields, temporal_evidence: [c("date", "amanhã", TOMORROW), { field: "time", text: "não às 14h", excluded: clock(14) }] }, message);
    expect(state.fields.time).toBeUndefined();
  };
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", "true"); });
  it("barbershop: 'não às 14h', then 'às 2': never 14h; said unavailable with the owner's exclusion and real times", async () => {
    const state = fresh("appointment.create");
    await ask(sol, state, { customer_name: "Kevin", service_name: "Corte", professional_name: "Caio" }, "marca o Kevin amanhã com o Caio pra corte, mas não às 14h");
    const codes = await turn(sol, state, "appointment.create", { temporal_evidence: [c("time", "às 2", clock(2))] }, "às 2");
    expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();expect(codes).toContain("DAYPART_UNAVAILABLE_BY_HOURS");
    expect(state.message).toBe("Esse horário não está disponível em qua, 30/09: às 2h Caio Brito não atende; você descartou às 14h. Tenho 8h, 8h30, 9h, 9h30, 10h. Qual horário você prefere?");
    expect(state.alternatives?.map(slot => slot.startLocal)).not.toContain("2026-09-30T14:00");
  });
  it("the kept exclusion ends once the owner gives the time, on the caller's state too (never a stale exclusion later)", async () => {
    const state = fresh("appointment.create");
    await ask(sol, state, { customer_name: "Kevin", service_name: "Corte", professional_name: "Caio" }, "marca o Kevin amanhã com o Caio pra corte, mas não às 14h");
    expect(state.excluded_readings).toEqual([{ field: "time", values: ["14:00"] }]);
    await turn(sol, state, "appointment.create", { temporal_evidence: [c("time", "às 10h", clock(10))] }, "às 10h");
    expect(state.fields.time).toBe("10:00");expect(state.proposal).toBeDefined();expect(state).not.toHaveProperty("excluded_readings");
  });
  it("24h spa: 'só não às 14h', then 'às 2': the only reading left is 02h, said before Confirmar", async () => {
    const state = fresh("appointment.create");
    await ask(spa, state, { customer_name: "Luz", service_name: "Massagem", professional_name: "Jade" }, "marca a Luz amanhã com a Jade pra massagem, só não às 14h");
    await turn(spa, state, "appointment.create", { temporal_evidence: [c("time", "às 2", clock(2))] }, "às 2");
    expect(state.fields.time).toBe("02:00");expect(state.proposal).toBeDefined();expect(state.message).toBe("PROPOSTA\nConsiderei 2h: você descartou às 14h.\nUse Confirmar para executar.");
  });
  it("adversarial: a cancel's own clock never lands on the reading the owner excluded in the same message (dates flag off)", async () => {
    flags(false, true, true);
    db.appointments = [{ id: "a-hiro", salonId: sol.salonId, customer_ref: "c-hiro", professional_ref: "p-caio", service_ref: "s-corte", start_local: "2026-09-29T14:00", status: "CONFIRMED" }];
    const state = fresh("appointment.cancel");
    await turn(sol, state, "appointment.cancel", { customer_name: "Hiroshi", reason: "ele viajou", temporal_evidence: [c("date", "hoje", TODAY), c("time", "das 2", clock(2)),
      { field: "time", text: "não às 14h", excluded: clock(14) }] }, "cancela o Hiroshi hoje das 2, não às 14h, porque ele viajou");
    expect(state.fields.time).not.toBe("14:00");expect(state.fields.appointment_ref).toBeUndefined();expect(state.proposal).toBeUndefined();
  });
  it("flag off: the exclusion is not kept and the question is today's", async () => {
    flags(false, false, false);
    const state = fresh("appointment.create");
    await ask(sol, state, { customer_name: "Kevin", service_name: "Corte", professional_name: "Caio" }, "marca o Kevin amanhã com o Caio pra corte, mas não às 14h");
    expect(state).not.toHaveProperty("excluded_readings");
    await turn(sol, state, "appointment.create", { temporal_evidence: [c("time", "às 2", clock(2))] }, "às 2");
    expect(state.message).toBe(QUESTION("às 2"));
  });
});

describe("the service filters whose hours decide, before it is resolved", () => {
  it("'com a Ana pra barba': only the morning Ana does barba; never 14h by the afternoon Ana (who only cuts)", async () => {
    const state = fresh("appointment.create");
    const codes = await turn(sol, state, "appointment.create", { customer_name: "Kevin", service_name: "Barba", professional_name: "Ana", temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "pras 2", clock(2))] },
      "marca o Kevin amanhã pras 2 com a Ana pra barba");
    expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();expect(codes).toContain("DAYPART_UNAVAILABLE_BY_HOURS");
    expect(state.message).toBe("Esse horário não está disponível em qua, 30/09: às 2h e às 14h Ana Luiza Prado não atende. Tenho 8h, 8h30, 9h, 9h30, 10h. Qual horário você prefere?");
    expect(state.daypart_hours?.[0].basis).toBe("BOOK|2026-09-30|p-ana2|30");
  });
  it("adversarial: a named professional who does not do the service lends nobody's hours: today's question, then the eligibility notice", async () => {
    const state = fresh("appointment.create");
    const codes = await turn(sol, state, "appointment.create", { customer_name: "Kevin", service_name: "Sobrancelha", professional_name: "Caio", temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "pras 2", clock(2))] },
      "marca o Kevin amanhã pras 2 com o Caio pra sobrancelha");
    expect(state.fields.time).toBeUndefined();expect(codes).not.toContain("DAYPART_RESOLVED_BY_HOURS");expect(codes).not.toContain("DAYPART_UNAVAILABLE_BY_HOURS");
    expect(state.message).toBe(QUESTION("pras 2"));expect(state.proposal).toBeUndefined();
  });
});

describe("LOCATE with a clock the owner fixed", () => {
  const cancel = (state: SchedulingState, clockQuote: string, value: ClockComponent) => turn(lua, state, "appointment.cancel", { customer_name: "Gabriela", reason: "ela vai viajar",
    temporal_evidence: [c("date", "sexta que vem", FRIDAY), c("time", clockQuote, value)] }, `cancela a Gabriela de sexta que vem ${clockQuote}, ela vai viajar`);
  beforeEach(() => { vi.setSystemTime(new Date("2026-09-28T15:00:00Z")); }); // Monday
  it("her Fridays are at other times: the notice names the clock and her real times, the clock is asked; her answer then locates", async () => {
    db.appointments = [appt("a-gabi-02", lua.salonId, "c-gabi", "2026-10-02T15:00"), appt("a-gabi-09", lua.salonId, "c-gabi", "2026-10-09T16:00")];
    const state = fresh("appointment.cancel"), codes = await cancel(state, "às 10h", clock(10));
    expect(state.message).toBe("Não encontrei agendamento futuro de Gabriela Nunes em sex, 02/10 nem em sex, 09/10 às 10h. Encontrei sex, 02/10 às 15h e sex, 09/10 às 16h. Preciso confirmar horário do atendimento. Pode informar?");
    expect(codes).toContain("LOCATE_CLOCK_ASKED");expect(codes).not.toContain("DATE_CHOICE_RESOLVED_BY_AGENDA_NONE");expect(state.waiting_for).toBe("time");expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();
    await turn(lua, state, "appointment.cancel", { temporal_evidence: [c("time", "às 16h", clock(16))] }, "às 16h");
    expect(state.fields).toMatchObject({ date: "2026-10-09", time: "16:00", appointment_ref: "a-gabi-09" });expect(state.proposal).toBeDefined();
  });
  it("nothing on either Friday: the notice names the clock and the day is asked (as today)", async () => {
    db.appointments = [appt("a-gabi-16", lua.salonId, "c-gabi", "2026-10-16T10:00")];
    const state = fresh("appointment.cancel"); await cancel(state, "às 10h", clock(10));
    expect(state.message).toBe("Não encontrei agendamento futuro de Gabriela Nunes em sex, 02/10 nem em sex, 09/10 às 10h. Preciso confirmar data do atendimento. Pode informar?");
    expect(state.waiting_for).toBe("date");
  });
  it("adversarial: another salon's appointments at the same clock never count", async () => {
    db.customers.push({ id: "c-gabi-n", name: "Gabriela Nunes", salonId: sol.salonId });
    db.appointments = [appt("a-gabi-n", sol.salonId, "c-gabi-n", "2026-10-02T10:00", "CONFIRMED", "p-caio")];
    const state = fresh("appointment.cancel"); await cancel(state, "às 10h", clock(10));
    expect(state.fields.appointment_ref).toBeUndefined();expect(state.message).toMatch(/^Não encontrei agendamento futuro de Gabriela Nunes em sex, 02\/10 nem em sex, 09\/10 às 10h\. Preciso confirmar data/);
  });
});

describe("the DATE_CHOICE retry asks for what can settle it", () => {
  it("'sexta que vem' (same month) asks for the day, and 'dia 9' then settles it", async () => {
    vi.setSystemTime(new Date("2026-09-28T15:00:00Z")); // Monday
    const state = fresh("appointment.list");
    await turn(spa, state, "appointment.list", { professional_name: "Jade", temporal_evidence: [c("date", "sexta que vem", FRIDAY)] }, "o que a Jade tem sexta que vem?");
    const question = calendarConflictQuestion({ field: "date", kind: "DATE_CHOICE", expression: "sexta que vem", candidates: ["2026-10-02", "2026-10-09"] });
    expect(state.message).toBe(question);
    await turn(spa, state, "appointment.list", { temporal_evidence: [c("date", "sexta que vem", FRIDAY)] }, "sexta que vem");
    expect(state.message).toBe(`${dateChoiceRetryFor(["2026-10-02", "2026-10-09"])}\n${question}`);expect(state.message).toContain("responda com o dia");
    await turn(spa, state, "appointment.list", { temporal_evidence: [c("date", "dia 9", dom(9))] }, "dia 9");
    expect(state.fields.date).toBe("2026-10-09");expect(state.message).toBe("Jade não tem atendimentos em sex, 09/10.");
  });
});
