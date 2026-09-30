import { describe, expect, it } from "vitest";
import { createActionPlan, assessPlanAction, patchPlanAction, executeConfirmationGroup, refreshActionPlan, discardNotice, terminalActionStatus,
  conversationalClarifications, actionPlanPreview, type ActionPlan } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";

/** B3 DISCARDED at the plan level: terminal, outside readiness, groups and every later edit. */
const service = (key: string, extra: object = {}) => intent("service.create", { item_key: key, name: `Serviço ${key}`, durationMin: 30, priceCents: 5000, depends_on: [], ...extra });
const ready = (p: ActionPlan) => p.actions.reduce((next, action) => assessPlanAction(next, action.key,
  { status: "READY_FOR_CONFIRMATION", missing_fields: [], preview: `Prévia ${action.key}`, proposal_token: `token-${action.key}` }), p);
const discard = (p: ActionPlan, key: string) => assessPlanAction(p, key, { status: "DISCARDED", missing_fields: [], issue: "DISCARDED_BY_USER" });

describe("DISCARDED action status", () => {
  it("is terminal: excluded from groups and review size; the rest stays READY_FOR_CONFIRMATION with a new revision and fingerprints", () => {
    for (const grouping of ["packed", "component"] as const) {
      const before = ready(createActionPlan(plan([service("a"), service("b"), service("c")]), { normalReviewMax: 5, maxActionsPerConfirmationGroup: 10, grouping }));
      const after = discard(before, "b");
      expect(after.actions.map(action => action.status)).toEqual(["READY_FOR_CONFIRMATION", "DISCARDED", "READY_FOR_CONFIRMATION"]);
      expect(after.confirmation_groups.flatMap(group => group.action_keys)).toEqual(["a", "c"]);
      expect(after.confirmation_groups.every(group => group.status === "READY_FOR_CONFIRMATION")).toBe(true);
      expect(after.status).toBe("READY_FOR_CONFIRMATION"); expect(after.revision).toBeGreaterThan(before.revision);
      const fingerprints = new Set(before.confirmation_groups.map(group => group.fingerprint));
      expect(after.confirmation_groups.some(group => fingerprints.has(group.fingerprint))).toBe(false);
      expect(after.actions[1]).toMatchObject({ missing_fields: [], blocked_by: [] });
      expect(terminalActionStatus("DISCARDED") && terminalActionStatus("DONE") && !terminalActionStatus("READY_FOR_CONFIRMATION")).toBe(true);
    }
  });
  it("never comes back: re-assessment and patches are refused; a dependent left behind is blocked, never executed", async () => {
    const p = discard(ready(createActionPlan({ ...plan([service("a"), service("b", { depends_on: ["a"] })]), independent: false })), "a");
    expect(() => assessPlanAction(p, "a", { status: "READY_FOR_CONFIRMATION", missing_fields: [], proposal_token: "x", preview: "x" })).toThrow("ACTION_DISCARDED");
    expect(() => patchPlanAction(p, "a", { priceCents: 1 })).toThrow("ACTION_DISCARDED");
    expect(p.actions.map(action => action.status)).toEqual(["DISCARDED", "BLOCKED_BY_DEPENDENCY"]);
    expect(p.confirmation_groups.flatMap(group => group.action_keys)).toEqual(["b"]);
    const group = p.confirmation_groups[0];
    await expect(executeConfirmationGroup(p, { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }, async () => { throw Error("MUST_NOT_RUN"); }))
      .rejects.toThrow("PLAN_NOT_READY");
    // A patch to a surviving parent never resets a discarded dependent.
    const kept = discard(ready(createActionPlan({ ...plan([service("a"), service("b", { depends_on: ["a"] })]), independent: false })), "b");
    expect(patchPlanAction(kept, "a", { priceCents: 7000 }).actions[1].status).toBe("DISCARDED");
  });
  it("a plan of only DONE and DISCARDED actions is DONE; questions and previews skip discarded actions", () => {
    let p = ready(createActionPlan(plan([service("a"), service("b")])));
    p = assessPlanAction(p, "a", { status: "DONE", missing_fields: [], preview: "Concluído." });
    p = discard(p, "b");
    expect(refreshActionPlan(structuredClone(p)).status).toBe("DONE");
    let asking = createActionPlan(plan([service("a", { durationMin: null }), service("b", { durationMin: null })]));
    asking = assessPlanAction(asking, "a", { status: "NEEDS_INPUT", missing_fields: ["durationMin"] });
    asking = assessPlanAction(asking, "b", { status: "NEEDS_INPUT", missing_fields: ["durationMin"] });
    const left = discard(asking, "b");
    expect(conversationalClarifications(left).map(q => q.action_key)).toEqual(["a"]);
    expect(actionPlanPreview(discard(ready(createActionPlan(plan([service("a"), service("b")]))), "b"))).not.toContain("Prévia b");
  });
  it("the discard notice names what was given up and what went with it, and that nothing was executed", () => {
    const p = createActionPlan({ ...plan([intent("appointment.cancel", { item_key: "a", depends_on: [], customer_name: "Amanda Souza", reason: "Pedido dela" }),
      intent("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a", customer_name: "Fábio Santos", service_name: "Corte" }),
      intent("schedule.block", { item_key: "c", depends_on: [], professional_name: "Rodrigo" }),
      intent("financial.report", { item_key: "d", depends_on: [], financial: { metrics: ["service_revenue"], period: "yesterday" } })]), independent: false });
    const [a, b, c, d] = p.actions;
    expect(discardNotice([c])).toBe("Certo, descartei o bloqueio de Rodrigo. Nada foi alterado.");
    expect(discardNotice([a], [b])).toBe("Certo, descartei o cancelamento de Amanda Souza. Também descartei o agendamento de Fábio Santos, que estava ligado a esse item. Nada foi alterado.");
    expect(discardNotice([c, d])).toBe("Certo, descartei o bloqueio de Rodrigo e a consulta financeira. Nada foi alterado.");
  });
});
