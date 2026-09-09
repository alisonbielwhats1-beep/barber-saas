import { z } from "zod";

export const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export type WeeklyHours = { weekday: number; startMinutes: number; endMinutes: number };

export const teamScheduleInput = z.object({
  professionalIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  openMinutes: z.number().int().min(0).max(1439),
  closeMinutes: z.number().int().min(1).max(1440),
  pause: z.object({ startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(1).max(1440) }).nullable(),
  confirmed: z.literal(true),
}).superRefine((value, ctx) => {
  if (value.closeMinutes <= value.openMinutes) ctx.addIssue({ code: "custom", message: "Fechamento deve ser depois da abertura." });
  if (value.pause && (value.pause.startMinutes <= value.openMinutes || value.pause.endMinutes >= value.closeMinutes || value.pause.endMinutes <= value.pause.startMinutes)) {
    ctx.addIssue({ code: "custom", message: "A pausa deve ficar entre a abertura e o fechamento, com fim após o início." });
  }
});
export type TeamScheduleInput = z.infer<typeof teamScheduleInput>;

/** Preserve weekly days off; only the explicitly selected daily shifts change. */
export function replaceDailyShifts(current: WeeklyHours[], input: Pick<TeamScheduleInput, "openMinutes" | "closeMinutes" | "pause">): WeeklyHours[] {
  return [...new Set(current.map(row => row.weekday))].sort().flatMap(weekday =>
    (input.pause ? [
      { startMinutes: input.openMinutes, endMinutes: input.pause.startMinutes },
      { startMinutes: input.pause.endMinutes, endMinutes: input.closeMinutes },
    ] : [{ startMinutes: input.openMinutes, endMinutes: input.closeMinutes }]).map(interval => ({ weekday, ...interval })),
  );
}

export function scheduleLabel(hours: WeeklyHours[], weekday: number): string {
  const rows = hours.filter(row => row.weekday === weekday).sort((a, b) => a.startMinutes - b.startMinutes);
  return rows.length ? rows.map(row => `${scheduleTime(row.startMinutes)}–${scheduleTime(row.endMinutes)}`).join(" · ") : "Folga";
}

export function scheduleTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Only prefill a shared pause if every configured day has that same gap. */
export function commonDailyPause(schedules: WeeklyHours[][]): { startMinutes: number; endMinutes: number } | null {
  const days = schedules.flatMap(hours => [...new Set(hours.map(row => row.weekday))].map(day => hours.filter(row => row.weekday === day).sort((a, b) => a.startMinutes - b.startMinutes)));
  if (!days.length || days.some(day => day.length !== 2)) return null;
  const startMinutes = days[0][0].endMinutes;
  const endMinutes = days[0][1].startMinutes;
  return startMinutes < endMinutes && days.every(day => day[0].endMinutes === startMinutes && day[1].startMinutes === endMinutes) ? { startMinutes, endMinutes } : null;
}
