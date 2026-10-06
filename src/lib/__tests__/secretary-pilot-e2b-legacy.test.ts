import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { handlePilotMessage, type PilotHost, type PilotResolvedChange, type PilotSessionState } from "../secretary-pilot";
import type { PilotPerson, PilotProfessionalRow, PilotServiceRow } from "../secretary-pilot-resolver";
import { parseStoredAggregate, storedSession, STORED_AGGREGATE_SCHEMA } from "../secretary-session-state";
import { booked, clockAt, everyDay, memoryReader } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bClock, e2bLuna, e2bOrigin, e2bTo, e2bWeekday, e2aStoredOriginDays, e2aStoredOriginMinutes, e2aStoredToday, type E2bInterpretation } from "../../test/secretary-pilot-e2b";

/** Reschedule pilot E2-B, a conversation saved under the E2-A contract (docs/c5-spike/12-piloto-remarcacao.md §11.1 "Estado antigo", only in the
 * local database): the loader CONVERTS its pending operators, never drops them — relativo_hoje → deslocamento anchored on hoje, origem_mais_dias
 * → anchored on origem (days), origem_mais_minutos → clock deslocamento anchored on origem. The plan, replies, proofs and the turn anchors stay as
 * saved, no reset mark is set, and the next turn resolves the converted operator to the very day E2-A would have (the anchor "hoje" is still the
 * received_at of the turn that said it). An E1-shaped state (numbered weekday) is still dropped with the reset mark; anything else fails closed.
 * received_at is Thursday 2031-03-13, 09:00 in São Paulo. Invented names; no network, database or model. */
const ventosa: PilotServiceRow = { id: "srv-ventosa", name: "Ventosaterapia", durationMin: 40, priceCents: 8000 };
const herculano: PilotProfessionalRow = { id: "pro-herculano", name: "Herculano Paraná", serviceIds: [ventosa.id] };
const urbano: PilotProfessionalRow = { id: "pro-urbano", name: "Urbano Tocantins", serviceIds: [ventosa.id] };
const teobaldina: PilotPerson = { id: "cli-teobaldina", name: "Teobaldina Caiçara" };
const FRI = "2031-03-14", SAT = "2031-03-15", WED = "2031-03-19";
const ID = "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b02";
/** Teobaldina: Saturday 10:00 (Herculano) and Wednesday 11:00 (Urbano). */
const base = () => ({ customers: [teobaldina], team: [herculano, urbano], catalog: [ventosa],
  hours: { [herculano.id]: everyDay(["08:00", "20:00"]), [urbano.id]: everyDay(["08:00", "20:00"]) },
  appointments: [booked("apt-teo-sat", teobaldina, herculano, ventosa, SAT, "10:00"), booked("apt-teo-wed", teobaldina, urbano, ventosa, WED, "11:00")] });
function fake(frames: E2bInterpretation[]) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [];
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base());
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-e2b-legacy", userId: "user-e2b-legacy" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => clockAt("2031-03-13T12:00:00.000Z"),
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async () => undefined,
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-teo-sat", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, model };
}
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: ID, message });
const aggregate = (pilot: unknown) => ({ schema: STORED_AGGREGATE_SCHEMA, root: ID, sessions: [{ id: ID, skill: "auto", expires: 1, turns: 1, cancelled: false, pilot }] });
const loadedPilot = (pilot: unknown) => (parseStoredAggregate(aggregate(structuredClone(pilot))).sessions[0] as { pilot: PilotSessionState & Record<string, unknown> }).pilot;
/** The first turn of every case: two appointments, so the appointment is asked (q1) and the operators stay pending. */
const ASK = e2bLuna({ cliente: { mencao: "Teobaldina" }, destino: e2bTo(e2bWeekday("domingo", "pro domingo"), e2bClock(15, "às 15h")) });
/** A state saved after the first turn, with its pending destination replaced by stored E2-A operators. */
async function savedWith(destino: Record<string, unknown>, origemDia: unknown = null) {
  const f = fake([ASK]);
  expect((await send(f, "A Teobaldina vai pro domingo às 15h")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
  const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState & Record<string, unknown>;
  const pending = saved.pending as unknown as { origem: Record<string, unknown>; destino: Record<string, unknown> };
  Object.assign(pending.destino, destino);
  if (origemDia) pending.origem.dia = origemDia;
  return saved;
}

describe("E2-B: a pilot state saved under the E2-A contract is converted on load, never dropped", () => {
  it("relativo_hoje → a day offset anchored on hoje; origem_mais_dias → anchored on origem; origem_mais_minutos → a clock offset anchored on origem", async () => {
    const saved = await savedWith({ dia: e2aStoredToday(2, "depois de amanhã"), hora: e2aStoredOriginMinutes(150, "cento e cinquenta minutos adiante") }, e2aStoredToday(2, "a de depois de amanhã"));
    expect(storedSession.safeParse(aggregate(saved).sessions[0]).success, "control: the strict shape rejects the stored E2-A operators as they are").toBe(false);
    const pilot = loadedPilot(saved);
    expect(pilot.pending?.destino.dia).toEqual({ tipo: "deslocamento", quantidade: 2, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: "depois de amanhã" });
    expect(pilot.pending?.destino.hora).toEqual({ tipo: "deslocamento", minutos: 150, ancoras: ["origem"], mencao: "cento e cinquenta minutos adiante" });
    expect(pilot.pending?.origem.dia).toEqual({ tipo: "deslocamento", quantidade: 2, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: "a de depois de amanhã" });
    const days = loadedPilot(await savedWith({ dia: e2aStoredOriginDays(7, "uma semana adiante do marcado") }));
    expect(days.pending?.destino.dia).toEqual({ tipo: "deslocamento", quantidade: 7, unidade: "dias", ancoras: ["origem"], data_citada: null, mencao: "uma semana adiante do marcado" });
  });
  it("everything else stays as saved (plan, replies, proofs, the turn anchors) and no reset mark is set; the result passes the strict shape", async () => {
    const saved = await savedWith({ dia: e2aStoredToday(1, "amanhã") });
    const pilot = loadedPilot(saved);
    expect(pilot.reset).toBeUndefined();
    expect(pilot.plan).toEqual(saved.plan);
    expect(pilot.replies).toEqual(saved.replies);
    expect(pilot.pending?.proven).toEqual(saved.pending?.proven);
    expect(pilot.pending?.anchors).toEqual(saved.pending?.anchors);
    expect(pilot.pending?.destino.hora).toEqual(saved.pending?.destino.hora);
    expect(pilot.pending?.destino.profissional).toEqual(saved.pending?.destino.profissional);
    expect(storedSession.safeParse({ ...aggregate(pilot).sessions[0] }).success).toBe(true);
  });
  it("the converted operator resolves to the day E2-A would have: 'amanhã' said on Thursday is Friday when the appointment question is answered", async () => {
    const saved = await savedWith({ dia: e2aStoredToday(1, "amanhã") });
    const f = fake([e2bLuna({ tipo: "resposta", resposta_a: "q1", origem: e2bOrigin({ dia: e2bWeekday("sabado", "a de sábado") }) })]);
    Object.assign(f.state, loadedPilot(saved));
    expect((await send(f, "a de sábado")).view.status).toBe("proposal_ready");
    expect(f.prepared.map(change => [change.appointmentRef, change.date, change.time])).toEqual([["apt-teo-sat", FRI, "15:00"]]);
  });
  it("an E2-B state is left exactly as saved", async () => {
    const saved = await savedWith({ dia: { tipo: "deslocamento", quantidade: 3, unidade: "dias", ancoras: ["origem", "hoje"], data_citada: null, mencao: "três dias depois" } });
    expect(loadedPilot(saved)).toEqual(saved);
  });
  it("an E1-shaped state (numbered weekday) is still dropped with the reset mark, even beside an E2-A operator; a malformed old operator fails closed", async () => {
    const saved = await savedWith({});
    const e1 = { ...saved, pending: { origem: { dia: { tipo: "dia_semana", dia_semana: 6, qualificador: null, mencao: "a de sexta" }, hora: null, profissional_mencao: null,
      servico_mencao: null, posicao: null }, destino: { dia: e2aStoredToday(1, "amanhã"), hora: null, profissional: { modo: null, mencao: null } } } };
    const dropped = loadedPilot(e1);
    expect(dropped.pending).toBeUndefined();
    expect(dropped.reset).toBe(true);
    for (const bad of [{ ...e2aStoredToday(1, "amanhã"), extra: 1 }, { tipo: "relativo_hoje", dias: "1", mencao: "amanhã" }, { tipo: "origem_mais_dias", mencao: "depois" }])
      expect(() => parseStoredAggregate(aggregate(structuredClone({ ...saved, pending: { ...saved.pending, destino: { ...saved.pending!.destino, dia: bad } } }))), JSON.stringify(bad))
        .toThrow("SESSION_STATE_INVALID");
  });
});
