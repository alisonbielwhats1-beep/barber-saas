import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { AGENT_DEPENDENCY_FLAGS } from "../../../packages/salon-secretary/src/agent-context";
import { PILOT_RESCHEDULE_PARAMETERS, PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { prisma } from "../prisma";
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { PILOT_CUSTOMER_NOTICE, PILOT_OUT_OF_SCOPE_REPLY, PILOT_WITHDRAWN_REPLY } from "../secretary-pilot";
import { ScriptedServicesModel, appendScriptedResponses, call } from "../../test/scripted-services-model";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc, weekdayOfDateKey } from "../time";
import { e2aClock, e2aDay, e2aLuna, e2aOrigin, e2aService, e2aTo, type E2aInterpretation } from "../../test/secretary-pilot-e2a";

/** Reschedule pilot E2-A on the local disposable PostgreSQL (docs/c5-spike/12-piloto-remarcacao.md §10; Adendo 10), written BEFORE the
 * implementation: through SalonSecretary with SALON_SECRETARY_PILOT_RESCHEDULE=true only when RUN_SERVICE_MVP_INTEGRATION=1 and the MVP database
 * preflight passes (127.0.0.1:55441/everflair_service_mvp), with a scripted Luna answering the E2-A contract (no network, no paid model).
 *  - the service locates the appointment end to end (two appointments of different services; the Confirmar moves exactly that row);
 *  - the weekday enum, in origin and destination, end to end;
 *  - a message with context only reaches the proposal (no scope question) and writes on the Confirmar;
 *  - a real separate request asks the scope question and writes nothing (nor does a request wholly out of scope);
 *  - adversarial review SERVICE-1: an appointment with two service items is found by its SECOND service too (the reader carries every item's
 *    service id): a lone combo is bound and moved; a combo beside a lone appointment of that service asks with both.
 * The clock is frozen at a Monday 08:00 in São Paulo a few days ahead. Synthetic nail studio, invented names and sentences; another salon with
 * the same names must stay untouched. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const TZ = "America/Sao_Paulo", FLAG = "SALON_SECRETARY_PILOT_RESCHEDULE";
let admin: PrismaClient;
/** The frozen Monday; D(n) is n days after it (D(1) Tuesday … D(5) Saturday). */
let D0 = "";
const D = (offset: number) => addCalendarDays(D0, offset);
type Svc = { id: string; name: string; durationMin: number; priceCents: number };

async function atelier(label: string, customers: string[]) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: `Gestão ${label}`, email: `e2a-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Ateliê Cajueiro ${label}`, slug: `e2a-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: TZ, currency: "BRL",
      minBookingLeadMinutes: 0, bufferMinutes: 0 } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const service = (name: string, durationMin: number, priceCents: number) => tx.service.create({ data: { salonId, name, durationMin, priceCents } });
    const manicure = await service("Manicure com cutilagem", 40, 4500), pedicure = await service("Pedicure spa", 50, 6000), gel = await service("Esmaltação em gel", 60, 8000);
    const pro = async (name: string, services: Svc[]) => {
      const user = await tx.user.create({ data: { name, email: `e2a-pro-${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      for (const item of services) await tx.professionalService.create({ data: { serviceId: item.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      return professional.id;
    };
    const marisol = await pro("Marisol Lobão", [manicure, pedicure, gel]), rivaldo = await pro("Rivaldo Ataíde", [manicure, pedicure]);
    const people: Record<string, string> = {};
    for (const [index, name] of customers.entries()) people[name] = (await tx.clientProfile.create({ data: { salonId, name, phone: `1196200${String(index).padStart(4, "0")}` } })).id;
    return { salonId, actor: { salonId, userId: owner.id }, manicure, pedicure, gel, marisol, rivaldo, people };
  });
}
type Atelier = Awaited<ReturnType<typeof atelier>>;
async function book(s: Atelier, customer: string, professionalId: string, service: Svc, date: string, clock: string) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    const startAt = localDateTimeToUtc(`${date}T${clock}`, TZ), endAt = new Date(+startAt + service.durationMin * 60_000);
    return (await tx.appointment.create({ data: { salonId: s.salonId, clientId: s.people[customer], professionalId, serviceId: service.id, startAt, endAt, timezone: TZ,
      priceCents: service.priceCents, status: "CONFIRMED", serviceItems: { create: [{ serviceId: service.id, position: 0, serviceName: service.name,
        durationMin: service.durationMin, priceCents: service.priceCents }] } } })).id;
  });
}
/** SERVICE-1: one appointment with several service items, as the agenda writes it (Appointment.serviceId is the first; one AppointmentService per item). */
async function bookCombo(s: Atelier, customer: string, professionalId: string, services: Svc[], date: string, clock: string) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    const minutes = services.reduce((sum, item) => sum + item.durationMin, 0), price = services.reduce((sum, item) => sum + item.priceCents, 0);
    const startAt = localDateTimeToUtc(`${date}T${clock}`, TZ), endAt = new Date(+startAt + minutes * 60_000);
    return (await tx.appointment.create({ data: { salonId: s.salonId, clientId: s.people[customer], professionalId, serviceId: services[0].id, startAt, endAt, timezone: TZ,
      priceCents: price, status: "CONFIRMED", serviceItems: { create: services.map((item, position) => ({ serviceId: item.id, position, serviceName: item.name,
        durationMin: item.durationMin, priceCents: item.priceCents })) } } })).id;
  });
}
async function rows(s: Atelier) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    return {
      appointments: await tx.appointment.findMany({ where: { salonId: s.salonId }, orderBy: { id: "asc" } }),
      events: await tx.appointmentEvent.findMany({ where: { salonId: s.salonId }, orderBy: { id: "asc" }, select: { id: true, appointmentId: true, eventType: true } }),
      outbox: await tx.notificationOutbox.findMany({ where: { salonId: s.salonId }, orderBy: { id: "asc" }, select: { id: true, appointmentId: true } }),
      customers: await tx.clientProfile.findMany({ where: { salonId: s.salonId }, orderBy: { id: "asc" } }),
    };
  });
}
type Rows = Awaited<ReturnType<typeof rows>>;
/** Exactly the row `id` changed (slot, professional, version); every other row as it was; every new event and notification is that appointment's. */
function expectMoved(before: Rows, after: Rows, id: string, change: { start: string; end: string; professionalId?: string }) {
  const was = before.appointments.find(row => row.id === id)!, now = after.appointments.find(row => row.id === id)!;
  expect(now).toEqual({ ...was, startAt: localDateTimeToUtc(change.start, TZ), endAt: localDateTimeToUtc(change.end, TZ), professionalId: change.professionalId ?? was.professionalId,
    version: was.version + 1, updatedAt: now.updatedAt });
  expect(after.appointments.filter(row => row.id !== id)).toEqual(before.appointments.filter(row => row.id !== id));
  expect(after.customers).toEqual(before.customers);
  const events = after.events.filter(row => !before.events.some(old => old.id === row.id)), notices = after.outbox.filter(row => !before.outbox.some(old => old.id === row.id));
  expect(events.length).toBeGreaterThan(0);
  expect(events.every(row => row.appointmentId === id)).toBe(true);
  expect(notices.every(row => row.appointmentId === id)).toBe(true);
}
/** Two ateliers with the same names; in A: Edênia (manicure Wednesday 10h, gel Thursday 14h, both with Marisol), Valdomiro (pedicure Tuesday 9h and
 * Wednesday 11h, with Rivaldo) and Odorico (manicure Wednesday 15h with Rivaldo). */
async function world() {
  const names = ["Edênia Mascarenhas", "Valdomiro Arraes", "Odorico Serrano"];
  const a = await atelier("A", names), b = await atelier("B", names);
  const manicure = await book(a, "Edênia Mascarenhas", a.marisol, a.manicure, D(2), "10:00"), gel = await book(a, "Edênia Mascarenhas", a.marisol, a.gel, D(3), "14:00");
  const tuesday = await book(a, "Valdomiro Arraes", a.rivaldo, a.pedicure, D(1), "09:00"), wednesday = await book(a, "Valdomiro Arraes", a.rivaldo, a.pedicure, D(2), "11:00");
  const odorico = await book(a, "Odorico Serrano", a.rivaldo, a.manicure, D(2), "15:00");
  await book(b, "Edênia Mascarenhas", b.marisol, b.gel, D(3), "14:00");
  return { a, b, manicure, gel, tuesday, wednesday, odorico };
}

async function open(s: Atelier, frames: E2aInterpretation[]) {
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
  const secretary = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await secretary.start(s.actor, "auto");
  return { s, model, secretary, sessionId };
}
type Conversation = Awaited<ReturnType<typeof open>>;
const say = (c: Conversation, message: string) => c.secretary.send(c.s.actor, { sessionId: c.sessionId, message, clientTurnId: randomUUID() });
const more = (c: Conversation, ...frames: E2aInterpretation[]) => appendScriptedResponses(c.model, frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
const readyGroups = (view: SecretaryView) => view.action_plan?.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION") ?? [];
function confirm(c: Conversation, view: SecretaryView) {
  const plan = view.action_plan, group = readyGroups(view)[0];
  if (!plan || !group) throw Error("NO_READY_GROUP");
  return c.secretary.confirmActionPlanGroup(c.s.actor, c.sessionId, { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint });
}

suite("Reschedule pilot E2-A through SalonSecretary on the local PostgreSQL", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("PILOT_E2A_PREFLIGHT", await assertMvpTestDatabase(admin));
    vi.stubGlobal("fetch", network);
  });
  beforeEach(() => {
    for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, "true");
    vi.stubEnv("SALON_SECRETARY_AGENT", "false");
    vi.stubEnv(FLAG, "true");
    const today = dateKeyInTimeZone(new Date(), TZ);
    D0 = addCalendarDays(today, ((8 - weekdayOfDateKey(today)) % 7) || 7);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(localDateTimeToUtc(`${D0}T08:00`, TZ));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin?.$disconnect(); await prisma.$disconnect(); });

  it("the service locates the appointment: of two of different services, the gel moves, derived and shown; the manicure and the other atelier stay", async () => {
    const w = await world(), message = "A Edênia vai viajar quinta, então passa a esmaltação dela pra sexta às 15h";
    const c = await open(w.a, [e2aLuna({ cliente: { mencao: "Edênia" }, origem: e2aOrigin({ servico: e2aService("a esmaltação", ["Esmaltação em gel"]) }),
      destino: e2aTo(e2aDay("sexta", "pra sexta"), e2aClock(15, "às 15h")), observacoes: ["vai viajar quinta"] })]);
    const before = { a: await rows(w.a), b: await rows(w.b) };
    const view = await say(c, message);
    expect(view.pilot).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(view.pilot?.fields).toMatchObject({ customer: { value: w.a.people["Edênia Mascarenhas"], provenance: "explicit" }, appointment: { value: w.gel, provenance: "derived" },
      date: { value: D(4), provenance: "explicit" }, time: { value: "15:00", provenance: "explicit" }, professional: { value: w.a.marisol, provenance: "inherited" },
      service: { value: w.a.gel.id, provenance: "inherited" } });
    for (const text of ["Edênia Mascarenhas", "Esmaltação em gel", "Marisol Lobão", PILOT_CUSTOMER_NOTICE]) expect(view.message, text).toContain(text);
    expect(view.message).not.toContain("vai viajar");
    // §2: Luna got the strict E2-A tool and the catalog names it may copy into catalogo.
    const request = c.model.requests[0], tool = request.tools.find(item => "name" in item && item.name === PILOT_RESCHEDULE_TOOL) as { parameters?: unknown } | undefined;
    expect(tool?.parameters).toEqual(PILOT_RESCHEDULE_PARAMETERS);
    const sent = JSON.stringify({ instructions: request.systemInstructions, input: request.input });
    for (const name of ["Manicure com cutilagem", "Pedicure spa", "Esmaltação em gel"]) expect(sent, name).toContain(name);
    expect({ a: await rows(w.a), b: await rows(w.b) }).toEqual(before);
    expect((await confirm(c, view)).pilot?.status).toBe("done");
    const after = { a: await rows(w.a), b: await rows(w.b) };
    expectMoved(before.a, after.a, w.gel, { start: `${D(4)}T15:00`, end: `${D(4)}T16:00` });
    expect(after.b).toEqual(before.b);
  });

  it("the weekday enum end to end: the Tuesday appointment (origin 'terca') moves to Thursday ('quinta'); the Wednesday one stays", async () => {
    const w = await world();
    const c = await open(w.a, [e2aLuna({ cliente: { mencao: "Valdomiro" }, origem: e2aOrigin({ dia: e2aDay("terca", "a de terça") }),
      destino: e2aTo(e2aDay("quinta", "pra quinta"), e2aClock(16, "às 16h")) })]);
    const before = await rows(w.a);
    const view = await say(c, "A de terça do Valdomiro vai pra quinta às 16h");
    expect(view.pilot).toMatchObject({ status: "proposal_ready", fields: { appointment: { value: w.tuesday, provenance: "derived" }, date: { value: D(3) }, time: { value: "16:00" } } });
    await confirm(c, view);
    expectMoved(before, await rows(w.a), w.tuesday, { start: `${D(3)}T16:00`, end: `${D(3)}T16:50` });
  });

  it("context only (greeting, family news, a condition, keep the professional) reaches the proposal with no scope question and writes on the Confirmar", async () => {
    const w = await world(), message = "Bom dia! O filho do Odorico nasceu ontem; se der, passa a manicure dele pra sábado às 10h com o mesmo profissional";
    const c = await open(w.a, [e2aLuna({ cliente: { mencao: "Odorico" }, destino: e2aTo(e2aDay("sabado", "pra sábado"), e2aClock(10, "às 10h"), { modo: "manter", mencao: null }),
      observacoes: ["Bom dia!", "O filho do Odorico nasceu ontem", "se der"] })]);
    const before = await rows(w.a);
    const view = await say(c, message);
    expect(view.pilot).toMatchObject({ status: "proposal_ready", questions: [], fields: { appointment: { value: w.odorico }, professional: { value: w.a.rivaldo, provenance: "inherited" } } });
    expect(readyGroups(view)).toHaveLength(1);
    expect(await rows(w.a)).toEqual(before);
    await confirm(c, view);
    expectMoved(before, await rows(w.a), w.odorico, { start: `${D(5)}T10:00`, end: `${D(5)}T10:40` });
  });

  it("a real separate request beside the reschedule asks the scope question and writes nothing; the owner's no withdraws, still nothing written", async () => {
    const w = await world(), pedido = "desmarca a Edênia de quarta";
    const c = await open(w.a, [e2aLuna({ tipo: "misto", cliente: { mencao: "Odorico" }, destino: e2aTo(e2aDay("sabado", "pra sábado"), e2aClock(10, "às 10h")),
      observacoes: ["se der"], fora_do_escopo: [{ tipo: "cancelar", pedido }] })]);
    const before = { a: await rows(w.a), b: await rows(w.b) };
    const view = await say(c, `Se der, passa o Odorico pra sábado às 10h e ${pedido}`);
    expect(view.pilot).toMatchObject({ status: "pending", questions: [expect.objectContaining({ field: "scope", reason: "OUT_OF_SCOPE_PART" })] });
    expect(view.message).toContain(`“${pedido}”`);
    expect(readyGroups(view)).toEqual([]);
    more(c, e2aLuna({ tipo: "resposta", resposta_a: view.pilot!.questions[0].questionId, aceita_parcial: false }));
    const declined = await say(c, "Não, deixa tudo como está então");
    expect(declined.pilot?.status).toBe("withdrawn");
    expect(declined.message).toContain(PILOT_WITHDRAWN_REPLY);
    expect({ a: await rows(w.a), b: await rows(w.b) }).toEqual(before);
  });

  it("a request wholly out of scope, with context, gets the clear answer, opens no plan and writes nothing", async () => {
    const w = await world();
    const c = await open(w.a, [e2aLuna({ tipo: "fora_do_escopo", observacoes: ["é para um curso de atualização"],
      fora_do_escopo: [{ tipo: "bloquear", pedido: "trava os horários da Marisol na sexta" }] })]);
    const before = await rows(w.a);
    const view = await say(c, "Trava os horários da Marisol na sexta, é para um curso de atualização");
    expect(view.message).toContain(PILOT_OUT_OF_SCOPE_REPLY);
    expect(view.pilot?.status ?? null).toBeNull();
    expect(readyGroups(view)).toEqual([]);
    expect(c.model.requests).toHaveLength(1);
    expect(await rows(w.a)).toEqual(before);
  });

  it("SERVICE-1: a lone two-item appointment named by its second service is bound (derived) and the Confirmar moves exactly it", async () => {
    const a = await atelier("A", ["Zenóbia Florêncio"]), b = await atelier("B", ["Zenóbia Florêncio"]);
    const combo = await bookCombo(a, "Zenóbia Florêncio", a.marisol, [a.manicure, a.pedicure], D(3), "10:00");
    await bookCombo(b, "Zenóbia Florêncio", b.marisol, [b.manicure, b.pedicure], D(3), "10:00");
    const c = await open(a, [e2aLuna({ cliente: { mencao: "Zenóbia" }, origem: e2aOrigin({ servico: e2aService("A pedicure", ["Pedicure spa"]) }),
      destino: e2aTo(e2aDay("sabado", "pra sábado"), e2aClock(10, "às 10h")) })]);
    const before = { a: await rows(a), b: await rows(b) };
    const view = await say(c, "A pedicure da Zenóbia vai pra sábado às 10h");
    expect(view.pilot).toMatchObject({ status: "proposal_ready", questions: [], fields: { appointment: { value: combo, provenance: "derived" }, date: { value: D(5) }, time: { value: "10:00" } } });
    expect({ a: await rows(a), b: await rows(b) }).toEqual(before);
    expect((await confirm(c, view)).pilot?.status).toBe("done");
    const after = { a: await rows(a), b: await rows(b) };
    expectMoved(before.a, after.a, combo, { start: `${D(5)}T10:00`, end: `${D(5)}T11:30` });
    expect(after.b).toEqual(before.b);
  });

  it("SERVICE-1: a two-item appointment and a lone appointment of its second service: the owner is asked with both, nothing written", async () => {
    const a = await atelier("A", ["Anatólio Gaudêncio"]);
    const combo = await bookCombo(a, "Anatólio Gaudêncio", a.marisol, [a.manicure, a.pedicure], D(2), "10:00");
    const solo = await book(a, "Anatólio Gaudêncio", a.rivaldo, a.pedicure, D(4), "11:00");
    const c = await open(a, [e2aLuna({ cliente: { mencao: "Anatólio" }, origem: e2aOrigin({ servico: e2aService("A pedicure", ["Pedicure spa"]) }),
      destino: e2aTo(e2aDay("sabado", "pra sábado"), e2aClock(16, "às 16h")) })]);
    const before = await rows(a);
    const view = await say(c, "A pedicure do Anatólio vai pra sábado às 16h");
    expect(view.pilot?.questions).toEqual([expect.objectContaining({ field: "appointment", reason: "APPOINTMENT_SEVERAL" })]);
    expect(view.pilot?.questions[0].options?.map(option => option.id).sort()).toEqual([combo, solo].sort());
    expect(readyGroups(view)).toEqual([]);
    expect(await rows(a)).toEqual(before);
  });
});
