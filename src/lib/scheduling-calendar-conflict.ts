import { z } from "zod";
import { isDateKey, weekdayOfDateKey } from "./time";
import type { SchedulingFields } from "./scheduling-contract";

/** An unresolved factual contradiction, never an executable date candidate. */
export const pendingCalendarConflict = z.object({
  field: z.enum(["source_date", "date", "end_date"]),
  kind: z.literal("WEEKDAY_DATE_CONFLICT"),
  expression: z.string().min(1).max(600),
  calendar_date: z.string().refine(isDateKey),
  stated_weekday: z.number().int().min(0).max(6),
  actual_weekday: z.number().int().min(0).max(6),
}).strict().refine(value => value.stated_weekday !== value.actual_weekday &&
  weekdayOfDateKey(value.calendar_date) === value.actual_weekday, "Invalid calendar contradiction");
export const pendingCalendarConflicts = z.array(pendingCalendarConflict).max(3).refine(
  values => new Set(values.map(value => value.field)).size === values.length, "Duplicate calendar role");
export type PendingCalendarConflict = z.infer<typeof pendingCalendarConflict>;

export function firstCalendarConflict(values: readonly PendingCalendarConflict[] = []) {
  return [...values].sort((a,b) => ["source_date","date","end_date"].indexOf(a.field) - ["source_date","date","end_date"].indexOf(b.field))[0];
}
export function calendarConflictQuestion(value: PendingCalendarConflict) {
  const weekdays = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const label = {source_date:"data original", date:"data desejada", end_date:"data final"}[value.field];
  const date = value.calendar_date.split("-").reverse().join("/");
  return `Você informou ${weekdays[value.stated_weekday]}, mas ${date} cai em ${weekdays[value.actual_weekday]}. Para a ${label}, vale ${weekdays[value.stated_weekday]} ou ${date}?`;
}
/** A validated value resolves its own role; unrelated patches retain the facts. */
export function nextCalendarConflicts(previous: readonly PendingCalendarConflict[] = [],
  incoming: readonly PendingCalendarConflict[] = [], fields: SchedulingFields) {
  const next = new Map(previous.filter(item => !fields[item.field]).map(item => [item.field, item]));
  for (const item of incoming) if (!fields[item.field]) next.set(item.field, item);
  return pendingCalendarConflicts.parse([...next.values()]);
}
