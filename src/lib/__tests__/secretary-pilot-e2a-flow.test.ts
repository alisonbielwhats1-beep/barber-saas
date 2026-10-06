import { describe, expect, it } from "vitest";
import type { Model } from "@everflair/salon-secretary";
import { PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { handlePilotMessage, PILOT_OUT_OF_SCOPE_REPLY, PILOT_WITHDRAWN_REPLY, type PilotHost, type PilotReceipt, type PilotReply, type PilotResolvedChange,
  type PilotSessionState } from "../secretary-pilot";
import type { PilotPerson, PilotProfessionalRow, PilotServiceRow } from "../secretary-pilot-resolver";
import { storedSession } from "../secretary-session-state";
import { formatLocal } from "../secretary-datetime-format";
import { addCalendarDays } from "../time";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { E2A_OUT_OF_SCOPE_KINDS, e2aClock, e2aDay, e2aLuna, e2aOrigin, e2aService, e2aTo, type E2aInterpretation, type E2aOutOfScopeKind } from "../../test/secretary-pilot-e2a";

/** Reschedule pilot E2-A through the orchestrator (docs/c5-spike/12-piloto-remarcacao.md §10; Adendo 10), written BEFORE the implementation, with
 * a scripted Luna that answers the E2-A contract and an in-memory salon; the host's agenda preparation and Confirmar are stand-ins that record what
 * they receive.
 *  - Context (observacoes) with no separate request reaches the proposal with NO scope question; observacoes never change a resolved value
 *    (property test) and only their count reaches the telemetry (their words are kept nowhere).
 *  - A real separate request (every kind) still asks the scope question; context beside one real request asks it once.
 *  - The weekday enum and the service hint locate the appointment end to end; the persisted state loads with the new shapes.
 *  - Adversarial review: an answer to an appointment question is resolved among that question's options by the answer's own hints (FLOW-1), a
 *    service mention that fits no catalog name asks (PRINCIPLE-1), the catalog names past the 80th reach Luna (CATALOG-1), a notice of this very
 *    change and the same customer's slot taken out and put elsewhere stay inside the reschedule (SEMANTICS-1/2).
 * received_at is Thursday 2031-03-13, 09:00 in São Paulo. Invented names and sentences; no network, database or paid model. */
const escova: PilotServiceRow = { id: "srv-escova", name: "Escova modelada", durationMin: 45, priceCents: 7000 };
const hidratacao: PilotServiceRow = { id: "srv-hidratacao", name: "Hidratação capilar", durationMin: 60, priceCents: 9500 };
const camadas: PilotServiceRow = { id: "srv-camadas", name: "Corte em camadas", durationMin: 50, priceCents: 8000 };
const lisandra: PilotProfessionalRow = { id: "pro-lisandra", name: "Lisandra Pompeu", serviceIds: [escova.id, hidratacao.id, camadas.id] };
const thales: PilotProfessionalRow = { id: "pro-thales", name: "Thales Aranha", serviceIds: [escova.id, camadas.id] };
const person = (id: string, name: string): PilotPerson => ({ id, name });
const eudoxia = person("cli-eudoxia", "Eudóxia Marcondes"), filomeno = person("cli-filomeno", "Filomeno Bonfim"), cremilda = person("cli-cremilda", "Cremilda Caldas");
const THU = "2031-03-13", FRI = "2031-03-14", SAT = "2031-03-15", SUN = "2031-03-16", MON = "2031-03-17", TUE = "2031-03-18", WED = "2031-03-19", NEXT_TUE = "2031-03-25";
/** Eudóxia: escova on Friday, hidratação on Saturday and on the Tuesday after; Filomeno: one corte on Friday; Cremilda: escova on Friday and Wednesday. */
const rows = () => [booked("apt-eu-escova", eudoxia, lisandra, escova, FRI, "10:00"), booked("apt-eu-hidra", eudoxia, lisandra, hidratacao, SAT, "14:00"),
  booked("apt-eu-hidra-2", eudoxia, lisandra, hidratacao, NEXT_TUE, "11:00"), booked("apt-fi", filomeno, thales, camadas, FRI, "16:00"),
  booked("apt-cre-fri", cremilda, thales, escova, FRI, "15:00"), booked("apt-cre-wed", cremilda, thales, escova, WED, "10:00")];
const salon = (over: MemorySalon = {}): MemorySalon => ({ customers: [eudoxia, filomeno, cremilda], team: [lisandra, thales], catalog: [escova, hidratacao, camadas],
  hours: { [lisandra.id]: everyDay(["08:00", "20:00"]), [thales.id]: everyDay(["08:00", "20:00"]) }, appointments: rows(), ...over });

/** A host over the in-memory salon: the scripted Luna answers the E2-A frames, the preparation proposes, the Confirmar writes. */
function fake(frames: E2aInterpretation[], base: MemorySalon = salon()) {
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], settled: PilotReceipt[] = [];
  const model = new ScriptedServicesModel(frames.map(frame => call(PILOT_RESCHEDULE_TOOL, frame))), reader = memoryReader(base);
  let n = 0;
  const host: PilotHost = { actor: { salonId: "salon-e2a", userId: "user-e2a" }, state, modelId: "gpt-6-luna",
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => clockAt("2031-03-13T12:00:00.000Z"),
    prepare: async change => { prepared.push(change); n += 1; return { ok: true, proposal: { proposalRef: `prop-${n}`, draftRef: `draft-${n}`, draftRevision: 1, revision: 0, text: `PROPOSTA ${n}` } }; },
    receipt: async () => undefined, settle: async receipt => { settled.push(receipt); },
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-x", outcome: "RESCHEDULED", duplicate: false }) };
  return { host, state, prepared, settled, model, base };
}
const send = (f: ReturnType<typeof fake>, message: string) => handlePilotMessage(f.host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a01", message });
const slot = (change: PilotResolvedChange | undefined) => change && { appointmentRef: change.appointmentRef, date: change.date, time: change.time, professionalRef: change.professionalRef };
const scopeQuestions = (reply: PilotReply) => reply.view.questions.filter(question => question.field === "scope");
const occurrences = (text: string, part: string) => text.split(part).length - 1;
const session = (pilot: unknown) => ({ id: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0a01", skill: "auto", expires: 1, turns: 0, cancelled: false, pilot });

/** In-scope messages rich in context (each invented): Luna's reading keeps everything inside the reschedule (fora_do_escopo empty). */
const CONTEXT_CASES: { label: string; message: string; frame: E2aInterpretation; expected: ReturnType<typeof slot> }[] = [
  { label: "reason", message: "O Filomeno pegou plantão no hospital, então passa o corte dele pra sábado às 16h",
    frame: e2aLuna({ cliente: { mencao: "Filomeno" }, origem: e2aOrigin({ servico: e2aService("o corte", ["Corte em camadas"]) }),
      destino: e2aTo(e2aDay("sabado", "pra sábado"), e2aClock(16, "às 16h")), observacoes: ["pegou plantão no hospital"] }),
    expected: { appointmentRef: "apt-fi", date: SAT, time: "16:00", professionalRef: thales.id } },
  { label: "courtesy", message: "Bom dia! Se não for incômodo, pode jogar a Eudóxia da escova pra quarta às 9h30? Obrigada!",
    frame: e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("da escova", ["Escova modelada"]) }),
      destino: e2aTo(e2aDay("quarta", "pra quarta"), e2aClock(9, "às 9h30", 30)), observacoes: ["Bom dia!", "Se não for incômodo", "Obrigada!"] }),
    expected: { appointmentRef: "apt-eu-escova", date: WED, time: "09:30", professionalRef: lisandra.id } },
  { label: "correction", message: "Leva o Filomeno pra sábado às 10, não, às 11",
    frame: e2aLuna({ cliente: { mencao: "Filomeno" }, destino: e2aTo(e2aDay("sabado", "pra sábado"), e2aClock(11, "às 11")), observacoes: ["às 10, não"] }),
    expected: { appointmentRef: "apt-fi", date: SAT, time: "11:00", professionalRef: thales.id } },
  { label: "condition", message: "Se tiver vaga, coloca a escova da Eudóxia no domingo às 15h, com a mesma profissional",
    frame: e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("a escova", ["Escova modelada"]) }),
      destino: e2aTo(e2aDay("domingo", "no domingo"), e2aClock(15, "às 15h"), { modo: "manter", mencao: null }), observacoes: ["Se tiver vaga"] }),
    expected: { appointmentRef: "apt-eu-escova", date: SUN, time: "15:00", professionalRef: lisandra.id } },
  { label: "customer information", message: "A Eudóxia está com o braço engessado; a escova dela fica pra terça às 14h",
    frame: e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("a escova", ["Escova modelada"]) }),
      destino: e2aTo(e2aDay("terca", "pra terça"), e2aClock(14, "às 14h")), observacoes: ["está com o braço engessado"] }),
    expected: { appointmentRef: "apt-eu-escova", date: TUE, time: "14:00", professionalRef: lisandra.id } },
  { label: "availability check serving the reschedule", message: "Vê se o Thales tem domingo às 10h livre e, se tiver, passa o corte do Filomeno pra lá",
    frame: e2aLuna({ cliente: { mencao: "Filomeno" }, origem: e2aOrigin({ servico: e2aService("o corte", ["Corte em camadas"]) }),
      destino: e2aTo(e2aDay("domingo", "domingo"), e2aClock(10, "às 10h"), { modo: "nomeado", mencao: "Thales" }), observacoes: ["Vê se o Thales tem domingo às 10h livre"] }),
    expected: { appointmentRef: "apt-fi", date: SUN, time: "10:00", professionalRef: thales.id } },
  { label: "reference to the appointment", message: "Sabe aquela hidratação que a Eudóxia marcou no sábado à tarde? Joga pra segunda às 17h",
    frame: e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("aquela hidratação", ["Hidratação capilar"]), dia: e2aDay("sabado", "no sábado") }),
      destino: e2aTo(e2aDay("segunda", "pra segunda"), e2aClock(17, "às 17h")), observacoes: ["Sabe aquela hidratação que a Eudóxia marcou"] }),
    expected: { appointmentRef: "apt-eu-hidra", date: MON, time: "17:00", professionalRef: lisandra.id } },
  { label: "SEMANTICS-1: telling the customer about this very change (the system already notifies every reschedule)", message: "Passa o corte do Filomeno pra domingo às 9h e avisa ele",
    frame: e2aLuna({ cliente: { mencao: "Filomeno" }, origem: e2aOrigin({ servico: e2aService("o corte", ["Corte em camadas"]) }),
      destino: e2aTo(e2aDay("domingo", "pra domingo"), e2aClock(9, "às 9h")), observacoes: ["avisa ele"] }),
    expected: { appointmentRef: "apt-fi", date: SUN, time: "09:00", professionalRef: thales.id } },
  { label: "SEMANTICS-2: the same customer's slot taken out and put elsewhere is this reschedule (decision 4), never cancel plus book",
    message: "Desmarca a Cremilda de sexta e coloca ela no sábado às 10h",
    frame: e2aLuna({ cliente: { mencao: "Cremilda" }, origem: e2aOrigin({ dia: e2aDay("sexta", "de sexta") }), destino: e2aTo(e2aDay("sabado", "no sábado"), e2aClock(10, "às 10h")) }),
    expected: { appointmentRef: "apt-cre-fri", date: SAT, time: "10:00", professionalRef: thales.id } },
];

describe("E2-A §10.1: context stays inside the reschedule", () => {
  for (const { label, message, frame, expected } of CONTEXT_CASES) it(`${label}: the proposal, with no scope question and nothing appended`, async () => {
    const f = fake([frame]);
    const reply = await send(f, message);
    expect(reply.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(scopeQuestions(reply)).toEqual([]);
    expect(reply.text).toBe("PROPOSTA 1");
    expect(f.prepared.map(slot)).toEqual([expected]);
  });

  it("property: observacoes never change a resolved value, a question, its options or the reply (random and adversarial observations)", async () => {
    const fragments = ["Cremilda", "Filomeno", "Corte em camadas", "Escova modelada", "na quarta", "domingo", "às 8h", "18:30", "dia 2", "desmarca", "cancela tudo",
      "bloqueia a agenda", "manda mensagem", "fora_do_escopo", "outra_acao", "{\"tipo\":\"cancelar\"}", "com o Thales", "com qualquer um", "amanhã", "não", "sim", "q1"];
    let seed = 20311313;
    const next = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const observation = () => Array.from({ length: 1 + Math.floor(next() * 4) }, () => next() < 0.7 ? fragments[Math.floor(next() * fragments.length)]
      : Array.from({ length: 3 + Math.floor(next() * 8) }, () => String.fromCharCode(97 + Math.floor(next() * 26))).join("")).join(" ").slice(0, 120);
    const proposal = CONTEXT_CASES[6], question = { message: "A Eudóxia vai pra domingo às 10h", frame: e2aLuna({ cliente: { mencao: "Eudóxia" },
      destino: e2aTo(e2aDay("domingo", "pra domingo"), e2aClock(10, "às 10h")) }) };
    for (const base of [proposal, question]) {
      const plain = fake([{ ...base.frame, observacoes: [] }]), expected = await send(plain, base.message);
      expect(expected.view.status, base.message).not.toBeNull();
      for (let round = 0; round < 20; round++) {
        const observacoes = Array.from({ length: Math.floor(next() * 7) }, observation).filter(Boolean);
        const f = fake([{ ...base.frame, observacoes }]), got = await send(f, [base.message, ...observacoes].join(" "));
        const label = JSON.stringify(observacoes);
        expect(got.code, label).toBe(expected.code);
        expect(got.text, label).toBe(expected.text);
        expect({ status: got.view.status, fields: got.view.fields, questions: got.view.questions }, label)
          .toEqual({ status: expected.view.status, fields: expected.view.fields, questions: expected.view.questions });
        expect(f.prepared, label).toEqual(plain.prepared);
      }
    }
  });

  it("only the count of observacoes reaches the telemetry; neither the telemetry nor the saved state keeps their words", async () => {
    const observacoes = ["zumbido azul primeiro", "zumbido azul segundo", "zumbido azul terceiro"];
    const f = fake([{ ...CONTEXT_CASES[0].frame, observacoes }]);
    const reply = await send(f, `${CONTEXT_CASES[0].message} ${observacoes.join(" ")}`);
    expect(reply.view.status).toBe("proposal_ready");
    const counted = Object.entries(reply.telemetry ?? {}).filter(([key]) => /observ/i.test(key));
    expect(counted).toEqual([[expect.any(String), observacoes.length]]);
    expect(JSON.stringify(reply.telemetry)).not.toContain("zumbido");
    expect(JSON.stringify(f.state)).not.toContain("zumbido");
    // Without observations the count is 0 (or the key is left out).
    const none = fake([{ ...CONTEXT_CASES[2].frame, observacoes: [] }]), quiet = await send(none, "Leva o Filomeno pra sábado às 11");
    expect(quiet.view.status).toBe("proposal_ready");
    expect([[], [0]]).toContainEqual(Object.entries(quiet.telemetry ?? {}).filter(([key]) => /observ/i.test(key)).map(([, value]) => value));
  });

  it("an answer with context fills only the asked field; a withdrawal with context withdraws; neither asks the scope question", async () => {
    const asked = fake([e2aLuna({ cliente: { mencao: "Eudóxia" }, destino: e2aTo(e2aDay("domingo", "pra domingo"), e2aClock(10, "às 10h")) }),
      e2aLuna({ tipo: "resposta", resposta_a: "q1", origem: e2aOrigin({ servico: e2aService("a da escova", ["Escova modelada"]) }), observacoes: ["foi mal, esqueci de dizer"] })]);
    expect((await send(asked, "A Eudóxia vai pra domingo às 10h")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    const answered = await send(asked, "foi mal, esqueci de dizer: é a da escova");
    expect(answered.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(asked.prepared.map(slot)).toEqual([{ appointmentRef: "apt-eu-escova", date: SUN, time: "10:00", professionalRef: lisandra.id }]);
    const withdrawn = fake([CONTEXT_CASES[0].frame, e2aLuna({ desistir: true, cliente: { mencao: "Filomeno" }, observacoes: ["ele desmarcou o plantão"] })]);
    await send(withdrawn, CONTEXT_CASES[0].message);
    const out = await send(withdrawn, "Esquece a do Filomeno, ele desmarcou o plantão");
    expect(out).toMatchObject({ code: "WITHDRAWN", text: PILOT_WITHDRAWN_REPLY });
    expect(scopeQuestions(out)).toEqual([]);
  });
});

describe("E2-A §10.1: a real separate request is still detected and asked", () => {
  /** One invented separate request of each kind (the words Luna copies into `pedido`). */
  const REQUESTS: Record<E2aOutOfScopeKind, string> = {
    cancelar: "desmarca a Cremilda de quarta", bloquear: "trava os horários do Thales no domingo de manhã", trocar_servico: "troca o serviço dele pra hidratação",
    agendar: "reserva um horário novo de corte pra Cremilda na segunda", consultar: "me diz quantos clientes a Lisandra tem na terça", outra_acao: "passa também a Cremilda pra terça",
    recorrencia: "deixa ele fixo toda sexta", mensagem: "manda pro Filomeno o link da pesquisa de satisfação",
  };
  const move = (over: Partial<E2aInterpretation> = {}) => e2aLuna({ cliente: { mencao: "Filomeno" }, destino: e2aTo(e2aDay("sabado", "pra sábado"), e2aClock(16, "às 16h")), ...over });
  it("each kind beside a reschedule asks the scope question before anything is prepared, naming the request", async () => {
    for (const tipo of E2A_OUT_OF_SCOPE_KINDS) {
      const pedido = REQUESTS[tipo], f = fake([move({ tipo: "misto", fora_do_escopo: [{ tipo, pedido }] })]);
      const reply = await send(f, `Passa o Filomeno pra sábado às 16h e ${pedido}`);
      expect(reply.code, tipo).toBe("ASKED_OUT_OF_SCOPE_PART");
      expect(reply.view.questions, tipo).toEqual([expect.objectContaining({ field: "scope", reason: "OUT_OF_SCOPE_PART" })]);
      expect(reply.text, tipo).toContain(`“${pedido}”`);
      expect(f.prepared, tipo).toEqual([]);
    }
  });
  it("a request wholly out of scope gets the clear reply, with or without context, and opens no plan", async () => {
    for (const tipo of ["cancelar", "agendar", "consultar", "bloquear"] as const) for (const observacoes of [[], ["é urgente, por favor"]]) {
      const pedido = REQUESTS[tipo], f = fake([e2aLuna({ tipo: "fora_do_escopo", fora_do_escopo: [{ tipo, pedido }], observacoes })]);
      const reply = await send(f, [...observacoes, pedido].join(" "));
      expect(reply.code, tipo).toBe("OUT_OF_SCOPE");
      expect(reply.text, tipo).toContain(PILOT_OUT_OF_SCOPE_REPLY);
      expect(reply.view.status, tipo).toBeNull();
      expect(f.prepared, tipo).toEqual([]);
    }
  });
  it("context beside one real request asks the scope question once; the yes prepares only the reschedule and the question never returns", async () => {
    const pedido = REQUESTS.cancelar;
    const f = fake([move({ tipo: "misto", observacoes: ["ele pediu desculpas", "se tiver vaga"], fora_do_escopo: [{ tipo: "cancelar", pedido }] }),
      e2aLuna({ tipo: "resposta", resposta_a: "q1", aceita_parcial: true, observacoes: ["beleza, obrigado"] }),
      e2aLuna({ tipo: "conversa", observacoes: ["valeu!"] })]);
    const asked = await send(f, `Ele pediu desculpas; se tiver vaga, passa o Filomeno pra sábado às 16h e ${pedido}`);
    expect(asked.code).toBe("ASKED_OUT_OF_SCOPE_PART");
    expect(scopeQuestions(asked)).toHaveLength(1);
    expect(asked.view.questions).toHaveLength(1);
    expect(occurrences(asked.text, `“${pedido}”`)).toBe(1);
    expect(asked.text).not.toContain("pediu desculpas");
    expect(f.prepared).toEqual([]);
    const yes = await send(f, "pode ser só a remarcação, beleza, obrigado");
    expect(yes.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-fi", date: SAT, time: "16:00", professionalRef: thales.id }]);
    const thanks = await send(f, "valeu!");
    expect(scopeQuestions(thanks)).toEqual([]);
    expect(thanks.view.status).toBe("proposal_ready");
    expect(f.prepared).toHaveLength(1);
  });
});

describe("E2-A §10.2/§10.3 through the orchestrator: weekday enum and service hint", () => {
  it("the weekday enum picks the origin among two and sets the destination", async () => {
    const f = fake([e2aLuna({ cliente: { mencao: "Cremilda" }, origem: e2aOrigin({ dia: e2aDay("sexta", "a de sexta") }), destino: e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(11, "às 11h")) })]);
    const reply = await send(f, "A de sexta da Cremilda vai pro domingo às 11h");
    expect(reply.view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-cre-fri", date: SUN, time: "11:00", professionalRef: thales.id }]);
  });
  it("one appointment of the service: bound as derived and shown in the proposal's notes", async () => {
    const f = fake([e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("a escova", ["Escova modelada"]) }),
      destino: e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(10, "às 10h")) })]);
    const reply = await send(f, "A escova da Eudóxia vai pro domingo às 10h");
    expect(reply.view.fields?.appointment).toMatchObject({ value: "apt-eu-escova", provenance: "derived" });
    const [change] = f.prepared;
    expect(slot(change)).toEqual({ appointmentRef: "apt-eu-escova", date: SUN, time: "10:00", professionalRef: lisandra.id });
    expect(change.derived).toContain("appointment");
    expect(change.notes.some(note => note.includes(formatLocal(`${FRI}T10:00`, THU)))).toBe(true);
  });
  it("two appointments of the service ask with exactly those options; a service contradicting the day asks showing all of hers", async () => {
    const two = fake([e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("a hidratação", ["Hidratação capilar"]) }),
      destino: e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(10, "às 10h")) })]);
    const several = await send(two, "A hidratação da Eudóxia vai pro domingo às 10h");
    expect(several.code).toBe("ASKED_APPOINTMENT_SEVERAL");
    expect(several.view.questions[0].options?.map(option => option.id).sort()).toEqual(["apt-eu-hidra", "apt-eu-hidra-2"]);
    expect(two.prepared).toEqual([]);
    const contradiction = fake([e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("a escova", ["Escova modelada"]), dia: e2aDay("sabado", "de sábado") }),
      destino: e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(10, "às 10h")) })]);
    const none = await send(contradiction, "A escova de sábado da Eudóxia vai pro domingo às 10h");
    expect(none.code).toBe("ASKED_APPOINTMENT_NONE");
    expect(none.view.questions[0].options?.map(option => option.id).sort()).toEqual(["apt-eu-escova", "apt-eu-hidra", "apt-eu-hidra-2"]);
    expect(contradiction.prepared).toEqual([]);
  });
  it("catalogo [] with a mention equal to a catalog name is never matched by the words: asked showing her appointments (PRINCIPLE-1)", async () => {
    const f = fake([e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("escova modelada", []) }),
      destino: e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(10, "às 10h")) })]);
    const reply = await send(f, "A escova modelada da Eudóxia vai pro domingo às 10h");
    expect(reply.code).toBe("ASKED_APPOINTMENT_NONE");
    expect(reply.view.questions[0].options?.map(option => option.id).sort()).toEqual(["apt-eu-escova", "apt-eu-hidra", "apt-eu-hidra-2"]);
    expect(f.prepared).toEqual([]);
  });
  it("the saved state after E2-A turns loads with the new shapes (service hint, enum weekday) and keeps no observation", async () => {
    const f = fake([CONTEXT_CASES[6].frame]);
    await send(f, CONTEXT_CASES[6].message);
    const saved = JSON.parse(JSON.stringify(f.state)) as PilotSessionState;
    expect(storedSession.safeParse(session(saved)).success).toBe(true);
    expect(saved.pending?.origem).toMatchObject({ servico: { catalogo: ["Hidratação capilar"] }, dia: { tipo: "dia_semana", dia_semana: "sabado" } });
    expect(JSON.stringify(saved)).not.toContain("Sabe aquela");
  });
});

describe("E2-A review FLOW-1 + PRINCIPLE-1: an appointment question is answered among its own options, by the answer's own hints", () => {
  /** Quintiliana: a corte on Friday 11h (Thales) and a hidratação on Saturday 15h (Lisandra). Bartolomeu: only a hidratação on Friday 14h. */
  const quintiliana = person("cli-quintiliana", "Quintiliana Cotrim"), bartolomeu = person("cli-bartolomeu", "Bartolomeu Varejão");
  const world = (): MemorySalon => salon({ customers: [eudoxia, filomeno, cremilda, quintiliana, bartolomeu], appointments: [...rows(),
    booked("apt-q-fri", quintiliana, thales, camadas, FRI, "11:00"), booked("apt-q-sat", quintiliana, lisandra, hidratacao, SAT, "15:00"),
    booked("apt-b-fri", bartolomeu, lisandra, hidratacao, FRI, "14:00")] });
  const toSunday = e2aTo(e2aDay("domingo", "pro domingo"), e2aClock(10, "às 10h"));
  const quinti = (origem: E2aInterpretation["origem"]) => e2aLuna({ cliente: { mencao: "Quintiliana" }, origem, destino: toSunday });
  const answer = (questionId: string, origem: E2aInterpretation["origem"] = e2aOrigin()) => e2aLuna({ tipo: "resposta", resposta_a: questionId, origem });
  const optionIds = (reply: PilotReply) => reply.view.questions[0]?.options?.map(option => option.id).sort();
  const contradiction = () => quinti(e2aOrigin({ dia: e2aDay("sabado", "de sábado"), servico: e2aService("o corte", ["Corte em camadas"]) }));

  it("a service contradicting the day asks (NONE); answering the day binds that option, with only the answer's hints kept", async () => {
    const f = fake([contradiction(), answer("q1", e2aOrigin({ dia: e2aDay("sabado", "o de sábado") }))], world());
    const asked = await send(f, "O corte de sábado da Quintiliana vai pro domingo às 10h");
    expect(asked.code).toBe("ASKED_APPOINTMENT_NONE");
    expect(optionIds(asked)).toEqual(["apt-q-fri", "apt-q-sat"]);
    const bound = await send(f, "é o de sábado");
    expect(bound.view).toMatchObject({ status: "proposal_ready", questions: [] });
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-q-sat", date: SUN, time: "10:00", professionalRef: lisandra.id }]);
    expect(f.state.pending?.origem).toMatchObject({ dia: { dia_semana: "sabado" }, servico: null });
  });
  it("answering the service instead binds the other option (the stale day is not applied again)", async () => {
    const f = fake([contradiction(), answer("q1", e2aOrigin({ servico: e2aService("o corte", ["Corte em camadas"]) }))], world());
    expect((await send(f, "O corte de sábado da Quintiliana vai pro domingo às 10h")).code).toBe("ASKED_APPOINTMENT_NONE");
    expect((await send(f, "é o corte mesmo")).view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-q-fri", date: SUN, time: "10:00", professionalRef: thales.id }]);
  });
  it("a wrong clock, then the day; a wrong weekday, then the service: each answer binds at once, never the same question again", async () => {
    const clock = fake([quinti(e2aOrigin({ hora: e2aClock(10, "das 10h") })), answer("q1", e2aOrigin({ dia: e2aDay("sexta", "a de sexta") }))], world());
    expect((await send(clock, "A das 10h da Quintiliana vai pro domingo às 10h")).code).toBe("ASKED_APPOINTMENT_NONE");
    expect((await send(clock, "é a de sexta")).view.status).toBe("proposal_ready");
    expect(clock.prepared.map(change => change.appointmentRef)).toEqual(["apt-q-fri"]);
    const weekday = fake([quinti(e2aOrigin({ dia: e2aDay("segunda", "A de segunda") })), answer("q1", e2aOrigin({ servico: e2aService("a da hidratação", ["Hidratação capilar"]) }))], world());
    expect((await send(weekday, "A de segunda da Quintiliana vai pro domingo às 10h")).code).toBe("ASKED_APPOINTMENT_NONE");
    expect((await send(weekday, "é a da hidratação")).view.status).toBe("proposal_ready");
    expect(weekday.prepared.map(change => change.appointmentRef)).toEqual(["apt-q-sat"]);
  });
  it("an answer whose hint matches none of the options asks again among them; nothing is prepared", async () => {
    const f = fake([contradiction(), answer("q1", e2aOrigin({ dia: e2aDay("quarta", "o de quarta") }))], world());
    await send(f, "O corte de sábado da Quintiliana vai pro domingo às 10h");
    const again = await send(f, "é o de quarta");
    expect(again.code).toBe("ASKED_APPOINTMENT_NONE");
    expect(optionIds(again)).toEqual(["apt-q-fri", "apt-q-sat"]);
    expect(f.prepared).toEqual([]);
  });
  it("PRINCIPLE-1 probe: a service the salon does not have, beside her only appointment of another service, asks; a yes without a pointer never binds", async () => {
    const f = fake([e2aLuna({ cliente: { mencao: "Bartolomeu" }, origem: e2aOrigin({ servico: e2aService("A progressiva", []) }), destino: toSunday }),
      answer("q1"), answer("q2", e2aOrigin({ servico: e2aService("a progressiva", []) })), answer("q3", e2aOrigin({ dia: e2aDay("sexta", "o de sexta") }))], world());
    const asked = await send(f, "A progressiva do Bartolomeu vai pro domingo às 10h");
    expect(asked.code).toBe("ASKED_APPOINTMENT_NONE");
    expect(optionIds(asked)).toEqual(["apt-b-fri"]);
    expect(f.prepared).toEqual([]);
    const yes = await send(f, "isso, esse mesmo");
    expect(yes.code).toBe("ASKED_APPOINTMENT_NONE");
    expect(optionIds(yes)).toEqual(["apt-b-fri"]);
    expect(yes.view.questions[0].questionId).toBe("q2");
    expect(f.prepared).toEqual([]);
    const unmapped = await send(f, "é a progressiva");
    expect(unmapped.code).toBe("ASKED_APPOINTMENT_NONE");
    expect(f.prepared).toEqual([]);
    const pointed = await send(f, "o de sexta");
    expect(pointed.view.status).toBe("proposal_ready");
    expect(f.prepared.map(slot)).toEqual([{ appointmentRef: "apt-b-fri", date: SUN, time: "10:00", professionalRef: lisandra.id }]);
  });
  it("a question whose options were cut at the cap does not restrict the answer: an appointment past the 20th is still reachable by the answer's hint", async () => {
    const days = Array.from({ length: 22 }, (_, index) => addCalendarDays(FRI, index));
    const series = salon({ customers: [quintiliana], appointments: days.map(date => booked(`apt-q-${date}`, quintiliana, thales, camadas, date, "10:00")) });
    const last = days.at(-1)!;
    const f = fake([quinti(e2aOrigin()), answer("q1", e2aOrigin({ dia: { tipo: "data", dia: Number(last.slice(8, 10)), mes: Number(last.slice(5, 7)), mencao: "o do dia 4/4" } }))], series);
    const asked = await send(f, "A Quintiliana vai pro domingo às 10h");
    expect(asked.code).toBe("ASKED_APPOINTMENT_SEVERAL");
    expect(asked.view.questions[0].options).toHaveLength(20);
    expect(asked.view.questions[0].options?.some(option => option.id === `apt-q-${last}`)).toBe(false);
    const answered = await send(f, "o do dia 4/4");
    expect(answered.view.fields?.appointment.value).toBe(`apt-q-${last}`);
  });
  it("control: an APPOINTMENT_SEVERAL answered by a hint among its options still binds, as before", async () => {
    const f = fake([quinti(e2aOrigin()), answer("q1", e2aOrigin({ servico: e2aService("a hidratação", ["Hidratação capilar"]) }))], world());
    expect((await send(f, "A Quintiliana vai pro domingo às 10h")).code).toBe("ASKED_APPOINTMENT_SEVERAL");
    expect((await send(f, "a hidratação")).view.status).toBe("proposal_ready");
    expect(f.prepared.map(change => change.appointmentRef)).toEqual(["apt-q-sat"]);
  });
});

describe("E2-A review CATALOG-1: every catalog name the reader returned reaches Luna, so a service past the 80th can locate its appointment", () => {
  const fillers = Array.from({ length: 90 }, (_, index): PilotServiceRow => ({ id: `srv-fill-${index}`, name: `Ritual sintético ${String(index).padStart(3, "0")}`, durationMin: 30, priceCents: 1000 }));
  const vela: PilotServiceRow = { id: "srv-vela", name: "Velaterapia", durationMin: 90, priceCents: 20000 };
  const big = (): MemorySalon => salon({ catalog: [...fillers, vela, escova, hidratacao, camadas],
    team: [{ ...lisandra, serviceIds: [...lisandra.serviceIds, vela.id] }, thales],
    appointments: [...rows(), booked("apt-eu-vela", eudoxia, lisandra, vela, MON, "13:00")] });
  it("the 91st name is in Luna's data, and Luna naming it binds the appointment of that service", async () => {
    const f = fake([e2aLuna({ cliente: { mencao: "Eudóxia" }, origem: e2aOrigin({ servico: e2aService("a velaterapia", ["Velaterapia"]) }),
      destino: e2aTo(e2aDay("quarta", "pra quarta"), e2aClock(13, "às 13h")) })], big());
    const reply = await send(f, "A velaterapia da Eudóxia vai pra quarta às 13h");
    const sent = JSON.stringify(f.model.requests[0].input);
    expect(sent).toContain("Velaterapia");
    expect(sent).toContain("Ritual sintético 089");
    expect(reply.view.status).toBe("proposal_ready");
    expect(f.prepared.map(change => change.appointmentRef)).toEqual(["apt-eu-vela"]);
    expect(reply.telemetry?.catalog_names).toEqual({ sent: 94, total: 94 });
  });
});
