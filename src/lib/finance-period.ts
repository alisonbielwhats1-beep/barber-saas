import { addCalendarDays, dateKeyInTimeZone, isDateKey, monthRangeInTimeZone, startOfDateInTimeZone, weekdayOfDateKey } from "./time";

export type FinanceCalendarPeriod = { mode: "day" | "week" | "month"; date: string };

export function resolveFinanceCalendar(period: FinanceCalendarPeriod, timezone: string) {
  if (!isDateKey(period.date)) throw new Error("Data financeira inválida");
  if (period.mode === "month") {
    const bounds = monthRangeInTimeZone(period.date, timezone);
    return { ...bounds, fromDate: dateKeyInTimeZone(bounds.from, timezone), toDate: dateKeyInTimeZone(bounds.to, timezone) };
  }
  const fromDate = period.mode === "week" ? addCalendarDays(period.date, -weekdayOfDateKey(period.date)) : period.date;
  const toDate = addCalendarDays(fromDate, period.mode === "week" ? 7 : 1);
  return { from: startOfDateInTimeZone(fromDate, timezone), to: startOfDateInTimeZone(toDate, timezone), fromDate, toDate };
}
