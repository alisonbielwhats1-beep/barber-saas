import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import type { Locale } from "date-fns";
import { ptBR } from "date-fns/locale";

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * Rótulo único para intervalos já resolvidos como datas inclusivas.
 * Mantém Dashboard, Financeiro e Relatórios com a mesma leitura de período.
 */
export function formatPeriodLabel(from: Date, to: Date, timeZone: string): string {
  const fromDate = formatInTimeZone(from, timeZone, "yyyy-MM-dd");
  const toDate = formatInTimeZone(to, timeZone, "yyyy-MM-dd");
  if (fromDate === toDate) {
    return formatInTimeZone(from, timeZone, "d MMM yyyy", { locale: ptBR });
  }
  return `${formatInTimeZone(from, timeZone, "d MMM", { locale: ptBR })} – ${formatInTimeZone(to, timeZone, "d MMM yyyy", { locale: ptBR })}`;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const WALL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)$/;

export class InvalidTimeZoneError extends Error {
  constructor(timeZone: string) {
    super(`Fuso horário IANA inválido: ${timeZone}`);
    this.name = "InvalidTimeZoneError";
  }
}

export class InvalidWallClockError extends Error {
  constructor(value: string) {
    super(`Data/hora local inválida: ${value}`);
    this.name = "InvalidWallClockError";
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) throw new InvalidTimeZoneError(timeZone);
  return timeZone;
}

export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isWallTime(value: string): boolean {
  return WALL_TIME.test(value);
}

/**
 * Horário de parede do estabelecimento para instante UTC real.
 *
 * A conversão é feita no servidor usando o timezone IANA do salão. O
 * round-trip rejeita horários inexistentes em transições de DST, em vez de
 * o runtime ajustar silenciosamente para outra hora.
 */
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date {
  assertTimeZone(timeZone);
  if (!isDateKey(date) || !isWallTime(time)) {
    throw new InvalidWallClockError(`${date}T${time}`);
  }

  const local = `${date}T${time}:00`;
  const instant = fromZonedTime(local, timeZone);
  const roundTrip = formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm");
  if (roundTrip !== `${date}T${time}`) {
    throw new InvalidWallClockError(`${date}T${time}`);
  }
  // Na volta do horário de verão, a mesma hora de parede pode representar
  // dois instantes. Como o formulário não coleta offset, escolher um deles
  // silenciosamente seria inseguro; o servidor pede outro horário.
  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 15) {
    if (offsetMinutes === 0) continue;
    const candidate = new Date(instant.getTime() + offsetMinutes * 60_000);
    if (
      formatInTimeZone(candidate, timeZone, "yyyy-MM-dd'T'HH:mm") ===
      `${date}T${time}`
    ) {
      throw new InvalidWallClockError(`${date}T${time}`);
    }
  }
  return instant;
}

export function localDateTimeToUtc(value: string, timeZone: string): Date {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) throw new InvalidWallClockError(value);
  return zonedDateTimeToUtc(match[1]!, match[2]!, timeZone);
}

export function toLocalDateTime(instant: Date, timeZone: string): string {
  assertTimeZone(timeZone);
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm");
}

export function dateKeyInTimeZone(instant: Date, timeZone: string): string {
  assertTimeZone(timeZone);
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

export function hhmmInTimeZone(instant: Date, timeZone: string): string {
  assertTimeZone(timeZone);
  return formatInTimeZone(instant, timeZone, "HH:mm");
}

export function wallClockMinutesInTimeZone(instant: Date, timeZone: string): number {
  const zoned = toZonedTime(instant, assertTimeZone(timeZone));
  return zoned.getHours() * 60 + zoned.getMinutes();
}

export function weekdayOfDateKey(date: string): number {
  if (!isDateKey(date)) throw new InvalidWallClockError(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

export function weekdayInTimeZone(instant: Date, timeZone: string): number {
  return weekdayOfDateKey(dateKeyInTimeZone(instant, timeZone));
}

export function addCalendarDays(date: string, amount: number): string {
  if (!isDateKey(date)) throw new InvalidWallClockError(date);
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return [
    String(result.getUTCFullYear()).padStart(4, "0"),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function startOfDateInTimeZone(date: string, timeZone: string): Date {
  return zonedDateTimeToUtc(date, "00:00", timeZone);
}

/** Limite exclusivo do dia seguinte, ideal para queries [from, to). */
export function endExclusiveOfDateInTimeZone(date: string, timeZone: string): Date {
  return startOfDateInTimeZone(addCalendarDays(date, 1), timeZone);
}

export function dayRangeInTimeZone(
  instant: Date,
  timeZone: string,
): { from: Date; to: Date } {
  const date = dateKeyInTimeZone(instant, timeZone);
  return {
    from: startOfDateInTimeZone(date, timeZone),
    to: endExclusiveOfDateInTimeZone(date, timeZone),
  };
}

export function dateRangeInTimeZone(
  fromDate: string,
  toDateInclusive: string,
  timeZone: string,
): { from: Date; to: Date } {
  return {
    from: startOfDateInTimeZone(fromDate, timeZone),
    to: endExclusiveOfDateInTimeZone(toDateInclusive, timeZone),
  };
}

export function monthRangeInTimeZone(
  date: string,
  timeZone: string,
): { from: Date; to: Date } {
  if (!isDateKey(date)) throw new InvalidWallClockError(date);
  const [year, month] = date.split("-").map(Number);
  const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12
    ? `${String(year! + 1).padStart(4, "0")}-01-01`
    : `${String(year).padStart(4, "0")}-${String(month! + 1).padStart(2, "0")}-01`;
  return {
    from: startOfDateInTimeZone(first, timeZone),
    to: startOfDateInTimeZone(nextMonth, timeZone),
  };
}

export function formatInSalonTime(
  instant: Date,
  timeZone: string,
  pattern: string,
  options?: { locale?: Locale },
): string {
  assertTimeZone(timeZone);
  return formatInTimeZone(instant, timeZone, pattern, options);
}
