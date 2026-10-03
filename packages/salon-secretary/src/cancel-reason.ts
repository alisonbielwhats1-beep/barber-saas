/** Owner decision of 03/10/2026 (flag SALON_SECRETARY_CANCEL_REASON_OPTIONAL, default off): a cancellation needs no reason.
 * The requirement drops to the appointment alone and the Secretária never asks for a cause. A cause the owner says is still
 * proven literally and stored; one the backend cannot prove is dropped (never stored, never asked). The encaixe reason
 * (override_reason) is unchanged. Off, every wire, prompt, example and behaviour is byte-identical. */
export const cancelReasonOptionalEnabled = () => process.env.SALON_SECRETARY_CANCEL_REASON_OPTIONAL === "true";
/** The scheduling manual's T14 clause and the agent's reason sentence, each with its flag-on wording (checked replaces:
 * skill-registry.ts and agent-prompt.ts fail at module load when a target drifts). */
export const CANCEL_REASON_MANUAL_EDIT = ["motivo real obrigatório, nunca inventado.", "motivo opcional: só o dito, nunca inventado."] as const;
export const CANCEL_REASON_AGENT_EDIT = ["motivo fica null só quando a mensagem não traz causa nenhuma, e então o backend pergunta.",
  "motivo fica null quando a mensagem não traz causa: o motivo é opcional e não é pedido."] as const;
/** The flag-on text: a target that drifted away fails (applied at module load), never leaking the mandatory wording. */
export function withOptionalCancelReason(text: string, [target, replacement]: readonly [string, string]) {
  if (!text.includes(target)) throw Error("INSTRUCTION_REPLACE_TARGET_MISSING");
  return text.replace(target, replacement);
}
type ExampleStateLike = { kind: string; requested_field?: string; operation?: string; questions?: readonly { operation: string; requested_field: string }[];
  actions?: readonly { operation: string; summary: string }[] };
/** A bank state showing a cancellation still waiting for its reason (a question for `reason` or a plan item "(falta
 * motivo)"): with the flag those examples are never served, so the model is not taught to wait for a cause. */
export function asksCancelReason(state: ExampleStateLike) {
  const questions = state.questions ?? (state.kind === "ANSWER" && state.operation ? [{ operation: state.operation, requested_field: state.requested_field ?? "" }] : []);
  return questions.some(question => question.operation === "appointment.cancel" && question.requested_field === "reason") ||
    (state.actions ?? []).some(action => action.operation === "appointment.cancel" && action.summary.includes("(falta motivo)"));
}
