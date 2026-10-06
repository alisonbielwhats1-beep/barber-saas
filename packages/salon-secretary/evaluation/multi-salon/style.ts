/** Style layer of the multi-salon generator (evaluation only: no I/O, no model). Inserts regional and register markers of
 * styles.json into a rendered owner text (insertion only: at the start, at the end, before a command verb at an existing
 * clause boundary, or as an own sentence) and may rewrite a leading command into a polite frame. Its own invariant
 * (styleViolations) proves the meaning is kept: entity names keep their counts, noiseFacts (clocks, days, dates, weekdays,
 * negations, entity words, numbers) is unchanged, only marker/frame vocabulary is added, only the framed imperative is
 * lost, the two words after every negation are the same and no excluded expression appears. A text that would break it
 * is left as written. `{{d:...}}` day templates are never touched (the runner renders them). */
import { renderTemplate } from '../agenda-practice-lib';
import { foldNoise, foldedSpans, noiseFacts } from '../agenda-practice-noise';

export type Marker = { text: string; positions: string[]; joiner?: string; mark?: string; turns: string[]; tags: string[] };
export type StyleGroup = { id: string; kind: string; label: string; maxPerMessage: number; markers: Marker[] };
export type StyleVerb = { imperative: string[]; infinitive: string; subjunctive: string; nounHomograph: boolean };
export type StyleFrame = { id: string; template: string; register: string; mark?: string; turns: string[]; tags: string[] };
export type Styles = { groups: StyleGroup[]; verbs: StyleVerb[]; frames: StyleFrame[]; excluded: { text: string; reason: string }[] };
export type Turn = 'first' | 'say' | 'answer';
export type Position = 'start' | 'end' | 'clause' | 'sentence-before' | 'sentence-after';
export type StyleChoice = { region: StyleGroup | null; register: StyleGroup | null; frame: StyleFrame | null };
export type StyleOptions = { turn: Turn; choice: StyleChoice; rand: () => number; voice: boolean; names: readonly string[];
  /** probability of one insertion per chosen group */ p: number; /** allowed positions (a reason-bearing text: start only) */ positions?: readonly Position[] };

const TOKEN = /\{\{[^{}]*\}\}/g;
/** Day templates masked as a digit run of the same length: a number to every rule, never split, never edited. */
const mask = (text: string) => text.replace(TOKEN, m => '0'.repeat(m.length));
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;
type W = { w: string; raw: string; start: number; end: number };
const wordsOf = (text: string): W[] => [...mask(text).matchAll(WORD)].map(m => ({ w: foldNoise(m[0]), raw: m[0], start: m.index!, end: m.index! + m[0].length }));
const NEG = new Set(['nao', 'n', 'nunca', 'nem', 'jamais']);
const FINAL_MARKS = /[\s.!?…]+$/u;
const cap = (s: string) => s ? s[0].toLocaleUpperCase('pt-BR') + s.slice(1) : s;
const low = (s: string) => s ? s[0].toLocaleLowerCase('pt-BR') + s.slice(1) : s;
const isUpper = (ch: string | undefined) => !!ch && ch !== ch.toLocaleLowerCase('pt-BR');
const nameWordSet = (names: readonly string[]) => new Set(names.flatMap(n => foldNoise(n).split(/[^\p{L}\p{N}]+/u)).filter(w => w.length >= 2));
const DEFAULT_POSITIONS: readonly Position[] = ['start', 'end', 'clause', 'sentence-before', 'sentence-after'];
const turnAllows = (m: Marker, turn: Turn) => m.turns.includes(turn) || (turn === 'first' && m.turns.includes('say'));

export function styleVocabulary(styles: Styles) {
  const words = new Set<string>();
  const add = (text: string) => { for (const w of wordsOf(text)) words.add(w.w); };
  for (const g of styles.groups) for (const m of g.markers) add(m.text);
  for (const f of styles.frames) add(f.template.replace(/\{[a-z]+\}/g, ' '));
  for (const v of styles.verbs) { add(v.infinitive); add(v.subjunctive); }
  return words;
}
const imperativeMap = (styles: Styles) => new Map(styles.verbs.flatMap(v => v.imperative.map(i => [foldNoise(i), v] as const)));

/** Clause boundaries before a command verb: after a comma or sentence mark, or between "e" and the verb; never within two
 * words after a negation. Returns the insertion offsets. */
function clauseSlots(text: string, verbs: Map<string, StyleVerb>) {
  const w = wordsOf(text), m = mask(text), out: number[] = [];
  for (let i = 1; i < w.length; i++) {
    if (!verbs.has(w[i].w)) continue;
    const gap = m.slice(w[i - 1].end, w[i].start), linked = w[i - 1].w === 'e' && i >= 2 && /[,;]/.test(m.slice(w[i - 2].end, w[i - 1].start));
    if (!/[,.;!?…]/.test(gap) && !linked) continue;
    if (w.slice(Math.max(0, i - 2), i).some(x => NEG.has(x.w))) continue;
    out.push(w[i].start);
  }
  return out;
}

function insert(text: string, marker: Marker, pos: Position, o: StyleOptions, verbs: Map<string, StyleVerb>, names: Set<string>): string | null {
  const w = wordsOf(text), comma = marker.joiner === 'comma' && !o.voice;
  if (!w.length) return null;
  const firstIsName = names.has(w[0].w);
  switch (pos) {
    case 'start': {
      if (NEG.has(w[0].w)) return null;
      const upper = isUpper(text[0]) && !o.voice, rest = upper && !firstIsName ? low(text) : text;
      return `${upper ? cap(marker.text) : marker.text}${comma ? ',' : ''} ${rest}`;
    }
    case 'end': {
      if (w.slice(-2).some(x => NEG.has(x.w))) return null;
      const body = text.replace(FINAL_MARKS, '');
      return `${body}${comma ? ',' : ''} ${marker.text}`;
    }
    case 'clause': {
      const slots = clauseSlots(text, verbs);
      if (!slots.length) return null;
      const at = slots[Math.floor(o.rand() * slots.length)], upper = isUpper(text[at]) && !o.voice;
      return `${text.slice(0, at)}${upper ? cap(marker.text) : marker.text}${comma ? ',' : ''} ${upper ? low(text.slice(at)) : text.slice(at)}`;
    }
    case 'sentence-before':
      return o.voice ? `${marker.text} ${text}` : `${cap(marker.text)}${marker.mark ?? '!'} ${text}`;
    case 'sentence-after': {
      if (w.slice(-2).some(x => NEG.has(x.w))) return null;
      if (o.voice) return `${text.replace(FINAL_MARKS, '')} ${marker.text}`;
      const body = /[.!?…]\s*$/u.test(text) ? text.trimEnd() : `${text.replace(FINAL_MARKS, '')}.`;
      return `${body} ${cap(marker.text)}${marker.mark ?? '.'}`;
    }
  }
}

/** Polite or indirect frame for a leading command ("cancela a Ana..." -> "poderia cancelar a Ana...?"): only a one-sentence
 * text that starts with an imperative of styles.verbs (a noun homograph only before an article, "pra"/"pro" or a name). */
function applyFrame(text: string, frame: StyleFrame, verbs: Map<string, StyleVerb>, names: Set<string>, voice: boolean): string | null {
  const w = wordsOf(text), m = mask(text);
  if (w.length < 2 || w[0].start !== 0 || /[.!?…]\s+\S/u.test(m.replace(FINAL_MARKS, ''))) return null;
  const verb = verbs.get(w[0].w);
  if (!verb || (verb.nounHomograph && !['o', 'a', 'os', 'as', 'um', 'uma', 'pra', 'pro'].includes(w[1].w) && !names.has(w[1].w))) return null;
  const head = frame.template.replace('{infinitive}', verb.infinitive).replace('{subjunctive}', verb.subjunctive);
  const body = `${head}${text.slice(w[0].end)}`.replace(FINAL_MARKS, '');
  return voice ? body : `${cap(body)}${frame.mark ?? '.'}`;
}

/** One styled text: the frame (first turn), then up to maxPerMessage markers per chosen group. Deterministic in `rand`. */
export function applyStyle(text: string, styles: Styles, o: StyleOptions) {
  const verbs = imperativeMap(styles), names = nameWordSet(o.names), allowed = o.positions ?? DEFAULT_POSITIONS;
  let out = text; const markers: string[] = [], inserted: string[] = []; let frame: string | null = null; const used = new Set<Position>();
  if (o.choice.frame && o.turn === 'first' && allowed.includes('start')) {
    const framed = applyFrame(out, o.choice.frame, verbs, names, o.voice);
    if (framed !== null) { out = framed; frame = o.choice.frame.id; used.add('start'); inserted.push(o.choice.frame.template.replace(/\{[a-z]+\}/g, ' ')); }
  }
  for (const group of [o.choice.region, o.choice.register]) {
    if (!group || o.rand() >= o.p) continue;
    const count = group.maxPerMessage >= 2 && o.rand() < 0.25 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const options = group.markers.flatMap(m => turnAllows(m, o.turn) && !markers.includes(`${group.id}:${m.text}`) ? (m.positions as Position[])
        .filter(p => allowed.includes(p) && !used.has(p) && (o.turn !== 'answer' || p === 'start' || p === 'end') && (o.turn === 'first' || p !== 'sentence-before' || m.turns.includes('say')))
        .map(p => ({ m, p })) : []);
      for (let tries = 0; tries < 4 && options.length; tries++) {
        const pick = options.splice(Math.floor(o.rand() * options.length), 1)[0], next = insert(out, pick.m, pick.p, o, verbs, names);
        if (next === null) continue;
        out = next; used.add(pick.p); markers.push(`${group.id}:${pick.m.text}`); inserted.push(pick.m.text); break;
      }
    }
  }
  const violations = out === text ? [] : styleViolations(text, out, styles, o.names, inserted);
  return violations.length ? { text, markers: [] as string[], frame: null, violations } : { text: out, markers, frame, violations };
}

const REFERENCE_DAY = '2026-09-28';
const multiset = (text: string) => { const out = new Map<string, number>(); for (const w of wordsOf(text)) out.set(w.w, (out.get(w.w) ?? 0) + 1); return out; };
const negationScopes = (text: string) => { const w = wordsOf(text).map(x => x.w); return w.flatMap((x, i) => NEG.has(x) ? [`${w[i + 1] ?? ''}|${w[i + 2] ?? ''}`] : []); };
/** Codes of every broken style invariant between the text as written and the styled text (empty = meaning kept).
 * `inserted`: the marker and frame texts added (an excluded word inside a vetted marker, as "bom" in "bom dia", is that
 * marker's own rule; only an excluded expression formed anew counts). */
export function styleViolations(original: string, styled: string, styles: Styles, names: readonly string[], inserted: readonly string[] = []) {
  const codes = new Set<string>(), a = renderTemplate(original, REFERENCE_DAY), b = renderTemplate(styled, REFERENCE_DAY);
  if ((original.match(TOKEN) ?? []).join() !== (styled.match(TOKEN) ?? []).join()) codes.add('DAY_TEMPLATE');
  for (const n of names) if (foldedSpans(a, [n]).length !== foldedSpans(b, [n]).length) codes.add('NAME');
  if (JSON.stringify(noiseFacts(a, names)) !== JSON.stringify(noiseFacts(b, names))) codes.add('FACTS');
  const vocab = styleVocabulary(styles), imperatives = new Set(styles.verbs.flatMap(v => v.imperative.map(foldNoise)));
  const before = multiset(a), after = multiset(b);
  for (const [w, n] of after) if (n > (before.get(w) ?? 0) && !vocab.has(w)) codes.add('WORD_ADDED');
  for (const [w, n] of before) if ((after.get(w) ?? 0) < n && !imperatives.has(w)) codes.add('WORD_LOST');
  if (negationScopes(a).join() !== negationScopes(b).join()) codes.add('NEG_SCOPE');
  for (const e of styles.excluded) if (foldedSpans(b, [e.text]).length > foldedSpans(a, [e.text]).length + inserted.reduce((n, m) => n + foldedSpans(m, [e.text]).length, 0)) codes.add('EXCLUDED');
  return [...codes].sort();
}
