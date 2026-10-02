import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { decodePilotInterpretation, PilotContractError, PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { pilotRepairText, PILOT_REPAIR_RULES } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { handlePilotMessage, pilotOptionRef, selectPilotOption, PILOT_TOO_LARGE_REPLY, PILOT_DIRECTORY_UNAVAILABLE, type PilotHost, type PilotReply,
  type PilotResolvedChange, type PilotSessionState } from "../secretary-pilot";
import type { PilotPerson, PilotProfessionalRow, PilotReader, PilotServiceRow } from "../secretary-pilot-resolver";
import { parseStoredAggregate, storedSession, STORED_AGGREGATE_SCHEMA } from "../secretary-session-state";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bClock, e2bDays, e2bMinutes, e2bWeekday, saoPauloInstant, type E2bClock } from "../../test/secretary-pilot-e2b";
import { e2b2Luna, e2b2Pro, e2b2To, type E2b2Destination, type E2b2Interpretation } from "../../test/secretary-pilot-e2b2";

/** Reschedule pilot, completion of E2-B (docs/c5-spike/12-piloto-remarcacao.md §11.4+): the implementer's regression tests for the mechanisms the
 * completion added beyond the audit's gap tests, each with a TWIN. Never a reading of the owner's words: typed operators, the order of the messages,
 * the frozen received_at, real records and the owner's own taps.
 *  - §11.6: the DATE_CLOCK_CONFLICT question settles the clock's anchor too (now's own day keeps "agora"; the day said before keeps the others).
 *  - §11.5: a clock-settled day follows a NEW clock counted from now (its own day), and stays for any other clock.
 *  - §11.7: an exclusion that names nobody for sure is asked with no option (a tap would make that person the one who attends).
 *  - §11.7: the exclusion list goes only with a delegated mode (a rule of the contract, with its fixed repair sentence).
 *  - §11.8: a team or catalog past the reader's bound, and a request past the cap, fail safely saying it is about size; a state saved before the
 *    exclusion list loads with `excluidos: []`.
 * received_at: Monday 2031-03-10, 09:00 in São Paulo. Eustórgia: Thursday 13/03 15:00 with Tibúrcia. Invented names; no network, database or model. */
const escalda: PilotServiceRow = { id: "srv-escalda", name: "Escalda-pés de alecrim", durationMin: 50, priceCents: 7000 };
const pro = (id: string, name: string): PilotProfessionalRow => ({ id, name, serviceIds: [escalda.id] });
const tiburcia = pro("pro-t", "Tibúrcia Jaboticatubas"), leocadio = pro("pro-l", "Leocádio Pirapetinga"), quiterinha = pro("pro-q", "Quiterinha Taiobeiras");
const eustorgia: PilotPerson = { id: "cli-e", name: "Eustórgia Cajazeira" }, hortensio: PilotPerson = { id: "cli-h", name: "Hortênsio Macaúbas" };
const MON = "2031-03-10", TUE = "2031-03-11", THU = "2031-03-13", FRI = "2031-03-14";
const TEAM = [tiburcia, leocadio, quiterinha];
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [eustorgia, hortensio], team: TEAM, catalog: [escalda],
  hours: Object.fromEntries(TEAM.map(item => [item.id, everyDay(["08:00", "20:00"])])), appointments: [booked("apt-e", eustorgia, tiburcia, escalda, THU, "15:00")], ...over });
function fake(frames: E2b2Interpretation[], base: MemorySalon = salon(), reader: PilotReader = memoryReader(base)) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], now = { clock: clockAt() };
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame)));
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-e2b2-impl", userId: "user-e2b2-impl" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => now.clock,
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async () => undefined,
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-e", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, now, model };
}
const ID = "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b0a";
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: ID, message });
const slot = (change: PilotResolvedChange | undefined) => change && { date: change.date, time: change.time, professionalRef: change.professionalRef };
const optionIds = (reply: PilotReply) => reply.view.questions[0]?.options?.map(option => option.id) ?? [];
const tap = (f: ReturnType<typeof fake>, reply: PilotReply, id: string) => selectPilotOption(f.host, pilotOptionRef(reply.view.questions[0].questionId, id));
const forEustorgia = (dia: E2b2Destination["dia"], hora: E2bClock | null, profissional = e2b2Pro(null)) => e2b2Luna({ cliente: { mencao: "Eustórgia" }, destino: e2b2To(dia, hora, profissional) });
const later = (hora: E2bClock) => e2b2Luna({ destino: e2b2To(null, hora) });
const FRIDAY_10 = [e2bWeekday("sexta", "na sexta"), e2bClock(10, "às 10h", 0, "manha")] as const;

describe("§11.6: the DATE_CLOCK_CONFLICT question (a clock from now said after a day it does not fit) settles the clock's anchor too", () => {
  it("tapping today proposes now's clock (Monday 11:00) at once; tapping the day said before asks its clock, never Friday 11:00", async () => {
    for (const [choice, expected] of [[MON, { date: MON, time: "11:00", professionalRef: tiburcia.id }], [FRI, undefined]] as const) {
      const f = fake([forEustorgia(...FRIDAY_10), later(e2bMinutes(120, ["agora"], "daqui a duas horas"))]);
      await send(f, "A Eustórgia vai na sexta às 10h da manhã");
      const asked = await send(f, "Melhor daqui a duas horas");
      expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "DATE_CLOCK_CONFLICT" })]);
      expect(optionIds(asked)).toEqual([MON, FRI]);
      const tapped = await tap(f, asked, choice);
      if (expected) { expect(tapped.view).toMatchObject({ status: "proposal_ready", questions: [] }); expect(slot(f.prepared.at(-1))).toEqual(expected); }
      else { expect(tapped.view.questions).toEqual([expect.objectContaining({ field: "time" })]); expect(f.prepared).toHaveLength(1); }
    }
  });
  it("with both anchors (origem and agora): today keeps now's clock (11:00, no clock question); the day said before keeps the appointment's clock + 2h (17:00)", async () => {
    for (const [choice, expected] of [[MON, { date: MON, time: "11:00", professionalRef: tiburcia.id }], [FRI, { date: FRI, time: "17:00", professionalRef: tiburcia.id }]] as const) {
      const f = fake([forEustorgia(...FRIDAY_10), later(e2bMinutes(120, ["origem", "agora"], "duas horas pra frente"))]);
      await send(f, "A Eustórgia vai na sexta às 10h da manhã");
      const asked = await send(f, "Joga duas horas pra frente");
      expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "DATE_CLOCK_CONFLICT" })]);
      const tapped = await tap(f, asked, choice);
      expect(tapped.view).toMatchObject({ status: "proposal_ready", questions: [] });
      expect(slot(f.prepared.at(-1))).toEqual(expected);
    }
  });
  it("TWINS: the same later clock after a day that IS today, or said in the same message as the day, is no conflict", async () => {
    const today = fake([forEustorgia(e2bDays(0, ["hoje"], "hoje"), e2bClock(16, "às 16h")), later(e2bMinutes(120, ["agora"], "daqui a duas horas"))]);
    await send(today, "A Eustórgia vai hoje às 16h");
    await send(today, "Melhor daqui a duas horas");
    expect(today.prepared.map(slot)).toEqual([{ date: MON, time: "16:00", professionalRef: tiburcia.id }, { date: MON, time: "11:00", professionalRef: tiburcia.id }]);
    const same = fake([forEustorgia(e2bWeekday("sexta", "na sexta"), e2bMinutes(120, ["agora"], "daqui a duas horas"))]);
    const asked = await send(same, "A Eustórgia na sexta, daqui a duas horas");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time", reason: "TIME_INVALID" })]);
  });
});

describe("§11.5: a clock-settled day stays for any later clock, and follows only a new clock counted from now", () => {
  it("'daqui a duas horas' on Monday; the next day 'daqui a três horas' says Tuesday 12:00 (never Monday, already past); TWIN the same day: Monday 12:00", async () => {
    const f = fake([forEustorgia(null, e2bMinutes(120, ["agora"], "daqui a duas horas")), later(e2bMinutes(180, ["agora"], "daqui a três horas"))]);
    await send(f, "Põe a Eustórgia daqui a duas horas");
    f.now.clock = clockAt(saoPauloInstant(`${TUE}T09:00`));
    await send(f, "Melhor daqui a três horas");
    expect(f.prepared.map(slot)).toEqual([{ date: MON, time: "11:00", professionalRef: tiburcia.id }, { date: TUE, time: "12:00", professionalRef: tiburcia.id }]);
    const twin = fake([forEustorgia(null, e2bMinutes(120, ["agora"], "daqui a duas horas")), later(e2bMinutes(180, ["agora"], "daqui a três horas"))]);
    await send(twin, "Põe a Eustórgia daqui a duas horas");
    await send(twin, "Melhor daqui a três horas");
    expect(twin.prepared.map(slot).at(-1)).toEqual({ date: MON, time: "12:00", professionalRef: tiburcia.id });
  });
});

describe("§11.7: exclusions", () => {
  it("an exclusion that names nobody for sure is asked with NO option (never a tap that makes her the one who attends); TWIN the exact name → chosen", async () => {
    const loads = salon({ appointments: [booked("apt-e", eustorgia, tiburcia, escalda, THU, "15:00"), booked("x-q", hortensio, quiterinha, escalda, FRI, "08:00")] });
    const twin = fake([forEustorgia(e2bWeekday("sexta", "na sexta"), e2bClock(16, "às 16h"), e2b2Pro("outro", ["Leocádio"]))], loads);
    await send(twin, "A Eustórgia vai na sexta às 16h com outra pessoa, menos o Leocádio");
    expect(twin.prepared.map(slot)).toEqual([{ date: FRI, time: "16:00", professionalRef: quiterinha.id }]);
    const f = fake([forEustorgia(e2bWeekday("sexta", "na sexta"), e2bClock(16, "às 16h"), e2b2Pro("outro", ["Leocádia Pirapetinga Neta"]))], loads);
    const asked = await send(f, "A Eustórgia vai na sexta às 16h com outra pessoa, menos a Leocádia Pirapetinga Neta");
    // §11.10 (contract migration; was PROFESSIONAL_(NOT_FOUND|CONTRADICTORY)): the exclusion question has reasons of its own, never a who-attends one.
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "professional", reason: expect.stringMatching(/^EXCLUSION_(NOT_FOUND|CONTRADICTORY)$/) })]);
    expect(asked.view.questions[0].options).toBeUndefined();
    expect(f.prepared).toEqual([]);
  });
  it("contract: excluidos only beside 'qualquer' or 'outro' (RULE:excluidos_sem_delegacao, with its fixed repair sentence); TWINS accepted", () => {
    const frame = (modo: "manter" | "nomeado" | "qualquer" | "outro" | null, mencao: string | null) =>
      forEustorgia(e2bWeekday("sexta", "na sexta"), e2bClock(16, "às 16h"), { modo, mencao, excluidos: ["Leocádio"] });
    for (const [modo, mencao] of [["qualquer", null], ["outro", null]] as const) expect(decodePilotInterpretation(structuredClone(frame(modo, mencao))), String(modo)).toEqual(frame(modo, mencao));
    for (const [modo, mencao] of [["nomeado", "Quiterinha"], ["manter", null], [null, null]] as const) {
      let reasons: readonly string[] = [];
      try { decodePilotInterpretation(frame(modo, mencao)); } catch (error) { reasons = error instanceof PilotContractError ? error.reasons : ["OTHER"]; }
      expect(reasons, String(modo)).toEqual(["RULE:excluidos_sem_delegacao"]);
    }
    expect(pilotRepairText(["RULE:excluidos_sem_delegacao"])).toContain(PILOT_REPAIR_RULES["RULE:excluidos_sem_delegacao"]);
  });
});

describe("§11.8: nothing cut in silence; size failures are safe and say so; a state saved before the exclusion list loads", () => {
  it("a catalog or team the reader refuses as too large: no model call, its own code, the size reply with 'nada foi alterado'; TWIN any other failed read: PILOT_DIRECTORY_UNAVAILABLE", async () => {
    for (const [method, code] of [["catalog", "PILOT_CATALOG_TOO_LARGE"], ["team", "PILOT_TEAM_TOO_LARGE"]] as const) {
      const refusing = { ...memoryReader(salon()), [method]: async () => { throw Error(code); } } as PilotReader;
      const f = fake([forEustorgia(...FRIDAY_10)], salon(), refusing);
      const reply = await send(f, "A Eustórgia vai na sexta às 10h da manhã");
      expect(reply).toMatchObject({ code, telemetry: { model_calls: 0 } });
      expect(reply.text).toContain(PILOT_TOO_LARGE_REPLY);
      expect(reply.text).toContain("nada foi alterado");
      expect(f.model.requests).toHaveLength(0);
      const failing = { ...memoryReader(salon()), [method]: async () => { throw Error("SYNTHETIC_READ_FAILURE"); } } as PilotReader;
      const twin = fake([forEustorgia(...FRIDAY_10)], salon(), failing);
      expect((await send(twin, "A Eustórgia vai na sexta às 10h da manhã")).code).toBe("PILOT_DIRECTORY_UNAVAILABLE");
      expect((await send(twin, "A Eustórgia vai na sexta às 10h da manhã")).text).toContain(PILOT_DIRECTORY_UNAVAILABLE);
    }
  });
  it("a request past the cap (team names of 12000 characters) is PILOT_BUDGET with the size reply, never the generic one", async () => {
    const team = TEAM.map((item, index) => ({ ...item, name: `${item.name} ${"Sobrenome Comprido ".repeat(632)}${index}` }));
    const f = fake([forEustorgia(...FRIDAY_10)], salon({ team }));
    const reply = await send(f, "A Eustórgia vai na sexta às 10h da manhã");
    expect(reply).toMatchObject({ code: "PILOT_BUDGET", telemetry: { model_calls: 0 } });
    expect(reply.text).toContain(PILOT_TOO_LARGE_REPLY);
  });
  it("a pending professional saved before the exclusion list ({ modo, mencao }) loads with excluidos [] and the strict shape; one saved with it is left as it is", async () => {
    const f = fake([forEustorgia(e2bWeekday("domingo", "no domingo"), null)], salon({ appointments: [booked("apt-e", eustorgia, tiburcia, escalda, THU, "15:00"),
      booked("apt-e2", eustorgia, tiburcia, escalda, "2031-03-20", "15:00")] }));
    expect((await send(f, "A Eustórgia vai no domingo")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState & { pending: { destino: { profissional: Record<string, unknown> } } };
    expect(saved.pending.destino.profissional).toEqual({ modo: null, mencao: null, excluidos: [] });
    const load = (pilot: unknown) => (parseStoredAggregate({ schema: STORED_AGGREGATE_SCHEMA, root: ID, sessions: [{ id: ID, skill: "auto", expires: 1, turns: 1, cancelled: false, pilot }] })
      .sessions[0] as { pilot: PilotSessionState }).pilot;
    expect(load(structuredClone(saved))).toEqual(saved);
    const before = structuredClone(saved);
    before.pending.destino.profissional = { modo: "qualquer", mencao: null };
    const session = (pilot: unknown) => ({ id: ID, skill: "auto", expires: 1, turns: 1, cancelled: false, pilot });
    expect(storedSession.safeParse(session(before)).success, "control: the strict shape needs the list").toBe(false);
    const loaded = load(before);
    expect(loaded.pending?.destino.profissional).toEqual({ modo: "qualquer", mencao: null, excluidos: [] });
    expect(storedSession.safeParse(session(loaded)).success).toBe(true);
  });
});
