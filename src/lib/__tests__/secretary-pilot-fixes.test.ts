import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { decodePilotInterpretation, PILOT_RESCHEDULE_PARAMETERS, PILOT_RESCHEDULE_TOOL, type PilotInterpretation, type PilotOrigin, type PilotTempoDia,
  type PilotTempoHora } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { PILOT_PROMPT } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { confirmPilotProposal, handlePilotMessage, pilotAppointmentLabel, selectPilotOption, PILOT_ALREADY_WRITTEN, PILOT_CONFIRM_UNVERIFIED, PILOT_NOTHING_OPEN_REPLY,
  PILOT_OUT_OF_SCOPE_REPLY, PILOT_RECEIPT_UNVERIFIED, PILOT_REPLAY_SUPERSEDED, PILOT_WITHDRAWN_REPLY, type PilotHost, type PilotPreparation, type PilotReceipt,
  type PilotResolvedChange, type PilotSessionState } from "../secretary-pilot";
import type { PilotPlan } from "../secretary-pilot-plan";
import { resolveAppointment, resolveTargetDate, type PilotPerson, type PilotProfessionalRow, type PilotServiceRow } from "../secretary-pilot-resolver";
import { storedSession } from "../secretary-session-state";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

/** Reschedule pilot: the fixes of the final review (P1-P7, E1-E3, S1-S9; docs/c5-spike/12-piloto-remarcacao.md). Orchestrator, resolver and
 * contract over an in-memory salon and a scripted Luna; the host's agenda preparation and Confirmar are stand-ins that record what they receive.
 * received_at is Monday 2031-03-10, 09:00 in São Paulo unless a case moves the clock. Invented names and sentences; no network, database or paid
 * model. */
const corte: PilotServiceRow = { id: "srv-corte", name: "Corte bordado", durationMin: 40, priceCents: 9000 };
const ines: PilotProfessionalRow = { id: "pro-ines", name: "Inês Valadares", serviceIds: [corte.id] };
const otavio: PilotProfessionalRow = { id: "pro-otavio", name: "Otávio Brandão", serviceIds: [corte.id] };
const person = (id: string, name: string): PilotPerson => ({ id, name });
const severina = person("cli-severina", "Severina Lobato"), anselmo = person("cli-anselmo", "Anselmo Prado");
const MON = "2031-03-10", WED = "2031-03-12", FRI = "2031-03-14", SAT = "2031-03-15";
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [severina, anselmo], team: [ines, otavio], catalog: [corte],
  hours: { [ines.id]: everyDay(["08:00", "21:00"]), [otavio.id]: everyDay(["08:00", "21:00"]) }, appointments: [], ...over });
const ORIGIN: PilotOrigin = { dia: null, hora: null, profissional_mencao: null, servico_mencao: null, posicao: null };
const day = (dia_semana: number, mencao: string, qualificador: "este" | "proximo" | null = null): PilotTempoDia => ({ tipo: "dia_semana", dia_semana, qualificador, mencao });
const clock = (hora: number, mencao: string): PilotTempoHora => ({ tipo: "relogio", hora, minuto: 0, periodo: null, mencao });
const luna = (over: Partial<PilotInterpretation> = {}): PilotInterpretation => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null,
  cliente: { mencao: null }, origem: ORIGIN, destino: { dia: null, hora: null, profissional: { modo: null, mencao: null } }, fora_do_escopo: [], ...over });
const to = (dia: PilotTempoDia | null, hora: PilotTempoHora | null, profissional: PilotInterpretation["destino"]["profissional"] = { modo: null, mencao: null }) => ({ dia, hora, profissional });
/** Local São Paulo time (UTC-3) as the frozen received_at. */
const local = (at: string) => clockAt(new Date(Date.parse(`${at}:00Z`) + 3 * 3_600_000).toISOString());

/** A host over the in-memory salon with a clock the case can move; the scripted Luna answers, the preparation proposes, the Confirmar writes. */
function fake(base: MemorySalon, frames: PilotInterpretation[], over: Partial<PilotHost> = {}) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], settled: PilotReceipt[] = [], now = { clock: clockAt() };
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-fixes", userId: "user-fixes" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => now.clock,
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async receipt => { settled.push(receipt); },
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-x", outcome: "RESCHEDULED", duplicate: false }), ...over };
  return { host, state, prepared, settled, model, reader, base, now };
}
const send = (f: ReturnType<typeof fake>, message: string, clientTurnId?: string) =>
  handlePilotMessage(f.host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a01", message, ...(clientTurnId ? { clientTurnId } : {}) });
const approvalOf = (plan: PilotPlan) => ({ proposalRef: plan.action.proposal!.proposalRef, draftRevision: plan.action.proposal!.draftRevision, revision: plan.revision });
const severinaWed = () => [booked("apt-sev", severina, ines, corte, WED, "10:00")];
const twoOnWednesday = () => [booked("apt-sev-10", severina, ines, corte, WED, "10:00"), booked("apt-sev-16", severina, ines, corte, WED, "16:00")];
const move = (over: Partial<PilotInterpretation> = {}) => luna({ cliente: { mencao: "Severina" }, destino: to(day(6, "sexta"), clock(15, "15h")), ...over });

describe("review P1/P2: each origin hint is proved against the message that brought it; other words never move a bound appointment", () => {
  it("P1: an answer whose hint's words appear only in an earlier turn never binds an appointment (asked again); its own words do", async () => {
    const turn1 = luna({ cliente: { mencao: "Severina" }, origem: { ...ORIGIN, dia: day(4, "de quarta") }, destino: to(day(6, "sexta"), clock(10, "às 10h")) });
    const f = fake(salon({ appointments: twoOnWednesday() }), [turn1, luna({ tipo: "resposta", resposta_a: "q1", origem: { ...ORIGIN, hora: clock(10, "às 10h") } })]);
    expect((await send(f, "Severina de quarta pra sexta às 10h")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    const again = await send(f, "a da tarde");
    expect(again.code).toBe("ASKED_APPOINTMENT_SEVERAL");
    expect(again.view.fields!.appointment.value).toBeNull();
    expect(f.state.pending?.proven).toMatchObject({ dia: true, hora: false });
    expect(f.prepared).toEqual([]);
    const own = fake(salon({ appointments: twoOnWednesday() }), [turn1, luna({ tipo: "resposta", resposta_a: "q1", origem: { ...ORIGIN, hora: clock(16, "das 16h") } })]);
    await send(own, "Severina de quarta pra sexta às 10h");
    const bound = await send(own, "a das 16h");
    expect(bound.view.fields!.appointment.value).toBe("apt-sev-16");
    expect(bound.view.status).toBe("proposal_ready");
  });
  it("P2: a tapped appointment stays bound when a later message says the same origin in other words, or with words absent from it", async () => {
    const f = fake(salon({ appointments: twoOnWednesday() }), [
      luna({ cliente: { mencao: "Severina" }, origem: { ...ORIGIN, dia: day(4, "a de quarta") }, destino: to(day(6, "sexta"), clock(15, "às 15h")) }),
      luna({ origem: { ...ORIGIN, dia: day(4, "isso, a de quarta") }, destino: to(null, clock(17, "às 17h")) }),
      luna({ origem: { ...ORIGIN, dia: day(4, "quarta-feira") }, destino: to(null, clock(18, "às 18h")) }),
      luna({ origem: { ...ORIGIN, dia: day(4, "desta quarta", "este") }, destino: to(null, clock(19, "às 19h")) })]);
    expect((await send(f, "Severina, a de quarta, pra sexta às 15h")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    expect((await selectPilotOption(f.host, "q1/apt-sev-16")).view.fields!.appointment.value).toBe("apt-sev-16");
    const reworded = await send(f, "isso, a de quarta, mas às 17h");
    expect(reworded.view).toMatchObject({ status: "proposal_ready", fields: { appointment: { value: "apt-sev-16" }, time: { value: "17:00" } } });
    const unproven = await send(f, "melhor às 18h");
    expect(unproven.view).toMatchObject({ status: "proposal_ready", fields: { appointment: { value: "apt-sev-16" }, time: { value: "18:00" } } });
    // A proved hint with another typed value is located again; the bound one is kept while it is still among the rows the hints leave.
    const kept = await send(f, "desta quarta, às 19h");
    expect(kept.view).toMatchObject({ status: "proposal_ready", fields: { appointment: { value: "apt-sev-16" }, time: { value: "19:00" } } });
  });
});

describe("review P3/P6, S3: an out-of-scope part is never dropped in silence", () => {
  it("a withdrawal with a correction and an out-of-scope part asks the scope question before proposing (decision 26)", async () => {
    const rows = [...severinaWed(), booked("apt-ans", anselmo, otavio, corte, WED, "11:00")];
    const f = fake(salon({ appointments: rows }), [move(), luna({ tipo: "misto", desistir: true, cliente: { mencao: "Anselmo Prado" }, destino: to(day(7, "sábado"), clock(15, "15h")),
      fora_do_escopo: [{ tipo: "cancelar", mencao: "desmarca a Severina" }] })]);
    await send(f, "Severina vai pra sexta 15h");
    const out = await send(f, "esquece; o Anselmo Prado pra sábado 15h e desmarca a Severina");
    expect(out.code).toBe("ASKED_OUT_OF_SCOPE_PART");
    expect(out.view).toMatchObject({ status: "pending", questions: [{ field: "scope", reason: "OUT_OF_SCOPE_PART" }] });
    expect(out.text).toContain("“desmarca a Severina”");
    expect(f.prepared).toHaveLength(1);
  });
  it("a plain withdrawal, and one with nothing open, say the out-of-scope part they leave out", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move(), luna({ desistir: true, fora_do_escopo: [{ tipo: "cancelar", mencao: "desmarca ela" }] })]);
    await send(f, "Severina vai pra sexta 15h");
    const out = await send(f, "esquece e desmarca ela");
    expect(out.code).toBe("WITHDRAWN");
    expect(out.text).toContain(PILOT_WITHDRAWN_REPLY);
    expect(out.text).toContain("“desmarca ela”");
    const none = fake(salon(), [luna({ desistir: true, fora_do_escopo: [{ tipo: "cancelar", mencao: "desmarca ela" }] })]);
    const nothing = await send(none, "esquece e desmarca ela");
    expect(nothing.code).toBe("WITHDRAW_NOTHING");
    expect(nothing.text).toContain(PILOT_NOTHING_OPEN_REPLY);
    expect(nothing.text).toContain("“desmarca ela”");
  });
  it("P6: the owner's yes to the scope question stands when the answer names the part again; a conversation naming one gets the clear reply", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move({ tipo: "misto", fora_do_escopo: [{ tipo: "cancelar", mencao: "desmarca o Anselmo" }] }),
      luna({ tipo: "resposta", resposta_a: "q1", aceita_parcial: true, fora_do_escopo: [{ tipo: "cancelar", mencao: "o desmarque" }] })]);
    await send(f, "Severina vai pra sexta 15h e desmarca o Anselmo");
    const yes = await send(f, "sim, só a remarcação; o desmarque eu faço depois");
    expect(yes.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(yes.text).toContain("“o desmarque”");
    expect(f.prepared).toHaveLength(1);
    const talk = fake(salon(), [luna({ tipo: "conversa", fora_do_escopo: [{ tipo: "bloquear", mencao: "lacra o livro de horas da Inês" }] })]);
    const reply = await send(talk, "Bom dia! lacra o livro de horas da Inês");
    expect(reply.code).toBe("OUT_OF_SCOPE");
    expect(reply.text).toContain(PILOT_OUT_OF_SCOPE_REPLY);
  });
});

describe("review P4/P5/P7: the contract", () => {
  it("P4/P5: one appointment per message (a second reschedule goes in fora_do_escopo) and name mentions carry the name only; the examples decode", () => {
    expect(PILOT_PROMPT).toContain("Uma segunda remarcação na mesma mensagem");
    expect(PILOT_PROMPT).toContain("sem artigo, preposição ou forma de tratamento");
    const examples = PILOT_PROMPT.split("\n").filter(line => line.startsWith("{")).map(line => decodePilotInterpretation(JSON.parse(line)));
    expect(examples).toHaveLength(3);
    expect(examples[2]).toMatchObject({ tipo: "misto", cliente: { mencao: "Ermengarda" }, origem: { profissional_mencao: "Lupércio" },
      destino: { dia: { tipo: "mes_relativo", dia: 3, meses: 1 } }, fora_do_escopo: [{ tipo: "outra_acao" }] });
    const wire = JSON.stringify(PILOT_RESCHEDULE_PARAMETERS);
    expect(wire).toContain("Só as palavras do próprio nome");
    expect(wire).toContain("uma segunda remarcação (outra pessoa ou outro atendimento) como outra_acao");
  });
  it("P7: a day of a month said relative to the current one is counted by the resolver, never this month in its place", async () => {
    const rel = (dia: number, meses: number, mencao: string): PilotTempoDia => ({ tipo: "mes_relativo", dia, meses, mencao });
    expect(resolveTargetDate(rel(15, 1, "dia 15 do outro mês"), { date: WED }, clockAt())).toMatchObject({ state: "one", date: "2031-04-15", provenance: "explicit" });
    expect(resolveTargetDate(rel(31, 1, "dia 31 do outro mês"), { date: WED }, clockAt())).toMatchObject({ state: "invalid", reason: "NO_SUCH_DATE" });
    expect(resolveTargetDate(rel(5, 0, "dia 5 deste mês"), { date: WED }, clockAt())).toMatchObject({ state: "invalid", reason: "DATE_PAST" });
    expect(resolveTargetDate(rel(15, 1, "dia 15 do outro mês"), { date: WED }, local("2031-12-10T09:00"))).toMatchObject({ state: "one", date: "2032-01-15" });
    expect(() => decodePilotInterpretation(luna({ destino: to(rel(15, 13, "dia 15 daqui a muito"), null) }))).toThrow();
    const april = [booked("apt-sev-abr", severina, ines, corte, "2031-04-15", "10:00"), booked("apt-sev-mar", severina, ines, corte, "2031-03-15", "10:00")];
    const located = await resolveAppointment(memoryReader(salon({ appointments: april })), { customerId: severina.id, origem: { ...ORIGIN, dia: rel(15, 1, "a do dia 15 do outro mês") },
      message: "a do dia 15 do outro mês" }, clockAt());
    expect(located.state === "one" && located.appointment.id).toBe("apt-sev-abr");
    const f = fake(salon({ appointments: severinaWed() }), [move({ destino: to(rel(15, 1, "pro dia 15 do outro mês"), { tipo: "mesmo_da_origem", mencao: "mesma hora" }) })]);
    await send(f, "Severina pro dia 15 do outro mês, mesma hora");
    expect(f.prepared.map(change => [change.date, change.time])).toEqual([["2031-04-15", "10:00"]]);
  });
});

describe("review E1/E3: a write already made is reported; a replay never pairs an old reply with a later proposal", () => {
  const written = (ref: string): PilotReceipt => ({ proposalRef: ref, appointmentRef: "apt-sev", outcome: "RESCHEDULED", duplicate: true });
  it("a message after a write behind the session reports it (done, settled) and is neither interpreted nor prepared again", async () => {
    let committed = false;
    const f = fake(salon({ appointments: severinaWed() }), [move(), luna({ destino: to(null, clock(16, "16h")) })],
      { receipt: async ref => committed && ref === "prop-1" ? written(ref) : undefined });
    await send(f, "Severina vai pra sexta 15h");
    committed = true;
    const out = await send(f, "melhor 16h");
    expect(out.code).toBe("CONFIRMED_BY_RECEIPT");
    expect(out.view.status).toBe("done");
    expect(out.text).toContain("Remarcação gravada");
    expect(out.text).not.toContain("nada foi alterado");
    expect(f.settled.map(receipt => receipt.proposalRef)).toEqual(["prop-1"]);
    expect(f.prepared).toHaveLength(1);
    expect(f.model.requests).toHaveLength(1);
  });
  it("an unreadable journal changes nothing (no interpretation, the proposal kept); only then an expired proposal is dropped and prepared again", async () => {
    let failing = false, lapsed = false;
    const f = fake(salon({ appointments: severinaWed() }), [move(), luna({ tipo: "conversa" })],
      { receipt: async () => { if (failing) throw Error("SYNTHETIC_JOURNAL_DOWN"); return undefined; }, expired: () => lapsed });
    const ready = await send(f, "Severina vai pra sexta 15h");
    failing = true;
    const unverified = await send(f, "e então?");
    expect(unverified).toMatchObject({ code: "RECEIPT_UNVERIFIED", text: PILOT_RECEIPT_UNVERIFIED });
    expect(unverified.view).toMatchObject({ status: "proposal_ready", revision: ready.view.revision, proposal: { proposalRef: "prop-1" } });
    expect(f.model.requests).toHaveLength(1);
    failing = false; lapsed = true;
    const again = await send(f, "e então?");
    expect(again.expiry).toMatchObject({ status: "needs_review", invalidation: "PROPOSAL_EXPIRED" });
    expect(again.view).toMatchObject({ status: "proposal_ready", proposal: { proposalRef: "prop-2" } });
  });
  it("a Confirmar whose receipt cannot be read after a failure keeps the proposal as it was (never «nada foi gravado»)", async () => {
    let reads = 0;
    const f = fake(salon({ appointments: severinaWed() }), [move()], { confirm: async () => { throw Error("SYNTHETIC_TIMEOUT"); },
      receipt: async () => { reads += 1; if (reads > 1) throw Error("SYNTHETIC_JOURNAL_DOWN"); return undefined; } });
    await send(f, "Severina vai pra sexta 15h");
    const before = structuredClone(f.state.plan!);
    const out = await confirmPilotProposal(f.host, approvalOf(before));
    expect(out).toMatchObject({ code: "CONFIRM_UNVERIFIED", text: PILOT_CONFIRM_UNVERIFIED });
    expect(out.text).not.toContain("nada foi gravado");
    expect(f.state.plan).toEqual(before);
  });
  it("a preparation that finds the change's draft confirmed already reports that write and closes the plan", async () => {
    const receipt = written("prop-old");
    const f = fake(salon({ appointments: severinaWed() }), [move()], { prepare: async (): Promise<PilotPreparation> => ({ ok: false, code: "ALREADY_WRITTEN", text: PILOT_ALREADY_WRITTEN, receipt }) });
    const out = await send(f, "Severina vai pra sexta 15h");
    expect(out).toMatchObject({ code: "ALREADY_WRITTEN", text: PILOT_ALREADY_WRITTEN });
    expect(out.view.status).toBe("withdrawn");
    expect(f.settled).toEqual([receipt]);
  });
  it("E3: a repeated clientTurnId after a later change answers with the current state, never its old text", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move(), luna({ destino: to(null, clock(16, "16h")) })]);
    const id = "4c2b7e1a-9d3f-4b8e-a1c6-5f0e2d7b9a31";
    const first = await send(f, "Severina vai pra sexta 15h", id);
    expect((await send(f, "Severina vai pra sexta 15h", id)).text).toBe(first.text);
    await send(f, "melhor 16h");
    const again = await send(f, "Severina vai pra sexta 15h", id);
    expect(again.code).toBe("REPLAYED_SUPERSEDED");
    expect(again.text.startsWith(PILOT_REPLAY_SUPERSEDED)).toBe(true);
    expect(again.text).toContain("PROPOSTA 2");
    expect(again.text).not.toContain("PROPOSTA 1");
    expect(again.view).toMatchObject({ revision: f.state.plan!.revision, proposal: { proposalRef: "prop-2" }, turn: { clientTurnId: id, replayed: true } });
    expect(f.model.requests).toHaveLength(2);
  });
});

describe("review S1/S2/S5: what a message changes is read from the message itself; a said day keeps its turn's today", () => {
  it("S1: a withdrawal naming the customer again withdraws, whatever the agenda or the clock did meanwhile", async () => {
    const withdrawal = luna({ desistir: true, cliente: { mencao: "Severina" } });
    const free = fake(salon({ appointments: severinaWed() }), [move({ destino: to(day(6, "sexta"), clock(15, "15h"), { modo: "qualquer", mencao: "com quem estiver livre" }) }), withdrawal]);
    expect((await send(free, "Severina pra sexta 15h com quem estiver livre")).view.fields!.professional.value).toBe(ines.id);
    free.base.appointments!.push(booked("apt-other", anselmo, ines, corte, FRI, "09:00"));
    expect((await send(free, "esquece a da Severina")).code).toBe("WITHDRAWN");
    const cancelled = fake(salon({ appointments: severinaWed() }), [move(), withdrawal]);
    await send(cancelled, "Severina vai pra sexta 15h");
    cancelled.base.appointments![0] = { ...cancelled.base.appointments![0], status: "CANCELLED" };
    expect((await send(cancelled, "esquece a da Severina")).code).toBe("WITHDRAWN");
    const late = fake(salon({ appointments: severinaWed() }), [move({ destino: to({ tipo: "relativo_hoje", dias: 1, mencao: "amanhã" }, clock(15, "15h")) }), withdrawal]);
    late.now.clock = local(`${MON}T23:50`);
    await send(late, "Severina pra amanhã 15h");
    late.now.clock = local("2031-03-11T00:30");
    expect((await send(late, "esquece a da Severina")).code).toBe("WITHDRAWN");
    expect(late.prepared).toHaveLength(1);
  });
  it("S2: a day said before local midnight keeps that turn's today; a day that has passed meanwhile is asked, never moved", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move({ destino: to({ tipo: "relativo_hoje", dias: 1, mencao: "amanhã" }, null) }),
      luna({ tipo: "resposta", resposta_a: "q1", destino: to(null, clock(15, "às 15h")) })]);
    f.now.clock = local(`${MON}T23:50`);
    expect((await send(f, "Severina pra amanhã")).code).toBe("ASKED_TIME_MISSING");
    f.now.clock = local("2031-03-11T00:10");
    await send(f, "às 15h");
    expect(f.prepared.map(change => change.date)).toEqual(["2031-03-11"]);
    const g = fake(salon({ appointments: severinaWed() }), [move({ destino: to({ tipo: "data", dia: 10, mes: null, mencao: "dia 10" }, clock(22, "às 22h")) }),
      luna({ destino: to(null, null, { modo: "nomeado", mencao: "Otávio" }) })]);
    g.now.clock = local(`${MON}T21:00`);
    await send(g, "Severina pro dia 10 às 22h");
    g.now.clock = local("2031-03-11T00:05");
    const past = await send(g, "com o Otávio");
    expect(past.code).toBe("ASKED_DATE_INVALID");
    expect(g.prepared.map(change => change.date)).toEqual([MON]);
  });
  it("S5: a message that changes nothing keeps the revision and the proposal; nothing is prepared again", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move(), luna({ tipo: "resposta" }), move(), luna({ destino: to(null, null, { modo: "manter", mencao: null }) })]);
    const ready = await send(f, "Severina vai pra sexta 15h");
    for (const message of ["ok", "isso, a Severina pra sexta 15h", "mantém quem atende"]) {
      const out = await send(f, message);
      expect(out.code, message).toBe("UNCHANGED");
      expect(out.view, message).toMatchObject({ revision: ready.view.revision, proposal: { proposalRef: "prop-1" } });
      expect(out.text, message).toBe("PROPOSTA 1");
    }
    expect(f.prepared).toHaveLength(1);
    expect(await confirmPilotProposal(f.host, approvalOf(f.state.plan!))).toMatchObject({ code: "CONFIRMED" });
  });
});

describe("review S4/S6/S8/S9: taps, turns and bounds", () => {
  it("S4: a tap names its question; a card of a closed question (or a bare id once there were others) changes nothing", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move({ destino: to(day(6, "esta sexta", "este"), clock(8, "às 8")) }),
      luna({ destino: to(day(7, "este sábado", "este"), clock(8, "às 8")) })]);
    expect((await send(f, "Severina pra esta sexta às 8")).view.questions).toEqual([expect.objectContaining({ questionId: "q1", reason: "TIME_TWO_READINGS" })]);
    const asked = await send(f, "não, este sábado às 8");
    expect(asked.view.questions).toEqual([expect.objectContaining({ questionId: "q2", reason: "TIME_TWO_READINGS" })]);
    const before = structuredClone(f.state);
    await expect(selectPilotOption(f.host, "q1/20:00")).rejects.toThrow("SELECTION_INVALID");
    await expect(selectPilotOption(f.host, "20:00")).rejects.toThrow("SELECTION_INVALID");
    expect(f.state).toEqual(before);
    const tapped = await selectPilotOption(f.host, "q2/20:00");
    expect(tapped.view.status).toBe("proposal_ready");
    expect(f.prepared.map(change => [change.date, change.time])).toEqual([[SAT, "20:00"]]);
  });
  it("S6: a tap on a professional binds that record, even among namesakes", async () => {
    const twin: PilotProfessionalRow = { id: "pro-ines-2", name: "Inês Valadares", serviceIds: [corte.id] };
    const f = fake(salon({ team: [ines, twin, otavio], appointments: [booked("apt-sev", severina, otavio, corte, WED, "10:00")] }),
      [move({ destino: to(null, { tipo: "mesmo_da_origem", mencao: "mesmo horário" }, { modo: "nomeado", mencao: "Inês" }) })]);
    expect((await send(f, "Severina com a Inês, mesmo horário")).view.questions).toEqual([expect.objectContaining({ field: "professional", reason: "PROFESSIONAL_AMBIGUOUS" })]);
    const tapped = await selectPilotOption(f.host, "q1/pro-ines-2");
    expect(tapped.view).toMatchObject({ status: "proposal_ready", fields: { professional: { value: "pro-ines-2", provenance: "explicit" } } });
    expect(f.prepared.map(change => change.professionalRef)).toEqual(["pro-ines-2"]);
  });
  it("S8: the first turn of a new plan is recorded from revision 0, never from the closed plan's", async () => {
    const f = fake(salon({ appointments: [...severinaWed(), booked("apt-ans", anselmo, otavio, corte, WED, "11:00")] }), [move(), luna({ cliente: { mencao: "Anselmo Prado" } })]);
    await send(f, "Severina vai pra sexta 15h");
    await confirmPilotProposal(f.host, approvalOf(f.state.plan!));
    const next = await send(f, "agora o Anselmo Prado");
    expect(f.state.plan!.turns.map(turn => turn.baseRevision)).toEqual([0]);
    expect(next.telemetry).toMatchObject({ base_revision: 0 });
  });
  it("S9: a long catalog or team name is bounded in labels and questions, so the state always saves", async () => {
    const longService: PilotServiceRow = { ...corte, name: "Tratamento ".repeat(40).trim() }, longPro: PilotProfessionalRow = { ...ines, name: `Inês ${"Valadares ".repeat(20).trim()}` };
    const rows = [booked("apt-a", severina, longPro, longService, WED, "10:00"), booked("apt-b", severina, longPro, longService, FRI, "10:00")];
    const f = fake(salon({ team: [longPro, otavio], catalog: [longService], appointments: rows }), [move()]);
    const out = await send(f, "Severina vai pra sexta 15h");
    expect(out.code).toBe("ASKED_APPOINTMENT_SEVERAL");
    for (const option of out.view.questions[0].options ?? []) expect(option.label.length).toBeLessThanOrEqual(400);
    expect(pilotAppointmentLabel(rows[0]).endsWith("…")).toBe(true);
    const session = { id: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a01", skill: "auto", expires: 1, turns: 0, cancelled: false, pilot: JSON.parse(JSON.stringify(f.state)) };
    expect(storedSession.safeParse(session).success).toBe(true);
  });
});
