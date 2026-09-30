import { z } from "zod";

export const schedulingExceptionFields = {
  destination_mode: z.enum(["SAME_RELEASED_SLOT", "ALTERNATIVE_SLOT"]),
  override_requested: z.boolean(),
  override_reason: z.string().trim().min(1).max(200),
};
export const schedulingReviewSchema = z.object({
  status: z.enum(["AVAILABLE", "CONFLICT_OVERRIDABLE", "CONFLICT_HARD_BLOCK"]),
  startLocal: z.string(), endLocal: z.string(), durationMin: z.number(),
  causes: z.array(z.string()),
  conflicts: z.array(z.object({ startLocal: z.string(), endLocal: z.string(), overlapMinutes: z.number() }).strict()),
  override_allowed: z.boolean(),
  missing_fields: z.array(z.string()),
  message: z.string(),
  alternatives: z.array(z.object({ startLocal: z.string(), endLocal: z.string(), professional_ref: z.string() }).strict()),
}).strict();
export type SchedulingReview = z.infer<typeof schedulingReviewSchema>;
export const schedulingOverlapEnabled = () => process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED === "true";
/** Neutral values restate the historical default and request no exception:
 * the released slot itself (T21 v1) and an explicit refusal of overlap. Only an
 * alternative destination, an overlap request or its reason need the capability. */
const neutralException = (key: string, value: unknown) =>
  key === "destination_mode" && value === "SAME_RELEASED_SLOT" || key === "override_requested" && value === false;
export function assertSchedulingExceptionScope(fields: Record<string, unknown>, operation: string) {
  if (Object.keys(schedulingExceptionFields).some(key => fields[key] != null && !neutralException(key, fields[key]))) {
    if (!schedulingOverlapEnabled()) throw Error("SCHEDULING_OVERLAP_DISABLED");
    if (operation !== "appointment.create") throw Error("CAPABILITY_FIELD_MISMATCH");
  }
}
/** Backend-only context: a semantic reply is bound to the existing draft and
 * slot. It is never permission to execute; availability/role are checked again. */
export type SchedulingOverrideDecisionContext = {
  operation: string; waiting_for?: string; fields: Record<string, unknown>;
  review?: SchedulingReview; expires_at: string;
};
function isPendingOverrideDecision(context:SchedulingOverrideDecisionContext|undefined,previous:Record<string,unknown>,patch:Record<string,unknown>){
  if(!context||context.operation!=="appointment.create"||context.waiting_for!=="override_requested"||
    context.review?.status!=="CONFLICT_OVERRIDABLE"||!context.review.override_allowed||
    !context.review.missing_fields.includes("override_requested")||!(Date.parse(context.expires_at)>Date.now()))return false;
  const sameFields=[...new Set([...Object.keys(context.fields),...Object.keys(previous)])].every(key=>JSON.stringify(context.fields[key])===JSON.stringify(previous[key]));
  const sameRequest=Object.entries(patch).every(([key,value])=>["override_requested","override_reason","override_reason_source"].includes(key)||value===undefined||JSON.stringify(value)===JSON.stringify(previous[key]));
  return sameFields&&sameRequest;
}
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
/** The conservative historical source guard of an encaixe consent (a normalized message). */
const historicalConsent = (text: string) => /(?:pode|quero|faca|fazer|autorizar|autorizo|permite|permito) (?:o )?encaix|mesmo (?:que|com).*conflito/.test(text);
const SLOT_KEYS = ["customer_name","customer_ref","service_name","service_ref","professional_name","professional_ref","appointment_ref","date","time","period"] as const;
/** Luna owns the meaning of a reply to a specific pending decision. Outside
 * that backend context, keep the conservative historical source guard. */
export function groundSchedulingException(patch: Record<string, unknown>, previous: Record<string, unknown>, message?: string, context?: SchedulingOverrideDecisionContext) {
  if (message === undefined) return;
  const text=normalize(message);
  const contextualReply=isPendingOverrideDecision(context,previous,patch)&&text.length>0;
  const changedSlot=[...SLOT_KEYS,"destination_mode"].some(k=>patch[k]!==undefined&&patch[k]!==previous[k]);
  if (patch.override_requested === true && (previous.override_requested !== true||changedSlot) &&
    (!contextualReply&&!historicalConsent(text) || /\bnao\b/.test(text)))
    throw Error("OVERRIDE_INTENT_NOT_GROUNDED");
  if (typeof patch.override_reason === "string" && patch.override_reason !== previous.override_reason &&
    (!text.includes(normalize(patch.override_reason)) || /^(sim|ok|pode encaixar|fazer encaixe|encaixe)$/.test(normalize(patch.override_reason))))
    throw Error("OVERRIDE_REASON_NOT_GROUNDED");
}
/** A1-GF23 / A3 (flag SALON_SECRETARY_EXCEPTION_RULES_V2, default off: every call site keeps today's behaviour). */
export const exceptionRulesV2Enabled = (env: Record<string, string | undefined> = process.env) => env.SALON_SECRETARY_EXCEPTION_RULES_V2 === "true";
/** The owner's own words carry an encaixe consent the conservative historical guard accepts (never beside a negation). */
export const literalOverrideConsent = (message: string | undefined) => {
  if (message === undefined) return false;
  const text = normalize(message);
  return historicalConsent(text) && !/\bnao\b/.test(text);
};
/** A1-GF23: a decision asserting both encaixe (override_requested true) and another destination (destination_mode
 * ALTERNATIVE_SLOT) contradicts itself. The ungrounded destination never retracts a proven day or time, and the contradiction
 * is never resolved toward the riskier branch: destination_mode leaves the patch; the consent stays only where it selects the
 * honest answer of the LIVE review — a HARD_BLOCK (its status and the absent plan never depend on it; it only says "Não posso
 * fazer encaixe") or an OVERRIDABLE conflict whose consent the owner wrote literally (the reason is still asked, Confirmar
 * still required). A merely contextual consent, a review that is not live or a turn that also moves the slot or changes the
 * person/service drops both (a new slot is reviewed afresh; consent is never inherited). A reason inside a contradiction is
 * never kept. Mutates the patch; returns codes only. Runs after the consent/negation guard (groundSchedulingException). */
export function reconcileExceptionDecision(patch: Record<string, unknown>, previous: Record<string, unknown>, decision: { review?: SchedulingReview; literal: boolean }): string[] {
  if (patch.destination_mode !== "ALTERNATIVE_SLOT" || patch.override_requested !== true) return [];
  delete patch.destination_mode; delete patch.override_reason; delete patch.override_reason_source;
  const changedSlot = SLOT_KEYS.some(k => patch[k] !== undefined && patch[k] !== previous[k]), status = decision.review?.status;
  if (changedSlot || !(status === "CONFLICT_HARD_BLOCK" || status === "CONFLICT_OVERRIDABLE" && decision.literal)) delete patch.override_requested;
  return ["EXCEPTION_DECISION_CONTRADICTION"];
}
