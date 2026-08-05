import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { startOfDay, endOfDay } from "date-fns";

/**
 * O produto é 100% Brasil, sem seleção de fuso por salão. As funções daqui
 * fixam "agora"/"hoje" em America/Sao_Paulo mesmo quando o processo Node
 * roda em outro fuso — que é exatamente o caso em produção: funções
 * serverless da Vercel rodam com TZ=UTC por padrão (a região `gru1` em
 * vercel.json só afetava latência de rede, não fuso do processo), enquanto
 * em dev a máquina já está em America/Sao_Paulo. Sem isso, todo `.getHours()`
 * /`.setHours()`/`startOfDay()` do lado servidor lia o fuso errado em
 * produção — e o bug nunca aparecia localmente. `Date.prototype.getDay()`
 * em cima de string "YYYY-MM-DD" (parseada como UTC-meia-noite) é o caso
 * mais visível: em produção isso "voltava" um dia perto da virada.
 */
export const BR_TZ = "America/Sao_Paulo";

/** "YYYY-MM-DD" → dia da semana. Data-calendário pura não depende de fuso. */
export function weekdayOfDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** "YYYY-MM-DD" + minutos desde meia-noite (horário de Brasília) → instante UTC real. */
export function brazilInstant(dateStr: string, minutesFromMidnight: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 0, minutesFromMidnight, 0, 0), BR_TZ);
}

/** Instante UTC real → hora/minuto no horário de parede de Brasília. */
export function brazilWallClock(instant: Date): { hours: number; minutes: number } {
  const zoned = toZonedTime(instant, BR_TZ);
  return { hours: zoned.getHours(), minutes: zoned.getMinutes() };
}

/** Instante UTC real → dia da semana (0=domingo) em Brasília. */
export function brazilWeekday(instant: Date): number {
  return toZonedTime(instant, BR_TZ).getDay();
}

/** Instante UTC real → "HH:MM" no horário de parede de Brasília. */
export function brazilHHMM(instant: Date): string {
  const { hours, minutes } = brazilWallClock(instant);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Instante UTC real → "YYYY-MM-DD" do dia-calendário em Brasília.
 * `toISOString()` sempre devolve UTC — por isso lê os getters LOCAIS do Date
 * já convertido, não a serialização ISO dele.
 */
export function brazilDateKey(instant: Date): string {
  const zoned = toZonedTime(instant, BR_TZ);
  const y = zoned.getFullYear();
  const m = (zoned.getMonth() + 1).toString().padStart(2, "0");
  const d = zoned.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfBrazilDay(instant: Date): Date {
  return fromZonedTime(startOfDay(toZonedTime(instant, BR_TZ)), BR_TZ);
}

export function endOfBrazilDay(instant: Date): Date {
  return fromZonedTime(endOfDay(toZonedTime(instant, BR_TZ)), BR_TZ);
}
