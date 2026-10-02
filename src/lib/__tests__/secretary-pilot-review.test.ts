import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { decodePilotInterpretation, PILOT_RESCHEDULE_TOOL, type PilotInterpretation, type PilotOrigin, type PilotTempoDia,
  type PilotTempoHora, type PilotWeekday } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { confirmPilotProposal, handlePilotMessage, pilotReplay, selectPilotOption, PILOT_DIRECTORY_UNAVAILABLE, PILOT_NAME_REQUIRED, PILOT_WITHDRAWN_REPLY,
  type PilotHost, type PilotPreparation, type PilotReceipt, type PilotResolvedChange, type PilotSessionState } from "../secretary-pilot";
import { applyAnswer, applyIntent, attachProposal, completeExecution, createPilotPlan, invalidate, nextQuestionId, pilotFieldValid, startExecution, withdraw,
  type PilotField, type PilotPlan } from "../secretary-pilot-plan";
import { pilotClockReadings, pilotMentionIn, resolveAppointment, resolveProfessional, resolveTargetDate, type PilotPerson, type PilotProfessionalRow,
  type PilotServiceRow } from "../secretary-pilot-resolver";
import { storedSession } from "../secretary-session-state";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

/** Reschedule pilot: the fixes of the early review (C1-C4, M1-M13, L1-L11; coordinator decisions 1-8). Resolver, reducer and the orchestrator
 * over an in-memory salon and a scripted Luna; the host's agenda preparation and Confirmar are stand-ins that record what they receive. received_at
 * is Monday 2031-03-10, 09:00 in São Paulo. Invented names and sentences; no network, database or paid model. */
const corte: PilotServiceRow = { id: "srv-corte", name: "Corte bordado", durationMin: 40, priceCents: 9000 };
const ines: PilotProfessionalRow = { id: "pro-ines", name: "Inês Valadares", serviceIds: [corte.id] };
const otavio: PilotProfessionalRow = { id: "pro-otavio", name: "Otávio Brandão", serviceIds: [corte.id] };
const person = (id: string, name: string): PilotPerson => ({ id, name });
const severina = person("cli-severina", "Severina Lobato"), anselmo = person("cli-anselmo", "Anselmo Prado"), anselmoT = person("cli-anselmo-t", "Anselmo Teixeira");
const MON = "2031-03-10", WED = "2031-03-12", FRI = "2031-03-14", NEXT_MON = "2031-03-17";
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [severina, anselmo, anselmoT], team: [ines, otavio], catalog: [corte],
  hours: { [ines.id]: everyDay(["08:00", "20:00"]), [otavio.id]: everyDay(["08:00", "20:00"]) }, appointments: [], ...over });
const ORIGIN: PilotOrigin = { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null };
const day = (dia_semana: PilotWeekday, mencao: string, qualificador: "este" | "proximo" | null = null): PilotTempoDia => ({ tipo: "dia_semana", dia_semana, qualificador, mencao });
const clock = (hora: number, mencao: string, periodo: "manha" | "tarde" | "noite" | null = null): Extract<PilotTempoHora, { tipo: "relogio" }> =>
  ({ tipo: "relogio", hora, minuto: 0, periodo, mencao });
const luna = (over: Partial<PilotInterpretation> = {}): PilotInterpretation => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null,
  cliente: { mencao: null }, origem: ORIGIN, destino: { dia: null, hora: null, profissional: { modo: null, mencao: null } }, observacoes: [], fora_do_escopo: [], ...over });
const to = (dia: PilotTempoDia | null, hora: PilotTempoHora | null) => ({ dia, hora, profissional: { modo: null, mencao: null } });

/** A host over the in-memory salon: the scripted Luna answers, the preparation proposes (or `prepare` decides), the Confirmar writes. */
function fake(base: MemorySalon, frames: PilotInterpretation[], over: Partial<PilotHost> = {}) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], settled: PilotReceipt[] = [];
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-review", userId: "user-review" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => clockAt(),
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async receipt => { settled.push(receipt); },
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-x", outcome: "RESCHEDULED", duplicate: false }), ...over };
  return { host, state, prepared, settled, model, reader, base };
}
const send = (f: ReturnType<typeof fake>, message: string, clientTurnId?: string) =>
  handlePilotMessage(f.host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a01", message, ...(clientTurnId ? { clientTurnId } : {}) });
const approvalOf = (plan: PilotPlan) => ({ proposalRef: plan.action.proposal!.proposalRef, draftRevision: plan.action.proposal!.draftRevision, revision: plan.revision });

describe("resolver fixes", () => {
  it("C4: an origin said 'este' is the first such weekday from today on, today included", async () => {
    const rows = [booked("apt-sev-today", severina, ines, corte, MON, "17:00"), booked("apt-sev-next", severina, ines, corte, NEXT_MON, "10:00")];
    const reader = memoryReader(salon({ appointments: rows }));
    const este = await resolveAppointment(reader, { customerId: severina.id, origem: { ...ORIGIN, dia: day("segunda", "desta segunda", "este") }, message: "a desta segunda da Severina vai pra quarta" }, clockAt());
    expect(este.state === "one" && este.appointment.id).toBe("apt-sev-today");
    const bare = await resolveAppointment(reader, { customerId: severina.id, origem: { ...ORIGIN, dia: day("segunda", "de segunda") }, message: "a de segunda da Severina vai pra quarta" }, clockAt());
    expect(bare.state === "several" && bare.options.map(row => row.id)).toEqual(["apt-sev-today", "apt-sev-next"]);
  });
  it("decision 4: a destination weekday said on that very weekday also reads as today only while the known clock is ahead; readings that differ are asked", () => {
    const origin = { date: WED }, at = clockAt();
    expect(resolveTargetDate(day("segunda", "segunda"), origin, at, { time: "15:00" })).toMatchObject({ state: "ask", options: [MON, NEXT_MON] });
    expect(resolveTargetDate(day("segunda", "nesta segunda", "este"), origin, at, { time: "15:00" })).toMatchObject({ state: "ask", options: [MON, NEXT_MON] });
    expect(resolveTargetDate(day("segunda", "segunda"), origin, at, { time: "08:30" })).toMatchObject({ state: "one", date: NEXT_MON });
    expect(resolveTargetDate(day("segunda", "segunda"), origin, at)).toMatchObject({ state: "one", date: NEXT_MON });
    expect(resolveTargetDate(day("segunda", "segunda que vem", "proximo"), origin, at, { time: "15:00" })).toMatchObject({ state: "one", date: NEXT_MON });
    expect(resolveTargetDate(day("sexta", "sexta"), origin, at, { time: "15:00" })).toMatchObject({ state: "one", date: FRI });
  });
  it("M6: a day already past or that does not exist is invalid, and the contract bounds day and minute offsets", () => {
    const at = clockAt(), origin = { date: WED };
    expect(resolveTargetDate({ tipo: "deslocamento", quantidade: -1, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: "ontem" }, origin, at)).toMatchObject({ state: "invalid", reason: "DATE_PAST" });
    expect(resolveTargetDate({ tipo: "data", dia: 30, mes: 2, mencao: "30 de fevereiro" }, origin, at)).toMatchObject({ state: "invalid", reason: "NO_SUCH_DATE" });
    expect(resolveTargetDate({ tipo: "deslocamento", quantidade: -5, unidade: "dias", ancoras: ["origem"], data_citada: null, mencao: "cinco dias antes" }, origin, at)).toMatchObject({ state: "invalid", reason: "DATE_PAST" });
    expect(() => decodePilotInterpretation(luna({ destino: to({ tipo: "deslocamento", quantidade: 1_000_000_000, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: "daqui a muito" }, null) }))).toThrow();
    expect(() => decodePilotInterpretation(luna({ destino: to(null, { tipo: "deslocamento", minutos: 1441, ancoras: ["origem"], mencao: "um dia depois" }) }))).toThrow();
    expect(decodePilotInterpretation(luna({ destino: to({ tipo: "deslocamento", quantidade: 366, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: "daqui a um ano" }, null) })).destino.dia).toMatchObject({ quantidade: 366 });
  });
  it("M10: a period adds 12 only to 1-11, midnight said at night is 00:00, and a period that contradicts the hour is two readings", () => {
    expect(pilotClockReadings(clock(0, "meia-noite", "noite"))).toEqual(["00:00"]);
    expect(pilotClockReadings(clock(12, "12 da noite", "noite"))).toEqual(["00:00"]);
    expect(pilotClockReadings(clock(15, "15 da manhã", "manha"))).toEqual(["03:00", "15:00"]);
    expect(pilotClockReadings(clock(3, "3 da tarde", "tarde"))).toEqual(["15:00"]);
    expect(pilotClockReadings(clock(12, "meio-dia", "manha"))).toEqual(["12:00"]);
    expect(pilotClockReadings(clock(9, "9", null))).toEqual(["09:00", "21:00"]);
  });
  it("M9: 'manter' or 'qualquer' beside a mention of someone else of the team is a conflict (asked); words naming nobody change nothing", async () => {
    const reader = memoryReader(salon()), context = { current: { id: ines.id, name: ines.name }, appointmentId: "apt", serviceId: corte.id, durationMin: 40, slot: null };
    expect(await resolveProfessional(reader, { modo: "manter", mencao: "Otávio" }, context)).toMatchObject({ state: "conflict", mode: "manter", named: { id: otavio.id } });
    expect(await resolveProfessional(reader, { modo: "manter", mencao: "Inês" }, context)).toMatchObject({ state: "kept", id: ines.id });
    expect(await resolveProfessional(reader, { modo: "manter", mencao: "quem já atendia" }, context)).toMatchObject({ state: "kept", id: ines.id });
    expect(await resolveProfessional(reader, { modo: "qualquer", mencao: "Otávio" }, context)).toMatchObject({ state: "conflict", mode: "qualquer" });
  });
  it("M11: a dependent's appointment is never located from the customer's own mention", async () => {
    const own = { ...booked("apt-ans-dep", anselmo, ines, corte, WED, "10:00"), dependentName: "Caçula" };
    const located = await resolveAppointment(memoryReader(salon({ appointments: [own] })), { customerId: anselmo.id, origem: ORIGIN, message: "Anselmo pra sexta" }, clockAt());
    expect(located).toMatchObject({ state: "none", upcoming: [], skippedDependents: 1 });
  });
  it("L3: a degenerate mention (one letter, a particle) proves nothing; a name or a number does", () => {
    expect(pilotMentionIn("passa a da Severina pra quarta", "a")).toBe(false);
    expect(pilotMentionIn("passa a da Severina pra quarta", "da")).toBe(false);
    expect(pilotMentionIn("passa a da Severina pra quarta", "Severina")).toBe(true);
    expect(pilotMentionIn("a das 9 da Severina", "9")).toBe(true);
  });
});

describe("reducer fixes", () => {
  const resolved = (value: string, display = value): PilotField => ({ value, display, provenance: "explicit" });
  const full = (): PilotPlan => {
    const plan = applyIntent(createPilotPlan("plan-r"), { fields: { customer: resolved("cli"), appointment: resolved("apt"), date: resolved(FRI), time: resolved("15:00"),
      professional: resolved("pro"), service: resolved("srv") } }, 0);
    if (!plan.ok) throw Error("fixture");
    return plan.plan;
  };
  it("C1: a withdrawal whose 'correction' changes nothing is the plain withdrawal; a real change is the corrected draft", () => {
    const plan = full();
    expect(withdraw(plan, plan.revision, { fields: { customer: resolved("cli"), date: resolved(FRI) } })).toMatchObject({ ok: true, plan: { action: { status: "withdrawn" } } });
    const corrected = withdraw(plan, plan.revision, { fields: { time: resolved("16:00") } });
    expect(corrected.ok && corrected.plan.action.status).toBe("draft");
    expect(corrected.ok && corrected.plan.action.fields.time.value).toBe("16:00");
  });
  it("L8: a proposal is never swapped at the same revision nor attached without real refs; execution needs the approval", () => {
    const plan = full(), first = attachProposal(plan, { proposalRef: "p1", draftRef: "d1", draftRevision: 1, revision: plan.revision, text: "x" });
    if (!first.ok) throw Error("fixture");
    expect(attachProposal(first.plan, { proposalRef: "p2", draftRef: "d2", draftRevision: 1, revision: plan.revision, text: "y" })).toMatchObject({ ok: false, code: "PROPOSAL_MISMATCH" });
    expect(attachProposal(first.plan, { proposalRef: "p1", draftRef: "d1", draftRevision: 1, revision: plan.revision, text: "x" })).toMatchObject({ ok: true });
    expect(attachProposal(plan, { proposalRef: undefined as never, draftRef: "d1", draftRevision: 1, revision: plan.revision, text: "x" })).toMatchObject({ ok: false, code: "FIELD_INVALID" });
    expect(startExecution(first.plan)).toBe(first.plan);
    expect(completeExecution(first.plan)).toBe(first.plan);
    expect(pilotFieldValid({ value: null, display: "algo", provenance: "unresolved" })).toBe(false);
  });
  it("L8: answering one question keeps the others open at the new revision; a closed question keeps no options; ids continue past a floor", () => {
    const plan = applyIntent(createPilotPlan("plan-q"), { fields: {}, questions: [
      { questionId: "q1", field: "customer", reason: "CUSTOMER_AMBIGUOUS", options: [{ id: "cli-a", label: "A" }, { id: "cli-b", label: "B" }] },
      { questionId: "q2", field: "scope", reason: "OUT_OF_SCOPE_PART" }] }, 0);
    if (!plan.ok) throw Error("fixture");
    const answered = applyAnswer(plan.plan, { questionId: "q1", value: resolved("cli-a", "A") }, plan.plan.revision);
    if (!answered.ok) throw Error("answer");
    expect(answered.plan.action.questions.map(q => [q.questionId, q.open, q.revision, q.options?.length ?? 0])).toEqual([["q1", false, 1, 0], ["q2", true, 2, 0]]);
    expect(nextQuestionId(answered.plan, 7)).toBe("q8");
    expect(nextQuestionId(answered.plan)).toBe("q3");
    expect(applyIntent(answered.plan, { fields: {} }, plan.plan.revision)).toMatchObject({ ok: false, code: "STALE_REVISION" });
  });
  it("L10: invalidate keeps its reason until the next accepted change", () => {
    const plan = full(), dropped = invalidate(plan, "CONFIRM_FAILED");
    expect(dropped.action).toMatchObject({ status: "needs_review", invalidation: { reason: "CONFIRM_FAILED", revision: plan.revision + 1 } });
    const next = applyIntent(dropped, { fields: { time: resolved("17:00") } }, dropped.revision);
    expect(next.ok && next.plan.action.invalidation).toBeUndefined();
  });
});

describe("orchestrator fixes (scripted Luna, in-memory salon)", () => {
  const severinaWed = () => [booked("apt-sev", severina, ines, corte, WED, "10:00")];
  const move = (over: Partial<PilotInterpretation> = {}) => luna({ cliente: { mencao: "Severina" }, destino: to(day("sexta", "sexta"), clock(15, "15h")), ...over });
  it("C2: an out-of-scope part is asked about whatever kind Luna gave the message; nothing is prepared before the answer", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move({ tipo: "remarcar", fora_do_escopo: [{ tipo: "cancelar", pedido: "desmarca o Anselmo" }] })]);
    const reply = await send(f, "Severina vai pra sexta 15h e desmarca o Anselmo");
    expect(reply.view.questions).toEqual([expect.objectContaining({ field: "scope", reason: "OUT_OF_SCOPE_PART" })]);
    expect(f.prepared).toEqual([]);
  });
  it("M1: the scope question takes only aceita_parcial: null asks again, false withdraws, true goes on; a yes is never inferred", async () => {
    const mixed = move({ tipo: "misto", fora_do_escopo: [{ tipo: "cancelar", pedido: "desmarca o Anselmo" }] });
    const answerOf = (questionId: string, aceita_parcial: boolean | null) => luna({ tipo: "resposta", resposta_a: questionId, aceita_parcial });
    const unsure = fake(salon({ appointments: severinaWed() }), [mixed, answerOf("q1", null), answerOf("q1", false)]);
    const asked = await send(unsure, "Severina vai pra sexta 15h e desmarca o Anselmo");
    const again = await send(unsure, "hmm, depende do Anselmo");
    expect(again.code).toBe("SCOPE_UNANSWERED");
    expect(again.view.questions).toEqual(asked.view.questions);
    expect(again.view.revision).toBe(asked.view.revision);
    const declined = await send(unsure, "não quero só isso");
    expect(declined.text).toBe(PILOT_WITHDRAWN_REPLY);
    expect(declined.view.status).toBe("withdrawn");
    expect(unsure.prepared).toEqual([]);
    const yes = fake(salon({ appointments: severinaWed() }), [mixed, answerOf("q1", true)]);
    await send(yes, "Severina vai pra sexta 15h e desmarca o Anselmo");
    const ready = await send(yes, "só a remarcação mesmo");
    expect(ready.view.status).toBe("proposal_ready");
    expect(yes.prepared).toHaveLength(1);
  });
  it("C1: 'desistir' repeating the open request is the withdrawal, never a new proposal", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move(), move({ desistir: true, destino: to(null, null) })]);
    await send(f, "Severina vai pra sexta 15h");
    const out = await send(f, "esquece a da Severina");
    expect(out.view.status).toBe("withdrawn");
    expect(f.prepared).toHaveLength(1);
  });
  it("M2: a Confirmar that fails after the agenda wrote finds the receipt: done, settled, nothing prepared again", async () => {
    let written: PilotReceipt | undefined;
    const f = fake(salon({ appointments: severinaWed() }), [move()], {
      confirm: async approval => { written = { proposalRef: approval.proposalRef, appointmentRef: "apt-sev", outcome: "RESCHEDULED", duplicate: false }; throw Error("CONFIRM_FAILED"); },
      receipt: async ref => written && written.proposalRef === ref ? { ...written, duplicate: true } : undefined });
    await send(f, "Severina vai pra sexta 15h");
    const done = await confirmPilotProposal(f.host, approvalOf(f.state.plan!));
    expect(done.code).toBe("CONFIRMED_AFTER_FAILURE");
    expect(f.state.plan!.action.status).toBe("done");
    expect(f.settled).toHaveLength(1);
    expect(f.prepared).toHaveLength(1);
  });
  it("L2: a receipt of another proposal_ref never settles the open plan", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move()], { receipt: async () => ({ proposalRef: "prop-other", appointmentRef: "apt-sev", outcome: "RESCHEDULED", duplicate: true }) });
    await send(f, "Severina vai pra sexta 15h");
    const before = structuredClone(f.state.plan);
    const out = await confirmPilotProposal(f.host, approvalOf(f.state.plan!));
    expect(out.code).toBe("RECEIPT_OTHER_PROPOSAL");
    expect(f.state.plan).toEqual(before);
    expect(f.settled).toEqual([]);
  });
  it("M4: a bound appointment cancelled meanwhile is asked (APPOINTMENT_CHANGED), never replaced by another in silence", async () => {
    const rows = [booked("apt-sev", severina, ines, corte, WED, "10:00"), booked("apt-sev-2", severina, ines, corte, FRI, "11:00")];
    const base = salon({ appointments: rows });
    const f = fake(base, [move({ origem: { ...ORIGIN, dia: day("quarta", "de quarta") } }), luna({ destino: to(null, clock(16, "16h")) })]);
    await send(f, "Severina, a de quarta, vai pra sexta 15h");
    expect(f.state.plan!.action.fields.appointment.value).toBe("apt-sev");
    base.appointments![0] = { ...base.appointments![0], status: "CANCELLED" };
    const out = await send(f, "melhor 16h");
    expect(out.view.questions).toEqual([expect.objectContaining({ field: "appointment", reason: "APPOINTMENT_CHANGED" })]);
    expect(out.view.fields!.appointment.value).toBeNull();
    expect(f.prepared).toHaveLength(1);
  });
  it("M5: another customer's appointment brings its own professional (never the previous one kept as inherited)", async () => {
    const rows = [booked("apt-sev", severina, ines, corte, WED, "10:00"), booked("apt-ans", anselmoT, otavio, corte, WED, "11:00")];
    const f = fake(salon({ appointments: rows }), [move(), luna({ cliente: { mencao: "Anselmo Teixeira" } })]);
    await send(f, "Severina vai pra sexta 15h");
    expect(f.state.plan!.action.fields.professional.value).toBe(ines.id);
    await send(f, "não, é o Anselmo Teixeira");
    expect(f.state.plan!.action.fields).toMatchObject({ appointment: { value: "apt-ans" }, professional: { value: otavio.id, provenance: "inherited" } });
  });
  it("M12: an identity question answered without a name asks for it (no loop); a tap on an option binds that real record", async () => {
    const rows = [booked("apt-ans", anselmo, ines, corte, WED, "10:00")];
    const f = fake(salon({ appointments: rows }), [luna({ cliente: { mencao: "Anselmo" }, destino: to(day("sexta", "sexta"), clock(15, "15h")) }),
      luna({ tipo: "resposta", resposta_a: "q1" })]);
    const asked = await send(f, "Anselmo vai pra sexta 15h");
    expect(asked.view.questions).toEqual([expect.objectContaining({ questionId: "q1", field: "customer", reason: "CUSTOMER_AMBIGUOUS" })]);
    const nameless = await send(f, "esse mesmo");
    expect(nameless.text).toContain(PILOT_NAME_REQUIRED);
    expect(nameless.view.questions.map(q => q.questionId)).toEqual(["q1"]);
    const tapped = await selectPilotOption(f.host, anselmo.id);
    expect(tapped.view.fields!.customer).toMatchObject({ value: anselmo.id, provenance: "explicit" });
    expect(tapped.view.status).toBe("proposal_ready");
    await expect(selectPilotOption(f.host, "cli-desconhecido")).rejects.toThrow("SELECTION_INVALID");
  });
  it("L1: a repeated clientTurnId returns the stored text and view as recorded, marked replayed", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [move()]);
    const id = "0a8d2f4e-7b1c-4e59-8f3a-2c6d9e1b5a77";
    const first = await send(f, "Severina vai pra sexta 15h", id);
    const replay = pilotReplay(f.state, id)!;
    expect(replay.text).toBe(first.text);
    expect({ ...replay.view, turn: { ...replay.view.turn, replayed: false } }).toEqual(first.view);
    expect(replay.view.turn.replayed).toBe(true);
  });
  it("L9: the salon's team or catalog unreadable before Luna is the safe reply with no model call", async () => {
    const f = fake(salon({ fail: { team: true } }), [move()]);
    const out = await send(f, "Severina vai pra sexta 15h");
    expect(out.text).toContain(PILOT_DIRECTORY_UNAVAILABLE);
    expect(out.code).toBe("PILOT_DIRECTORY_UNAVAILABLE");
    expect(f.model.requests).toHaveLength(0);
  });
  it("L10: the agenda's own reason becomes the question (hours, no change, an appointment this path does not move)", async () => {
    const refusing = (preparation: PilotPreparation) => fake(salon({ appointments: severinaWed() }), [move()], { prepare: async () => preparation });
    const hours = refusing({ ok: false, code: "OUTSIDE_HOURS", text: "Fora do expediente.", alternatives: ["16:00"] });
    expect((await send(hours, "Severina vai pra sexta 15h")).view.questions).toEqual([expect.objectContaining({ field: "time", reason: "OUTSIDE_HOURS", options: [{ id: "16:00", label: expect.any(String) }] })]);
    const same = refusing({ ok: false, code: "NO_CHANGE", text: "" });
    const asked = await send(same, "Severina vai pra sexta 15h");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "date", reason: "DESTINATION_MISSING" })]);
    expect(asked.view.fields).toMatchObject({ date: { value: null }, time: { value: null } });
    const relation = refusing({ ok: false, code: "RELATION_NOT_SUPPORTED", text: "Não dá por aqui." });
    expect((await send(relation, "Severina vai pra sexta 15h")).view.questions).toEqual([expect.objectContaining({ field: "appointment", reason: "APPOINTMENT_NOT_SUPPORTED" })]);
  });
  it("L8: question ids continue across the plans of a session", async () => {
    const f = fake(salon({ appointments: severinaWed() }), [luna({ cliente: { mencao: "Anselmo" } }), luna({ desistir: true }), luna({ cliente: { mencao: "Anselmo" } })]);
    expect((await send(f, "Anselmo")).view.questions.map(q => q.questionId)).toEqual(["q1"]);
    expect((await send(f, "deixa pra lá")).view.status).toBe("withdrawn");
    expect((await send(f, "Anselmo de novo")).view.questions.map(q => q.questionId)).toEqual(["q2"]);
  });
});

describe("persisted pilot state (M3, L7)", () => {
  const session = (pilot: unknown) => ({ id: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a01", skill: "auto", expires: 1, turns: 0, cancelled: false, pilot });
  it("a plan, its questions and the pending operators are checked strictly on load; the bounds hold what the orchestrator writes", async () => {
    const f = fake(salon({ appointments: [booked("apt-sev", severina, ines, corte, WED, "10:00")] }), [luna({ cliente: { mencao: "Severina" }, destino: to(day("sexta", "sexta"), clock(15, "15h")) })]);
    await send(f, "Severina vai pra sexta 15h");
    const state = JSON.parse(JSON.stringify(f.state)) as PilotSessionState;
    expect(storedSession.safeParse(session(state)).success).toBe(true);
    expect(storedSession.safeParse(session({ ...state, plan: { ...state.plan!, action: { ...state.plan!.action, status: "talvez" } } })).success).toBe(false);
    expect(storedSession.safeParse(session({ ...state, plan: { ...state.plan!, action: { ...state.plan!.action, extra: 1 } } })).success).toBe(false);
    expect(storedSession.safeParse(session({ ...state, pending: { origem: { dia: "sexta" }, destino: {} } })).success).toBe(false);
    expect(storedSession.safeParse(session({ ...state, outOfScope: ["x".repeat(480)] })).success).toBe(true);
    expect(storedSession.safeParse(session({ ...state, outOfScope: ["x".repeat(481)] })).success).toBe(false);
  });
  it("a question over many real appointments lists the first ones and counts the rest (its text always fits the saved bound)", async () => {
    const many = Array.from({ length: 30 }, (_, i) => booked(`apt-${i}`, severina, ines, corte, `2031-04-${String(i + 1).padStart(2, "0")}`, "10:00"));
    const f = fake(salon({ appointments: many }), [luna({ cliente: { mencao: "Severina" }, destino: to(day("sexta", "sexta"), clock(15, "15h")) })]);
    const out = await send(f, "Severina vai pra sexta 15h");
    expect(out.view.questions).toEqual([expect.objectContaining({ field: "appointment", reason: "APPOINTMENT_SEVERAL" })]);
    expect(out.text).toContain("e mais 22");
    expect(out.view.questions[0].options).toHaveLength(20);
    expect(storedSession.safeParse(session(JSON.parse(JSON.stringify(f.state)))).success).toBe(true);
  });
});
