import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Owner's 3-action request through the real plan path (decoder, ActionPlan, per-action
 * adapters, journal drafts/proposals, intra-plan conflicts) with a recorded Luna frame.
 * Only tenant data lookups are replaced by fixtures; no DB, no network, nothing confirmed. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], fabioWith: "pro-tatiana" }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /rodrigo/i.test(filter.query ?? "") ? [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] : [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: ref === "a-fabio" ? "2026-09-30T16:00" : "2026-10-01T11:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /f[aá]bio/i.test(name) ? [{ id: "c-fabio", name: "Fábio Santos" }] : /amanda/i.test(name) ? [{ id: "c-amanda", name: "Amanda Souza" }] : [] }));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));
// B2 only: the domain confirm is replaced (records which proposal was confirmed); preparation stays real.
const confirmed = vi.hoisted(() => ({ refs: [] as string[] }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    confirmed.refs.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: "synthetic-appointment" };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const plusHour = (time: string) => `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`;
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => f.customer_ref === "c-fabio" ? [{ appointment_ref: "a-fabio" }] : f.customer_ref === "c-amanda" ? [{ appointment_ref: "a-amanda" }] : [],
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse(operation === "schedule.block"
      ? { ...base, kind: operation, professional_ref: "pro-rodrigo", professional_name: "Rodrigo Lima", startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}` }
      : operation === "appointment.change"
        ? { ...base, kind: operation, appointment_ref: "a-fabio", revision: 1, customer_ref: "c-fabio", customer_name: "Fábio Santos", professional_ref: db.fabioWith, professional_name: db.fabioWith === "pro-rodrigo" ? "Rodrigo Lima" : "Tatiana Rocha",
          before_start: "2026-09-30T16:00", before_end: "2026-09-30T17:00", before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${plusHour(f.time)}`, priceCents: 8000 }
        : { ...base, kind: operation, appointment_ref: "a-amanda", revision: 1, customer_ref: "c-amanda", customer_name: "Amanda Souza", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
          before_start: "2026-10-01T11:00", before_end: "2026-10-01T12:00", before_timezone: "America/Sao_Paulo", startLocal: "2026-10-01T11:00", endLocal: "2026-10-01T12:00", priceCents: 9000 }) };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
  // Monday 2026-09-28 12:00 in São Paulo, the V01 run day: amanhã = dia 29.
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = []; db.fabioWith = "pro-tatiana"; confirmed.refs = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function prepare(raw: string, message: string) {
  const model = new ScriptedServicesModel([call("select_capabilities", JSON.parse(raw))]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const view = await secretary.send(actor, { sessionId: session.sessionId, message });
  expect(model.requests).toHaveLength(1);
  const action = (key: string) => view.action_plan!.actions.find(item => item.key === key)!;
  const child = (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state as SecretaryView;
  const router = db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").at(-1)?.metadata as { outcome?: { divergence: { failed_codes: string[] } } } | undefined;
  return { view, action, child, failed: router?.outcome?.divergence.failed_codes ?? [], secretary, sessionId: session.sessionId };
}
const corrected = V01_LUNA.replace("\"day_offset\":null,\"weekday\":null,\"time\":{\"value\":\"10:00\",\"literal\":\"10 horas\"}",
  "\"day_offset\":{\"value\":1,\"literal\":\"amanhã\"},\"weekday\":null,\"time\":{\"value\":\"10:00\",\"literal\":\"às 10 horas\"}");

describe("owner's 3-action request: change Fábio, cancel Amanda, close Rodrigo's agenda with the day after the interval", () => {
  it("complete interpretation: change and block are confirmable cards; the cancel asks only its reason", async () => {
    const run = await prepare(corrected, V01_MESSAGE);
    expect(run.action("alterar_fabio").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("alterar_fabio").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "10:00", appointment_ref: "a-fabio" });
    expect(run.action("bloquear_rodrigo").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("bloquear_rodrigo").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "10:00", end_time: "11:00", professional_ref: "pro-rodrigo" });
    expect(run.child("bloquear_rodrigo").scheduling!.fields.end_date).toBeUndefined();
    expect(run.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
    expect(run.child("cancelar_amanda").scheduling!.draft!.temporal_missing ?? []).toEqual([]);
    expect(run.failed).not.toContain("TEMPORAL_SCOPE_UNCLAIMED_DATE");
    expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false);
  });

  it("SAFETY (recorded V01): Fábio's 'amanhã' dropped by Luna never becomes a proposal on his original day; a date question and a divergence code instead", async () => {
    const run = await prepare(V01_LUNA, V01_MESSAGE);
    const fabio = run.child("alterar_fabio").scheduling!;
    expect(run.action("alterar_fabio").status).toBe("NEEDS_INPUT");
    expect(run.action("alterar_fabio").missing_fields).toContain("date");
    expect(fabio.proposal).toBeUndefined();
    expect(fabio.fields.date).toBeUndefined();
    expect(JSON.stringify(run.view)).not.toContain("30/09 às 10h");
    expect(db.rows.filter(row => row.action === "PROPOSAL").map(row => (row.metadata as { fields: { date?: string } }).fields.date)).not.toContain("2026-09-30");
    expect(run.view.message).toContain("Para qual dia devo passar Fábio?");
    expect(run.view.message).toContain("Qual o motivo do cancelamento?");
    expect(run.failed).toContain("TEMPORAL_SCOPE_UNCLAIMED_DATE");
    // Siblings are unaffected: Rodrigo's short '10'/'11' and trailing 'dia 29' are proven in his clause,
    // and Amanda's evidence-less cancel asks only its reason (no 'Para qual dia...' from Fábio's 'amanhã').
    expect(run.action("bloquear_rodrigo").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("bloquear_rodrigo").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "10:00", end_time: "11:00" });
    expect(run.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
    expect(run.view.message).not.toMatch(/Para qual dia é o agendamento de Amanda/);
  });

  // Variants use the recorded V01 operation shapes; every quote is copied from the message.
  const recorded = JSON.parse(V01_LUNA).turn.operations as Record<string, unknown>[];
  const shape = (operation: string, fields: Record<string, unknown>) => ({ ...recorded.find(item => item.operation === operation)!,
    date: null, day_offset: null, weekday: null, time: null, end_time: null, reason: null, ...fields });
  const turn = (...operations: Record<string, unknown>[]) => JSON.stringify({ turn: { mode: "NEW", operations } });
  const pair = (value: unknown, literal: string) => ({ value, literal });
  it.each([
    ["no accents, lower case", "altere o horario do fabio para amanha as 10 horas, cancele o horario da amanda e feche a agenda do profissional rodrigo das 10 as 11 do dia 29",
      ["altere o horario do fabio para amanha as 10 horas", "cancele o horario da amanda", "feche a agenda do profissional rodrigo das 10 as 11 do dia 29"],
      { date: pair("2026-09-29", "dia 29") }, null],
    ["'de amanhã' after the interval", "altere o horário do Fábio para amanhã às 10 horas, cancele o horário da Amanda e feche a agenda do profissional Rodrigo das 10 às 11 de amanhã",
      ["altere o horário do Fábio para amanhã às 10 horas", "cancele o horário da Amanda", "feche a agenda do profissional Rodrigo das 10 às 11 de amanhã"],
      { day_offset: pair(1, "amanhã") }, null],
    ["reason inline", "altere o horário do Fábio para amanhã às 10 horas, cancele o horário da Amanda porque ela viajou e feche a agenda do profissional Rodrigo das 10 às 11 do dia 29",
      ["altere o horário do Fábio para amanhã às 10 horas", "cancele o horário da Amanda porque ela viajou", "feche a agenda do profissional Rodrigo das 10 às 11 do dia 29"],
      { date: pair("2026-09-29", "dia 29") }, "ela viajou"],
  ] as const)("%s", async (_label, message, scopes, blockDay, reason) => {
    const raw = turn(
      shape("appointment.change", { source_scope: scopes[0], day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10 horas") }),
      shape("appointment.cancel", { source_scope: scopes[1], reason }),
      shape("schedule.block", { source_scope: scopes[2], ...blockDay, time: pair("10:00", "das 10"), end_time: pair("11:00", "às 11") }));
    const run = await prepare(raw, message);
    expect(run.action("alterar_fabio").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("alterar_fabio").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "10:00" });
    expect(run.action("bloquear_rodrigo").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("bloquear_rodrigo").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "10:00", end_time: "11:00" });
    if (reason) expect(run.action("cancelar_amanda").status).toBe("READY_FOR_CONFIRMATION");
    else expect(run.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
  });
  it("reordered actions with 'das 14h às 18h de sexta' keep each action's own day", async () => {
    const message = "Fecha a agenda do Rodrigo das 14h às 18h de sexta, cancela o horário da Amanda e passa o Fábio para amanhã às 10h.";
    const raw = turn(
      shape("schedule.block", { source_scope: "Fecha a agenda do Rodrigo das 14h às 18h de sexta", weekday: pair(5, "sexta"), time: pair("14:00", "das 14h"), end_time: pair("18:00", "às 18h") }),
      shape("appointment.cancel", { source_scope: "cancela o horário da Amanda" }),
      shape("appointment.change", { source_scope: "passa o Fábio para amanhã às 10h", day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") }));
    const run = await prepare(raw, message);
    expect(run.action("bloquear_rodrigo").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("bloquear_rodrigo").scheduling!.fields).toMatchObject({ date: "2026-10-02", time: "14:00", end_time: "18:00" });
    expect(run.action("alterar_fabio").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.child("alterar_fabio").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "10:00" });
    expect(run.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
  });

  it.each([["change first", false], ["block first", true]])("intra-request conflict (%s): the block of the same request wins; Fábio is asked another time", async (_label, blockFirst) => {
    db.fabioWith = "pro-rodrigo";
    const change = shape("appointment.change", { source_scope: "Passa o Fábio para amanhã às 10h", day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") });
    const block = shape("schedule.block", { source_scope: "fecha a agenda do Rodrigo amanhã das 10h às 11h", day_offset: pair(1, "amanhã"), time: pair("10:00", "das 10h"), end_time: pair("11:00", "às 11h") });
    const run = await prepare(blockFirst ? turn(block, change) : turn(change, block), "Passa o Fábio para amanhã às 10h e fecha a agenda do Rodrigo amanhã das 10h às 11h.");
    expect(run.action("bloquear_rodrigo").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.action("alterar_fabio")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["time"] });
    expect(run.child("alterar_fabio").scheduling!.proposal).toBeUndefined();
    expect(run.child("alterar_fabio").message).toContain("a agenda de Rodrigo Lima estará bloqueada das 10h às 11h neste mesmo pedido.");
    // B2: groups are per component. Fábio's (a time question) is never confirmable; the block's own group is.
    const groupOf = (key: string) => run.view.action_plan!.confirmation_groups.find(group => group.action_keys.includes(key))!;
    expect(groupOf("alterar_fabio").status).not.toBe("READY_FOR_CONFIRMATION");
    expect(groupOf("bloquear_rodrigo")).toMatchObject({ status: "READY_FOR_CONFIRMATION", action_keys: ["bloquear_rodrigo"] });
  });

  it("B2: the ready change and block are confirmed in one call while Amanda's cancel keeps asking only its reason", async () => {
    const run = await prepare(corrected, V01_MESSAGE), p = run.view.action_plan!;
    expect(p.policy.grouping).toBe("component");
    expect(p.confirmation_groups.map(group => [group.action_keys, group.status])).toEqual([
      [["alterar_fabio"], "READY_FOR_CONFIRMATION"], [["cancelar_amanda"], "NEEDS_REVIEW"], [["bloquear_rodrigo"], "READY_FOR_CONFIRMATION"]]);
    expect(run.view.capability_status).toBe("SUPPORTED");
    // B7: the lead names the subjects as registered once resolved (backup: contract-migration/secretary-three-action-plan.test.before-b7.ts).
    expect(run.view.message).toBe("Já dá para confirmar: remarcação de Fábio Santos e bloqueio de Rodrigo Lima.\n\nQual o motivo do cancelamento?");
    const refs = ["alterar_fabio", "bloquear_rodrigo"].map(key => run.child(key).scheduling!.proposal!.proposal_ref);
    const approvals = p.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
      .map(group => ({ plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }));
    const done = await run.secretary.confirmReadyGroups(actor, run.sessionId, approvals);
    expect(confirmed.refs).toEqual(refs);
    expect(done.action_plan!.actions.map(action => [action.key, action.status])).toEqual([
      ["alterar_fabio", "DONE"], ["cancelar_amanda", "NEEDS_INPUT"], ["bloquear_rodrigo", "DONE"]]);
    expect(done.confirmation_batch).toEqual({ executed: ["group_1", "group_3"], replayed: [], not_executed: [] });
    expect(done.message).toBe("Qual o motivo do cancelamento?");
    expect(done.operations!.find(op => op.action_keys?.includes("cancelar_amanda"))!.state.scheduling!.proposal).toBeUndefined();
  });
  it("B2 with the recorded V01 frame: only Rodrigo's block is confirmable; Fábio's day and Amanda's reason are still asked", async () => {
    const run = await prepare(V01_LUNA, V01_MESSAGE);
    expect(run.view.action_plan!.confirmation_groups.map(group => group.status)).toEqual(["NEEDS_REVIEW", "NEEDS_REVIEW", "READY_FOR_CONFIRMATION"]);
    expect(run.view.message).toBe("Já dá para confirmar: bloqueio de Rodrigo Lima.\n\nSó preciso de duas informações:\n\n1. Para qual dia devo passar Fábio?\n2. Qual o motivo do cancelamento?");
  });

  it("scope coverage needs a verified clause: without source_scope the historical sibling masking is used unchanged", async () => {
    const unscoped = V01_LUNA.replace(/"source_scope":"[^"]*"/g, "\"source_scope\":null");
    const run = await prepare(unscoped, V01_MESSAGE);
    // Documented open risk (not pinned as desired behaviour): no clause, no coverage check.
    expect(run.failed).not.toContain("TEMPORAL_SCOPE_UNCLAIMED_DATE");
    expect(run.failed).not.toContain("TEMPORAL_SCOPE_UNCLAIMED_CLOCK");
  });
});
