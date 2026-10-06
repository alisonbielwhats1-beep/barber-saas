import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessPlanAction, createActionPlan, type ActionPlan } from "@everflair/salon-secretary";
import { SalonSecretary } from "../salon-secretary";

/** markIntraPlanConflicts runs on already prepared children. These tests build the prepared
 * state directly (no DB, no model) and read only the backend-derived plan and child views. */
const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
type Claim = { key: string; operation: "appointment.create" | "appointment.change" | "schedule.block"; professional: string; name: string;
  start: string; end: string; customer?: string; batch?: boolean };
const op = (key: string, operation: string) => ({ operation, item_key: key, depends_on: [], released_slot_of: null, source_scope: null,
  target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] });

function prepared(claims: Claim[]) {
  const secretary = new SalonSecretary(async () => { throw Error("NO_MODEL"); });
  const sessions = (secretary as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions;
  const operations = claims.flatMap(claim => claim.batch ? [{ ...op(`${claim.key}_cancel`, "appointment.cancel") },
    { ...op(claim.key, "appointment.create"), depends_on: [`${claim.key}_cancel`], released_slot_of: `${claim.key}_cancel` }] : [op(claim.key, claim.operation)]);
  let plan: ActionPlan = createActionPlan({ skills: ["scheduling"], independent: !claims.some(claim => claim.batch), operations } as never);
  const parent: Record<string, unknown> & { actionUnits: { keys: string[]; kind: string; child?: string }[]; children: string[] } = {
    id: randomUUID(), actor, skill: "auto", expires: Date.now() + 20 * 60_000, busy: false, turns: 1, cancelled: false, actionUnits: [], children: [] };
  sessions.set(parent.id as string, parent);
  const children: Record<string, Record<string, unknown>> = {};
  for (const claim of claims) {
    const id = randomUUID(), proposal = { proposal_ref: randomUUID(), draft_revision: 1, payload_hash: "h".repeat(64), preview: `preview ${claim.key}`, expires_at: future() };
    const slot = { professional_ref: claim.professional, professional_name: claim.name, startLocal: claim.start, endLocal: claim.end };
    const child: Record<string, unknown> = { id, actor, skill: "scheduling", planOwner: parent.id, expires: parent.expires, busy: false, turns: 0, cancelled: false };
    if (claim.batch) {
      const items = [{ key: `${claim.key}_cancel`, operation: "appointment.cancel", depends_on: [], fields: { customer_name: "Amanda", reason: "ela viajou" } },
        { key: claim.key, operation: "appointment.create", depends_on: [`${claim.key}_cancel`], released_slot_of: `${claim.key}_cancel`, fields: { customer_name: claim.customer ?? "Fábio", service_name: "Corte" } }];
      const batchPlan = { execution_policy: "all_or_nothing", items };
      child.batch = { operation: "action.batch", plan: batchPlan, message: `preview ${claim.key}`, metrics: {}, interpretation_source: "MODEL", proposal,
        draft: { draft_ref: randomUUID(), draft_revision: 1, status: "READY", missing_fields: [], plan: batchPlan, message: "ok",
          snapshot: { cancel: { professional_ref: claim.professional }, create: { ...slot, customer_name: claim.customer ?? "Fábio" } } } };
      parent.actionUnits.push({ keys: [`${claim.key}_cancel`, claim.key], kind: "scheduling-batch", child: id });
    } else {
      const snapshot = { kind: claim.operation, ...slot, ...(claim.customer ? { customer_name: claim.customer } : {}) };
      child.scheduling = { operation: claim.operation, fields: {}, message: `preview ${claim.key}`, metrics: {}, proposal,
        draft: { draft_ref: randomUUID(), draft_revision: 1, missing_fields: [], ...(claim.operation === "appointment.create" ? { snapshot } : { action_snapshot: snapshot }) } };
      parent.actionUnits.push({ keys: [claim.key], kind: "single", child: id });
    }
    sessions.set(id, child); parent.children.push(id); children[claim.key] = child;
    for (const key of claim.batch ? [`${claim.key}_cancel`, claim.key] : [claim.key])
      plan = assessPlanAction(plan, key, { status: "READY_FOR_CONFIRMATION", missing_fields: [], preview: `preview ${key}`, proposal_token: `${proposal.proposal_ref}:1:${"h".repeat(64)}` });
  }
  parent.actionPlan = plan;
  const changed = (secretary as unknown as { markIntraPlanConflicts(s: unknown): boolean }).markIntraPlanConflicts(parent);
  const status = (key: string) => (parent.actionPlan as ActionPlan).actions.find(action => action.key === key)!;
  const state = (key: string) => (children[key].scheduling ?? children[key].batch) as { message: string; waiting_for?: string; proposal?: unknown };
  return { changed, status, state, plan: () => parent.actionPlan as ActionPlan };
}
const rodrigo = { professional: "pro-rodrigo", name: "Rodrigo Lima" };
const day = "2026-09-29";

describe("intra-request conflicts: a block of this same request wins over an appointment, in any operation order", () => {
  it.each([
    ["block before the change", ["block", "move"]],
    ["change before the block (Luna order reversed)", ["move", "block"]],
  ])("%s: the block keeps its proposal; the appointment becomes a causal time question", (_label, order) => {
    const claims: Record<string, Claim> = {
      block: { key: "block", operation: "schedule.block", ...rodrigo, start: `${day}T10:00`, end: `${day}T11:00` },
      move: { key: "move", operation: "appointment.change", ...rodrigo, customer: "Fábio Santos", start: `${day}T10:00`, end: `${day}T10:45` },
    };
    const run = prepared(order.map(key => claims[key]));
    expect(run.changed).toBe(true);
    expect(run.status("block").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.state("block").proposal).toBeDefined();
    expect(run.status("move")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["time"] });
    expect(run.state("move").proposal).toBeUndefined();
    expect(run.state("move").waiting_for).toBe("time");
    expect(run.state("move").message).toContain("a agenda de Rodrigo Lima estará bloqueada das 10h às 11h neste mesmo pedido.");
    expect(run.state("move").message).toMatch(/Qual outro horário você prefere\?$/);
    expect(run.plan().confirmation_groups.every(group => group.status !== "READY_FOR_CONFIRMATION")).toBe(true);
  });
  it("a new appointment inside a block of the same request is questioned too", () => {
    const run = prepared([
      { key: "carla", operation: "appointment.create", ...rodrigo, customer: "Carla", start: `${day}T10:30`, end: `${day}T11:15` },
      { key: "block", operation: "schedule.block", ...rodrigo, start: `${day}T10:00`, end: `${day}T11:00` },
    ]);
    expect(run.status("block").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.status("carla").status).toBe("NEEDS_INPUT");
  });
});

describe("intra-request conflicts between appointments keep the historical order rule", () => {
  it("the later of two overlapping appointments on one professional asks another time", () => {
    const run = prepared([
      { key: "amanda", operation: "appointment.create", ...rodrigo, customer: "Amanda", start: `${day}T10:00`, end: `${day}T11:00` },
      { key: "carla", operation: "appointment.create", ...rodrigo, customer: "Carla", start: `${day}T10:30`, end: `${day}T11:30` },
    ]);
    expect(run.status("amanda").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.status("carla")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["time"] });
    expect(run.state("carla").message).toContain("Rodrigo Lima já estará com Amanda das 10h às 11h neste mesmo pedido.");
  });
  it.each([
    ["another professional", { professional: "pro-tatiana", name: "Tatiana Rocha" }, "10:00", "11:00"],
    ["back-to-back slots", rodrigo, "11:00", "12:00"],
  ])("%s never conflicts", (_label, pro, start, end) => {
    const run = prepared([
      { key: "block", operation: "schedule.block", ...rodrigo, start: `${day}T10:00`, end: `${day}T11:00` },
      { key: "carla", operation: "appointment.create", ...pro, customer: "Carla", start: `${day}T${start}`, end: `${day}T${end}` },
    ]);
    expect(run.changed).toBe(false);
    expect(run.status("block").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.status("carla").status).toBe("READY_FOR_CONFIRMATION");
  });
});

describe("the atomic cancel→create pair claims its created slot", () => {
  it("the pair's new slot and a single appointment never both stay confirmable (execution order decides)", () => {
    const run = prepared([
      { key: "fabio", operation: "appointment.create", ...rodrigo, customer: "Fábio", start: `${day}T10:00`, end: `${day}T10:45`, batch: true },
      { key: "carla", operation: "appointment.create", ...rodrigo, customer: "Carla", start: `${day}T10:30`, end: `${day}T11:15` },
    ]);
    const order = run.plan().execution_order.filter(key => key === "fabio" || key === "carla");
    const [first, later] = order;
    expect(run.status(first).status).toBe("READY_FOR_CONFIRMATION");
    expect(run.status(later)).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["time"] });
    expect(run.state(later).proposal).toBeUndefined();
    expect(run.status(later).assessment.preview ?? run.state(later).message).toContain(first === "fabio" ? "já estará com Fábio das 10h às 10h45 neste mesmo pedido." : "já estará com Carla das 10h30 às 11h15 neste mesmo pedido.");
  });
  it("a block of the same request makes the pair's appointment a question and withdraws the pair's single proposal", () => {
    const run = prepared([
      { key: "fabio", operation: "appointment.create", ...rodrigo, customer: "Fábio", start: `${day}T10:00`, end: `${day}T10:45`, batch: true },
      { key: "block", operation: "schedule.block", ...rodrigo, start: `${day}T10:00`, end: `${day}T11:00` },
    ]);
    expect(run.status("block").status).toBe("READY_FOR_CONFIRMATION");
    expect(run.state("fabio").proposal).toBeUndefined();
    expect(run.status("fabio")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["time"] });
    expect(run.status("fabio").assessment.preview).toContain("a agenda de Rodrigo Lima estará bloqueada das 10h às 11h neste mesmo pedido.");
    expect(run.status("fabio_cancel").status).not.toBe("READY_FOR_CONFIRMATION");
  });
});

describe("no two proposals of one request ever claim the same professional time", () => {
  it("three overlapping claims leave exactly one confirmable card (the block)", () => {
    const run = prepared([
      { key: "amanda", operation: "appointment.create", ...rodrigo, customer: "Amanda", start: `${day}T10:00`, end: `${day}T10:45` },
      { key: "move", operation: "appointment.change", ...rodrigo, customer: "Fábio", start: `${day}T10:30`, end: `${day}T11:15` },
      { key: "block", operation: "schedule.block", ...rodrigo, start: `${day}T09:00`, end: `${day}T12:00` },
    ]);
    const ready = run.plan().actions.filter(action => action.status === "READY_FOR_CONFIRMATION").map(action => action.key);
    expect(ready).toEqual(["block"]);
  });
});
