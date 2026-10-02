import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { handlePilotMessage, pilotOptionRef, selectPilotOption, type PilotHost, type PilotReceipt, type PilotReply, type PilotResolvedChange,
  type PilotSessionState } from "../secretary-pilot";
import type { PilotPerson, PilotProfessionalRow, PilotServiceRow } from "../secretary-pilot-resolver";
import { storedSession } from "../secretary-session-state";
import { formatClock, formatDay } from "../secretary-datetime-format";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bClock, e2bDate, e2bDays, e2bLuna, e2bMinutes, e2bOrigin, e2bRandom, e2bSameClock, e2bTo, e2bWeekday, saoPauloInstant, type E2bDayAnchor,
  type E2bInterpretation, type E2bProfessional } from "../../test/secretary-pilot-e2b";

/** Reschedule pilot E2-B through the orchestrator (docs/c5-spike/12-piloto-remarcacao.md §11; Adendo 11), written BEFORE the implementation, with a
 * scripted Luna answering the E2-B contract and an in-memory salon; the host's agenda preparation and Confirmar are stand-ins that record what
 * they receive. ADVERSARIAL TWINS throughout (identical frames but for the one typed fact that must change the result).
 *  - An anchored day or clock offset reaches the proposal computed by the code (derived, shown in the proposal's notes).
 *  - Two anchors whose readings differ ask ANCHOR_TWO_READINGS bound to `date` or `time`, with both real values as options; the answer by text or
 *    the tap binds; readings that coincide ask nothing.
 *  - Each anchor is computed from the received_at of the turn that SAID it (a later turn's clock never moves it).
 *  - Decision 2 still holds: a day-only offset asks the time unless the clock is kept.
 *  - No re-reading (property): changing the words of a mention never changes the computed result; only the typed fields do.
 *  - Delegated professional (decision 15 as amended): the origin's own slot with "qualquer" moves to another free professional (no NO_CHANGE);
 *    "outro" excludes the current one; nobody free asks PROFESSIONAL_NOBODY_FREE keeping the rest of the plan; the proposal says who was chosen.
 * received_at: Monday 2031-03-10, 09:00 in São Paulo unless a case moves the clock. Invented names and sentences; no network, database or model. */
const reflexo: PilotServiceRow = { id: "srv-reflexo", name: "Reflexologia podal", durationMin: 50, priceCents: 9000 };
const cera: PilotServiceRow = { id: "srv-cera", name: "Banho de parafina", durationMin: 30, priceCents: 4000 };
const abelardo: PilotProfessionalRow = { id: "pro-abelardo", name: "Abelardo Juruena", serviceIds: [reflexo.id] };
const bernadete: PilotProfessionalRow = { id: "pro-bernadete", name: "Bernadete Quixadá", serviceIds: [reflexo.id, cera.id] };
const cassiano: PilotProfessionalRow = { id: "pro-cassiano", name: "Cassiano Urubatã", serviceIds: [reflexo.id] };
const dagoberto: PilotProfessionalRow = { id: "pro-dagoberto", name: "Dagoberto Jaraguá", serviceIds: [cera.id] };
const person = (id: string, name: string): PilotPerson => ({ id, name });
const ivonete = person("cli-ivonete", "Ivonete Barbalho"), gerusa = person("cli-gerusa", "Gerusa Tabajara"), clodoaldo = person("cli-clodoaldo", "Clodoaldo Mendanha");
const zila = person("cli-zila", "Zilá Cotegipe"), sulamita = person("cli-sulamita", "Sulamita Aroeira");
const MON = "2031-03-10", TUE = "2031-03-11", WED = "2031-03-12", THU = "2031-03-13", FRI = "2031-03-14";
const TEAM = [abelardo, bernadete, cassiano, dagoberto];
/** Ivonete: Thursday 15:00 (Bernadete); Gerusa: today 15:00 (Bernadete); Clodoaldo: Tuesday and Wednesday 10:00 (Abelardo); Zilá: Thursday 10:00
 * (Bernadete). Loads (Sulamita's): Thursday Abelardo 13:00 and Cassiano 12:00 (with Ivonete's, everyone has 1: the old preference for the current one would keep Bernadete); Friday Abelardo 12:00, Cassiano 12:00 and 13:00. */
const rows = () => [booked("apt-ivo", ivonete, bernadete, reflexo, THU, "15:00"), booked("apt-ger", gerusa, bernadete, reflexo, MON, "15:00"),
  booked("apt-clo-tue", clodoaldo, abelardo, reflexo, TUE, "10:00"), booked("apt-clo-wed", clodoaldo, abelardo, reflexo, WED, "10:00"),
  booked("apt-zil", zila, bernadete, reflexo, THU, "10:00"), booked("x-a-thu", sulamita, abelardo, reflexo, THU, "13:00"), booked("x-c-thu", sulamita, cassiano, reflexo, THU, "12:00"),
  booked("x-a-fri", sulamita, abelardo, reflexo, FRI, "12:00"), booked("x-c-fri-1", sulamita, cassiano, reflexo, FRI, "12:00"), booked("x-c-fri-2", sulamita, cassiano, reflexo, FRI, "13:00")];
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [ivonete, gerusa, clodoaldo, zila, sulamita], team: TEAM, catalog: [reflexo, cera],
  hours: Object.fromEntries(TEAM.map(pro => [pro.id, everyDay(["08:00", "20:00"])])), appointments: rows(), ...over });
/** A host over the in-memory salon with a clock the case can move; the scripted Luna answers the E2-B frames, the preparation proposes. */
function fake(frames: E2bInterpretation[], base: MemorySalon = salon()) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], settled: PilotReceipt[] = [], now = { clock: clockAt() };
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-e2b", userId: "user-e2b" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => now.clock,
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async receipt => { settled.push(receipt); },
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-x", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, model, now };
}
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b01", message });
const slot = (change: PilotResolvedChange | undefined) => change && { appointmentRef: change.appointmentRef, date: change.date, time: change.time, professionalRef: change.professionalRef };
const optionIds = (reply: PilotReply) => reply.view.questions[0]?.options?.map(option => option.id);
const at = (local: string) => clockAt(saoPauloInstant(local));
const session = (pilot: unknown) => ({ id: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b01", skill: "auto", expires: 1, turns: 0, cancelled: false, pilot });
const keep = e2bSameClock("no mesmo horário");
const forIvonete = (dia: E2bInterpretation["destino"]["dia"], hora: E2bInterpretation["destino"]["hora"] = keep) => e2bLuna({ cliente: { mencao: "Ivonete" }, destino: e2bTo(dia, hora) });
const forGerusa = (dia: E2bInterpretation["destino"]["dia"], hora: E2bInterpretation["destino"]["hora"]) => e2bLuna({ cliente: { mencao: "Gerusa" }, destino: e2bTo(dia, hora) });
const forZila = (dia: E2bInterpretation["destino"]["dia"], hora: E2bInterpretation["destino"]["hora"], profissional: E2bProfessional) =>
  e2bLuna({ cliente: { mencao: "Zilá" }, destino: e2bTo(dia, hora, profissional) });
const answer = (questionId: string, destino: E2bInterpretation["destino"], origem = e2bOrigin()) => e2bLuna({ tipo: "resposta", resposta_a: questionId, origem, destino });

describe("§11.1 an anchored day offset through the orchestrator (TWINS: only the anchor differs)", () => {
  it("one day after the APPOINTMENT (Thursday) → Friday 15:00, derived and shown in the proposal", async () => {
    const f = fake([forIvonete(e2bDays(1, ["origem"], "um dia depois do que ela tem marcado"))]);
    const reply = await send(f, "Realoca a Ivonete para um dia depois do que ela tem marcado, no mesmo horário");
    expect(reply.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ivo", date: FRI, time: "15:00", professionalRef: bernadete.id }]);
    expect(f.prepared[0].derived).toContain("date");
    expect(reply.view.fields?.date).toMatchObject({ value: FRI, provenance: "derived" });
    expect(f.prepared[0].notes.some(note => note.includes(formatDay(FRI, MON))), "the derived day is shown").toBe(true);
  });
  it("one day after TODAY → Tuesday 15:00, derived", async () => {
    const f = fake([forIvonete(e2bDays(1, ["hoje"], "amanhã"))]);
    const reply = await send(f, "Realoca a Ivonete para amanhã, no mesmo horário");
    expect(reply.view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ivo", date: TUE, time: "15:00", professionalRef: bernadete.id }]);
    expect(f.prepared[0].notes.some(note => note.includes(formatDay(TUE, MON)))).toBe(true);
  });
  it("decision 2 still holds: a day-only offset asks the time (nothing prepared); TWIN keeping the clock proposes", async () => {
    const asked = fake([forIvonete(e2bDays(1, ["origem"], "um dia depois do que ela tem marcado"), null)]);
    const reply = await send(asked, "Realoca a Ivonete para um dia depois do que ela tem marcado");
    expect(reply.code).toBe("ASKED_TIME_MISSING");
    expect(reply.view.questions).toEqual([expect.objectContaining({ field: "time" })]);
    expect(asked.prepared).toEqual([]);
    const kept = fake([forIvonete(e2bDays(1, ["origem"], "um dia depois do que ela tem marcado"))]);
    expect((await send(kept, "Realoca a Ivonete para um dia depois do que ela tem marcado, no mesmo horário")).view.status).toBe("proposal_ready");
  });
});

describe("§11.1 two anchors: asked with both real dates or clocks, bound to the field; answered by text or tap", () => {
  const twoReadings = () => forIvonete(e2bDays(1, ["origem", "hoje"], "um dia depois"));
  it("different readings ask ANCHOR_TWO_READINGS on `date` with Tuesday and Friday; nothing is prepared; the answer 'o dia 14' binds Friday", async () => {
    const f = fake([twoReadings(), answer("q1", e2bTo(e2bDate(14, null, "o dia 14"), null))]);
    const asked = await send(f, "Realoca a Ivonete para um dia depois, no mesmo horário");
    expect(asked.code).toBe("ASKED_ANCHOR_TWO_READINGS");
    expect(asked.view.questions).toEqual([expect.objectContaining({ questionId: "q1", field: "date", reason: "ANCHOR_TWO_READINGS" })]);
    expect(optionIds(asked)).toEqual([TUE, FRI]);
    for (const date of [TUE, FRI]) expect(asked.text, date).toContain(formatDay(date, MON));
    expect(f.prepared).toEqual([]);
    const bound = await send(f, "o dia 14");
    expect(bound.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ivo", date: FRI, time: "15:00", professionalRef: bernadete.id }]);
  });
  it("the tap on the other option binds Tuesday", async () => {
    const f = fake([twoReadings()]);
    const asked = await send(f, "Realoca a Ivonete para um dia depois, no mesmo horário");
    const tapped = await selectPilotOption(f.host, pilotOptionRef(asked.view.questions[0].questionId, TUE));
    expect(tapped.view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ivo", date: TUE, time: "15:00", professionalRef: bernadete.id }]);
  });
  it("TWIN: the appointment is TODAY (Gerusa, 15:00) → both readings are Tuesday → no question", async () => {
    const f = fake([forGerusa(e2bDays(1, ["origem", "hoje"], "um dia depois"), keep)]);
    const reply = await send(f, "Realoca a Gerusa para um dia depois, no mesmo horário");
    expect(reply.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ger", date: TUE, time: "15:00", professionalRef: bernadete.id }]);
  });
  it("the saved state with the anchored operator and the anchor question loads (strict shape)", async () => {
    const f = fake([twoReadings()]);
    await send(f, "Realoca a Ivonete para um dia depois, no mesmo horário");
    const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState;
    expect(storedSession.safeParse(session(saved)).success).toBe(true);
    expect(saved.pending?.destino.dia).toMatchObject({ tipo: "deslocamento", quantidade: 1, unidade: "dias", ancoras: ["origem", "hoje"], data_citada: null });
  });
});

describe("§11.1 clock offsets through the orchestrator (Gerusa today at 15:00; received_at 09:00)", () => {
  it("TWINS +90 min: from the appointment → 16:30; from now → 10:30 (both derived, shown)", async () => {
    const late = fake([forGerusa(null, e2bMinutes(90, ["origem"], "uma hora e meia mais tarde"))]);
    expect((await send(late, "A Gerusa fica uma hora e meia mais tarde")).view.status).toBe("proposal_ready");
    expect(late.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ger", date: MON, time: "16:30", professionalRef: bernadete.id }]);
    expect(late.prepared[0].derived).toContain("time");
    expect(late.prepared[0].notes.some(note => note.includes(formatClock("16:30")))).toBe(true);
    const soon = fake([forGerusa(null, e2bMinutes(90, ["agora"], "daqui a uma hora e meia"))]);
    expect((await send(soon, "A Gerusa vem daqui a uma hora e meia")).view.status).toBe("proposal_ready");
    expect(soon.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ger", date: MON, time: "10:30", professionalRef: bernadete.id }]);
  });
  it("TWINS -30 min: from the appointment → 14:30; from now it is already past → asked, nothing prepared", async () => {
    const earlier = fake([forGerusa(null, e2bMinutes(-30, ["origem"], "meia hora mais cedo"))]);
    await send(earlier, "A Gerusa vem meia hora mais cedo");
    expect(earlier.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ger", date: MON, time: "14:30", professionalRef: bernadete.id }]);
    const before = fake([forGerusa(null, e2bMinutes(-30, ["agora"], "meia hora atrás"))]);
    const reply = await send(before, "A Gerusa era pra meia hora atrás");
    expect((reply.code ?? "").startsWith("ASKED_")).toBe(true);
    expect(before.prepared).toEqual([]);
  });
  it("two clock anchors ask ANCHOR_TWO_READINGS on `time` with 10:30 and 16:30; the answer 16h30 binds it", async () => {
    const f = fake([forGerusa(null, e2bMinutes(90, ["origem", "agora"], "uma hora e meia depois")), answer("q1", e2bTo(null, e2bClock(16, "às 16h30", 30)))]);
    const asked = await send(f, "A Gerusa fica pra uma hora e meia depois");
    expect(asked.code).toBe("ASKED_ANCHOR_TWO_READINGS");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time", reason: "ANCHOR_TWO_READINGS" })]);
    expect(optionIds(asked)).toEqual(["10:30", "16:30"]);
    expect(f.prepared).toEqual([]);
    expect((await send(f, "às 16h30")).view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ger", date: MON, time: "16:30", professionalRef: bernadete.id }]);
  });
  it("ENCODED AMBIGUITY B: a clock from now with no day said carries now's day (Ivonete's Thursday appointment → today 11:00), never Thursday 11:00", async () => {
    const f = fake([forIvonete(null, e2bMinutes(120, ["agora"], "daqui a duas horas"))]);
    await send(f, "Traz a Ivonete pra daqui a duas horas");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-ivo", date: MON, time: "11:00", professionalRef: bernadete.id }]);
  });
});

describe("§11.1 each anchor is the received_at of the turn that SAID it", () => {
  it("'amanhã' said at 23:50, the appointment chosen after midnight: the turn's tomorrow (Tuesday), never Wednesday", async () => {
    const f = fake([e2bLuna({ cliente: { mencao: "Clodoaldo" }, destino: e2bTo(e2bDays(1, ["hoje"], "amanhã"), e2bClock(18, "às 18h")) }),
      answer("q1", e2bTo(null, null), e2bOrigin({ dia: e2bWeekday("quarta", "a de quarta") }))]);
    f.now.clock = at("2031-03-10T23:50");
    expect((await send(f, "Realoca o Clodoaldo para amanhã às 18h")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    f.now.clock = at("2031-03-11T00:10");
    expect((await send(f, "a de quarta")).view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-clo-wed", date: TUE, time: "18:00", professionalRef: abelardo.id }]);
  });
  it("'daqui a uma hora e meia' said at 09:00, the appointment chosen at 09:40: 10:30 (the first turn's now), never 11:10", async () => {
    const f = fake([e2bLuna({ cliente: { mencao: "Clodoaldo" }, destino: e2bTo(null, e2bMinutes(90, ["agora"], "daqui a uma hora e meia")) }),
      answer("q1", e2bTo(null, null), e2bOrigin({ dia: e2bWeekday("terca", "a de terça") }))]);
    expect((await send(f, "Traz o Clodoaldo pra daqui a uma hora e meia")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    f.now.clock = at("2031-03-10T09:40");
    expect((await send(f, "a de terça")).view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-clo-tue", date: MON, time: "10:30", professionalRef: abelardo.id }]);
  });
});

describe("no re-reading after Luna (property): the words of a mention never change the computed result; only the typed fields do", () => {
  const words = ["amanhã", "depois de amanhã", "a partir de hoje", "depois do atendimento dela", "dia 20", "semana que vem", "uma semana", "do horário marcado",
    "agora", "daqui a pouco", "q1", "origem", "hoje", "data_citada", "outra pessoa", "com quem estiver livre"];
  it("day: 24 seeded variants per anchor; origem always → Friday, hoje always → Tuesday", async () => {
    const random = e2bRandom(20311003), expected: Record<"origem" | "hoje", string> = { origem: FRI, hoje: TUE };
    for (const anchor of ["origem", "hoje"] as E2bDayAnchor[]) for (let round = 0; round < 24; round++) {
      const mencao = [0, 1].map(() => words[Math.floor(random() * words.length)]).join(" ");
      const f = fake([forIvonete(e2bDays(1, [anchor], mencao))]);
      await send(f, `Realoca a Ivonete para ${mencao}, no mesmo horário`);
      expect(f.prepared.map(slot), `${anchor}: ${mencao}`).toEqual([{ appointmentRef: "apt-ivo", date: expected[anchor as "origem" | "hoje"], time: "15:00", professionalRef: bernadete.id }]);
    }
  });
  it("clock: the same minutes and anchor with any words → the same clock", async () => {
    for (const mencao of words) {
      const f = fake([forGerusa(null, e2bMinutes(60, ["origem"], mencao))]);
      await send(f, `A Gerusa fica ${mencao}`);
      expect(f.prepared.map(change => change.time), mencao).toEqual(["16:00"]);
    }
  });
});

describe("§11.2 delegated professional through the orchestrator (decision 15 as amended)", () => {
  const sameSlotAny = () => forZila(null, null, { modo: "qualquer", mencao: null });
  it("'qualquer' at the origin's own day and clock moves to another free professional (a tie of 1 each: the name order, Abelardo; Bernadete is excluded as a fact), shown; never NO_CHANGE", async () => {
    const f = fake([sameSlotAny()]);
    const reply = await send(f, "A Zilá pode ser atendida por quem estiver livre, no mesmo horário");
    expect(reply.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(reply.code).not.toBe("ASKED_DESTINATION_MISSING");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-zil", date: THU, time: "10:00", professionalRef: abelardo.id }]);
    expect(f.prepared[0].derived).toContain("professional");
    expect(f.prepared[0].keepsProfessional).toBe(false);
    expect(f.prepared[0].notes.some(note => note.includes(abelardo.name)), "the proposal says who was chosen").toBe(true);
  });
  it("TWINS at Friday 16:00 (Bernadete 0, Abelardo 1, Cassiano 2): 'outro' → Abelardo; 'qualquer' → Bernadete (the current one may win when not excluded)", async () => {
    const other = fake([forZila(e2bWeekday("sexta", "sexta"), e2bClock(16, "às 16h"), { modo: "outro", mencao: null })]);
    await send(other, "A Zilá vai pra sexta às 16h com outra pessoa");
    expect(other.prepared.map(slot)).toEqual([{ appointmentRef: "apt-zil", date: FRI, time: "16:00", professionalRef: abelardo.id }]);
    const any = fake([forZila(e2bWeekday("sexta", "sexta"), e2bClock(16, "às 16h"), { modo: "qualquer", mencao: null })]);
    await send(any, "A Zilá vai pra sexta às 16h com quem estiver livre");
    expect(any.prepared.map(slot)).toEqual([{ appointmentRef: "apt-zil", date: FRI, time: "16:00", professionalRef: bernadete.id }]);
  });
  it("nobody free at the origin's slot: PROFESSIONAL_NOBODY_FREE, the rest of the plan kept, nothing prepared; another clock then proposes by the same rule", async () => {
    const busy = salon({ appointments: [...rows(), booked("x-a-slot", sulamita, abelardo, reflexo, THU, "10:00"), booked("x-c-slot", sulamita, cassiano, reflexo, THU, "10:00")] });
    const f = fake([sameSlotAny(), answer("q1", e2bTo(null, e2bClock(16, "às 16h"), { modo: "qualquer", mencao: null }))], busy);
    const asked = await send(f, "A Zilá pode ser atendida por quem estiver livre, no mesmo horário");
    expect(asked.code).toBe("ASKED_PROFESSIONAL_NOBODY_FREE");
    expect(asked.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_NOBODY_FREE" })]);
    expect(["time", "professional"]).toContain(asked.view.questions[0].field);
    for (const field of ["customer", "appointment", "date"] as const) expect(asked.view.fields?.[field].provenance, field).not.toBe("unresolved");
    expect(asked.view.fields?.professional.provenance).toBe("unresolved");
    expect(f.prepared).toEqual([]);
    // 16:00: Abelardo 2 (10:00, 13:00), Bernadete 1 (Ivonete 15:00), Cassiano 2 (10:00, 12:00) → the fewest: Bernadete (not the origin's slot any more).
    expect((await send(f, "pode ser às 16h com quem estiver livre")).view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-zil", date: THU, time: "16:00", professionalRef: bernadete.id }]);
  });
  it("control: a named professional is unchanged (explicit)", async () => {
    const f = fake([forZila(null, null, { modo: "nomeado", mencao: "Cassiano" })]);
    await send(f, "A Zilá fica com o Cassiano, no mesmo horário");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-zil", date: THU, time: "10:00", professionalRef: cassiano.id }]);
  });
  it("the saved state with mode 'outro' loads (strict shape)", async () => {
    const f = fake([forZila(e2bWeekday("sexta", "sexta"), e2bClock(16, "às 16h"), { modo: "outro", mencao: null })]);
    await send(f, "A Zilá vai pra sexta às 16h com outra pessoa");
    const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState;
    expect(storedSession.safeParse(session(saved)).success).toBe(true);
    expect(saved.pending?.destino.profissional).toEqual({ modo: "outro", mencao: null });
  });
});
