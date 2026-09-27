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
/** Luna owns the meaning of a reply to a specific pending decision. Outside
 * that backend context, keep the conservative historical source guard. */
export function groundSchedulingException(patch: Record<string, unknown>, previous: Record<string, unknown>, message?: string, context?: SchedulingOverrideDecisionContext) {
  if (message === undefined) return;
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
  const text=normalize(message);
  const contextualReply=isPendingOverrideDecision(context,previous,patch)&&text.length>0;
  const changedSlot=["customer_name","customer_ref","service_name","service_ref","professional_name","professional_ref","appointment_ref","date","time","period","destination_mode"].some(k=>patch[k]!==undefined&&patch[k]!==previous[k]);
  if (patch.override_requested === true && (previous.override_requested !== true||changedSlot) &&
    (!contextualReply&&!/(?:pode|quero|faca|fazer|autorizar|autorizo|permite|permito) (?:o )?encaix|mesmo (?:que|com).*conflito/.test(text) || /\bnao\b/.test(text)))
    throw Error("OVERRIDE_INTENT_NOT_GROUNDED");
  if (typeof patch.override_reason === "string" && patch.override_reason !== previous.override_reason &&
    (!text.includes(normalize(patch.override_reason)) || /^(sim|ok|pode encaixar|fazer encaixe|encaixe)$/.test(normalize(patch.override_reason))))
    throw Error("OVERRIDE_REASON_NOT_GROUNDED");
}
