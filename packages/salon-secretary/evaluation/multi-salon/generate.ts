/** Multi-salon Agenda scenario generator (evaluation only: no database, no network, no model).
 *
 * The Secretária will serve many salons with other names, catalogs, hours, regional styles and wording than our few test
 * salons. This generator instantiates the conversation templates of templates.ts into standard practice scenarios (the
 * runner's format, with a scenario-level `salon`: catalog subset, team and weekly windows) so pass rates can be measured
 * per salon type, name group, style and template, and compared between a DEV split and a HOLDOUT split that differ in:
 * - salon TYPE: dev = barbearia + salão de beleza; holdout = esmalteria + sobrancelha e cílios + estética e spa;
 * - names, surnames, nicknames, honorifics, reasons, command verbs, style markers and frames: every pool is split in two by
 *   a seeded hash rank (SPLIT_SEED, never by hand); template phrasings by phraseSides, so no holdout phrasing is
 *   masked-identical (names, days, clocks, punctuation and word order neutralized) to a dev one; near ones (masked Jaccard
 *   >= 0.8) are counted in the manifest and seal (phraseSplit) and measured by the --gap similarity strata;
 * - holdout names already seen in the base fixture, the dev batteries or the example bank are left out (`exclude`); holdout
 *   services a dev catalog or the example bank already shows are tagged service-seen (the rest service-unseen).
 * Every name the owner says must find exactly its entity by the runtime's substring search, unless the template is about
 * that ambiguity (homonyms, nicknames, a shared service word): an instance where a search would ask a question no step
 * scripts is regenerated, so a failure is the Secretária's and not the generator's.
 * Every instance is deterministic in (seed, template, type, instance, attempt); an attempt the planner cannot satisfy, or
 * whose scenario fails the static battery audit or the noise invariant, moves to the next attempt seed.
 * v3 (Candidate 4, M0 + F5): DEV hour profiles (night studio, day and night, lunch break, a morning-only main professional),
 * the typing style `twelve` ("às 3" for 15h), an oracle for every clock written without its half of the day derived from
 * the SAME fixture hours (one open reading: booked without a question; two: the half of the day must be asked, with scripted
 * replies; anything else is rendered unambiguously, never graded as "A or a question"), the T06 conflict replies
 * (override_requested, destination_mode) with the CONFLICT_ANSWERS_INCOMPLETE audit, a DEV split without any name the
 * example bank, the dev batteries or the base fixture shows, and a rotated HOLDOUT: people from the holdout half of the
 * names-v3 cohort only, and none of the v2 holdout phrasings (retired: phrase-sides-v2.json).
 * v4 (Track H, external holdout phrasings): `--holdout-phrases <file outside every checkout>` replaces every HOLDOUT-side
 * phrasing by the ones an isolated author wrote against the machine-readable contract (holdout-phrases.ts; the DEV side and
 * every DEV instance are unchanged); the holdout's names avoid every repository name corpus (repoNameCorpora).
 * CLI: scripts/generate-multi-salon.cjs (see `main`). Runtime code must never import this folder. */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { AUDIT_DAYS, auditBattery } from '../agenda-practice-battery';
import { BASE_FIXTURE, answerInstances, hash32, mulberry32, validateScenarios, type AgendaScenario, type DaySpec, type FinalOracle, type ScenarioAppointment, type Step } from '../agenda-practice-lib';
import { foldNoise, foldedSpans, noisePreflight } from '../agenda-practice-noise';
import { isInside, sealedRepoRoots } from '../agenda-sealed';
import { devBatteryScenarios, exampleBankCorpus, foldWords, jaccard, maskedTokens, nameTokens, scenarioNames } from '../agenda-practice-stats';
// v4 (a module cycle by design: each side reads the other's exports inside functions only, never while loading)
import { loadHoldoutPhrases, writePhrasesContract } from './holdout-phrases';
import { applyStyle, type Position, type StyleChoice, type StyleFrame, type StyleGroup, type Styles, type Turn } from './style';
import { BLOCK_REASONS, DAYPART_ANSWERS, REASONS, TEMPLATES, VERB_POOLS, type Mode, type Planner, type Template, type Variant } from './templates';

/** v2: runtime-lookup-consistent oracles (nickname, nested service names, select strings), protected correction spans,
 * T04 service question, phrasing identity split; salon catalogs without cross-split service vocabulary.
 * v3: see the header (every instance changes: the version seeds the instance generator, so v2 results never pair). */
export const GENERATOR_VERSION = 'multi-salon-generator-v3';
export const SPLIT_SEED = 'multi-salon-split-v1';
export const DEFAULT_DEV_SEED = 'multi-salon-dev-v1';
export const POOL_DIR = 'packages/salon-secretary/evaluation/multi-salon';
export const DEV_FILE = `${POOL_DIR}/generated-dev.json`;
export const DEV_MANIFEST = `${POOL_DIR}/generated-dev.manifest.json`;
/** v3 name cohort (new names only) and the v2 phrase sides (text hashes), both read by loadPools. */
export const COHORT_FILE = 'names-v3.json', PHRASE_SIDES_FILE = 'phrase-sides-v2.json';
export const SPLIT_TYPES = { dev: ['barbearia', 'salao-de-beleza', 'estudio-noturno', 'trancas-e-afro'], holdout: ['esmalteria', 'sobrancelha-e-cilios', 'estetica-spa'] } as const;
export type Split = keyof typeof SPLIT_TYPES;
const TYPE_LETTER: Record<string, string> = { barbearia: 'B', 'salao-de-beleza': 'S', 'estudio-noturno': 'N', 'trancas-e-afro': 'T', esmalteria: 'E', 'sobrancelha-e-cilios': 'C', 'estetica-spa': 'P' };
/** Splits whose typing mode may use the `twelve` clock style. DEV only in v3: the rotated holdout of the next proof turns it
 * on (with the new hour profiles for its types) at the freeze, as a pre-registered change. */
export const TWELVE_STYLE_SPLITS: readonly Split[] = ['dev'];
const ID_PREFIX: Record<Split, string> = { dev: 'MD', holdout: 'MH' };
/** Run days every instance must pass the static audit on (one week of run days plus month/year/leap boundaries). */
export const GENERATOR_AUDIT_DAYS = [...AUDIT_DAYS];
const NOISE_DAYS = ['2026-09-28', '2026-10-31', '2027-02-26'];
const MAX_ATTEMPTS = 80;

// ---------------------------------------------------------------- pools
type PoolPerson = { name: string; tags: string[]; variants?: string[]; relatesTo?: string[] };
type Nick = { nickname: string; formal: string[]; tags: string[] };
type Surname = { name: string; particle?: string; tags: string[]; relatesTo?: string[] };
type Names = Record<'female' | 'male' | 'unisex' | 'compound' | 'foreignOrigin' | 'wordNames', PoolPerson[]> & { nicknames: Nick[]; surnames: Surname[]; honorifics: { text: string; tags: string[] }[] };
type CatalogService = { key: string; name: string; durationMin: number; priceCents: number; specialties: string[]; aliases: string[]; tags?: string[] };
type Role = { id: string; label: string; specialties: string[] };
type HoursDay = { weekdays: number[]; openMinutes: number; closeMinutes: number; breaks?: { fromMinutes: number; toMinutes: number }[] };
/** `professionalWindow` (v3): the scenario's main professional (p1) works only this part of each open day. `daypartWeight`
 * (v3): how much likelier a clock is when its half of the day could be left unsaid (1-7h, and 13-19h in the twelve style). */
export type HoursProfile = { id: string; label: string; days: HoursDay[]; professionalWindow?: { fromMinutes: number; toMinutes: number }; daypartWeight?: number };
export type SalonType = { id: string; label: string; services: CatalogService[]; professionals: { min: number; max: number; typical: number; roles: Role[] }; hours: HoursProfile[] };
export type Pools = { names: Names; cohort: Names; styles: Styles; salons: { types: SalonType[] }; sha256: Record<string, string> };
const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function loadPools(root: string = process.cwd()): Pools {
  const read = (f: string) => readFileSync(join(root, POOL_DIR, f), 'utf8');
  const files = { names: read('names.json'), cohort: read(COHORT_FILE), styles: read('styles.json'), salons: read('salon-types.json'), sides: read(PHRASE_SIDES_FILE) };
  return { names: JSON.parse(files.names), cohort: JSON.parse(files.cohort), styles: JSON.parse(files.styles), salons: JSON.parse(files.salons),
    sha256: { 'names.json': sha256(files.names), [COHORT_FILE]: sha256(files.cohort), 'styles.json': sha256(files.styles), 'salon-types.json': sha256(files.salons),
      [PHRASE_SIDES_FILE]: sha256(files.sides) } };
}
/** The v2 phrase sides (sha256 of a variant text → side); a missing or malformed record fails closed. */
function phraseSidesV2(): Record<string, Split> {
  const file = join(process.cwd(), POOL_DIR, PHRASE_SIDES_FILE);
  if (!existsSync(file)) throw Error('MULTI_SALON_PHRASE_SIDES_MISSING');
  const sides = (JSON.parse(readFileSync(file, 'utf8')) as { sides?: Record<string, string> }).sides;
  if (!sides || typeof sides !== 'object' || Object.values(sides).some(s => s !== 'dev' && s !== 'holdout')) throw Error('MULTI_SALON_PHRASE_SIDES_INVALID');
  return sides as Record<string, Split>;
}
/** sha256 of the generator sources (templates, style layer, generator, v4 phrase contract): part of every manifest and seal. */
export function sourcesSha256(root: string = process.cwd()) {
  return sha256(['templates.ts', 'style.ts', 'generate.ts', 'holdout-phrases.ts'].map(f => readFileSync(join(root, POOL_DIR, f), 'utf8').replace(/\r\n/g, '\n')).join('\u0000'));
}

const fold = (s: string) => foldNoise(s).trim();
/** Seeded hash rank, alternating: dev takes ranks 0, 2, 4...; holdout 1, 3, 5... Balanced, deterministic, never by hand. */
export function splitSide<T>(items: readonly T[], kind: string, key: (x: T) => string, side: Split): T[] {
  return items.map(x => ({ x, k: fold(key(x)), h: hash32(`${SPLIT_SEED}|${kind}|${fold(key(x))}`) })).sort((a, b) => a.h - b.h || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .filter((_, i) => (i % 2 === 0) === (side === 'dev')).map(r => r.x);
}
const PERSON_GROUPS = ['female', 'male', 'unisex', 'compound', 'foreignOrigin', 'wordNames'] as const;
type Group = (typeof PERSON_GROUPS)[number];
/** Folded tokens of every names.json person (and variant), surname and nickname, both halves: the v2 corpus a v3 holdout never draws. */
export const namesJsonTokens = (p: Pools) => new Set([...PERSON_GROUPS.flatMap(g => (p.names[g] ?? []).flatMap(e => [e.name, ...(e.variants ?? [])])),
  ...(p.names.surnames ?? []).map(s => s.name), ...(p.names.nicknames ?? []).map(n => n.nickname)].flatMap(foldWords));
type Entry = PoolPerson & { group: Group; gender: 'f' | 'm' | 'u' };
const genderOf = (tags: string[]): 'f' | 'm' | 'u' => tags.includes('f') ? 'f' : tags.includes('m') ? 'm' : 'u';
const variantText = (v: Variant) => typeof v === 'string' ? v : v.t;
const variantMode = (v: Variant): Mode | null => typeof v === 'string' ? null : v.mode ?? null;
export type SidePools = ReturnType<typeof sidePools>;
/** Everything one split may draw from. `exclude`: folded name tokens seen elsewhere. v1 (default: ft-export, example-names):
 * the seeded half of names.json. `v3` (the generator): the v3 cohort is split with its own seeded hash; the dev side is the
 * dev half of names.json plus the dev half of the cohort, the HOLDOUT side is the holdout half of the cohort only (the
 * names.json holdout half was consumed by the V2/V3 holdouts: rotated out). The v3 HOLDOUT side also never draws a person,
 * surname or nickname sharing a folded token with ANY names.json entry (cohort compounds such as "Maria X" reuse names.json
 * words): its disjointness from the repository's name corpus is the generator's own property, whatever the caller excludes.
 * `retire` (a holdout that must be rotated): the retired v2 holdout phrasings are never drawn (sideVariants). `phrases` (v4,
 * holdout only): the external phrase map every message and reply of the split is drawn from instead of templates.ts. */
export function sidePools(p: Pools, side: Split, exclude: ReadonlySet<string> = new Set(), o: { v3?: boolean; retire?: boolean; phrases?: ExternalPhrases } = {}) {
  if (o.phrases && side !== 'holdout') throw Error('MULTI_SALON_ARGUMENT');
  const excluded = o.v3 && side === 'holdout' ? new Set([...exclude, ...namesJsonTokens(p)]) : exclude;
  const fresh = (name: string) => !foldWords(name).some(w => excluded.has(w));
  const fromNames = !o.v3 || side === 'dev', fromCohort = !!o.v3;
  const people = (names: Names, prefix: string): Entry[] => PERSON_GROUPS.flatMap(g => splitSide(names[g] ?? [], `${prefix}person:${g}`, e => e.name, side).filter(e => fresh(e.name))
    .map(e => ({ ...e, group: g, gender: genderOf(e.tags) })));
  const both = <T,>(pick: (names: Names, prefix: string) => T[]) => [...(fromNames ? pick(p.names, '') : []), ...(fromCohort ? pick(p.cohort, 'v3:') : [])];
  const persons: Entry[] = both(people);
  const styles: Styles = { ...p.styles, groups: p.styles.groups.map(g => ({ ...g, markers: splitSide(g.markers, `marker:${g.id}`, m => m.text, side) })),
    frames: splitSide(p.styles.frames, 'frame', f => f.id, side) };
  return { side, persons, surnames: both((names, prefix) => splitSide(names.surnames ?? [], `${prefix}surname`, s => s.name, side).filter(s => fresh(s.name))),
    nicknames: both((names, prefix) => splitSide(names.nicknames ?? [], `${prefix}nickname`, n => n.nickname, side).filter(n => fresh(n.nickname))),
    honorifics: splitSide(p.names.honorifics, 'honorific', h => h.text, side), styles, fullStyles: p.styles,
    verbs: Object.fromEntries(Object.entries(VERB_POOLS).map(([k, list]) => [k, splitSide(list, `verb:${k}`, v => v, side)])) as Record<keyof typeof VERB_POOLS, string[]>,
    reasons: splitSide(REASONS, 'reason', r => r.text, side), blockReasons: splitSide(BLOCK_REASONS, 'block-reason', r => r, side), excluded: excluded.size,
    generation: o.v3 ? 'v3' as const : 'v1' as const, retire: side === 'holdout' && !!o.retire, phrases: o.phrases ?? null };
}
/** v4: HOLDOUT-side phrasings from outside the repository, by slot id (externalSlotIds, EXTRA_SLOTS ids); validated by
 * holdout-phrases.ts (contract, coverage, no repository phrasing) before any generation. */
export type ExternalPhrases = ReadonlyMap<string, readonly Variant[]>;
/** Slot ids of a template's messages and replies, as the external phrase map and its contract name them. */
export const externalSlotIds = (t: Template) => [...t.says.map((_, i) => `${t.id}:say${i}`), ...Object.keys(t.answers ?? {}).map(f => `${t.id}:answer:${f}`)];
/** Slots (`<slot>`) or slot modes (`<slot>:<mode>`) an external phrase map leaves without a phrasing usable in a mode the
 * template allows (the extra reply slots: both modes). Ids only. */
export function phraseCoverageGaps(phrases: ExternalPhrases, templates: readonly Template[] = TEMPLATES) {
  const gaps = (slot: string, modes: readonly Mode[]) => !phrases.has(slot) ? [slot]
    : modes.filter(m => !phrases.get(slot)!.some(v => !variantMode(v) || variantMode(v) === m)).map(m => `${slot}:${m}`);
  return [...templates.flatMap(t => externalSlotIds(t).flatMap(slot => gaps(slot, t.modes))), ...EXTRA_SLOTS.flatMap(x => gaps(x.id, ['typing', 'voice']))];
}
/** Neutral value per placeholder kind, to compare phrasings (never to generate): names, days and clocks mask like real
 * ones (maskedTokens), a service, a reason, a block reason and each command verb are one fixed word, gendered words are
 * feminine, and `⟦...⟧` marks go. */
export const NEUTRAL_NAME = 'Fulana';
const NEUTRAL_NAMES: ReadonlySet<string> = new Set([NEUTRAL_NAME.toLowerCase()]);
const NEUTRAL_ATTR: Record<string, string> = { o: 'a', do: 'da', pro: 'pra', ele: 'ela', dele: 'dela' };
const NEUTRAL_CLOCK: Record<string, string> = { '': '10h', as: 'às 10h', das: 'das 10h', pras: 'pras 10h', hhmm: '10:00' };
export function neutralText(text: string) {
  return text.replace(/[⟦⟧]/g, '').replace(/\{([a-z]+?)\d*h?(?:\.([A-Za-z]+))?\}/g, (_, kind: string, attr = '') => {
    if (kind === 'v') return VERB_POOLS[attr as keyof typeof VERB_POOLS]?.[0] ?? attr;
    if (kind === 'c' || kind === 'p') return NEUTRAL_ATTR[attr] ?? NEUTRAL_NAME;
    if (kind === 's') return 'servico';
    if (kind === 'd') return ['', 'spec'].includes(attr) ? 'terça' : `${attr} terça`;
    if (kind === 'h') return NEUTRAL_CLOCK[attr] ?? '10h';
    return kind === 'motivo' ? 'motivo' : 'compromisso';
  });
}
/** Masked token set of a phrasing: punctuation, case, word order, binding numbers and case-only attributes are gone. */
export const phraseTokens = (v: Variant) => maskedTokens(neutralText(variantText(v)), NEUTRAL_NAMES);
/** A phrasing's identity, its sorted masked token set: "marca a Ana na terça às 10h pra corte com a Bia" and "marca corte
 * pra Ana na terça, às 10h, com a Bia" (or "Pode ser {h1.as}." and "pode ser {h2.as}") are one phrasing. */
export const phraseKey = (v: Variant) => [...phraseTokens(v)].sort().join(' ');
/** Masked Jaccard from which two different phrasings count as near (a pull toward one side; reported when split). */
export const PHRASE_NEAR = 0.8;
type PhraseSplit = { side: Map<string, Split>; tokens: Map<string, ReadonlySet<string>>; slots: { id: string; keys: string[] }[]; pinned: Set<string>; retired: Set<string> };
let PHRASE_SPLIT: PhraseSplit | null = null;
/** Message and answer slots outside the templates (v3): the replies to the half-of-day question. */
export const EXTRA_SLOTS: readonly { id: string; list: readonly Variant[] }[] = [{ id: 'daypart:time', list: DAYPART_ANSWERS }];
const allSlots = (templates: readonly Template[] = TEMPLATES) => [...templates.flatMap(t => [...t.says.map((list, i) => ({ id: `${t.id}:say${i}`, list })),
  ...Object.entries(t.answers ?? {}).map(([f, list]) => ({ id: `${t.id}:${f}`, list }))]), ...EXTRA_SLOTS];
/** One side per phrasing (phraseKey) for ALL templates: a phrasing shared by several templates, reordered or repunctuated
 * never lands on both sides. Message and answer slots are visited in template order; each new phrasing goes, in seeded-hash
 * order, to the side its near phrasings (masked Jaccard >= PHRASE_NEAR) already hold when that keeps the slot within one of
 * balance, else to the lighter side (a tie by hash parity). A repair pass then moves phrasings until every slot keeps one
 * per side. Near phrasings cannot all share a side (single linkage at 0.8 chains most booking phrasings into one group and
 * leaves 14 messages without a holdout phrasing): the ones left across sides are counted by phraseSplitDiagnostics and
 * measured by the similarity strata of the generalization gap (agenda-practice-passk --gap).
 * v3: every phrasing recorded in phrase-sides-v2.json keeps its v2 side (pinned by the sha256 of a variant text; an explicit
 * `side` on a new variant pins it too; two pins disagreeing fail closed). The v2 holdout phrasings are RETIRED: read by the
 * consumed V2/V3 holdouts, they never serve a new holdout, nor does a new phrasing near one of them (it leans to dev). The
 * repair pass only moves unpinned phrasings. */
function phraseSplit(): PhraseSplit {
  if (PHRASE_SPLIT) return PHRASE_SPLIT;
  const h = (k: string) => hash32(`${SPLIT_SEED}|phrase|${k}`), side = new Map<string, Split>(), tokens = new Map<string, ReadonlySet<string>>(), recorded = phraseSidesV2();
  const pinned = new Set<string>(), retiredPins = new Set<string>(), raw = allSlots();
  const slots = raw.map(({ id, list }) => ({ id, keys: [...new Set(list.map(v => { const k = phraseKey(v); tokens.set(k, phraseTokens(v)); return k; }))] }));
  for (const { list } of raw) for (const v of list) {
    const k = phraseKey(v), v2 = recorded[sha256(variantText(v))], explicit = typeof v === 'string' ? undefined : v.side;
    for (const s of [v2, explicit]) if (s) { if (side.has(k) && side.get(k) !== s) throw Error('MULTI_SALON_PHRASE_PIN_CONFLICT'); side.set(k, s); pinned.add(k); }
    if (v2 === 'holdout') retiredPins.add(k);
  }
  const near = (a: string, b: string) => a !== b && jaccard(tokens.get(a)!, tokens.get(b)!) >= PHRASE_NEAR;
  for (const slot of slots) {
    let dev = slot.keys.filter(k => side.get(k) === 'dev').length, held = slot.keys.filter(k => side.get(k) === 'holdout' && !retiredPins.has(k)).length;
    for (const k of slot.keys.filter(x => !side.has(x)).sort((a, b) => h(a) - h(b) || (a < b ? -1 : 1))) {
      let pull = 0; for (const [o, s] of side) if (near(k, o)) pull += s === 'dev' || retiredPins.has(o) ? 1 : -1;
      const pref: Split | null = pull > 0 ? 'dev' : pull < 0 ? 'holdout' : null;
      const s: Split = pref && (pref === 'dev' ? dev - held : held - dev) < 1 ? pref : dev < held ? 'dev' : held < dev ? 'holdout' : h(`tie|${k}`) % 2 ? 'holdout' : 'dev';
      side.set(k, s); if (s === 'dev') dev++; else held++;
    }
  }
  const missing = () => slots.flatMap(slot => (['dev', 'holdout'] as const).filter(s => !slot.keys.some(k => side.get(k) === s)).map(s => ({ slot, s })));
  const uses = (k: string) => slots.filter(slot => slot.keys.includes(k)).length;
  for (let gaps = missing(); gaps.length;) {
    const { slot, s } = gaps[0], other: Split = s === 'dev' ? 'holdout' : 'dev';
    const moved = slot.keys.filter(k => side.get(k) === other && !pinned.has(k)).sort((a, b) => uses(a) - uses(b) || h(a) - h(b)).find(k => {
      side.set(k, s); if (missing().length < gaps.length) return true; side.set(k, other); return false;
    });
    if (!moved) throw Error(`MULTI_SALON_PHRASE_SPLIT:${slot.id}`);
    gaps = missing();
  }
  const retired = new Set([...retiredPins, ...[...side.keys()].filter(k => side.get(k) === 'holdout' && [...retiredPins].some(r => near(k, r)))]);
  return (PHRASE_SPLIT = { side, tokens, slots, pinned, retired });
}
export const phraseSides = (): Map<string, Split> => phraseSplit().side;
/** Phrasings a rotated holdout never uses (v2 holdout phrasings and the new ones near them). */
export const retiredPhrasings = (): ReadonlySet<string> => phraseSplit().retired;
/** How far the holdout phrasings are from the dev ones (counts only): identical is 0 by construction. `fresh`: holdout
 * phrasings a rotated holdout may use (not retired). */
export function phraseSplitDiagnostics() {
  const { side, tokens, retired, pinned } = phraseSplit(), keys = [...side.keys()], dev = keys.filter(k => side.get(k) === 'dev'), held = keys.filter(k => side.get(k) === 'holdout');
  const best = held.map(k => Math.max(0, ...dev.map(d => jaccard(tokens.get(k)!, tokens.get(d)!))));
  return { phrasings: keys.length, dev: dev.length, holdout: held.length, nearThreshold: PHRASE_NEAR, holdoutIdenticalToDev: best.filter(x => x >= 1).length,
    holdoutNearDev: best.filter(x => x >= PHRASE_NEAR).length, pinned: pinned.size, retired: retired.size, fresh: held.filter(k => !retired.has(k)).length };
}
/** Templates (and extra slots) a rotated holdout cannot instantiate yet: some message or answer slot has no fresh (not
 * retired) holdout phrasing in any mode the template allows. Ids only. */
export function holdoutRotationGaps(templates: readonly Template[] = TEMPLATES) {
  const fresh = (list: readonly Variant[], mode?: Mode) => sideVariants(null, '', list, 'holdout', mode, true).length > 0;
  return [...templates.filter(t => !t.modes.some(m => [...t.says, ...Object.values(t.answers ?? {})].every(list => fresh(list, m)))).map(t => t.id),
    ...EXTRA_SLOTS.filter(x => !fresh(x.list)).map(x => x.id)];
}
const PUNCTUATION = /[.,;:!?…()"“”]+/g;
/** The marks of a text gone, placeholders kept ("{c1.o}" holds a dot). */
const unmarked = (text: string) => text.split(/(\{[^{}]*\})/).map(part => part.startsWith('{') ? part : part.replace(PUNCTUATION, ' ')).join('');
/** Template checks (codes): `⟦...⟧` spans are balanced, non-empty and only in typing-only variants (dictation drops every
 * mark); and no two variants of one message read the same once the punctuation noise or dictation may drop (all of a
 * voice-capable variant's, the unprotected of a typing-only one) is gone while binding other values in that reading
 * ("pras {h2}, não pras {h3}" = h2 and "pras {h3}... não, pras {h2}" = h2 both read "pras _ não pras _"). */
export function templateIssues(t: Template): string[] {
  const out = new Set<string>();
  const slots = [...t.says.map((list, i) => [`say${i}`, list] as const), ...Object.entries(t.answers ?? {}).map(([f, list]) => [`answer:${f}`, list] as const)];
  for (const [slot, list] of slots) {
    const readings = new Map<string, string>();
    for (const v of list) {
      const text = variantText(v), typing = variantMode(v) === 'typing';
      if (/[⟦⟧]/.test(text.replace(/⟦[^⟦⟧]+⟧/g, ''))) out.add(`${t.id}:${slot}:PROTECTED_SPAN`);
      if (/⟦/.test(text) && !typing) out.add(`${t.id}:${slot}:PROTECTED_SPAN_NOT_TYPING`);
      const bare = typing ? text.split(/(⟦[^⟦⟧]*⟧)/).map(part => part.startsWith('⟦') ? part : unmarked(part)).join('') : unmarked(text.replace(/[⟦⟧]/g, ''));
      const order = new Map<string, string>(), counts: Record<string, number> = {};
      const reading = fold(bare).replace(/\{([a-z]+?)(\d+h?)?((?:\.[a-z]+)?)\}/g, (_, kind: string, n: string | undefined, attr: string) => {
        if (!n) return `{${kind}${attr}}`;
        if (!order.has(kind + n)) { counts[kind] = (counts[kind] ?? 0) + 1; order.set(kind + n, `${kind}#${counts[kind]}`); }
        return `{${order.get(kind + n)}${attr}}`;
      }).replace(/\s+/g, ' ').trim();
      const bound = [...order.keys()].join(','), seen = readings.get(reading);
      if (seen === undefined) readings.set(reading, bound); else if (seen !== bound) out.add(`${t.id}:${slot}:VARIANT_CONFLICT`);
    }
  }
  return [...out];
}
/** Variants of one template message for a split (and a mode); `retire`: without the retired holdout phrasings. */
export function sideVariants(_t: Template | null, _slot: string, variants: readonly Variant[], side: Split, mode?: Mode, retire = false) {
  const { side: sides, retired } = phraseSplit();
  return variants.filter(v => (sides.get(phraseKey(v)) ?? (hash32(`${SPLIT_SEED}|phrase|${phraseKey(v)}`) % 2 ? 'holdout' : 'dev')) === side)
    .filter(v => !(retire && side === 'holdout' && retired.has(phraseKey(v))))
    .filter(v => !mode || !variantMode(v) || variantMode(v) === mode);
}
/** Folded name tokens already present in the base fixture, the dev batteries or the few-shot example bank. */
export function seenNameTokens(root: string = process.cwd()) {
  return nameTokens([...BASE_FIXTURE.customers.map(c => c.name), ...BASE_FIXTURE.professionals.map(p => p.name), ...devBatteryScenarios(root).flatMap(scenarioNames),
    ...exampleBankCorpus(root).names]);
}

// ---------------------------------------------------------------- instance model
type Person = { first: string; surname: string; particle: string | null; full: string; gender: 'f' | 'm'; mention: string; group: Group; tags: string[]; relatesTo: string[] };
type Staff = Person & { key: string; role: Role };
type DayBind = { spec: DaySpec; key: string; weekdays: number[] };
type Bind = { kind: 'person'; person: Person; key: string } | { kind: 'service'; svc: CatalogService; mention: string } | { kind: 'day'; day: DayBind } | { kind: 'time'; minutes: number }
  | { kind: 'reason'; text: string; core: string } | { kind: 'block-reason'; text: string };
type Booking = { pro: string; day: string; from: number; to: number };
type Window = { weekday: number; from: number; to: number };
class PlanFail extends Error {}
const fail = (code: string): never => { throw new PlanFail(code); };
const WD_SPEC = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WD_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WD_FOLDED = WD.map(fold);
const COLLISION_TAGS = new Set(['near-temporal', 'temporal', 'weekday-like', 'number-like', 'service-like', 'word', 'vocative-like', 'assistant-name']);
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'em', 'e', 'na', 'no', 'pra', 'para']);
const DATE_FORMS: Record<Mode, string[]> = { typing: ['weekday', 'weekdayfull', 'dia', 'ddmm', 'dm', 'weekday-dia', 'weekday-ddmm'], voice: ['weekday', 'weekdayfull', 'dia-dw', 'weekday-dia-dw'] };
const TIME_STYLES: Record<Mode, string[]> = { typing: ['h', 'colon', 'horas', 'bare'], voice: ['words'] };
/** v3 typing style: an afternoon clock (13-19h) written as its bare 12-hour hour ("às 3", "pras 5h30"), as owners type it. */
export const TWELVE_STYLE = 'twelve';
const TYPING_REGISTERS = ['formal', 'informal', 'whatsapp', 'emoji', 'greetings'], VOICE_REGISTERS = ['audio', 'informal', 'formal'];
const GROUP_LABEL: Record<Group, string> = { female: 'name-female', male: 'name-male', unisex: 'name-unisex', compound: 'name-compound', foreignOrigin: 'name-foreign', wordNames: 'name-word' };
const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const lowerFirst = (s: string) => s ? s[0].toLocaleLowerCase('pt-BR') + s.slice(1) : s;
const capFirst = (s: string) => s ? s[0].toLocaleUpperCase('pt-BR') + s.slice(1) : s;
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function windowsOf(days: readonly HoursDay[]): Window[] {
  const out: Window[] = [];
  for (const d of days) for (const w of d.weekdays) {
    let start = d.openMinutes;
    for (const b of d.breaks ?? []) { out.push({ weekday: w, from: start, to: b.fromMinutes }); start = b.toMinutes; }
    out.push({ weekday: w, from: start, to: d.closeMinutes });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.from - b.from);
}
/** Spoken clock (dictation): 10:30 "dez e meia", 15:00 "três da tarde", 19:00 "sete da noite". `half` (v3): a morning or
 * early clock also says its part of the day ("duas da madrugada", "sete da manhã"). */
export function spokenClock(minutes: number, half = false) {
  const F = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze'];
  const h = Math.floor(minutes / 60), m = minutes % 60, tail = m === 0 ? '' : m === 30 ? ' e meia' : m === 15 ? ' e quinze' : ' e quarenta e cinco';
  if (h < 12 && half) return `${F[h]}${tail} da ${h < 6 ? 'madrugada' : 'manhã'}`;
  if (h < 12) return `${F[h]}${m === 0 ? (h === 1 ? ' hora' : ' horas') : tail}`;
  if (h === 12) return `meio-dia${tail}`;
  return `${F[h - 12]}${tail} da ${h < 19 ? 'tarde' : 'noite'}`;
}
/** The two readings of a clock written without its half of the day, as the runtime reads it (an hour 1-7 as said, or the
 * `twelve` style's 1-7 for 13-19h): [early, late]; null when the written clock is unambiguous. */
export function writtenReadings(minutes: number, mode: Mode, timeStyle: string): [number, number] | null {
  const h = Math.floor(minutes / 60);
  if (h >= 1 && h <= 7) return [minutes, minutes + 720];
  return mode === 'typing' && timeStyle === TWELVE_STYLE && h >= 13 && h <= 19 ? [minutes - 720, minutes] : null;
}
/** How a clock binding is written and graded (v3): `exact` (unambiguous as written), `single` (written without its half of
 * the day; the tenant hours leave one reading: booked without a question), `ask` (both readings open and free: the half of
 * the day must be asked, scripted replies give it unambiguously), `plain` (any other ambiguity: written unambiguously, so no
 * scenario is ever graded as "A or a question"). */
export type DaypartDecision = 'exact' | 'single' | 'ask' | 'plain';

type Choice = { mode: Mode; dateForm: string; timeStyle: string; pras: string; relative: boolean; verbs: Record<string, string>; style: StyleChoice };
export type ScenarioMeta = { id: string; template: string; type: string; split: Split; attempt: number; mode: Mode; hours: string; dateForm: string; timeStyle: string; relative: boolean;
  region: string | null; register: string | null; frame: string | null; markers: number; styleDropped: number; styleViolations: string[]; nameGroup: string | null; professionals: number; services: number; customers: number;
  /** v3: `<binding>:<decision>` of every clock the texts wrote without its half of the day, and the main professional's window */
  daypart: string[]; proWindow: boolean; tags: string[] };

function build(t: Template, type: SalonType, sp: SidePools, id: string, rand: () => number, seenServices?: ReadonlySet<string>) {
  const pick = <T,>(xs: readonly T[]): T => xs.length ? xs[Math.floor(rand() * xs.length)] : fail('EMPTY_POOL');
  const shuffle = <T,>(xs: readonly T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const weighted = <T,>(xs: readonly { x: T; w: number }[]): T => { const total = xs.reduce((n, x) => n + x.w, 0); if (!total) fail('EMPTY_CHOICE'); let r = rand() * total; for (const x of xs) { r -= x.w; if (r < 0) return x.x; } return xs[xs.length - 1].x; };

  // ---- salon: hours, catalog, staff roles
  const hours = pick(type.hours), windows = windowsOf(hours.days), open = [...new Set(windows.map(w => w.weekday))].sort((a, b) => a - b);
  // v3: a main professional who works only part of each open day (morning-only): the salon windows clipped to it.
  const pw = hours.professionalWindow, clipped = pw ? windows.map(w => ({ ...w, from: Math.max(w.from, pw.fromMinutes), to: Math.min(w.to, pw.toMinutes) })).filter(w => w.from < w.to) : null;
  if (clipped && [...new Set(clipped.map(w => w.weekday))].length !== open.length) fail('PRO_WINDOW');
  const catalog = type.services, performs = (r: Role, s: CatalogService) => s.specialties.some(x => r.specialties.includes(x));
  const serviceWords = new Set(catalog.flatMap(s => words(s.name)).filter(w => w.length >= 4 && !STOP.has(w)));
  const collides = (name: string) => words(name).some(w => [...serviceWords].some(sw => w === sw || (w.length >= 3 && sw.startsWith(w)) || (sw.length >= 4 && w.startsWith(sw))));
  const used = new Set<string>(), surnamesUsed: string[] = [];
  const free = (name: string) => words(name).every(w => STOP.has(w) || !used.has(w));
  const take = (name: string) => { for (const w of words(name)) if (!STOP.has(w)) used.add(w); };
  const general = sp.persons.filter(e => e.group !== 'wordNames' && !e.relatesTo?.length && !e.tags.some(x => COLLISION_TAGS.has(x)));
  const GROUP_WEIGHT: Partial<Record<Group, number>> = { female: 3, male: 3, compound: 1.5, foreignOrigin: 1.5, unisex: 0.6 };
  const surnamePool = sp.surnames.filter(s => !s.relatesTo?.length && !s.tags.some(x => ['temporal', 'service-like'].includes(x)));
  const drawSurname = () => {
    for (let i = 0; i < 60; i++) {
      const s = pick(surnamePool), f = fold(s.name);
      if (!free(s.name) || collides(s.name) || surnamesUsed.some(u => u.includes(f) || f.includes(u))) continue;
      surnamesUsed.push(f); return { surname: s.name, particle: s.particle && rand() < 0.4 ? s.particle : null };
    }
    return fail('SURNAME');
  };
  const person = (e: Entry, gender?: 'f' | 'm', surname?: { surname: string; particle: string | null }): Person => {
    const sn = surname ?? drawSurname(), g = e.gender === 'u' ? gender ?? (rand() < 0.5 ? 'f' : 'm') : e.gender;
    const full = `${e.name} ${sn.particle ? sn.particle + ' ' : ''}${sn.surname}`;
    take(full);
    return { first: e.name, surname: sn.surname, particle: sn.particle, full, gender: g, mention: e.name, group: e.group, tags: e.tags, relatesTo: e.relatesTo ?? [] };
  };
  const drawGeneral = (gender?: 'f' | 'm', pool: Entry[] = general): Person => {
    const candidates = pool.filter(x => !gender || x.gender === gender || x.gender === 'u');
    const groups = [...new Set(candidates.map(e => e.group))].map(g => ({ x: g, w: GROUP_WEIGHT[g] ?? 1 }));
    for (let i = 0; i < 80; i++) {
      const g = weighted(groups), e = pick(candidates.filter(x => x.group === g));
      if (!free(e.name) || collides(e.name)) continue;
      return person(e, gender);
    }
    return fail('PERSON');
  };

  // ---- special customer first (its words steer the staff and the days)
  let c1: Person | null = null; const special = t.special, extraCustomers: Person[] = [];
  const temporalWeekdays = new Set<number>();
  if (special === 'word-temporal' || special === 'word-service' || special === 'word-name') {
    const tags = special === 'word-temporal' ? ['temporal', 'weekday-like', 'number-like', 'near-temporal'] : special === 'word-service' ? ['service-like'] : [];
    const pool = sp.persons.filter(e => special === 'word-name' ? e.group === 'wordNames' && !e.tags.some(x => ['temporal', 'weekday-like', 'number-like', 'near-temporal', 'service-like'].includes(x))
      : e.tags.some(x => tags.includes(x)));
    const e = pick(pool); c1 = person(e);
    for (const r of e.relatesTo ?? []) WD_FOLDED.forEach((w, i) => { if (w.startsWith(fold(r).slice(0, 4)) || fold(r).startsWith(w.slice(0, 4))) temporalWeekdays.add(i); });
  } else if (special === 'nickname') {
    const byName = new Map(sp.persons.filter(e => ['female', 'male', 'compound'].includes(e.group) && !collides(e.name)).map(e => [fold(e.name), e]));
    const nick = pick(sp.nicknames.filter(n => !collides(n.nickname) && n.formal.some(f => byName.has(fold(f)))));
    const formal = shuffle(nick.formal.filter(f => byName.has(fold(f))));
    const e = byName.get(fold(formal[0]))!; c1 = person(e); c1.mention = nick.nickname; take(nick.nickname);
    if (formal.length > 1 && rand() < 0.5) extraCustomers.push(person(byName.get(fold(formal[1]))!)); // another person the nickname may stand for
  } else if (special === 'honorific') {
    c1 = drawGeneral();
    const h = pick(sp.honorifics.filter(x => x.tags.includes(c1!.gender)));
    c1.mention = `${h.text} ${c1.first}`;
  }

  // ---- staff: count, roles, and the constraints of the template
  const lo = Math.max(type.professionals.min, t.pros + (special === 'pro-homonym' ? 1 : 0)), hi = Math.max(lo, Math.min(type.professionals.max, 6));
  const n = lo + Math.floor(rand() * (hi - lo + 1)), roles = type.professionals.roles;
  const staffRoles: Role[] = Array.from({ length: n }, () => pick(roles));
  const preset: Record<string, { svc: CatalogService; mention?: string }> = {}; const presetExtra: CatalogService[] = [];
  if (special === 'one-eligible') {
    const options = shuffle(catalog).flatMap(s => roles.filter(r => performs(r, s)).map(r => ({ s, r, others: roles.filter(o => !performs(o, s)) })))
      .filter(o => n === 1 || o.others.length);
    const o = pick(options); staffRoles[0] = o.r; for (let i = 1; i < n; i++) staffRoles[i] = pick(o.others); preset.s1 = { svc: o.s };
  } else if (special === 'shared-word') {
    const pairs = catalog.flatMap(a => catalog.filter(b => b.key > a.key && words(a.name)[0] === words(b.name)[0] && words(a.name)[0].length >= 4 &&
      !catalog.some(s => fold(s.name) === words(a.name)[0])).flatMap(b => roles.filter(r => performs(r, a) && performs(r, b)).map(r => ({ a, b, r }))));
    const o = pick(pairs); let [target, other] = rand() < 0.5 ? [o.a, o.b] : [o.b, o.a];
    if (fold(other.name).includes(fold(target.name))) [target, other] = [other, target]; // the answer (the full name) finds the target only
    staffRoles[0] = o.r; preset.s1 = { svc: target, mention: target.name.split(/\s+/)[0].toLocaleLowerCase('pt-BR') }; presetExtra.push(other);
  } else if (special === 'word-service' && c1) {
    const related = catalog.filter(s => c1!.relatesTo.some(r => words(s.name).some(w => w.startsWith(fold(r).slice(0, 4)) || fold(r).startsWith(w.slice(0, 4)))));
    const withRole = related.flatMap(s => roles.filter(r => performs(r, s)).map(r => ({ s, r })));
    if (withRole.length) { const o = pick(withRole); staffRoles[0] = o.r; preset.s1 = { svc: o.s }; }
  }
  if (special === 'pro-homonym') staffRoles[1] = staffRoles[0];
  const staff: Staff[] = [];
  const proPersons: Person[] = [];
  for (let i = 0; i < n; i++) {
    if (special === 'pro-homonym' && i === 1) {
      const p0 = proPersons[0], sn = drawSurname(), full = `${p0.first} ${sn.particle ? sn.particle + ' ' : ''}${sn.surname}`; take(full);
      proPersons.push({ ...p0, surname: sn.surname, particle: sn.particle, full }); continue;
    }
    proPersons.push(drawGeneral());
  }
  proPersons.forEach((p, i) => staff.push({ ...p, key: '', role: staffRoles[i] }));
  const staffBinding: Record<string, Staff> = {};
  for (let i = 1; i <= Math.max(t.pros, 1); i++) staffBinding[`p${i}`] = staff[special === 'pro-homonym' && i >= 2 ? i : i - 1];
  if (special === 'pro-homonym') staffBinding.p1h = staff[1];
  const proServices = (s: Staff) => catalog.filter(x => performs(s.role, x));
  const ownWindows = new Map<Staff, Window[]>(clipped ? [[staffBinding.p1, clipped]] : []), winOf = (p: Staff) => ownWindows.get(p) ?? windows;

  // ---- customers
  const customers: Person[] = [];
  const cBinding: Record<string, Person> = {};
  for (let i = 1; i <= t.customers; i++) { const c = i === 1 && c1 ? c1 : drawGeneral(); customers.push(c); cBinding[`c${i}`] = c; }
  if (special === 'customer-homonym') {
    const c = cBinding.c1, sn = drawSurname(), full = `${c.first} ${sn.particle ? sn.particle + ' ' : ''}${sn.surname}`; take(full);
    const twin: Person = { ...c, surname: sn.surname, particle: sn.particle, full }; customers.push(twin); cBinding.c1h = twin;
  }
  customers.push(...extraCustomers);
  const distractors = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => drawGeneral());
  customers.push(...distractors);

  // ---- choices of the speaker (v4: an external phrase map replaces the split's phrasings; only the mode filters it)
  const ext = sp.phrases, says: readonly (readonly Variant[])[] = ext ? t.says.map((_, i) => ext.get(`${t.id}:say${i}`) ?? []) : t.says;
  const replies: Record<string, readonly Variant[]> = ext ? Object.fromEntries(Object.keys(t.answers ?? {}).map(f => [f, ext.get(`${t.id}:answer:${f}`) ?? []])) : t.answers ?? {};
  const variantsFor = (slot: string, list: readonly Variant[], m?: Mode) => ext ? list.filter(v => !m || !variantMode(v) || variantMode(v) === m) : sideVariants(t, slot, list, sp.side, m, sp.retire);
  const modes = t.modes.filter(m => says.every((v, i) => variantsFor(`say${i}`, v, m).length) &&
    Object.entries(replies).every(([f, v]) => variantsFor(`answer:${f}`, v, m).length));
  const mode: Mode = modes.includes('voice') && (modes.length === 1 || rand() < 0.3) ? 'voice' : modes.includes('typing') ? 'typing' : fail('MODE');
  const dayCount = new Set(JSON.stringify([t.says, t.answers, t.final]).match(/\{d\d/g) ?? []).size;
  const relative = open.length === 7 && dayCount <= 2 && !t.dateForms && rand() < 0.35;
  const twelve = mode === 'typing' && TWELVE_STYLE_SPLITS.includes(sp.side);
  const dateForm = relative ? 'relative' : pick(t.dateForms?.[mode] ?? DATE_FORMS[mode]), timeStyle = twelve ? weighted([...TIME_STYLES.typing.map(x => ({ x, w: 1 })), { x: TWELVE_STYLE, w: 2 }])
    : pick(TIME_STYLES[mode]);
  const regionGroups = sp.styles.groups.filter(g => g.kind === 'region' && g.markers.length), registerGroups = sp.styles.groups.filter(g => g.kind === 'register' && g.markers.length);
  const region = rand() < 0.6 ? pick(regionGroups) : null;
  const registerIds = mode === 'voice' ? VOICE_REGISTERS : TYPING_REGISTERS, registers = registerGroups.filter(g => registerIds.includes(g.id));
  const register = registers.length && rand() < (mode === 'voice' ? 0.8 : 0.75) ? pick(registers) : null;
  const frames = sp.styles.frames.filter(f => mode === 'voice' ? f.register === 'audio' : f.register !== 'audio');
  const frame: StyleFrame | null = frames.length && rand() < (mode === 'voice' ? 0.2 : 0.25) ? pick(frames) : null;
  const choice: Choice = { mode, dateForm, timeStyle, pras: mode === 'typing' && rand() < 0.3 ? 'para as' : 'pras', relative,
    verbs: Object.fromEntries(Object.entries(sp.verbs).map(([k, list]) => [k, pick(list)])), style: { region, register, frame } };

  // ---- planner
  const binds = new Map<string, Bind>(), bookings: Booking[] = [], seeds: { customer: Person; pro: Staff; svc: CatalogService; day: DayBind; minutes: number }[] = [];
  const subset = new Map<string, CatalogService>();
  for (const [name, p] of Object.entries(cBinding)) binds.set(name, { kind: 'person', person: p, key: '' });
  for (const [name, p] of Object.entries(staffBinding)) binds.set(name, { kind: 'person', person: p, key: '' });
  const get = <K extends Bind['kind']>(name: string, kind: K) => { const b = binds.get(name); if (!b || b.kind !== kind) fail(`BINDING:${name}`); return b as Extract<Bind, { kind: K }>; };
  const staffOf = (name: string) => staffBinding[name] ?? fail(`PRO:${name}`);
  const customerOf = (name: string) => cBinding[name] ?? fail(`CUSTOMER:${name}`);
  // A booking fits one window of the professional's own schedule (the salon's, or the main professional's window) on every
  // weekday the day can be; `openAt`: a start inside some window (what a lax reading of the hours would still call open).
  const fitsPro = (pro: Staff, day: DayBind, from: number, to: number) => day.weekdays.every(wd => winOf(pro).some(w => w.weekday === wd && w.from <= from && to <= w.to));
  const openAt = (pro: Staff, day: DayBind, at: number) => day.weekdays.some(wd => winOf(pro).some(w => w.weekday === wd && w.from <= at && at < w.to));
  const inDay = (pro: Staff, day: DayBind, from: number, to: number) => day.weekdays.some(wd => { const ws = winOf(pro).filter(w => w.weekday === wd);
    return ws.length > 0 && Math.min(...ws.map(w => w.from)) <= from && to <= Math.max(...ws.map(w => w.to)); });
  const isFree = (pro: Staff, day: DayBind, from: number, to: number) => !bookings.some(b => b.pro === pro.full && b.day === day.key && b.from < to && from < b.to);
  // v3: how each clock binding was planned (the tenant facts its half-of-day readings are checked against)
  const timeCtx = new Map<string, { day: DayBind; pro: Staff; dur: number }>(), seedAt = new Map<string, { customer: string; pro: string; day: string }[]>();
  const spans: { from: string; to: string; day: DayBind; pro: Staff }[] = [];
  const dayOf = (spec: DaySpec): DayBind => typeof spec === 'number' ? { spec, key: String(spec), weekdays: [0, 1, 2, 3, 4, 5, 6] } : { spec, key: spec, weekdays: [WD_SPEC.indexOf(spec)] };
  const randomDay = (not: string[] = []): DayBind => {
    const notKeys = new Set(not.map(d => get(d, 'day').day.key));
    if (relative) return dayOf(pick([1, 2].filter(o => !notKeys.has(String(o)))));
    return dayOf(pick(open.filter(w => !notKeys.has(WD_SPEC[w]) && !temporalWeekdays.has(w)).map(w => WD_SPEC[w])));
  };
  const slot = (day: DayBind, duration: number, pros: Staff[]) => {
    const options: { x: number; w: number }[] = [];
    // v3: the whole day (the hour profiles open at night and at dawn); never 00:xx nor 12:00-13:59.
    for (let m = 60; m <= 23 * 60 + 45; m += 15) {
      if ((m >= 720 && m < 840) || (mode === 'voice' && m % 60 === 45)) continue;
      if (!pros.every(p => fitsPro(p, day, m, m + duration) && isFree(p, day, m, m + duration))) continue;
      options.push({ x: m, w: (m % 60 === 0 ? 6 : m % 30 === 0 ? 3 : 1) * (writtenReadings(m, mode, timeStyle) ? hours.daypartWeight ?? 1 : 1) });
    }
    return options.length ? weighted(options) : fail('NO_SLOT');
  };
  const addService = (svc: CatalogService) => { subset.set(svc.key, svc); };
  // The runtime finds a service by a case/accent-insensitive substring of its name (scheduling-catalog.ts; several rows
  // ask): a service whose name holds what the owner says for a bound service ("Pé e mão" beside "Pé") never joins the
  // subset, so no unscripted service question appears. The shared word of the ambiguity template is meant to find several.
  const boundTerms = () => [...binds.entries()].flatMap(([name, b]) => b.kind !== 'service' ? []
    : [...(special === 'shared-word' && name === 's1' ? [] : [b.mention]), b.svc.name].map(x => ({ key: b.svc.key, term: fold(x) })));
  const nests = (s: CatalogService) => boundTerms().some(x => x.key !== s.key && fold(s.name).includes(x.term));
  const planner: Planner = {
    service(name, o) {
      const pros = [o.pro, ...(o.with ?? [])].map(staffOf), not = new Set((o.not ?? []).map(x => get(x, 'service').svc.key));
      if (preset[name] && pros.every(p => performs(p.role, preset[name].svc))) {
        const pr = preset[name]; addService(pr.svc); presetExtra.forEach(addService); binds.set(name, { kind: 'service', svc: pr.svc, mention: pr.mention ?? lowerFirst(pr.svc.name) }); return;
      }
      let options = catalog.filter(s => pros.every(p => performs(p.role, s)) && !not.has(s.key) && s.durationMin <= 180 && !nests(s) &&
        ![...subset.values()].some(x => x.key !== s.key && fold(x.name).includes(fold(s.name))));
      if (o.minProServices && proServices(pros[0]).length < o.minProServices) fail('PRO_SERVICES');
      if (!options.length) fail('SERVICE');
      options = shuffle(options);
      const svc = options[0]; addService(svc);
      binds.set(name, { kind: 'service', svc, mention: lowerFirst(svc.name) });
      if (o.minProServices) {
        for (const extra of shuffle(proServices(pros[0]).filter(s => s.key !== svc.key && !nests(s))).slice(0, o.minProServices - 1)) addService(extra);
        if (proServices(pros[0]).filter(s => subset.has(s.key)).length < o.minProServices) fail('PRO_SERVICES');
      }
    },
    same(name, as) { binds.set(name, binds.get(as) ?? fail(`SAME:${as}`)); },
    day(name, o) { binds.set(name, { kind: 'day', day: randomDay(o?.not) }); },
    time(name, o) {
      const day = get(o.day, 'day').day, svc = get(o.service, 'service').svc, pro = staffOf(o.pro), pros = [pro, ...(o.free ?? []).map(staffOf)];
      const m = slot(day, svc.durationMin, pros);
      if (o.book !== false) bookings.push({ pro: pro.full, day: day.key, from: m, to: m + svc.durationMin });
      binds.set(name, { kind: 'time', minutes: m }); timeCtx.set(name, { day, pro, dur: svc.durationMin });
    },
    span(from, to, o) {
      const day = get(o.day, 'day').day, pro = staffOf(o.pro), options: { x: [number, number]; w: number }[] = [];
      for (const len of [60, 90, 120, 180]) for (let m = 60; m + len <= 23 * 60 + 55; m += 30) {
        const end = m + len;
        if ((m >= 720 && m < 840) || (end >= 720 && end < 840) || !fitsPro(pro, day, m, end) || !isFree(pro, day, m, end)) continue;
        options.push({ x: [m, end], w: m % 60 === 0 ? 3 : 1 });
      }
      const [a, b] = options.length ? weighted(options) : fail('NO_SPAN');
      bookings.push({ pro: pro.full, day: day.key, from: a, to: b });
      binds.set(from, { kind: 'time', minutes: a }); binds.set(to, { kind: 'time', minutes: b }); spans.push({ from, to, day, pro });
    },
    seed(customer, pro, service, day, time) {
      const c = customerOf(customer), p = staffOf(pro), svc = get(service, 'service').svc, d = get(day, 'day').day, m = get(time, 'time').minutes;
      if (!performs(p.role, svc) || !fitsPro(p, d, m, m + svc.durationMin) || !isFree(p, d, m, m + svc.durationMin)) fail('SEED');
      bookings.push({ pro: p.full, day: d.key, from: m, to: m + svc.durationMin }); seeds.push({ customer: c, pro: p, svc, day: d, minutes: m });
      seedAt.set(time, [...(seedAt.get(time) ?? []), { customer, pro, day }]);
    },
    book(pro, day, time, service) {
      const p = staffOf(pro), d = get(day, 'day').day, m = get(time, 'time').minutes, svc = get(service, 'service').svc;
      if (!fitsPro(p, d, m, m + svc.durationMin) || !isFree(p, d, m, m + svc.durationMin)) fail('BOOK');
      bookings.push({ pro: p.full, day: d.key, from: m, to: m + svc.durationMin });
    },
    reason(name, of) {
      const c = customerOf(of), r = pick(sp.reasons.filter(x => !collides(x.text.replace(/\{[a-z]+\}/g, ' '))));
      const g = (s: string) => s.replace(/\{ele\}/g, c.gender === 'f' ? 'ela' : 'ele').replace(/\{dele\}/g, c.gender === 'f' ? 'dela' : 'dele');
      binds.set(name, { kind: 'reason', text: g(r.text), core: g(r.core) });
    },
    blockReason(name) { binds.set(name, { kind: 'block-reason', text: pick(sp.blockReasons.filter(x => !collides(x))) }); },
  };
  t.plan(planner);

  // ---- background bookings of other customers (never the template's customers), then the catalog subset
  const primaries = new Set(Object.values(cBinding).map(c => c.full));
  for (const c of distractors.slice(0, 1 + Math.floor(rand() * 3))) {
    for (let tries = 0; tries < 6; tries++) {
      try {
        const p = pick(staff), svc = pick(proServices(p).filter(s => s.durationMin <= 180 && !nests(s))), d = randomDay(), m = slot(d, svc.durationMin, [p]);
        addService(svc); bookings.push({ pro: p.full, day: d.key, from: m, to: m + svc.durationMin }); seeds.push({ customer: c, pro: p, svc, day: d, minutes: m }); break;
      } catch (e) { if (!(e instanceof PlanFail)) throw e; }
    }
  }
  for (const p of staff) if (![...subset.values()].some(s => performs(p.role, s))) addService(pick(proServices(p).filter(s => !nests(s))));
  const target = Math.min(catalog.length, 6 + Math.floor(rand() * 7));
  for (const s of shuffle(catalog)) { if (subset.size >= target) break; if (staff.some(p => performs(p.role, s)) && !nests(s)) addService(s); }
  const subsetList = catalog.filter(s => subset.has(s.key));

  // ---- keys (shuffled: the target is never always the first row)
  const custRows = shuffle(customers).map((c, i) => ({ key: `c${pad2(i + 1)}`, c }));
  const proRows = shuffle(staff).map((p, i) => ({ key: `p${pad2(i + 1)}`, p }));
  const custKey = (c: Person) => custRows.find(r => r.c === c)!.key, proKey = (p: Staff) => proRows.find(r => r.p === p)!.key;

  // ---- v3: the half of the day of every clock binding, from the same tenant facts the fixture seeds (the professional's own
  // windows that day, the bookings of the instance): see DaypartDecision. Say variants are picked first: a question about the
  // half of the day is scripted only for a clock the owner actually says.
  const saySkeletons = says.map((variants, i) => variantText(pick(variantsFor(`say${i}`, variants, mode))));
  const said = new Set(saySkeletons.flatMap(s => [...s.matchAll(/\{(h\d)(?:\.[a-z]+)?\}/g)].map(x => x[1])));
  const finalDest = new Set((t.final.unchanged ? [] : t.final.appointments ?? []).filter(a => !a.status).flatMap(a => /^\{(h\d)\.hhmm\}$/.exec(a.time)?.[1] ?? []));
  const spanOf = new Map(spans.flatMap(s => [[s.from, s], [s.to, s]] as const)), decisions = new Map<string, DaypartDecision>();
  const minutesOf = (name: string) => get(name, 'time').minutes;
  const decide = (name: string): DaypartDecision => {
    const m = minutesOf(name), readings = writtenReadings(m, mode, timeStyle), span = spanOf.get(name);
    if (span) { // a block: exactly one reading of the interval inside the professional's day (lax: first start to last end)
      const a = minutesOf(span.from), b = minutesOf(span.to), ra = writtenReadings(a, mode, timeStyle), rb = writtenReadings(b, mode, timeStyle);
      if (!ra && !rb) return 'exact';
      const valid = (ra ?? [a]).flatMap(x => (rb ?? [b]).filter(y => x < y && inDay(span.pro, span.day, x, y)).map(y => [x, y]));
      return valid.length === 1 && valid[0][0] === a && valid[0][1] === b ? 'single' : 'plain';
    }
    if (!readings) return 'exact';
    const ctx = timeCtx.get(name);
    if (!ctx) return 'plain';
    const other = readings[0] === m ? readings[1] : readings[0], { day, pro, dur } = ctx;
    // Closed even for a lax reading of the hours (no start inside a window): one reading left, never a question.
    if (!openAt(pro, day, other) && !fitsPro(pro, day, other, other + dur)) return 'single';
    // Both readings open and free for a booking the owner asks for: the half of the day must be asked (one per instance,
    // never next to an entity question or another scripted time reply, whose any-of oracle it would weaken).
    const askable = !seedAt.has(name) && finalDest.has(name) && said.has(name) && !t.final.mustAsk && !t.answers?.time && ![...decisions.values()].includes('ask') &&
      fitsPro(pro, day, other, other + dur) && isFree(pro, day, other, other + dur);
    return askable ? 'ask' : 'plain';
  };
  for (const [name, b] of binds) if (b.kind === 'time' && !decisions.has(name)) {
    const d = decide(name), span = spanOf.get(name);
    for (const n of span ? [span.from, span.to] : [name]) decisions.set(n, d);
  }
  const askName = [...decisions].find(([, d]) => d === 'ask')?.[0];
  // A clock the owner says that falls on a booking left untouched in the final state is a calendar conflict (T06): the
  // conflict replies are then required (conflictAnswerIssues), whatever the template's tags say.
  const conflict = [...said].some(h => (seedAt.get(h) ?? []).some(x => (t.final.appointments ?? []).some(a => !a.status && a.customer === `{${x.customer}.nome}` &&
    a.time === `{${h}.hhmm}` && a.professional === `{${x.pro}.nome}` && a.day === `{${x.day}.spec}`)));

  // ---- rendering
  const allNames = [...customers, ...staff].flatMap(p => [p.full, p.mention]);
  const serviceNames = [...binds.values()].flatMap(b => b.kind === 'service' ? [b.svc.name, b.mention] : []);
  const nameWords = new Set(allNames.flatMap(words));
  const dayPhrase = (d: DayBind, attr: string) => {
    if (typeof d.spec === 'number') {
      const core = d.spec === 1 ? 'amanhã' : 'depois de amanhã';
      return attr === 'pra' ? `pra ${core}` : attr === 'de' ? `de ${core}` : core;
    }
    const w = d.weekdays[0], spec = d.spec, masc = w === 0 || w === 6, tok = (f: string) => `{{d:${spec}|${f}}}`, voice = mode === 'voice';
    const cores: Record<string, [string, 'wd' | 'dia' | 'date']> = { weekday: [WD[w], 'wd'], weekdayfull: [WD_FULL[w], 'wd'], dia: [`dia ${tok('d')}`, 'dia'], ddmm: [tok('ddmm'), 'date'],
      dm: [tok('dm'), 'date'], 'weekday-dia': [`${WD[w]}${voice ? '' : ','} dia ${tok('d')}`, 'wd'], 'weekday-ddmm': [`${WD[w]} (${tok('ddmm')})`, 'wd'], 'dia-dw': [`dia ${tok('dw')}`, 'dia'],
      'weekday-dia-dw': [`${WD[w]} dia ${tok('dw')}`, 'wd'] };
    const [core, kind] = cores[dateForm] ?? fail('DATE_FORM');
    if (attr === '') return core;
    if (kind === 'wd') return attr === 'na' ? `${masc ? 'no' : 'na'} ${core}` : attr === 'pra' ? `${masc ? 'pro' : 'pra'} ${core}` : `de ${core}`;
    const prep = attr === 'na' ? 'no' : attr === 'pra' ? 'pro' : 'do';
    return kind === 'dia' ? `${prep} ${core}` : `${prep} dia ${core}`;
  };
  const typed = (m: number, withPrep: boolean, style: string) => {
    const h = Math.floor(m / 60), mm = m % 60 ? pad2(m % 60) : '';
    switch (style) {
      case 'colon': return `${h}:${mm || '00'}`;
      case 'horas': return mm ? `${h}h${mm}` : `${h} horas`;
      case 'bare': return mm ? `${h}h${mm}` : withPrep ? String(h) : `${h}h`;
      case TWELVE_STYLE: { // 13-19h as the bare 12-hour hour ("às 3", "3h30"); 1-7h as said; the rest as usual
        const hh = h >= 13 && h <= 19 ? h - 12 : h;
        return hh !== h || (h >= 1 && h <= 7) ? (mm ? `${hh}h${mm}` : withPrep ? String(hh) : `${hh}h`) : mm ? `${h}h${mm}` : `${h}h`;
      }
      default: return mm ? `${h}h${mm}` : `${h}h`;
    }
  };
  /** `plain`: a clock the owner could not leave ambiguous here, written with its half of the day (24-hour clock for 13-19h,
   * "da madrugada" / "da manhã" for an early hour). */
  const clock = (m: number, withPrep: boolean, plain = false) => {
    if (mode === 'voice') return spokenClock(m, plain && !!writtenReadings(m, mode, timeStyle));
    if (!plain || !writtenReadings(m, mode, timeStyle)) return typed(m, withPrep, timeStyle);
    const h = Math.floor(m / 60);
    return h >= 13 ? typed(m, withPrep, 'h') : `${typed(m, withPrep, timeStyle === TWELVE_STYLE ? 'bare' : timeStyle)} da ${h < 6 ? 'madrugada' : 'manhã'}`;
  };
  /** Names the owner's texts say (bound placeholder and attribute), for the lookup check below. */
  const mentions: { name: string; attr: string; answer: boolean }[] = []; let tracking: 'say' | 'answer' | null = null;
  /** v3: the decision of every clock binding a say or a reply wrote (tags and meta). */
  const writtenClocks = new Map<string, DaypartDecision>();
  const render = (text: string) => text.replace(/\{([a-z][a-z0-9]*)(?:\.([A-Za-z]+))?\}/g, (_, name: string, attr = '') => {
    if (name === 'v') return choice.verbs[attr] ?? fail(`VERB:${attr}`);
    const b = binds.get(name) ?? fail(`UNBOUND:${name}`);
    if (tracking && (b.kind === 'person' || b.kind === 'service')) mentions.push({ name, attr, answer: tracking === 'answer' });
    switch (b.kind) {
      case 'person': {
        const p = b.person, f = p.gender === 'f';
        const values: Record<string, string> = { '': p.mention, nome: p.full, sobrenome: `${p.particle ? p.particle + ' ' : ''}${p.surname}`, o: f ? 'a' : 'o', do: f ? 'da' : 'do',
          pro: f ? 'pra' : 'pro', ele: f ? 'ela' : 'ele', dele: f ? 'dela' : 'dele' };
        return values[attr] ?? fail(`ATTR:${name}.${attr}`);
      }
      case 'service': return attr === '' ? b.mention : attr === 'nome' ? b.svc.name : fail(`ATTR:${name}.${attr}`);
      case 'day': return ['', 'na', 'pra', 'de'].includes(attr) ? dayPhrase(b.day, attr) : fail(`ATTR:${name}.${attr}`);
      case 'time': {
        const d = decisions.get(name) ?? 'exact', plain = d === 'plain' || (d === 'ask' && tracking === 'answer'), m = b.minutes, spoken = clock(m, true, plain);
        if (tracking && d !== 'exact') writtenClocks.set(name, d);
        if (attr === '') return clock(m, false, plain);
        if (attr === 'as') return `${m === 720 ? 'ao' : 'às'} ${spoken}`;
        if (attr === 'das') return `${m === 720 ? 'do' : 'das'} ${spoken}`;
        if (attr === 'pras') return `${choice.pras} ${spoken}`;
        return fail(`ATTR:${name}.${attr}`);
      }
      case 'reason': return attr === '' ? b.text : attr === 'M' ? capFirst(b.text) : attr === 'core' ? b.core : fail(`ATTR:${name}.${attr}`);
      case 'block-reason': return attr === '' ? b.text : fail(`ATTR:${name}.${attr}`);
    }
  });
  const TOKEN = /\{\{[^{}]*\}\}/g;
  const outsideTokens = (text: string, f: (s: string) => string) => { let out = '', last = 0; for (const m of text.matchAll(TOKEN)) { out += f(text.slice(last, m.index!)) + m[0]; last = m.index! + m[0].length; } return out + f(text.slice(last)); };
  const shape = (text: string) => {
    if (mode === 'voice') {
      text = text.replace(/[⟦⟧]/g, ''); // protected spans are typing-only (templateIssues); dictation has no marks to protect
      // dictation has no sentence marks: a capital after one (not a name) is lowered before the marks go
      const lowered = outsideTokens(text, s => s.replace(/([.!?…]\s+)(\p{Lu}\p{L}*)/gu, (m: string, b: string, w: string) => nameWords.has(fold(w)) ? m : b + lowerFirst(w)));
      const flat = outsideTokens(lowered, s => s.replace(/\.\.\.|…/g, ' ').replace(/[,;:!?().]/g, ' ')).replace(/\s+/g, ' ').trim();
      const first = flat.match(/^[\p{L}]+/u)?.[0];
      return first && !nameWords.has(fold(first)) ? lowerFirst(flat) : flat;
    }
    return outsideTokens(text, s => s.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('pt-BR'))).replace(/\s+/g, ' ').trim();
  };
  let markers = 0, dropped = 0; const styleCodes = new Set<string>();
  // `⟦...⟧` (typing only): the span becomes a noNoise region, so its punctuation (a correction vs a contrast) survives noise.
  const protectedSpans: string[] = [];
  const unprotect = (text: string) => { for (const m of text.matchAll(/⟦([^⟦⟧]+)⟧/g)) protectedSpans.push(m[1]); return text.replace(/[⟦⟧]/g, ''); };
  const styled = (skeleton: string, turn: Turn, field?: string) => {
    tracking = turn === 'answer' ? 'answer' : 'say'; const rendered = render(skeleton); tracking = null;
    const text = shape(rendered), reason = /\{b?motivo/.test(skeleton);
    if (turn === 'answer' && (field === 'reason' || reason)) return unprotect(text); // a reason is the owner's literal: never styled
    const positions: Position[] | undefined = reason ? ['start', 'sentence-before'] : undefined;
    const r = applyStyle(text, sp.styles, { turn, choice: choice.style, rand, voice: mode === 'voice', names: [...allNames, ...serviceNames],
      p: turn === 'first' ? 0.8 : turn === 'say' ? 0.55 : 0.3, positions });
    markers += r.markers.length + (r.frame ? 1 : 0); if (r.violations.length) { dropped++; r.violations.forEach(c => styleCodes.add(c)); }
    return unprotect(r.text);
  };
  const sayTexts = saySkeletons.map((skeleton, i) => styled(skeleton, i === 0 ? 'first' : 'say'));
  // v3: the half-of-day question gets its scripted replies (the asked clock, always written unambiguously in a reply).
  const daypartReplies = askName ? variantsFor('daypart:time', ext ? ext.get('daypart:time') ?? [] : DAYPART_ANSWERS, mode).map(v => variantText(v).replace(/\{h9/g, `{${askName}`)) : [];
  if (askName && !daypartReplies.length) fail('DAYPART_ANSWERS');
  const answerSlots: [string, string[]][] = [...Object.entries(replies).map(([field, variants]) => [field, variantsFor(`answer:${field}`, variants, mode).map(variantText)] as [string, string[]]),
    ...(askName ? [['time', daypartReplies] as [string, string[]]] : [])];
  const answers = Object.fromEntries(answerSlots.map(([field, variants]) => [field, variants.map(v => styled(v, 'answer', field))]));

  // ---- lookups as the runtime does them (a case/accent-insensitive substring of the stored name; one row resolves, several
  // or none ask: customer-catalog.ts, scheduling-catalog.ts): every name said finds exactly its own entity, except the
  // ambiguity the template is about. A nickname is graded by what its search finds: none or several must ask, one (this
  // customer) resolves without a question (tag nickname-unique); one OTHER customer is an incoherent instance.
  const ambiguous = special === 'customer-homonym' || special === 'nickname' ? 'c1' : special === 'pro-homonym' ? 'p1' : special === 'shared-word' ? 's1' : null;
  let nickHits: Person[] | null = null;
  for (const m of mentions) {
    const b = binds.get(m.name)!, intended = m.name === ambiguous && m.attr === '';
    if (intended && m.answer) continue; // the reply's full name disambiguates
    let hits: string[], own: string;
    if (b.kind === 'person') {
      if (m.attr !== '' && m.attr !== 'nome') continue;
      const pool: Person[] = m.name.startsWith('p') ? staff : customers, p = b.person;
      const term = fold(m.attr === 'nome' ? p.full : special === 'honorific' && m.name === 'c1' ? p.first : p.mention), found = pool.filter(x => fold(x.full).includes(term));
      if (intended && special === 'nickname') { nickHits = found; continue; }
      hits = found.map(x => x.full); own = p.full;
    } else if (b.kind === 'service') {
      const term = fold(m.attr === 'nome' ? b.svc.name : b.mention);
      hits = subsetList.filter(s => fold(s.name).includes(term)).map(s => s.key); own = b.svc.key;
    } else continue;
    if (intended ? hits.length < 2 || !hits.includes(own) : hits.length !== 1 || hits[0] !== own) fail(`LOOKUP:${b.kind}${intended ? ':AMBIGUITY' : ''}`);
  }
  const nickname = special !== 'nickname' ? null : !nickHits ? fail('NICKNAME_UNSAID') : nickHits.length === 0 ? 'unmatched' : nickHits.length > 1 ? 'ambiguous'
    : nickHits[0].full === cBinding.c1.full ? 'unique' : fail('NICKNAME_OTHER');
  const saidServices = [...new Set(mentions.flatMap(m => { const b = binds.get(m.name); return b?.kind === 'service' ? [b.svc.name] : []; }))];
  const serviceTags = sp.side === 'holdout' && seenServices && saidServices.length ? [saidServices.some(n => seenServices.has(fold(n))) ? 'service-seen' : 'service-unseen'] : [];
  const steps: Step[] = t.steps.filter(s => !('select' in s) || nickname === null || nickname === 'ambiguous').map(s => 'say' in s ? { say: sayTexts[s.say], ...(s.expect ? { expect: s.expect } : {}) }
    : 'select' in s ? { select: render(s.select), ...(s.optional ? { optional: true as const } : {}) } : { confirm: s.confirm, ...(s.expectError ? { expectError: s.expectError } : {}) });

  // ---- oracle from the same bindings
  const value = (tpl: string) => render(tpl);
  const daySpec = (tpl: string) => get(/^\{(d\d)\.spec\}$/.exec(tpl)?.[1] ?? fail('DAY_SPEC'), 'day').day.spec;
  const clockOf = (tpl: string) => hhmm(get(/^\{(h\d)\.hhmm\}$/.exec(tpl)?.[1] ?? fail('CLOCK'), 'time').minutes);
  const templateSeeds = seeds.filter(s => primaries.has(s.customer.full));
  const background = seeds.filter(s => !primaries.has(s.customer.full));
  const mustAsk = [...new Set([...(t.final.mustAsk && nickname !== 'unique' ? t.final.mustAsk : []), ...(askName ? ['time'] : [])])];
  const final: FinalOracle = t.final.unchanged ? { unchanged: true, ...(t.final.noPendingPlan ? { noPendingPlan: true } : {}) } : {
    appointments: [...(t.final.appointments ?? []).map(a => ({ customer: value(a.customer), service: value(a.service), day: daySpec(a.day), time: clockOf(a.time), professional: value(a.professional),
      ...(a.status ? { status: a.status } : {}), ...(a.reason ? { reason: value(a.reason) } : {}) })),
    ...background.map(s => ({ customer: s.customer.full, service: s.svc.name, day: s.day.spec, time: hhmm(s.minutes), professional: s.pro.full }))],
    ...(t.final.blocks ? { blocks: t.final.blocks.map(b => ({ professional: value(b.professional), day: daySpec(b.day), from: clockOf(b.from), to: clockOf(b.to) })) } : {}),
    ...(mustAsk.length ? { mustAsk } : {}), ...(t.final.noPendingPlan ? { noPendingPlan: true } : {}) };
  if (t.final.unchanged && templateSeeds.length + background.length === 0 && t.ops.includes('read')) fail('READ_WITHOUT_ROWS');

  const appointments: ScenarioAppointment[] = shuffle(seeds).map((s, i) => ({ key: `a${i + 1}`, customer: custKey(s.customer), professional: proKey(s.pro), service: s.svc.key,
    day: s.day.spec, time: hhmm(s.minutes) }));
  const c1Group = cBinding.c1?.group ?? null;
  const capability = [...new Set([...t.ops, ...t.tags, 'multi-salon', `salon-${type.id}`, `mode-${mode}`, `hours-${hours.id}`, ...(c1Group ? [GROUP_LABEL[c1Group]] : []),
    `date-${dateForm}`, `time-${timeStyle}`, region ? `style-${region.id}` : 'style-none', register ? `register-${register.id}` : 'register-none', ...(frame ? ['frame'] : []),
    ...(nickname ? [`nickname-${nickname}`] : []), ...serviceTags, ...(conflict ? ['conflict'] : []), ...(clipped ? ['pro-window'] : []),
    ...[...writtenClocks.values()].map(d => `daypart-${d}`)])];
  const scenario: AgendaScenario = { id, title: `multi-salon ${t.id}: ${t.title} (${type.label})`, capability,
    salon: { type: type.id, services: subsetList.map(s => ({ key: s.key, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents })),
      hours: windows.map(w => ({ weekday: w.weekday, from: hhmm(w.from), to: hhmm(w.to) })) },
    professionals: proRows.map(({ key, p }) => ({ key, name: p.full, services: subsetList.filter(s => performs(p.role, s)).map(s => s.key),
      ...(ownWindows.has(p) ? { hours: ownWindows.get(p)!.map(w => ({ weekday: w.weekday, from: hhmm(w.from), to: hhmm(w.to) })) } : {}) })),
    customers: custRows.map(({ key, c }) => ({ key, name: c.full })),
    ...(appointments.length ? { appointments } : {}),
    steps, ...(Object.keys(answers).length ? { answers } : {}), ...(protectedSpans.length ? { noNoise: [...new Set(protectedSpans)] } : {}), final };
  const unresolved = JSON.stringify(scenario).replace(/\{\{d:[^{}|]+\|[a-z]+\}\}/g, '').match(/\{[^{}"]+\}/);
  if (unresolved) fail('UNRESOLVED');
  const meta = { mode, hours: hours.id, dateForm, timeStyle, relative, region: region?.id ?? null, register: register?.id ?? null, frame: frame?.id ?? null, markers, styleDropped: dropped, styleViolations: [...styleCodes].sort(),
    nameGroup: c1Group ? GROUP_LABEL[c1Group] : null, professionals: staff.length, services: subsetList.length, customers: customers.length,
    daypart: [...writtenClocks].map(([n, d]) => `${n}:${d}`).sort(), proWindow: !!clipped };
  return { scenario, meta };
}

/** Static checks every instance must pass: structure, the battery audit on every audit run day, and the noise
 * invariant for every attempt level the runner can use (light, heavy, mixed; K up to 8) on several run days. */
export function instanceIssues(s: AgendaScenario, verbose = false) {
  const audit = auditBattery([s], { days: GENERATOR_AUDIT_DAYS, requireFinal: true, verbose });
  const noise = NOISE_DAYS.flatMap(today => (['light', 'heavy', 'mixed'] as const).flatMap(profile => noisePreflight([s], { profile, repeat: 8, today }).violations
    .map(v => `NOISE:${profile}:${v.source}:${v.codes.join('+')}`)));
  return [...audit.issues, ...noise, ...lookupIssues(s), ...mustAskAnswerIssues(s), ...conflictAnswerIssues(s)];
}
/** v3 (F5): every field a transcript oracle accepts as the question (`mustAsk`, any of) has scripted replies, so a legitimate
 * question never stalls the attempt; 'selection' is answered by clicking (a select step or an entity reply). Codes only. */
export function mustAskAnswerIssues(s: AgendaScenario): string[] {
  const answered = new Set(Object.keys(s.answers ?? {})), asked = s.final?.mustAsk ?? [];
  const missing = asked.filter(f => f !== 'selection' && !answered.has(f));
  const selectionOnly = asked.length > 0 && asked.every(f => f === 'selection') && !s.steps.some(step => 'select' in step || 'choose' in step);
  return missing.length || selectionOnly ? [`${s.id}:MUST_ASK_UNANSWERED`] : [];
}
/** The replies a calendar-conflict scenario needs: the Secretária may ask the time, or first "encaixo ou outro horário?"
 * (override_requested; a hard block asks destination_mode directly), with the free slots. */
export const CONFLICT_ANSWER_FIELDS = ['time', 'override_requested', 'destination_mode'] as const;
/** v3 (F5): CONFLICT_ANSWERS_INCOMPLETE when a scenario tagged 'conflict' (the generator tags every instance whose said
 * clock falls on a booking the final state keeps) does not script replies for, and accept as the question, each of
 * CONFLICT_ANSWER_FIELDS. 'selection' is never widened to slot alternatives. Codes only. */
export function conflictAnswerIssues(s: AgendaScenario): string[] {
  if (!s.capability.includes('conflict') || s.final?.unchanged) return [];
  const answered = Object.keys(s.answers ?? {}), asked = s.final?.mustAsk ?? [];
  return CONFLICT_ANSWER_FIELDS.every(f => answered.includes(f) && asked.includes(f)) ? [] : [`${s.id}:CONFLICT_ANSWERS_INCOMPLETE`];
}
/** Names the runner and the runtime cannot resolve as the oracle assumes (codes only; read from the scenario alone): a
 * select string must be contained in exactly one customer, professional or service name (the runner clicks the one option
 * whose label contains it); and a service name a text says (the longest one at each place) must be contained in no other
 * service of the salon (the runtime's substring search would ask), unless the scenario expects a service question for
 * what the owner says (answers always resolve). */
export function lookupIssues(s: AgendaScenario): string[] {
  const out = new Set<string>(), services = (s.salon?.services ?? []).map(x => x.name);
  const names = [...(s.customers ?? []).map(c => c.name), ...(s.professionals ?? []).map(p => p.name), ...services];
  for (const step of s.steps) if ('select' in step && names.filter(n => n.toLowerCase().includes(step.select.toLowerCase())).length !== 1) out.add(`${s.id}:SELECT_AMBIGUOUS`);
  const asksService = !!s.final?.mustAsk?.includes('service_ref');
  const texts = [...s.steps.flatMap(step => 'say' in step ? [{ text: step.say, answer: false }] : []),
    ...Object.values(s.answers ?? {}).flatMap(spec => answerInstances(spec).flat().map(text => ({ text, answer: true })))];
  for (const { text, answer } of texts) {
    const said = services.flatMap(n => foldedSpans(text, [n]).map(([a, b]) => ({ n, a, b })));
    for (const x of said) {
      if (said.some(y => y !== x && y.a <= x.a && x.b <= y.b && y.b - y.a > x.b - x.a)) continue; // part of a longer name said there
      if ((answer || !asksService) && services.filter(n => fold(n).includes(fold(x.n))).length > 1) out.add(`${s.id}:SERVICE_LOOKUP_AMBIGUOUS`);
    }
  }
  return [...out];
}
/** Folded names of holdout-type services a dev run or the few-shot bank already shows: the name (or an alias) equals a dev
 * catalog name or alias, a dev name equals one of its aliases, or a bank message says the name. Holdout instances that say
 * one are tagged service-seen (the others service-unseen), so the type gap can be read on unseen vocabulary alone. */
export function seenServiceNames(p: Pools, root: string = process.cwd()) {
  const types = (ids: readonly string[]) => p.salons.types.filter(t => ids.includes(t.id));
  const devNames = new Set(types(SPLIT_TYPES.dev).flatMap(t => t.services.map(s => fold(s.name))));
  // G1: the bank's services are placeholders filled from a generic list (or the salon's own catalog): that list is "seen" too.
  const devTerms = new Set([...devNames, ...types(SPLIT_TYPES.dev).flatMap(t => t.services.flatMap(s => s.aliases.map(fold)))]), corpus = exampleBankCorpus(root), bank = [...corpus.messages, ...corpus.services];
  return new Set(types(SPLIT_TYPES.holdout).flatMap(t => t.services).filter(s => devTerms.has(fold(s.name)) || s.aliases.some(a => devNames.has(fold(a))) ||
    bank.some(m => foldedSpans(m, [s.name]).length > 0)).map(s => fold(s.name)));
}

export type GenerateOptions = { split: Split; seed: string; perType?: number; perTemplate?: number; exclude?: ReadonlySet<string>; templates?: readonly Template[]; pools?: Pools; root?: string;
  /** holdout: folded service names already seen (seenServiceNames), for the service-seen / service-unseen tags */ seenServices?: ReadonlySet<string>;
  /** holdout: 'required' (default) never draws a retired phrasing and refuses to generate while a template has no fresh
   * holdout phrasing (MULTI_SALON_HOLDOUT_NOT_ROTATED); 'waived-for-tests' only for in-memory unit tests of the other holdout
   * properties. `main` never waives it. */ rotation?: 'required' | 'waived-for-tests';
  /** v4, holdout only: the external HOLDOUT-side phrasings (holdout-phrases.ts validates them first); templates.ts then
   * gives the plans, steps and oracles only, and the rotation of its own holdout side is moot. */ phrases?: ExternalPhrases };
/** One split, deterministic in its options: dev = every template x every dev type x perType; holdout = every template
 * perTemplate times, holdout types rotated over a seeded order of the templates. `exclude` (v3: both splits): folded name
 * tokens the split never uses (the CLI passes devExcludedTokens for dev, every repository name corpus for holdout). */
export function generateSplit(o: GenerateOptions) {
  if (o.phrases && o.split !== 'holdout') throw Error('MULTI_SALON_ARGUMENT');
  const retire = o.split === 'holdout' && o.rotation !== 'waived-for-tests';
  const pools = o.pools ?? loadPools(o.root), templates = o.templates ?? TEMPLATES, sp = sidePools(pools, o.split, o.exclude, { v3: true, retire, phrases: o.phrases });
  const ext = o.phrases, effective: readonly Template[] = ext ? templates.map(t => ({ ...t, says: t.says.map((_, i) => [...ext.get(`${t.id}:say${i}`) ?? []]),
    ...(t.answers ? { answers: Object.fromEntries(Object.keys(t.answers).map(f => [f, [...ext.get(`${t.id}:answer:${f}`) ?? []]])) } : {}) })) : templates;
  const invalid = effective.flatMap(templateIssues);
  if (invalid.length) throw Object.assign(Error(ext ? 'MULTI_SALON_PHRASES_CONTRACT' : 'MULTI_SALON_TEMPLATE'), { details: invalid });
  const covered = ext ? phraseCoverageGaps(ext, templates) : [];
  if (covered.length) throw Object.assign(Error('MULTI_SALON_PHRASES_INCOMPLETE'), { details: covered.slice(0, 40) });
  const gaps = retire && !ext ? holdoutRotationGaps(templates) : [];
  if (gaps.length) throw Object.assign(Error('MULTI_SALON_HOLDOUT_NOT_ROTATED'), { details: gaps.slice(0, 8) });
  const types = SPLIT_TYPES[o.split].map(id => pools.salons.types.find(t => t.id === id) ?? fail(`TYPE:${id}`));
  const jobs: { t: Template; type: SalonType; n: number }[] = [];
  if (o.split === 'dev') for (const t of templates) for (const type of types) for (let n = 1; n <= (o.perType ?? 1); n++) jobs.push({ t, type, n });
  else {
    const order = templates.map(t => ({ t, h: hash32(`${o.seed}|order|${t.id}`) })).sort((a, b) => a.h - b.h || a.t.id.localeCompare(b.t.id)).map(x => x.t);
    order.forEach((t, i) => { for (let n = 0; n < Math.min(o.perTemplate ?? 1, types.length); n++) jobs.push({ t, type: types[(i + n) % types.length], n: n + 1 }); });
  }
  const scenarios: AgendaScenario[] = [], meta: ScenarioMeta[] = [];
  for (const { t, type, n } of jobs) {
    const id = `${ID_PREFIX[o.split]}${t.id.slice(1)}${TYPE_LETTER[type.id]}${n}`;
    let done = false; const reasons: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
      const rand = mulberry32(hash32(`${GENERATOR_VERSION}|${o.seed}|${o.split}|${t.id}|${type.id}|${n}|${attempt}`));
      try {
        const built = build(t, type, sp, id, rand, o.split === 'holdout' ? o.seenServices : undefined), issues = instanceIssues(built.scenario, o.split === 'dev');
        if (issues.length) { reasons.push(issues[0]); continue; }
        scenarios.push(built.scenario);
        meta.push({ id, template: t.id, type: type.id, split: o.split, attempt, ...built.meta, tags: built.scenario.capability });
        done = true;
      } catch (e) { if (!(e instanceof PlanFail)) throw e; reasons.push(e.message); }
    }
    if (!done) throw Object.assign(Error(`MULTI_SALON_UNSATISFIABLE:${id}`), { details: [...new Set(reasons)].slice(0, 8) });
  }
  scenarios.sort((a, b) => a.id.localeCompare(b.id)); meta.sort((a, b) => a.id.localeCompare(b.id));
  validateScenarios(scenarios);
  return { scenarios, meta, pools: sp };
}
export const scenarioFileText = (scenarios: readonly AgendaScenario[]) => JSON.stringify(scenarios, null, 2) + '\n';
/** v3: name tokens the DEV split never uses: every person word of the base fixture, the dev batteries and the example bank
 * (its fill list included), so the bank and the hand-written batteries never share a name with the generated DEV split. The
 * CLI records them in the manifest; the committed dev file is regenerated from that record. */
export const devExcludedTokens = (root: string = process.cwd()) => seenNameTokens(root);
/** Person-name tokens of the committed DEV instances (a new holdout never uses them either). */
export function committedDevNameTokens(root: string = process.cwd()) {
  const file = join(root, DEV_FILE);
  return existsSync(file) ? nameTokens((JSON.parse(readFileSync(file, 'utf8')) as AgendaScenario[]).flatMap(scenarioNames)) : new Set<string>();
}
/** v4: person-name tokens of every repository corpus, by corpus: the base fixture, every Agenda practice battery file (the
 * DEV ones and any later one), the Golden 30 fixture, the example bank (fill list, pre-G1 names, literal values), the committed
 * DEV instances, names.json (both halves) and the DEV halves of the name pools. A holdout the CLI writes never draws one. */
export function repoNameCorpora(root: string = process.cwd(), pools: Pools = loadPools(root)): Record<string, ReadonlySet<string>> {
  const dir = join(root, 'packages/salon-secretary/evaluation'), json = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
  const batteries = readdirSync(dir).filter(f => /^agenda-practice-.+\.json$/.test(f)).sort().flatMap(f => { const list = json(f); return Array.isArray(list) ? list as AgendaScenario[] : []; });
  const golden = (json('free-use-golden-30.json') as { fixture?: Partial<Record<'customers' | 'professionals', { name: string }[]>> }).fixture;
  const dev = sidePools(pools, 'dev', new Set(), { v3: true });
  return { 'base-fixture': nameTokens([...BASE_FIXTURE.customers, ...BASE_FIXTURE.professionals].map(p => p.name)), batteries: nameTokens(batteries.flatMap(scenarioNames)),
    'golden-30': nameTokens([...golden?.customers ?? [], ...golden?.professionals ?? []].map(p => p.name)), 'example-bank': nameTokens(exampleBankCorpus(root).names),
    'multi-salon-dev': committedDevNameTokens(root), 'names-json': namesJsonTokens(pools),
    'dev-pools': nameTokens([...dev.persons.flatMap(e => [e.name, ...(e.variants ?? [])]), ...dev.surnames.map(s => s.name), ...dev.nicknames.map(n => n.nickname)]) };
}
/** Person-name tokens a holdout shares with each repository name corpus (all 0 by construction; the CLI fails closed). */
export function holdoutNameOverlap(scenarios: readonly AgendaScenario[], corpora: Readonly<Record<string, ReadonlySet<string>>>) {
  const held = nameTokens(scenarios.flatMap(scenarioNames));
  return Object.fromEntries(Object.entries(corpora).map(([k, s]) => [k, [...held].filter(w => s.has(w)).length]));
}
const histogram =(xs: readonly string[]) => Object.fromEntries(Object.entries(xs.reduce<Record<string, number>>((n, x) => { n[x] = (n[x] ?? 0) + 1; return n; }, {})).sort());

// ---------------------------------------------------------------- CLI (offline; prints codes and counts only)
const VALUE_FLAGS = ['--split', '--seed', '--dev-out', '--holdout-out', '--holdout-seed', '--per-type', '--per-template', '--holdout-phrases', '--phrases-contract-out'],
  BOOLEAN_FLAGS = ['--check'];
function parseArgs(argv: string[]) {
  const args = [...argv], values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift()!;
    if (BOOLEAN_FLAGS.includes(key)) { values[key] = 'true'; continue; }
    if (!VALUE_FLAGS.includes(key) || !args.length || key in values) throw Error('MULTI_SALON_ARGUMENT');
    values[key] = args.shift()!;
  }
  const split = values['--split'] ?? 'dev';
  if (!['dev', 'holdout', 'both'].includes(split)) throw Error('MULTI_SALON_ARGUMENT');
  // v4: the contract is written alone; external phrasings serve a holdout only
  if ('--phrases-contract-out' in values && Object.keys(values).length > 1) throw Error('MULTI_SALON_ARGUMENT');
  if ('--holdout-phrases' in values && split === 'dev') throw Error('MULTI_SALON_ARGUMENT');
  const int = (flag: string, max: number) => { const v = values[flag]; if (v === undefined) return undefined; if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > max) throw Error('MULTI_SALON_ARGUMENT'); return Number(v); };
  return { split, seed: values['--seed'] ?? DEFAULT_DEV_SEED, devOut: values['--dev-out'] ?? DEV_FILE, holdoutOut: values['--holdout-out'], holdoutSeed: values['--holdout-seed'],
    perType: int('--per-type', 3) ?? 1, perTemplate: int('--per-template', 3) ?? 1, check: values['--check'] === 'true', holdoutPhrases: values['--holdout-phrases'],
    contractOut: values['--phrases-contract-out'] };
}
/** --split dev (default): writes generated-dev.json + generated-dev.manifest.json (in the repo).
 * --split holdout --holdout-out <file outside every checkout> [--holdout-seed s]: writes the holdout and `<file>.seal.json`
 *   (seed, sha256, sources) next to it; an existing holdout with other bytes is never overwritten; stdout: sha256 and counts.
 * --check: generates in memory, runs the audit, the noise invariant and the runner's pure preflight; writes nothing.
 * --holdout-phrases <file outside every checkout> (v4; --split holdout|both): the holdout's messages and replies come from that
 *   file, validated before anything is generated (inside-repo refusal before it is read; then contract, coverage, repository
 *   duplicates and example-bank overlap: codes, slot ids and counts only); its sha256 goes to the seal. With --check it is
 *   validated and the holdout generated in memory and preflighted; nothing is written.
 * --phrases-contract-out <file outside every checkout> (alone): writes the machine-readable phrase contract. */
/** `preflight`: the runner's pure preflight, injected by the CLI launcher (this module never loads the runner). */
export type MainDeps = { preflight?: (scenarios: AgendaScenario[]) => Record<string, unknown> };
export async function main(argv: string[], root: string = process.cwd(), deps: MainDeps = {}) {
  const a = parseArgs(argv);
  if (a.contractOut) { console.log(JSON.stringify(writePhrasesContract(a.contractOut, root), null, 2)); return; }
  const pools = loadPools(root), sources = sourcesSha256(root), out: Record<string, unknown>[] = [];
  const phrases = a.holdoutPhrases ? loadHoldoutPhrases(a.holdoutPhrases, { root, pools }) : null;
  const summary = (split: Split, scenarios: AgendaScenario[], meta: ScenarioMeta[]) => ({ split, scenarios: scenarios.length, byType: histogram(meta.map(m => m.type)),
    byTemplate: Object.keys(histogram(meta.map(m => m.template))).length, modes: histogram(meta.map(m => m.mode)), styleMarkers: meta.reduce((n, m) => n + m.markers, 0),
    styleDropped: meta.reduce((n, m) => n + m.styleDropped, 0), callsPerPass: auditBattery(scenarios, { days: ['2026-09-28'] }).callsPerPass });
  const preflight = async (scenarios: AgendaScenario[]) => deps.preflight ? deps.preflight(scenarios) : null;
  if (a.split === 'dev' || a.split === 'both') {
    const devExclude = devExcludedTokens(root);
    const dev = generateSplit({ split: 'dev', seed: a.seed, perType: a.perType, pools, root, exclude: devExclude });
    const text = scenarioFileText(dev.scenarios), sha = sha256(text);
    if (!a.check) {
      const file = resolve(root, a.devOut); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text);
      writeFileSync(resolve(root, a.devOut === DEV_FILE ? DEV_MANIFEST : a.devOut.replace(/\.json$/, '.manifest.json')), JSON.stringify({ generator: GENERATOR_VERSION, split: 'dev',
        seed: a.seed, perType: a.perType, sha256: sha, sources, pools: pools.sha256, splitSeed: SPLIT_SEED, twelveStyleSplits: TWELVE_STYLE_SPLITS, phraseSplit: phraseSplitDiagnostics(),
        devExcludedTokens: [...devExclude].sort(), scenarios: dev.meta }, null, 2) + '\n');
    }
    out.push({ ...summary('dev', dev.scenarios, dev.meta), file: a.check ? null : a.devOut, sha256: sha, ...(a.check ? { preflight: await preflight(dev.scenarios) } : {}) });
  }
  if (a.split === 'holdout' || a.split === 'both') {
    if (!a.holdoutOut && !a.check) throw Error('MULTI_SALON_HOLDOUT_OUT_REQUIRED');
    const file = a.holdoutOut ? resolve(a.holdoutOut) : null, sealFile = file ? file.replace(/\.json$/i, '') + '.seal.json' : null;
    if (file && sealedRepoRoots(root).some(r => isInside(file, r))) throw Error('MULTI_SALON_HOLDOUT_INSIDE_REPO');
    const previous = sealFile && existsSync(sealFile) ? JSON.parse(readFileSync(sealFile, 'utf8')) as { seed?: string } : null;
    const seed = a.holdoutSeed ?? previous?.seed ?? randomBytes(16).toString('hex');
    // v3: rotation is always required here (retired phrasings never drawn; names from the cohort's holdout half, minus every
    // name the repository's corpora or the committed DEV instances show). v4: every repository name corpus (repoNameCorpora)
    // is excluded, and the generated names are checked against each of them again (fail closed).
    const corpora = repoNameCorpora(root, pools), exclude = new Set(Object.values(corpora).flatMap(s => [...s])), seenServices = seenServiceNames(pools, root);
    const held = generateSplit({ split: 'holdout', seed, perTemplate: a.perTemplate, exclude, seenServices, pools, root, rotation: 'required', ...(phrases ? { phrases: phrases.map } : {}) });
    const nameOverlap = holdoutNameOverlap(held.scenarios, corpora), shared = Object.entries(nameOverlap).filter(([, n]) => n > 0);
    if (shared.length) throw Object.assign(Error('MULTI_SALON_HOLDOUT_NAMES_NOT_DISJOINT'), { details: shared.map(([k, n]) => `${k}:${n}`) });
    const text = scenarioFileText(held.scenarios), sha = sha256(text);
    let status = a.check ? 'CHECKED' : 'WRITTEN';
    if (!a.check && file) {
      if (existsSync(file)) { if (sha256(readFileSync(file)) !== sha) throw Error('MULTI_SALON_HOLDOUT_EXISTS'); status = 'UNCHANGED'; }
      else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text, { flag: 'wx' }); }
      writeFileSync(sealFile!, JSON.stringify({ generator: GENERATOR_VERSION, split: 'holdout', file: basename(file), seed, perTemplate: a.perTemplate, sha256: sha, sources, pools: pools.sha256,
        splitSeed: SPLIT_SEED, excludedNameTokens: exclude.size, excludedSha256: sha256([...exclude].sort().join('\n')), seenServiceNames: seenServices.size,
        rotation: { cohort: COHORT_FILE, retiredPhrasings: retiredPhrasings().size, phrases: phrases ? 'external' : 'repository' }, twelveStyleSplits: TWELVE_STYLE_SPLITS,
        phraseSplit: phraseSplitDiagnostics(), holdoutPhrases: phrases ? phrases.record : null,
        nameCorpora: { excluded: Object.fromEntries(Object.entries(corpora).map(([k, s]) => [k, s.size])), overlap: nameOverlap }, ids: held.scenarios.map(s => s.id),
        scenarios: held.meta }, null, 2) + '\n');
    }
    out.push({ ...summary('holdout', held.scenarios, held.meta), status, sha256: sha, excludedNameTokens: exclude.size, nameOverlap: shared.length,
      ...(phrases ? { phrases: phrases.record } : {}), ...(a.check ? { preflight: await preflight(held.scenarios) } : {}) });
  }
  console.log(JSON.stringify({ generator: GENERATOR_VERSION, sources: sources.slice(0, 16), results: out }, null, 2));
}
