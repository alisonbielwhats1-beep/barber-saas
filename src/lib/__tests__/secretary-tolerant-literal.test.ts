import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@everflair/salon-secretary";
import { invalidSourceLiterals } from "../../../packages/salon-secretary/src/source-literal-repair";
import { decodeTemporalEvidencePayload } from "../../../packages/salon-secretary/src/scheduling-skill";
import { expandedWire, operationWire } from "../../test/secretary-wire-schema";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import { groundSchedulingReasons } from "../scheduling-literal-source";
import { siblingScopedMessage } from "../secretary-sibling-scope";
import { schedulingPatch, type SchedulingFields } from "../scheduling-contract";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
// Monday 2026-09-28, 12:00 in São Paulo: amanhã = 2026-09-29, sexta = 2026-10-02.
const now = new Date("2026-09-28T15:00:00Z"), tz = "America/Sao_Paulo";
type Evidence = { field: "date" | "time" | "source_date" | "source_time" | "end_date" | "end_time"; text: string }[];
const ground = (source: string, fields: SchedulingFields, evidence: Evidence, operation = "appointment.change") =>
  groundSchedulingTemporal({}, fields, source, tz, now, undefined, operation, evidence);

const config = { SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: "gpt-6-luna", SALON_SECRETARY_OPENAI_API_KEY: "synthetic-offline-not-a-key", SALON_SECRETARY_OPENAI_PROJECT: "proj_offline" };
const unused: api.Model = { async getResponse() { throw Error("SHAPE_ONLY"); }, async *getStreamedResponse() { throw Error("NO_STREAM"); } };
function operation(id: string, fields: Record<string, unknown>) {
  const tool = api.createServicesAgent(unused, () => {}, "discovery", true).tools[0]; if (tool.type !== "function") throw Error("TOOL");
  const shape = operationWire(expandedWire(tool.parameters), id);
  return { ...Object.fromEntries(Object.keys(shape).map(key => [key, null])), operation: id, item_key: "visit", source_scope: null, depends_on: [], released_slot_of: null, ...fields };
}
const change = (date: string, time: string, offset = 1, clock = "10:00") => ({ turn: { mode: "NEW", operations: [operation("appointment.change", {
  customer_name: "Fábio", day_offset: { value: offset, literal: date }, time: { value: clock, literal: time } })] } });
/** Offline HTTP only: every frame is a recorded function call; a third dispatch fails. */
async function sdk(frames: unknown[], message: string) {
  const bodies = frames.map(value => JSON.stringify(value)), requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body))); const index = requests.length - 1;
    if (index >= bodies.length) throw Error("UNEXPECTED_HTTP");
    api.assertSecretaryResponsesPayload(requests[index], "gpt-6-luna");
    return new Response(JSON.stringify({ id: "resp_" + index, object: "response", created_at: 0, status: "completed", model: "gpt-6-luna",
      output: [{ id: "fc_" + index, call_id: "call_" + index, type: "function_call", name: "select_capabilities", arguments: bodies[index], status: "completed" }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  const events: api.ModelCallUsage[] = [];
  const model = api.instrumentServicesModel(await api.createPaidModel(config), "gpt-6-luna", async event => { events.push(event); });
  let result: api.CapabilitySelection | undefined, error: unknown;
  try { result = await api.runServicesTurn(model, message, {}, {}, "discovery", true); } catch (caught) { error = caught; }
  return { result, error, requests, purposes: events.filter(event => event.status === "SUCCEEDED").map(event => event.purpose) };
}
function grounded(selection: api.CapabilitySelection, message: string) {
  const item = selection.operations[0];
  const fields = schedulingPatch.parse(Object.fromEntries(Object.entries(item).filter(([key, value]) => key in schedulingPatch.shape && value != null)));
  return groundSchedulingTemporal({}, fields, message, tz, now, undefined, item.operation, item.temporal_evidence ?? undefined);
}

describe("owner requirement: phone/dictation spelling proves Luna's canonical quotes without a repair", () => {
  const message = "passa o fabio pra amanha as 10h";
  it("'amanhã'/'às 10h' quoted for 'amanha as 10h' is present: no repair path, one request, accepted", async () => {
    expect(invalidSourceLiterals(change("amanhã", "às 10h"), message)).toEqual([]);
    const run = await sdk([change("amanhã", "às 10h")], message);
    expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(1); expect(run.purposes).toEqual(["INTERPRETATION"]);
    expect(run.result!.operations[0].temporal_evidence).toEqual([{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]);
    expect(grounded(run.result!, message)).toMatchObject({ fields: { date: "2026-09-29", time: "10:00" }, rejected: [] });
  });
  it.each([
    ["caps", "PASSA O FABIO PRA AMANHA AS 10H"],
    ["accents on the user side", "Passa o Fábio pra Amanhã Às 10h"],
    ["NFD dictation", "Passa o Fábio pra amanhã às 10h"],
    ["extra spacing", "passa o fabio pra  amanha   as 10h"],
  ])("%s: grounding re-parses the user's own span", (_label, source) => {
    const result = ground(source, { day_offset: 1, time: "10:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]);
    expect(result.rejected).toEqual([]); expect(result.fields).toMatchObject({ date: "2026-09-29", time: "10:00" });
  });
  it("tolerance never proves a hallucinated value: the span is still re-parsed", () => {
    const wrongDay = ground(message, { day_offset: 2, time: "10:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]);
    expect(wrongDay.fields.date).toBeUndefined(); expect(wrongDay.rejected.map(item => item.field)).toContain("date");
    const wrongClock = ground(message, { day_offset: 1, time: "11:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]);
    expect(wrongClock.fields.time).toBeUndefined(); expect(wrongClock.rejected.map(item => item.field)).toContain("time");
  });
  it("a denial in the user's clause still rejects the folded quote", () => {
    const result = ground("nao passa o fabio pra amanha as 10h", { day_offset: 1, time: "10:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]);
    expect(result.fields.date).toBeUndefined(); expect(result.fields.time).toBeUndefined();
  });
  it("a clipped token is not a proof ('10' inside '100', 'amanhã' inside 'depois de amanhã')", () => {
    expect(ground("muda para as 100", { time: "10:00" }, [{ field: "time", text: "10" }]).fields.time).toBeUndefined();
    expect(ground("muda para depois de amanha", { day_offset: 1 }, [{ field: "date", text: "amanhã" }]).fields.date).toBeUndefined();
  });
});

describe("a literal absent even after folding keeps the single bounded repair", () => {
  const message = "passa o fabio pra amanha as 10h";
  it("lists only the absent leaf and repairs it once", async () => {
    expect(invalidSourceLiterals(change("tomorrow", "às 10h"), message)).toEqual([["turn", "operations", 0, "day_offset", "literal"]]);
    const run = await sdk([change("tomorrow", "às 10h"), change("amanha", "às 10h")], message);
    expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(2); expect(run.purposes).toEqual(["INTERPRETATION", "SOURCE_LITERAL_REPAIR"]);
    expect(grounded(run.result!, message)).toMatchObject({ fields: { date: "2026-09-29", time: "10:00" }, rejected: [] });
  });
  it("an unsuccessful repair fails closed without a third request", async () => {
    const run = await sdk([change("tomorrow", "às 10h"), change("tomorrow", "às 10h")], message);
    expect(run.result).toBeUndefined(); expect(run.error).toBeDefined(); expect(run.requests).toHaveLength(2);
  });
  it("scope proofs keep the exact-byte contract of their consumers", () => {
    const envelope = { turn: { mode: "NEW", operations: [{ ...operation("appointment.change", {}), source_scope: "PASSA O FABIO PRA AMANHA AS 10H" }] } };
    expect(invalidSourceLiterals(envelope, message)).toEqual([["turn", "operations", 0, "source_scope"]]);
  });
  const scoped = (scope: string, date: string) => ({ turn: { mode: "NEW", operations: [{ ...change(date, "às 10h").turn.operations[0], source_scope: scope }] } });
  it("a repair of another leaf may re-copy a present tolerant quote as the user's exact bytes, never as another quote", async () => {
    expect(invalidSourceLiterals(scoped("Passa o Fábio para amanhã", "amanhã"), message)).toEqual([["turn", "operations", 0, "source_scope"]]);
    const recopy = await sdk([scoped("Passa o Fábio para amanhã", "amanhã"), scoped(message, "amanha")], message);
    expect(recopy.error).toBeUndefined(); expect(recopy.requests).toHaveLength(2);
    expect(grounded(recopy.result!, message)).toMatchObject({ fields: { date: "2026-09-29", time: "10:00" }, rejected: [] });
    const unchanged = await sdk([scoped("Passa o Fábio para amanhã", "amanhã"), scoped(message, "amanhã")], message);
    expect(unchanged.error).toBeUndefined(); expect(unchanged.requests).toHaveLength(2);
    const other = await sdk([scoped("Passa o Fábio para amanhã", "amanhã"), scoped(message, "fabio")], message);
    expect(other.result).toBeUndefined(); expect(other.error).toBeDefined(); expect(other.requests).toHaveLength(2);
  });
});

describe("repeated short literals are resolved by the action's own role scope", () => {
  const op = (item_key: string, id: string, fields: Record<string, unknown>) => ({ item_key, operation: id, depends_on: [], released_slot_of: null, source_scope: null,
    target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [], ...fields }) as never;
  const message = "Passa o Fábio pra amanhã às 10 e bloqueia o Rodrigo na sexta das 9 às 10.";
  const fabio = op("fabio", "appointment.change", { customer_name: "Fábio", day_offset: 1, time: "10:00", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10" }] });
  const rodrigo = op("rodrigo", "schedule.block", { professional_name: "Rodrigo", weekday: 5, time: "09:00", end_time: "10:00",
    temporal_evidence: [{ field: "date", text: "sexta" }, { field: "time", text: "das 9" }, { field: "end_time", text: "às 10" }] });
  it("the block's end 'às 10' binds to its own occurrence, not Fábio's earlier 'às 10'", () => {
    const scoped = siblingScopedMessage(message, rodrigo, [fabio, rodrigo]);
    expect(scoped).toHaveLength(message.length); expect(scoped).not.toContain("amanhã");
    const result = groundSchedulingTemporal({}, { weekday: 5, time: "09:00", end_time: "10:00" }, scoped, tz, now, undefined, "schedule.block",
      [{ field: "date", text: "sexta" }, { field: "time", text: "das 9" }, { field: "end_time", text: "às 10" }]);
    expect(result.rejected).toEqual([]); expect(result.fields).toMatchObject({ date: "2026-10-02", time: "09:00", end_time: "10:00" });
  });
  it("Fábio's own 'às 10' still grounds, and a wrong value on the scoped occurrence is still rejected", () => {
    const scoped = siblingScopedMessage(message, fabio, [fabio, rodrigo]);
    expect(scoped).not.toContain("sexta"); expect(scoped).not.toContain("das 9");
    const own = groundSchedulingTemporal({}, { day_offset: 1, time: "10:00" }, scoped, tz, now, undefined, "appointment.change", [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10" }]);
    expect(own.rejected).toEqual([]); expect(own.fields).toMatchObject({ date: "2026-09-29", time: "10:00" });
    const wrong = groundSchedulingTemporal({}, { weekday: 5, time: "09:00", end_time: "11:00" }, siblingScopedMessage(message, rodrigo, [fabio, rodrigo]), tz, now, undefined, "schedule.block",
      [{ field: "date", text: "sexta" }, { field: "time", text: "das 9" }, { field: "end_time", text: "às 10" }]);
    expect(wrong.fields.end_time).toBeUndefined();
  });
  it("an end quote that exists only inside the start range is still rejected (no borrowing across roles)", () => {
    const result = groundSchedulingTemporal({}, { weekday: 5, time: "09:00", end_time: "10:00" }, "Bloqueia o Rodrigo às 10 na sexta das 9 às 11.", tz, now, undefined, "schedule.block",
      [{ field: "date", text: "sexta" }, { field: "time", text: "das 9" }, { field: "end_time", text: "às 10" }]);
    expect(result.fields.end_time).toBeUndefined();
  });
  it("sibling masking blanks a sibling's quote even when the user typed it without accents", () => {
    const text = "cancela a amanda e passa o fabio pra amanha as 10";
    const amanda = op("amanda", "appointment.cancel", { customer_name: "Amanda" });
    const moved = op("fabio", "appointment.change", { customer_name: "Fábio", day_offset: 1, time: "10:00", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10" }] });
    const scoped = siblingScopedMessage(text, amanda, [amanda, moved]);
    expect(scoped).toHaveLength(text.length); expect(scoped).not.toMatch(/amanha|as 10/);
    expect(scoped.startsWith("cancela a amanda e passa o fabio pra ")).toBe(true);
  });
});

describe("other literal proofs share the same tolerance", () => {
  it("a date + weekday split is rejoined over the user's unaccented span", () => {
    const message = "Reserva para Bruno na terca, dia 14 de abril de 2027, as 13h.";
    const out = decodeTemporalEvidencePayload({ date: { value: "2027-04-14", literal: "dia 14 de abril de 2027" }, weekday: { value: 2, literal: "terça" } }, true, message) as Record<string, unknown>;
    expect(out).toMatchObject({ date: "2027-04-14", weekday: null, temporal_evidence: [{ field: "date", text: "terca, dia 14 de abril de 2027" }] });
  });
  it("redundant selectors quoted with different case/accents are one witness; different words still conflict", () => {
    const same = decodeTemporalEvidencePayload({ date: { value: "2026-09-30", literal: "Depois de amanhã" }, day_offset: { value: 2, literal: "depois de amanha" } }, true) as Record<string, unknown>;
    expect(same).toMatchObject({ date: "2026-09-30", day_offset: 2, temporal_evidence: [{ field: "date", text: "Depois de amanhã" }] });
    expect(() => decodeTemporalEvidencePayload({ weekday: { value: 2, literal: "terça" }, day_offset: { value: 1, literal: "amanhã" } }, true)).toThrow("TEMPORAL_SELECTOR_CONFLICT");
  });
  it("a reason quoted with accents proves the user's unaccented words and stores the original", () => {
    const message = "cancela o horario da rosa pq ela ta doente", patch: Record<string, unknown> = { reason: "ela tá doente" };
    expect(groundSchedulingReasons(patch, {}, message)).toEqual({ accepted: ["reason"], rejected: [] });
    expect(patch.reason).toBe("ela ta doente");
    const proof = patch.reason_source as { start: number; end: number; original_text: string; interpreted_text: string };
    expect(message.slice(proof.start, proof.end)).toBe("ela ta doente"); expect(proof.interpreted_text).toBe("ela tá doente");
  });
  it("reason tolerance keeps the clipped-word and attached-negation rejections", () => {
    expect(groundSchedulingReasons({ reason: "iajou" }, {}, "ela viajou").rejected).toHaveLength(1);
    expect(groundSchedulingReasons({ reason: "vai viajar" }, {}, "Ela nao vai viajar").rejected).toHaveLength(1);
    expect(groundSchedulingReasons({ reason: "ela viajou" }, {}, "ele ficou doente").rejected).toHaveLength(1);
  });
  it("a residual half-day question repeats the user's own words", () => {
    const result = ground("muda a amanda para as duas", { time: "14:00" }, [{ field: "time", text: "às duas" }]);
    expect(result.fields.time).toBeUndefined();
    expect(result.pending_temporal_ambiguities).toEqual([{ field: "time", kind: "CLOCK_DAYPART", expression: "as duas", candidates: ["02:00", "14:00"] }]);
  });
});
