import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** P3b (flag SALON_SECRETARY_READS_V2) through the real scheduling adapter (grounding, journal drafts, prepare): only the tenant
 * lookups are fixtures. Today is Tuesday 29/09/2026 (São Paulo): "amanhã" = Wednesday 30/09. A barbershop + nail studio with
 * diverse synthetic names; no gender is inferred from any name. Read-only: no proposal, no write besides the journal draft. */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; end_at: string; status: string; timezone: string; revision: number; priceCents: number };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, day: [] as Row[], upcoming: [] as Row[], slots: {} as Record<string, { plan?: string; alternatives: string[] }>,
  availability: [] as { input: Record<string, unknown>; limit?: number }[], upcomingCalls: [] as Record<string, unknown>[], dayCalls: [] as Record<string, unknown>[],
  summaryCalls: [] as Record<string, unknown>[], rangeCalls: [] as Record<string, unknown>[], extraPros: 0, proDay: undefined as { date: string; today: boolean } | undefined, proDayCalls: [] as Record<string, unknown>[] }));
const at = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const row = (ref: string, customer: [string, string], pro: [string, string], start: string, service: [string, string], status = "CONFIRMED"): Row => ({ appointment_ref: ref,
  customer_ref: customer[0], customer_name: customer[1], professional_ref: pro[0], professional_name: pro[1], service_ref: service[0], services: [{ serviceName: service[1] }],
  start_local: start, end_local: start, start_at: at(start), end_at: at(start), status, timezone: "America/Sao_Paulo", revision: 1, priceCents: 5000 });
const PROS: Record<string, [string, string]> = { caio: ["pro-caio", "Caio Brito"], lia: ["pro-lia", "Lia Moraes"], nara: ["pro-nara", "Nara Quintela"], jonas: ["pro-jonas", "Jonas Ferraz"] };
const SERVICES: Record<string, string> = { "s-corte": "Corte masculino", "s-gel": "Esmaltação em gel", "s-sobr": "Design de sobrancelha" };
/** Who performs each service (scope of an availability without a professional). */
const ELIGIBLE: Record<string, string[]> = { "s-corte": ["pro-caio", "pro-jonas", "pro-nara"], "s-gel": ["pro-lia", "pro-nara"], "s-sobr": ["pro-lia"] };
const CUSTOMERS = [{ id: "c-maria", name: "Maria Eduarda Lopes" }, { id: "c-hiroshi", name: "Hiroshi Tanaka" }, { id: "c-anapaula", name: "Ana Paula Reis" }, { id: "c-anabia", name: "Ana Beatriz Costa" }];
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const inPeriod = (local: string, period?: string) => { const minute = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  return !period || (period === "morning" ? minute < 720 : period === "afternoon" ? minute >= 720 && minute < 1080 : minute >= 1080); };
const professionals = () => [...Object.values(PROS).map(([id, name]) => ({ id, name })), ...Array.from({ length: db.extraPros }, (_, i) => ({ id: `pro-extra-${i}`, name: `Extra Quadro ${i}` }))];
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string; service_ref?: string }) => {
    const rows = filter.query ? professionals().filter(pro => fold(pro.name).split(" ").some(word => word.startsWith(fold(filter.query!).split(" ")[0]))) : professionals();
    return filter.service_ref ? rows.filter(pro => ELIGIBLE[filter.service_ref!]?.includes(pro.id) || pro.id.startsWith("pro-extra")) : rows;
  },
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { professional_ref: string; date: string; time?: string }, _now?: unknown, _projection?: unknown, _excluded?: unknown, limit?: number) => {
    db.availability.push({ input, limit });
    const own = db.slots[input.professional_ref] ?? { alternatives: [] }, max = limit ?? 5;
    const slot = (time: string) => ({ startLocal: `${input.date}T${time}`, endLocal: `${input.date}T${time}`, professional_ref: input.professional_ref });
    return { plan: input.time && own.plan === input.time ? { ...slot(input.time), items: [] } : null, alternatives: own.alternatives.slice(0, max).map(slot), timezone: "America/Sao_Paulo" };
  },
  listSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string; professional_ref?: string; customer_ref?: string; time?: string; period?: string }) => {
    db.dayCalls.push(input);
    return db.day.filter(r => r.start_local.startsWith(input.date) && (!input.professional_ref || r.professional_ref === input.professional_ref) && (!input.customer_ref || r.customer_ref === input.customer_ref) &&
      (!input.time || r.start_local.slice(11) === input.time) && inPeriod(r.start_local, input.period)).slice(0, 51);
  },
  listSchedulingAppointmentsRange: async (_tx: unknown, _actor: unknown, input: { from: string; to: string; professional_ref?: string; customer_ref?: string }) => {
    db.rangeCalls.push(input);
    return db.day.filter(r => r.start_local.slice(0, 10) >= input.from && r.start_local.slice(0, 10) <= input.to && ["PENDING", "CONFIRMED"].includes(r.status) &&
      (!input.professional_ref || r.professional_ref === input.professional_ref) && (!input.customer_ref || r.customer_ref === input.customer_ref)).slice(0, 51);
  },
  summarizeSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: Record<string, unknown>) => {
    db.summaryCalls.push(input);
    const rows = db.day.filter(r => r.start_local.startsWith(input.date as string) && (!input.professional_ref || r.professional_ref === input.professional_ref) && inPeriod(r.start_local, input.period as string | undefined));
    const active = rows.filter(r => r.status !== "CANCELLED"), by = new Map<string, { professional_ref: string; professional_name: string; count: number; first_local: string; last_local: string }>();
    for (const r of active) { const item = by.get(r.professional_ref); if (item) { item.count++; item.last_local = r.start_local; } else by.set(r.professional_ref, { professional_ref: r.professional_ref, professional_name: r.professional_name, count: 1, first_local: r.start_local, last_local: r.start_local }); }
    return { total: active.length, cancelled: rows.length - active.length, more: false, professionals: [...by.values()],
      periods: { morning: active.filter(r => inPeriod(r.start_local, "morning")).length, afternoon: active.filter(r => inPeriod(r.start_local, "afternoon")).length, evening: active.filter(r => inPeriod(r.start_local, "evening")).length } };
  },
  listUpcomingCustomerAppointments: async (_tx: unknown, _actor: unknown, customer: string, options: { take?: number; professional_ref?: string; service_ref?: string }) => {
    db.upcomingCalls.push({ customer, ...options });
    return db.upcoming.filter(r => r.customer_ref === customer && ["PENDING", "CONFIRMED"].includes(r.status) && Date.parse(r.start_at) > Date.now() &&
      (!options.professional_ref || r.professional_ref === options.professional_ref) && (!options.service_ref || r.service_ref === options.service_ref)).slice(0, options.take ?? 3);
  },
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const found = [...db.day, ...db.upcoming].find(r => r.appointment_ref === ref); if (!found) throw Error("APPOINTMENT_NOT_FOUND"); return found; },
  // C4 owner rule 6: the tenant's answer about a professional's next day (undefined: the hours cannot tell, the day is asked).
  professionalReadDay: async (_tx: unknown, _actor: unknown, input: Record<string, unknown>) => { db.proDayCalls.push(input); return db.proDay; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => CUSTOMERS.filter(row => fold(row.name).startsWith(fold(name))) }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER" }));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { pickReadRow } from "../secretary-same-as";
import { weekRead } from "../secretary-reads";
import { deferredReadAssessment } from "../secretary-action-plan";
import { schedulingRequiredFields } from "../scheduling-contract";
import { getOperationRequirements } from "../service-contract";

const actor = { salonId: "synthetic-studio", userId: "synthetic-owner" };
const journal: Record<string, unknown>[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  vi.stubEnv("SALON_SECRETARY_READS_V2", "true");
  journal.length = 0;
  Object.assign(db, { day: [], upcoming: [], slots: {}, availability: [], upcomingCalls: [], dayCalls: [], summaryCalls: [], rangeCalls: [], extraPros: 0, proDay: undefined, proDayCalls: [] });
  const filtered = (where: Record<string, unknown>) => journal.filter(r => Object.entries(where).every(([k, v]) => r[k] === v));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { journal.push(structuredClone(data)); return data; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null) } } as unknown as Tx;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const tomorrow = { day_offset: 1, temporal_evidence: [{ field: "date", text: "amanhã" }] };
let lastCodes: string[] = [];
async function ask(fields: Record<string, unknown>, message: string) {
  const state = schedulingState();
  lastCodes = await applySchedulingInterpretation(actor, state, fields as Parameters<typeof applySchedulingInterpretation>[2], message);
  return state;
}
const nothingWritten = (state: SchedulingState) => {
  expect(state.proposal).toBeUndefined();
  expect(journal.every(r => r.action === "DRAFT")).toBe(true);
};
const upcoming = (ref: string, customer: [string, string], pro: keyof typeof PROS, start: string, service = "s-corte", status = "CONFIRMED") =>
  row(ref, customer, PROS[pro], start, [service, SERVICES[service]], status);
const MARIA: [string, string] = ["c-maria", "Maria Eduarda Lopes"], HIROSHI: [string, string] = ["c-hiroshi", "Hiroshi Tanaka"];

describe("C32: a customer's next appointments without a day", () => {
  it("list with the customer only: the next PENDING/CONFIRMED appointments (past, cancelled and other customers left out)", async () => {
    db.upcoming = [upcoming("u1", MARIA, "caio", "2026-10-01T10:00"), upcoming("u2", MARIA, "lia", "2026-10-06T15:30", "s-gel", "PENDING"),
      upcoming("u0", MARIA, "caio", "2026-09-28T10:00"), upcoming("ux", MARIA, "nara", "2026-10-02T09:00", "s-gel", "CANCELLED"), upcoming("uh", HIROSHI, "jonas", "2026-10-01T11:00")];
    const state = await ask({ operation: "appointment.list", customer_name: "Maria Eduarda" }, "quando é o próximo horário da Maria Eduarda?");
    expect(state.fields.customer_ref).toBe("c-maria");
    expect(state.draft?.missing_fields).toEqual([]);
    expect(db.upcomingCalls).toEqual([{ customer: "c-maria", take: 4 }]);
    expect(db.dayCalls).toEqual([]);
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["u1", "u2"]);
    expect(state.message).toBe("Próximos agendamentos de Maria Eduarda Lopes:\nqui, 01/10 às 10h — Corte masculino com Caio Brito\nter, 06/10 às 15h30 — Esmaltação em gel com Lia Moraes · pendente");
    expect(state.read_partial).toBeUndefined();
    expect(state.candidates).toBeUndefined();
    nothingWritten(state);
  });
  it("read with one upcoming appointment says it as the next one", async () => {
    db.upcoming = [upcoming("u1", HIROSHI, "jonas", "2026-10-03T09:15")];
    const state = await ask({ operation: "appointment.read", customer_name: "Hiroshi" }, "o Hiroshi tá marcado pra quando?");
    expect(state.message).toBe("Próximo agendamento de Hiroshi Tanaka: sáb, 03/10 às 9h15 — Corte masculino com Jonas Ferraz.");
    expect(state.appointments).toHaveLength(1);
  });
  it("more than the limit: the first three and an explicit 'há mais' (never a cut list shown as complete)", async () => {
    db.upcoming = ["2026-10-01T10:00", "2026-10-08T10:00", "2026-10-15T10:00", "2026-10-22T10:00", "2026-10-29T10:00"].map((start, i) => upcoming(`u${i}`, MARIA, "caio", start));
    const state = await ask({ operation: "appointment.list", customer_name: "Maria Eduarda" }, "a Maria Eduarda tá marcada pra quando?");
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["u0", "u1", "u2"]);
    expect(state.read_partial).toBe("UPCOMING");
    expect(lastCodes).toContain("READ_UPCOMING");
    expect(state.message).toContain("Há mais agendamentos futuros de Maria Eduarda Lopes; mostrei os 3 primeiros. Diga a data para ver outros.");
  });
  it("no future appointment: said plainly", async () => {
    db.upcoming = [upcoming("u0", HIROSHI, "caio", "2026-09-28T10:00")];
    const state = await ask({ operation: "appointment.list", customer_name: "Hiroshi" }, "quando é o próximo horário do Hiroshi?");
    expect(state.appointments).toEqual([]);
    expect(state.message).toBe("Não encontrei agendamento futuro pendente ou confirmado de Hiroshi Tanaka.");
  });
  it("a professional said is a filter of the upcoming read", async () => {
    db.upcoming = [upcoming("u1", MARIA, "caio", "2026-10-01T10:00"), upcoming("u2", MARIA, "lia", "2026-10-02T10:00", "s-gel")];
    const state = await ask({ operation: "appointment.list", customer_name: "Maria Eduarda", professional_name: "Lia" }, "quando a Maria Eduarda volta com a Lia?");
    expect(db.upcomingCalls).toEqual([{ customer: "c-maria", take: 4, professional_ref: "pro-lia" }]);
    expect(state.message).toBe("Próximo agendamento de Maria Eduarda Lopes com Lia: sex, 02/10 às 10h — Esmaltação em gel com Lia Moraes.");
  });
  it("adversarial: similar names are asked (a card), nothing is read", async () => {
    const state = await ask({ operation: "appointment.list", customer_name: "Ana" }, "quando é o horário da Ana?");
    expect(state.candidates?.kind).toBe("customer_ref");
    expect(state.candidates?.items.map(i => i.id)).toEqual(["c-anapaula", "c-anabia"]);
    expect(db.upcomingCalls).toEqual([]);
    expect(state.appointments).toBeUndefined();
  });
  it("after the card choice the chosen customer's next appointments are read", async () => {
    db.upcoming = [upcoming("u1", ["c-anabia", "Ana Beatriz Costa"], "nara", "2026-10-05T17:00", "s-gel")];
    const state = await ask({ operation: "appointment.list", customer_name: "Ana" }, "quando é o horário da Ana?");
    await selectScheduling(actor, state, "c-anabia", { clicked: true });
    expect(db.upcomingCalls).toEqual([{ customer: "c-anabia", take: 4 }]);
    expect(state.message).toContain("Ana Beatriz Costa: seg, 05/10 às 17h");
  });
  it("without a customer the day is still required (a professional alone never reads 'upcoming')", async () => {
    const state = await ask({ operation: "appointment.list", professional_name: "Caio" }, "e a agenda do Caio?");
    expect(state.draft?.missing_fields).toEqual(["date"]);
    expect(state.message).toBe("Informe data.");
    expect(db.upcomingCalls).toEqual([]); expect(db.dayCalls).toEqual([]);
  });
  it("adversarial: a clock or period without a day still asks the day (never guessed)", async () => {
    const state = await ask({ operation: "appointment.read", customer_name: "Hiroshi", time: "15:00", temporal_evidence: [{ field: "time", text: "das 15h" }] }, "o Hiroshi das 15h?");
    expect(state.draft?.missing_fields).toContain("date");
    expect(db.upcomingCalls).toEqual([]);
  });
  it("a day said still counts: the day read of that customer", async () => {
    db.day = [upcoming("d1", MARIA, "caio", "2026-09-30T10:00")];
    const state = await ask({ operation: "appointment.list", customer_name: "Maria Eduarda", ...tomorrow }, "a Maria Eduarda tem horário amanhã?");
    expect(db.upcomingCalls).toEqual([]);
    expect(db.dayCalls).toEqual([{ date: "2026-09-30", customer_ref: "c-maria" }]);
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["d1"]);
  });
  it("flag off: the historical question for the day", async () => {
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    db.upcoming = [upcoming("u1", MARIA, "caio", "2026-10-01T10:00")];
    const state = await ask({ operation: "appointment.list", customer_name: "Maria Eduarda" }, "quando é o próximo horário da Maria Eduarda?");
    expect(state.draft?.missing_fields).toEqual(["date"]);
    expect(state.message).toBe("Informe data.");
    expect(db.upcomingCalls).toEqual([]);
  });
});

/** C4 owner rule 6 (DECISOES_PRODUTO, 29/09): a professional's next appointment with no day said. The tenant's answer (today while
 * any is left, else the professional's next working day; scheduling-catalog professionalReadDay) is a fixture here; the adapter
 * reads that day, says it is not today, and never guesses a day the hours cannot tell. */
describe("C4 rule 6: a professional's next appointments without a day", () => {
  const YUKI: [string, string] = ["c-yuki", "Yuki Sato"], OBI: [string, string] = ["c-obi", "Obinna Eze"];
  const wednesday = () => { db.day = [row("w1", YUKI, PROS.nara, "2026-09-30T10:00", ["s-gel", SERVICES["s-gel"]]), row("w2", OBI, PROS.nara, "2026-09-30T15:30", ["s-corte", SERVICES["s-corte"]]),
    row("w3", MARIA, PROS.caio, "2026-09-30T10:00", ["s-corte", SERVICES["s-corte"]]), row("n1", HIROSHI, PROS.nara, "2026-10-07T16:00", ["s-gel", SERVICES["s-gel"]])]; };
  it("nothing left today: the next working day's agenda of that professional, said as such (no question, nothing written)", async () => {
    wednesday(); db.proDay = { date: "2026-09-30", today: false };
    const state = await ask({ operation: "appointment.list", professional_name: "Nara" }, "quando é o próximo atendimento da Nara? com quem?");
    expect(db.proDayCalls).toEqual([{ professional_ref: "pro-nara" }]);
    expect(state.fields.date).toBe("2026-09-30");
    expect(state.draft?.missing_fields).toEqual([]);
    expect(db.dayCalls).toEqual([{ date: "2026-09-30", professional_ref: "pro-nara" }]);
    expect(state.message.split("\n")).toEqual(["Nara não tem mais atendimentos hoje. Próximo dia de trabalho: qua, 30/09.", "Agenda de Nara em qua, 30/09:",
      "10h — Yuki Sato (Esmaltação em gel) com Nara Quintela", "15h30 — Obinna Eze (Corte masculino) com Nara Quintela"]);
    for (const word of ["Maria", "Hiroshi", "07/10", "16h"]) expect(state.message).not.toContain(word);
    expect(lastCodes).toContain("READ_PROFESSIONAL_NEXT_DAY");
    expect(state.waiting_for).toBeUndefined(); expect(state.candidates).toBeUndefined(); expect(db.upcomingCalls).toEqual([]);
    nothingWritten(state);
  });
  it("something still left today: today's agenda, never presented as another day", async () => {
    db.day = [row("t1", YUKI, PROS.lia, "2026-09-29T17:00", ["s-sobr", SERVICES["s-sobr"]])]; db.proDay = { date: "2026-09-29", today: true };
    const state = await ask({ operation: "appointment.list", professional_name: "Lia" }, "qual o próximo horário da Lia?");
    expect(state.message).toBe("Agenda de Lia em ter, 29/09:\n17h — Yuki Sato (Design de sobrancelha) com Lia Moraes");
    expect(lastCodes).toContain("READ_PROFESSIONAL_TODAY");
  });
  it("a service said is a filter of the tenant's answer and of the day read", async () => {
    db.proDay = { date: "2026-10-01", today: false };
    const state = await ask({ operation: "appointment.list", professional_name: "Lia", service_name: "esmaltação" }, "quando a Lia faz a próxima esmaltação?");
    expect(db.proDayCalls).toEqual([{ professional_ref: "pro-lia", service_ref: "s-gel" }]);
    expect(db.dayCalls).toEqual([{ date: "2026-10-01", professional_ref: "pro-lia", service_ref: "s-gel" }]);
    expect(state.message).toBe("Lia não tem mais atendimentos hoje. Próximo dia de trabalho: qui, 01/10.\nLia não tem atendimentos em qui, 01/10.");
  });
  it("a read of 'the next one' on a day with several rows lists them (no card to pick among them)", async () => {
    wednesday(); db.proDay = { date: "2026-09-30", today: false };
    const state = await ask({ operation: "appointment.read", professional_name: "Nara" }, "qual o próximo atendimento da Nara?");
    expect(state.candidates).toBeUndefined();
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["w1", "w2"]);
    nothingWritten(state);
  });
  it("adversarial: the tenant's hours cannot tell (no hours, or no working day ahead): the day is asked as before", async () => {
    const state = await ask({ operation: "appointment.list", professional_name: "Caio" }, "e a agenda do Caio?");
    expect(db.proDayCalls).toEqual([{ professional_ref: "pro-caio" }]);
    expect(state.draft?.missing_fields).toEqual(["date"]);
    expect(state.message).toBe("Informe data.");
    expect(db.dayCalls).toEqual([]);
  });
  it("adversarial: a day, a clock or a period said, a customer said, or several professionals: never a derived day", async () => {
    db.proDay = { date: "2026-10-07", today: false };
    await ask({ operation: "appointment.list", professional_name: "Nara", ...tomorrow }, "e a Nara amanhã?");
    expect(db.dayCalls).toEqual([{ date: "2026-09-30", professional_ref: "pro-nara" }]);
    const clock = await ask({ operation: "appointment.read", professional_name: "Nara", time: "15:00", temporal_evidence: [{ field: "time", text: "das 15h" }] }, "e a da Nara das 15h?");
    expect(clock.draft?.missing_fields).toContain("date");
    const period = await ask({ operation: "appointment.list", professional_name: "Nara", period: "afternoon" }, "a Nara à tarde?");
    expect(period.draft?.missing_fields).toContain("date");
    db.upcoming = [upcoming("u1", MARIA, "nara", "2026-10-01T10:00", "s-gel")];
    const customer = await ask({ operation: "appointment.list", customer_name: "Maria Eduarda", professional_name: "Nara" }, "quando a Maria Eduarda volta com a Nara?");
    expect(customer.message).toContain("Maria Eduarda Lopes");
    PROS.nunes = ["pro-extra-nunes", "Nara Nunes"];
    try {
      const several = await ask({ operation: "appointment.list", professional_name: "Nara" }, "quando é o próximo da Nara?");
      expect(several.candidates?.kind).toBe("professional_ref");
      expect(several.fields.date).toBeUndefined();
    } finally { delete PROS.nunes; }
    expect(db.proDayCalls).toEqual([]);
  });
  it("adversarial (rule 5 + 6): 'my next appointment' by an owner with no professional registration asks whose agenda; the chosen one's next day is read", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true");
    wednesday(); db.proDay = { date: "2026-09-30", today: false };
    const state = await ask({ operation: "appointment.list", professional_name: "meu" }, "qual o meu próximo atendimento?");
    expect(lastCodes).toContain("SELF_NOT_PROFESSIONAL");
    expect(state.candidates?.kind).toBe("professional_ref");
    expect(state.message).toContain("Não encontrei seu cadastro como profissional");
    expect(db.proDayCalls).toEqual([]); expect(db.dayCalls).toEqual([]); expect(state.fields.date).toBeUndefined();
    await selectScheduling(actor, state, "pro-nara", { clicked: true });
    expect(db.proDayCalls).toEqual([{ professional_ref: "pro-nara" }]);
    expect(state.fields.date).toBe("2026-09-30");
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["w1", "w2"]);
    nothingWritten(state);
  });
  it("flag off: the historical question for the day (the tenant is never asked)", async () => {
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    wednesday(); db.proDay = { date: "2026-09-30", today: false };
    const state = await ask({ operation: "appointment.list", professional_name: "Nara" }, "quando é o próximo atendimento da Nara?");
    expect(state.draft?.missing_fields).toEqual(["date"]);
    expect(state.message).toBe("Informe data.");
    expect(db.proDayCalls).toEqual([]); expect(db.dayCalls).toEqual([]);
  });
});

const busyDay = (count: number, date = "2026-09-30") => Array.from({ length: count }, (_, i) => {
  const pro = (["caio", "lia", "nara", "jonas"] as const)[i % 4], minute = 8 * 60 + Math.floor(i / 4) * 30;
  return row(`b${i}`, [`c-${i}`, `Cliente Sintético ${i}`], PROS[pro], `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, ["s-corte", SERVICES["s-corte"]]);
});
describe("C29: the salon's day", () => {
  it("the whole salon (no professional said): every row of the day, filter said in the answer", async () => {
    db.day = busyDay(6);
    const state = await ask({ operation: "appointment.list", ...tomorrow }, "como está a agenda amanhã?");
    expect(state.appointments).toHaveLength(6);
    expect(state.message.split("\n")[0]).toBe("Agenda em qua, 30/09:");
    expect(new Set(state.appointments!.map(r => r.professional_ref)).size).toBe(4);
  });
  it("the period filter is applied BEFORE the row limit: a full day with a quiet afternoon lists the afternoon", async () => {
    db.day = busyDay(64);
    const afternoon = db.day.filter(r => inPeriod(r.start_local, "afternoon")).length;
    expect(afternoon).toBeLessThan(50);
    const state = await ask({ operation: "appointment.list", ...tomorrow, period: "afternoon" }, "agenda de amanhã à tarde");
    expect(db.dayCalls).toEqual([{ date: "2026-09-30", period: "afternoon" }]);
    expect(state.appointments).toHaveLength(afternoon);
    expect(state.message.split("\n")[0]).toBe("Agenda em qua, 30/09 à tarde:");
  });
  it("above the limit without a professional: a per-professional summary and a question, with the professionals as options", async () => {
    db.day = [...busyDay(60), row("cx", ["c-x", "Cliente Cancelado"], PROS.caio, "2026-09-30T19:00", ["s-corte", SERVICES["s-corte"]], "CANCELLED")];
    const state = await ask({ operation: "appointment.list", ...tomorrow }, "como está a agenda amanhã?");
    expect(state.appointments).toBeUndefined();
    expect(state.read_partial).toBe("SUMMARY");
    expect(lastCodes).toContain("READ_DAY_SUMMARY");
    expect(state.waiting_for).toBe("professional_ref");
    expect(state.message).toBe(["Agenda em qua, 30/09: 60 agendamentos e 1 cancelado, mais do que listo de uma vez.",
      "Caio Brito: 15 agendamentos, das 8h às 15h", "Lia Moraes: 15 agendamentos, das 8h às 15h", "Nara Quintela: 15 agendamentos, das 8h às 15h", "Jonas Ferraz: 15 agendamentos, das 8h às 15h",
      "De qual profissional ou período você quer a lista?"].join("\n"));
    expect(state.message).not.toMatch(/restrinja|cliente/i);
    expect(state.candidates).toEqual({ kind: "professional_ref", items: [{ id: "pro-caio", name: "Caio Brito · 15" }, { id: "pro-lia", name: "Lia Moraes · 15" }, { id: "pro-nara", name: "Nara Quintela · 15" }, { id: "pro-jonas", name: "Jonas Ferraz · 15" }] });
    nothingWritten(state);
  });
  it("choosing a professional of the summary lists that professional's day (named as registered)", async () => {
    db.day = busyDay(60);
    const state = await ask({ operation: "appointment.list", ...tomorrow }, "como está a agenda amanhã?");
    await selectScheduling(actor, state, "pro-nara", { clicked: true });
    expect(state.fields.professional_ref).toBe("pro-nara");
    expect(state.appointments).toHaveLength(15);
    expect(state.read_partial).toBeUndefined();
    expect(state.message.split("\n")[0]).toBe("Agenda de Nara Quintela em qua, 30/09:");
  });
  it("adversarial: an id outside the summary's options, or a professional gone since, is never read", async () => {
    db.day = busyDay(60);
    const state = await ask({ operation: "appointment.list", ...tomorrow }, "como está a agenda amanhã?");
    await expect(selectScheduling(actor, state, "pro-other-salon", { clicked: true })).rejects.toThrow("SELECTION_INVALID");
    const saved = PROS.jonas; delete (PROS as Record<string, unknown>).jonas;
    try { await expect(selectScheduling(actor, state, "pro-jonas", { clicked: true })).rejects.toThrow("SELECTION_INVALID"); } finally { PROS.jonas = saved; }
    expect(state.fields.professional_ref).toBeUndefined();
    expect(state.read_partial).toBe("SUMMARY");
  });
  it("above the limit for one professional: the counts per period and 'which period'", async () => {
    db.day = Array.from({ length: 56 }, (_, i) => row(`n${i}`, [`c-${i}`, `Cliente ${i}`], PROS.nara, `2026-09-30T${String(8 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`, ["s-gel", SERVICES["s-gel"]]));
    const state = await ask({ operation: "appointment.list", professional_name: "Nara", ...tomorrow }, "agenda da Nara amanhã");
    expect(state.waiting_for).toBe("period");
    expect(state.candidates).toBeUndefined();
    expect(state.message).toBe("Agenda de Nara em qua, 30/09: 56 agendamentos, mais do que listo de uma vez.\nManhã: 16; tarde: 24; noite: 16.\nQual período você quer ver?");
  });
  it("above the limit with a professional and a period: a clock is asked", async () => {
    db.day = Array.from({ length: 52 }, (_, i) => row(`n${i}`, [`c-${i}`, `Cliente ${i}`], PROS.nara, `2026-09-30T${String(12 + Math.floor(i / 10)).padStart(2, "0")}:${String((i % 10) * 5).padStart(2, "0")}`, ["s-gel", SERVICES["s-gel"]]));
    const state = await ask({ operation: "appointment.list", professional_name: "Nara", ...tomorrow, period: "afternoon" }, "agenda da Nara amanhã à tarde");
    expect(state.waiting_for).toBe("time");
    expect(state.message).toBe("Agenda de Nara em qua, 30/09 à tarde: 52 agendamentos, mais do que listo de uma vez.\nInforme um horário para ver a lista.");
  });
  it("flag off: the historical refusal, and the period filtered after the limit", async () => {
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    db.day = busyDay(64);
    const state = await ask({ operation: "appointment.list", ...tomorrow, period: "afternoon" }, "agenda de amanhã à tarde");
    expect(db.dayCalls).toEqual([{ date: "2026-09-30" }]);
    expect(db.summaryCalls).toEqual([]);
    expect(state.message).toBe("Muitos agendamentos. Restrinja a busca por cliente.");
  });
});

/** Candidate 4 (D20 class): the whole salon's day named by a weekday, through the components wire with every candidate flag on.
 * Tuesday 29/09: "sábado" = 03/10; the Friday before and the Saturday of the next week hold other rows that must never show. */
describe("C29 whole salon on a weekday (components wire): every professional's day, a named professional stays scoped", () => {
  const CANDIDATE = ["TEMPORAL_COMPONENTS", "TEMPORAL_POLARITY", "SAME_AS", "STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE",
    "SCHEDULING_OVERLAP_ENABLED", "MULTI_ACTION_V2_ENABLED", "DATE_RULES_V2", "DAYPART_RULES_V2", "DAYPART_BY_HOURS", "ALTER_APPOINTMENT", "MULTI_SERVICE", "EXCEPTION_RULES_V2",
    "COPY_V2", "REFERENCES_V2", "READS_V2", "RECURRENCE_GUARD"];
  beforeEach(() => {
    for (const name of CANDIDATE) vi.stubEnv(`SALON_SECRETARY_${name}`, "true");
    db.day = [row("s1", HIROSHI, PROS.caio, "2026-10-03T09:00", ["s-corte", SERVICES["s-corte"]]), row("s2", MARIA, PROS.lia, "2026-10-03T10:30", ["s-gel", SERVICES["s-gel"]]),
      row("s3", ["c-anapaula", "Ana Paula Reis"], PROS.nara, "2026-10-03T14:00", ["s-gel", SERVICES["s-gel"]]), row("s4", ["c-anabia", "Ana Beatriz Costa"], PROS.lia, "2026-10-03T16:15", ["s-sobr", SERVICES["s-sobr"]]),
      row("f1", ["c-yuki", "Yuki Sato"], PROS.jonas, "2026-10-02T10:00", ["s-corte", SERVICES["s-corte"]]), row("n1", ["c-obi", "Obinna Eze"], PROS.caio, "2026-10-10T09:00", ["s-corte", SERVICES["s-corte"]])];
  });
  const saturday = (text: string, week: "NEAREST" | "AMBIGUOUS_NEXT" = "NEAREST") =>
    ({ temporal_evidence: [{ field: "date", text, component: { kind: "WEEKDAY", offset: null, weekday: 6, week, day: null, month: null, year: null, days: null } }] });
  const unlisted = ["Yuki", "Obinna", "02/10", "10/10"];
  // A retracted or asked day is journaled (TEMPORAL_RECONCILED) beside the draft; never a proposal.
  const onlyJournaled = (state: SchedulingState) => {
    expect(state.proposal).toBeUndefined();
    expect(journal.every(r => r.action === "DRAFT" || r.action === "TEMPORAL_RECONCILED")).toBe(true);
  };
  it("no professional said: one tenant day read without a professional, the four rows of three professionals, nothing else", async () => {
    const state = await ask({ operation: "appointment.list", ...saturday("sábado") }, "me passa tudo que tem no sábado, a equipe inteira");
    expect(state.fields.date).toBe("2026-10-03");
    expect(db.dayCalls).toEqual([{ date: "2026-10-03" }]);
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(new Set(state.appointments!.map(r => r.professional_ref)).size).toBe(3);
    expect(state.message.split("\n")).toEqual(["Agenda em sáb, 03/10:", "9h — Hiroshi Tanaka (Corte masculino) com Caio Brito", "10h30 — Maria Eduarda Lopes (Esmaltação em gel) com Lia Moraes",
      "14h — Ana Paula Reis (Esmaltação em gel) com Nara Quintela", "16h15 — Ana Beatriz Costa (Design de sobrancelha) com Lia Moraes"]);
    for (const word of unlisted) expect(state.message).not.toContain(word);
    expect(state.waiting_for).toBeUndefined(); expect(state.candidates).toBeUndefined(); expect(state.read_partial).toBeUndefined();
    expect(db.summaryCalls).toEqual([]); expect(db.upcomingCalls).toEqual([]);
    nothingWritten(state);
  });
  it("a professional said keeps the same day read scoped to that professional (never the whole salon)", async () => {
    const state = await ask({ operation: "appointment.list", professional_name: "Lia", ...saturday("sábado") }, "e a Lia, o que ela tem no sábado?");
    expect(db.dayCalls).toEqual([{ date: "2026-10-03", professional_ref: "pro-lia" }]);
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["s2", "s4"]);
    expect(state.appointments!.every(r => r.professional_ref === "pro-lia")).toBe(true);
    expect(state.message.split("\n")[0]).toBe("Agenda de Lia Moraes em sáb, 03/10:");
    for (const word of ["Hiroshi", "Ana Paula", "Caio", "Nara", ...unlisted]) expect(state.message).not.toContain(word);
    nothingWritten(state);
  });
  it("adversarial: a week qualifier the words do not state never reads a week they do not name (no 10/10, nothing written)", async () => {
    const state = await ask({ operation: "appointment.list", ...saturday("sábado", "AMBIGUOUS_NEXT") }, "me passa tudo que tem no sábado, a equipe inteira");
    expect(db.dayCalls.every(call => call.date === "2026-10-03")).toBe(true);
    expect((state.appointments ?? []).every(r => r.start_local.startsWith("2026-10-03"))).toBe(true);
    expect(state.fields.date === undefined || state.fields.date === "2026-10-03").toBe(true);
    for (const word of unlisted) expect(state.message).not.toContain(word);
    onlyJournaled(state);
  });
  it("adversarial: 'sábado que vem' said on a Tuesday is a choice between the two Saturdays, never a silent read of either", async () => {
    const state = await ask({ operation: "appointment.list", ...saturday("sábado que vem", "AMBIGUOUS_NEXT") }, "e no sábado que vem, quem está marcado?");
    expect(db.dayCalls).toEqual([]);
    expect(state.appointments).toBeUndefined();
    expect(state.fields.date).toBeUndefined();
    expect(state.message).toContain("03/10"); expect(state.message).toContain("10/10");
    onlyJournaled(state);
  });
  it("flags off (historical wire, legacy weekday selector): the same whole-salon day read", async () => {
    for (const name of CANDIDATE) vi.stubEnv(`SALON_SECRETARY_${name}`, "false");
    const state = await ask({ operation: "appointment.list", weekday: 6, temporal_evidence: [{ field: "date", text: "sábado" }] }, "me passa tudo que tem no sábado, a equipe inteira");
    expect(db.dayCalls).toEqual([{ date: "2026-10-03" }]);
    expect(state.appointments?.map(r => r.appointment_ref)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(state.message.split("\n")[0]).toBe("Agenda em sáb, 03/10:");
  });
});

describe("C30/C31 a+b: availability with an optional professional, and 'há mais'", () => {
  const corte = { operation: "availability.get", service_name: "corte", ...tomorrow };
  it("no professional said: the free times of each eligible professional (earliest first), no question, nothing reserved", async () => {
    db.slots = { "pro-caio": { alternatives: ["14:00", "14:30"] }, "pro-jonas": { alternatives: ["13:00"] }, "pro-nara": { alternatives: [] } };
    const state = await ask({ ...corte, period: "afternoon" }, "tem horário amanhã à tarde pra corte?");
    expect(db.availability.map(call => [call.input.professional_ref, call.input.period, call.limit])).toEqual([["pro-caio", "afternoon", 6], ["pro-nara", "afternoon", 6], ["pro-jonas", "afternoon", 6]]);
    expect(state.message).toBe(["Horários livres para corte em qua, 30/09 à tarde:", "Jonas Ferraz: 13h", "Caio Brito: 14h, 14h30", "Sem horário livre nesse período: Nara Quintela.", "A consulta não reserva o horário."].join("\n"));
    expect(state.candidates).toBeUndefined();
    expect(state.fields.professional_ref).toBeUndefined();
    expect(lastCodes).toContain("AVAILABILITY_ACROSS");
    expect(state.alternatives?.map(s => s.professional_ref)).toEqual(["pro-caio", "pro-caio", "pro-jonas"]);
    expect(state.draft?.missing_fields).toEqual([]);
    nothingWritten(state);
  });
  it("'quem está livre às 15h': who is free at that clock, then each one's times from it", async () => {
    db.slots = { "pro-caio": { plan: "15:00", alternatives: ["15:30"] }, "pro-jonas": { alternatives: ["16:00"] }, "pro-nara": { plan: "15:00", alternatives: [] } };
    const state = await ask({ ...corte, time: "15:00", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 15h" }] }, "quem está livre amanhã às 15h pra corte?");
    expect(state.message).toBe(["Às 15h: livre com Caio Brito e Nara Quintela.", "Horários livres para corte em qua, 30/09 a partir das 15h:", "Caio Brito: 15h, 15h30", "Nara Quintela: 15h", "Jonas Ferraz: 16h", "A consulta não reserva o horário."].join("\n"));
  });
  it("a professional with more free times than shown says 'e há mais' (five shown)", async () => {
    db.slots = { "pro-lia": { alternatives: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"] }, "pro-nara": { alternatives: ["09:00"] } };
    const state = await ask({ operation: "availability.get", service_name: "esmaltação", ...tomorrow }, "tem horário amanhã pra esmaltação?");
    expect(state.message.split("\n")).toContain("Lia Moraes: 9h, 9h30, 10h, 10h30, 11h e há mais");
    expect(state.message.split("\n")).toContain("Nara Quintela: 9h");
  });
  it("nobody free: said for the whole team", async () => {
    const state = await ask({ ...corte, period: "evening" }, "tem horário amanhã à noite pra corte?");
    expect(state.message).toBe("Não encontrei horário livre para corte em qua, 30/09 à noite com nenhum profissional.");
    expect(state.alternatives).toEqual([]);
  });
  it("one professional said: the historical answer plus 'e há mais' when more exist than shown", async () => {
    db.slots = { "pro-caio": { alternatives: ["09:00", "09:15", "09:30", "09:45", "10:00", "10:15"] } };
    const state = await ask({ ...corte, professional_name: "Caio" }, "horários do Caio amanhã pra corte");
    expect(db.availability.map(call => call.limit)).toEqual([6]);
    expect(state.message).toBe("Horários livres de Caio para corte em qua, 30/09: 9h, 9h15, 9h30, 9h45, 10h e há mais. A consulta não reserva o horário.");
    expect(state.alternatives).toHaveLength(5);
  });
  it("one professional with exactly five: no 'há mais'", async () => {
    db.slots = { "pro-caio": { alternatives: ["09:00", "09:15", "09:30", "09:45", "10:00"] } };
    const state = await ask({ ...corte, professional_name: "Caio" }, "horários do Caio amanhã pra corte");
    expect(state.message).toBe("Horários livres de Caio para corte em qua, 30/09: 9h, 9h15, 9h30, 9h45, 10h. A consulta não reserva o horário.");
  });
  it("adversarial: a name with several matches is still asked (never listed for all of them)", async () => {
    PROS.nunes = ["pro-extra-nunes", "Nara Nunes"];
    try {
      const state = await ask({ ...corte, professional_name: "Nara" }, "horários da Nara amanhã pra corte");
      expect(state.candidates?.kind).toBe("professional_ref");
      expect(db.availability).toEqual([]);
    } finally { delete PROS.nunes; }
  });
  it("more eligible professionals than the bounded team: today's question with the options", async () => {
    db.extraPros = 9;
    const state = await ask(corte, "tem horário amanhã pra corte?");
    expect(state.message).toBe("Qual profissional? Escolha uma opção real.");
    expect(state.candidates?.items).toHaveLength(12);
    expect(db.availability).toEqual([]);
  });
  it("flag off: the historical question, a card of the eligible professionals", async () => {
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    db.slots = { "pro-caio": { alternatives: ["09:00", "09:15", "09:30", "09:45", "10:00", "10:15"] } };
    const state = await ask(corte, "tem horário amanhã pra corte?");
    expect(state.message).toBe("Qual profissional? Escolha uma opção real.");
    expect(state.draft?.missing_fields).toEqual(["professional_ref"]);
    expect(db.availability).toEqual([]);
    const one = await ask({ ...corte, professional_name: "Caio" }, "horários do Caio amanhã pra corte");
    expect(db.availability.map(call => call.limit)).toEqual([undefined]);
    expect(one.message).toBe("Horários livres de Caio para corte em qua, 30/09: 9h, 9h15, 9h30, 9h45, 10h. A consulta não reserva o horário.");
  });
});

describe("read requirements (runtime only; the published requirements are unchanged)", () => {
  it("availability needs no professional and a customer read needs no day, only with the flag", () => {
    expect(schedulingRequiredFields("availability.get", {})).toEqual(["service_ref", "date"]);
    expect(schedulingRequiredFields("appointment.list", { customer_ref: "c" })).toEqual([]);
    expect(schedulingRequiredFields("appointment.read", { customer_name: "Lia" })).toEqual([]);
    expect(schedulingRequiredFields("appointment.list", { customer_ref: "c", period: "morning" })).toEqual(["date"]);
    expect(schedulingRequiredFields("appointment.list", { professional_ref: "p" })).toEqual(["date"]);
    expect(schedulingRequiredFields("appointment.create", {})).toEqual(["customer_ref", "service_ref", "professional_ref", "date", "time"]);
    expect(getOperationRequirements("availability.get").required_fields).toEqual(["service_ref", "professional_ref", "date"]);
    expect(getOperationRequirements("appointment.list").required_fields).toEqual(["date"]);
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    expect(schedulingRequiredFields("availability.get", {})).toEqual(["service_ref", "professional_ref", "date"]);
    expect(schedulingRequiredFields("appointment.list", { customer_ref: "c" })).toEqual(["date"]);
  });
  it("a deferred customer read waits for no day with the flag (a professional-only read still does)", () => {
    const action = (fields: Record<string, unknown>) => ({ key: "a", operation: "appointment.list", skill: "scheduling", depends_on: ["b"], fields } as unknown as Parameters<typeof deferredReadAssessment>[0]);
    expect(deferredReadAssessment(action({ customer_name: "Hiroshi" })).missing_fields).toEqual([]);
    expect(deferredReadAssessment(action({ professional_name: "Caio" })).missing_fields).toEqual(["date"]);
    vi.stubEnv("SALON_SECRETARY_READS_V2", "false");
    expect(deferredReadAssessment(action({ customer_name: "Hiroshi" })).missing_fields).toEqual(["date"]);
  });
});

describe("D2 over a partial read (review): an ordinal from the end is not computed from the first rows", () => {
  const rows = ["2026-10-01T10:00", "2026-10-08T10:00", "2026-10-15T10:00"].map((start, i) => ({ appointment_ref: `u${i}`, customer_ref: "c-maria", customer_name: "Maria Eduarda Lopes",
    professional_name: "Caio Brito", start_local: start, start_at: at(start), status: "CONFIRMED" }));
  it("'o primeiro' is still the first; 'o último' and no ordinal are a card of the rows shown", () => {
    expect(pickReadRow(rows, "o primeiro", new Date(), false)).toMatchObject({ kind: "ROW", row: { appointment_ref: "u0" } });
    expect(pickReadRow(rows, "o último", new Date(), false)).toMatchObject({ kind: "CARD" });
    expect(pickReadRow(rows.slice(0, 1), "ela", new Date(), false)).toMatchObject({ kind: "CARD" });
    expect(pickReadRow(rows, "o último", new Date())).toMatchObject({ kind: "ROW", row: { appointment_ref: "u2" } });
    expect(pickReadRow(rows.slice(0, 1), "ela", new Date())).toMatchObject({ kind: "ROW" });
  });
});

describe("owner 07/10: a week read ('verifica a agenda da Nara para essa semana')", () => {
  const YUKI: [string, string] = ["c-yuki", "Yuki Sato"];
  it("the week the words name (pure): this week to Sunday, next week Monday to Sunday; a weekday or a weekend is not a week", () => {
    expect(weekRead("verifica a agenda da Beatriz Costa para essa semana", "2026-09-29")).toEqual({ from: "2026-09-29", to: "2026-10-04", label: "nesta semana" });
    expect(weekRead("como está a agenda da semana que vem?", "2026-09-29")).toEqual({ from: "2026-10-05", to: "2026-10-11", label: "na semana que vem" });
    expect(weekRead("e na próxima semana?", "2026-10-04")).toEqual({ from: "2026-10-05", to: "2026-10-11", label: "na semana que vem" });
    for (const text of ["agenda da Nara na sexta dessa semana", "agenda do fim de semana", "agenda de amanhã", "agenda do dia 2 desta semana", "toda semana"]) expect(weekRead(text, "2026-09-29"), text).toBeUndefined();
  });
  it("a professional's week, by day, PENDING/CONFIRMED, even when the model's single-day reading of 'essa semana' is refused", async () => {
    db.day = [row("w1", YUKI, PROS.nara, "2026-09-30T10:00", ["s-gel", SERVICES["s-gel"]]), row("w2", MARIA, PROS.nara, "2026-10-02T15:30", ["s-corte", SERVICES["s-corte"]], "PENDING"),
      row("w3", HIROSHI, PROS.nara, "2026-10-01T09:00", ["s-gel", SERVICES["s-gel"]], "CANCELLED"), row("w4", MARIA, PROS.caio, "2026-09-30T11:00", ["s-corte", SERVICES["s-corte"]]),
      row("w5", HIROSHI, PROS.nara, "2026-10-06T09:00", ["s-gel", SERVICES["s-gel"]])];
    const state = await ask({ operation: "appointment.list", professional_name: "Nara", weekday: 1, temporal_evidence: [{ field: "date", text: "essa semana" }] }, "Verifica a agenda da Nara para essa semana.");
    expect(lastCodes).toContain("READ_WEEK");
    expect(db.rangeCalls).toEqual([{ from: "2026-09-29", to: "2026-10-04", professional_ref: "pro-nara" }]);
    expect(state.message.split("\n")).toEqual(["Agenda de Nara nesta semana (ter, 29/09 a dom, 04/10):", "qua, 30/09", "10h — Yuki Sato (Esmaltação em gel) com Nara Quintela",
      "sex, 02/10", "15h30 — Maria Eduarda Lopes (Corte masculino) com Nara Quintela · pendente"]);
    expect(state.waiting_for).toBeUndefined(); nothingWritten(state);
  });
  it("a customer's week and the whole salon's next week; an empty week is said plainly", async () => {
    db.day = [row("m1", MARIA, PROS.caio, "2026-10-01T10:00", ["s-corte", SERVICES["s-corte"]]), row("m2", HIROSHI, PROS.lia, "2026-10-06T14:00", ["s-gel", SERVICES["s-gel"]])];
    const maria = await ask({ operation: "appointment.list", customer_name: "Maria Eduarda" }, "como está a semana da Maria Eduarda nesta semana?");
    expect(maria.message).toBe("Agenda de Maria Eduarda Lopes nesta semana (ter, 29/09 a dom, 04/10):\nqui, 01/10\n10h — Maria Eduarda Lopes (Corte masculino) com Caio Brito");
    const salon = await ask({ operation: "appointment.list" }, "me mostra a agenda da semana que vem");
    expect(salon.message).toBe("Agenda na semana que vem (seg, 05/10 a dom, 11/10):\nter, 06/10\n14h — Hiroshi Tanaka (Esmaltação em gel) com Lia Moraes");
    const none = await ask({ operation: "appointment.list", professional_name: "Jonas" }, "agenda do Jonas essa semana");
    expect(none.message).toBe("Jonas não tem agendamentos nesta semana (ter, 29/09 a dom, 04/10).");
  });
  it("adversarial: a day said ('sexta dessa semana') is that day's read, never the week", async () => {
    db.day = [row("d1", MARIA, PROS.nara, "2026-10-02T10:00", ["s-corte", SERVICES["s-corte"]])];
    await ask({ operation: "appointment.list", professional_name: "Nara", weekday: 5, temporal_evidence: [{ field: "date", text: "sexta" }] }, "agenda da Nara na sexta dessa semana");
    expect(lastCodes).not.toContain("READ_WEEK"); expect(db.rangeCalls).toEqual([]);
  });
});
