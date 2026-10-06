import type { Tx } from "./prisma-tenant";
import { workingHoursForDate } from "./working-hours";

/** Owner, 06/10/2026: "bloqueia a agenda do Arthur o dia inteiro" blocks that professional's whole working day: from the first
 * minute to the last of their own hours on that date (weekly hours plus that day's extra openings), for any professional.
 * Only when no time was said; a time said in the same or a later turn always wins. */
const WHOLE_DAY = /\b(?:o\s+)?dia\s+(?:inteiro|todo|completo)\b|\btodo\s+o\s+dia\b/i;
export const saysWholeDay = (text?: string) => !!text && WHOLE_DAY.test(text);

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** The professional's hours on that date as a block (start and end), or undefined when they do not work that day. */
export async function wholeDayBounds(tx: Tx, salonId: string, professionalId: string, dateKey: string) {
  const shifts = await workingHoursForDate(tx, salonId, professionalId, dateKey);
  if (!shifts.length) return undefined;
  const start = Math.min(...shifts.map(s => s.startMinutes)), end = Math.max(...shifts.map(s => s.endMinutes));
  return start < end && end < 24 * 60 ? { time: clock(start), end_time: clock(end) } : undefined;
}
