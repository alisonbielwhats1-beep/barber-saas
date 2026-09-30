import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_FIXTURE } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { devBatteryScenarios, exampleBankCorpus, foldWords, nameTokens, scenarioNames } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';

// Evaluation-only diversity pools for multi-salon scenario generation (many salons, names, regional styles and
// catalogs). They measure overfitting to our few test salons: no runtime file may read them.
const DIR = 'packages/salon-secretary/evaluation/multi-salon';
const FILES = ['names.json', 'styles.json', 'salon-types.json'];
const load = <T,>(file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as T;

type Person = { name: string; tags: string[]; variants?: string[]; relatesTo?: string[]; meaning?: string };
type Nick = { nickname: string; formal: string[]; tags: string[]; variants?: string[] };
type Surname = { name: string; particle?: string; tags: string[]; variants?: string[]; relatesTo?: string[] };
type Names = { version: number; about: string[]; tagDefinitions: Record<string, string>; female: Person[]; male: Person[]; unisex: Person[]; compound: Person[];
  foreignOrigin: Person[]; wordNames: Person[]; nicknames: Nick[]; surnames: Surname[]; particles: string[]; honorifics: { text: string; tags: string[] }[] };
type Marker = { text: string; positions: string[]; joiner?: string; mark?: string; turns: string[]; tags: string[] };
type Styles = { version: number; about: string[]; positions: Record<string, string>; joiners: Record<string, string>; turns: Record<string, string>; neverInside: string[];
  tagDefinitions: Record<string, string>; groups: { id: string; kind: string; label: string; maxPerMessage: number; markers: Marker[] }[];
  verbs: { imperative: string[]; infinitive: string; subjunctive: string; nounHomograph: boolean }[];
  frames: { id: string; template: string; register: string; mark?: string; turns: string[]; tags: string[] }[]; excluded: { text: string; reason: string; note: string }[] };
type Service = { key: string; name: string; durationMin: number; priceCents: number; specialties: string[]; aliases: string[]; tags?: string[] };
type Day = { weekdays: number[]; openMinutes: number; closeMinutes: number; breaks?: { fromMinutes: number; toMinutes: number }[] };
type SalonType = { id: string; label: string; specialties: { id: string; label: string }[]; services: Service[];
  professionals: { min: number; max: number; typical: number; roles: { id: string; label: string; specialties: string[] }[] }; hours: { id: string; label: string; days: Day[] }[] };
type Salons = { version: number; about: string[]; types: SalonType[] };

const names = load<Names>('names.json'), styles = load<Styles>('styles.json'), salons = load<Salons>('salon-types.json');
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const hasMark = (s: string) => /\p{M}/u.test(s.normalize('NFD'));
const dupes = (xs: string[]) => { const seen = new Set<string>(); return xs.filter(x => { const k = fold(x); if (seen.has(k)) return true; seen.add(k); return false; }); };
/** Every object key and string value with its JSON path. */
const strings = (v: unknown, path = '$'): [string, string][] => typeof v === 'string' ? [[path, v]] : Array.isArray(v) ? v.flatMap((x, i) => strings(x, `${path}[${i}]`))
  : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [[`${path}.${k}#key`, k] as [string, string], ...strings(x, `${path}.${k}`)]) : [];

const PERSON_GROUPS = ['female', 'male', 'unisex', 'compound', 'foreignOrigin', 'wordNames'] as const;
const GROUP_GENDER: Record<string, string | null> = { female: 'f', male: 'm', unisex: 'u', compound: null, foreignOrigin: null, wordNames: null };
const persons = PERSON_GROUPS.flatMap(g => names[g].map(p => ({ ...p, group: g })));
const GENDERS = ['f', 'm', 'u'];
const PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos']);
const NEGATIONS = new Set(['nao', 'n', 'nunca', 'nem', 'jamais', 'num']);
const NUMBER_WORDS = new Set(['zero', 'um', 'uma', 'dois', 'duas', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'catorze',
  'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'meia', 'primeiro', 'primeira']);
const ORDINALS = new Set(['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'setimo', 'oitavo', 'nono', 'decimo']);
const WEEKDAYS = new Set(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']);
const TEMPORAL = new Set([...WEEKDAYS, 'feira', 'dia', 'dias', 'hoje', 'amanha', 'ontem', 'manha', 'tarde', 'noite', 'madrugada', 'semana', 'semanas', 'mes', 'meses', 'ano', 'hora',
  'horas', 'minuto', 'minutos', 'segundo', 'agora', 'cedo', 'depois', 'antes', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
  'novembro', 'dezembro', 'natal', 'pascoa', 'aurora']);
const STOP = new Set(['a', 'o', 'as', 'os', 'e', 'de', 'da', 'do', 'das', 'dos', 'com', 'em', 'na', 'no', 'nas', 'nos', 'para', 'pra', 'por', 'se', 'que', 'eu', 'me']);
const services = salons.types.flatMap(t => t.services);
const SERVICE_WORDS = new Set(services.flatMap(s => [s.name, ...s.aliases]).flatMap(foldWords).filter(w => !STOP.has(w)));
const NAME_TOKENS = new Set([...persons.flatMap(p => [p.name, ...(p.variants ?? [])]), ...names.nicknames.flatMap(n => [n.nickname, ...(n.variants ?? [])]),
  ...names.surnames.flatMap(s => [s.name, ...(s.variants ?? [])])].flatMap(foldWords).filter(w => !STOP.has(w)));
const HONORIFIC_TOKENS = new Set(names.honorifics.flatMap(h => foldWords(h.text)));
/** Function words an accented marker may not become once accents are stripped ('e', 'ne' and 'ai' are the noise generator's own fillers). */
const COLLAPSE = new Set(['o', 'a', 'os', 'as', 'so', 'no', 'na', 'nos', 'nas', 'ha', 'da', 'do', 'ta', 'se', 'mas', 'nao', 'pra', 'pro', 'por', 'de']);
const markers = styles.groups.flatMap(g => g.markers.map(m => ({ ...m, group: g.id })));
const SENTENCE = ['sentence-before', 'sentence-after'], MARKS = ['!', '?', '.', ':'];
const withAccentedE = (text: string) => /(?<!\p{L})é(?!\p{L})/u.test(text.normalize('NFC'));

describe('multi-salon diversity pools (evaluation data)', () => {
  it('parse and hold no digit in any key or string (numbers only as JSON numbers)', () => {
    for (const file of FILES) {
      const data = load<{ version: unknown; about: unknown }>(file);
      expect(data.version, file).toBe(1);
      expect(Array.isArray(data.about) && data.about.length > 0, file).toBe(true);
      expect(strings(data).filter(([, s]) => /\p{N}/u.test(s)).map(([p]) => `${file}:${p}`)).toEqual([]);
      expect(strings(data).filter(([, s]) => s !== s.trim() || !s.length).map(([p]) => `${file}:${p}`)).toEqual([]);
    }
  });

  it('names: counts per group and the requested examples', () => {
    expect(names.female.length).toBeGreaterThanOrEqual(120);
    expect(names.male.length).toBeGreaterThanOrEqual(120);
    expect(names.surnames.length).toBeGreaterThanOrEqual(60);
    expect(names.compound.length).toBeGreaterThanOrEqual(30);
    expect(names.nicknames.length).toBeGreaterThanOrEqual(40);
    expect(names.foreignOrigin.length).toBeGreaterThanOrEqual(30);
    expect(names.wordNames.length).toBeGreaterThanOrEqual(30);
    expect(names.unisex.length).toBeGreaterThanOrEqual(5);
    expect(names.honorifics.length).toBeGreaterThanOrEqual(6);
    const has = (list: { name: string }[], wanted: string[]) => wanted.filter(w => !list.some(x => fold(x.name) === fold(w)));
    expect(has(names.compound, ['Maria Eduarda', 'João Pedro', 'Ana Clara'])).toEqual([]);
    expect(has(names.foreignOrigin, ['Kelly', 'Wellington', 'Maicon', 'Suellen'])).toEqual([]);
    expect(has(names.wordNames, ['Rosa', 'Luz', 'Vitória', 'Graça', 'Glória', 'Paz', 'Flor', 'Domingos', 'Branca', 'Serena', 'Jasmin', 'Mel', 'Neve'])).toEqual([]);
    const nick = (n: string) => names.nicknames.find(x => x.nickname === n)?.formal;
    expect(nick('Duda')).toContain('Maria Eduarda');
    for (const n of ['Guto', 'Fabinho', 'Tati', 'Rô', 'Bia', 'Zé']) expect(nick(n), n).toBeDefined();
    for (const g of ['f', 'm']) expect(names.compound.filter(p => p.tags.includes(g)).length, g).toBeGreaterThanOrEqual(15);
    for (const g of ['f', 'm']) expect(names.foreignOrigin.filter(p => p.tags.includes(g)).length, g).toBeGreaterThanOrEqual(15);
    expect(names.wordNames.filter(p => p.tags.includes('m')).length).toBeGreaterThanOrEqual(8);
  });

  it('names: unique (accent and case folded) across person groups, surnames and nicknames; variants never shadow another entry', () => {
    expect(dupes(persons.map(p => p.name))).toEqual([]);
    expect(dupes(names.surnames.map(s => s.name))).toEqual([]);
    expect(dupes(names.honorifics.map(h => h.text))).toEqual([]);
    const people = new Set(persons.map(p => fold(p.name)));
    expect(dupes(names.nicknames.flatMap(n => [n.nickname, ...(n.variants ?? [])]))).toEqual([]);
    expect(names.nicknames.flatMap(n => [n.nickname, ...(n.variants ?? [])]).filter(n => people.has(fold(n)))).toEqual([]);
    // A spelling variant is another spelling of the same person: never equal to its own name folded, nor to another entry.
    const nicks = new Set(names.nicknames.map(n => fold(n.nickname)));
    const variants = persons.flatMap(p => (p.variants ?? []).map(v => ({ v, own: p.name })));
    expect(variants.filter(({ v, own }) => fold(v) === fold(own) || people.has(fold(v)) || nicks.has(fold(v))).map(x => x.v)).toEqual([]);
    expect(dupes(variants.map(x => x.v))).toEqual([]);
    const surnames = new Set(names.surnames.map(s => fold(s.name)));
    expect(names.surnames.flatMap(s => (s.variants ?? []).filter(v => fold(v) === fold(s.name) || surnames.has(fold(v))))).toEqual([]);
  });

  it('names: shape, gender per group, derived tags (accent, particle, ambiguous), nickname referents and collision words', () => {
    const tags = new Set(Object.keys(names.tagDefinitions)), people = new Map(persons.map(p => [fold(p.name), p]));
    const NAME = /^\p{Lu}[\p{L}'’ -]*\p{L}$/u;
    for (const p of persons) {
      const where = `${p.group}:${p.name}`;
      expect(NAME.test(p.name), where).toBe(true);
      expect(p.tags.filter(t => !tags.has(t)), where).toEqual([]);
      expect(new Set(p.tags).size, where).toBe(p.tags.length);
      expect(p.tags.filter(t => GENDERS.includes(t)), where).toHaveLength(1);
      if (GROUP_GENDER[p.group]) expect(p.tags, where).toContain(GROUP_GENDER[p.group]);
      expect(p.tags.includes('compound'), where).toBe(p.group === 'compound');
      expect(p.name.includes(' '), where).toBe(p.group === 'compound');
      expect(p.tags.includes('accent'), where).toBe(hasMark(p.name));
      expect(p.tags.includes('particle'), where).toBe(p.name.split(' ').some(w => PARTICLES.has(w)));
      for (const v of p.variants ?? []) expect(NAME.test(v), where).toBe(true);
    }
    for (const n of names.nicknames) {
      expect(/^\p{Lu}\p{L}*$/u.test(n.nickname), n.nickname).toBe(true);
      expect(n.tags.filter(t => !tags.has(t)), n.nickname).toEqual([]);
      expect(n.tags.filter(t => GENDERS.includes(t)), n.nickname).toHaveLength(1);
      expect(n.tags, n.nickname).toContain('nickname');
      expect(n.formal.length, n.nickname).toBeGreaterThan(0);
      expect(dupes(n.formal), n.nickname).toEqual([]);
      expect(n.formal.filter(f => !people.has(fold(f))), n.nickname).toEqual([]);
      expect(n.tags.includes('ambiguous'), n.nickname).toBe(n.formal.length > 1);
      expect(n.tags.includes('accent'), n.nickname).toBe(hasMark(n.nickname));
    }
    expect(names.nicknames.filter(n => n.tags.includes('ambiguous')).length).toBeGreaterThanOrEqual(15);
    // Collision words: every tag that claims a collision names it in relatesTo, and the claim is checked.
    const ofKind = (x: { relatesTo?: string[] }, set: Set<string>) => (x.relatesTo ?? []).some(w => set.has(w));
    for (const x of [...persons, ...names.surnames]) {
      const where = x.name, t = x.tags;
      if (['temporal', 'near-temporal', 'weekday-like', 'number-like', 'service-like'].some(k => t.includes(k))) expect(x.relatesTo?.length, where).toBeGreaterThan(0);
      for (const w of x.relatesTo ?? []) expect(/^[a-z]+(?:-[a-z]+)*$/.test(w), where).toBe(true);
      if (t.includes('temporal') || t.includes('near-temporal')) expect(ofKind(x, TEMPORAL), where).toBe(true);
      if (t.includes('weekday-like')) expect(ofKind(x, WEEKDAYS), where).toBe(true);
      if (t.includes('number-like')) expect(ofKind(x, new Set([...NUMBER_WORDS, ...ORDINALS])), where).toBe(true);
      if (t.includes('service-like')) expect(ofKind(x, SERVICE_WORDS), where).toBe(true);
    }
    for (const w of names.wordNames) { expect(w.meaning?.trim(), w.name).toBeTruthy(); expect(w.relatesTo?.length, w.name).toBeGreaterThan(0); }
    for (const tag of ['temporal', 'weekday-like', 'service-like', 'vocative-like', 'color', 'flower']) expect(names.wordNames.some(w => w.tags.includes(tag)), tag).toBe(true);
    expect(names.particles.every(p => PARTICLES.has(p))).toBe(true);
    for (const s of names.surnames) {
      expect(NAME.test(s.name) && !s.name.includes(' '), s.name).toBe(true);
      expect(s.tags.filter(t => !tags.has(t) || GENDERS.includes(t)), s.name).toEqual([]);
      expect(s.tags.includes('accent'), s.name).toBe(hasMark(s.name));
      if (s.particle !== undefined) expect(PARTICLES.has(s.particle), s.name).toBe(true);
    }
    for (const h of names.honorifics) {
      expect(/^\p{Lu}\p{Ll}*\.?$/u.test(h.text), h.text).toBe(true);
      expect(h.tags.filter(t => !tags.has(t)), h.text).toEqual([]);
      expect(h.tags.filter(t => GENDERS.includes(t)), h.text).toHaveLength(1);
    }
  });

  it('names: most first names are unseen by the base fixture, the dev batteries and the example bank (a held pool exists)', () => {
    const seen = nameTokens([...BASE_FIXTURE.customers.map(c => c.name), ...BASE_FIXTURE.professionals.map(p => p.name), ...devBatteryScenarios().flatMap(scenarioNames),
      ...exampleBankCorpus().names]);
    const unseen = (list: Person[]) => list.filter(p => foldWords(p.name).some(w => !seen.has(w)));
    for (const g of ['female', 'male'] as const) {
      expect(unseen(names[g]).length, g).toBeGreaterThanOrEqual(100);
      expect(unseen(names[g]).length / names[g].length, g).toBeGreaterThanOrEqual(0.65);
    }
    const all = PERSON_GROUPS.flatMap(g => names[g]);
    expect(unseen(all).length / all.length).toBeGreaterThanOrEqual(0.7);
  });

  it('styles: required regions and registers, marker fields, vocabularies and uniqueness', () => {
    const ids = styles.groups.map(g => g.id);
    for (const id of ['nordeste', 'mineiro', 'gaucho', 'carioca', 'paulista', 'formal', 'informal', 'whatsapp', 'audio', 'emoji', 'greetings']) expect(ids, id).toContain(id);
    expect(dupes(ids)).toEqual([]);
    const positions = new Set(Object.keys(styles.positions)), turns = new Set(Object.keys(styles.turns)), joiners = new Set(Object.keys(styles.joiners));
    const tags = new Set(Object.keys(styles.tagDefinitions));
    for (const g of styles.groups) {
      expect(['region', 'register'], g.id).toContain(g.kind);
      expect(Number.isInteger(g.maxPerMessage) && g.maxPerMessage >= 1, g.id).toBe(true);
      expect(g.markers.length, g.id).toBeGreaterThanOrEqual(2);
    }
    for (const m of markers) {
      const where = `${m.group}:${m.text}`;
      expect(m.positions.length && m.positions.every(p => positions.has(p)), where).toBe(true);
      expect(m.turns.length && m.turns.every(t => turns.has(t)), where).toBe(true);
      expect(m.tags.filter(t => !tags.has(t)), where).toEqual([]);
      const sentence = m.positions.some(p => SENTENCE.includes(p)), inline = m.positions.some(p => !SENTENCE.includes(p));
      expect(sentence ? MARKS.includes(m.mark ?? '') : m.mark === undefined, where).toBe(true);
      expect(inline ? joiners.has(m.joiner ?? '') : m.joiner === undefined, where).toBe(true);
      expect(m.text === m.text.normalize('NFC') && m.text === m.text.toLowerCase(), where).toBe(true);
    }
    expect(dupes([...markers.map(m => m.text), ...styles.excluded.map(x => x.text)])).toEqual([]);
    expect(styles.neverInside).toEqual(expect.arrayContaining(['entity-name', 'number', 'clock', 'date', 'negation-scope', 'reason-literal', 'protected-region']));
  });

  it('styles: markers keep meaning (no negation, number, name or service word; temporal, assent and lookalike markers restricted)', () => {
    for (const m of markers) {
      const where = `${m.group}:${m.text}`, words = foldWords(m.text);
      expect(words.filter(w => NEGATIONS.has(w)), where).toEqual([]);
      expect(words.filter(w => NUMBER_WORDS.has(w)), where).toEqual([]);
      expect(words.filter(w => NAME_TOKENS.has(w) || HONORIFIC_TOKENS.has(w)), where).toEqual([]);
      expect(words.filter(w => !STOP.has(w) && !TEMPORAL.has(w) && SERVICE_WORDS.has(w)), where).toEqual([]); // temporal words: temporal-lexeme rule below
      // The noise generator strips accents: a marker must not collapse into another function word (sô → so, nó → no, hã → ha).
      expect(m.text.split(/[^\p{L}\p{M}]+/u).filter(w => w && hasMark(w) && COLLAPSE.has(fold(w))), where).toEqual([]);
      const temporal = words.some(w => TEMPORAL.has(w));
      expect(m.tags.includes('temporal-lexeme'), where).toBe(temporal);
      if (temporal) { expect(m.positions, where).toEqual(['sentence-before']); expect(m.turns, where).toEqual(['first']); }
      if (m.tags.includes('assent-like')) expect(m.turns, where).toEqual(['first']);
      // A prefix matcher would read "barbaridade" as "barba": such markers are tagged, and the tag is true.
      const lookalike = words.some(w => w.length >= 4 && [...SERVICE_WORDS].some(s => s.length >= 4 && (w.startsWith(s) || s.startsWith(w))));
      expect(m.tags.includes('lookalike'), where).toBe(lookalike);
      expect(m.tags.includes('neg-sensitive'), where).toBe(withAccentedE(m.text));
    }
    expect(markers.some(m => m.tags.includes('lookalike'))).toBe(true);
  });

  it('styles: excluded expressions, verbs and frames', () => {
    const REASONS = new Set(['NEGATION_LIKE', 'ASSENT_LIKE', 'TEMPORAL_LEXEME', 'CORRECTION_LIKE', 'DISCARD_LIKE', 'UNCERTAINTY', 'ENTITY_LIKE', 'NOUN_REPLACING', 'NAME_COLLISION',
      'PRIORITY_LIKE', 'ACCENT_COLLAPSE']);
    expect(styles.excluded.filter(x => !REASONS.has(x.reason) || !x.note.trim()).map(x => x.text)).toEqual([]);
    for (const r of REASONS) expect(styles.excluded.some(x => x.reason === r), r).toBe(true);
    const people = new Set([...persons.map(p => fold(p.name)), ...names.nicknames.map(n => fold(n.nickname))]);
    expect(styles.excluded.filter(x => x.reason === 'NAME_COLLISION' && !people.has(fold(x.text))).map(x => x.text)).toEqual([]);
    expect(styles.excluded.filter(x => x.reason === 'NEGATION_LIKE').map(x => x.text)).toEqual(expect.arrayContaining(['capaz', 'num', 'pois não']));
    expect(styles.excluded.filter(x => x.reason === 'ACCENT_COLLAPSE' && !x.text.split(/\s+/).some(w => hasMark(w) && COLLAPSE.has(fold(w)))).map(x => x.text)).toEqual([]);
    const imperatives = styles.verbs.flatMap(v => v.imperative);
    expect(dupes(imperatives)).toEqual([]);
    for (const v of styles.verbs) {
      expect(/r$/.test(v.infinitive) && v.imperative.includes(v.subjunctive) && typeof v.nounHomograph === 'boolean', v.infinitive).toBe(true);
      expect(v.imperative.every(i => /^\p{Ll}+$/u.test(i)), v.infinitive).toBe(true);
    }
    for (const verb of ['cancela', 'marca', 'remarca', 'bloqueia', 'fecha', 'desmarca']) expect(imperatives, verb).toContain(verb);
    expect(dupes(styles.frames.map(f => f.id))).toEqual([]);
    const tags = new Set(Object.keys(styles.tagDefinitions)), turns = new Set(Object.keys(styles.turns));
    for (const f of styles.frames) {
      expect((f.template.match(/\{(infinitive|subjunctive)\}/g) ?? []).length, f.id).toBe(1);
      expect(f.template.replace(/\{(infinitive|subjunctive)\}/, '').includes('{'), f.id).toBe(false);
      expect(f.mark === undefined || MARKS.includes(f.mark), f.id).toBe(true);
      expect(f.turns.every(t => turns.has(t)) && f.tags.every(t => tags.has(t)), f.id).toBe(true);
      expect(f.tags.includes('neg-sensitive'), f.id).toBe(withAccentedE(f.template));
      expect(foldWords(f.template).filter(w => NEGATIONS.has(w) || NUMBER_WORDS.has(w) || TEMPORAL.has(w)), f.id).toEqual([]);
    }
    expect(styles.frames.some(f => f.template.startsWith('por gentileza, poderia'))).toBe(true);
  });

  // v3 migration (backup: .demo/agenda-core/contract-migration/multi-salon-pools.test.before-multi-salon-v3.ts): two DEV
  // types (night studio, braids and afro hair) join; the dev/holdout vocabulary rule now covers every dev type.
  it('salon types: seven types, realistic catalogs, roles covering every service, ambiguous aliases and professional counts from one to fifteen', () => {
    expect(salons.types.map(t => t.id)).toEqual(['barbearia', 'salao-de-beleza', 'esmalteria', 'sobrancelha-e-cilios', 'estetica-spa', 'estudio-noturno', 'trancas-e-afro']);
    const SERVICE_TAGS = new Set(['number-word', 'temporal-word', 'english']);
    for (const t of salons.types) {
      const specialties = new Set(t.specialties.map(s => s.id));
      expect(dupes(t.specialties.map(s => s.id)), t.id).toEqual([]);
      expect(t.services.length, t.id).toBeGreaterThanOrEqual(12);
      expect(dupes(t.services.map(s => s.key)), t.id).toEqual([]);
      expect(dupes(t.services.map(s => s.name)), t.id).toEqual([]);
      const serviceNames = new Set(t.services.map(s => fold(s.name)));
      for (const s of t.services) {
        const where = `${t.id}:${s.key}`, words = [s.name, ...s.aliases].flatMap(foldWords);
        expect(/^[a-z][a-z_]*$/.test(s.key), where).toBe(true);
        expect(Number.isInteger(s.durationMin) && s.durationMin % 5 === 0 && s.durationMin >= 5 && s.durationMin <= 480, where).toBe(true);
        expect(Number.isInteger(s.priceCents) && s.priceCents >= 500 && s.priceCents <= 200_000, where).toBe(true);
        expect(s.specialties.length > 0 && s.specialties.every(x => specialties.has(x)), where).toBe(true);
        expect(dupes(s.aliases), where).toEqual([]);
        expect(s.aliases.filter(a => serviceNames.has(fold(a))), where).toEqual([]); // an alias never equals a service name of its catalog
        expect((s.tags ?? []).filter(x => !SERVICE_TAGS.has(x)), where).toEqual([]);
        expect((s.tags ?? []).includes('number-word'), where).toBe(words.some(w => NUMBER_WORDS.has(w)));
        expect((s.tags ?? []).includes('temporal-word'), where).toBe(words.some(w => TEMPORAL.has(w)));
      }
      const aliasUse = new Map<string, number>();
      for (const s of t.services) for (const a of s.aliases) aliasUse.set(fold(a), (aliasUse.get(fold(a)) ?? 0) + 1);
      expect([...aliasUse.values()].some(n => n > 1), `${t.id} has an alias shared by two services`).toBe(true);
      const p = t.professionals;
      expect(Number.isInteger(p.min) && Number.isInteger(p.max) && Number.isInteger(p.typical) && p.min >= 1 && p.min <= p.typical && p.typical <= p.max && p.max <= 15, t.id).toBe(true);
      expect(dupes(p.roles.map(r => r.id)), t.id).toEqual([]);
      for (const r of p.roles) expect(r.specialties.length > 0 && r.specialties.every(x => specialties.has(x)), `${t.id}:${r.id}`).toBe(true);
      for (const s of t.services) expect(p.roles.some(r => r.specialties.some(x => s.specialties.includes(x))), `${t.id}:${s.key} has a professional role`).toBe(true);
      for (const sp of specialties) expect(t.services.some(s => s.specialties.includes(sp)) && p.roles.some(r => r.specialties.includes(sp)), `${t.id}:${sp}`).toBe(true);
    }
    expect(Math.min(...salons.types.map(t => t.professionals.min))).toBe(1);
    expect(Math.max(...salons.types.map(t => t.professionals.max))).toBe(15);
    expect(services.filter(s => s.tags?.includes('number-word')).length).toBeGreaterThan(0);
    expect(services.filter(s => s.tags?.includes('temporal-word')).length).toBeGreaterThan(0);
    // Most catalog names differ from the base fixture services (Corte Completo, Escova, Barba, Coloração).
    const base = new Set(BASE_FIXTURE.services.map(s => fold(s.name)));
    expect(services.filter(s => base.has(fold(s.name))).length / services.length).toBeLessThan(0.1);
  });

  it('salon types: dev and holdout types share no service vocabulary (the type gap is measured on services dev never shows)', () => {
    const DEV = ['barbearia', 'salao-de-beleza', 'estudio-noturno', 'trancas-e-afro'], side = (dev: boolean) => salons.types.filter(t => DEV.includes(t.id) === dev).flatMap(t => t.services);
    const names = (list: Service[]) => list.map(s => fold(s.name)), aliases = (list: Service[]) => list.flatMap(s => s.aliases.map(fold));
    const dev = side(true), held = side(false), phrase = (x: string) => ` ${foldWords(x).join(' ')} `;
    expect(names(held).filter(n => names(dev).includes(n) || aliases(dev).includes(n))).toEqual([]); // "Design de sobrancelha", "Mão" (manicure alias)
    expect(names(dev).filter(n => aliases(held).includes(n))).toEqual([]); // "Manicure", "Hidratação"
    // never a name said inside a name of the other side ("limpeza de pele" inside "limpeza de pele masculina")
    expect(names(held).flatMap(a => names(dev).filter(b => phrase(b).includes(phrase(a)) || phrase(a).includes(phrase(b))).map(b => `${a}|${b}`))).toEqual([]);
  });

  it('salon types: opening-hours variants (Sunday opening in one type, lunch breaks in another)', () => {
    for (const t of salons.types) {
      expect(t.hours.length, t.id).toBeGreaterThanOrEqual(2);
      expect(dupes(t.hours.map(h => h.id)), t.id).toEqual([]);
      for (const h of t.hours) {
        const where = `${t.id}:${h.id}`, weekdays = h.days.flatMap(d => d.weekdays);
        expect(weekdays.length > 0 && new Set(weekdays).size === weekdays.length && weekdays.every(w => Number.isInteger(w) && w >= 0 && w <= 6), where).toBe(true);
        for (const d of h.days) {
          expect(Number.isInteger(d.openMinutes) && Number.isInteger(d.closeMinutes) && d.openMinutes >= 0 && d.openMinutes < d.closeMinutes && d.closeMinutes <= 1440, where).toBe(true);
          expect(d.openMinutes % 5 === 0 && d.closeMinutes % 5 === 0, where).toBe(true);
          let last = d.openMinutes;
          for (const b of d.breaks ?? []) {
            expect(Number.isInteger(b.fromMinutes) && Number.isInteger(b.toMinutes) && b.fromMinutes > last && b.fromMinutes < b.toMinutes && b.toMinutes < d.closeMinutes, where).toBe(true);
            last = b.toMinutes;
          }
        }
      }
    }
    const sunday = salons.types.filter(t => t.hours.some(h => h.days.some(d => d.weekdays.includes(0)))).map(t => t.id);
    const breaks = salons.types.filter(t => t.hours.some(h => h.days.some(d => d.breaks?.length))).map(t => t.id);
    expect(sunday.length).toBeGreaterThan(0);
    expect(breaks.length).toBeGreaterThan(0);
    expect(sunday.some(a => breaks.some(b => a !== b))).toBe(true);
    expect(salons.types.some(t => t.hours.some(h => h.days.length > 1 && new Set(h.days.map(d => `${d.openMinutes}-${d.closeMinutes}`)).size > 1))).toBe(true);
  });

  it('stays evaluation-only: no runtime source references the pools', () => {
    const roots = ['src/lib', 'src/app', 'packages/salon-secretary/src'], offenders: string[] = [];
    for (const root of roots) for (const rel of readdirSync(root, { recursive: true }) as string[]) {
      const file = join(root, rel);
      if (/(^|[\\/])__tests__([\\/]|$)/.test(rel) || !/\.(?:ts|tsx|js|cjs|mjs|json)$/.test(rel)) continue;
      if (readFileSync(file, 'utf8').includes('multi-salon')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
