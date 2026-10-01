import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 agent, WP7 (docs/c5-spike/11-especificacao-agente.md §8.4): SALON_SECRETARY_AGENT off keeps the Secretária exactly as it was (no message
 * context, no lookup executor, the same C4 request); on, a message on an active plan still goes to the C4 with a byte-identical request body
 * (the flag never enters the C4 wire), only now under the message's call counter and deadline; and two tenants' messages at the same time
 * never share a context, an executor or a ref. Recorded frames only (no network, no model); tenant lookups are fixtures (the fixture style of
 * secretary-c5-stale-proposal-guard.test.ts). Synthetic tenants and texts; no name of any evaluation set. */
type Seen = { purpose: string; context: boolean; used: number | undefined };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], executors: [] as { salonId: string }[], seen: [] as Seen[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async () => [], listSchedulingProfessionals: async () => [], schedulingSelfProfessional: async () => undefined,
  listSchedulingAppointments: async () => [], listUpcomingCustomerAppointments: async () => [],
  getSchedulingAppointment: async () => { throw Error("APPOINTMENT_NOT_FOUND"); } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined, searchSalonCustomer: async () => [] }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [] }));
// Each model call's usage STARTED event (persisted before dispatch) records whether it ran inside the agent's message context and how many of
// the message's calls were taken by then. Nothing is written.
vi.mock("../salon-secretary-usage", async importOriginal => ({ ...await importOriginal<object>(),
  usageRecorder: () => async (event: { status: string; purpose: string }) => {
    if (event.status !== "STARTED") return;
    const { agentMessage } = await import("../../../packages/salon-secretary/src/agent-context"), context = agentMessage();
    db.seen.push({ purpose: event.purpose, context: !!context, used: context?.calls.used() });
  } }));
// The executor of each message is recorded (the tenant it closes over); it never reads anything here.
vi.mock("../secretary-agent-lookups", async importOriginal => ({ ...await importOriginal<object>(),
  createAgentLookupExecutor: (actor: { salonId: string }) => { db.executors.push({ salonId: actor.salonId });
    return { directory: async () => ({ ok: false, code: "AGENT_UNAVAILABLE" }), round: async () => [] }; } }));
import { SalonSecretary } from "../salon-secretary";
import { agentMessageScope } from "../secretary-agent-apply";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { agentMessage } from "../../../packages/salon-secretary/src/agent-context";
import { AGENT_PLAN_PARAMETERS, AGENT_PLAN_TOOL } from "../../../packages/salon-secretary/src/agent-plan";
import { AGENT_PROMPT_BASES } from "../../../packages/salon-secretary/src/agent-prompt";
import type { Model, ModelRequest } from "@everflair/salon-secretary";

const FLAG = "SALON_SECRETARY_AGENT";
const actor = { salonId: "synthetic-flag-studio", userId: "synthetic-flag-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2031-03-10T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  Object.assign(db, { rows: [], executors: [], seen: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** One read with nothing said: the plan asks its day (an active plan with one open action). */
const read = { operation: "appointment.list", item_key: "leitura", depends_on: null, released_slot_of: null, same_as: null, source_scope: null, customer_name: null, service_name: null,
  professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null, source_weekday: null, source_time: null,
  end_time: null, end_date: null, reason: null, destination_mode: null, override_requested: null, override_reason: null };
const OPEN = "agenda sintética", CHAT = "xablau quíntuplo";
type Stored = Record<string, unknown>;
/** A two-message conversation: the plan, then a casual answer on it. `second` switches the flag just before the second message. */
async function conversation(second: "off" | "on") {
  const models = [new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "NEW", operations: [read] } })]),
    new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "CONVERSATION", response: "Resposta sintética." } })])];
  const queue = [...models];
  const s = new SalonSecretary(async () => { const next = queue.shift(); if (!next) throw Error("NO_RECORDED_MODEL"); return next as unknown as Model; }, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId, message: OPEN });
  if (second === "on") vi.stubEnv(FLAG, "true");
  const executorsBefore = db.executors.length;
  const view = await s.send(actor, { sessionId, message: CHAT });
  const stored = (s as unknown as { sessions: Map<string, Stored> }).sessions.get(sessionId)!;
  return { first, view, stored, requests: models.map(model => model.requests), executors: db.executors.length - executorsBefore };
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** What reaches the provider of a request (instructions, input, settings, tools), with the per-conversation ids (plan, drafts) masked. */
const body = (request: ModelRequest) => JSON.stringify({ instructions: request.systemInstructions, input: request.input, settings: request.modelSettings, tools: request.tools,
  output: request.outputType, handoffs: request.handoffs, tracing: request.tracing, explicit: request.toolsExplicitlyProvided, prompt: request.prompt ?? null,
  previous: request.previousResponseId ?? null, conversation: request.conversationId ?? null }).replace(UUID, "<uuid>");

describe("SALON_SECRETARY_AGENT off: nothing of the agent runs", () => {
  it("installs no message context, creates no lookup executor and leaves no agent key in the view or the session", async () => {
    vi.stubEnv(FLAG, "false");
    const run = await conversation("off");
    expect(db.seen).toEqual([{ purpose: "INTERPRETATION", context: false, used: undefined }, { purpose: "INTERPRETATION", context: false, used: undefined }]);
    expect(db.executors).toEqual([]);
    expect(run.first.action_plan?.actions.map(action => action.key)).toEqual(["leitura"]);
    expect("agent_plan" in run.first).toBe(false); expect("agent_plan" in run.view).toBe(false);
    expect("agentPending" in run.stored).toBe(false); expect("agentPlan" in run.stored).toBe(false);
    // No agent telemetry block in any router row.
    for (const row of db.rows.filter(item => item.entityType === "SECRETARY_ROUTER")) expect((row.metadata as { outcome?: { agent?: unknown } | null }).outcome?.agent).toBeUndefined();
  });
  it("an unset flag behaves as off", async () => {
    await conversation("off");
    expect(db.seen.map(item => item.context)).toEqual([false, false]);
    expect(db.executors).toEqual([]);
  });
});

describe("SALON_SECRETARY_AGENT on with an active plan: the C4 answers with the same request", () => {
  it("the second message's C4 request body is byte-identical to the flag-off one (ids masked), now under the message counter", async () => {
    const off = await conversation("off"), seenOff = [...db.seen];
    Object.assign(db, { rows: [], executors: [], seen: [] });
    const on = await conversation("on");
    expect(off.requests[1]).toHaveLength(1); expect(on.requests[1]).toHaveLength(1);
    expect(body(on.requests[1][0])).toBe(body(off.requests[1][0]));
    // Same first request too (the flag was off for both).
    expect(body(on.requests[0][0])).toBe(body(off.requests[0][0]));
    // Off: no context. On: the message context was installed with this tenant's executor, and the C4 call took one of its 3 calls first.
    expect(seenOff[1]).toEqual({ purpose: "INTERPRETATION", context: false, used: undefined });
    expect(db.seen[1]).toEqual({ purpose: "INTERPRETATION", context: true, used: 1 });
    expect(on.executors).toBe(1); expect(db.executors).toEqual([{ salonId: actor.salonId }]);
    // The active plan was answered by the C4 (the agent only takes new requests): the same plan, never an agent plan.
    expect(on.view.action_plan?.plan_ref).toBe(on.first.action_plan?.plan_ref);
    expect("agent_plan" in on.view).toBe(false); expect("agentPlan" in on.stored).toBe(false);
  });
  it("S1c: the agent's cause wording (its prompt and propor_plano's motivo) never reaches a C4 request, flag off or on", async () => {
    const off = await conversation("off");
    Object.assign(db, { rows: [], executors: [], seen: [] });
    const on = await conversation("on");
    const quoted = (text: string) => JSON.stringify(text).slice(1, -1);
    const motivo = String(((AGENT_PLAN_PARAMETERS.properties.acoes as { items: { properties: Record<string, { description?: string }> } }).items.properties.motivo.description));
    expect(motivo).toMatch(/copiada literalmente/);
    const sent = [...off.requests.flat(), ...on.requests.flat()].map(body);
    expect(sent).toHaveLength(4);
    for (const text of sent) { expect(text).not.toContain(quoted(motivo)); expect(text).not.toContain(quoted(AGENT_PROMPT_BASES)); expect(text).not.toContain(AGENT_PLAN_TOOL); }
  });
  it("the C4 call runs under a live deadline signal of the message", async () => {
    const on = await conversation("on");
    const signal = on.requests[1][0].signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});

describe("two tenants at the same time", () => {
  it("each message has its own context, executor and refs; nothing crosses", async () => {
    vi.stubEnv(FLAG, "true");
    const tenants = [{ salonId: "synthetic-tenant-north", userId: "owner-north" }, { salonId: "synthetic-tenant-south", userId: "owner-south" }];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = (tenant: typeof tenants[number], id: string) => agentMessageScope(tenant, [`mensagem ${id}`], async () => {
      const context = agentMessage()!;
      context.binding.bind("p", `prof-${id}`, { name: `Pessoa ${id}` });
      await gate;
      // After the other message ran in between: still this message's context, owner text and single ref.
      const now = agentMessage()!;
      return { same: now === context, context, owner: [...now.owner], refs: now.binding.entries().map(entry => entry.id), executor: now.executor };
    });
    const pending = [run(tenants[0], "norte"), run(tenants[1], "sul")];
    release();
    const [north, south] = await Promise.all(pending);
    expect(north.same).toBe(true); expect(south.same).toBe(true);
    expect(north.context).not.toBe(south.context);
    expect(north.owner).toEqual(["mensagem norte"]); expect(south.owner).toEqual(["mensagem sul"]);
    expect(north.refs).toEqual(["prof-norte"]); expect(south.refs).toEqual(["prof-sul"]);
    expect(north.executor).not.toBe(south.executor);
    expect(db.executors).toEqual([{ salonId: "synthetic-tenant-north" }, { salonId: "synthetic-tenant-south" }]);
    // Outside both messages there is no context left.
    expect(agentMessage()).toBeUndefined();
  });
  it("a message scope inside another reuses the outer one (never nested, never a second executor)", async () => {
    vi.stubEnv(FLAG, "true");
    const inner = await agentMessageScope(actor, ["fora"], () => agentMessageScope(actor, ["dentro"], async () => [...agentMessage()!.owner]));
    expect(inner).toEqual(["fora"]);
    expect(db.executors).toHaveLength(1);
  });
  it("with the flag off the scope is only the work itself", async () => {
    vi.stubEnv(FLAG, "false");
    expect(await agentMessageScope(actor, ["qualquer"], async () => agentMessage())).toBeUndefined();
    expect(db.executors).toEqual([]);
  });
  it("Phase 2: with the flag off an open plan's scope is never even computed; on, it reaches the context and the state waits for the directory", async () => {
    const render = vi.fn(() => '{"acoes":[{"chave":"k"}]}'), open = vi.fn(() => ({ keys: ["k"], render }));
    vi.stubEnv(FLAG, "false");
    expect(await agentMessageScope(actor, ["qualquer"], async () => agentMessage(), open)).toBeUndefined();
    expect(open).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled(); expect(db.executors).toEqual([]);
    vi.stubEnv(FLAG, "true");
    const seen = await agentMessageScope(actor, ["qualquer"], async () => { const context = agentMessage()!; return { keys: [...context.open!.keys], done: [...context.open!.done!] }; }, open);
    expect(seen).toEqual({ keys: ["k"], done: [] });
    expect(open).toHaveBeenCalledOnce(); expect(render).not.toHaveBeenCalled();
    // No open plan (a new request or a C4-built plan): the context carries none.
    expect(await agentMessageScope(actor, ["qualquer"], async () => "open" in agentMessage()!, () => undefined)).toBe(false);
  });
});
