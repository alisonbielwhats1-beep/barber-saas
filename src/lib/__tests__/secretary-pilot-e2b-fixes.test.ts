import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { decodePilotInterpretation, PILOT_RESCHEDULE_TOOL, type PilotTempoDia } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { handlePilotMessage, pilotOptionRef, selectPilotOption, type PilotHost, type PilotReply, type PilotResolvedChange,
  type PilotSessionState } from "../secretary-pilot";
import { resolveAppointment, resolveProfessional, resolveTargetDate, type PilotAppointmentResolution, type PilotPerson, type PilotProfessionalResolution,
  type PilotProfessionalRow, type PilotServiceRow } from "../secretary-pilot-resolver";
import { storedSession } from "../secretary-session-state";
import { formatDay } from "../secretary-datetime-format";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bCited, e2bClock, e2bDate, e2bDays, e2bLuna, e2bMinutes, e2bOrigin, e2bSameClock, e2bTo, e2bWeekday, e2bWeeks, saoPauloInstant, wire, type E2bCited,
  type E2bDay, type E2bInterpretation, type E2bOrigin, type E2bProfessional } from "../../test/secretary-pilot-e2b";

/** Reschedule pilot E2-B, the fixes of the adversarial review (docs/c5-spike/12-piloto-remarcacao.md §11.3; Adendo 11), each written BEFORE its fix
 * with ADVERSARIAL TWINS (identical but for the one typed fact that must change the result). Never a reading of the owner's words: only typed
 * operators, the anchors the model listed, the frozen received_at, real records and the owner's own taps or answers.
 *  - PRINCIPLE-1: the day a clock counted from now settles (no day said) is kept by the plan; a later clock-only change keeps it (twin: a typed day).
 *  - PRINCIPLE-2 / RESOLVER-2 / REGRESSION-1: answering the day question of a clock offset with two anchors picks the anchor too (one question, never a
 *    clock that no anchor gives); twin: a day the owner said himself still asks both clocks.
 *  - PRINCIPLE-3 / PROFESSIONAL-3 / REGRESSION-2: "outro" with a team member's name excludes that member too (the role the contract gives the field).
 *  - PRINCIPLE-4 / PROPOSAL-6: the proposal says which anchor gave the day or clock, and names a reading left out because it already passed or leaves
 *    the day.
 *  - SEMANTICS-1: a cited day number already past this month is two readings (this month's and the next), never moved forward in silence; with its
 *    month, the occurrence nearest to today.
 *  - CONTRACT-4: the reference of a data_citada anchor may be a weekday or a day of a relative month (decision 27 readings of the reference).
 *  - RESOLVER-5: an origin hint that also lists the anchor origem filters by its other anchors.
 * received_at: Monday 2031-03-10, 09:00 in São Paulo unless a case moves it. Invented names and sentences; no network, database or model. */
const drenagem: PilotServiceRow = { id: "srv-dren", name: "Drenagem tibetana", durationMin: 50, priceCents: 9000 };
const arquimedes: PilotProfessionalRow = { id: "pro-a", name: "Arquimedes Pirapora", serviceIds: [drenagem.id] };
const belmira: PilotProfessionalRow = { id: "pro-b", name: "Belmira Caraguatá", serviceIds: [drenagem.id] };
const cristovao: PilotProfessionalRow = { id: "pro-c", name: "Cristóvão Itaporanga", serviceIds: [drenagem.id] };
const dulcineia: PilotProfessionalRow = { id: "pro-d", name: "Dulcinéia Ubatuba", serviceIds: [drenagem.id] };
const person = (id: string, name: string): PilotPerson => ({ id, name });
const odalisca = person("cli-o", "Odalisca Tremembé"), florisbela = person("cli-f", "Florisbela Jacarandá"), genesio = person("cli-g", "Genésio Paranapanema");
const iracilda = person("cli-i", "Iracilda Mogiana"), hermogenes = person("cli-h", "Hermógenes Taubaté");
const MON = "2031-03-10", TUE = "2031-03-11", WED = "2031-03-12", THU = "2031-03-13", FRI = "2031-03-14", SAT = "2031-03-08";
const TEAM = [arquimedes, belmira, cristovao, dulcineia];
/** Odalisca: Thursday 15:00 (Belmira); Iracilda: Tuesday 18/03 10:00 (Belmira); Genésio: Wednesday and Friday 10:00 (Arquimedes, his Friday is
 * Arquimedes' 1 that day); Hermógenes: Friday 12:00 with Dulcinéia (her 1). Friday 16:00: Arquimedes 1, Belmira 0, Cristóvão 0, Dulcinéia 1. */
const rows = () => [booked("apt-o", odalisca, belmira, drenagem, THU, "15:00"), booked("apt-i", iracilda, belmira, drenagem, "2031-03-18", "10:00"),
  booked("apt-g-wed", genesio, arquimedes, drenagem, WED, "10:00"), booked("apt-g-fri", genesio, arquimedes, drenagem, FRI, "10:00"),
  booked("x-h-fri", hermogenes, dulcineia, drenagem, FRI, "12:00")];
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [odalisca, florisbela, genesio, iracilda, hermogenes], team: TEAM, catalog: [drenagem],
  hours: Object.fromEntries(TEAM.map(pro => [pro.id, everyDay(["08:00", "20:00"])])), appointments: rows(), ...over });
function fake(frames: E2bInterpretation[], base: MemorySalon = salon()) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], now = { clock: clockAt() };
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-fix", userId: "user-fix" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => now.clock,
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async () => undefined,
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-x", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, now };
}
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b02", message });
const slot = (change: PilotResolvedChange | undefined) => change && { appointmentRef: change.appointmentRef, date: change.date, time: change.time, professionalRef: change.professionalRef };
const optionIds = (reply: PilotReply) => reply.view.questions[0]?.options?.map(option => option.id);
const at = (local: string) => clockAt(saoPauloInstant(local));
const keep = e2bSameClock("na hora de sempre");
const forOdalisca = (dia: E2bInterpretation["destino"]["dia"], hora: E2bInterpretation["destino"]["hora"], profissional?: E2bProfessional) =>
  e2bLuna({ cliente: { mencao: "Odalisca" }, destino: e2bTo(dia, hora, profissional) });
const answer = (questionId: string, destino: E2bInterpretation["destino"]) => e2bLuna({ tipo: "resposta", resposta_a: questionId, destino });
const session = (pilot: unknown) => ({ id: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b02", skill: "auto", expires: 1, turns: 0, cancelled: false, pilot });
const notesOf = (change: PilotResolvedChange | undefined) => (change?.notes ?? []).join("\n");

describe("PRINCIPLE-1: the day a clock counted from now settles is kept when only the clock changes later", () => {
  it("'daqui a duas horas' → Monday 11:00; the correction 'às 16h' (no day) keeps Monday, never Thursday (TWIN: a typed day is kept the same way)", async () => {
    const f = fake([forOdalisca(null, e2bMinutes(120, ["agora"], "daqui a duas horas")), e2bLuna({ destino: e2bTo(null, e2bClock(16, "às 16h")) })]);
    await send(f, "Põe a Odalisca daqui a duas horas");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: MON, time: "11:00", professionalRef: belmira.id }]);
    const corrected = await send(f, "Não, melhor às 16h");
    expect(corrected.view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot).at(-1)).toEqual({ appointmentRef: "apt-o", date: MON, time: "16:00", professionalRef: belmira.id });
    expect(notesOf(f.prepared.at(-1)), "the day kept is still shown").toContain(formatDay(MON, MON));
    const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState;
    expect(storedSession.safeParse(session(saved)).success, "the kept day loads (strict shape)").toBe(true);
    const typed = fake([forOdalisca(e2bDays(1, ["hoje"], "amanhã"), e2bClock(11, "às 11h")), e2bLuna({ destino: e2bTo(null, e2bClock(16, "às 16h")) })]);
    await send(typed, "Põe a Odalisca amanhã às 11h");
    await send(typed, "Não, melhor às 16h");
    expect(typed.prepared.map(change => [change.date, change.time])).toEqual([[TUE, "11:00"], [TUE, "16:00"]]);
  });
  it("said at 22:30 (no reading left): the question names Monday and its answer stays on Monday — a clock already past is asked again, never Thursday", async () => {
    const past = fake([forOdalisca(null, e2bMinutes(120, ["agora"], "daqui a duas horas")), answer("q1", e2bTo(null, e2bClock(10, "10h da manhã", 0, "manha")))]);
    past.now.clock = at(`${MON}T22:30`);
    const asked = await send(past, "Põe a Odalisca daqui a duas horas");
    expect(asked.code).toBe("ASKED_TIME_INVALID");
    expect(asked.text).toContain(formatDay(MON, MON));
    const again = await send(past, "10h da manhã");
    expect(again.code).toBe("ASKED_TIME_INVALID");
    expect(again.view.questions).toEqual([expect.objectContaining({ field: "time" })]);
    expect(past.prepared, "Thursday 10:00 is never proposed, nor a Monday clock already past").toEqual([]);
    // TWIN: an answer still ahead on the day the question named is proposed on that day.
    const ahead = fake([forOdalisca(null, e2bMinutes(120, ["agora"], "daqui a duas horas")), answer("q1", e2bTo(null, e2bClock(23, "às 23h")))]);
    ahead.now.clock = at(`${MON}T22:30`);
    await send(ahead, "Põe a Odalisca daqui a duas horas");
    await send(ahead, "às 23h");
    expect(ahead.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: MON, time: "23:00", professionalRef: belmira.id }]);
  });
});

describe("PRINCIPLE-2 / RESOLVER-2 / REGRESSION-1: the day question of a clock offset with two anchors settles the anchor too", () => {
  const twoAnchors = () => forOdalisca(null, e2bMinutes(120, ["origem", "agora"], "duas horas pra frente"));
  it("the day is asked with Monday (now) and Thursday (the appointment); tapping Monday proposes 11:00 at once, with no second question", async () => {
    const f = fake([twoAnchors()]);
    const asked = await send(f, "Joga a Odalisca duas horas pra frente");
    expect(asked.code).toBe("ASKED_ANCHOR_TWO_READINGS");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "ANCHOR_TWO_READINGS" })]);
    expect(optionIds(asked)).toEqual([MON, THU]);
    const tapped = await selectPilotOption(f.host, pilotOptionRef(asked.view.questions[0].questionId, MON));
    expect(tapped.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: MON, time: "11:00", professionalRef: belmira.id }]);
  });
  it("TWIN: tapping Thursday proposes the appointment's clock + 2h (17:00)", async () => {
    const f = fake([twoAnchors()]);
    const asked = await send(f, "Joga a Odalisca duas horas pra frente");
    await selectPilotOption(f.host, pilotOptionRef(asked.view.questions[0].questionId, THU));
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: THU, time: "17:00", professionalRef: belmira.id }]);
  });
  it("a typed answer naming Monday does the same (one question, 11:00); never a Monday 17:00 that no anchor gives", async () => {
    const f = fake([twoAnchors(), answer("q1", e2bTo(e2bDate(10, 3, "segunda, dia 10"), null))]);
    await send(f, "Joga a Odalisca duas horas pra frente");
    const bound = await send(f, "segunda, dia 10");
    expect(bound.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: MON, time: "11:00", professionalRef: belmira.id }]);
  });
  it("TWIN: a day the owner said himself with the same clock offset still asks both clocks on that day (both anchors plausible there)", async () => {
    const f = fake([forOdalisca(e2bDate(10, 3, "segunda, dia 10"), e2bMinutes(120, ["origem", "agora"], "duas horas pra frente"))]);
    const asked = await send(f, "Na segunda, dia 10: joga a Odalisca duas horas pra frente");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time", reason: "ANCHOR_TWO_READINGS" })]);
    expect(optionIds(asked)).toEqual(["11:00", "17:00"]);
  });
});

const ctxOf = (slotAt: { date: string; time: string } | null, current: PilotProfessionalRow = belmira) =>
  ({ current: { id: current.id, name: current.name }, appointmentId: "apt-o", serviceId: drenagem.id, durationMin: drenagem.durationMin, slot: slotAt, origin: { date: THU, time: "15:00" } });
const pick = (result: PilotProfessionalResolution) => result.state === "chosen" ? result.id : result.state;
const FRI_16 = { date: FRI, time: "16:00" };

describe("PRINCIPLE-3 / PROFESSIONAL-3 / REGRESSION-2: 'outro' with a member's name leaves that member out too (never a conflict offering them)", () => {
  const resolve = (profissional: E2bProfessional, base = salon()) => resolveProfessional(memoryReader(base), wire(profissional), ctxOf(FRI_16));
  it("TWINS on Friday 16:00 (Arquimedes 1, Cristóvão 0, Dulcinéia 1): 'outro' alone → Cristóvão; 'outro' without Cristóvão → Arquimedes (tie, name order)", async () => {
    expect(pick(await resolve({ modo: "outro", mencao: null }))).toBe(cristovao.id);
    expect(pick(await resolve({ modo: "outro", mencao: "Cristóvão" }))).toBe(arquimedes.id);
    expect(pick(await resolve({ modo: "outro", mencao: "Belmira" })), "the current one named: only she leaves").toBe(cristovao.id);
  });
  it("everyone else busy: nobody_free, saying who was left out by name; controls: 'qualquer' and 'manter' with another member's name are still asked", async () => {
    const busy = salon({ appointments: [...rows(), booked("x-a-16", hermogenes, arquimedes, drenagem, FRI, "16:00"), booked("x-d-16", hermogenes, dulcineia, drenagem, FRI, "16:00")] });
    expect(await resolve({ modo: "outro", mencao: "Cristóvão" }, busy)).toMatchObject({ state: "nobody_free", excluded: [{ id: cristovao.id }] });
    expect((await resolve({ modo: "qualquer", mencao: "Cristóvão" })).state).toBe("conflict");
    expect((await resolve({ modo: "manter", mencao: "Cristóvão" })).state).toBe("conflict");
  });
  it("through the orchestrator: a proposal with Arquimedes and no question; nobody free asks naming both left out", async () => {
    const frame = forOdalisca(e2bWeekday("sexta", "na sexta"), e2bClock(16, "às 16h"), { modo: "outro", mencao: "Cristóvão" });
    const f = fake([frame]);
    const reply = await send(f, "Passa a Odalisca pra sexta às 16h com outra pessoa, menos o Cristóvão");
    expect(reply.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: FRI, time: "16:00", professionalRef: arquimedes.id }]);
    const busy = fake([frame], salon({ appointments: [...rows(), booked("x-a-16", hermogenes, arquimedes, drenagem, FRI, "16:00"), booked("x-d-16", hermogenes, dulcineia, drenagem, FRI, "16:00")] }));
    const asked = await send(busy, "Passa a Odalisca pra sexta às 16h com outra pessoa, menos o Cristóvão");
    expect(asked.code).toBe("ASKED_PROFESSIONAL_NOBODY_FREE");
    expect(asked.text).toContain(belmira.name);
    expect(asked.text).toContain(cristovao.name);
    expect(asked.view.questions[0]?.options ?? []).not.toContainEqual(expect.objectContaining({ id: cristovao.id }));
    expect(busy.prepared).toEqual([]);
  });
});

describe("PRINCIPLE-4 / PROPOSAL-6: the proposal says which anchor gave the value, and names a reading left out", () => {
  it("TWINS, one anchor: the note says 'contando de hoje' or 'contando do dia do atendimento'", async () => {
    const today = fake([forOdalisca(e2bDays(1, ["hoje"], "um dia depois"), keep)]);
    await send(today, "A Odalisca vai um dia depois, na hora de sempre");
    expect(notesOf(today.prepared[0])).toMatch(new RegExp(`${formatDay(TUE, MON)}[^\\n]*contando de hoje`));
    const origin = fake([forOdalisca(e2bDays(1, ["origem"], "um dia depois"), keep)]);
    await send(origin, "A Odalisca vai um dia depois, na hora de sempre");
    expect(notesOf(origin.prepared[0])).toMatch(new RegExp(`${formatDay(FRI, MON)}[^\\n]*contando do dia do atendimento`));
  });
  it("two anchors, one already past (encoded ambiguity A as amended): the other is used and the past one is named in the proposal", async () => {
    const f = fake([forOdalisca(e2bDays(-2, ["origem", "hoje"], "dois dias antes"), keep)]);
    await send(f, "A Odalisca vai dois dias antes, na hora de sempre");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: TUE, time: "15:00", professionalRef: belmira.id }]);
    const notes = notesOf(f.prepared[0]);
    expect(notes).toContain("contando do dia do atendimento");
    expect(notes).toContain(formatDay(SAT, MON));
    expect(notes).toContain("já passou");
  });
  it("clock offsets: the note names the anchor; said at 22:00, a reading from now that leaves the day is named, the appointment's clock is used", async () => {
    const f = fake([forOdalisca(null, e2bMinutes(60, ["origem"], "uma hora depois"))]);
    await send(f, "A Odalisca vai uma hora depois");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: THU, time: "16:00", professionalRef: belmira.id }]);
    expect(notesOf(f.prepared[0])).toContain("contando do horário do atendimento");
    const late = fake([forOdalisca(null, e2bMinutes(180, ["agora", "origem"], "três horas depois"))]);
    late.now.clock = at(`${MON}T22:00`);
    await send(late, "A Odalisca vai três horas depois");
    expect(late.prepared.map(slot)).toEqual([{ appointmentRef: "apt-o", date: THU, time: "18:00", professionalRef: belmira.id }]);
    expect(notesOf(late.prepared[0])).toMatch(/contando do horário do atendimento/);
    expect(notesOf(late.prepared[0])).toMatch(/contando de agora/i);
  });
});

const day = (dia: E2bDay, origin = THU, said = clockAt()) => resolveTargetDate(wire<PilotTempoDia>(dia), { date: origin }, said);
const ask = (options: string[], mencao: string) => ({ state: "ask", options, reason: "ANCHOR_TWO_READINGS", mencao });
const one = (date: string, mencao: string) => ({ state: "one", date, provenance: "derived", mencao });

describe("SEMANTICS-1: a cited day is read where the owner may mean it, never moved forward in silence", () => {
  it("a day number already past this month (the 9th, said on the 10th): this month's and the next are both readings; different results are asked", () => {
    expect(day(e2bDays(3, ["data_citada"], "três dias depois do 9", e2bCited(9, null, "9")))).toEqual(ask([WED, "2031-04-12"], "três dias depois do 9"));
    expect(day(e2bDays(7, ["data_citada"], "uma semana depois do 8", e2bCited(8, null, "8")))).toEqual(ask(["2031-03-15", "2031-04-15"], "uma semana depois do 8"));
    // A result already past is no reading (and is named in the proposal): only next month's is left.
    expect(day(e2bDays(-3, ["data_citada"], "três dias antes do 9", e2bCited(9, null, "9")))).toEqual(one("2031-04-06", "três dias antes do 9"));
  });
  it("TWIN: a day number still ahead this month is one reading (this month's)", () => {
    expect(day(e2bDays(3, ["data_citada"], "três dias depois do 20", e2bCited(20, null, "20")))).toEqual(one("2031-03-23", "três dias depois do 20"));
    expect(day(e2bWeeks(4, ["data_citada"], "quatro semanas depois do 20", e2bCited(20, null, "20")))).toEqual(one("2031-04-17", "quatro semanas depois do 20"));
    expect(day(e2bDays(0, ["data_citada"], "no próprio dia 10", e2bCited(10, null, "10")))).toEqual(one(MON, "no próprio dia 10"));
  });
  it("with its month: the occurrence nearest to today (8/3 is two days ago, never next year's); a result already past is asked", () => {
    expect(day(e2bDays(7, ["data_citada"], "uma semana depois de 8/3", e2bCited(8, 3, "8/3")))).toEqual(one("2031-03-15", "uma semana depois de 8/3"));
    expect(day(e2bDays(-3, ["data_citada"], "três dias antes de 8/3", e2bCited(8, 3, "8/3")))).toEqual({ state: "invalid", reason: "DATE_PAST", mencao: "três dias antes de 8/3" });
    // Near the turn of the year the nearest is next year's.
    expect(day(e2bDays(7, ["data_citada"], "uma semana depois de 3/1", e2bCited(3, 1, "3/1")), "2031-12-30", at("2031-12-28T09:00"))).toEqual(one("2032-01-10", "uma semana depois de 3/1"));
  });
  it("beside another anchor, every reading of the cited day is offered (never an invented one)", () => {
    expect(day(e2bDays(2, ["data_citada", "hoje"], "dois dias depois do 9", e2bCited(9, null, "9")))).toEqual(ask([TUE, WED, "2031-04-11"], "dois dias depois do 9"));
  });
});

const weekdayRef = (dia_semana: "sexta" | "segunda", mencao: string, qualificador: "este" | "proximo" | null = null) =>
  ({ tipo: "dia_semana", dia_semana, qualificador, mencao }) as unknown as E2bCited;
const monthRef = (dia: number, meses: number, mencao: string) => ({ tipo: "mes_relativo", dia, meses, mencao }) as unknown as E2bCited;

describe("CONTRACT-4: the reference of a data_citada anchor may be a weekday or a day of a relative month (never a date Luna computed)", () => {
  it("the decoder accepts the literal, a weekday and a relative month as the reference; another operator, or extra keys, are rejected", () => {
    const move = (cited: unknown) => e2bLuna({ cliente: { mencao: "Odalisca" }, destino: e2bTo({ ...e2bDays(2, ["data_citada"], "dois dias depois"), data_citada: cited as E2bCited }, keep) });
    for (const cited of [e2bCited(20, null, "20"), weekdayRef("sexta", "da sexta"), weekdayRef("sexta", "desta sexta", "este"), monthRef(5, 1, "dia 5 do mês que vem")])
      expect(decodePilotInterpretation(structuredClone(move(cited))), JSON.stringify(cited)).toEqual(move(cited));
    for (const cited of [{ tipo: "mesmo_da_origem", mencao: "do dia dela" }, { tipo: "dia_semana", dia_semana: "sexta", qualificador: null, mencao: "da sexta", dia: 14 },
      { tipo: "deslocamento", quantidade: 1, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: "amanhã" }, { tipo: "dia_semana", dia_semana: 5, qualificador: null, mencao: "sexta" }])
      expect(() => decodePilotInterpretation(move(cited)), JSON.stringify(cited)).toThrow();
  });
  it("TWINS 'dois dias depois da sexta': the appointment on Tuesday 18/03 → Friday 14 or 21 (decision 27) → both results asked; on Thursday 13 → one Friday → Sunday 16", () => {
    const shift = e2bDays(2, ["data_citada"], "dois dias depois da sexta", weekdayRef("sexta", "da sexta"));
    expect(day(shift, "2031-03-18")).toEqual(ask(["2031-03-16", "2031-03-23"], "dois dias depois da sexta"));
    expect(day(shift, THU)).toEqual(one("2031-03-16", "dois dias depois da sexta"));
    // "este": only the first one after today.
    expect(day(e2bDays(2, ["data_citada"], "dois dias depois desta sexta", weekdayRef("sexta", "desta sexta", "este")), "2031-03-18")).toEqual(one("2031-03-16", "dois dias depois desta sexta"));
  });
  it("a weekday said on that very weekday also reads as today; a relative month is one reading", () => {
    expect(day(e2bDays(2, ["data_citada"], "dois dias depois de segunda", weekdayRef("segunda", "de segunda")))).toEqual(ask([WED, "2031-03-19"], "dois dias depois de segunda"));
    expect(day(e2bWeeks(1, ["data_citada"], "uma semana depois do dia 5 do mês que vem", monthRef(5, 1, "dia 5 do mês que vem")))).toEqual(one("2031-04-12", "uma semana depois do dia 5 do mês que vem"));
  });
  it("the mention never decides (property): other words in the reference, the same typed fields → the same result", () => {
    const base = day(e2bDays(2, ["data_citada"], "x", weekdayRef("sexta", "da sexta")), "2031-03-18");
    for (const words of ["do dia 9", "de hoje", "do atendimento", "amanhã", "da segunda", "origem"])
      expect({ ...day(e2bDays(2, ["data_citada"], "x", weekdayRef("sexta", words)), "2031-03-18") }, words).toEqual(base);
  });
  it("through the orchestrator: both results asked on `date`, each labelled with the Friday it counts from; the tap binds", async () => {
    const f = fake([e2bLuna({ cliente: { mencao: "Iracilda" }, destino: e2bTo(e2bDays(2, ["data_citada"], "dois dias depois da sexta", weekdayRef("sexta", "da sexta")), keep) })]);
    const asked = await send(f, "A Iracilda vai dois dias depois da sexta, na hora de sempre");
    expect(asked.code).toBe("ASKED_ANCHOR_TWO_READINGS");
    expect(optionIds(asked)).toEqual(["2031-03-16", "2031-03-23"]);
    expect(asked.view.questions[0].options?.[0].label).toContain(formatDay(FRI, MON));
    expect(asked.view.questions[0].options?.[1].label).toContain(formatDay("2031-03-21", MON));
    await selectPilotOption(f.host, pilotOptionRef(asked.view.questions[0].questionId, "2031-03-23"));
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-i", date: "2031-03-23", time: "10:00", professionalRef: belmira.id }]);
  });
});

describe("RESOLVER-5: an origin hint that also lists the anchor origem filters by its other anchor(s)", () => {
  const locate = (customer: PilotPerson, origem: E2bOrigin, message: string, base = salon()) =>
    resolveAppointment(memoryReader(base), wire<Parameters<typeof resolveAppointment>[1]>({ customerId: customer.id, origem, message, catalog: [drenagem] }), clockAt());
  const picked = (result: PilotAppointmentResolution) => result.state === "one" ? result.appointment.id : result.state === "several" ? result.options.map(row => row.id).sort() : result.state;
  it("TWINS, Genésio (Wednesday and Friday): +4 from today → Friday's, with or without origem listed beside it (never both asked)", async () => {
    expect(picked(await locate(genesio, e2bOrigin({ dia: e2bDays(4, ["hoje"], "a que cai em quatro dias") }), "A que cai em quatro dias do Genésio passa pra sábado"))).toBe("apt-g-fri");
    expect(picked(await locate(genesio, e2bOrigin({ dia: e2bDays(4, ["hoje", "origem"], "a que cai em quatro dias") }), "A que cai em quatro dias do Genésio passa pra sábado"))).toBe("apt-g-fri");
  });
  it("only Wednesday's left and the hint says Thursday: none (asked), with or without origem listed — never Wednesday's bound against the hint", async () => {
    const onlyWed = salon({ appointments: [booked("apt-g-wed", genesio, arquimedes, drenagem, WED, "10:00")] });
    for (const anchors of [["hoje"], ["hoje", "origem"]] as const)
      expect(picked(await locate(genesio, e2bOrigin({ dia: e2bDays(3, [...anchors], "a que cai em três dias") }), "A que cai em três dias do Genésio passa pra sábado", onlyWed)), String(anchors)).toBe("none");
    for (const anchors of [["data_citada"], ["data_citada", "origem"]] as const)
      expect(picked(await locate(genesio, e2bOrigin({ dia: e2bDays(1, [...anchors], "a do dia seguinte ao 12", e2bCited(12, null, "12")) }), "A do dia seguinte ao 12 do Genésio passa pra sábado", onlyWed)), String(anchors)).toBe("none");
  });
  it("control: origem alone still says nothing about the origin (both of his asked)", async () => {
    expect(picked(await locate(genesio, e2bOrigin({ dia: e2bDays(1, ["origem"], "a de um dia depois") }), "A de um dia depois do Genésio passa pra sábado"))).toEqual(["apt-g-fri", "apt-g-wed"]);
  });
});
