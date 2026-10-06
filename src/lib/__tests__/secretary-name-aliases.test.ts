import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** D1 learned aliases (SALON_SECRETARY_NAME_ALIASES) through the real scheduling adapter, the real search/suggest
 * functions, a fake tenant transaction and the in-memory alias store (no network, no database). An alias is learned only
 * from the owner's click on a suggestion or homonym card for a typed name; it only PROPOSES (one highlighted option to
 * confirm, plus "não é essa pessoa"), never resolves on its own, needs the entity still active in the same salon, and a
 * refusal deletes it (OWNER/MANAGER) and shows the ordinary card. */
type Customer = { id: string; name: string; phone: string | null; salonId: string; mergedIntoId?: string };
const io = vi.hoisted(() => ({ draft: vi.fn(), customers: [] as Customer[],
  professionals: [] as { id: string; name: string; services: string[]; active?: boolean }[], services: [] as { id: string; name: string; active?: boolean }[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const mask = (phone: string | null) => phone ? `(${phone.slice(0, 2)}) *****-${phone.slice(-4)}` : null;
const tx = {
  $queryRaw: vi.fn(async (parts: readonly string[], ...values: unknown[]) => {
    const sql = parts.join("?");
    if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
    if (sql.includes('"ClientProfile"')) {
      const pattern = new RegExp(String(values.at(-1))), salonId = values[0];
      return io.customers.filter(row => row.salonId === salonId && !row.mergedIntoId && pattern.test(fold(row.name))).map(({ id, name, phone }) => ({ id, name, phone }));
    }
    return [{ accessStatus: "APPROVED" }];
  }),
  clientProfile: { findFirst: vi.fn(async ({ where }: { where: { id: string; salonId: string } }) =>
    io.customers.find(row => row.id === where.id && row.salonId === where.salonId && !row.mergedIntoId) ?? null) },
  professional: {
    findMany: vi.fn(async (args: { where: { services?: { some: { serviceId: string } } } }) => io.professionals
      .filter(row => row.active !== false && (!args.where.services || row.services.includes(args.where.services.some.serviceId))).map(row => ({ id: row.id, user: { name: row.name } }))),
    findFirst: vi.fn(async ({ where }: { where: { id: string; services?: { some: { serviceId: string } } } }) => {
      const row = io.professionals.find(item => item.id === where.id && item.active !== false && (!where.services || item.services.includes(where.services.some.serviceId)));
      return row ? { id: row.id, user: { name: row.name } } : null;
    }),
  },
  service: {
    findMany: vi.fn(async () => io.services.filter(row => row.active !== false).map(row => ({ ...row, durationMin: 30, priceCents: 5000, priceType: "FIXED" }))),
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => io.services.find(row => row.id === where.id && row.active !== false) ?? null),
  },
  auditLog: { create: vi.fn() },
};
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (t: object) => unknown) => work(tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(),
  searchSalonCustomer: async (_tx: unknown, actor: { salonId: string }, query: string) => io.customers
    .filter(row => row.salonId === actor.salonId && !row.mergedIntoId && fold(row.name).includes(fold(query.trim()))).map(({ id, name, phone }) => ({ id, name, phone: mask(phone) })) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo",
  listSchedulingServices: async (_tx: unknown, _actor: unknown, query: string) => io.services.filter(row => row.active !== false && fold(row.name).includes(fold(query))).map(row => ({ ...row, durationMin: 30, priceCents: 5000, priceType: "FIXED" })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, input: { service_ref?: string; query?: string }) => io.professionals
    .filter(row => row.active !== false && (!input.service_ref || row.services.includes(input.service_ref)) && (!input.query || fold(row.name).includes(fold(input.query)))).map(row => ({ id: row.id, name: row.name })) }));
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(), upsertSchedulingDraft: io.draft }));
vi.mock("../scheduling-mutations", async original => ({ ...await original<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [] }));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { ALIAS_REJECT_REF, InMemoryNameAliasStore, aliasKey, candidateSetHash, useNameAliasStore } from "../secretary-name-aliases";
import { withNameObserver } from "../entity-suggestions";
import { presentationHints } from "../secretary-presentation";
import { RouterTrace } from "../secretary-router";
import { assessPlanAction, createActionPlan } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";

const actor = { salonId: "ours", userId: "owner" };
let store: InMemoryNameAliasStore, restore: () => void;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2027-06-14T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  io.customers = [{ id: "c-fabio-santos", name: "Fábio Santos", phone: "11999990003", salonId: "ours" }, { id: "c-fabio-lima", name: "Fábio Lima", phone: null, salonId: "ours" },
    { id: "c-tatiana", name: "Tatiana Rocha", phone: "11999990001", salonId: "ours" }, { id: "c-other", name: "Fábio Santos", phone: null, salonId: "other" }];
  io.professionals = [{ id: "pro-rodrigo-lima", name: "Rodrigo Lima", services: ["escova"] }, { id: "pro-rodrigo-alves", name: "Rodrigo Alves", services: ["escova", "corte"] },
    { id: "pro-tatiana", name: "Tatiana Rocha", services: ["corte"] }];
  io.services = [{ id: "corte", name: "Corte Feminino" }, { id: "escova", name: "Escova Progressiva" }];
  io.draft.mockImplementation(async (_tx: unknown, _actor: unknown, input: { operation: string; fields: Record<string, unknown>; draft_ref?: string; expected_revision?: number }) => {
    const missing_fields = ["customer_ref", "service_ref", "professional_ref", "date", "time"].filter(key => !input.fields[key]);
    return { draft_ref: input.draft_ref ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd", draft_revision: (input.expected_revision ?? 0) + 1, operation: input.operation,
      fields: structuredClone(input.fields), expires_at: "2027-06-14T12:30:00Z", status: "NEEDS_INPUT", missing_fields, temporal_conflicts: [] };
  });
  store = new InMemoryNameAliasStore(); restore = useNameAliasStore(store);
});
afterEach(() => { restore(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const flags = (aliases: boolean, suggestions = false) => { vi.stubEnv("SALON_SECRETARY_NAME_ALIASES", aliases ? "true" : "false"); vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", suggestions ? "true" : "false"); };
const block = (fields: Record<string, unknown>, message: string) => {
  const state: SchedulingState = { ...schedulingState(), operation: "schedule.block" };
  return applySchedulingInterpretation(actor, state, { operation: "schedule.block", ...fields }, message).then(() => state);
};
const create = (fields: Record<string, unknown>, message: string) => {
  const state: SchedulingState = { ...schedulingState(), operation: "appointment.create" };
  return applySchedulingInterpretation(actor, state, { operation: "appointment.create", ...fields }, message).then(() => state);
};
const santos = { id: "c-fabio-santos", name: "Fábio Santos · (11) *****-0003" };
const aliasCardOf = (item: { id: string; name: string }, refusal = "Não é essa pessoa") => ({ kind: "customer_ref", source: "alias", items: [item, { id: ALIAS_REJECT_REF, name: refusal }] });

describe("flag off: nothing is learned, read or proposed", () => {
  it("a homonym card is today's card and a click learns nothing", async () => {
    flags(false);
    const find = vi.spyOn(store, "find"), learn = vi.spyOn(store, "learn");
    const state = await create({ customer_name: "Fabio" }, "marca o Fabio");
    expect(state.candidates).toEqual({ kind: "customer_ref", items: [santos, { id: "c-fabio-lima", name: "Fábio Lima" }] });
    await selectScheduling(actor, state, "c-fabio-santos", { clicked: true });
    expect(state.fields.customer_ref).toBe("c-fabio-santos");
    expect(find).not.toHaveBeenCalled(); expect(learn).not.toHaveBeenCalled(); expect(store.rows.size).toBe(0);
  });
});

describe("flag on: learned from a click, proposed for confirmation, never resolved alone", () => {
  it("a click on the homonym card of a typed name teaches it; the same search next time proposes that one person to confirm", async () => {
    flags(true);
    const first = await create({ customer_name: "Fabio" }, "marca o Fabio");
    expect(first.candidates).toEqual({ kind: "customer_ref", items: [santos, { id: "c-fabio-lima", name: "Fábio Lima" }], alias_basis: candidateSetHash(["c-fabio-lima", "c-fabio-santos"]) });
    await selectScheduling(actor, first, "c-fabio-santos", { clicked: true });
    expect([...store.rows.values()]).toEqual([expect.objectContaining({ kind: "customer", key: "fabio", targetId: "c-fabio-santos", salonId: "ours", createdBy: "owner", useCount: 1 })]);
    const trace = new RouterTrace();
    const next = await withNameObserver(entry => trace.names(entry), () => create({ customer_name: "Fabio" }, "agenda o Fabio"));
    expect(next.candidates).toEqual(aliasCardOf(santos));
    expect(next.fields.customer_ref).toBeUndefined();
    expect(next.message).toContain("Fabio → Fábio Santos · (11) *****-0003 — confirmar?");
    expect(trace.nameResolutions).toEqual([{ kind: "customer", outcome: "ALIAS", n: 1 }]);
    // The card is the question (hint), and a typed "sim" is not a choice: nothing is resolved.
    await applySchedulingInterpretation(actor, next, { operation: "appointment.create" }, "sim");
    expect(next.fields.customer_ref).toBeUndefined(); expect(next.candidates).toMatchObject({ source: "alias" });
    await selectScheduling(actor, next, "c-fabio-santos", { clicked: true });
    expect(next.fields.customer_ref).toBe("c-fabio-santos"); expect(next.selected_names?.customer_name).toBe("Fábio Santos");
    expect([...store.rows.values()][0].useCount).toBe(2);
  });
  it("the spec example: a name the search never finds proposes the taught person ('Fabinho → Fábio Santos · (11) *****-0003 — confirmar?')", async () => {
    flags(true);
    await store.learn(actor, { kind: "customer", key: aliasKey("Fabinho")!, targetId: "c-fabio-santos", candidateSet: candidateSetHash([]) });
    const state = await create({ customer_name: "Fabinho" }, "marca o Fabinho");
    expect(state.candidates).toEqual(aliasCardOf(santos));
    expect(state.message).toBe("Fabinho → Fábio Santos · (11) *****-0003 — confirmar?");
    let actionPlan = createActionPlan(plan([intent("appointment.create", { item_key: "a", customer_name: "Fabinho" })]));
    actionPlan = assessPlanAction(actionPlan, "a", { status: "NEEDS_INPUT", missing_fields: ["customer_ref"], preview: state.message });
    const hints = presentationHints(actionPlan, [{ keys: ["a"], kind: "single", child: "op" }],
      [{ operation_ref: "op", state: { sessionId: "op", cancelled: false, message: state.message, scheduling: state } as never }]);
    expect(hints.a.question).toBe("Fabinho → Fábio Santos · (11) *****-0003 — confirmar?");
    expect(hints.a.selection?.labels).toEqual(["Fábio Santos · (11) *****-0003", "Não é essa pessoa"]);
  });
  it("a click on a suggestion card (nothing found) teaches the typed name too; next time the alias comes before the suggestions", async () => {
    flags(true, true);
    const first = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    expect(first.candidates).toMatchObject({ source: "suggest", alias_basis: candidateSetHash([]) });
    await selectScheduling(actor, first, "c-tatiana", { clicked: true });
    const next = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    expect(next.candidates).toEqual(aliasCardOf({ id: "c-tatiana", name: "Tatiana Rocha · (11) *****-0001" }));
  });
  it("only the owner's click teaches: a choice made by the model (no click) and a confirmation card never do", async () => {
    flags(true);
    const state = await create({ customer_name: "Fabio" }, "marca o Fabio");
    await selectScheduling(actor, state, "c-fabio-santos");
    expect(store.rows.size).toBe(0);
  });
  it("another candidate set, an inactive or merged entity, or another salon's alias: no proposal (the ordinary card)", async () => {
    flags(true);
    await store.learn(actor, { kind: "customer", key: "fabio", targetId: "c-fabio-santos", candidateSet: candidateSetHash(["c-fabio-lima", "c-fabio-santos"]) });
    io.customers.push({ id: "c-fabio-nunes", name: "Fábio Nunes", phone: null, salonId: "ours" });
    expect((await create({ customer_name: "Fabio" }, "marca o Fabio")).candidates).toMatchObject({ items: [expect.anything(), expect.anything(), expect.anything()] });
    io.customers = io.customers.filter(row => row.id !== "c-fabio-nunes");
    io.customers.find(row => row.id === "c-fabio-santos")!.mergedIntoId = "c-fabio-lima";
    const merged = await create({ customer_name: "Fabio" }, "marca o Fabio");
    expect(merged.candidates?.source).toBeUndefined(); expect(merged.fields.customer_ref).toBe("c-fabio-lima");
    delete io.customers.find(row => row.id === "c-fabio-santos")!.mergedIntoId;
    await store.learn({ salonId: "other", userId: "x" }, { kind: "customer", key: "fabinho", targetId: "c-other", candidateSet: candidateSetHash([]) });
    const foreign = await create({ customer_name: "Fabinho" }, "marca o Fabinho");
    expect(foreign.candidates).toBeUndefined(); expect(foreign.message).toBe("Não encontrei esse cliente neste salão.");
  });
  it("'não é essa pessoa' (owner): the alias is deleted and the ordinary card follows; a receptionist's refusal keeps it but it is not proposed again here", async () => {
    flags(true);
    const learned = async () => store.learn(actor, { kind: "customer", key: "fabio", targetId: "c-fabio-santos", candidateSet: candidateSetHash(["c-fabio-lima", "c-fabio-santos"]) });
    await learned();
    const state = await create({ customer_name: "Fabio" }, "marca o Fabio");
    await selectScheduling(actor, state, ALIAS_REJECT_REF, { clicked: true });
    expect(store.rows.size).toBe(0);
    expect(state.candidates).toMatchObject({ kind: "customer_ref", items: [{ id: "c-fabio-santos" }, { id: "c-fabio-lima" }] });
    expect(state.candidates?.source).toBeUndefined(); expect(state.fields.customer_ref).toBeUndefined();
    // A receptionist cannot delete (RLS): the alias stays for the salon but this action never proposes it again.
    restore(); store = new InMemoryNameAliasStore(() => false); restore = useNameAliasStore(store); await learned();
    const receptionist = await create({ customer_name: "Fabio" }, "marca o Fabio");
    await selectScheduling(actor, receptionist, ALIAS_REJECT_REF, { clicked: true });
    expect(store.rows.size).toBe(1); expect(receptionist.candidates?.source).toBeUndefined();
    await applySchedulingInterpretation(actor, receptionist, { operation: "appointment.create", time: "10:00" }, "às 10:00");
    expect(receptionist.candidates?.source).toBeUndefined();
    expect((await create({ customer_name: "Fabio" }, "marca o Fabio")).candidates?.source).toBe("alias");
  });
  it("a stale alias card (alias gone or entity inactive before the click) is SELECTION_INVALID, never a pick", async () => {
    flags(true);
    await store.learn(actor, { kind: "customer", key: "fabinho", targetId: "c-fabio-santos", candidateSet: candidateSetHash([]) });
    const state = await create({ customer_name: "Fabinho" }, "marca o Fabinho");
    store.rows.clear();
    await expect(selectScheduling(actor, state, "c-fabio-santos", { clicked: true })).rejects.toThrow("SELECTION_INVALID");
    expect(state.fields.customer_ref).toBeUndefined();
  });
  it("review: a homonym alias is never settled without the owner's click (a model's choice is SELECTION_INVALID; its refusal only shows the ordinary card)", async () => {
    flags(true);
    // Two customers are named Fábio; the owner once clicked Fábio Santos on their homonym card.
    const first = await create({ customer_name: "Fabio" }, "marca o Fabio");
    await selectScheduling(actor, first, "c-fabio-santos", { clicked: true });
    const next = await create({ customer_name: "Fabio" }, "agenda o Fabio");
    expect(next.candidates).toEqual(aliasCardOf(santos));
    // The path a Luna option choice takes ("o Fabio" names only the proposal on this 2-option card): no click, no pick.
    await expect(selectScheduling(actor, next, "c-fabio-santos")).rejects.toThrow("SELECTION_INVALID");
    expect(next.fields.customer_ref).toBeUndefined(); expect(next.candidates).toEqual(aliasCardOf(santos));
    expect([...store.rows.values()][0].useCount).toBe(1);
    // A refusal without a click deletes nothing; this action falls back to the ordinary homonym card.
    await selectScheduling(actor, next, ALIAS_REJECT_REF);
    expect(store.rows.size).toBe(1); expect(next.fields.customer_ref).toBeUndefined();
    expect(next.candidates).toMatchObject({ kind: "customer_ref", items: [{ id: "c-fabio-santos" }, { id: "c-fabio-lima" }] }); expect(next.candidates?.source).toBeUndefined();
  });
  it("professionals: a homonym card of an eligible typed name teaches it; a proposal needs the professional still eligible for the service", async () => {
    flags(true);
    const first = await block({ professional_name: "Rodrigo" }, "bloqueia o Rodrigo");
    expect(first.candidates).toMatchObject({ kind: "professional_ref", alias_basis: candidateSetHash(["pro-rodrigo-lima", "pro-rodrigo-alves"]) });
    await selectScheduling(actor, first, "pro-rodrigo-alves", { clicked: true });
    const next = await block({ professional_name: "Rodrigo" }, "bloqueia o Rodrigo");
    expect(next.candidates).toEqual({ kind: "professional_ref", source: "alias", items: [{ id: "pro-rodrigo-alves", name: "Rodrigo Alves" }, { id: ALIAS_REJECT_REF, name: "Não é essa pessoa" }] });
    expect(next.message).toContain("Rodrigo → Rodrigo Alves — confirmar?");
    // Create: "rodrigo" for Corte finds only Rodrigo Alves (a single match resolves as today); for Escova both: the alias proposes.
    const escova = await create({ customer_name: "Tatiana", service_name: "Escova", professional_name: "Rodrigo" }, "marca a Tatiana na Escova com o Rodrigo");
    expect(escova.candidates).toMatchObject({ kind: "professional_ref", source: "alias", items: [{ id: "pro-rodrigo-alves" }, { id: ALIAS_REJECT_REF }] });
    io.professionals.find(row => row.id === "pro-rodrigo-alves")!.services = ["corte"];
    const ineligible = await create({ customer_name: "Tatiana", service_name: "Escova", professional_name: "Rodrigo" }, "marca a Tatiana na Escova com o Rodrigo");
    expect(ineligible.candidates?.source).toBeUndefined(); expect(ineligible.fields.professional_ref).toBe("pro-rodrigo-lima");
  });
  it("services: the refusal of a service alias says 'Não é esse serviço'", async () => {
    flags(true);
    await store.learn(actor, { kind: "service", key: "progressiva", targetId: "escova", candidateSet: candidateSetHash([]) });
    io.services = [{ id: "corte", name: "Corte Feminino" }, { id: "escova", name: "Escova Longa" }];
    const state = await create({ customer_name: "Tatiana", service_name: "Progressiva" }, "marca a Tatiana na Progressiva");
    expect(state.candidates).toEqual({ kind: "service_ref", source: "alias", items: [{ id: "escova", name: "Escova Longa" }, { id: ALIAS_REJECT_REF, name: "Não é esse serviço" }] });
    expect(state.fields.service_ref).toBeUndefined();
  });
});
