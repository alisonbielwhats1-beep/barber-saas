import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { AGENT_DEPENDENCY_FLAGS } from "../../../packages/salon-secretary/src/agent-context";
import { PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { prisma } from "../prisma";
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { PILOT_CUSTOMER_NOTICE } from "../secretary-pilot";
import { ScriptedServicesModel, appendScriptedResponses, call } from "../../test/scripted-services-model";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc, weekdayOfDateKey } from "../time";
import { e2bDate, e2bDays, e2bLuna, e2bSameClock, e2bTo, type E2bInterpretation } from "../../test/secretary-pilot-e2b";

/** Reschedule pilot E2-B on the local disposable PostgreSQL (docs/c5-spike/12-piloto-remarcacao.md §11; Adendo 11), written BEFORE the
 * implementation: through SalonSecretary with SALON_SECRETARY_PILOT_RESCHEDULE=true only when RUN_SERVICE_MVP_INTEGRATION=1 and the MVP database
 * preflight passes (127.0.0.1:55441/everflair_service_mvp), with a scripted Luna answering the E2-B contract (no network, no paid model).
 *  - an offset anchored on the appointment moves exactly that row to origin + N (TWIN anchored on today → today + N);
 *  - two anchors with different readings ask the day with both real dates; the owner's answer binds; the Confirmar moves exactly that row;
 *  - "qualquer" at the origin's own slot moves the appointment to another free professional (same start and end), never NO_CHANGE;
 *  - nobody free asks PROFESSIONAL_NOBODY_FREE and writes nothing.
 * The clock is frozen at a Monday 08:00 in São Paulo a few days ahead. Synthetic podiatry and massage studio, invented names and sentences;
 * another studio with the same names must stay untouched. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const TZ = "America/Sao_Paulo", FLAG = "SALON_SECRETARY_PILOT_RESCHEDULE";
let admin: PrismaClient;
/** The frozen Monday; D(n) is n days after it (D(1) Tuesday … D(5) Saturday). */
let D0 = "";
const D = (offset: number) => addCalendarDays(D0, offset);
type Svc = { id: string; name: string; durationMin: number; priceCents: number };

async function studio(label: string, customers: string[]) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: `Gestão ${label}`, email: `e2b-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Espaço Jatobá ${label}`, slug: `e2b-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: TZ, currency: "BRL",
      minBookingLeadMinutes: 0, bufferMinutes: 0 } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const service = (name: string, durationMin: number, priceCents: number) => tx.service.create({ data: { salonId, name, durationMin, priceCents } });
    const pindas = await service("Massagem com pindas quentes", 60, 14000), escalda = await service("Escalda-pés aromático", 30, 5000);
    const pro = async (name: string, services: Svc[]) => {
      const user = await tx.user.create({ data: { name, email: `e2b-pro-${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      for (const item of services) await tx.professionalService.create({ data: { serviceId: item.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      return professional.id;
    };
    const edelvira = await pro("Edelvira Massapê", [pindas, escalda]), felisberto = await pro("Felisberto Capibaribe", [pindas, escalda]);
    const genoveva = await pro("Genoveva Itapoã", [escalda]);
    const people: Record<string, string> = {};
    for (const [index, name] of customers.entries()) people[name] = (await tx.clientProfile.create({ data: { salonId, name, phone: `1196300${String(index).padStart(4, "0")}` } })).id;
    return { salonId, actor: { salonId, userId: owner.id }, pindas, escalda, edelvira, felisberto, genoveva, people };
  });
}
type Studio = Awaited<ReturnType<typeof studio>>;
async function book(s: Studio, customer: string, professionalId: string, service: Svc, date: string, clock: string) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    const startAt = localDateTimeToUtc(`${date}T${clock}`, TZ), endAt = new Date(+startAt + service.durationMin * 60_000);
    return (await tx.appointment.create({ data: { salonId: s.salonId, clientId: s.people[customer], professionalId, serviceId: service.id, startAt, endAt, timezone: TZ,
      priceCents: service.priceCents, status: "CONFIRMED", serviceItems: { create: [{ serviceId: service.id, position: 0, serviceName: service.name,
        durationMin: service.durationMin, priceCents: service.priceCents }] } } })).id;
  });
}
async function rows(s: Studio) {
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
async function open(s: Studio, frames: E2bInterpretation[]) {
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
  const secretary = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await secretary.start(s.actor, "auto");
  return { s, model, secretary, sessionId };
}
type Conversation = Awaited<ReturnType<typeof open>>;
const say = (c: Conversation, message: string) => c.secretary.send(c.s.actor, { sessionId: c.sessionId, message, clientTurnId: randomUUID() });
const more = (c: Conversation, ...frames: E2bInterpretation[]) => appendScriptedResponses(c.model, frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
const readyGroups = (view: SecretaryView) => view.action_plan?.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION") ?? [];
function confirm(c: Conversation, view: SecretaryView) {
  const plan = view.action_plan, group = readyGroups(view)[0];
  if (!plan || !group) throw Error("NO_READY_GROUP");
  return c.secretary.confirmActionPlanGroup(c.s.actor, c.sessionId, { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint });
}
const NAMES = ["Otacília Guarapari", "Pacífico Igarapé", "Salomé Andaraí", "Leovigildo Tucunaré"];

suite("Reschedule pilot E2-B through SalonSecretary on the local PostgreSQL", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("PILOT_E2B_PREFLIGHT", await assertMvpTestDatabase(admin));
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

  it("TWINS: one day after the APPOINTMENT moves exactly that row to D(3); one day after TODAY moves it to D(1); the other studio stays", async () => {
    for (const [anchor, mencao, expected] of [["origem", "um dia depois do que ela tem marcado", D(3)], ["hoje", "amanhã", D(1)]] as const) {
      const a = await studio("A", NAMES), b = await studio("B", NAMES);
      const id = await book(a, "Otacília Guarapari", a.edelvira, a.pindas, D(2), "10:00");
      await book(a, "Pacífico Igarapé", a.edelvira, a.pindas, D(2), "14:00");
      await book(b, "Otacília Guarapari", b.edelvira, b.pindas, D(2), "10:00");
      const c = await open(a, [e2bLuna({ cliente: { mencao: "Otacília" }, destino: e2bTo(e2bDays(1, [anchor], mencao), e2bSameClock("no mesmo horário")) })]);
      const before = { a: await rows(a), b: await rows(b) };
      const view = await say(c, `Realoca a Otacília para ${mencao}, no mesmo horário`);
      expect(view.pilot, anchor).toMatchObject({ status: "proposal_ready", questions: [], fields: { appointment: { value: id }, date: { value: expected, provenance: "derived" },
        time: { value: "10:00" }, professional: { value: a.edelvira } } });
      for (const text of ["Otacília Guarapari", "Massagem com pindas quentes", "Edelvira Massapê", PILOT_CUSTOMER_NOTICE]) expect(view.message, text).toContain(text);
      expect({ a: await rows(a), b: await rows(b) }, "nothing written before the Confirmar").toEqual(before);
      expect((await confirm(c, view)).pilot?.status).toBe("done");
      const after = { a: await rows(a), b: await rows(b) };
      expectMoved(before.a, after.a, id, { start: `${expected}T10:00`, end: `${expected}T11:00` });
      expect(after.b).toEqual(before.b);
    }
  });

  it("two anchors with different readings ask the day (both real dates), nothing written; the owner's answer binds and the Confirmar moves exactly that row", async () => {
    const a = await studio("A", NAMES);
    const id = await book(a, "Pacífico Igarapé", a.felisberto, a.pindas, D(3), "14:00");
    const c = await open(a, [e2bLuna({ cliente: { mencao: "Pacífico" }, destino: e2bTo(e2bDays(2, ["origem", "hoje"], "dois dias depois"), e2bSameClock("mesma hora")) })]);
    const before = await rows(a);
    const asked = await say(c, "Joga o Pacífico pra dois dias depois, mesma hora");
    expect(asked.pilot?.questions).toEqual([expect.objectContaining({ field: "date", reason: "ANCHOR_TWO_READINGS" })]);
    expect(asked.pilot?.questions[0].options?.map(option => option.id)).toEqual([D(2), D(5)]);
    expect(readyGroups(asked)).toEqual([]);
    expect(await rows(a)).toEqual(before);
    more(c, e2bLuna({ tipo: "resposta", resposta_a: asked.pilot!.questions[0].questionId, destino: e2bTo(e2bDate(Number(D(5).slice(8, 10)), Number(D(5).slice(5, 7)), "o segundo"), null) }));
    const ready = await say(c, "o segundo");
    expect(ready.pilot).toMatchObject({ status: "proposal_ready", fields: { appointment: { value: id }, date: { value: D(5) }, time: { value: "14:00" } } });
    expect(await rows(a)).toEqual(before);
    await confirm(c, ready);
    expectMoved(before, await rows(a), id, { start: `${D(5)}T14:00`, end: `${D(5)}T15:00` });
  });

  it("'qualquer' at the origin's own slot moves the appointment to the other free professional (same start and end), shown; the other studio stays", async () => {
    const a = await studio("A", NAMES), b = await studio("B", NAMES);
    const id = await book(a, "Salomé Andaraí", a.edelvira, a.pindas, D(2), "11:00");
    await book(b, "Salomé Andaraí", b.edelvira, b.pindas, D(2), "11:00");
    const c = await open(a, [e2bLuna({ cliente: { mencao: "Salomé" }, destino: e2bTo(null, null, { modo: "qualquer", mencao: null }) })]);
    const before = { a: await rows(a), b: await rows(b) };
    const view = await say(c, "A Salomé pode ser com quem estiver livre, no mesmo horário");
    expect(view.pilot).toMatchObject({ status: "proposal_ready", questions: [], fields: { appointment: { value: id }, date: { value: D(2) }, time: { value: "11:00" },
      professional: { value: a.felisberto, provenance: "derived" } } });
    expect(view.message).toContain("Felisberto Capibaribe");
    expect({ a: await rows(a), b: await rows(b) }).toEqual(before);
    expect((await confirm(c, view)).pilot?.status).toBe("done");
    const after = { a: await rows(a), b: await rows(b) };
    expectMoved(before.a, after.a, id, { start: `${D(2)}T11:00`, end: `${D(2)}T12:00`, professionalId: a.felisberto });
    expect(after.b).toEqual(before.b);
  });

  it("nobody free at the origin's slot (the other one is busy, the third does not perform the service): PROFESSIONAL_NOBODY_FREE, nothing written", async () => {
    const a = await studio("A", NAMES);
    await book(a, "Salomé Andaraí", a.edelvira, a.pindas, D(2), "11:00");
    await book(a, "Leovigildo Tucunaré", a.felisberto, a.pindas, D(2), "11:30");
    const c = await open(a, [e2bLuna({ cliente: { mencao: "Salomé" }, destino: e2bTo(null, null, { modo: "qualquer", mencao: null }) })]);
    const before = await rows(a);
    const view = await say(c, "A Salomé pode ser com quem estiver livre, no mesmo horário");
    expect(view.pilot?.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_NOBODY_FREE" })]);
    expect(view.pilot?.fields).toMatchObject({ customer: { provenance: "explicit" }, appointment: { provenance: "derived" }, professional: { provenance: "unresolved" } });
    expect(readyGroups(view)).toEqual([]);
    expect(await rows(a)).toEqual(before);
  });
});
