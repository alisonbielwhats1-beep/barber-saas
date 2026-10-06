import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { validateSelectionV2, validateExistingPlanPatches, createActionPlan, decodeConversationTurn, decodeTemporalEvidencePayload, withConversationRouting,
  rejectedPartsNotice, runServicesTurn, isInterpretationFailure, Usage, type Model, type CapabilitySelection } from "@everflair/salon-secretary";
import { invalidSourceLiterals } from "../../../packages/salon-secretary/src/source-literal-repair";
import { intent, plan } from "../../test/secretary-capability-plan";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";

/** B5 partial acceptance, library level: one bad operation (or one contradicted temporal role) never loses
 * the rest of a turn; graph/route errors stay turn-fatal; dropped parts are always reported. Offline only. */
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const scheduling = (operation: string, fields: Record<string, unknown> = {}) => intent(operation, { item_key: null, depends_on: [], released_slot_of: null, source_scope: null, ...fields });
const three = () => plan([
  scheduling("appointment.change", { item_key: "fabio", customer_name: "Fábio", source_scope: "passa o Fábio para amanhã" }),
  scheduling("appointment.cancel", { item_key: "amanda", customer_name: "Amanda", name: "invented", source_scope: "cancela a Amanda" }),
  scheduling("schedule.block", { item_key: "rodrigo", professional_name: "Rodrigo" }),
]);

describe("validateSelectionV2 partial mode", () => {
  it("3 operations with one invalid: the other 2 proceed and the invalid one is reported (strict mode still throws)", () => {
    const input = three(), before = JSON.stringify(input);
    expect(() => validateSelectionV2(input)).toThrow("CAPABILITY_FIELD_MISMATCH");
    const selection = validateSelectionV2(input, { partial: true });
    expect(JSON.stringify(input)).toBe(before);
    expect(selection.operations.map(op => op.item_key)).toEqual(["fabio", "rodrigo"]);
    expect(selection.rejected).toEqual([{ item_key: "amanda", operation: "appointment.cancel", code: "CAPABILITY_FIELD_MISMATCH", dependent: false,
      source_scope: "cancela a Amanda", subject: "Amanda" }]);
    // The report survives every internal re-validation; the plan holds only accepted operations.
    expect(validateSelectionV2(selection)).toEqual(selection);
    expect(createActionPlan(selection).actions.map(action => action.key)).toEqual(["fabio", "rodrigo"]);
  });
  it("a dependent of an invalid operation is dropped with it, transitively; independent operations proceed", () => {
    const input = { ...plan([
      scheduling("appointment.cancel", { item_key: "cancel", customer_name: "Amanda", name: "invented" }),
      scheduling("appointment.create", { item_key: "replace", customer_name: "Carla", depends_on: ["cancel"], released_slot_of: "cancel" }),
      scheduling("appointment.list", { item_key: "after", depends_on: ["replace"] }),
      scheduling("schedule.block", { item_key: "rodrigo", professional_name: "Rodrigo" }),
    ]), independent: false };
    const selection = validateSelectionV2(input, { partial: true });
    expect(selection.operations.map(op => op.item_key)).toEqual(["rodrigo"]);
    expect(selection.independent).toBe(true); expect(selection.skills).toEqual(["scheduling"]);
    expect(selection.rejected!.map(item => [item.item_key, item.code, item.dependent])).toEqual([
      ["cancel", "CAPABILITY_FIELD_MISMATCH", false], ["replace", "DEPENDENT_OF_REJECTED", true], ["after", "DEPENDENT_OF_REJECTED", true]]);
  });
  it("keeps the historical generated keys of the accepted operations", () => {
    const input = plan([scheduling("schedule.block", { professional_name: "Rodrigo" }), scheduling("appointment.cancel", { name: "x" }), scheduling("schedule.block", { professional_name: "Tati" })]);
    expect(validateSelectionV2(input, { partial: true }).operations.map(op => op.item_key)).toEqual(["action_1", "action_3"]);
  });
  it.each([
    ["a cycle", [scheduling("appointment.cancel", { item_key: "a", depends_on: ["b"], name: "x" }), scheduling("appointment.cancel", { item_key: "b", depends_on: ["a"] })], false],
    ["an unknown edge", [scheduling("appointment.cancel", { item_key: "a", name: "x" }), scheduling("appointment.list", { item_key: "b", depends_on: ["ghost"] })], false],
    ["a released slot of a non-cancel", [scheduling("schedule.block", { item_key: "a", name: "x" }), scheduling("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a" })], false],
  ] as const)("graph errors stay turn-fatal even with an invalid operation: %s", (_label, operations, independent) => {
    expect(() => validateSelectionV2({ ...plan(operations as never), independent }, { partial: true })).toThrow();
  });
  it("a skills mismatch and an unreadable identity stay turn-fatal", () => {
    expect(() => validateSelectionV2({ ...three(), skills: ["services"] }, { partial: true })).toThrow("SKILL_OPERATION_MISMATCH");
    expect(() => validateSelectionV2(plan([scheduling("schedule.block", { item_key: "Bad Key" }), scheduling("schedule.block", { item_key: "ok" })]), { partial: true })).toThrow();
  });
  it("when no operation remains the turn fails exactly as before (first operation's own error)", () => {
    const input = plan([scheduling("appointment.cancel", { item_key: "a", name: "x" }), scheduling("schedule.block", { item_key: "b", target_name: "y" })]);
    expect(() => validateSelectionV2(input, { partial: true })).toThrow("CAPABILITY_FIELD_MISMATCH");
  });
});

describe("validateExistingPlanPatches partial mode", () => {
  const active = { plan_ref: "10000000-0000-4000-8000-000000000001", actions: [
    { item_key: "fabio", operation: "appointment.change", status: "READY_FOR_CONFIRMATION", depends_on: [] },
    { item_key: "amanda", operation: "appointment.cancel", status: "NEEDS_INPUT", depends_on: [] },
    { item_key: "msg", operation: "customer.message", status: "NEEDS_INPUT", depends_on: ["amanda"] },
    { item_key: "done", operation: "schedule.block", status: "DONE", depends_on: [] },
  ] };
  const item = (item_key: string, fields: Record<string, unknown>) => ({ item_key, choice: null, fields });
  it("a delta reclassifying its operation is left out; the other correction applies", () => {
    const input = { operations: [item("fabio", { operation: "appointment.cancel", reason: "motivo" }), item("amanda", { reason: "ela viajou", source_scope: "o motivo da Amanda é que ela viajou" })] };
    expect(() => validateExistingPlanPatches(input, active)).toThrow("CONTINUATION_ACTION_MISMATCH");
    const selection = validateExistingPlanPatches(input, active, { partial: true });
    expect(selection.operations).toEqual([expect.objectContaining({ item_key: "amanda", operation: "appointment.cancel", reason: "ela viajou" })]);
    expect(selection.rejected).toEqual([{ item_key: "fabio", operation: "appointment.change", code: "CONTINUATION_ACTION_MISMATCH", dependent: false, source_scope: null, subject: null }]);
    expect(validateExistingPlanPatches(selection, active)).toEqual(selection);
  });
  it("a correction of an action depending on a left-out correction waits with it; two deltas for one item choose neither", () => {
    const dependent = validateExistingPlanPatches({ operations: [item("amanda", { operation: "customer.message" }), item("msg", {}), item("fabio", { time: "11:00" })] }, active, { partial: true });
    expect(dependent.operations.map(op => op.item_key)).toEqual(["fabio"]);
    expect(dependent.rejected!.map(entry => [entry.item_key, entry.code, entry.dependent])).toEqual([["amanda", "CONTINUATION_ACTION_MISMATCH", false], ["msg", "DEPENDENT_OF_REJECTED", true]]);
    const twice = validateExistingPlanPatches({ operations: [item("fabio", { time: "11:00" }), item("fabio", { time: "12:00" }), item("amanda", { reason: "viagem" })] }, active, { partial: true });
    expect(twice.operations.map(op => op.item_key)).toEqual(["amanda"]);
    expect(twice.rejected!.map(entry => entry.item_key)).toEqual(["fabio", "fabio"]);
  });
  it("completed or unknown keys are left out; with nothing left the turn fails; an item carrying an edge never edits the graph", () => {
    const mixed = validateExistingPlanPatches({ operations: [item("done", { time: "11:00" }), item("ghost", {}), item("fabio", { time: "11:00" })] }, active, { partial: true });
    expect(mixed.operations.map(op => op.item_key)).toEqual(["fabio"]);
    expect(() => validateExistingPlanPatches({ operations: [item("done", { time: "11:00" })] }, active, { partial: true })).toThrow("CONTINUATION_ACTION_MISMATCH");
    // The published item shape has no edge fields: such an item is refused on its own, the graph is untouched.
    const edge = validateExistingPlanPatches({ operations: [item("fabio", { depends_on: ["amanda"] }), item("amanda", { reason: "viagem" })] }, active, { partial: true });
    expect(edge.operations.map(op => [op.item_key, op.depends_on])).toEqual([["amanda", []]]);
    expect(() => validateExistingPlanPatches({ operations: [{ item_key: "fabio", time: "11:00", depends_on: ["amanda"] }] }, active)).toThrow("CONTINUATION_ACTION_MISMATCH");
  });
});

describe("turn decoder (live path) — partial by default, strict for dev validators", () => {
  const op = (fields: Record<string, unknown>) => ({ operation: "schedule.block", item_key: null, depends_on: null, released_slot_of: null, source_scope: null, customer_name: null, service_name: null,
    professional_name: "Rodrigo", date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null, source_weekday: null, source_time: null,
    end_time: null, end_date: null, reason: null, ...fields });
  it("an operation failing its own schema is left out of a NEW turn; the others proceed", () => {
    const raw = { turn: { mode: "NEW", operations: [op({ item_key: "a" }), op({ item_key: "b", professional_name: " R ", source_scope: "e bloqueia o R" }), op({ item_key: "c", professional_name: "Tati" })] } };
    const decoded = decodeConversationTurn(raw, undefined, "bloqueia o Rodrigo e bloqueia o R e a Tati") as CapabilitySelection;
    expect(decoded.operations.map(item => item.item_key)).toEqual(["a", "c"]);
    expect(decoded.rejected).toEqual([expect.objectContaining({ item_key: "b", code: "OPERATION_INVALID", dependent: false, source_scope: "e bloqueia o R" })]);
    expect(() => decodeConversationTurn(raw, undefined, "x", { strict: true })).toThrow();
  });
  it("a PATCH item that is not the published {item_key, choice, fields} shape is refused; alone it fails the turn", async () => {
    const context = { active_plan: { plan_ref: "10000000-0000-4000-8000-000000000001", actions: [{ item_key: "x", operation: "schedule.block", status: "NEEDS_INPUT", depends_on: [] }] } };
    await withConversationRouting(async () => {
      expect(() => decodeConversationTurn({ turn: { mode: "PATCH", operations: [{ item_key: "x", time: null }] } })).toThrow();
    }, context);
  });
});

describe("contradictory temporal selectors (TEMPORAL_SELECTOR_CONFLICT) invalidate only their role", () => {
  const pair = (value: unknown, literal: string) => ({ value, literal });
  const conflicting = { day_offset: pair(1, "amanhã"), weekday: pair(4, "quinta"), time: pair("10:00", "às 10h") };
  it("degrade: both selectors of the role are dropped and a value-less marker records it; other roles keep their proof", () => {
    const decoded = decodeTemporalEvidencePayload(conflicting, true, "amanhã ou quinta às 10h", true) as Record<string, unknown>;
    expect(decoded).toMatchObject({ day_offset: null, weekday: null, time: "10:00" }); expect(decoded).not.toHaveProperty("date");
    expect(decoded.temporal_evidence).toEqual([{ field: "date", text: "amanhã", conflict: true }, { field: "time", text: "às 10h" }]);
    // The historical primitive (and every legacy/isolated path) still refuses.
    expect(() => decodeTemporalEvidencePayload(conflicting, true, "amanhã ou quinta às 10h")).toThrow("TEMPORAL_SELECTOR_CONFLICT");
  });
  it("the contiguous calendar-span merge is unchanged in degrade mode (GF24)", () => {
    const message = "Reserva Hidratação Névoa para Bruno na terça, dia 14 de abril de 2027, às 13h.";
    const split = { date: pair("2027-04-14", "dia 14 de abril de 2027"), weekday: pair(2, "terça") };
    expect(decodeTemporalEvidencePayload(split, true, message, true)).toEqual(decodeTemporalEvidencePayload(split, true, message));
  });
  it.each(["false", "true"])("components flag %s: a component contradicting its role's legacy quote is dropped the same way", flag => {
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", flag);
    const empty = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
    const day = { kind: "WEEKDAY", offset: null, weekday: 4, week: null, day: null, month: null, year: null, days: null };
    const decoded = decodeTemporalEvidencePayload({ day_offset: pair(1, "amanhã"), components: { ...empty, date: { value: day, literal: "quinta" } } }, true, "amanhã, quinta", true) as Record<string, unknown>;
    expect(decoded.day_offset).toBeNull(); expect(decoded.temporal_evidence).toEqual([{ field: "date", text: "amanhã", conflict: true }]);
  });
  it("a conflict inside an isolated adapter's CURRENT fields still rejects that turn", () => {
    expect(() => decodeConversationTurn({ turn: { mode: "CURRENT", fields: conflicting } }, { parse: (value: unknown) => value } as never, "amanhã ou quinta às 10h")).toThrow("TEMPORAL_SELECTOR_CONFLICT");
  });
  it("the dropped role's quotes never trigger a paid literal repair", () => {
    const raw = { turn: { mode: "NEW", operations: [{ operation: "appointment.create", ...conflicting, weekday: pair(4, "na quinta que vem") }] } };
    expect(invalidSourceLiterals(raw, "amanhã às 10h")).toEqual([]);
    expect(invalidSourceLiterals({ turn: { mode: "NEW", operations: [{ operation: "appointment.create", time: pair("10:00", "às dez") }] } }, "amanhã às 10h")).toEqual([["turn", "operations", 0, "time", "literal"]]);
  });
  it("the backend rejects the marked role with its cause (and the value the owner was changing), grounding the rest normally", () => {
    const now = new Date("2026-09-28T15:00:00Z");
    const grounded = groundSchedulingTemporalTurn({ date: "2026-10-05", time: "09:00", appointment_ref: "a" }, { time: "10:00" }, "amanhã ou quinta às 10h", "America/Sao_Paulo", now, undefined, "appointment.create",
      [{ field: "date", text: "amanhã", conflict: true }, { field: "time", text: "às 10h" }]);
    expect(grounded.fields).toEqual({ time: "10:00" });
    expect(grounded.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "date", value: "SELECTOR_CONFLICT" }]);
  });
});

describe("reply and interpretation-failure boundary", () => {
  it("the notice names what was left out (owner's words or the action), what depended on it, and asks to repeat", () => {
    expect(rejectedPartsNotice([{ dependent: false, quote: "cancele o horário da Amanda" }]))
      .toBe("Não entendi com segurança esta parte do pedido e a deixei de fora: “cancele o horário da Amanda”. Pode repetir essa parte de outro jeito?");
    expect(rejectedPartsNotice([{ dependent: false, operation: "appointment.cancel", subject: "Amanda" }, { dependent: true, quote: "coloca a Carla no lugar" }]))
      .toBe("Não entendi com segurança esta parte do pedido e a deixei de fora: o cancelamento de Amanda. Também deixei de fora “coloca a Carla no lugar”, que dependia dela. Pode repetir essas partes de outro jeito?");
  });
  function model(respond: (request: Parameters<Model["getResponse"]>[0]) => Promise<Awaited<ReturnType<Model["getResponse"]>>>): Model {
    return { getResponse: respond, async *getStreamedResponse() { throw Error("NO_STREAM"); } };
  }
  const discovery = (m: Model) => runServicesTurn(m, "Remarca o Fábio.", {}, {}, "discovery", true);
  it("an answer that cannot be read is tagged; transport failures are not (the error itself is unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
    const wrongTool = await discovery(model(async () => ({ usage: new Usage(), output: [{ type: "function_call", callId: randomUUID(), name: "upsert_action_draft", arguments: "{}" }] }))).catch(error => error);
    expect(wrongTool).toBeInstanceOf(Error); expect((wrongTool as Error).message).toBe("INTERPRETATION_INVALID"); expect(isInterpretationFailure(wrongTool)).toBe(true);
    const badSchema = await discovery(model(async request => ({ usage: new Usage(), output: [{ type: "function_call", callId: randomUUID(), name: (request.tools[0] as { name: string }).name,
      arguments: JSON.stringify({ turn: { mode: "NEW", operations: [] } }) }] }))).catch(error => error);
    expect(isInterpretationFailure(badSchema)).toBe(true);
    const transport = await discovery(model(async () => { throw Object.assign(Error("SYNTHETIC_TIMEOUT"), { name: "TimeoutError" }); })).catch(error => error);
    expect((transport as Error).message).toBe("SYNTHETIC_TIMEOUT"); expect(isInterpretationFailure(transport)).toBe(false);
  });
});
