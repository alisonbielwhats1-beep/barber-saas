import { addCalendarDays, isDateKey, weekdayOfDateKey } from "./time";
import type { ClockComponent, DayComponent } from "../../packages/salon-secretary/src/temporal-components";
import { normalizedOffsets } from "../../packages/salon-secretary/src/literal-match";

/** Temporal components (C1): deterministic calendar/clock arithmetic from the salon's local
 * date, and token consistency between a component and the words the user wrote. Pure: no
 * clock, DB or model. A closed pt-BR vocabulary (numbers 0-59 in digits or words, weekdays and
 * abbreviations, relative days, months, dayparts, week qualifiers, limit and duration words) is
 * compared as TOKENS; there is no phrase grammar. A located quote is first widened to the whole
 * temporal expression around it, so a clipped quote cannot hide a qualifier the user wrote next
 * to it. Verification never creates or corrects a value: an inconsistency rejects that role (a
 * question), an ambiguity becomes a choice question. */

export const foldTemporal = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR")
  .replace(/ª/g, "a").replace(/[º°]/g, "o").replace(/[‐‑‒–—―−]/g, "-");
const units: Record<string, number> = { zero: 0, um: 1, uma: 1, primeiro: 1, primeira: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezassete: 17, dezoito: 18,
  dezenove: 19, dezanove: 19 };
const ordinalWords = new Set(["primeiro", "primeira"]);
const tens: Record<string, number> = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };
const weekdayWords: Record<string, number> = { domingo: 0, dom: 0, segunda: 1, seg: 1, terca: 2, ter: 2, quarta: 3, qua: 3, quinta: 4, qui: 4, sexta: 5, sex: 5, sabado: 6, sab: 6 };
// "dez" is ten, never December, except right after "<number> de" ("15 de dez"), where it is
// read as December so that a month the user said is never silently dropped.
const monthWords: Record<string, number> = { janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
  julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12 };
const daypartWords: Record<string, Daypart> = { manha: "MANHA", tarde: "TARDE", noite: "NOITE", madrugada: "MADRUGADA" };
/** Candidate 4 hour rules (flag SALON_SECRETARY_DAYPART_RULES_V2, default off): a daypart the owner did not write is never
 * evidence, a greeting is never a daypart, a single-day interval keeps only coherent readings, and the open half-day readings
 * are click options. Off: today's rules. */
export const daypartRulesV2Enabled = () => process.env.SALON_SECRETARY_DAYPART_RULES_V2 === "true";
/** C1 greeting guard (flag), a closed grammatical class: the adjective "bom"/"boa" directly before the day-period noun it
 * agrees with ("bom dia", "boa manhã", "boa tarde", "boa noite", "boa madrugada") greets. A daypart that qualifies a clock or a
 * day is always introduced by a preposition ("da tarde", "à noite", "pela manhã", "de madrugada"), never by that adjective, so
 * the noun is then a content word: never a daypart, a date anchor or a widening token. "dia" followed by a numeral keeps its
 * date reading ("tá bom dia 5"). Removing a fact can only turn a value into a question; it never picks a reading. */
const greetingNouns: Record<string, string> = { dia: "bom", manha: "boa", tarde: "boa", noite: "boa", madrugada: "boa" };
/** The same guard for the historical whole-text daypart checks (scheduling-temporal-source.ts): in an already folded text (lower
 * case, no accents) the daypart noun of "boa manhã/tarde/noite/madrugada" is blanked, keeping every offset. Flag off: unchanged. */
export const withoutGreetings = (folded: string) => daypartRulesV2Enabled()
  ? folded.replace(/(?<![\p{L}\p{N}])boa(\s+)(manha|tarde|noite|madrugada)(?![\p{L}\p{N}])/gu, (_match, gap: string, noun: string) => `boa${gap}${" ".repeat(noun.length)}`) : folded;
const clockUnits = new Set(["h", "hs", "hr", "hrs", "hora", "horas", "min", "mins", "minuto", "minutos"]);
const countUnits: Record<string, number> = { dia: 1, dias: 1, semana: 7, semanas: 7 };
const relativeWords = new Set(["hoje", "hj", "amanha", "ontem", "anteontem"]);
const nextWords = new Set(["proxima", "proximo", "seguinte"]);
const thisWords = new Set(["esta", "essa", "este", "esse", "nesta", "nessa", "neste", "nesse", "desta", "dessa", "deste", "desse"]);
/** Qualifiers the components cannot express (a past or an "other" week/day): always a question. */
const pastWords = new Set(["passada", "passado", "retrasada", "retrasado", "anterior"]);
const otherWords = new Set(["outra", "outro"]);
/** C4 (days() only): the edge heads of a week/month/year ("fim de semana", "começo do mês", "meio da semana") and the glue between
 * them (a preposition, or its contraction with a demonstrative: "fim desta semana"). Closed grammatical classes. */
const edgeHeads = new Set(["fim", "final", "inicio", "comeco", "meio"]);
const edgeGlue = new Set(["de", "do", "da", "desta", "dessa", "deste", "desse"]);
/** Words that make a clock/day a limit, a range edge or a duration instead of the exact value. */
type Limit = "LIMIT" | "UNTIL" | "FROM" | "RANGE" | "DURATION";
const limitWords: Record<string, Limit> = { antes: "LIMIT", depois: "LIMIT", dps: "LIMIT", apos: "LIMIT", ate: "UNTIL", partir: "FROM", entre: "RANGE",
  daqui: "DURATION", dentro: "DURATION", durante: "DURATION", em: "DURATION" };
/** A number right after one of these words is a clock ("às 10", "umas 10", "pra 15"), never a day. */
const clockLeads = new Set(["as", "pelas", "umas", "pras", "pra", "das", "ate", "las"]);
/** Articles/prepositions between a limit word and what it governs ("depois das", "a partir das"). */
const leadGlue = new Set(["a", "as", "o", "os", "da", "das", "de", "do", "dos", "la", "las", "pelas", "pela", "pelo", "umas", "no", "na", "dia"]);
/** Words that may sit inside one temporal expression, between two temporal tokens ("até" opens an
 * expression of its own: "de quinta até sábado" is a start and an end, not one day). */
const expressionGlue = new Set(["e", "de", "do", "da", "das", "dos", "a", "as", "o", "os", "no", "na", "nos", "nas", "em", "pelas", "pela", "pelo", "umas", "las", "la", "ou", "d"]);
type Daypart = "MANHA" | "TARDE" | "NOITE" | "MADRUGADA";

type Pos = { at: number; to: number };
type Num = Pos & { k: "num"; n: number; bind: "date" | "clock" | "count" | "free"; part?: "day" | "month" | "year" | "hour" | "minute"; unit?: number; ordinal?: true };
type Word = Pos & { k: "word"; w: string };
type Tok = Num | Word | (Pos & { k: "anchor"; n: 0 | 12 }) | (Pos & { k: "dash" });
const scanner = /(\d{4})([/.-])(\d{1,2})\2(\d{1,2})(?!\d)|(\d{1,2})([/.-])(\d{1,2})\6(\d{4}|\d{2})(?!\d)|(\d{1,2})\/(\d{1,2})(?!\d)|(\d{1,2}):(\d{2})(?!\d)|(\d{1,2})\.(\d{2})(?!\d)|(\d{1,2}) ?(horas|hora|hrs|hr|hs|h)(?: ?(\d{2}) ?(?:minutos|minuto|mins|min)?)?(?![a-z])|(\d{1,2})([ao])(?![a-z\d])|(\d+)|([a-z]+)|(-)/g;

/** Tokens of a FOLDED text with their offsets in it. Parts of one written form ("10h30", "28/09")
 * share the offsets of that form. Numbers are bound by their closed-vocabulary neighbours. */
function tokens(text: string): Tok[] {
  const raw: Tok[] = [];
  for (const m of text.matchAll(scanner)) {
    const p = { at: m.index!, to: m.index! + m[0].length };
    const num = (n: string | number, bind: Num["bind"], part?: Num["part"]): Num => ({ k: "num", n: Number(n), bind, ...(part ? { part } : {}), ...p });
    if (m[1]) raw.push(num(m[1], "date", "year"), num(m[3], "date", "month"), num(m[4], "date", "day"));
    else if (m[5]) raw.push(num(m[5], "date", "day"), num(m[7], "date", "month"), num(m[8].length === 2 ? 2000 + Number(m[8]) : m[8], "date", "year"));
    else if (m[9]) raw.push(num(m[9], "date", "day"), num(m[10], "date", "month"));
    else if (m[11]) raw.push(num(m[11], "clock", "hour"), num(m[12], "clock", "minute"));
    else if (m[13]) raw.push(num(m[13], "free"), num(m[14], "free"));
    else if (m[15]) raw.push(num(m[15], "clock", "hour"), ...(m[17] ? [num(m[17], "clock", "minute")] : []));
    else if (m[18]) raw.push(m[19] === "a" && Number(m[18]) >= 2 && Number(m[18]) <= 6 ? { k: "word", w: Object.keys(weekdayWords).find(w => weekdayWords[w] === Number(m[18]) - 1)!, ...p }
      : { ...num(m[18], "free"), ordinal: true });
    else if (m[20]) raw.push(num(m[20], "free"));
    else if (m[21]) raw.push({ k: "word", w: m[21], ...p });
    else raw.push({ k: "dash", ...p });
  }
  // Number words and the two clock anchors. "vinte e oito" is one number; "dez e meia" is two.
  const out: Tok[] = [];
  const word = (i: number) => raw[i]?.k === "word" ? (raw[i] as Word).w : undefined;
  const after = (i: number, w: string) => word(i + 1) === w ? 1 : raw[i + 1]?.k === "dash" && word(i + 2) === w ? 2 : 0;
  const greets = (i: number, w: string) => greetingNouns[w] !== undefined && word(i - 1) === greetingNouns[w] && /^\s+$/.test(text.slice(raw[i - 1].to, raw[i].at)) &&
    !(w === "dia" && (raw[i + 1]?.k === "num" || units[word(i + 1) ?? ""] !== undefined || tens[word(i + 1) ?? ""] !== undefined)) && daypartRulesV2Enabled();
  for (let i = 0; i < raw.length; i++) {
    const w = word(i), t = raw[i], span = (j: number) => ({ at: t.at, to: raw[j].to });
    if (w === undefined) { out.push(t); continue; }
    if (greets(i, w)) { out.push({ k: "word", w: "saudacao", at: t.at, to: t.to }); continue; }
    if (w === "meianoite" || w === "meiodia") { out.push({ k: "anchor", n: w === "meiodia" ? 12 : 0, ...span(i) }); continue; }
    if (w === "meia" && after(i, "noite")) { const k = after(i, "noite"); out.push({ k: "anchor", n: 0, ...span(i + k) }); i += k; continue; }
    if (w === "meio" && after(i, "dia")) { const k = after(i, "dia"); out.push({ k: "anchor", n: 12, ...span(i + k) }); i += k; continue; }
    if (w === "meia") { out.push({ k: "num", n: 30, bind: "free", ...span(i) }); continue; }
    const last = out.at(-1);
    if (w === "dez" && last?.k === "word" && last.w === "de" && out.at(-2)?.k === "num") { out.push({ k: "word", w: "dezembro", ...span(i) }); continue; }
    if (tens[w] !== undefined && word(i + 1) === "e" && units[word(i + 2) ?? ""] >= 1 && units[word(i + 2)!] <= 9) { out.push({ k: "num", n: tens[w] + units[word(i + 2)!], bind: "free", ...span(i + 2) }); i += 2; continue; }
    if (tens[w] !== undefined) { out.push({ k: "num", n: tens[w], bind: "free", ...span(i) }); continue; }
    if (units[w] !== undefined) { out.push({ k: "num", n: units[w], bind: "free", ...(ordinalWords.has(w) ? { ordinal: true as const } : {}), ...span(i) }); continue; }
    out.push(t);
  }
  const wordAt = (i: number) => out[i]?.k === "word" ? (out[i] as Word).w : undefined;
  // A month written with a dash ("2-Out", "1-Jan") is adjacent to its day.
  // Only "da": "sexta 16 de manhã" is a day of the month and its part of the day, never a clock.
  const daypartAfter = (j: number) => wordAt(j) === "da" && daypartWords[wordAt(j + 1) ?? ""] !== undefined;
  // Owner 07/10: a clause break between them ("de outubro, oito e meia") keeps a month and a number apart.
  const joined = (a: number, b: number) => !!out[a] && !!out[b] && !/[,.;!?]/.test(text.slice(Math.min(out[a]!.to, out[b]!.to), Math.max(out[a]!.at, out[b]!.at)));
  const monthNear = (i: number, step: 1 | -1) => {
    const k = wordAt(i + step) !== undefined ? i + step : out[i + step]?.k === "dash" ? i + 2 * step : -1;
    return k >= 0 && monthWords[wordAt(k) ?? ""] !== undefined && joined(i, k);
  };
  out.forEach((token, i) => {
    if (token.k !== "num" || token.bind !== "free") return;
    const before = wordAt(i - 1), next = wordAt(i + 1);
    if (before === "dia" || monthNear(i, -1) || monthNear(i, 1) || next === "de" && monthWords[wordAt(i + 2) ?? ""] !== undefined) { token.bind = "date"; token.part = "day"; }
    // The spoken month number after its day ("dia 16 do 10", "16 de 10", "16 do mês 10") is that day's month, as in "16/10".
    else if (token.n >= 1 && token.n <= 12 && !token.ordinal && (() => { const j = before === "mes" && ["do", "de"].includes(wordAt(i - 2) ?? "") ? i - 3 : ["do", "de"].includes(before ?? "") ? i - 2 : -1;
      const day = j >= 0 ? out[j] : undefined; return day?.k === "num" && day.part === "day" && day.bind === "date"; })()) { token.bind = "date"; token.part = "month"; }
    else if (next !== undefined && countUnits[next] !== undefined) { token.bind = "count"; token.unit = countUnits[next]; }
    else if (next !== undefined && clockUnits.has(next)) { token.bind = "clock"; token.part = next.startsWith("h") ? "hour" : "minute"; }
    else if (before !== undefined && clockLeads.has(before) && !token.ordinal) { token.bind = "clock"; token.part = "hour"; }
    // "às 10 e meia", "10 horas e 15": the number after "e" that follows a clock is its minute
    // (not the second edge of "entre as 5 e 6").
    else if (before === "e" && (out[i - 2]?.k === "anchor" || out[i - 2]?.k === "num" && (out[i - 2] as Num).bind === "clock" || clockUnits.has(wordAt(i - 2) ?? "")) &&
      ![i - 3, i - 4, i - 5].some(j => wordAt(j) === "entre")) { token.bind = "clock"; token.part = "minute"; }
    // Owner 07/10: an hour said with its part of the day and no lead ("…, oito e meia da manhã, …", "2 da tarde") is a clock too.
    else if (!token.ordinal && token.n <= 23 && (daypartAfter(i + 1) || wordAt(i + 1) === "e" && out[i + 2]?.k === "num" && daypartAfter(i + 3))) { token.bind = "clock"; token.part = "hour"; }
    else if (token.n >= 1000 && token.n <= 2999) { token.bind = "date"; token.part = "year"; }
  });
  return out;
}

type ClockTok = { n: number; anchor: boolean; part?: Num["part"]; i: number; at: number; to: number };
/** What a token list states (a quote, or a widened span of a scanned message). */
function factsOf(list: Tok[], text: string) {
  const wordOf = (i: number) => list[i]?.k === "word" ? (list[i] as Word).w : undefined;
  const words = list.flatMap(token => token.k === "word" ? [token.w] : []);
  const relative: number[] = [], consumed = new Set<number>();
  list.forEach((token, i) => {
    if (token.k !== "word") return;
    // Phone abbreviations of the same words: hj = hoje, dps = depois; "depois amanhã" and
    // "depois d amanhã" are typed forms of "depois de amanhã".
    let j = i - 1;while (wordOf(j) === "de" || wordOf(j) === "d") j--;
    if (token.w === "hoje" || token.w === "hj") relative.push(0);
    else if (token.w === "amanha") { if (wordOf(j) === "depois" || wordOf(j) === "dps") { relative.push(2); consumed.add(j); } else relative.push(1); }
    else if (token.w === "ontem") { if (wordOf(j) === "antes") { relative.push(-2); consumed.add(j); } else relative.push(-1); }
    else if (token.w === "anteontem") relative.push(-2);
  });
  const clockSeq: ClockTok[] = [];
  list.forEach((token, i) => {
    if (token.k === "anchor") clockSeq.push({ n: token.n, anchor: true, i, at: token.at, to: token.to });
    else if (token.k === "num" && !token.ordinal && (token.bind === "clock" || token.bind === "free")) clockSeq.push({ n: token.n, anchor: false, part: token.part, i, at: token.at, to: token.to });
  });
  const semana = list.some((token, i) => token.k === "word" && token.w === "semana" && list[i - 1]?.k !== "num");
  return {
    list, text, clockSeq, consumed,
    weekdays: [...new Set(words.flatMap(w => weekdayWords[w] !== undefined ? [weekdayWords[w]] : []))],
    months: [...new Set(words.flatMap(w => monthWords[w] !== undefined ? [monthWords[w]] : []))],
    dayparts: [...new Set(words.flatMap(w => daypartWords[w] ? [daypartWords[w]] : []))],
    daypartAt: list.flatMap((token, i) => token.k === "word" && daypartWords[token.w] ? [{ i, daypart: daypartWords[token.w] }] : []),
    relative: [...new Set(relative)],
    dateNums: list.flatMap(token => token.k === "num" && token.bind === "date" ? [token] : []),
    countNums: list.flatMap(token => token.k === "num" && token.bind === "count" ? [token] : []),
    freeNums: list.flatMap(token => token.k === "num" && token.bind === "free" ? [token] : []),
    next: words.some((w, i) => nextWords.has(w) || (w === "que" || w === "q") && words[i + 1] === "vem"),
    thisWeek: words.some(w => thisWords.has(w)),
    past: words.some(w => pastWords.has(w)),
    other: words.some(w => otherWords.has(w)),
    // "ou" offers an alternative ("dia 2 ou 3", "amanhã ou depois"); "mais ou menos" only approximates.
    alternatives: words.some((w, i) => w === "ou" && !(words[i - 1] === "mais" && words[i + 1] === "menos")),
    /** "ou" between two clock tokens ("às 10 ou 11"): a day alternative ("dia 2 ou 3 às 10") leaves the clock alone. */
    clockAlternatives: list.some((token, j) => token.k === "word" && token.w === "ou" && clockSeq.some(t => t.i < j) && clockSeq.some(t => t.i > j)),
    semana,
  };
}
type Facts = ReturnType<typeof factsOf>;
/** What a quote states, token by token. */
export function temporalQuoteFacts(literal: string) {
  const text = foldTemporal(literal);
  return factsOf(tokens(text), text);
}
/** The limit/range/duration word governing token i (skipping articles and prepositions). */
function governing(facts: Facts, i: number): Limit | undefined {
  let j = i - 1;
  while (j >= 0 && facts.list[j].k === "word" && leadGlue.has((facts.list[j] as Word).w)) j--;
  const token = facts.list[j];
  return token?.k === "word" && !facts.consumed.has(j) ? limitWords[token.w] : undefined;
}

const pad = (value: number) => String(value).padStart(2, "0");
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const key = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const between = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const int = (value: number | null, min: number, max: number) => value !== null && Number.isInteger(value) && value >= min && value <= max;

/** Candidate 4 date rules (flag SALON_SECRETARY_DATE_RULES_V2, default off): EXISTING direction, the stated weekday
 * narrowing a DATE_CHOICE, WEEKDAY+day read as a day of the month, answers to a live DATE_CHOICE. Off: today's rules. */
export const dateRulesV2Enabled = () => process.env.SALON_SECRETARY_DATE_RULES_V2 === "true";
/** `dropped` (EXISTING only): the past reading removed, shown to the owner before Confirmar ("01/09 já passou"). */
export type DayResolution = { status: "OK"; date: string; dropped?: string } | { status: "DATE_CHOICE"; candidates: [string, string] }
  | { status: "REJECTED"; code: "COMPONENT_INVALID" | "DATE_INVALID" | "DATE_IN_PAST" };
/** FORWARD: a day to book or block (the next occurrence). ANY: a day that names an existing
 * appointment or a read (the original day of a move, a cancel, a list), which may be past.
 * EXISTING (flag): the day of an appointment the Secretária can still change or cancel (the locator only finds future
 * ones): a past reading of a day without month, or of a month without year, is dropped; an explicit year never shifts. */
export type DayDirection = "FORWARD" | "ANY" | "EXISTING";
export const dayDirection = (role: string, operation?: string): DayDirection =>
  (role === "source_date" || role === "date" && operation === "appointment.cancel") && dateRulesV2Enabled() ? "EXISTING" :
  role === "source_date" || role === "date" && ["appointment.cancel", "appointment.read", "appointment.list"].includes(operation ?? "") ? "ANY" : "FORWARD";
/** B3 (flag): a WEEKDAY that also carries a day number ("sexta dia 2") is that day of the month qualified by its weekday.
 * Nothing is added or computed: the day, the weekday and any month/year must still be written (token check). */
export const canonicalDay = (value: DayComponent): DayComponent =>
  value.kind === "WEEKDAY" && value.day !== null && value.offset === null && value.days === null && (value.week === null || value.week === "NEAREST") &&
  dateRulesV2Enabled() ? { ...value, kind: "DAY_OF_MONTH", week: null } : value;
/** An omitted year never jumps more than about half a year into the next year ("5 de janeiro"
 * said in December); a farther next-year date is offered beside this year's (a choice). */
export const OMITTED_YEAR_HORIZON_DAYS = 183;
/** Calendar arithmetic of a date component from the salon's local date (YYYY-MM-DD). A reference
 * that names two days (a past one and a coming one) is a choice, never a silent roll or a
 * "já passou" for a phrase that reads as a future date; only an explicit past year to book is past. */
export function resolveDayComponent(component: DayComponent, today: string, direction: DayDirection = "FORWARD"): DayResolution {
  const invalid = { status: "REJECTED", code: "COMPONENT_INVALID" } as const, value = canonicalDay(component);
  if (!isDateKey(today)) throw Error("INVALID_LOCAL_DATE");
  const unused = (...fields: (keyof DayComponent)[]) => fields.every(field => value[field] === null);
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  switch (value.kind) {
    case "RELATIVE_DAY":
      return int(value.offset, 0, 2) && unused("weekday", "week", "day", "month", "year", "days") ? { status: "OK", date: addCalendarDays(today, value.offset!) } : invalid;
    case "DAYS_FROM_NOW":
      return int(value.days, 1, 365) && unused("offset", "weekday", "week", "day", "month", "year") ? { status: "OK", date: addCalendarDays(today, value.days!) } : invalid;
    case "WEEKDAY": {
      if (!int(value.weekday, 0, 6) || !unused("offset", "day", "month", "year", "days")) return invalid;
      const current = weekdayOfDateKey(today), target = value.weekday!;
      const nearest = addCalendarDays(today, (target - current + 7) % 7 || 7);
      // Weeks run Monday-Sunday.
      const thisWeek = addCalendarDays(addCalendarDays(today, -((current + 6) % 7)), (target + 6) % 7), nextWeek = addCalendarDays(thisWeek, 7);
      switch (value.week ?? "NEAREST") {
        case "NEAREST": return { status: "OK", date: nearest };
        // "essa sexta" said on Saturday: last Friday or the coming one. EXISTING keeps ANY's past day (a weekly client's
        // "essa segunda" said on Wednesday is not found, never next Monday's appointment).
        case "THIS_WEEK": return thisWeek >= today || direction !== "FORWARD" ? { status: "OK", date: thisWeek } : { status: "DATE_CHOICE", candidates: [thisWeek, nextWeek] };
        case "NEXT_WEEK": return { status: "OK", date: nextWeek };
        case "AMBIGUOUS_NEXT": return nearest === nextWeek ? { status: "OK", date: nearest } : { status: "DATE_CHOICE", candidates: [nearest, nextWeek] };
      }
      return invalid;
    }
    case "DAY_OF_MONTH": {
      if (!int(value.day, 1, 31) || !unused("offset", "week", "days") || value.weekday !== null && !int(value.weekday, 0, 6) ||
        value.month !== null && !int(value.month, 1, 12) || value.year !== null && (!int(value.year, 1000, 9999) || value.month === null)) return invalid;
      const day = value.day!;
      if (value.month === null) {
        // The nearest date not before today with that day; months without it are skipped.
        let next: string | undefined;
        for (let k = 0; k < 13 && !next; k++) {
          const y = year + Math.floor((month - 1 + k) / 12), m = (month - 1 + k) % 12 + 1;
          if (day <= daysIn(y, m) && key(y, m, day) >= today) next = key(y, m, day);
        }
        if (!next) return { status: "REJECTED", code: "DATE_INVALID" };
        // An existing appointment's day already past this month is this month's or the next, asked (ANY); one that must
        // still be changeable (EXISTING) is the next occurrence, with the dropped past day kept for the owner to see.
        const current = day <= daysIn(year, month) ? key(year, month, day) : undefined;
        if (direction === "EXISTING" && current !== undefined && current < today) return { status: "OK", date: next, dropped: current };
        return direction === "ANY" && current !== undefined && current < today ? { status: "DATE_CHOICE", candidates: [current, next] } : { status: "OK", date: next };
      }
      if (value.year !== null) {
        // A salon agenda is booked within the current and the next calendar year.
        if (day > daysIn(value.year, value.month) || value.year > year + 1) return { status: "REJECTED", code: "DATE_INVALID" };
        const date = key(value.year, value.month, day);
        return date < today && direction === "FORWARD" ? { status: "REJECTED", code: "DATE_IN_PAST" } : { status: "OK", date };
      }
      const valid = [year, year + 1].filter(y => day <= daysIn(y, value.month!)).map(y => key(y, value.month!, day));
      if (!valid.length) return { status: "REJECTED", code: "DATE_INVALID" };
      const next = valid.find(date => date >= today), past = valid.find(date => date < today);
      if (next && (next.startsWith(String(year)) || between(today, next) <= OMITTED_YEAR_HORIZON_DAYS)) return { status: "OK", date: next };
      if (direction === "EXISTING" && past && next) return { status: "OK", date: next, dropped: past };
      return past && next ? { status: "DATE_CHOICE", candidates: [past, next] } : next ? { status: "OK", date: next } : { status: "REJECTED", code: "DATE_IN_PAST" };
    }
  }
  return invalid;
}

export type ClockResolution = { status: "OK"; time: string } | { status: "REJECTED"; code: "COMPONENT_INVALID" };
/** Hour/minute/daypart to HH:mm (same daypart ranges as the historical interval grammar). */
export function resolveClockComponent(value: ClockComponent): ClockResolution {
  const invalid = { status: "REJECTED", code: "COMPONENT_INVALID" } as const;
  if (!int(value.hour, 0, 23) || !int(value.minute, 0, 59)) return invalid;
  let hour = value.hour;
  if (value.daypart === "MANHA" && hour >= 12) return invalid;
  if (value.daypart === "TARDE") { if (hour >= 1 && hour <= 11) hour += 12; if (hour < 12 || hour > 18) return invalid; }
  if (value.daypart === "NOITE") { if (hour >= 6 && hour <= 11) hour += 12; if (hour < 18) return invalid; }
  return { status: "OK", time: `${pad(hour)}:${pad(value.minute)}` };
}
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const fitsDaypart = (time: string, daypart: Daypart) => {
  const minute = minutesOf(time);
  return daypart === "MANHA" ? minute < 720 : daypart === "TARDE" ? minute >= 720 && minute < 1140 : daypart === "NOITE" ? minute >= 1080 || minute < 60 : minute < 360;
};

/** Token offsets that witness a role's value (for the cross-role checks of the caller). */
export type Witness = [number, number][];
export type DayVerdict = DayResolution | { status: "WEEKDAY_CONFLICT"; calendar_date: string; stated_weekday: number; actual_weekday: number }
  | { status: "REJECTED"; code: "TOKEN_MISMATCH" };
const mismatch = { status: "REJECTED", code: "TOKEN_MISMATCH" } as const;
export type DayOptions = { direction?: DayDirection; role?: string; operation?: string; answer?: boolean };
/** A date proof: the verdict, the day-number tokens it used and the free numbers of the
 * expression it did not explain (a clock role of the same message may explain them). */
function dayProof(facts: Facts, component: DayComponent, today: string, options: DayOptions): { verdict: DayVerdict; witness: Witness; free: Witness } {
  const value = canonicalDay(component), none = { witness: [] as Witness, free: [] as Witness }, resolved = resolveDayComponent(value, today, options.direction);
  if (resolved.status === "REJECTED" && resolved.code === "COMPONENT_INVALID") return { verdict: resolved, ...none };
  // "outra sexta" alone stays a question; with the week written ("na outra sexta, na próxima semana") the week says which one.
  const otherWeekSaid = facts.other && value.kind === "WEEKDAY" && value.week === "NEXT_WEEK" && facts.next && facts.semana;
  if (facts.alternatives || facts.past || facts.other && !otherWeekSaid) return { verdict: mismatch, ...none };
  // "até sexta" ends a block; "a partir de amanhã" starts one; "depois de sexta" is not a day.
  const first = facts.list.findIndex(token => token.k === "word" && (weekdayWords[token.w] !== undefined || relativeWords.has(token.w) || monthWords[token.w] !== undefined) ||
    token.k === "num" && token.bind !== "clock");
  const limit = first < 0 ? undefined : governing(facts, first);
  if (limit && !(limit === "UNTIL" && options.role === "end_date" || limit === "FROM" && options.role === "date" && options.operation === "schedule.block" ||
    limit === "DURATION" && value.kind === "DAYS_FROM_NOW")) return { verdict: mismatch, ...none };
  const stated = componentStated(facts, value, options);
  if (!stated) {
    // C4 R-B1 (flag SALON_SECRETARY_DATE_RULES_V2): a week scope the quote does not write ("na terça" read as NEXT_WEEK) is
    // Luna's reading, not the owner's words; the words alone (NEAREST) prove the day only when that reading names the very
    // same day. A scope that moves the day (another week, a choice) keeps the refusal.
    const plain: DayComponent | undefined = dateRulesV2Enabled() && value.kind === "WEEKDAY" && value.week !== null && value.week !== "NEAREST" ? { ...value, week: "NEAREST" } : undefined;
    const same = plain && resolved.status === "OK" && componentStated(facts, plain, options) ? resolveDayComponent(plain, today, options.direction) : undefined;
    return same?.status === "OK" && resolved.status === "OK" && same.date === resolved.date ? dayProof(facts, plain!, today, options) : { verdict: mismatch, ...none };
  }
  if (resolved.status === "DATE_CHOICE" && dateRulesV2Enabled()) return narrowChoice(facts, value, today, options, resolved.candidates, stated);
  if (resolved.status !== "OK") return { verdict: resolved, witness: stated, free: [] };
  return settleDay(facts, value, today, resolved, stated);
}
/** The consistency checks of one reading: qualifiers written next to the reference, its numbers and the stated weekday. */
function settleDay(facts: Facts, value: DayComponent, today: string, resolved: Extract<DayResolution, { status: "OK" }>, stated: Witness): { verdict: DayVerdict; witness: Witness; free: Witness } {
  const none = { witness: [] as Witness, free: [] as Witness }, date = resolved.date, actual = weekdayOfDateKey(date);
  // Qualifiers written next to the reference ("amanhã, dia 29", "terça, dia 14") must describe the same day.
  if (value.kind !== "RELATIVE_DAY" && facts.relative.some(offset => addCalendarDays(today, offset) !== date)) return { verdict: mismatch, ...none };
  if (value.kind !== "DAY_OF_MONTH" && facts.dateNums.some(token => token.n !== (token.part === "month" ? Number(date.slice(5, 7)) : token.part === "year" ? Number(date.slice(0, 4)) : Number(date.slice(8)))))
    return { verdict: mismatch, ...none };
  const witness: Witness = [...stated, ...facts.dateNums.map((token): [number, number] => [token.at, token.to])];
  // A free number beside the reference is its day ("sexta 2", when that Friday is the 2nd) or a
  // clock another role proves ("amanhã 10"); any other one ("sexta 13") is unexplained.
  const free: Witness = [];
  for (const token of facts.freeNums) {
    if (stated.some(([at]) => at === token.at)) continue;
    if (token.n === Number(date.slice(8))) witness.push([token.at, token.to]); else free.push([token.at, token.to]);
  }
  if (value.kind !== "WEEKDAY" && facts.weekdays.length) {
    if (facts.weekdays.length > 1) return { verdict: mismatch, ...none };
    if (facts.weekdays[0] !== actual)
      return value.kind === "DAY_OF_MONTH" ? { verdict: { status: "WEEKDAY_CONFLICT", calendar_date: date, stated_weekday: facts.weekdays[0], actual_weekday: actual }, witness, free } : { verdict: mismatch, ...none };
  }
  return { verdict: resolved, witness, free };
}
/** Words that may join a weekday to its day number inside one expression ("sexta dia 2", "sexta-feira, dia 2", "dia 2, sexta"):
 * articles/prepositions and the date nouns, a closed grammatical class. "e"/"ou" join two references, never qualify one. */
const dayGlue = new Set(["a", "o", "de", "do", "da", "no", "na", "em", "dia", "feira"]);
/** B2 (flag): the one weekday written next to the day number (only glue, a dash or one comma between) and not followed by
 * a content word: "sexta dia 2" qualifies the day; "dia 5, segunda vez que…" is an ordinal, never a weekday filter. */
function adjacentWeekday(facts: Facts, stated: Witness) {
  const list = facts.list, days = stated.map(([at]) => list.findIndex(token => token.k === "num" && token.at === at)).filter(i => i >= 0);
  const joined = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const a = list[i], b = list[i + 1], gap = facts.text.slice(a.to, b.at);
      if (i > from && !(a.k === "dash" || a.k === "word" && dayGlue.has(a.w))) return false;
      if (a.at !== b.at && boundary.test(gap) && !/^\s*,\s*$/.test(gap)) return false;
    }
    return true;
  };
  const found = new Set<number>();
  list.forEach((token, i) => {
    if (token.k !== "word" || weekdayWords[token.w] === undefined || !days.some(d => joined(Math.min(i, d), Math.max(i, d)))) return;
    const next = /^[\s,-]*(?:feira\b[\s,-]*)?([a-z]+)/.exec(facts.text.slice(token.to))?.[1];
    if (next === undefined || temporalWord(next)) found.add(weekdayWords[token.w]);
  });
  return found.size === 1 ? [...found][0] : undefined;
}
/** B2 (flag): the same consistency checks run on every published candidate of a DATE_CHOICE (qualifiers, date-bound
 * day/month/year numbers and, for a day of the month, the adjacent weekday). Exactly one consistent candidate is the day;
 * none because only the weekday disagrees is the calendar contradiction; otherwise the choice is unchanged. It only narrows
 * the backend's own candidates, and a day to book is never a past one. A free number never chooses: it may be the clock of
 * the same message ("sexta que vem 2 da tarde"); the chosen day still explains it or leaves it to a clock role (settleDay). */
function narrowChoice(facts: Facts, value: DayComponent, today: string, options: DayOptions, candidates: [string, string], stated: Witness): { verdict: DayVerdict; witness: Witness; free: Witness } {
  const part = (token: Num, date: string) => token.part === "month" ? Number(date.slice(5, 7)) : token.part === "year" ? Number(date.slice(0, 4)) : Number(date.slice(8));
  const weekday = value.kind === "DAY_OF_MONTH" ? adjacentWeekday(facts, stated) : undefined;
  const fits = (date: string, useWeekday: boolean) => !(value.kind !== "RELATIVE_DAY" && facts.relative.some(offset => addCalendarDays(today, offset) !== date)) &&
    !(value.kind !== "DAY_OF_MONTH" && facts.dateNums.some(token => token.n !== part(token, date))) &&
    !(useWeekday && weekday !== undefined && weekdayOfDateKey(date) !== weekday);
  const fit = candidates.filter(date => fits(date, true)), unchanged = { verdict: { status: "DATE_CHOICE", candidates } as DayVerdict, witness: stated, free: [] as Witness };
  if (fit.length === 1) return (options.direction ?? "FORWARD") === "FORWARD" && fit[0] < today ? unchanged : settleDay(facts, value, today, { status: "OK", date: fit[0] }, stated);
  // The later reading carries the contradiction question (never a past day to book).
  if (!fit.length && weekday !== undefined && candidates.every(date => fits(date, false))) return settleDay(facts, value, today, { status: "OK", date: candidates[1] }, stated);
  return unchanged;
}
/** The component's own fields are written in the quote (digits or words), nothing contradicts them.
 * Returns the day-number tokens that state it (empty for days said in words) or undefined. */
function componentStated(facts: Facts, value: DayComponent, options: DayOptions): Witness | undefined {
  if (facts.relative.some(offset => offset < 0)) return;
  if (value.kind !== "DAYS_FROM_NOW" && facts.countNums.length) return;
  if (value.kind !== "WEEKDAY" && facts.next) return;
  const span = (token: Pos): [number, number] => [token.at, token.to];
  switch (value.kind) {
    case "RELATIVE_DAY": return facts.relative.length === 1 && facts.relative[0] === value.offset ? [] : undefined;
    case "DAYS_FROM_NOW": return !facts.relative.length && facts.countNums.length === 1 && facts.countNums[0].n * facts.countNums[0].unit! === value.days ? facts.countNums.map(span) : undefined;
    case "WEEKDAY": {
      if (facts.relative.length || facts.weekdays.length !== 1 || facts.weekdays[0] !== value.weekday || facts.months.length) return;
      const week = value.week ?? "NEAREST";
      return (week === "NEAREST" ? !facts.next && !facts.thisWeek && !facts.semana : week === "THIS_WEEK" ? facts.thisWeek && !facts.next :
        week === "NEXT_WEEK" ? facts.next && facts.semana : facts.next) ? [] : undefined;
    }
    case "DAY_OF_MONTH": {
      // A day number needs a date anchor: "dia", a month, a d/m form, an ordinal, or the weekday it
      // is said with ("sexta 13" for Friday the 13th). A bare number is a day only as the answer to
      // a date question; after "às/umas/pra" it is a clock and never a day.
      const list = facts.list, days = facts.dateNums.filter(token => token.part === "day");
      const afterWeekday = (token: Num) => { const i = list.indexOf(token); return value.weekday !== null && list[i - 1]?.k === "word" && weekdayWords[(list[i - 1] as Word).w] !== undefined; };
      const witness = days.length ? days : facts.dateNums.some(token => token.part === "month") ? [] : facts.freeNums.filter(token => token.ordinal).length ? facts.freeNums.filter(token => token.ordinal)
        : facts.freeNums.filter(afterWeekday).length ? facts.freeNums.filter(afterWeekday) : options.answer ? facts.freeNums : [];
      if (!witness.some(token => token.n === value.day) || witness.some(token => token.n !== value.day)) return;
      const months = [...facts.months, ...facts.dateNums.filter(token => token.part === "month").map(token => token.n)];
      if (value.month === null ? months.length > 0 : !months.length || months.some(month => month !== value.month)) return;
      const years = facts.dateNums.filter(token => token.part === "year").map(token => token.n);
      if (value.year === null ? years.length > 0 : !years.length || years.some(year => year !== value.year)) return;
      if (value.weekday !== null && !facts.weekdays.includes(value.weekday)) return;
      return witness.map(span);
    }
  }
  return;
}
export function verifyDayComponent(quote: string, value: DayComponent, today: string, options: DayOptions = {}): DayVerdict {
  const proof = dayProof(temporalQuoteFacts(quote), value, today, options);
  // Alone, an unexplained free number beside the day ("sexta 13") is inconsistent.
  return proof.free.length && proof.verdict.status !== "REJECTED" ? mismatch : proof.verdict;
}

export type ClockVerdict = { status: "OK"; time: string } | { status: "DAYPART_CHOICE"; candidates: [string, string] }
  | { status: "REJECTED"; code: "COMPONENT_INVALID" | "TOKEN_MISMATCH" };
/** Owner decision 18 (30/09/2026; flag SALON_SECRETARY_DAYPART_ASK_WIDE, default off; product rule of BOTH arms, the C4 and the C5
 * agent): a bare 8-11 is asked like 1-7, so the asked range becomes 1-11. The tenant's hours still settle a single possible reading
 * (daypart-by-hours; the agent validator's V9). Off: exactly the historical 1-7. */
export const daypartAskWideEnabled = () => process.env.SALON_SECRETARY_DAYPART_ASK_WIDE === "true";
/** A clock written without manhã/tarde/noite whose hour is 1-7 (as said) could be either half
 * of the day in a salon: asked, never assumed. 8-11 as said keeps the historical reading (1-11 with the
 * flag above). The upper bound is read at every use (a getter), so every reader of this pair follows the flag. */
const askedHours: [number, number] = [1, 7];
Object.defineProperty(askedHours, 1, { get: () => daypartAskWideEnabled() ? 11 : 7, enumerable: true, configurable: false });
export const UNSPECIFIED_DAYPART_ASKED_HOURS: readonly [number, number] = Object.freeze(askedHours);
const glue = new Set(["e", ...clockUnits]);
/** Any symbol but a dash ends an expression (",", ".", ">", "|", emoji); parts of one written form share offsets. */
const boundary = /[^\p{L}\p{N}\s-]/u;
/** Two clock tokens of one written clock: only "e"/units between them, no punctuation (except
 * inside one written form such as "10:30" or "15.00"). */
function adjacent(facts: Facts, from: number, to: number) {
  for (let i = from; i < to; i++) {
    const a = facts.list[i], b = facts.list[i + 1];
    if (i > from && !(a.k === "word" && glue.has(a.w))) return false;
    if (a.at !== b.at && boundary.test(facts.text.slice(a.to, b.at))) return false;
  }
  return true;
}
export type ClockOptions = { role?: string; operation?: string };
/** `readings` (flag SALON_SECRETARY_DAYPART_RULES_V2): the clocks the words allow for this endpoint, for interval coherence
 * only. A choice's two candidates; an OK clock written 8-11 without a daypart, anchor or leading zero is its historical morning
 * reading AND the evening one (the 8-11 default is never proof of a half-day); any other OK clock is itself. */
type ClockProof = { verdict: ClockVerdict; witness: Witness; readings?: string[] };
/** The limit words an endpoint may carry: "até" ends (end_time), "a partir de" starts a block. */
const clockAllows = (options: ClockOptions, endpoint?: "start" | "end"): ReadonlySet<Limit> => new Set<Limit>([
  ...(options.role === "end_time" || endpoint === "end" ? ["UNTIL" as const] : []),
  ...(endpoint === "start" ? ["RANGE" as const] : []),
  ...(options.operation === "schedule.block" && (options.role === "time" || endpoint === "start") ? ["FROM" as const] : [])]);
/** One clock endpoint: the written hour (and the minute adjacent to it) against the component. */
function clockGroup(facts: Facts, group: readonly ClockTok[], component: ClockComponent, dayparts: readonly Daypart[], allows: ReadonlySet<Limit>): ClockProof {
  const fail = { verdict: mismatch, witness: [] as Witness }, v2 = daypartRulesV2Enabled();
  // C1 (flag): a daypart the owner did not write is Luna's reading, never evidence. Without a written daypart, Luna's resolved
  // clock is verified as an UNSPECIFIED component (a 13-23 hour tagged with a daypart that does not hold it is the hour as
  // said), so the verdict is exactly today's UNSPECIFIED one: OK only for what the words fix, a choice for 1-7 or 12-hour writing.
  const unwritten = v2 && !dayparts.length && component.daypart !== "UNSPECIFIED";
  let resolved = resolveClockComponent(component);
  if (unwritten && resolved.status !== "OK" && int(component.hour, 13, 23) && int(component.minute, 0, 59)) resolved = { status: "OK", time: `${pad(component.hour)}:${pad(component.minute)}` };
  if (resolved.status !== "OK") return { verdict: resolved, witness: [] };
  // C4 R-B1 (flag): the converse. A daypart the owner DID write settles an hour Luna left UNSPECIFIED ("uma da tarde" read as
  // hour 1): the clock is the other half of the 12-hour day only when the written dayparts reject the hour as said and hold its
  // twin. The written hour and minute are still checked below; nothing the words do not fix is chosen.
  const asSaid = resolved.time, twin = int(component.hour, 1, 11) ? `${pad(component.hour + 12)}:${pad(component.minute)}` : undefined;
  if (v2 && twin && dayparts.length && component.daypart === "UNSPECIFIED" && !dayparts.every(daypart => fitsDaypart(asSaid, daypart)) &&
    dayparts.every(daypart => fitsDaypart(twin, daypart))) resolved = { status: "OK", time: twin };
  const value: ClockComponent = unwritten ? { hour: Number(resolved.time.slice(0, 2)), minute: component.minute, daypart: "UNSPECIFIED" } : component;
  const [head, ...rest] = group, time = resolved.time, hour = Number(time.slice(0, 2));
  if (!head || head.part === "minute" || rest.length > 1) return fail;
  const limit = governing(facts, head.i);
  if (limit && !allows.has(limit)) return fail;
  // C1 (flag): what is written is compared with the resolved clock ("às 14h" is 14:00 whatever hour/daypart pair Luna chose).
  const said = v2 ? hour : value.hour;
  const written = head.anchor ? (head.n === hour ? "EXACT" : undefined)
    : head.n === said || head.n === 24 && hour === 0 ? "EXACT" : said >= 13 && head.n === said - 12 ? "TWELVE" : undefined;
  if (!written) return fail;
  // The minute is the number right after the hour ("10h30", "10:30", "dez e meia", "10 horas e 15"),
  // never a second clock of the same quote ("das 10 às 11" is not 10:11, "às 10, 11" is not 10:11).
  if (rest.length) {
    const minute = rest[0];
    if (minute.anchor || minute.part === "hour" || minute.n !== value.minute || !adjacent(facts, head.i, minute.i)) return fail;
  } else if (value.minute !== 0) return fail;
  // C1 (flag): a written daypart stays authoritative: the resolved clock must fit every daypart the expression writes.
  if (v2) { if (dayparts.length && !dayparts.every(daypart => fitsDaypart(time, daypart))) return fail; }
  else if (value.daypart !== "UNSPECIFIED") { if (!dayparts.includes(value.daypart)) return fail; }
  else if (dayparts.length && !dayparts.some(daypart => fitsDaypart(time, daypart))) return fail;
  const witness = group.map((token): [number, number] => [token.at, token.to]);
  const other = (hour + 12) % 24, evening = `${pad(other)}:${pad(value.minute)}`;
  if (value.daypart === "UNSPECIFIED" && !dayparts.length && !head.anchor) {
    const twin = `${pad(Math.min(hour, other))}:${pad(value.minute)}`, late = `${pad(Math.max(hour, other))}:${pad(value.minute)}`;
    if (written === "TWELVE" || hour >= UNSPECIFIED_DAYPART_ASKED_HOURS[0] && hour <= UNSPECIFIED_DAYPART_ASKED_HOURS[1])
      return { verdict: { status: "DAYPART_CHOICE", candidates: [twin, late] }, witness, ...(v2 ? { readings: [twin, late] } : {}) };
  }
  const historical = v2 && !dayparts.length && !head.anchor && written === "EXACT" && hour >= 8 && hour <= 11 && facts.text[head.at] !== "0";
  return { verdict: { status: "OK", time }, witness, ...(v2 ? { readings: historical ? [time, evening] : [time] } : {}) };
}
/** The clock the quote starts (`from`: the offset where the quote begins) with its adjacent minute;
 * another clock of the same expression, or a clock written just before it, is inconsistent. */
function clockProof(facts: Facts, value: ClockComponent, options: ClockOptions, from = 0): ClockProof {
  const fail = { verdict: mismatch, witness: [] as Witness };
  if (facts.clockAlternatives) return fail;
  const seq = facts.clockSeq, h = seq.findIndex(token => token.at >= from);
  if (h < 0) return clockGroup(facts, [], value, facts.dayparts, clockAllows(options));
  const previous = seq[h - 1];
  if (previous && adjacent(facts, previous.i, seq[h].i)) return fail;
  const minute = seq[h + 1] && adjacent(facts, seq[h].i, seq[h + 1].i) ? [seq[h + 1]] : [];
  if (seq.length > h + 1 + minute.length) return fail;
  return clockGroup(facts, [seq[h], ...minute], value, facts.dayparts, clockAllows(options));
}
export function verifyClockComponent(quote: string, value: ClockComponent, options: ClockOptions = {}): ClockVerdict {
  return clockProof(temporalQuoteFacts(quote), value, options).verdict;
}
/** One interval shared by time and end_time ("das 10 às 11", "14h-16h", "de 2 a 5 da tarde"): the
 * start binds to the first written clock, the end to the second. A daypart qualifies the clock it
 * follows; written once, after the end or before the start, it also qualifies a bare start. */
function intervalProof(facts: Facts, start: ClockComponent, end: ClockComponent, options: ClockOptions, from = 0): [ClockProof, ClockProof] {
  const fail = { verdict: mismatch, witness: [] as Witness }, h = facts.clockSeq.findIndex(token => token.at >= from);
  const seq = h < 0 ? [] : facts.clockSeq.slice(h);
  if (facts.clockAlternatives || h > 0 && adjacent(facts, facts.clockSeq[h - 1].i, seq[0].i)) return [fail, fail];
  for (let k = 1; k < seq.length; k++) {
    const [a, b] = [seq[0].i, seq[k].i], own = (lo: number, hi: number) => facts.daypartAt.filter(item => item.i > lo && item.i < hi).map(item => item.daypart);
    const lead = own(-1, a), mine = own(a, b), theirs = own(b, Infinity);
    const startParts = mine.length ? mine : lead.length ? lead : theirs.length === facts.daypartAt.length ? theirs : [];
    const endParts = theirs.length ? theirs : lead.length && !mine.length ? lead : [];
    const first = clockGroup(facts, seq.slice(0, k), start, startParts, clockAllows(options, "start")), second = clockGroup(facts, seq.slice(k), end, endParts, clockAllows(options, "end"));
    if (first.verdict.status !== "REJECTED" && second.verdict.status !== "REJECTED") return [first, second];
  }
  return [fail, fail];
}
export function verifyClockInterval(quote: string, start: ClockComponent, end: ClockComponent, options: ClockOptions = {}): [ClockVerdict, ClockVerdict] {
  const [a, b] = intervalProof(temporalQuoteFacts(quote), start, end, options);
  return [a.verdict, b.verdict];
}
/** Every closed-vocabulary word of this module: temporal words, qualifiers, limits and glue. */
const temporalWord = (w: string) => weekdayWords[w] !== undefined || monthWords[w] !== undefined || daypartWords[w] !== undefined || relativeWords.has(w) ||
  clockUnits.has(w) || countUnits[w] !== undefined || nextWords.has(w) || thisWords.has(w) || pastWords.has(w) || otherWords.has(w) || limitWords[w] !== undefined ||
  clockLeads.has(w) || leadGlue.has(w) || expressionGlue.has(w) || ["que", "q", "vem", "feira", "semana", "mes", "ano", "dps", "pro", "pros"].includes(w);
/** C4 polarity: the shape of a quote without its negation. `temporalOnly`: every word is closed temporal vocabulary
 * or glue (no verb, name or other content word); `day` / `clock`: whether it names a day and/or a clock. */
export function quoteTemporalShape(quote: string) {
  const list = tokens(foldTemporal(quote));
  const dayWord = (token: Tok) => token.k === "word" && (relativeWords.has(token.w) || weekdayWords[token.w] !== undefined || monthWords[token.w] !== undefined);
  return { temporalOnly: list.some(token => token.k === "num" || token.k === "anchor" || dayWord(token)) && list.every(token => token.k !== "word" || temporalWord(token.w)),
    day: list.some(token => token.k === "num" && token.bind === "date" || dayWord(token)),
    clock: list.some(token => token.k === "anchor" || token.k === "num" && token.bind === "clock") };
}
/** C3 (flag): the (start, end) pairs of one single-day interval whose end is after its start, from each end's readings. Never
 * across midnight: an end at 00:00 is not after any start of that day. */
export function coherentIntervalReadings(starts: readonly string[], ends: readonly string[]): [string, string][] {
  return [...new Set(starts)].flatMap(start => [...new Set(ends)].filter(end => minutesOf(end) > minutesOf(start)).map((end): [string, string] => [start, end]));
}
/** A short answer that only names a daypart ("da tarde") selects one published half-day candidate. */
export function daypartAnswer(quote: string, candidates: readonly string[]) {
  const facts = temporalQuoteFacts(quote);
  if (facts.clockSeq.length || facts.dayparts.length !== 1) return;
  const fitting = candidates.filter(time => fitsDaypart(time, facts.dayparts[0]));
  return fitting.length === 1 ? fitting[0] : undefined;
}
/** Feminine ordinals spelled like weekdays (a closed grammatical class) and their positions: answering a question with two
 * options, "a segunda" is the second option as much as Monday ("a segunda opção", "2ª"). */
const ordinalWeekdays: Record<string, number> = { segunda: 2, terca: 3, quarta: 4, quinta: 5, sexta: 6 };
/** Definite articles (a closed class): "a segunda, dia 28" may still be the second option. */
const articles = new Set(["a", "o", "as", "os"]);
/** UX (flag): an answer to a live DATE_CHOICE that states calendar facts only (a month word or number, "mês que vem" /
 * "deste mês", "semana que vem" / "desta semana", "ano que vem" / "deste ano", a weekday, a day, a year) selects the ONE
 * published candidate consistent with all of them. A clock, a count, an alternative, a past/other qualifier or no calendar
 * fact selects nothing, and neither does a weekday word that may be the ordinal of an option: it is a weekday only when
 * written as one (with "feira", or right beside its day number without an article). */
function choiceAnswer(facts: Facts, candidates: readonly string[], today: string) {
  if (facts.clockSeq.length || facts.alternatives || facts.past || facts.other || facts.countNums.length || facts.weekdays.length > 1) return;
  const words = facts.list.flatMap(token => token.k === "word" ? [token.w] : []);
  const nums = (part: Num["part"]) => facts.dateNums.filter(token => token.part === part).map(token => token.n);
  const beside = adjacentWeekday(facts, facts.dateNums.filter(token => token.part === "day").map((token): [number, number] => [token.at, token.to]));
  if (facts.list.some((token, i) => token.k === "word" && (ordinalWeekdays[token.w] ?? Infinity) <= candidates.length && !/^[\s-]*feira\b/.test(facts.text.slice(token.to)) &&
    !(beside === weekdayWords[token.w] && !(facts.list[i - 1]?.k === "word" && articles.has((facts.list[i - 1] as Word).w))))) return;
  const [days, months, years] = [nums("day"), [...facts.months, ...nums("month")], nums("year")];
  const shift = (said: boolean) => !said ? undefined : facts.next ? 1 : facts.thisWeek ? 0 : undefined;
  const month = shift(words.includes("mes")), week = shift(facts.semana), year = shift(words.includes("ano"));
  if (!days.length && !months.length && !years.length && !facts.weekdays.length && !facts.relative.length && month === undefined && week === undefined && year === undefined) return;
  const monday = (date: string) => addCalendarDays(date, -((weekdayOfDateKey(date) + 6) % 7));
  const index = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const fit = candidates.filter(date => days.every(day => day === Number(date.slice(8))) && months.every(value => value === Number(date.slice(5, 7))) &&
    years.every(value => value === Number(date.slice(0, 4))) && facts.weekdays.every(value => value === weekdayOfDateKey(date)) &&
    facts.relative.every(offset => addCalendarDays(today, offset) === date) && (year === undefined || Number(date.slice(0, 4)) === Number(today.slice(0, 4)) + year) &&
    (month === undefined || index(date) === index(today) + month) && (week === undefined || monday(date) === addCalendarDays(monday(today), 7 * week)));
  return fit.length === 1 ? fit[0] : undefined;
}
export function dateChoiceAnswer(quote: string, candidates: readonly string[], today: string) {
  return choiceAnswer(temporalQuoteFacts(quote), candidates, today);
}
/** Whether a word belongs to this module's closed vocabulary (temporal words, qualifiers, limits and glue). */
export const temporalVocabulary = (word: string) => temporalWord(foldTemporal(word));

/** A message scanned once (components mode): tokens are bound with their real neighbours, and
 * every located quote is widened to the whole temporal expression around it before it is
 * verified, so a clipped quote ("amanhã" of "depois de amanhã", "às 10" of "às 10 e meia",
 * "dia 29" of "dia 29 de outubro", "sexta" of "sexta que vem") never proves a value the user did
 * not say. Offsets are ORIGINAL message offsets; undefined when the text cannot be mapped. */
export function temporalScan(source: string) {
  const map = normalizedOffsets(source, foldTemporal);
  if (!map) return;
  const text = map.text, list = tokens(text);
  const wordOf = (i: number) => list[i]?.k === "word" ? (list[i] as Word).w : undefined;
  const strong = (i: number) => { const t = list[i], w = wordOf(i);
    return t?.k === "num" || t?.k === "anchor" || w !== undefined && (weekdayWords[w] !== undefined || monthWords[w] !== undefined || daypartWords[w] !== undefined ||
      relativeWords.has(w) || clockUnits.has(w) || countUnits[w] !== undefined || w === "mes" || w === "ano"); };
  // Qualifiers belong to an expression only next to it: before it ("próxima", "essa", "outra",
  // "depois das", "a partir das", "entre"), or after it ("que vem", "passada", "seguinte", "feira").
  // "ou" joins an alternative on either side ("amanhã ou depois"): the expression then asks.
  const leftQualifier = (i: number) => { const w = wordOf(i); return w !== undefined && (nextWords.has(w) || thisWords.has(w) || otherWords.has(w) || limitWords[w] !== undefined || w === "ou"); };
  const dayAfter = (i: number) => { let j = i + 1;while (wordOf(j) === "de" || wordOf(j) === "d") j++; return wordOf(j) === "amanha"; };
  const rightQualifier = (i: number) => { const w = wordOf(i);
    return w !== undefined && (nextWords.has(w) || pastWords.has(w) || otherWords.has(w) || w === "feira" || w === "ou" || (w === "depois" || w === "dps") && dayAfter(i) ||
      (w === "que" || w === "q") && wordOf(i + 1) === "vem" || w === "vem" && ["que", "q"].includes(wordOf(i - 1) ?? "")) || list[i]?.k === "dash"; };
  const connector = (i: number) => { const w = wordOf(i); return w !== undefined && expressionGlue.has(w); };
  // A limit word opens its expression ("até sábado", "depois das 10"): nothing before it joins.
  const opens = (i: number) => limitWords[wordOf(i) ?? ""] !== undefined;
  // Punctuation ends an expression; one comma between two temporal tokens does not ("terça, dia 14").
  const broken = (i: number, j: number) => { const gap = text.slice(list[i].to, list[j].at);
    return list[i].at !== list[j].at && boundary.test(gap) && !(/^\s*,\s*$/.test(gap) && strong(i) && strong(j)); };
  const extend = (from: number, step: -1 | 1, attach: (i: number) => boolean) => {
    let edge = from;
    for (let i = from + step; i >= 0 && i < list.length;) {
      if (broken(Math.min(i, i - step), Math.max(i, i - step))) break;
      if (strong(i) || attach(i)) { edge = i; if (step < 0 && opens(i)) break; i += step; continue; }
      let j = i;
      while (j >= 0 && j < list.length && connector(j) && !broken(Math.min(j, j - step), Math.max(j, j - step))) j += step;
      if (j < 0 || j >= list.length || j === i || broken(Math.min(j, j - step), Math.max(j, j - step)) || !(strong(j) || attach(j))) break;
      edge = j; if (step < 0 && opens(j)) break; i = j + step;
    }
    return edge;
  };
  const toText = (at: number) => map.toNormalized(at);
  // The whole temporal expression around the tokens a folded range [a, b) covers.
  const around = (a: number, b: number) => {
    const covered = list.flatMap((token, i) => token.at < b && token.to > a ? [i] : []);
    if (!covered.length) return { from: a, to: b };
    const lo = opens(covered[0]) ? covered[0] : extend(covered[0], -1, leftQualifier), hi = extend(covered.at(-1)!, 1, rightQualifier);
    return { from: Math.min(a, list[lo].at), to: Math.max(b, list[hi].to) };
  };
  const abbreviated = (w: string) => Object.keys(weekdayWords).some(full => full.length > w.length && full.startsWith(w) && weekdayWords[full] === weekdayWords[w]);
  const ordinalAt = (i: number) => { const w = wordOf(i)!, next = /^[\s,-]*(?:feira\b[\s,-]*)?([a-z]+)/.exec(text.slice(list[i].to))?.[1];
    return ordinalWeekdays[w] !== undefined && articles.has(wordOf(i - 1) ?? "") && next !== undefined && !temporalWord(next); };
  return {
    /** The widened expression [start, end) (folded offsets) of an original span, and where the quote starts in it. */
    widen(start: number, end: number): { from: number; to: number; quoteAt: number } {
      const a = toText(start);
      return { ...around(a, toText(end)), quoteAt: a };
    },
    /** The widened expression of an ORIGINAL span, in ORIGINAL offsets. */
    expression(start: number, end: number): [number, number] { const span = around(toText(start), toText(end)); return [map.toOriginal(span.from), map.toOriginal(span.to)]; },
    /** C4 (the caller's flag SALON_SECRETARY_DATE_RULES_V2): every token of the message that states a DAY, with the whole expression
     * around it as a quote there is widened (ORIGINAL offsets). The proof's own vocabulary: a relative day not in the past, a weekday,
     * a number bound to a date, a count of days/weeks governed by a duration word ("daqui a 3 dias"), a week/month/year with its
     * "next" qualifier ("semana que vem", "mês que vem"). Two closed readings are not days: a weekday abbreviation (a prefix of its
     * full name, "ter", "sex") with no other temporal token in its expression ("vai ter que"), and a feminine ordinal between its
     * article and a content word ("a segunda vez", as in choiceAnswer). An expression stating a past ("sexta passada") never counts.
     * A unit word (dia/semana/mês/ano, not a count) states a day no component can carry when its expression has a next, other or
     * order qualifier ("dia seguinte", "outra semana", "outro dia", "dia anterior": "anterior" is the order of the appointment's own
     * day, never a calendar past) or, for a week/month/year, an edge head before "de/do/da" ("fim de semana", "começo do mês"). */
    days(): { token: [number, number]; expression: [number, number] }[] {
      const all = factsOf(list, text);
      return list.flatMap((token, i) => {
        const w = wordOf(i), span = around(token.at, token.to), inside = list.flatMap((item, k) => item.at >= span.from && item.to <= span.to ? [k] : []);
        const facts = factsOf(inside.map(k => list[k]), text);
        const unit = (w === "dia" || w === "semana" || w === "mes" || w === "ano") && list[i - 1]?.k !== "num";
        const ordered = unit && inside.some(k => wordOf(k) === "anterior");
        const edge = unit && w !== "dia" && edgeGlue.has(wordOf(i - 1) ?? "") && edgeHeads.has(wordOf(i - 2) ?? "");
        const day = token.k === "num" ? token.bind === "date" || token.bind === "count" && governing(all, i) === "DURATION"
          : w === undefined ? false
          : relativeWords.has(w) ? facts.relative.some(offset => offset >= 0)
          : weekdayWords[w] !== undefined ? !(abbreviated(w) && !inside.some(k => k !== i && strong(k))) && !ordinalAt(i)
          : unit && (facts.next || facts.other || ordered || edge);
        return day && (!facts.past || ordered) ? [{ token: [map.toOriginal(token.at), map.toOriginal(token.to)] as [number, number], expression: [map.toOriginal(span.from), map.toOriginal(span.to)] as [number, number] }] : [];
      });
    },
    facts(from: number, to: number) { return factsOf(list.filter(token => token.at >= from && token.to <= to), text); },
    /** The folded offset of an ORIGINAL offset. */
    folded(at: number) { return toText(at); },
    /** Whether a range (folded offsets) holds a limit word (antes/depois/até/a partir/entre): a boundary, not a value.
     * "depois de amanhã" / "antes de ontem" are relative days (factsOf consumes their first word), never limits. */
    bounded(from: number, to: number) {
      const relativeDay = (i: number) => { const w = wordOf(i); let j = i + 1;while (wordOf(j) === "de" || wordOf(j) === "d") j++;
        return (w === "depois" || w === "dps") && wordOf(j) === "amanha" || w === "antes" && wordOf(j) === "ontem"; };
      return list.some((token, i) => token.at >= from && token.to <= to && token.k === "word" && ["LIMIT", "UNTIL", "FROM", "RANGE"].includes(limitWords[token.w] ?? "") && !relativeDay(i));
    },
    /** Whether an ORIGINAL range states a day (a relative day, weekday, month or day number). */
    statesDay(start: number, end: number) {
      const [a, b] = [toText(start), toText(end)];
      return list.some(token => token.at >= a && token.to <= b && (token.k === "num" && token.bind === "date" ||
        token.k === "word" && (relativeWords.has(token.w) || weekdayWords[token.w] !== undefined || monthWords[token.w] !== undefined)));
    },
    day(span: { from: number; to: number }, value: DayComponent, today: string, options: DayOptions) { return dayProof(this.facts(span.from, span.to), value, today, options); },
    /** The published DATE_CHOICE candidate a widened answer names (see dateChoiceAnswer). */
    dateAnswer(span: { from: number; to: number }, candidates: readonly string[], today: string) { return choiceAnswer(this.facts(span.from, span.to), candidates, today); },
    clock(span: { from: number; to: number; quoteAt: number }, value: ClockComponent, options: ClockOptions) { return clockProof(this.facts(span.from, span.to), value, options, span.quoteAt); },
    interval(span: { from: number; to: number; quoteAt: number }, start: ClockComponent, end: ClockComponent, options: ClockOptions) {
      return intervalProof(this.facts(span.from, span.to), start, end, options, span.quoteAt);
    },
  };
}
export type TemporalScan = NonNullable<ReturnType<typeof temporalScan>>;
