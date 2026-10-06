/** Deterministic, meaning-preserving input noise for the Agenda practice harness (evaluation only: no I/O, no model).
 * Real owners never type or dictate like the scripts: phone keyboards drop accents, capitals and punctuation and use chat
 * abbreviations; speech-to-text adds fillers, repeats a word and spells clocks and days. `light` and `heavy` reproduce that
 * on the rendered `say`/`answer` texts (AFTER templating; never oracles, clicks, `noise:false` scenarios or `noNoise`
 * regions) while keeping meaning and entity identity, so a correct secretary still reaches the same final state:
 * - entity names (customers, professionals, services) and literal cores (cancellation reasons) change only by accents/case;
 * - dates written dd/mm, dd/mm/yyyy or ISO and `noNoise` regions stay verbatim;
 * - `noiseFacts` (clocks, days, dates, weekdays, relative days, negations, entity words, other numbers) stays equal, no word
 *   is lost and only the generator's own vocabulary is added; `noiseViolations` checks it at preflight and before every send;
 * - a negation's scope is never touched: no filler right after it, no 'eh' within two words after it, no repeated negated verb.
 * Typos, nicknames and truncations are NOT noise (they change what a correct secretary must do: ask, never auto-pick) and
 * live in explicit scenarios. STT-like joins are never produced. */
import { answerInstances, buildScenarioFixture, prng, renderTemplate, type AgendaScenario, type LegacyMap } from './agenda-practice-lib';

export const NOISE_PROFILES = ['off', 'light', 'heavy', 'mixed'] as const;
export type NoiseProfile = (typeof NOISE_PROFILES)[number];
export type NoiseLevel = 'off' | 'light' | 'heavy';
export function noiseProfile(value: unknown = 'off'): NoiseProfile {
  if (typeof value !== 'string' || !(NOISE_PROFILES as readonly string[]).includes(value)) throw Error('AGENDA_NOISE_ARGUMENT');
  return value as NoiseProfile;
}
/** `mixed`: attempt 1 clean (comparable with legacy runs), then light, heavy, light, heavy... `noise:false` is always clean. */
export function noiseLevel(profile: NoiseProfile, attempt: number, s?: { noise?: boolean }): NoiseLevel {
  if (profile === 'off' || s?.noise === false) return 'off';
  return profile !== 'mixed' ? profile : attempt <= 1 ? 'off' : attempt % 2 === 0 ? 'light' : 'heavy';
}
/** Seed of one sent text: scenario, attempt and origin (`say:<scripted step>` or `answer:<field>:<use>`), so the noise of a
 * scripted text never depends on how many answers the runtime asked for before it. */
export const noiseSeed = (scenario: string, attempt: number, source: string) => `noise|${scenario}#k${attempt}|${source}`;

export type NoiseParams = { subst: number; numbers: number; double: number; comma: number; period: number; filler: number; tail: number; maxFillers: number };
export const NOISE_PARAMS: Readonly<Record<'light' | 'heavy', Readonly<NoiseParams>>> = {
  light: { subst: 0.8, numbers: 0, double: 0, comma: 0, period: 0, filler: 0, tail: 0, maxFillers: 0 },
  heavy: { subst: 0.9, numbers: 0.7, double: 0.4, comma: 0.85, period: 0.9, filler: 0.4, tail: 0.25, maxFillers: 2 },
};
/** `names`: entity names (accents/case only); `protect`: verbatim regions; `literals`: literal cores graded by the oracle
 * (accents/case only); `finalClocks`: HH:MM of the final state (an afternoon clock is spoken only when listed). */
export type NoiseContext = { names?: readonly string[]; protect?: readonly string[]; literals?: readonly string[]; finalClocks?: readonly string[] };

const MARKS = /\p{M}/gu;
export const foldNoise = (value: string) => value.normalize('NFD').replace(MARKS, '').toLowerCase();
const stripAccents = (value: string) => value.normalize('NFD').replace(MARKS, '').normalize('NFC');
const TOKEN = /\s+|[\p{L}\p{M}\p{N}]+(?:[-:\/'’][\p{L}\p{M}\p{N}]+)*|[^\s\p{L}\p{M}\p{N}]/gu;
const FACT_WORD = /[\p{L}\p{N}]+(?:[-:\/'’][\p{L}\p{N}]+)*/gu;
const DATE = /(?<![\p{L}\p{N}])(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})(?![\p{L}\p{N}])/gu;
type Span = [number, number];
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameWords = (names: readonly string[]) => [...new Set(names.flatMap(n => foldNoise(n).split(/[^\p{L}\p{N}]+/u)).filter(w => w.length >= 3))];
/** Accent/case-insensitive, word-bounded occurrences (a space matches any whitespace run), as spans of the source text. */
export function foldedSpans(text: string, needles: readonly string[]): Span[] {
  let out = '', i = 0; const at: number[] = [], spans: Span[] = [];
  for (const ch of text) { const f = foldNoise(ch); for (let k = 0; k < f.length; k++) at.push(i); out += f; i += ch.length; }
  at.push(text.length);
  for (const n of new Set(needles.map(x => foldNoise(x).trim()).filter(Boolean))) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${n.split(/\s+/).map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}])`, 'gu');
    for (const m of out.matchAll(re)) spans.push([at[m.index!], at[m.index! + m[0].length]]);
  }
  return spans;
}
function exactSpans(text: string, needles: readonly string[]): Span[] {
  const spans: Span[] = [];
  for (const n of needles) if (n) for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + n.length)) spans.push([i, i + n.length]);
  return spans;
}

type Tok = { kind: 'space' | 'word' | 'punct' | 'verbatim'; src: string; out: string; /** 0 free, 1 accents/case only, 2 verbatim */ guard: 0 | 1 | 2; gone?: boolean; before: string[]; after: string[];
  /** negation scope: the previous non-filler word is a negation / a negation is one of the two previous words */ afterNeg?: boolean; nearNeg?: boolean };
/** Negations whose scope noise never touches ('Nunca transforme uma negação em operação afirmativa'): nothing is inserted
 * right after one, no 'eh' ('é') lands within two words after one, and the word it negates is never repeated. */
const NEG_WORDS = new Set(['nao', 'n', 'nunca', 'nem', 'jamais']);
function tokenize(text: string, ctx: NoiseContext): Tok[] {
  const guard = new Uint8Array(text.length), names = ctx.names ?? [];
  const mark = (spans: Span[], v: 1 | 2) => { for (const [a, b] of spans) for (let i = a; i < b; i++) if (guard[i] < v) guard[i] = v; };
  mark(foldedSpans(text, [...names, ...nameWords(names), ...(ctx.literals ?? [])]), 1);
  mark(exactSpans(text, ctx.protect ?? []), 2);
  mark([...text.matchAll(DATE)].map(m => [m.index!, m.index! + m[0].length] as Span), 2);
  const toks: Tok[] = [];
  for (let i = 0; i < text.length;) {
    const verbatim = guard[i] === 2; let j = i;
    while (j < text.length && (guard[j] === 2) === verbatim) j++;
    if (verbatim) toks.push({ kind: 'verbatim', src: text.slice(i, j), out: text.slice(i, j), guard: 2, before: [], after: [] });
    else for (const m of text.slice(i, j).matchAll(TOKEN)) {
      const a = i + m.index!, s = m[0];
      toks.push({ kind: /^\s/u.test(s) ? 'space' : /^[\p{L}\p{M}\p{N}]/u.test(s) ? 'word' : 'punct', src: s, out: s,
        guard: guard.subarray(a, a + s.length).includes(1) ? 1 : 0, before: [], after: [] });
    }
    i = j;
  }
  // Guarded boundary: the negation scope of the text as written (punctuation skipped; a verbatim region is a non-negation word).
  const back: string[] = [];
  for (const t of toks) {
    if (t.kind === 'space' || t.kind === 'punct') continue;
    const content = back.filter(w => !FILLER_WORDS.has(w));
    t.afterNeg = content.length > 0 && NEG_WORDS.has(content[content.length - 1]);
    t.nearNeg = back.slice(-2).some(w => NEG_WORDS.has(w));
    back.push(t.kind === 'word' ? foldNoise(t.src) : '');
  }
  return toks;
}

const SUBST: Record<string, readonly [string, string]> = { que: ['q', 'QUE_Q'], porque: ['pq', 'PORQUE_PQ'], voce: ['vc', 'VOCE_VC'], tambem: ['tb', 'TAMBEM_TB'] };
const ARTICLES = new Set(['o', 'a', 'os', 'as']);
/** Words a contraction or abbreviation may legitimately replace (not counted as lost). */
const SUBSTITUTABLE = new Set(['para', ...ARTICLES, 'que', 'porque', 'voce', 'tambem', 'esta']);
/** Command verbs a speaker may repeat ('cancela cancela'); only these are ever doubled. */
const VERBS = new Set(['cancela', 'cancele', 'desmarca', 'desmarque', 'marca', 'marque', 'remarca', 'remarque', 'passa', 'passe', 'muda', 'mude', 'altera', 'altere',
  'bloqueia', 'bloqueie', 'fecha', 'feche', 'coloca', 'coloque']);
const FILLERS = ['eh', 'tipo', 'entao', 'ai'] as const, LINK_FILLERS = ['ai', 'entao'] as const;
const FILLER_WORDS = new Set<string>(FILLERS), NO_EH_FILLERS = FILLERS.filter(f => f !== 'eh');
const FINAL = /^[.!?;,:…]$/;
const FEM = ['', 'uma', 'duas', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze'];
const MASC = ['', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const pad2 = (n: number) => String(n).padStart(2, '0');
/** 1..31, masculine (days). */
export function numberWords(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 31) throw Error('AGENDA_NOISE_NUMBER');
  if (n < 10) return MASC[n]; if (n < 20) return TEENS[n - 10];
  const tens = n < 30 ? 'vinte' : 'trinta', u = n % 10; return u ? `${tens} e ${MASC[u]}` : tens;
}
const MINUTE_WORDS: Record<number, string> = { 15: ' e quinze', 30: ' e meia', 45: ' e quarenta e cinco' };
/** A clock in words only where unambiguous in a salon day: 7h-12h always; an afternoon clock only when the final state has it. */
export function spokenClock(h: number, m: number, finals: readonly string[] = []) {
  if (m !== 0 && !MINUTE_WORDS[m]) return null;
  const tail = MINUTE_WORDS[m] ?? '';
  if (h >= 7 && h <= 11) return m ? FEM[h] + tail : `${FEM[h]} horas`;
  if (h === 12) return 'meio-dia' + tail;
  if (h >= 13 && h <= 18 && finals.includes(`${pad2(h)}:${pad2(m)}`)) return `${FEM[h - 12]}${tail} da tarde`;
  return null;
}
const CLOCK = /^(\d{1,2})(?:h(\d{2})?|:(\d{2}))$/;

/** Applies one noise level to one rendered text. Deterministic in (text, level, seed, ctx); `tune` overrides the
 * probabilities (unit tests only). Returns the text to send and the codes of the rules that fired (no text). */
export function applyNoise(text: string, level: NoiseLevel, seed: string, ctx: NoiseContext = {}, tune: Partial<NoiseParams> = {}) {
  if (level === 'off') return { text, rules: [] as string[] };
  if (/[\uE000\uE001]/.test(text)) throw Error('AGENDA_NOISE_TEXT');
  const p = { ...NOISE_PARAMS[level], ...tune }, rand = prng(seed), rules = new Set<string>(), toks = tokenize(text, ctx);
  const next = (i: number) => { for (let j = i + 1; j < toks.length; j++) if (!toks[j].gone && toks[j].kind !== 'space') return j; return -1; };
  const prev = (i: number) => { for (let j = i - 1; j >= 0; j--) if (!toks[j].gone && toks[j].kind !== 'space') return j; return -1; };
  const wordAt = (i: number) => i >= 0 && toks[i].kind === 'word' ? toks[i].out : undefined;
  const free = (t: Tok) => t.guard === 0 && !t.gone;
  // 1. accents and case everywhere except verbatim regions (fold-equivalent for names and literals)
  for (const t of toks) if (t.kind === 'word' || t.kind === 'punct') {
    const nfc = t.src.normalize('NFC'), plain = stripAccents(nfc), low = plain.toLowerCase(), lower = nfc.toLowerCase();
    if (plain !== nfc) rules.add('ACCENTS');
    if (low !== plain) rules.add('LOWERCASE');
    if (lower === 'horário' || lower === 'horários') rules.add('HORARIO');
    if (lower === 'às') rules.add('AS_CRASE');
    t.out = low;
  }
  // 2. heavy: clocks and days in words ('10h' dez horas, '10:30' dez e meia, 'dia 28' dia vinte e oito)
  if (p.numbers > 0) toks.forEach((t, i) => {
    if (t.kind !== 'word' || !free(t)) return;
    const m = CLOCK.exec(t.out); let spoken: string | null = null, rule = 'CLOCK_WORDS';
    if (m) spoken = spokenClock(Number(m[1]), Number(m[2] ?? m[3] ?? 0), ctx.finalClocks);
    else if (/^\d{1,2}$/.test(t.out)) {
      const n = Number(t.out), after = wordAt(next(i)), before = wordAt(prev(i));
      if ((after === 'hora' || after === 'horas') && n >= 7 && n <= 12) spoken = FEM[n];
      else if (before === 'dia' && n >= 1 && n <= 31) { spoken = n === 1 ? 'primeiro' : numberWords(n); rule = 'DAY_WORDS'; }
      else if ((after === 'dia' || after === 'dias') && n >= 1 && n <= 31) { spoken = numberWords(n); rule = 'DAY_WORDS'; }
    }
    if (spoken && rand() < p.numbers) { t.out = spoken; rules.add(rule); }
  });
  // 3. chat abbreviations: para→pra/pro (never 'para de'), que→q, porque→pq, você→vc, também→tb, está→ta (accented only)
  toks.forEach((t, i) => {
    if (t.kind !== 'word' || !free(t)) return;
    if (t.out === 'para') {
      const j = next(i), nj = j >= 0 ? toks[j] : undefined, k = j >= 0 ? next(j) : -1;
      if (!nj || (nj.kind !== 'word' && nj.kind !== 'verbatim') || nj.out === 'de') return;
      if (nj.kind === 'word' && free(nj) && ARTICLES.has(nj.out) && k >= 0 && (toks[k].kind === 'word' || toks[k].kind === 'verbatim')) {
        if (rand() < p.subst) { t.out = 'pr' + nj.out; nj.gone = true; rules.add('PARA_ARTICLE'); }
      } else if (rand() < p.subst) { t.out = 'pra'; rules.add('PARA_PRA'); }
      return;
    }
    const s = (Object.hasOwn(SUBST, t.out) ? SUBST[t.out] : undefined) ?? (t.out === 'esta' && t.src.normalize('NFC').toLowerCase() === 'está' ? ['ta', 'ESTA_TA'] as const : undefined);
    if (s && rand() < p.subst) { t.out = s[0]; rules.add(s[1]); }
  });
  // 4. heavy: one repeated command verb (never a negated one: 'nao marca marca' would add a bare affirmative command)
  const verbs = toks.filter(t => t.kind === 'word' && free(t) && VERBS.has(t.out) && !t.afterNeg);
  if (p.double > 0 && verbs.length && rand() < p.double) { const t = verbs[Math.floor(rand() * verbs.length)]; t.after.push(t.out); rules.add('DOUBLE'); }
  // 5. punctuation: the final mark always goes; heavy drops most commas and periods (never between digits, never a join)
  for (let i = prev(toks.length); i >= 0 && toks[i].kind === 'punct' && free(toks[i]) && FINAL.test(toks[i].out); i = prev(i)) { toks[i].gone = true; rules.add('FINAL_PUNCT'); }
  if (p.comma > 0 || p.period > 0) toks.forEach((t, i) => {
    if (t.kind !== 'punct' || !free(t) || (t.out !== ',' && t.out !== '.')) return;
    const a = toks[i - 1], b = toks[i + 1];
    if (a?.kind === 'word' && b?.kind === 'word' && /\d$/.test(a.out) && /^\d/.test(b.out)) return;
    if (rand() < (t.out === ',' ? p.comma : p.period)) { rules.add(t.out === ',' ? 'COMMA' : 'PERIOD'); t.kind = 'space'; t.out = ' '; }
  });
  // 6. heavy: fillers at clause boundaries (start, after a sentence mark or comma, 'e' before a command verb) and a tail 'né';
  // never right after a negation ('nao, a carla' → 'nao eh a carla' inverts a self-correction) and no 'eh' within two words after one
  if (p.maxFillers > 0 && toks.filter(t => t.kind === 'word' && !t.gone).length >= 3) {
    const targets = new Map<number, readonly string[]>(), first = next(-1);
    if (first >= 0 && toks[first].kind === 'word') targets.set(first, FILLERS);
    toks.forEach((t, i) => {
      if (t.guard !== 0 || t.gone) return;
      const j = next(i);
      if (j < 0 || toks[j].kind !== 'word' || targets.has(j) || toks[j].afterNeg) return;
      if (/^[,.;!?]$/.test(t.src)) targets.set(j, toks[j].nearNeg ? NO_EH_FILLERS : FILLERS);
      else if (t.kind === 'word' && t.out === 'e' && VERBS.has(toks[j].out)) targets.set(j, LINK_FILLERS);
    });
    let used = 0;
    for (const [j, list] of [...targets].sort((a, b) => a[0] - b[0])) if (used < p.maxFillers && rand() < p.filler) {
      toks[j].before.push(list[Math.floor(rand() * list.length)]); used++; rules.add('FILLER');
    }
    const last = prev(toks.length);
    if (used < p.maxFillers && last >= 0 && toks[last].kind === 'word' && !NEG_WORDS.has(foldNoise(toks[last].src)) && rand() < p.tail) { toks[last].after.push('ne'); rules.add('FILLER'); }
  }
  // 7. join; collapse whitespace outside verbatim regions
  if (toks.some(t => t.kind === 'space' && t.guard === 0 && /^\s+$/.test(t.src) && t.src !== ' ') || /^\s|\s$/.test(text)) rules.add('SPACES');
  const kept: string[] = [];
  const joined = toks.filter(t => !t.gone).map(t => t.kind === 'verbatim' ? `\uE000${kept.push(t.out) - 1}\uE001` : [...t.before, t.out, ...t.after].join(' ')).join('');
  return { text: joined.replace(/\s+/g, ' ').trim().replace(/\uE000(\d+)\uE001/g, (_, n: string) => kept[Number(n)]), rules: [...rules].sort() };
}

// ---------------------------------------------------------------- invariants (independent of the generator)
const HOUR_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, 'meio-dia': 12 };
const UNIT_WORDS: Record<string, number> = { um: 1, uma: 1, primeiro: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9 };
const TEEN_WORDS: Record<string, number> = { ...Object.fromEntries(TEENS.map((w, i) => [w, 10 + i])), quatorze: 14 };
const TEN_WORDS: Record<string, number> = { vinte: 20, trinta: 30 };
const MINUTE_SEQ: [string[], number][] = [[['meia'], 30], [['quinze'], 15], [['quarenta', 'e', 'cinco'], 45]];
const WEEKDAY_WORDS = new Set(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']);
const NEGATIONS = new Set(['nao', 'nunca', 'nem', 'jamais']), RELATIVE = new Set(['hoje', 'amanha', 'ontem']);
/** The only words noise may add: fillers, a repeated command verb, spelled clocks/days and the abbreviations. */
const ADDABLE = new Set([...FILLERS, 'ne', ...VERBS, ...FEM, ...MASC, ...TEENS, 'vinte', 'trinta', 'primeiro', 'meio-dia', 'hora', 'horas', 'da', 'tarde', 'e', 'meia',
  'quinze', 'quarenta', 'pra', 'pro', 'pras', 'pros', 'q', 'pq', 'vc', 'tb', 'ta'].filter(Boolean));
/** Meaning-bearing facts of a text whatever its spelling: clocks (digits or words), days of month, day counts, dates,
 * weekdays, relative days, negations, entity words and any other number, as a sorted multiset. */
export function noiseFacts(text: string, names: readonly string[] = []) {
  const w = [...foldNoise(text).matchAll(FACT_WORD)].map(m => m[0]), entity = new Set(nameWords(names)), facts: string[] = [];
  const has = (o: Record<string, number>, x: string | undefined): x is string => x !== undefined && Object.hasOwn(o, x);
  const minutesAt = (j: number): [number, number] | null => {
    if (w[j] !== 'e') return null;
    for (const [seq, m] of MINUTE_SEQ) if (seq.every((x, k) => w[j + 1 + k] === x)) return [m, seq.length + 1];
    return null;
  };
  const numberAt = (j: number): [number, number] | null => {
    const x = w[j];
    if (x !== undefined && /^\d{1,2}$/.test(x)) return [Number(x), 1];
    if (has(TEN_WORDS, x)) { const u = w[j + 1] === 'e' && has(UNIT_WORDS, w[j + 2]) && w[j + 2] !== 'primeiro' ? UNIT_WORDS[w[j + 2]] : 0; return u ? [TEN_WORDS[x] + u, 3] : [TEN_WORDS[x], 1]; }
    if (has(TEEN_WORDS, x)) return [TEEN_WORDS[x], 1];
    if (has(UNIT_WORDS, x)) return [UNIT_WORDS[x], 1];
    return null;
  };
  /** 'da tarde'/'da noite' (+12 below noon) and 'da manhã' after a clock. */
  const period = (h: number, j: number): [number, number] => w[j] === 'da' && ['tarde', 'noite', 'manha'].includes(w[j + 1]) ? [w[j + 1] !== 'manha' && h < 12 ? h + 12 : h, j + 2] : [h, j];
  for (let i = 0; i < w.length;) {
    const x = w[i], m = CLOCK.exec(x);
    if (m || (/^\d{1,2}$/.test(x) && (w[i + 1] === 'hora' || w[i + 1] === 'horas'))) {
      let min = m ? Number(m[2] ?? m[3] ?? 0) : 0, j = i + (m ? 1 : 2);
      const e = min === 0 ? minutesAt(j) : null; if (e) { min = e[0]; j += e[1]; }
      const [h, end] = period(Number(m ? m[1] : x), j);
      facts.push(`T:${pad2(h)}:${pad2(min)}`); i = end; continue;
    }
    if (has(HOUR_WORDS, x)) {
      let min: number | null = x === 'meio-dia' ? 0 : null, j = i + 1;
      if (w[j] === 'hora' || w[j] === 'horas') { min = 0; j++; }
      const e = minutesAt(j); if (e) { min = (min ?? 0) + e[0]; j += e[1]; }
      const spoken = w[j] === 'da' && ['tarde', 'noite', 'manha'].includes(w[j + 1]);
      if (min !== null || spoken) { const [h, end] = period(HOUR_WORDS[x], j); facts.push(`T:${pad2(h)}:${pad2(min ?? 0)}`); i = end; continue; }
    }
    if (x === 'dia') { const n = numberAt(i + 1); if (n && n[0] >= 1 && n[0] <= 31) { facts.push(`D:${n[0]}`); i += 1 + n[1]; continue; } }
    const n = numberAt(i);
    if (n && (w[i + n[1]] === 'dia' || w[i + n[1]] === 'dias')) { facts.push(`C:${n[0]}`); i += n[1] + 1; continue; }
    const day = x.replace(/-feira$/, '');
    if (/^(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})$/.test(x)) facts.push('DATE:' + x);
    else if (WEEKDAY_WORDS.has(day)) facts.push('W:' + day);
    else if (RELATIVE.has(x)) facts.push('R:' + x);
    else if (NEGATIONS.has(x)) facts.push('NEG');
    else if (entity.has(x)) facts.push('E:' + x);
    else if (/\d/.test(x)) facts.push('N:' + x);
    i++;
  }
  return facts.sort();
}
/** The two words after each negation, in order (folded). */
const negationScopes = (text: string) => {
  const w = [...foldNoise(text).matchAll(FACT_WORD)].map(m => m[0]);
  return w.flatMap((x, i) => NEG_WORDS.has(x) ? [[w[i + 1], w[i + 2]] as [string | undefined, string | undefined]] : []);
};
const ABBREVIATED: Record<string, string> = { pra: 'para', pro: 'para', pras: 'para', pros: 'para', q: 'que', pq: 'porque', vc: 'voce', tb: 'tambem', ta: 'esta' };
const numberish = (x: string) => /\d/.test(x) || x === 'meio-dia' || [HOUR_WORDS, UNIT_WORDS, TEEN_WORDS, TEN_WORDS].some(o => Object.hasOwn(o, x));
const unabbreviated = (x: string) => Object.hasOwn(ABBREVIATED, x) ? ABBREVIATED[x] : x;
const sameScopeWord = (a: string | undefined, b: string | undefined) => a === b ||
  (a !== undefined && b !== undefined && (unabbreviated(a) === unabbreviated(b) || (numberish(a) && numberish(b))));
/** Codes of every broken invariant between the text as written and the text sent (empty = meaning preserved). */
export function noiseViolations(original: string, sent: string, ctx: NoiseContext = {}) {
  const codes = new Set<string>();
  if (original.trim() && !sent.trim()) codes.add('EMPTY');
  for (const r of ctx.protect ?? []) if (exactSpans(original, [r]).length !== exactSpans(sent, [r]).length) codes.add('VERBATIM');
  for (const n of ctx.names ?? []) if (foldedSpans(original, [n]).length !== foldedSpans(sent, [n]).length) codes.add('NAME');
  for (const n of ctx.literals ?? []) if (foldedSpans(original, [n]).length !== foldedSpans(sent, [n]).length) codes.add('LITERAL');
  if (JSON.stringify(noiseFacts(original, ctx.names)) !== JSON.stringify(noiseFacts(sent, ctx.names))) codes.add('FACTS');
  // Negation scope, per negation (a changed count is already FACTS/WORD_LOST): the first word after it is the same word
  // (abbreviation or spelled number allowed), it is not newly repeated and no new 'eh' lands within two words after it.
  const o = negationScopes(original), s = negationScopes(sent);
  if (o.length === s.length && o.some(([a1, a2], k) => { const [b1, b2] = s[k];
    return !sameScopeWord(a1, b1) || (b1 !== undefined && b1 === b2 && a1 !== a2) || [b1, b2].filter(x => x === 'eh').length > [a1, a2].filter(x => x === 'eh').length; })) codes.add('NEG_SCOPE');
  const count = (text: string, keep: (x: string) => boolean) => {
    const out = new Map<string, number>();
    for (const [x] of foldNoise(text).matchAll(FACT_WORD)) if (keep(x)) out.set(x, (out.get(x) ?? 0) + 1);
    return out;
  };
  const before = count(original, () => true), after = count(sent, () => true);
  for (const [x, n] of before) if (!/\d/.test(x) && !SUBSTITUTABLE.has(x) && (after.get(x) ?? 0) < n) codes.add('WORD_LOST');
  for (const [x, n] of after) if (n > (before.get(x) ?? 0) && !ADDABLE.has(x)) codes.add('WORD_ADDED');
  return [...codes].sort();
}

// ---------------------------------------------------------------- scenario wiring
const FINAL_CLOCK = /\b\d{2}:\d{2}\b/g;
/** Names of the scenario's fixture, its `noNoise` regions (rendered), its literal reason cores and its final clocks
 * (from `final`, or from the legacy E map for legacy scenarios). The oracle is only read, never altered or sent. */
export function scenarioNoiseContext(s: AgendaScenario, today: string, legacy?: LegacyMap): NoiseContext {
  const { fixture } = buildScenarioFixture(s, today);
  const names = [...fixture.customers, ...fixture.professionals, ...fixture.services].map(x => x.name);
  const literals = (s.final?.appointments ?? []).flatMap(a => a.reason === undefined ? [] : typeof a.reason === 'string' ? [a.reason] : a.reason);
  const clocks = s.final ? [...(s.final.appointments ?? []).flatMap(a => [a.time, ...(a.end ? [a.end] : [])]), ...(s.final.blocks ?? []).flatMap(b => [b.from, b.to])]
    : legacy && Object.hasOwn(legacy, s.id) ? JSON.stringify(legacy[s.id]).match(FINAL_CLOCK) ?? [] : [];
  return { names, protect: (s.noNoise ?? []).map(r => renderTemplate(r, today)), literals, finalClocks: [...new Set(clocks)].sort() };
}
/** Every text a run can send: scripted says (`say:<n>`) and every variant of every answer instance (`answer:<field>:<use>`). */
export function noiseSources(s: AgendaScenario, today: string): [string, string][] {
  const out: [string, string][] = [];
  s.steps.forEach((step, i) => { if ('say' in step) out.push([`say:${i + 1}`, renderTemplate(step.say, today)]); });
  for (const [field, spec] of Object.entries(s.answers ?? {})) answerInstances(spec).forEach((v, n) => {
    for (const text of Array.isArray(v) ? v : [v]) out.push([`answer:${field}:${n + 1}`, renderTemplate(text, today)]);
  });
  return out;
}
export type NoiseViolation = { id: string; k: number; source: string; codes: string[] };
/** Offline check of every text the run could send, for every attempt: counts, rule histogram and violations (codes only). */
export function noisePreflight(scenarios: AgendaScenario[], input: { profile: NoiseProfile; repeat: number; today: string; legacy?: LegacyMap }) {
  const levels = Array.from({ length: input.repeat }, (_, i) => noiseLevel(input.profile, i + 1));
  const out = { profile: input.profile, levels, texts: 0, changed: 0, rules: {} as Record<string, number>, clean: [] as string[], violations: [] as NoiseViolation[] };
  if (input.profile === 'off') return out;
  for (const s of scenarios) {
    if (s.noise === false) { out.clean.push(s.id); continue; }
    const ctx = scenarioNoiseContext(s, input.today, input.legacy), sources = noiseSources(s, input.today);
    for (let k = 1; k <= input.repeat; k++) {
      const level = noiseLevel(input.profile, k, s);
      if (level === 'off') continue;
      for (const [source, text] of sources) {
        const r = applyNoise(text, level, noiseSeed(s.id, k, source), ctx);
        out.texts++; if (r.text !== text) out.changed++;
        for (const x of r.rules) out.rules[x] = (out.rules[x] ?? 0) + 1;
        const codes = noiseViolations(text, r.text, ctx);
        if (codes.length) out.violations.push({ id: s.id, k, source, codes });
      }
    }
  }
  out.rules = Object.fromEntries(Object.entries(out.rules).sort());
  return out;
}
