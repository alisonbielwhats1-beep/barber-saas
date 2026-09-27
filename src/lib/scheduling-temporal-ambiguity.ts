import { z } from "zod";
import type { SchedulingFields } from "./scheduling-contract";
import type { TemporalRejection } from "./scheduling-temporal";
import type { PendingCalendarConflict } from "./scheduling-calendar-conflict";

/** Backend-owned unresolved constraint, never an accepted executable field. */
export const pendingTemporalAmbiguity = z.object({
  field: z.enum(["source_time", "time", "end_time"]),
  kind: z.literal("CLOCK_DAYPART"),
  expression: z.string().min(1).max(600),
  candidates: z.tuple([z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]),
}).strict().refine(value=>value.candidates[0].slice(3)===value.candidates[1].slice(3)&&Math.abs(Number(value.candidates[0].slice(0,2))-Number(value.candidates[1].slice(0,2)))===12,"Invalid half-day alternatives");
export const pendingTemporalAmbiguities = z.array(pendingTemporalAmbiguity).max(3).refine(
  values => new Set(values.map(value => value.field)).size === values.length, "Duplicate temporal role");
export type PendingTemporalAmbiguity = z.infer<typeof pendingTemporalAmbiguity>;
export type TemporalAmbiguityContext = {
  pending_temporal_ambiguities?: readonly PendingTemporalAmbiguity[];
  pending_calendar_conflicts?: readonly PendingCalendarConflict[];
  scope_valid?: boolean;
  draft_ref: string; draft_revision: number; expires_at: string;
};

export function firstTemporalAmbiguity(values: readonly PendingTemporalAmbiguity[] = []) {
  return [...values].sort((a,b) => ["source_time","time","end_time"].indexOf(a.field) - ["source_time","time","end_time"].indexOf(b.field))[0];
}
export function temporalAmbiguityQuestion(value: PendingTemporalAmbiguity) {
  const label = {source_time:"horário original",time:"horário de destino",end_time:"horário final"}[value.field];
  return `No ${label}, “${value.expression}” significa ${value.candidates.map(time => time.replace(":00","h").replace(":","h")).join(" ou ")}?`;
}
/** Current active constraints replace only the same role. Audit values are never inputs. */
export function nextTemporalAmbiguities(previous: readonly PendingTemporalAmbiguity[] = [],
  incoming: readonly PendingTemporalAmbiguity[] = [], fields: SchedulingFields,
  patch: SchedulingFields = {}, rejected: readonly TemporalRejection[] = []) {
  const next = new Map(previous.filter(item => !fields[item.field] &&
    !(patch[item.field] !== undefined && rejected.some(rejection => rejection.field === item.field)))
    .map(item => [item.field,item]));
  for (const item of incoming) if (!fields[item.field]) next.set(item.field,item);
  return pendingTemporalAmbiguities.parse([...next.values()]);
}
