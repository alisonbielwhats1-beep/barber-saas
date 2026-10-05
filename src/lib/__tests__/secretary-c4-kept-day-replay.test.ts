import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Tx } from "../prisma-tenant";

/** Candidate 4 safety replay (flag SALON_SECRETARY_DATE_RULES_V2): V30 of the final real-Luna DEV check (c4-vn-final, 30/09/2026),
 * "Passa a Rosa para amanhã às 10h e meia." with Rosa's appointment on Friday 02/10 at 14h and the run day Wednesday 30/09
 * ("amanhã" = Thursday 01/10). In k2 Luna sent only the clock (components.date = null): the backend kept the ORIGIN day and proposed
 * Friday 02/10 at 10h30, a day the owner did not say. The recorded arguments are replayed byte for byte through the real plan path
 * (decoder, ActionPlan, adapter, journal drafts and proposals) with the run's full candidate flag set; only tenant lookups are
 * fixtures (the run's own tenant rows). No network, no model, no DB. This extends the recorded V30 regression, hence its names. */
const RUN = "packages/salon-secretary/evaluation/results/agenda-core/2026-09-30T04-07-24-898Z-c4-vn-final";
const K1 = "{\"turn\":{\"mode\":\"NEW\",\"operations\":[{\"operation\":\"appointment.change\",\"item_key\":\"a\",\"depends_on\":null,\"released_slot_of\":null,\"same_as\":null,\"source_scope\":\"Passa a Rosa para amanhã às 10h e meia.\",\"customer_name\":\"Rosa\",\"service_names\":null,\"service_name\":null,\"professional_name\":null,\"components\":{\"date\":{\"value\":{\"kind\":\"RELATIVE_DAY\",\"offset\":1,\"weekday\":null,\"week\":null,\"day\":null,\"month\":null,\"year\":null,\"days\":null},\"literal\":\"amanhã\"},\"source_date\":null,\"end_date\":null,\"time\":{\"value\":{\"hour\":10,\"minute\":30,\"daypart\":\"UNSPECIFIED\"},\"literal\":\"10h e meia\"},\"source_time\":null,\"end_time\":null},\"date\":null,\"time\":null,\"period\":null,\"source_date\":null,\"source_time\":null,\"end_time\":null,\"end_date\":null,\"excluded\":null,\"reason\":null,\"target_professional_name\":null,\"service_changes\":null}]}}";
const K2 = "{\"turn\":{\"mode\":\"NEW\",\"operations\":[{\"operation\":\"appointment.change\",\"item_key\":\"a\",\"depends_on\":null,\"released_slot_of\":null,\"same_as\":null,\"source_scope\":\"Passa a Rosa para amanhã às 10h e meia.\",\"customer_name\":\"Rosa\",\"service_names\":null,\"service_name\":null,\"professional_name\":null,\"components\":{\"date\":null,\"source_date\":null,\"end_date\":null,\"time\":{\"value\":{\"hour\":10,\"minute\":30,\"daypart\":\"UNSPECIFIED\"},\"literal\":\"10h e meia\"},\"source_time\":null,\"end_time\":null},\"date\":null,\"time\":null,\"period\":null,\"source_date\":null,\"source_time\":null,\"end_time\":null,\"end_date\":null,\"excluded\":null,\"reason\":null,\"target_professional_name\":null,\"service_changes\":null}]}}";
const SHA = { k1: "0b37fe5b9511f57e6d3b8af1d72d545658075f90db761b72261680a2c7640597", k2: "8e66d6d88cea2c09d57909c8860e49863b4814dfc510942bdfe66851b376a757" };
const MESSAGE = "Passa a Rosa para amanhã às 10h e meia.";
/** The model contract both attempts ran under (V30.json `contractVersion`): b1e04c55d38ea8dab9357faa6fc9ed331122e97f4a725d58cc25e18273f28b76.
 * Contract migration (04/10/2026, backup: .demo/agenda-core/contract-migration/secretary-c4-kept-day-replay.test.before-professional-schedule-rule.ts):
 * the discovery prompt gained "ou jornada" (a professional's schedule is professional_management); the recorded outputs above
 * are replayed under the current contract, so a turn now records this one. The backend assertions are unchanged. */
const CONTRACT_NOW = "c582307bd1cb76622023cbd39fad197a44823b276602f954c0189087095b1f7f";
/** The run's flags (V30.json `flags`, candidate-flags-c4.sh). */
const FLAGS: Record<string, string> = { ALTER_APPOINTMENT: "true", COPY_V2: "true", CUSTOMER_OVERLAP_GUARD: "true", DATE_RULES_V2: "true", DAYPART_BY_HOURS: "true",
  DAYPART_RULES_V2: "true", EXAMPLES: "selected", EXAMPLES_V2: "true", EXCEPTION_RULES_V2: "true", JEV_ROUTER_ENABLED: "false", JIT_INSTRUCTIONS: "true",
  MULTI_ACTION_V2_ENABLED: "true", MULTI_SERVICE: "true", NAME_SUGGESTIONS: "true", PERSISTED_STATE: "true", READS_V2: "true", RECURRENCE_GUARD: "true", REFERENCES_V2: "true",
  SAME_AS: "true", SCHEDULING_OVERLAP_ENABLED: "true", STRUCTURED_CONTEXT: "true", TEMPORAL_COMPONENTS: "true", TEMPORAL_POLARITY: "true" };

const ROSA = { appointment_ref: "a-rosa", customer_ref: "c-rosa", customer_name: "Rosa Viana", professional_ref: "p-tatiana", professional_name: "Tatiana Rocha", service_ref: "s-escova",
  services: [{ serviceName: "Escova" }], start_local: "2026-10-02T14:00", end_local: "2026-10-02T14:45", start_at: "2026-10-02T17:00:00.000Z", status: "CONFIRMED" };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], moves: [] as string[] }));
const plus45 = (local: string) => { const minutes = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) + 45;
  return `${local.slice(0, 11)}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; };
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async () => [{ id: "s-escova", name: "Escova" }],
  listSchedulingProfessionals: async () => [{ id: "p-tatiana", name: "Tatiana Rocha" }],
  schedulingSelfProfessional: async () => undefined, listUpcomingCustomerAppointments: async () => [], listSchedulingAppointments: async () => [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { if (ref !== ROSA.appointment_ref) throw Error("APPOINTMENT_NOT_FOUND"); return ROSA; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /^rosa/i.test(name.trim()) ? [{ id: "c-rosa", name: "Rosa Viana" }] : [],
  getCustomer: async () => ({ id: "c-rosa", name: "Rosa Viana" }) }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string; source_date?: string }) =>
      f.customer_ref === ROSA.customer_ref && (!f.source_date || ROSA.start_local.startsWith(f.source_date)) ? [ROSA] : [],
    inspectSchedulingMove: async (_tx: unknown, _actor: unknown, _ref: string, date: string, time: string) => { db.moves.push(`${date}T${time}`); return { result: {}, alternatives: [] }; },
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse({ kind: operation,
      appointment_ref: ROSA.appointment_ref, revision: 1, customer_ref: ROSA.customer_ref, customer_name: ROSA.customer_name, professional_ref: ROSA.professional_ref,
      professional_name: ROSA.professional_name, timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: plus45(`${f.date}T${f.time}`), before_start: ROSA.start_local,
      before_end: ROSA.end_local, before_timezone: "America/Sao_Paulo", priceCents: 6000, services: [{ id: "s-escova", name: "Escova", durationMin: 45, priceCents: 6000, priceType: "FIXED",
        priceNote: null, processingMin: 0, finishingMin: 0 }], requires_acceptance: false, resource_ids: [], waiting_count: 0, waiting_hash: "", affected: [] }) };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { applySchedulingInterpretation, schedulingState } from "../secretary-scheduling";
import { ScriptedServicesModel, appendScriptedResponses, call } from "../../test/scripted-services-model";

const actor = { salonId: "v30-replay", userId: "v30-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-30T15:00:00Z")); // Wednesday 30/09, 12h in São Paulo
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  for (const [name, value] of Object.entries(FLAGS)) vi.stubEnv(`SALON_SECRETARY_${name}`, value);
  Object.assign(db, { rows: [], moves: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** The recorded arguments, byte for byte (never re-serialized). */
const recorded = (args: string) => [{ type: "function_call" as const, callId: crypto.randomUUID(), name: "select_capabilities", arguments: args }];
async function session(args: string) {
  const model = new ScriptedServicesModel([recorded(args)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const started = await secretary.start(actor, "auto");
  return { model, say: (message: string) => secretary.send(actor, { sessionId: started.sessionId, message }) };
}
const action = (view: SecretaryView) => view.action_plan!.actions[0];
const codes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").flatMap(row => (row.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? []);

describe("V30 replay (c4-vn-final): 'Passa a Rosa para amanhã às 10h e meia.'", () => {
  it("replays the recorded bytes of both attempts", () => {
    expect(createHash("sha256").update(K1).digest("hex")).toBe(SHA.k1);expect(createHash("sha256").update(K2).digest("hex")).toBe(SHA.k2);
    // Provenance, when the (git-ignored) evidence of the run is on this machine.
    for (const [k, args] of [["k1", K1], ["k2", K2]] as const) if (existsSync(`${RUN}/${k}/V30.json`))
      expect((JSON.parse(readFileSync(`${RUN}/${k}/V30.json`, "utf8")) as { transcript: { luna: string[] }[] }).transcript[0].luna[0]).toBe(args);
  });
  it("k2 (date dropped by Luna) asks the destination day: nothing confirmable, the origin day is never proposed", async () => {
    const view = await (await session(K2)).say(MESSAGE);
    expect(action(view).status).toBe("NEEDS_INPUT");expect(action(view).missing_fields).toContain("date");expect((action(view).fields as Record<string, unknown>).date).toBeUndefined();
    expect(view.message).toBe("Para qual dia devo passar Rosa?");expect(action(view).assessment?.preview).toContain("Preciso confirmar data de destino");
    expect(JSON.stringify(view)).not.toContain("02/10 às 10h30");
    expect(db.moves).toEqual([]);expect(codes()).toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
    // Backend only: the model contract of this turn is the one the run recorded (same prompt, wire, examples and flags).
    expect(db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome?: { contract_version?: string } }).outcome?.contract_version))
      .toEqual([CONTRACT_NOW]);
  });
  it("k2 then the owner's answer: Thursday 01/10 at 10h30, the clock already said is kept", async () => {
    const { model, say } = await session(K2);
    await say(MESSAGE);
    appendScriptedResponses(model, [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "a", choice: null, fields: { components: { date: { value: { kind: "RELATIVE_DAY",
      offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null }, literal: "amanhã" }, source_date: null, end_date: null, time: null, source_time: null, end_time: null } } }] } })]);
    const view = await say("amanhã");
    expect(action(view).status).toBe("READY_FOR_CONFIRMATION");expect(action(view).fields).toMatchObject({ date: "2026-10-01", time: "10:30" });
    expect(view.message).toContain("DEPOIS: qui, 01/10 às 10h30");
  });
  it("k1 (date sent) still passes: Thursday 01/10 at 10h30, ready to confirm", async () => {
    const view = await (await session(K1)).say(MESSAGE);
    expect(action(view).status).toBe("READY_FOR_CONFIRMATION");expect(action(view).fields).toMatchObject({ date: "2026-10-01", time: "10:30" });
    expect(view.message).toContain("DEPOIS: qui, 01/10 às 10h30");expect(db.moves).toEqual(["2026-10-01T10:30"]);expect(codes()).not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
  });
  it("the adapter of a one-action session (sendSchedulingTurn's call) asks too; a day linked by same_as is the link's", async () => {
    const quote = { field: "time" as const, text: "10h e meia", component: { hour: 10, minute: 30, daypart: "UNSPECIFIED" as const } };
    const state = { ...schedulingState(), operation: "appointment.change" as const };
    expect(await applySchedulingInterpretation(actor, state, { operation: "appointment.change", customer_name: "Rosa", temporal_evidence: [quote] }, MESSAGE, { single: true }))
      .toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
    expect(state.waiting_for).toBe("date");expect(state.proposal).toBeUndefined();expect(db.moves).toEqual([]);
    // "no mesmo dia" kept on purpose (D-SELF-ORIGIN): the origin's day is the owner's, nothing asked.
    const kept = { ...schedulingState(), operation: "appointment.change" as const, references: { origin: ["date" as const] } };
    expect(await applySchedulingInterpretation(actor, kept, { operation: "appointment.change", customer_name: "Rosa", temporal_evidence: [quote] }, MESSAGE, { single: true }))
      .not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
    expect(kept.fields).toMatchObject({ date: "2026-10-02", time: "10:30" });
  });
  it("flag off (SALON_SECRETARY_DATE_RULES_V2=false): the recorded failure, byte for byte the historical behaviour (Friday 02/10 proposed)", async () => {
    vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", "false");
    const view = await (await session(K2)).say(MESSAGE);
    expect(action(view).status).toBe("READY_FOR_CONFIRMATION");expect(action(view).fields).toMatchObject({ date: "2026-10-02", time: "10:30" });
    expect(view.message).toContain("DEPOIS: sex, 02/10 às 10h30");expect(codes()).not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
  });
});
