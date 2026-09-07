import { addCalendarDays, localDateTimeToUtc } from "@/lib/time";

/** Expand civil dates before converting each occurrence: DST must not shift the hour. */
export function availabilityOccurrences(startLocal: string, endLocal: string, timezone: string, everyWeeks = 0, count = 1) {
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
