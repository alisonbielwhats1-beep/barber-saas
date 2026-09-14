import { formatInTimeZone } from "date-fns-tz";
type Interval = { startAt: string; endAt: string };
const minutes = (value: string, zone: string) => {
  const [h, m] = formatInTimeZone(new Date(value), zone, "HH:mm")
    .split(":")
    .map(Number);
  return h! * 60 + m!;
};
/** Long/all-day blocks remain visible without stretching every day to 24 hours. */
export function agendaRange(
  appointments: Interval[],
  blocks: Interval[],
  hours: { startMinutes: number; endMinutes: number }[],
  timezone: string,
  fullDay = false,
) {
  if (fullDay) return { start: 0, end: 1440 };
  const timedBlocks = blocks.filter(
    (b) =>
      new Date(b.endAt).getTime() - new Date(b.startAt).getTime() < 86400000,
  );
  const intervals = [...appointments, ...timedBlocks];
  const crossesDate = (i: Interval) =>
    formatInTimeZone(new Date(i.startAt), timezone, "yyyy-MM-dd") !==
    formatInTimeZone(new Date(i.endAt), timezone, "yyyy-MM-dd");
  const starts = intervals.map((i) =>
    crossesDate(i) && minutes(i.endAt, timezone) > 0
      ? 0
      : minutes(i.startAt, timezone),
  );
  const ends = intervals.map((i) =>
    crossesDate(i) ? 1440 : minutes(i.endAt, timezone) || 1440,
  );
  return {
    start: Math.max(
      0,
      Math.floor(
        Math.min(480, ...starts, ...hours.map((h) => h.startMinutes)) / 30,
      ) * 30,
    ),
    end: Math.min(
      1440,
      Math.ceil(
        Math.max(1260, ...ends, ...hours.map((h) => h.endMinutes)) / 30,
      ) * 30,
    ),
  };
}
