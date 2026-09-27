import { z } from "zod";
import { schedulingExceptionFields, schedulingOverlapEnabled } from "./scheduling-conflict-contract";
import { reasonSource } from "./scheduling-literal-source";
import { overrideReasonSource } from "./scheduling-reason-source";
import { schedulingOperationIds } from "../../packages/salon-secretary/src/scheduling-skill";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, weekdayOfDateKey } from "./time";

// Domain uses Zod 3; SDK extraction uses its isolated Zod 4 adapter.
export const schedulingOperation=z.enum(schedulingOperationIds);
const schedulingFields={customer_name:z.string().trim().min(2).max(200),service_name:z.string().trim().min(2).max(200),professional_name:z.string().trim().min(2).max(200),date:z.string().refine(isDateKey),day_offset:z.number().int().min(0).max(365),weekday:z.number().int().min(0).max(6),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),period:z.enum(["morning","afternoon","evening"]),source_date:z.string().refine(isDateKey),source_day_offset:z.number().int().min(0).max(365),source_weekday:z.number().int().min(0).max(6),source_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end_date:z.string().refine(isDateKey),reason:z.string().trim().max(200)};
export const schedulingPatch = z.object({...schedulingFields,...schedulingExceptionFields}).partial().strict();
export const schedulingResolved = z.object({
  override_reason_source: overrideReasonSource, reason_source: reasonSource,
  ...schedulingFields, ...schedulingExceptionFields, appointment_ref:z.string().min(1).max(100), customer_ref: z.string().min(1).max(100), service_ref: z.string().min(1).max(100), professional_ref: z.string().min(1).max(100),
}).partial().strict();
export type SchedulingFields = z.infer<typeof schedulingResolved>;

export function schedulingRequirements(operation: z.infer<typeof schedulingOperation>) {
  return { operation, requirements_version: "scheduling-actions-v1",
    required_fields: operation === "appointment.create" ? ["customer_ref", "service_ref", "professional_ref", "date", "time"]
      : operation === "appointment.change" ? ["appointment_ref","date","time"] : operation === "appointment.cancel" ? ["appointment_ref","reason"] : operation === "schedule.block" ? ["professional_ref","date","time","end_time"] : operation === "availability.get" ? ["service_ref", "professional_ref", "date"] : ["date"],
    backend_resolution: true, price_duration_from_domain: true, auto_assign_only_single_eligible: true,
    supported_fields: [...Object.keys(schedulingFields),...(operation==="appointment.create"&&schedulingOverlapEnabled()?Object.keys(schedulingExceptionFields):[])], defaults: {} };
}
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
