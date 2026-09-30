import { foldName, tokenSimilarity } from "./name-search";
import { temporalQuoteFacts } from "./scheduling-temporal-reference";

/** C3 voice (SALON_SECRETARY_VOICE_CORRECTION, default off). After a dictation, a word that looks like a misheard
 * professional or service name of the salon directory ("rodrigues" → "Rodrigo") is offered as a correction the owner
 * may accept in the input box. Customers are never part of the vocabulary. Nothing is replaced or sent automatically:
 * the suggestion is only text the owner reviews before pressing Enviar. */
export function voiceCorrectionEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SALON_SECRETARY_VOICE_CORRECTION === "true";
}
export type DictationSuggestion = { start: number; end: number; from: string; to: string };
export const DICTATION_SUGGESTION_LIMIT = 3;
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);
const word = /[\p{L}\p{N}]+/gu;
const length = (text: string) => [...text].length;
function commonPrefix(a: string, b: string) {
  const x = [...a], y = [...b];
  let n = 0; while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
}
/** Dates, clocks, weekdays, months, dayparts and number words are never names. */
function temporalWord(token: string) {
  const facts = temporalQuoteFacts(token);
  return facts.weekdays.length + facts.months.length + facts.dayparts.length + facts.relative.length + facts.freeNums.length +
    facts.dateNums.length + facts.countNums.length > 0 || facts.next || facts.thisWeek || facts.semana;
}
/** Recognizers alter name endings ("Rodrigo" heard as "rodrigues"): a long shared start counts. Short lowercase words
 * are ordinary vocabulary far more often than names, so the edit-distance scorer applies to them only when the
 * recognizer capitalized the word mid-sentence or the word is long. A word that extends a directory token
 * ("cortes", "escovar", "Anabela") is an inflection or another name, never a correction. */
function similarity(token: string, entry: string, capitalized: boolean) {
  if (token.startsWith(entry)) return 0;
  const shared = commonPrefix(token, entry), shorter = Math.min(length(token), length(entry));
  const stem = shared >= 5 && shared / shorter >= 0.75 && Math.abs(length(token) - length(entry)) <= 3 ? 0.85 : 0;
  return Math.max(stem, capitalized || length(token) >= 8 ? tokenSimilarity(token, entry) : 0);
}
/** Correction suggestions for one dictated text against professional and service names only. Deterministic; a word
 * with no unique best entry (a tie between two names) gets no suggestion. */
export function dictationSuggestions(text: string, vocabulary: readonly string[], limit = DICTATION_SUGGESTION_LIMIT): DictationSuggestion[] {
  const entries = new Map<string, string>();
  for (const name of vocabulary) for (const match of name.matchAll(word)) {
    const key = foldName(match[0]);
    if (length(key) >= 3 && !PARTICLES.has(key) && !entries.has(key)) entries.set(key, match[0]);
  }
  const out: DictationSuggestion[] = [];
  for (const match of text.slice(0, 1000).matchAll(word)) {
    if (out.length >= limit) break;
    const token = foldName(match[0]), at = match.index ?? 0;
    if (length(token) < 4 || /\d/.test(token) || entries.has(token) || temporalWord(token)) continue;
    const capitalized = /^\p{Lu}/u.test(match[0]) && !/(?:^|[.!?])\s*$/.test(text.slice(0, at));
    let best = 0, chosen: string[] = [];
    for (const [key, display] of entries) {
      const score = similarity(token, key, capitalized);
      if (score < 0.8 - 1e-9) continue;
      if (score > best + 1e-9) { best = score; chosen = [display]; } else if (Math.abs(score - best) <= 1e-9) chosen.push(display);
    }
    if (chosen.length === 1) out.push({ start: at, end: at + match[0].length, from: match[0], to: chosen[0] });
  }
  return out;
}
