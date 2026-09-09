import { addCalendarDays, isDateKey, localDateTimeToUtc, weekdayOfDateKey } from "@/lib/time";

export type WeekdayRecurrence = { weekdays: number[]; untilDate: string };

/** Expand civil dates before converting each occurrence: DST must not shift the hour. */
export function availabilityOccurrences(startLocal: string, endLocal: string, timezone: string, everyWeeks = 0, count = 1, days?: WeekdayRecurrence) {
  if (days) {
    const firstDate = startLocal.slice(0, 10);
    if (everyWeeks !== 0 || count !== 1 || !isDateKey(firstDate) || !isDateKey(days.untilDate) || days.untilDate < firstDate || days.untilDate > addCalendarDays(firstDate, 365) || !days.weekdays.length || days.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Escolha dias da semana e uma data final em até um ano.");
    // A repeating daily pause must not accidentally become a multi-day closure.
    if (endLocal.slice(0, 10) !== firstDate || endLocal.slice(11) <= startLocal.slice(11)) throw new Error("Para repetir por dias da semana, início e fim devem estar no mesmo dia.");
    const intervals: { startAt: Date; endAt: Date }[] = [];
    for (let date = firstDate; date <= days.untilDate; date = addCalendarDays(date, 1)) {
      if (!days.weekdays.includes(weekdayOfDateKey(date))) continue;
      intervals.push({ startAt: localDateTimeToUtc(`${date}T${startLocal.slice(11)}`, timezone), endAt: localDateTimeToUtc(`${date}T${endLocal.slice(11)}`, timezone) });
    }
    if (!intervals.length) throw new Error("Nenhum dos dias escolhidos está nesse período.");
    return intervals;
  }
  if (![0, 1, 2, 4].includes(everyWeeks) || !Number.isInteger(count) || count < 1 || count > 52 || (everyWeeks === 0 && count !== 1)) {
    throw new Error("Escolha até 52 ocorrências semanais, quinzenais ou a cada quatro semanas.");
  }
  const intervals = Array.from({ length: count }, (_, index) => {
    const shift = index * everyWeeks * 7;
    const startAt = localDateTimeToUtc(`${addCalendarDays(startLocal.slice(0, 10), shift)}T${startLocal.slice(11)}`, timezone);
    const endAt = localDateTimeToUtc(`${addCalendarDays(endLocal.slice(0, 10), shift)}T${endLocal.slice(11)}`, timezone);
    if (endAt <= startAt || +endAt - +startAt > 366 * 86400000) throw new Error("Informe um intervalo válido de até um ano.");
    return { startAt, endAt };
  });
  if (+intervals[intervals.length - 1]!.endAt - +intervals[0]!.startAt > 366 * 86400000) throw new Error("A série deve terminar em até um ano.");
  if (intervals.some((interval, index) => index > 0 && interval.startAt < intervals[index - 1]!.endAt)) throw new Error("As ocorrências não podem se sobrepor.");
  return intervals;
}
