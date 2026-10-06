import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Request budget through the real plan path: a message whose interpretation request cannot fit the cap even degraded
 * is refused before any model call; the active plan is kept exactly (no action failed, proposals intact) and the owner
 * reads the pt-BR request to split it. Fixtures as in the B5 runtime test; no DB, no network. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], directory: undefined as unknown }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => db.directory,
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /rodrigo/i.test(filter.query ?? "") ? [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] : [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: ref === "a-fabio" ? "2026-09-30T16:00" : "2026-10-01T11:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /f[aá]bio/i.test(name) ? [{ id: "c-fabio", name: "Fábio Santos" }] : /amanda/i.test(name) ? [{ id: "c-amanda", name: "Amanda Souza" }] : [] }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const plusHour = (time: string) => `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`;
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => f.customer_ref === "c-fabio" ? [{ appointment_ref: "a-fabio" }] : f.customer_ref === "c-amanda" ? [{ appointment_ref: "a-amanda" }] : [],
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse(operation === "schedule.block"
      ? { ...base, kind: operation, professional_ref: "pro-rodrigo", professional_name: "Rodrigo Lima", startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}` }
      : operation === "appointment.change"
        ? { ...base, kind: operation, appointment_ref: "a-fabio", revision: 1, customer_ref: "c-fabio", customer_name: "Fábio Santos", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
          before_start: "2026-09-30T16:00", before_end: "2026-09-30T17:00", before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${plusHour(f.time)}`, priceCents: 8000 }
        : { ...base, kind: operation, appointment_ref: "a-amanda", revision: 1, customer_ref: "c-amanda", customer_name: "Amanda Souza", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
          before_start: "2026-10-01T11:00", before_end: "2026-10-01T12:00", before_timezone: "America/Sao_Paulo", startLocal: "2026-10-01T11:00", endLocal: "2026-10-01T12:00", priceCents: 9000 }) };
});
import { requestTooLargeMessage, secretaryContractVersion } from "@everflair/salon-secretary";
import { backendPresentationDigest } from "../secretary-presentation-contract";
import { turnRequestBudget } from "../../../packages/salon-secretary/evaluation/free-use-runner";
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";
import type { TurnOutcome } from "../secretary-router";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = []; db.directory = undefined;
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const outcomes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome: TurnOutcome }).outcome);
/** A salon whose published team and catalog alone exceed the request cap (degradation never trims the directory). */
const oversized = { professionals: Array.from({ length: 300 }, (_, i) => `Profissional Sintética de Nome Longo ${i}`), services: Array.from({ length: 700 }, (_, i) => `Serviço Sintético de Nome Bem Longo ${i}`),
  today: { date: "2026-09-28", weekday: "segunda-feira", timezone: "America/Sao_Paulo" } };

describe("a request that cannot fit is refused and the plan is kept", () => {
  it("several pending actions: no model call, nothing failed or withdrawn, the owner is asked to split the request", async () => {
    const model = new ScriptedServicesModel([call("select_capabilities", JSON.parse(V01_LUNA))]);
    const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
    const session = await secretary.start(actor, "auto");
    const before = await secretary.send(actor, { sessionId: session.sessionId, message: V01_MESSAGE });
    const plan = before.action_plan!, ready = (view: SecretaryView) => view.operations!.flatMap(op => (op.state as SecretaryView).scheduling?.proposal ? op.action_keys ?? [] : []);
    expect(plan.actions.map(action => action.status)).toEqual(["NEEDS_INPUT", "NEEDS_INPUT", "READY_FOR_CONFIRMATION"]);
    db.directory = oversized;
    const kept = await secretary.send(actor, { sessionId: session.sessionId, message: "amanhã e ela viajou" });
    expect(model.requests).toHaveLength(1); // only the first turn reached the model
    expect(kept.message).toBe(requestTooLargeMessage); expect(kept.turn_notice).toBe(requestTooLargeMessage);
    expect(kept.action_plan!.plan_ref).toBe(plan.plan_ref); expect(kept.action_plan!.revision).toBeGreaterThan(plan.revision);
    expect(kept.action_plan!.actions.map(action => [action.status, action.assessment.issue])).toEqual(plan.actions.map(action => [action.status, action.assessment.issue]));
    expect(kept.action_plan!.actions.some(action => action.status === "FAILED_SAFE")).toBe(false);
    expect(ready(kept)).toEqual(ready(before));
    const outcome = outcomes()[1];
    expect(outcome).toMatchObject({ kind: "NOT_UNDERSTOOD", request_budget: { requests: 1, rejected: 1, steps: ["STRUCTURED_CONTEXT", "JIT_APPENDIX"] } });
    expect(outcome.divergence.failed_codes).toContain("SECRETARY_REQUEST_TOO_LARGE");
    expect(outcome.request_budget!.final_bytes + 8192).toBeGreaterThan(64000);
    // Review: the configured turn keeps the recorded contract; the turn the budget rewrote/refused names its own.
    const contract = (requestBudget?: string[]) => secretaryContractVersion({ modelId: "gpt-6-luna", presentation: backendPresentationDigest(), requestBudget });
    expect(outcomes()[0].request_budget).toBeUndefined(); expect(outcomes()[0].contract_version).toBe(contract());
    expect(outcome.contract_version).toBe(contract(["JIT_APPENDIX", "STRUCTURED_CONTEXT"])); expect(outcome.contract_version).not.toBe(contract());
    expect(contract(["SUSPENDED_TRIMMED"])).not.toBe(contract(["STRUCTURED_CONTEXT", "JIT_APPENDIX"])); expect(contract(["NOT_A_STEP"])).toBe(contract());
    // The Golden runner records it per turn from the same router row (absent on configured turns: historical shape).
    const routers = db.rows.filter(row => row.entityType === "SECRETARY_ROUTER");
    expect(turnRequestBudget(routers[0].metadata)).toBeUndefined();
    expect(turnRequestBudget(routers[1].metadata)).toEqual({ steps: ["STRUCTURED_CONTEXT", "JIT_APPENDIX"], rejected: 1, contractVersion: contract(["JIT_APPENDIX", "STRUCTURED_CONTEXT"]) });
  });
  it("the first message of a conversation (no plan) fails with the stable code the Server Action maps", async () => {
    db.directory = oversized;
    const model = new ScriptedServicesModel([]);
    const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
    const session = await secretary.start(actor, "auto");
    await expect(secretary.send(actor, { sessionId: session.sessionId, message: "marca a paula amanha as 10" })).rejects.toThrow("SECRETARY_REQUEST_TOO_LARGE");
    expect(model.requests).toHaveLength(0);
    expect(outcomes()[0]).toMatchObject({ kind: "ERROR", error_code: "SECRETARY_REQUEST_TOO_LARGE", request_budget: { requests: 1, rejected: 1, steps: ["JIT_APPENDIX"] } });
  });
});
