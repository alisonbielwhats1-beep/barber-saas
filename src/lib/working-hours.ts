import type { Tx } from "./prisma-tenant";
import { weekdayOfDateKey } from "./time";
import { unionIntervals } from "./intervals";

type Shift = { startMinutes: number; endMinutes: number };

/** Jornada semanal somada às aberturas extras da data, sem contar sobreposição duas vezes. */
export function mergeWorkingHours(weekly: Shift[], openings: Shift[]): Shift[] {
  return unionIntervals([...weekly, ...openings].map(w => ({ start: w.startMinutes, end: w.endMinutes })))
    .map(w => ({ startMinutes: w.start, endMinutes: w.end }));
}

/** Additional date-specific shifts augment the weekly schedule. Closures still win. */
export async function workingHoursForDate(tx: Tx, salonId: string, professionalId: string, dateKey: string) {
  const weekly = await tx.workingHours.findMany({
    where: { salonId, professionalId, weekday: weekdayOfDateKey(dateKey) },
    select: { startMinutes: true, endMinutes: true },
  });
  const openings = await tx.professionalOpening.findMany({
    where: { salonId, professionalId, dateKey },
    select: { startMinutes: true, endMinutes: true },
  });
  return mergeWorkingHours(weekly, openings);
}
