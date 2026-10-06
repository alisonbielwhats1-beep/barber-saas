/** Candidate 5, WP4 (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §5.1 V12, graft of 07): the closed
 * reader of a DURATION the owner wrote ("meia hora", "40 min", "1h30", "uma hora e meia", "2 horas e 15 minutos"). It reads only; the
 * backend adds the minutes to a re-read row (an anchor's end or start), never Luna. A closed grammar, not a phrase list: a count (digits or
 * the spoken numbers) with an hour or minute unit, the half ("meia hora", "hora e meia") and the compact clock-like form "1h30". A clock is
 * never a duration: a form led by a clock word ("às 2h", "até 3h", "das 10h") or followed by a daypart ("10h da manhã") is refused, and so
 * is a zero, a minute part of 60 or more, anything past 24 hours, and a text with two durations (no choice between them). Offsets are the
 * ORIGINAL text's: the folding keeps one unit per UTF-16 unit. Nothing imports this module with the flag off. */
export type DurationLiteral = { minutes: number; start: number; end: number; text: string };

const SPOKEN: Readonly<Record<string, number>> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11,
  doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, noventa: 90 };
const WORD = Object.keys(SPOKEN).sort((a, b) => b.length - a.length).join("|");
const COUNT = `(?:\\d{1,3}|(?:${WORD})(?: e (?:${WORD}))?)`;
const HOURS = "(?:horas?|hrs?|h)", MINUTES = "(?:minutos?|mins?)";
/** Alternatives in order (the first that matches at a position wins): N horas e meia | hora e meia | meia hora | 1h30(min) | N horas e M minutos |
 * N horas | N minutos. */
const PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:(${COUNT})\\s*${HOURS}\\s+e\\s+meia|hora\\s+e\\s+meia|meia\\s+hora|(\\d{1,2})h(\\d{2})(?:\\s*${MINUTES})?|(${COUNT})\\s*${HOURS}\\s+e\\s+(${COUNT})\\s*${MINUTES}|(${COUNT})\\s*${HOURS}|(${COUNT})\\s*${MINUTES})(?![\\p{L}\\p{N}])`, "gu");
/** Closed class of the words that make a following hour form a clock (a time of day), never an amount of time. */
const CLOCK_LEAD = /(?:^|[^\p{L}\p{N}])(?:as|pelas|umas|das|ate|pras|la|desde)\s*$/u;
const DAYPART_AFTER = /^\s+(?:da|de|a)\s+(?:manha|tarde|noite|madrugada)(?![\p{L}\p{N}])/u;
/** One folded unit per UTF-16 unit (accents and case aside), so every index of the folded text is an index of the original. */
const fold = (text: string) => text.split("").map(unit => { const folded = unit.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR"); return folded.length === 1 ? folded : " "; }).join("");
function count(text: string | undefined): number {
  if (text === undefined) return NaN;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(" e ");
  return parts.every(part => SPOKEN[part] !== undefined) ? parts.reduce((sum, part) => sum + SPOKEN[part], 0) : NaN;
}
/** Every duration of a text, left to right (clocks and invalid amounts left out). */
export function durationLiterals(text: string): DurationLiteral[] {
  const folded = fold(text), out: DurationLiteral[] = [];
  for (const match of folded.matchAll(PATTERN)) {
    const start = match.index!, end = start + match[0].length;
    // An hour form followed by a daypart is a time of day ("10h da manhã", "duas horas da tarde").
    const hourForm = match[2] !== undefined || match[6] !== undefined;
    if (CLOCK_LEAD.test(folded.slice(0, start)) || hourForm && DAYPART_AFTER.test(folded.slice(end))) continue;
    const minutes = match[1] !== undefined ? count(match[1]) * 60 + 30 : match[0].startsWith("hora") ? 90 : match[0].startsWith("meia") ? 30
      : match[2] !== undefined ? Number(match[2]) * 60 + (Number(match[3]) < 60 ? Number(match[3]) : NaN)
      : match[4] !== undefined ? count(match[4]) * 60 + (count(match[5]) < 60 ? count(match[5]) : NaN)
      : match[6] !== undefined ? count(match[6]) * 60 : count(match[7]);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) continue;
    out.push({ minutes, start, end, text: text.slice(start, end) });
  }
  return out;
}
/** The one duration a text states (none, or two or more: undefined). */
export function durationLiteral(text: string): DurationLiteral | undefined {
  const found = durationLiterals(text);
  return found.length === 1 ? found[0] : undefined;
}
export const durationMinutes = (text: string) => durationLiteral(text)?.minutes;
/** "30 min", "1h", "1h30" (the owner-facing form of an amount of minutes). */
export const durationText = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes % 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes / 60}h`;
