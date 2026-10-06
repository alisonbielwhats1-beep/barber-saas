import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessPlanAction, createActionPlan } from "@everflair/salon-secretary";
import { decodeInventoryQuantityPayload, inventoryInterpretation } from "../../../packages/salon-secretary/src/inventory-skill";
import fixture from "../../test/fixtures/secretary-real-wire-holdout-v2-v208-inventory.json";
import totalFixture from "../../test/fixtures/secretary-real-wire-holdout-v2-v223-inventory.json";
import { intent } from "../../test/secretary-capability-plan";
import { applyInventoryInterpretation, inventoryState } from "../secretary-inventory";
import { assessmentFromView, collectedActionFields } from "../secretary-action-plan";
import { planConversationContext, secretaryPlanMessage } from "../secretary-presentation";
import type { Tx } from "../prisma-tenant";

const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../inventory-catalog", async original => ({ ...await original<object>(), assertInventoryAccess: async () => undefined,
  searchProducts: async () => [{ id: "spray", name: "Spray Brisa", stock: 9, minStock: 2, active: true, unit: "un", revision: "a".repeat(64) }],
  getProduct: async () => ({ id: "spray", name: "Spray Brisa", stock: 9, minStock: 2, active: true, unit: "un", revision: "a".repeat(64) }),
}));
vi.mock("../inventory-reference-catalog", () => ({ inventoryReferenceCatalog: async () => [{ id: "spray", name: "Spray Brisa" }] }));
type Row = Record<string, unknown>;
let rows: Row[];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2028-06-12T12:00:00Z")); rows = [];
  const filter = (where: Row) => rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Row }) => { rows.push(structuredClone(data)); return data; }),
    findMany: vi.fn(async ({ where }: { where: Row }) => filter(where)), findFirst: vi.fn(async ({ where }: { where: Row }) => filter(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("observed V208 inventory projection with original source and provider output", () => {
  it("keeps the count in the draft, proposal, plan and clarification context without a repeated quantity question", async () => {
    const wire = fixture.provider_observations[1].output[0].arguments;
    const decoded = decodeInventoryQuantityPayload(JSON.parse(wire), true) as { turn: { operations: Array<{ operation: string; item_key: string; source_scope: string; inventory?: object }> } };
    const op = decoded.turn.operations.find(value => value.operation === "stock.movement")!;
    const others = decoded.turn.operations.filter(value => value !== op).map(value => ({ key: value.item_key, operation: value.operation, literal: value.source_scope }));
    const input = inventoryInterpretation.parse({ ...op.inventory, source_scope: op.source_scope, operation: op.operation });
    const state = inventoryState();
    await applyInventoryInterpretation({ salonId: "tenant", userId: "owner" }, state, input, fixture.turns[0].source, undefined, others);
    expect(state.quantity_resolution).toMatchObject({ status: "ACCEPTED", quantity: 3 });
    expect(state.fields.quantity).toBe(3);
    expect(state.draft).toMatchObject({ fields: { quantity: 3 }, missing_fields: [], product: { id: "spray", stock: 9 } });
    expect(state.proposal).toMatchObject({ delta: 3, projected_stock: 12, product: { id: "spray", stock: 9 } });
    expect(state.pending_quantity_source).toBeUndefined();
    // The SDK's transport decoder supplies neutral internal fields before plan
    // construction. Materialize those defaults without changing the raw input.
    let plan = createActionPlan({ skills: ["inventory"], independent: true, operations: [intent(op.operation, op)] });
    const action = plan.actions[0], view = { sessionId: "inventory", cancelled: false, inventory: state, message: state.message };
    action.fields = collectedActionFields(view, action);
    plan = assessPlanAction(plan, action.key, assessmentFromView(view, action));
    expect(plan.actions[0]).toMatchObject({ status: "READY_FOR_CONFIRMATION", missing_fields: [], fields: { inventory: { quantity: 3 } } });
    const units = [{ keys: [action.key], kind: "single" as const, child: "inventory" }], children = [{ operation_ref: "inventory", state: view }];
    expect(secretaryPlanMessage(plan, units, children)).not.toMatch(/Quantas unidades|informar.*quantidade/i);
    expect(planConversationContext(plan, units, children).actions[0].clarification.requested_field).not.toBe("quantity");
    // The observed second turn updates only another action. Inventory state is
    // already complete; no inferred quantity or replay of history is necessary.
    const next = JSON.parse(fixture.provider_observations[2].output[0].arguments);
    expect(next.turn.operations.map((patch: { item_key: string }) => patch.item_key)).not.toContain(op.item_key);
    expect(state.fields.quantity).toBe(3);
    expect(rows.some(row => row.action === "CONFIRMED")).toBe(false);
  });
  it("replays V223's original packaging clarification and supplied total on the same draft", async () => {
    const rawFirst = decodeInventoryQuantityPayload(JSON.parse(totalFixture.provider_observations[0].output[0].arguments), true) as { turn: { operations: Array<{ source_scope: string; inventory: object }> } };
    const rawReply = decodeInventoryQuantityPayload(JSON.parse(totalFixture.provider_observations[2].output[0].arguments), true) as { turn: { operations: Array<{ fields: { source_scope: string; inventory: object } }> } };
    const first = rawFirst.turn.operations[0], reply = rawReply.turn.operations[0].fields;
    const state = inventoryState(), actor = { salonId: "tenant", userId: "owner" };
    await applyInventoryInterpretation(actor, state, inventoryInterpretation.parse({ ...first.inventory, source_scope: first.source_scope, operation: "stock.movement" }), totalFixture.turns[0].source);
    expect(state.quantity_resolution).toMatchObject({ status: "NEEDS_INPUT", cause: "UNIT_UNPROVEN", count: 3 });
    expect(state.proposal).toBeUndefined();
    expect(state.draft?.missing_fields).toEqual(["quantity"]);
    const originalDraft = state.draft!.draft_ref;
    await applyInventoryInterpretation(actor, state, inventoryInterpretation.parse({ ...reply.inventory, source_scope: reply.source_scope }), totalFixture.turns[1].source);
    expect(state.draft).toMatchObject({ draft_ref: originalDraft, draft_revision: 2, fields: { quantity: 12 }, missing_fields: [] });
    expect(state.quantity_resolution).toMatchObject({ status: "ACCEPTED", quantity: 12 });
    expect(state.proposal).toMatchObject({ delta: 12, projected_stock: 21, product: { id: "spray", stock: 9 } });
    expect(state.message).not.toMatch(/Quantas unidades/);
    expect(rows.some(row => row.action === "CONFIRMED")).toBe(false);
  });
});
