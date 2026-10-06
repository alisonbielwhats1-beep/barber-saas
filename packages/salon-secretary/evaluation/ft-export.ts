/** Fine-tuning-READY export of the few-shot example bank (evaluation/data only). NO training, NO network, NO model call:
 * the owner keeps a supervised dataset ready in case a trainable model and budget appear.
 *
 * Reads packages/salon-secretary/src/examples/bank.json (read-only) and writes .demo/agenda-core/ft-export/<bank16>.jsonl in
 * OpenAI's chat fine-tuning format with tools, plus <bank16>.manifest.json (counts per category, excluded ids with reasons).
 * Every line is one LIVE request, built by the real runServicesTurn behind an offline fetch stub that answers with the
 * expected arguments and never forwards anything: system = the decision instructions; system = the conversation context
 * with a FICTIONAL salon directory and the example clock; user = the draft; user = the message; assistant = the tool call
 * with the expected turn completed for the strict wire (every published key present, absent = null); tools = the published
 * function schema of that state. The expected output also passes the live parser and the strict decoder.
 *
 * Anti-overfitting (many salons, names and wordings): every person name of an entry is replaced at export time (fixed seed,
 * per entry) by a name of the DEV side of the multi-salon pools, never the holdout side and never a name of the fixtures,
 * dev batteries, Golden 30 or the bank itself; gender, case, accents, honorifics and nickname/formal pairs are preserved.
 * Directories list the named professionals by FULL name plus distractors, with services of DEV salon types only, so a row
 * teaches "copy the name as said" and never a specific name. Any original name left in a row excludes it (NAME_LEAK).
 *
 * Eligibility = failure taxonomy §3: NEW/ANSWER states, complete expected output, no unavailable `requires`, not
 * out-of-scope only (UNSUPPORTED), no near-duplicates (token Jaccard >= 0.6 with the same state, mode and operations;
 * the first in bank order stays), no overlap with the multi-salon evaluation corpora (EVAL_OVERLAP: a holdout-side template
 * phrasing or a committed dev instance, multi-salon/overlap.ts). Availability is read from the live wire under FT_PROFILE, so a feature that ships later
 * (polarity, same_as) enters with a re-export.
 * CLI: npx tsx packages/salon-secretary/evaluation/ft-export.ts [--seed <s>] [--out <dir>] [--check] */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPaidModel, runServicesTurn, withConversationRouting, withSalonDirectory, inConversationRouting, decodeConversationTurn, SecretaryRouteRequest,
  continuationDraft, continuationRequirements, secretaryContractDigest, examplesState, EXAMPLES_HEADER, SECRETARY_CONTRACT_ENV,
  type Model, type SalonDirectory, type SecretaryWireSchema } from '../src';
import { bankExample, exampleRequirements, EXAMPLES_RENDER_VERSION, EXAMPLE_CLOCK_DATE, type BankExample } from '../src/examples/bank';
import { exampleFills, fillExample } from '../src/examples/fill';
import { availableExampleFeatures } from '../src/examples/select';
import { skillRegistry } from '../src/skill-registry';
import { exampleRoutingContext, wireTurn, tokenJaccard, CONTAMINATION_THRESHOLD } from '../src/examples/validate';
import { getOperationRequirements } from '../../../src/lib/service-contract';
import { BASE_FIXTURE, hash32, mulberry32 } from './agenda-practice-lib';
import { foldWords } from './agenda-practice-stats';
import { loadPools, sidePools, seenNameTokens, SPLIT_TYPES, type Pools, type SalonType } from './multi-salon/generate';
import { MULTI_SALON_OVERLAP_THRESHOLD, multiSalonCorpora, overlapNames, overlapScores, prepareCorpora, type OverlapCorpus } from './multi-salon/overlap';
import { VERB_POOLS } from './multi-salon/templates';
import { backendPresentationDigest } from '../../../src/lib/secretary-presentation-contract';

export const FT_EXPORT_VERSION = 'ft-export-v1';
export const FT_EXPORT_SEED = 'ft-export-names-v1';
export const FT_OUT_DIR = '.demo/agenda-core/ft-export';
export const FT_BANK_FILE = 'packages/salon-secretary/src/examples/bank.json';
/** Only names the offline request (the cost guard's allow-list); no model is ever called. */
const FT_MODEL_ID = 'gpt-6-luna';
/** Contract flags of the validated agenda practice arms, examples OFF (a trained model replaces few-shot, and the bank's
 * own names must never reach a row). Every other contract variable is unset while exporting. */
export const FT_PROFILE: Readonly<Record<string, string>> = Object.freeze({ SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true',
  SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true' });
export const NEAR_DUPLICATE_THRESHOLD = CONTAMINATION_THRESHOLD;

// ---------------------------------------------------------------- text helpers
type Gender = 'f' | 'm' | 'u';
type Kind = 'given' | 'nickname' | 'surname';
const WORD = /\p{L}[\p{L}\p{M}]*/gu;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Folded, letter runs collapsed ("biaa" = "bia"): the identity of a name token. */
const keyOf = (w: string) => fold(w).replace(/(\p{L})\1+/gu, '$1');
const hasMark = (s: string) => /\p{M}/u.test(s.normalize('NFD'));
const stripMarks = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
const isUpperInitial = (w: string) => w[0] !== w[0].toLowerCase();
const words = (s: string) => [...s.matchAll(WORD)].map(m => ({ text: m[0], at: m.index!, key: keyOf(m[0]) }));
const PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'du']);
const HONORIFICS = ['dona', 'seu', 'sr', 'sra', 'senhor', 'senhora', 'tia', 'tio', 'dr', 'dra', 'd', 'dom'];
const F_MARK = new Set(['a', 'da', 'na', 'pela', 'dona', 'sra', 'senhora', 'tia', 'dra']), M_MARK = new Set(['o', 'do', 'no', 'pelo', 'ao', 'seu', 'sr', 'senhor', 'tio', 'dr']);
/** Same collision tags as the multi-salon generator: never a replacement (names that are also words, dates, services or
 * vocatives change what a correct secretary must do). Detection skips only the ones that are common words when lowercase. */
const COLLISION_TAGS = new Set(['near-temporal', 'temporal', 'weekday-like', 'number-like', 'service-like', 'word', 'vocative-like', 'assistant-name']);
const SOUNDS_LIKE_ONLY = new Set(['near-temporal', 'weekday-like']);
/** Words that introduce a person in these texts ("da Julia", "com a Keila", "Keila, Rafaela ou Priscila", "remarcar Bruno"):
 * articles, prepositions, honorifics and the multi-salon command verbs (and their infinitives). */
const NAME_LEAD = new Set(['a', 'o', 'as', 'os', 'da', 'do', 'das', 'dos', 'na', 'no', 'nas', 'nos', 'com', 'pra', 'pro', 'para', 'de', 'e', 'ou', 'ao', 'pela', 'pelo', 'que', ...HONORIFICS,
  ...Object.entries(VERB_POOLS).flatMap(([verb, forms]) => [verb, ...forms]).map(verb => verb.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())]);
const CALENDAR = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'feira', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'hoje', 'amanha'];
/** Salon/agenda nouns that may be capitalized after an article ("fecha o Salão") and are never a person. */
const DOMAIN_WORDS = ['salao', 'agenda', 'luna', 'whatsapp', 'zap', 'pix', 'instagram', 'google', 'plano', 'confirmar', 'cliente', 'clientes', 'profissional', 'profissionais',
  'horario', 'horarios', 'servico', 'servicos', 'produto', 'estoque', 'caixa', 'feriado', 'natal', 'pascoa', 'carnaval', 'dia', 'semana', 'mes', 'ano', 'manha', 'tarde',
  'noite', 'hora', 'horas', 'motivo', 'bloqueio', 'cancelamento', 'remarcacao', 'reuniao', 'almoco', 'folga', 'ferias'];
const TIMEZONES = ['America/Sao_Paulo', 'America/Sao_Paulo', 'America/Sao_Paulo', 'America/Recife', 'America/Fortaleza', 'America/Bahia', 'America/Manaus', 'America/Belem', 'America/Cuiaba', 'America/Campo_Grande'];
const PERSON_FIELDS = new Set(['customer_name', 'professional_name', 'customer_ref', 'professional_ref', 'customer', 'professional']);
/** Keys whose strings are structure, never text to rename. */
const STRUCTURE = new Set(['id', 'clock', 'source', 'tags', 'item_key', 'operation', 'requested_field', 'kind', 'mode', 'unavailable_capability', 'requires', 'depends_on', 'released_slot_of', 'field', 'legacy', 'components', 'daypart']);
const capitalize = (s: string) => s.split(' ').map(w => w ? w[0].toLocaleUpperCase('pt-BR') + w.slice(1) : w).join(' ');

// ---------------------------------------------------------------- pools
export type NamePools = {
  given: Record<Gender, string[]>; givenGender: Map<string, Gender>; nicknames: Record<Gender, { name: string; formal: string[] }[]>; surnames: { name: string; particle?: string }[];
  lexicon: { given: Map<string, Gender>; nicknames: Map<string, { gender: Gender; formal: string[] }>; surnames: Set<string>; wordish: Set<string>; honorifics: Set<string> };
  salonTypes: SalonType[]; stop: Set<string>; poolSha256: string;
};
const genderOf = (tags: readonly string[]): Gender => tags.includes('f') ? 'f' : tags.includes('m') ? 'm' : 'u';
const single = (name: string) => !/\s/.test(name.trim());
/** Replacement pools = the DEV side of the multi-salon pools (the generator's own seeded split), minus collision names and
 * `reserved` (fixtures, dev batteries, Golden, bank). The detection lexicon reads every side: it only recognizes names. */
export function namePools(pools: Pools, reserved: ReadonlySet<string>): NamePools {
  const dev = sidePools(pools, 'dev', reserved), taken = new Set([...reserved].map(keyOf));
  // Reserved words are compared by identity too ("Isabella" = "isabela").
  const clean = (tags: readonly string[], name = '') => !tags.some(tag => COLLISION_TAGS.has(tag)) && words(name).every(w => !taken.has(w.key));
  const given: Record<Gender, string[]> = { f: [], m: [], u: [] };
  for (const p of dev.persons) if (['female', 'male', 'unisex', 'foreignOrigin'].includes(p.group) && single(p.name) && clean(p.tags, p.name)) given[p.gender].push(p.name);
  const devGiven = new Map(Object.values(given).flat().map(name => [keyOf(name), name]));
  const givenGender = new Map((Object.entries(given) as [Gender, string[]][]).flatMap(([g, names]) => names.map(name => [keyOf(name), g] as const)));
  const nicknames: NamePools['nicknames'] = { f: [], m: [], u: [] };
  for (const n of dev.nicknames) if (single(n.nickname) && clean(n.tags, n.nickname))
    nicknames[genderOf(n.tags)].push({ name: n.nickname, formal: n.formal.filter(single).map(f => devGiven.get(keyOf(f))).filter((f): f is string => !!f) });
  const surnames = dev.surnames.filter(s => clean(s.tags, s.name)).map(s => ({ name: s.name, ...(s.particle ? { particle: s.particle } : {}) }));
  const lexGiven = new Map<string, Gender>(), lexNick = new Map<string, { gender: Gender; formal: string[] }>(), lexSurname = new Set<string>(), wordish = new Set<string>();
  const addGiven = (name: string, g: Gender) => { for (const w of words(name)) if (!PARTICLES.has(w.key)) lexGiven.set(w.key, lexGiven.has(w.key) && lexGiven.get(w.key) !== g ? 'u' : g); };
  const nameLike = (tags: readonly string[]) => !tags.some(tag => COLLISION_TAGS.has(tag) && !SOUNDS_LIKE_ONLY.has(tag));
  for (const group of ['female', 'male', 'unisex', 'compound', 'foreignOrigin', 'wordNames'] as const) for (const p of pools.names[group]) for (const name of [p.name, ...(p.variants ?? [])]) {
    if (nameLike(p.tags)) addGiven(name, genderOf(p.tags)); else words(name).forEach(w => wordish.add(w.key));
  }
  for (const n of pools.names.nicknames) {
    if (!nameLike(n.tags)) { words(n.nickname).forEach(w => wordish.add(w.key)); continue; }
    if (single(n.nickname)) lexNick.set(keyOf(n.nickname), { gender: genderOf(n.tags), formal: n.formal.flatMap(f => words(f).slice(0, 1).map(w => w.key)) });
  }
  for (const s of pools.names.surnames) for (const name of [s.name, ...((s as { variants?: string[] }).variants ?? [])]) {
    if (nameLike(s.tags)) lexSurname.add(keyOf(name)); else wordish.add(keyOf(name));
  }
  const honorifics = new Set([...HONORIFICS, ...pools.names.honorifics.flatMap(h => words(h.text).map(w => w.key))]);
  const salonTypes = pools.salons.types.filter(t => (SPLIT_TYPES.dev as readonly string[]).includes(t.id));
  const stop = new Set([...CALENDAR, ...DOMAIN_WORDS, ...pools.salons.types.flatMap(t => t.services.flatMap(s => [s.name, ...s.aliases])).flatMap(foldWords), ...BASE_FIXTURE.services.flatMap(s => foldWords(s.name))]
    .map(keyOf).filter(w => !PARTICLES.has(w)));
  return { given, givenGender, nicknames, surnames, lexicon: { given: lexGiven, nicknames: lexNick, surnames: lexSurname, wordish, honorifics }, salonTypes, stop,
    poolSha256: pools.sha256['names.json'] ?? '' };
}
/** The replacement pools without names whose words are in `names` (identity keys); the lexicon is unchanged. */
export function withoutNames(np: NamePools, names: ReadonlySet<string>): NamePools {
  const ok = (name: string) => words(name).every(w => !names.has(w.key));
  const nicks = (list: NamePools['nicknames'][Gender]) => list.filter(n => ok(n.name)).map(n => ({ ...n, formal: n.formal.filter(ok) }));
  return { ...np, given: { f: np.given.f.filter(ok), m: np.given.m.filter(ok), u: np.given.u.filter(ok) },
    nicknames: { f: nicks(np.nicknames.f), m: nicks(np.nicknames.m), u: nicks(np.nicknames.u) }, surnames: np.surnames.filter(s => ok(s.name)) };
}
/** Person-name words of the Golden 30 fixture (never used as a replacement). */
export function goldenNameTokens(root = process.cwd()) {
  const golden = JSON.parse(readFileSync(join(root, 'packages/salon-secretary/evaluation/free-use-golden-30.json'), 'utf8')) as { fixture?: { customers?: { name: string }[]; professionals?: { name: string }[] } };
  return new Set([...(golden.fixture?.customers ?? []), ...(golden.fixture?.professionals ?? [])].flatMap(p => foldWords(p.name)).filter(w => !PARTICLES.has(w)));
}

// ---------------------------------------------------------------- name detection and renaming
/** Bank-wide terms: first words of every person value (so a lowercase mention elsewhere is recognized) and service words. */
export type BankTerms = { given: Set<string>; services: Set<string> };
export function bankTerms(examples: readonly BankExample[]): BankTerms {
  const given = new Set<string>(), services = new Set<string>();
  for (const e of examples) for (const op of e.expected.operations) {
    for (const said of [op.customer_name, op.professional_name]) if (said) for (const s of [said.value, said.literal]) {
      const first = words(s).find(w => !HONORIFICS.includes(w.key) && !PARTICLES.has(w.key)); if (first) given.add(first.key);
    }
    if (op.service_name) for (const w of words(op.service_name.value)) services.add(w.key);
    if (op.target_name && !op.operation.startsWith('customer.')) for (const w of words(op.target_name.value)) services.add(w.key);
  }
  return { given, services };
}
type Mention = { key: string; kind: Kind; votes: { f: number; m: number }; lex?: Gender };
const stateTexts = (e: BankExample) => { const s = e.state; return [...('question' in s ? [s.question] : []), ...('questions' in s ? s.questions.map(q => q.question) : []),
  ...('actions' in s ? s.actions.map(a => a.summary) : []), ...('candidates' in s ? s.candidates ?? [] : [])]; };
/** Every free text an entry shows (message, questions, options, summaries, reply, values): where names are looked for. */
function exampleTexts(e: BankExample) {
  const out = [e.message, ...stateTexts(e), ...(e.expected.response ? [e.expected.response] : [])];
  for (const op of e.expected.operations) {
    if (op.source_scope) out.push(op.source_scope);
    for (const said of [op.customer_name, op.professional_name, op.reason, op.selection, ...(op.operation.startsWith('customer.') ? [op.target_name] : [])]) if (said) out.push(String(said.value), said.literal);
    for (const item of op.excluded ?? []) out.push(item.value, item.literal);
  }
  return out;
}
const personLabel = (label: string, stop: ReadonlySet<string>) => {
  const head = label.split(/\s[—–-]\s/)[0].trim();
  return /^\p{Lu}[\p{L}\p{M}]*(?:\s+(?:d[aeo]s?\s+)?\p{Lu}[\p{L}\p{M}]*)*$/u.test(head) && !stop.has(keyOf(head.split(/\s+/)[0])) ? head : undefined;
};
/** Names of one entry: person values and person options (sure), capitalized words inside a sentence that are not service,
 * calendar or honorific words, and lowercase words that are names of the lexicon or of another bank value. */
export function detectNames(e: BankExample, np: NamePools, bank: BankTerms): Map<string, Mention> {
  const out = new Map<string, Mention>(), lex = np.lexicon, stop = new Set([...np.stop, ...bank.services, ...DOMAIN_WORDS]);
  const kindOf = (key: string): Kind => lex.nicknames.has(key) && !lex.given.has(key) || /(?:inh[oa]|zinh[oa])$/.test(key) ? 'nickname' : 'given';
  const add = (key: string, kind: Kind) => { if (!out.has(key)) out.set(key, { key, kind, votes: { f: 0, m: 0 }, lex: lex.given.get(key) ?? lex.nicknames.get(key)?.gender }); };
  const person = (text: string) => {
    const ws = words(text).filter(w => !lex.honorifics.has(w.key) && !PARTICLES.has(w.key));
    ws.forEach((w, i) => add(w.key, i === 0 ? kindOf(w.key) : lex.given.has(w.key) && !lex.surnames.has(w.key) || lex.nicknames.has(w.key) ? kindOf(w.key) : 'surname'));
  };
  for (const op of e.expected.operations) {
    for (const said of [op.customer_name, op.professional_name, ...(op.operation.startsWith('customer.') ? [op.target_name] : [])]) if (said) { person(String(said.value)); person(said.literal); }
    for (const item of op.excluded ?? []) if (/customer|professional/.test(item.field)) person(item.value);
  }
  const s = e.state;
  if ('candidates' in s && s.candidates) for (const label of s.candidates) {
    const field = 'requested_field' in s ? s.requested_field : '';
    const head = PERSON_FIELDS.has(field) ? label.split(/\s[—–-]\s/)[0] : field === 'selection' ? personLabel(label, stop) : undefined;
    if (head) person(head);
  }
  const texts = exampleTexts(e);
  for (const text of texts) for (const w of words(text)) {
    if (out.has(w.key) || lex.honorifics.has(w.key) || PARTICLES.has(w.key) || stop.has(w.key)) continue;
    if (w.key.endsWith('s') && out.has(w.key.slice(0, -1))) continue; // "duas Anas"
    const before = text.slice(0, w.at).replace(/[\s"'“”(]+$/u, ''), previous = words(before).at(-1), adjacent = !!previous && before.endsWith(previous.text);
    const inside = before.length > 0 && !/[.!?:;—–\n•]$/u.test(before);
    if (isUpperInitial(w.text) && inside && (before.endsWith(',') || adjacent && (NAME_LEAD.has(previous!.key) || out.has(previous!.key)))) {
      add(w.key, adjacent && out.has(previous!.key) && out.get(previous!.key)!.kind !== 'surname' && !lex.given.has(w.key) ? 'surname' : kindOf(w.key));
    } else if ((w.key.length >= 3 || bank.given.has(w.key) || lex.nicknames.has(w.key)) && !lex.wordish.has(w.key) && (lex.given.has(w.key) || lex.nicknames.has(w.key) || bank.given.has(w.key)))
      add(w.key, kindOf(w.key));
  }
  for (const text of texts) { const ws = words(text); ws.forEach((w, i) => { const m = out.get(w.key); if (!m || m.kind === 'surname' || !i) return;
    if (F_MARK.has(ws[i - 1].key)) m.votes.f++; else if (M_MARK.has(ws[i - 1].key)) m.votes.m++; }); }
  return out;
}
const genderFor = (m: Mention): Gender => m.votes.f > m.votes.m ? 'f' : m.votes.m > m.votes.f ? 'm' : m.lex ?? 'u';
export type Replacement = { canonical: string; kind: Kind; gender: Gender; formal?: string };
function shuffled<T>(items: readonly T[], rng: () => number) { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
/** One replacement per detected name, distinct, never a word the entry already holds; a nickname and the formal name it
 * abbreviates in the same entry ("rafa" / "Rafaela") become a pool nickname and one of its formal names. */
export function nameMapping(e: BankExample, mentions: ReadonlyMap<string, Mention>, np: NamePools, rng: () => number): Map<string, Replacement> | { error: string } {
  const forbidden = new Set([...exampleTexts(e), JSON.stringify(e)].flatMap(t => words(t).map(w => w.key))), out = new Map<string, Replacement>();
  const free = (name: string) => words(name).every(w => !forbidden.has(w.key));
  const fits = (formal: string, gender: Gender) => { const g = np.givenGender.get(keyOf(formal)) ?? 'u'; return gender === 'u' || g === 'u' || g === gender; };
  const take = (canonical: string, kind: Kind, gender: Gender, key: string, formal?: string) => { out.set(key, { canonical, kind, gender, ...(formal ? { formal } : {}) }); for (const w of words(canonical)) forbidden.add(w.key); };
  const keys = [...mentions.keys()].sort();
  for (const n of keys) {
    const nick = mentions.get(n)!;if (nick.kind !== 'nickname' || out.has(n)) continue;
    const formal = keys.find(g => g !== n && mentions.get(g)!.kind === 'given' && !out.has(g) && ((np.lexicon.nicknames.get(n)?.formal ?? []).includes(g) || n.length >= 3 && g.startsWith(n)));
    if (!formal) continue;
    const gender = genderFor(mentions.get(formal)!), pair = shuffled([...np.nicknames[gender], ...(gender === 'u' ? [] : np.nicknames.u)], rng)
      .flatMap(entry => entry.formal.filter(f => fits(f, gender) && free(f) && free(entry.name) && keyOf(f) !== keyOf(entry.name)).map(f => ({ entry, f })))[0];
    if (!pair) return { error: 'RENAME_NICKNAME_RELATION' };
    take(pair.entry.name, 'nickname', gender, n, pair.f); take(pair.f, 'given', gender, formal);
  }
  for (const key of keys) {
    if (out.has(key)) continue;
    const m = mentions.get(key)!, gender = genderFor(m);
    if (m.kind === 'surname') {
      const s = shuffled(np.surnames, rng).find(item => free(item.name));
      if (!s) return { error: 'RENAME_POOL_EXHAUSTED' }; take(s.name, 'surname', 'u', key); continue;
    }
    const nick = m.kind === 'nickname' ? shuffled([...np.nicknames[gender], ...(gender === 'u' ? [] : np.nicknames.u)], rng).find(item => free(item.name)) : undefined;
    if (nick) { take(nick.name, 'nickname', gender, key, nick.formal.find(f => fits(f, gender) && free(f))); continue; }
    // No gender cue: a unisex name first; with a cue: that gender first, unisex after.
    const name = (gender === 'u' ? [...shuffled(np.given.u, rng), ...shuffled([...np.given.f, ...np.given.m], rng)] : [...shuffled(np.given[gender], rng), ...shuffled(np.given.u, rng)]).find(free);
    if (!name) return { error: 'RENAME_POOL_EXHAUSTED' };
    take(name, 'given', gender, key);
  }
  return out;
}
function styled(canonical: string, occurrence: string, keepMarks: boolean) {
  const text = keepMarks ? canonical : stripMarks(canonical);
  if (occurrence.length > 1 && occurrence === occurrence.toUpperCase()) return text.toUpperCase();
  return isUpperInitial(occurrence) ? capitalize(text) : text.toLowerCase();
}
/** The entry with every mapped name replaced in every text (values, literals, message, state, reply), per occurrence case;
 * a name keeps its accents when any occurrence had one or was capitalized, and loses them when always typed lowercase. */
export function renameExample(e: BankExample, mapping: ReadonlyMap<string, Replacement>): BankExample {
  const occurrences = new Map<string, string[]>();
  const visit = (value: unknown, key = ''): void => { if (STRUCTURE.has(key)) return;
    if (typeof value === 'string') for (const w of words(value)) (occurrences.get(w.key) ?? occurrences.set(w.key, []).get(w.key)!).push(w.text);
    else if (Array.isArray(value)) value.forEach(item => visit(item)); else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, k); };
  visit(e);
  const keep = (key: string) => (occurrences.get(key) ?? []).some(text => hasMark(text) || isUpperInitial(text));
  const swap = (text: string) => text.replace(WORD, w => {
    const key = keyOf(w), plural = !mapping.has(key) && isUpperInitial(w) && key.endsWith('s') && mapping.get(key.slice(0, -1))?.kind !== 'surname' ? mapping.get(key.slice(0, -1)) : undefined;
    const m = mapping.get(key) ?? plural;
    return m ? styled(m.canonical, w, keep(mapping.has(key) ? key : key.slice(0, -1))) + (plural ? 's' : '') : w;
  });
  const rewrite = (value: unknown, key = ''): unknown => STRUCTURE.has(key) ? value : typeof value === 'string' ? swap(value) : Array.isArray(value) ? value.map(item => rewrite(item))
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, k)])) : value;
  return bankExample.parse(rewrite(e));
}

// ---------------------------------------------------------------- fictional directory
/** A fictional salon of a DEV type: the professionals the entry names (by full name: given + pool surname, or the formal
 * name of a nickname), distractors (sometimes a homonym), services of that type (the ones the entry says, when the catalog
 * has them, plus others) and today = the example clock in a Brazilian timezone. */
export function fictionalDirectory(renamed: BankExample, mapping: ReadonlyMap<string, Replacement>, np: NamePools, rng: () => number, avoid: Iterable<string> = []): { directory: SalonDirectory; salonType: string } {
  const byReplacement = new Map([...mapping.values()].map(r => [keyOf(r.canonical), r]));
  // `avoid`: the entry's original names (a distractor never brings one back).
  const used = new Set([...[...exampleTexts(renamed), ...[...mapping.values()].flatMap(r => [r.canonical, r.formal ?? ''])].flatMap(t => words(t).map(w => w.key)), ...avoid]);
  const surname = () => { const s = shuffled(np.surnames, rng).find(item => !used.has(keyOf(item.name))) ?? np.surnames[Math.floor(rng() * np.surnames.length)];
    used.add(keyOf(s.name)); return (s.particle && rng() < 0.3 ? s.particle + ' ' : '') + s.name; };
  const said: string[] = [];
  for (const op of renamed.expected.operations) if (op.professional_name) said.push(String(op.professional_name.value));
  const s = renamed.state;
  if ('candidates' in s && s.candidates && 'requested_field' in s && /^professional/.test(s.requested_field)) said.push(...s.candidates.map(label => label.split(/\s[—–-]\s/)[0]));
  const team: string[] = [];
  for (const text of said) {
    const ws = words(text).filter(w => !np.lexicon.honorifics.has(w.key) && !PARTICLES.has(w.key)), parts = ws.map(w => byReplacement.get(w.key));
    if (!ws.length || parts.some(p => !p)) continue;
    const first = parts[0]!, given = first.kind === 'nickname' && first.formal ? first.formal : first.canonical;
    team.push(parts.length > 1 ? [given, ...parts.slice(1).map(p => p!.canonical)].join(' ') : given + ' ' + surname());
  }
  const type = (() => {
    const wanted = [...renamed.expected.operations.flatMap(op => op.service_name ? [String(op.service_name.value)] : []),
      ...('candidates' in s && s.candidates && 'requested_field' in s && /^service/.test(s.requested_field) ? s.candidates : [])].map(t => foldWords(t));
    const matches = (t: SalonType) => t.services.filter(svc => wanted.some(ws => ws.length && [svc.name, ...svc.aliases].some(n => { const f = new Set(foldWords(n)); return ws.every(w => f.has(w)); })));
    const scored = np.salonTypes.map(t => ({ t, m: matches(t) })), best = Math.max(...scored.map(x => x.m.length));
    const pick = shuffled(scored.filter(x => x.m.length === best), rng)[0];
    return pick;
  })();
  const catalog = type.t.services, size = Math.min(catalog.length, 6 + Math.floor(rng() * Math.max(1, catalog.length - 5)));
  const services = [...new Set([...type.m.map(svc => svc.name), ...shuffled(catalog, rng).map(svc => svc.name)])].slice(0, Math.max(size, type.m.length))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const range = type.t.professionals, total = Math.max(team.length + 1, range.min + Math.floor(rng() * (range.max - range.min + 1)));
  if (team.length && rng() < 0.2) { const given = team[Math.floor(rng() * team.length)].split(' ')[0]; team.push(given + ' ' + surname()); }
  const pool = shuffled([...np.given.f, ...np.given.m, ...np.given.u], rng).filter(name => !used.has(keyOf(name)));
  while (team.length < total && pool.length) { const name = pool.shift()!; used.add(keyOf(name)); team.push(name + ' ' + surname()); }
  const timezone = TIMEZONES[Math.floor(rng() * TIMEZONES.length)];
  const weekday = new Date(`${EXAMPLE_CLOCK_DATE}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: timezone, weekday: 'long' });
  return { directory: { professionals: shuffled([...new Set(team)], rng), services, today: { date: EXAMPLE_CLOCK_DATE, weekday, timezone } }, salonType: type.t.id };
}

// ---------------------------------------------------------------- eligibility (failure taxonomy §3)
const publishedOperations = () => new Set(skillRegistry.filter(skill => skill.enabled).flatMap(skill => skill.operations));
/** Reasons an entry is not a training row (empty = eligible), read from the live wire of the current environment. */
export function eligibilityIssues(e: BankExample): string[] {
  const out: string[] = [], mode = e.expected.mode, ops = e.expected.operations;
  if (e.state.kind === 'PLAN') out.push('STATE_PLAN');
  if (mode === 'UNSUPPORTED') out.push('OUT_OF_SCOPE_ONLY');
  const state = examplesState(exampleRoutingContext(e)), features = new Set<string>([...availableExampleFeatures(), ...(state.features ?? [])]);
  const missing = exampleRequirements(e).filter(feature => !features.has(feature));
  if (missing.length) out.push('REQUIRES_UNAVAILABLE:' + missing.join('+'));
  if (e.state.kind !== 'PLAN' && !state.modes.has(mode)) out.push('MODE_UNPUBLISHED');
  const published = publishedOperations();if (ops.some(op => !published.has(op.operation))) out.push('OPERATION_UNPUBLISHED');
  if (['NEW', 'ADD', 'PATCH', 'DISCARD'].includes(mode) && !ops.length || mode === 'CONVERSATION' && !e.expected.response) out.push('INCOMPLETE_OUTPUT');
  return out;
}
const sameShape = (a: BankExample, b: BankExample) => a.state.kind === b.state.kind && a.expected.mode === b.expected.mode &&
  JSON.stringify(a.expected.operations.map(op => op.operation).sort()) === JSON.stringify(b.expected.operations.map(op => op.operation).sort());

// ---------------------------------------------------------------- live request (offline)
type ResponsesBody = { instructions: string; input: { role: string; content: unknown }[]; tools: { type: string; name: string; description?: string; parameters: SecretaryWireSchema }[] };
type Capture = { calls: number; answer: (parameters: SecretaryWireSchema) => unknown; body?: ResponsesBody; args?: unknown; error?: string };
let capture: Capture | undefined;
const errorCode = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 80);
/** The only fetch while exporting: answers the one Responses request with the expected arguments; anything else fails. */
const offlineFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!capture || url !== 'https://api.openai.com/v1/responses') throw Error('FT_EXPORT_OFFLINE');
  if (++capture.calls > 1) throw Error('FT_EXPORT_SECOND_REQUEST');
  const body = JSON.parse(String(init?.body)) as ResponsesBody;capture.body = body;
  try { capture.args = capture.answer(body.tools[0].parameters); } catch (error) { capture.error = 'RENDER:' + errorCode(error); throw error; }
  return new Response(JSON.stringify({ id: 'resp_ft_export', object: 'response', created_at: 0, status: 'completed', model: FT_MODEL_ID,
    output: [{ id: 'fc_ft_export', call_id: 'call_ft_export', type: 'function_call', name: body.tools[0].name, arguments: JSON.stringify(capture.args), status: 'completed' }],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
/** First-turn requirements of the live auto session (src/lib/salon-secretary.ts sendAutomatic), under the current flags. */
const firstTurnRequirements = () => ({ services: { create: getOperationRequirements(), change: getOperationRequirements('service.change') },
  scheduling: { batch: getOperationRequirements('action.batch'), create: getOperationRequirements('appointment.create'), read: getOperationRequirements('appointment.list'),
    availability: getOperationRequirements('availability.get') }, customers: { create: getOperationRequirements('customer.create'), change: getOperationRequirements('customer.change') } });
/** NEW: the first turn (no plan). ANSWER: the plan continuation turn (routing context of the state, continuation draft and
 * requirements), the request the few-shot examples of that state are validated on. */
async function liveRequest(model: Model, e: BankExample, directory: SalonDirectory) {
  const context = exampleRoutingContext(e);
  capture = { calls: 0, answer: parameters => wireTurn(e, 'components', parameters) };
  let failure: string | undefined;
  try {
    await withSalonDirectory(directory, () => context ? withConversationRouting(() => runServicesTurn(model, e.message,
      continuationDraft(context.active_plan!.actions as { item_key: string }[]), continuationRequirements(), 'discovery', true), context)
      : runServicesTurn(model, e.message, {}, firstTurnRequirements(), 'discovery', true));
  } catch (error) { if (!(error instanceof SecretaryRouteRequest)) failure = errorCode(error); }
  const done = capture;capture = undefined;
  if (done.error) return { error: done.error };
  if (done.calls > 1) return { error: 'LITERAL_REPAIR_NEEDED' };
  if (failure || !done.body || done.args === undefined) return { error: 'LIVE_PARSE:' + (failure ?? 'NO_REQUEST') };
  try { inConversationRouting(context, () => decodeConversationTurn(structuredClone(done.args), undefined, e.message, { strict: true })); }
  catch (error) { return { error: 'DECODE_STRICT:' + errorCode(error) }; }
  return { body: done.body, args: done.args };
}

// ---------------------------------------------------------------- OpenAI chat fine-tuning line
export type SftLine = { messages: ({ role: 'system' | 'user'; content: string } | { role: 'assistant'; tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] })[];
  tools: { type: 'function'; function: { name: string; description?: string; parameters: unknown } }[]; parallel_tool_calls: false };
/** The few-shot block's opening words: a row never carries it (examples are off; bank names never reach a row). */
const EXAMPLES_MARK = EXAMPLES_HEADER.slice(0, EXAMPLES_HEADER.indexOf(':'));
const contentText = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => String((part as { text?: unknown })?.text ?? '')).join('') : '';
/** Live request + expected arguments → one training example. `strict` is not part of the fine-tuning tool format; the
 * arguments are already the complete strict object. */
function sftLine(body: ResponsesBody, args: unknown): SftLine {
  const tool = body.tools[0];
  return { messages: [{ role: 'system', content: body.instructions }, ...body.input.map(item => ({ role: item.role === 'user' ? 'user' as const : 'system' as const, content: contentText(item.content) })),
    { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: tool.name, arguments: JSON.stringify(args) } }] }],
  tools: [{ type: 'function', function: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.parameters } }], parallel_tool_calls: false };
}
/** Structural checks of the chat fine-tuning format (roles, one forced tool call, JSON arguments with `turn`, no few-shot block). */
export function sftLineIssues(line: SftLine): string[] {
  const out: string[] = [], messages = line.messages ?? [], last = messages.at(-1), tool = line.tools?.[0]?.function;
  if (line.tools?.length !== 1 || line.tools[0].type !== 'function' || !tool?.name || !tool.parameters) out.push('TOOLS');
  if (line.parallel_tool_calls !== false) out.push('PARALLEL');
  if (!messages.length || messages[0].role !== 'system') out.push('FIRST_NOT_SYSTEM');
  for (const m of messages.slice(0, -1)) if (m.role === 'assistant' || !('content' in m) || typeof m.content !== 'string' || !m.content.trim() || m.content.includes(EXAMPLES_MARK)) out.push('MESSAGE');
  if (!messages.slice(0, -1).some(m => m.role === 'user')) out.push('NO_USER');
  if (!last || last.role !== 'assistant' || !('tool_calls' in last) || last.tool_calls.length !== 1) out.push('ASSISTANT');
  else { const call = last.tool_calls[0];
    if (call.type !== 'function' || call.function.name !== tool?.name) out.push('TOOL_NAME');
    try { const args = JSON.parse(call.function.arguments) as unknown; if (!args || typeof args !== 'object' || !('turn' in args)) out.push('ARGUMENTS'); } catch { out.push('ARGUMENTS_JSON'); } }
  return out;
}

// ---------------------------------------------------------------- export
/** `overlap`: evaluation corpora a row's (renamed) message may not reach (multi-salon/overlap.ts: masked or plain Jaccard >=
 * threshold): such a row is excluded as EVAL_OVERLAP:<corpus>, so training never holds a holdout phrasing nor a dev
 * instance it would be graded on. `names`: extra person words to mask (the pools' are always masked). */
export type ExportOptions = { bank: readonly unknown[]; pools: NamePools; reserved: ReadonlySet<string>; seed?: string; profile?: Readonly<Record<string, string>>;
  overlap?: { corpora: readonly OverlapCorpus[]; names?: ReadonlySet<string>; threshold?: number } };
export type Excluded = { id: string; reasons: string[] };
export type ExportRow = { line: number; id: string; transition: string; operations: string[]; renamed: number; salonType: string; professionals: number; services: number; bytes: number };
export type FtManifest = ReturnType<typeof buildManifest>;
export const bankSha256 = (bank: readonly unknown[]) => createHash('sha256').update(EXAMPLES_RENDER_VERSION + JSON.stringify(bank)).digest('hex');
async function withProfile<T>(profile: Readonly<Record<string, string>>, work: () => Promise<T>): Promise<T> {
  if (!['', 'off', 'false', '0'].includes((profile.SALON_SECRETARY_EXAMPLES ?? '').trim().toLowerCase())) throw Error('FT_EXPORT_EXAMPLES_MUST_BE_OFF');
  const names = [...new Set([...SECRETARY_CONTRACT_ENV, ...Object.keys(profile)])], saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];Object.assign(process.env, profile);
  try { return await work(); } finally { for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
async function offline<T>(work: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;globalThis.fetch = offlineFetch;
  try { return await work(); } finally { globalThis.fetch = original; capture = undefined; }
}
const group = (operation: string) => ({ 'appointment.create': 'create', 'appointment.change': 'change', 'appointment.cancel': 'cancel', 'schedule.block': 'block',
  'appointment.list': 'read', 'appointment.read': 'read', 'availability.get': 'read' } as Record<string, string>)[operation] ?? 'other';
const tally = (values: readonly string[]) => Object.fromEntries([...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a < b ? -1 : 1));
/** Builds the rows in bank order. Deterministic in (bank, pools, reserved, seed, profile, live contract). */
export async function exportFineTuning(o: ExportOptions): Promise<{ lines: string[]; manifest: FtManifest }> {
  const seed = o.seed ?? FT_EXPORT_SEED, profile = o.profile ?? FT_PROFILE, excluded: Excluded[] = [], examples: BankExample[] = [];
  for (const [index, raw] of o.bank.entries()) {
    const parsed = bankExample.safeParse(raw);
    if (!parsed.success) { excluded.push({ id: String((raw as { id?: unknown })?.id ?? `#${index}`), reasons: ['BANK_INVALID'] }); continue; }
    // G1: placeholders are filled first (fixed seed, per entry); the renaming below then replaces those names like any other.
    const fills = exampleFills(parsed.data, seed);
    if (fills) examples.push(fillExample(parsed.data, fills)); else excluded.push({ id: parsed.data.id, reasons: ['FILL_UNAVAILABLE'] });
  }
  const terms = bankTerms(examples), rows: { e: BankExample; line: SftLine; row: Omit<ExportRow, 'line' | 'bytes'> }[] = [];
  // Every name the bank itself shows (values, questions, options) is never a replacement, and no row may carry it.
  const bankNames = new Set(examples.flatMap(e => [...detectNames(e, o.pools, terms).keys()])), pools = withoutNames(o.pools, bankNames);
  // Evaluation/bank person words a row must never carry (same identity as detection; common words and services aside).
  const reserved = new Set([...o.reserved, ...bankNames].map(keyOf).filter(key => !o.pools.lexicon.wordish.has(key) && !o.pools.stop.has(key) && !terms.services.has(key)));
  const overlapMask = o.overlap ? new Set([...o.overlap.names ?? [], ...o.pools.lexicon.given.keys(), ...o.pools.lexicon.nicknames.keys(), ...o.pools.lexicon.surnames,
    ...[...Object.values(o.pools.given).flat(), ...Object.values(o.pools.nicknames).flat().map(n => n.name), ...o.pools.surnames.map(s => s.name)].flatMap(foldWords)]) : new Set<string>();
  const overlap = o.overlap ? { corpora: prepareCorpora(o.overlap.corpora, overlapMask), threshold: o.overlap.threshold ?? MULTI_SALON_OVERLAP_THRESHOLD } : null;
  const overlapping = (text: string) => overlap ? Object.entries(overlapScores(text, overlap.corpora, overlapMask)).filter(([, score]) => score >= overlap.threshold).map(([name]) => name) : [];
  const contract = await withProfile(profile, () => offline(async () => {
    // Offline only: the configuration names the guarded client; its fetch is offlineFetch, which never leaves the process.
    const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: FT_MODEL_ID, SALON_SECRETARY_OPENAI_API_KEY: 'offline-ft-export-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' });
    for (const e of examples) {
      const issues = eligibilityIssues(e);
      if (issues.length) { excluded.push({ id: e.id, reasons: issues }); continue; }
      const rng = mulberry32(hash32(`${seed}|${e.id}`)), mentions = detectNames(e, o.pools, terms), mapping = nameMapping(e, mentions, pools, rng);
      if ('error' in mapping) { excluded.push({ id: e.id, reasons: [String(mapping.error)] }); continue; }
      let renamed: BankExample;
      try { renamed = renameExample(e, mapping); } catch (error) { excluded.push({ id: e.id, reasons: ['RENAME_INVALID:' + errorCode(error)] }); continue; }
      const evaluated = overlapping(renamed.message);
      if (evaluated.length) { excluded.push({ id: e.id, reasons: evaluated.map(name => `EVAL_OVERLAP:${name}`) }); continue; }
      const { directory, salonType } = fictionalDirectory(renamed, mapping, pools, rng, mentions.keys()), live = await liveRequest(model, renamed, directory);
      if ('error' in live) { excluded.push({ id: e.id, reasons: [String(live.error)] }); continue; }
      const line = sftLine(live.body, live.args), format = sftLineIssues(line);
      // No original name may survive anywhere the entry reaches (the instructions are the same fixed text in every row).
      // The timezone id ("America/Sao_Paulo") is not a person.
      const variable = TIMEZONES.reduce((text, zone) => text.split(zone).join(' '), JSON.stringify(line.messages.slice(1))), seen = new Set(words(variable).map(w => w.key));
      const leaks = [...mentions.keys()].filter(key => seen.has(key)).length + [...reserved].filter(key => seen.has(key)).length;
      if (format.length || leaks) { excluded.push({ id: e.id, reasons: [...format.map(code => 'FORMAT:' + code), ...(leaks ? ['NAME_LEAK'] : [])] }); continue; }
      rows.push({ e, line, row: { id: e.id, transition: `${e.state.kind}>${e.expected.mode}`, operations: e.expected.operations.map(op => op.operation), renamed: mapping.size, salonType,
        professionals: directory.professionals.length, services: directory.services.length } });
    }
    return secretaryContractDigest({ modelId: FT_MODEL_ID, presentation: backendPresentationDigest() }).version;
  }));
  const kept: typeof rows = [];
  for (const candidate of rows) {
    const twin = kept.map(k => ({ id: k.e.id, score: sameShape(k.e, candidate.e) ? tokenJaccard(k.e.message, candidate.e.message) : 0 })).filter(k => k.score >= NEAR_DUPLICATE_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0];
    if (twin) excluded.push({ id: candidate.e.id, reasons: [`NEAR_DUPLICATE:${twin.id}:${twin.score.toFixed(2)}`] }); else kept.push(candidate);
  }
  const lines = kept.map(k => JSON.stringify(k.line));
  // Anti-overfitting measure: how often one name is the expected customer/professional (first word, honorifics aside).
  const said = kept.flatMap(k => { const last = k.line.messages.at(-1)!, args = 'tool_calls' in last ? last.tool_calls[0].function.arguments : '';
    return [...args.matchAll(/"(?:customer_name|professional_name)":"([^"]+)"/g)].flatMap(m => words(m[1]).filter(w => !HONORIFICS.includes(w.key) && !PARTICLES.has(w.key)).slice(0, 1).map(w => w.key)); });
  const nameValues = { total: said.length, distinct: new Set(said).size, maxCount: Math.max(0, ...Object.values(tally(said))) };
  const order = new Map(o.bank.map((raw, index) => [String((raw as { id?: unknown })?.id ?? `#${index}`), index]));
  excluded.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { lines, manifest: buildManifest({ o, pools, bankNames: bankNames.size, nameValues, seed, profile, contract, excluded, rows: kept.map((k, i) => ({ ...k.row, line: i + 1, bytes: Buffer.byteLength(lines[i], 'utf8') })) }) };
}
function buildManifest(x: { o: ExportOptions; pools: NamePools; bankNames: number; nameValues: { total: number; distinct: number; maxCount: number }; seed: string; profile: Readonly<Record<string, string>>; contract: string; excluded: Excluded[]; rows: ExportRow[] }) {
  const sha = bankSha256(x.o.bank), rows = x.rows;
  return {
    version: FT_EXPORT_VERSION, format: 'openai-chat-fine-tuning-with-tools',
    notes: ['No training and no network: rows are live requests built offline (runServicesTurn behind a fetch stub).',
      'Line = {messages:[system instructions, system context (fictional directory, example clock), user draft, user message, assistant tool_call], tools, parallel_tool_calls:false}.',
      'Assistant arguments = the expected turn completed for the strict wire (the live tool is strict; `strict` is omitted in the file).',
      'ANSWER rows use the plan-continuation request (discovery wire); single-question answers in production reach the adapter request.',
      'Names: DEV side of the multi-salon pools only (holdout side and holdout salon types never appear); fixtures, dev batteries, Golden and bank names excluded.',
      'Rows whose message reaches a multi-salon evaluation corpus (holdout-side phrasings, dev instances; masked or plain Jaccard >= threshold) are excluded as EVAL_OVERLAP.',
      'Re-export whenever the bank, the pools, the templates, the dev instances, the contract (instructions, wire, flags) or the seed change.'],
    bank: { sha256: sha, sha16: sha.slice(0, 16), renderVersion: EXAMPLES_RENDER_VERSION, entries: x.o.bank.length },
    seed: x.seed, profile: { ...x.profile }, examples: 'off', contractVersion: x.contract, clock: `${EXAMPLE_CLOCK_DATE}T09:00`,
    overlap: x.o.overlap ? { threshold: x.o.overlap.threshold ?? MULTI_SALON_OVERLAP_THRESHOLD, corpora: x.o.overlap.corpora.map(c => ({ name: c.name, texts: c.texts.length })) } : null,
    names: { pool: 'packages/salon-secretary/evaluation/multi-salon/names.json', poolSha256: x.pools.poolSha256, side: 'dev', reservedTokens: x.o.reserved.size, bankNames: x.bankNames,
      given: { f: x.pools.given.f.length, m: x.pools.given.m.length, u: x.pools.given.u.length },
      nicknames: Object.values(x.pools.nicknames).flat().length, surnames: x.pools.surnames.length, salonTypes: x.pools.salonTypes.map(t => t.id) },
    rows: rows.length, bytes: { total: rows.reduce((sum, r) => sum + r.bytes + 1, 0), max: Math.max(0, ...rows.map(r => r.bytes)) },
    counts: { byTransition: tally(rows.map(r => r.transition)), byOperation: tally(rows.flatMap(r => [...new Set(r.operations)])),
      byGroup: tally(rows.flatMap(r => [...new Set(r.operations.map(group))])), multiAction: rows.filter(r => r.operations.length > 1).length,
      bySource: tally(rows.map(r => r.id[0])), bySalonType: tally(rows.map(r => r.salonType)), renamedNames: rows.reduce((sum, r) => sum + r.renamed, 0), nameValues: x.nameValues },
    excluded: x.excluded, excludedByReason: tally(x.excluded.flatMap(item => item.reasons.map(reason => reason.split(':')[0]))),
    lines: rows,
  };
}

// ---------------------------------------------------------------- CLI
export async function main(argv: string[], root = process.cwd()) {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const seed = arg('--seed') ?? FT_EXPORT_SEED, outDir = resolve(root, arg('--out') ?? FT_OUT_DIR), check = argv.includes('--check');
  const bank = JSON.parse(readFileSync(join(root, FT_BANK_FILE), 'utf8')) as unknown[];
  const reserved = new Set([...seenNameTokens(root), ...goldenNameTokens(root)]);
  const { lines, manifest } = await exportFineTuning({ bank, pools: namePools(loadPools(root), reserved), reserved, seed,
    overlap: { corpora: multiSalonCorpora(root), names: overlapNames(root) } });
  const files = { jsonl: join(outDir, `${manifest.bank.sha16}.jsonl`), manifest: join(outDir, `${manifest.bank.sha16}.manifest.json`) };
  if (!check) { mkdirSync(outDir, { recursive: true }); writeFileSync(files.jsonl, lines.join('\n') + '\n'); writeFileSync(files.manifest, JSON.stringify(manifest, null, 1) + '\n'); }
  // Codes, ids and counts only.
  console.log(JSON.stringify({ written: check ? null : files, rows: manifest.rows, bytes: manifest.bytes, counts: manifest.counts, excludedByReason: manifest.excludedByReason,
    excluded: manifest.excluded.length, contractVersion: manifest.contractVersion }, null, 1));
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.error(errorCode(error)); process.exitCode = 1; });
