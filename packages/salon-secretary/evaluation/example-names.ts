/** G1 (28/09/2026): the compact name list the few-shot bank is FILLED with at render time
 * (packages/salon-secretary/src/examples/names.json). Evaluation code: it reads the diversity pools; the runtime only
 * reads the derived JSON, never the pools, and uses it to fill example placeholders, never to recognize a name.
 *
 * A name enters the list only when it is on the DEV side of the pools' seeded split, carries no collision tag (word,
 * temporal, service-like, vocative-like...), shares no folded token with ANY holdout-side entry (persons, spelling
 * variants, nicknames and their formal names, surnames), and is not a person of the evaluation fixtures, the dev
 * batteries or the Golden 30. The generated dev instances draw from the same dev side (train split): they are not
 * excluded, or almost no name would remain. A compact subset of names of at most 8 letters is kept by a seeded hash rank
 * (never by hand), so the rendered block stays close to its former size. Deterministic in (pools, evaluation files).
 * CLI: npx tsx packages/salon-secretary/evaluation/example-names.ts [--check] */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash32 } from './agenda-practice-lib';
import { devBatteryScenarios, foldWords, scenarioNames } from './agenda-practice-stats';
import { goldenNameTokens, namePools } from './ft-export';
import { loadPools, sidePools, type Pools } from './multi-salon/generate';
import { evaluationPeople } from '../src/examples/validate';
import { GENERIC_EXAMPLE_SERVICES, EXAMPLE_NAMES_FILE } from '../src/examples/fill';

export const EXAMPLE_NAMES_SEED = 'example-names-v1';
/** Sizes of the compact list (per gender for given names and nicknames). */
export const EXAMPLE_NAMES_SIZE = { given: 24, unisex: 4, nicknames: 8, surnames: 24, maxLength: 8 } as const;
const PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
const tokens = (text: string) => foldWords(text).filter(w => !PARTICLES.has(w));

/** Every folded token of the holdout side of the pools (any group, variants, nicknames with their formal names, surnames). */
export function holdoutTokens(pools: Pools) {
  const held = sidePools(pools, 'holdout');
  return new Set([...held.persons.flatMap(p => [p.name, ...((p as { variants?: string[] }).variants ?? [])]), ...held.nicknames.flatMap(n => [n.nickname, ...n.formal]),
    ...held.surnames.flatMap(s => [s.name, ...((s as { variants?: string[] }).variants ?? [])])].flatMap(tokens));
}
/** Person words a fill must never show: evaluation fixtures and dev batteries, Golden 30. */
export function reservedEvaluationTokens(root = process.cwd()) {
  return new Set([...evaluationPeople(root), ...goldenNameTokens(root), ...devBatteryScenarios(root).flatMap(scenarioNames).flatMap(tokens)]);
}
const rank = <T>(items: readonly T[], kind: string, key: (item: T) => string) =>
  [...items].map(item => ({ item, h: hash32(`${EXAMPLE_NAMES_SEED}|${kind}|${foldWords(key(item)).join(' ')}`) })).sort((a, b) => a.h - b.h).map(x => x.item);

export type ExampleNamesFile = { about: string[]; version: number; given: Record<'f' | 'm' | 'u', string[]>; nicknames: { name: string; formal?: string; gender: 'f' | 'm' | 'u' }[];
  surnames: string[]; services: string[] };
/** The runtime list, deterministic. */
export function exampleNames(root = process.cwd()): ExampleNamesFile {
  const pools = loadPools(root), reserved = reservedEvaluationTokens(root), held = holdoutTokens(pools);
  const np = namePools(pools, reserved), size = EXAMPLE_NAMES_SIZE;
  const ok = (name: string) => name.length <= size.maxLength && tokens(name).every(w => !held.has(w) && !reserved.has(w) && !np.stop.has(w) && !np.lexicon.wordish.has(w));
  const given = { f: rank(np.given.f.filter(ok), 'f', n => n).slice(0, size.given), m: rank(np.given.m.filter(ok), 'm', n => n).slice(0, size.given),
    u: rank(np.given.u.filter(ok), 'u', n => n).slice(0, size.unisex) };
  const taken = new Set(Object.values(given).flat().flatMap(tokens));
  // A nickname keeps its formal given name when one is eligible ({x.formal} needs it); without one it still fills a
  // nickname slot that never shows the formal name. Unisex nicknames fill either gender.
  const nicknames = (['f', 'm', 'u'] as const).flatMap(gender => rank(np.nicknames[gender].filter(n => ok(n.name) && !taken.has(tokens(n.name)[0])), `nick:${gender}`, n => n.name)
    .map(n => { const formal = n.formal.find(f => ok(f)); return { name: n.name, ...(formal ? { formal } : {}), gender }; }).slice(0, gender === 'u' ? size.unisex : size.nicknames));
  const surnames = rank(np.surnames.filter(s => ok(s.name) && !taken.has(tokens(s.name)[0])), 'surname', s => s.name).slice(0, size.surnames).map(s => s.name);
  return { about: [
    'G1: nomes fictícios que preenchem os marcadores dos exemplos few-shot ({cliente}, {profissional}, {servico}) na hora de montar o pedido.',
    'Uso exclusivo de preenchimento: nenhum código usa esta lista para reconhecer, validar ou resolver nomes.',
    'Gerada por packages/salon-secretary/evaluation/example-names.ts (lado de desenvolvimento dos pools; nenhum token do lado reservado à avaliação; nenhuma pessoa das fixtures, baterias ou do Golden 30). Não edite à mão.',
    'services: lista genérica usada só quando o salão atual não publica seus serviços.'],
  version: 1, given, nicknames, surnames, services: [...GENERIC_EXAMPLE_SERVICES] };
}
export const exampleNamesText = (file: ExampleNamesFile) => JSON.stringify(file, null, 1) + '\n';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd(), text = exampleNamesText(exampleNames(root)), path = join(root, EXAMPLE_NAMES_FILE);
  if (process.argv.includes('--check')) { const same = readFileSync(path, 'utf8').replace(/\r\n/g, '\n') === text; console.log(JSON.stringify({ upToDate: same })); process.exitCode = same ? 0 : 1; }
  else { writeFileSync(path, text); console.log(JSON.stringify({ written: EXAMPLE_NAMES_FILE })); }
}
