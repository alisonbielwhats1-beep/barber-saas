import { createHash } from "node:crypto";
import { conversationalClarifications, type ActionPlan, type PlanAction } from "@everflair/salon-secretary";
import type { ActionUnit } from "./secretary-action-plan";
import type { SecretaryView } from "./salon-secretary";
import { presentationHints } from "./secretary-presentation";
import { hintOptions, type SecretaryOption } from "./secretary-options";

/** B6 repeated-question limit (rec 8). In memory, per parent session: the question each open action of the
 * active plan showed and for how many user turns in a row. Never persisted, logged or sent anywhere. */
export type AskedQuestion = { action_key: string; fields: readonly string[]; question: string };
export type ClarificationEntry = { plan_ref: string; action_key: string; fingerprint: string; count: number };
export type ClarificationHistory = Readonly<Record<string, ClarificationEntry>>;
export type ClarificationFallback = { href: string; label: string };
/** One open question of the plan on the screen. `field`: the question's field(s), comma-joined. `attempt`: user turns
 * in a row it was asked. From 2: `options` the backend already has (ids + labels). From 3: `fallback`, the agenda form. */
export type SecretaryClarification = { action_key: string; field: string; attempt: number; options?: SecretaryOption[]; fallback?: ClarificationFallback };
type Operation = { operation_ref: string; action_keys?: string[]; state: SecretaryView };

export const agendaFallbackLabel = "Abrir no formulário da agenda";
/** Appended to the reply only from the third time the same question is asked (single questions stay exact before). */
export const agendaFallbackNotice = `Se preferir, toque em “${agendaFallbackLabel}” para concluir por lá com o que já entendi.`;

const key = (q: Pick<AskedQuestion, "action_key" | "fields">) => `${q.action_key}:${q.fields.join(",")}`;
export const questionFingerprint = (q: Pick<AskedQuestion, "question">) => createHash("sha256").update(q.question).digest("hex");
/** What an action looked like before a message (a message that changes nothing repeats every open question). */
export const actionMark = (action: PlanAction) => JSON.stringify([action.fields, action.status, action.assessment]);
export function planQuestions(plan: ActionPlan, units: readonly ActionUnit[], operations: readonly Operation[]): AskedQuestion[] {
  return conversationalClarifications(plan, presentationHints(plan, units, operations));
}
/** Turns in a row this very question (same plan, action, field and wording) was asked; 1 when new. Read-only. */
export function clarificationAttempt(history: ClarificationHistory | undefined, planRef: string, q: AskedQuestion) {
  const entry = history?.[key(q)];
  return entry && entry.plan_ref === planRef && entry.fingerprint === questionFingerprint(q) ? entry.count : 1;
}
/** Once per user message, after preparation (never while projecting a view). The same question asked again counts
 * one more turn when the message was about its action (`repeats`); a message about another action keeps the count;
 * a new or reworded question starts at 1; a question no longer asked leaves the history. */
export function recordClarifications(history: ClarificationHistory | undefined, planRef: string, questions: readonly AskedQuestion[],
  repeats: (actionKey: string) => boolean): ClarificationHistory {
  const next: Record<string, ClarificationEntry> = {};
  for (const q of questions) {
    const entry = history?.[key(q)], fingerprint = questionFingerprint(q);
    const same = !!entry && entry.plan_ref === planRef && entry.fingerprint === fingerprint;
    next[key(q)] = { plan_ref: planRef, action_key: q.action_key, fingerprint, count: !same ? 1 : entry.count + (repeats(q.action_key) ? 1 : 0) };
  }
  return next;
}

// A reason is the owner's own words (literal proof), never a choice.
const literalFields = new Set(["reason", "overrideReason"]);
/** The view's open questions with their attempt, options (from 2) and agenda fallback (from 3). Read-only. */
export function clarificationsView(plan: ActionPlan, units: readonly ActionUnit[], operations: readonly Operation[], history: ClarificationHistory | undefined): SecretaryClarification[] {
  const hints = presentationHints(plan, units, operations), entities = hintOptions(hints);
  return conversationalClarifications(plan, hints).map(q => {
    const attempt = clarificationAttempt(history, plan.plan_ref, q), action = plan.actions.find(item => item.key === q.action_key)!;
    const state = operations.find(operation => operation.action_keys?.includes(q.action_key))?.state;
    // Entity candidates by their published option ids; otherwise the time slots the backend offered (B4).
    const offered: readonly SecretaryOption[] | undefined = attempt < 2 || q.fields.some(field => literalFields.has(field)) ? undefined
      : entities[q.action_key] ?? (q.fields.includes("time") ? state?.options : undefined);
    const fallback = attempt >= 3 ? agendaFallback(action, state) : undefined;
    return { action_key: q.action_key, field: q.fields.join(","), attempt, ...(offered?.length ? { options: offered.map(({ option_id, label }) => ({ option_id, label })) } : {}), ...(fallback ? { fallback } : {}) };
  });
}

const refShape = /^[A-Za-z0-9_-]{1,64}$/, dayShape = /^\d{4}-\d{2}-\d{2}$/, clockShape = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const take = (value: unknown, shape: RegExp) => typeof value === "string" && shape.test(value) ? value : undefined;
/** The agenda's own form for this action, prefilled only with opaque ids, days and clocks the backend already
 * resolved (never names, phones or text). The agenda re-validates every value; nothing is confirmed by the link. */
export function agendaFallback(action: PlanAction, state?: SecretaryView): ClarificationFallback | undefined {
  const scheduling = state?.scheduling ?? (action.operation === "appointment.cancel" ? state?.communication?.cancel : undefined);
  const f = (scheduling?.fields ?? state?.batch?.plan.items.find(item => item.key === action.key)?.fields ?? {}) as Record<string, unknown>;
  const params: [string, string | undefined][] = action.operation === "appointment.create"
    ? [["date", take(f.date, dayShape)], ["client", take(f.customer_ref, refShape)], ["professional", take(f.professional_ref, refShape)], ["time", take(f.time, clockShape)], ["service", take(f.service_ref, refShape)], ["from", "secretaria"]]
    : action.operation === "appointment.change" || action.operation === "appointment.cancel"
      // The appointment's own day (a change's destination day is not where the appointment is).
      ? [["date", take(action.operation === "appointment.change" ? f.source_date : f.date, dayShape)], ["appointment", take(f.appointment_ref, refShape)]]
      : action.operation === "schedule.block"
        ? [["date", take(f.date, dayShape)], ["professional", take(f.professional_ref, refShape)], ["block", "1"], ["time", take(f.time, clockShape)],
          ["end", f.end_date == null || f.end_date === f.date ? take(f.end_time, clockShape) : undefined]]
        : [];
  if (!params.length) return undefined;
  const query = new URLSearchParams(params.filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
  return { href: query ? `/agenda?${query}` : "/agenda", label: agendaFallbackLabel };
}
