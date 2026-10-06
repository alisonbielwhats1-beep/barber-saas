import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** C7 through the real scheduling adapter with a fake tenant transaction (no network, no database): a directory name
 * Luna expanded from the owner's words is proven by the exact-token subset rule (flag SALON_SECRETARY_NAME_SUGGESTIONS),
 * a pure pick of an open card never erases a proven date, and a NEW booking overlapping the same customer's
 * appointment is asked (flag SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD). */
const io = vi.hoisted(() => ({ draft: vi.fn(), audit: vi.fn(), proposal: vi.fn(), upcoming: vi.fn(),
  customers: [] as { id: string; name: string; phone: string | null; salonId: string }[],
  professionals: [] as { id: string; name: string; services: string[] }[], services: [] as { id: string; name: string }[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const tx = {
  $queryRaw: vi.fn(async (parts: readonly string[]) => parts.join("?").includes('"Membership"') ? [{ role: "OWNER" }] : [{ accessStatus: "APPROVED" }]),
  professional: { findMany: vi.fn(async () => io.professionals.map(row => ({ id: row.id, user: { name: row.name } }))) },
  service: { findMany: vi.fn(async () => io.services.map(row => ({ ...row, durationMin: 30, priceCents: 5000, priceType: "FIXED" }))) },
  auditLog: { create: io.audit },
};
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (t: object) => unknown) => work(tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(),
  searchSalonCustomer: async (_tx: unknown, actor: { salonId: string }, query: string) => io.customers.filter(row => row.salonId === actor.salonId && fold(row.name).includes(fold(query.trim()))).map(({ id, name, phone }) => ({ id, name, phone })) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo",
  listSchedulingServices: async (_tx: unknown, _actor: unknown, query: string) => io.services.filter(row => fold(row.name).includes(fold(query))).map(row => ({ ...row, durationMin: 30, priceCents: 5000, priceType: "FIXED" })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, input: { service_ref?: string; query?: string }) => io.professionals
    .filter(row => (!input.service_ref || row.services.includes(input.service_ref)) && (!input.query || fold(row.name).includes(fold(input.query)))).map(row => ({ id: row.id, name: row.name })),
  getSchedulingAvailability: async () => ({ plan: { startLocal: "2027-06-15T10:00" }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listUpcomingCustomerAppointments: io.upcoming }));
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(), upsertSchedulingDraft: io.draft, proposeAppointmentCreate: io.proposal,
  schedulingSnapshot: async () => ({ customer_ref: "fabio", customer_name: "Fábio Santos", service_ref: "corte", service_name: "Corte Feminino", professional_ref: "pro-tatiana",
    professional_name: "Tatiana Rocha", date: "2027-06-15", startLocal: "2027-06-15T10:00", endLocal: "2027-06-15T10:30", timezone: "America/Sao_Paulo" }) }));
vi.mock("../scheduling-mutations", async original => ({ ...await original<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [] }));
import { applySchedulingInterpretation, customerOverlapGuardEnabled, schedulingState, type SchedulingState } from "../secretary-scheduling";
import { withNameObserver } from "../entity-suggestions";
import { RouterTrace } from "../secretary-router";
import { groundBatchPatch } from "../secretary-batch";

const actor = { salonId: "ours", userId: "owner" };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2027-06-14T12:00:00Z")); // a Monday
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  io.customers = [{ id: "fabio", name: "Fábio Santos", phone: null, salonId: "ours" }, { id: "amanda-l", name: "Amanda Lima", phone: null, salonId: "ours" },
    { id: "amanda-s", name: "Amanda Souza", phone: null, salonId: "ours" }];
  io.professionals = [{ id: "pro-tatiana", name: "Tatiana Rocha", services: ["corte"] }, { id: "pro-ricardo", name: "Ricardo Alves", services: ["corte", "escova"] },
    { id: "pro-rodrigo", name: "Rodrigo Lima", services: ["escova"] }];
  io.services = [{ id: "corte", name: "Corte Feminino" }, { id: "escova", name: "Escova Progressiva" }];
  io.upcoming.mockResolvedValue([]);
  io.proposal.mockImplementation(async (_tx: unknown, _actor: unknown, input: object) => ({ ...input, proposal_ref: "pppppppp-pppp-4ppp-8ppp-pppppppppppp", payload_hash: "hash", preview: "NOVO AGENDAMENTO", expires_at: "2027-06-14T12:30:00Z" }));
  io.draft.mockImplementation(async (_tx: unknown, _actor: unknown, input: { operation: string; fields: Record<string, unknown>; draft_ref?: string; expected_revision?: number }) => {
    const missing_fields = ["customer_ref", "service_ref", "professional_ref", "date", "time"].filter(key => !input.fields[key]);
    return { draft_ref: input.draft_ref ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd", draft_revision: (input.expected_revision ?? 0) + 1, operation: input.operation,
      fields: structuredClone(input.fields), expires_at: "2027-06-14T12:30:00Z", status: missing_fields.length ? "NEEDS_INPUT" : "READY", missing_fields, temporal_conflicts: [] };
  });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const flag = (name: string, on: boolean) => vi.stubEnv(name, on ? "true" : "false");
const names = (on: boolean) => flag("SALON_SECRETARY_NAME_SUGGESTIONS", on);
const run = (operation: string, fields: Record<string, unknown>, message: string, options?: { names?: string; scoped?: boolean; askUnprovenService?: boolean },
  state: SchedulingState = { ...schedulingState(), operation: operation as SchedulingState["operation"] }) => {
  const trace = new RouterTrace();
  return withNameObserver(entry => trace.names(entry), () => applySchedulingInterpretation(actor, state, { operation: operation as never, ...fields }, message, options)).then(() => ({ state, trace }));
};

describe("directory name Luna expanded from a spoken first name (professional)", () => {
  it("'rodrigo' written, 'Rodrigo Lima' emitted, one Rodrigo in the salon: proven and resolved, no confirmation card", async () => {
    names(true);
    const { state, trace } = await run("schedule.block", { professional_name: "Rodrigo Lima" }, "fecha a agenda do rodrigo");
    expect(state.fields.professional_ref).toBe("pro-rodrigo"); expect(state.unproven_names).toBeUndefined(); expect(state.candidates).toBeUndefined();
    expect(trace.nameChecks).toEqual([{ role: "professional", in_message: false, option_echo: false, directory_proof: true }]);
    expect(trace.nameResolutions).toEqual([{ kind: "professional", outcome: "MATCH", n: 1 }]);
    expect(JSON.stringify(trace.snapshot())).not.toMatch(/rodrigo/i);
  });
  it("two Rodrigos share the owner's token: never picked, the claim stays a confirmation", async () => {
    names(true); io.professionals.push({ id: "pro-rodrigo-2", name: "Rodrigo Alves", services: ["corte"] });
    const { state, trace } = await run("schedule.block", { professional_name: "Rodrigo Lima" }, "fecha a agenda do rodrigo");
    expect(state.fields.professional_ref).toBeUndefined(); expect(state.unproven_names).toEqual(["professional_name"]);
    expect(state.candidates).toEqual({ kind: "professional_ref", source: "confirm", items: [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] });
    expect(trace.nameChecks).toEqual([{ role: "professional", in_message: false, option_echo: false }]);
  });
  it("a typo is never proven by the directory (it stays a suggestion to confirm)", async () => {
    names(true);
    const { state } = await run("schedule.block", { professional_name: "Rodrigo Lima" }, "fecha a agenda do rodirgo");
    expect(state.fields.professional_ref).toBeUndefined(); expect(state.candidates?.source).toBe("confirm");
  });
  it("the owner's tokens must be in THIS action's scope: a sibling clause naming the same word proves nothing", async () => {
    names(true);
    const outside = await run("schedule.block", { professional_name: "Rodrigo Lima" }, "                  fecha a agenda", { names: "cancela o rodrigo e fecha a agenda" });
    expect(outside.state.fields.professional_ref).toBeUndefined(); expect(outside.state.candidates?.source).toBe("confirm");
    const inside = await run("schedule.block", { professional_name: "Rodrigo Lima" }, "cancela a bia e fecha a agenda do rodrigo", { names: "cancela a bia e fecha a agenda do rodrigo" });
    expect(inside.state.fields.professional_ref).toBe("pro-rodrigo");
  });
  it("create: the eligible professional Luna wrote in full is resolved when the owner wrote the first name", async () => {
    names(true);
    const { state } = await run("appointment.create", { customer_name: "Fábio", service_name: "Corte", professional_name: "Ricardo Alves" }, "marca o fabio pra corte com o ricardo");
    expect(state.fields).toMatchObject({ customer_ref: "fabio", service_ref: "corte", professional_ref: "pro-ricardo" }); expect(state.unproven_names).toBeUndefined();
  });
  it("flag off: nothing changes (no directory query, only the historical boolean)", async () => {
    names(false);
    const { state, trace } = await run("schedule.block", { professional_name: "Rodrigo Lima" }, "fecha a agenda do rodrigo");
    expect(state.fields.professional_ref).toBe("pro-rodrigo"); expect(tx.professional.findMany).not.toHaveBeenCalled();
    expect(trace.nameChecks).toEqual([{ role: "professional", in_message: false, option_echo: false }]);
  });
  it("review: the customer's own surname never proves a professional Luna invented ('Carla Lima' is not 'Rodrigo Lima'): the CONFIRM card", async () => {
    names(true); io.customers.push({ id: "carla", name: "Carla Lima", phone: null, salonId: "ours" });
    const { state, trace } = await run("appointment.create", { customer_name: "Carla Lima", service_name: "Escova", professional_name: "Rodrigo Lima", day_offset: 1, time: "10:00" },
      "marca a Carla Lima amanhã às 10h escova");
    expect(state.fields.customer_ref).toBe("carla"); expect(state.fields.professional_ref).toBeUndefined();
    expect(state.unproven_names).toEqual(["professional_name"]);
    expect(state.candidates).toEqual({ kind: "professional_ref", source: "confirm", items: [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] });
    expect(trace.nameChecks).toContainEqual({ role: "professional", in_message: false, option_echo: false });
    // The owner's own word for the professional still proves it.
    const said = await run("appointment.create", { customer_name: "Carla Lima", service_name: "Escova", professional_name: "Rodrigo Lima", day_offset: 1, time: "10:00" },
      "marca a Carla Lima amanhã às 10h escova com o rodrigo");
    expect(said.state.fields.professional_ref).toBe("pro-rodrigo");
  });
  it("customers are never proven by a directory (they are not in Luna's)", async () => {
    names(true);
    const { state } = await run("appointment.create", { customer_name: "Fábio Santos" }, "marca o fabio");
    expect(state.fields.customer_ref).toBeUndefined(); expect(state.candidates?.source).toBe("confirm");
  });
});

describe("directory name Luna expanded from the owner's words (service)", () => {
  it("'escova' written, 'Escova Progressiva' emitted, one escova in the catalog: proven (no refusal, no question)", async () => {
    names(true);
    const { state, trace } = await run("appointment.create", { customer_name: "Fábio", service_name: "Escova Progressiva" }, "marca o fabio pra escova");
    expect(state.fields).toMatchObject({ customer_ref: "fabio", service_ref: "escova" });
    expect(trace.nameChecks).toContainEqual({ role: "service", in_message: false, option_echo: false, directory_proof: true });
  });
  it("flag off, a shared token, or the word only inside the customer's name: refused exactly as before", async () => {
    names(false);
    await expect(run("appointment.create", { customer_name: "Fábio", service_name: "Escova Progressiva" }, "marca o fabio pra escova")).rejects.toThrow("ENTITY_MENTION_CONFLICT");
    names(true); io.services.push({ id: "escova-2", name: "Escova Simples" });
    await expect(run("appointment.create", { customer_name: "Fábio", service_name: "Escova Progressiva" }, "marca o fabio pra escova")).rejects.toThrow("ENTITY_MENTION_CONFLICT");
    io.services.pop(); io.customers.push({ id: "maria", name: "Maria Escova", phone: null, salonId: "ours" });
    await expect(run("appointment.create", { customer_name: "Maria Escova", service_name: "Escova Progressiva" }, "marca a maria escova amanha")).rejects.toThrow("ENTITY_MENTION_CONFLICT");
  });
  it("plan turns keep asking for an unproven service on its own", async () => {
    names(true); io.services.push({ id: "escova-2", name: "Escova Simples" });
    const { state } = await run("appointment.create", { customer_name: "Fábio", service_name: "Escova Progressiva" }, "marca o fabio pra escova", { askUnprovenService: true });
    expect(state.fields.service_name).toBeUndefined(); expect(state.waiting_for).toBe("service_name");
  });
});

describe("a pure pick of the open card is not temporal evidence ('a segunda' = the second option)", () => {
  const card = async () => {
    const { state } = await run("appointment.cancel", { customer_name: "amanda", day_offset: 1, reason: "ela pediu para desmarcar" }, "cancela a amanda amanha ela pediu para desmarcar");
    expect(state.candidates).toEqual({ kind: "customer_ref", items: [{ id: "amanda-l", name: "Amanda Lima" }, { id: "amanda-s", name: "Amanda Souza" }] });
    expect(state.fields.date).toBe("2027-06-15");
    return state;
  };
  it.each(["a segunda", "e a segunda, a amanda souza", "a de baixo"])("%s: the proven date (Tuesday) is kept and the chosen customer resolves", async reply => {
    names(false);
    const state = await card();
    await run("appointment.cancel", { customer_name: "Amanda Souza" }, reply, undefined, state);
    expect(state.fields).toMatchObject({ customer_ref: "amanda-s", date: "2027-06-15", reason: "ela pediu para desmarcar" });
  });
  it("a reply that is not only a published option keeps the full grounding (the date is re-checked and asked)", async () => {
    names(false);
    const state = await card();
    await run("appointment.cancel", { customer_name: "Amanda Pereira" }, "a segunda", undefined, state);
    expect(state.fields.date).toBeUndefined();
  });
  // Review: the OWNER's words decide too. Luna restating only the option's name never hides a negation or a new day
  // she left out: the negated date is never kept for the cancellation (it is asked).
  it.each(["a amanda souza, mas não amanhã", "amanda souza. amanhã não, sexta", "a segunda, só que não é amanhã", "a amanda souza de quinta às 10h"])(
    "%s: Luna emits only the option's name, yet the proven date is re-checked and never kept against the owner's words", async reply => {
      names(false);
      const state = await card();
      await run("appointment.cancel", { customer_name: "Amanda Souza" }, reply, undefined, state);
      expect(state.fields.date).toBeUndefined(); expect(state.proposal).toBeUndefined();
    });
});

describe("cancel→create batch: a pure pick of the item's card keeps its proven date", () => {
  const plan = { execution_policy: "all_or_nothing", items: [
    { key: "a", operation: "appointment.cancel", depends_on: [], fields: { customer_name: "amanda", date: "2027-06-15", reason: "ela pediu para desmarcar" } },
    { key: "b", operation: "appointment.create", depends_on: ["a"], released_slot_of: "a", fields: { customer_name: "Fábio" } }] };
  const draft = { plan, draft_ref: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", draft_revision: 1, expires_at: "2027-06-14T12:30:00Z", missing_fields: ["a.customer_ref"],
    candidates: { item_key: "a", field: "customer_ref", items: [{ id: "amanda-l", name: "Amanda Lima" }, { id: "amanda-s", name: "Amanda Souza" }] } };
  const ground = (name: string, reply = "a segunda") => groundBatchPatch(plan as never, "a", { customer_name: name }, reply, "America/Sao_Paulo", undefined, draft as never).items[0].fields;
  it("'a segunda' naming Amanda Souza keeps Tuesday; a name that is not an option keeps the full grounding", () => {
    expect(ground("Amanda Souza")).toMatchObject({ customer_name: "Amanda Souza", date: "2027-06-15", reason: "ela pediu para desmarcar" });
    expect(ground("Amanda Pereira").date).toBeUndefined();
  });
  it("review: the owner's negation or new day Luna left out keeps the full grounding (the negated date is not kept)", () => {
    for (const reply of ["a amanda souza, mas não amanhã", "amanda souza. amanhã não, sexta", "a segunda, só que não é amanhã"])
      expect(ground("Amanda Souza", reply).date, reply).toBeUndefined();
    expect(ground("Amanda Souza", "e a segunda, a amanda souza").date).toBe("2027-06-15");
  });
});

describe("create vs change: the same customer booked at an overlapping time", () => {
  const book = () => run("appointment.create", { customer_name: "Fábio", service_name: "Corte", professional_name: "Tatiana", day_offset: 1, time: "10:00" }, "marca o fabio pra corte com a tatiana amanha as 10");
  const overlap = [{ appointment_ref: "old", start_local: "2027-06-15T10:00", start_at: "2027-06-15T13:00:00.000Z", end_at: "2027-06-15T14:00:00.000Z" }];
  it("flag off (default): the proposal is prepared as before (its preview lists the customer's appointments)", async () => {
    expect(customerOverlapGuardEnabled({})).toBe(false);
    io.upcoming.mockResolvedValue(overlap);
    const { state } = await book();
    expect(io.proposal).toHaveBeenCalledTimes(1); expect(io.upcoming).not.toHaveBeenCalled(); expect(state.proposal).toBeDefined();
  });
  it("flag on: an overlapping appointment of the same customer is a question, never a second proposal", async () => {
    flag("SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD", true); io.upcoming.mockResolvedValue(overlap);
    const { state } = await book();
    expect(io.proposal).not.toHaveBeenCalled(); expect(state.proposal).toBeUndefined(); expect(state.waiting_for).toBe("time");
    expect(state.message).toBe('Fábio Santos já tem horário ter, 15/06 às 10h, que se sobrepõe a este. Isto criaria um segundo agendamento; para remarcar, diga "remarcar", ou informe outro horário.');
    expect(io.upcoming.mock.calls[0][2]).toBe("fabio");
    expect(io.upcoming.mock.calls[0][3]).toEqual({ overlapping: { start: new Date("2027-06-15T13:00:00.000Z"), end: new Date("2027-06-15T13:30:00.000Z") } });
  });
  it("flag on without an overlap: proposed as usual", async () => {
    flag("SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD", true);
    const { state } = await book();
    expect(io.proposal).toHaveBeenCalledTimes(1); expect(state.proposal).toBeDefined();
  });
});
