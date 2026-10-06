import { describe, expect, it, vi } from "vitest";
import type { Model, ModelRequest } from "@everflair/salon-secretary";
import { agentRequestBody } from "../../../packages/salon-secretary/src/agent-loop";
import { PILOT_RESCHEDULE_TOOL } from "../../../packages/salon-secretary/src/pilot-reschedule-contract";
import { pilotRepairText, runPilotInterpretation, PILOT_REPAIR_RULES, PILOT_REQUEST_CAP, type PilotRequestContext } from "../../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { handlePilotMessage, type PilotHost, type PilotReply, type PilotResolvedChange, type PilotSessionState } from "../secretary-pilot";
import type { PilotAppointmentRow, PilotPerson, PilotProfessionalRow, PilotServiceRow } from "../secretary-pilot-resolver";
import { booked, clockAt, everyDay, memoryReader, type MemorySalon } from "../../test/secretary-pilot-reader";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { e2bOrigin, e2bDate } from "../../test/secretary-pilot-e2b";
import { e2b2Luna, PILOT_SAFE_FAILURE } from "../../test/secretary-pilot-e2b2";

/** Reschedule pilot, completion of E2-B — owner requirement 4 (prompt and context): the WORST REAL request is proved to fit the cap (request bytes +
 * the output framing ≤ 64000) through the real path (handlePilotMessage: the reader's catalog and team, the open plan the app renders, the 1000-character
 * message, the format repair), and nothing Luna needs is cut in silence: a request that is SENT carries every catalog name, every team name, every
 * option of the open question (or says how many were left out) and every repair rule; a turn whose context cannot fit fails SAFELY and OBSERVABLY (no
 * model call, a code of the PILOT_BUDGET family, nothing prepared, "nada foi alterado").
 *  - GAP 4.a: the catalog is cut past a 10.5 KB budget and the turn goes on (only a count in telemetry): a needed service at the end of the catalog is
 *    never seen by Luna. Twin: a typical large salon is sent whole.
 *  - GAP 4.b: the team is cut to 40 names in silence.
 *  - GAP 4.c: the open question shows Luna 8 of its options with no word about the rest.
 *  - GAP 4.d: the repair note keeps the first 8 codes and drops the rest (a rule's fixed sentence included) in silence.
 *  - GAP 4.e: a request whose size cannot be measured is SENT unmeasured (fail open).
 *  - COVERED evidence: a typical large salon (100 services, 10 long team names, the largest open question, the longest message, the repair) is sent and
 *    fits; a request past the cap is never sent (PILOT_BUDGET, telemetry, nothing prepared).
 * Synthetic salon data only (generated names); no network, database or model. */
const measure = vi.hoisted(() => ({ fail: false }));
vi.mock("../../../packages/salon-secretary/src/agent-loop", async importOriginal => {
  const real = await importOriginal<typeof import("../../../packages/salon-secretary/src/agent-loop")>();
  return { ...real, agentRequestBodyBytes: (...args: Parameters<typeof real.agentRequestBodyBytes>) => { if (measure.fail) throw Error("SYNTHETIC_MEASURE_FAILURE"); return real.agentRequestBodyBytes(...args); } };
});

const MODEL = "gpt-6-luna";
const requestBytes = (request: ModelRequest) => Buffer.byteLength(JSON.stringify(agentRequestBody(request, MODEL)), "utf8");
const systemText = (request: ModelRequest) => (request.input as { role: string; content: string }[]).filter(item => item.role === "system").map(item => item.content).join("\n");
const sized = (prefix: string, length: number) => `${prefix} ${"tratamento de bem-estar ".repeat(Math.ceil(length / 24))}`.slice(0, length).trimEnd();
type Shape = { services: number; serviceLength: number; team: number; teamLength: number; neededLast?: boolean };
/** A salon of that shape: generated catalog and team names (the needed service — Xisto's — LAST in the reader's order when `neededLast`), and Xisto with
 * 24 future appointments (an open question with 20 options at the label bound: a service name past 160 characters, a professional name past 120). */
function salonOf(shape: Shape) {
  const needed: PilotServiceRow = { id: "srv-needed", name: sized("Zimbroterapia com pedras de rio e óleo de copaíba", 170), durationMin: 50, priceCents: 15000 };
  const catalog: PilotServiceRow[] = Array.from({ length: shape.services }, (_, index) => ({ id: `srv-${index}`, name: sized(`Ritual ${String(index).padStart(3, "0")}`, shape.serviceLength),
    durationMin: 30, priceCents: 5000 }));
  const team: PilotProfessionalRow[] = Array.from({ length: shape.team }, (_, index) => ({ id: `pro-${index}`, name: sized(`Profissional ${String(index).padStart(2, "0")} Sobrenome Comprido`, shape.teamLength),
    serviceIds: [needed.id, ...catalog.map(item => item.id)] }));
  const xisto: PilotPerson = { id: "cli-x", name: "Xisto Paracatu" };
  const appointments: PilotAppointmentRow[] = Array.from({ length: 24 }, (_, index) =>
    booked(`apt-x-${index}`, xisto, team[index % team.length], needed, `2031-${String(4 + Math.floor(index / 28)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`, "10:00"));
  const salon: MemorySalon = { customers: [xisto], team, catalog: shape.neededLast === false ? [needed, ...catalog] : [...catalog, needed],
    hours: Object.fromEntries(team.map(item => [item.id, everyDay(["08:00", "20:00"])])), appointments };
  return { salon, catalog: salon.catalog!, team };
}
/** Two owner messages: the first opens the plan (Xisto's appointment is asked, 20 options); the second is the longest message, its first answer invalid
 * (so the repair is sent too). Every request the model received, every reply and what was prepared. */
async function run(shape: Shape, longest = `o do dia 20 ${"ção".repeat(329)}`) {
  const { salon, catalog, team } = salonOf(shape);
  const model = new ScriptedServicesModel([call(PILOT_RESCHEDULE_TOOL, e2b2Luna({ cliente: { mencao: "Xisto" } })), call(PILOT_RESCHEDULE_TOOL, { tipo: "remarcar" }),
    call(PILOT_RESCHEDULE_TOOL, e2b2Luna({ tipo: "resposta", resposta_a: "q1", origem: e2bOrigin({ dia: e2bDate(20, 4, "dia 20") }) }))]);
  const state: PilotSessionState = { replies: [] }, prepared: PilotResolvedChange[] = [], reader = memoryReader(salon);
  const host: PilotHost = { actor: { salonId: "salon-e2b2-payload", userId: "user-e2b2-payload" }, state, modelId: MODEL,
    model: async () => model as unknown as Model, reader: () => reader, clock: async () => clockAt(),
    prepare: async change => { prepared.push(change); return { ok: true, proposal: { proposalRef: "prop-1", draftRef: "draft-1", draftRevision: 1, revision: 0, text: "PROPOSTA" } }; },
    receipt: async () => undefined, settle: async () => undefined,
    confirm: async approval => ({ proposalRef: approval.proposalRef, appointmentRef: "apt-x-0", outcome: "RESCHEDULED", duplicate: false }) };
  const replies: PilotReply[] = [];
  replies.push(await handlePilotMessage(host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b09", message: "Remarca o Xisto" }));
  replies.push(await handlePilotMessage(host, { sessionId: "6f1f3c1e-0d55-4a59-9d55-6a4b8f1f0b09", message: longest }));
  return { requests: model.requests, replies, prepared, catalog, team };
}
type Run = Awaited<ReturnType<typeof run>>;
/** The invariant of requirement 4 over one run: every request SENT fits and carries every catalog and team name; every turn that sent nothing failed safely. */
function expectNoSilentCut(result: Run, label: string) {
  for (const [index, request] of result.requests.entries()) {
    expect(requestBytes(request) + PILOT_REQUEST_CAP.outputFraming, `${label} request ${index}: fits the cap`).toBeLessThanOrEqual(PILOT_REQUEST_CAP.requestCap);
    const text = systemText(request);
    expect(result.catalog.filter(item => !text.includes(JSON.stringify(item.name))).length, `${label} request ${index}: catalog names left out`).toBe(0);
    expect(result.team.filter(item => !text.includes(JSON.stringify(item.name))).length, `${label} request ${index}: team names left out`).toBe(0);
  }
  for (const [index, reply] of result.replies.entries()) if (reply.telemetry?.model_calls === 0) {
    expect(reply.code, `${label} turn ${index}: a turn that sent nothing ends with a safe failure code`).toMatch(PILOT_SAFE_FAILURE);
    expect(reply.text, `${label} turn ${index}`).toContain("nada foi alterado");
  }
  expect(result.prepared, `${label}: nothing is prepared from a cut context`).toEqual([]);
}
const TYPICAL: Shape = { services: 100, serviceLength: 60, team: 10, teamLength: 120 };

describe("COVERED: the worst real request of a typical large salon is sent whole and fits", () => {
  it("100 services of 60 characters, 10 team names of 120, the open question with 20 options at the label bound, the 1000-character message and the repair", async () => {
    const result = await run(TYPICAL);
    expect(result.requests, "the first message, the long one and its repair").toHaveLength(3);
    expect(result.replies[0].code).toBe("ASKED_APPOINTMENT_SEVERAL");
    expect(result.replies[0].view.questions[0]?.options).toHaveLength(20);
    expectNoSilentCut(result, "typical");
    const headroom = PILOT_REQUEST_CAP.requestCap - PILOT_REQUEST_CAP.outputFraming - Math.max(...result.requests.map(requestBytes));
    expect(headroom, "bytes left under the cap by the largest request of the run").toBeGreaterThan(0);
  });
  it("past the cap (10 team names of 6000 characters): nothing is sent, PILOT_BUDGET with the measured bytes, nothing prepared, the reply says nothing changed", async () => {
    const result = await run({ services: 20, serviceLength: 40, team: 10, teamLength: 6000 });
    expect(result.requests).toEqual([]);
    expect(result.replies[0]).toMatchObject({ code: "PILOT_BUDGET", telemetry: { model_calls: 0 } });
    expect((result.replies[0].telemetry?.request_bytes as number[])[0]).toBeGreaterThan(PILOT_REQUEST_CAP.requestCap - PILOT_REQUEST_CAP.outputFraming);
    expectNoSilentCut(result, "huge team names");
  });
  it("the most expensive message the input admits (1000 control characters, 6 bytes each on the wire) with the typical salon: sent whole and fitting, or refused before sending", async () => {
    expectNoSilentCut(await run(TYPICAL, `o do dia 20 ${"\u0001".repeat(988)}`), "escaped message");
  });
});

describe("GAP 4.a — the catalog is never cut in silence; a needed service is never out of Luna's sight", () => {
  it("400 services of 40 characters, Xisto's service last in the reader's order: every request sent carries it (and every other name), or the turn fails safely; TWIN first in the order", async () => {
    const first = await run({ services: 400, serviceLength: 40, team: 10, teamLength: 120, neededLast: false });
    const sentFirst = first.requests.map(systemText).every(text => text.includes(JSON.stringify(first.catalog[0].name)));
    expect(sentFirst, "TWIN: the needed service first in the order is in every request sent").toBe(true);
    const last = await run({ services: 400, serviceLength: 40, team: 10, teamLength: 120 });
    expectNoSilentCut(last, "needed service last");
  });
  it("400 services of 200 characters (no request can carry them): nothing is sent, a safe failure code, nothing prepared", async () => {
    const result = await run({ services: 400, serviceLength: 200, team: 10, teamLength: 120 });
    expectNoSilentCut(result, "catalog past the cap");
    expect(result.requests, "a cut catalog is never sent").toEqual([]);
  });
});

describe("GAP 4.b — the team is never cut in silence", () => {
  it("41 team members: every name in every request sent, or the turn fails safely", async () => {
    expectNoSilentCut(await run({ services: 20, serviceLength: 40, team: 41, teamLength: 40 }), "team of 41");
  });
});

describe("GAP 4.c — the open question Luna sees lists every option, or says how many were left out", () => {
  it("20 options (Xisto's appointments): the long message's request names each label, or 'e mais N' for those it leaves out", async () => {
    const result = await run(TYPICAL);
    const labels = result.replies[0].view.questions[0]?.options?.map(option => option.label) ?? [];
    expect(labels).toHaveLength(20);
    const text = systemText(result.requests[1]);
    // §11.10 (contract migration; was counted against the 20 options kept): what is left out is counted against the REAL number of choices (24).
    const missing = 24 - labels.filter(label => text.includes(JSON.stringify(label).slice(1, -1))).length;
    expect(missing === 0 || text.includes(`e mais ${missing}`), `${missing} choice(s) left out in silence`).toBe(true);
  });
});

describe("GAP 4.d — the repair note never drops a code or a rule sentence in silence", () => {
  it("12 reasons with a rule code in 10th place: its fixed sentence is there, and every code is named or counted", () => {
    const reasons = [...Array.from({ length: 9 }, (_, index) => `SCHEMA:invalid_type@destino.campo${index}`), "RULE:ancora_repetida", "SCHEMA:too_big@observacoes", "WIRE"];
    const note = pilotRepairText(reasons);
    expect(note, "the rule's fixed sentence").toContain(PILOT_REPAIR_RULES["RULE:ancora_repetida"]);
    const missing = reasons.filter(reason => !note.includes(reason));
    expect(missing.length === 0 || note.includes(`e mais ${missing.length}`), `${missing.length} code(s) dropped in silence`).toBe(true);
  });
});

describe("GAP 4.e — a request whose size cannot be measured is never sent (fail closed)", () => {
  it("the measurement throws: no model call, a failure outcome; TWIN measured: one call", async () => {
    const context: PilotRequestContext = { today: { date: "2031-03-10", weekday: "segunda-feira", timezone: "America/Sao_Paulo" }, team: ["Profissional Sintética"], services: ["Ritual sintético"] };
    const frame = call(PILOT_RESCHEDULE_TOOL, e2b2Luna({ cliente: { mencao: "Xisto" } }));
    const twin = new ScriptedServicesModel([frame]);
    expect(await runPilotInterpretation(twin as never, { context, message: "Remarca o Xisto", modelId: MODEL, startedAt: performance.now() })).toMatchObject({ ok: true });
    expect(twin.requests).toHaveLength(1);
    const model = new ScriptedServicesModel([frame]);
    measure.fail = true;
    try {
      const outcome = await runPilotInterpretation(model as never, { context, message: "Remarca o Xisto", modelId: MODEL, startedAt: performance.now() });
      expect(model.requests, "an unmeasured request is never sent").toHaveLength(0);
      expect(outcome.ok).toBe(false);
    } finally { measure.fail = false; }
  });
});
