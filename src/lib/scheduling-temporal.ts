import type { SchedulingFields } from "./scheduling-contract";
import { addCalendarDays } from "./time";
import { z } from "zod";

// Audit evidence only; never merged back into effective fields or model context.
export const temporalRejectionSchema = z.object({
  code: z.enum(["TIME_OUTSIDE_PERIOD", "END_NOT_AFTER_START", "SOURCE_TEMPORAL_CONFLICT"]),
  field: z.enum(["date", "source_date", "source_time", "time", "period", "end_time", "end_date"]),
  value: z.string().max(20),
  retained_value: z.string().max(20).optional(),
}).strict();
export type TemporalRejection = z.infer<typeof temporalRejectionSchema>;

/** Rejection of a new patch is distinct from invalidating an accepted value.
 * Only the backend's unchanged prior value can survive a rejected retarget. */
export function applyTemporalRejections(fields: SchedulingFields, previous: SchedulingFields, rejected: TemporalRejection[]) {
  for (const rejection of rejected) {
    if (rejection.code !== "SOURCE_TEMPORAL_CONFLICT") continue;
    const retained = rejection.retained_value;
    if (retained !== undefined && previous[rejection.field] === retained && fields[rejection.field] === retained) continue;
    delete fields[rejection.field];
  }
  if (rejected.some(item=>item.code==="SOURCE_TEMPORAL_CONFLICT")) delete fields.appointment_ref;
}

/** Existing availability dayparts, in the salon's local clock. */
export function matchesSchedulingPeriod(time: string, period: SchedulingFields["period"]) {
  const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return !period || (period === "morning" ? minute < 720 : period === "afternoon" ? minute >= 720 && minute < 1080 : minute >= 1080);
}

/** Domain consistency precedes field presence. A supplied daypart invalidates
 * an incompatible clock even when that clock was repeated in the same patch.
 * Rejected values belong to audit history, never the effective draft. */
export function reconcileSchedulingTemporal(previous: SchedulingFields, patch: SchedulingFields) {
  const provided = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as SchedulingFields;
  const fields = { ...previous, ...provided };
  const rejected: TemporalRejection[] = [];
  if (fields.time && fields.period && !matchesSchedulingPeriod(fields.time, fields.period)) {
    if (provided.time !== undefined && provided.period === undefined) {
      rejected.push({code:"TIME_OUTSIDE_PERIOD",field:"period",value:fields.period});
      delete fields.period;
    } else {
      rejected.push({code:"TIME_OUTSIDE_PERIOD",field:"time",value:fields.time});
      delete fields.time;
    }
  }
  if (schedulingTemporalConflicts(fields).some(c=>c.code==="END_NOT_AFTER_START")) {
    rejected.push({code:"END_NOT_AFTER_START",field:"end_time",value:fields.end_time!});
    delete fields.end_time;
    if (fields.end_date && fields.date && fields.end_date < fields.date) {
      rejected.push({code:"END_NOT_AFTER_START",field:"end_date",value:fields.end_date});
      delete fields.end_date;
    }
  }
  return { fields, rejected };
}

export function reconcileSchedulingFields(previous: SchedulingFields, patch: SchedulingFields): SchedulingFields {
  return reconcileSchedulingTemporal(previous, patch).fields;
}

export function schedulingTemporalConflicts(fields: SchedulingFields) {
  const conflicts: { code: string; field: "time" | "end_time" | "date" }[] = [];
  if (fields.time && fields.period && !matchesSchedulingPeriod(fields.time, fields.period)) {
    conflicts.push({ code: "TIME_OUTSIDE_PERIOD", field: "time" });
  }
  // U03 must not persist unresolved relative selectors alongside absolute dates.
  if ([fields.day_offset, fields.weekday, fields.source_day_offset, fields.source_weekday].some(value => value !== undefined)) {
    conflicts.push({ code: "UNRESOLVED_DATE", field: "date" });
  }
  if (fields.date && fields.time && fields.end_time) {
    const endDate = fields.end_date ?? (fields.end_time === "00:00" ? addCalendarDays(fields.date, 1) : fields.date);
    if (`${endDate}T${fields.end_time}` <= `${fields.date}T${fields.time}`) {
      conflicts.push({ code: "END_NOT_AFTER_START", field: "end_time" });
    }
  }
  return conflicts;
}

export function assertSchedulingTemporalConsistency(fields: SchedulingFields) {
  if (schedulingTemporalConflicts(fields).length) throw Error("TEMPORAL_CONFLICT");
}
