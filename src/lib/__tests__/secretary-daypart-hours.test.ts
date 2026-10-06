import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** Candidate 4, track R2 through the real scheduling adapter (flags SALON_SECRETARY_DAYPART_BY_HOURS and
 * SALON_SECRETARY_DAYPART_RULES_V2): the two readings of a bare hour are settled by the TENANT's real facts for that day and
 * professional (backlog §0 adversarials), said before Confirmar, re-checked when the professional/service/day change, and a
 * half-day question is never asked again silently. Fake tenant transaction: the real draft journal, locator filters and facts
 * loader run; three different businesses (barbearia, estúdio noturno de tatuagem, spa 24h). No DB, no network, no model. */
type Pro = { id: string; name: string; salonId: string; services: string[] };
type Appt = { id: string; salonId: string; customer_ref: string; professional_ref: string; service_ref: string; start_local: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown, rows: [] as Record<string, unknown>[], pros: [] as Pro[], appointments: [] as Appt[], failFacts: false,
  hours: [] as { salonId: string; professionalId: string; weekday: number; startMinutes: number; endMinutes: number }[],
  closures: [] as { salonId: string; startAt: Date; endAt: Date }[], offs: [] as { professionalId: string; startAt: Date; endAt: Date }[],
  customers: [] as { id: string; name: string; salonId: string }[], services: [] as { id: string; name: string; salonId: string; durationMin: number }[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000);
const minute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const hhmm = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const dto = (a: Appt) => ({ appointment_ref: a.id, customer_ref: a.customer_ref, customer_name: db.customers.find(row => row.id === a.customer_ref)?.name ?? "?",
  professional_ref: a.professional_ref, professional_name: db.pros.find(row => row.id === a.professional_ref)?.name ?? "?", service_ref: a.service_ref, services: [],
  start_at: utc(a.start_local).toISOString(), end_at: new Date(utc(a.start_local).getTime() + 30 * 60_000).toISOString(), start_local: a.start_local,
  end_local: `${a.start_local.slice(0, 11)}${hhmm(minute(a.start_local.slice(11)) + 30)}`, timezone: "America/Sao_Paulo", status: a.status, revision: 1, priceCents: 5000 });
/** The booking engine stand-in: a start is free when the whole service fits one working interval, no closure/TimeOff/booking overlaps. */
function free(salonId: string, pro: string, service: string, date: string, start: number) {
  const duration = db.services.find(row => row.id === service)?.durationMin ?? 30, weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const [a, b] = [utc(`${date}T${hhmm(start)}`), utc(`${date}T${hhmm(start)}`).getTime() + duration * 60_000];
  return db.hours.some(row => row.salonId === salonId && row.professionalId === pro && row.weekday === weekday && row.startMinutes <= start && start + duration <= row.endMinutes) &&
    !db.closures.some(row => row.salonId === salonId && row.startAt.getTime() < b && row.endAt > a) && !db.offs.some(row => row.professionalId === pro && row.startAt.getTime() < b && row.endAt > a) &&
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
  listSchedulingAppointments: async (_tx: unknown, actor: { salonId: string }, input: { date: string; customer_ref?: string; professional_ref?: string }) =>
    db.appointments.filter(a => a.salonId === actor.salonId && a.start_local.startsWith(input.date) && (!input.customer_ref || a.customer_ref === input.customer_ref) &&
      (!input.professional_ref || a.professional_ref === input.professional_ref)).map(dto),
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
import { slotOptions } from "../secretary-options";
import { daypartChoiceRetry } from "../scheduling-temporal-ambiguity";

const sol = { salonId: "barbearia-sol", userId: "dono-sol" }, noite = { salonId: "estudio-noite", userId: "dona-noite" }, spa = { salonId: "spa-lua", userId: "dona-spa" };
type Actor = typeof sol;
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const TOMORROW = day({ kind: "RELATIVE_DAY", offset: 1 }), TODAY = day({ kind: "RELATIVE_DAY", offset: 0 });
const clock = (hour: number, minute_ = 0, daypart: ClockComponent["daypart"] = "UNSPECIFIED"): ClockComponent => ({ hour, minute: minute_, daypart });
const c = (field: string, text: string, component: DayComponent | ClockComponent) => ({ field, text, component });
const fresh = (operation: string): SchedulingState => ({ ...schedulingState(), operation: operation as SchedulingState["operation"] });
const flags = (hours: boolean, v2: boolean) => { vi.stubEnv("SALON_SECRETARY_DAYPART_BY_HOURS", hours ? "true" : "false"); vi.stubEnv("SALON_SECRETARY_DAYPART_RULES_V2", v2 ? "true" : "false"); };
async function turn(actor: Actor, state: SchedulingState, operation: string, fields: Record<string, unknown>, message: string) {
  return applySchedulingInterpretation(actor, state, { operation, ...fields } as never, message);
}
const book = (actor: Actor, state: SchedulingState, who: string, service: string, pro: string, quote: string, value: ClockComponent, message: string) =>
  turn(actor, state, "appointment.create", { customer_name: who, service_name: service, professional_name: pro, temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", quote, value)] }, message);
const hours = (salonId: string, professionalId: string, weekday: number, from: string, to: string) => ({ salonId, professionalId, weekday, startMinutes: minute(from), endMinutes: to === "24:00" ? 1440 : minute(to) });
const confirmed = () => db.rows.filter(row => row.action === "CONFIRMED");

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true"); flags(true, true);
  db.rows = []; db.appointments = []; db.closures = []; db.offs = []; db.failFacts = false;
  db.pros = [{ id: "p-caio", name: "Caio Brito", salonId: sol.salonId, services: ["s-corte", "s-barba", "s-progressiva"] }, { id: "p-lia", name: "Lia Moraes", salonId: sol.salonId, services: ["s-corte"] },
    { id: "p-ana1", name: "Ana Paula Reis", salonId: sol.salonId, services: ["s-barba"] }, { id: "p-ana2", name: "Ana Luiza Prado", salonId: sol.salonId, services: ["s-barba"] },
    { id: "p-kai", name: "Caio Brito", salonId: noite.salonId, services: ["s-tattoo"] }, { id: "p-jade", name: "Jade Moura", salonId: spa.salonId, services: ["s-massagem"] }];
  db.hours = [2, 3, 4].flatMap(weekday => [hours(sol.salonId, "p-caio", weekday, "08:00", "20:00"), hours(sol.salonId, "p-lia", weekday, "08:00", "12:00"),
    hours(sol.salonId, "p-ana1", weekday, "14:00", "20:00"), hours(sol.salonId, "p-ana2", weekday, "08:00", "12:00"),
    hours(noite.salonId, "p-kai", weekday, "00:00", "03:00"), hours(noite.salonId, "p-kai", weekday, "18:00", "24:00"), hours(spa.salonId, "p-jade", weekday, "00:00", "24:00")]);
  db.customers = [{ id: "c-kevin", name: "Kevin Sato", salonId: sol.salonId }, { id: "c-hiro", name: "Hiroshi Tanaka", salonId: sol.salonId }, { id: "c-duda", name: "Duda Ramos", salonId: sol.salonId },
    { id: "c-yas", name: "Yasmin Kato", salonId: noite.salonId }, { id: "c-teo", name: "Téo Lins", salonId: spa.salonId }];
  db.services = [{ id: "s-corte", name: "Corte masculino", salonId: sol.salonId, durationMin: 30 }, { id: "s-barba", name: "Barba", salonId: sol.salonId, durationMin: 30 },
    { id: "s-progressiva", name: "Progressiva", salonId: sol.salonId, durationMin: 180 }, { id: "s-tattoo", name: "Tatuagem fineline", salonId: noite.salonId, durationMin: 60 },
    { id: "s-massagem", name: "Massagem relaxante", salonId: spa.salonId, durationMin: 60 }];
  const find = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  const failing = <T>(value: T) => { if (db.failFacts) throw Error("FACTS_UNAVAILABLE"); return value; };
  const overlapping = (row: { startAt: Date; endAt: Date }, where: { startAt: { lt: Date }; endAt: { gt: Date } }) => row.startAt < where.startAt.lt && row.endAt > where.endAt.gt;
  db.tx = { $executeRaw: vi.fn(async () => 0), membership: { findFirstOrThrow: async () => ({ role: "OWNER" }) },
    workingHours: { findFirst: async ({ where }: { where: { salonId: string } }) => db.hours.find(row => row.salonId === where.salonId) ?? null,
      // 06/10: one professional (working-hours.ts) or a list of them (the day facts).
      findMany: async ({ where }: { where: { salonId: string; professionalId: string | { in: string[] }; weekday: number } }) => db.hours.filter(row => row.salonId === where.salonId && (typeof where.professionalId === "string" ? row.professionalId === where.professionalId : where.professionalId.in.includes(row.professionalId)) && row.weekday === where.weekday) },
    professionalOpening: { findMany: async () => [] },
    salonClosure: { findMany: async ({ where }: { where: { salonId: string; startAt: { lt: Date }; endAt: { gt: Date } } }) => failing(db.closures.filter(row => row.salonId === where.salonId && overlapping(row, where))) },
    timeOff: { findMany: async ({ where }: { where: { professionalId: { in: string[] }; professional: { salonId: string }; startAt: { lt: Date }; endAt: { gt: Date } } }) =>
      db.offs.filter(row => where.professionalId.in.includes(row.professionalId) && db.pros.find(pro => pro.id === row.professionalId)?.salonId === where.professional.salonId && overlapping(row, where)) },
    service: { findFirst: async ({ where }: { where: { id: string; salonId: string } }) => db.services.find(row => row.id === where.id && row.salonId === where.salonId) ?? null },
    appointment: { findMany: async ({ where }: { where: { salonId: string; clientId?: string; status: { in: string[] }; startAt: { gt: Date } } }) =>
      db.appointments.filter(a => a.salonId === where.salonId && (!where.clientId || a.customer_ref === where.clientId) && where.status.in.includes(a.status) && utc(a.start_local) > where.startAt.gt).map(a => ({ id: a.id })) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.rows.push(structuredClone(data)); return data; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)[0] ?? null) } } as unknown as Tx;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(confirmed()).toEqual([]); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const QUESTION = (expression: string, a: string, b: string) => `No horário de destino, “${expression}” significa ${a} ou ${b}?`;

describe("BOOK by the tenant's facts (backlog §0)", () => {
  const MESSAGE = "marca o Kevin amanhã pras 2 com o Caio pra corte";
  it("a barbershop open 08-20: 'pras 2' is 14h, said before Confirmar; the flag off keeps today's question", async () => {
    const state = fresh("appointment.create"), codes = await book(sol, state, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(state.fields).toMatchObject({ date: "2026-09-30", time: "14:00", professional_ref: "p-caio", customer_ref: "c-kevin" });
    expect(state.proposal).toBeDefined();expect(state.receipt).toBeUndefined();expect(codes).toContain("DAYPART_RESOLVED_BY_HOURS");
    expect(state.message).toBe("PROPOSTA\nConsiderei 14h: às 2h Caio Brito não atende.\nUse Confirmar para executar.");
    expect(state.daypart_hours).toEqual([{ field: "time", value: "14:00", candidates: ["02:00", "14:00"], expression: "pras 2", basis: "BOOK|2026-09-30|p-caio|30", line: "Considerei 14h: às 2h Caio Brito não atende." }]);
    flags(false, false);
    const before = fresh("appointment.create"), off = await book(sol, before, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(before.fields.time).toBeUndefined();expect(before.message).toBe(QUESTION("pras 2", "02h", "14h"));expect(off).not.toContain("DAYPART_RESOLVED_BY_HOURS");
    expect(before).not.toHaveProperty("daypart_hours");
  });
  it("each flag stands alone: the tenant's hours without the V2 rules settle 14h; the V2 rules alone never read the hours", async () => {
    flags(true, false);
    const hoursOnly = fresh("appointment.create"); await book(sol, hoursOnly, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(hoursOnly.fields.time).toBe("14:00");expect(hoursOnly.message).toContain("Considerei 14h");
    flags(false, true);
    const rulesOnly = fresh("appointment.create"); await book(sol, rulesOnly, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(rulesOnly.fields.time).toBeUndefined();expect(rulesOnly.message).toBe(QUESTION("pras 2", "02h", "14h"));expect(rulesOnly).not.toHaveProperty("daypart_hours");
  });
  it("tenant isolation: another salon's TimeOff, closure and hours for a same-named professional never count", async () => {
    db.offs = [{ professionalId: "p-kai", startAt: utc("2026-09-30T00:00"), endAt: utc("2026-10-01T00:00") }];
    db.closures = [{ salonId: noite.salonId, startAt: utc("2026-09-30T00:00"), endAt: utc("2026-10-01T00:00") }];
    const state = fresh("appointment.create"); await book(sol, state, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(state.fields).toMatchObject({ time: "14:00", professional_ref: "p-caio" });expect(state.proposal).toBeDefined();
  });
  it("a morning-only professional: unavailable with her real free times; never 14h with someone else, never 02h", async () => {
    const state = fresh("appointment.create"), codes = await book(sol, state, "Kevin", "Corte", "Lia", "pras 2", clock(2), "marca o Kevin amanhã pras 2 com a Lia pra corte");
    expect(state.fields.time).toBeUndefined();expect(state.fields.professional_ref).not.toBe("p-caio");expect(state.proposal).toBeUndefined();
    expect(state.pending_temporal_ambiguities).toEqual([]);expect(state.waiting_for).toBe("time");expect(codes).toContain("DAYPART_UNAVAILABLE_BY_HOURS");
    expect(state.message).toBe("Esse horário não está disponível em qua, 30/09: às 2h e às 14h Lia Moraes não atende. Tenho 8h, 8h30, 9h, 9h30, 10h. Qual horário você prefere?");
    expect(slotOptions(state).map(option => option.label)).toEqual(["qua, 30/09 às 8h", "qua, 30/09 às 8h30", "qua, 30/09 às 9h", "qua, 30/09 às 9h30", "qua, 30/09 às 10h"]);
    // The owner then picks a real time: the normal proposal, still with Lia.
    await turn(sol, state, "appointment.create", { time: "09:00" }, "09:00");
    expect(state.fields).toMatchObject({ time: "09:00", professional_ref: "p-lia" });expect(state.proposal).toBeDefined();expect(state.message).not.toContain("Considerei");
  });
  it("a night tattoo studio (18h-03h): 'às 2' is 02h; the same name in the barbershop never leaks its hours", async () => {
    const state = fresh("appointment.create");
    await book(noite, state, "Yasmin", "Tatuagem", "Caio", "às 2", clock(2), "coloca a Yasmin amanhã às 2 com o Caio pra tatuagem");
    expect(state.fields).toMatchObject({ time: "02:00", professional_ref: "p-kai" });expect(state.message).toContain("Considerei 2h: às 14h Caio Brito não atende.");
    const day_ = fresh("appointment.create");
    await book(sol, day_, "Kevin", "Corte", "Caio", "às 2", clock(2), "coloca o Kevin amanhã às 2 com o Caio pra corte");
    expect(day_.fields).toMatchObject({ time: "14:00", professional_ref: "p-caio" });
  });
  it("a 24h spa keeps the question; its two open readings are click options from the first ask (flag V2 only)", async () => {
    const state = fresh("appointment.create");
    await book(spa, state, "Téo", "Massagem", "Jade", "às 2", clock(2), "marca o Téo amanhã às 2 com a Jade pra massagem");
    expect(state.fields.time).toBeUndefined();expect(state.message).toBe(QUESTION("às 2", "02h", "14h"));
    expect(slotOptions(state)).toEqual([{ option_id: "opt_1", label: "qua, 30/09 às 2h", startLocal: "2026-09-30T02:00" }, { option_id: "opt_2", label: "qua, 30/09 às 14h", startLocal: "2026-09-30T14:00" }]);
    flags(true, false); expect(slotOptions(state)).toEqual([]);
  });
  it("a day the salon is closed: said, and no reading is chosen", async () => {
    db.closures = [{ salonId: sol.salonId, startAt: utc("2026-09-30T00:00"), endAt: utc("2026-10-01T00:00") }];
    const state = fresh("appointment.create"); await book(sol, state, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(state.fields.time).toBeUndefined();expect(state.message).toBe("Esse horário não está disponível: o salão está fechado em qua, 30/09. Qual outro horário ou dia você prefere?");
  });
  it("a TimeOff covering 14h: that reading is not possible to book (the block rule is tested apart)", async () => {
    db.offs = [{ professionalId: "p-caio", startAt: utc("2026-09-30T13:00"), endAt: utc("2026-09-30T15:00") }];
    const state = fresh("appointment.create"); await book(sol, state, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(state.fields.time).toBeUndefined();expect(state.message).toMatch(/^Esse horário não está disponível em qua, 30\/09: às 2h Caio Brito não atende; às 14h Caio Brito está indisponível\. Tenho 8h/);
  });
  it("'às 2 da manhã' in the day barbershop: the written daypart wins and the closed hour is said; never 14h", async () => {
    const state = fresh("appointment.create"), codes = await book(sol, state, "Kevin", "Corte", "Caio", "às 2 da manhã", clock(2, 0, "MANHA"), "marca o Kevin amanhã às 2 da manhã com o Caio pra corte");
    expect(state.fields.time).toBe("02:00");expect(state.proposal).toBeUndefined();expect(state.message).toMatch(/^Esse horário está indisponível\. Tenho 8h/);
    expect(codes).not.toContain("DAYPART_RESOLVED_BY_HOURS");
  });
  it("the settled 14h is taken: the normal unavailable answer with alternatives, never the other reading", async () => {
    db.appointments = [{ id: "a-ocupado", salonId: sol.salonId, customer_ref: "c-hiro", professional_ref: "p-caio", service_ref: "s-corte", start_local: "2026-09-30T14:00", status: "CONFIRMED" }];
    const state = fresh("appointment.create"); await book(sol, state, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(state.fields.time).toBe("14:00");expect(state.proposal).toBeUndefined();
    expect(state.message).toBe("Esse horário está indisponível. Tenho 14h30, 15h, 15h30, 16h, 16h30. Qual horário você prefere?\nConsiderei 14h: às 2h Caio Brito não atende.");
  });
  it("a 180-minute service at 19h does not fit the 20h close: unavailable, never a squeezed booking", async () => {
    const state = fresh("appointment.create"); await book(sol, state, "Kevin", "Progressiva", "Caio", "pras 7", clock(7), "marca o Kevin amanhã pras 7 com o Caio pra progressiva");
    expect(state.fields.time).toBeUndefined();
    expect(state.message).toMatch(/^Esse horário não está disponível em qua, 30\/09: às 7h Caio Brito não atende; às 19h o serviço não cabe no expediente de Caio Brito\. Tenho 8h/);
  });
  it("'não às 2': nothing is resolved and nothing is asked about 02h/14h", async () => {
    const state = fresh("appointment.create"), codes = await turn(sol, state, "appointment.create", { customer_name: "Kevin", service_name: "Corte", professional_name: "Caio",
      temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "às 2", clock(2))] }, "marca o Kevin amanhã com o Caio pra corte, mas não às 2");
    expect(state.fields.time).toBeUndefined();expect(state.pending_temporal_ambiguities ?? []).toEqual([]);expect(codes).not.toContain("DAYPART_RESOLVED_BY_HOURS");expect(state.proposal).toBeUndefined();
  });
  it("the facts read failing, or a salon without configured hours: today's question", async () => {
    db.failFacts = true;
    const failing = fresh("appointment.create"); await book(sol, failing, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(failing.message).toBe(QUESTION("pras 2", "02h", "14h"));
    db.failFacts = false; db.hours = db.hours.filter(row => row.salonId !== sol.salonId);
    const unconfigured = fresh("appointment.create"); await book(sol, unconfigured, "Kevin", "Corte", "Caio", "pras 2", clock(2), MESSAGE);
    expect(unconfigured.message).toBe(QUESTION("pras 2", "02h", "14h"));
  });
  it("homonym 'Ana': the envelope of both settles 14h without choosing either; picking the morning one re-checks and says unavailable", async () => {
    const state = fresh("appointment.create");
    await book(sol, state, "Kevin", "Barba", "Ana", "pras 2", clock(2), "marca o Kevin amanhã pras 2 com a Ana pra barba");
    expect(state.fields.time).toBe("14:00");expect(state.fields.professional_ref).toBeUndefined();
    expect(state.candidates?.items.map(item => item.id).sort()).toEqual(["p-ana1", "p-ana2"]);expect(state.proposal).toBeUndefined();
    await selectScheduling(sol, state, "p-ana2", { clicked: true });
    expect(state.fields.professional_ref).toBe("p-ana2");expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();
    expect(state.message).toMatch(/^Esse horário não está disponível em qua, 30\/09: às 2h e às 14h Ana Luiza Prado não atende\. Tenho 8h/);
  });
  it("the service changes after the resolution: the owner's two readings are checked again for the new duration", async () => {
    const state = fresh("appointment.create");
    await book(sol, state, "Kevin", "Corte", "Caio", "pras 7", clock(7), "marca o Kevin amanhã pras 7 com o Caio pra corte");
    expect(state.fields.time).toBe("19:00");expect(state.proposal).toBeDefined();
    const codes = await turn(sol, state, "appointment.create", { service_name: "Progressiva" }, "na verdade é progressiva");
    expect(codes).toContain("DAYPART_HOURS_STALE");expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();
    expect(state.message).toContain("às 19h o serviço não cabe no expediente de Caio Brito");
  });
});

describe("BLOCK and LOCATE by the tenant's facts", () => {
  it("'das 2 às 6' for a professional 08-20 blocks 14h-18h (both edges said before Confirmar)", async () => {
    const state = fresh("schedule.block"), codes = await turn(sol, state, "schedule.block", { professional_name: "Caio",
      temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "das 2 às 6", clock(2)), c("end_time", "das 2 às 6", clock(6))] }, "fecha a agenda do Caio amanhã das 2 às 6");
    expect(state.fields).toMatchObject({ time: "14:00", end_time: "18:00", professional_ref: "p-caio" });expect(state.proposal).toBeDefined();
    expect(codes.filter(code => code === "DAYPART_RESOLVED_BY_HOURS")).toHaveLength(2);
    expect(state.message).toBe("PROPOSTA\nConsiderei 14h: às 2h Caio Brito não atende. Considerei 18h: às 6h Caio Brito não atende.\nUse Confirmar para executar.");
  });
  it("'das 10 às 2': 10h-14h in the barbershop; in the night studio (where it may cross midnight) both readings are asked", async () => {
    const block = (actor: Actor, state: SchedulingState) => turn(actor, state, "schedule.block", { professional_name: "Caio",
      temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "das 10 às 2", clock(10)), c("end_time", "das 10 às 2", clock(2))] }, "fecha a agenda do Caio amanhã das 10 às 2");
    const day_ = fresh("schedule.block"), dayCodes = await block(sol, day_);
    expect(day_.fields).toMatchObject({ time: "10:00", end_time: "14:00" });expect(day_.proposal).toBeDefined();expect(dayCodes).toContain("DAYPART_RESOLVED_BY_INTERVAL");
    const night = fresh("schedule.block"), nightCodes = await block(noite, night);
    expect(nightCodes).toContain("DAYPART_INTERVAL_REJECTED_BY_HOURS");expect(night.proposal).toBeUndefined();
    expect(night.fields.time).toBeUndefined();expect(night.fields.end_time).toBeUndefined();
    expect(night.pending_temporal_ambiguities).toEqual([{ field: "time", kind: "CLOCK_DAYPART", expression: "das 10 às 2", candidates: ["10:00", "22:00"] },
      { field: "end_time", kind: "CLOCK_DAYPART", expression: "das 10 às 2", candidates: ["02:00", "14:00"] }]);
    // Without the tenant's hours the interval rule alone keeps 10h-14h (shown before Confirmar; nothing is written).
    flags(false, true);
    const blind = fresh("schedule.block"); await block(noite, blind);
    expect(blind.fields).toMatchObject({ time: "10:00", end_time: "14:00" });
  });
  it("a block may cover the professional's TimeOff: 'das 2 até as 17h' is 14h-17h even with a TimeOff at 14h", async () => {
    db.offs = [{ professionalId: "p-caio", startAt: utc("2026-09-30T13:00"), endAt: utc("2026-09-30T15:00") }];
    const state = fresh("schedule.block");
    await turn(sol, state, "schedule.block", { professional_name: "Caio", temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "das 2", clock(2)), c("end_time", "até as 17h", clock(17))] },
      "fecha a agenda do Caio amanhã das 2 até as 17h");
    expect(state.fields).toMatchObject({ time: "14:00", end_time: "17:00" });
  });
  it("a cancel 'das 2' said at 12h: 02h already passed, 14h is her real appointment; flag off asks", async () => {
    db.appointments = [{ id: "a-hiro", salonId: sol.salonId, customer_ref: "c-hiro", professional_ref: "p-caio", service_ref: "s-corte", start_local: "2026-09-29T14:00", status: "CONFIRMED" }];
    const cancel = (state: SchedulingState) => turn(sol, state, "appointment.cancel", { customer_name: "Hiroshi", reason: "ele viajou",
      temporal_evidence: [c("date", "hoje", TODAY), c("time", "das 2", clock(2))] }, "cancela o Hiroshi hoje das 2 porque ele viajou");
    const state = fresh("appointment.cancel"); await cancel(state);
    expect(state.fields).toMatchObject({ time: "14:00", appointment_ref: "a-hiro" });expect(state.proposal).toBeDefined();
    expect(state.message).toBe("PROPOSTA\nConsiderei 14h: às 2h já passou.\nUse Confirmar para executar.");
    flags(false, false);
    const before = fresh("appointment.cancel"); await cancel(before);
    expect(before.fields.appointment_ref).toBeUndefined();expect(before.message).toBe(QUESTION("das 2", "02h", "14h"));
  });
  it("a cancel whose two readings both passed keeps its question and says why nothing can be located", async () => {
    vi.setSystemTime(new Date("2026-09-29T18:30:00Z")); // 15h30 in São Paulo
    const state = fresh("appointment.cancel");
    await turn(sol, state, "appointment.cancel", { customer_name: "Hiroshi", reason: "ele viajou", temporal_evidence: [c("date", "hoje", TODAY), c("time", "das 2", clock(2))] },
      "cancela o Hiroshi hoje das 2 porque ele viajou");
    expect(state.fields.time).toBeUndefined();expect(state.pending_temporal_ambiguities).toHaveLength(1);
    expect(state.message).toBe(`Em ter, 29/09, às 2h e às 14h já passaram: a Secretária só altera agendamentos futuros.\n${QUESTION("das 2", "02h", "14h")}`);
  });
  it("a move 'pras 2' keeps its appointment's professional and day: 14h with the barber, unavailable with the morning-only one", async () => {
    db.appointments = [{ id: "a-duda", salonId: sol.salonId, customer_ref: "c-duda", professional_ref: "p-caio", service_ref: "s-corte", start_local: "2026-09-30T10:00", status: "CONFIRMED" }];
    const move = (state: SchedulingState) => turn(sol, state, "appointment.change", { customer_name: "Duda", temporal_evidence: [c("time", "pras 2", clock(2))] }, "passa a Duda pras 2");
    const state = fresh("appointment.change"); await move(state);
    expect(state.fields).toMatchObject({ time: "14:00", date: "2026-09-30", appointment_ref: "a-duda" });expect(state.proposal).toBeDefined();
    db.appointments[0].professional_ref = "p-lia";
    const morning = fresh("appointment.change"); await move(morning);
    expect(morning.fields.time).toBeUndefined();expect(morning.message).toMatch(/^Esse horário não está disponível em qua, 30\/09: às 2h e às 14h Lia Moraes não atende\./);
  });
  it("owner 05/10: a move whose appointment is not chosen yet is checked against every appointment it may be: 'às 9' is 9h when all close at 20h; a late professional keeps the question", async () => {
    vi.stubEnv("SALON_SECRETARY_DAYPART_ASK_WIDE", "true"); // decision 18: a bare 8-11 is asked unless the tenant's hours settle it
    db.appointments = [{ id: "a-duda-1", salonId: sol.salonId, customer_ref: "c-duda", professional_ref: "p-caio", service_ref: "s-corte", start_local: "2026-09-30T10:00", status: "CONFIRMED" },
      { id: "a-duda-2", salonId: sol.salonId, customer_ref: "c-duda", professional_ref: "p-lia", service_ref: "s-corte", start_local: "2026-10-01T10:00", status: "CONFIRMED" }];
    const move = (state: SchedulingState) => turn(sol, state, "appointment.change", { customer_name: "Duda",
      temporal_evidence: [c("date", "depois de amanhã", day({ kind: "RELATIVE_DAY", offset: 2 })), c("time", "às 9", clock(9))] }, "passa a Duda pra depois de amanhã às 9");
    const state = fresh("appointment.change"), codes = await move(state);
    expect(codes).toContain("DAYPART_RESOLVED_BY_HOURS");
    expect(state.fields).toMatchObject({ date: "2026-10-01", time: "09:00" });expect(state.fields.appointment_ref).toBeUndefined(); // which one is still asked
    expect(state.pending_temporal_ambiguities ?? []).toEqual([]);
    // One of the possible professionals works until 23h that day: 21h stays possible, so the owner is asked as before.
    db.hours.push(hours(sol.salonId, "p-lia", 4, "18:00", "23:00"));
    const late = fresh("appointment.change"); await move(late);
    expect(late.fields.time).toBeUndefined();expect(late.message).toContain(QUESTION("às 9", "09h", "21h"));
  });
});

describe("UX: a half-day question is never asked again silently (flag V2)", () => {
  const ask = async () => { const state = fresh("appointment.create"); await book(spa, state, "Téo", "Massagem", "Jade", "às 2", clock(2), "marca o Téo amanhã às 2 com a Jade pra massagem"); return state; };
  it("an answer that re-creates the same two readings says so above the question; flag off repeats it identically", async () => {
    const state = await ask(), first = state.message;
    const codes = await turn(spa, state, "appointment.create", { temporal_evidence: [c("time", "às 2", clock(2))] }, "às 2");
    expect(codes).toContain("DAYPART_CHOICE_REPEATED");expect(state.message).toBe(`${daypartChoiceRetry}\n${first}`);expect(state.message).not.toBe(first);
    flags(true, false);
    const before = await ask(), again = before.message;
    await turn(spa, before, "appointment.create", { temporal_evidence: [c("time", "às 2", clock(2))] }, "às 2");
    expect(before.message).toBe(again);
  });
  it("an answer that is not applied is said on its own line (never stacked); flag off keeps today's inline prefix", async () => {
    const state = await ask();
    const codes = await turn(spa, state, "appointment.create", { temporal_evidence: [c("time", "às 14h", clock(15))] }, "às 14h");
    expect(codes).toContain("DAYPART_ANSWER_UNRESOLVED");expect(state.fields.time).toBeUndefined();
    expect(state.message).toBe(`${daypartChoiceRetry}\n${QUESTION("às 2", "02h", "14h")}`);
    await turn(spa, state, "appointment.create", { temporal_evidence: [c("time", "às 14h", clock(15))] }, "às 14h");
    expect(state.message).toBe(`${daypartChoiceRetry}\n${QUESTION("às 2", "02h", "14h")}`);
    flags(true, false);
    const before = await ask();
    await turn(spa, before, "appointment.create", { temporal_evidence: [c("time", "às 14h", clock(15))] }, "às 14h");
    expect(before.message).toBe(`Não consegui associar essa resposta com segurança à informação solicitada. ${QUESTION("às 2", "02h", "14h")}`);
  });
  it("adversarial: a negated half-day answer ('não, da tarde não') settles nothing and nothing is proposed", async () => {
    const state = await ask();
    await turn(spa, state, "appointment.create", { temporal_evidence: [c("time", "da tarde", clock(2, 0, "TARDE"))] }, "não, da tarde não");
    expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.message).toBe(`${daypartChoiceRetry}\n${QUESTION("às 2", "02h", "14h")}`);
  });
  it("the answer '… às 14h' Luna tagged {2, TARDE} settles the question (C1)", async () => {
    const state = await ask();
    await turn(spa, state, "appointment.create", { temporal_evidence: [c("time", "às 14h", clock(2, 0, "TARDE"))] }, "o Téo às 14h");
    expect(state.fields.time).toBe("14:00");expect(state.proposal).toBeDefined();expect(state.pending_temporal_ambiguities).toEqual([]);
  });
});

/** Owner, 06/10/2026: "o dia inteiro" blocks the professional's whole working day, by each professional's own hours. */
describe("BLOCK the whole day by the professional's hours", () => {
  const wholeDay = (actor: Actor, state: SchedulingState, pro: string, message: string) => turn(actor, state, "schedule.block", { professional_name: pro,
    temporal_evidence: [c("date", "amanhã", TOMORROW)] }, message);
  it("'o dia inteiro' is 08h-20h for Caio and 08h-12h for Lia: each professional's own hours that day", async () => {
    const caio = fresh("schedule.block"), caioCodes = await wholeDay(sol, caio, "Caio", "bloqueia a agenda do Caio amanhã o dia inteiro");
    expect(caio.fields).toMatchObject({ professional_ref: "p-caio", date: "2026-09-30", time: "08:00", end_time: "20:00" });expect(caio.proposal).toBeDefined();
    expect(caioCodes).toContain("BLOCK_WHOLE_DAY");
    const lia = fresh("schedule.block"); await wholeDay(sol, lia, "Lia", "fecha o dia todo da Lia amanhã");
    expect(lia.fields).toMatchObject({ professional_ref: "p-lia", time: "08:00", end_time: "12:00" });expect(lia.proposal).toBeDefined();
  });
  it("a professional with no hours that day is asked for the interval; nothing is invented", async () => {
    db.hours = db.hours.filter(row => row.professionalId !== "p-lia");
    const lia = fresh("schedule.block"), codes = await wholeDay(sol, lia, "Lia", "bloqueia a agenda da Lia amanhã o dia inteiro");
    expect(codes).toContain("BLOCK_WHOLE_DAY_NO_HOURS");expect(lia.proposal).toBeUndefined();expect(lia.fields.time).toBeUndefined();expect(lia.fields.end_time).toBeUndefined();
    expect(lia.message).toContain("não tem expediente");
  });
  it("a time said wins over 'o dia inteiro', and without those words nothing is filled", async () => {
    const said = fresh("schedule.block"), codes = await turn(sol, said, "schedule.block", { professional_name: "Caio",
      temporal_evidence: [c("date", "amanhã", TOMORROW), c("time", "das 10 às 12", clock(10)), c("end_time", "das 10 às 12", clock(12))] }, "bloqueia o dia inteiro do Caio amanhã, quer dizer, das 10 às 12");
    expect(said.fields).toMatchObject({ time: "10:00", end_time: "12:00" });expect(codes).not.toContain("BLOCK_WHOLE_DAY");
    const plain = fresh("schedule.block"), plainCodes = await wholeDay(sol, plain, "Caio", "bloqueia a agenda do Caio amanhã");
    expect(plainCodes).not.toContain("BLOCK_WHOLE_DAY");expect(plain.fields.time).toBeUndefined();expect(plain.proposal).toBeUndefined();
  });
});
