import { describe, expect, it } from "vitest";
import { targetCases, verifyFrozenTarget, scoreTargetUX } from "../../../packages/salon-secretary/evaluation/conversational-ux-target";
import { verifyFrozenTarget as verifyFinalTarget } from "../../../packages/salon-secretary/evaluation/conversational-ux-final-target";
import { actionPlanPreview, type ActionPlan } from "@everflair/salon-secretary";
import evidence from "../../test/fixtures/conversational-ux-benchmark.json";
import type { SecretaryView } from "../salon-secretary";
import type { TurnCapture } from "../../../packages/salon-secretary/evaluation/hard-conversations-observation-bridge";
describe("targeted real run gate, no inference", () => {
  it("binds immutable messages, fixtures, oracle, runtime and the five-case allowlist", () => {
    // The old manifest must reject changed runtime bytes; the authorized delta has a separate seal.
    expect(() => verifyFrozenTarget()).toThrow("TARGET_COMPOSER_DRIFT");
    // T21 changes presentation too; even the final x49 seal must now fail closed.
    expect(()=>verifyFinalTarget()).toThrow("FINAL_TIMEZONE_DELTA");
    expect(targetCases.map(c => c.id)).toEqual(["x41", "x42", "x44", "x46", "x49"]);
    expect(targetCases.reduce((n, c) => n + c.messages.length, 0)).toBe(10);
  });
  it.each(evidence.rows)("scores frozen $case_id turn $turn without changing oracle", row => {
    const hints = Object.fromEntries(row.capture.operations.filter(o => o.candidates).map(o => [row.plan.actions.find(a => a.operation === o.operation)!.key,
      { selection: { field: o.candidates!.kind!, labels: o.candidates!.labels } }]));
    const view: SecretaryView = { sessionId: row.conversation_ref, cancelled: false, action_plan: row.plan as ActionPlan, message: actionPlanPreview(row.plan as ActionPlan, hints) };
    const score = scoreTargetUX(row.case_id, row.turn, view, row.capture as unknown as TurnCapture, { pass: true, failures: [], safety: [] });
    expect(score.failures).toEqual([]); expect(score.safety).toEqual([]);
    expect(Object.values(score.metrics!)).toEqual(Array(8).fill(0));
  });
  it("rejects duplicate, missing and premature questions independently", () => {
    const row = evidence.rows.find(r => r.case_id === "x46" && r.turn === 1)!;
    const score = (message: string) => scoreTargetUX("x46", 1, { sessionId: row.conversation_ref, cancelled: false, message, action_plan: row.plan as ActionPlan },
      row.capture as unknown as TurnCapture, { pass: true, failures: [], safety: [] });
    expect(score("Qual serviço? Qual serviço?").metrics!.DUPLICATE_QUESTION).toBe(1);
    expect(score("Tudo pronto.").metrics!.MISSING_REQUIRED_QUESTION).toBe(1);
    expect(score("Qual profissional?").metrics!.UNNECESSARY_QUESTION).toBe(1);
    expect(score("Informe service_ref.").metrics!.TECHNICAL_FIELD_LEAK).toBe(1);
  });
  it("wrong backend entity remains a safety failure even with natural text", () => {
    const row = evidence.rows.find(r => r.case_id === "x41" && r.turn === 1)!;
    const capture = structuredClone(row.capture) as unknown as TurnCapture;
    capture.operations[0].fields.customer_ref = "wrong";
    const score = scoreTargetUX("x41", 1, { sessionId: row.conversation_ref, cancelled: false, message: "Qual horário?", action_plan: row.plan as ActionPlan },
      capture, { pass: true, failures: [], safety: [] });
    expect(score.metrics!.WRONG_ENTITY_AUTO_SELECTED).toBe(1); expect(score.safety).toHaveLength(1);
  });
});
