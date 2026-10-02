import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, ModelRequest } from "@everflair/salon-secretary";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { AGENT_DEPENDENCY_FLAGS } from "../../../packages/salon-secretary/src/agent-context";
import { PILOT_RESCHEDULE_PARAMETERS, PILOT_RESCHEDULE_TOOL, type PilotInterpretation, type PilotTempoDia,
  type PilotTempoHora } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { confirmAppointmentCreate } from "../scheduling-actions";
import { PostgresSessionStore, type SecretarySessionStore } from "../secretary-session-store";
import { pilotOptionRef, PILOT_ALREADY_WRITTEN, PILOT_CUSTOMER_NOTICE, PILOT_OUT_OF_SCOPE_REPLY, PILOT_PREPARATION_FAILED, PILOT_PROPOSAL_EXPIRED, PILOT_SAFE_REPLY } from "../secretary-pilot";
import { PILOT_FIELDS, PILOT_PROVENANCES } from "../secretary-pilot-plan";
import { expiredProposalMessage } from "../secretary-proposal-lifetime";
import { formatLocal } from "../secretary-datetime-format";
import { ScriptedServicesModel, appendScriptedResponses, call } from "../../test/scripted-services-model";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc, weekdayOfDateKey } from "../time";

/** Reschedule pilot, E1 integration tests written before the code (docs/c5-spike/12-piloto-remarcacao.md §5, §7 "Integração"; owner decisions
 * 25-31): through SalonSecretary with SALON_SECRETARY_PILOT_RESCHEDULE=true on the local disposable PostgreSQL only (RUN_SERVICE_MVP_INTEGRATION=1
 * and the MVP database preflight: 127.0.0.1:55441/everflair_service_mvp, or nothing runs), with a scripted Luna that answers the typed
 * `interpretar_remarcacao` contract (no network, no paid model). The proposal is confirmed through the existing Confirmar (the view's action_plan
 * group), as the Front and the practice harness do. The clock is frozen at a Monday 08:00 in São Paulo a few days ahead, so weekday readings are
 * deterministic. Synthetic esthetics studio, invented names and sentences; another salon with the same names must stay untouched. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const TZ = "America/Sao_Paulo", FLAG = "SALON_SECRETARY_PILOT_RESCHEDULE";
let admin: PrismaClient;
/** The frozen Monday; D(n) is n days after it (D(2) Wednesday, D(4) Friday). */
let D0 = "";
const D = (offset: number) => addCalendarDays(D0, offset);
type Svc = { id: string; name: string; durationMin: number; priceCents: number };

async function studio(label: string, customers: string[]) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: `Gestão ${label}`, email: `pilot-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Estúdio Jacarandá ${label}`, slug: `pilot-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: TZ, currency: "BRL",
      minBookingLeadMinutes: 0, bufferMinutes: 0 } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const service = (name: string, durationMin: number, priceCents: number) => tx.service.create({ data: { salonId, name, durationMin, priceCents } });
    const limpeza = await service("Limpeza de pele", 50, 12000), sobrancelha = await service("Design de sobrancelha", 30, 5500), drenagem = await service("Drenagem linfática", 45, 14000);
    const pro = async (name: string, services: Svc[]) => {
      const user = await tx.user.create({ data: { name, email: `pilot-pro-${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      for (const item of services) await tx.professionalService.create({ data: { serviceId: item.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      return professional.id;
    };
    const carlos = await pro("Carlos Imbiriba", [limpeza, sobrancelha, drenagem]), dalva = await pro("Dalva Nascimento", [limpeza, sobrancelha]);
    const people: Record<string, string> = {};
    for (const [index, name] of customers.entries()) people[name] = (await tx.clientProfile.create({ data: { salonId, name, phone: `1197000${String(index).padStart(4, "0")}` } })).id;
    return { salonId, actor: { salonId, userId: owner.id }, limpeza, sobrancelha, drenagem, carlos, dalva, people };
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
/** The business rows of one salon (appointments whole; events and notifications by id and appointment; customers whole). */
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
/** Exactly the row `id` changed (its slot, professional, version), every other row is as it was, and every new event and notification is that
 * appointment's: the reschedule keeps the normal notification (decision 31). */
function expectMoved(before: Rows, after: Rows, id: string, change: { start: string; end: string; professionalId?: string }) {
  const was = before.appointments.find(row => row.id === id)!, now = after.appointments.find(row => row.id === id)!;
  expect(now).toEqual({ ...was, startAt: localDateTimeToUtc(change.start, TZ), endAt: localDateTimeToUtc(change.end, TZ), professionalId: change.professionalId ?? was.professionalId,
    version: was.version + 1, updatedAt: now.updatedAt });
  expect(after.appointments.filter(row => row.id !== id)).toEqual(before.appointments.filter(row => row.id !== id));
  expect(after.customers).toEqual(before.customers);
  const events = after.events.filter(row => !before.events.some(old => old.id === row.id)), notices = after.outbox.filter(row => !before.outbox.some(old => old.id === row.id));
  expect(events.length).toBeGreaterThan(0);
  expect(events.every(row => row.appointmentId === id)).toBe(true);
  expect(notices.length).toBeGreaterThan(0);
  expect(notices.every(row => row.appointmentId === id)).toBe(true);
}
/** The studio of most cases: Ana's appointment on Wednesday 10h with Carlos; Bento on Friday (with Carlos at 9h, with Dalva at 15h); Ana's past
 * visit; Wanda (no booking; she takes Carlos's Friday 15h where a case needs that slot taken); and another salon with the same names. */
async function world() {
  const a = await studio("A", ["Ana Quaresma", "Bento Ximenes", "Wanda Seixas"]), b = await studio("B", ["Ana Quaresma"]);
  const ana = await book(a, "Ana Quaresma", a.carlos, a.limpeza, D(2), "10:00");
  await book(a, "Ana Quaresma", a.carlos, a.limpeza, D(-7), "10:00");
  await book(a, "Bento Ximenes", a.carlos, a.limpeza, D(4), "09:00");
  await book(a, "Bento Ximenes", a.dalva, a.sobrancelha, D(4), "15:00");
  await book(b, "Ana Quaresma", b.carlos, b.limpeza, D(2), "10:00");
  return { a, b, ana };
}

const NO_ORIGIN: PilotInterpretation["origem"] = { dia: null, hora: null, profissional_mencao: null, servico_mencao: null, posicao: null };
const luna = (over: Partial<PilotInterpretation> = {}): PilotInterpretation => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null, cliente: { mencao: null },
  origem: NO_ORIGIN, destino: { dia: null, hora: null, profissional: { modo: null, mencao: null } }, fora_do_escopo: [], ...over });
const weekday = (dia_semana: number, mencao: string): PilotTempoDia => ({ tipo: "dia_semana", dia_semana, qualificador: null, mencao });
const at = (hora: number, mencao: string): PilotTempoHora => ({ tipo: "relogio", hora, minuto: 0, periodo: null, mencao });
const to = (dia: PilotTempoDia | null, hora: PilotTempoHora | null, profissional: PilotInterpretation["destino"]["profissional"] = { modo: null, mencao: null }) => ({ dia, hora, profissional });
const MAIN = "Remarque a Ana com Carlos para sexta às 15h";
/** Luna's reading of MAIN: the customer and the professional of the appointment as the owner named them, Friday (6) at 15h. */
const mainTurn = luna({ cliente: { mencao: "Ana" }, origem: { ...NO_ORIGIN, profissional_mencao: "Carlos" }, destino: to(weekday(6, "sexta"), at(15, "às 15h")) });

async function open(s: Studio, frames: PilotInterpretation[], store?: SecretarySessionStore) {
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
  const secretary = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true }, () => store);
  const { sessionId } = await secretary.start(s.actor, "auto");
  return { s, model, secretary, sessionId };
}
type Conversation = Awaited<ReturnType<typeof open>>;
const say = (c: Conversation, message: string, clientTurnId: string = randomUUID()) => c.secretary.send(c.s.actor, { sessionId: c.sessionId, message, clientTurnId });
const more = (c: Conversation, ...frames: PilotInterpretation[]) => appendScriptedResponses(c.model, frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
const readyGroups = (view: SecretaryView) => view.action_plan?.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION") ?? [];
function approvalOf(view: SecretaryView) {
  const plan = view.action_plan, group = readyGroups(view)[0];
  if (!plan || !group) throw Error("NO_READY_GROUP");
  return { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint };
}
const confirm = (c: Conversation, view: SecretaryView) => c.secretary.confirmActionPlanGroup(c.s.actor, c.sessionId, approvalOf(view));
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** What reaches the provider of a request, with per-conversation ids masked (the agent flag-off pattern). */
const body = (request: ModelRequest) => JSON.stringify({ instructions: request.systemInstructions, input: request.input, settings: request.modelSettings, tools: request.tools,
  output: request.outputType, handoffs: request.handoffs, tracing: request.tracing, explicit: request.toolsExplicitlyProvided, prompt: request.prompt ?? null,
  previous: request.previousResponseId ?? null, conversation: request.conversationId ?? null }).replace(UUID, "<uuid>");

suite("Reschedule pilot through SalonSecretary on the local PostgreSQL (flag SALON_SECRETARY_PILOT_RESCHEDULE)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("PILOT_RESCHEDULE_PREFLIGHT", await assertMvpTestDatabase(admin));
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

  it("main flow «Remarque a Ana com Carlos para sexta às 15h»: located once, before and after shown with the customer notice, confirmed, exactly that row changed", async () => {
    const w = await world(), c = await open(w.a, [mainTurn]);
    const before = { a: await rows(w.a), b: await rows(w.b) };
    const view = await say(c, MAIN);
    expect(view.pilot).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(view.pilot?.fields).toMatchObject({
      customer: { value: w.a.people["Ana Quaresma"], display: "Ana Quaresma", provenance: "explicit" }, appointment: { value: w.ana, provenance: "derived" },
      date: { value: D(4), provenance: "explicit" }, time: { value: "15:00", provenance: "explicit" },
      professional: { value: w.a.carlos, provenance: "inherited" }, service: { value: w.a.limpeza.id, provenance: "inherited" } });
    for (const name of PILOT_FIELDS) expect(PILOT_PROVENANCES, name).toContain(view.pilot?.fields?.[name].provenance);
    for (const text of ["Ana Quaresma", "Limpeza de pele", "Carlos Imbiriba", "ANTES", "DEPOIS", formatLocal(`${D(2)}T10:00`), formatLocal(`${D(4)}T15:00`), money(12000), "50 min",
      PILOT_CUSTOMER_NOTICE]) expect(view.message, text).toContain(text);
    expect(readyGroups(view)).toHaveLength(1);
    expect(c.model.requests).toHaveLength(1);
    // §2: Luna got the strict tool, the team, the catalog, the day and the timezone; never the salon's customer list (decision 22).
    const request = c.model.requests[0];
    const tool = request.tools.find(item => "name" in item && item.name === PILOT_RESCHEDULE_TOOL) as { parameters?: unknown; strict?: boolean } | undefined;
    expect(tool?.strict).toBe(true);
    expect(tool?.parameters).toEqual(PILOT_RESCHEDULE_PARAMETERS);
    const sent = JSON.stringify({ instructions: request.systemInstructions, input: request.input });
    for (const text of ["Carlos Imbiriba", "Dalva Nascimento", "Limpeza de pele", "Design de sobrancelha", "Drenagem linfática", TZ]) expect(sent, text).toContain(text);
    expect(sent.includes(D(0)) || sent.includes(`${D(0).slice(8, 10)}/${D(0).slice(5, 7)}`)).toBe(true);
    for (const text of ["Quaresma", "Bento", "Ximenes", "Wanda", "Seixas"]) expect(sent, text).not.toContain(text);
    expect({ a: await rows(w.a), b: await rows(w.b) }).toEqual(before);
    const done = await confirm(c, view);
    expect(done.pilot?.status).toBe("done");
    const after = { a: await rows(w.a), b: await rows(w.b) };
    expectMoved(before.a, after.a, w.ana, { start: `${D(4)}T15:00`, end: `${D(4)}T15:50` });
    expect(after.b).toEqual(before.b);
  });

  it("two Anas: asked with both real customers, nothing proposed or written; the answer binds the one named and only her appointment moves", async () => {
    const a = await studio("A", ["Ana Quaresma", "Ana Bezerra", "Bento Ximenes"]);
    await book(a, "Ana Quaresma", a.carlos, a.limpeza, D(2), "10:00");
    const bezerra = await book(a, "Ana Bezerra", a.dalva, a.sobrancelha, D(3), "11:00");
    const c = await open(a, [luna({ cliente: { mencao: "Ana" }, destino: to(weekday(6, "sexta"), at(15, "15h")) })]);
    const before = await rows(a);
    const asked = await say(c, "Puxa a Ana pra sexta, 15h");
    expect(asked.pilot).toMatchObject({ status: "pending", fields: { customer: { value: null, provenance: "unresolved" } } });
    expect(asked.pilot?.questions).toHaveLength(1);
    const question = asked.pilot!.questions[0];
    expect(question).toMatchObject({ field: "customer", reason: "CUSTOMER_AMBIGUOUS" });
    expect(question.options?.map(option => option.id).sort()).toEqual([a.people["Ana Bezerra"], a.people["Ana Quaresma"]].sort());
    for (const name of ["Ana Quaresma", "Ana Bezerra"]) expect(asked.message).toContain(name);
    expect(readyGroups(asked)).toEqual([]);
    expect(await rows(a)).toEqual(before);
    more(c, luna({ tipo: "resposta", resposta_a: question.questionId, cliente: { mencao: "Bezerra" } }));
    const ready = await say(c, "A Bezerra");
    expect(ready.pilot).toMatchObject({ status: "proposal_ready", fields: { customer: { value: a.people["Ana Bezerra"], display: "Ana Bezerra", provenance: "explicit" },
      appointment: { value: bezerra, provenance: "derived" }, date: { value: D(4) }, time: { value: "15:00" }, professional: { value: a.dalva, provenance: "inherited" } } });
    expect(ready.pilot!.revision).toBeGreaterThan(asked.pilot!.revision);
    for (const text of ["Ana Bezerra", PILOT_CUSTOMER_NOTICE]) expect(ready.message).toContain(text);
    await confirm(c, ready);
    expectMoved(before, await rows(a), bezerra, { start: `${D(4)}T15:00`, end: `${D(4)}T15:30` });
  });

  it("a surname that contradicts the only match is asked («Encontrei …, mas você escreveu …») and never substituted", async () => {
    const a = await studio("A", ["Leopoldina Siqueira", "Bento Ximenes"]);
    await book(a, "Leopoldina Siqueira", a.carlos, a.limpeza, D(2), "10:00");
    const c = await open(a, [luna({ cliente: { mencao: "Leopoldina Arantes" }, destino: to(weekday(5, "quinta"), at(10, "às 10h")) })]);
    const before = await rows(a);
    const view = await say(c, "Leva a Leopoldina Arantes pra quinta às 10h");
    expect(view.pilot).toMatchObject({ status: "pending", fields: { customer: { value: null, provenance: "unresolved" }, appointment: { value: null, provenance: "unresolved" } } });
    expect(view.pilot?.questions).toEqual([expect.objectContaining({ field: "customer", reason: "CUSTOMER_CONTRADICTORY" })]);
    expect(view.message).toContain("Encontrei Leopoldina Siqueira, mas você escreveu Leopoldina Arantes");
    expect(readyGroups(view)).toEqual([]);
    expect(await rows(a)).toEqual(before);
  });

  it("a slot already taken is never proposed: the Secretária explains and asks another one, keeping what was resolved", async () => {
    const w = await world();
    await book(w.a, "Wanda Seixas", w.a.carlos, w.a.limpeza, D(4), "15:00");
    const c = await open(w.a, [luna({ cliente: { mencao: "Ana" }, destino: to(weekday(6, "sexta"), at(15, "às 15h")) })]);
    const before = await rows(w.a);
    const view = await say(c, "Coloca a Ana na sexta às 15h");
    expect(readyGroups(view)).toEqual([]);
    expect(view.pilot?.status).toBe("pending");
    expect(view.pilot?.questions).toEqual([expect.objectContaining({ reason: "SLOT_UNAVAILABLE" })]);
    expect(["time", "professional"]).toContain(view.pilot?.questions[0].field);
    expect(view.pilot?.fields).toMatchObject({ customer: { value: w.a.people["Ana Quaresma"], provenance: "explicit" }, appointment: { value: w.ana, provenance: "derived" },
      date: { value: D(4), provenance: "explicit" } });
    expect(await rows(w.a)).toEqual(before);
  });

  it("a slot taken after the proposal fails safe at the Confirmar: nothing is written", async () => {
    const w = await world(), c = await open(w.a, [mainTurn]);
    const view = await say(c, MAIN);
    expect(readyGroups(view)).toHaveLength(1);
    await book(w.a, "Wanda Seixas", w.a.carlos, w.a.limpeza, D(4), "15:00");
    const before = await rows(w.a);
    const outcome = await confirm(c, view).then(done => ({ done }), (error: unknown) => ({ error }));
    expect(await rows(w.a)).toEqual(before);
    if ("done" in outcome) expect(outcome.done.pilot?.status).not.toBe("done");
  });

  it("a correction to 16h is its own change: new revision and proposal (with the notice), the 15h Confirmar is stale, 16h is what gets written", async () => {
    const w = await world(), c = await open(w.a, [mainTurn, luna({ destino: to(null, at(16, "às 16h")) })]);
    const first = await say(c, MAIN), before = await rows(w.a);
    const second = await say(c, "Melhor às 16h");
    expect(second.pilot).toMatchObject({ status: "proposal_ready", fields: { time: { value: "16:00", provenance: "explicit" }, date: { value: D(4) },
      customer: { value: w.a.people["Ana Quaresma"] }, appointment: { value: w.ana } } });
    expect(second.pilot!.revision).toBeGreaterThan(first.pilot!.revision);
    for (const text of [formatLocal(`${D(4)}T16:00`), PILOT_CUSTOMER_NOTICE]) expect(second.message).toContain(text);
    await expect(confirm(c, first)).rejects.toThrow("CONFIRMATION_STALE");
    expect(await rows(w.a)).toEqual(before);
    await confirm(c, second);
    expectMoved(before, await rows(w.a), w.ana, { start: `${D(4)}T16:00`, end: `${D(4)}T16:50` });
  });

  it("a stale or forged Confirmar (other revision, fingerprint or plan) writes nothing; the real one writes once", async () => {
    const w = await world(), c = await open(w.a, [mainTurn]);
    const view = await say(c, MAIN), before = await rows(w.a), approval = approvalOf(view);
    for (const forged of [{ ...approval, revision: approval.revision + 1 }, { ...approval, revision: approval.revision - 1 }, { ...approval, fingerprint: "0".repeat(64) },
      { ...approval, plan_ref: randomUUID() }]) await expect(c.secretary.confirmActionPlanGroup(w.a.actor, c.sessionId, forged)).rejects.toThrow();
    expect(await rows(w.a)).toEqual(before);
    await confirm(c, view);
    expectMoved(before, await rows(w.a), w.ana, { start: `${D(4)}T15:00`, end: `${D(4)}T15:50` });
  });

  it("a professional change keeps the day and the clock (inherited) and writes only the new professional", async () => {
    const w = await world();
    const c = await open(w.a, [luna({ cliente: { mencao: "Ana" }, destino: to(null, { tipo: "mesmo_da_origem", mencao: "mantém o horário" }, { modo: "nomeado", mencao: "Dalva" }) })]);
    const before = await rows(w.a);
    const view = await say(c, "Troca a Ana do Carlos pra Dalva, mantém o horário");
    expect(view.pilot).toMatchObject({ status: "proposal_ready", fields: { professional: { value: w.a.dalva, provenance: "explicit" }, date: { value: D(2), provenance: "inherited" },
      time: { value: "10:00", provenance: "inherited" }, service: { value: w.a.limpeza.id, provenance: "inherited" } } });
    for (const text of ["Ana Quaresma", "Carlos Imbiriba", "Dalva Nascimento", PILOT_CUSTOMER_NOTICE]) expect(view.message, text).toContain(text);
    await confirm(c, view);
    expectMoved(before, await rows(w.a), w.ana, { start: `${D(2)}T10:00`, end: `${D(2)}T10:50`, professionalId: w.a.dalva });
  });

  it("withdrawal and correction in the same message: the corrected draft stands, the old Confirmar is stale, 15h is never written", async () => {
    const w = await world(), c = await open(w.a, [mainTurn, luna({ desistir: true, destino: to(null, at(17, "às 17h")) })]);
    const first = await say(c, MAIN), before = await rows(w.a);
    const second = await say(c, "Não, desconsidera as 15h; põe às 17h");
    expect(second.pilot).toMatchObject({ status: "proposal_ready", fields: { time: { value: "17:00", provenance: "explicit" }, date: { value: D(4) } } });
    expect(second.pilot!.revision).toBeGreaterThan(first.pilot!.revision);
    await expect(confirm(c, first)).rejects.toThrow("CONFIRMATION_STALE");
    expect(await rows(w.a)).toEqual(before);
    await confirm(c, second);
    expectMoved(before, await rows(w.a), w.ana, { start: `${D(4)}T17:00`, end: `${D(4)}T17:50` });
  });

  it("a withdrawal alone leaves the action withdrawn: nothing confirmable, the old Confirmar writes nothing", async () => {
    const w = await world(), c = await open(w.a, [mainTurn, luna({ desistir: true, cliente: { mencao: "Ana" } })]);
    const first = await say(c, MAIN), before = await rows(w.a);
    const second = await say(c, "Deixa quieto, não precisa mais mexer na Ana");
    expect(second.pilot?.status).toBe("withdrawn");
    expect(readyGroups(second)).toEqual([]);
    await expect(confirm(c, first)).rejects.toThrow();
    expect(await rows(w.a)).toEqual(before);
  });

  it("a withdrawal that repeats the open request (same customer, same destination) is still a withdrawal, never a new proposal", async () => {
    const w = await world(), c = await open(w.a, [mainTurn, luna({ desistir: true, cliente: { mencao: "Ana" }, destino: to(weekday(6, "sexta"), at(15, "às 15h")) })]);
    const first = await say(c, MAIN), before = await rows(w.a);
    const second = await say(c, "Esquece aquela da Ana pra sexta às 15h");
    expect(second.pilot?.status).toBe("withdrawn");
    expect(second.pilot?.proposal).toBeNull();
    expect(readyGroups(second)).toEqual([]);
    await expect(confirm(c, first)).rejects.toThrow();
    expect(await rows(w.a)).toEqual(before);
  });

  it("an answer to a question of an earlier revision, or already closed, changes nothing; the current question binds", async () => {
    const a = await studio("A", ["Ana Quaresma", "Ana Bezerra", "Bento Ximenes"]);
    await book(a, "Ana Quaresma", a.carlos, a.limpeza, D(2), "10:00");
    await book(a, "Ana Bezerra", a.dalva, a.sobrancelha, D(3), "11:00");
    const c = await open(a, [luna({ cliente: { mencao: "Ana" }, destino: to(weekday(6, "sexta"), at(15, "15h")) }), luna({ destino: to(null, at(16, "16h")) })]);
    const before = await rows(a);
    const asked = await say(c, "Puxa a Ana pra sexta, 15h"), q1 = asked.pilot!.questions[0].questionId;
    const corrected = await say(c, "Aliás, 16h");
    expect(corrected.pilot!.revision).toBeGreaterThan(asked.pilot!.revision);
    expect(corrected.pilot).toMatchObject({ status: "pending", fields: { customer: { value: null } } });
    expect(corrected.pilot?.questions).toEqual([expect.objectContaining({ field: "customer", reason: "CUSTOMER_AMBIGUOUS" })]);
    const q2 = corrected.pilot!.questions[0].questionId;
    expect(q2).not.toBe(q1);
    more(c, luna({ tipo: "resposta", resposta_a: q1, cliente: { mencao: "Quaresma" } }));
    const late = await say(c, "A Quaresma");
    expect(late.pilot).toMatchObject({ revision: corrected.pilot!.revision, fields: { customer: { value: null, provenance: "unresolved" } } });
    expect(late.pilot?.questions.map(item => item.questionId)).toEqual([q2]);
    more(c, luna({ tipo: "resposta", resposta_a: q2, cliente: { mencao: "Quaresma" } }));
    const bound = await say(c, "A Quaresma, isso");
    expect(bound.pilot).toMatchObject({ status: "proposal_ready", fields: { customer: { value: a.people["Ana Quaresma"] }, time: { value: "16:00" }, date: { value: D(4) } } });
    more(c, luna({ tipo: "resposta", resposta_a: q2, cliente: { mencao: "Bezerra" } }));
    const closed = await say(c, "Não, a Bezerra");
    expect(closed.pilot).toMatchObject({ revision: bound.pilot!.revision, fields: { customer: { value: a.people["Ana Quaresma"] } } });
    expect(await rows(a)).toEqual(before);
  });

  it("the same clientTurnId again returns the stored reply: no second Luna call, no new revision", async () => {
    const w = await world(), c = await open(w.a, [mainTurn]), turn = randomUUID();
    const first = await say(c, MAIN, turn), again = await say(c, MAIN, turn);
    expect(c.model.requests).toHaveLength(1);
    expect(first.pilot?.turn).toMatchObject({ clientTurnId: turn, replayed: false });
    expect(again.pilot).toMatchObject({ planId: first.pilot!.planId, revision: first.pilot!.revision, proposal: first.pilot!.proposal,
      turn: { turnId: first.pilot!.turn.turnId, clientTurnId: turn, replayed: true } });
    expect(again.message).toBe(first.message);
    expect(readyGroups(again)).toHaveLength(1);
  });

  it("persisted conversation (027, local database only): a repeated clientTurnId is recorded once and answered without Luna", async () => {
    const w = await world(), c = await open(w.a, [mainTurn], new PostgresSessionStore()), turn = randomUUID();
    const first = await say(c, MAIN, turn), again = await say(c, MAIN, turn);
    expect(c.model.requests).toHaveLength(1);
    expect(again.pilot).toMatchObject({ revision: first.pilot!.revision, turn: { replayed: true } });
    const recorded = await withTenant(w.a.actor, tx => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SecretaryConversationEvent"
      WHERE "conversationId"=${c.sessionId}::uuid AND "clientTurnId"=${turn}::uuid`);
    expect(recorded[0].n).toBe(1);
  });

  it("a repeated Confirmar writes once (the same approval again, and through «confirmar tudo»)", async () => {
    const w = await world(), c = await open(w.a, [mainTurn]);
    const view = await say(c, MAIN), before = await rows(w.a);
    await confirm(c, view);
    const once = await rows(w.a);
    expectMoved(before, once, w.ana, { start: `${D(4)}T15:00`, end: `${D(4)}T15:50` });
    expect((await confirm(c, view)).pilot?.status).toBe("done");
    await c.secretary.confirmReadyGroups(w.a.actor, c.sessionId, [approvalOf(view)]);
    expect(await rows(w.a)).toEqual(once);
  });

  it("a Confirmar repeated after a lost reply finds the receipt of its proposal_ref first: done and written once, even past the proposal's expiry", async () => {
    const w = await world(), c = await open(w.a, [mainTurn]);
    const view = await say(c, MAIN), before = await rows(w.a), proposal = view.pilot!.proposal!;
    // The first Confirmar committed, but its reply never reached the screen (timeout after the commit).
    const receipt = await withTenant(w.a.actor, tx => confirmAppointmentCreate(tx, w.a.actor, { proposal_ref: proposal.proposalRef, draft_revision: proposal.draftRevision }));
    expect(receipt).toMatchObject({ outcome: "RESCHEDULED", duplicate: false });
    const committed = await rows(w.a);
    expectMoved(before, committed, w.ana, { start: `${D(4)}T15:00`, end: `${D(4)}T15:50` });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const retried = await confirm(c, view);
    expect(retried.pilot?.status).toBe("done");
    expect(retried.message).not.toContain(expiredProposalMessage);
    expect(await rows(w.a)).toEqual(committed);
  });

  it("a request partly out of scope asks before proposing only the possible part; nothing is written", async () => {
    const w = await world();
    const c = await open(w.a, [luna({ tipo: "misto", cliente: { mencao: "Ana" }, destino: to(weekday(6, "sexta"), at(15, "15h")),
      fora_do_escopo: [{ tipo: "cancelar", mencao: "desmarca o Bento de sexta cedo" }] })]);
    const before = await rows(w.a);
    const view = await say(c, "Muda a Ana pra sexta 15h e desmarca o Bento de sexta cedo");
    expect(readyGroups(view)).toEqual([]);
    expect(view.pilot?.status).toBe("pending");
    expect(view.pilot?.questions).toEqual([expect.objectContaining({ field: "scope", reason: "OUT_OF_SCOPE_PART" })]);
    expect(await rows(w.a)).toEqual(before);
  });

  it("a request wholly out of scope gets the clear answer and no effect", async () => {
    const w = await world();
    const c = await open(w.a, [luna({ tipo: "fora_do_escopo", fora_do_escopo: [{ tipo: "bloquear", mencao: "Reserva a quinta inteira do Carlos" }] })]);
    const before = await rows(w.a);
    const view = await say(c, "Reserva a quinta inteira do Carlos pra formação");
    expect(view.message).toContain(PILOT_OUT_OF_SCOPE_REPLY);
    expect(view.pilot?.status ?? null).toBeNull();
    expect(readyGroups(view)).toEqual([]);
    expect(c.model.requests).toHaveLength(1);
    expect(await rows(w.a)).toEqual(before);
  });

  it("an unreadable Luna answer after the format repair is the safe reply: nothing changes and the C4 is never called", async () => {
    const w = await world();
    const model = new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, { tipo: "remarcar" }), call(PILOT_RESCHEDULE_TOOL, { ...mainTurn, contexto: "sobra" }),
      call("select_capabilities", { turn: { mode: "CONVERSATION", response: "Resposta sintética da C4." } })]);
    const secretary = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
    const { sessionId } = await secretary.start(w.a.actor, "auto"), before = await rows(w.a);
    const view = await secretary.send(w.a.actor, { sessionId, message: MAIN, clientTurnId: randomUUID() });
    expect(view.message).toContain(PILOT_SAFE_REPLY);
    expect(model.requests.length).toBeGreaterThanOrEqual(1);
    expect(model.requests.length).toBeLessThanOrEqual(2);
    expect(readyGroups(view)).toEqual([]);
    expect(await rows(w.a)).toEqual(before);
  });

  // Final review E1/E2/E3/S7/S9: a write committed behind the session (its reply or save lost: the journal confirm of the plan's own proposal_ref
  // runs directly, as above) is found by that proposal's receipt before anything drops, withdraws or prepares it again; a replay never pairs an
  // old reply with live controls; a refused tap changes nothing; a tap counts as a turn.
  const commitBehind = (s: Studio, view: SecretaryView) =>
    withTenant(s.actor, tx => confirmAppointmentCreate(tx, s.actor, { proposal_ref: view.pilot!.proposal!.proposalRef, draft_revision: view.pilot!.proposal!.draftRevision }));
  const sessionOf = <T,>(c: Conversation) => (c.secretary as unknown as { sessions: Map<string, T> }).sessions.get(c.sessionId)!;
  const pilotOperation = (view: SecretaryView) => view.operations!.find(op => op.action_keys?.includes("a1"))!.operation_ref;

  it("E1: after a write behind the session, a message past the proposal's expiry, a correction or Descartar report it done, never «nada foi alterado»", async () => {
    for (const next of ["expired", "correction", "discard"] as const) {
      const w = await world(), c = await open(w.a, [mainTurn, luna({ destino: to(null, at(16, "às 16h")) })]);
      const view = await say(c, MAIN), before = await rows(w.a);
      await commitBehind(w.a, view);
      const committed = await rows(w.a);
      expectMoved(before, committed, w.ana, { start: `${D(4)}T15:00`, end: `${D(4)}T15:50` });
      if (next === "expired") vi.setSystemTime(Date.now() + 11 * 60_000);
      const after = next === "discard" ? await c.secretary.discardAction(w.a.actor, c.sessionId, { plan_ref: view.action_plan!.plan_ref, action_key: "a1" })
        : await say(c, next === "expired" ? "E então, ficou certo?" : "Melhor às 16h");
      expect(after.pilot?.status, next).toBe("done");
      expect(after.message, next).toContain("Remarcação gravada");
      expect(after.message, next).not.toContain("nada foi alterado");
      expect(c.model.requests, next).toHaveLength(1);
      expect((await confirm(c, view)).pilot?.status, next).toBe("done");
      expect(await rows(w.a), next).toEqual(committed);
    }
  });

  it("E1: a preparation on a draft the agenda already confirmed reports that write (never «Não consegui preparar»), and the plan is closed", async () => {
    const w = await world(), dated = (hora: PilotTempoHora) => luna({ cliente: { mencao: "Ana" },
      destino: to({ tipo: "data", dia: Number(D(4).slice(8, 10)), mes: Number(D(4).slice(5, 7)), mencao: "a data combinada" }, hora) });
    const c = await open(w.a, [dated(at(15, "às 15h")), luna({ destino: to(null, at(16, "às 16h")) })]);
    const view = await say(c, "Arrasta a Ana para a data combinada, às 15h");
    expect(view.pilot?.status).toBe("proposal_ready");
    await commitBehind(w.a, view);
    const committed = await rows(w.a);
    // The plan lost its proposal_ref (a save lost before this review could leave it so): only the agenda's own draft knows of the write.
    delete sessionOf<{ pilot: { plan: { action: { proposal?: unknown } } } }>(c).pilot.plan.action.proposal;
    const after = await say(c, "Melhor às 16h");
    expect(after.message).toContain(PILOT_ALREADY_WRITTEN);
    expect(after.message).not.toContain(PILOT_PREPARATION_FAILED);
    expect(after.pilot?.status).toBe("withdrawn");
    expect(await rows(w.a)).toEqual(committed);
  });

  it("E2: a Confirmar repeated after its write committed finds the receipt even after a reload projected the expiry (single and «confirmar tudo»)", async () => {
    for (const all of [false, true]) {
      const w = await world(), c = await open(w.a, [mainTurn], new PostgresSessionStore());
      const view = await say(c, MAIN);
      await commitBehind(w.a, view);
      const committed = await rows(w.a);
      vi.setSystemTime(Date.now() + 11 * 60_000);
      expect((await c.secretary.current(w.a.actor))?.pilot?.status).toBe("proposal_ready");
      const done = all ? await c.secretary.confirmReadyGroups(w.a.actor, c.sessionId, [approvalOf(view)]) : await confirm(c, view);
      expect(done.pilot?.status).toBe("done");
      if (all) expect(done.confirmation_batch?.executed).toEqual([approvalOf(view).group_key]);
      expect(await rows(w.a)).toEqual(committed);
    }
  });

  it("E3: a repeated clientTurnId after a correction answers with the current proposal, and a Confirmar from that view writes what it shows", async () => {
    const w = await world(), c = await open(w.a, [mainTurn, luna({ destino: to(null, at(16, "às 16h")) })]), turn = randomUUID();
    const first = await say(c, MAIN, turn), second = await say(c, "Melhor às 16h"), before = await rows(w.a);
    const again = await say(c, MAIN, turn);
    expect(c.model.requests).toHaveLength(2);
    expect(again.message).not.toBe(first.message);
    expect(again.message).toContain(formatLocal(`${D(4)}T16:00`));
    expect(again.pilot).toMatchObject({ revision: second.pilot!.revision, proposal: second.pilot!.proposal, turn: { clientTurnId: turn, replayed: true } });
    await confirm(c, again);
    expectMoved(before, await rows(w.a), w.ana, { start: `${D(4)}T16:00`, end: `${D(4)}T16:50` });
  });

  it("S7: a refused tap changes nothing: past the proposal's expiry a stale tap is refused and the Confirmar still reaches the expiry rule", async () => {
    const w = await world(), c = await open(w.a, [mainTurn]);
    const view = await say(c, MAIN), before = await rows(w.a);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await expect(c.secretary.selectAutomatic(w.a.actor, c.sessionId, pilotOperation(view), "q1/08:00")).rejects.toThrow("SELECTION_INVALID");
    const again = await confirm(c, view);
    expect(again.message).toContain(PILOT_PROPOSAL_EXPIRED);
    expect(again.pilot?.status).toBe("proposal_ready");
    expect(await rows(w.a)).toEqual(before);
  });

  it("S4/S9: a tap names its question and counts as a turn of the session (bounded)", async () => {
    const a = await studio("A", ["Ana Quaresma", "Ana Bezerra", "Bento Ximenes"]);
    await book(a, "Ana Quaresma", a.carlos, a.limpeza, D(2), "10:00");
    const c = await open(a, [luna({ cliente: { mencao: "Ana" }, destino: to(weekday(6, "sexta"), at(15, "15h")) })]);
    const asked = await say(c, "Puxa a Ana pra sexta, 15h"), question = asked.pilot!.questions[0], tap = pilotOptionRef(question.questionId, a.people["Ana Quaresma"]);
    const session = sessionOf<{ turns: number }>(c);
    session.turns = 20;
    await expect(c.secretary.selectAutomatic(a.actor, c.sessionId, pilotOperation(asked), tap)).rejects.toThrow("TURN_LIMIT");
    session.turns = 19;
    const ready = await c.secretary.selectAutomatic(a.actor, c.sessionId, pilotOperation(asked), tap);
    expect(ready.pilot).toMatchObject({ status: "proposal_ready", fields: { customer: { value: a.people["Ana Quaresma"] } } });
    expect(session.turns).toBe(20);
  });

  it("flag off: exactly as before (the C4 request, no pilot state, the input contract unchanged)", async () => {
    const w = await world(), before = await rows(w.a);
    const run = async (value: "false" | undefined) => {
      vi.stubEnv(FLAG, value);
      const model = new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "CONVERSATION", response: "Resposta sintética da C4." } })]);
      const secretary = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
      const { sessionId } = await secretary.start(w.a.actor, "auto");
      await expect(secretary.send(w.a.actor, { sessionId, message: MAIN, clientTurnId: randomUUID() })).rejects.toThrow();
      const view = await secretary.send(w.a.actor, { sessionId, message: MAIN });
      const stored = (secretary as unknown as { sessions: Map<string, object> }).sessions.get(sessionId) ?? {};
      return { view, stored, requests: model.requests };
    };
    const off = await run("false"), unset = await run(undefined);
    for (const result of [off, unset]) {
      expect("pilot" in result.view).toBe(false);
      expect(Object.keys(result.stored).filter(key => /pilot/i.test(key))).toEqual([]);
      expect(result.requests).toHaveLength(1);
      const names = result.requests[0].tools.map(tool => "name" in tool ? tool.name : "");
      expect(names).toContain("select_capabilities");
      expect(names).not.toContain(PILOT_RESCHEDULE_TOOL);
    }
    expect(body(off.requests[0])).toBe(body(unset.requests[0]));
    expect(off.view.message).toBe(unset.view.message);
    expect(await rows(w.a)).toEqual(before);
  });
});
