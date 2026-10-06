import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** P3a D3 (flag SALON_SECRETARY_REFERENCES_V2 with SALON_SECRETARY_SAME_AS): the atomic cancel→create pair marks its create
 * `service_follows_released` only when "o mesmo serviço" is PROVEN in the create's own clause (identity marker, never negated,
 * present in this message). The journal/draft is a fixture: this checks only the plan the batch is started with. */
const captured = vi.hoisted(() => ({ plans: [] as { items: Record<string, unknown>[] }[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo" }));
vi.mock("../scheduling-batch", async original => ({ ...await original<object>(),
  upsertBatchDraft: async (_tx: unknown, _actor: unknown, input: { plan: { items: Record<string, unknown>[] } }) => {
    captured.plans.push(input.plan);
    return { status: "NEEDS_INPUT", plan: input.plan, draft_ref: crypto.randomUUID(), draft_revision: 1, message: "", metrics: {}, missing_fields: [] };
  } }));
import { startBatch, startReleasedSlotBatch } from "../secretary-batch";
import type { CapabilitySelection } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-studio", userId: "synthetic-owner" };
const neutral = { target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
const cancelScope = "cancela a Iara amanhã às 10h porque ela viajou";
const selection = (createScope: string, literal = "pro mesmo serviço"): CapabilitySelection => ({ skills: ["scheduling"], independent: false, operations: [
  { ...neutral, operation: "appointment.cancel", item_key: "a", depends_on: [], released_slot_of: null, source_scope: cancelScope, customer_name: "Iara", day_offset: 1, time: "10:00", reason: "porque ela viajou",
    temporal_evidence: [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }] },
  { ...neutral, operation: "appointment.create", item_key: "b", depends_on: ["a"], released_slot_of: "a", source_scope: createScope, customer_name: "Téo", same_as: [{ field: "service", item_key: "a", literal }] },
] } as unknown as CapabilitySelection);
const follows = () => captured.plans.at(-1)!.items.find(item => item.key === "b")!.service_follows_released;
beforeEach(() => { captured.plans = []; vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("D3 proof for the atomic pair", () => {
  it("proven in the create's clause: the item follows the released service", async () => {
    const scope = "coloca o Téo no lugar dela pro mesmo serviço";
    await startBatch(actor, selection(scope), `${cancelScope} e ${scope}`);
    expect(follows()).toBe(true);
  });
  it.each([
    ["negated", "coloca o Téo no lugar dela, não pro mesmo serviço, pra escova", "pro mesmo serviço"],
    ["absent from the message (another turn)", "coloca o Téo no lugar dela", "pro mesmo serviço"],
    ["without an identity marker", "coloca o Téo no lugar dela pra corte", "pra corte"],
  ])("%s: never followed (the service is the owner's own or asked)", async (_label, scope, literal) => {
    await startBatch(actor, selection(scope, literal), `${cancelScope} e ${scope}`);
    expect(follows()).toBeUndefined();
  });
  it("a later turn (ADD) into a pending cancellation: the link is proven in that turn's message", async () => {
    const message = "coloca o Téo no lugar dela pro mesmo serviço", create = selection(message).operations[1];
    await startReleasedSlotBatch(actor, { key: "a", fields: { customer_name: "Iara", reason: "porque ela viajou", date: "2026-09-29", time: "10:00" } }, create, message);
    expect(follows()).toBe(true);
    await startReleasedSlotBatch(actor, { key: "a", fields: { customer_name: "Iara", reason: "porque ela viajou", date: "2026-09-29", time: "10:00" } }, create, "coloca o Téo no lugar dela");
    expect(follows()).toBeUndefined();
  });
  it("either flag off: never followed", async () => {
    const scope = "coloca o Téo no lugar dela pro mesmo serviço";
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    await startBatch(actor, selection(scope), `${cancelScope} e ${scope}`);
    expect(follows()).toBeUndefined();
  });
});
