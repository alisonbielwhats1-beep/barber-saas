import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** ERR-COPY + UX-COPY through the real runtime (flag SALON_SECRETARY_COPY_V2): a new request whose interpretation cannot be read
 * is answered as a turn (never the capability menu, nothing prepared); "not found" says what was read; list sentences and the
 * discard notice name the registered subject once resolved. Spa/estética fixture; scripted Luna answers; nothing confirmed. */
type Row = { appointment_ref: string; customer_name: string; start_local: string; professional_name: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[],
  customers: [] as { id: string; name: string; phone: string }[], appointments: {} as Record<string, Row[]> }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => {
    const row = Object.values(db.appointments).flat().find(item => item.appointment_ref === ref);
    if (!row) throw Error("APPOINTMENT_NOT_FOUND");
    return { ...row, status: "CONFIRMED", services: [] };
  },
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, input: { query?: string }) =>
    [{ id: "pro-jaci", name: "Jaci Albuquerque" }].filter(row => !input.query || row.name.toLowerCase().includes(input.query.toLowerCase())),
  listSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string }) =>
    Object.values(db.appointments).flat().filter(row => row.start_local.startsWith(input.date)).map(row => ({ ...row, status: "CONFIRMED", services: [{ serviceName: "Drenagem" }] })) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => db.customers.filter(row => row.name.toLowerCase().includes(name.toLowerCase())) }));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  const plusHour = (time: string) => `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`;
  const find = (ref?: string) => Object.entries(db.appointments).flatMap(([customer, rows]) => rows.map(row => ({ customer, row }))).find(item => item.row.appointment_ref === ref);
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: Record<string, string | undefined>, operation: string) => {
      const change = operation === "appointment.change", day = change ? f.source_date : f.date, clock = change ? f.source_time : f.time;
      return (db.appointments[f.customer_ref ?? ""] ?? []).filter(row => (!day || row.start_local.startsWith(day)) && (!clock || row.start_local.slice(11, 16) === clock));
    },
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const { customer, row } = find(f.appointment_ref)!;
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: customer, customer_name: row.customer_name,
        professional_ref: "pro-jaci", professional_name: row.professional_name, before_start: row.start_local, before_end: `${row.start_local.slice(0, 11)}${plusHour(row.start_local.slice(11, 16))}`,
        before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${plusHour(f.time)}`, priceCents: 12000 });
    } };
});
import { SalonSecretary, ambiguousRequestMessage, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { secretaryErrorMessages } from "../secretary-error-copy";

const actor = { salonId: "salon-spa", userId: "owner-spa" };
const rute = { id: "c-rute", name: "Rute Figueiredo", phone: "(51) *****-0303" }, ruteHomonym = { id: "c-rute-2", name: "Rute Camargo", phone: "(51) *****-0404" };
const drenagem: Row = { appointment_ref: "appt-rute", customer_name: "Rute Figueiredo", start_local: "2026-10-01T10:00", professional_name: "Jaci Albuquerque" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z")); // Monday; "sexta" = 02/10, "sábado" = 03/10
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_COPY_V2", "true");
  db.rows = []; db.customers = [rute]; db.appointments = { "c-rute": [drenagem] };
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const pair = (value: unknown, literal: string) => ({ value, literal });
const newTurn = (...operations: Record<string, unknown>[]) => ({ turn: { mode: "NEW", operations } });
async function conversation(model: ScriptedServicesModel) {
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  return { secretary, sessionId: session.sessionId, say: (message: string) => secretary.send(actor, { sessionId: session.sessionId, message }) };
}
const scripted = (...turns: unknown[]) => new ScriptedServicesModel(turns.map(turn => call("select_capabilities", turn)));
const router = () => (db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").at(-1)?.metadata as { outcome?: { kind: string; error_code: string | null; divergence: { failed_codes: string[] } } }).outcome!;
const drafts = () => db.rows.filter(row => row.action === "DRAFT").length;
/** D1's shape: a create in the slot a RESCHEDULE frees (released_slot_of only accepts a cancellation): an invalid graph. */
const releasedByChange = newTurn(
  { item_key: "a", operation: "appointment.change", customer_name: "Rute", weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") },
  { item_key: "b", operation: "appointment.create", customer_name: "Rute", depends_on: ["a"], released_slot_of: "a" });
const d1Message = "Passa a Rute pra sexta às 16h e coloca a Rute no horário que ela deixou livre";

describe("ERR-COPY: an unreadable NEW request is this turn's own honest reply", () => {
  it("flag on: INVALID_DEPENDENCY_GRAPH answered with its copy; AMBIGUOUS (nothing confirmable); no plan, no draft; NOT_UNDERSTOOD", async () => {
    const run = await conversation(scripted(releasedByChange));
    const view = await run.say(d1Message);
    expect(view.message).toBe(secretaryErrorMessages.INVALID_DEPENDENCY_GRAPH);
    expect(view.message).not.toContain("Posso ajudar");
    expect(view.capability_status).toBe("AMBIGUOUS"); expect(view.action_plan).toBeUndefined(); expect(view.operations ?? []).toEqual([]);
    expect(drafts()).toBe(0);
    expect(router()).toMatchObject({ kind: "NOT_UNDERSTOOD", error_code: null }); expect(router().divergence.failed_codes).toContain("INVALID_DEPENDENCY_GRAPH");
  });
  it("flag off: today's behaviour (the refusal escapes to the server action)", async () => {
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "false");
    const run = await conversation(scripted(releasedByChange));
    await expect(run.say(d1Message)).rejects.toThrow("INVALID_DEPENDENCY_GRAPH");
  });
  it("a provider failure (not an interpretation failure) is never swallowed", async () => {
    const run = await conversation(new ScriptedServicesModel([], undefined, { name: "APIConnectionTimeoutError", message: "Request timed out." }));
    await expect(run.say("Marca uma drenagem para a Rute sexta às 16h")).rejects.toThrow();
  });
  it("the next message after the converted refusal starts clean (a normal plan, no leftover notice)", async () => {
    const run = await conversation(scripted(releasedByChange, newTurn({ item_key: "a", operation: "appointment.change", customer_name: "Rute", weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") })));
    await run.say(d1Message);
    const next = await run.say("Passa a Rute pra sexta às 16h");
    expect(next.capability_status).not.toBe("AMBIGUOUS"); expect(next.action_plan?.actions).toHaveLength(1);
    expect(next.message).not.toContain(secretaryErrorMessages.INVALID_DEPENDENCY_GRAPH);
  });
  it("a request mapped to nothing (AMBIGUOUS) says nothing was changed instead of the capability menu", async () => {
    const run = await conversation(scripted({ skills: [], independent: true, operations: [], disposition: "AMBIGUOUS" }));
    const view = await run.say("Aquilo lá de ontem");
    expect(view.capability_status).toBe("AMBIGUOUS"); expect(view.message).toBe(ambiguousRequestMessage); expect(view.message).not.toContain("Posso ajudar");
  });
  it("flag off: AMBIGUOUS keeps the historical capability menu", async () => {
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "false");
    const run = await conversation(scripted({ skills: [], independent: true, operations: [], disposition: "AMBIGUOUS" }));
    expect((await run.say("Aquilo lá de ontem")).message).toBe("Qual pedido deseja fazer? Posso ajudar com serviços, clientes, agenda, estoque e consultas financeiras.");
  });
});
const scheduling = (view: SecretaryView) => view.operations![0].state.scheduling!;
describe("UX-COPY in the adapter: say what was read, name the registered subject", () => {
  const notFound = newTurn({ item_key: "a", operation: "appointment.change", customer_name: "Rute", source_weekday: pair(6, "sábado"), source_time: pair("09:00", "às 9h"),
    weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") });
  const notFoundMessage = "Remarca a Rute de sábado às 9h para sexta às 16h";
  it("'not found' names the registered customer, the day and the clock it looked for", async () => {
    const run = await conversation(scripted(notFound));
    const view = await run.say(notFoundMessage);
    expect(scheduling(view).message).toMatch(/^Não encontrei agendamento futuro pendente ou confirmado de Rute Figueiredo em sáb, 03\/10 às 9h\. Agendamentos que já começaram/);
    expect(scheduling(view).proposal).toBeUndefined();
  });
  it("flag off: the historical 'para esses dados'", async () => {
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "false");
    const run = await conversation(scripted(notFound));
    expect(scheduling(await run.say(notFoundMessage)).message).toMatch(/^Não encontrei agendamento futuro pendente ou confirmado para esses dados\./);
  });
  it("wire: the next request carries the reworded question/notice as data only; its growth stays small (flag on vs off)", async () => {
    const size = async (flag: string) => {
      vi.stubEnv("SALON_SECRETARY_COPY_V2", flag); db.rows = [];
      const model = new ScriptedServicesModel([call("select_capabilities", notFound), call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "a", fields: { source_time: pair("10:00", "às 10h") } }] } })]);
      const run = await conversation(model);
      await run.say(notFoundMessage); await run.say("Na verdade é às 10h.");
      return Buffer.byteLength(JSON.stringify(model.requests[1].input), "utf8");
    };
    const off = await size("false"), on = await size("true");
    console.info(JSON.stringify({ copyV2WireDelta: on - off, off, on }));
    expect(Math.abs(on - off)).toBeLessThanOrEqual(160);
  });
  const agenda = newTurn({ item_key: "a", operation: "appointment.list", professional_name: "Jaci", weekday: pair(4, "quinta") });
  it("a list names the professional as registered ('Agenda de Jaci Albuquerque'); flag off keeps the typed words", async () => {
    const on = await conversation(scripted(agenda));
    expect(scheduling(await on.say("Vê a agenda da Jaci na quinta")).message).toMatch(/^Agenda de Jaci Albuquerque em qui, 01\/10:\n10h — Rute Figueiredo \(Drenagem\) com Jaci Albuquerque/);
    vi.stubEnv("SALON_SECRETARY_COPY_V2", "false");
    const off = await conversation(scripted(agenda));
    expect(scheduling(await off.say("Vê a agenda da Jaci na quinta")).message).toMatch(/^Agenda de Jaci em qui, 01\/10:/);
  });
  const reschedule = newTurn({ item_key: "a", operation: "appointment.change", customer_name: "Rute", weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") });
  it("the discard notice names the registered subject once resolved; the flag off keeps the owner's words", async () => {
    for (const [flag, subject] of [["true", "Rute Figueiredo"], ["false", "Rute"]] as const) {
      vi.stubEnv("SALON_SECRETARY_COPY_V2", flag);
      const run = await conversation(scripted(reschedule));
      const ready = await run.say("Passa a Rute pra sexta às 16h");
      expect(ready.action_plan!.actions[0].status).toBe("READY_FOR_CONFIRMATION");
      const discarded = await run.secretary.discardAction(actor, run.sessionId, { plan_ref: ready.action_plan!.plan_ref, action_key: "a" });
      expect(discarded.message).toBe(`Certo, descartei a remarcação de ${subject}. Nada foi alterado.`);
    }
  });
  it("an unresolved homonym (card still open) keeps the typed name in the discard notice", async () => {
    db.customers = [rute, ruteHomonym];
    const run = await conversation(scripted(reschedule));
    const card = await run.say("Passa a Rute pra sexta às 16h");
    expect(scheduling(card).candidates?.kind).toBe("customer_ref");
    const discarded = await run.secretary.discardAction(actor, run.sessionId, { plan_ref: card.action_plan!.plan_ref, action_key: "a" });
    expect(discarded.message).toBe("Certo, descartei a remarcação de Rute. Nada foi alterado."); expect(discarded.message).not.toMatch(/Figueiredo|Camargo/);
  });
});
