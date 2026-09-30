/** Name / entity diversity report (Candidate 4, backlog section 1): offline, no network, no database, no model. It reads
 * repository files and reports NAMES AND COUNTS ONLY, never a sentence, per corpus:
 * - the few-shot example bank as the model reads it (every entry filled from names.json with a fixed list of seeds), and
 *   the fill list itself (a pool: one occurrence per name);
 * - every Agenda practice battery file (DEV V = variations, DEV N = natural, practices A/B/C = scenarios, -r2, -r3, and any
 *   new agenda-practice-*.json), the multi-salon generated DEV split, the Golden 30 and the base fixtures.
 * An occurrence is a person of a scenario (declared in the scenario, or in the base fixture it runs on) whose first name the
 * owner's texts (says, scripted replies, select strings) mention: once per scenario. In the bank, one per filled person slot.
 * The first name of a full name is the longest compound of the name pools it starts with ("Maria Eduarda"), else its first
 * word; names are compared accent- and case-folded.
 * Metrics: top-5 / top-10 share, normalized entropy (H / ln D), distinct names per 100 occurrences, names above the 3%
 * target, and the same share by FIRST WORD (every "Maria X" compound counted as "Maria": the word the owner writes first; the
 * 3% target applies to both views); Jaccard of the name sets and the share of one corpus's occurrences whose name the other shows; category coverage
 * (compound, short, foreign, nickname, name that is a word, look-alike pairs). Historical regressions (Golden 30, base
 * fixtures) are reported but exempt from the 3% target.
 * CLI: scripts/secretary-name-diversity.cjs (JSON; --summary for one line per corpus). */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_FIXTURE, type AgendaScenario } from './agenda-practice-lib';
import { foldWords } from './agenda-practice-stats';
import { DEV_FILE, loadPools, type Pools } from './multi-salon/generate';
import { bankExample } from '../src/examples/bank';
import { CANONICAL_FILL_SEED, EXAMPLE_NAMES_FILE, exampleFills } from '../src/examples/fill';

export const NAME_DIVERSITY_VERSION = 'name-diversity-v2';
/** Backlog section 1 targets, fixed before the proof: no name above 3% of a corpus's occurrences outside the historical
 * regressions, and the bank x DEV overlap near zero. */
export const TARGET_MAX_SHARE = 0.03;
/** Seeds the bank is filled with (the canonical fill plus nine request-like seeds): the fill varies per request. */
export const BANK_FILL_SEEDS = [CANONICAL_FILL_SEED, ...Array.from({ length: 9 }, (_, i) => `name-diversity-${i + 1}`)];
const EVAL = 'packages/salon-secretary/evaluation';
const BATTERY = /^agenda-practice-(.+)\.json$/;
const BATTERY_LABEL: Record<string, string> = { variations: 'DEV V', natural: 'DEV N', scenarios: 'practice A', 'scenarios-r2': 'practice B', 'scenarios-r3': 'practice C' };
const key = (name: string) => foldWords(name).join(' ');
const PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

export type Lexicon = { compound: Set<string>; foreign: Set<string>; nickname: Set<string>; word: Set<string>; nicknames: Map<string, string> };
/** Category words from the name pools (names.json and the v3 cohort) and the bank's fill list. */
export function nameLexicon(pools: Pools, fill: { nicknames?: { name: string; formal?: string }[] } = {}): Lexicon {
  const sets = [pools.names, pools.cohort];
  const all = (g: 'compound' | 'foreignOrigin' | 'wordNames') => sets.flatMap(n => (n[g] ?? []).flatMap(p => [p.name, ...(p.variants ?? [])])).map(key);
  const nicknames = new Map([...sets.flatMap(n => (n.nicknames ?? []).map(x => x.nickname)), ...(fill.nicknames ?? []).map(x => x.name)].map(n => [key(n), n] as const));
  return { compound: new Set(all('compound')), foreign: new Set(all('foreignOrigin')), word: new Set(all('wordNames')), nickname: new Set(nicknames.keys()), nicknames };
}
/** The first name of a full name (display spelling): the longest pool compound it starts with, else its first word. */
export function firstName(full: string, lex: Lexicon) {
  const parts = full.trim().split(/\s+/);
  for (let n = Math.min(4, parts.length); n >= 2; n--) if (lex.compound.has(key(parts.slice(0, n).join(' ')))) return parts.slice(0, n).join(' ');
  return parts[0] ?? '';
}

type Counts = Map<string, { name: string; n: number }>;
export type Corpus = { id: string; label: string; kind: 'bank' | 'pool' | 'scenarios' | 'fixture'; historical: boolean; units: number; counts: Counts };
const add = (counts: Counts, name: string) => { const k = key(name); if (!k) return; const x = counts.get(k); if (x) x.n++; else counts.set(k, { name, n: 1 }); };
const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
/** Names a scenario's owner texts mention (first names, once each). */
export function scenarioMentions(s: AgendaScenario, lex: Lexicon): string[] {
  const texts = [...(s.steps ?? []).flatMap(step => 'say' in step ? [step.say] : 'select' in step ? [step.select] : []), ...strings(s.answers)]
    .map(t => ` ${foldWords(t.replace(/\{\{[^{}]*\}\}/g, ' ')).join(' ')} `);
  const declared = [...(s.customers ?? []).map(c => c.name), ...(s.professionals ?? []).map(p => p.name),
    ...(s.salon ? [] : [...BASE_FIXTURE.customers, ...BASE_FIXTURE.professionals].map(p => p.name))];
  const out = new Map<string, string>();
  for (const full of declared) {
    const first = firstName(full, lex), k = key(first);
    if (!k || out.has(k)) continue;
    if (texts.some(t => t.includes(` ${k} `) || t.includes(` ${key(full)} `))) out.set(k, first);
  }
  // A nickname the owner says (a pool or fill-list nickname of 3+ letters, whole word) is an occurrence of its own.
  for (const [k, display] of lex.nicknames) if (k.length >= 3 && !out.has(k) && texts.some(t => t.includes(` ${k} `))) out.set(k, display);
  return [...out.values()];
}
function scenarioCorpus(id: string, label: string, scenarios: readonly AgendaScenario[], lex: Lexicon, historical = false): Corpus {
  const counts: Counts = new Map();
  for (const s of scenarios) for (const name of scenarioMentions(s, lex)) add(counts, name);
  return { id, label, kind: 'scenarios', historical, units: scenarios.length, counts };
}
type Golden = { fixture: { customers: { name: string }[]; professionals: { name: string }[] }; cases: { turns: { message: string }[] }[] };
const readJson = <T,>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
/** Every corpus of the report (deterministic in the repository files). */
export function nameCorpora(root: string = process.cwd()): { corpora: Corpus[]; lex: Lexicon } {
  const pools = loadPools(root), fill = readJson<{ given: Record<string, string[]>; nicknames: { name: string; formal?: string }[] }>(join(root, EXAMPLE_NAMES_FILE));
  const lex = nameLexicon(pools, fill), corpora: Corpus[] = [];
  // the bank as the model reads it
  const bank = readJson<unknown[]>(join(root, 'packages/salon-secretary/src/examples/bank.json')), bankCounts: Counts = new Map();
  for (const raw of bank) {
    const parsed = bankExample.safeParse(raw);
    if (!parsed.success) continue;
    for (const seed of BANK_FILL_SEEDS) {
      const fills = exampleFills(parsed.data, seed);
      for (const p of Object.values(fills?.people ?? {})) add(bankCounts, p.nickname ?? p.given);
    }
  }
  corpora.push({ id: 'bank-filled', label: `example bank filled (${BANK_FILL_SEEDS.length} seeds)`, kind: 'bank', historical: false, units: bank.length, counts: bankCounts });
  const pool: Counts = new Map();
  for (const name of [...Object.values(fill.given).flat(), ...fill.nicknames.map(n => n.name)]) add(pool, name);
  corpora.push({ id: 'bank-fill-list', label: 'fill list (names.json)', kind: 'pool', historical: false, units: pool.size, counts: pool });
  // Agenda practice batteries (DEV V/N, practices A/B/C, any new one)
  for (const file of readdirSync(join(root, EVAL)).filter(f => BATTERY.test(f)).sort()) {
    const list = readJson<unknown>(join(root, EVAL, file));
    if (!Array.isArray(list)) continue;
    const stem = BATTERY.exec(file)![1];
    corpora.push(scenarioCorpus(`battery-${stem}`, BATTERY_LABEL[stem] ?? stem, list as AgendaScenario[], lex));
  }
  const devFile = join(root, DEV_FILE);
  if (existsSync(devFile)) corpora.push(scenarioCorpus('multi-salon-dev', 'multi-salon generated DEV split', readJson<AgendaScenario[]>(devFile), lex));
  // Golden 30 (historical regression: fixed names by design)
  const golden = readJson<Golden>(join(root, EVAL, 'free-use-golden-30.json')), goldenCounts: Counts = new Map();
  const goldenPeople = [...golden.fixture.customers, ...golden.fixture.professionals].map(p => p.name);
  for (const c of golden.cases) {
    const texts = c.turns.map(t => ` ${foldWords(t.message).join(' ')} `), seen = new Set<string>();
    for (const full of goldenPeople) { const first = firstName(full, lex), k = key(first); if (!seen.has(k) && texts.some(t => t.includes(` ${k} `))) { seen.add(k); add(goldenCounts, first); } }
  }
  corpora.push({ id: 'golden-30', label: 'Golden 30 (historical)', kind: 'scenarios', historical: true, units: golden.cases.length, counts: goldenCounts });
  // base fixtures (historical): each declared person once
  const fixture: Counts = new Map();
  for (const full of [...BASE_FIXTURE.customers, ...BASE_FIXTURE.professionals].map(p => p.name).concat(goldenPeople)) add(fixture, firstName(full, lex));
  corpora.push({ id: 'base-fixtures', label: 'base fixture + Golden fixture (historical)', kind: 'fixture', historical: true, units: fixture.size, counts: fixture });
  return { corpora, lex };
}

// ---------------------------------------------------------------- metrics (names and counts only)
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const sorted = (c: Counts) => [...c.values()].sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
export function concentration(c: Counts) {
  const list = sorted(c), N = list.reduce((s, x) => s + x.n, 0), D = list.length;
  const share = (k: number) => N ? r4(list.slice(0, k).reduce((s, x) => s + x.n, 0) / N) : 0;
  const H = N ? -list.reduce((s, x) => s + (x.n / N) * Math.log(x.n / N), 0) : 0;
  return { occurrences: N, distinct: D, top5Share: share(5), top10Share: share(10), normalizedEntropy: D > 1 ? r4(H / Math.log(D)) : null, distinctPer100: N ? r4((100 * D) / N) : 0,
    maxShare: N ? r4(list[0].n / N) : 0, aboveTarget: list.filter(x => x.n / N > TARGET_MAX_SHARE).map(x => ({ name: x.name, count: x.n, share: r4(x.n / N) })),
    top10: list.slice(0, 10).map(x => ({ name: x.name, count: x.n })) };
}
/** The same concentration by first word: "Maria Lívia", "Maria Heloísa" and "Maria" all count as "Maria" (a compound-aware
 * count alone can read "no name above 3%" while the first word the owner writes is above it). */
export function firstTokenConcentration(c: Counts) {
  const tokens: Counts = new Map();
  for (const x of c.values()) {
    const first = x.name.trim().split(/\s+/)[0] ?? '', k = key(first);
    if (!k) continue;
    const t = tokens.get(k); if (t) t.n += x.n; else tokens.set(k, { name: first, n: x.n });
  }
  const list = sorted(tokens), N = list.reduce((s, x) => s + x.n, 0);
  return { distinct: list.length, maxShare: N ? r4(list[0].n / N) : 0, aboveTarget: list.filter(x => x.n / N > TARGET_MAX_SHARE).map(x => ({ name: x.name, count: x.n, share: r4(x.n / N) })) };
}
/** Look-alike names (Ana/Anna/Ana Paula, Luiz/Luís, Rafael/Rafaela, Taís/Thaís): same spelling skeleton, one a short
 * suffix away from the other, one the first word of the other, or one edit apart (4+ letters). */
export function lookAlike(a: string, b: string) {
  const x = key(a), y = key(b);
  if (!x || !y || x === y) return false;
  const skeleton = (s: string) => s.replace(/th/g, 't').replace(/ph/g, 'f').replace(/y/g, 'i').replace(/w/g, 'v').replace(/k/g, 'c').replace(/z/g, 's').replace(/h/g, '').replace(/(.)\1+/g, '$1');
  if (skeleton(x) === skeleton(y)) return true;
  if (x.split(' ')[0] === y || y.split(' ')[0] === x) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s) && l.length - s.length <= 2 && !l.slice(s.length).includes(' ')) return true;
  if (s.length < 4 || l.length - s.length > 1) return false;
  let i = 0; while (i < s.length && s[i] === l[i]) i++;
  return s.length === l.length ? s.slice(i + 1) === l.slice(i + 1) : s.slice(i) === l.slice(i + 1);
}
export function categories(c: Counts, lex: Lexicon) {
  const list = sorted(c), cat = (test: (k: string) => boolean) => { const hit = list.filter(x => test(key(x.name))); return { distinct: hit.length, occurrences: hit.reduce((s, x) => s + x.n, 0) }; };
  const pairs: [string, string][] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (lookAlike(list[i].name, list[j].name)) pairs.push([list[i].name, list[j].name]);
  return { compound: cat(k => k.split(' ').filter(w => !PARTICLES.has(w)).length > 1 || lex.compound.has(k)), short: cat(k => !k.includes(' ') && k.length <= 3),
    foreign: cat(k => lex.foreign.has(k)), nickname: cat(k => lex.nickname.has(k)), word: cat(k => lex.word.has(k)),
    lookAlikePairs: { pairs: pairs.length, examples: pairs.slice(0, 8) } };
}
export function overlap(a: Counts, b: Counts) {
  const A = new Set(a.keys()), B = new Set(b.keys()), common = [...A].filter(k => B.has(k));
  const occ = (x: Counts, other: Set<string>) => { const N = [...x.values()].reduce((s, v) => s + v.n, 0); return N ? r4([...x].filter(([k]) => other.has(k)).reduce((s, [, v]) => s + v.n, 0) / N) : 0; };
  return { jaccard: A.size + B.size ? r4(common.length / (A.size + B.size - common.length)) : 0, common: common.length, aInB: occ(a, B), bInA: occ(b, A) };
}
/** The whole report: names and counts only. */
export function nameDiversityReport(root: string = process.cwd()) {
  const { corpora, lex } = nameCorpora(root);
  const rows = corpora.map(c => ({ id: c.id, label: c.label, kind: c.kind, historical: c.historical, units: c.units, ...concentration(c.counts), firstToken: firstTokenConcentration(c.counts),
    categories: categories(c.counts, lex) }));
  const pairs = corpora.flatMap((a, i) => corpora.slice(i + 1).map(b => ({ a: a.id, b: b.id, ...overlap(a.counts, b.counts) })));
  const dev = corpora.filter(c => c.kind === 'scenarios' && !c.historical).map(c => c.id);
  const bankDev = pairs.filter(p => (p.a === 'bank-filled' && dev.includes(p.b)) || (p.b === 'bank-filled' && dev.includes(p.a)));
  return { tool: NAME_DIVERSITY_VERSION, targets: { maxShare: TARGET_MAX_SHARE, bankDevOverlap: 'near zero' }, bankFillSeeds: BANK_FILL_SEEDS.length, corpora: rows, overlap: pairs,
    checks: { aboveMaxShare: rows.filter(r => !r.historical && r.kind !== 'pool' && r.maxShare > TARGET_MAX_SHARE).map(r => ({ corpus: r.id, maxShare: r.maxShare, names: r.aboveTarget.length })),
      // The 3% target by first word too: a corpus listed here does NOT meet the target, whatever its compound-aware share.
      aboveMaxShareFirstToken: rows.filter(r => !r.historical && r.kind !== 'pool' && r.firstToken.maxShare > TARGET_MAX_SHARE)
        .map(r => ({ corpus: r.id, maxShare: r.firstToken.maxShare, tokens: r.firstToken.aboveTarget.map(x => x.name) })),
      bankDev: bankDev.map(p => ({ corpus: p.a === 'bank-filled' ? p.b : p.a, jaccard: p.jaccard, common: p.common, bankInCorpus: p.a === 'bank-filled' ? p.aInB : p.bInA,
        corpusInBank: p.a === 'bank-filled' ? p.bInA : p.aInB })) } };
}
/** One line per corpus (the --summary view). */
export const summaryLines = (report: ReturnType<typeof nameDiversityReport>) => report.corpora.map(r =>
  `${r.id.padEnd(26)} n=${String(r.occurrences).padStart(5)} distinct=${String(r.distinct).padStart(4)} top5=${r.top5Share.toFixed(3)} top10=${r.top10Share.toFixed(3)} ` +
  `H=${r.normalizedEntropy === null ? '-' : r.normalizedEntropy.toFixed(3)} per100=${r.distinctPer100.toFixed(1)} max=${r.maxShare.toFixed(3)} maxFirstWord=${r.firstToken.maxShare.toFixed(3)}` +
  `${r.historical ? ' (historical)' : ''}`);
