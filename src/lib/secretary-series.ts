import { recurrenceGuardEnabled } from "../../packages/salon-secretary/src/recurrence-guard";
import { addCalendarDays, weekdayOfDateKey } from "./time";
import { formatClock, formatDay, formatLocal } from "./secretary-datetime-format";
import { FIRST_ONLY_REF, RECURRENCE_CARD } from "./secretary-recurrence";

/** Owner 07/10 (flag SALON_SECRETARY_RECURRING_SERIES, default off; only with SALON_SECRETARY_RECURRENCE_GUARD): a weekly or
 * fortnightly create the owner's words state is offered as a series, the same one the manual agenda creates
 * (createRecurringAppointments: every occurrence its own appointment with one seriesId; a date that is taken or closed is skipped,
 * and said BEFORE Confirmar). The rule and its end are read from the owner's own words by the closed grammar below (no model field):
 * anything it does not read (every day, monthly, two weekdays, more than SERIES_MAX dates) keeps the guard's "só a primeira?".
 * Owner decisions 07/10: skip a taken date and say it; ask "até quando?" with shortcuts when no end is said; weekly and fortnightly
 * only. Pure: no tenant access. */
export const seriesEnabled = () => recurrenceGuardEnabled() && process.env.SALON_SECRETARY_RECURRING_SERIES === "true";
/** The manual agenda's bounds (agenda/actions.ts recurringInput.occurrences): 2 to 24 dates, the first included. */
export const SERIES_MAX = 24;
export const SERIES_REF = "recurrence-series";
export const SERIES_UNTIL_PREFIX = "recurrence-until-";
export type SeriesStep = 7 | 14;
export type SeriesRule = { step_days: SeriesStep; weekday: number | null };

/** Folds accents and case (the guard's own reading of the owner's words). */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
const weekdayNumber: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, "2a": 1, "3a": 2, "4a": 3, "5a": 4, "6a": 5, "2ª": 1, "3ª": 2, "4ª": 3, "5ª": 4, "6ª": 5 };
const weekdaysIn = (folded: string) => [...new Set([...folded.matchAll(/(domingo|segunda|terca|quarta|quinta|sexta|sabado|[2-6][ªa](?![\p{L}\p{N}]))/gu)].map(m => weekdayNumber[m[1]!]!))];

/** The repetition an expression of statedRecurrence states, when the series supports it: every week or every two weeks, on at most one
 * weekday (none written: the first occurrence's). Every day, a month, a part of the day, a weekend or N times a week is not. */
export function seriesRule(expression: string): SeriesRule | undefined {
  const folded = fold(expression).trim(), days = weekdaysIn(folded);
  const unitless = folded.replace(/de (15|quinze) em \1 dias/, "").replace(/cada (15|quinze) dias/, "");
  if (days.length > 1 || /(?<![\p{L}])(dias?|diari\p{L}*|mes|meses|mensa\p{L}*|manhas?|tardes?|noites?|fins?|finais)(?![\p{L}])/u.test(unitless)) return undefined;
  const weekday = days[0] ?? null;
  if (/quinzena|quinzenal|de (15|quinze) em \1|cada (2|duas) semanas|cada (15|quinze) dias|\bsim,? (?:a |o )?(?:outr[ao]|semana|domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)? nao/u.test(folded))
    return { step_days: 14, weekday };
  if (/(?<![\p{L}\p{N}])(\d+|dois|duas|tres)\s*(x|vez|vezes)(?![\p{L}])/u.test(folded) && !/(?<![\p{L}\p{N}])(1|uma|um)\s*(x|vez)(?![\p{L}])/u.test(folded)) return undefined;
  if (/cada (\d+|dois|duas|tres|quatro) /.test(folded)) return undefined;
  return weekday !== null || /semana|semanal/.test(folded) ? { step_days: 7, weekday } : undefined;
}

const monthNames = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTH = `(${monthNames.join("|")})`;
const SMALL: Record<string, number> = { duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };
const amount = (word: string) => /^\d+$/.test(word) ? Number(word) : SMALL[word];
const COUNT = "(\\d{1,2}|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)";
const pad = (n: number) => String(n).padStart(2, "0");
/** How the owner's words end a series: a date, the end of a month (the first date's, or a named one), weeks, or a number of dates. */
export type SeriesEnd = { until: string } | { month: number | "FIRST" } | { weeks: number } | { count: number };
/** The end a turn's words state for a series, by a closed grammar: "até dia 30", "até 30/10", "até 30 de outubro", "até o fim do mês",
 * "até (o fim de) outubro", "por/durante 6 semanas", "nas próximas 6 semanas", "4 vezes", "4 datas"; and a month written right after the
 * recurrence itself ("todas as sextas de outubro", "toda sexta deste mês"). `after`: the end of the recurrence in the text (a month right
 * after it is read only then); `today`: the salon's day (a date never reads into the past: an earlier month is next year's). */
export function seriesEnd(text: string | undefined, today: string, after?: number): SeriesEnd | undefined {
  if (!text) return undefined;
  const folded = fold(text), year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)), dayNow = Number(today.slice(8, 10));
  const dated = (d: number, m: number) => m < 1 || m > 12 || d < 1 || d > 31 ? undefined : { until: `${m < month ? year + 1 : year}-${pad(m)}-${pad(d)}` };
  let m: RegExpExecArray | null;
  if ((m = /\bate (?:o )?(?:dia )?(\d{1,2})\/(\d{1,2})\b/.exec(folded))) return dated(Number(m[1]), Number(m[2]));
  if ((m = new RegExp(`\\bate (?:o )?(?:dia )?(\\d{1,2}) de ${MONTH}\\b`).exec(folded))) return dated(Number(m[1]), monthNames.indexOf(m[2]!) + 1);
  if ((m = /\bate (?:o )?dia (\d{1,2})\b/.exec(folded))) { const d = Number(m[1]); return d >= dayNow ? dated(d, month) : dated(d, month === 12 ? 1 : month + 1); }
  if (/\bate (?:o )?(?:fim|final) (?:do|deste|desse) mes\b/.test(folded)) return { month: "FIRST" };
  if ((m = new RegExp(`\\bate (?:o )?(?:(?:fim|final) de )?${MONTH}\\b`).exec(folded))) return { month: monthNames.indexOf(m[1]!) + 1 };
  if ((m = new RegExp(`\\b(?:por|durante|pelas|nas)(?: proximas)? ${COUNT} semanas\\b`).exec(folded))) { const n = amount(m[1]!); if (n) return { weeks: n }; }
  if ((m = new RegExp(`\\b${COUNT} (?:vezes|sessoes|datas|encontros|atendimentos|horarios)\\b`).exec(folded))) { const n = amount(m[1]!); if (n) return { count: n }; }
  if (after !== undefined) {
    const next = fold(text.slice(after));
    if (/^,? (?:d[eo]ste|d[eo]sse|do) mes\b/.test(next)) return { month: "FIRST" };
    if ((m = new RegExp(`^,? (?:de|do mes de|em) ${MONTH}\\b`).exec(next))) return { month: monthNames.indexOf(m[1]!) + 1 };
  }
  return undefined;
}
const lastDayOfMonth = (date: string) => { const [y, mo] = date.split("-").map(Number); return `${y}-${pad(mo!)}-${pad(new Date(Date.UTC(y!, mo!, 0)).getUTCDate())}`; };
/** The last day a series may reach, from its end and its first date (undefined: an end before the first date). */
export function seriesUntil(end: SeriesEnd, first: string, step: SeriesStep): string | undefined {
  const until = "until" in end ? end.until : "weeks" in end ? addCalendarDays(first, end.weeks * 7 - 1) : "count" in end ? addCalendarDays(first, (end.count - 1) * step)
    : end.month === "FIRST" ? lastDayOfMonth(first) : lastDayOfMonth(`${Number(first.slice(0, 4)) + (end.month < Number(first.slice(5, 7)) ? 1 : 0)}-${pad(end.month)}-01`);
  return until >= first ? until : undefined;
}
/** Every date of the series from its first one (included), every `step` days, up to `until`; undefined beyond SERIES_MAX. */
export function seriesDates(first: string, step: SeriesStep, until: string): string[] | undefined {
  const dates: string[] = [];
  for (let day = first; day <= until; day = addCalendarDays(day, step)) { dates.push(day); if (dates.length > SERIES_MAX) return undefined; }
  return dates;
}
/** The first date of a series whose words name a weekday and no day: that weekday from today (today itself only while `time` is still
 * ahead of `nowClock`), or from the first day of a later month the end names ("todas as sextas de novembro"). */
export function seriesFirstDay(rule: SeriesRule, today: string, nowClock: string, time: string | undefined, end?: SeriesEnd): string | undefined {
  if (rule.weekday === null) return undefined;
  let from = today;
  if (end && "month" in end && end.month !== "FIRST") {
    const start = `${Number(today.slice(0, 4)) + (end.month < Number(today.slice(5, 7)) ? 1 : 0)}-${pad(end.month)}-01`;
    if (start > from) from = start;
  }
  for (let n = 0; n < 7; n++) {
    const day = addCalendarDays(from, n);
    if (weekdayOfDateKey(day) !== rule.weekday) continue;
    return day === today && time !== undefined && time <= nowClock ? addCalendarDays(day, 7) : day;
  }
  return undefined;
}

const stepLabel = (step: SeriesStep) => step === 7 ? "toda semana" : "a cada 2 semanas";
const short = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const firstOnly = (first: string, time: string) => ({ id: FIRST_ONLY_REF, name: `Só a primeira: ${formatLocal(`${first}T${time}`)}` });
/** "Até quando?" as a card: 4 and 8 dates, and the end of the first date's month when it holds 2+ dates and is another end. */
export function seriesEndQuestion(step: SeriesStep, first: string, time: string) {
  const options = new Map<string, string>();
  const month = seriesDates(first, step, lastDayOfMonth(first))!;
  if (month.length >= 2) options.set(month.at(-1)!, `Até o fim do mês (${formatDay(month.at(-1)!)})`);
  for (const count of [4, 8]) { const until = addCalendarDays(first, (count - 1) * step); if (!options.has(until)) options.set(until, `${count} datas (até ${formatDay(until)})`); }
  return { message: `Repetindo ${stepLabel(step)} a partir de ${formatLocal(`${first}T${time}`)}. Até quando marco?`,
    card: { kind: RECURRENCE_CARD, items: [...[...options].map(([until, name]) => ({ id: `${SERIES_UNTIL_PREFIX}${until}`, name })), firstOnly(first, time)] } };
}
export type SeriesPreview = { step_days: SeriesStep; until: string; first: string; occurrences: readonly { startLocal: string }[]; skipped: readonly { date: string; cause: string }[] };
/** What a skipped date is said with (the domain's cause, grouped as the owner reads it). */
export const seriesSkipLabel = (cause: string) => cause === "SALON_CLOSED" ? "salão fechado" : cause === "CUSTOMER_OVERLAP" ? "cliente já tem horário" :
  ["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS", "WORKING_HOURS_BREAK", "PROFESSIONAL_UNAVAILABLE"].includes(cause) ? "fora do expediente ou folga" : "horário ocupado";
export const seriesSkippedText = (skipped: SeriesPreview["skipped"]) => skipped.map(item => `${short(item.date)} (${seriesSkipLabel(item.cause)})`).join(", ");
/** The series card: every date that can be booked (the first included) and those left out with why, BEFORE any proposal. */
export function seriesQuestion(preview: SeriesPreview, time: string) {
  const dates = [preview.first, ...preview.occurrences.map(item => item.startLocal.slice(0, 10))], skipped = seriesSkippedText(preview.skipped);
  const head = `Repetindo ${stepLabel(preview.step_days)} às ${formatClock(time)}, de ${formatDay(preview.first)} a ${formatDay(preview.until)}.`;
  if (dates.length < 2) return { message: `${head} Só a primeira data está livre${skipped ? `; ficam de fora: ${skipped}` : ""}. Marco só ela?`, card: { kind: RECURRENCE_CARD, items: [firstOnly(preview.first, time)] } };
  return { message: `${head} Datas livres: ${dates.map(short).join(", ")}.${skipped ? ` Ficam de fora: ${skipped}.` : ""} Marco as ${dates.length} datas?`,
    card: { kind: RECURRENCE_CARD, items: [{ id: SERIES_REF, name: `Marcar as ${dates.length} datas: ${dates.map(short).join(", ")}` }, firstOnly(preview.first, time)] } };
}
/** The preview lines of a series proposal (after the first occurrence's own lines). */
export function seriesPreviewLines(series: { step_days: SeriesStep; occurrences: readonly { startLocal: string }[]; skipped: readonly { date: string; cause: string }[] }, first: string) {
  const dates = [first, ...series.occurrences.map(item => item.startLocal.slice(0, 10))];
  return `\nRepete: ${stepLabel(series.step_days)} · ${dates.length} datas: ${dates.map(short).join(", ")}${series.skipped.length ? `\nFicam de fora: ${seriesSkippedText(series.skipped)}` : ""}`;
}
/** Whether the owner's words name the series' start day themselves ("a partir do dia 16", "começando amanhã", "dia 16", "16/10",
 * "16 de outubro", "hoje", "amanhã", "semana que vem", "próxima sexta"): then the first date is theirs (asked when missing), never derived.
 * An end ("até dia 30", "até 30/10") is no start. */
export function seriesStartSaid(text: string | undefined) {
  if (!text) return false;
  const folded = fold(text).replace(/\bate (?:o )?(?:dia )?\d{1,2}(?:\/\d{1,2}| de [a-z]+)?\b/g, " ");
  return /\b(a partir|comec\w*|inici\w*|hoje|amanha|depois de amanha|semana que vem|proxim[ao]|dia \d{1,2}\b|\d{1,2}\/\d{1,2})/.test(folded) ||
    new RegExp(`\b\d{1,2} de ${MONTH}\b`).test(folded);
}
/** Whether a stated recurrence of this operation is one the series books (the guard's "não marco" notice is then never said). */
export const seriesSupports = (operation: string | undefined, expression: string) => operation === "appointment.create" && seriesEnabled() && !!seriesRule(expression);
