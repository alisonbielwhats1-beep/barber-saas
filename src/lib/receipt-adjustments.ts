import { z } from "zod";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  isDateKey,
  localDateTimeToUtc,
} from "./time";

export const receiptAdjustmentsSchema = z
  .object({
    extraServiceIds: z.array(z.string().min(1)).max(30).default([]),
    surchargeCents: z.number().int().min(0).max(100_000_000).default(0),
    adjustmentReason: z.string().trim().max(300).default(""),
    receivedDate: z.string().refine(isDateKey, "Data inválida").optional(),
  })
  .refine((v) => !v.surchargeCents || v.adjustmentReason.length >= 3, {
    message: "Descreva o acréscimo em pelo menos três caracteres",
    path: ["adjustmentReason"],
  });

export type ReceiptExtra = {
  serviceId: string;
  serviceName: string;
  priceCents: number;
};
export function receiptExtras(value: unknown): ReceiptExtra[] {
  const result = z
    .array(
      z.object({
        serviceId: z.string(),
        serviceName: z.string(),
        priceCents: z.number().int().nonnegative(),
      }),
    )
    .safeParse(value);
  return result.success ? result.data : [];
}
export function defaultReceivedDate(timezone: string, now = new Date()) {
  return addCalendarDays(dateKeyInTimeZone(now, timezone), -1);
}
export function receiptDate(
  date: string | undefined,
  timezone: string,
  now = new Date(),
) {
  if (!date) return now;
  if (!isDateKey(date) || date > dateKeyInTimeZone(now, timezone))
    throw new Error("Escolha uma data de recebimento até hoje.");
  const instant = localDateTimeToUtc(`${date}T12:00`, timezone);
  return instant > now ? now : instant;
}
