import { z } from "zod";

/** Temporal components (flag, default off). Luna reports WHAT the user said about a day or a
 * clock (relative day, weekday + week, day of month, days from now; hour/minute/daypart) and
 * the backend computes the calendar date from the salon clock. Each role keeps the pinned
 * {value, literal} pair; `value` is a small typed object instead of a model-computed date.
 * Published only while SALON_SECRETARY_TEMPORAL_COMPONENTS=true; with the flag off the wire,
 * the instructions and every recorded output are exactly the historical ones. */
export const temporalComponentsEnabled = () => process.env.SALON_SECRETARY_TEMPORAL_COMPONENTS === "true";

export const dayComponentKinds = ["RELATIVE_DAY", "WEEKDAY", "DAY_OF_MONTH", "DAYS_FROM_NOW"] as const;
export const weekScopes = ["NEAREST", "THIS_WEEK", "NEXT_WEEK", "AMBIGUOUS_NEXT"] as const;
export const clockDayparts = ["MANHA", "TARDE", "NOITE", "UNSPECIFIED"] as const;
/** Role keys of the `components` container: exactly the existing temporal roles. */
export const temporalComponentRoles = ["date", "source_date", "end_date", "time", "source_time", "end_time"] as const;
export type TemporalComponentRole = typeof temporalComponentRoles[number];
export const isDateComponentRole = (role: string) => role.endsWith("date");

// Bounds and kind coherence are backend checks per role (a bad value asks about that role,
// never fails the whole turn); the transport only fixes the shape.
const count = z.number().int().nullable();
export const dayComponent = z.object({ kind: z.enum(dayComponentKinds), offset: count, weekday: count, week: z.enum(weekScopes).nullable(),
  day: count, month: count, year: count, days: count }).strict();
export const clockComponent = z.object({ hour: z.number().int(), minute: z.number().int(), daypart: z.enum(clockDayparts) }).strict();
export type DayComponent = z.infer<typeof dayComponent>;
export type ClockComponent = z.infer<typeof clockComponent>;
export const temporalComponent = z.union([dayComponent, clockComponent]);
export type TemporalComponent = z.infer<typeof temporalComponent>;

const literal = z.string().min(1).max(600).regex(/\S/);
const pair = <T extends z.ZodType>(value: T) => z.object({ value, literal }).strict().nullable();
/** Decoder view of the published container (never a domain field). */
export const temporalComponentsTransport = z.object({
  date: pair(dayComponent), source_date: pair(dayComponent), end_date: pair(dayComponent),
  time: pair(clockComponent), source_time: pair(clockComponent), end_time: pair(clockComponent),
}).strict().nullable();

type Schema = Record<string, unknown>;
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: "null" }] });
const object = (properties: Record<string, Schema>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
/** The published day and clock value schemas (shared, byte-identical, by every container that carries a component). */
export function dayComponentWire(): Schema {
  const int = nullable({ type: "integer" });
  return object({ kind: { type: "string", enum: [...dayComponentKinds] }, offset: int, weekday: int, week: nullable({ type: "string", enum: [...weekScopes] }),
    day: int, month: int, year: int, days: int });
}
export const clockComponentWire = (): Schema => object({ hour: { type: "integer" }, minute: { type: "integer" }, daypart: { type: "string", enum: [...clockDayparts] } });
/** Hand-written compact JSON Schema (the 64k request budget): no numeric bounds, no prose.
 * `literalSchema` is the exact published literal schema, so $defs compaction shares it. */
export function temporalComponentsWire(literalSchema: Schema): Schema {
  const day = dayComponentWire(), clock = clockComponentWire();
  const selector = (value: Schema) => nullable(object({ value, literal: literalSchema }));
  return nullable(object(Object.fromEntries(temporalComponentRoles.map(role => [role, selector(isDateComponentRole(role) ? day : clock)]))));
}

/** Components-mode instructions, only while the flag is on. In the decision transport the
 * catalog example that tells Luna to compute a selector is replaced (see index.ts). */
export const temporalComponentInstructions = `components (preferido): cada papel null ou {value,literal}; não calcule datas, o backend calcula. Data {kind,offset,weekday,week,day,month,year,days}, null no que não se aplica: RELATIVE_DAY offset hoje=0/amanhã=1/depois de amanhã=2; WEEKDAY weekday 0=domingo..6=sábado, week NEAREST, THIS_WEEK ("esta sexta"), NEXT_WEEK ("sexta da semana que vem"), AMBIGUOUS_NEXT ("sexta que vem", "próxima sexta"); DAY_OF_MONTH day, month/year só se ditos; DAYS_FROM_NOW days ("daqui a 3 dias"). Hora {hour como dito,minute,daypart MANHA/TARDE/NOITE dito ou UNSPECIFIED}; meio-dia=12, meia-noite=0. Intervalo ("das 10 às 11"): time e end_time com o mesmo literal inteiro. Seletores date/time antigos só respondem a pending_temporal_ambiguities/pending_calendar_conflicts (DATE_CHOICE: date={value:um dos candidates,literal:resposta atual}); stated_weekday vai em components.`;
/** The catalog's legacy selector clause (skill-registry decisionTemporalClause) that would contradict "não calcule datas"
 * in components mode and name selectors the components wire does not publish: removed (C6 lint). The components
 * instructions and the "Hoje" line already say that dates and clocks go in components. */
export const legacySelectorExample = [' Seletores temporais: amanhã day_offset={value:1,literal:"amanhã"}; date value YYYY-MM-DD; time value HH:mm.', ''] as const;
