import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { confirmPilotProposal, handlePilotMessage, pilotOptionRef, selectPilotOption, PILOT_STATE_RESET, type PilotHost, type PilotReceipt, type PilotResolvedChange,
  type PilotSessionState } from "../secretary-pilot";
import type { PilotPerson, PilotProfessionalRow, PilotServiceRow } from "../secretary-pilot-resolver";
import { parseStoredAggregate, storedSession, upgradeStoredPilot, STORED_AGGREGATE_SCHEMA } from "../secretary-session-state";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2aClock, e2aDay, e2aLuna, e2aOrigin, e2aTo, type E2aInterpretation } from "../../test/secretary-pilot-e2a";

/** Reschedule pilot E2-A, a conversation saved under the E1 contract (numbered weekday, servico_mencao): its pending operators can no longer be
 * resolved, so the loader drops them and marks the state; the next message or tap withdraws a plan still open with a clear reply (never resolved
 * again without its operators, never a crash), after the receipt of its proposal; a ready proposal can still be confirmed (its fields are complete).
 * Anything that is neither the E1 nor the E2-A shape still fails closed. received_at is Thursday 2031-03-13, 09:00 in São Paulo. Invented names;
 * no network, database or model. */
const bambu: PilotServiceRow = { id: "srv-bambu", name: "Bambuterapia", durationMin: 50, priceCents: 9000 };
const hermogenes: PilotProfessionalRow = { id: "pro-hermogenes", name: "Hermógenes Trovoada", serviceIds: [bambu.id] };
const anacleto: PilotProfessionalRow = { id: "pro-anacleto", name: "Anacleto Cambará", serviceIds: [bambu.id] };
const belmira: PilotPerson = { id: "cli-belmira", name: "Belmira Quintanilha" };
const FRI = "2031-03-14", WED = "2031-03-19", SUN = "2031-03-16";
const ID = "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a02";
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [belmira], team: [hermogenes, anacleto], catalog: [bambu],
  hours: { [hermogenes.id]: everyDay(["08:00", "20:00"]), [anacleto.id]: everyDay(["08:00", "20:00"]) },
  appointments: [booked("apt-bel-fri", belmira, hermogenes, bambu, FRI, "10:00"), booked("apt-bel-wed", belmira, anacleto, bambu, WED, "11:00")], ...over });

function fake(frames: E2aInterpretation[], receipt?: (ref: string) => PilotReceipt | undefined) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], confirmed: string[] = [];
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(salon());
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-legacy", userId: "user-legacy" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => clockAt("2031-03-13T12:00:00.000Z"),
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async ref => receipt?.(ref), settle: async () => undefined,
    confirm: async approval => { confirmed.push(approval.proposalRef); return { proposalRef: approval.proposalRef, appointmentRef: "apt-bel-fri", outcome: "RESCHEDULED", duplicate: false }; } };
  return { host, state, prepared, confirmed, model };
}
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: ID, message });
/** The two turns of every case: a question over her two appointments (q1), then a ready proposal once the Friday one is said. */
const ASK = e2aLuna({ cliente: { mencao: "Belmira" }, destino: e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(15, "às 15h")) });
const READY = e2aLuna({ cliente: { mencao: "Belmira" }, origem: e2aOrigin({ dia: e2aDay("sexta", "a de sexta") }), destino: e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(15, "às 15h")) });
/** What the loader leaves of a conversation saved by the E1 pilot. */
const legacy = (state: PilotSessionState) => { delete state.pending; state.reset = true; };
/** The pending operators exactly as the E1 contract wrote them. */
const E1_PENDING = {
  origem: { dia: { tipo: "dia_semana", dia_semana: 6, qualificador: null, mencao: "a de sexta" }, hora: null, profissional_mencao: null, servico_mencao: "a bambuterapia", posicao: null },
  destino: { dia: { tipo: "dia_semana", dia_semana: 1, qualificador: null, mencao: "pro domingo" }, hora: { tipo: "relogio", hora: 15, minuto: 0, periodo: null, mencao: "às 15h" },
    profissional: { modo: null, mencao: null } },
  proven: { dia: true, servico_mencao: true }, anchors: { origem: "2031-03-13T12:00:00.000Z", destino: "2031-03-13T12:00:00.000Z" } };
const aggregate = (pilot: unknown) => ({ schema: STORED_AGGREGATE_SCHEMA, root: ID, sessions: [{ id: ID, skill: "auto", expires: 1, turns: 1, cancelled: false, pilot }] });

describe("E2-A: a pilot state saved under the E1 contract", () => {
  it("loads with its E1 operators dropped and the reset mark; its plan and replies stay as saved", async () => {
    const f = fake([READY]);
    expect((await send(f, "A de sexta da Belmira vai pro domingo às 15h")).view.status).toBe("proposal_ready");
    const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState & Record<string, unknown>;
    const old = { ...saved, pending: structuredClone(E1_PENDING) };
    expect(storedSession.safeParse({ ...aggregate(old).sessions[0] }).success, "control: the strict shape rejects the E1 operators").toBe(false);
    const loaded = parseStoredAggregate(aggregate(structuredClone(old)));
    const pilot = (loaded.sessions[0] as { pilot: PilotSessionState }).pilot;
    expect(pilot.pending).toBeUndefined();
    expect(pilot.reset).toBe(true);
    expect(pilot.plan).toEqual(saved.plan);
    expect(pilot.replies).toEqual(saved.replies);
    expect(storedSession.safeParse(loaded.sessions[0]).success).toBe(true);
  });
  it("an E2-A state is left exactly as saved; anything that is neither shape still fails closed", async () => {
    const f = fake([READY]);
    await send(f, "A de sexta da Belmira vai pro domingo às 15h");
    const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState;
    const current = parseStoredAggregate(aggregate(structuredClone(saved)));
    expect((current.sessions[0] as { pilot: unknown }).pilot).toEqual(saved);
    const mixed = { ...E1_PENDING, origem: { ...E1_PENDING.origem, servico: null } };
    const numberedInNew = { ...saved.pending, origem: { ...saved.pending!.origem, dia: { tipo: "dia_semana", dia_semana: 6, qualificador: null, mencao: "a de sexta" } } };
    for (const pending of [{ origem: { dia: "sexta" }, destino: {} }, mixed, numberedInNew, { ...E1_PENDING, extra: 1 }])
      expect(() => parseStoredAggregate(aggregate({ ...structuredClone(saved), pending })), JSON.stringify(pending).slice(0, 80)).toThrow("SESSION_STATE_INVALID");
    const untouched = { id: ID, skill: "auto" };
    upgradeStoredPilot(untouched);
    expect(untouched).toEqual({ id: ID, skill: "auto" });
  });
  it("the next message withdraws a plan still open: no Luna call, nothing prepared, a clear reply; the mark is consumed and the next request is new", async () => {
    const f = fake([ASK, READY]);
    expect((await send(f, "A Belmira vai pro domingo às 15h")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    legacy(f.state);
    const out = await send(f, "a de sexta");
    expect(out).toMatchObject({ code: "PILOT_STATE_RESET", text: PILOT_STATE_RESET });
    expect(out.view.status).toBe("withdrawn");
    expect(out.view.questions).toEqual([]);
    expect(f.model.requests).toHaveLength(1);
    expect(f.prepared).toEqual([]);
    expect(f.state.reset).toBeUndefined();
    const again = await send(f, "A de sexta da Belmira vai pro domingo às 15h");
    expect(again.view.status).toBe("proposal_ready");
    expect(f.prepared.map(change => [change.appointmentRef, change.date, change.time])).toEqual([["apt-bel-fri", SUN, "15:00"]]);
  });
  it("a tap on the open question withdraws instead of resolving without the operators (control: the same tap without the mark resolves)", async () => {
    const control = fake([ASK]);
    const asked = await send(control, "A Belmira vai pro domingo às 15h"), question = asked.view.questions[0];
    expect((await selectPilotOption(control.host, pilotOptionRef(question.questionId, "apt-bel-fri"))).view.status).toBe("proposal_ready");
    const f = fake([ASK]);
    await send(f, "A Belmira vai pro domingo às 15h");
    legacy(f.state);
    const tapped = await selectPilotOption(f.host, pilotOptionRef(question.questionId, "apt-bel-fri"));
    expect(tapped).toMatchObject({ code: "PILOT_STATE_RESET", text: PILOT_STATE_RESET });
    expect(tapped.view.status).toBe("withdrawn");
    expect(f.prepared).toEqual([]);
  });
  it("a ready proposal already written behind the session is reported first, never withdrawn", async () => {
    const f = fake([READY], ref => ref === "prop-1" ? { proposalRef: "prop-1", appointmentRef: "apt-bel-fri", outcome: "RESCHEDULED", duplicate: false } : undefined);
    await send(f, "A de sexta da Belmira vai pro domingo às 15h");
    legacy(f.state);
    const out = await send(f, "e aí, foi?");
    expect(out.code).toBe("CONFIRMED_BY_RECEIPT");
    expect(out.view.status).toBe("done");
  });
  it("a ready proposal can still be confirmed (every field is resolved); the mark then leaves without a reply of its own", async () => {
    const f = fake([READY, e2aLuna({ tipo: "conversa" })]);
    const ready = await send(f, "A de sexta da Belmira vai pro domingo às 15h"), proposal = ready.view.proposal!;
    legacy(f.state);
    const done = await confirmPilotProposal(f.host, { proposalRef: proposal.proposalRef, draftRevision: proposal.draftRevision, revision: ready.view.revision });
    expect(done.code).toBe("CONFIRMED");
    expect(f.confirmed).toEqual(["prop-1"]);
    const next = await send(f, "obrigada");
    expect(next.code).toBe("CONVERSATION");
    expect(f.state.reset).toBeUndefined();
    expect(f.model.requests).toHaveLength(2);
  });
});
