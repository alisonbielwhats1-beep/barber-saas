import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Owner decision of 03/10/2026 (flag SALON_SECRETARY_CANCEL_REASON_OPTIONAL, default off): a cancellation never waits for a
 * reason. Through the real plan path (decoder, ActionPlan, adapters, journal drafts/proposals) with scripted frames: tenant
 * lookups are fixtures, no DB, no network. Flag off, everything stays as recorded (asked, mandatory wording). */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingProfessionals: async () => [], getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: "2026-10-01T15:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /iara/i.test(name) ? [{ id: "c-iara", name: "Iara Bittencourt" }] : [] }));
const confirmed = vi.hoisted(() => ({ refs: [] as string[] }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    confirmed.refs.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: "a-iara" };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => f.customer_ref === "c-iara" ? [{ appointment_ref: "a-iara" }] : [],
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string) => original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: "a-iara",
      revision: 1, customer_ref: "c-iara", customer_name: "Iara Bittencourt", professional_ref: "pro-lis", professional_name: "Lis Moura", before_start: "2026-10-01T15:00",
      before_end: "2026-10-01T16:00", before_timezone: "America/Sao_Paulo", startLocal: "2026-10-01T15:00", endLocal: "2026-10-01T16:00", priceCents: 9000 }) };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { batchRequirements, schedulingRequirements } from "../scheduling-contract";
import { askedSourceFields } from "../scheduling-literal-source";
import { actionSnapshot, schedulingActionPreview } from "../scheduling-mutations";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { AGENT_PROMPT, agentInstructions } from "../../../packages/salon-secretary/src/agent-prompt";
import { asksCancelReason, CANCEL_REASON_AGENT_EDIT, CANCEL_REASON_MANUAL_EDIT, withOptionalCancelReason } from "../../../packages/salon-secretary/src/cancel-reason";
import { exampleBank } from "../../../packages/salon-secretary/src/examples/bank";
import { eligibleExamples, type ExamplesState } from "../../../packages/salon-secretary/src/examples/select";
import { loadSkills, secretaryContractParts, schedulingSkill } from "@everflair/salon-secretary";

const FLAG = "SALON_SECRETARY_CANCEL_REASON_OPTIONAL";
const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = []; confirmed.refs = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const cancel = (message: string, reason: string | null = null) => ({ operation: "appointment.cancel", item_key: "cancelar_iara", depends_on: null, released_slot_of: null,
  source_scope: message, customer_name: "Iara", service_name: null, professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null,
  source_date: null, source_day_offset: null, source_weekday: null, source_time: null, end_time: null, end_date: null, reason });
async function run(message: string, reason: string | null = null) {
  const model = new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "NEW", operations: [cancel(message, reason)] } })]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const view = await secretary.send(actor, { sessionId: session.sessionId, message });
  const child = view.operations!.find(item => item.action_keys?.includes("cancelar_iara"))!.state as SecretaryView;
  return { view, secretary, sessionId: session.sessionId, action: view.action_plan!.actions.find(item => item.key === "cancelar_iara")!, scheduling: child.scheduling! };
}

describe("flag off: the historical behaviour, byte for byte", () => {
  it("requirements, batch contract, manual, agent prompt and pending fields are the recorded ones", () => {
    expect(schedulingRequirements("appointment.cancel").required_fields).toEqual(["appointment_ref", "reason"]);
    expect(batchRequirements().reason_required).toBe(true);
    const manual = loadSkills({ skill_ids: ["scheduling"] }).manuals[0].manual;
    expect(manual).toBe(schedulingSkill); expect(manual).toContain(CANCEL_REASON_MANUAL_EDIT[0]);
    expect(agentInstructions()).toBe(AGENT_PROMPT); expect(AGENT_PROMPT).toContain(CANCEL_REASON_AGENT_EDIT[0]);
    expect(askedSourceFields(["reason", "override_reason"])).toEqual(["reason", "override_reason"]);
    expect(secretaryContractParts().flags).not.toHaveProperty("cancelReasonOptional");
  });
  it("a cancellation without a reason still waits for it", async () => {
    const r = await run("cancela o horário da Iara");
    expect(r.action).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
    expect(r.scheduling.proposal).toBeUndefined();
  });
});

describe("flag on: the Secretária never asks for a cancellation reason", () => {
  beforeEach(() => { vi.stubEnv(FLAG, "true"); });
  it("only the appointment is required; the batch no longer requires a reason; the encaixe reason stays pending", () => {
    expect(schedulingRequirements("appointment.cancel").required_fields).toEqual(["appointment_ref"]);
    expect(batchRequirements().reason_required).toBe(false);
    expect(askedSourceFields(["reason", "override_reason"])).toEqual(["override_reason"]);
    expect(secretaryContractParts().flags).toMatchObject({ cancelReasonOptional: true });
  });
  it("T14 and the agent sentence say the reason is optional; nothing else in either text changes", () => {
    const manual = loadSkills({ skill_ids: ["scheduling"] }).manuals[0].manual;
    expect(manual).toContain(CANCEL_REASON_MANUAL_EDIT[1]); expect(manual).not.toContain("motivo real obrigatório");
    expect(manual.replace(CANCEL_REASON_MANUAL_EDIT[1], CANCEL_REASON_MANUAL_EDIT[0])).toBe(schedulingSkill);
    expect(agentInstructions()).toContain(CANCEL_REASON_AGENT_EDIT[1]); expect(agentInstructions()).not.toContain("e então o backend pergunta");
    expect(agentInstructions().replace(CANCEL_REASON_AGENT_EDIT[1], CANCEL_REASON_AGENT_EDIT[0])).toBe(AGENT_PROMPT);
    expect(() => withOptionalCancelReason("texto sem o alvo", CANCEL_REASON_MANUAL_EDIT)).toThrow("INSTRUCTION_REPLACE_TARGET_MISSING");
  });
  it("a cancellation without a reason is ready to confirm, with no question and no Motivo line", async () => {
    const r = await run("cancela o horário da Iara");
    expect(r.action.status).toBe("READY_FOR_CONFIRMATION"); expect(r.action.missing_fields).toEqual([]);
    expect(r.view.message).not.toMatch(/motivo/i);
    expect(r.scheduling.fields.reason).toBeUndefined();
    expect(r.scheduling.proposal!.preview).not.toContain("Motivo");
    // Confirmar still executes only on the authenticated click, with the current approval.
    const approvals = r.view.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
      .map(group => ({ plan_ref: r.view.action_plan!.plan_ref, revision: r.view.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint }));
    expect(confirmed.refs).toEqual([]);
    await r.secretary.confirmReadyGroups(actor, r.sessionId, approvals);
    expect(confirmed.refs).toEqual([r.scheduling.proposal!.proposal_ref]);
  });
  it("a reason the owner says is still recorded literally and shown on the proposal", async () => {
    const r = await run("cancela o horário da Iara porque ela viajou", "ela viajou");
    expect(r.action.status).toBe("READY_FOR_CONFIRMATION");
    expect(r.scheduling.fields.reason).toBe("ela viajou");
    expect(r.scheduling.proposal!.preview).toContain("Motivo: ela viajou");
  });
  it("with the local demo's candidate flags too (c4pair, without the DB-backed persisted state)", async () => {
    for (const [name, value] of Object.entries({ SALON_SECRETARY_TEMPORAL_COMPONENTS: "true", SALON_SECRETARY_TEMPORAL_POLARITY: "true", SALON_SECRETARY_SAME_AS: "true",
      SALON_SECRETARY_JIT_INSTRUCTIONS: "true", SALON_SECRETARY_STRUCTURED_CONTEXT: "true", SALON_SECRETARY_NAME_SUGGESTIONS: "true", SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: "true",
      SALON_SECRETARY_EXAMPLES: "selected", SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: "true", SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: "true", SALON_SECRETARY_DATE_RULES_V2: "true",
      SALON_SECRETARY_DAYPART_RULES_V2: "true", SALON_SECRETARY_DAYPART_BY_HOURS: "true", SALON_SECRETARY_ALTER_APPOINTMENT: "true", SALON_SECRETARY_MULTI_SERVICE: "true",
      SALON_SECRETARY_EXCEPTION_RULES_V2: "true", SALON_SECRETARY_COPY_V2: "true", SALON_SECRETARY_REFERENCES_V2: "true", SALON_SECRETARY_READS_V2: "true",
      SALON_SECRETARY_RECURRENCE_GUARD: "true", SALON_SECRETARY_EXAMPLES_V2: "true", SALON_SECRETARY_COMBO_GUARD: "true", SALON_SECRETARY_BLOCK_OVERLAP_GUARD: "true",
      SALON_SECRETARY_STALE_PROPOSAL_GUARD: "true", SALON_SECRETARY_WHOLE_NAME_MATCH: "true", SALON_SECRETARY_PROMPT_CACHE: "true", SALON_SECRETARY_DAYPART_ASK_WIDE: "true" })) vi.stubEnv(name, value);
    const r = await run("cancela o horário da Iara");
    expect(r.action.status).toBe("READY_FOR_CONFIRMATION"); expect(r.view.message).not.toMatch(/motivo/i);
    expect(r.scheduling.proposal!.preview).not.toContain("Motivo");
  });
  it("a reason the message does not say is dropped: never stored, never asked", async () => {
    const r = await run("cancela o horário da Iara", "problema de saúde");
    expect(r.action.status).toBe("READY_FOR_CONFIRMATION");
    expect(r.scheduling.fields.reason).toBeUndefined(); expect(r.scheduling.source_missing ?? []).toEqual([]);
    expect(r.view.message).not.toMatch(/motivo/i);
  });
});

describe("examples and previews", () => {
  const TEACH_ASKING = ["M014", "R018", "R019", "R020", "R021", "R022", "R023", "R054", "R056", "R057", "R058", "R059", "R060", "R061", "R062", "S046", "S047"];
  it("the bank entries that wait for a cancellation reason are exactly the ones the flag withholds", () => {
    expect(exampleBank().examples.filter(example => asksCancelReason(example.state)).map(example => example.id).sort()).toEqual(TEACH_ASKING);
  });
  it.each(["ANSWER", "PLAN"] as const)("%s states: served with the flag off, withheld with it on", kind => {
    const state: ExamplesState = { kind, pending: kind === "ANSWER" ? 1 : 0, operations: ["appointment.cancel"], fields: [], modes: new Set(["NEW", "ADD", "PATCH", "DISCARD", "CONVERSATION", "UNSUPPORTED", "AMBIGUOUS"]) };
    const off = eligibleExamples(state).map(example => example.id);
    expect(off.filter(id => TEACH_ASKING.includes(id)).length).toBeGreaterThan(0);
    vi.stubEnv(FLAG, "true");
    const on = eligibleExamples(state).map(example => example.id);
    expect(on.filter(id => TEACH_ASKING.includes(id))).toEqual([]);
    expect(on).toEqual(off.filter(id => !TEACH_ASKING.includes(id)));
  });
  it("a cancellation preview shows the Motivo line only when there is a reason (same text as before when there is)", () => {
    const snapshot = actionSnapshot.parse({ kind: "appointment.cancel", timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "",
      requires_acceptance: false, affected: [], appointment_ref: "a-iara", revision: 1, customer_ref: "c-iara", customer_name: "Iara Bittencourt", professional_ref: "pro-lis",
      professional_name: "Lis Moura", before_start: "2026-10-01T15:00", before_end: "2026-10-01T16:00", before_timezone: "America/Sao_Paulo", startLocal: "2026-10-01T15:00",
      endLocal: "2026-10-01T16:00", priceCents: 9000 });
    const without = schedulingActionPreview(snapshot), said = schedulingActionPreview(snapshot, "ela viajou");
    expect(without).not.toContain("Motivo"); expect(without).toContain("Lista de espera: ninguém.");
    expect(said).toBe(without.replace("\nLista de espera", "\nMotivo: ela viajou\nLista de espera"));
  });
});
