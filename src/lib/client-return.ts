import { addCalendarDays } from "./time";

/** Uma visita por data/pessoa/serviço. Repetições no mesmo atendimento não encurtam a frequência. */
export function predictedReturn(dates: string[], fallbackDays: number) {
  const visits = [...new Set(dates)].sort().reverse();
  if (!visits.length) return null;
  const intervals = visits
    .slice(0, -1)
    .map((date, index) =>
      Math.round(
        (Date.parse(date) - Date.parse(visits[index + 1]!)) / 86_400_000,
      ),
    )
    .filter((days) => days >= 1 && days <= 365)
    .slice(0, 6)
    .sort((a, b) => a - b);
  const fromHistory = intervals.length >= 2;
  const middle = Math.floor(intervals.length / 2);
  const cadence = fromHistory
    ? intervals.length % 2
      ? intervals[middle]!
      : Math.round((intervals[middle - 1]! + intervals[middle]!) / 2)
    : fallbackDays;
  return {
    lastDate: visits[0]!,
    date: addCalendarDays(visits[0]!, cadence),
    cadence,
    fromHistory,
  };
}
