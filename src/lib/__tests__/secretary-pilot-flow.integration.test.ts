import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { AGENT_DEPENDENCY_FLAGS } from "../../../packages/salon-secretary/src/agent-context";
import { PILOT_RESCHEDULE_TOOL, type PilotInterpretation, type PilotTempoDia, type PilotTempoHora, type PilotWeekday } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { prisma } from "../prisma";
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { PostgresSessionStore, type SecretarySessionStore } from "../secretary-session-store";
import { PILOT_CUSTOMER_NOTICE } from "../secretary-pilot";
import { pilotTenantReader } from "../secretary-pilot-reader";
import { ScriptedServicesModel, appendScriptedResponses, call } from "../../test/scripted-services-model";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc, weekdayOfDateKey } from "../time";

/** Reschedule pilot, integration requirements of E1 (docs/c5-spike/12-piloto-remarcacao.md §3-§5): what the screen and the practice runner read.
 * Every open question is a missing field of the plan's ONE action, by the runner's names (customer_ref, appointment_ref, date, time,
 * target_professional_ref, scope); a ready proposal is the READY_FOR_CONFIRMATION group; decision 27 (a weekday read two ways) and decision 18
 * (a bare hour inside both halves of the day's hours) are asked and then bound by the answer; "qualquer" (decision 15) names who was chosen; a
 * conversation saved in the local store (027) runs question → answer → proposal → Confirmar across loads; no card or slot button of the agenda
 * adapter is published or selectable. Local disposable PostgreSQL only (RUN_SERVICE_MVP_INTEGRATION=1 and the MVP preflight), scripted Luna, no
 * network. Invented names (an esthetics studio) and sentences. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const TZ = "America/Sao_Paulo", FLAG = "SALON_SECRETARY_PILOT_RESCHEDULE";
let admin: PrismaClient;
let D0 = "";
const D = (offset: number) => addCalendarDays(D0, offset);
type Svc = { id: string; name: string; durationMin: number; priceCents: number };

async function studio(customers: string[], team: { name: string; from: number; to: number }[]) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: "Gestão Ipê", email: `pilot-flow-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: "Estúdio Ipê Amarelo", slug: `pilot-flow-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: TZ, currency: "BRL",
      minBookingLeadMinutes: 0, bufferMinutes: 0 } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const peeling = await tx.service.create({ data: { salonId, name: "Peeling de diamante", durationMin: 50, priceCents: 15000 } });
    const pros: Record<string, string> = {};
    for (const member of team) {
      const user = await tx.user.create({ data: { name: member.name, email: `pilot-flow-pro-${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      await tx.professionalService.create({ data: { serviceId: peeling.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: member.from, endMinutes: member.to })) });
      pros[member.name] = professional.id;
    }
    const people: Record<string, string> = {};
    for (const [index, name] of customers.entries()) people[name] = (await tx.clientProfile.create({ data: { salonId, name, phone: `1196000${String(index).padStart(4, "0")}` } })).id;
    return { salonId, actor: { salonId, userId: owner.id }, peeling, pros, people };
  });
}
type Studio = Awaited<ReturnType<typeof studio>>;
async function book(s: Studio, customer: string, professional: string, date: string, clock: string, service: Svc = s.peeling) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    const startAt = localDateTimeToUtc(`${date}T${clock}`, TZ), endAt = new Date(+startAt + service.durationMin * 60_000);
    return (await tx.appointment.create({ data: { salonId: s.salonId, clientId: s.people[customer], professionalId: s.pros[professional], serviceId: service.id, startAt, endAt, timezone: TZ,
      priceCents: service.priceCents, status: "CONFIRMED", serviceItems: { create: [{ serviceId: service.id, position: 0, serviceName: service.name, durationMin: service.durationMin,
        priceCents: service.priceCents }] } } })).id;
  });
}
async function appointment(s: Studio, id: string) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    return tx.appointment.findUniqueOrThrow({ where: { id }, select: { startAt: true, professionalId: true, version: true } });
  });
}

const NO_ORIGIN: PilotInterpretation["origem"] = { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null };
const luna = (over: Partial<PilotInterpretation> = {}): PilotInterpretation => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null, cliente: { mencao: null }, origem: NO_ORIGIN,
  destino: { dia: null, hora: null, profissional: { modo: null, mencao: null, excluidos: [] } }, observacoes: [], fora_do_escopo: [], ...over });
const answer = (questionId: string, over: Partial<PilotInterpretation>) => luna({ tipo: "resposta", resposta_a: questionId, ...over });
const weekday = (dia_semana: PilotWeekday, mencao: string): PilotTempoDia => ({ tipo: "dia_semana", dia_semana, qualificador: null, mencao });
const at = (hora: number, mencao: string): PilotTempoHora => ({ tipo: "relogio", hora, minuto: 0, periodo: null, mencao });
// E2-B completion (§11.4) contract migration: the wire's professional carries `excluidos` (who must not attend); frames here get [] (shape only).
const to = (dia: PilotTempoDia | null, hora: PilotTempoHora | null, profissional: Omit<PilotInterpretation["destino"]["profissional"], "excluidos"> & { excluidos?: string[] } = { modo: null, mencao: null }) =>
  ({ dia, hora, profissional: { excluidos: [] as string[], ...profissional } });

async function open(s: Studio, frames: PilotInterpretation[], store?: SecretarySessionStore) {
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
  const secretary = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true }, () => store);
  const { sessionId } = await secretary.start(s.actor, "auto");
  return { s, model, secretary, sessionId };
}
type Conversation = Awaited<ReturnType<typeof open>>;
const say = (c: Conversation, message: string, next?: PilotInterpretation) => {
  if (next) appendScriptedResponses(c.model, [call(PILOT_RESCHEDULE_TOOL, next)]);
  return c.secretary.send(c.s.actor, { sessionId: c.sessionId, message, clientTurnId: randomUUID() });
};
const missing = (view: SecretaryView) => view.action_plan?.actions.map(action => action.missing_fields);
const readyGroups = (view: SecretaryView) => view.action_plan?.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION") ?? [];
const confirm = (c: Conversation, view: SecretaryView) => {
  const plan = view.action_plan!, group = readyGroups(view)[0];
  return c.secretary.confirmActionPlanGroup(c.s.actor, c.sessionId, { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint });
};
const question = (view: SecretaryView) => view.pilot!.questions[0];

suite("Reschedule pilot: what the screen and the runner read (flag SALON_SECRETARY_PILOT_RESCHEDULE, local PostgreSQL)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("PILOT_FLOW_PREFLIGHT", await assertMvpTestDatabase(admin));
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

  it("each question is the action's missing field (customer_ref → appointment_ref → date → time), then the READY group; the other customer never reaches Luna", async () => {
    const s = await studio(["Odete Vasconcelos", "Odete Ramalho"], [{ name: "Ícaro Monteiro", from: 480, to: 1260 }]);
    await book(s, "Odete Vasconcelos", "Ícaro Monteiro", D(3), "10:00");
    const moved = await book(s, "Odete Vasconcelos", "Ícaro Monteiro", D(7), "11:00");
    const c = await open(s, [luna({ cliente: { mencao: "Odete" }, destino: to(weekday("sexta", "sexta"), at(8, "às 8")) })]);
    const first = await say(c, "Empurra a Odete pra sexta às 8");
    expect(missing(first)).toEqual([["customer_ref"]]);
    expect(question(first)).toMatchObject({ field: "customer", reason: "CUSTOMER_AMBIGUOUS" });
    const second = await say(c, "Vasconcelos", answer(question(first).questionId, { cliente: { mencao: "Vasconcelos" } }));
    expect(missing(second)).toEqual([["appointment_ref"]]);
    expect(question(second)).toMatchObject({ field: "appointment", reason: "APPOINTMENT_SEVERAL" });
    expect(question(second).options?.map(option => option.id)).toContain(moved);
    const third = await say(c, "a de segunda", answer(question(second).questionId, { origem: { ...NO_ORIGIN, dia: weekday("segunda", "a de segunda") } }));
    expect(missing(third)).toEqual([["date"]]);
    expect(question(third)).toMatchObject({ field: "date", reason: "DATE_TWO_READINGS" });
    expect(question(third).options?.map(option => option.id)).toEqual([D(4), D(11)]);
    const day = D(11);
    const fourth = await say(c, `dia ${Number(day.slice(8))}`, answer(question(third).questionId,
      { destino: to({ tipo: "data", dia: Number(day.slice(8)), mes: Number(day.slice(5, 7)), mencao: `dia ${Number(day.slice(8))}` }, null) }));
    expect(missing(fourth)).toEqual([["time"]]);
    expect(question(fourth)).toMatchObject({ field: "time", reason: "TIME_TWO_READINGS", options: [{ id: "08:00" }, { id: "20:00" }] });
    const ready = await say(c, "20h", answer(question(fourth).questionId, { destino: to(null, at(20, "20h")) }));
    expect(missing(ready)).toEqual([[]]);
    expect(readyGroups(ready)).toHaveLength(1);
    expect(ready.pilot).toMatchObject({ status: "proposal_ready", fields: { appointment: { value: moved }, date: { value: day, provenance: "explicit" }, time: { value: "20:00", provenance: "explicit" } } });
    expect(ready.message).toContain(PILOT_CUSTOMER_NOTICE);
    for (const request of c.model.requests) expect(JSON.stringify(request.input)).not.toContain("Ramalho");
    expect((await confirm(c, ready)).pilot?.status).toBe("done");
    expect(await appointment(s, moved)).toMatchObject({ startAt: localDateTimeToUtc(`${day}T20:00`, TZ), professionalId: s.pros["Ícaro Monteiro"] });
  });

  it("a named professional shared by two people asks target_professional_ref; the answer binds and the proposal shows who leaves and who attends", async () => {
    const s = await studio(["Leonora Bastos"], [{ name: "Ícaro Monteiro", from: 540, to: 1080 }, { name: "Ícaro Pestana", from: 540, to: 1080 }, { name: "Jurema Saldanha", from: 540, to: 1080 }]);
    const id = await book(s, "Leonora Bastos", "Jurema Saldanha", D(2), "10:00");
    const c = await open(s, [luna({ cliente: { mencao: "Leonora" }, destino: to(null, { tipo: "mesmo_da_origem", mencao: "mesmo horário" }, { modo: "nomeado", mencao: "Ícaro" }) })]);
    const asked = await say(c, "Realoca a Leonora com o Ícaro conservando o horário");
    expect(missing(asked)).toEqual([["target_professional_ref"]]);
    expect(question(asked)).toMatchObject({ field: "professional", reason: "PROFESSIONAL_AMBIGUOUS" });
    const ready = await say(c, "o Pestana", answer(question(asked).questionId, { destino: to(null, null, { modo: "nomeado", mencao: "Pestana" }) }));
    expect(readyGroups(ready)).toHaveLength(1);
    expect(ready.pilot?.fields).toMatchObject({ professional: { value: s.pros["Ícaro Pestana"], provenance: "explicit" }, time: { value: "10:00", provenance: "inherited" } });
    expect(ready.message).toContain("Jurema Saldanha → Ícaro Pestana");
    await confirm(c, ready);
    expect(await appointment(s, id)).toMatchObject({ startAt: localDateTimeToUtc(`${D(2)}T10:00`, TZ), professionalId: s.pros["Ícaro Pestana"] });
  });

  it("'qualquer' (decision 15) picks who performs the service and is free, and the proposal says who was chosen", async () => {
    const s = await studio(["Leonora Bastos", "Teobaldo Viana"], [{ name: "Ícaro Monteiro", from: 540, to: 1080 }, { name: "Jurema Saldanha", from: 540, to: 1080 }]);
    const id = await book(s, "Leonora Bastos", "Ícaro Monteiro", D(2), "10:00");
    await book(s, "Teobaldo Viana", "Ícaro Monteiro", D(4), "15:00");
    const c = await open(s, [luna({ cliente: { mencao: "Leonora" }, destino: to(weekday("sexta", "sexta"), at(15, "15h"), { modo: "qualquer", mencao: "com quem estiver livre" }) })]);
    const ready = await say(c, "Leonora na sexta 15h com quem estiver livre");
    expect(ready.pilot?.fields).toMatchObject({ professional: { value: s.pros["Jurema Saldanha"], provenance: "derived" } });
    expect(ready.message).toContain("Escolhi Jurema Saldanha");
    await confirm(c, ready);
    expect(await appointment(s, id)).toMatchObject({ startAt: localDateTimeToUtc(`${D(4)}T15:00`, TZ), professionalId: s.pros["Jurema Saldanha"] });
  });

  it("the scope question is the missing field 'scope'; the owner's yes prepares only the reschedule", async () => {
    const s = await studio(["Leonora Bastos"], [{ name: "Ícaro Monteiro", from: 540, to: 1080 }]);
    const id = await book(s, "Leonora Bastos", "Ícaro Monteiro", D(2), "10:00");
    const c = await open(s, [luna({ tipo: "misto", cliente: { mencao: "Leonora" }, destino: to(weekday("quinta", "quinta"), at(16, "16h")),
      fora_do_escopo: [{ tipo: "mensagem", pedido: "manda um recado pra ela" }] })]);
    const asked = await say(c, "Leonora pra quinta 16h e manda um recado pra ela");
    expect(missing(asked)).toEqual([["scope"]]);
    const ready = await say(c, "pode ser só isso", answer(question(asked).questionId, { aceita_parcial: true }));
    expect(readyGroups(ready)).toHaveLength(1);
    await confirm(c, ready);
    expect(await appointment(s, id)).toMatchObject({ startAt: localDateTimeToUtc(`${D(3)}T16:00`, TZ) });
  });

  it("a slot taken publishes no card or slot button of the agenda adapter, and neither can be selected", async () => {
    const s = await studio(["Leonora Bastos", "Teobaldo Viana"], [{ name: "Ícaro Monteiro", from: 540, to: 1080 }]);
    await book(s, "Leonora Bastos", "Ícaro Monteiro", D(2), "10:00");
    await book(s, "Teobaldo Viana", "Ícaro Monteiro", D(4), "15:00");
    const c = await open(s, [luna({ cliente: { mencao: "Leonora" }, destino: to(weekday("sexta", "sexta"), at(15, "15h")) })]);
    const asked = await say(c, "Leonora pra sexta 15h");
    expect(missing(asked)).toEqual([["time"]]);
    expect(question(asked)).toMatchObject({ reason: "SLOT_UNAVAILABLE" });
    const operation = asked.operations![0];
    expect(operation.state.options ?? []).toEqual([]);
    expect(operation.state.scheduling?.candidates).toBeUndefined();
    await expect(c.secretary.selectOption(s.actor, c.sessionId, { operation_ref: operation.operation_ref, option_id: "opt_1" })).rejects.toThrow("OPTION_UNAVAILABLE");
    await expect(c.secretary.selectAutomatic(s.actor, c.sessionId, operation.operation_ref, "qualquer")).rejects.toThrow("SELECTION_INVALID");
  });

  it("a conversation in the local store (027) runs question → answer → proposal → Confirmar across loads", async () => {
    const s = await studio(["Odete Vasconcelos", "Odete Ramalho"], [{ name: "Ícaro Monteiro", from: 540, to: 1080 }]);
    const id = await book(s, "Odete Vasconcelos", "Ícaro Monteiro", D(2), "10:00");
    const c = await open(s, [luna({ cliente: { mencao: "Odete" }, destino: to(weekday("sexta", "sexta"), at(11, "11h")) })], new PostgresSessionStore());
    const asked = await say(c, "Odete pra sexta 11h");
    expect(missing(asked)).toEqual([["customer_ref"]]);
    const ready = await say(c, "a Vasconcelos", answer(question(asked).questionId, { cliente: { mencao: "Vasconcelos" } }));
    expect(readyGroups(ready)).toHaveLength(1);
    expect((await confirm(c, ready)).pilot?.status).toBe("done");
    expect(await appointment(s, id)).toMatchObject({ startAt: localDateTimeToUtc(`${D(4)}T11:00`, TZ) });
  });

  it("a tap on an option of the pilot's question answers it like the words would (review M12); anything else stays refused", async () => {
    const s = await studio(["Leonora Bastos"], [{ name: "Ícaro Monteiro", from: 540, to: 1080 }, { name: "Ícaro Pestana", from: 540, to: 1080 }, { name: "Jurema Saldanha", from: 540, to: 1080 }]);
    const id = await book(s, "Leonora Bastos", "Jurema Saldanha", D(2), "10:00");
    const c = await open(s, [luna({ cliente: { mencao: "Leonora" }, destino: to(null, { tipo: "mesmo_da_origem", mencao: "mesmo horário" }, { modo: "nomeado", mencao: "Ícaro" }) })]);
    const asked = await say(c, "Realoca a Leonora com o Ícaro conservando o horário");
    const options = question(asked).options ?? [], pestana = options.find(option => option.label === "Ícaro Pestana");
    expect(options.map(option => option.label).sort()).toEqual(["Ícaro Monteiro", "Ícaro Pestana"]);
    const operation = asked.operations![0].operation_ref;
    await expect(c.secretary.selectAutomatic(s.actor, c.sessionId, randomUUID(), pestana!.id)).rejects.toThrow();
    const ready = await c.secretary.selectAutomatic(s.actor, c.sessionId, operation, pestana!.id);
    expect(readyGroups(ready)).toHaveLength(1);
    expect(ready.pilot?.fields).toMatchObject({ professional: { value: s.pros["Ícaro Pestana"], provenance: "explicit" } });
    expect(c.model.requests).toHaveLength(1);
    await expect(c.secretary.selectAutomatic(s.actor, c.sessionId, operation, pestana!.id)).rejects.toThrow("SELECTION_INVALID");
    await confirm(c, ready);
    expect(await appointment(s, id)).toMatchObject({ professionalId: s.pros["Ícaro Pestana"] });
  });

  it("the tenant reader: whole name words (a full name among namesakes), a dependent's appointment marked as such, rows in the salon's timezone", async () => {
    const s = await studio(["Ana Quaresma", "Ana Bezerra", "Mariana Quaresmeira"], [{ name: "Ícaro Monteiro", from: 540, to: 1080 }]);
    const reader = pilotTenantReader(s.actor), names = async (mention: string) => (await reader.customers(mention)).map(row => row.name).sort();
    expect(await names("Ana Quaresma")).toEqual(["Ana Quaresma"]);
    expect(await names("ana")).toEqual(["Ana Bezerra", "Ana Quaresma"]);
    expect(await names("Ana Lua")).toEqual(["Ana Bezerra", "Ana Quaresma"]);
    const own = await book(s, "Ana Bezerra", "Ícaro Monteiro", D(2), "10:00"), child = await book(s, "Ana Bezerra", "Ícaro Monteiro", D(3), "11:00");
    await admin.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
      const dependent = await tx.clientDependent.create({ data: { salonId: s.salonId, clientId: s.people["Ana Bezerra"], name: "Caçula", relationship: "FILHO" } });
      await tx.appointment.update({ where: { id: child }, data: { dependentId: dependent.id, dependentName: "Caçula" } });
      await tx.appointment.update({ where: { id: own }, data: { timezone: "America/Manaus" } });
    });
    const rows = await reader.appointmentsOf(s.people["Ana Bezerra"], `${D(0)}T00:00`);
    expect(rows.map(row => [row.id, row.startLocal.slice(11, 16), row.dependentName ?? null])).toEqual([[own, "10:00", null], [child, "11:00", "Caçula"]]);
  });
});
