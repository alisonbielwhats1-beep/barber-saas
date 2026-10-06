import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAddSelection, createActionPlan, assessPlanAction, conversationalClarifications } from "@everflair/salon-secretary";
import { assertSchedulingExceptionScope } from "../scheduling-conflict-contract";

afterEach(() => { vi.unstubAllEnvs(); });

const create = (extra: Record<string, unknown> = {}) => ({
  operation: "appointment.create", item_key: "fabio", depends_on: ["cancel_joao"], released_slot_of: "cancel_joao", source_scope: null,
  target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [],
  customer_name: "Fábio", service_name: "Corte Completo", ...extra,
});
const request = (operations: unknown[]) => ({ disposition: "SUPPORTED", conversation_response: null, unavailable_capability: null,
  skills: ["scheduling"], independent: false, operations });
const activePlan = { plan_ref: "10000000-0000-4000-8000-000000000001", actions: [
  { item_key: "cancel_joao", operation: "appointment.cancel", status: "READY_FOR_CONFIRMATION" },
  { item_key: "block_tati", operation: "schedule.block", status: "NEEDS_INPUT" },
] };

describe("released slot of an existing cancellation (Coloca o Fábio no lugar)", () => {
  it("accepts one new appointment filling the slot of a cancellation already in the active plan", () => {
    const selection = validateAddSelection(request([create()]), activePlan);
    expect(selection.independent).toBe(false);
    expect(selection.operations).toHaveLength(1);
    expect(selection.operations[0]).toMatchObject({ item_key: "fabio", depends_on: ["cancel_joao"], released_slot_of: "cancel_joao", customer_name: "Fábio" });
  });
  it.each([
    ["an unknown key", create({ depends_on: ["nope"], released_slot_of: "nope" })],
    ["a non-cancellation action", create({ depends_on: ["block_tati"], released_slot_of: "block_tati" })],
    ["a dependency without released slot", create({ released_slot_of: null })],
    ["a non-create operation", { ...create(), operation: "appointment.list" }],
  ])("still rejects %s", (_label, op) => {
    expect(() => validateAddSelection(request([op]), activePlan)).toThrow();
  });
  it("rejects an external reference when more than one operation is added", () => {
    expect(() => validateAddSelection(request([create(), create({ item_key: "carla", customer_name: "Carla" })]), activePlan)).toThrow("INVALID_DEPENDENCY_GRAPH");
  });
  it("rejects any external reference without an active plan", () => {
    expect(() => validateAddSelection(request([create()]), undefined)).toThrow();
  });
});

describe("neutral exception values do not require the overlap capability", () => {
  it.each([
    [{ destination_mode: "SAME_RELEASED_SLOT" }],
    [{ override_requested: false }],
    [{ destination_mode: "SAME_RELEASED_SLOT", override_requested: false }],
  ])("accepts %j with the overlap feature disabled", fields => {
    vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "false");
    expect(() => assertSchedulingExceptionScope(fields, "appointment.create")).not.toThrow();
  });
  it.each([
    [{ destination_mode: "ALTERNATIVE_SLOT" }],
    [{ override_requested: true }],
    [{ override_reason: "cliente antiga" }],
  ])("still refuses a real exception %j with the overlap feature disabled", fields => {
    vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "false");
    expect(() => assertSchedulingExceptionScope(fields, "appointment.create")).toThrow("SCHEDULING_OVERLAP_DISABLED");
  });
  it("keeps a real exception scoped to appointment creation when enabled", () => {
    vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "true");
    expect(() => assertSchedulingExceptionScope({ override_requested: true }, "appointment.cancel")).toThrow("CAPABILITY_FIELD_MISMATCH");
  });
});

describe("Agenda clarification wording names the role asked", () => {
  const plan = (operation: string, fields: Record<string, unknown>, missing: string[]) => {
    const op = { operation, item_key: "a", depends_on: [], released_slot_of: null, source_scope: null, target_name: null, name: null, priceCents: null,
      durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [], ...fields };
    const created = createActionPlan({ disposition: "SUPPORTED", conversation_response: null, unavailable_capability: null, skills: ["scheduling"], independent: true, operations: [op] });
    return assessPlanAction(created, "a", { status: "NEEDS_INPUT", missing_fields: missing });
  };
  it.each([
    ["appointment.cancel", { customer_name: "João" }, ["reason"], "Qual o motivo do cancelamento?"],
    ["schedule.block", { professional_name: "Tatiana" }, ["date"], "Para qual dia é o bloqueio?"],
    ["appointment.create", { customer_name: "Amanda" }, ["date"], "Para qual dia é o agendamento de Amanda?"],
    ["appointment.create", { customer_name: "Amanda" }, ["date", "time"], "Para qual dia e horário é o agendamento de Amanda?"],
    ["schedule.block", { professional_name: "Ricardo" }, ["time", "end_time"], "De que horas até que horas devo bloquear a agenda de Ricardo?"],
  ])("%s asking %j", (operation, fields, missing, expected) => {
    expect(conversationalClarifications(plan(operation, fields, missing))[0].question).toBe(expected);
  });
});

describe("compound requests ground each action without its siblings' temporal literals", () => {
  const op = (item_key: string, operation: string, fields: Record<string, unknown>) => ({ item_key, operation, depends_on: [], released_slot_of: null, source_scope: null,
    target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [], ...fields }) as never;
  const message = "Muda o horário do Fábio de amanhã para as 17h e cancela a Carla de sexta, ela está doente.";
  it("blanks only the sibling's quoted date, keeping offsets and this action's literals", async () => {
    const { siblingScopedMessage } = await import("../secretary-sibling-scope");
    const fabio = op("fabio", "appointment.change", { customer_name: "Fábio", source_day_offset: 1, temporal_evidence: [{ field: "source_date", text: "amanhã" }] });
    const carla = op("carla", "appointment.cancel", { customer_name: "Carla", weekday: 5, reason: "ela está doente", temporal_evidence: [{ field: "date", text: "sexta" }] });
    const scoped = siblingScopedMessage(message, fabio, [fabio, carla]);
    expect(scoped).toHaveLength(message.length);
    expect(scoped).not.toContain("sexta");
    expect(scoped).toContain("amanhã");
    expect(siblingScopedMessage(message, carla, [fabio, carla])).not.toContain("amanhã");
  });
  it("never blanks a sibling quote that overlaps this action's own literal", async () => {
    const { siblingScopedMessage } = await import("../secretary-sibling-scope");
    const text = "Marca a Amanda às 10h e a Carla às 10h também.";
    const amanda = op("amanda", "appointment.create", { customer_name: "Amanda", time: "10:00", temporal_evidence: [{ field: "time", text: "às 10h" }] });
    const carla = op("carla", "appointment.create", { customer_name: "Carla", time: "10:00", temporal_evidence: [{ field: "time", text: "10h" }] });
    expect(siblingScopedMessage(text, amanda, [amanda, carla])).toBe(text);
  });
  it("leaves a single-action message untouched", async () => {
    const { siblingScopedMessage } = await import("../secretary-sibling-scope");
    const only = op("a", "appointment.create", { customer_name: "Amanda", temporal_evidence: [{ field: "time", text: "às 10h" }] });
    expect(siblingScopedMessage("Marca a Amanda às 10h", only, [only])).toBe("Marca a Amanda às 10h");
  });
});

describe("redundant selectors witnessed by the same literal", () => {
  it("accepts one exact literal for two selectors of the same role; different literals still conflict", async () => {
    const { decodeTemporalEvidencePayload } = await import("../../../packages/salon-secretary/src/scheduling-skill");
    const same = decodeTemporalEvidencePayload({ date: { value: "2026-09-29", literal: "depois de amanhã" }, day_offset: { value: 2, literal: "depois de amanhã" } }, true) as Record<string, unknown>;
    expect(same).toMatchObject({ date: "2026-09-29", day_offset: 2, temporal_evidence: [{ field: "date", text: "depois de amanhã" }] });
    expect(() => decodeTemporalEvidencePayload({ weekday: { value: 2, literal: "terça" }, day_offset: { value: 1, literal: "amanhã" } }, true)).toThrow("TEMPORAL_SELECTOR_CONFLICT");
  });
  it("the backend keeps the date only when both selectors resolve to it", async () => {
    const { groundSchedulingTemporal } = await import("../scheduling-temporal-source");
    const now = new Date("2026-09-27T15:00:00Z"), evidence = [{ field: "date" as const, text: "depois de amanhã" }];
    const ok = groundSchedulingTemporal({}, { date: "2026-09-29", day_offset: 2 }, "Remarca a Amanda para depois de amanhã no mesmo horário.", "America/Sao_Paulo", now, undefined, "appointment.change", evidence);
    expect(ok.rejected).toEqual([]); expect(ok.fields.date).toBe("2026-09-29");
    const bad = groundSchedulingTemporal({}, { date: "2026-09-30", day_offset: 2 }, "Remarca a Amanda para depois de amanhã no mesmo horário.", "America/Sao_Paulo", now, undefined, "appointment.change", evidence);
    expect(bad.fields.date).toBeUndefined(); expect(bad.rejected.map(item => item.field)).toContain("date");
  });
});

describe("one calendar reference split into date + weekday (Golden GF24)", () => {
  const message = "Reserva Hidratação Névoa para Bruno na terça, dia 14 de abril de 2027, às 13h.";
  const split = { date: { value: "2027-04-14", literal: "dia 14 de abril de 2027" }, weekday: { value: 2, literal: "terça" } };
  it("rejoins contiguous quotes into the exact message span and keeps only the explicit date", async () => {
    const { decodeTemporalEvidencePayload } = await import("../../../packages/salon-secretary/src/scheduling-skill");
    const out = decodeTemporalEvidencePayload(split, true, message) as Record<string, unknown>;
    expect(out).toMatchObject({ date: "2027-04-14", weekday: null, temporal_evidence: [{ field: "date", text: "terça, dia 14 de abril de 2027" }] });
    const contained = decodeTemporalEvidencePayload({ date: { value: "2027-04-14", literal: "terça, dia 14 de abril de 2027" }, weekday: { value: 2, literal: "terça" } }, true, message) as Record<string, unknown>;
    expect(contained).toMatchObject({ date: "2027-04-14", weekday: null, temporal_evidence: [{ field: "date", text: "terça, dia 14 de abril de 2027" }] });
  });
  it("never merges separated, repeated or relative selectors, nor without the message", async () => {
    const { decodeTemporalEvidencePayload } = await import("../../../packages/salon-secretary/src/scheduling-skill");
    expect(() => decodeTemporalEvidencePayload(split, true)).toThrow("TEMPORAL_SELECTOR_CONFLICT");
    expect(() => decodeTemporalEvidencePayload(split, true, "Na terça eu queria, se der, o dia 14 de abril de 2027 às 13h.")).toThrow("TEMPORAL_SELECTOR_CONFLICT");
    expect(() => decodeTemporalEvidencePayload(split, true, "Não é terça; é terça, dia 14 de abril de 2027.")).toThrow("TEMPORAL_SELECTOR_CONFLICT");
    expect(() => decodeTemporalEvidencePayload({ day_offset: { value: 1, literal: "amanhã" }, weekday: { value: 2, literal: "terça" } }, true, "Marca amanhã, terça, às 10h.")).toThrow("TEMPORAL_SELECTOR_CONFLICT");
  });
  it("the backend then asks about the contradiction instead of choosing a day", async () => {
    const { groundSchedulingTemporal } = await import("../scheduling-temporal-source");
    const g = groundSchedulingTemporal({}, { date: "2027-04-14", time: "13:00" }, message, "America/Sao_Paulo", new Date("2027-04-12T12:00:00Z"), undefined, "appointment.create",
      [{ field: "date", text: "terça, dia 14 de abril de 2027" }, { field: "time", text: "13h" }]);
    expect(g.fields.date).toBeUndefined();
    expect(g.pending_calendar_conflicts).toEqual([expect.objectContaining({ field: "date", kind: "WEEKDAY_DATE_CONFLICT", calendar_date: "2027-04-14", stated_weekday: 2 })]);
  });
});

describe("identical pending questions are asked once", () => {
  it("two fields with the same question do not produce a duplicated numbered list", async () => {
    const { composeActionPlanResponse } = await import("../../../packages/salon-secretary/src/conversational-presentation");
    // Practice C08: the atomic cancel+message unit leaves "content" pending on both actions.
    const cancel = { key: "cancel_joao", operation: "appointment.cancel", skill: "scheduling", status: "NEEDS_INPUT", depends_on: [], missing_fields: ["content"], fields: {}, assessment: {} };
    const message = { key: "msg_joao", operation: "customer.message", skill: "communication", status: "NEEDS_INPUT", depends_on: ["cancel_joao"], missing_fields: ["content"], fields: {}, assessment: {} };
    const plan = { plan_ref: "p", revision: 1, status: "NEEDS_INPUT", actions: [cancel, message], confirmation_groups: [], execution_order: ["cancel_joao", "msg_joao"] } as never;
    const { conversationalClarifications } = await import("../../../packages/salon-secretary/src/conversational-presentation");
    expect(conversationalClarifications(plan, {}).length).toBe(2);
    const text = composeActionPlanResponse(plan);
    const lines = text.split("\n").filter(Boolean);
    expect(new Set(lines).size).toBe(lines.length);
    expect(text).not.toMatch(/^1\. /m);
  });
});
