import { firstTemporalAmbiguity, type PendingTemporalAmbiguity } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, type PendingCalendarConflict } from "./scheduling-calendar-conflict";
import { optionId } from "./secretary-options";
import { structuredResponse, type QuestionCode } from "../../packages/salon-secretary/src/structured-context";
/** Only already-authorized display data; never expose entity IDs to extraction. */
export function candidateLabel(candidate:{name:string;phone?:string|null}){
  return candidate.name+(candidate.phone?` · ${candidate.phone}`:"");
}
function responseFields(operation:string|undefined,field:string){
  if(field==="customer_ref")return [operation==="customer.message"?"recipient_name":operation?.startsWith("customer.")?"target_name":"customer_name"];
  if(field==="service_ref")return [operation?.startsWith("service.")?"target_name":"service_name"];
  if(field==="professional_ref")return ["professional_name"];
  if(field==="appointment_ref")return operation==="appointment.change"?["source_date","source_time"]:["date","time"];
  // P2a: an alteration card is answered by the field it resolves (the NEW professional; the service delta).
  if(field==="target_professional_ref")return ["target_professional_name"];
  if(field==="service_changes_ref")return ["service_changes"];
  // P2b: a service-list card is answered by the list it resolves.
  if(field==="service_list_ref"||field==="service_combo_ref")return ["service_names"];
  return [field];
}
/** B7 (flag SALON_SECRETARY_STRUCTURED_CONTEXT, default off): Luna reads what was asked as a code plus a short, stable
 * sentence (no names, dates or screen prose), instead of the full text shown to the owner. With the flag off the context
 * is byte-for-byte the historical one. */
export const structuredContextEnabled=()=>process.env.SALON_SECRETARY_STRUCTURED_CONTEXT==="true";
// The wording lives in the package (one source): the request budget converts a built context into the same form.
export { structuredResponse, type QuestionCode };
/** Backend-owned conversational context. Domain refs and provenance stay private. */
export function clarificationContext(input: {
  operation?: string; fields: Record<string, unknown>; missing_fields?: readonly string[];
  waiting_for?: string; message: string; pending_temporal_ambiguities?: readonly PendingTemporalAmbiguity[]; pending_calendar_conflicts?: readonly PendingCalendarConflict[];
  selection?:{field:string;labels:readonly string[]};
  /** B6: how many turns in a row this very question was asked (published only when repeated, i.e. 2 or more). */
  repeat_count?: number;
}) {
  const missing = [...new Set([...(input.missing_fields ?? []), ...(input.waiting_for ? [input.waiting_for] : [])])];
  const pending=input.waiting_for?input.pending_temporal_ambiguities?.find(item=>item.field===input.waiting_for):firstTemporalAmbiguity(input.pending_temporal_ambiguities);
  const calendar=input.waiting_for?input.pending_calendar_conflicts?.find(item=>item.field===input.waiting_for):firstCalendarConflict(input.pending_calendar_conflicts);
  const requested=input.waiting_for ?? calendar?.field ?? pending?.field ?? (missing.length === 1 ? missing[0] : null);
  const structured=structuredContextEnabled();
  const code:QuestionCode|undefined=!structured?undefined:input.selection?"OPTION":calendar?"CALENDAR":pending?"DAYPART":requested?"FIELD":missing.length?"FIELDS":undefined;
  return {
    operation: input.operation,
    // Omit transport placeholders, never accepted zero/false or customer clears.
    // Missing fields are declared below; repeated null slots carry no semantics.
    fields: Object.fromEntries(Object.entries(input.fields).filter(([key,value]) => !key.endsWith("_ref") && key !== "override_reason_source" && key !== "reason_source" &&
      (value !== null || key === "phone" || key === "email") && (!Array.isArray(value) || value.length > 0))),
    ...(input.pending_temporal_ambiguities?.length?{pending_temporal_ambiguities:input.pending_temporal_ambiguities}:{}),
    ...(input.pending_calendar_conflicts?.length?{pending_calendar_conflicts:input.pending_calendar_conflicts}:{}),
    clarification: {
      missing_fields: missing,
      ...(calendar?{requested_component:"calendar_reference"}:pending?{requested_component:"daypart"}:{}),
      requested_field: requested,
      ...(code?{question_code:code}:{}),
      previous_response: structured?structuredResponse(code,requested,missing):input.message,
      // B4: each option carries its positional id (opt_1 = first label); refs never leave the backend.
      ...(input.selection?{response_fields:responseFields(input.operation,input.selection.field),candidates:input.selection.labels.map((label,index)=>({option_id:optionId(index),label}))}:{}),
      ...(Number.isSafeInteger(input.repeat_count)&&input.repeat_count!>1?{repeat_count:input.repeat_count}:{}),
    },
  };
}
