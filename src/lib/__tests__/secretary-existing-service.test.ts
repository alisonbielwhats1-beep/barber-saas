import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ auditLog: { create: vi.fn() }, $queryRaw: vi.fn(), search: vi.fn(), upsert: vi.fn(), proposeCreate: vi.fn(), proposeChange: vi.fn(),
  catalog: [] as { id: string; name: string; priceCents: number; durationMin: number; priceType: string }[], drafts: new Map<string, Record<string, unknown>>() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../service-catalog", async original => ({ ...await original<object>(), assertServiceWriter: async () => ({ currency: "BRL" }), findCatalogServices: db.search }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(),
  upsertActionDraft: db.upsert, proposeServiceCreate: db.proposeCreate, proposeServiceChange: db.proposeChange }));
import { validateSelectionV2 } from "@everflair/salon-secretary";
import { SalonSecretary } from "../salon-secretary";
import { existingServiceInterpretation, existingServiceName, withExistingServiceTargets } from "../secretary-existing-service";
import { foldName } from "../name-search";
import { ScriptedServicesModel, appendScriptedResponses, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";

/** Owner decision (04/10/2026, "nome repetido vira alteração"): a create of a service the salon already has becomes its change.
 * The GF07 shape of the Golden: "Coloca a Escova Lisa por sessenta e cinco reais." read as a create must never offer a duplicate. */
const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const escova = { id: "svc-escova", name: "Escova Lisa", priceCents: 5500, durationMin: 45, priceType: "FIXED" };
beforeEach(() => {
  vi.clearAllMocks(); db.drafts.clear(); db.catalog = [escova];
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  // The catalog search of the product: case- and accent-insensitive "contains".
  db.search.mockImplementation(async (_tx: unknown, _actor: unknown, name: string) => db.catalog.filter(row => foldName(row.name).includes(foldName(name))));
  db.upsert.mockImplementation(async (_tx: unknown, _actor: unknown, input: { draft_ref?: string; expected_revision?: number; service_ref?: string; patch: Record<string, unknown> }) => {
    const draft_ref = input.draft_ref ?? crypto.randomUUID(), previous = db.drafts.get(draft_ref);
    const service = input.service_ref ? db.catalog.find(row => row.id === input.service_ref) : undefined;
    const change = (previous?.change as Record<string, unknown> | undefined) ?? (service ? { service_ref: service.id, service_revision: "1", price_type: "FIXED",
      before: { name: service.name, priceCents: service.priceCents, durationMin: service.durationMin }, patch: {} } : undefined);
    const fields = { ...(change?.before as object), ...(previous?.fields as object), ...input.patch };
    if (change) change.patch = { ...(change.patch as object), ...input.patch };
    db.drafts.set(draft_ref, { fields, change });
    const missing_fields = ["name", "priceCents", "durationMin"].filter(key => (fields as Record<string, unknown>)[key] === undefined);
    return { draft_ref, draft_revision: (input.expected_revision ?? 0) + 1, fields, ...(change ? { change } : {}),
      status: missing_fields.length ? "NEEDS_INPUT" : "READY", missing_fields };
  });
  const propose = (kind: string) => async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) => ({ ...input, proposal_ref: crypto.randomUUID(),
    payload_hash: "backend-hash", fields: (db.drafts.get(input.draft_ref) as { fields: object }).fields, preview: kind, expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...(kind === "change" ? { change: (db.drafts.get(input.draft_ref) as { change: object }).change } : {}) });
  db.proposeCreate.mockImplementation(propose("create")); db.proposeChange.mockImplementation(propose("change"));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("which create is an existing service", () => {
  it("the same name up to case, accents and a leading article; a longer or different name is a new service", async () => {
    for (const name of ["Escova Lisa", "escova lisa", "ESCOVA LISA", "a Escova Lisa"]) expect(await existingServiceName(actor, name), name).toBe("Escova Lisa");
    db.catalog = [{ ...escova, name: "Escova Lisa Longa" }]; // the search finds it, the name is not the same
    expect(await existingServiceName(actor, "Escova Lisa")).toBeUndefined();
    db.catalog = [escova];
    for (const name of ["Escova Lisa Longa", "Escova Progressiva", "x"]) expect(await existingServiceName(actor, name), name).toBeUndefined();
  });
  it("a new plan's create of an existing service is born as its change; everything else of the selection stays", async () => {
    const selection = validateSelectionV2(plan([intent("service.create", { item_key: "a", name: "Escova Lisa", priceCents: 6500, durationMin: null }),
      intent("service.create", { item_key: "b", name: "Pedicure", priceCents: 4000, durationMin: 40 }),
      intent("service.change", { item_key: "c", target_name: "Escova Lisa", priceCents: 7000 })]));
    const result = await withExistingServiceTargets(actor, selection);
    expect(result.operations[0]).toEqual({ ...selection.operations[0], operation: "service.change", target_name: "Escova Lisa", name: null });
    expect(result.operations.slice(1)).toEqual(selection.operations.slice(1));
    db.search.mockClear();
    const noCreate = validateSelectionV2(plan([intent("service.change", { item_key: "c", target_name: "Escova Lisa", priceCents: 7000 })]));
    expect(await withExistingServiceTargets(actor, noCreate)).toBe(noCreate); expect(db.search).not.toHaveBeenCalled();
  });
  it("a services session: fresh create of an existing service is its change; on a change under way, a create of the same service or of none is that change", async () => {
    expect(await existingServiceInterpretation(actor, { operation: "service.create", name: "Escova Lisa", priceCents: 6500 }, {}))
      .toEqual({ operation: "service.change", target_name: "Escova Lisa", priceCents: 6500 });
    expect(await existingServiceInterpretation(actor, { name: "Pedicure", priceCents: 4000 }, {})).toEqual({ name: "Pedicure", priceCents: 4000 });
    const changing = { operation: "service.change" as const, target: "Escova Lisa" };
    expect(await existingServiceInterpretation(actor, { operation: "service.create", name: "escova lisa", priceCents: 6700 }, changing))
      .toEqual({ operation: "service.change", target_name: undefined, priceCents: 6700 });
    expect(await existingServiceInterpretation(actor, { operation: "service.create", priceCents: 6700 }, changing)).toEqual({ operation: "service.change", target_name: undefined, priceCents: 6700 });
    const other = { operation: "service.create" as const, name: "Corte Feminino", priceCents: 9000 };
    expect(await existingServiceInterpretation(actor, other, changing)).toBe(other); // another service: still a mismatch
    const creating = { operation: "service.create" as const, name: "Escova Lisa" };
    expect(await existingServiceInterpretation(actor, creating, { operation: "service.create" })).toBe(creating); // a create under way stays a create
  });
});

describe("the Secretary never offers a duplicate service (Golden GF07 shape)", () => {
  const secretary = (first: unknown) => {
    const model = new ScriptedServicesModel([call("select_capabilities", first)]);
    return { model, s: new SalonSecretary(async () => model, () => "synthetic-execution", undefined, {}, { enabled: () => true }) };
  };
  it("'Coloca a Escova Lisa por 65' read as a create proposes the change of the Escova Lisa; a correction read as a create again stays that change", async () => {
    const { s, model } = secretary(plan([intent("service.create", { item_key: "service", name: "Escova Lisa", priceCents: 6500, durationMin: null })]));
    const session = await s.start(actor, "auto");
    const first = await s.send(actor, { sessionId: session.sessionId, message: "Coloca a Escova Lisa por sessenta e cinco reais." });
    expect(first.action_plan!.actions[0]).toMatchObject({ operation: "service.change", status: "READY_FOR_CONFIRMATION", fields: { target_name: "Escova Lisa", priceCents: 6500 } });
    expect(db.upsert.mock.calls[0][2]).toMatchObject({ service_ref: "svc-escova", patch: { priceCents: 6500 } });
    expect(db.proposeChange).toHaveBeenCalledTimes(1); expect(db.proposeCreate).not.toHaveBeenCalled();
    // The model keeps reading a create: the correction applies to the same change, never to a new service.
    appendScriptedResponses(model, [call("upsert_action_draft", { operation: "service.create", target_name: null, name: "Escova Lisa", priceCents: 6700, durationMin: null })]);
    const second = await s.send(actor, { sessionId: session.sessionId, message: "Corrigindo: sessenta e sete." });
    expect(second.action_plan!.actions[0]).toMatchObject({ operation: "service.change", status: "READY_FOR_CONFIRMATION" });
    expect(second.operations![0].state.draft).toMatchObject({ draft_ref: first.operations![0].state.draft!.draft_ref, fields: { name: "Escova Lisa", priceCents: 6700, durationMin: 45 } });
    expect(db.proposeCreate).not.toHaveBeenCalled();
  });
  it("a new service and a similar name are still created; with several actions, a correction calling the changed one a create is asked again, never applied", async () => {
    const { s, model } = secretary(plan([intent("service.create", { item_key: "a0", name: "Escova Lisa", priceCents: 6500, durationMin: null }),
      intent("service.create", { item_key: "a1", name: "Escova Lisa Longa", priceCents: 9000, durationMin: 60 })]));
    const session = await s.start(actor, "auto");
    const first = await s.send(actor, { sessionId: session.sessionId, message: "Escova Lisa por 65 e cadastra a Escova Lisa Longa por 90, uma hora." });
    expect(first.action_plan!.actions.map(action => action.operation)).toEqual(["service.change", "service.create"]);
    expect(db.proposeChange).toHaveBeenCalledTimes(1); expect(db.proposeCreate).toHaveBeenCalledTimes(1);
    // The routing never reclassifies an action's operation (conversation-routing.ts): that correction is left out and asked again.
    appendScriptedResponses(model, [call("select_capabilities", plan([intent("service.create", { item_key: "a0", name: "Escova Lisa", priceCents: 6700 })]))]);
    const unread = await s.send(actor, { sessionId: session.sessionId, message: "A escova lisa fica por sessenta e sete." });
    expect(unread.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref);
    expect(unread.action_plan!.actions[0]).toMatchObject({ operation: "service.change", fields: { priceCents: 6500 } });
    expect(db.proposeCreate).toHaveBeenCalledTimes(1);
    // Read as the change it is, the correction applies.
    appendScriptedResponses(model, [call("select_capabilities", plan([intent("service.change", { item_key: "a0", priceCents: 6700 })]))]);
    const next = await s.send(actor, { sessionId: session.sessionId, message: "A escova lisa fica por sessenta e sete." });
    expect(next.action_plan!.actions[0]).toMatchObject({ operation: "service.change", fields: { priceCents: 6700 } });
    expect(next.action_plan!.actions[1]).toMatchObject({ operation: "service.create", fields: { name: "Escova Lisa Longa" } });
    expect(db.proposeCreate).toHaveBeenCalledTimes(1);
  });
});
