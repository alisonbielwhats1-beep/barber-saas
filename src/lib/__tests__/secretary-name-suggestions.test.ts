import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** C3: tolerant name suggestions (flag) and the Luna-name divergence check, through the real scheduling adapter,
 * the real suggest functions and a fake tenant transaction. No network, no database. */
const io = vi.hoisted(() => ({ draft: vi.fn(), audit: vi.fn(), customers: [] as { id: string; name: string; phone: string | null; salonId: string }[],
  professionals: [] as { id: string; name: string; services: string[] }[], services: [] as { id: string; name: string }[], queries: [] as string[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const tx = {
  $queryRaw: vi.fn(async (parts: readonly string[], ...values: unknown[]) => {
    const sql = parts.join("?");
    io.queries.push(sql.includes('"ClientProfile"') ? "CUSTOMER_PREFILTER" : sql.includes('"Membership"') ? "MEMBERSHIP" : "SALON");
    if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
    if (sql.includes('"ClientProfile"')) {
      const pattern = new RegExp(String(values.at(-1))), salonId = values[0];
      return io.customers.filter(row => row.salonId === salonId && pattern.test(fold(row.name))).map(({ id, name, phone }) => ({ id, name, phone }));
    }
    return [{ accessStatus: "APPROVED" }];
  }),
  professional: { findMany: vi.fn(async (args: { where: { services?: { some: { serviceId: string } } } }) => io.professionals
    .filter(row => !args.where.services || row.services.includes(args.where.services.some.serviceId)).map(row => ({ id: row.id, user: { name: row.name } }))) },
  service: { findMany: vi.fn(async () => io.services.map(row => ({ ...row, durationMin: 30, priceCents: 5000, priceType: "FIXED" }))) },
  auditLog: { create: io.audit },
};
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (t: object) => unknown) => work(tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(),
  searchSalonCustomer: async (_tx: unknown, actor: { salonId: string }, query: string) => io.customers.filter(row => row.salonId === actor.salonId && fold(row.name).includes(fold(query.trim()))).map(({ id, name, phone }) => ({ id, name, phone: phone ? `(${phone.slice(0, 2)}) *****-${phone.slice(-4)}` : null })) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo",
  listSchedulingServices: async (_tx: unknown, _actor: unknown, query: string) => io.services.filter(row => fold(row.name).includes(fold(query))).map(row => ({ ...row, durationMin: 30, priceCents: 5000, priceType: "FIXED" })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, input: { service_ref?: string; query?: string }) => io.professionals
    .filter(row => (!input.service_ref || row.services.includes(input.service_ref)) && (!input.query || fold(row.name).includes(fold(input.query)))).map(row => ({ id: row.id, name: row.name })) }));
vi.mock("../scheduling-actions", async original => ({ ...await original<object>(), upsertSchedulingDraft: io.draft }));
vi.mock("../scheduling-mutations", async original => ({ ...await original<object>(), authorizeSchedulingOperation: async () => "OWNER" }));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { withNameObserver } from "../entity-suggestions";
import { presentationHints } from "../secretary-presentation";
import { RouterTrace } from "../secretary-router";

const actor = { salonId: "ours", userId: "owner" };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2027-06-14T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  io.queries.length = 0;
  io.customers = [{ id: "tatiana", name: "Tatiana Rocha", phone: "11999990001", salonId: "ours" }, { id: "fabio", name: "Fábio Santos", phone: null, salonId: "ours" },
    { id: "other-tatiana", name: "Tatiana Lima", phone: null, salonId: "other" }];
  io.professionals = [{ id: "pro-tatiana", name: "Tatiana Rocha", services: ["corte"] }, { id: "pro-ricardo", name: "Ricardo Alves", services: ["corte", "escova"] },
    { id: "pro-rodrigo", name: "Rodrigo Lima", services: ["escova"] }];
  io.services = [{ id: "corte", name: "Corte Feminino" }, { id: "escova", name: "Escova Progressiva" }];
  io.draft.mockImplementation(async (_tx: unknown, _actor: unknown, input: { operation: string; fields: Record<string, unknown>; draft_ref?: string; expected_revision?: number }) => {
    const missing_fields = ["customer_ref", "service_ref", "professional_ref", "date", "time"].filter(key => !input.fields[key]);
    return { draft_ref: input.draft_ref ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd", draft_revision: (input.expected_revision ?? 0) + 1, operation: input.operation,
      fields: structuredClone(input.fields), expires_at: "2027-06-14T12:30:00Z", status: "NEEDS_INPUT", missing_fields, temporal_conflicts: [] };
  });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const flag = (on: boolean) => vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", on ? "true" : "false");
const create = (fields: Record<string, unknown>, message: string, state: SchedulingState = { ...schedulingState(), operation: "appointment.create" }) =>
  applySchedulingInterpretation(actor, state, { operation: "appointment.create", ...fields }, message).then(() => state);
const block = (fields: Record<string, unknown>, message: string, state: SchedulingState = { ...schedulingState(), operation: "schedule.block" }) =>
  applySchedulingInterpretation(actor, state, { operation: "schedule.block", ...fields }, message).then(() => state);

describe("flag off: the exact/substring search is unchanged", () => {
  it("an unknown customer is not found and nothing is suggested or queried beyond today's lookup", async () => {
    flag(false);
    const state = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    expect(state.message).toBe("Não encontrei esse cliente neste salão.");
    expect(state.candidates).toBeUndefined(); expect(state.fields.customer_ref).toBeUndefined();
    expect(io.queries).not.toContain("CUSTOMER_PREFILTER"); expect(tx.service.findMany).not.toHaveBeenCalled();
  });
  it("a name Luna rewrote is still resolved as today (only the boolean is recorded)", async () => {
    flag(false);
    const trace = new RouterTrace();
    const state = await withNameObserver(entry => trace.names(entry), () => create({ customer_name: "Tatiana" }, "marca a tatiane"));
    expect(state.fields.customer_ref).toBe("tatiana"); expect(state.unproven_names).toBeUndefined();
    expect(trace.nameChecks).toEqual([{ role: "customer", in_message: false, option_echo: false }]);
    expect(trace.nameResolutions).toEqual([{ kind: "customer", outcome: "MATCH", n: 1 }]);
  });
  it("block with an unknown professional keeps today's (empty) option card", async () => {
    flag(false);
    const state = await block({ professional_name: "Tatiane" }, "bloqueia a tatiane");
    expect(state.message).toBe("Não encontrei esse profissional neste salão.");
    expect(state.candidates).toEqual({ kind: "professional_ref", items: [] });
  });
});

describe("flag on: suggestions after an empty search, never an automatic pick", () => {
  it("a misspelled customer becomes a suggestion card; the owner's click is rechecked by the same function", async () => {
    flag(true);
    const state = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    expect(state.fields.customer_ref).toBeUndefined();
    expect(state.candidates).toEqual({ kind: "customer_ref", source: "suggest", items: [{ id: "tatiana", name: "Tatiana Rocha · (11) *****-0001" }] });
    expect(state.message).toBe("Não encontrei “Tatiane”. Você quis dizer: 1. Tatiana Rocha · (11) *****-0001? Selecione uma opção ou escreva o nome completo.");
    // Another salon's Tatiana never enters the prefilter result.
    expect(JSON.stringify(state)).not.toContain("other-tatiana");
    await selectScheduling(actor, state, "tatiana");
    expect(state.fields.customer_ref).toBe("tatiana"); expect(state.candidates).toBeUndefined();
  });
  it("a click whose suggestion is no longer produced by fresh rows is SELECTION_INVALID", async () => {
    flag(true);
    const state = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    io.customers = io.customers.filter(row => row.id !== "tatiana");
    await expect(selectScheduling(actor, state, "tatiana")).rejects.toThrow("SELECTION_INVALID");
    expect(state.fields.customer_ref).toBeUndefined();
  });
  it("services: a typo is suggested from the active catalog", async () => {
    flag(true);
    const state = await create({ customer_name: "Fábio", service_name: "Escova Progresiva" }, "marca o fabio pra Escova Progresiva");
    expect(state.fields.customer_ref).toBe("fabio");
    expect(state.candidates).toMatchObject({ kind: "service_ref", source: "suggest", items: [{ id: "escova", name: "Escova Progressiva" }] });
    await selectScheduling(actor, state, "escova");
    expect(state.fields.service_ref).toBe("escova");
  });
  it("block: a misspelled professional is suggested; nothing similar gives no empty option card", async () => {
    flag(true);
    const state = await block({ professional_name: "Rodirgo" }, "bloqueia o Rodirgo");
    expect(state.candidates).toEqual({ kind: "professional_ref", source: "suggest", items: [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] });
    await selectScheduling(actor, state, "pro-rodrigo");
    expect(state.fields.professional_ref).toBe("pro-rodrigo");
    const none = await block({ professional_name: "Joaquim" }, "bloqueia o Joaquim");
    expect(none.message).toBe("Não encontrei esse profissional neste salão."); expect(none.candidates).toBeUndefined();
  });
  it("create: 'não está elegível' only for someone who exists; an unknown name is 'não encontrei' with suggestions among the eligible", async () => {
    flag(true);
    const ineligible = await create({ customer_name: "Fábio", service_name: "Corte Feminino", professional_name: "Rodrigo" }, "marca o fabio pra Corte Feminino com o Rodrigo");
    expect(ineligible.message).toBe("O profissional informado não está elegível para esse serviço. Escolha um profissional elegível.");
    expect(ineligible.candidates?.items.map(item => item.id)).toEqual(["pro-tatiana", "pro-ricardo"]);
    const typo = await create({ customer_name: "Fábio", service_name: "Corte Feminino", professional_name: "Tatiane" }, "marca o fabio pra Corte Feminino com a Tatiane");
    expect(typo.candidates).toEqual({ kind: "professional_ref", source: "suggest", items: [{ id: "pro-tatiana", name: "Tatiana Rocha" }] });
    expect(typo.message).toMatch(/^Não encontrei “Tatiane”\. Você quis dizer: 1\. Tatiana Rocha\?/);
    await selectScheduling(actor, typo, "pro-tatiana");
    expect(typo.fields.professional_ref).toBe("pro-tatiana");
    const unknown = await create({ customer_name: "Fábio", service_name: "Corte Feminino", professional_name: "Joaquim" }, "marca o fabio pra Corte Feminino com o Joaquim");
    expect(unknown.message).toBe("Não encontrei esse profissional neste salão. Escolha um profissional elegível.");
    expect(unknown.candidates).toEqual({ kind: "professional_ref", items: [{ id: "pro-tatiana", name: "Tatiana Rocha" }, { id: "pro-ricardo", name: "Ricardo Alves" }] });
  });
  it("a tie at the cut asks for detail instead of truncating the options", async () => {
    flag(true);
    io.customers = ["A", "B", "C", "D", "F", "G"].map(letter => ({ id: `t-${letter}`, name: `Tatiana ${letter}`, phone: null, salonId: "ours" }));
    const state = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    expect(state.candidates).toBeUndefined();
    expect(state.message).toBe("Não encontrei “Tatiane” e há vários nomes parecidos. Informe o sobrenome ou o telefone.");
  });
  it("a prefilter above its bound asks for the surname or phone and never scores a partial pool", async () => {
    flag(true);
    io.customers = Array.from({ length: 301 }, (_, i) => ({ id: `c${i}`, name: `Tamires ${i}`, phone: null, salonId: "ours" }));
    const state = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    expect(state.candidates).toBeUndefined(); expect(state.message).toContain("Informe o sobrenome ou o telefone.");
  });
});

describe("flag on: a name Luna wrote that the message does not contain is only a suggestion", () => {
  it("'tatiane' typed, 'Tatiana' emitted: one exact row is shown to confirm, not resolved", async () => {
    flag(true);
    const trace = new RouterTrace();
    const state = await withNameObserver(entry => trace.names(entry), () => create({ customer_name: "Tatiana" }, "marca a tatiane"));
    expect(state.fields.customer_ref).toBeUndefined(); expect(state.unproven_names).toEqual(["customer_name"]);
    expect(state.candidates).toEqual({ kind: "customer_ref", source: "confirm", items: [{ id: "tatiana", name: "Tatiana Rocha · (11) *****-0001" }] });
    expect(state.message).toBe("Confirme o cliente: você quis dizer 1. Tatiana Rocha · (11) *****-0001? Selecione uma opção ou escreva o nome completo.");
    expect(trace.nameChecks).toEqual([{ role: "customer", in_message: false, option_echo: false }]);
    expect(trace.nameResolutions).toEqual([{ kind: "customer", outcome: "CONFIRM", n: 1 }]);
    expect(JSON.stringify([trace.nameChecks, trace.nameResolutions])).not.toMatch(/tatian/i);
    // Only the click (rechecked by the same search) resolves it.
    await selectScheduling(actor, state, "tatiana");
    expect(state.fields.customer_ref).toBe("tatiana"); expect(state.unproven_names).toBeUndefined();
  });
  it("a typed 'sim' (Luna repeating the same name) never confirms the suggestion", async () => {
    flag(true);
    const state = await create({ customer_name: "Tatiana" }, "marca a tatiane");
    await applySchedulingInterpretation(actor, state, { operation: "appointment.create", customer_name: "Tatiana" }, "sim");
    expect(state.fields.customer_ref).toBeUndefined(); expect(state.candidates?.source).toBe("confirm");
  });
  it("an ordinary homonym card keeps today's typed choice: an option picked by its exact name is an echo", async () => {
    flag(true);
    io.customers.push({ id: "amanda-s", name: "Amanda Souza", phone: null, salonId: "ours" }, { id: "amanda-l", name: "Amanda Lima", phone: null, salonId: "ours" });
    const state = await create({ customer_name: "Amanda" }, "marca a amanda");
    expect(state.candidates).toEqual({ kind: "customer_ref", items: [{ id: "amanda-s", name: "Amanda Souza" }, { id: "amanda-l", name: "Amanda Lima" }] });
    const trace = new RouterTrace();
    await withNameObserver(entry => trace.names(entry), () => applySchedulingInterpretation(actor, state, { operation: "appointment.create", customer_name: "Amanda Lima" }, "a última"));
    expect(trace.nameChecks).toEqual([{ role: "customer", in_message: false, option_echo: true }]);
    expect(state.fields.customer_ref).toBe("amanda-l");
  });
  it("a suggestion/confirmation card is never resolved by Luna echoing its option: only a click or the written name", async () => {
    flag(true);
    const state = await create({ customer_name: "Tatiana" }, "marca a tatiane");
    const trace = new RouterTrace();
    await withNameObserver(entry => trace.names(entry), () => applySchedulingInterpretation(actor, state, { operation: "appointment.create", customer_name: "Tatiana Rocha" }, "a primeira"));
    expect(trace.nameChecks).toEqual([{ role: "customer", in_message: false, option_echo: false }]);
    expect(state.fields.customer_ref).toBeUndefined(); expect(state.candidates?.source).toBe("confirm");
    const suggested = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    await applySchedulingInterpretation(actor, suggested, { operation: "appointment.create", customer_name: "Tatiana Rocha" }, "isso");
    expect(suggested.fields.customer_ref).toBeUndefined(); expect(suggested.candidates?.source).toBe("confirm");
  });
  it("the owner writing the name makes it evidence again", async () => {
    flag(true);
    const state = await create({ customer_name: "Tatiana" }, "marca a tatiane");
    await applySchedulingInterpretation(actor, state, { operation: "appointment.create", customer_name: "Tatiana Rocha" }, "é a Tatiana Rocha");
    expect(state.fields.customer_ref).toBe("tatiana"); expect(state.unproven_names).toBeUndefined();
  });
  it("professionals too: a rewritten professional name on a block is confirmed by a click", async () => {
    flag(true);
    const state = await block({ professional_name: "Rodrigo" }, "bloqueia o rodirgo");
    expect(state.fields.professional_ref).toBeUndefined();
    expect(state.candidates).toEqual({ kind: "professional_ref", source: "confirm", items: [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] });
    await selectScheduling(actor, state, "pro-rodrigo");
    expect(state.fields.professional_ref).toBe("pro-rodrigo");
  });
  it("the whole message is the reference: a name outside the action's clause is still written by the owner", async () => {
    flag(true);
    const state: SchedulingState = { ...schedulingState(), operation: "appointment.create" };
    await applySchedulingInterpretation(actor, state, { operation: "appointment.create", customer_name: "Fábio" }, "marca corte", { names: "Pro Fábio: marca corte" });
    expect(state.fields.customer_ref).toBe("fabio"); expect(state.unproven_names).toBeUndefined();
  });
});

describe("presentation: an option card is the question itself", () => {
  it("the suggestion question is used verbatim and its 'Não encontrei' line is not repeated as a notice", async () => {
    flag(true);
    const state = await create({ customer_name: "Tatiane" }, "marca a Tatiane");
    const { createActionPlan, assessPlanAction } = await import("@everflair/salon-secretary");
    const { intent, plan } = await import("../../test/secretary-capability-plan");
    let actionPlan = createActionPlan(plan([intent("appointment.create", { item_key: "a", customer_name: "Tatiane" })]));
    actionPlan = assessPlanAction(actionPlan, "a", { status: "NEEDS_INPUT", missing_fields: ["selection"], preview: state.message });
    const hints = presentationHints(actionPlan, [{ keys: ["a"], kind: "single", child: "c" }], [{ operation_ref: "c", state: { sessionId: "c", cancelled: false, message: state.message, scheduling: state } }]);
    expect(hints.a).toMatchObject({ question: state.message, selection: { field: "customer_ref", labels: ["Tatiana Rocha · (11) *****-0001"] } });
    expect(hints.a.notice).toBeUndefined();
  });
});
