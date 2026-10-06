import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PhaseAWireWitness } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-witness";
import { assertPhaseADatabase, comparePhaseAJournal, emptyIndependentCounters, installPhaseAWriteWitness, seedPhaseACase,
  snapshotPhaseACase, type OperationalSnapshot } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { assessPhaseAMissingFields, withPhaseAClock } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-execution";
import { makeFixture, validateFixture, candidates } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
import { verifyPhaseA } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a";
import { secretaryGuardedFetch } from "../../../packages/salon-secretary/src/openai-cost-guard";

const wire = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  model: "gpt-6-luna", instructions: "synthetic", input: [{ role: "user", content: "Agenda o Alisson amanhã." }],
  tools: [{ type: "function", name: "select_capabilities", parameters: {} }],
  tool_choice: { type: "function", name: "select_capabilities" }, parallel_tool_calls: false,
  max_output_tokens: 1200, store: false, stream: false, include: [], ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe("Phase A serialized wire witness", () => {
  it("records only sanitized metadata after the frozen cost guard and before network", async () => {
    const witness = new PhaseAWireWitness();
    witness.expectTurn("i01", 1, "select_capabilities", ["private-uuid"]);
    const native = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body);
      witness.beforeNetwork({ url: String(input), method: String(init?.method), body });
      return native(input, init);
    });
    const body = wire();
    await secretaryGuardedFetch("gpt-6-luna")("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: "Bearer sk-proj-secret-not-logged" }, body,
    });
    expect(native).toHaveBeenCalledTimes(1);
    expect(witness.records).toMatchObject([{ endpoint: "/v1/responses", method: "POST",
      model: "gpt-6-luna", store: false, stream: false, parallel_tool_calls: false,
      function_tools: ["select_capabilities"], hosted_tools: 0, containers: 0 }]);
    expect(JSON.stringify(witness.records)).not.toContain("secret-not-logged");
    expect(witness.budget.calls).toBe(1);
  });

  it.each([
    ["store", { store: true }], ["hosted", { tools: [{ type: "web_search" }] }],
    ["container", { container: { type: "auto" } }], ["unexpected", { background: true }],
  ])("rejects %s before global fetch", async (_label, extra) => {
    const witness = new PhaseAWireWitness();
    witness.expectTurn("i01", 1, "select_capabilities", []);
    const native = vi.fn(); vi.stubGlobal("fetch", native);
    await expect(secretaryGuardedFetch("gpt-6-luna")("https://api.openai.com/v1/responses",
      { method: "POST", body: wire(extra) })).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
    expect(native).not.toHaveBeenCalled();
    expect(witness.records).toHaveLength(0);
  });

  it("rejects secret, internal ID and wrong Function Tool without accepting a request", () => {
    const witness = new PhaseAWireWitness();
    witness.expectTurn("i01", 1, "select_capabilities", ["private-uuid"]);
    expect(() => witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST",
      body: wire({ instructions: "sk-proj-secretsecretsecret" }) })).toThrow("WIRE_WITNESS_REJECTED");
    expect(() => witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST",
      body: wire({ input: [{ role: "user", content: "private-uuid" }] }) })).toThrow("WIRE_WITNESS_REJECTED");
    expect(() => witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST",
      body: wire({ instructions: "internal 11111111-1111-4111-8111-111111111111" }) })).toThrow("WIRE_WITNESS_REJECTED");
    expect(() => witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST",
      body: wire({ tools: [{ type: "function", name: "upsert_action_draft", parameters: {} }],
        tool_choice: { type: "function", name: "upsert_action_draft" } }) })).toThrow("WIRE_WITNESS_TOOL_MISMATCH");
    expect(witness.records).toHaveLength(0);
  });

  it("caps the serialized requests at 28 even with tiny payloads", () => {
    const witness = new PhaseAWireWitness();
    for (let i = 1; i <= 28; i++) {
      witness.expectTurn("i01", i, "select_capabilities", []);
      witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST", body: wire() });
      witness.clearTurn();
    }
    witness.expectTurn("i01", 29, "select_capabilities", []);
    expect(() => witness.beforeNetwork({ url: "https://api.openai.com/v1/responses",
      method: "POST", body: wire() })).toThrow("BUDGET_EXCEEDED");
    expect(witness.records).toHaveLength(28);
    expect(witness.budget.reservedUsd).toBe(.2408);
  });

  it("blocks a second request in the same turn before reserving cost", () => {
    const witness = new PhaseAWireWitness();
    witness.expectTurn("t07", 2, "upsert_action_draft", []);
    const request = { url: "https://api.openai.com/v1/responses", method: "POST", body: wire({
      tools: [{ type: "function", name: "upsert_action_draft", parameters: {} }],
      tool_choice: { type: "function", name: "upsert_action_draft" },
    }) };
    witness.beforeNetwork(request);
    expect(() => witness.beforeNetwork(request)).toThrow("WIRE_TURN_LIMIT");
    expect(witness.budget.calls).toBe(1);
  });
});

describe("Phase A fixtures and independent journal", () => {
  it("stops on an invented required field or proposal that bypasses frozen clarification", () => {
    const capture = { operations: [{ fields: { customer_name: "Alisson", service_ref: "synthetic-ref" }, proposal_ref: "proposal" }] };
    expect(assessPhaseAMissingFields(["service", "time"], capture)).toEqual({
      invented_critical_fields: ["service"], unsafe_proposal: true });
    const safe = { operations: [{ fields: { customer_name: "Alisson" }, proposal_ref: null }] };
    expect(assessPhaseAMissingFields(["service", "time"], safe)).toEqual({
      invented_critical_fields: [], unsafe_proposal: false });
  });
  it("maps all 26 frozen cases to isolated synthetic writes, with 28 untouched turns", async () => {
    const frozen = verifyPhaseA(process.cwd());
    expect([frozen.cases, frozen.turns]).toEqual([26, 28]);
    const plan = (await import("../../../packages/salon-secretary/evaluation/hard-conversations-phase-a.json")).default;
    const tenants = new Set<string>();
    for (const c of plan.cases) {
      const fixture = makeFixture(c.case_id, c.fixture as Parameters<typeof makeFixture>[1]);
      expect(validateFixture(fixture)).toEqual([]);
      expect(tenants.has(fixture.tenant)).toBe(false);
      tenants.add(fixture.tenant);
      expect(candidates(fixture, "customers", "Alisson").every(x => x.tenant === fixture.tenant)).toBe(true);
      const writes: string[] = [];
      const model = (name: string) => ({ findUnique: async () => null, create: async () => { writes.push(name); return {}; },
        createMany: async () => { writes.push(name); return { count: 1 }; } });
      const tx = { user: model("user"), salon: model("salon"), membership: model("membership"),
        professional: model("professional"), workingHours: model("workingHours"), service: model("service"),
        professionalService: model("professionalService"), clientProfile: model("clientProfile"),
        product: model("product"), appointment: model("appointment"), appointmentService: model("appointmentService"),
        payment: model("payment"), $executeRaw: async () => 1 };
      const admin = { salon: tx.salon, $transaction: async (fn: (client: typeof tx) => Promise<void>) => fn(tx) } as unknown as PrismaClient;
      await seedPhaseACase(admin, fixture);
      expect(writes.filter(name => name === "salon")).toHaveLength(1);
      expect(writes.filter(name => name === "service")).toHaveLength(fixture.services.length);
      expect(writes.filter(name => name === "professional")).toHaveLength(fixture.professionals.length);
      expect(writes.filter(name => name === "appointment")).toHaveLength(fixture.appointments.length +
        (["m03", "m07"].includes(c.case_id) ? 1 : 0));
    }
    expect(tenants.size).toBe(26);
  });

  it("separates technical audit from operational mutation and confirmation", () => {
    const before: OperationalSnapshot = { hashes: { services: "a", customers: "a", appointments: "a",
      appointment_services: "a", appointment_events: "a", products: "a", outbox: "a",
      closures: "a", payments: "a" }, counts: { outbox: 0 }, technical_audits: 0, confirmations: 0 };
    const technical = { ...before, technical_audits: 4 };
    expect(comparePhaseAJournal(before, technical)).toMatchObject({
      counters: { operational_writes: 0, confirmations: 0 }, technical_audit_delta: 4 });
    const changed = { ...before, hashes: { ...before.hashes, appointments: "b", products: "b", outbox: "b" },
      counts: { outbox: 1 }, technical_audits: 5, confirmations: 1 };
    expect(comparePhaseAJournal(before, changed)).toMatchObject({ counters: {
      operational_writes: 3, appointment_mutations: 1, inventory_mutations: 1, outbox_creations: 1, confirmations: 1 } });
  });

  it("journals draft, proposal and usage evidence without retaining their payloads", async () => {
    const rows = [
      { id: "draft", action: "SERVICE_CREATE_DRAFT", entityType: "SERVICE_CREATE_MVP", entityId: "synthetic", metadata: { field: "synthetic" }, createdAt: new Date(0) },
      { id: "proposal", action: "SERVICE_CREATE_PROPOSAL", entityType: "SERVICE_CREATE_MVP", entityId: "synthetic", metadata: { field: "synthetic" }, createdAt: new Date(0) },
      { id: "usage", action: "MODEL_CALL_FINISHED", entityType: "SALON_SECRETARY_USAGE", entityId: "synthetic", metadata: { field: "synthetic" }, createdAt: new Date(0) },
    ];
    const empty = { findMany: async () => [] };
    const admin = { service: empty, clientProfile: empty, appointment: empty, appointmentService: empty,
      appointmentEvent: empty, appointmentProduct: empty, product: empty, notificationOutbox: empty,
      salonClosure: empty, timeOff: empty, resourceBooking: empty, payment: empty,
      auditLog: { findMany: async () => rows } } as unknown as PrismaClient;
    const snapshot = await snapshotPhaseACase(admin, makeFixture("i01", "free"));
    expect(snapshot).toMatchObject({ technical_audits: 3,
      technical_by_kind: { drafts: 1, proposals: 1, usage: 1, router: 0, other: 0 } });
    expect(snapshot.technical_audit_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain("synthetic");
  });

  it("observes write attempts independently of post-case state", async () => {
    const counters = emptyIndependentCounters();
    let middleware: ((params: { action: string; model?: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) | null = null;
    installPhaseAWriteWitness({ $use: (fn: typeof middleware) => { middleware = fn; } } as unknown as PrismaClient, counters);
    expect(middleware).not.toBeNull();
    for (const model of ["AuditLog", "Service", "Appointment", "Product", "NotificationOutbox"])
      await middleware!({ model, action: "create" }, async () => ({}));
    expect(counters).toMatchObject({ operational_writes: 4, service_mutations: 1,
      appointment_mutations: 1, inventory_mutations: 1, outbox_creations: 1 });
  });

  it("uses a controlled relative date and always restores the global clock", async () => {
    const original = Date;
    await expect(withPhaseAClock(async () => {
      expect(new Date().toISOString()).toBe("2026-10-05T12:00:00.000Z");
      expect(Date.now()).toBe(Date.parse("2026-10-05T12:00:00.000Z"));
      throw Error("synthetic");
    })).rejects.toThrow("synthetic");
    expect(Date).toBe(original);
    await expect(withPhaseAClock(() => { throw Error("synchronous"); })).rejects.toThrow("synchronous");
    expect(Date).toBe(original);
  });

  it("requires the disposable identity, nonprivileged runtime role and FORCE RLS", async () => {
    const tables = ["Salon", "Membership", "ClientProfile", "Service", "Professional", "WorkingHours",
      "ProfessionalService", "Appointment", "AppointmentService", "AppointmentEvent", "AppointmentProduct",
      "Payment", "Product", "NotificationOutbox", "AuditLog", "SalonClosure", "TimeOff",
      "PhysicalResource", "ResourceBooking"];
    const admin = { $queryRaw: async () => [{ name: "everflair_service_mvp", host: "127.0.0.1", port: 55441,
      directory: "C:/Temp/everflair-service-mvp-synthetic/data" }] } as unknown as PrismaClient;
    const runtime = { $queryRaw: vi.fn().mockResolvedValueOnce([{ name: "mvp_service_runtime", super: false, bypass: false }])
      .mockResolvedValueOnce(tables.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true }))) } as unknown as PrismaClient;
    await expect(assertPhaseADatabase(admin, runtime)).resolves.toMatchObject({ rls_force_tables: 19 });
    const badRole = { $queryRaw: async () => [{ name: "mvp_service_runtime", super: true, bypass: false }] } as unknown as PrismaClient;
    await expect(assertPhaseADatabase(admin, badRole)).rejects.toThrow("PHASE_A_RUNTIME_ROLE");
  });
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
