import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CapabilitySelection } from "@everflair/salon-secretary";
import { decodeConversationTurn } from "../../../packages/salon-secretary/src/conversation-routing";
import { actionScopedSource, siblingScopedMessage } from "../secretary-sibling-scope";
import { applyScopeCoverage, groundSchedulingTemporal, unclaimedScopeRoles } from "../scheduling-temporal-source";
import { groundSchedulingReasons } from "../scheduling-literal-source";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import { V01_LUNA, V01_LUNA_SHA256, V01_MESSAGE } from "../../test/secretary-v01-recorded";

// Monday 2026-09-28, 12:00 in São Paulo (the V01 run day): amanhã = 2026-09-29.
const now = new Date("2026-09-28T15:00:00Z"), tz = "America/Sao_Paulo";

const temporal = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([key]) => /^(?:source_|end_)?(?:date|time)$/.test(key)));
const decode = (raw: string, message: string) => decodeConversationTurn(JSON.parse(raw), undefined, message) as unknown as CapabilitySelection;
const byKey = (selection: CapabilitySelection, key: string) => selection.operations.find(op => op.item_key === key)!;
/** Grounds one operation exactly like the adapter: scoped view, temporal proof, then scope coverage. */
function groundAction(selection: CapabilitySelection, key: string, message: string) {
  const op = byKey(selection, key), { operation, fields, temporal_evidence } = projectSchedulingOperation(op);
  const source = actionScopedSource(message, op, selection.operations);
  const grounded = groundSchedulingTemporal({}, fields, source.text, tz, now, undefined, operation, temporal_evidence);
  const divergence = source.scoped ? applyScopeCoverage(grounded, source.text, tz, now, operation, fields, temporal_evidence) : [];
  return { source, grounded, divergence, fields };
}

describe("recorded V01 Luna output: each action is grounded against its own clause", () => {
  const selection = decode(V01_LUNA, V01_MESSAGE);
  it("pins the exact recorded arguments", () => {
    expect(createHash("sha256").update(V01_LUNA).digest("hex")).toBe(V01_LUNA_SHA256);
    expect(selection.operations.map(op => op.item_key)).toEqual(["alterar_fabio", "cancelar_amanda", "bloquear_rodrigo"]);
  });
  it("views keep offsets, keep the own clause and the unattributed text, and blank only the siblings' clauses", () => {
    for (const op of selection.operations) {
      const view = actionScopedSource(V01_MESSAGE, op, selection.operations);
      expect(view.scoped).toBe(true);
      expect(view.text).toHaveLength(V01_MESSAGE.length);
      const clauses = selection.operations.map(item => [V01_MESSAGE.indexOf(item.source_scope!), V01_MESSAGE.indexOf(item.source_scope!) + item.source_scope!.length, item] as const);
      for (let i = 0; i < V01_MESSAGE.length; i++) {
        const owner = clauses.find(([start, end]) => i >= start && i < end)?.[2];
        expect(view.text[i]).toBe(!owner || owner === op ? V01_MESSAGE[i] : " ");
      }
    }
  });
  it("Rodrigo's block: the short '10' resolves inside its own clause and the trailing 'dia 29' is the block day", () => {
    const { grounded, divergence } = groundAction(selection, "bloquear_rodrigo", V01_MESSAGE);
    expect(grounded.rejected).toEqual([]);
    expect(temporal(grounded.fields)).toEqual({ date: "2026-09-29", time: "10:00", end_time: "11:00" });
    expect(divergence).toEqual([]);
  });
  it("Amanda's evidence-less cancel no longer sees Fábio's 'amanhã' (no spurious date question)", () => {
    const { grounded, divergence } = groundAction(selection, "cancelar_amanda", V01_MESSAGE);
    expect(grounded.rejected).toEqual([]);
    expect(temporal(grounded.fields)).toEqual({});
    expect(divergence).toEqual([]);
    // Without the clause, the same evidence-less cancel is asked for Fábio's date (historical fallback).
    const legacy = groundSchedulingTemporal({}, {}, siblingScopedMessage(V01_MESSAGE, byKey(selection, "cancelar_amanda"), selection.operations), tz, now, undefined, "appointment.cancel");
    expect(legacy.rejected.map(item => item.field)).toEqual(["date"]);
  });
  it("SAFETY: Fábio's change without 'amanhã' keeps the clock but the unclaimed day is asked, never defaulted", () => {
    const { grounded, divergence } = groundAction(selection, "alterar_fabio", V01_MESSAGE);
    expect(temporal(grounded.fields)).toEqual({ time: "10:00" });
    expect(grounded.fields.date).toBeUndefined();
    expect(grounded.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "date", value: "MISSING" }]);
    expect(divergence).toEqual(["TEMPORAL_SCOPE_UNCLAIMED_DATE"]);
  });
  it("the corrected interpretation (Luna quotes 'amanhã') is accepted without divergence", () => {
    const fixed = decode(V01_LUNA.replace("\"day_offset\":null,\"weekday\":null,\"time\":{\"value\":\"10:00\",\"literal\":\"10 horas\"}",
      "\"day_offset\":{\"value\":1,\"literal\":\"amanhã\"},\"weekday\":null,\"time\":{\"value\":\"10:00\",\"literal\":\"às 10 horas\"}"), V01_MESSAGE);
    const { grounded, divergence } = groundAction(fixed, "alterar_fabio", V01_MESSAGE);
    expect(grounded.rejected).toEqual([]);
    expect(temporal(grounded.fields)).toEqual({ date: "2026-09-29", time: "10:00" });
    expect(divergence).toEqual([]);
  });
});

const op = (item_key: string, operation: string, fields: Record<string, unknown>) => ({ item_key, operation, depends_on: [], released_slot_of: null, source_scope: null,
  target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [], ...fields }) as never as CapabilitySelection["operations"][number];

describe("a sibling quoting the same word does not hide what this action dropped", () => {
  it("Rodrigo's 'amanhã' leaves Fábio's own 'amanhã' visible in Fábio's clause, so the dropped day is asked", () => {
    const message = "Fecha a agenda do Rodrigo amanhã das 14h às 15h e passa o Fábio para amanhã às 10h.";
    const rodrigo = op("rodrigo", "schedule.block", { professional_name: "Rodrigo", day_offset: 1, time: "14:00", end_time: "15:00", source_scope: "Fecha a agenda do Rodrigo amanhã das 14h às 15h",
      temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "das 14h" }, { field: "end_time", text: "às 15h" }] });
    const fabio = op("fabio", "appointment.change", { customer_name: "Fábio", time: "10:00", source_scope: "passa o Fábio para amanhã às 10h",
      temporal_evidence: [{ field: "time", text: "às 10h" }] });
    const selection = { operations: [rodrigo, fabio] } as unknown as CapabilitySelection;
    const view = actionScopedSource(message, fabio, selection.operations);
    expect(view.scoped).toBe(true);
    expect(view.text).toContain("amanhã às 10h");
    const { grounded, divergence } = groundAction(selection, "fabio", message);
    expect(temporal(grounded.fields)).toEqual({ time: "10:00" });
    expect(divergence).toEqual(["TEMPORAL_SCOPE_UNCLAIMED_DATE"]);
    expect(groundAction(selection, "rodrigo", message).grounded.rejected).toEqual([]);
  });
});

describe("a sibling's negation or reason never leaks into another action", () => {
  const message = "Cancela a Amanda que não vem mais e fecha a agenda do Rodrigo das 10 às 11 amanhã.";
  const amanda = (scope: string | null) => op("amanda", "appointment.cancel", { customer_name: "Amanda", reason: "não vem mais", source_scope: scope });
  const rodrigo = (scope: string | null) => op("rodrigo", "schedule.block", { professional_name: "Rodrigo", day_offset: 1, time: "10:00", end_time: "11:00", source_scope: scope,
    temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }] });
  const ground = (own: ReturnType<typeof rodrigo>, all: ReturnType<typeof rodrigo>[]) => {
    const { operation, fields, temporal_evidence } = projectSchedulingOperation(own);
    return groundSchedulingTemporal({}, fields, actionScopedSource(message, own, all).text, tz, now, undefined, operation, temporal_evidence);
  };
  it("historical masking: Amanda's 'não' rejects every time of Rodrigo's block (the leak)", () => {
    const leak = ground(rodrigo(null), [amanda(null), rodrigo(null)]);
    expect(leak.rejected.map(item => item.field).sort()).toEqual(["date", "end_time", "time"]);
  });
  it("with each clause quoted, the block is grounded and Amanda's reason is still her own literal", () => {
    const all = [amanda("Cancela a Amanda que não vem mais"), rodrigo("fecha a agenda do Rodrigo das 10 às 11 amanhã.")];
    const block = ground(all[1], all);
    expect(block.rejected).toEqual([]);
    expect(temporal(block.fields)).toEqual({ date: "2026-09-29", time: "10:00", end_time: "11:00" });
    const patch: Record<string, unknown> = { reason: "não vem mais" };
    const reasons = groundSchedulingReasons(patch, {}, actionScopedSource(message, all[0], all).text);
    expect(reasons).toEqual({ rejected: [], accepted: ["reason"] });
    expect(patch.reason).toBe("não vem mais");
    // A reason quoted from the sibling's clause is not provable in this action's view.
    const stolen: Record<string, unknown> = { reason: "fecha a agenda" };
    expect(groundSchedulingReasons(stolen, {}, actionScopedSource(message, all[0], all).text).rejected).toHaveLength(1);
  });
});

describe("the clause is used only when it is verified; otherwise the historical masking applies", () => {
  const message = "Passa o Fábio para amanhã às 10h e bloqueia o Rodrigo das 14h às 15h.";
  const fabio = (scope: string | null, evidence = [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]) =>
    op("fabio", "appointment.change", { customer_name: "Fábio", day_offset: 1, time: "10:00", source_scope: scope, temporal_evidence: evidence });
  const rodrigo = (scope: string | null) => op("rodrigo", "schedule.block", { professional_name: "Rodrigo", time: "14:00", end_time: "15:00", source_scope: scope,
    temporal_evidence: [{ field: "time", text: "das 14h" }, { field: "end_time", text: "às 15h" }] });
  it.each([
    ["no scope", fabio(null), rodrigo("bloqueia o Rodrigo das 14h às 15h")],
    ["a scope absent from the message", fabio("passa o Fabio para amanha"), rodrigo("bloqueia o Rodrigo das 14h às 15h")],
    ["a scope overlapping the sibling's clause", fabio("Passa o Fábio para amanhã às 10h e bloqueia o Rodrigo"), rodrigo("bloqueia o Rodrigo das 14h às 15h")],
    ["an own quote only outside the clause", fabio("Passa o Fábio para", [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }]), rodrigo("bloqueia o Rodrigo das 14h às 15h")],
  ])("%s → historical masking", (_label, own, sibling) => {
    const view = actionScopedSource(message, own, [own, sibling]);
    expect(view.scoped).toBe(false);
    expect(view.text).toBe(siblingScopedMessage(message, own, [own, sibling]));
  });
  it("a repeated scope text is not unique", () => {
    const text = "Marca a Carla às 10h. Marca a Carla às 10h.";
    const carla = op("carla", "appointment.create", { customer_name: "Carla", source_scope: "Marca a Carla às 10h." });
    expect(actionScopedSource(text, carla, [carla, op("x", "appointment.cancel", { customer_name: "Ana" })]).scoped).toBe(false);
  });
  it("a single operation is never scoped", () => {
    const only = fabio("Passa o Fábio para amanhã às 10h");
    expect(actionScopedSource(message, only, [only])).toEqual({ text: message, scoped: false });
  });
});

describe("scope coverage uses the grammar's own atoms and maps them to the action's roles", () => {
  const roles = (source: string, operation: string, evidence: { field: string; text: string }[], exempt: string[] = []) =>
    unclaimedScopeRoles(source, tz, now, operation, {}, evidence as never, exempt).map(role => role.field);
  it("an unclaimed clock when only a date was sent is asked as the time", () => {
    expect(roles("passa o Fábio para amanhã às 10h", "appointment.change", [{ field: "date", text: "amanhã" }])).toEqual(["time"]);
  });
  it("origin atoms map to the origin roles of a move", () => {
    expect(roles("muda o Fábio de sexta às 9h para as 11h", "appointment.change", [{ field: "time", text: "as 11h" }]).sort()).toEqual(["source_date", "source_time"]);
  });
  it("a directly denied atom is an exclusion, not a claim to cover", () => {
    expect(roles("passa o Fábio para amanhã às 11h, não às 10h", "appointment.change", [{ field: "date", text: "amanhã" }, { field: "time", text: "às 11h" }])).toEqual([]);
  });
  it("an atom inside the action's own reason quote is not a temporal claim", () => {
    expect(roles("cancela a Amanda de amanhã porque ela viaja sexta", "appointment.cancel", [{ field: "date", text: "amanhã" }], ["ela viaja sexta"])).toEqual([]);
  });
  it("a block's second interval endpoint left out is asked as the end time", () => {
    expect(roles("fecha a agenda do Rodrigo amanhã das 10 às 11", "schedule.block", [{ field: "date", text: "amanhã" }, { field: "time", text: "das 10" }])).toEqual(["end_time"]);
  });
});

/** Temporal fields and rejected fields of one action grounded like the adapter (single unit and startBatch share this path). */
function outcome(message: string, ops: CapabilitySelection["operations"], key: string) {
  const { grounded, divergence, source } = groundAction({ operations: ops } as unknown as CapabilitySelection, key, message);
  return { fields: temporal(grounded.fields), rejected: grounded.rejected.map(item => item.field).sort(), divergence, source };
}
const cancel = (key: string, name: string, scope: string, extra: Record<string, unknown> = {}) => op(key, "appointment.cancel", { customer_name: name, source_scope: scope, ...extra });
const block = (scope: string, fields: Record<string, unknown>, evidence: { field: string; text: string }[]) =>
  op("rodrigo", "schedule.block", { professional_name: "Rodrigo", source_scope: scope, temporal_evidence: evidence, ...fields });
const rodrigoTomorrow = (scope: string) => block(scope, { day_offset: 1, time: "10:00", end_time: "11:00" },
  [{ field: "date", text: "amanhã" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);

describe("SAFETY: Luna's clause never hides this action's own negation", () => {
  it.each([
    ["block, leading 'Não' left out of the clause", "Não bloqueie a agenda do Rodrigo amanhã das 10 às 11, cancele a Amanda porque ela viajou.",
      rodrigoTomorrow("bloqueie a agenda do Rodrigo amanhã das 10 às 11"), cancel("amanda", "Amanda", "cancele a Amanda porque ela viajou", { reason: "ela viajou" }), ["date", "end_time", "time"]],
    ["change, leading 'Não' left out of the clause", "Não passe o Fábio para amanhã às 10h, e cancele a Amanda porque ela viajou.",
      op("fabio", "appointment.change", { customer_name: "Fábio", day_offset: 1, time: "10:00", source_scope: "passe o Fábio para amanhã às 10h", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }] }),
      cancel("amanda", "Amanda", "cancele a Amanda porque ela viajou", { reason: "ela viajou" }), ["date", "time"]],
    ["change before a block, leading 'Não' left out", "Não passa o Fábio para amanhã às 10h; fecha a agenda do Rodrigo das 14h às 15h.",
      op("fabio", "appointment.change", { customer_name: "Fábio", day_offset: 1, time: "10:00", source_scope: "passa o Fábio para amanhã às 10h", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }] }),
      block("fecha a agenda do Rodrigo das 14h às 15h", { time: "14:00", end_time: "15:00" }, [{ field: "time", text: "das 14h" }, { field: "end_time", text: "às 15h" }]), ["date", "time"]],
    ["create, leading 'Nunca' left out of the clause", "Nunca marca a Carla amanhã às 9h, e cancela o horário do João.",
      op("carla", "appointment.create", { customer_name: "Carla", day_offset: 1, time: "09:00", source_scope: "marca a Carla amanhã às 9h", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 9h" }] }),
      cancel("joao", "João", "cancela o horário do João"), ["date", "time"]],
    ["cancel, leading 'Não' left out of the clause", "Não cancela a Amanda amanhã às 10, só bloqueia o Rodrigo das 14 às 15.",
      cancel("amanda", "Amanda", "cancela a Amanda amanhã às 10", { day_offset: 1, time: "10:00", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10" }] }),
      block("bloqueia o Rodrigo das 14 às 15", { time: "14:00", end_time: "15:00" }, [{ field: "time", text: "das 14" }, { field: "end_time", text: "às 15" }]), ["date", "time"]],
  ] as const)("%s", (_label, message, own, sibling, rejected) => {
    const result = outcome(message, [own, sibling], own.item_key!);
    expect(result.source.scoped).toBe(true);
    expect(result.fields).toEqual({});
    expect(result.rejected).toEqual(rejected);
  });
  it("a sibling after the boundary is still grounded: the leading negator governs only its own clause", () => {
    const amanda = cancel("amanda", "Amanda", "cancela a Amanda amanhã às 10", { day_offset: 1, time: "10:00", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10" }] });
    const rodrigo = block("bloqueia o Rodrigo das 14 às 15", { time: "14:00", end_time: "15:00" }, [{ field: "time", text: "das 14" }, { field: "end_time", text: "às 15" }]);
    expect(outcome("Não cancela a Amanda amanhã às 10, só bloqueia o Rodrigo das 14 às 15.", [amanda, rodrigo], "rodrigo")).toMatchObject({ fields: { time: "14:00", end_time: "15:00" }, rejected: [] });
    const fabio = op("fabio", "appointment.change", { customer_name: "Fábio", day_offset: 1, time: "10:00", source_scope: "passa o Fábio para amanhã às 10h", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }] });
    const block15 = block("fecha a agenda do Rodrigo das 14h às 15h", { time: "14:00", end_time: "15:00" }, [{ field: "time", text: "das 14h" }, { field: "end_time", text: "às 15h" }]);
    expect(outcome("Não passa o Fábio para amanhã às 10h; fecha a agenda do Rodrigo das 14h às 15h.", [fabio, block15], "rodrigo")).toMatchObject({ fields: { time: "14:00", end_time: "15:00" }, rejected: [] });
  });
  it("atomic pair (startBatch scope): the cancel's own 'Não' outside its clause still denies it", () => {
    const message = "Não cancela a Amanda amanhã às 10 e coloca o João no lugar dela; fecha a agenda do Rodrigo das 14h às 15h.";
    const ops = [cancel("a", "Amanda", "cancela a Amanda amanhã às 10", { day_offset: 1, time: "10:00", temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10" }] }),
      op("b", "appointment.create", { customer_name: "João", depends_on: ["a"], released_slot_of: "a", source_scope: "coloca o João no lugar dela" }),
      block("fecha a agenda do Rodrigo das 14h às 15h", { time: "14:00", end_time: "15:00" }, [{ field: "time", text: "das 14h" }, { field: "end_time", text: "às 15h" }])];
    expect(outcome(message, ops, "a")).toMatchObject({ fields: {}, rejected: ["date", "time"] });
    expect(outcome(message, ops, "rodrigo")).toMatchObject({ fields: { time: "14:00", end_time: "15:00" }, rejected: [] });
  });
  it.each([
    ["in the lead, swallowed by the previous sibling's clause", "Cancela a Amanda e não bloqueia o Rodrigo amanhã das 10 às 11.", "Cancela a Amanda e não", "bloqueia o Rodrigo amanhã das 10 às 11"],
    ["in the tail, swallowed by the next sibling's clause", "Bloqueia o Rodrigo amanhã das 10 às 11 não, cancela a Amanda.", "não, cancela a Amanda", "Bloqueia o Rodrigo amanhã das 10 às 11"],
  ])("a negator governing the clause %s stays visible", (_label, message, amandaScope, rodrigoScope) => {
    const result = outcome(message, [cancel("amanda", "Amanda", amandaScope), rodrigoTomorrow(rodrigoScope)], "rodrigo");
    expect(result.source.scoped).toBe(true);
    expect(result.source.text).toContain("não");
    expect(result.source.text).not.toContain("Amanda");
    expect(result).toMatchObject({ fields: {}, rejected: ["date", "end_time", "time"] });
  });
  it("a sibling clause that does not hold the sibling's own quotes is not blanked (its negator stays visible)", () => {
    const message = "Cancela a Amanda que não vem mais e fecha a agenda do Rodrigo das 10 às 11 amanhã.";
    const result = outcome(message, [cancel("amanda", "Amanda", "Cancela a Amanda", { reason: "não vem mais" }), rodrigoTomorrow("fecha a agenda do Rodrigo das 10 às 11 amanhã.")], "rodrigo");
    expect(result.source.text).toContain("não vem mais");
    expect(result.rejected).toEqual(["date", "end_time", "time"]);
  });
});

describe("SAFETY: a clipped clause never drops constraints the user stated for the same action", () => {
  it("origin atoms left outside Luna's clause are still demanded (never a time-only move)", () => {
    const message = "Muda o Fábio de sexta às 9h para as 11h e cancela a Amanda porque ela viajou.";
    const fabio = op("fabio", "appointment.change", { customer_name: "Fábio", time: "11:00", source_scope: "para as 11h", temporal_evidence: [{ field: "time", text: "as 11h" }] });
    const result = outcome(message, [fabio, cancel("amanda", "Amanda", "cancela a Amanda porque ela viajou", { reason: "ela viajou" })], "fabio");
    expect(result.source.scoped).toBe(true);
    expect(result.fields).toEqual({ time: "11:00" });
    expect(result.rejected).toEqual(["source_date", "source_time"]);
    expect([...result.divergence].sort()).toEqual(["TEMPORAL_SCOPE_UNCLAIMED_CLOCK", "TEMPORAL_SCOPE_UNCLAIMED_DATE"]);
  });
  it("a block quoting a date only from the sibling's clause does not borrow it (scoped or not)", () => {
    const message = "Fecha a agenda do Rodrigo das 10 às 11 e cancela a Amanda de amanhã.";
    const rodrigo = rodrigoTomorrow("Fecha a agenda do Rodrigo das 10 às 11");
    const amanda = cancel("amanda", "Amanda", "cancela a Amanda de amanhã", { day_offset: 1, temporal_evidence: [{ field: "date", text: "amanhã" }] });
    for (const ops of [[rodrigo, amanda], [{ ...rodrigo, source_scope: null }, { ...amanda, source_scope: null }]]) {
      const result = outcome(message, ops, "rodrigo");
      expect(result.fields.date).toBeUndefined();
      expect(result.rejected).toContain("date");
    }
  });
});

describe("scope coverage keeps a role the action's own quote proved", () => {
  it("a duration in the create clause ('coloração de 2h') is reported, the proven 15h is kept", () => {
    const message = "Coloca a Rosa amanhã às 15h para uma coloração de 2h e cancela o horário da Carla.";
    const rosa = op("rosa", "appointment.create", { customer_name: "Rosa", service_name: "coloração", day_offset: 1, time: "15:00", source_scope: "Coloca a Rosa amanhã às 15h para uma coloração de 2h",
      temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 15h" }] });
    const result = outcome(message, [rosa, cancel("carla", "Carla", "cancela o horário da Carla")], "rosa");
    expect(result.source.scoped).toBe(true);
    expect(result.fields).toEqual({ date: "2026-09-29", time: "15:00" });
    expect(result.rejected).toEqual([]);
    expect(result.divergence).toEqual(["TEMPORAL_SCOPE_EXTRA_CLOCK"]);
  });
});
