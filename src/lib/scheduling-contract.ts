import { z } from "zod";
import { schedulingExceptionFields, schedulingOverlapEnabled } from "./scheduling-conflict-contract";
import { reasonSource } from "./scheduling-literal-source";
import { overrideReasonSource } from "./scheduling-reason-source";
import { schedulingOperationIds } from "../../packages/salon-secretary/src/scheduling-skill";
import { temporalComponentsEnabled } from "../../packages/salon-secretary/src/temporal-components";
import { alterAppointmentEnabled } from "../../packages/salon-secretary/src/alter-appointment";
import { readsV2Enabled } from "../../packages/salon-secretary/src/reads-v2";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, weekdayOfDateKey } from "./time";

// Domain uses Zod 3; SDK extraction uses its isolated Zod 4 adapter.
export const schedulingOperation=z.enum(schedulingOperationIds);
const schedulingFields={customer_name:z.string().trim().min(2).max(200),service_name:z.string().trim().min(2).max(200),professional_name:z.string().trim().min(2).max(200),date:z.string().refine(isDateKey),day_offset:z.number().int().min(0).max(365),weekday:z.number().int().min(0).max(6),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),period:z.enum(["morning","afternoon","evening"]),source_date:z.string().refine(isDateKey),source_day_offset:z.number().int().min(0).max(365),source_weekday:z.number().int().min(0).max(6),source_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end_date:z.string().refine(isDateKey),reason:z.string().trim().max(200)};
/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT): an appointment.change's NEW professional and service delta as the owner said
 * them (never locators: professional_name/service_name keep locating the current appointment). The backend resolves them into
 * target_professional_ref and service_changes_ref (parallel to service_changes; null = not resolved yet). */
const serviceChange=z.object({mode:z.enum(["SET","INCLUDE","REMOVE"]),service_name:z.string().trim().min(2).max(200)}).strict();
const alterationFields={target_professional_name:z.string().trim().min(2).max(200),service_changes:z.array(serviceChange).min(1).max(10)};
export type SchedulingServiceChange=z.infer<typeof serviceChange>;
/** P2b (flag SALON_SECRETARY_MULTI_SERVICE): the services of ONE appointment.create/availability.get as the owner said them
 * (service_name/service_ref stay the single-service form; the adapter keeps one form at a time, a list of 2+). The backend
 * resolves them into service_list_ref (parallel; null = not resolved yet). */
const serviceListFields={service_names:z.array(z.string().trim().min(2).max(200)).min(1).max(10)};
export const schedulingPatch = z.object({...schedulingFields,...schedulingExceptionFields,...alterationFields,...serviceListFields}).partial().strict();
export const schedulingResolved = z.object({
  override_reason_source: overrideReasonSource, reason_source: reasonSource,
  ...schedulingFields, ...schedulingExceptionFields, appointment_ref:z.string().min(1).max(100), customer_ref: z.string().min(1).max(100), service_ref: z.string().min(1).max(100), professional_ref: z.string().min(1).max(100),
  ...alterationFields, target_professional_ref:z.string().min(1).max(100), service_changes_ref:z.array(z.string().min(1).max(100).nullable()).max(10),
  ...serviceListFields, service_list_ref:z.array(z.string().min(1).max(100).nullable()).max(10),
}).partial().strict();
export type SchedulingFields = z.infer<typeof schedulingResolved>;
/** P2b: the operations a service list applies to. */
export const serviceListOperation=(operation:string|undefined)=>operation==="appointment.create"||operation==="availability.get";
/** P2b: every service of the list resolved to one catalog service of the tenant. */
export const serviceListResolved=(f:Partial<SchedulingFields>)=>!f.service_names||f.service_list_ref?.length===f.service_names.length&&f.service_list_ref.every(Boolean);
/** P2b: the resolved services of a create/availability, in order (the single service, or every service of a resolved list);
 * undefined while any is unresolved. */
export const schedulingServiceRefs=(f:Partial<SchedulingFields>):string[]|undefined=>f.service_names?serviceListResolved(f)?f.service_list_ref as string[]:undefined:f.service_ref?[f.service_ref]:undefined;
/** P2a: whether a change alters who attends or the services (the owner's words or a resolved choice). */
export const schedulingAlteration=(f:Partial<SchedulingFields>)=>!!(f.target_professional_name||f.target_professional_ref||f.service_changes?.length);
/** P2a: every service change resolved to one catalog service of the tenant. */
export const serviceChangesResolved=(f:Partial<SchedulingFields>)=>!f.service_changes||f.service_changes_ref?.length===f.service_changes.length&&f.service_changes_ref.every(Boolean);
/** Required fields of this draft. P2a: an alteration with no destination said (no day, clock or period) keeps the slot, so it
 * needs no date/time; its names must be resolved first. A day without a clock still asks the clock (GF14). */
export function schedulingRequiredFields(operation: z.infer<typeof schedulingOperation>, f: Partial<SchedulingFields>): string[] {
  const required=([...schedulingRequirements(operation).required_fields] as string[]).filter(key=>!readFieldOptional(operation,f,key));
  // P2b: a service list stands for the single service (every name resolved).
  if(f.service_names&&serviceListOperation(operation))return required.map(key=>key==="service_ref"?"service_list_ref":key);
  if(operation!=="appointment.change"||!schedulingAlteration(f))return required;
  const kept=!f.date&&!f.time&&!f.period;
  return [...required.filter(key=>!kept||key!=="date"&&key!=="time"),...(f.target_professional_name?["target_professional_ref"]:[]),...(f.service_changes?["service_changes_ref"]:[])];
}
/** P3b (flag SALON_SECRETARY_READS_V2): a list/read of ONE customer with no day, clock or period said is that customer's next
 * appointments, so no day is required (a clock or period without a day still asks the day; without a customer the day is
 * required as before). The runtime requirement only: the requirements published to Luna are unchanged. */
export const readDayOptional=(operation:string|undefined,f:{customer_ref?:unknown;customer_name?:unknown;time?:unknown;period?:unknown})=>
  readsV2Enabled()&&(operation==="appointment.list"||operation==="appointment.read")&&!!(f.customer_ref||f.customer_name)&&f.time==null&&f.period==null;
/** P3b: availability with no professional said lists each eligible professional's free times (the professional is optional). */
const readFieldOptional=(operation:string,f:Partial<SchedulingFields>,key:string)=>readsV2Enabled()&&(key==="professional_ref"&&operation==="availability.get"||key==="date"&&readDayOptional(operation,f));
/** The required fields this draft still lacks (a service delta needs every one of its names resolved). */
export const schedulingMissingRequired=(operation: z.infer<typeof schedulingOperation>,f: Partial<SchedulingFields>)=>
  schedulingRequiredFields(operation,f).filter(key=>!requiredFieldHeld(f,key));
/** Whether the draft holds this required field (a service delta or a service list needs every one of its names resolved). */
export const requiredFieldHeld=(f:Partial<SchedulingFields>,key:string)=>key==="service_changes_ref"?serviceChangesResolved(f):key==="service_list_ref"?!!f.service_names&&serviceListResolved(f):!!f[key as keyof SchedulingFields];

export function schedulingRequirements(operation: z.infer<typeof schedulingOperation>) {
  return { operation, requirements_version: "scheduling-actions-v1",
    required_fields: operation === "appointment.create" ? ["customer_ref", "service_ref", "professional_ref", "date", "time"]
      : operation === "appointment.change" ? ["appointment_ref","date","time"] : operation === "appointment.cancel" ? ["appointment_ref","reason"] : operation === "schedule.block" ? ["professional_ref","date","time","end_time"] : operation === "availability.get" ? ["service_ref", "professional_ref", "date"] : ["date"],
    backend_resolution: true, price_duration_from_domain: true, auto_assign_only_single_eligible: true,
    supported_fields: [...publishedSchedulingFields(),...(operation==="appointment.create"&&schedulingOverlapEnabled()?Object.keys(schedulingExceptionFields):[]),
      ...(operation==="appointment.change"&&alterAppointmentEnabled()?Object.keys(alterationFields):[])], defaults: {} };
}
/** C6 lint: the fields the model can fill as the wire publishes them. Components mode (flag) publishes `components`
 * instead of the relative-day and weekday selectors, which the decoder still reads. */
const componentOnlySelectors=new Set(["day_offset","weekday","source_day_offset","source_weekday"]);
const publishedSchedulingFields=()=>temporalComponentsEnabled()?["components",...Object.keys(schedulingFields).filter(key=>!componentOnlySelectors.has(key))]:Object.keys(schedulingFields);
export function resolveSchedulingDate(patch: z.infer<typeof schedulingPatch>, timezone: string, now: Date): z.infer<typeof schedulingPatch> {
  const {source_date,source_day_offset,source_weekday,...target}=patch;
  const source = [source_date,source_day_offset,source_weekday].some(x=>x!==undefined) ? resolveSchedulingDate({date:source_date,day_offset:source_day_offset,weekday:source_weekday},timezone,now).date : undefined;
  patch=target;
  const selectors = [patch.date, patch.day_offset, patch.weekday].filter(x=>x!==undefined);
  if (selectors.length>1) throw new Error("AMBIGUOUS_DATE");
  const today = dateKeyInTimeZone(now,timezone);
  let date = patch.date;
  if (patch.day_offset!==undefined) date=addCalendarDays(today,patch.day_offset);
  if (patch.weekday!==undefined) date=addCalendarDays(today,(patch.weekday-weekdayOfDateKey(today)+7)%7 || 7);
  if (date && !isDateKey(date)) throw new Error("INVALID_LOCAL_DATE");
  const { day_offset: _offset, weekday: _weekday, ...rest }=patch; void _offset; void _weekday;
  return {...rest,...(date?{date}:{}),...(source?{source_date:source}:{})};
}

export const batchRequirements = () => ({ operation: "action.batch" as const, requirements_version: schedulingOverlapEnabled()?"scheduling-batch-t21-v2":"scheduling-batch-v1", max_operations: 2,
  execution_policy: "all_or_nothing", supported: ["appointment.cancel", "appointment.create"], reason_required: true, backend_resolution: true,
  ...(schedulingOverlapEnabled()?{destination_modes:["SAME_RELEASED_SLOT","ALTERNATIVE_SLOT"],override_requires_explicit_consent_and_reason:true}:{} ) });
