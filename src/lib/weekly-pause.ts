import { z } from "zod";
import type { WeeklyHours } from "./team-schedule";

export const weeklyPauseInput = z.object({
  professionalIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinutes: z.number().int().min(0).max(1439),
  endMinutes: z.number().int().min(1).max(1440),
}).refine(v => v.endMinutes > v.startMinutes, "O fim da pausa deve ser depois do início.");
export type WeeklyPauseInput = z.infer<typeof weeklyPauseInput>;

/** Only subtract availability. Existing gaps, other weekdays and days off are preserved. */
export function subtractWeeklyPause<T extends WeeklyHours>(hours: T[], pause: Pick<WeeklyPauseInput, "weekdays" | "startMinutes" | "endMinutes">): T[] {
  return hours.flatMap(row => {
    if (!pause.weekdays.includes(row.weekday) || row.endMinutes <= pause.startMinutes || row.startMinutes >= pause.endMinutes) return [row];
    const result: T[] = [];
    if (row.startMinutes < pause.startMinutes) result.push({ ...row, endMinutes: pause.startMinutes });
    if (row.endMinutes > pause.endMinutes) result.push({ ...row, startMinutes: pause.endMinutes });
    return result;
  });
}
