/** Human pt-BR date/time text for the Secretary. Presentation only: drafts, proposals,
 * hashes, receipts and the model contract keep ISO local values ("2026-09-29T10:00"). */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** "10:00" → "10h", "09:45" → "9h45". */
export function formatClock(time: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = String(Number(match[1]));
  return match[2] === "00" ? `${hour}h` : `${hour}h${match[2]}`;
}

/** "2026-09-29" → "ter, 29/09"; a year other than the reference (default: the current
 * year) is shown: "ter, 13/04/2027". */
export function formatDay(date: string, reference?: string) {
  const match = DATE_KEY.exec(date);
  if (!match) return date;
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(/\.$/, "");
  const currentYear = reference ? reference.slice(0, 4) : String(new Date().getFullYear());
  const year = currentYear !== match[1] ? `/${match[1]}` : "";
  return `${weekday}, ${match[3]}/${match[2]}${year}`;
}

/** "2026-09-29T10:00" → "ter, 29/09 às 10h". */
export function formatLocal(local: string, reference?: string) {
  const match = LOCAL.exec(local);
  return match ? `${formatDay(match[1], reference)} às ${formatClock(`${match[2]}:${match[3]}`)}` : local;
}

/** Same day: "ter, 29/09 às 10h–10h45". Across days: "ter, 29/09 às 22h → qua, 30/09 às 2h". */
export function formatLocalRange(start: string, end: string, reference?: string) {
  const a = LOCAL.exec(start), b = LOCAL.exec(end);
  if (!a || !b) return `${start}–${end}`;
  return a[1] === b[1]
    ? `${formatLocal(start, reference)}–${formatClock(`${b[2]}:${b[3]}`)}`
    : `${formatLocal(start, reference)} → ${formatLocal(end, reference)}`;
}
