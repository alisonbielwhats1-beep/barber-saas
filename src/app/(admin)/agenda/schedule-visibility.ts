import { weekdayOfDateKey } from "@/lib/time";

export type VisualWorkingHours = {
  weekday?: number;
  dateKey?: string;
  startMinutes: number;
  endMinutes: number;
};

type Interval = { startMinutes: number; endMinutes: number };

/** Returns only the gaps that the professional cannot receive bookings in. */
export function unavailableScheduleIntervals(
  workingHours: VisualWorkingHours[],
  date: string,
  visibleStart: number,
  visibleEnd: number,
): Interval[] {
  const weekday = weekdayOfDateKey(date);
  const available = workingHours
    .filter((interval) => interval.dateKey === date || interval.weekday === weekday)
    .map((interval) => ({
      startMinutes: Math.max(visibleStart, interval.startMinutes),
      endMinutes: Math.min(visibleEnd, interval.endMinutes),
    }))
    .filter((interval) => interval.endMinutes > interval.startMinutes)
    .sort((left, right) => left.startMinutes - right.startMinutes)
    .reduce<Interval[]>((merged, interval) => {
      const previous = merged.at(-1);
      if (!previous || interval.startMinutes > previous.endMinutes) {
        merged.push({ ...interval });
      } else {
        previous.endMinutes = Math.max(previous.endMinutes, interval.endMinutes);
      }
      return merged;
    }, []);

  const unavailable: Interval[] = [];
  let cursor = visibleStart;
  for (const interval of available) {
    if (interval.startMinutes > cursor) {
      unavailable.push({ startMinutes: cursor, endMinutes: interval.startMinutes });
    }
    cursor = Math.max(cursor, interval.endMinutes);
  }
  if (cursor < visibleEnd) {
    unavailable.push({ startMinutes: cursor, endMinutes: visibleEnd });
  }
  return unavailable;
}
