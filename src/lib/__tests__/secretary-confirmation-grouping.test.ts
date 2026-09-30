import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionPlanPreview, admitConfirmationBatch, assessPlanAction, confirmationGroupContent, createActionPlan, defaultReviewConfiguration,
  executeConfirmationGroup, multiActionConfiguration, reviewConfiguration, runtimeConfirmationGrouping, runtimeReviewConfiguration,
  type ActionPlan, type ReviewConfiguration } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";

/** B2 "confirm what is ready": grouping policy, batch admission and the composed message. Pure library, offline. */
const component: ReviewConfiguration = { ...defaultReviewConfiguration, grouping: "component" };
type Op = ReturnType<typeof intent> & { depends_on?: string[] };
const service = (key: string, depends_on: string[] = []) => intent("service.create", { item_key: key, depends_on, name: `Serviço ${key}`, priceCents: 8000, durationMin: 30 });
const selection = (operations: Op[]) => ({ ...plan(operations), independent: !operations.some(op => op.depends_on?.length) });
function prepared(input: unknown, policy: ReviewConfiguration = component): ActionPlan {
  let result = createActionPlan(input, policy);
  for (const action of result.actions) result = assessPlanAction(result, action.key, action.mutation ?
    { status: "READY_FOR_CONFIRMATION", missing_fields: [], proposal_token: `token-${action.key}`, preview: `Preview ${action.key}` } :
    { status: "DONE", missing_fields: [], preview: "Leitura backend" });
  return result;
}
const groupOf = (p: ActionPlan, key: string) => p.confirmation_groups.find(group => group.action_keys.includes(key))!;
const approval = (p: ActionPlan, key: string) => { const group = groupOf(p, key);
  return { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }; };
const needs = (p: ActionPlan, key: string, missing: string[]) => assessPlanAction(p, key, { status: "NEEDS_INPUT", missing_fields: missing });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("per-component confirmation groups", () => {
  it("three independent actions are three groups; the library default keeps packing them into one", () => {
    const p = prepared(selection([service("a"), service("b"), service("c")]));
    expect(p.confirmation_groups.map(group => [group.key, group.action_keys, group.status])).toEqual([
      ["group_1", ["a"], "READY_FOR_CONFIRMATION"], ["group_2", ["b"], "READY_FOR_CONFIRMATION"], ["group_3", ["c"], "READY_FOR_CONFIRMATION"]]);
    expect(p.policy).toEqual({ normalReviewMax: 5, maxActionsPerConfirmationGroup: 10, grouping: "component" });
    const packed = prepared(selection([service("a"), service("b"), service("c")]), defaultReviewConfiguration);
    expect(packed.confirmation_groups.map(group => group.action_keys)).toEqual([["a", "b", "c"]]);
    expect(packed.policy).toEqual({ normalReviewMax: 5, maxActionsPerConfirmationGroup: 10 }); // absent = packed, fingerprints unchanged
  });
  it("one action's missing field never blocks another independent action", () => {
    const p = needs(prepared(selection([service("a"), service("b"), service("c")])), "b", ["durationMin"]);
    expect(p.confirmation_groups.map(group => group.status)).toEqual(["READY_FOR_CONFIRMATION", "NEEDS_REVIEW", "READY_FOR_CONFIRMATION"]);
    expect(p.status).toBe("NEEDS_INPUT");
    const packed = needs(prepared(selection([service("a"), service("b"), service("c")]), defaultReviewConfiguration), "b", ["durationMin"]);
    expect(packed.confirmation_groups.map(group => group.status)).toEqual(["NEEDS_REVIEW"]);
  });
  it("the released-slot cancel→create pair and its cancel→message stay one group; never split by readiness", () => {
    const content = "Seu horário foi cancelado.";
    const input = selection([
      intent("appointment.cancel", { item_key: "a", depends_on: [], customer_name: "Amanda Souza", day_offset: 1, time: "10:00", reason: "Pedido dela" }),
      intent("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a", customer_name: "Fábio Santos", service_name: "Corte Completo" }),
      intent("service.change", { item_key: "c", depends_on: [], target_name: "Massagem", priceCents: 8000 }),
      intent("customer.message", { item_key: "e", depends_on: ["a"], communication: { recipient_name: "Amanda Souza", channel: "WHATSAPP", message_mode: "EXACT", content } }),
    ]);
    const p = prepared(input);
    expect(p.confirmation_groups.map(group => group.action_keys)).toEqual([["a", "b", "e"], ["c"]]);
    const waiting = needs(p, "b", ["service_name"]);
    expect(waiting.confirmation_groups.map(group => [group.action_keys, group.status])).toEqual([[["a", "b", "e"], "NEEDS_REVIEW"], [["c"], "READY_FOR_CONFIRMATION"]]);
    const pair = prepared(selection([intent("appointment.cancel", { item_key: "x", depends_on: [], customer_name: "João", reason: "Pedido dele" }),
      intent("customer.message", { item_key: "y", depends_on: ["x"], communication: { recipient_name: "João", channel: "WHATSAPP", message_mode: "EXACT", content } })]));
    expect(pair.confirmation_groups.map(group => group.action_keys)).toEqual([["x", "y"]]);
  });
  it("an oversized component stays one intact SPECIAL_REVIEW group and never executes; an independent action is unaffected", async () => {
    const chain = Array.from({ length: 12 }, (_, i) => service(`a${i}`, i ? [`a${i - 1}`] : []));
    const p = prepared(selection([...chain, service("x")]));
    expect(p.confirmation_groups).toMatchObject([
      { action_keys: Array.from({ length: 12 }, (_, i) => `a${i}`), review: "SPECIAL_REVIEW", status: "SPECIAL_REVIEW" },
      { action_keys: ["x"], review: "NORMAL_REVIEW", status: "READY_FOR_CONFIRMATION" }]);
    const executor = vi.fn(async () => ({ status: "DONE" as const, missing_fields: [] }));
    await expect(executeConfirmationGroup(p, approval(p, "a0"), executor)).rejects.toThrow("SPECIAL_REVIEW_REQUIRED");
    expect(executor).not.toHaveBeenCalled();
    expect(() => admitConfirmationBatch(p, [approval(p, "x"), approval(p, "a0")])).toThrow("CONFIRMATION_STALE");
  });
  it("fingerprint formula is unchanged: plan_ref, revision, policy and members including the proposal token", async () => {
    const p = prepared(selection([service("a"), service("b")]));
    const packed = createActionPlan(selection([service("a"), service("b")]), defaultReviewConfiguration);
    expect(p.confirmation_groups[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    // Executing one group keeps the approved revision; the other group's fingerprint and content stay valid.
    const next = await executeConfirmationGroup(p, approval(p, "a"), async () => ({ status: "DONE", missing_fields: [] }));
    expect(next.revision).toBe(p.revision);
    expect(groupOf(next, "b").fingerprint).toBe(groupOf(p, "b").fingerprint);
    expect(confirmationGroupContent(next, ["b"])).toBe(confirmationGroupContent(p, ["b"]));
    // A new proposal token for b changes b's content; a's content (not its revision-bound fingerprint) is unchanged.
    const retoken = assessPlanAction(p, "b", { status: "READY_FOR_CONFIRMATION", missing_fields: [], proposal_token: "token-b-2", preview: "Preview b" });
    expect(retoken.revision).toBe(p.revision + 1);
    expect(confirmationGroupContent(retoken, ["b"])).not.toBe(confirmationGroupContent(p, ["b"]));
    expect(confirmationGroupContent(retoken, ["a"])).toBe(confirmationGroupContent(p, ["a"]));
    expect(groupOf(retoken, "a").fingerprint).not.toBe(groupOf(p, "a").fingerprint);
    expect(packed.confirmation_groups[0].fingerprint).not.toBe(p.confirmation_groups[0].fingerprint); // policy is bound
  });
});

describe("runtime grouping configuration", () => {
  it("defaults to per component; SALON_SECRETARY_CONFIRMATION_GROUPING=packed restores packing; anything else fails closed", () => {
    expect(runtimeConfirmationGrouping({})).toBe("component");
    expect(runtimeConfirmationGrouping({ SALON_SECRETARY_CONFIRMATION_GROUPING: "" })).toBe("component");
    expect(runtimeConfirmationGrouping({ SALON_SECRETARY_CONFIRMATION_GROUPING: "packed" })).toBe("packed");
    expect(() => runtimeConfirmationGrouping({ SALON_SECRETARY_CONFIRMATION_GROUPING: "PACKED" })).toThrow();
    expect(runtimeReviewConfiguration({})).toEqual({ normalReviewMax: 5, maxActionsPerConfirmationGroup: 10, grouping: "component" });
    expect(multiActionConfiguration({}).policy.grouping).toBe("component");
    expect(multiActionConfiguration({ SALON_SECRETARY_CONFIRMATION_GROUPING: "packed" }).policy.grouping).toBe("packed");
    expect(() => reviewConfiguration.parse({ ...defaultReviewConfiguration, grouping: "per_action" })).toThrow();
  });
});

describe("batch admission: all approvals against ONE current plan before anything runs", () => {
  const p = prepared(selection([service("a", []), service("b", ["a"]), service("c"), service("d")]));
  it("returns every admitted group in execution order with its content snapshot", () => {
    const admitted = admitConfirmationBatch(p, [approval(p, "d"), approval(p, "a"), approval(p, "c")]);
    expect(admitted.map(item => item.action_keys)).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(admitted[0].content).toBe(confirmationGroupContent(p, ["a", "b"]));
  });
  it.each([
    ["fingerprint", (value: ReturnType<typeof approval>) => ({ ...value, fingerprint: "0".repeat(64) })],
    ["revision", (value: ReturnType<typeof approval>) => ({ ...value, revision: value.revision + 1 })],
    ["plan", (value: ReturnType<typeof approval>) => ({ ...value, plan_ref: crypto.randomUUID() })],
    ["group", (value: ReturnType<typeof approval>) => ({ ...value, group_key: "group_9" })],
  ])("one mismatched %s rejects the whole batch", (_label, tamper) => {
    expect(() => admitConfirmationBatch(p, [approval(p, "a"), tamper(approval(p, "c")), approval(p, "d")])).toThrow("CONFIRMATION_STALE");
  });
  it("a group that is not ready, or already done, rejects the batch; a repeated group is an invalid request", async () => {
    const waiting = needs(p, "c", ["name"]);
    expect(() => admitConfirmationBatch(waiting, [approval(waiting, "a"), approval(waiting, "c")])).toThrow("CONFIRMATION_STALE");
    const done = await executeConfirmationGroup(p, approval(p, "d"), async () => ({ status: "DONE", missing_fields: [] }));
    expect(groupOf(done, "d").status).toBe("DONE");
    expect(() => admitConfirmationBatch(done, [approval(done, "a"), approval(done, "d")])).toThrow("CONFIRMATION_STALE");
    expect(() => admitConfirmationBatch(p, [approval(p, "a"), approval(p, "a")])).toThrow("CONFIRMATION_BATCH_INVALID");
  });
});

describe("composed message names what can already be confirmed, then keeps one natural question", () => {
  const owner = () => selection([
    intent("appointment.change", { item_key: "fabio", depends_on: [], customer_name: "Fábio", day_offset: 1, time: "10:00" }),
    intent("appointment.cancel", { item_key: "amanda", depends_on: [], customer_name: "Amanda" }),
    intent("schedule.block", { item_key: "rodrigo", depends_on: [], professional_name: "Rodrigo", date: "2026-09-29", time: "10:00", end_time: "11:00" }),
  ]);
  it("owner's request: change and block are confirmable, the cancel asks only its reason", () => {
    const p = needs(prepared(owner()), "amanda", ["reason"]);
    expect(p.confirmation_groups.map(group => group.status)).toEqual(["READY_FOR_CONFIRMATION", "NEEDS_REVIEW", "READY_FOR_CONFIRMATION"]);
    const text = actionPlanPreview(p);
    expect(text).toBe("Já dá para confirmar: remarcação de Fábio e bloqueio de Rodrigo.\n\nQual o motivo do cancelamento?");
    expect(text.match(/\?/g)).toHaveLength(1);
  });
  it("packed plans (nothing confirmable yet) keep the validated single question exactly", () => {
    expect(actionPlanPreview(needs(prepared(owner(), defaultReviewConfiguration), "amanda", ["reason"]))).toBe("Qual o motivo do cancelamento?");
  });
  it("with two questions the lead replaces the 'already prepared' count; done items are never announced again", async () => {
    let p = needs(needs(prepared(owner()), "amanda", ["reason"]), "fabio", ["date"]);
    const text = actionPlanPreview(p);
    expect(text).toBe("Já dá para confirmar: bloqueio de Rodrigo.\n\nSó preciso de duas informações:\n\n1. Para qual dia devo passar Fábio?\n2. Qual o motivo do cancelamento?");
    expect(text).not.toContain("preparad");
    p = await executeConfirmationGroup(p, approval(p, "rodrigo"), async () => ({ status: "DONE", missing_fields: [] }));
    expect(actionPlanPreview(p)).toBe("1 item já está preparado. Só preciso de duas informações:\n\n1. Para qual dia devo passar Fábio?\n2. Qual o motivo do cancelamento?");
  });
  it("more than three confirmable items are counted instead of listed", () => {
    const p = needs(prepared(selection([service("a"), service("b"), service("c"), service("d"), service("e")])), "e", ["durationMin"]);
    expect(actionPlanPreview(p)).toBe("Já dá para confirmar 4 itens.\n\nPode informar duração em minutos de Serviço e?");
  });
  it("a failed item does not hide what is still confirmable", () => {
    const p = assessPlanAction(prepared(owner()), "amanda", { status: "FAILED_SAFE", missing_fields: [], issue: "BACKEND_PREPARATION_FAILED" });
    const text = actionPlanPreview(p);
    expect(text.startsWith("Cancelar agendamento — Amanda: não foi possível preparar este item.")).toBe(true);
    expect(text.endsWith("Já dá para confirmar: remarcação de Fábio e bloqueio de Rodrigo. Os itens com pendências precisam ser revisados antes de confirmar.")).toBe(true);
  });
});
