import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { AGENT_DEPENDENCY_FLAGS } from "../../../packages/salon-secretary/src/agent-context";
import { PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { prisma } from "../prisma";
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { pilotTenantReader } from "../secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc, weekdayOfDateKey } from "../time";
import { e2bDays, e2bSameClock } from "../../test/secretary-pilot-e2b";
import { e2b2Luna, e2b2Pro, e2b2To, E2B2_REASONS, type E2b2Interpretation, type E2b2Professional } from "../../test/secretary-pilot-e2b2";

/** Reschedule pilot, completion of E2-B on the local disposable PostgreSQL (owner requirements 2 and 4), written BEFORE the fix: through
 * SalonSecretary with SALON_SECRETARY_PILOT_RESCHEDULE=true only when RUN_SERVICE_MVP_INTEGRATION=1 and the MVP database preflight passes
 * (127.0.0.1:55441/everflair_service_mvp), with a scripted Luna (no network, no paid model).
 *  - GAP 2.a: "outro" with two free members tied on the fewest appointments asks PROFESSIONAL_TIE with both real records and writes nothing; the
 *    owner's tap binds and the Confirmar moves exactly that row to the tapped member. TWIN: one of them busier that day → the other, proposed at once.
 *  - GAP 2.b: "outro" with a typed exclusion never gives the excluded member (the one left is proposed and written).
 *  - GAP 4.a: the tenant reader returns the salon's whole active catalog (or refuses), never the first 400 in silence; the request of a message
 *    carries every name of it (or the message fails safely), so a needed service is never out of Luna's sight.
 * The clock is frozen at a Monday 08:00 in São Paulo a few days ahead. Synthetic bamboo-massage studio, invented names; another studio with the
 * same names must stay untouched. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const TZ = "America/Sao_Paulo", FLAG = "SALON_SECRETARY_PILOT_RESCHEDULE";
let admin: PrismaClient;
let D0 = "";
const D = (offset: number) => addCalendarDays(D0, offset);
type Svc = { id: string; name: string; durationMin: number; priceCents: number };

async function studio(label: string, customers: string[], extraServices = 0) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: `Gestão ${label}`, email: `e2b2-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Estúdio Taquara ${label}`, slug: `e2b2-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: TZ, currency: "BRL",
      minBookingLeadMinutes: 0, bufferMinutes: 0 } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    if (extraServices) await tx.service.createMany({ data: Array.from({ length: extraServices }, (_, index) => ({ salonId, name: `Ritual de bambu ${String(index).padStart(3, "0")}`, durationMin: 30, priceCents: 4000 })) });
    // Sorted by name, the studio's own service comes last ("Z…"), past any cut of the first 400.
    const bambu: Svc = await tx.service.create({ data: { salonId, name: "Zona reflexa com bambu morno", durationMin: 60, priceCents: 13000 } });
    const pro = async (name: string) => {
      const user = await tx.user.create({ data: { name, email: `e2b2-pro-${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      await tx.professionalService.create({ data: { serviceId: bambu.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      return professional.id;
    };
    const herminia = await pro("Hermínia Ubajara"), isaltino = await pro("Isaltino Caparaó"), jovelina = await pro("Jovelina Itatiaia");
    const people: Record<string, string> = {};
    for (const [index, name] of customers.entries()) people[name] = (await tx.clientProfile.create({ data: { salonId, name, phone: `1196411${String(index).padStart(4, "0")}` } })).id;
    return { salonId, actor: { salonId, userId: owner.id }, bambu, herminia, isaltino, jovelina, people };
  });
}
type Studio = Awaited<ReturnType<typeof studio>>;
async function book(s: Studio, customer: string, professionalId: string, date: string, clock: string) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    const startAt = localDateTimeToUtc(`${date}T${clock}`, TZ), endAt = new Date(+startAt + s.bambu.durationMin * 60_000);
    return (await tx.appointment.create({ data: { salonId: s.salonId, clientId: s.people[customer], professionalId, serviceId: s.bambu.id, startAt, endAt, timezone: TZ,
      priceCents: s.bambu.priceCents, status: "CONFIRMED", serviceItems: { create: [{ serviceId: s.bambu.id, position: 0, serviceName: s.bambu.name,
        durationMin: s.bambu.durationMin, priceCents: s.bambu.priceCents }] } } })).id;
  });
}
async function rows(s: Studio) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${s.salonId},true)`;
    return { appointments: await tx.appointment.findMany({ where: { salonId: s.salonId }, orderBy: { id: "asc" } }),
      customers: await tx.clientProfile.findMany({ where: { salonId: s.salonId }, orderBy: { id: "asc" } }) };
  });
}
async function open(s: Studio, frames: E2b2Interpretation[]) {
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
  const secretary = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await secretary.start(s.actor, "auto");
  return { s, model, secretary, sessionId };
}
type Conversation = Awaited<ReturnType<typeof open>>;
const say = (c: Conversation, message: string) => c.secretary.send(c.s.actor, { sessionId: c.sessionId, message, clientTurnId: randomUUID() });
const readyGroups = (view: SecretaryView) => view.action_plan?.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION") ?? [];
function confirm(c: Conversation, view: SecretaryView) {
  const plan = view.action_plan, group = readyGroups(view)[0];
  if (!plan || !group) throw Error("NO_READY_GROUP");
  return c.secretary.confirmActionPlanGroup(c.s.actor, c.sessionId, { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint });
}
const NAMES = ["Leopoldina Caxangá", "Nestório Piracanjuba"];
/** Leopoldina: D(2) 10:00 with Hermínia; moved one day later, same clock, to someone other than Hermínia. */
const moveLeopoldina = (profissional: E2b2Professional) => e2b2Luna({ cliente: { mencao: "Leopoldina" }, destino: e2b2To(e2bDays(1, ["origem"], "um dia depois"), e2bSameClock("na mesma hora"), profissional) });

suite("Reschedule pilot, E2-B completion, through SalonSecretary on the local PostgreSQL", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("PILOT_E2B2_PREFLIGHT", await assertMvpTestDatabase(admin));
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

  it("GAP 2.a TWINS: Isaltino busier that day → Jovelina proposed at once; a tie (0 and 0) → PROFESSIONAL_TIE with both, nothing written; the tap binds and the Confirmar writes exactly that row", async () => {
    const busier = await studio("A", NAMES);
    await book(busier, "Leopoldina Caxangá", busier.herminia, D(2), "10:00");
    await book(busier, "Nestório Piracanjuba", busier.isaltino, D(3), "14:00");
    const quick = await open(busier, [moveLeopoldina(e2b2Pro("outro"))]);
    const ready = await say(quick, "A Leopoldina vai um dia depois, na mesma hora, com outra pessoa");
    expect(ready.pilot).toMatchObject({ status: "proposal_ready", fields: { date: { value: D(3) }, time: { value: "10:00" }, professional: { value: busier.jovelina, provenance: "derived" } } });

    const a = await studio("A", NAMES), b = await studio("B", NAMES);
    const id = await book(a, "Leopoldina Caxangá", a.herminia, D(2), "10:00");
    await book(b, "Leopoldina Caxangá", b.herminia, D(2), "10:00");
    const c = await open(a, [moveLeopoldina(e2b2Pro("outro"))]);
    const before = { a: await rows(a), b: await rows(b) };
    const asked = await say(c, "A Leopoldina vai um dia depois, na mesma hora, com outra pessoa");
    expect(asked.pilot?.questions).toEqual([expect.objectContaining({ field: "professional", reason: E2B2_REASONS.tie })]);
    expect(asked.pilot?.questions[0].options?.map(option => option.id).sort()).toEqual([a.isaltino, a.jovelina].sort());
    expect(readyGroups(asked)).toEqual([]);
    expect({ a: await rows(a), b: await rows(b) }, "nothing written before the owner chooses").toEqual(before);
    const tapped = await c.secretary.selectAutomatic(a.actor, c.sessionId, asked.operations![0].operation_ref, a.jovelina);
    expect(tapped.pilot).toMatchObject({ status: "proposal_ready", fields: { professional: { value: a.jovelina } } });
    expect((await confirm(c, tapped)).pilot?.status).toBe("done");
    const after = { a: await rows(a), b: await rows(b) };
    const was = before.a.appointments.find(row => row.id === id)!, now = after.a.appointments.find(row => row.id === id)!;
    expect(now).toMatchObject({ professionalId: a.jovelina, startAt: localDateTimeToUtc(`${D(3)}T10:00`, TZ), version: was.version + 1 });
    expect(after.a.appointments.filter(row => row.id !== id)).toEqual(before.a.appointments.filter(row => row.id !== id));
    expect(after.b).toEqual(before.b);
  });

  it("GAP 2.b: 'outro' excluding Isaltino (typed list) gives Jovelina, written exactly; the excluded member is never proposed", async () => {
    const a = await studio("A", NAMES);
    const id = await book(a, "Leopoldina Caxangá", a.herminia, D(2), "10:00");
    const c = await open(a, [moveLeopoldina(e2b2Pro("outro", ["Isaltino"]))]);
    const ready = await say(c, "A Leopoldina vai um dia depois, na mesma hora, com outra pessoa, menos o Isaltino");
    expect(ready.pilot).toMatchObject({ status: "proposal_ready", fields: { professional: { value: a.jovelina, provenance: "derived" } } });
    expect((await confirm(c, ready)).pilot?.status).toBe("done");
    expect((await rows(a)).appointments.find(row => row.id === id)).toMatchObject({ professionalId: a.jovelina, startAt: localDateTimeToUtc(`${D(3)}T10:00`, TZ) });
  });

  it("GAP 4.a: 401 active services — the tenant reader returns all of them (or refuses), never the first 400; the message's request carries the studio's own service (or fails safely)", async () => {
    const a = await studio("A", NAMES, 400);
    const read = await pilotTenantReader(a.actor).catalog().then(list => list.map(item => item.name), (error: unknown) => error);
    expect(read instanceof Error || (Array.isArray(read) && read.length === 401 && read.includes(a.bambu.name)), "never a silent cut of the catalog").toBe(true);
    await book(a, "Leopoldina Caxangá", a.herminia, D(2), "10:00");
    const c = await open(a, [moveLeopoldina(e2b2Pro(null))]);
    const view = await say(c, "A Leopoldina vai um dia depois, na mesma hora");
    const sent = c.model.requests.map(request => (request.input as { role: string; content: string }[]).filter(item => item.role === "system").map(item => item.content).join("\n"));
    expect(sent.every(text => text.includes(JSON.stringify(a.bambu.name))), "the needed service is in every request sent").toBe(true);
    // Nothing sent: the message failed safely (the reply says nothing changed), never resolved on a cut catalog.
    if (!sent.length) expect(view.message).toContain("nada foi alterado");
  });
});
