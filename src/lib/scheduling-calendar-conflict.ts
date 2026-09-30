import { z } from "zod";
import { isDateKey, weekdayOfDateKey } from "./time";
import type { SchedulingFields } from "./scheduling-contract";
import { formatDay } from "./secretary-datetime-format";
import { temporalQuestionLabel } from "./scheduling-field-labels";

/** An unresolved factual contradiction, never an executable date candidate. */
const weekdayDateConflict = z.object({
  field: z.enum(["source_date", "date", "end_date"]),
  kind: z.literal("WEEKDAY_DATE_CONFLICT"),
  expression: z.string().min(1).max(600),
  calendar_date: z.string().refine(isDateKey),
  stated_weekday: z.number().int().min(0).max(6),
  actual_weekday: z.number().int().min(0).max(6),
}).strict().refine(value => value.stated_weekday !== value.actual_weekday &&
  weekdayOfDateKey(value.calendar_date) === value.actual_weekday, "Invalid calendar contradiction");
/** Components mode: one reference that names two different days ("sexta que vem" = this
 * coming Friday or next week's). Both are options to choose, neither is executable. */
const dateChoice = z.object({
  field: z.enum(["source_date", "date", "end_date"]),
  kind: z.literal("DATE_CHOICE"),
  expression: z.string().min(1).max(600),
  candidates: z.tuple([z.string().refine(isDateKey), z.string().refine(isDateKey)]),
}).strict().refine(value => value.candidates[0] < value.candidates[1], "Invalid date choice");
export const pendingCalendarConflict = z.union([weekdayDateConflict, dateChoice]);
export const pendingCalendarConflicts = z.array(pendingCalendarConflict).max(3).refine(
  values => new Set(values.map(value => value.field)).size === values.length, "Duplicate calendar role");
export type PendingCalendarConflict = z.infer<typeof pendingCalendarConflict>;

export function firstCalendarConflict(values: readonly PendingCalendarConflict[] = []) {
  return [...values].sort((a,b) => ["source_date","date","end_date"].indexOf(a.field) - ["source_date","date","end_date"].indexOf(b.field))[0];
}
/** `operation` (UX-COPY, flag SALON_SECRETARY_COPY_V2): the role is named by what the operation does; off, the historical label. */
export function calendarConflictQuestion(value: PendingCalendarConflict, operation?: string) {
  const weekdays = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const label = temporalQuestionLabel(value.field, operation);
  if (value.kind === "DATE_CHOICE") return `Para a ${label}, “${value.expression}” é ${formatDay(value.candidates[0])} ou ${formatDay(value.candidates[1])}?`;
  const date = value.calendar_date.split("-").reverse().join("/");
  return `Você informou ${weekdays[value.stated_weekday]}, mas ${date} cai em ${weekdays[value.actual_weekday]}. Para a ${label}, vale ${weekdays[value.stated_weekday]} ou ${date}?`;
}
/** UX (flag SALON_SECRETARY_DATE_RULES_V2): said before a DATE_CHOICE asked again after an answer that settled neither
 * date, so a closed question is never repeated silently (starts like the other plan notices of what was not found). */
export const dateChoiceRetry = "Não encontrei na sua resposta qual das duas datas é a certa: responda com o mês ou com a data completa.";
/** The retry asks for what tells the two published dates apart (the month, else the day, else the year): a same-month choice
 * ("sexta que vem" = 02/10 or 09/10) is never told to answer with the month, which could not settle it. */
export function dateChoiceRetryFor(candidates: readonly [string, string]) {
  const [a, b] = candidates;
  return a.slice(5, 7) !== b.slice(5, 7) ? dateChoiceRetry
    : `Não encontrei na sua resposta qual das duas datas é a certa: responda com ${a.slice(8) !== b.slice(8) ? "o dia" : "o ano"} ou com a data completa.`;
}
/** A validated value resolves its own role; unrelated patches retain the facts. */
export function nextCalendarConflicts(previous: readonly PendingCalendarConflict[] = [],
  incoming: readonly PendingCalendarConflict[] = [], fields: SchedulingFields) {
  const next = new Map(previous.filter(item => !fields[item.field]).map(item => [item.field, item]));
  for (const item of incoming) if (!fields[item.field]) next.set(item.field, item);
  return pendingCalendarConflicts.parse([...next.values()]);
}
