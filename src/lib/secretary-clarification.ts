import { firstTemporalAmbiguity, type PendingTemporalAmbiguity } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, type PendingCalendarConflict } from "./scheduling-calendar-conflict";
/** Only already-authorized display data; never expose entity IDs to extraction. */
export function candidateLabel(candidate:{name:string;phone?:string|null}){
  return candidate.name+(candidate.phone?` · ${candidate.phone}`:"");
}
function responseFields(operation:string|undefined,field:string){
  if(field==="customer_ref")return [operation==="customer.message"?"recipient_name":operation?.startsWith("customer.")?"target_name":"customer_name"];
  if(field==="service_ref")return [operation?.startsWith("service.")?"target_name":"service_name"];
  if(field==="professional_ref")return ["professional_name"];
  if(field==="appointment_ref")return operation==="appointment.change"?["source_date","source_time"]:["date","time"];
  return [field];
}
/** Backend-owned conversational context. Domain refs and provenance stay private. */
export function clarificationContext(input: {
  operation?: string; fields: Record<string, unknown>; missing_fields?: readonly string[];
  waiting_for?: string; message: string; pending_temporal_ambiguities?: readonly PendingTemporalAmbiguity[]; pending_calendar_conflicts?: readonly PendingCalendarConflict[];
  selection?:{field:string;labels:readonly string[]};
}) {
  const missing = [...new Set([...(input.missing_fields ?? []), ...(input.waiting_for ? [input.waiting_for] : [])])];
  const pending=input.waiting_for?input.pending_temporal_ambiguities?.find(item=>item.field===input.waiting_for):firstTemporalAmbiguity(input.pending_temporal_ambiguities);
  const calendar=input.waiting_for?input.pending_calendar_conflicts?.find(item=>item.field===input.waiting_for):firstCalendarConflict(input.pending_calendar_conflicts);
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
      requested_field: input.waiting_for ?? calendar?.field ?? pending?.field ?? (missing.length === 1 ? missing[0] : null),
      previous_response: input.message,
      ...(input.selection?{response_fields:responseFields(input.operation,input.selection.field),candidates:input.selection.labels.map(label=>({label}))}:{}),
    },
  };
}
