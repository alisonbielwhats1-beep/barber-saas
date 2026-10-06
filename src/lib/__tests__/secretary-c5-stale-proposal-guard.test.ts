import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 (flag SALON_SECRETARY_STALE_PROPOSAL_GUARD; C4 proof MV25 and MV40) through the real plan path (decoder, ActionPlan, per-action adapters,
 * journal drafts and proposals), in the fixture style of secretary-c4-rb2-rules-runtime.test.ts. Recorded frames only (no network, no model):
 * a lost interpretation is a recorded provider TimeoutError (the instrumented model reports MODEL_REQUEST_FAILED). Tenant lookups are fixtures
 * and a confirmed write is only recorded (db.writes). Today is Monday 28/09/2026 (São Paulo): "quinta" = 01/10. A nail studio with synthetic,
 * diverse names; no gender is ever inferred from a name (a pronoun is the owner's own word). */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], writes: [] as string[] }));
const plusHour = (local: string) => `${local.slice(0, 11)}${String(Number(local.slice(11, 13)) + 1).padStart(2, "0")}${local.slice(13)}`;
const SERVICES: Record<string, string> = { "s-gel": "Esmaltação em gel", "s-spa": "Spa dos pés" };
const TEAM = [{ id: "pro-zuleica", name: "Zuleica Amaral" }, { id: "pro-ravi", name: "Ravi Menon" }];
const CUSTOMERS: Record<string, { id: string; name: string }> = { kaua: { id: "c-kaua", name: "Kauã Ribeiro" }, mirela: { id: "c-mirela", name: "Mirela Sato" },
  obadias: { id: "c-obadias", name: "Obadias Nunes" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const teamName = (ref: unknown) => TEAM.find(row => row.id === ref)?.name ?? "Zuleica Amaral";
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) =>
    TEAM.filter(row => !filter.query || fold(row.name).startsWith(fold(filter.query).split(" ")[0])).map(row => ({ ...row })),
  schedulingSelfProfessional: async () => undefined,
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listSchedulingAppointments: async () => [],
  getSchedulingAppointment: async () => { throw Error("APPOINTMENT_NOT_FOUND"); } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown>) => {
    const time = f.time as string, date = f.date as string;
    return { customer_ref: f.customer_ref, customer_name: f.customer_name, service_ref: f.service_ref, service_revision: "1", service_name: SERVICES[f.service_ref as string] ?? f.service_name, professional_ref: f.professional_ref,
      professional_name: teamName(f.professional_ref), date, startLocal: `${date}T${time}`, endLocal: plusHour(`${date}T${time}`), timezone: "America/Sao_Paulo", priceCents: 6000, priceType: "FIXED", durationMin: 60, quote: "q" };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }),
  // A confirmed write is only recorded (its proposal ref): the tests count what would have been written.
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    db.writes.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: crypto.randomUUID() };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [], inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    // Only blocks reach it here (no move or cancellation in these conversations).
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse({ timezone: "America/Sao_Paulo", resource_ids: [],
      waiting_hash: "", affected: [], priceCents: 8000, kind: operation, professional_ref: f.professional_ref, professional_name: teamName(f.professional_ref), startLocal: `${f.date}T${f.time}`,
      endLocal: `${f.end_date ?? f.date}T${f.end_time}`, services: [], requires_acceptance: false, waiting_count: 0 }) };
});
import { SalonSecretary, staleProposalGuardEnabled, staleProposalNotice, unreadAnswerNotice, withdrawnHeldNotice, withdrawnProposalMessage, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { reviewRequiredMessage, type ActionPlan } from "@everflair/salon-secretary";

const FLAG = "SALON_SECRETARY_STALE_PROPOSAL_GUARD";
const actor = { salonId: "synthetic-nail-studio", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true"); vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "true");
  vi.stubEnv(FLAG, "true");
  Object.assign(db, { rows: [], writes: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const pair = (value: unknown, literal: string) => ({ value, literal });
const op = (item_key: string, operation: string, fields: Record<string, unknown> = {}) => ({ operation, item_key, depends_on: null, released_slot_of: null, same_as: null, source_scope: null,
  customer_name: null, service_name: null, professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null,
  source_weekday: null, source_time: null, end_time: null, end_date: null, reason: null, destination_mode: null, override_requested: null, override_reason: null, ...fields });
const plan = (...operations: unknown[]) => new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "NEW", operations } })]);
const answer = (tool: "select_capabilities" | "upsert_action_draft", turn: unknown) => new ScriptedServicesModel([call(tool, { turn })]);
/** A lost interpretation: the provider fails as a timeout. */
const lost = () => new ScriptedServicesModel([], undefined, { name: "TimeoutError", message: "synthetic timeout" });
/** One recorded model per interpretation of the conversation, in order; `multi` is the multi-action switch. */
async function conversation(models: ScriptedServicesModel[], message: string, multi = { enabled: true }) {
  const queue = [...models];
  const s = new SalonSecretary(async () => { const next = queue.shift(); if (!next) throw Error("NO_RECORDED_MODEL"); return next; }, () => "gpt-6-luna", undefined, {}, { enabled: () => multi.enabled });
  const { sessionId } = await s.start(actor, "auto");
  return { s, sessionId, first: await s.send(actor, { sessionId, message }),
    say: (text: string, operation_ref?: string) => s.send(actor, { sessionId, message: text, ...(operation_ref ? { operation_ref } : {}) }) };
}
const read = (view: SecretaryView) => ({
  action: (key: string) => view.action_plan!.actions.find(item => item.key === key)!,
  child: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state,
  card: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.operation_ref,
  ready: () => view.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION").flatMap(group => group.action_keys).sort(),
});
const approvals = (p: ActionPlan) => p.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }));
const approvalOf = (p: ActionPlan, key: string) => { const group = p.confirmation_groups.find(item => item.action_keys.includes(key))!;
  return { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }; };
const codes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").flatMap(row => (row.metadata as { outcome?: { divergence: { failed_codes: string[] } } | null }).outcome?.divergence.failed_codes ?? []);
type Stored = { actionPlan?: ActionPlan; conversationNotice?: string; scheduling?: { receipt?: unknown; proposal?: unknown } };
/** A session after a message that threw (the caller only receives the error): read from process memory, as the next call reads it. */
const stored = (s: SalonSecretary, id: string) => (s as unknown as { sessions: Map<string, Stored> }).sessions.get(id)!;
const shown = (s: SalonSecretary, id: string) => (s as unknown as { view(session: Stored): SecretaryView }).view(stored(s, id));

const BLOCK = "quinta fecha a agenda da Zuleica das 17h às 19h que ela tem curso";
const block = () => op("bloq", "schedule.block", { professional_name: "Zuleica", source_scope: BLOCK, weekday: pair(4, "quinta"), time: pair("17:00", "das 17h"),
  end_time: pair("19:00", "às 19h"), reason: "ela tem curso" });
const gelScope = (clock = "") => `e marca Kauã quinta ${clock ? `${clock} ` : ""}pra esmaltação em gel com a Zuleica`;
const gel = (time?: string, clock?: string) => op("gel", "appointment.create", { customer_name: "Kauã", service_name: "esmaltação em gel", professional_name: "Zuleica",
  source_scope: gelScope(clock), weekday: pair(4, "quinta"), ...(time && clock ? { time: pair(time, clock) } : {}) });
const SPA = "e Mirela quinta às 11h pro spa dos pés com Ravi";
const spa = () => op("spa", "appointment.create", { customer_name: "Mirela", service_name: "spa dos pés", professional_name: "Ravi", source_scope: SPA, weekday: pair(4, "quinta"),
  time: pair("11:00", "às 11h") });
/** The ready block and a booking still without its time (the only pending action: the next message is routed to it). */
const PENDING = `${BLOCK} ${gelScope()}`;
/** The ready block and a ready booking (two open actions: the next message is one interpretation over the plan). */
const READY = `${BLOCK} ${gelScope("às 15h")}`;
const WITHDRAW_BLOCK = "tira o bloqueio da Zuleica, o curso foi cancelado";
/** MV40: the second booking follows the first one's professional and day ("com ela também") and was made to depend on it. */
const MIRELA = "quinta marca Mirela às 10h pro spa dos pés com a Zuleica", OBADIAS = "e Obadias às 11h pro spa dos pés com ela também";
const linked = () => plan(op("mirela", "appointment.create", { customer_name: "Mirela", service_name: "spa dos pés", professional_name: "Zuleica", source_scope: MIRELA,
  weekday: pair(4, "quinta"), time: pair("10:00", "às 10h") }), op("obadias", "appointment.create", { customer_name: "Obadias", service_name: "spa dos pés", source_scope: OBADIAS,
  time: pair("11:00", "às 11h"), depends_on: ["mirela"], same_as: [{ field: "professional", item_key: "mirela", literal: "com ela também" }, { field: "date", item_key: "mirela", literal: "com ela também" }] }));
const withdrawMirela = () => answer("select_capabilities", { mode: "DISCARD", item_keys: ["mirela"] });
const DISCARD_QUESTION = "Quer que eu descarte os dois? Nada foi alterado.";

describe("C5 stale-proposal guard, MV25: an owner message on the active plan that could not be applied", () => {
  it("the answer routed to the pending booking is lost (timeout): the ready block leaves confirmation and the reply says nothing was written", async () => {
    const c = await conversation([plan(block(), gel()), lost()], PENDING);
    expect(read(c.first).action("bloq").status).toBe("READY_FOR_CONFIRMATION"); expect(read(c.first).action("gel").missing_fields).toContain("time");
    const draft = read(c.first).child("bloq").scheduling!.draft;
    const view = await c.say(WITHDRAW_BLOCK), r = read(view);
    expect(r.action("gel").status).toBe("FAILED_SAFE");
    expect(r.action("bloq")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: [], assessment: { issue: "REVIEW_REQUIRED" } });
    expect(r.ready()).toEqual([]);
    // Withdrawn, never rewritten: the accepted draft stays for when the owner restates or keeps it.
    expect(r.child("bloq").scheduling!.proposal).toBeUndefined(); expect(r.child("bloq").scheduling!.draft).toEqual(draft);
    expect(view.turn_notice).toBe(staleProposalNotice); expect(view.message.startsWith(`${staleProposalNotice}\n\n`)).toBe(true);
    expect(view.action_plan!.revision).toBeGreaterThan(c.first.action_plan!.revision);
    expect(codes()).toContain("STALE_PROPOSAL_HELD");
    // "Confirmar": the approval shown before the lost message is stale; the held block is in no confirmable group.
    await expect(c.s.confirmReadyGroups(actor, c.sessionId, approvals(c.first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    await expect(c.s.confirmActionPlanGroup(actor, c.sessionId, approvalOf(view.action_plan!, "bloq"))).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });
  it("the held block is confirmable again only after it is prepared and shown again (the owner restates it)", async () => {
    const restated = { mode: "PATCH", operations: [{ item_key: "bloq", choice: null, fields: { operation: null, time: pair("17:00", "das 17h"), end_time: pair("19:00", "às 19h") } }] };
    const c = await conversation([plan(block(), gel()), lost(), answer("upsert_action_draft", restated)], PENDING);
    expect(read(await c.say(WITHDRAW_BLOCK)).ready()).toEqual([]);
    const again = await c.say("pode manter o bloqueio da Zuleica das 17h às 19h, o curso continua"), r = read(again);
    expect(r.action("bloq").status).toBe("READY_FOR_CONFIRMATION"); expect(r.ready()).toEqual(["bloq"]);
    expect(again.turn_notice).toBeUndefined(); expect(db.writes).toEqual([]);
    const done = await c.s.confirmReadyGroups(actor, c.sessionId, approvals(again.action_plan!));
    expect(done.confirmation_batch!.executed).toHaveLength(1); expect(db.writes).toHaveLength(1);
  });
  it("C5 review: a second lost answer on a card that had already failed (same assessment) still holds the other ready proposal", async () => {
    const restated = { mode: "PATCH", operations: [{ item_key: "bloq", choice: null, fields: { operation: null, time: pair("17:00", "das 17h"), end_time: pair("19:00", "às 19h") } }] };
    const c = await conversation([plan(block(), gel()), lost(), answer("upsert_action_draft", restated), lost()], PENDING);
    await c.say(WITHDRAW_BLOCK);
    const kept = await c.say("pode manter o bloqueio da Zuleica das 17h às 19h, o curso continua"), before = read(kept);
    expect(before.action("gel").status).toBe("FAILED_SAFE"); expect(before.ready()).toEqual(["bloq"]);
    const gelAssessment = before.action("gel").assessment, heldBefore = codes().filter(code => code === "STALE_PROPOSAL_HELD").length;
    // The answer on the failed booking's card also moves the block; the provider times out again and nothing of it is applied.
    const view = await c.say("Kauã às 16h e o bloqueio da Zuleica passa pras 18h", before.card("gel")), r = read(view);
    // The assessment is exactly the one before (a diff of assessments sees no failure): the failure is recorded per message.
    expect(r.action("gel").status).toBe("FAILED_SAFE"); expect(r.action("gel").assessment).toEqual(gelAssessment);
    expect(r.action("bloq")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } }); expect(r.ready()).toEqual([]);
    expect(view.turn_notice).toBe(staleProposalNotice); expect(codes().filter(code => code === "STALE_PROPOSAL_HELD")).toHaveLength(heldBefore + 1);
    await expect(c.s.confirmReadyGroups(actor, c.sessionId, approvals(kept.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.writes).toEqual([]);
  });
  it("adversarial: a lost answer on the failed card while nothing else is ready holds nothing more and adds no notice", async () => {
    const c = await conversation([plan(block(), gel()), lost(), lost()], PENDING);
    const first = await c.say(WITHDRAW_BLOCK), heldBefore = codes().filter(code => code === "STALE_PROPOSAL_HELD").length;
    expect(read(first).ready()).toEqual([]);
    const view = await c.say("Kauã às 16h", read(first).card("gel")), r = read(view);
    expect(r.action("gel").status).toBe("FAILED_SAFE"); expect(r.action("bloq").assessment.issue).toBe("REVIEW_REQUIRED");
    expect(r.ready()).toEqual([]); expect(view.turn_notice).toBeUndefined();
    expect(codes().filter(code => code === "STALE_PROPOSAL_HELD")).toHaveLength(heldBefore);
    expect(db.writes).toEqual([]);
  });
  it("an answer that cannot be read while two proposals are ready: both leave confirmation and the reply is only the notice", async () => {
    // The plan-wide continuation answered with an adapter's tool: an unreadable answer (B5), nothing of the message applied.
    const c = await conversation([plan(block(), gel("15:00", "às 15h")), answer("upsert_action_draft", { mode: "CONVERSATION", response: "Certo." })], READY);
    expect(read(c.first).ready()).toEqual(["bloq", "gel"]);
    const view = await c.say("tira o bloqueio e muda Kauã pras 16h"), r = read(view);
    for (const key of ["bloq", "gel"]) expect(r.action(key)).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
    expect(r.ready()).toEqual([]);
    expect(view.message).toBe(staleProposalNotice); expect(view.turn_notice).toBe(staleProposalNotice); expect(view.turn_notice_alone).toBe(true);
    await expect(c.s.confirmReadyGroups(actor, c.sessionId, approvals(c.first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.writes).toEqual([]);
  });
  it("a message that throws while answering one card (the multi-action switch turned off meanwhile) holds the other ready proposal; the plan says why", async () => {
    const multi = { enabled: true }, c = await conversation([plan(block(), gel("15:00", "às 15h"))], READY, multi);
    multi.enabled = false;
    await expect(c.say("muda Kauã pras 16h", read(c.first).card("gel"))).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
    multi.enabled = true;
    const p = stored(c.s, c.sessionId).actionPlan!, action = (key: string) => p.actions.find(item => item.key === key)!;
    expect(action("gel").status).toBe("FAILED_SAFE");
    expect(action("bloq")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
    expect(p.confirmation_groups.some(group => group.status === "READY_FOR_CONFIRMATION")).toBe(false);
    expect(stored(c.s, c.sessionId).conversationNotice!.startsWith(`${staleProposalNotice}\n\n`)).toBe(true);
    expect(shown(c.s, c.sessionId).message.startsWith(`${staleProposalNotice}\n\n`)).toBe(true);
    expect(codes()).toContain("STALE_PROPOSAL_HELD");
    await expect(c.s.confirmReadyGroups(actor, c.sessionId, approvals(c.first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.writes).toEqual([]);
  });
  it("adversarial: a failure inside the guard never replaces the message's own error", async () => {
    const multi = { enabled: true }, c = await conversation([plan(block(), gel("15:00", "às 15h"))], READY, multi);
    vi.spyOn(c.s as unknown as { holdForReview(parent: unknown, keys: readonly string[]): void }, "holdForReview").mockImplementation(() => { throw Error("SYNTHETIC_GUARD_FAILURE"); });
    multi.enabled = false;
    await expect(c.say("muda Kauã pras 16h", read(c.first).card("gel"))).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
    expect(db.writes).toEqual([]);
  });
  it("adversarial: a confirmed action and its receipt are never touched by a failed message; only the open ready proposal is held", async () => {
    const multi = { enabled: true }, c = await conversation([plan(block(), gel("15:00", "às 15h"), spa())], `${READY} ${SPA}`, multi);
    expect(read(c.first).ready()).toEqual(["bloq", "gel", "spa"]);
    const confirmed = await c.s.confirmActionPlanGroup(actor, c.sessionId, approvalOf(c.first.action_plan!, "bloq"));
    expect(read(confirmed).action("bloq").status).toBe("DONE"); expect(db.writes).toHaveLength(1);
    multi.enabled = false;
    await expect(c.say("muda Kauã pras 16h", read(c.first).card("gel"))).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
    multi.enabled = true;
    const p = stored(c.s, c.sessionId).actionPlan!, action = (key: string) => p.actions.find(item => item.key === key)!;
    expect(action("bloq").status).toBe("DONE"); expect(stored(c.s, read(c.first).card("bloq")).scheduling!.receipt).toBeDefined();
    expect(action("gel").status).toBe("FAILED_SAFE");
    expect(action("spa")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
    expect(db.writes).toHaveLength(1);
  });
  it("adversarial: a message that is applied (the pending time, answered) keeps the other proposal ready and confirmable", async () => {
    const c = await conversation([plan(block(), gel())], PENDING);
    const view = await c.say("16h"), r = read(view);
    expect(r.action("gel").status).toBe("READY_FOR_CONFIRMATION"); expect(r.action("bloq").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.ready()).toEqual(["bloq", "gel"]); expect(view.turn_notice).toBeUndefined(); expect(codes()).not.toContain("STALE_PROPOSAL_HELD");
    const done = await c.s.confirmReadyGroups(actor, c.sessionId, approvals(view.action_plan!));
    expect(done.confirmation_batch!.executed).toHaveLength(2); expect(db.writes).toHaveLength(2);
  });
  it("adversarial: casual conversation on a ready plan is a read answer, not a lost one: nothing is held", async () => {
    const c = await conversation([plan(block(), gel("15:00", "às 15h")), answer("select_capabilities", { mode: "CONVERSATION", response: "Combinado." })], READY);
    const view = await c.say("valeu, depois eu vejo"), r = read(view);
    expect(view.capability_status).toBe("CONVERSATION");
    for (const key of ["bloq", "gel"]) expect(r.action(key).status).toBe("READY_FOR_CONFIRMATION");
    expect(view.action_plan!.actions.some(action => action.assessment.issue === "REVIEW_REQUIRED")).toBe(false);
    expect(view.turn_notice).toBeUndefined(); expect(codes()).not.toContain("STALE_PROPOSAL_HELD");
  });
});

describe("C5 stale-proposal guard, MV40: an item the owner withdraws while another one depends on it", () => {
  it("the withdrawn item leaves confirmation at once while the linked one is asked; 'sim, os dois' then discards both and nothing is written", async () => {
    // C5 review: with no card the answer goes to the whole plan (select_capabilities), as with the flag off; never the withdrawn item's card.
    const c = await conversation([linked(), withdrawMirela(), answer("select_capabilities", { mode: "DISCARD", item_keys: ["mirela", "obadias"] })], `${MIRELA} ${OBADIAS}`);
    expect(read(c.first).ready()).toEqual(["mirela", "obadias"]);
    const asked = await c.say("tira Mirela, ela desmarcou"), r = read(asked);
    expect(asked.message).toContain(DISCARD_QUESTION);
    expect(r.action("mirela")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
    expect(r.child("mirela").scheduling!.proposal).toBeUndefined();
    // C5 review: its own copy on the plan and on its card, never the review copy that invites keeping it ("repita ... ou diga que mantém").
    expect(r.action("mirela").assessment.preview).toBe(withdrawnProposalMessage); expect(r.child("mirela").message).toBe(withdrawnProposalMessage);
    expect(asked.message).not.toContain(reviewRequiredMessage); expect(asked.message).not.toContain("Envie a correção novamente");
    // Only the linked booking is asked about: it keeps its proposal, but no group holding the withdrawn item is confirmable.
    expect(r.action("obadias").status).not.toBe("DISCARDED"); expect(r.child("obadias").scheduling!.proposal).toBeDefined();
    expect(r.ready()).toEqual([]); expect(codes()).toContain("WITHDRAWN_PROPOSAL_HELD");
    await expect(c.s.confirmReadyGroups(actor, c.sessionId, approvals(c.first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    await expect(c.s.confirmActionPlanGroup(actor, c.sessionId, approvalOf(asked.action_plan!, "mirela"))).rejects.toThrow();
    const done = await c.say("sim, pode descartar os dois");
    expect(done.action_plan).toBeUndefined();
    expect(done.retired_plan!.actions.map(action => [action.key, action.status])).toEqual([["mirela", "DISCARDED"], ["obadias", "DISCARDED"]]);
    expect(db.writes).toEqual([]);
  });
  it("adversarial: a lost answer to that question never brings the withdrawn item back, and the linked proposal leaves confirmation too", async () => {
    // C5 review: the whole plan's interpretation is lost (as with the flag off, the message throws): the withdrawn item fails safe and its
    // dependent is blocked by that dependency (action-plan.ts: a FAILED_SAFE parent blocks its children); nothing is confirmable.
    const c = await conversation([linked(), withdrawMirela(), lost()], `${MIRELA} ${OBADIAS}`);
    const asked = await c.say("tira Mirela, ela desmarcou");
    await expect(c.say("sim, os dois")).rejects.toThrow();
    const p = stored(c.s, c.sessionId).actionPlan!, action = (key: string) => p.actions.find(item => item.key === key)!;
    expect(action("mirela").status).toBe("FAILED_SAFE"); expect(action("obadias").status).toBe("BLOCKED_BY_DEPENDENCY");
    expect(p.confirmation_groups.some(group => group.status === "READY_FOR_CONFIRMATION")).toBe(false);
    for (const key of ["mirela", "obadias"]) expect(stored(c.s, read(asked).card(key)).scheduling!.proposal).toBeUndefined();
    await expect(c.s.confirmReadyGroups(actor, c.sessionId, approvals(c.first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.writes).toEqual([]);
  });
  it("adversarial (C5 review): with no card, a keep read by the whole plan while the question is pending never makes the withdrawn item confirmable", async () => {
    const keep = { mode: "PATCH", operations: [{ item_key: "mirela", choice: null, fields: { operation: null, time: pair("10:00", "às 10h") } }] };
    const c = await conversation([linked(), withdrawMirela(), answer("select_capabilities", keep)], `${MIRELA} ${OBADIAS}`);
    await c.say("tira Mirela, ela desmarcou");
    const view = await c.say("não, mantém a Mirela às 10h"), r = read(view);
    expect(r.action("mirela")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED", preview: withdrawnProposalMessage } });
    expect(r.child("mirela").scheduling!.proposal).toBeUndefined(); expect(r.ready()).toEqual([]);
    expect(view.turn_notice).toBe(withdrawnHeldNotice); expect(view.message).not.toContain(reviewRequiredMessage);
    expect(db.writes).toEqual([]);
  });
  it("adversarial (C5 review): a keep on the withdrawn item's own card while the question is pending is held; once the question is over it can be kept", async () => {
    const keep = { mode: "PATCH", operations: [{ item_key: "mirela", choice: null, fields: { operation: null, time: pair("10:00", "às 10h") } }] };
    const c = await conversation([linked(), withdrawMirela(), answer("upsert_action_draft", keep), answer("upsert_action_draft", keep)], `${MIRELA} ${OBADIAS}`);
    const asked = await c.say("tira Mirela, ela desmarcou"), card = read(asked).card("mirela");
    const view = await c.say("não, mantém a Mirela às 10h", card), r = read(view);
    expect(r.action("mirela")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED", preview: withdrawnProposalMessage } });
    expect(r.child("mirela").scheduling!.proposal).toBeUndefined(); expect(r.ready()).toEqual([]);
    expect(view.turn_notice).toBe(withdrawnHeldNotice); expect(codes()).toContain("WITHDRAWN_PROPOSAL_HELD");
    await expect(c.s.confirmReadyGroups(actor, c.sessionId, approvals(c.first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    // The question is over: keeping it now prepares it again, and it is shown before any confirmation.
    const again = await c.say("pode manter a Mirela às 10h", card), r2 = read(again);
    expect(r2.action("mirela").status).toBe("READY_FOR_CONFIRMATION"); expect(r2.child("mirela").scheduling!.proposal).toBeDefined();
    expect(again.turn_notice).toBeUndefined(); expect(db.writes).toEqual([]);
  });
  it("the screen's discard button withdraws at once too; the linked set it then accepts discards both, nothing written", async () => {
    const c = await conversation([linked()], `${MIRELA} ${OBADIAS}`), plan_ref = c.first.action_plan!.plan_ref;
    const asked = await c.s.discardAction(actor, c.sessionId, { plan_ref, action_key: "mirela" }), r = read(asked);
    expect(asked.message).toContain(DISCARD_QUESTION);
    expect(r.action("mirela").assessment.issue).toBe("REVIEW_REQUIRED"); expect(r.ready()).toEqual([]);
    const done = await c.s.discardAction(actor, c.sessionId, { plan_ref, action_key: "mirela", linked: ["obadias"] });
    expect(done.retired_plan!.actions.every(action => action.status === "DISCARDED")).toBe(true);
    expect(db.writes).toEqual([]);
  });
  it("adversarial: withdrawing an item nothing depends on discards it directly (nothing held, nothing asked); the other stays confirmable", async () => {
    const c = await conversation([linked()], `${MIRELA} ${OBADIAS}`);
    const view = await c.s.discardAction(actor, c.sessionId, { plan_ref: c.first.action_plan!.plan_ref, action_key: "obadias" }), r = read(view);
    expect(r.action("obadias").status).toBe("DISCARDED"); expect(r.action("mirela").status).toBe("READY_FOR_CONFIRMATION");
    expect(view.message).not.toContain(DISCARD_QUESTION); expect(r.ready()).toEqual(["mirela"]);
    expect(view.action_plan!.actions.some(action => action.assessment.issue === "REVIEW_REQUIRED")).toBe(false);
  });
});

describe("flag off (default): the historical behaviour", () => {
  beforeEach(() => { vi.stubEnv(FLAG, undefined); });
  it("MV25: after the lost answer the block stays ready and a confirmation writes it (the wrong write this flag closes)", async () => {
    const c = await conversation([plan(block(), gel()), lost()], PENDING);
    const view = await c.say(WITHDRAW_BLOCK), r = read(view);
    expect(r.action("gel").status).toBe("FAILED_SAFE"); expect(r.action("bloq").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.ready()).toEqual(["bloq"]); expect(view.turn_notice).toBeUndefined(); expect(view.message).not.toContain(staleProposalNotice);
    expect(codes()).not.toContain("STALE_PROPOSAL_HELD");
    await c.s.confirmReadyGroups(actor, c.sessionId, approvals(view.action_plan!));
    expect(db.writes).toHaveLength(1);
  });
  it("an unreadable answer keeps both proposals ready behind the moved revision (B5 as before)", async () => {
    const c = await conversation([plan(block(), gel("15:00", "às 15h")), answer("upsert_action_draft", { mode: "CONVERSATION", response: "Certo." })], READY);
    const view = await c.say("tira o bloqueio e muda Kauã pras 16h"), r = read(view);
    expect(view.message).toBe(unreadAnswerNotice); expect(r.ready()).toEqual(["bloq", "gel"]);
    expect(view.action_plan!.revision).toBeGreaterThan(c.first.action_plan!.revision);
  });
  it("MV40: the withdrawn item stays ready while its dependent is asked, and a confirmation writes it (the wrong write this flag closes)", async () => {
    const c = await conversation([linked(), withdrawMirela()], `${MIRELA} ${OBADIAS}`);
    const asked = await c.say("tira Mirela, ela desmarcou"), r = read(asked);
    expect(asked.message).toContain(DISCARD_QUESTION);
    expect(r.action("mirela").status).toBe("READY_FOR_CONFIRMATION"); expect(r.ready()).toEqual(["mirela", "obadias"]);
    expect(codes()).not.toContain("WITHDRAWN_PROPOSAL_HELD");
    await c.s.confirmReadyGroups(actor, c.sessionId, approvals(asked.action_plan!));
    expect(db.writes).toHaveLength(2);
  });
  it("MV40: the answer to the discard question is read by the whole plan (the routing the flag keeps); no withdrawn copy, no hold", async () => {
    const c = await conversation([linked(), withdrawMirela(), answer("select_capabilities", { mode: "DISCARD", item_keys: ["mirela", "obadias"] })], `${MIRELA} ${OBADIAS}`);
    const asked = await c.say("tira Mirela, ela desmarcou");
    expect(asked.message).not.toContain(withdrawnProposalMessage); expect(read(asked).action("mirela").assessment.preview).not.toBe(withdrawnProposalMessage);
    const done = await c.say("sim, pode descartar os dois");
    expect(done.retired_plan!.actions.map(action => [action.key, action.status])).toEqual([["mirela", "DISCARDED"], ["obadias", "DISCARDED"]]);
    expect(done.turn_notice).toBeUndefined(); expect(db.writes).toEqual([]);
  });
  it("MV25: a second lost answer on the failed card records nothing for the guard and holds nothing", async () => {
    const c = await conversation([plan(block(), gel()), lost(), lost()], PENDING);
    const first = await c.say(WITHDRAW_BLOCK);
    const view = await c.say("Kauã às 16h", read(first).card("gel")), r = read(view);
    expect(r.action("gel").status).toBe("FAILED_SAFE"); expect(r.action("bloq").status).toBe("READY_FOR_CONFIRMATION");
    expect(view.turn_notice).toBeUndefined(); expect(codes()).not.toContain("STALE_PROPOSAL_HELD");
  });
});

describe("flag", () => {
  it("only the exact value 'true' turns the guard on; unset or anything else is off (fail-safe default)", () => {
    expect(staleProposalGuardEnabled()).toBe(true);
    for (const value of [undefined, "", "1", "TRUE", "yes", "on"]) { vi.stubEnv(FLAG, value); expect(staleProposalGuardEnabled()).toBe(false); }
  });
});
