import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { decodePilotInterpretation, PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { handlePilotMessage, pilotOptionRef, selectPilotOption, type PilotHost, type PilotReply, type PilotResolvedChange, type PilotSessionState } from "../secretary-pilot";
import { resolveProfessional, type PilotAppointmentRow, type PilotPerson, type PilotProfessionalResolution, type PilotProfessionalRow,
  type PilotServiceRow } from "../secretary-pilot-resolver";
import { parseStoredAggregate, STORED_AGGREGATE_SCHEMA } from "../secretary-session-state";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bClock, e2bOrigin, e2bWeekday, e2bRandom, wire, type E2bClock, type E2bDay } from "../../test/secretary-pilot-e2b";
import { e2b2Luna, e2b2Pro, e2b2To, E2B2_REASONS, type E2b2Interpretation, type E2b2Professional } from "../../test/secretary-pilot-e2b2";

/** Reschedule pilot, completion of E2-B — owner requirement 2 (who attends): "qualquer profissional" / "com quem estiver livre", "outra pessoa" and
 * exclusions ("menos X", one or several) are TYPED by the model (mode + an exclusion LIST); the resolver only checks real professionals, the service
 * and availability; decision 15 breaks a tie by the fewest appointments that day and, when more than one choice is still left, the Secretária ASKS
 * (never the name order); the current professional is never kept against the delegation. Written BEFORE the fix, with ADVERSARIAL TWINS.
 *  - GAP 2.a: a tie after the fewest appointments is decided by the name order (resolver line "free.sort(... || byName)"): it must be asked.
 *  - GAP 2.b: exclusions are one free-text mention (only in "outro"): several names in it ("Clemência e Deodato") resolve to nobody and NOBODY is
 *    excluded — an excluded member can be chosen (CRITICAL with today's contract); an exclusion that names nobody is ignored in silence; "qualquer"
 *    cannot exclude anyone (asked as a conflict). The contract needs `excluidos: string[]`.
 *  - GAP 2.c: while the delegation "outro" waits for the clock, the plan keeps showing the current professional as kept (inherited).
 *  - COVERED evidence: "qualquer"/"outro" typed; fewest appointments wins; the current one leaves for "outro" and at the origin's own slot; "manter"/
 *    "qualquer" beside another member's name is still a conflict; a saved "outro" exclusion survives the load.
 * received_at: Monday 2031-03-10, 09:00 in São Paulo. Petronilha: Thursday 13/03 15:00 with Brígida (the current professional). Loads are other
 * customers' appointments in the morning (never overlapping the slot). Invented names and sentences; no network, database or model. */
const reflexo: PilotServiceRow = { id: "srv-reflexo", name: "Reflexologia andina", durationMin: 50, priceCents: 11000 };
const pro = (id: string, name: string): PilotProfessionalRow => ({ id, name, serviceIds: [reflexo.id] });
const anacleto = pro("pro-a", "Anacleto Jurubeba"), brigida = pro("pro-b", "Brígida Taquaral"), clemencia = pro("pro-c", "Clemência Itapecuru");
const deodato = pro("pro-d", "Deodato Mucuri"), eufrasia = pro("pro-e", "Eufrásia Juruena"), deodato2 = pro("pro-d2", "Deodato Paraopeba");
const petronilha: PilotPerson = { id: "cli-q", name: "Petronilha Gurupi" }, rufino: PilotPerson = { id: "cli-r", name: "Rufino Tibagi" };
const THU = "2031-03-13", FRI = "2031-03-14", NEXT_THU = "2031-03-20";
const TEAM = [anacleto, brigida, clemencia, deodato, eufrasia];
const MORNING = ["08:00", "09:00", "10:00"];
type Loads = Partial<Record<string, number>>;
/** `loads`: appointments of other customers that `date` for each professional id (mornings only, so everyone stays free at the slot). */
function salon(loads: Loads = {}, date = FRI, over: MemorySalon = {}): MemorySalon {
  const team = over.team ?? TEAM;
  const fillers: PilotAppointmentRow[] = Object.entries(loads).flatMap(([id, n]) => Array.from({ length: n ?? 0 }, (_, index) =>
    booked(`load-${id}-${index}`, rufino, team.find(item => item.id === id)!, reflexo, date, MORNING[index])));
  return { customers: [petronilha, rufino], team, catalog: [reflexo], hours: Object.fromEntries(team.map(item => [item.id, everyDay(["08:00", "22:00"])])),
    appointments: [booked("apt-q", petronilha, brigida, reflexo, THU, "15:00"), booked("apt-q2", petronilha, brigida, reflexo, NEXT_THU, "15:00"), ...fillers], ...over };
}
const FRI_16 = { date: FRI, time: "16:00" }, ORIGIN_SLOT = { date: THU, time: "15:00" };
const ctx = (slot = FRI_16) => ({ current: { id: brigida.id, name: brigida.name }, appointmentId: "apt-q", serviceId: reflexo.id, durationMin: reflexo.durationMin,
  slot, origin: ORIGIN_SLOT });
const resolve = (profissional: E2b2Professional, base: MemorySalon, slot = FRI_16) => resolveProfessional(memoryReader(base), wire(profissional), ctx(slot));
/** What a resolution leaves: who was chosen, or the state with its options' ids (sorted). */
const outcome = (result: PilotProfessionalResolution) => result.state === "chosen" ? result.id
  : { state: result.state, ...("options" in result && Array.isArray(result.options) ? { options: result.options.map(item => item.id).sort() } : {}) };
const outro = (excluidos: string[] = []) => ({ modo: "outro" as const, mencao: null, excluidos });
const qualquer = (excluidos: string[] = []) => ({ modo: "qualquer" as const, mencao: null, excluidos });

describe("COVERED: the delegation is typed (mode) and decision 15's fewest appointments decides when it can", () => {
  it("contract: 'qualquer' and 'outro' decode as typed modes; the unique fewest wins (the current one too, for 'qualquer'); 'outro' leaves the current one out", async () => {
    for (const modo of ["qualquer", "outro"] as const)
      expect(decodePilotInterpretation(e2b2Luna({ cliente: { mencao: "Petronilha" }, destino: e2b2To(null, null, e2b2Pro(modo)) })).destino.profissional.modo).toBe(modo);
    expect(await resolve(qualquer(), salon({ "pro-a": 1, "pro-b": 0, "pro-c": 1, "pro-d": 1, "pro-e": 1 })).then(outcome)).toBe(brigida.id);
    expect(await resolve(outro(), salon({ "pro-a": 1, "pro-b": 0, "pro-c": 0, "pro-d": 1, "pro-e": 1 })).then(outcome)).toBe(clemencia.id);
  });
  it("controls kept: 'manter' or 'qualquer' beside another member's name (no exclusion) is still a conflict, never a silent choice", async () => {
    expect((await resolve({ modo: "qualquer", mencao: "Clemência" }, salon())).state).toBe("conflict");
    expect((await resolve({ modo: "manter", mencao: "Clemência" }, salon())).state).toBe("conflict");
  });
});

describe("GAP 2.a — a tie after the fewest appointments is ASKED with the tied members, never decided by the name order", () => {
  it("'outro' (the current one out): Anacleto 0 and Clemência 0 → tie asked with both; TWIN: Anacleto 1 → Clemência chosen", async () => {
    expect(await resolve(outro(), salon({ "pro-a": 1, "pro-c": 0, "pro-d": 1, "pro-e": 1 })).then(outcome)).toBe(clemencia.id);
    expect(await resolve(outro(), salon({ "pro-a": 0, "pro-c": 0, "pro-d": 1, "pro-e": 1 })).then(outcome)).toEqual({ state: "tie", options: [anacleto.id, clemencia.id] });
  });
  it("'qualquer' with the current one tied (Brígida 0, Anacleto 0): asked with both; TWIN: Anacleto 1 → Brígida (fewest)", async () => {
    expect(await resolve(qualquer(), salon({ "pro-a": 1, "pro-b": 0, "pro-c": 1, "pro-d": 1, "pro-e": 1 })).then(outcome)).toBe(brigida.id);
    expect(await resolve(qualquer(), salon({ "pro-a": 0, "pro-b": 0, "pro-c": 1, "pro-d": 1, "pro-e": 1 })).then(outcome)).toEqual({ state: "tie", options: [anacleto.id, brigida.id] });
  });
  it("'qualquer' at the origin's own slot (the current one out as a fact): a tie of the others is asked; TWIN: one of them busier → the other", async () => {
    expect(await resolve(qualquer(), salon({ "pro-a": 1, "pro-c": 0, "pro-d": 1, "pro-e": 1 }, THU), ORIGIN_SLOT).then(outcome)).toBe(clemencia.id);
    expect(await resolve(qualquer(), salon({ "pro-a": 0, "pro-c": 0, "pro-d": 1, "pro-e": 1 }, THU), ORIGIN_SLOT).then(outcome)).toEqual({ state: "tie", options: [anacleto.id, clemencia.id] });
  });
  it("property (60 seeded rounds): the unique fewest is chosen; two or more with the fewest are asked (exactly them); never the name order", async () => {
    const random = e2bRandom(20311002);
    for (let round = 0; round < 60; round++) {
      const loads: Loads = Object.fromEntries(TEAM.map(item => [item.id, Math.floor(random() * 3)]));
      const mode: "qualquer" | "outro" = random() < 0.5 ? "qualquer" : "outro";
      const candidates = TEAM.filter(item => mode === "qualquer" || item.id !== brigida.id);
      const least = Math.min(...candidates.map(item => loads[item.id] ?? 0)), winners = candidates.filter(item => (loads[item.id] ?? 0) === least).map(item => item.id).sort();
      const expected = winners.length === 1 ? winners[0] : { state: "tie", options: winners };
      expect(await resolve(mode === "outro" ? outro() : qualquer(), salon(loads)).then(outcome), `${round} ${mode} ${JSON.stringify(loads)}`).toEqual(expected);
    }
  });
});

describe("GAP 2.b — exclusions are a typed LIST (one or several), each checked against the real team; never ignored, never chosen", () => {
  it("contract: excluidos decodes with 'outro' and 'qualquer', with one or several names (the owner's words for each)", () => {
    for (const profissional of [outro(["Clemência"]), outro(["Clemência", "Deodato"]), qualquer(["Eufrásia"])]) {
      const frame = e2b2Luna({ cliente: { mencao: "Petronilha" }, destino: e2b2To(e2bWeekday("sexta", "na sexta"), e2bClock(16, "às 16h"), profissional) });
      expect(decodePilotInterpretation(structuredClone(frame)), JSON.stringify(profissional)).toEqual(frame);
    }
  });
  it("CRITICAL today: 'outro' whose one mention names two members ('Clemência e Deodato') never chooses either of them (nor offers them)", async () => {
    const result = await resolve({ modo: "outro", mencao: "Clemência e Deodato" }, salon({ "pro-a": 1, "pro-c": 0, "pro-d": 0, "pro-e": 1 }));
    expect([clemencia.id, deodato.id], "an excluded member is never chosen").not.toContain(result.state === "chosen" ? result.id : null);
    const offered = "options" in result && Array.isArray(result.options) ? result.options.map(item => item.id) : [];
    expect(offered.filter(id => [clemencia.id, deodato.id, brigida.id].includes(id)), "nor offered").toEqual([]);
  });
  it("TWINS 'outro' (Anacleto 1, Clemência 0, Deodato 0, Eufrásia 1): none excluded → Clemência/Deodato tie asked; Clemência → Deodato; Clemência and Deodato → Anacleto/Eufrásia tie asked", async () => {
    const base = salon({ "pro-a": 1, "pro-c": 0, "pro-d": 0, "pro-e": 1 });
    expect(await resolve(outro(["Clemência"]), base).then(outcome)).toBe(deodato.id);
    expect(await resolve(outro(["Clemência", "Deodato"]), base).then(outcome)).toEqual({ state: "tie", options: [anacleto.id, eufrasia.id] });
    expect(await resolve(outro(), base).then(outcome)).toEqual({ state: "tie", options: [clemencia.id, deodato.id] });
  });
  it("'qualquer' with an exclusion: the excluded one leaves, the current one stays a candidate (Brígida 1 wins over the others' 2); never a conflict", async () => {
    const base = salon({ "pro-a": 2, "pro-b": 1, "pro-c": 0, "pro-d": 2, "pro-e": 2 });
    expect(await resolve(qualquer(), base).then(outcome), "TWIN without the exclusion: Clemência (0)").toBe(clemencia.id);
    expect(await resolve(qualquer(["Clemência"]), base).then(outcome)).toBe(brigida.id);
  });
  it("an exclusion that names nobody of the team (a slip, or another surname) is ASKED with that mention, never ignored; TWIN with the exact name → Deodato", async () => {
    const base = salon({ "pro-a": 2, "pro-c": 0, "pro-d": 1, "pro-e": 2 });
    expect(await resolve(outro(["Clemência"]), base).then(outcome)).toBe(deodato.id);
    for (const mention of ["Clemêncio", "Clemência Paraguaçu"]) {
      const result = await resolve(outro([mention]), base);
      expect(result.state === "chosen" ? result.id : null, mention).not.toBe(clemencia.id);
      expect(result, mention).toMatchObject({ state: expect.stringMatching(/^(not_found|contradictory)$/), mencao: mention });
    }
  });
  it("an ambiguous exclusion leaves out every member it may be (§11.3), no question: two Deodatos out → Clemência (1); TWIN none excluded → the Deodatos' tie", async () => {
    const team = [...TEAM, deodato2], base = salon({ "pro-a": 2, "pro-c": 1, "pro-d": 0, "pro-d2": 0, "pro-e": 2 }, FRI, { team });
    expect(await resolve(outro(), base).then(outcome)).toEqual({ state: "tie", options: [deodato.id, deodato2.id] });
    expect(await resolve(outro(["Deodato"]), base).then(outcome)).toBe(clemencia.id);
  });
  it("property (60 seeded rounds): an excluded member is never chosen nor offered; the rest is decision 15 with the ask on a tie", async () => {
    const random = e2bRandom(20311003);
    for (let round = 0; round < 60; round++) {
      const loads: Loads = Object.fromEntries(TEAM.map(item => [item.id, Math.floor(random() * 3)]));
      const mode: "qualquer" | "outro" = random() < 0.5 ? "qualquer" : "outro";
      const excluded = TEAM.filter(item => item.id !== brigida.id && random() < 0.35);
      const left = TEAM.filter(item => !excluded.includes(item) && (mode === "qualquer" || item.id !== brigida.id));
      const least = Math.min(...left.map(item => loads[item.id] ?? 0)), winners = left.filter(item => (loads[item.id] ?? 0) === least).map(item => item.id).sort();
      const expected = !left.length ? { state: "nobody_free" } : winners.length === 1 ? winners[0] : { state: "tie", options: winners };
      const words = excluded.map(item => item.name.split(" ")[0]);
      expect(await resolve(mode === "outro" ? outro(words) : qualquer(words), salon(loads)).then(outcome), `${round} ${mode} -${words.join(",")} ${JSON.stringify(loads)}`).toEqual(expected);
    }
  });
});

function fake(frames: E2b2Interpretation[], base: MemorySalon) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [];
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-e2b2-pro", userId: "user-e2b2-pro" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => clockAt(),
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async () => undefined,
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-q", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, model };
}
const ID = "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b08";
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: ID, message });
const who = (change: PilotResolvedChange | undefined) => change && { appointmentRef: change.appointmentRef, date: change.date, time: change.time, professionalRef: change.professionalRef };
const optionIds = (reply: PilotReply) => (reply.view.questions[0]?.options ?? []).map(option => option.id).sort();
const forPetronilha = (dia: E2bDay | null, hora: E2bClock | null, profissional: E2b2Professional) =>
  e2b2Luna({ cliente: { mencao: "Petronilha" }, origem: e2bOrigin({ dia: e2bWeekday("quinta", "de quinta", "este") }), destino: e2b2To(dia, hora, profissional) });
const FRIDAY_16 = [e2bWeekday("sexta", "pra sexta"), e2bClock(16, "às 16h")] as const;

describe("GAP 2.a/2.b through the orchestrator: one question with the real tied members; the tap binds; exclusions never offered", () => {
  it("'outro' with a tie (Anacleto 0, Clemência 0): PROFESSIONAL_TIE on `professional` with both, nothing prepared; tapping Clemência proposes her; TWIN Anacleto 1 → Clemência proposed at once", async () => {
    const twin = fake([forPetronilha(...FRIDAY_16, e2b2Pro("outro"))], salon({ "pro-a": 1, "pro-c": 0, "pro-d": 1, "pro-e": 1 }));
    await send(twin, "A Petronilha de quinta vai pra sexta às 16h com outra pessoa");
    expect(twin.prepared.map(who)).toEqual([{ appointmentRef: "apt-q", date: FRI, time: "16:00", professionalRef: clemencia.id }]);
    const f = fake([forPetronilha(...FRIDAY_16, e2b2Pro("outro"))], salon({ "pro-a": 0, "pro-c": 0, "pro-d": 1, "pro-e": 1 }));
    const asked = await send(f, "A Petronilha de quinta vai pra sexta às 16h com outra pessoa");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "professional", reason: E2B2_REASONS.tie })]);
    expect(optionIds(asked)).toEqual([anacleto.id, clemencia.id]);
    expect(f.prepared, "never the name order in silence").toEqual([]);
    for (const name of [anacleto.name, clemencia.name]) expect(asked.text).toContain(name);
    await selectPilotOption(f.host, pilotOptionRef(asked.view.questions[0].questionId, clemencia.id));
    expect(f.prepared.map(who)).toEqual([{ appointmentRef: "apt-q", date: FRI, time: "16:00", professionalRef: clemencia.id }]);
  });
  it("'outro' without Clemência and Deodato (typed list): the tie of the two left is asked, the excluded never offered; TWIN only Clemência excluded → Deodato proposed", async () => {
    const base = () => salon({ "pro-a": 1, "pro-c": 0, "pro-d": 0, "pro-e": 1 });
    const twin = fake([forPetronilha(...FRIDAY_16, e2b2Pro("outro", ["Clemência"]))], base());
    await send(twin, "A Petronilha de quinta vai pra sexta às 16h com outra pessoa, menos a Clemência");
    expect(twin.prepared.map(who)).toEqual([{ appointmentRef: "apt-q", date: FRI, time: "16:00", professionalRef: deodato.id }]);
    const f = fake([forPetronilha(...FRIDAY_16, e2b2Pro("outro", ["Clemência", "Deodato"]))], base());
    const asked = await send(f, "A Petronilha de quinta vai pra sexta às 16h com outra pessoa, menos a Clemência e o Deodato");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "professional", reason: E2B2_REASONS.tie })]);
    expect(optionIds(asked)).toEqual([anacleto.id, eufrasia.id]);
    expect(f.prepared).toEqual([]);
  });
  it("an exclusion naming nobody of the team is asked on `professional` (never ignored): nothing prepared, Clemência never proposed", async () => {
    const f = fake([forPetronilha(...FRIDAY_16, e2b2Pro("outro", ["Clemêncio"]))], salon({ "pro-a": 2, "pro-c": 0, "pro-d": 1, "pro-e": 2 }));
    const asked = await send(f, "A Petronilha de quinta vai pra sexta às 16h com outra pessoa, menos o Clemêncio");
    // §11.10 (contract migration; was PROFESSIONAL_(NOT_FOUND|CONTRADICTORY)): the exclusion question has reasons of its own, never a who-attends one.
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "professional", reason: expect.stringMatching(/^EXCLUSION_(NOT_FOUND|CONTRADICTORY)$/) })]);
    expect(f.prepared).toEqual([]);
  });
});

describe("GAP 2.c — the current professional is never kept in the plan against a delegation that excludes her", () => {
  it("'sexta às 16h' (Brígida kept); then 'outro' with a clock to ask: while the clock is asked, the professional is not Brígida (unresolved); TWIN without 'outro' keeps Brígida", async () => {
    const twin = fake([forPetronilha(...FRIDAY_16, e2b2Pro(null)), e2b2Luna({ destino: e2b2To(null, e2bClock(9, "às 9"), e2b2Pro(null)) })], salon());
    await send(twin, "A Petronilha de quinta vai pra sexta às 16h");
    const kept = await send(twin, "Melhor às 9");
    expect(kept.view.questions).toEqual([expect.objectContaining({ field: "time", reason: "TIME_TWO_READINGS" })]);
    expect(kept.view.fields?.professional).toMatchObject({ value: brigida.id, provenance: "inherited" });
    const f = fake([forPetronilha(...FRIDAY_16, e2b2Pro(null)), e2b2Luna({ destino: e2b2To(null, e2bClock(9, "às 9"), e2b2Pro("outro")) })], salon());
    await send(f, "A Petronilha de quinta vai pra sexta às 16h");
    expect(f.prepared.map(who)).toEqual([{ appointmentRef: "apt-q", date: FRI, time: "16:00", professionalRef: brigida.id }]);
    const asked = await send(f, "Melhor às 9, com outra pessoa");
    expect(asked.view.questions).toEqual([expect.objectContaining({ field: "time", reason: "TIME_TWO_READINGS" })]);
    expect(asked.view.fields?.professional.value, "the delegation excludes her: never shown as kept").not.toBe(brigida.id);
  });
});

describe("COVERED (migration guard): a conversation saved with the E2-B 'outro' exclusion in its mention still excludes that member after loading", () => {
  it("saved pending { modo: 'outro', mencao: 'Clemência' } (Clemência 0, Deodato 1): after the load and the answer, Deodato — never Clemência", async () => {
    const ask = e2b2Luna({ cliente: { mencao: "Petronilha" }, destino: e2b2To(...FRIDAY_16, e2b2Pro("outro")) });
    const first = fake([ask], salon({ "pro-a": 2, "pro-c": 0, "pro-d": 1, "pro-e": 2 }));
    expect((await send(first, "A Petronilha vai pra sexta às 16h com outra pessoa")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    const saved = JSON.parse(JSON.stringify(first.state)) as PilotSessionState & { pending: { destino: { profissional: unknown } } };
    saved.pending.destino.profissional = { modo: "outro", mencao: "Clemência" };
    const loaded = (parseStoredAggregate({ schema: STORED_AGGREGATE_SCHEMA, root: ID, sessions: [{ id: ID, skill: "auto", expires: 1, turns: 1, cancelled: false, pilot: saved }] })
      .sessions[0] as { pilot: PilotSessionState }).pilot;
    const next = fake([e2b2Luna({ tipo: "resposta", resposta_a: "q1", origem: e2bOrigin({ dia: e2bWeekday("quinta", "a desta quinta", "este") }) })],
      salon({ "pro-a": 2, "pro-c": 0, "pro-d": 1, "pro-e": 2 }));
    Object.assign(next.state, loaded);
    await send(next, "a desta quinta");
    expect(next.prepared.map(who)).toEqual([{ appointmentRef: "apt-q", date: FRI, time: "16:00", professionalRef: deodato.id }]);
  });
});
