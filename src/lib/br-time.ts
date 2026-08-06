import {
  DEFAULT_TIMEZONE,
  dateKeyInTimeZone,
  dayRangeInTimeZone,
  hhmmInTimeZone,
  weekdayInTimeZone,
  weekdayOfDateKey,
  wallClockMinutesInTimeZone,
  zonedDateTimeToUtc,
} from "./time";

/**
 * Compatibilidade para módulos antigos que ainda trabalham explicitamente em
 * Brasília. Novos fluxos devem usar `time.ts` com o timezone IANA do salão;
 * manter estes wrappers evita uma troca ampla e arriscada numa única fase.
 */
export const BR_TZ = DEFAULT_TIMEZONE;

/** "YYYY-MM-DD" → dia da semana. Data-calendário pura não depende de fuso. */
export function weekdayOfDateStr(dateStr: string): number {
  return weekdayOfDateKey(dateStr);
}

/** "YYYY-MM-DD" + minutos desde meia-noite (horário de Brasília) → instante UTC real. */
export function brazilInstant(dateStr: string, minutesFromMidnight: number): Date {
  const hours = Math.floor(minutesFromMidnight / 60).toString().padStart(2, "0");
  const minutes = (minutesFromMidnight % 60).toString().padStart(2, "0");
  return zonedDateTimeToUtc(dateStr, `${hours}:${minutes}`, BR_TZ);
}

/** Instante UTC real → hora/minuto no horário de parede de Brasília. */
export function brazilWallClock(instant: Date): { hours: number; minutes: number } {
  const total = wallClockMinutesInTimeZone(instant, BR_TZ);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Instante UTC real → dia da semana (0=domingo) em Brasília. */
export function brazilWeekday(instant: Date): number {
  return weekdayInTimeZone(instant, BR_TZ);
}

/** Instante UTC real → "HH:MM" no horário de parede de Brasília. */
export function brazilHHMM(instant: Date): string {
  return hhmmInTimeZone(instant, BR_TZ);
}

/**
 * Instante UTC real → "YYYY-MM-DD" do dia-calendário em Brasília.
 * `toISOString()` sempre devolve UTC; a chave precisa ser formatada no fuso.
 */
export function brazilDateKey(instant: Date): string {
  return dateKeyInTimeZone(instant, BR_TZ);
}

export function startOfBrazilDay(instant: Date): Date {
  return dayRangeInTimeZone(instant, BR_TZ).from;
}

export function endOfBrazilDay(instant: Date): Date {
  return new Date(dayRangeInTimeZone(instant, BR_TZ).to.getTime() - 1);
}
