import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { decodePilotInterpretation, PILOT_RESCHEDULE_TOOL, type PilotTempoDia, type PilotTempoHora } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { handlePilotMessage, type PilotHost, type PilotReply, type PilotResolvedChange, type PilotSessionState } from "../secretary-pilot";
import { resolveTargetDate, resolveTargetTime, type PilotDateResolution, type PilotPerson, type PilotProfessionalRow, type PilotServiceRow } from "../secretary-pilot-resolver";
import { formatDay } from "../secretary-datetime-format";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bCited, e2bClock, e2bDate, e2bDays, e2bMinutes, e2bSameClock, e2bSameDay, e2bWeekday, e2bWeeks, saoPauloInstant, wire, type E2bClock,
  type E2bDay } from "../../test/secretary-pilot-e2b";
import { e2b2Luna, e2b2OpenDay, e2b2To, E2B2_REASONS, type E2b2Destination, type E2b2Interpretation } from "../../test/secretary-pilot-e2b2";

/** Reschedule pilot, completion of E2-B — owner requirement 1 (ONE general temporal model: operation + explicit anchor + value; the model identifies the
 * relation, the code computes) and 3 (one question per ambiguity), audited item by item. Written BEFORE the fix, each with ADVERSARIAL TWINS (identical
 * but for the one typed fact that must flip the result). Never a reading of the owner's words: typed operators, the anchors the model listed, the frozen
 * received_at, real records and the owner's own answers only.
 *  - GAP 1.a (ASK if the anchor is missing): the contract has no way to say "an operation with no anchor the contract has" (ancoras needs ≥ 1), so the
 *    model must invent one; with `ancoras: []` the day or the clock is asked (ANCHOR_MISSING), never computed. Twin: one anchor → derived.
 *  - GAP 1.b (never silently inherit the old day after it was dropped): the day has no "left open" operator (the clock has `a_definir`), so a dropped
 *    day silently keeps the old one. Twin: a time-only correction keeps the day.
 *  - GAP 1.c (one general model): a day number with its month said outright ("data") is pushed a year in silence, while the very same reference as an
 *    anchor (data_citada, §11.3 SEMANTICS-1) is asked; a day number already past this month moves a month with no word in the proposal.
 *  - GAP 1.d (a later time-only correction must NOT erase a resolved day): the day a clock counted from now settled is erased by a later clock offset
 *    counted from the appointment (the appointment's day comes back in silence). Twin: a typed day is kept.
 *  - GAP 1.e + 3 (a later correction incompatible with the earlier day → ONE question that resolves it): "sexta" then a clock counted from now is asked
 *    as a clock on Friday only; the day the later clock gives is never offered.
 *  - COVERED evidence: a resolved day survives a time-only correction for every way it was said; a day correction after a clock from now asks the
 *    clock (never pastes it on another day); the orchestrator reads the owner's message only through the narrow provenance check.
 * received_at: Monday 2031-03-10, 09:00 in São Paulo. Vitalina: Thursday 13/03 15:00 with Abdênago. Invented names and sentences; no network,
 * database or model. */
const argila: PilotServiceRow = { id: "srv-argila", name: "Banho de argila verde", durationMin: 50, priceCents: 9000 };
const abdenago: PilotProfessionalRow = { id: "pro-ab", name: "Abdênago Iguaçu", serviceIds: [argila.id] };
const lucrecia: PilotProfessionalRow = { id: "pro-be", name: "Lucrécia Mearim", serviceIds: [argila.id] };
const vitalina: PilotPerson = { id: "cli-v", name: "Vitalina Corumbá" };
const MON = "2031-03-10", TUE = "2031-03-11", THU = "2031-03-13", FRI = "2031-03-14", SAT = "2031-03-15";
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [vitalina], team: [abdenago, lucrecia], catalog: [argila],
  hours: { [abdenago.id]: everyDay(["08:00", "20:00"]), [lucrecia.id]: everyDay(["08:00", "20:00"]) },
  appointments: [booked("apt-v", vitalina, abdenago, argila, THU, "15:00")], ...over });
function fake(frames: E2b2Interpretation[], base: MemorySalon = salon()) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], now = { clock: clockAt() };
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-e2b2-time", userId: "user-e2b2-time" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => now.clock,
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async () => undefined,
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-v", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, now, model };
}
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b07", message });
const slot = (change: PilotResolvedChange | undefined) => change && { date: change.date, time: change.time };
const optionIds = (reply: PilotReply) => reply.view.questions[0]?.options?.map(option => option.id) ?? [];
const notesOf = (change: PilotResolvedChange | undefined) => (change?.notes ?? []).join("\n");
const forVitalina = (dia: E2b2Destination["dia"], hora: E2bClock | null) => e2b2Luna({ cliente: { mencao: "Vitalina" }, destino: e2b2To(dia, hora) });
const correction = (dia: E2b2Destination["dia"], hora: E2bClock | null) => e2b2Luna({ destino: e2b2To(dia, hora) });
const ORIGIN = { date: THU, time: "15:00" };

describe("GAP 1.a — ASK if the anchor is missing: an offset whose anchor the owner did not give (ancoras []) is asked, never computed", () => {
  it("contract: a day or clock offset with no anchor decodes (TWIN: one anchor, as today); with a cited reference and no anchor it is a rule failure", () => {
    const day = (ancoras: string[], cited: unknown = null) => forVitalina({ ...e2bDays(2, [], "dois dias depois"), ancoras: ancoras as never, data_citada: cited as never }, e2bSameClock("na mesma hora"));
    const clock = (ancoras: string[]) => forVitalina(null, { ...e2bMinutes(60, [], "uma hora mais tarde"), ancoras: ancoras as never });
    expect(decodePilotInterpretation(structuredClone(day(["hoje"])))).toEqual(day(["hoje"]));
    expect(decodePilotInterpretation(structuredClone(clock(["origem"])))).toEqual(clock(["origem"]));
    expect(decodePilotInterpretation(structuredClone(day([]))), "no anchor said: a typed fact the contract must be able to carry").toEqual(day([]));
    expect(decodePilotInterpretation(structuredClone(clock([])))).toEqual(clock([]));
    expect(() => decodePilotInterpretation(day([], e2bCited(20, null, "20"))), "a cited reference needs the data_citada anchor").toThrow();
  });
  it("resolver: no anchor → asked with ANCHOR_MISSING (never the appointment's or today's reading); TWIN with one anchor → derived", async () => {
    const date = (shift: E2bDay) => resolveTargetDate(wire<PilotTempoDia>(shift), ORIGIN, clockAt());
    expect(date(e2bDays(2, ["origem"], "dois dias depois"))).toEqual({ state: "one", date: SAT, provenance: "derived", mencao: "dois dias depois" });
    expect(date(e2bDays(2, [], "dois dias depois"))).toMatchObject({ state: "ask", reason: E2B2_REASONS.anchorMissing, mencao: "dois dias depois" });
    expect(date(e2bWeeks(-1, [], "uma semana antes"))).toMatchObject({ state: "ask", reason: E2B2_REASONS.anchorMissing });
    const time = (shift: E2bClock) => resolveTargetTime(memoryReader(salon()), wire<PilotTempoHora>(shift), { origin: ORIGIN, date: FRI, professionalId: abdenago.id, clock: clockAt() });
    expect(await time(e2bMinutes(60, ["origem"], "uma hora mais tarde"))).toEqual({ state: "one", time: "16:00", provenance: "derived", mencao: "uma hora mais tarde" });
    expect(await time(e2bMinutes(60, [], "uma hora mais tarde"))).toMatchObject({ state: "ask", reason: E2B2_REASONS.anchorMissing, mencao: "uma hora mais tarde" });
  });
  it("orchestrator: 'amanhã às 10h' proposed; a later clock offset with no anchor asks the TIME (ANCHOR_MISSING), keeps Tuesday, prepares nothing; TWIN anchored on the appointment's clock → Tuesday 16:00", async () => {
    const twin = fake([forVitalina(e2bDays(1, ["hoje"], "amanhã"), e2bClock(10, "às 10h", 0, "manha")), correction(null, e2bMinutes(60, ["origem"], "uma hora depois do horário dela"))]);
    await send(twin, "A Vitalina vai amanhã às 10h da manhã");
    await send(twin, "Faz uma hora depois do horário dela");
    expect(twin.prepared.map(slot)).toEqual([{ date: TUE, time: "10:00" }, { date: TUE, time: "16:00" }]);
    const f = fake([forVitalina(e2bDays(1, ["hoje"], "amanhã"), e2bClock(10, "às 10h", 0, "manha")), correction(null, e2bMinutes(60, [], "uma hora mais tarde"))]);
    await send(f, "A Vitalina vai amanhã às 10h da manhã");
    expect(f.prepared.map(slot)).toEqual([{ date: TUE, time: "10:00" }]);
    const asked = await send(f, "Joga uma hora mais tarde");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time", reason: E2B2_REASONS.anchorMissing })]);
    expect(asked.view.fields?.date).toMatchObject({ value: TUE });
    expect(f.prepared, "nothing computed from an anchor nobody said").toHaveLength(1);
  });
});

describe("GAP 1.b — never silently inherit the old day after the owner dropped it: the day can be left open (a_definir) and is then asked", () => {
  it("contract: destino.dia { tipo: 'a_definir' } decodes, like the clock's", () => {
    const frame = correction(e2b2OpenDay("vê outro dia"), null);
    expect(decodePilotInterpretation(structuredClone(frame))).toEqual(frame);
  });
  it("resolver: a day left open is asked, never the appointment's day", () => {
    expect(resolveTargetDate(wire<PilotTempoDia>(e2b2OpenDay("outro dia")), ORIGIN, clockAt())).toMatchObject({ state: "ask" });
  });
  it("orchestrator: 'sexta às 10h' proposed; the day dropped → the day is asked, Friday never kept nor proposed again; TWIN: a time-only correction keeps Friday", async () => {
    const twin = fake([forVitalina(e2bWeekday("sexta", "pra sexta"), e2bClock(10, "às 10h", 0, "manha")), correction(null, e2bClock(16, "às 16h"))]);
    await send(twin, "Passa a Vitalina pra sexta às 10h da manhã");
    await send(twin, "Não, às 16h");
    expect(twin.prepared.map(slot)).toEqual([{ date: FRI, time: "10:00" }, { date: FRI, time: "16:00" }]);
    const f = fake([forVitalina(e2bWeekday("sexta", "pra sexta"), e2bClock(10, "às 10h", 0, "manha")), correction(e2b2OpenDay("vê outro dia"), null)]);
    await send(f, "Passa a Vitalina pra sexta às 10h da manhã");
    expect(f.prepared.map(slot)).toEqual([{ date: FRI, time: "10:00" }]);
    const asked = await send(f, "Esquece esse dia, vê outro dia");
    expect(asked.view.status).not.toBe("proposal_ready");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date" })]);
    expect(asked.view.fields?.date.provenance).toBe("unresolved");
    expect(f.prepared).toHaveLength(1);
  });
});

const shape = (result: PilotDateResolution) => result.state === "one" ? { state: "one", date: result.date } : result.state === "ask" ? { state: "ask", options: result.options } : { state: "invalid" };
describe("GAP 1.c — one general model: a reference said outright resolves like the same reference used as an anchor (never pushed in silence)", () => {
  it("TWINS (a date vs a zero offset from the same cited date): ahead, passed this month, with its month ahead or passed, a day the month lacks, a relative month", () => {
    const outright = (dia: E2bDay, at = clockAt()) => shape(resolveTargetDate(wire<PilotTempoDia>(dia), ORIGIN, at));
    const anchored = (cited: unknown, at = clockAt()) => shape(resolveTargetDate(wire<PilotTempoDia>(e2bDays(0, ["data_citada"], "nesse dia", cited as never)), ORIGIN, at));
    const april10 = clockAt(saoPauloInstant("2031-04-10T09:00"));
    const cases: [string, E2bDay, unknown, ReturnType<typeof clockAt>?][] = [
      ["dia 14 (ahead)", e2bDate(14, null, "dia 14"), e2bCited(14, null, "14")],
      ["dia 3 (passed this month)", e2bDate(3, null, "dia 3"), e2bCited(3, null, "3")],
      ["20/4 (ahead)", e2bDate(20, 4, "20/4"), e2bCited(20, 4, "20/4")],
      ["9/3 (yesterday, with its month)", e2bDate(9, 3, "9/3"), e2bCited(9, 3, "9/3")],
      ["5/1 (passed this year, with its month)", e2bDate(5, 1, "5/1"), e2bCited(5, 1, "5/1")],
      ["dia 31 said in April (the month lacks it)", e2bDate(31, null, "dia 31"), e2bCited(31, null, "31"), april10],
      ["dia 5 do mês que vem", { tipo: "mes_relativo", dia: 5, meses: 1, mencao: "dia 5 do mês que vem" }, { tipo: "mes_relativo", dia: 5, meses: 1, mencao: "dia 5 do mês que vem" }],
    ];
    const differ = cases.filter(([, dia, cited, at]) => JSON.stringify(outright(dia, at)) !== JSON.stringify(anchored(cited, at))).map(([label]) => label);
    expect(differ, "the same reference must give the same day (or the same question) both ways").toEqual([]);
  });
  it("a day number already past this month, said outright, names the reading left out (as a cited one does, §11.3 PRINCIPLE-4); TWIN ahead: no such note", async () => {
    const ahead = fake([forVitalina(e2bDate(20, null, "dia 20"), e2bClock(14, "às 14h"))]);
    await send(ahead, "A Vitalina passa pro dia 20 às 14h");
    expect(ahead.prepared.map(slot)).toEqual([{ date: "2031-03-20", time: "14:00" }]);
    expect(notesOf(ahead.prepared[0])).not.toContain("já passou");
    const passed = fake([forVitalina(e2bDate(3, null, "dia 3"), e2bClock(14, "às 14h"))]);
    await send(passed, "A Vitalina passa pro dia 3 às 14h");
    expect(passed.prepared.map(slot)).toEqual([{ date: "2031-04-03", time: "14:00" }]);
    expect(notesOf(passed.prepared[0]), "the month was computed, never in silence").toContain("já passou");
    expect(notesOf(passed.prepared[0])).toContain(formatDay("2031-03-03", MON));
  });
});

describe("GAP 1.d — a later time-only correction never erases a day already resolved (however it was resolved)", () => {
  it("'daqui a duas horas' settled Monday; a later clock counted from the appointment keeps Monday (or asks offering it), never Thursday in silence; TWIN: a typed day is kept", async () => {
    const typed = fake([forVitalina(e2bDays(1, ["hoje"], "amanhã"), e2bClock(11, "às 11h")), correction(null, e2bMinutes(60, ["origem"], "uma hora depois do horário dela"))]);
    await send(typed, "Põe a Vitalina amanhã às 11h");
    await send(typed, "Faz uma hora depois do horário dela");
    expect(typed.prepared.map(slot)).toEqual([{ date: TUE, time: "11:00" }, { date: TUE, time: "16:00" }]);
    const f = fake([forVitalina(null, e2bMinutes(120, ["agora"], "daqui a duas horas")), correction(null, e2bMinutes(60, ["origem"], "uma hora depois do horário dela"))]);
    await send(f, "Põe a Vitalina daqui a duas horas");
    expect(f.prepared.map(slot)).toEqual([{ date: MON, time: "11:00" }]);
    const reply = await send(f, "Faz uma hora depois do horário dela");
    const proposed = f.prepared.length === 2 ? f.prepared[1].date : null;
    expect(proposed, "the appointment's day never comes back in silence").not.toBe(THU);
    expect(proposed === MON || (reply.view.questions[0]?.field === "date" && optionIds(reply).includes(MON)), "Monday kept, or asked with Monday offered").toBe(true);
  });
  // COVERED evidence: every way of saying the day, then a clock-only correction (a clock, the appointment's own clock, a clock left open).
  const DAYS: [string, E2bDay | null, E2bClock, string][] = [
    ["data", e2bDate(14, null, "dia 14"), e2bClock(14, "às 14h"), FRI],
    ["mes_relativo", { tipo: "mes_relativo", dia: 20, meses: 0, mencao: "dia 20 deste mês" }, e2bClock(14, "às 14h"), "2031-03-20"],
    ["dia_semana este", e2bWeekday("sexta", "nesta sexta", "este"), e2bClock(14, "às 14h"), FRI],
    ["dia_semana (one reading)", e2bWeekday("sabado", "no sábado"), e2bClock(14, "às 14h"), SAT],
    ["mesmo_da_origem", e2bSameDay("no mesmo dia"), e2bClock(12, "às 12h"), THU],
    ["deslocamento hoje", e2bDays(1, ["hoje"], "amanhã"), e2bClock(14, "às 14h"), TUE],
    ["deslocamento origem", e2bDays(2, ["origem"], "dois dias depois do dela"), e2bClock(14, "às 14h"), SAT],
    ["deslocamento semanas origem", e2bWeeks(1, ["origem"], "uma semana depois do dela"), e2bClock(14, "às 14h"), "2031-03-20"],
    ["deslocamento data_citada", e2bDays(0, ["data_citada"], "no dia 20", e2bCited(20, null, "20")), e2bClock(14, "às 14h"), "2031-03-20"],
    ["clock from now (no day)", null, e2bMinutes(120, ["agora"], "daqui a duas horas"), MON],
  ];
  it.each(DAYS)("%s: the day stays when only the clock changes (a clock, the appointment's clock, a clock left open)", async (_label, dia, hora, expected) => {
    // (the appointment's own clock on its own day would be no change at all: that pair is left out)
    for (const [later, time] of ([[e2bClock(17, "às 17h"), "17:00"], [e2bSameClock("no horário de sempre"), "15:00"]] as const).filter(([later]) => !(expected === THU && later.tipo === "mesmo_da_origem"))) {
      const f = fake([forVitalina(dia, hora), correction(null, later)]);
      await send(f, "Remarca a Vitalina");
      expect(f.prepared[0]?.date).toBe(expected);
      await send(f, "Só muda o horário");
      expect(slot(f.prepared.at(-1)), `${_label} → ${later.tipo}`).toEqual({ date: expected, time });
    }
    const open = fake([forVitalina(dia, hora), correction(null, { tipo: "a_definir", mencao: "outro horário" })]);
    await send(open, "Remarca a Vitalina");
    const asked = await send(open, "Vê outro horário");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time" })]);
    expect(asked.view.fields?.date.value, "the day stays while the clock is asked").toBe(expected);
  });
});

describe("GAP 1.e + requirement 3 — a later correction incompatible with the day said before: asked once, with the question that resolves it", () => {
  it("'sexta às 10h' then 'daqui a duas horas' (now's clock is today's): nothing prepared, and the one question lets the owner take today (Monday 11h); TWIN from the appointment's clock: Friday 17h", async () => {
    const twin = fake([forVitalina(e2bWeekday("sexta", "pra sexta"), e2bClock(10, "às 10h", 0, "manha")), correction(null, e2bMinutes(120, ["origem"], "duas horas depois do horário dela"))]);
    await send(twin, "Passa a Vitalina pra sexta às 10h da manhã");
    await send(twin, "Melhor duas horas depois do horário dela");
    expect(twin.prepared.map(slot)).toEqual([{ date: FRI, time: "10:00" }, { date: FRI, time: "17:00" }]);
    const f = fake([forVitalina(e2bWeekday("sexta", "pra sexta"), e2bClock(10, "às 10h", 0, "manha")), correction(null, e2bMinutes(120, ["agora"], "daqui a duas horas"))]);
    await send(f, "Passa a Vitalina pra sexta às 10h da manhã");
    const reply = await send(f, "Melhor daqui a duas horas");
    expect(f.prepared).toHaveLength(1);
    expect(reply.view.questions).toHaveLength(1);
    expect(optionIds(reply).includes(MON) || reply.text.includes(formatDay(MON, MON)), "the question offers the day the later clock gives (one answer settles it)").toBe(true);
  });
  it("COVERED: 'daqui a duas horas' (Monday 11h) then 'na sexta': the clock is asked on Friday, never Friday 11h (now's clock pasted on another day)", async () => {
    const f = fake([forVitalina(null, e2bMinutes(120, ["agora"], "daqui a duas horas")), correction(e2bWeekday("sexta", "na sexta"), null)]);
    await send(f, "Põe a Vitalina daqui a duas horas");
    const reply = await send(f, "Na verdade na sexta");
    expect(reply.view.questions).toEqual([expect.objectContaining({ field: "time" })]);
    expect(f.prepared.map(slot)).toEqual([{ date: MON, time: "11:00" }]);
  });
});

describe("requirement 5 — no linguistic re-reading after the model (structure of the sources)", () => {
  const source = (file: string) => readFileSync(file, "utf8");
  it("the orchestrator reads the owner's message only through the narrow provenance check; observacoes only as a count; a separate request's words only shown", () => {
    const pilot = source("src/lib/secretary-pilot.ts");
    expect((pilot.match(/ctx\.message/g) ?? []).length).toBe((pilot.match(/pilotMentionIn\(ctx\.message,/g) ?? []).length);
    expect((pilot.match(/input\.message/g) ?? []).length, "the request to the model and the turn context only").toBe(2);
    expect(pilot.match(/\.observacoes(?!\.length)/g) ?? []).toEqual([]);
    expect(pilot.match(/\.pedido\b/g)?.length).toBe(pilot.match(/\.map\(item => item\.pedido\)/g)?.length);
  });
  it("no text test, match, search or prefix check is applied to the owner's words or a mention in the orchestrator, the resolver or the reducer", () => {
    for (const file of ["src/lib/secretary-pilot.ts", "src/lib/secretary-pilot-resolver.ts", "src/lib/secretary-pilot-plan.ts"]) {
      const text = source(file);
      expect(text.match(/\.(?:test|exec|match|matchAll|search)\([^)]*(?:mencao|message|observacoes|pedido)/g) ?? [], file).toEqual([]);
      expect(text.match(/(?:mencao|message|observacoes|pedido)[\w.?]*\.(?:match|matchAll|search|startsWith|endsWith|includes|split|replace|toLowerCase|normalize)\(/g) ?? [], file).toEqual([]);
    }
  });
});
