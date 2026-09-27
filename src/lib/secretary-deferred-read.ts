import { nextTemporalAmbiguities, type TemporalAmbiguityContext } from "./scheduling-temporal-ambiguity";
import { nextCalendarConflicts } from "./scheduling-calendar-conflict";
import type { PlanAction, SchedulingTemporalEvidence } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { schedulingTimezone } from "./scheduling-catalog";
import { schedulingPatch } from "./scheduling-contract";
import { groundSchedulingTemporal } from "./scheduling-temporal-source";
import { reconcileSchedulingTemporal } from "./scheduling-temporal";

/** Validate a deferred read at the user's turn. Reading data still waits for its
 * dependencies; relative selectors and source quotes must not wait until then. */
export async function prepareDeferredReadFields(actor: ServiceActor, action: PlanAction,
  patchFields: Record<string, unknown>, sourceMessage: string, requestedField?: string, now = new Date(), context?: TemporalAmbiguityContext) {
  const supplied = Object.fromEntries(Object.entries(patchFields).filter(([, value]) => value != null));
  const fields = { ...action.fields, ...supplied } as PlanAction["fields"] & Record<string, unknown>;
  for (const key of ["financial", "inventory", "communication"] as const) {
    const nested = supplied[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested))
      Object.assign(fields, {[key]: {...action.fields[key], ...Object.fromEntries(Object.entries(nested).filter(([, value]) => value != null))}});
  }
  delete fields.temporal_evidence;
  if (action.skill !== "scheduling") return { fields, rejected: [], missing: [], pending_temporal_ambiguities: [], pending_calendar_conflicts: [] };
  const keys = new Set(Object.keys(schedulingPatch.shape));
  const domain = (value: Record<string, unknown>) => schedulingPatch.parse(Object.fromEntries(
    Object.entries(value).filter(([key, item]) => keys.has(key) && item != null)));
  const previous = domain(action.fields), patch = domain(patchFields);
  // Raw selectors may exist on a just-created action. Only the current patch
  // can establish them; effective state always keeps absolute dates.
  for (const key of ["day_offset", "weekday", "source_day_offset", "source_weekday"] as const) delete previous[key];
  const timezone = await withTenant(actor, tx => schedulingTimezone(tx, actor));
  const activeContext=context;
  const grounded = groundSchedulingTemporal(previous, patch, sourceMessage, timezone, now, requestedField,
    action.operation, patchFields.temporal_evidence as SchedulingTemporalEvidence | undefined,activeContext);
  const effective = reconcileSchedulingTemporal({}, grounded.fields);
  for (const key of keys) delete (fields as Record<string, unknown>)[key];
  Object.assign(fields, effective.fields);
  const rejected = [...grounded.rejected, ...effective.rejected];
  const pending_temporal_ambiguities=nextTemporalAmbiguities(context?.pending_temporal_ambiguities??action.assessment.pending_temporal_ambiguities,grounded.pending_temporal_ambiguities,effective.fields,patch,grounded.rejected);
  const pending_calendar_conflicts=nextCalendarConflicts(action.assessment.pending_calendar_conflicts,grounded.pending_calendar_conflicts,effective.fields);
  return { fields, rejected, pending_temporal_ambiguities, pending_calendar_conflicts, missing: [...new Set([...rejected.map(item => item.field),...pending_temporal_ambiguities.map(item=>item.field),...pending_calendar_conflicts.map(item=>item.field)])] };
}
