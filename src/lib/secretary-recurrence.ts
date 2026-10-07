import { recurrenceGuardEnabled } from "../../packages/salon-secretary/src/recurrence-guard";
import { formatDay, formatLocal, formatLocalRange } from "./secretary-datetime-format";
import { unavailableCapabilityMessage } from "./secretary-capability-status";
import { literalSpans } from "../../packages/salon-secretary/src/literal-match";
import type { SeriesEnd } from "./secretary-series";

/** P3c recurrence guard (flag SALON_SECRETARY_RECURRENCE_GUARD). The owner's own words for a create or a block (review B: and for a
 * change or a cancellation) are read for a stated recurrence, so the action is never prepared as one silent occurrence (it asks
 * "Marco só a primeira (…)?" / "Remarco só o de …?" / "Cancelo só o de …?").
 *
 * Closed temporal class (written justification). Portuguese states a repeating calendar pattern only through a small set of
 * grammatical constructions, independent of the sentence around them:
 * (a) the distributive quantifier before a calendar noun: "todo/toda" + singular noun WITHOUT article ("toda sexta", "todo dia",
 *     "toda semana", "todo mês", "toda manhã"), "todos/todas" + plural noun ("todas as segundas", "todos os dias"). With the
 *     article the singular is a totality, not a repetition ("toda a semana", "todo o dia"), and a quantifier after the noun is a
 *     totality too ("o dia todo"): neither is read;
 * (b) the iterative "(a) cada" + optional count + calendar noun ("a cada 15 dias", "cada sexta", "a cada duas semanas");
 * (c) the interval "de N em N" with the same count twice, followed by a calendar unit or nothing ("de 15 em 15 dias",
 *     "de quinze em quinze"); a unit of minutes or hours is not a calendar pattern;
 * (d) the frequency adverbs and adjectives of the calendar units (diariamente, semanalmente, quinzenalmente, mensalmente;
 *     semanal, quinzenal, mensal);
 * (e) a plural weekday after a preposition/article ("às sextas", "nas segundas", "aos sábados") or after "sempre" ("sempre na
 *     sexta"): a weekday said in the plural, or as always, names every such day;
 * (f) the alternation "<unit> sim, <unit> não" ("semana sim, semana não", "sexta sim, sexta não", "uma sexta sim, outra não");
 * (g) the frequency "<N> vez(es)/<N>x por|na|no|ao|pela|pelo <unit>" ("uma vez por semana", "2x por mês");
 * (h) plural weekdays coordinated without an article ("terças e quintas").
 * Review B: (c) without a unit ("de quinze em quinze") only when it ends its clause ("de duas em duas amanhã" is "two at a
 * time"); an adjective of (d) inside the owner's own name of a service, customer or professional ("pacote mensal") is that name.
 * Calendar nouns are the weekdays (also "2ª"…"6ª") and the units dia, semana, quinzena, mês, manhã, tarde, noite, fim/final de semana.
 * Negation (closed class): a negator (não, n, nem, nunca, jamais; the bare "n" only in lower case: "Ana N" is an initial) that
 * governs the construction itself, right before it or
 * separated only by copula forms and the preposition of purpose (é, ser, será, seria, era, foi, pra, para): "não é toda sexta",
 * "não é pra ser toda sexta", "nem toda semana". A negator elsewhere in the
 * clause ("não esquece de marcar ela toda sexta") does not negate the recurrence: when in doubt the guard asks (one question),
 * never the reverse (a silent single occurrence). Pure: no tenant access, no model. */
const WEEKDAY = "(?:segunda|terca|quarta|quinta|sexta|[2-6][ªa])(?:[- ]?feira)?|sabado|domingo";
const WEEKDAYS = "(?:segundas|tercas|quartas|quintas|sextas)(?:[- ]feiras)?|sabados|domingos";
const UNIT = "dia|semana|quinzena|mes|manha|tarde|noite|fim de semana|final de semana";
const UNITS = "dias|semanas|quinzenas|meses|manhas|tardes|noites|fins de semana|finais de semana";
const ADJECTIVES = "semanal|semanais|quinzenal|quinzenais|mensal|mensais|diario|diaria|diarios|diarias";
const COUNT ="\\d{1,3}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|vinte|trinta";
const B = "(?<![\\p{L}\\p{N}])", E = "(?![\\p{L}\\p{N}])";
const constructions = [
  `${B}(?:todo|toda)\\s+(?!(?:o|a)${E})(?:${WEEKDAY}|${UNIT})${E}`,
  `${B}(?:todos|todas)\\s+(?:(?:os|as)\\s+)?(?:${WEEKDAYS}|${UNITS})${E}`,
  `${B}(?:a\\s+)?cada\\s+(?:(?:${COUNT})\\s+)?(?:${WEEKDAY}|${WEEKDAYS}|${UNIT}|${UNITS})${E}`,
  `${B}de\\s+(?<count>${COUNT})\\s+em\\s+\\k<count>${E}(?:\\s+(?:${UNITS}|${UNIT})${E}|(?=\\s*(?:[,.;!?]|$)))`,
  `${B}(?:diariamente|semanalmente|quinzenalmente|mensalmente|${ADJECTIVES})${E}`,
  `${B}(?:as|nas|aos|nos|pelas|pelos)\\s+(?:${WEEKDAYS}|fins de semana|finais de semana|manhas|tardes|noites)${E}`,
  `${B}sempre\\s+(?:(?:a|as|na|nas|no|nos|aos|de)\\s+)?(?:${WEEKDAY}|${WEEKDAYS})${E}`,
  `${B}(?:(?:um|uma)\\s+)?(?<unit>dia|semana|mes|quinzena|${WEEKDAY})\\s+sim,?\\s+(?:\\k<unit>|(?:(?:o|a)\\s+)?outr[oa])\\s+nao${E}`,
  `${B}(?:${COUNT}|um|uma)\\s*(?:x|vez|vezes)\\s+(?:por|na|no|ao|pela|pelo)\\s+(?:${UNIT})${E}`,
  `${B}(?:${WEEKDAYS})(?:\\s*,\\s*|\\s+e\\s+)(?:${WEEKDAYS})${E}`,
];
const PATTERN = new RegExp(constructions.map(source => `(?:${source})`).join("|"), "gu");
const NEGATED = new RegExp(`${B}(nao|n|nem|nunca|jamais)(?:\\s+(?:e|eh|ser|sera|seria|era|foi|pra|para))*\\s*$`, "u");
const ADJECTIVE = new RegExp(`^(?:${ADJECTIVES})$`, "u");
/** Folds each UTF-16 unit on its own (accents and case), so every index of the folded text is an index of the original. */
const fold = (text: string) => text.split("").map(unit => { const folded = unit.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR"); return folded.length === 1 ? folded : " "; }).join("");
export type StatedRecurrence = { expression: string; start: number; end: number };
/** The first recurrence the text states and does not negate (its exact words), or undefined. `names` (review B): the owner's own
 * names of this action's service(s), customer and professional; an adjective of (d) inside one of them is that name. */
export function statedRecurrence(text: string | undefined, names: readonly (string | null | undefined)[] = []): StatedRecurrence | undefined {
  if (!text) return undefined;
  const folded = fold(text), spans = names.flatMap(name => typeof name === "string" && name.trim() ? literalSpans(text, name) : []);
  for (const match of folded.matchAll(PATTERN)) {
    const start = match.index!, end = start + match[0].length;
    const negation = NEGATED.exec(folded.slice(0, start));
    // A capital "N" right before the construction is an initial ("a Ana N toda sexta"), never the typed negator "n".
    if (negation && !(negation[1] === "n" && text[negation.index] === "N")) continue;
    if (ADJECTIVE.test(match[0]) && spans.some(([from, to]) => start >= from && end <= to)) continue;
    return { expression: text.slice(start, end), start, end };
  }
  return undefined;
}
/** Operations the guard covers: the ones that write a new time, and (review B) the moves and cancellations whose own words state
 * a series ("passa o Téo pra toda quinta", "desmarca a Jade de toda terça"): never one occurrence as if it were the whole request. */
export const recurrenceOperations = ["appointment.create", "schedule.block", "appointment.change", "appointment.cancel"] as const;
export const recurrenceOperation = (operation: string | undefined) => (recurrenceOperations as readonly string[]).includes(operation ?? "");
/** The card kind and its one option (never an entity ref). */
export const RECURRENCE_CARD = "recurrence_ref" as const;
export const FIRST_ONLY_REF = "recurrence-first-only";
/** `ASKED`: the owner stated a recurrence and has not said yes to one occurrence; `FIRST_ONLY`: they did (click or verified pick).
 * `noticed`: the "Ainda não marco…" line was already said before a question of this statement (said once, not on every turn). */
export type RecurrenceState = { expression: string; status: "ASKED" | "FIRST_ONLY" | "SERIES"; noticed?: true;
  /** Owner 07/10 (flag SALON_SECRETARY_RECURRING_SERIES): the end the owner's words gave the series, or the last day a card fixed;
   * `SERIES`: the owner picked the series (its dates are the draft's `series`). */
  end?: SeriesEnd; until?: string };
/** Interpretation step: this turn's own words for the action. A stated recurrence (re)opens the question, even after a yes. */
export function recurrenceFromTurn(previous: RecurrenceState | undefined, operation: string | undefined, source: string | undefined,
  names: readonly (string | null | undefined)[] = []): { state?: RecurrenceState; stated: boolean } {
  if (!recurrenceGuardEnabled() || !recurrenceOperation(operation)) return { state: previous, stated: false };
  const said = statedRecurrence(source, names);
  return said ? { state: { expression: said.expression, status: "ASKED" }, stated: true } : { state: previous, stated: false };
}
/** Whether the action still owes the owner's yes (the flag is read at every preparation: off, nothing is held). */
export const recurrencePending = (state: RecurrenceState | undefined, operation: string | undefined) =>
  recurrenceGuardEnabled() && recurrenceOperation(operation) && state?.status === "ASKED";
/** The first occurrence as said back: "sex, 16/04 às 10h", a block's "ter, 13/04 às 12h–13h", or the day alone. */
const when = (date: string, time?: string, endLocal?: string) => !time ? formatDay(date) : endLocal ? formatLocalRange(`${date}T${time}`, endLocal) : formatLocal(`${date}T${time}`);
/** "Ainda não marco horários recorrentes pelo chat (“toda sexta”)." (create) / "… bloqueios recorrentes …" (block) / "… remarco
 * séries …" (change) / "… cancelo séries …" (cancel). */
export const recurrenceNotice = (operation: string, expression: string) =>
  `Ainda não ${operation === "schedule.block" ? "faço bloqueios recorrentes" : operation === "appointment.change" ? "remarco séries" : operation === "appointment.cancel" ? "cancelo séries" : "marco horários recorrentes"} pelo chat (“${expression}”).`;
/** The one-option question once the first occurrence is known: "Marco só a primeira (sex, 16/04 às 10h)?". Review B: a move or a
 * cancellation names the one appointment it would change (`origin`, its start): "Remarco só o de qua, 30/09 às 14h para qui, 01/10
 * às 15h?" / "Cancelo só o de ter, 29/09 às 9h?". */
export function recurrenceQuestion(operation: string, expression: string, date: string, time?: string, endLocal?: string, origin?: string) {
  if (origin && (operation === "appointment.change" || operation === "appointment.cancel")) {
    const one = operation === "appointment.change" ? `${formatLocal(origin)} para ${when(date, time)}` : formatLocal(origin);
    return { message: `${recurrenceNotice(operation, expression)} ${operation === "appointment.change" ? "Remarco" : "Cancelo"} só o de ${one}? Nada foi preparado para as outras datas.`,
      card: { kind: RECURRENCE_CARD, items: [{ id: FIRST_ONLY_REF, name: `Só este: ${one}` }] } };
  }
  const first = when(date, time, endLocal);
  return { message: `${recurrenceNotice(operation, expression)} ${operation === "schedule.block" ? "Bloqueio" : "Marco"} só a primeira (${first})? Nada foi preparado para as outras datas.`,
    card: { kind: RECURRENCE_CARD, items: [{ id: FIRST_ONLY_REF, name: `Só a primeira: ${first}` }] } };
}
/** A turn with no operation whose words state a recurrence: the specific notice (flag on). */
export function recurrenceUnsupportedMessage(message: string | undefined) {
  if (!recurrenceGuardEnabled()) return undefined;
  const said = statedRecurrence(message);
  return said ? `Ainda não marco horários nem bloqueios recorrentes pelo chat (“${said.expression}”). Posso preparar um de cada vez: diga o dia e o horário do primeiro. Nada foi preparado.` : undefined;
}
/** The reply to a turn Luna declared UNSUPPORTED: the recurrence notice when no more specific capability was named and the words
 * state a recurrence; otherwise (and with the flag off) the historical capability copy. */
export const unsupportedTurnNotice = (capability: Parameters<typeof unavailableCapabilityMessage>[0], message: string | undefined) =>
  (capability ?? "other") === "other" && recurrenceUnsupportedMessage(message) || unavailableCapabilityMessage(capability);
