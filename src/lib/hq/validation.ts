import { z } from "zod";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { definition, hqTimezone } from "./catalog";

export class HqError extends Error {}
export const uuid = z.string().uuid();
export const normalizedTitle = (title: string) => title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const today = (now = new Date()) => formatInTimeZone(now, hqTimezone, "yyyy-MM-dd");
export function parseValues(entity: string, input: unknown): Record<string, string | number | null> {
  const def = definition(entity);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of def.fields.filter(f => !f.readonly)) {
    let rule: z.ZodTypeAny;
    if (field.options) rule = z.string().refine(v => field.options!.includes(v), "Opção inválida.");
    else if (field.type === "relation") rule = uuid;
    else if (field.type === "money" || field.type === "number") rule = z.coerce.number().int().min(field.min ?? 0).max(field.max ?? 100_000_000);
    else if (field.type === "email") rule = z.string().trim().email().max(254);
    else if (field.type === "date" || field.type === "month") {
      rule = z.string().regex(field.type === "month" ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).transform(v => field.type === "month" ? v + "-01" : v).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Data inválida.");
    } else if (field.type === "datetime") {
      rule = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).transform(v => fromZonedTime(v, hqTimezone)).refine(v => !Number.isNaN(v.getTime()), "Data inválida.").transform(v => v.toISOString());
    } else rule = z.string().trim().min(1).max(field.type === "textarea" ? 10000 : 300);
    if (!field.required && !field.options && field.type !== "number" && field.type !== "money") rule = z.union([z.literal(""), z.null(), rule]).optional().transform(v => v === "" || v === undefined ? null : v);
    shape[field.key] = rule;
  }
  return z.object(shape).strict().parse(input);
}

