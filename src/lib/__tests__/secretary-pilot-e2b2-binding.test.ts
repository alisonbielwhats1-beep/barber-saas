import { describe, expect, it } from "vitest";
import type { Model, ModelRequest } from "@everflair/salon-secretary";
import { pilotDestinoShape, PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { agentRequestBody } from "../../../packages/salon-secretary/src/agent-loop";
import { pilotCatalogNames, pilotRequest, runPilotInterpretation, PILOT_PROMPT, PILOT_REPAIR_RULES, PILOT_REQUEST_CAP, type PilotRequestContext } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { handlePilotMessage, pilotMissingField, pilotOptionRef, selectPilotOption, PILOT_MISSING_FIELDS, type PilotHost, type PilotReply, type PilotResolvedChange,
  type PilotSessionState } from "../secretary-pilot";
import { parseStoredAggregate, STORED_AGGREGATE_SCHEMA } from "../secretary-session-state";
import { resolveProfessional, type PilotAppointmentRow, type PilotPerson, type PilotProfessionalRow, type PilotServiceRow } from "../secretary-pilot-resolver";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bClock, e2bDate, e2bDays, e2bMinutes, e2bSameClock, e2bWeekday, e2bWeeks, saoPauloInstant, wire, type E2bClock } from "../../test/secretary-pilot-e2b";
import { e2b2Luna, e2b2OpenDay, e2b2Pro, e2b2To, type E2b2Destination, type E2b2Professional } from "../../test/secretary-pilot-e2b2";

/** Reschedule pilot, E2-B round 2 (docs/c5-spike/12-piloto-remarcacao.md §11.10): the owner's central rule, written BEFORE the fix, each case with a TWIN.
 * Every answer is bound to the question, the action, the pending field and the plan revision that asked it: it changes only that field, never erases what
 * was resolved (the day, the anchor, the exclusions, the provenance), picks an offered option only when it names exactly one of them, and is asked again
 * when it is not enough. The question that CHOOSES who attends and the question that CLARIFIES AN EXCLUSION have their own reasons, their own pending state
 * and their own answers: neither answer can play the other's role. Inputs like "tanto faz" are only frames of the mechanism (no rule is written for
 * any phrase). Invented names and sentences (the ones of the committed E2-B tests); no network, database or model. received_at: Monday 2031-03-10, 09:00
 * in São Paulo, unless a case moves it. */
const systemText = (request: ModelRequest) => (request.input as { role: string; content: string }[]).filter(item => item.role === "system").map(item => item.content).join("\n");
function fake(frames: unknown[], base: MemorySalon) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], now = { clock: clockAt() };
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-e2b2-bind", userId: "user-e2b2-bind" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => now.clock,
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async () => undefined,
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, now, model };
}
type Fake = ReturnType<typeof fake>;
const ID = "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b10";
const send = (f: Fake, message: string) => handlePilotMessage(f.host, { sessionId: ID, message });
const slot = (change: PilotResolvedChange | undefined) => change && { date: change.date, time: change.time, professionalRef: change.professionalRef };
const optionIds = (reply: PilotReply) => (reply.view.questions[0]?.options ?? []).map(option => option.id).sort();
const tap = (f: Fake, reply: PilotReply, id: string) => selectPilotOption(f.host, pilotOptionRef(reply.view.questions[0].questionId, id));
const answerTo = (questionId: string, destino: E2b2Destination) => e2b2Luna({ tipo: "resposta", resposta_a: questionId, destino });
const correction = (destino: E2b2Destination) => e2b2Luna({ destino });

// ---------------------------------------------------------------- who attends (Petronilha: Thursday 13/03 15:00 with Brígida, the current professional)
const reflexo: PilotServiceRow = { id: "srv-reflexo", name: "Reflexologia andina", durationMin: 50, priceCents: 11000 };
const pro = (id: string, name: string): PilotProfessionalRow => ({ id, name, serviceIds: [reflexo.id] });
const anacleto = pro("pro-a", "Anacleto Jurubeba"), brigida = pro("pro-b", "Brígida Taquaral"), clemencia = pro("pro-c", "Clemência Itapecuru");
const deodato = pro("pro-d", "Deodato Mucuri"), eufrasia = pro("pro-e", "Eufrásia Juruena"), deodato2 = pro("pro-d2", "Deodato Paraopeba");
const petronilha: PilotPerson = { id: "cli-q", name: "Petronilha Gurupi" }, rufino: PilotPerson = { id: "cli-r", name: "Rufino Tibagi" };
const THU = "2031-03-13", FRI = "2031-03-14", MON = "2031-03-10";
const TEAM = [anacleto, brigida, clemencia, deodato, eufrasia];
const MORNING = ["08:00", "09:00", "10:00"];
/** `loads`: other customers' appointments that Friday per professional id (mornings only: everyone stays free at 16:00). */
function team(loads: Partial<Record<string, number>>, members = TEAM): MemorySalon {
  const fillers: PilotAppointmentRow[] = Object.entries(loads).flatMap(([id, n]) => Array.from({ length: n ?? 0 }, (_, index) =>
    booked(`load-${id}-${index}`, rufino, members.find(item => item.id === id)!, reflexo, FRI, MORNING[index])));
  return { customers: [petronilha, rufino], team: members, catalog: [reflexo], hours: Object.fromEntries(members.map(item => [item.id, everyDay(["08:00", "22:00"])])),
    appointments: [booked("apt-q", petronilha, brigida, reflexo, THU, "15:00"), ...fillers] };
}
const forPetronilha = (profissional: E2b2Professional, hora: E2bClock | null = e2bClock(16, "às 16h")) =>
  e2b2Luna({ cliente: { mencao: "Petronilha" }, destino: e2b2To(e2bWeekday("sexta", "pra sexta"), hora, profissional) });
const professionalOf = (f: Fake) => f.prepared.map(change => change.professionalRef);

describe("R1-PROFESSIONAL-1 / R1-PAYLOAD-1 — the EXCLUSION question has its own reason, its own pending state and its own answer", () => {
  // Brígida (current, 0) and Clemência (0) are what a wrong reading would pick; once 'outro' and the exclusion hold, decision 15 gives Deodato (1).
  const loads = { "pro-a": 2, "pro-b": 0, "pro-c": 0, "pro-d": 1, "pro-e": 2 };
  it("asked with EXCLUSION_NOT_FOUND (never a who-attends reason) and no option; Luna's next context names the field as who must NOT attend and shows the pending delegation", async () => {
    const f = fake([forPetronilha(e2b2Pro("outro", ["Clemêncio"])), answerTo("q1", e2b2To(null, null, e2b2Pro("outro", ["Clemência"])))], team(loads));
    const asked = await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos o Clemêncio");
    expect(asked.view.questions).toEqual([{ questionId: "q1", field: "professional", reason: "EXCLUSION_NOT_FOUND" }]);
    expect(f.prepared).toEqual([]);
    await send(f, "Quis dizer a Clemência");
    const context = systemText(f.model.requests[1]);
    expect(context).toContain("motivo EXCLUSION_NOT_FOUND");
    expect(context).toContain("campo quem não deve atender");
    expect(context).toContain("modo outro");
    expect(context).toContain("sem: “Clemêncio”");
    expect(professionalOf(f)).toEqual([deodato.id]);
  });
  it("an answer typed as who attends (named, a bare name; the CONTRADICTORY twin too) is asked again: never bound, nothing prepared, the exclusion and 'outro' kept", async () => {
    const cases: [string[], E2b2Professional, string][] = [[["Clemêncio"], e2b2Pro("nomeado", [], "Clemência"), "EXCLUSION_NOT_FOUND"],
      [["Clemêncio"], e2b2Pro(null, [], "Clemência"), "EXCLUSION_NOT_FOUND"], [["Clemência Paraguaçu"], e2b2Pro("nomeado", [], "Clemência Itapecuru"), "EXCLUSION_CONTRADICTORY"]];
    for (const [first, reply, reason] of cases) {
      const f = fake([forPetronilha(e2b2Pro("outro", first)), answerTo("q1", e2b2To(null, null, reply))], team(loads));
      expect((await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, sem aquela pessoa")).view.questions).toEqual([{ questionId: "q1", field: "professional", reason }]);
      const again = await send(f, "a Clemência");
      expect(again.code, JSON.stringify(reply)).toBe("ANSWER_NOT_EXCLUSION");
      expect(again.view.questions).toEqual([{ questionId: "q1", field: "professional", reason }]);
      expect(f.prepared, "the excluded member never becomes who attends").toEqual([]);
      expect(f.state.pending?.destino.profissional).toMatchObject({ modo: "outro", excluidos: first });
    }
  });
  it("an answer typed 'qualquer' (Luna could not see the mode) keeps the pending 'outro': the current professional stays out; TWIN 'outro' gives the same", async () => {
    for (const modo of ["qualquer", "outro"] as const) {
      const f = fake([forPetronilha(e2b2Pro("outro", ["Clemêncio"])), answerTo("q1", e2b2To(null, null, e2b2Pro(modo, ["Clemência"])))], team(loads));
      await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos o Clemêncio");
      await send(f, "é a Clemência");
      expect(professionalOf(f), modo).toEqual([deodato.id]);
    }
  });
  it("the answer replaces only the words that were asked: every other exclusion stays (Deodato never offered in the tie that follows)", async () => {
    const f = fake([forPetronilha(e2b2Pro("outro", ["Clemêncio", "Deodato"])), answerTo("q1", e2b2To(null, null, e2b2Pro("outro", ["Clemência"])))], team(loads));
    await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos o Clemêncio e o Deodato");
    const next = await send(f, "a Clemência");
    expect(next.view.questions).toEqual([expect.objectContaining({ field: "professional", reason: "PROFESSIONAL_TIE" })]);
    expect(optionIds(next)).toEqual([anacleto.id, eufrasia.id]);
    expect(f.prepared).toEqual([]);
  });
});

describe("R1-PROFESSIONAL-2 / R1-PROFESSIONAL-4 — the TIE question (choose who attends) binds only an answer naming exactly one of its options", () => {
  // 'outro' without Clemência: Anacleto 1 and Deodato 1 tie; Brígida (current) 1 and Clemência 0 must never come back.
  const loads = { "pro-a": 1, "pro-b": 1, "pro-c": 0, "pro-d": 1, "pro-e": 2 };
  const asked = async (reply: E2b2Professional) => {
    const f = fake([forPetronilha(e2b2Pro("outro", ["Clemência"])), answerTo("q1", e2b2To(null, null, reply))], team(loads));
    const tie = await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos a Clemência");
    expect(tie.view.questions).toEqual([expect.objectContaining({ questionId: "q1", reason: "PROFESSIONAL_TIE" })]);
    expect(optionIds(tie)).toEqual([anacleto.id, deodato.id]);
    return { f, tie, next: await send(f, "tanto faz") };
  };
  it("a delegated mode with no name, or an exclusion already said, is asked again: nothing prepared, the delegation and its exclusions untouched", async () => {
    for (const reply of [e2b2Pro("qualquer"), e2b2Pro("outro"), e2b2Pro("qualquer", ["Clemência"])]) {
      const { f, next } = await asked(reply);
      expect(next.code, JSON.stringify(reply)).toBe("ANSWER_NOT_AN_OPTION");
      expect(next.view.questions).toEqual([expect.objectContaining({ questionId: "q1", reason: "PROFESSIONAL_TIE" })]);
      expect(f.prepared).toEqual([]);
      expect(f.state.pending?.destino.profissional).toMatchObject({ modo: "outro", excluidos: ["Clemência"] });
    }
  });
  it("TWINS: a name of one option binds it (named or bare); a tap binds it; a new exclusion narrows the delegation (decision 15 then decides), never re-admitting Clemência", async () => {
    expect(professionalOf((await asked(e2b2Pro("nomeado", [], "Deodato"))).f)).toEqual([deodato.id]);
    expect(professionalOf((await asked(e2b2Pro(null, [], "Anacleto"))).f)).toEqual([anacleto.id]);
    expect(professionalOf((await asked(e2b2Pro("outro", ["Anacleto"]))).f)).toEqual([deodato.id]);
    const { f, tie } = await asked(e2b2Pro("qualquer"));
    await tap(f, tie, anacleto.id);
    expect(professionalOf(f)).toEqual([anacleto.id]);
  });
  it("a name that is no option is asked again (a member not tied, or one excluded): never bound from the whole team", async () => {
    for (const name of ["Eufrásia", "Clemência"]) {
      const { f, next } = await asked(e2b2Pro("nomeado", [], name));
      expect(next.code, name).toBe("ANSWER_NOT_AN_OPTION");
      expect(f.prepared).toEqual([]);
    }
  });
  it("'o Deodato' answering a tie with Deodato Mucuri binds him among the options; Deodato Paraopeba (excluded) is never offered", async () => {
    const members = [...TEAM, deodato2], base = team({ "pro-a": 0, "pro-b": 1, "pro-c": 1, "pro-d": 0, "pro-e": 1, "pro-d2": 0 }, members);
    const f = fake([forPetronilha(e2b2Pro("outro", ["Paraopeba"])), answerTo("q1", e2b2To(null, null, e2b2Pro("nomeado", [], "Deodato")))], base);
    const tie = await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos o Paraopeba");
    expect(optionIds(tie)).toEqual([anacleto.id, deodato.id]);
    const next = await send(f, "o Deodato");
    expect(next.view.questions.flatMap(question => question.options ?? []).map(option => option.id)).not.toContain(deodato2.id);
    expect(professionalOf(f)).toEqual([deodato.id]);
  });
  it("'outro' with the current one tied out of the options: 'tanto faz' typed 'qualquer' never chooses the current professional", async () => {
    const f = fake([forPetronilha(e2b2Pro("outro")), answerTo("q1", e2b2To(null, null, e2b2Pro("qualquer")))], team({ "pro-a": 1, "pro-b": 0, "pro-c": 1, "pro-d": 2, "pro-e": 2 }));
    const tie = await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa");
    expect(optionIds(tie)).toEqual([anacleto.id, clemencia.id]);
    expect((await send(f, "tanto faz")).code).toBe("ANSWER_NOT_AN_OPTION");
    expect(f.prepared).toEqual([]);
  });
});

describe("R1-PROFESSIONAL-3 / R1-PROFESSIONAL-2(b) — a later turn never erases an exclusion; Luna's context carries the pending delegation", () => {
  // Deodato (0) wins only if his exclusion is lost; with it, Anacleto (1) is the unique fewest (Brígida out by 'outro').
  const loads = { "pro-a": 1, "pro-b": 1, "pro-c": 2, "pro-d": 0, "pro-e": 2 };
  it("'outra pessoa, menos o Deodato' with the clock asked; then 'às 16h, com outra pessoa mesmo' (no list), as an answer and as a correction: Anacleto, never Deodato", async () => {
    for (const second of [answerTo("q1", e2b2To(null, e2bClock(16, "às 16h"), e2b2Pro("outro"))), correction(e2b2To(null, e2bClock(16, "às 16h"), e2b2Pro("outro")))]) {
      const f = fake([forPetronilha(e2b2Pro("outro", ["Deodato"]), null), second], team(loads));
      expect((await send(f, "A Petronilha vai pra sexta com outra pessoa, menos o Deodato")).view.questions).toEqual([expect.objectContaining({ field: "time" })]);
      await send(f, "às 16h, com outra pessoa mesmo");
      expect(systemText(f.model.requests[1])).toContain("sem: “Deodato”");
      expect(professionalOf(f), second.tipo).toEqual([anacleto.id]);
    }
  });
});

describe("R1-PROFESSIONAL-4 (GAP 2.c) — while a day question is open, a pending delegation never shows the current professional as kept", () => {
  it("'sexta às 16h' (Brígida kept), then 'outro dia, com outra pessoa' (DATE_MISSING) and an offset with no anchor (ANCHOR_MISSING): professional unresolved; TWIN without 'outro': Brígida kept", async () => {
    for (const dia of [e2b2OpenDay("outro dia"), e2bDays(2, [], "dois dias depois")]) {
      for (const modo of ["outro", null] as const) {
        const f = fake([forPetronilha(e2b2Pro(null)), correction(e2b2To(dia, null, e2b2Pro(modo)))], team({}));
        await send(f, "A Petronilha vai pra sexta às 16h");
        const asked = await send(f, "Vê outro dia, com outra pessoa");
        expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: expect.stringMatching(/^(DATE_MISSING|ANCHOR_MISSING)$/) })]);
        if (modo) expect(asked.view.fields?.professional.provenance, JSON.stringify(dia)).toBe("unresolved");
        else expect(asked.view.fields?.professional).toMatchObject({ value: brigida.id, provenance: "inherited" });
      }
    }
  });
});

describe("R1-PROFESSIONAL-3 (resolver) — 'qualquer' whose stray mencao names an excluded member is no conflict and never offers her", () => {
  const ctx = { current: { id: brigida.id, name: brigida.name }, appointmentId: "apt-q", serviceId: reflexo.id, durationMin: reflexo.durationMin,
    slot: { date: FRI, time: "16:00" }, origin: { date: THU, time: "15:00" } };
  it("mencao and exclusion both Clemência → decision 15 (Eufrásia); TWIN mencao Deodato (not excluded) → still the M9 conflict naming him", async () => {
    const base = memoryReader(team({ "pro-a": 2, "pro-b": 2, "pro-c": 0, "pro-d": 2, "pro-e": 1 }));
    expect(await resolveProfessional(base, wire({ modo: "qualquer", mencao: "Clemência", excluidos: ["Clemência"] }), ctx)).toMatchObject({ state: "chosen", id: eufrasia.id });
    expect(await resolveProfessional(base, wire({ modo: "qualquer", mencao: "Deodato", excluidos: ["Clemência"] }), ctx)).toMatchObject({ state: "conflict", named: { id: deodato.id } });
  });
});

describe("R1-PROFESSIONAL-5 — a format repair never drops an exclusion the first call typed", () => {
  const context: PilotRequestContext = { today: { date: MON, weekday: "segunda-feira", timezone: "America/Sao_Paulo" }, team: TEAM.map(item => item.name), services: [reflexo.name] };
  const first = forPetronilha(e2b2Pro(null, ["Brígida"]));
  it("the repaired call that empties the list fails closed (PILOT_SCHEMA, nothing prepared); TWIN a repair that keeps the name under a delegated mode is used; the sentence never offers emptying it", async () => {
    const dropped = new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, first), call(PILOT_RESCHEDULE_TOOL, forPetronilha(e2b2Pro(null)))]);
    expect(await runPilotInterpretation(dropped as never, { context, message: "Passa a Petronilha pra sexta às 16h, mas não com a Brígida", modelId: "gpt-6-luna", startedAt: performance.now() }))
      .toMatchObject({ ok: false, code: "PILOT_SCHEMA", telemetry: { calls: 2 } });
    const kept = new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, first), call(PILOT_RESCHEDULE_TOOL, forPetronilha(e2b2Pro("outro", ["Brígida"])))]);
    expect(await runPilotInterpretation(kept as never, { context, message: "Passa a Petronilha pra sexta às 16h, mas não com a Brígida", modelId: "gpt-6-luna", startedAt: performance.now() }))
      .toMatchObject({ ok: true, telemetry: { calls: 2, repaired: true } });
    const f = fake([first, forPetronilha(e2b2Pro(null))], team({}));
    expect((await send(f, "Passa a Petronilha pra sexta às 16h, mas não com a Brígida")).code).toBe("PILOT_SCHEMA");
    expect(f.prepared).toEqual([]);
    expect(PILOT_REPAIR_RULES["RULE:excluidos_sem_delegacao"]).not.toMatch(/sem modo, excluidos é \[\]/);
  });
});

// ---------------------------------------------------------------- the day and the clock (Eustórgia: Thursday 13/03 15:00 with Tibúrcia)
const escalda: PilotServiceRow = { id: "srv-escalda", name: "Escalda-pés de alecrim", durationMin: 50, priceCents: 7000 };
const tiburcia: PilotProfessionalRow = { id: "pro-t", name: "Tibúrcia Jaboticatubas", serviceIds: [escalda.id] };
const leocadio: PilotProfessionalRow = { id: "pro-l", name: "Leocádio Pirapetinga", serviceIds: [escalda.id] };
const eustorgia: PilotPerson = { id: "cli-e", name: "Eustórgia Cajazeira" };
const salonE = (over: MemorySalon = {}): MemorySalon => ({ customers: [eustorgia], team: [tiburcia, leocadio], catalog: [escalda],
  hours: { [tiburcia.id]: everyDay(["08:00", "20:00"]), [leocadio.id]: everyDay(["08:00", "20:00"]) }, appointments: [booked("apt-e", eustorgia, tiburcia, escalda, THU, "15:00")], ...over });
const forEustorgia = (dia: E2b2Destination["dia"], hora: E2bClock | null) => e2b2Luna({ cliente: { mencao: "Eustórgia" }, destino: e2b2To(dia, hora) });
const FRIDAY_10 = forEustorgia(e2bWeekday("sexta", "na sexta"), e2bClock(10, "às 10h", 0, "manha"));
const LATER_2H = correction(e2b2To(null, e2bMinutes(120, ["origem", "agora"], "duas horas pra frente")));

describe("R1-TIME-1 / R1-TEMPORAL-1 / R1-TEMPORAL-2 — an answer to DATE_CLOCK_CONFLICT binds only by naming one of the offered days", () => {
  const conflict = async (reply: unknown, frames: unknown[] = [FRIDAY_10, LATER_2H]) => {
    const f = fake([...frames, reply], salonE());
    await send(f, "A Eustórgia vai na sexta às 10h da manhã");
    const asked = await send(f, "Joga duas horas pra frente");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "DATE_CLOCK_CONFLICT" })]);
    expect(optionIds(asked)).toEqual([MON, FRI]);
    return { f, asked, next: await send(f, "pode ser") };
  };
  it("no day (empty, only a professional, or only the clock printed on an option) is asked again: the same question, nothing prepared again, never a day picked", async () => {
    for (const reply of [answerTo("q1", e2b2To(null, null)), answerTo("q1", e2b2To(null, null, e2b2Pro("nomeado", [], "Leocádio"))), answerTo("q1", e2b2To(null, e2bClock(11, "às 11h")))]) {
      const { f, asked, next } = await conflict(reply);
      expect(next.code, JSON.stringify(reply.destino)).toBe("ANSWER_NOT_AN_OPTION");
      expect(next.view.questions).toEqual([expect.objectContaining({ questionId: asked.view.questions[0].questionId, reason: "DATE_CLOCK_CONFLICT" })]);
      expect(f.prepared, "only the first proposal").toHaveLength(1);
    }
    const nowOnly = correction(e2b2To(null, e2bMinutes(120, ["agora"], "daqui a duas horas")));
    const { f, next } = await conflict(answerTo("q1", e2b2To(null, null)), [FRIDAY_10, nowOnly]);
    expect(next.code).toBe("ANSWER_NOT_AN_OPTION");
    expect(next.view.fields?.date.provenance, "Friday never settled in silence").toBe("unresolved");
    expect(f.prepared).toHaveLength(1);
  });
  it("TWINS: a day naming one option binds it — 'sexta' Friday 17:00 (the appointment's clock + 2h), 'hoje' and 'segunda' (today's weekday) Monday 11:00, never Monday 17/03", async () => {
    const cases: [E2b2Destination["dia"], { date: string; time: string }][] = [[e2bWeekday("sexta", "sexta"), { date: FRI, time: "17:00" }],
      [e2bDays(0, ["hoje"], "hoje"), { date: MON, time: "11:00" }], [e2bWeekday("segunda", "segunda"), { date: MON, time: "11:00" }]];
    for (const [dia, expected] of cases) {
      const { f } = await conflict(answerTo("q1", e2b2To(dia, null)));
      expect(slot(f.prepared.at(-1)), JSON.stringify(dia)).toEqual({ ...expected, professionalRef: tiburcia.id });
    }
  });
  it("the clock-day question (+2h from the appointment or from now, no day said): 'segunda' binds today (Monday 11:00), never Monday 17/03", async () => {
    const f = fake([forEustorgia(null, e2bMinutes(120, ["origem", "agora"], "duas horas pra frente")), answerTo("q1", e2b2To(e2bWeekday("segunda", "segunda"), null))], salonE());
    const asked = await send(f, "Joga a Eustórgia duas horas pra frente");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "ANCHOR_TWO_READINGS" })]);
    expect(optionIds(asked)).toEqual([MON, THU]);
    await send(f, "segunda");
    expect(f.prepared.map(slot)).toEqual([{ date: MON, time: "11:00", professionalRef: tiburcia.id }]);
  });
});

describe("R1-TIME-3 / R1-TEMPORAL-3 — an offered day is that exact day when tapped or named, however far ahead", () => {
  it("30 weeks (origem or hoje): tapping 09/10 or 06/10, or answering 'dia 9 de outubro', proposes that day; TWIN 3 weeks", async () => {
    for (const [weeks, fromOrigin, fromToday] of [[30, "2031-10-09", "2031-10-06"], [3, "2031-04-03", "2031-03-31"]] as const) {
      for (const choice of [fromOrigin, fromToday]) {
        const f = fake([forEustorgia(e2bWeeks(weeks, ["origem", "hoje"], `${weeks} semanas pra frente`), e2bSameClock("no mesmo horário"))], salonE());
        const asked = await send(f, "A Eustórgia vai umas semanas pra frente, no mesmo horário");
        expect(optionIds(asked)).toEqual([fromToday, fromOrigin]);
        const tapped = await tap(f, asked, choice);
        expect(tapped.code, `${weeks} ${choice}`).toBe("SELECTED_ANSWERED");
        expect(f.prepared.map(slot)).toEqual([{ date: choice, time: "15:00", professionalRef: tiburcia.id }]);
      }
    }
    const f = fake([forEustorgia(e2bWeeks(30, ["origem", "hoje"], "30 semanas pra frente"), e2bSameClock("no mesmo horário")), answerTo("q1", e2b2To(e2bDate(9, 10, "dia 9 de outubro"), null))], salonE());
    await send(f, "A Eustórgia vai 30 semanas pra frente, no mesmo horário");
    await send(f, "dia 9 de outubro");
    expect(f.prepared.map(slot)).toEqual([{ date: "2031-10-09", time: "15:00", professionalRef: tiburcia.id }]);
  });
});

describe("R1-TIME-2 / R1-TEMPORAL-4 — ANCHOR_MISSING asks for the final day or clock, and Luna's next context carries the words still without a value", () => {
  it("day: '3 dias depois' with no anchor asks the final day (never 'a partir de'); the context shows the words; TWIN the final day answered is proposed", async () => {
    const f = fake([forEustorgia(e2bDays(3, [], "três dias depois"), e2bClock(14, "às 14h")), answerTo("q1", e2b2To(e2bWeekday("sexta", "sexta"), null))], salonE());
    const asked = await send(f, "Passa a Eustórgia três dias depois, às 14h");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "ANCHOR_MISSING" })]);
    expect(asked.text).not.toMatch(/a partir de/);
    expect(asked.text).toMatch(/dia final/);
    await send(f, "sexta");
    expect(systemText(f.model.requests[1])).toContain("novo dia: não definido (“três dias depois”)");
    expect(f.prepared.map(slot)).toEqual([{ date: FRI, time: "14:00", professionalRef: tiburcia.id }]);
  });
  it("clock: 'uma hora depois disso' with no anchor asks the final clock (never 'a partir de'); the context shows the words; TWIN the final clock is proposed", async () => {
    const f = fake([forEustorgia(e2bWeekday("sexta", "na sexta"), e2bMinutes(60, [], "uma hora depois disso")), answerTo("q1", e2b2To(null, e2bClock(17, "às 17h")))], salonE());
    const asked = await send(f, "Na sexta, uma hora depois disso");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time", reason: "ANCHOR_MISSING" })]);
    expect(asked.text).not.toMatch(/a partir de/);
    expect(asked.text).toMatch(/horário final/);
    await send(f, "17h");
    expect(systemText(f.model.requests[1])).toContain("novo horário: não definido (“uma hora depois disso”)");
    expect(f.prepared.map(slot)).toEqual([{ date: FRI, time: "17:00", professionalRef: tiburcia.id }]);
  });
});

describe("R1-TEMPORAL-5 — the same operator counted from today or now, said again in a later turn, is read from that turn", () => {
  it("'amanhã às 10h' at 23:50 (Tuesday), said again at 00:05: Wednesday (CHANGED); TWIN the same minute: UNCHANGED", async () => {
    const amanha = forEustorgia(e2bDays(1, ["hoje"], "amanhã"), e2bClock(10, "às 10h", 0, "manha"));
    const f = fake([amanha, amanha, amanha], salonE());
    f.now.clock = clockAt(saoPauloInstant(`${MON}T23:50`));
    await send(f, "Põe a Eustórgia amanhã às 10h");
    expect((await send(f, "Põe a Eustórgia amanhã às 10h")).code).toBe("UNCHANGED");
    f.now.clock = clockAt(saoPauloInstant("2031-03-11T00:05"));
    expect((await send(f, "Põe a Eustórgia amanhã às 10h")).code).toBe("CHANGED");
    expect(f.prepared.map(slot)).toEqual([{ date: "2031-03-11", time: "10:00", professionalRef: tiburcia.id }, { date: "2031-03-12", time: "10:00", professionalRef: tiburcia.id }]);
  });
  it("'daqui a duas horas' at 09:00 (11:00), said again at 09:20: 11:20; TWIN the same minute: UNCHANGED", async () => {
    const twoHours = forEustorgia(null, e2bMinutes(120, ["agora"], "daqui a duas horas"));
    const f = fake([twoHours, twoHours, twoHours], salonE());
    await send(f, "Põe a Eustórgia daqui a duas horas");
    expect((await send(f, "Põe a Eustórgia daqui a duas horas")).code).toBe("UNCHANGED");
    f.now.clock = clockAt(saoPauloInstant(`${MON}T09:20`));
    expect((await send(f, "Põe a Eustórgia daqui a duas horas")).code).toBe("CHANGED");
    expect(f.prepared.map(slot)).toEqual([{ date: MON, time: "11:00", professionalRef: tiburcia.id }, { date: MON, time: "11:20", professionalRef: tiburcia.id }]);
  });
});

describe("R1-TEMPORAL-6 — a time-only answer never reopens the day the plan already resolved", () => {
  it("'pra segunda' said on a Monday (no clock: seg, 17/03 asked its clock), then 'às 17h': Monday 17/03 17:00, no second day question", async () => {
    const f = fake([forEustorgia(e2bWeekday("segunda", "pra segunda"), null), answerTo("q1", e2b2To(null, e2bClock(17, "às 17h")))], salonE());
    const asked = await send(f, "A Eustórgia vai pra segunda");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time", reason: "TIME_MISSING" })]);
    expect(asked.view.fields?.date.value).toBe("2031-03-17");
    const done = await send(f, "às 17h");
    expect(done.view.questions).toEqual([]);
    expect(f.prepared.map(slot)).toEqual([{ date: "2031-03-17", time: "17:00", professionalRef: tiburcia.id }]);
  });
});

describe("R1-TEMPORAL-7 — a day number the month lacks is never moved in silence: the proposal names the day that does not exist", () => {
  it("'dia 31' said on 10/04 (April has no 31st): 31/05, and the note says 31/04 does not exist; TWIN 'dia 30': 30/04 with no such note", async () => {
    const april = salonE({ appointments: [booked("apt-e", eustorgia, tiburcia, escalda, "2031-04-17", "15:00")] });
    for (const [dia, date, note] of [[31, "2031-05-31", true], [30, "2031-04-30", false]] as const) {
      const f = fake([forEustorgia(e2bDate(dia, null, `dia ${dia}`), e2bClock(14, "às 14h"))], april);
      f.now.clock = clockAt(saoPauloInstant("2031-04-10T09:00"));
      await send(f, `Leva a Eustórgia ao dia ${dia}, às 14h`);
      expect(f.prepared.map(slot)).toEqual([{ date, time: "14:00", professionalRef: tiburcia.id }]);
      const notes = f.prepared[0].notes.join("\n");
      if (note) expect(notes).toContain("31/04 não existe");
      else expect(notes).not.toContain("não existe");
    }
  });
});

describe("requirement 4 with round 2's context lines — the worst real request still fits whole, with 2 KB to spare", () => {
  // The words still without a value are shown only beside the field a question WITH NO OPTIONS asks; a question with options shows its options instead.
  // Both worst shapes: the largest question (8 labels at the bound and the count) with every line at its bound and the delegation line (3 exclusions at
  // the mention bound, the rest counted); and a question with no options with the words of its field at the bound and the same delegation line.
  it("300 services, 40 team names, the 1000-character message, every repair rule: either worst shape of the open plan fits with 2 KB to spare", () => {
    const services = pilotCatalogNames(Array.from({ length: 300 }, (_, index) => `Ritual sintético ${String(index).padStart(3, "0")}`)).names;
    const members = Array.from({ length: 40 }, (_, index) => `Profissional Sintética Número ${index} de Sobrenome Comprido`);
    const label = (index: number) => `qua, 12/03/2031 às 23h59 — ${"ã".repeat(159)}… com ${"é".repeat(119)}… ${index}`;
    const words = `“${"é".repeat(120)}”`, delegation = `profissional: ${"é".repeat(119)}… (modo outro; sem: ${[words, words, words].join(", ")} e mais 7)`;
    const shapes = [{ lines: [`cliente: “${"ô".repeat(120)}” (cadastro ainda não definido)`, `atendimento atual: ${label(0)}`, "novo dia: não definido", "novo horário: não definido", delegation,
      "proposta pronta, aguardando Confirmar"], question: { questionId: "q999", field: "atendimento atual (origem)", reason: "APPOINTMENT_SEVERAL", options: Array.from({ length: 8 }, (_, index) => label(index + 1)), omitted: 99_992 } },
      { lines: [`cliente: “${"ô".repeat(120)}” (cadastro definido)`, `atendimento atual: ${label(0)}`, `novo dia: não definido (${words})`, "novo horário: não definido", delegation],
        question: { questionId: "q999", field: "quem não deve atender", reason: "EXCLUSION_CONTRADICTORY" } }];
    for (const open of shapes) {
      const request = pilotRequest({ today: { date: MON, weekday: "segunda-feira", timezone: "America/Sao_Paulo" }, team: members, services, open }, "ção".repeat(333),
        { repair: [...Object.keys(PILOT_REPAIR_RULES), "SCHEMA:invalid_type@tipo"] });
      const bytes = Buffer.byteLength(JSON.stringify(agentRequestBody(request, "gpt-6-luna")), "utf8");
      expect(bytes + PILOT_REQUEST_CAP.outputFraming + 2048, `${open.question.reason}: ${bytes} bytes`).toBeLessThanOrEqual(PILOT_REQUEST_CAP.requestCap);
    }
  });
});

describe("R1-PAYLOAD-2 — Luna and the owner are told how many choices really were left out", () => {
  it("24 future appointments: the question keeps 20 options, Luna sees 8 and 'e mais 16'; a tie of 11 lists 8 names and counts 3, for the owner and for Luna", async () => {
    const appointments = Array.from({ length: 24 }, (_, index) => booked(`apt-e-${index}`, eustorgia, tiburcia, escalda, `2031-04-${String(1 + index).padStart(2, "0")}`, "10:00"));
    const many = fake([forEustorgia(e2bWeekday("sexta", "na sexta"), e2bClock(16, "às 16h")), e2b2Luna({ tipo: "conversa" })], salonE({ appointments }));
    expect((await send(many, "A Eustórgia vai na sexta às 16h")).view.questions[0]?.options).toHaveLength(20);
    await send(many, "Bom dia");
    expect(systemText(many.model.requests[1])).toContain("e mais 16");
    const members = Array.from({ length: 12 }, (_, index) => pro(`pro-${index}`, `Profissional ${String(index).padStart(2, "0")} Sintético`));
    const base: MemorySalon = { customers: [petronilha], team: members, catalog: [reflexo], hours: Object.fromEntries(members.map(item => [item.id, everyDay(["08:00", "22:00"])])),
      appointments: [booked("apt-q", petronilha, members[0], reflexo, THU, "15:00")] };
    const tie = fake([forPetronilha(e2b2Pro("outro")), e2b2Luna({ tipo: "conversa" })], base);
    const asked = await send(tie, "A Petronilha vai pra sexta às 16h com outra pessoa");
    expect(asked.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_TIE" })]);
    expect(asked.text).toContain("e mais 3");
    expect(members.filter(item => asked.text.includes(item.name))).toHaveLength(8);
    await send(tie, "Bom dia");
    expect(systemText(tie.model.requests[1])).toContain("e mais 3");
  });
});

// ================================================================ §11.11 (round 2, the verified findings R2-*): written BEFORE the fix, each with its TWIN.
// One mechanism: an answer is bound to its question's role (a fact of the question: field and reason). The question that CHOOSES who attends binds only a
// name of exactly one of its choices (all of them, never only the options kept); the question that CLARIFIES AN EXCLUSION takes only a name it did not
// have yet, replacing only the words it asked about; neither ever erases a resolved day, an anchor or an exclusion said before. "tanto faz", "pode ser"
// and the like are only frames of the mechanism: the typed value Luna gives is what is tested, never the words.
const destinoOf = (f: Fake) => f.state.pending?.destino.profissional;
/** The pilot state as the store saves and loads it (the strict stored shape): throws when it could not be saved. */
const reloaded = (f: Fake) => (parseStoredAggregate({ schema: STORED_AGGREGATE_SCHEMA, root: ID, sessions: [{ id: ID, skill: "auto", expires: 1, turns: 1, cancelled: false,
  pilot: JSON.parse(JSON.stringify(f.state)) }] }).sessions[0] as { pilot: PilotSessionState }).pilot;

describe("R2-PROFESSIONAL-1 — an EXCLUSION answer binds only a name it did not have: repeating the pending exclusions never erases the one asked", () => {
  const loads = { "pro-a": 2, "pro-b": 0, "pro-c": 0, "pro-d": 1, "pro-e": 2 };
  const first = forPetronilha(e2b2Pro("outro", ["Clemêncio", "Deodato"]));
  it("echoing every pending exclusion, or only the other one (outro or qualquer), is asked again: nothing prepared, both exclusions kept; TWIN a new name with the echo narrows (tie Anacleto/Eufrásia)", async () => {
    for (const reply of [e2b2Pro("outro", ["Clemêncio", "Deodato"]), e2b2Pro("outro", ["Deodato"]), e2b2Pro("qualquer", ["Deodato"])]) {
      const f = fake([first, answerTo("q1", e2b2To(null, null, reply))], team(loads));
      expect((await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos o Clemêncio e o Deodato")).view.questions)
        .toEqual([{ questionId: "q1", field: "professional", reason: "EXCLUSION_NOT_FOUND" }]);
      const next = await send(f, "tanto faz");
      expect(next.code, JSON.stringify(reply)).toBe("ANSWER_NOT_EXCLUSION");
      expect(next.view.questions).toEqual([{ questionId: "q1", field: "professional", reason: "EXCLUSION_NOT_FOUND" }]);
      expect(f.prepared, "Clemência (the member the question suggested) is never chosen").toEqual([]);
      expect(destinoOf(f)).toMatchObject({ modo: "outro", excluidos: ["Clemêncio", "Deodato"] });
    }
    const f = fake([first, answerTo("q1", e2b2To(null, null, e2b2Pro("outro", ["Clemência", "Deodato"])))], team(loads));
    await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos o Clemêncio e o Deodato");
    const next = await send(f, "a Clemência e o Deodato");
    expect(next.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_TIE" })]);
    expect(optionIds(next)).toEqual([anacleto.id, eufrasia.id]);
  });
});

describe("R2-PROFESSIONAL-2 — an EXCLUSION answer replaces only the words asked: the words beside 'qualquer' that name a member are still asked (M9)", () => {
  const loads = { "pro-a": 0, "pro-b": 1, "pro-c": 1, "pro-d": 2, "pro-e": 2 };
  it("'qualquer' citing Deodato, the exclusion naming nobody: once clarified (typed qualquer or outro), the conflict naming Deodato is asked, never Anacleto proposed; TWIN the exclusion resolvable at once asks the same", async () => {
    for (const reply of [e2b2Pro("qualquer", ["Clemência"]), e2b2Pro("outro", ["Clemência"])]) {
      const f = fake([forPetronilha(e2b2Pro("qualquer", ["Clemêncio"], "Deodato")), answerTo("q1", e2b2To(null, null, reply))], team(loads));
      expect((await send(f, "A Petronilha vai pra sexta às 16h com quem estiver livre, o Deodato talvez, menos o Clemêncio")).view.questions)
        .toEqual([{ questionId: "q1", field: "professional", reason: "EXCLUSION_NOT_FOUND" }]);
      const next = await send(f, "é a Clemência");
      expect(next.view.questions, JSON.stringify(reply)).toEqual([expect.objectContaining({ field: "professional", reason: "PROFESSIONAL_CONTRADICTORY" })]);
      expect(optionIds(next)).toEqual([deodato.id]);
      expect(f.prepared).toEqual([]);
    }
    const twin = fake([forPetronilha(e2b2Pro("qualquer", ["Clemência"], "Deodato"))], team(loads));
    const asked = await send(twin, "A Petronilha vai pra sexta às 16h com quem estiver livre, o Deodato talvez, menos a Clemência");
    expect(asked.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_CONTRADICTORY" })]);
    expect(optionIds(asked)).toEqual([deodato.id]);
  });
  it("the answer's own 'outro' is itself an exclusion (of the current professional): Deodato, never Brígida; TWIN typed 'qualquer' keeps her a candidate (Brígida)", async () => {
    const zero = { "pro-a": 2, "pro-b": 0, "pro-c": 0, "pro-d": 1, "pro-e": 2 };
    for (const [modo, chosen] of [["outro", deodato.id], ["qualquer", brigida.id]] as const) {
      const f = fake([forPetronilha(e2b2Pro("qualquer", ["Clemêncio"])), answerTo("q1", e2b2To(null, null, e2b2Pro(modo, ["Clemência"])))], team(zero));
      await send(f, "A Petronilha vai pra sexta às 16h com quem estiver livre, menos o Clemêncio");
      await send(f, "a Clemência");
      expect(professionalOf(f), modo).toEqual([chosen]);
    }
  });
});

describe("R2-PROFESSIONAL-3 — words beside 'outro' that name nobody stay the mode's own words across turns (never turned into an exclusion that is asked)", () => {
  const loads = { "pro-a": 0, "pro-b": 1, "pro-c": 1, "pro-d": 1, "pro-e": 2 };
  it("'com outra pessoa' (the words in outro's mencao) with the clock asked, then 'às 16h, com outra pessoa mesmo' as an answer or a correction: Anacleto, nothing asked; TWIN the clock alone", async () => {
    for (const second of [answerTo("q1", e2b2To(null, e2bClock(16, "às 16h"), e2b2Pro("outro"))), correction(e2b2To(null, e2bClock(16, "às 16h"), e2b2Pro("outro"))),
      answerTo("q1", e2b2To(null, e2bClock(16, "às 16h")))]) {
      const f = fake([forPetronilha(e2b2Pro("outro", [], "outra pessoa"), null), second], team(loads));
      expect((await send(f, "A Petronilha vai pra sexta com outra pessoa")).view.questions).toEqual([expect.objectContaining({ field: "time" })]);
      const next = await send(f, "às 16h, com outra pessoa mesmo");
      expect(next.view.questions, JSON.stringify(second.destino)).toEqual([]);
      expect(professionalOf(f)).toEqual([anacleto.id]);
    }
  });
  it("the same words survive an exclusion clarified ('menos o Clemêncio' → Clemência) and an exclusion said later ('menos o Deodato'): never 'Não encontrei “outra pessoa”'", async () => {
    const f = fake([forPetronilha(e2b2Pro("outro", ["Clemêncio"], "outra pessoa")), answerTo("q1", e2b2To(null, null, e2b2Pro("outro", ["Clemência"])))], team(loads));
    expect((await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos o Clemêncio")).view.questions).toEqual([expect.objectContaining({ reason: "EXCLUSION_NOT_FOUND" })]);
    const clarified = await send(f, "a Clemência");
    expect(clarified.view.questions).toEqual([]);
    expect(professionalOf(f)).toEqual([anacleto.id]);
    const g = fake([forPetronilha(e2b2Pro("outro", [], "outra pessoa")), correction(e2b2To(null, null, e2b2Pro("outro", ["Deodato"])))], team(loads));
    await send(g, "A Petronilha vai pra sexta às 16h com outra pessoa");
    const later = await send(g, "menos o Deodato");
    expect(later.text).not.toContain("outra pessoa");
    expect(later.view.questions).toEqual([]);
    expect(professionalOf(g)).toEqual([anacleto.id, anacleto.id]);
  });
});

describe("R2-PROFESSIONAL-1 (merge) — 'qualquer' citing a member, said over a pending 'outro', is asked (M9), never dropped as UNCHANGED", () => {
  const loads = { "pro-a": 0, "pro-b": 1, "pro-c": 1, "pro-d": 1, "pro-e": 2 };
  it("'outra pessoa, menos a Clemência' (Anacleto proposed), then 'quem estiver livre, tipo o Deodato': the conflict naming Deodato Mucuri; TWIN over a pending 'qualquer' the same", async () => {
    for (const first of [e2b2Pro("outro", ["Clemência"]), e2b2Pro("qualquer", ["Clemência"])]) {
      const f = fake([forPetronilha(first), correction(e2b2To(null, null, e2b2Pro("qualquer", [], "Deodato")))], team(loads));
      await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos a Clemência");
      expect(professionalOf(f)).toEqual([anacleto.id]);
      const next = await send(f, "Pode ser quem estiver livre, tipo o Deodato");
      expect(next.code, String(first.modo)).toBe("ASKED_PROFESSIONAL_CONTRADICTORY");
      expect(optionIds(next)).toEqual([deodato.id]);
    }
  });
});

describe("R2-PROFESSIONAL-1 (choice) — every question that chooses who attends among offered options takes only a name of one of them: a delegation with nothing new is asked again", () => {
  const members = [...TEAM, deodato2];
  const base = () => team({ "pro-a": 0, "pro-b": 1, "pro-c": 1, "pro-d": 2, "pro-d2": 2 }, members);
  const cases: [string, E2b2Professional, string, string[]][] = [
    ["A Petronilha vai pra sexta às 16h com o Deodato", e2b2Pro("nomeado", [], "Deodato"), "PROFESSIONAL_AMBIGUOUS", [deodato.id, deodato2.id]],
    ["A Petronilha vai pra sexta às 16h, mantém o atual, mas o Deodato Mucuri", e2b2Pro("manter", [], "Deodato Mucuri"), "PROFESSIONAL_CONTRADICTORY", [brigida.id, deodato.id]],
    ["A Petronilha vai pra sexta às 16h com quem estiver livre, tipo o Deodato Mucuri", e2b2Pro("qualquer", [], "Deodato Mucuri"), "PROFESSIONAL_CONTRADICTORY", [deodato.id]],
    ["A Petronilha vai pra sexta às 16h com o Deodatu Mucuri", e2b2Pro("nomeado", [], "Deodatu Mucuri"), "PROFESSIONAL_CONTRADICTORY", [deodato.id]],
  ];
  it("a delegated answer with no name and no new exclusion ('qualquer' or 'outro') is asked again: nothing prepared, never Anacleto (who is no option)", async () => {
    for (const [message, said, reason, options] of cases) for (const reply of [e2b2Pro("qualquer"), e2b2Pro("outro")]) {
      const f = fake([forPetronilha(said), answerTo("q1", e2b2To(null, null, reply))], base());
      const asked = await send(f, message);
      expect(asked.view.questions, message).toEqual([expect.objectContaining({ questionId: "q1", field: "professional", reason })]);
      expect(optionIds(asked)).toEqual([...options].sort());
      const next = await send(f, "tanto faz");
      expect(next.code, `${message} / ${reply.modo}`).toBe("ANSWER_NOT_AN_OPTION");
      expect(next.view.questions).toEqual([expect.objectContaining({ questionId: "q1", reason })]);
      expect(f.prepared).toEqual([]);
    }
  });
  it("TWINS: a name of one option binds it ('Paraopeba'); a tap binds it; a name of nobody offered is still who attends (resolved, here Anacleto by name)", async () => {
    const named = fake([forPetronilha(cases[0][1]), answerTo("q1", e2b2To(null, null, e2b2Pro("nomeado", [], "Paraopeba")))], base());
    await send(named, cases[0][0]);
    await send(named, "o Paraopeba");
    expect(professionalOf(named)).toEqual([deodato2.id]);
    const tapped = fake([forPetronilha(cases[0][1])], base());
    await tap(tapped, await send(tapped, cases[0][0]), deodato.id);
    expect(professionalOf(tapped)).toEqual([deodato.id]);
    const other = fake([forPetronilha(cases[0][1]), answerTo("q1", e2b2To(null, null, e2b2Pro("nomeado", [], "Anacleto")))], base());
    await send(other, cases[0][0]);
    await send(other, "na verdade o Anacleto");
    expect(professionalOf(other)).toEqual([anacleto.id]);
  });
});

describe("R2-PROFESSIONAL-4 — a TIE with more members than the options kept binds a name against EVERY tied member (never only the first 20 by name)", () => {
  const uzelino = pro("pro-u", "Uzelino Jurubeba"), synth = Array.from({ length: 22 }, (_, index) => pro(`pro-s${index}`, `Profissional ${String(index).padStart(2, "0")} Sintético`));
  const members = [anacleto, brigida, ...synth, uzelino];
  const base: MemorySalon = { customers: [petronilha], team: members, catalog: [reflexo], hours: Object.fromEntries(members.map(item => [item.id, everyDay(["08:00", "22:00"])])),
    appointments: [booked("apt-q", petronilha, brigida, reflexo, THU, "15:00")] };
  it("24 tied (20 kept): 'Uzelino' (cut) binds him; 'Jurubeba' (one kept, one cut) is asked again, never Anacleto by the name order; TWIN 'Anacleto' binds him", async () => {
    for (const [name, expected] of [["Uzelino", [uzelino.id]], ["Jurubeba", []], ["Anacleto", [anacleto.id]]] as const) {
      const f = fake([forPetronilha(e2b2Pro("outro")), answerTo("q1", e2b2To(null, null, e2b2Pro("nomeado", [], name)))], base);
      const tie = await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa");
      expect(tie.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_TIE" })]);
      expect(optionIds(tie)).toHaveLength(20);
      expect(optionIds(tie)).not.toContain(uzelino.id);
      expect(reloaded(f).pending?.choices?.options, "every tied member is saved with the question").toHaveLength(24);
      const next = await send(f, name);
      if (expected.length) expect(professionalOf(f), name).toEqual(expected);
      else { expect(next.code, name).toBe("ANSWER_NOT_AN_OPTION"); expect(f.prepared).toEqual([]); }
    }
  });
});

describe("R2-BINDING-1 — binding a tied member keeps the delegation's exclusions: a later 'outro' or 'qualquer' never re-admits the excluded member, nor the current one after 'outro'", () => {
  const loads = { "pro-a": 1, "pro-b": 1, "pro-c": 0, "pro-d": 1, "pro-e": 2 };
  it("tie Anacleto/Deodato → Anacleto tapped or named → 'outra pessoa, não o Anacleto' gives Deodato; 'outra pessoa' or 'pras 17h com quem estiver livre' asks the tie again; never Clemência or Brígida", async () => {
    const later: [E2b2Destination, string[]][] = [[e2b2To(null, null, e2b2Pro("outro", ["Anacleto"])), [deodato.id]], [e2b2To(null, null, e2b2Pro("outro")), []],
      [e2b2To(null, e2bClock(17, "pras 17h"), e2b2Pro("qualquer")), []]];
    for (const bind of ["tap", "name"] as const) for (const [destino, chosen] of later) {
      const frames = [forPetronilha(e2b2Pro("outro", ["Clemência"])), ...(bind === "name" ? [answerTo("q1", e2b2To(null, null, e2b2Pro("nomeado", [], "Anacleto")))] : []), correction(destino)];
      const f = fake(frames, team(loads));
      const tie = await send(f, "A Petronilha vai pra sexta às 16h com outra pessoa, menos a Clemência");
      expect(optionIds(tie)).toEqual([anacleto.id, deodato.id]);
      if (bind === "tap") await tap(f, tie, anacleto.id); else await send(f, "o Anacleto");
      expect(professionalOf(f)).toEqual([anacleto.id]);
      expect(reloaded(f).pending?.held, "the exclusions held aside are saved").toEqual({ outro: true, excluidos: ["Clemência"] });
      const next = await send(f, "Melhor com outra pessoa");
      const label = `${bind} ${JSON.stringify(destino.profissional)}`;
      expect(professionalOf(f), label).toEqual([anacleto.id, ...chosen]);
      if (!chosen.length) {
        expect(next.view.questions, label).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_TIE" })]);
        expect(optionIds(next)).toEqual([anacleto.id, deodato.id]);
      }
    }
  });
});

describe("R2-PROFESSIONAL-4 (service) — for an appointment holding several services, only members who perform every one of them are candidates", () => {
  const both = (row: PilotProfessionalRow): PilotProfessionalRow => ({ ...row, serviceIds: [reflexo.id, escalda.id] });
  const salonOf = (members: PilotProfessionalRow[], combo: boolean): MemorySalon => {
    const base = team({ "pro-a": 0, "pro-b": 1, "pro-c": 1, "pro-d": 1, "pro-e": 1 }, members);
    const [apt, ...rest] = base.appointments!;
    return { ...base, catalog: [reflexo, escalda], appointments: [combo ? { ...apt, serviceIds: [reflexo.id, escalda.id] } : apt, ...rest] };
  };
  it("combo with Brígida: 'outra pessoa' chooses Eufrásia (both services), never Anacleto (only one, 0 appointments); with Deodato doing both too, the tie is only between them; TWIN a single-service appointment: Anacleto", async () => {
    const one = fake([forPetronilha(e2b2Pro("outro"))], salonOf([anacleto, both(brigida), clemencia, deodato, both(eufrasia)], true));
    await send(one, "A Petronilha vai pra sexta às 16h com outra pessoa");
    expect(professionalOf(one)).toEqual([eufrasia.id]);
    const two = fake([forPetronilha(e2b2Pro("outro"))], salonOf([anacleto, both(brigida), clemencia, both(deodato), both(eufrasia)], true));
    const tie = await send(two, "A Petronilha vai pra sexta às 16h com outra pessoa");
    expect(tie.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_TIE" })]);
    expect(optionIds(tie)).toEqual([deodato.id, eufrasia.id]);
    const single = fake([forPetronilha(e2b2Pro("outro"))], salonOf([anacleto, both(brigida), clemencia, deodato, both(eufrasia)], false));
    await send(single, "A Petronilha vai pra sexta às 16h com outra pessoa");
    expect(professionalOf(single)).toEqual([anacleto.id]);
  });
});

describe("R2-PROFESSIONAL-3 (repair) — a repaired call never drops a name the first call typed beside 'outro' (it is an exclusion too)", () => {
  const context: PilotRequestContext = { today: { date: MON, weekday: "segunda-feira", timezone: "America/Sao_Paulo" }, team: TEAM.map(item => item.name), services: [reflexo.name] };
  const misto = (profissional: E2b2Professional) => e2b2Luna({ tipo: "misto", cliente: { mencao: "Petronilha" }, destino: e2b2To(e2bWeekday("sexta", "pra sexta"), e2bClock(16, "às 16h"), profissional) });
  const run = (first: unknown, second: unknown) => runPilotInterpretation(new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, first), call(PILOT_RESCHEDULE_TOOL, second)]) as never,
    { context, message: "Passa a Petronilha pra sexta às 16h com outra pessoa, sem a Clemência", modelId: "gpt-6-luna", startedAt: performance.now() });
  it("the name in outro's mencao dropped by the repair fails closed (REPAIR_DROPPED_EXCLUSION); TWINS the name moved between mencao and excluidos, either way, is accepted", async () => {
    expect(await run(misto(e2b2Pro("outro", [], "Clemência")), forPetronilha(e2b2Pro("outro")))).toMatchObject({ ok: false, code: "PILOT_SCHEMA",
      telemetry: { schema: expect.arrayContaining(["REPAIR_DROPPED_EXCLUSION"]) } });
    expect(await run(misto(e2b2Pro("outro", [], "Clemência")), forPetronilha(e2b2Pro("outro", ["Clemência"])))).toMatchObject({ ok: true, telemetry: { repaired: true } });
    expect(await run(misto(e2b2Pro("outro", ["Clemência"])), forPetronilha(e2b2Pro("outro", [], "Clemência")))).toMatchObject({ ok: true, telemetry: { repaired: true } });
    expect(await run(misto(e2b2Pro("outro", ["Clemência"])), forPetronilha(e2b2Pro("outro")))).toMatchObject({ ok: false, code: "PILOT_SCHEMA" });
  });
});

describe("R2-PROMPT-1 / R2-RUNNER-1 — the exclusion question and the question of who attends never share a role: not in the prompt, not in the published field", () => {
  it("rule 6 binds the names of the exclusion answer to their role (who must not attend in excluidos; a name given as who attends as nomeado)", () => {
    const rule6 = PILOT_PROMPT.split("\n").find(line => line.startsWith("6. ")) ?? "";
    // Within the 2 KB the worst request keeps (requirement 4): who must not attend in excluidos, who attends in nomeado (never the other role).
    expect(rule6).toContain("Quando o campo pedido é quem não deve atender, os nomes vão em excluidos, com o modo do pedido em aberto; quem atende vai em nomeado.");
  });
  it("the EXCLUSION question publishes its own missing field; the questions that choose who attends keep target_professional_ref", () => {
    const question = (reason: "EXCLUSION_NOT_FOUND" | "EXCLUSION_CONTRADICTORY" | "PROFESSIONAL_TIE" | "PROFESSIONAL_AMBIGUOUS") => ({ field: "professional" as const, reason });
    for (const reason of ["EXCLUSION_NOT_FOUND", "EXCLUSION_CONTRADICTORY"] as const) {
      expect(pilotMissingField(question(reason))).toBe("excluded_professional");
      expect(pilotMissingField(question(reason))).not.toBe(PILOT_MISSING_FIELDS.professional);
    }
    for (const reason of ["PROFESSIONAL_TIE", "PROFESSIONAL_AMBIGUOUS"] as const) expect(pilotMissingField(question(reason))).toBe("target_professional_ref");
    expect(pilotMissingField({ field: "date", reason: "DATE_TWO_READINGS" })).toBe("date");
  });
});

// ---------------------------------------------------------------- the day: a resolved day is never reopened by an answer or a correction that says no day
describe("R2-TEMPORAL-1 / R2-BINDING-1 (day) — what says no day keeps the day the plan resolved: a tie, an exclusion, the scope, a clock or a professional", () => {
  const MON17 = "2031-03-17";
  const segunda = (profissional: E2b2Professional = e2b2Pro(null)) => e2b2Luna({ cliente: { mencao: "Petronilha" }, destino: e2b2To(e2bWeekday("segunda", "pra segunda"), null, profissional) });
  it("'pra segunda com outra pessoa' (Monday, no clock: seg, 17/03), 'às 17h' asks the tie on 17/03; tapping or naming Anacleto proposes 17/03 17:00 (never 'pode ser 10/03 ou 17/03')", async () => {
    for (const bind of ["tap", "name"] as const) {
      const f = fake([segunda(e2b2Pro("outro")), answerTo("q1", e2b2To(null, e2bClock(17, "às 17h"))), answerTo("q2", e2b2To(null, null, e2b2Pro("nomeado", [], "Anacleto")))], team({}));
      expect((await send(f, "A Petronilha vai pra segunda com outra pessoa")).view.fields?.date.value).toBe(MON17);
      const tie = await send(f, "às 17h");
      expect(tie.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_TIE" })]);
      const done = bind === "tap" ? await tap(f, tie, anacleto.id) : await send(f, "o Anacleto");
      expect(done.view.questions, bind).toEqual([]);
      expect(f.prepared.map(slot)).toEqual([{ date: MON17, time: "17:00", professionalRef: anacleto.id }]);
    }
  });
  it("the exclusion clarified after the clock keeps 17/03 (the tie that follows is on 17/03); the scope's yes with the clock keeps it too", async () => {
    const f = fake([segunda(e2b2Pro("outro", ["Clemêncio"])), answerTo("q1", e2b2To(null, e2bClock(17, "às 17h"))), answerTo("q2", e2b2To(null, null, e2b2Pro("outro", ["Clemência"])))], team({}));
    await send(f, "A Petronilha vai pra segunda com outra pessoa, menos o Clemêncio");
    expect((await send(f, "às 17h")).view.questions).toEqual([expect.objectContaining({ reason: "EXCLUSION_NOT_FOUND" })]);
    const tie = await send(f, "a Clemência");
    expect(tie.view.questions).toEqual([expect.objectContaining({ reason: "PROFESSIONAL_TIE" })]);
    expect(tie.view.fields?.date.value).toBe(MON17);
    const scope = fake([e2b2Luna({ tipo: "misto", cliente: { mencao: "Petronilha" }, destino: e2b2To(e2bWeekday("segunda", "pra segunda"), null), fora_do_escopo: [{ tipo: "mensagem", pedido: "manda um recado pra ela" }] }),
      e2b2Luna({ tipo: "resposta", resposta_a: "q1", aceita_parcial: true, destino: e2b2To(null, e2bClock(17, "às 17h")) })], team({}));
    expect((await send(scope, "A Petronilha vai pra segunda e manda um recado pra ela")).view.questions).toEqual([expect.objectContaining({ field: "scope" })]);
    await send(scope, "sim, às 17h");
    expect(scope.prepared.map(slot)).toEqual([{ date: MON17, time: "17:00", professionalRef: brigida.id }]);
  });
  it("corrections that say no day keep it: the clock (no question open, or after the proposal: 'às 18h') and the professional ('com a Clemência'); TWIN a correction that says the day again asks 10/03 or 17/03", async () => {
    const f = fake([segunda(), correction(e2b2To(null, e2bClock(17, "às 17h"))), correction(e2b2To(null, e2bClock(18, "às 18h"))),
      correction(e2b2To(null, null, e2b2Pro("nomeado", [], "Clemência"))), correction(e2b2To(e2bWeekday("segunda", "segunda"), e2bClock(19, "às 19h")))], team({}));
    await send(f, "A Petronilha vai pra segunda");
    await send(f, "às 17h");
    await send(f, "Melhor às 18h");
    await send(f, "com a Clemência");
    expect(f.prepared.map(slot)).toEqual([{ date: MON17, time: "17:00", professionalRef: brigida.id }, { date: MON17, time: "18:00", professionalRef: brigida.id },
      { date: MON17, time: "18:00", professionalRef: clemencia.id }]);
    const again = await send(f, "segunda às 19h");
    expect(again.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "DATE_TWO_READINGS" })]);
    expect(optionIds(again)).toEqual([MON, MON17]);
  });
});

describe("R2-TEMPORAL-2 (withdrawal) — 'desistir' with the open request said again is the plain withdrawal, in another minute or another day too", () => {
  it("'daqui a duas horas' at 09:00 (11:00), desistir with the same offset at 09:05: WITHDRAWN; 'amanhã às 10h' on Monday, desistir with it on Tuesday 08:00: WITHDRAWN; TWIN desistir with another clock: CORRECTED", async () => {
    const twoHours = forEustorgia(null, e2bMinutes(120, ["agora"], "daqui a duas horas"));
    const f = fake([twoHours, { ...twoHours, desistir: true }], salonE());
    await send(f, "Põe a Eustórgia daqui a duas horas");
    f.now.clock = clockAt(saoPauloInstant(`${MON}T09:05`));
    expect((await send(f, "Desiste daquela da Eustórgia daqui a duas horas")).code).toBe("WITHDRAWN");
    expect(f.prepared).toHaveLength(1);
    const amanha = forEustorgia(e2bDays(1, ["hoje"], "amanhã"), e2bClock(10, "às 10h", 0, "manha"));
    const g = fake([amanha, { ...amanha, desistir: true }], salonE());
    await send(g, "Põe a Eustórgia amanhã às 10h");
    g.now.clock = clockAt(saoPauloInstant("2031-03-11T08:00"));
    expect((await send(g, "Desiste da Eustórgia amanhã às 10h")).code).toBe("WITHDRAWN");
    expect(g.prepared).toHaveLength(1);
    const h = fake([twoHours, { ...forEustorgia(null, e2bClock(12, "às 12h")), desistir: true }], salonE());
    await send(h, "Põe a Eustórgia daqui a duas horas");
    expect((await send(h, "Desiste, põe às 12h")).code).toBe("CORRECTED");
  });
});

describe("R2-TIME-1 — an offered day more than 12 months ahead is that exact day when tapped or named (within the contract's bounds: a state that is saved)", () => {
  it("52 weeks from a June appointment (origem or hoje): tapping or naming 10/06/2032 proposes it; TWIN 08/03/2032; a day 24 months ahead (a cited day 12 months ahead + 52 weeks) too", async () => {
    const june = salonE({ appointments: [booked("apt-e", eustorgia, tiburcia, escalda, "2031-06-12", "15:00")] });
    for (const [choice, how] of [["2032-06-10", "tap"], ["2032-06-10", "name"], ["2032-03-08", "tap"]] as const) {
      const f = fake([forEustorgia(e2bWeeks(52, ["origem", "hoje"], "um ano pra frente"), e2bSameClock("no mesmo horário")), answerTo("q1", e2b2To(e2bDate(10, 6, "dia 10 de junho"), null))], june);
      const asked = await send(f, "A Eustórgia vai um ano pra frente, no mesmo horário");
      expect(optionIds(asked)).toEqual(["2032-03-08", "2032-06-10"]);
      const out = how === "tap" ? await tap(f, asked, choice) : await send(f, "dia 10 de junho");
      expect(out.view.questions, `${how} ${choice}`).toEqual([]);
      expect(f.prepared.map(slot)).toEqual([{ date: choice, time: "15:00", professionalRef: tiburcia.id }]);
      expect(pilotDestinoShape.safeParse(f.state.pending?.destino).success).toBe(true);
      expect(() => reloaded(f)).not.toThrow();
    }
    const cited = { tipo: "mes_relativo", dia: 9, meses: 12, mencao: "dia 9 daqui a doze meses" } as unknown as Parameters<typeof e2bWeeks>[3];
    const far = fake([forEustorgia(e2bWeeks(52, ["data_citada", "hoje"], "52 semanas depois", cited), e2bClock(14, "às 14h"))], salonE());
    const asked = await send(far, "A Eustórgia vai 52 semanas depois do dia 9 daqui a doze meses, às 14h");
    expect(optionIds(asked)).toEqual(["2032-03-08", "2033-03-08"]);
    expect((await tap(far, asked, "2033-03-08")).view.questions).toEqual([]);
    expect(far.prepared.map(slot)).toEqual([{ date: "2033-03-08", time: "14:00", professionalRef: tiburcia.id }]);
    expect(pilotDestinoShape.safeParse(far.state.pending?.destino).success).toBe(true);
    expect(() => reloaded(far)).not.toThrow();
  });
});

describe("R2-TEMPORAL-2 (weekday) — a weekday read against an earlier turn whose day has passed is the day asked (DATE_INVALID), never a clock refused forever", () => {
  it("'esta sexta' on Monday (no clock), answered 'às 16h' on Saturday: the day is asked; TWIN answered on Monday: 14/03 16:00", async () => {
    const later = salonE({ appointments: [booked("apt-e", eustorgia, tiburcia, escalda, "2031-03-20", "15:00")] });
    for (const [at, expected] of [["2031-03-15T10:00", "DATE_INVALID"], [`${MON}T11:00`, null]] as const) {
      const f = fake([forEustorgia(e2bWeekday("sexta", "esta sexta", "este"), null), answerTo("q1", e2b2To(null, e2bClock(16, "às 16h")))], later);
      expect((await send(f, "A Eustórgia vai esta sexta")).view.questions).toEqual([expect.objectContaining({ field: "time", reason: "TIME_MISSING" })]);
      f.now.clock = clockAt(saoPauloInstant(at));
      const out = await send(f, "às 16h");
      if (expected) {
        expect(out.view.questions, at).toEqual([expect.objectContaining({ field: "date", reason: expected })]);
        expect(out.text).toContain("já passou");
        expect(f.prepared).toEqual([]);
      } else expect(f.prepared.map(slot)).toEqual([{ date: FRI, time: "16:00", professionalRef: tiburcia.id }]);
    }
  });
});

describe("R2-TEMPORAL-2 (note) — every month that lacks the day number between the turn's and the day used is named", () => {
  it("'dia 30' on 31/01: 30/03, naming 30/01 passed and 30/02 not existing; 'dia 29' on 30/01/2031: 29/03 naming 29/02; TWIN 'dia 28' on 31/01: 28/02, nothing 'não existe'", async () => {
    for (const [dia, today, date, lacks] of [[30, "2031-01-31", "2031-03-30", "30/02 não existe"], [29, "2031-01-30", "2031-03-29", "29/02 não existe"], [28, "2031-01-31", "2031-02-28", null]] as const) {
      const f = fake([forEustorgia(e2bDate(dia, null, `dia ${dia}`), e2bClock(14, "às 14h"))], salonE({ appointments: [booked("apt-e", eustorgia, tiburcia, escalda, "2031-04-17", "15:00")] }));
      f.now.clock = clockAt(saoPauloInstant(`${today}T09:00`));
      await send(f, `Leva a Eustórgia ao dia ${dia}, às 14h`);
      expect(f.prepared.map(slot)).toEqual([{ date, time: "14:00", professionalRef: tiburcia.id }]);
      const notes = f.prepared[0].notes.join("\n");
      expect(notes).toContain("já passou");
      if (lacks) expect(notes, `dia ${dia}`).toContain(lacks); else expect(notes).not.toContain("não existe");
    }
  });
});
